# ADR 0034: Dual-Array Plane-of-Array (POA) Envelope Calibration

Amends [ADR 0032](0032-solar-diagnostics-and-production-intelligence.md) and [ADR 0033](0033-hybrid-solar-envelope-calibration.md).

Wattloft decomposes the clear-sky astronomical envelope into independent Plane-of-Array (POA) geometric models for each admitted logger array (East and West microinverters).

1. **Physical Plane-of-Array (POA) Geometry**: Angle of incidence $\theta_i$ is computed independently for each physical roof plane:
   $$\cos(\theta_i) = \cos(\theta_z)\cos(\beta) + \sin(\theta_z)\sin(\beta)\cos(\gamma_s - \gamma_p)$$
   where $\theta_z$ is the solar zenith angle, $\gamma_s$ is the solar azimuth, $\beta$ is surface tilt, and $\gamma_p$ is surface azimuth (e.g. East $\approx 90^\circ$, West $\approx 270^\circ$).
2. **Per-Array Microinverter AC Cap**: Each microinverter enforces its individual AC nameplate capacity (e.g. 1000 W) prior to plant aggregation, eliminating clipping modeling distortions during morning/afternoon asymmetric generation.
3. **Automated Per-Array Historical Calibration**: Local midnight calibration inspects reference sunny days to fit independent scale, tilt, azimuth, and elevation cutoff parameters per admitted logger serial, persisted in `history_meta`.
4. **Plant View Multi-Series Guidelines**: Plant view receives both total Plant ideal curve and per-logger ideal curves (`logger_ideal_curves`), allowing string-specific performance comparison when inspecting individual series in Overlay mode.
