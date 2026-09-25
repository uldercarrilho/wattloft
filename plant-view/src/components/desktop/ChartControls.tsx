import type { ChartMode } from "../../chartMode";
import { href } from "../../grains";
import {
  ChartModeBar,
  GRAIN_LABEL,
  PeriodStepper,
  chooseChartMode,
} from "../../plantChrome";
import type { Grain, PlantSnapshot } from "../../types";

export function ChartControls({
  snapshot,
  unit,
  mode,
  setMode,
  idealEnvelope,
  onToggleIdealEnvelope,
  period,
}: {
  snapshot: PlantSnapshot;
  unit: Grain;
  mode: ChartMode;
  setMode: (mode: ChartMode) => void;
  idealEnvelope: boolean;
  onToggleIdealEnvelope: () => void;
  period: { label: string; prevHref: string; nextHref: string };
}) {
  return (
    <div className="desktop-chart-controls">
      {unit !== "year" ? (
        <PeriodStepper
          label={period.label}
          prevHref={period.prevHref}
          nextHref={period.nextHref}
        />
      ) : null}

      <nav className="grain" aria-label="Grain">
        {(["time", "day", "month", "year"] as const).map((grain) => (
          <a
            key={grain}
            href={href(snapshot.selected_day, grain)}
            aria-current={grain === unit ? "true" : undefined}
            aria-label={grain === "time" ? "Power curve for this Local day" : undefined}
          >
            {GRAIN_LABEL[grain]}
          </a>
        ))}
      </nav>

      <ChartModeBar
        mode={mode}
        onChoose={(next) => chooseChartMode(next, setMode)}
        unit={unit}
        idealEnvelope={idealEnvelope}
        onToggleIdealEnvelope={onToggleIdealEnvelope}
      />
    </div>
  );
}
