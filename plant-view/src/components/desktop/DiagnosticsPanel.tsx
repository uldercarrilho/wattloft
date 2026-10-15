import { computeDiagnostics } from "../../diagnostics";
import { formatKwh, formatWatts } from "../../grains";
import type { PlantSnapshot } from "../../types";

export function DiagnosticsPanel({ snapshot }: { snapshot: PlantSnapshot }) {
  const diag = computeDiagnostics(snapshot);

  return (
    <details className="diagnostics-panel" open>
      <summary className="diagnostics-header">
        <span>Production Intelligence & Solar Diagnostics</span>
        <span className="diag-toggle-icon" aria-hidden="true">▾</span>
      </summary>
      <div className="diagnostics-body">
        {/* String Balance */}
        <div className="diag-card">
          <h4>Array Balance (East / West)</h4>
          <div className="diag-metric">
            {diag.arrayBalance.ratio !== null
              ? `R(d) = ${diag.arrayBalance.ratio}`
              : diag.arrayBalance.baselineRatio !== null
                ? `Ratio ${diag.arrayBalance.baselineRatio}`
                : "Tracking"}
          </div>
          <div className="diag-sub">
            {diag.arrayBalance.baselineRatio !== null
              ? `60-day baseline median: ${diag.arrayBalance.baselineRatio}`
              : "Awaiting baseline convergence"}
            {diag.arrayBalance.advisory ? (
              <p className="drift-advisory" role="note">
                {diag.arrayBalance.advisory}
              </p>
            ) : null}
          </div>
        </div>

        {/* AC Clipping */}
        <div className="diag-card">
          <h4>Inverter AC Clipping</h4>
          <div className="diag-metric">
            {diag.clipping.isClipped
              ? `${diag.clipping.durationMinutes} min`
              : "0 min (Nominal)"}
          </div>
          <div className="diag-sub">
            {diag.clipping.estimatedClippedKwh !== null
              ? `Estimated uncaptured: ~${formatKwh(diag.clipping.estimatedClippedKwh)}`
              : "No thermal throttling detected"}
          </div>
        </div>

        {/* Clear-Sky Envelope */}
        <div className="diag-card">
          <h4>Solar Envelope Benchmark</h4>
          <div className="diag-metric">
            {diag.solarEnvelope.efficiencyPct !== null
              ? `${diag.solarEnvelope.efficiencyPct}%`
              : "Calculated"}
          </div>
          <div className="diag-sub">
            {diag.solarEnvelope.actualKwh !== null && diag.solarEnvelope.idealKwh !== null
              ? `${formatKwh(diag.solarEnvelope.actualKwh)} (ideal: ${formatKwh(diag.solarEnvelope.idealKwh)})`
              : diag.solarEnvelope.idealPeakW !== null
                ? `Peak: ${formatWatts(diag.solarEnvelope.actualPeakW)} (ideal: ${formatWatts(diag.solarEnvelope.idealPeakW)})`
                : `Observed: ${formatWatts(diag.solarEnvelope.actualPeakW)}`}
          </div>
          <div className="diag-detail" style={{ fontSize: "0.75rem", opacity: 0.8, marginTop: "0.25rem" }}>
            {diag.solarEnvelope.calibration?.calibrated
              ? `Calibrated (${diag.solarEnvelope.calibration.sunnyDaysCount} sunny ${diag.solarEnvelope.calibration.sunnyDaysCount === 1 ? "day" : "days"})`
              : "Clear-Sky baseline"}
          </div>
        </div>

        {/* Prior Year Comparison */}
        <div className="diag-card">
          <h4>Prior Year Comparison</h4>
          <div className="diag-metric">
            {diag.historical.deltaPct !== null
              ? `${diag.historical.deltaPct > 0 ? "+" : ""}${diag.historical.deltaPct}%`
              : diag.historical.prevYearKwh !== null
                ? formatKwh(diag.historical.prevYearKwh)
                : "Baseline pending"}
          </div>
          <div className="diag-sub">
            {diag.historical.prevYearKwh !== null
              ? `Same period prior year: ${formatKwh(diag.historical.prevYearKwh)}`
              : "No prior-year samples in History for this date"}
          </div>
        </div>
      </div>
    </details>
  );
}
