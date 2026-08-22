from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

import psycopg

from wattloft.config import now_utc

_LOCAL = ZoneInfo("America/Sao_Paulo")

_SAMPLES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS samples (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    logger_serial TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    ac_power_w DOUBLE PRECISION,
    today_energy_kwh DOUBLE PRECISION,
    lifetime_energy_kwh DOUBLE PRECISION,
    parse_succeeded BOOLEAN NOT NULL
)
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


def ensure_history(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        connection.execute(_SAMPLES_TABLE_SQL)
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
    with psycopg.connect(database_url) as connection:
        connection.execute(
            """
            INSERT INTO samples (
                logger_serial,
                received_at,
                ac_power_w,
                today_energy_kwh,
                lifetime_energy_kwh,
                parse_succeeded
            )
            VALUES (%s, %s, %s, %s, %s, TRUE)
            """,
            (
                logger_serial,
                received_at,
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


def plant_snapshot(
    database_url: str, selected_day: date | None = None
) -> PlantSnapshot | None:
    local_day = now_utc().astimezone(_LOCAL).date()
    curve_day = selected_day or local_day
    with psycopg.connect(database_url) as connection:
        if (
            connection.execute(
                "SELECT 1 FROM samples WHERE parse_succeeded LIMIT 1"
            ).fetchone()
            is None
        ):
            return None
        today_rows = connection.execute(
            """
            SELECT DISTINCT ON (logger_serial) today_energy_kwh
            FROM samples
            WHERE parse_succeeded
              AND today_energy_kwh IS NOT NULL
              AND (received_at AT TIME ZONE 'America/Sao_Paulo')::date = %s
            ORDER BY logger_serial, received_at DESC
            """,
            (local_day,),
        ).fetchall()
        lifetime_rows = connection.execute(
            """
            SELECT DISTINCT ON (logger_serial) lifetime_energy_kwh
            FROM samples
            WHERE parse_succeeded
              AND lifetime_energy_kwh IS NOT NULL
            ORDER BY logger_serial, received_at DESC
            """
        ).fetchall()
        latest_power = connection.execute(
            """
            SELECT received_at
            FROM samples
            WHERE parse_succeeded AND ac_power_w IS NOT NULL
            ORDER BY received_at DESC
            LIMIT 1
            """
        ).fetchone()
        if latest_power is None:
            return None
        current_power_at = latest_power[0]
        power_rows = connection.execute(
            """
            SELECT DISTINCT ON (logger_serial) ac_power_w
            FROM samples
            WHERE parse_succeeded
              AND ac_power_w IS NOT NULL
              AND date_trunc(
                    'minute', received_at AT TIME ZONE 'America/Sao_Paulo'
                  ) = date_trunc(
                    'minute', %s AT TIME ZONE 'America/Sao_Paulo'
                  )
            ORDER BY logger_serial, received_at DESC
            """,
            (current_power_at,),
        ).fetchall()
        bar_rows = connection.execute(
            """
            WITH last_per_logger AS (
                SELECT DISTINCT ON (
                    (received_at AT TIME ZONE 'America/Sao_Paulo')::date,
                    logger_serial
                )
                    (received_at AT TIME ZONE 'America/Sao_Paulo')::date AS local_day,
                    today_energy_kwh
                FROM samples
                WHERE parse_succeeded
                  AND today_energy_kwh IS NOT NULL
                ORDER BY 1, logger_serial, received_at DESC
            )
            SELECT local_day, SUM(today_energy_kwh)
            FROM last_per_logger
            GROUP BY local_day
            ORDER BY local_day
            """
        ).fetchall()
        curve_rows = connection.execute(
            """
            SELECT DISTINCT ON (
                logger_serial,
                date_trunc('minute', received_at AT TIME ZONE 'America/Sao_Paulo')
            )
                logger_serial,
                date_trunc('minute', received_at AT TIME ZONE 'America/Sao_Paulo'),
                ac_power_w
            FROM samples
            WHERE parse_succeeded
              AND ac_power_w IS NOT NULL
              AND (received_at AT TIME ZONE 'America/Sao_Paulo')::date = %s
            ORDER BY logger_serial, 2, received_at DESC
            """,
            (curve_day,),
        ).fetchall()
        curve_points: list[tuple[str, datetime, float]] = []
        for row in curve_rows:
            serial, minute, watts = row
            if isinstance(minute, datetime):
                curve_points.append((str(serial), minute, float(watts)))
    if not lifetime_rows:
        return None
    return PlantSnapshot(
        today_energy_kwh=(
            sum(float(row[0]) for row in today_rows) if today_rows else None
        ),
        current_power_w=sum(float(row[0]) for row in power_rows),
        lifetime_energy_kwh=sum(float(row[0]) for row in lifetime_rows),
        current_power_at=current_power_at,
        local_day_bars=tuple(
            LocalDayBar(local_day=row[0], today_energy_kwh=float(row[1]))
            for row in bar_rows
        ),
        curve=_curve_series(curve_points),
    )
