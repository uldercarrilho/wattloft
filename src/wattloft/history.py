from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timezone
from urllib.parse import parse_qs, unquote, urlparse
from zoneinfo import ZoneInfo

import pymysql
from pymysql.connections import Connection

from wattloft.config import now_utc

_LOCAL = ZoneInfo("America/Sao_Paulo")
_DATABASE_NAME = re.compile(r"^[A-Za-z0-9_]+$")

_SAMPLES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS samples (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    logger_serial VARCHAR(32) NOT NULL,
    received_at DATETIME(6) NOT NULL,
    ac_power_w DOUBLE,
    today_energy_kwh DOUBLE,
    lifetime_energy_kwh DOUBLE,
    parse_succeeded TINYINT(1) NOT NULL
)
"""

_DUMP_SELECT_SQL = """
SELECT logger_serial, received_at, ac_power_w,
       today_energy_kwh, lifetime_energy_kwh, parse_succeeded
FROM samples
ORDER BY received_at, logger_serial
"""


@dataclass(frozen=True)
class CurvePoint:
    at: datetime
    watts: float


@dataclass(frozen=True)
class CurveSeries:
    name: str
    points: tuple[CurvePoint, ...]


@dataclass(frozen=True)
class LocalDayBar:
    local_day: date
    today_energy_kwh: float


@dataclass(frozen=True)
class PlantSnapshot:
    today_energy_kwh: float | None
    current_power_w: float
    lifetime_energy_kwh: float
    current_power_at: datetime
    local_day_bars: tuple[LocalDayBar, ...]
    curve: tuple[CurveSeries, ...]


@dataclass(frozen=True)
class _SampleRow:
    logger_serial: str
    received_at: datetime
    ac_power_w: float | None
    today_energy_kwh: float | None
    lifetime_energy_kwh: float | None


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
    ssl: dict[str, bool] | None = None
    if query.get("ssl", "").lower() in {"1", "true", "required"}:
        ssl = {"check_hostname": False}
    if "connect_timeout" in query:
        return pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            charset="utf8mb4",
            autocommit=False,
            ssl=ssl,
            connect_timeout=int(query["connect_timeout"]),
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
    )


def _sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, datetime):
        stamped = _as_utc(value).replace(tzinfo=None)
        return "'" + stamped.strftime("%Y-%m-%d %H:%M:%S.%f") + "'"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    text = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return "'" + text + "'"


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _local(value: datetime) -> datetime:
    return _as_utc(value).astimezone(_LOCAL)


def _local_minute(value: datetime) -> datetime:
    stamped = _local(value).replace(second=0, microsecond=0)
    return stamped.replace(tzinfo=None)


def _as_float(value: float | None) -> float | None:
    if value is None:
        return None
    return float(value)


def ensure_history(database_url: str) -> None:
    name = _database_name(database_url)
    with _connect(database_url, use_database=False) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{name}`")
        connection.commit()
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(_SAMPLES_TABLE_SQL)
        connection.commit()


def dump_history(database_url: str) -> str:
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(_DUMP_SELECT_SQL)
            rows = cursor.fetchall()
    statements = [_SAMPLES_TABLE_SQL.strip() + ";"]
    for row in rows:
        values = ", ".join(_sql_literal(item) for item in row)
        statements.append(
            "INSERT INTO samples ("
            "logger_serial, received_at, ac_power_w, "
            "today_energy_kwh, lifetime_energy_kwh, parse_succeeded"
            f") VALUES ({values});"
        )
    return "\n".join(statements) + "\n"


def restore_history(database_url: str, dump: str) -> None:
    ensure_history(database_url)
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            for raw in dump.split(";"):
                statement = raw.strip()
                if statement:
                    cursor.execute(statement)
        connection.commit()


def record_sample(
    database_url: str,
    *,
    logger_serial: str,
    received_at: datetime,
    ac_power_w: float,
    today_energy_kwh: float,
    lifetime_energy_kwh: float,
) -> None:
    stored_at = _as_utc(received_at).replace(tzinfo=None)
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO samples (
                    logger_serial,
                    received_at,
                    ac_power_w,
                    today_energy_kwh,
                    lifetime_energy_kwh,
                    parse_succeeded
                )
                VALUES (%s, %s, %s, %s, %s, 1)
                """,
                (
                    logger_serial,
                    stored_at,
                    ac_power_w,
                    today_energy_kwh,
                    lifetime_energy_kwh,
                ),
            )
        connection.commit()


def _curve_series(rows: Iterable[tuple[str, datetime, float]]) -> tuple[CurveSeries, ...]:
    by_logger: dict[str, list[CurvePoint]] = {}
    by_minute: dict[datetime, float] = {}
    for serial, minute, watts in rows:
        point = CurvePoint(at=minute, watts=watts)
        by_logger.setdefault(serial, []).append(point)
        by_minute[minute] = by_minute.get(minute, 0.0) + watts
    series = [
        CurveSeries(name=name, points=tuple(sorted(points, key=lambda item: item.at)))
        for name, points in sorted(by_logger.items())
    ]
    if by_minute:
        series.append(
            CurveSeries(
                name="Plant",
                points=tuple(
                    CurvePoint(at=minute, watts=watts)
                    for minute, watts in sorted(by_minute.items())
                ),
            )
        )
    return tuple(series)


def _load_successful_samples(database_url: str) -> tuple[_SampleRow, ...]:
    with _connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT logger_serial, received_at, ac_power_w,
                       today_energy_kwh, lifetime_energy_kwh
                FROM samples
                WHERE parse_succeeded
                ORDER BY received_at
                """
            )
            rows = cursor.fetchall()
    samples: list[_SampleRow] = []
    for row in rows:
        serial, received_at, ac_power_w, today_energy_kwh, lifetime_energy_kwh = row
        samples.append(
            _SampleRow(
                logger_serial=str(serial),
                received_at=_as_utc(received_at),
                ac_power_w=_as_float(ac_power_w),
                today_energy_kwh=_as_float(today_energy_kwh),
                lifetime_energy_kwh=_as_float(lifetime_energy_kwh),
            )
        )
    return tuple(samples)


def plant_snapshot(
    database_url: str, selected_day: date | None = None
) -> PlantSnapshot | None:
    local_day = now_utc().astimezone(_LOCAL).date()
    curve_day = selected_day or local_day
    samples = _load_successful_samples(database_url)
    if not samples:
        return None

    today_last: dict[str, float] = {}
    lifetime_last: dict[str, float] = {}
    latest_power_at: datetime | None = None
    power_in_minute: dict[str, float] = {}
    bar_last: dict[tuple[date, str], float] = {}
    curve_last: dict[tuple[str, datetime], float] = {}

    for sample in samples:
        local_stamp = _local(sample.received_at)
        sample_day = local_stamp.date()
        if sample.today_energy_kwh is not None:
            if sample_day == local_day:
                today_last[sample.logger_serial] = sample.today_energy_kwh
            bar_last[(sample_day, sample.logger_serial)] = sample.today_energy_kwh
        if sample.lifetime_energy_kwh is not None:
            lifetime_last[sample.logger_serial] = sample.lifetime_energy_kwh
        if sample.ac_power_w is None:
            continue
        if latest_power_at is None or sample.received_at >= latest_power_at:
            latest_power_at = sample.received_at
        if sample_day == curve_day:
            curve_last[(sample.logger_serial, _local_minute(sample.received_at))] = (
                sample.ac_power_w
            )

    if not lifetime_last or latest_power_at is None:
        return None

    current_minute = _local_minute(latest_power_at)
    for sample in samples:
        if sample.ac_power_w is None:
            continue
        if _local_minute(sample.received_at) == current_minute:
            power_in_minute[sample.logger_serial] = sample.ac_power_w

    by_bar_day: dict[date, float] = {}
    for (day, _), kwh in bar_last.items():
        by_bar_day[day] = by_bar_day.get(day, 0.0) + kwh

    curve_points = [
        (serial, minute, watts) for (serial, minute), watts in curve_last.items()
    ]

    return PlantSnapshot(
        today_energy_kwh=sum(today_last.values()) if today_last else None,
        current_power_w=sum(power_in_minute.values()),
        lifetime_energy_kwh=sum(lifetime_last.values()),
        current_power_at=latest_power_at,
        local_day_bars=tuple(
            LocalDayBar(local_day=day, today_energy_kwh=kwh)
            for day, kwh in sorted(by_bar_day.items())
        ),
        curve=_curve_series(curve_points),
    )
