import { useState } from "react";
import type { ChartMode } from "../../chartMode";
import { localDayOf, stackLoggerNames, stepper } from "../../grains";
import {
  Chart,
  ChartModeBar,
  PeriodStepper,
  chooseChartMode,
  overlayTimeNames,
} from "../../plantChrome";
import type { PlantSnapshot } from "../../types";
import { SeriesToggleChips } from "../SeriesToggleChips";

export function MobilePowerTab({
  snapshot,
  mode,
  setMode,
  idealEnvelope,
  onToggleIdealEnvelope,
}: {
  snapshot: PlantSnapshot;
  mode: ChartMode;
  setMode: (mode: ChartMode) => void;
  idealEnvelope: boolean;
  onToggleIdealEnvelope: () => void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const period = stepper(
    snapshot,
    snapshot.selected_day,
    "time",
    localDayOf(new Date().toISOString()),
  );

  const names =
    snapshot.curve.length === 0
      ? []
      : mode === "stack"
        ? stackLoggerNames(snapshot)
        : overlayTimeNames(snapshot);

  const visible = new Set(names.filter((name) => !hidden.has(name)));

  return (
    <div
      className="mobile-tab-screen mobile-power-screen"
      role="tabpanel"
      id="tabpanel-power"
      aria-labelledby="tab-power"
    >
      <PeriodStepper
        label={period.label}
        prevHref={period.prevHref}
        nextHref={period.nextHref}
        hideChevrons={!period.prevHref && !period.nextHref}
      />
      <ChartModeBar
        mode={mode}
        onChoose={(next) => chooseChartMode(next, setMode)}
        unit="time"
        idealEnvelope={idealEnvelope}
        onToggleIdealEnvelope={onToggleIdealEnvelope}
      />
      <Chart
        snapshot={snapshot}
        unit="time"
        mode={mode}
        visible={visible}
        idealEnvelope={idealEnvelope}
        chips={
          <SeriesToggleChips
            snapshot={snapshot}
            names={names}
            hidden={hidden}
            onToggle={(name) => {
              setHidden((prev) => {
                const next = new Set(prev);
                if (next.has(name)) next.delete(name);
                else next.add(name);
                return next;
              });
            }}
          />
        }
      />
    </div>
  );
}
