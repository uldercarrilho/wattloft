from __future__ import annotations

from datetime import date, datetime, timezone

from wattloft.api import _snapshot_payload
from wattloft.history._snapshot import (
    CurvePoint,
    CurveSeries,
    LocalDayBar,
    LoggerEnergy,
    PlantSnapshot,
)


def test_snapshot_payload_includes_display_name_and_history_start() -> None:
    snapshot = PlantSnapshot(
        today_energy_kwh=0.2,
        current_power_w=50.0,
        lifetime_energy_kwh=5635.4,
        current_power_at=datetime(2026, 8, 22, 13, 0, tzinfo=timezone.utc),
        local_day_bars=(
            LocalDayBar(
                local_day=date(2026, 8, 21),
                today_energy_kwh=3.9,
                loggers=(
                    LoggerEnergy(name="3909309465", today_energy_kwh=2.1),
                    LoggerEnergy(name="3913630013", today_energy_kwh=1.8),
                ),
            ),
            LocalDayBar(
                local_day=date(2026, 8, 22),
                today_energy_kwh=0.2,
                loggers=(LoggerEnergy(name="3909309465", today_energy_kwh=0.2),),
            ),
        ),
        curve=(
            CurveSeries(
                name="3909309465",
                points=(
                    CurvePoint(
                        at=datetime(2026, 8, 21, 15, 0),
                        watts=50.0,
                        lifetime_kwh=1.1,
                    ),
                ),
            ),
            CurveSeries(
                name="Plant",
                points=(CurvePoint(at=datetime(2026, 8, 21, 15, 0), watts=50.0),),
            ),
        ),
    )
    body = _snapshot_payload(snapshot, date(2026, 8, 21))
    assert body["history_start"] == "2026-08-21"
    logger_one = next(series for series in body["curve"] if series["name"] == "3909309465")
    assert logger_one["display_name"] == "Logger 1"
    plant = next(series for series in body["curve"] if series["name"] == "Plant")
    assert "display_name" not in plant
    loggers = body["local_day_bars"][0]["loggers"]
    assert isinstance(loggers, list)
    by_name = {part["name"]: part for part in loggers}
    assert by_name["3909309465"]["display_name"] == "Logger 1"
    assert by_name["3913630013"]["display_name"] == "Logger 2"


def test_snapshot_payload_omits_display_name_for_unknown_serial() -> None:
    snapshot = PlantSnapshot(
        today_energy_kwh=1.0,
        current_power_w=10.0,
        lifetime_energy_kwh=1.0,
        current_power_at=datetime(2026, 8, 21, 15, 0, tzinfo=timezone.utc),
        local_day_bars=(
            LocalDayBar(
                local_day=date(2026, 8, 21),
                today_energy_kwh=1.0,
                loggers=(LoggerEnergy(name="9999999999", today_energy_kwh=1.0),),
            ),
        ),
        curve=(
            CurveSeries(
                name="9999999999",
                points=(CurvePoint(at=datetime(2026, 8, 21, 15, 0), watts=10.0),),
            ),
        ),
    )
    body = _snapshot_payload(snapshot, date(2026, 8, 21))
    series = body["curve"][0]
    assert series["name"] == "9999999999"
    assert "display_name" not in series
    assert "display_name" not in body["local_day_bars"][0]["loggers"][0]
