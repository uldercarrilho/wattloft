from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from wattloft.config import (
    MICROINVERTER_NAMEPLATE_W,
    PLANT_LATITUDE,
    PLANT_LONGITUDE,
    PLANT_PEAK_DC_CAPACITY_W,
    now_utc,
)
from wattloft.history._mysql import connection
from wattloft.history._store import (
    load_day_summaries,
    load_samples_for_local_day,
)
from wattloft.solar.geometry import solar_position

_LOCAL = ZoneInfo("America/Sao_Paulo")


@dataclass(frozen=True)
class EnvelopeCalibration:
    calibrated: bool = False
    scale: float = 1.0
    tilt_deg: float = 15.0
    azimuth_offset_deg: float = 0.0
    elevation_cutoff_deg: float = 5.0
    ac_cap_w: float = 2000.0
    sunny_days_count: int = 0
    last_calibrated_at: datetime | None = None


def is_clear_sky_day(
    curve_points: list[tuple[datetime, float]],
    plant_peak_capacity_w: float,
    min_energy_wh: float = 4000.0,
    max_volatility: float = 0.08,
) -> tuple[bool, float]:
    """Detect if a day's production curve is a clear-sky reference day.

    Returns (is_clear, volatility_score).
    """
    if len(curve_points) < 60:
        return False, 1.0

    active_points = [(dt, w) for dt, w in curve_points if w >= 50.0]
    if len(active_points) < 45:
        return False, 1.0

    peak_w = max(w for _, w in active_points)
    if peak_w < 0.40 * plant_peak_capacity_w:
        return False, 1.0

    # Total approximate energy in Wh
    total_energy_wh = sum(w / 60.0 for _, w in active_points)
    if total_energy_wh < min_energy_wh:
        return False, 1.0

    # Smoothness / volatility metric:
    # On a clear sunny day, power rises monotonically before solar peak and falls monotonically after.
    peak_idx = max(range(len(active_points)), key=lambda i: active_points[i][1])

    # Counter-trend drops before peak (drops while sun should be rising)
    drops_before = sum(
        max(0.0, active_points[i][1] - active_points[i + 1][1])
        for i in range(peak_idx)
    )
    # Counter-trend rises after peak (rises while sun should be setting)
    rises_after = sum(
        max(0.0, active_points[i + 1][1] - active_points[i][1])
        for i in range(peak_idx, len(active_points) - 1)
    )

    counter_trend_energy = drops_before + rises_after
    volatility = counter_trend_energy / max(1.0, peak_w)

    is_clear = volatility <= max_volatility
    return is_clear, round(volatility, 4)


def calibrate_parameters(
    reference_curves: list[tuple[date, list[tuple[datetime, float]]]],
    latitude_deg: float = PLANT_LATITUDE,
    longitude_deg: float = PLANT_LONGITUDE,
    peak_capacity_w: float = PLANT_PEAK_DC_CAPACITY_W,
    ac_cap_w: float = 2.0 * MICROINVERTER_NAMEPLATE_W,
) -> EnvelopeCalibration:
    """Calibrate effective aggregate solar envelope parameters against reference sunny days."""
    if not reference_curves:
        return EnvelopeCalibration(
            calibrated=False,
            scale=1.0,
            tilt_deg=15.0,
            azimuth_offset_deg=0.0,
            elevation_cutoff_deg=5.0,
            ac_cap_w=ac_cap_w,
            sunny_days_count=0,
            last_calibrated_at=now_utc(),
        )

    # Estimate elevation cutoff: lowest elevation where active production begins
    elevations: list[float] = []
    for _d, points in reference_curves:
        active = [(dt, w) for dt, w in points if w >= 50.0]
        if active:
            first_dt = active[0][0]
            last_dt = active[-1][0]
            if first_dt.tzinfo is None:
                first_dt = first_dt.replace(tzinfo=_LOCAL)
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=_LOCAL)
            pos_first = solar_position(first_dt, latitude_deg, longitude_deg)
            pos_last = solar_position(last_dt, latitude_deg, longitude_deg)
            elevations.append(max(0.0, pos_first.elevation_deg))
            elevations.append(max(0.0, pos_last.elevation_deg))

    cutoff_deg = round(sum(elevations) / len(elevations), 1) if elevations else 5.0
    cutoff_deg = max(2.0, min(15.0, cutoff_deg))

    # Grid search candidate parameters over physical ranges
    tilt_candidates = [10.0, 15.0, 20.0, 25.0]
    azimuth_candidates = [-15.0, -10.0, -5.0, 0.0, 5.0, 10.0, 15.0]
    scale_candidates = [0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15]

    # Pre-compute solar positions for reference curves
    # curve_pos: list of (observed_w, zenith_deg, azimuth_deg, elevation_deg)
    from wattloft.solar.clearsky import haurwitz_irradiance

    samples_data: list[tuple[float, float, float, float]] = []
    for _d, points in reference_curves:
        for dt, obs_w in points:
            if obs_w < 50.0:
                continue
            stamp = dt if dt.tzinfo is not None else dt.replace(tzinfo=_LOCAL)
            pos = solar_position(stamp, latitude_deg, longitude_deg)
            if pos.elevation_deg >= cutoff_deg:
                samples_data.append((obs_w, pos.zenith_deg, pos.azimuth_deg, pos.elevation_deg))

    if not samples_data:
        return EnvelopeCalibration(
            calibrated=True,
            scale=1.0,
            tilt_deg=15.0,
            azimuth_offset_deg=0.0,
            elevation_cutoff_deg=cutoff_deg,
            ac_cap_w=ac_cap_w,
            sunny_days_count=len(reference_curves),
            last_calibrated_at=now_utc(),
        )

    best_error = float("inf")
    best_tilt = 15.0
    best_azimuth = 0.0
    best_scale = 1.0

    for tilt in tilt_candidates:
        beta = math.radians(tilt)
        cos_beta = math.cos(beta)
        sin_beta = math.sin(beta)
        for az_offset in azimuth_candidates:
            delta_gamma = math.radians(az_offset)
            # Evaluate base shape
            base_powers: list[float] = []
            for obs_w, zenith_deg, azimuth_deg, elevation_deg in samples_data:
                ghi = haurwitz_irradiance(zenith_deg)
                if ghi <= 0:
                    base_powers.append(0.0)
                    continue
                th_z = math.radians(zenith_deg)
                gamma_s = math.radians(azimuth_deg)
                cos_th_z = math.cos(th_z)
                sin_th_z = math.sin(th_z)

                cos_e = cos_th_z * cos_beta + sin_th_z * sin_beta * math.sin(gamma_s - delta_gamma)
                cos_w = cos_th_z * cos_beta - sin_th_z * sin_beta * math.sin(gamma_s - delta_gamma)
                cos_eff = 0.5 * (max(0.0, cos_e) + max(0.0, cos_w))
                ratio = cos_eff / max(0.08, cos_th_z)
                p_unscaled = peak_capacity_w * (ghi / 1000.0) * ratio
                base_powers.append(p_unscaled)

            for scale in scale_candidates:
                err = 0.0
                for (obs_w, _, _, _), p_unscaled in zip(samples_data, base_powers, strict=False):
                    pred = min(p_unscaled * scale, ac_cap_w)
                    diff = obs_w - pred
                    err += diff * diff
                if err < best_error:
                    best_error = err
                    best_tilt = tilt
                    best_azimuth = az_offset
                    best_scale = scale

    return EnvelopeCalibration(
        calibrated=True,
        scale=round(best_scale, 2),
        tilt_deg=round(best_tilt, 1),
        azimuth_offset_deg=round(best_azimuth, 1),
        elevation_cutoff_deg=round(cutoff_deg, 1),
        ac_cap_w=ac_cap_w,
        sunny_days_count=len(reference_curves),
        last_calibrated_at=now_utc(),
    )


def load_calibration_from_meta(meta: dict[str, str]) -> EnvelopeCalibration:
    """Construct an EnvelopeCalibration from history_meta key-value pairs."""
    calibrated_val = meta.get("envelope_calibrated", "0")
    if calibrated_val not in ("1", "true", "True"):
        return EnvelopeCalibration(calibrated=False)

    scale = float(meta.get("envelope_scale", "1.0"))
    tilt_deg = float(meta.get("envelope_tilt_deg", "15.0"))
    azimuth_offset_deg = float(meta.get("envelope_azimuth_offset_deg", "0.0"))
    elevation_cutoff_deg = float(meta.get("envelope_elevation_cutoff_deg", "5.0"))
    ac_cap_w = float(meta.get("envelope_ac_cap_w", str(2.0 * MICROINVERTER_NAMEPLATE_W)))
    sunny_days_count = int(meta.get("envelope_sunny_days_count", "0"))
    last_calibrated_str = meta.get("envelope_last_calibrated_at")
    last_calibrated_at: datetime | None = None
    if last_calibrated_str:
        try:
            last_calibrated_at = datetime.fromisoformat(last_calibrated_str)
        except ValueError:
            pass

    return EnvelopeCalibration(
        calibrated=True,
        scale=scale,
        tilt_deg=tilt_deg,
        azimuth_offset_deg=azimuth_offset_deg,
        elevation_cutoff_deg=elevation_cutoff_deg,
        ac_cap_w=ac_cap_w,
        sunny_days_count=sunny_days_count,
        last_calibrated_at=last_calibrated_at,
    )


def calibration_to_meta(cal: EnvelopeCalibration) -> dict[str, str]:
    """Convert an EnvelopeCalibration to history_meta key-value mapping."""
    return {
        "envelope_calibrated": "1" if cal.calibrated else "0",
        "envelope_scale": str(cal.scale),
        "envelope_tilt_deg": str(cal.tilt_deg),
        "envelope_azimuth_offset_deg": str(cal.azimuth_offset_deg),
        "envelope_elevation_cutoff_deg": str(cal.elevation_cutoff_deg),
        "envelope_ac_cap_w": str(cal.ac_cap_w),
        "envelope_sunny_days_count": str(cal.sunny_days_count),
        "envelope_last_calibrated_at": (
            cal.last_calibrated_at.isoformat() if cal.last_calibrated_at else ""
        ),
    }


def load_calibration(database_url: str) -> EnvelopeCalibration:
    """Load persisted calibration from history_meta."""
    try:
        with connection(database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT k, v FROM history_meta WHERE k LIKE 'envelope_%'"
                )
                rows = cursor.fetchall()
                meta = {str(k): str(v) for k, v in rows}
                return load_calibration_from_meta(meta)
    except Exception:
        return EnvelopeCalibration(calibrated=False)


def save_calibration(database_url: str, cal: EnvelopeCalibration) -> None:
    """Persist calibration parameters to history_meta."""
    meta = calibration_to_meta(cal)
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            for k, v in meta.items():
                cursor.execute(
                    """
                    INSERT INTO history_meta (k, v) VALUES (%s, %s)
                    ON DUPLICATE KEY UPDATE v = VALUES(v)
                    """,
                    (k, v),
                )
        conn.commit()


def find_sunny_days(
    database_url: str,
    max_days: int = 5,
    min_energy_kwh: float = 4.0,
) -> list[tuple[date, list[tuple[datetime, float]]]]:
    """Scan history for high-yield, low-volatility sunny days."""
    summaries = load_day_summaries(database_url)
    if not summaries:
        return []

    # Aggregate summaries by local_day
    energy_by_day: dict[date, float] = {}
    for row in summaries:
        if row.last_today_energy_kwh is not None:
            energy_by_day[row.local_day] = (
                energy_by_day.get(row.local_day, 0.0) + row.last_today_energy_kwh
            )

    # Filter candidate days with sufficient energy, sorted descending by date
    candidate_days = [
        d for d, kwh in sorted(energy_by_day.items(), key=lambda x: x[0], reverse=True)
        if kwh >= min_energy_kwh
    ]

    sunny_days: list[tuple[date, list[tuple[datetime, float]]]] = []

    for cand_day in candidate_days:
        if len(sunny_days) >= max_days:
            break
        samples = load_samples_for_local_day(database_url, cand_day)
        if not samples:
            continue

        # Aggregate plant watts per minute
        by_minute: dict[datetime, float] = {}
        for s in samples:
            if s.ac_power_w is not None and s.ac_power_w > 0:
                minute = s.received_at.astimezone(_LOCAL).replace(second=0, microsecond=0, tzinfo=None)
                by_minute[minute] = by_minute.get(minute, 0.0) + s.ac_power_w

        curve_points = sorted(by_minute.items(), key=lambda x: x[0])
        is_clear, _volatility = is_clear_sky_day(curve_points, PLANT_PEAK_DC_CAPACITY_W)
        if is_clear:
            sunny_days.append((cand_day, curve_points))

    return sunny_days


def run_calibration(database_url: str) -> EnvelopeCalibration:
    """Find sunny days in history and calibrate the envelope model, persisting results."""
    sunny_days = find_sunny_days(database_url)
    if not sunny_days:
        # Fall back to uncalibrated
        cal = EnvelopeCalibration(
            calibrated=False,
            scale=1.0,
            tilt_deg=15.0,
            azimuth_offset_deg=0.0,
            elevation_cutoff_deg=5.0,
            ac_cap_w=2.0 * MICROINVERTER_NAMEPLATE_W,
            sunny_days_count=0,
            last_calibrated_at=now_utc(),
        )
        save_calibration(database_url, cal)
        return cal

    cal = calibrate_parameters(sunny_days)
    save_calibration(database_url, cal)
    return cal
