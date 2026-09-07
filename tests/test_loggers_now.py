from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from wattloft.history._snapshot import build_plant_snapshot
from wattloft.history._store import _SampleRow

_LOCAL = ZoneInfo("America/Sao_Paulo")
_LOGGER = "3909309465"
_OTHER = "3913630013"


def _at(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp).replace(tzinfo=_LOCAL)


def _sample(
    stamp: str,
    *,
    today: float,
    lifetime: float,
    serial: str = _LOGGER,
    watts: float | None = 400,
) -> _SampleRow:
    return _SampleRow(
        logger_serial=serial,
        received_at=_at(stamp),
        ac_power_w=watts,
        today_energy_kwh=today,
        lifetime_energy_kwh=lifetime,
    )


def test_two_loggers_now_use_each_loggers_last_successful_power() -> None:
    snapshot = build_plant_snapshot(
        (
            _sample("2026-09-07T12:00:00", today=2.0, lifetime=1000.0, watts=210.0),
            _sample("2026-09-07T12:00:00", today=1.8, lifetime=500.0, serial=_OTHER, watts=202.0),
            _sample("2026-09-07T13:00:00", today=3.0, lifetime=1001.0, watts=180.0),
            _sample("2026-09-07T13:01:00", today=2.5, lifetime=501.0, serial=_OTHER, watts=190.0),
        ),
        now=_at("2026-09-07T13:01:00"),
    )
    assert snapshot is not None
    by_name = {row.name: row for row in snapshot.loggers_now}
    assert list(by_name) == [_LOGGER, _OTHER]
    assert by_name[_LOGGER].power_w == 180.0
    assert by_name[_LOGGER].last_success_at == _at("2026-09-07T13:00:00")
    assert by_name[_OTHER].power_w == 190.0
    assert by_name[_OTHER].last_success_at == _at("2026-09-07T13:01:00")


def test_zero_watts_successful_power_is_kept() -> None:
    snapshot = build_plant_snapshot(
        (_sample("2026-09-07T21:00:00", today=18.2, lifetime=1018.2, watts=0.0),),
        now=_at("2026-09-07T21:00:00"),
    )
    assert snapshot is not None
    assert len(snapshot.loggers_now) == 1
    assert snapshot.loggers_now[0].power_w == 0.0
    assert snapshot.loggers_now[0].last_success_at == _at("2026-09-07T21:00:00")


def test_missing_power_walks_back_and_does_not_become_zero() -> None:
    snapshot = build_plant_snapshot(
        (
            _sample("2026-09-07T12:00:00", today=2.0, lifetime=1000.0, watts=210.0),
            _sample("2026-09-07T13:00:00", today=3.0, lifetime=1001.0, watts=None),
        ),
        now=_at("2026-09-07T13:00:00"),
    )
    assert snapshot is not None
    assert len(snapshot.loggers_now) == 1
    row = snapshot.loggers_now[0]
    assert row.power_w == 210.0
    assert row.last_success_at == _at("2026-09-07T13:00:00")


def test_logger_without_successful_sample_is_absent_from_loggers_now() -> None:
    snapshot = build_plant_snapshot(
        (_sample("2026-09-07T13:00:00", today=3.0, lifetime=1001.0, watts=180.0),),
        now=_at("2026-09-07T13:00:00"),
    )
    assert snapshot is not None
    assert [row.name for row in snapshot.loggers_now] == [_LOGGER]
    assert _OTHER not in {row.name for row in snapshot.loggers_now}


def test_trailing_zero_lifetime_does_not_wipe_last_power_on_loggers_now() -> None:
    snapshot = build_plant_snapshot(
        (
            _sample("2026-08-25T18:00:00", today=5.0, lifetime=1000.0, watts=50.0),
            _sample("2026-08-26T12:00:00", today=8.0, lifetime=1008.0, watts=400.0),
            _sample("2026-08-26T18:00:00", today=0.0, lifetime=0.0, watts=0.0),
        ),
        now=_at("2026-08-26T18:00:00"),
    )
    assert snapshot is not None
    assert snapshot.lifetime_energy_kwh == 1008.0
    assert snapshot.loggers_now[0].power_w == 0.0
    assert snapshot.loggers_now[0].last_success_at == _at("2026-08-26T18:00:00")


def test_loggers_now_does_not_change_plant_totals() -> None:
    snapshot = build_plant_snapshot(
        (
            _sample("2026-09-07T12:00:00", today=2.0, lifetime=1000.0, watts=210.0),
            _sample("2026-09-07T12:00:00", today=1.8, lifetime=500.0, serial=_OTHER, watts=202.0),
        ),
        now=_at("2026-09-07T12:00:00"),
    )
    assert snapshot is not None
    assert snapshot.current_power_w == 412.0
    assert snapshot.lifetime_energy_kwh == 1500.0
    assert snapshot.today_energy_kwh == 3.8
    assert snapshot.current_power_at == _at("2026-09-07T12:00:00")
