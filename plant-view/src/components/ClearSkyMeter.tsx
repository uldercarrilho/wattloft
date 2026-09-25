import type { ClearSkyInstant } from "../glanceModel";

export function ClearSkyMeter({ meter }: { meter: ClearSkyInstant }) {
  return (
    <div
      className="clearsky-meter"
      role="meter"
      aria-label="Clear-sky efficiency"
      aria-valuenow={meter.efficiencyPct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${meter.efficiencyPct}% clear-sky · ${meter.idealLabel}`}
    >
      <div className="clearsky-bar-track">
        <div
          className={`clearsky-bar-fill condition-${meter.condition}`}
          style={{ width: `${meter.barWidthPct}%` }}
        />
      </div>
      <div className="clearsky-readout">
        <span className="clearsky-pct">{meter.efficiencyPct}% clear-sky</span>
        <span className="clearsky-sep" aria-hidden="true">
          ·
        </span>
        <span className="clearsky-ideal">{meter.idealLabel}</span>
      </div>
    </div>
  );
}
