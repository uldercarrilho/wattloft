from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class SolarPosition:
    zenith_deg: float
    elevation_deg: float
    azimuth_deg: float
    solar_noon: datetime
    equation_of_time_min: float
    declination_deg: float


def solar_position(
    dt: datetime,
    latitude_deg: float,
    longitude_deg: float,
) -> SolarPosition:
    """Compute solar position for a given datetime and coordinates using NOAA Meeus algorithms."""
    if dt.tzinfo is None:
        dt_utc = dt.replace(tzinfo=timezone.utc)
    else:
        dt_utc = dt.astimezone(timezone.utc)

    # Julian Day and Julian Century
    unix_time = dt_utc.timestamp()
    jd = 2440587.5 + (unix_time / 86400.0)
    t = (jd - 2451545.0) / 36525.0

    # Geometric Mean Longitude of Sun (deg)
    l0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360.0

    # Geometric Mean Anomaly of Sun (deg)
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    m_rad = math.radians(m)

    # Earth orbit eccentricity
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)

    # Sun Equation of Center (deg)
    c = (
        math.sin(m_rad) * (1.914602 - t * (0.004817 + 0.000014 * t))
        + math.sin(2.0 * m_rad) * (0.019993 - 0.000101 * t)
        + math.sin(3.0 * m_rad) * 0.000289
    )

    # Sun True Longitude & Apparent Longitude (deg)
    true_long = l0 + c
    omega = 125.04 - 1934.136 * t
    app_long = true_long - 0.00569 - 0.00478 * math.sin(math.radians(omega))

    # Obliquity of Ecliptic & Corrected Obliquity (deg)
    eps0 = 23.0 + (26.0 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0
    eps = eps0 + 0.00256 * math.cos(math.radians(omega))

    # Sun Declination (deg)
    sin_delta = math.sin(math.radians(eps)) * math.sin(math.radians(app_long))
    delta_deg = math.degrees(math.asin(max(-1.0, min(1.0, sin_delta))))

    # Equation of Time (minutes)
    y = math.tan(math.radians(eps) / 2.0) ** 2
    l0_rad = math.radians(l0)
    eot_min = 4.0 * math.degrees(
        y * math.sin(2.0 * l0_rad)
        - 2.0 * e * math.sin(m_rad)
        + 4.0 * e * y * math.sin(m_rad) * math.cos(2.0 * l0_rad)
        - 0.5 * (y**2) * math.sin(4.0 * l0_rad)
        - 1.25 * (e**2) * math.sin(2.0 * m_rad)
    )

    # Solar Noon (UTC)
    solar_noon_utc_offset_min = 720.0 - 4.0 * longitude_deg - eot_min
    midnight_utc = datetime(dt_utc.year, dt_utc.month, dt_utc.day, tzinfo=timezone.utc)
    solar_noon = midnight_utc + timedelta(minutes=solar_noon_utc_offset_min)
    if dt.tzinfo is not None:
        solar_noon = solar_noon.astimezone(dt.tzinfo)

    # True Solar Time (minutes)
    utc_min = (
        dt_utc.hour * 60.0
        + dt_utc.minute
        + dt_utc.second / 60.0
        + dt_utc.microsecond / 60_000_000.0
    )
    tst_min = (utc_min + 4.0 * longitude_deg + eot_min) % 1440.0

    # Solar Hour Angle (deg)
    ha_deg = (tst_min / 4.0) - 180.0
    if ha_deg < -180.0:
        ha_deg += 360.0

    # Solar Zenith & Elevation (deg)
    lat_rad = math.radians(latitude_deg)
    delta_rad = math.radians(delta_deg)
    ha_rad = math.radians(ha_deg)

    cos_zenith = (
        math.sin(lat_rad) * math.sin(delta_rad)
        + math.cos(lat_rad) * math.cos(delta_rad) * math.cos(ha_rad)
    )
    cos_zenith = max(-1.0, min(1.0, cos_zenith))
    zenith_deg = math.degrees(math.acos(cos_zenith))
    elevation_deg = 90.0 - zenith_deg

    # Solar Azimuth (deg clockwise from North)
    gamma_rad = math.atan2(
        -math.sin(ha_rad),
        math.tan(delta_rad) * math.cos(lat_rad) - math.sin(lat_rad) * math.cos(ha_rad),
    )
    azimuth_deg = (math.degrees(gamma_rad) + 180.0) % 360.0

    return SolarPosition(
        zenith_deg=zenith_deg,
        elevation_deg=elevation_deg,
        azimuth_deg=azimuth_deg,
        solar_noon=solar_noon,
        equation_of_time_min=eot_min,
        declination_deg=delta_deg,
    )
