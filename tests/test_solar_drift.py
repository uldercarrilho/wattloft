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
            "3909309465": round(east_base * e_mod, 2),
            "3913630013": round(west_base * w_mod, 2),
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

    names = {"3909309465": "East", "3913630013": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is True
    assert result.affected_logger == "3909309465"
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

    names = {"3909309465": "East", "3913630013": "West"}
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

    names = {"3909309465": "East", "3913630013": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is False


def test_no_drift_when_baseline_under_60_days() -> None:
    # Only 40 days of history total
    history = _generate_history(40, east_base=4.0, west_base=5.0)
    names = {"3909309465": "East", "3913630013": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is False
    assert result.threshold_pct == 5


def test_drift_triggers_at_five_percent_variance() -> None:
    # 60 days baseline, then sustained 6% underperformance for 35 days
    total_days = 95
    east_mods = [1.0] * 60 + [0.94] * 35
    history = _generate_history(
        total_days,
        east_base=5.0,
        west_base=5.0,
        east_modifier=east_mods,
    )
    names = {"3909309465": "East", "3913630013": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is True
    assert result.drift_pct == 6
    assert result.threshold_pct == 5
    assert "East array underperforming relative to West by 6%" in (result.advisory or "")


def test_no_drift_below_five_percent_variance() -> None:
    # 60 days baseline, then sustained 4% divergence (under the 5% threshold)
    total_days = 95
    east_mods = [1.0] * 60 + [0.96] * 35
    history = _generate_history(
        total_days,
        east_base=5.0,
        west_base=5.0,
        east_modifier=east_mods,
    )
    names = {"3909309465": "East", "3913630013": "West"}
    result = evaluate_drift(history, names)

    assert result.detected is False
    assert result.threshold_pct == 5


def test_custom_drift_threshold_override() -> None:
    # 6% divergence with a custom 8% threshold should not trigger
    total_days = 95
    east_mods = [1.0] * 60 + [0.94] * 35
    history = _generate_history(
        total_days,
        east_base=5.0,
        west_base=5.0,
        east_modifier=east_mods,
    )
    names = {"3909309465": "East", "3913630013": "West"}
    result = evaluate_drift(history, names, threshold=0.08)

    assert result.detected is False
    assert result.threshold_pct == 8

