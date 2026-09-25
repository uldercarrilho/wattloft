from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from wattloft.api import _snapshot_payload
from wattloft.history._snapshot import (
    CurvePoint,
    CurveSeries,
    LocalDayBar,
    PlantSnapshot,
    build_plant_snapshot,
)
from wattloft.history._store import _SampleRow
from wattloft.solar.calibration import (
    EnvelopeCalibration,
    calibrate_parameters,
    calibration_to_meta,
    is_clear_sky_day,
    load_calibration_from_meta,
)
from wattloft.solar.clearsky import ideal_envelope_curve, ideal_power_w

_SP = ZoneInfo("America/Sao_Paulo")


def test_clear_sky_detection_smooth_vs_cloudy() -> None:
    # 1. Generate synthetic smooth sunny day
    start_dt = datetime(2026, 9, 25, 6, 0)
    smooth_points: list[tuple[datetime, float]] = []
    # 12 hours of daylight: 6:00 to 18:00 (720 minutes)
    for m in range(720):
        dt = start_dt + timedelta(minutes=m)
        # Smooth sinusoidal bell curve peaking at 1800W at solar noon (360 min)
        phase = math.pi * (m / 720.0)
        w = max(0.0, 1800.0 * math.sin(phase))
        smooth_points.append((dt, round(w, 1)))

    is_clear, volatility = is_clear_sky_day(smooth_points, plant_peak_capacity_w=2000.0)
    assert is_clear is True
    assert volatility < 0.05

    # 2. Generate synthetic cloudy day with severe cloud drops
    cloudy_points: list[tuple[datetime, float]] = []
    for m in range(720):
        dt = start_dt + timedelta(minutes=m)
        phase = math.pi * (m / 720.0)
        w = max(0.0, 1800.0 * math.sin(phase))
        # Add intermittent cloud shadows causing 70% drops
        if (150 <= m <= 180) or (240 <= m <= 270) or (400 <= m <= 450):
            w *= 0.25
        cloudy_points.append((dt, round(w, 1)))

    is_clear_cloudy, volatility_cloudy = is_clear_sky_day(
        cloudy_points, plant_peak_capacity_w=2000.0
    )
    assert is_clear_cloudy is False
    assert volatility_cloudy > 0.10

    # 3. Low energy stormy day (peaks at only 250W)
    storm_points = [
        (start_dt + timedelta(minutes=m), max(0.0, 250.0 * math.sin(math.pi * (m / 720.0))))
        for m in range(720)
    ]
    is_clear_storm, _ = is_clear_sky_day(storm_points, plant_peak_capacity_w=2000.0)
    assert is_clear_storm is False


def test_calibrate_parameters_fitting() -> None:
    # Build two reference sunny days with known characteristics
    ref_days: list[tuple[date, list[tuple[datetime, float]]]] = []
    for d_offset in (1, 2):
        cal_date = date(2026, 9, 20 + d_offset)
        start_dt = datetime.combine(cal_date, datetime.min.time(), tzinfo=_SP) + timedelta(hours=6)
        points: list[tuple[datetime, float]] = []
        for m in range(720):
            dt = start_dt + timedelta(minutes=m)
            phase = math.pi * (m / 720.0)
            # Power peaking at 1900W
            w = max(0.0, 1900.0 * math.sin(phase))
            points.append((dt, round(w, 1)))
        ref_days.append((cal_date, points))

    cal = calibrate_parameters(
        ref_days,
        latitude_deg=-23.5505,
        longitude_deg=-46.6333,
        peak_capacity_w=2000.0,
        ac_cap_w=2000.0,
    )
    assert cal.calibrated is True
    assert cal.sunny_days_count == 2
    assert 0.8 <= cal.scale <= 1.2
    assert 10.0 <= cal.tilt_deg <= 25.0
    assert -15.0 <= cal.azimuth_offset_deg <= 15.0
    assert cal.ac_cap_w == 2000.0


def test_empty_reference_days_returns_uncalibrated_defaults() -> None:
    cal = calibrate_parameters([])
    assert cal.calibrated is False
    assert cal.sunny_days_count == 0
    assert cal.scale == 1.0


def test_calibrated_envelope_caps_at_ac_nameplate() -> None:
    cal = EnvelopeCalibration(
        calibrated=True,
        scale=1.1,
        tilt_deg=15.0,
        azimuth_offset_deg=0.0,
        elevation_cutoff_deg=5.0,
        ac_cap_w=1950.0,  # Cap below theoretical DC peak
        sunny_days_count=3,
        last_calibrated_at=datetime(2026, 9, 25, 0, 0, tzinfo=_SP),
    )

    day = date(2026, 12, 21)  # Summer solstice (maximum sun elevation)
    points = ideal_envelope_curve(
        local_day=day,
        latitude_deg=-23.5505,
        longitude_deg=-46.6333,
        peak_capacity_w=2200.0,
        calibration=cal,
    )
    assert len(points) > 0
    max_w = max(w for _, w in points)
    # The envelope must never exceed the AC cap
    assert max_w <= 1950.0


def test_meta_serialization_round_trip() -> None:
    stamp = datetime(2026, 9, 25, 12, 30, 45, tzinfo=_SP)
    cal = EnvelopeCalibration(
        calibrated=True,
        scale=0.96,
        tilt_deg=18.5,
        azimuth_offset_deg=3.2,
        elevation_cutoff_deg=6.5,
        ac_cap_w=2000.0,
        sunny_days_count=5,
        last_calibrated_at=stamp,
    )

    meta = calibration_to_meta(cal)
    loaded = load_calibration_from_meta(meta)

    assert loaded.calibrated is True
    assert loaded.scale == 0.96
    assert loaded.tilt_deg == 18.5
    assert loaded.azimuth_offset_deg == 3.2
    assert loaded.elevation_cutoff_deg == 6.5
    assert loaded.ac_cap_w == 2000.0
    assert loaded.sunny_days_count == 5
    assert loaded.last_calibrated_at is not None
    assert loaded.last_calibrated_at.isoformat() == stamp.isoformat()


def test_uncalibrated_meta_fallback() -> None:
    loaded = load_calibration_from_meta({})
    assert loaded.calibrated is False


def test_snapshot_payload_contains_envelope_calibration() -> None:
    cal = EnvelopeCalibration(
        calibrated=True,
        scale=0.98,
        tilt_deg=16.0,
        azimuth_offset_deg=1.0,
        elevation_cutoff_deg=5.5,
        ac_cap_w=2000.0,
        sunny_days_count=3,
        last_calibrated_at=datetime(2026, 9, 25, 1, 0, tzinfo=_SP),
    )

    now = datetime(2026, 9, 25, 12, 0, tzinfo=_SP)
    snapshot = PlantSnapshot(
        today_energy_kwh=10.5,
        current_power_w=1500.0,
        lifetime_energy_kwh=6000.0,
        current_power_at=now,
        local_day_bars=(
            LocalDayBar(
                local_day=date(2026, 9, 25),
                today_energy_kwh=10.5,
                loggers=(),
            ),
        ),
        curve=(CurveSeries(name="Plant", points=()),),
        loggers_now=(),
        ideal_curve=(),
        envelope_calibration=cal,
    )

    payload = _snapshot_payload(snapshot, date(2026, 9, 25))
    assert "envelope_calibration" in payload
    cal_payload = payload["envelope_calibration"]
    assert cal_payload is not None
    assert cal_payload["calibrated"] is True
    assert cal_payload["sunny_days_count"] == 3
    assert cal_payload["scale"] == 0.98
    assert cal_payload["tilt_deg"] == 16.0
    assert cal_payload["azimuth_offset_deg"] == 1.0
    assert cal_payload["elevation_cutoff_deg"] == 5.5
    assert cal_payload["ac_cap_w"] == 2000.0
