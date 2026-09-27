from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date

from wattloft.config import DRIFT_VARIANCE_THRESHOLD


@dataclass(frozen=True)
class DriftResult:
    detected: bool
    advisory: str | None
    affected_logger: str | None
    drift_pct: int | None
    baseline_ratio: float | None = None
    rolling_ratio: float | None = None
    threshold_pct: int = 5


def evaluate_drift(
    by_bar_day: dict[date, dict[str, float]],
    logger_display_names: dict[str, str],
    *,
    threshold: float | None = None,
) -> DriftResult:
    """Evaluate array balance and drift over daily logger production history.

    Mathematical formulation:
    - For each day with successful production (> 0) from both admitted loggers (e.g. East and West):
      Ratio(d) = TodayEnergy_East(d) / TodayEnergy_West(d)
    - Baseline R_base = median of first 60 days of monitoring.
    - 30-day rolling median R_30(d) compared against R_base.
    - If |R_30(d) - R_base| / R_base > threshold (default 0.05 / 5%) continuously for 14 Local Days:
      Advisory badge: '{Name} array underperforming relative to {Other} by X% (check for soiling or obstruction)'
    """
    variance_threshold = threshold if threshold is not None else DRIFT_VARIANCE_THRESHOLD
    th_pct = round(variance_threshold * 100)

    if not by_bar_day:
        return DriftResult(
            detected=False,
            advisory=None,
            affected_logger=None,
            drift_pct=None,
            threshold_pct=th_pct,
        )


    # Determine serials for Array A and Array B (prefer East as A, West as B if names match)
    all_serials = sorted({s for day_dict in by_bar_day.values() for s in day_dict})
    if len(all_serials) < 2:
        return DriftResult(
            detected=False,
            advisory=None,
            affected_logger=None,
            drift_pct=None,
            threshold_pct=th_pct,
        )

    serial_a = all_serials[0]
    serial_b = all_serials[1]
    # Check if serial_b is East and serial_a is West, swap so East is serial_a
    for s in all_serials:
        if logger_display_names.get(s, "").lower() == "east":
            serial_a = s
        elif logger_display_names.get(s, "").lower() == "west":
            serial_b = s

    name_a = logger_display_names.get(serial_a, serial_a)
    name_b = logger_display_names.get(serial_b, serial_b)

    # Build sequence of valid production days
    valid_days: list[tuple[date, float]] = []
    for day in sorted(by_bar_day):
        prod = by_bar_day[day]
        kwh_a = prod.get(serial_a, 0.0)
        kwh_b = prod.get(serial_b, 0.0)
        # Require positive production from both loggers (> 0.05 kWh)
        if kwh_a > 0.05 and kwh_b > 0.05:
            ratio = kwh_a / kwh_b
            valid_days.append((day, ratio))

    # Baseline requires first 60 days of monitoring
    if len(valid_days) < 60:
        return DriftResult(
            detected=False,
            advisory=None,
            affected_logger=None,
            drift_pct=None,
            threshold_pct=th_pct,
        )

    first_60_ratios = [r for _, r in valid_days[:60]]
    r_base = statistics.median(first_60_ratios)
    if r_base <= 0:
        return DriftResult(
            detected=False,
            advisory=None,
            affected_logger=None,
            drift_pct=None,
            threshold_pct=th_pct,
        )

    # Calculate 30-day rolling median for each day i >= 29
    rolling_medians: list[tuple[date, float, float]] = []  # (day, r_30, rel_drift)
    for i in range(len(valid_days)):
        start_idx = max(0, i - 29)
        window = [r for _, r in valid_days[start_idx : i + 1]]
        r_30 = statistics.median(window)
        rel_drift = abs(r_30 - r_base) / r_base
        rolling_medians.append((valid_days[i][0], r_30, rel_drift))

    # Need at least 14 days of evaluation
    if len(rolling_medians) < 14:
        return DriftResult(
            detected=False,
            advisory=None,
            affected_logger=None,
            drift_pct=None,
            baseline_ratio=round(r_base, 3),
            threshold_pct=th_pct,
        )

    # Check if relative drift > variance_threshold continuously for the last 14 Local Days
    last_14 = rolling_medians[-14:]
    sustained = all(drift > variance_threshold for _, _, drift in last_14)

    latest_day, latest_r_30, latest_drift = rolling_medians[-1]

    if not sustained:
        return DriftResult(
            detected=False,
            advisory=None,
            affected_logger=None,
            drift_pct=None,
            baseline_ratio=round(r_base, 3),
            rolling_ratio=round(latest_r_30, 3),
            threshold_pct=th_pct,
        )

    # Determine which array is underperforming
    if latest_r_30 < r_base:
        # Array A (e.g. East) is producing relatively less than baseline
        underperforming_serial = serial_a
        underperforming_name = name_a
        other_name = name_b
        drift_pct = round(((r_base - latest_r_30) / r_base) * 100)
    else:
        # Array B (e.g. West) is producing relatively less than baseline
        underperforming_serial = serial_b
        underperforming_name = name_b
        other_name = name_a
        drift_pct = round(((latest_r_30 - r_base) / r_base) * 100)

    advisory = (
        f"{underperforming_name} array underperforming relative to "
        f"{other_name} by {drift_pct}% (check for soiling or obstruction)"
    )

    return DriftResult(
        detected=True,
        advisory=advisory,
        affected_logger=underperforming_serial,
        drift_pct=drift_pct,
        baseline_ratio=round(r_base, 3),
        rolling_ratio=round(latest_r_30, 3),
        threshold_pct=th_pct,
    )
