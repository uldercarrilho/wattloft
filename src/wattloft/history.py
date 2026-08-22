from __future__ import annotations

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


def ensure_history(database_url: str) -> None:
    with psycopg.connect(database_url) as connection:
        connection.execute(_SAMPLES_TABLE_SQL)
        connection.commit()


def history_is_empty(database_url: str) -> bool:
    with psycopg.connect(database_url) as connection:
        row = connection.execute(
            "SELECT COUNT(*) FROM samples WHERE parse_succeeded"
        ).fetchone()
        return row is None or int(row[0]) == 0
