from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import psycopg

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
class PlantSnapshot:
    today_energy_kwh: float
    current_power_w: float
    lifetime_energy_kwh: float
    current_power_at: datetime


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


def plant_snapshot(database_url: str) -> PlantSnapshot | None:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            """
            SELECT today_energy_kwh, ac_power_w, lifetime_energy_kwh, received_at
            FROM samples
            WHERE parse_succeeded
              AND today_energy_kwh IS NOT NULL
              AND ac_power_w IS NOT NULL
              AND lifetime_energy_kwh IS NOT NULL
            ORDER BY received_at DESC
            LIMIT 1
            """
        ).fetchone()
    if row is None:
        return None
    today_energy_kwh, ac_power_w, lifetime_energy_kwh, received_at = row
    return PlantSnapshot(
        today_energy_kwh=float(today_energy_kwh),
        current_power_w=float(ac_power_w),
        lifetime_energy_kwh=float(lifetime_energy_kwh),
        current_power_at=received_at,
    )
