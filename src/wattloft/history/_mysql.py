from __future__ import annotations

import re
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from queue import Empty, Queue
from urllib.parse import parse_qs, unquote, urlparse

import pymysql
from pymysql.connections import Connection
from pymysql.err import InterfaceError, OperationalError

_DATABASE_NAME = re.compile(r"^[A-Za-z0-9_]+$")
_POOL_SIZE = 5
_pools: dict[str, _ConnectionPool] = {}
_pools_lock = threading.Lock()


def _database_name(database_url: str) -> str:
    name = unquote(urlparse(database_url).path.lstrip("/"))
    if not _DATABASE_NAME.fullmatch(name):
        raise ValueError(f"invalid database name: {name!r}")
    return name


def _connect(database_url: str, *, use_database: bool = True) -> Connection:
    parsed = urlparse(database_url)
    query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 3306
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    database = _database_name(database_url) if use_database else None
    ssl: dict[str, object] | None = None
    if query.get("ssl", "").lower() in {"1", "true", "required"}:
        ssl = {"check_hostname": False}
    connect_timeout = (
        int(query["connect_timeout"]) if "connect_timeout" in query else 10
    )
    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        charset="utf8mb4",
        autocommit=False,
        ssl=ssl,
        connect_timeout=connect_timeout,
    )


class _ConnectionPool:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._idle: Queue[Connection] = Queue()
        self._created = 0
        self._lock = threading.Lock()

    def acquire(self) -> Connection:
        while True:
            try:
                conn = self._idle.get_nowait()
            except Empty:
                conn = None
            if conn is not None:
                return self._checked(conn)
            with self._lock:
                if self._created < _POOL_SIZE:
                    self._created += 1
                    try:
                        return _connect(self._database_url)
                    except Exception:
                        self._created -= 1
                        raise
            return self._checked(self._idle.get())

    def _checked(self, conn: Connection) -> Connection:
        try:
            conn.ping()
            return conn
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            return _connect(self._database_url)

    def release(self, conn: Connection, *, discard: bool = False) -> None:
        if not discard:
            try:
                conn.rollback()
                self._idle.put(conn)
                return
            except Exception:
                discard = True
        try:
            conn.close()
        except Exception:
            pass
        with self._lock:
            self._created = max(0, self._created - 1)

    def close(self) -> None:
        while True:
            try:
                conn = self._idle.get_nowait()
            except Empty:
                break
            try:
                conn.close()
            except Exception:
                pass
        with self._lock:
            self._created = 0


def _pool_for(database_url: str) -> _ConnectionPool:
    with _pools_lock:
        pool = _pools.get(database_url)
        if pool is None:
            pool = _ConnectionPool(database_url)
            _pools[database_url] = pool
        return pool


@contextmanager
def connection(
    database_url: str, *, use_database: bool = True
) -> Iterator[Connection]:
    if not use_database:
        conn = _connect(database_url, use_database=False)
        try:
            yield conn
        finally:
            conn.close()
        return
    pool = _pool_for(database_url)
    conn = pool.acquire()
    discard = False
    try:
        yield conn
    except (OperationalError, InterfaceError):
        discard = True
        raise
    finally:
        pool.release(conn, discard=discard)
