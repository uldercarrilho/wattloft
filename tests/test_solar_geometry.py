from __future__ import annotations

import math
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from wattloft.solar.geometry import solar_position
from wattloft.solar.clearsky import (
    haurwitz_irradiance,
    ideal_envelope_curve,
    ideal_power_w,
)

_SP = ZoneInfo("America/Sao_Paulo")


def test_noaa_solar_noon_and_zenith_equinox() -> None:
    # Equinox: 2026-03-20 at Sao Paulo (-23.5505, -46.6333)
    dt = datetime(2026, 3, 20, 12, 13, tzinfo=_SP)
    pos = solar_position(dt, -23.5505, -46.6333)

    # NOAA solar noon for Sao Paulo on March 20, 2026 is at 12:13:58 BRT (within ~1 minute)
    assert pos.solar_noon.hour == 12
    assert 12 <= pos.solar_noon.minute <= 15

    # At solar noon, zenith should be approximately |lat - declination|
    # Declination near equinox is near 0 (+- 0.5 deg)
    assert abs(pos.declination_deg) < 1.0
    noon_pos = solar_position(pos.solar_noon, -23.5505, -46.6333)
    expected_zenith = abs(-23.5505 - noon_pos.declination_deg)
    # Assert match within +- 0.5% (relative error < 0.005)
    rel_error = abs(noon_pos.zenith_deg - expected_zenith) / max(1.0, expected_zenith)
    assert rel_error < 0.005, f"Zenith error {rel_error} exceeds 0.5%"


def test_noaa_solar_noon_december_solstice() -> None:
    # Southern summer solstice: December 21, 2026
    dt = datetime(2026, 12, 21, 12, 0, tzinfo=_SP)
    pos = solar_position(dt, -23.5505, -46.6333)

    # Declination is near -23.44 deg
    assert -23.5 <= pos.declination_deg <= -23.4
    # Sun is almost directly overhead in Sao Paulo at solar noon
    noon_pos = solar_position(pos.solar_noon, -23.5505, -46.6333)
    assert noon_pos.zenith_deg < 0.5  # nearly 0 deg zenith!
    assert noon_pos.elevation_deg > 89.5


def test_noaa_solar_noon_june_solstice() -> None:
    # Southern winter solstice: June 21, 2026
    dt = datetime(2026, 6, 21, 12, 0, tzinfo=_SP)
    pos = solar_position(dt, -23.5505, -46.6333)

    # Declination is near +23.44 deg
    assert 23.4 <= pos.declination_deg <= 23.5
    # Zenith angle = |-23.5505 - 23.44| approx 46.99 deg
    noon_pos = solar_position(pos.solar_noon, -23.5505, -46.6333)
    expected_zenith = abs(-23.5505 - noon_pos.declination_deg)
    rel_error = abs(noon_pos.zenith_deg - expected_zenith) / expected_zenith
    assert rel_error < 0.005


def test_haurwitz_clear_sky_irradiance() -> None:
    # At zenith 0 deg (sun directly overhead)
    # I = 1098 * cos(0) * exp(-0.057 / cos(0)) = 1098 * exp(-0.057) approx 1037 W/m^2
    irr_0 = haurwitz_irradiance(0.0)
    assert 1035.0 <= irr_0 <= 1040.0

    # At zenith 60 deg (cos = 0.5)
    # I = 1098 * 0.5 * exp(-0.057 / 0.5) = 549 * exp(-0.114) approx 489.8 W/m^2
    irr_60 = haurwitz_irradiance(60.0)
    assert 485.0 <= irr_60 <= 495.0

    # At zenith >= 85 deg or night (90 deg)
    assert haurwitz_irradiance(85.0) == 0.0
    assert haurwitz_irradiance(90.0) == 0.0
    assert haurwitz_irradiance(110.0) == 0.0


def test_ideal_power_and_envelope_curve() -> None:
    local_day = date(2026, 12, 21)
    points = ideal_envelope_curve(
        local_day=local_day,
        latitude_deg=-23.5505,
        longitude_deg=-46.6333,
        peak_capacity_w=2000.0,
    )
    assert len(points) > 0
    # Day length is around 13-14 hours (780-840 daylight minutes)
    assert 700 <= len(points) <= 900
    peak_w = max(w for _, w in points)
    # Peak power on summer solstice with sun overhead is ~2070 W
    assert 1900.0 <= peak_w <= 2150.0
