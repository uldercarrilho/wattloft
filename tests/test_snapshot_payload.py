from __future__ import annotations

from datetime import date, datetime, timezone

from wattloft.api import _snapshot_payload
from wattloft.history._snapshot import (
    CurvePoint,
    CurveSeries,
    LocalDayBar,
    LoggerEnergy,
    LoggerNow,
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
                    LoggerEnergy(name="1000000001", today_energy_kwh=2.1),
                    LoggerEnergy(name="1000000002", today_energy_kwh=1.8),
                ),
            ),
            LocalDayBar(
                local_day=date(2026, 8, 22),
                today_energy_kwh=0.2,
                loggers=(LoggerEnergy(name="1000000001", today_energy_kwh=0.2),),
            ),
        ),
        curve=(
            CurveSeries(
                name="1000000001",
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
    logger_one = next(series for series in body["curve"] if series["name"] == "1000000001")
    assert logger_one["display_name"] == "East"
    plant = next(series for series in body["curve"] if series["name"] == "Plant")
    assert "display_name" not in plant
    loggers = body["local_day_bars"][0]["loggers"]
    assert isinstance(loggers, list)
    by_name = {part["name"]: part for part in loggers}
    assert by_name["1000000001"]["display_name"] == "East"
    assert by_name["1000000002"]["display_name"] == "West"
    assert body["loggers_now"] == []


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
    assert body["loggers_now"] == []


def test_snapshot_payload_serializes_loggers_now() -> None:
    snapshot = PlantSnapshot(
        today_energy_kwh=0.2,
        current_power_w=412.0,
        lifetime_energy_kwh=5635.4,
        current_power_at=datetime(2026, 9, 7, 16, 3, tzinfo=timezone.utc),
        local_day_bars=(
            LocalDayBar(
                local_day=date(2026, 9, 7),
                today_energy_kwh=0.2,
                loggers=(LoggerEnergy(name="1000000001", today_energy_kwh=0.2),),
            ),
        ),
        curve=(
            CurveSeries(
                name="1000000001",
                points=(CurvePoint(at=datetime(2026, 9, 7, 13, 0), watts=210.0),),
            ),
        ),
        loggers_now=(
            LoggerNow(
                name="1000000001",
                last_success_at=datetime(2026, 9, 7, 16, 3, tzinfo=timezone.utc),
                power_w=210.0,
            ),
            LoggerNow(
                name="1000000002",
                last_success_at=datetime(2026, 9, 7, 16, 3, tzinfo=timezone.utc),
                power_w=0.0,
            ),
        ),
    )
    body = _snapshot_payload(snapshot, date(2026, 9, 7))
    rows = body["loggers_now"]
    assert isinstance(rows, list)
    by_name = {row["name"]: row for row in rows}
    assert by_name["1000000001"]["display_name"] == "East"
    assert by_name["1000000001"]["last_success_at"] == "2026-09-07T16:03:00+00:00"
    assert by_name["1000000001"]["power_w"] == 210.0
    assert by_name["1000000002"]["display_name"] == "West"
    assert by_name["1000000002"]["power_w"] == 0.0


def test_snapshot_payload_serializes_diagnostics_and_comparisons() -> None:
    from wattloft.solar import ClippingPlateau, ClippingSummary, DriftResult

    snapshot = PlantSnapshot(
        today_energy_kwh=5.0,
        current_power_w=998.0,
        lifetime_energy_kwh=1000.0,
        current_power_at=datetime(2026, 9, 9, 12, 45, tzinfo=timezone.utc),
        local_day_bars=(
            LocalDayBar(
                local_day=date(2026, 9, 9),
                today_energy_kwh=5.0,
                loggers=(LoggerEnergy(name="1000000001", today_energy_kwh=5.0),),
                prev_year_today_energy_kwh=4.6,
            ),
        ),
        curve=(),
        ideal_curve=(
            CurvePoint(at=datetime(2026, 9, 9, 12, 0), watts=1800.0),
        ),
        clipping=ClippingSummary(
            clipped=True,
            clipped_minutes=75,
            estimated_clipped_kwh=0.35,
            plateaus=(
                ClippingPlateau(
                    logger_serial="1000000001",
                    start_minute=720,
                    end_minute=795,
                    start_at=datetime(2026, 9, 9, 12, 0),
                    end_at=datetime(2026, 9, 9, 13, 15),
                    plateau_watts=998.0,
                    estimated_clipped_kwh=0.35,
                ),
            ),
        ),
        drift=DriftResult(
            detected=True,
            advisory="East array underperforming relative to West by 14% (check for soiling or obstruction)",
            affected_logger="1000000001",
            drift_pct=14,
            baseline_ratio=1.0,
            rolling_ratio=0.86,
        ),
    )
    body = _snapshot_payload(snapshot, date(2026, 9, 9))
    assert body["local_day_bars"][0]["prev_year_today_energy_kwh"] == 4.6
    assert len(body["ideal_curve"]) == 1
    assert body["ideal_curve"][0]["watts"] == 1800.0
    assert body["clipping"] is not None
    assert body["clipping"]["clipped"] is True
    assert body["clipping"]["clipped_minutes"] == 75
    assert body["clipping"]["estimated_clipped_kwh"] == 0.35
    assert len(body["clipping"]["plateaus"]) == 1
    assert body["clipping"]["plateaus"][0]["plateau_watts"] == 998.0
    assert body["drift"] is not None
    assert body["drift"]["detected"] is True
    assert body["drift"]["drift_pct"] == 14
    assert "East array underperforming" in body["drift"]["advisory"]
