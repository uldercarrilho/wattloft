from __future__ import annotations

import os
import platform
import socket
import subprocess
import tarfile
import time
import urllib.request
import zipfile
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

import httpx
import pytest

from conftest import OPERATOR_PASSWORD, WattloftProcess, _free_port
from snapshot import snapshot_json
from test_admitted_logger_sample import (
    _ADMITTED_SERIAL,
    _CONTROL_DATA,
    _EXPECTED_ACK,
    _LOCAL,
    _SEQUENCE,
    _live_shaped_upload_header,
    _recv_exact,
    _v5_frame,
    assert_last_sample_is_receive_time,
)

_ROOT = Path(__file__).resolve().parents[1]
_CADDY_VERSION = "2.11.4"
_CADDYFILE = _ROOT / "deploy" / "Caddyfile"
_CACHE = _ROOT / ".cache" / "caddy"
_SERVER = _ROOT / "plant-view" / "dist" / "server.js"


def _caddy_archive_url() -> tuple[str, str]:
    system = {"Windows": "windows", "Linux": "linux", "Darwin": "mac"}[platform.system()]
    machine = platform.machine().lower()
    if machine in {"amd64", "x86_64"}:
        arch = "amd64"
    elif machine in {"arm64", "aarch64"}:
        arch = "arm64"
    else:
        raise RuntimeError(f"unsupported architecture: {platform.machine()}")
    ext = "zip" if system == "windows" else "tar.gz"
    name = f"caddy_{_CADDY_VERSION}_{system}_{arch}.{ext}"
    url = (
        "https://github.com/caddyserver/caddy/releases/download/"
        f"v{_CADDY_VERSION}/{name}"
    )
    return url, ext


def _ensure_caddy() -> Path:
    exe_name = "caddy.exe" if os.name == "nt" else "caddy"
    dest = _CACHE / _CADDY_VERSION / exe_name
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    url, ext = _caddy_archive_url()
    archive_path = dest.parent / f"caddy.{ext}"
    urllib.request.urlretrieve(url, archive_path)
    if ext == "zip":
        with zipfile.ZipFile(archive_path) as archive:
            archive.extract(exe_name, dest.parent)
    else:
        with tarfile.open(archive_path, "r:gz") as archive:
            archive.extract(exe_name, dest.parent, filter="data")
    if os.name != "nt":
        dest.chmod(dest.stat().st_mode | 0o111)
    return dest


class PlantViewProcess:
    def __init__(self, api_url: str) -> None:
        self.api_url = api_url
        self.port = 0
        self.url = ""
        self._proc: subprocess.Popen[bytes] | None = None
        self._log_path: Path | None = None

    def start(self) -> None:
        if not _SERVER.is_file():
            raise FileNotFoundError(
                f"missing {_SERVER}; run npm ci && npm run build in plant-view"
            )
        self.port = _free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        log_path = (
            _ROOT / ".cache" / "plant-view" / f"{self.port}.log"
        )
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = log_path.open("w", encoding="utf-8")
        self._log_path = log_path
        env = os.environ.copy()
        env.update(
            {
                "OPERATOR_PASSWORD": OPERATOR_PASSWORD,
                "WATTLOFT_API_URL": self.api_url,
                "PLANT_VIEW_HOST": "127.0.0.1",
                "PLANT_VIEW_PORT": str(self.port),
                "COOKIE_SECURE": "false",
            }
        )
        self._proc = subprocess.Popen(
            ["node", str(_SERVER)],
            cwd=str(_ROOT / "plant-view"),
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        log_file.close()

    def wait_until_listening(self, timeout_s: float = 20) -> None:
        assert self._proc is not None
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self._proc.poll() is not None:
                raise RuntimeError(
                    f"plant-view exited {self._proc.returncode}:\n{self.log_text()}"
                )
            try:
                httpx.get(self.url, timeout=0.3)
            except httpx.TransportError:
                time.sleep(0.05)
                continue
            return
        raise RuntimeError(
            f"plant-view did not listen in time:\n{self.log_text()}"
        )

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


class PlantViewProxy:
    def __init__(self, wattloft: WattloftProcess, plant_view_port: int) -> None:
        self.wattloft = wattloft
        self.plant_view_port = plant_view_port
        self.http_port = 0
        self.https_port = 0
        self.http_url = ""
        self.https_url = ""
        self._proc: subprocess.Popen[bytes] | None = None
        self._log_path: Path | None = None

    def start(self) -> None:
        if not _CADDYFILE.is_file():
            raise FileNotFoundError(f"missing proxy config: {_CADDYFILE}")
        self.http_port = _free_port()
        self.https_port = _free_port()
        self.http_url = f"http://localhost:{self.http_port}"
        self.https_url = f"https://localhost:{self.https_port}"
        data_dir = _ROOT / ".cache" / "caddy-data" / str(self.https_port)
        data_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env.update(
            {
                "WATTLOFT_HOSTNAME": "localhost",
                "WATTLOFT_HTTP_PORT": str(self.http_port),
                "WATTLOFT_HTTPS_PORT": str(self.https_port),
                "PLANT_VIEW_PORT": str(self.plant_view_port),
                "APPDATA": str(data_dir / "appdata"),
                "HOME": str(data_dir),
                "XDG_DATA_HOME": str(data_dir / "share"),
            }
        )
        log_path = data_dir / "caddy.log"
        log_file = log_path.open("w", encoding="utf-8")
        self._log_path = log_path
        self._proc = subprocess.Popen(
            [
                str(_ensure_caddy()),
                "run",
                "--config",
                str(_CADDYFILE),
                "--adapter",
                "caddyfile",
            ],
            env=env,
            cwd=str(data_dir),
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        log_file.close()

    def wait_until_listening(self, timeout_s: float = 20) -> None:
        assert self._proc is not None
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self._proc.poll() is not None:
                raise RuntimeError(
                    f"proxy exited {self._proc.returncode}:\n{self.log_text()}"
                )
            try:
                httpx.get(self.http_url, timeout=0.3)
            except httpx.TransportError:
                time.sleep(0.05)
                continue
            try:
                httpx.get(self.https_url, timeout=0.3, verify=False)
            except httpx.TransportError:
                time.sleep(0.05)
                continue
            return
        raise RuntimeError(f"proxy did not listen in time:\n{self.log_text()}")

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


@pytest.fixture
def plant_view(wattloft: WattloftProcess) -> Iterator[PlantViewProcess]:
    process = PlantViewProcess(wattloft.url)
    process.start()
    process.wait_until_listening()
    try:
        yield process
    finally:
        process.stop()


@pytest.fixture
def proxy(
    wattloft: WattloftProcess, plant_view: PlantViewProcess
) -> Iterator[PlantViewProxy]:
    process = PlantViewProxy(wattloft, plant_view.port)
    process.start()
    process.wait_until_listening()
    try:
        yield process
    finally:
        process.stop()


def test_proxy_http_does_not_serve_plant_view(proxy: PlantViewProxy) -> None:
    response = httpx.get(proxy.http_url, follow_redirects=False)
    assert response.status_code in {301, 302, 307, 308}
    assert response.headers["location"].startswith("https://")
    assert "Password" not in response.text
    assert "This Plant has no History yet." not in response.text


def test_operator_reaches_plant_view_through_https_proxy(
    proxy: PlantViewProxy,
) -> None:
    with httpx.Client(
        base_url=proxy.https_url, follow_redirects=False, verify=False
    ) as client:
        spa = client.get("/")
        assert spa.status_code == 200
        assert 'id="root"' in spa.text
        denied = client.get("/api/plant")
        assert denied.status_code == 401
        granted = client.post("/login", data={"password": OPERATOR_PASSWORD})
        assert granted.status_code == 303
        plant = client.get("/api/plant")
        assert plant.status_code == 200
        assert plant.json()["empty"] is True
        assert plant.url.scheme == "https"


def test_admitted_logger_sample_is_visible_after_https_login(
    proxy: PlantViewProxy,
) -> None:
    frame = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    before = datetime.now(_LOCAL)
    with socket.create_connection(
        ("127.0.0.1", proxy.wattloft.ingest_port), timeout=5
    ) as sock:
        sock.sendall(frame)
        ack = _recv_exact(sock, len(_EXPECTED_ACK))
    after = datetime.now(_LOCAL)

    assert ack == _EXPECTED_ACK
    snapshot_json(proxy.wattloft.url)

    with httpx.Client(
        base_url=proxy.https_url, follow_redirects=False, verify=False
    ) as client:
        client.post("/login", data={"password": OPERATOR_PASSWORD})
        plant = client.get("/api/plant")

    assert plant.status_code == 200
    body = plant.json()
    assert body["empty"] is False
    assert body["today_energy_kwh"] == 1.1
    assert body["current_power_w"] == 625
    assert body["lifetime_energy_kwh"] == 5635.4
    assert_last_sample_is_receive_time(body, before=before, after=after)
