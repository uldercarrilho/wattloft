from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from wattloft.solar.clipping import (
    detect_clipping,
    detect_clipping_for_series,
)

_SP = ZoneInfo("America/Sao_Paulo")


def test_clipping_detected_on_sunny_plateau() -> None:
    # 1 kW inverter nameplate
    nameplate_w = 1000.0
    start_dt = datetime(2026, 9, 9, 6, 0, tzinfo=_SP)
    points: list[tuple[datetime, float]] = []

    # Morning ramp up: 6:00 to 11:59 (staying below 900 W until 12:00)
    for m in range(360):
        t = start_dt + timedelta(minutes=m)
        w = round((m / 360.0) * 880.0, 1)
        points.append((t, w))

    # Plateau from 12:00 to 13:15 (76 minutes) at ~998 W (+- 1 W)
    plateau_start = start_dt + timedelta(minutes=360)
    for m in range(76):
        t = plateau_start + timedelta(minutes=m)
        w = 998.0 + (1.0 if m % 2 == 0 else -1.0)
        points.append((t, w))

    # Afternoon ramp down: 13:16 to 18:00 (drops below 900 W immediately)
    down_start = plateau_start + timedelta(minutes=76)
    for m in range(285):
        t = down_start + timedelta(minutes=m)
        w = round(max(0.0, 880.0 - (m / 285.0) * 880.0), 1)
        points.append((t, w))

    summary = detect_clipping_for_series(
        serial="3909309465",
        points=points,
        nameplate_w=nameplate_w,
        latitude_deg=-23.5505,
        longitude_deg=-46.6333,
    )

    assert summary.clipped is True
    assert summary.clipped_minutes >= 75
    assert summary.estimated_clipped_kwh is not None
    assert summary.estimated_clipped_kwh > 0.1
    assert len(summary.plateaus) == 1
    p = summary.plateaus[0]
    assert p.start_minute == 12 * 60
    assert p.end_minute == 13 * 60 + 15
    assert 995.0 <= p.plateau_watts <= 1002.0


def test_no_clipping_when_plateau_is_too_short() -> None:
    # Plateau lasts only 30 minutes (< 45 minutes)
    nameplate_w = 1000.0
    start_dt = datetime(2026, 9, 9, 11, 30, tzinfo=_SP)
    points: list[tuple[datetime, float]] = []

    for m in range(30):
        t = start_dt + timedelta(minutes=m)
        points.append((t, 998.0))

    summary = detect_clipping_for_series(
        serial="3909309465",
        points=points,
        nameplate_w=nameplate_w,
        latitude_deg=-23.5505,
        longitude_deg=-46.6333,
    )

    assert summary.clipped is False
    assert summary.clipped_minutes == 0
    assert summary.estimated_clipped_kwh is None


def test_no_clipping_when_fluctuation_is_too_wide() -> None:
    # 60-minute duration but fluctuations exceed 1.5% of nameplate (e.g. 30 W delta)
    nameplate_w = 1000.0
    start_dt = datetime(2026, 9, 9, 11, 30, tzinfo=_SP)
    points: list[tuple[datetime, float]] = []

    for m in range(60):
        t = start_dt + timedelta(minutes=m)
        w = 980.0 if m % 2 == 0 else 1015.0  # delta = 35 W > 15 W
        points.append((t, w))

    summary = detect_clipping_for_series(
        serial="3909309465",
        points=points,
        nameplate_w=nameplate_w,
        latitude_deg=-23.5505,
        longitude_deg=-46.6333,
    )

    assert summary.clipped is False


def test_no_clipping_below_90_percent_nameplate() -> None:
    # Flat curve at 700 W (70% nameplate, e.g. overcast) for 60 min
    nameplate_w = 1000.0
    start_dt = datetime(2026, 9, 9, 11, 30, tzinfo=_SP)
    points: list[tuple[datetime, float]] = []

    for m in range(60):
        t = start_dt + timedelta(minutes=m)
        points.append((t, 700.0))

    summary = detect_clipping_for_series(
        serial="3909309465",
        points=points,
        nameplate_w=nameplate_w,
        latitude_deg=-23.5505,
        longitude_deg=-46.6333,
    )

    assert summary.clipped is False
