from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from wattloft.history._snapshot import PlantSnapshot, build_plant_snapshot
from wattloft.history._store import _SampleRow

_LOCAL = ZoneInfo("America/Sao_Paulo")
_LOGGER = "3909309465"


def _at(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp).replace(tzinfo=_LOCAL)


def _sample(
    stamp: str,
    *,
    today: float,
    lifetime: float,
    serial: str = _LOGGER,
    watts: float = 400,
) -> _SampleRow:
    return _SampleRow(
        logger_serial=serial,
        received_at=_at(stamp),
        ac_power_w=watts,
        today_energy_kwh=today,
        lifetime_energy_kwh=lifetime,
    )


def _bar(snapshot: PlantSnapshot, local_day: str) -> float:
    for bar in snapshot.local_day_bars:
        if bar.local_day.isoformat() == local_day:
            return float(bar.today_energy_kwh)
    raise AssertionError(f"missing bar {local_day}")


def _loggers(snapshot: PlantSnapshot, local_day: str) -> dict[str, float]:
    for bar in snapshot.local_day_bars:
        if bar.local_day.isoformat() == local_day:
            return {part.name: part.today_energy_kwh for part in bar.loggers}
    raise AssertionError(f"missing bar {local_day}")


def test_day_bars_are_that_local_days_production_not_accumulated_today_energy() -> None:
    snapshot = build_plant_snapshot(
        (
            _sample("2026-09-01T18:00:00", today=10.0, lifetime=1000.0),
            _sample("2026-09-02T18:00:00", today=22.0, lifetime=1012.0),
        ),
        now=_at("2026-09-02T18:00:00"),
    )
    assert snapshot is not None
    assert _bar(snapshot, "2026-09-01") == 10.0
    assert _bar(snapshot, "2026-09-02") == 12.0
    assert snapshot.today_energy_kwh == 12.0


def test_trailing_zero_lifetime_does_not_wipe_that_local_days_production() -> None:
    snapshot = build_plant_snapshot(
        (
            _sample("2026-08-25T18:00:00", today=5.0, lifetime=1000.0),
            _sample("2026-08-26T12:00:00", today=8.0, lifetime=1008.0),
            _sample("2026-08-26T18:00:00", today=0.0, lifetime=0.0),
        ),
        now=_at("2026-08-26T18:00:00"),
    )
    assert snapshot is not None
    assert _bar(snapshot, "2026-08-26") == 8.0
    assert snapshot.today_energy_kwh == 8.0


def test_two_loggers_sum_lifetime_deltas_per_local_day() -> None:
    other = "3913630013"
    snapshot = build_plant_snapshot(
        (
            _sample("2026-09-01T18:00:00", today=10.0, lifetime=1000.0),
            _sample("2026-09-01T18:01:00", today=4.0, lifetime=500.0, serial=other),
            _sample("2026-09-02T18:00:00", today=22.0, lifetime=1012.0),
            _sample("2026-09-02T18:01:00", today=9.0, lifetime=505.0, serial=other),
        ),
        now=_at("2026-09-02T18:01:00"),
    )
    assert snapshot is not None
    assert _bar(snapshot, "2026-09-01") == 14.0
    assert _bar(snapshot, "2026-09-02") == 17.0
    assert snapshot.today_energy_kwh == 17.0
    assert _loggers(snapshot, "2026-09-01") == {
        "3909309465": 10.0,
        "3913630013": 4.0,
    }
    assert _loggers(snapshot, "2026-09-02") == {
        "3909309465": 12.0,
        "3913630013": 5.0,
    }
    assert sum(_loggers(snapshot, "2026-09-01").values()) == _bar(
        snapshot, "2026-09-01"
    )
    assert sum(_loggers(snapshot, "2026-09-02").values()) == _bar(
        snapshot, "2026-09-02"
    )


def test_logger_without_samples_that_day_is_omitted_from_loggers() -> None:
    other = "3913630013"
    snapshot = build_plant_snapshot(
        (
            _sample("2026-09-01T18:00:00", today=10.0, lifetime=1000.0),
            _sample("2026-09-01T18:01:00", today=4.0, lifetime=500.0, serial=other),
            _sample("2026-09-02T18:00:00", today=22.0, lifetime=1012.0),
        ),
        now=_at("2026-09-02T18:00:00"),
    )
    assert snapshot is not None
    assert _loggers(snapshot, "2026-09-01") == {
        "3909309465": 10.0,
        "3913630013": 4.0,
    }
    assert _loggers(snapshot, "2026-09-02") == {"3909309465": 12.0}
    assert "3913630013" not in _loggers(snapshot, "2026-09-02")
    assert 0 not in _loggers(snapshot, "2026-09-02").values()
