# Hybrid solar envelope and historical sunny-day calibration

Amends [ADR 0032](0032-solar-diagnostics-and-production-intelligence.md).

Wattloft enhances the clear-sky astronomical envelope with an empirical hybrid calibration fitted from historical sunny days at the Plant total level.

1. **Clear-Sky Detection Heuristic**: Historical days are classified as reference sunny days using curve smoothness (low high-frequency power derivative variance, rejecting cloud valleys and overcast swings) combined with high total daily energy relative to season.
2. **Parametric Hybrid Solar Model**: Deterministic solar geometry (zenith, hour angle, declination) is scaled with empirical parameters fitted against identified sunny days (effective capacity scaling, roof tilt/azimuth offsets, morning/afternoon skew) and capped at the Plant AC nameplate capacity (e.g., 2000 W). This enables accurate envelope generation for any calendar day across seasons without requiring individual micro-modeling of strings.
3. **Automated Nightly Background Calibration**: Local midnight evaluation inspects completed days and updates calibrated parameters persisted in `history_meta`. Snapshot queries evaluate the calibrated model in constant $O(1)$ time with zero external API dependencies. Fallback to uncalibrated theoretical clear-sky baseline is used on fresh boots with no sunny days.
4. **Plant View Integration**: Retains the existing 'Ideal envelope' toggle and dashed styling on the Power curve. Daily envelope efficiency accurately reflects rooftop potential (~95–100% on clear days), with calibration metadata surfaced in Diagnostics.
