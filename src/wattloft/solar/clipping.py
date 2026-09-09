from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from wattloft.solar.geometry import solar_position

_LOCAL = ZoneInfo("America/Sao_Paulo")


@dataclass(frozen=True)
class ClippingPlateau:
    logger_serial: str
    start_minute: int
    end_minute: int
    start_at: datetime
    end_at: datetime
    plateau_watts: float
    estimated_clipped_kwh: float


@dataclass(frozen=True)
class ClippingSummary:
    clipped: bool
    clipped_minutes: int
    estimated_clipped_kwh: float | None
    plateaus: tuple[ClippingPlateau, ...]


def _minute_of_day(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def _is_solar_elevation_qualifying(
    start_dt: datetime,
    end_dt: datetime,
    latitude_deg: float,
    longitude_deg: float,
) -> bool:
    """Verify solar elevation angle is increasing or at peak zenith during the period."""
    pos_start = solar_position(start_dt, latitude_deg, longitude_deg)
    pos_end = solar_position(end_dt, latitude_deg, longitude_deg)

    # Must be during producing daylight
    if pos_start.elevation_deg < 10.0 and pos_end.elevation_deg < 10.0:
        return False

    # Elevation is increasing during the window
    if pos_end.elevation_deg >= pos_start.elevation_deg:
        return True

    # Or window covers or is adjacent to peak zenith (solar noon)
    solar_noon = pos_start.solar_noon
    # Window spans solar noon or is within 45 minutes of solar noon
    start_utc = start_dt.astimezone(timezone.utc)
    end_utc = end_dt.astimezone(timezone.utc)
    noon_utc = solar_noon.astimezone(timezone.utc)

    diff_start = (noon_utc - start_utc).total_seconds() / 60.0
    diff_end = (end_utc - noon_utc).total_seconds() / 60.0

    # Solar noon is inside the window or window is within 30 min of solar noon
    if start_utc <= noon_utc <= end_utc:
        return True
    if abs(diff_start) <= 45.0 or abs(diff_end) <= 45.0:
        return True

    return False


def _estimate_clipped_kwh(
    plateau_minutes: list[int],
    plateau_watts: list[float],
    pre_plateau_watts: list[float],
    nameplate_w: float,
) -> float:
    """Fit a standard sinusoidal bell curve across plateau endpoints to estimate uncaptured energy.

    E_clipped = int (P_ideal(t) - P_actual(t)) dt
    P_ideal(t) = P_plateau + A * sin(pi * (t - t0) / delta_t)
    """
    n = len(plateau_minutes)
    if n < 2:
        return 0.0

    delta_t = plateau_minutes[-1] - plateau_minutes[0] + 1
    # Solar DC over-sizing typically reaches 1.25x - 1.35x of inverter AC nameplate at peak.
    # Amplitude A of excess power curve above plateau:
    # Based on duration and slope, bounded between 15% and 40% of nameplate
    if pre_plateau_watts and len(pre_plateau_watts) >= 2:
        rise_rate = max(1.0, (pre_plateau_watts[-1] - pre_plateau_watts[0]) / max(1, len(pre_plateau_watts)))
        amplitude = rise_rate * delta_t / math.pi
    else:
        amplitude = 0.25 * nameplate_w

    amplitude = max(0.20 * nameplate_w, min(0.40 * nameplate_w, amplitude))

    # Analytical integral of A * sin(pi * t / D) from 0 to D is (2 * A * D) / pi (W * min)
    energy_w_min = (2.0 * amplitude * delta_t) / math.pi
    clipped_kwh = energy_w_min / 60_000.0

    return round(clipped_kwh, 2)


def detect_clipping_for_series(
    serial: str,
    points: list[tuple[datetime, float]],
    nameplate_w: float,
    latitude_deg: float,
    longitude_deg: float,
) -> ClippingSummary:
    """Detect inverter clipping on minute-by-minute curve for one logger.

    Rules:
    - Contiguous periods >= 45 minutes where:
      max(watts) - min(watts) <= 0.015 * nameplate_w
      and watts >= 0.90 * nameplate_w
    - Solar elevation angle is increasing or at peak zenith during period
    - Sinusoidal bell curve integration for clipped energy
    """
    if len(points) < 45:
        return ClippingSummary(
            clipped=False,
            clipped_minutes=0,
            estimated_clipped_kwh=None,
            plateaus=(),
        )

    # Sort points chronologically
    sorted_pts = sorted(points, key=lambda p: p[0])
    threshold_min_watts = 0.90 * nameplate_w
    max_delta = 0.015 * nameplate_w

    plateaus: list[ClippingPlateau] = []
    current_run: list[tuple[datetime, float, int]] = []

    def evaluate_run(run: list[tuple[datetime, float, int]]) -> None:
        if len(run) < 45:
            return
        m_start = run[0][2]
        m_end = run[-1][2]
        # Must be contiguous in minutes (allow max 2 min gap)
        if (m_end - m_start + 1) > len(run) + 5:
            return
        w_values = [p[1] for p in run]
        if (max(w_values) - min(w_values)) > max_delta:
            return

        dt_start = run[0][0]
        dt_end = run[-1][0]
        if not _is_solar_elevation_qualifying(dt_start, dt_end, latitude_deg, longitude_deg):
            return

        # Estimate clipped kWh
        run_indices = [p[2] for p in run]
        start_idx = sorted_pts.index((run[0][0], run[0][1]))
        pre_pts = [sorted_pts[i][1] for i in range(max(0, start_idx - 15), start_idx)]
        clipped_kwh = _estimate_clipped_kwh(run_indices, w_values, pre_pts, nameplate_w)
        avg_w = round(sum(w_values) / len(w_values), 1)

        plateaus.append(
            ClippingPlateau(
                logger_serial=serial,
                start_minute=m_start,
                end_minute=m_end,
                start_at=dt_start,
                end_at=dt_end,
                plateau_watts=avg_w,
                estimated_clipped_kwh=clipped_kwh,
            )
        )

    for i, (dt, watts) in enumerate(sorted_pts):
        m = _minute_of_day(dt)
        if watts >= threshold_min_watts:
            if not current_run:
                current_run.append((dt, watts, m))
            else:
                prev_m = current_run[-1][2]
                # Contiguous minute check (step of 1 or small sample gap <= 3 min)
                if (m - prev_m) <= 3:
                    # Check if adding this point still keeps max - min <= max_delta
                    test_run_w = [p[1] for p in current_run] + [watts]
                    if (max(test_run_w) - min(test_run_w)) <= max_delta:
                        current_run.append((dt, watts, m))
                    else:
                        evaluate_run(current_run)
                        current_run = [(dt, watts, m)]
                else:
                    evaluate_run(current_run)
                    current_run = [(dt, watts, m)]
        else:
            if current_run:
                evaluate_run(current_run)
                current_run = []

    if current_run:
        evaluate_run(current_run)

    if not plateaus:
        return ClippingSummary(
            clipped=False,
            clipped_minutes=0,
            estimated_clipped_kwh=None,
            plateaus=(),
        )

    total_minutes = sum(p.end_minute - p.start_minute + 1 for p in plateaus)
    total_clipped_kwh = round(sum(p.estimated_clipped_kwh for p in plateaus), 2)

    return ClippingSummary(
        clipped=True,
        clipped_minutes=total_minutes,
        estimated_clipped_kwh=total_clipped_kwh,
        plateaus=tuple(plateaus),
    )


def detect_clipping(
    points_by_logger: dict[str, list[tuple[datetime, float]]],
    nameplate_w: float,
    latitude_deg: float,
    longitude_deg: float,
) -> tuple[ClippingSummary, dict[str, ClippingSummary]]:
    """Detect clipping across all loggers and produce Plant-wide and per-logger summaries."""
    by_logger: dict[str, ClippingSummary] = {}
    all_plateaus: list[ClippingPlateau] = []

    for serial, points in sorted(points_by_logger.items()):
        summary = detect_clipping_for_series(
            serial, points, nameplate_w, latitude_deg, longitude_deg
        )
        by_logger[serial] = summary
        all_plateaus.extend(summary.plateaus)

    if not all_plateaus:
        plant_summary = ClippingSummary(
            clipped=False,
            clipped_minutes=0,
            estimated_clipped_kwh=None,
            plateaus=(),
        )
    else:
        total_minutes = sum(p.end_minute - p.start_minute + 1 for p in all_plateaus)
        total_kwh = round(sum(p.estimated_clipped_kwh for p in all_plateaus), 2)
        plant_summary = ClippingSummary(
            clipped=True,
            clipped_minutes=total_minutes,
            estimated_clipped_kwh=total_kwh,
            plateaus=tuple(all_plateaus),
        )

    return plant_summary, by_logger
