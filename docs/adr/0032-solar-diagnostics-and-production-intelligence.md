# Solar diagnostics and passive production intelligence

Amends [ADR 0001](0001-single-household-plant.md) and [ADR 0030](0030-day-summaries-and-pooled-mysql.md).

Wattloft computes solar benchmarks and diagnostic analytics in-process without third-party weather APIs, external sensor hardware, or cloud telemetry leaks, upholding domain data sovereignty.

1. **Clear-Sky Astronomical Envelope**: Deterministic offline solar geometry computes solar declination, hour angle, zenith, and azimuth for the Plant's rooftop coordinates. Irradiance follows Haurwitz's global horizontal irradiance model, scaled against Plant peak DC nameplate capacity ($W_p$), rendered as an optional quiet dashed guideline on the Power curve.
2. **Array Balance & Drift Tracking**: Physical string yields (East vs. West) are evaluated as a daily ratio $R(d)$ against a 60-day baseline median $R_{\text{base}}$. A 30-day rolling median tracks sustained divergence (>5% for 14 consecutive days, configurable via `WATTLOFT_DRIFT_VARIANCE_THRESHOLD`) to notify the Operator of localized panel soiling, shading, or microinverter aging without false alarms from cloudy weather while providing high sensitivity for panels placed close together.
3. **Inverter AC Clipping & Thermal Throttle Detection**: Contiguous plateaus $\ge 45$ minutes at $\ge 90\%$ AC nameplate within 1.5% power variance during ascending solar elevation or solar noon are identified as AC clipping. Clipped energy is estimated via sinusoidal bell curve integration and persisted to `day_summaries` (`clipped_minutes`, `estimated_clipped_kwh`), rendering highlighted plateau line segments and uncaptured kWh metrics on the Power curve.
4. **Historical Period Comparison**: Prior-year production overlays provide ghosted baseline comparisons for Month grain bars and percentage deltas on Year grain bars.
