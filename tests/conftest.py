from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from pymysql.err import ProgrammingError
from testcontainers.community.mysql import MySqlContainer

from wattloft.history._mysql import _connect

OPERATOR_PASSWORD = "correct-horse"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class WattloftProcess:
    def __init__(self, database_url: str, *, now: str | None = None) -> None:
        self.database_url = database_url
        self.now = now
        self.port = 0
        self.ingest_port = 0
        self.url = ""
        self._proc: subprocess.Popen[bytes] | None = None
        self._log_file = None
        self._log_path: Path | None = None

    def start(self) -> None:
        self.port = _free_port()
        self.ingest_port = _free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        env = os.environ.copy()
        env.update(
            {
                "DATABASE_URL": self.database_url,
                "OPERATOR_PASSWORD": OPERATOR_PASSWORD,
                "PLANT_VIEW_HOST": "127.0.0.1",
                "PLANT_VIEW_PORT": str(self.port),
                "INGEST_HOST": "127.0.0.1",
                "INGEST_PORT": str(self.ingest_port),
            }
        )
        if self.now is not None:
            env["WATTLOFT_NOW"] = self.now
        log_file = tempfile.NamedTemporaryFile(
            prefix=f"wattloft-test-{self.port}-",
            suffix=".log",
            mode="w",
            encoding="utf-8",
            delete=False,
        )
        self._log_file = log_file
        self._log_path = Path(log_file.name)
        self._proc = subprocess.Popen(
            [sys.executable, "-m", "wattloft"],
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )

    def wait_until_listening(self, timeout_s: float = 20) -> None:
        assert self._proc is not None
        assert self._log_path is not None
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self._proc.poll() is not None:
                raise RuntimeError(
                    f"Wattloft process exited {self._proc.returncode}:\n{self.log_text()}"
                )
            try:
                httpx.get(self.url, timeout=0.3)
            except httpx.TransportError:
                time.sleep(0.05)
                continue
            try:
                with socket.create_connection(
                    ("127.0.0.1", self.ingest_port), timeout=0.3
                ):
                    return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError(
            f"Wattloft process did not listen in time:\n{self.log_text()}"
        )

    def wait_until_exited(self, timeout_s: float = 15) -> int:
        assert self._proc is not None
        try:
            return int(self._proc.wait(timeout=timeout_s))
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"Wattloft process still running:\n{self.log_text()}"
            ) from exc

    def log_text(self) -> str:
        if self._log_path is None:
            return ""
        return self._log_path.read_text(encoding="utf-8")

    def stop(self) -> None:
        if self._proc is not None and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait(timeout=5)
        if self._log_file is not None:
            self._log_file.close()
            self._log_file = None

    def restart(self) -> None:
        self.stop()
        self.start()
        self.wait_until_listening()


def _reset_history(database_url: str) -> None:
    with _connect(database_url) as connection:
        try:
            with connection.cursor() as cursor:
                cursor.execute("TRUNCATE TABLE samples")
            connection.commit()
        except ProgrammingError as exc:
            if exc.args[0] != 1146:
                raise
            connection.rollback()


@pytest.fixture(scope="session")
def mysql_url() -> Iterator[str]:
    with MySqlContainer("mysql:8.4") as mysql:
        yield mysql.get_connection_url()


@pytest.fixture
def wattloft(mysql_url: str) -> Iterator[WattloftProcess]:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url)
    process.start()
    process.wait_until_listening()
    try:
        yield process
    finally:
        process.stop()


@pytest.fixture
def plant_view_url(wattloft: WattloftProcess) -> str:
    return wattloft.url
