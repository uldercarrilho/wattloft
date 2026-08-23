from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from wattloft.history._mysql import _connect, _database_name

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
class _SampleRow:
    logger_serial: str
    received_at: datetime
    ac_power_w: float | None
    today_energy_kwh: float | None
    lifetime_energy_kwh: float | None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _as_float(value: float | None) -> float | None:
    if value is None:
        return None
    return float(value)


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


def load_successful_samples(database_url: str) -> tuple[_SampleRow, ...]:
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
