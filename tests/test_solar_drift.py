from __future__ import annotations

from datetime import date, timedelta

from wattloft.solar.drift import evaluate_drift


def _generate_history(
    days_count: int,
    east_base: float,
    west_base: float,
    east_modifier: list[float] | None = None,
    west_modifier: list[float] | None = None,
) -> dict[date, dict[str, float]]:
    start = date(2026, 1, 1)
    history: dict[date, dict[str, float]] = {}
    for i in range(days_count):
        d = start + timedelta(days=i)
        e_mod = east_modifier[i] if east_modifier and i < len(east_modifier) else 1.0
        w_mod = west_modifier[i] if west_modifier and i < len(west_modifier) else 1.0
        history[d] = {
            "1000000001": round(east_base * e_mod, 2),
            "1000000002": round(west_base * w_mod, 2),
        }
    return history


def test_drift_triggers_on_sustained_single_string_soiling() -> None:
    # 60 days baseline with balanced 1.0 ratio (5.0 kWh each)
    # Then day 60-70: gradual soiling
    # Day 71-90 (20 days): East is soiled and underperforms West by 14% (4.3 kWh vs 5.0 kWh)
    total_days = 95
    east_mods = [1.0] * 60 + [0.86] * 35
    history = _generate_history(
        total_days,
        east_base=5.0,
        west_base=5.0,
        east_modifier=east_mods,
    )

    names = {"1000000001": "East", "1000000002": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is True
    assert result.affected_logger == "1000000001"
    assert result.drift_pct == 14
    assert result.advisory == "East array underperforming relative to West by 14% (check for soiling or obstruction)"


def test_no_drift_on_symmetric_weather_or_season_drop() -> None:
    # Both East and West drop equally by 50% (winter rain/solstice) for 30 consecutive days
    total_days = 95
    both_mods = [1.0] * 60 + [0.50] * 35
    history = _generate_history(
        total_days,
        east_base=5.0,
        west_base=5.0,
        east_modifier=both_mods,
        west_modifier=both_mods,
    )

    names = {"1000000001": "East", "1000000002": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is False
    assert result.advisory is None


def test_no_drift_when_divergence_is_transient() -> None:
    # Divergence lasts only 8 days (< 14 continuous days), then recovers
    total_days = 95
    east_mods = [1.0] * 60 + [0.80] * 8 + [1.0] * 27
    history = _generate_history(
        total_days,
        east_base=5.0,
        west_base=5.0,
        east_modifier=east_mods,
    )

    names = {"1000000001": "East", "1000000002": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is False


def test_no_drift_when_baseline_under_60_days() -> None:
    # Only 40 days of history total
    history = _generate_history(40, east_base=4.0, west_base=5.0)
    names = {"1000000001": "East", "1000000002": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is False
