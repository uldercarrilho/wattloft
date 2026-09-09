from __future__ import annotations

import threading
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from conftest import _reset_history

from wattloft.config import ADMITTED_LOGGER_SERIALS
from wattloft.history._mysql import _connect, connection
from wattloft.history._snapshot import build_plant_snapshot, plant_snapshot
from wattloft.history._store import (
    dump_history,
    ensure_history,
    load_day_summaries,
    load_latest_logger_samples,
    load_samples_for_local_day,
    load_successful_samples,
    record_sample,
    restore_history,
)
from wattloft.ingest import handle_frame
from wattloft.v5 import CONTROL_DATA, build_v5_frame

_LOCAL = ZoneInfo("America/Sao_Paulo")
_EAST = "1000000001"
_WEST = "1000000002"


@pytest.fixture
def history_url(mysql_url: str) -> str:
    ensure_history(mysql_url)
    _reset_history(mysql_url)
    return mysql_url


def _at(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp).replace(tzinfo=_LOCAL)


def _indexes(database_url: str, table: str) -> set[str]:
    with _connect(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT INDEX_NAME FROM information_schema.statistics
                WHERE table_schema = DATABASE() AND table_name = %s
                """,
                (table,),
            )
            return {str(row[0]) for row in cursor.fetchall()}


def _tables(database_url: str) -> set[str]:
    with _connect(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SHOW TABLES")
            return {str(row[0]) for row in cursor.fetchall()}


def _summaries(database_url: str) -> list[tuple[object, ...]]:
    with _connect(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT local_day, logger_serial, start_lifetime_kwh,
                       last_lifetime_kwh, last_today_energy_kwh,
                       peak_power_w, sample_count
                FROM day_summaries
                ORDER BY local_day, logger_serial
                """
            )
            return list(cursor.fetchall())


def _sample_flags(database_url: str) -> list[int]:
    with _connect(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT parse_succeeded FROM samples ORDER BY id"
            )
            return [int(row[0]) for row in cursor.fetchall()]


def _insert_raw_sample(
    database_url: str,
    *,
    logger_serial: str,
    received_at: datetime,
    ac_power_w: float | None,
    today_energy_kwh: float | None,
    lifetime_energy_kwh: float | None,
    parse_succeeded: int = 1,
) -> None:
    stored_at = received_at.astimezone(timezone.utc).replace(tzinfo=None)
    with _connect(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO samples (
                    logger_serial, received_at, ac_power_w,
                    today_energy_kwh, lifetime_energy_kwh, parse_succeeded
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    logger_serial,
                    stored_at,
                    ac_power_w,
                    today_energy_kwh,
                    lifetime_energy_kwh,
                    parse_succeeded,
                ),
            )
        conn.commit()


def _record(
    database_url: str,
    stamp: str,
    *,
    serial: str = _EAST,
    watts: float | None = 400.0,
    today: float | None = 1.0,
    lifetime: float | None = 1000.0,
    parse_succeeded: bool = True,
) -> None:
    record_sample(
        database_url,
        logger_serial=serial,
        received_at=_at(stamp),
        ac_power_w=watts,
        today_energy_kwh=today,
        lifetime_energy_kwh=lifetime,
        parse_succeeded=parse_succeeded,
    )


def test_pool_two_checkouts_run_concurrently(history_url: str) -> None:
    ensure_history(history_url)
    started = threading.Event()
    hold = threading.Event()
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            with connection(history_url) as conn:
                started.set()
                assert hold.wait(timeout=5)
                with conn.cursor() as cursor:
                    cursor.execute("SELECT 1")
                    assert cursor.fetchone() == (1,)
        except BaseException as exc:
            errors.append(exc)

    thread = threading.Thread(target=worker)
    thread.start()
    assert started.wait(timeout=5)
    with connection(history_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
            assert cursor.fetchone() == (1,)
    hold.set()
    thread.join(timeout=5)
    assert not thread.is_alive()
    assert errors == []


def test_pool_replaces_killed_connection(history_url: str) -> None:
    ensure_history(history_url)
    with connection(history_url) as conn:
        conn.close()
    with connection(history_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
            assert cursor.fetchone() == (1,)


def test_ensure_history_creates_indexes_and_day_summaries(history_url: str) -> None:
    ensure_history(history_url)
    tables = _tables(history_url)
    assert "day_summaries" in tables
    assert "history_meta" in tables
    names = _indexes(history_url, "samples")
    assert "idx_samples_received_serial" in names
    assert "idx_samples_success_received" in names
    ensure_history(history_url)
    assert "idx_samples_received_serial" in _indexes(history_url, "samples")


def test_ensure_history_backfills_day_summaries_from_samples(history_url: str) -> None:
    ensure_history(history_url)
    _insert_raw_sample(
        history_url,
        logger_serial=_EAST,
        received_at=_at("2026-08-25T18:00:00"),
        ac_power_w=50.0,
        today_energy_kwh=5.0,
        lifetime_energy_kwh=1000.0,
    )
    _insert_raw_sample(
        history_url,
        logger_serial=_EAST,
        received_at=_at("2026-08-26T12:00:00"),
        ac_power_w=400.0,
        today_energy_kwh=8.0,
        lifetime_energy_kwh=1008.0,
    )
    _insert_raw_sample(
        history_url,
        logger_serial=_EAST,
        received_at=_at("2026-08-26T18:00:00"),
        ac_power_w=0.0,
        today_energy_kwh=0.0,
        lifetime_energy_kwh=0.0,
    )
    ensure_history(history_url)
    rows = _summaries(history_url)
    assert len(rows) == 2
    first, second = rows
    assert first[0] == date(2026, 8, 25)
    assert first[1] == _EAST
    assert first[2] == 1000.0
    assert first[3] == 1000.0
    assert first[4] == 5.0
    assert first[5] == 50.0
    assert first[6] == 1
    assert second[0] == date(2026, 8, 26)
    assert second[2] == 1008.0
    assert second[3] == 1008.0
    assert second[4] == 8.0
    assert second[5] == 400.0
    assert second[6] == 2


def test_record_sample_upserts_day_summaries(history_url: str) -> None:
    ensure_history(history_url)
    _record(history_url, "2026-09-01T12:00:00", watts=210.0, today=2.0, lifetime=1000.0)
    _record(history_url, "2026-09-01T13:00:00", watts=180.0, today=3.0, lifetime=1001.0)
    rows = _summaries(history_url)
    assert len(rows) == 1
    row = rows[0]
    assert row[0] == date(2026, 9, 1)
    assert row[2] == 1000.0
    assert row[3] == 1001.0
    assert row[4] == 3.0
    assert row[5] == 210.0
    assert row[6] == 2


def test_failed_sample_does_not_touch_day_summaries(history_url: str) -> None:
    ensure_history(history_url)
    _record(history_url, "2026-09-01T12:00:00", watts=210.0, today=2.0, lifetime=1000.0)
    _record(
        history_url,
        "2026-09-01T12:01:00",
        watts=None,
        today=None,
        lifetime=None,
        parse_succeeded=False,
    )
    assert _sample_flags(history_url) == [1, 0]
    rows = _summaries(history_url)
    assert len(rows) == 1
    assert rows[0][6] == 1


def test_failed_parse_frame_is_stored_without_rollup(history_url: str) -> None:
    ensure_history(history_url)
    frame = build_v5_frame(CONTROL_DATA, 4, int(_EAST), bytes(534))
    ack = handle_frame(history_url, ADMITTED_LOGGER_SERIALS, frame)
    assert ack is not None
    assert _sample_flags(history_url) == [0]
    assert _summaries(history_url) == []


def test_plant_snapshot_matches_full_scan_builder(
    history_url: str, monkeypatch: object
) -> None:
    ensure_history(history_url)
    _record(
        history_url,
        "2026-09-01T18:00:00",
        watts=400.0,
        today=10.0,
        lifetime=1000.0,
    )
    _record(
        history_url,
        "2026-09-01T18:01:00",
        serial=_WEST,
        watts=400.0,
        today=4.0,
        lifetime=500.0,
    )
    _record(
        history_url,
        "2026-09-02T18:00:00",
        watts=400.0,
        today=22.0,
        lifetime=1012.0,
    )
    _record(
        history_url,
        "2026-09-02T18:01:00",
        serial=_WEST,
        watts=400.0,
        today=9.0,
        lifetime=505.0,
    )
    now = _at("2026-09-02T18:01:00")
    monkeypatch.setattr(
        "wattloft.history._snapshot.now_utc",
        lambda: now.astimezone(timezone.utc),
    )
    loaded = load_successful_samples(history_url)
    expected = build_plant_snapshot(loaded, now=now)
    assert plant_snapshot(history_url) == expected
    selected = date(2026, 9, 1)
    assert plant_snapshot(history_url, selected) == build_plant_snapshot(
        loaded, selected_day=selected, now=now
    )


def test_silent_logger_stays_in_loggers_now(history_url: str) -> None:
    ensure_history(history_url)
    _record(
        history_url,
        "2026-09-01T12:00:00",
        watts=210.0,
        today=2.0,
        lifetime=1000.0,
    )
    _record(
        history_url,
        "2026-09-04T12:00:00",
        serial=_WEST,
        watts=190.0,
        today=1.8,
        lifetime=500.0,
    )
    snapshot = plant_snapshot(history_url)
    assert snapshot is not None
    by_name = {row.name: row for row in snapshot.loggers_now}
    assert set(by_name) == {_EAST, _WEST}
    assert by_name[_EAST].power_w == 210.0
    assert by_name[_WEST].power_w == 190.0


def test_curve_query_is_constrained_to_selected_local_day(history_url: str) -> None:
    ensure_history(history_url)
    _record(history_url, "2026-08-21T15:00:00", watts=625.0, today=1.1, lifetime=5635.4)
    _record(history_url, "2026-08-22T10:00:00", watts=50.0, today=0.2, lifetime=5635.6)
    day = date(2026, 8, 21)
    rows = load_samples_for_local_day(history_url, day)
    assert len(rows) == 1
    assert rows[0].received_at.astimezone(_LOCAL).date() == day
    snapshot = plant_snapshot(history_url, day)
    assert snapshot is not None
    points = [point.at.date() for series in snapshot.curve for point in series.points]
    assert points
    assert all(point == day for point in points)


def test_dump_restore_includes_day_summaries(history_url: str) -> None:
    ensure_history(history_url)
    _record(history_url, "2026-09-01T12:00:00", watts=210.0, today=2.0, lifetime=1000.0)
    dump = dump_history(history_url)
    assert "day_summaries" in dump
    with _connect(history_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute("TRUNCATE TABLE samples")
            cursor.execute("TRUNCATE TABLE day_summaries")
            cursor.execute("TRUNCATE TABLE history_meta")
        conn.commit()
    restore_history(history_url, dump)
    rows = _summaries(history_url)
    assert len(rows) == 1
    assert rows[0][3] == 1000.0
    snapshot = plant_snapshot(history_url)
    assert snapshot is not None
    assert snapshot.lifetime_energy_kwh == 1000.0


def test_old_samples_only_dump_backfills_on_restore(history_url: str) -> None:
    ensure_history(history_url)
    _record(history_url, "2026-09-01T12:00:00", watts=210.0, today=2.0, lifetime=1000.0)
    dump = dump_history(history_url)
    old = ";\n".join(
        part.strip()
        for part in dump.split(";")
        if part.strip() and "day_summaries" not in part.lower()
    ) + ";\n"
    with _connect(history_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute("TRUNCATE TABLE samples")
            cursor.execute("TRUNCATE TABLE day_summaries")
            cursor.execute("TRUNCATE TABLE history_meta")
        conn.commit()
    restore_history(history_url, old)
    rows = _summaries(history_url)
    assert len(rows) == 1
    assert rows[0][3] == 1000.0


def test_plant_snapshot_does_not_full_scan(
    history_url: str, monkeypatch: object
) -> None:
    ensure_history(history_url)
    _record(history_url, "2026-09-01T12:00:00", watts=210.0, today=2.0, lifetime=1000.0)

    def _boom(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("full scan")

    monkeypatch.setattr(
        "wattloft.history._store.load_successful_samples", _boom
    )
    snapshot = plant_snapshot(history_url)
    assert snapshot is not None
    assert snapshot.current_power_w == 210.0


def test_latest_logger_samples_are_bounded_per_logger(history_url: str) -> None:
    ensure_history(history_url)
    start = _at("2026-08-01T12:00:00")
    for day in range(10):
        stamp = start + timedelta(days=day)
        _record(
            history_url,
            stamp.strftime("%Y-%m-%dT%H:%M:%S"),
            watts=100.0,
            today=1.0,
            lifetime=1000.0 + day,
        )
    latest = load_latest_logger_samples(history_url)
    assert latest
    by_serial: dict[str, list[datetime]] = {}
    for sample in latest:
        by_serial.setdefault(sample.logger_serial, []).append(sample.received_at)
    for stamps in by_serial.values():
        newest = max(stamps)
        for stamp in stamps:
            assert newest - stamp <= timedelta(hours=24)


def test_plant_snapshot_row_counts_stay_bounded(history_url: str) -> None:
    ensure_history(history_url)
    start = _at("2026-01-01T08:00:00")
    rows: list[tuple[object, ...]] = []
    east_life = 1000.0
    west_life = 500.0
    days = 20
    steps = 24
    for day in range(days):
        for step in range(steps):
            stamp = start + timedelta(days=day, minutes=step * 15)
            stored = stamp.astimezone(timezone.utc).replace(tzinfo=None)
            east_life += 0.1
            west_life += 0.05
            rows.append((_EAST, stored, 200.0, 1.0 + step * 0.1, east_life, 1))
            rows.append((_WEST, stored, 180.0, 0.8 + step * 0.05, west_life, 1))
    with _connect(history_url) as conn:
        with conn.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO samples (
                    logger_serial, received_at, ac_power_w,
                    today_energy_kwh, lifetime_energy_kwh, parse_succeeded
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
        conn.commit()
    ensure_history(history_url)
    selected = date(2026, 1, 10)
    t0 = time.perf_counter()
    snapshot = plant_snapshot(history_url, selected)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert snapshot is not None
    summaries = load_day_summaries(history_url)
    curve_rows = load_samples_for_local_day(history_url, selected)
    latest = load_latest_logger_samples(history_url)
    assert len(summaries) == days * 2
    assert len(curve_rows) == steps * 2
    assert len(latest) < days * steps
    assert len(curve_rows) + len(latest) + len(summaries) < len(rows)
    assert elapsed_ms < 2000
