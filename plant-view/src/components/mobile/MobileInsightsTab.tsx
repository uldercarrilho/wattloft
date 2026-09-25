import { computeDiagnostics } from "../../diagnostics";
import { formatKwh, formatWatts } from "../../grains";
import type { PlantSnapshot } from "../../types";
import { KpiCard } from "../KpiCard";

export function MobileInsightsTab({ snapshot }: { snapshot: PlantSnapshot }) {
  const diag = computeDiagnostics(snapshot);

  return (
    <div
      className="mobile-tab-screen mobile-insights-screen"
      role="tabpanel"
      id="tabpanel-insights"
      aria-labelledby="tab-insights"
    >
      <div className="insights-card-stack">
        {/* Array Balance Card */}
        <KpiCard
          label="Array Balance (East / West)"
          value={
            diag.arrayBalance.ratio !== null
              ? `R(d) = ${diag.arrayBalance.ratio}`
              : diag.arrayBalance.baselineRatio !== null
                ? `Baseline ${diag.arrayBalance.baselineRatio}`
                : "Nominal"
          }
          secondary={
            diag.arrayBalance.baselineRatio !== null ? (
              <span>60-day baseline: {diag.arrayBalance.baselineRatio}</span>
            ) : undefined
          }
          subtext={
            diag.arrayBalance.advisory ? (
              <span className="drift-advisory" role="note">
                {diag.arrayBalance.advisory}
              </span>
            ) : (
              "Symmetric physical string yields within nominal variance (<12%)."
            )
          }
          badge={
            diag.arrayBalance.status === "divergent"
              ? "Drift Warning"
              : diag.arrayBalance.status === "balanced"
                ? "Balanced"
                : "Tracking"
          }
        />

        {/* AC Clipping Card */}
        <KpiCard
          label="Inverter AC Clipping"
          value={
            diag.clipping.isClipped
              ? `${diag.clipping.durationMinutes} min clipping`
              : "No Clipping"
          }
          secondary={
            diag.clipping.estimatedClippedKwh !== null
              ? `Uncaptured: ~${formatKwh(diag.clipping.estimatedClippedKwh)}`
              : undefined
          }
          subtext={
            diag.clipping.isClipped
              ? `${diag.clipping.plateauCount} plateau segment(s) detected near AC nameplate capacity.`
              : "Inverters operating unthrottled within AC nameplate thermal limits."
          }
          badge={diag.clipping.isClipped ? "Clipped" : "Nominal"}
        />

        {/* Clear-Sky Solar Envelope Card */}
        <KpiCard
          label="Solar Envelope Efficiency"
          value={
            diag.solarEnvelope.efficiencyPct !== null
              ? `${diag.solarEnvelope.efficiencyPct}% of Clear-Sky`
              : "Calculated"
          }
          secondary={
            diag.solarEnvelope.idealPeakW !== null
              ? `Peak: ${formatWatts(diag.solarEnvelope.actualPeakW)} / ${formatWatts(diag.solarEnvelope.idealPeakW)} ideal`
              : `Observed Peak: ${formatWatts(diag.solarEnvelope.actualPeakW)}`
          }
          subtext="Passive astronomical Haurwitz irradiance envelope benchmark (ADR 0032)."
          badge={
            diag.solarEnvelope.status === "optimal"
              ? "Optimal"
              : diag.solarEnvelope.status === "reduced"
                ? "Reduced"
                : "Passive"
          }
        />
      </div>
    </div>
  );
}
