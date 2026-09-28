from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from conftest import _reset_history

from wattloft.history._mysql import _connect
from wattloft.history._snapshot import plant_snapshot
from wattloft.history._store import (
    dump_history,
    ensure_history,
    load_day_summaries,
    record_sample,
    restore_history,
)

_LOCAL = ZoneInfo("America/Sao_Paulo")
_EAST = "1000000001"
_WEST = "1000000002"


@pytest.fixture
def history_url(mysql_url: str) -> str:
    ensure_history(mysql_url)
    _reset_history(mysql_url)
    return mysql_url


def test_day_summaries_has_clipping_columns(history_url: str) -> None:
    with _connect(history_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
                FROM information_schema.columns
                WHERE table_schema = DATABASE() AND table_name = 'day_summaries'
                  AND COLUMN_NAME IN ('clipped_minutes', 'estimated_clipped_kwh')
                ORDER BY COLUMN_NAME
                """
            )
            rows = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}

    assert "clipped_minutes" in rows
    assert "int" in rows["clipped_minutes"][0].lower()
    assert rows["clipped_minutes"][1] == "NO"

    assert "estimated_clipped_kwh" in rows
    assert "double" in rows["estimated_clipped_kwh"][0].lower()
    assert rows["estimated_clipped_kwh"][1] == "YES"


def test_dump_and_restore_preserves_clipping_and_summaries(history_url: str) -> None:
    # Record samples across two days
    t1 = datetime(2026, 9, 8, 12, 0, tzinfo=_LOCAL)
    t2 = datetime(2026, 9, 9, 12, 0, tzinfo=_LOCAL)
    record_sample(
        history_url,
        logger_serial=_EAST,
        received_at=t1,
        ac_power_w=500.0,
        today_energy_kwh=3.0,
        lifetime_energy_kwh=100.0,
    )
    record_sample(
        history_url,
        logger_serial=_EAST,
        received_at=t2,
        ac_power_w=998.0,
        today_energy_kwh=4.0,
        lifetime_energy_kwh=104.0,
    )

    dump = dump_history(history_url)
    assert "day_summaries" in dump
    assert "clipped_minutes" in dump
    assert "estimated_clipped_kwh" in dump

    # Wipe and restore
    _reset_history(history_url)
    restore_history(history_url, dump)

    summaries = load_day_summaries(history_url)
    assert len(summaries) == 2
    assert summaries[0].local_day == date(2026, 9, 8)
    assert summaries[1].local_day == date(2026, 9, 9)
    assert summaries[1].last_today_energy_kwh == 4.0


def test_plant_snapshot_computes_diagnostics_and_ideal_envelope(history_url: str) -> None:
    # Record samples for East and West on a day with 1 kW plateau
    plateau_start = datetime(2026, 9, 9, 12, 0, tzinfo=_LOCAL)
    for m in range(75):
        t = plateau_start + timedelta(minutes=m)
        w = 998.0 + (1.0 if m % 2 == 0 else -1.0)
        record_sample(
            history_url,
            logger_serial=_EAST,
            received_at=t,
            ac_power_w=w,
            today_energy_kwh=3.0 + (m * 0.01),
            lifetime_energy_kwh=100.0 + (m * 0.01),
        )
        record_sample(
            history_url,
            logger_serial=_WEST,
            received_at=t,
            ac_power_w=w,
            today_energy_kwh=3.0 + (m * 0.01),
            lifetime_energy_kwh=100.0 + (m * 0.01),
        )

    snapshot = plant_snapshot(history_url, date(2026, 9, 9))
    assert snapshot is not None
    # Ideal clear-sky envelope is computed
    assert len(snapshot.ideal_curve) > 0
    assert any(p.watts > 1000 for p in snapshot.ideal_curve)

    # Clipping detected on 75-minute plateau
    assert snapshot.clipping is not None
    assert snapshot.clipping.clipped is True
    assert snapshot.clipping.clipped_minutes >= 75
    assert snapshot.clipping.estimated_clipped_kwh is not None
    assert snapshot.clipping.estimated_clipped_kwh > 0
