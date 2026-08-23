from __future__ import annotations

import re
from urllib.parse import parse_qs, unquote, urlparse

import pymysql
from pymysql.connections import Connection

_DATABASE_NAME = re.compile(r"^[A-Za-z0-9_]+$")


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
