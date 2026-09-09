from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from wattloft.solar.geometry import solar_position

_LOCAL = ZoneInfo("America/Sao_Paulo")


def haurwitz_irradiance(zenith_deg: float) -> float:
    """Haurwitz clear-sky global horizontal irradiance model (W/m^2).

    I_clear = 1098 * cos(theta_z) * exp(-0.057 / cos(theta_z)) for theta_z < 85 deg
    Returns 0.0 for theta_z >= 85 deg or below horizon.
    """
    if zenith_deg >= 85.0:
        return 0.0
    cos_z = math.cos(math.radians(zenith_deg))
    if cos_z <= 0.0:
        return 0.0
    return 1098.0 * cos_z * math.exp(-0.057 / cos_z)


def ideal_power_w(
    dt: datetime,
    latitude_deg: float,
    longitude_deg: float,
    peak_capacity_w: float,
) -> float:
    """Calculate clear-sky theoretical ideal AC/DC power (W) scaled to peak DC capacity."""
    pos = solar_position(dt, latitude_deg, longitude_deg)
    irradiance = haurwitz_irradiance(pos.zenith_deg)
    # Scaled to Plant peak nameplate DC capacity (1000 W/m^2 STC baseline)
    power = peak_capacity_w * (irradiance / 1000.0)
    return max(0.0, round(power, 1))


def ideal_envelope_curve(
    local_day: date,
    latitude_deg: float,
    longitude_deg: float,
    peak_capacity_w: float,
    tz: ZoneInfo = _LOCAL,
) -> list[tuple[datetime, float]]:
    """Compute minute-by-minute clear-sky envelope points across local_day where power > 0."""
    points: list[tuple[datetime, float]] = []
    # Loop across every minute of the 24h local day
    start_dt = datetime.combine(local_day, time.min, tzinfo=tz)
    for m in range(24 * 60):
        current_dt = start_dt + timedelta(minutes=m)
        power = ideal_power_w(current_dt, latitude_deg, longitude_deg, peak_capacity_w)
        if power > 0:
            points.append((current_dt.replace(tzinfo=None), power))
    return points
