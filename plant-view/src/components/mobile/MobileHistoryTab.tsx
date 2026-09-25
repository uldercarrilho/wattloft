import { useState } from "react";
import type { ChartMode } from "../../chartMode";
import {
  formatDayMonth,
  historyStartOf,
  href,
  localDayOf,
  stackLoggerNames,
  stepper,
} from "../../grains";
import {
  Chart,
  ChartModeBar,
  PeriodStepper,
  chooseChartMode,
} from "../../plantChrome";
import type { Grain, PlantSnapshot } from "../../types";
import { SeriesToggleChips } from "../SeriesToggleChips";

const HISTORY_GRAINS: { id: Grain; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

export function MobileHistoryTab({
  snapshot,
  grain,
  onSelectGrain,
  mode,
  setMode,
}: {
  snapshot: PlantSnapshot;
  grain: Grain;
  onSelectGrain?: (grain: Grain) => void;
  mode: ChartMode;
  setMode: (mode: ChartMode) => void;
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const effectiveGrain: Grain = grain === "time" ? "day" : grain;

  const period = stepper(
    snapshot,
    snapshot.selected_day,
    effectiveGrain,
    localDayOf(new Date().toISOString()),
  );

  const names = mode === "stack" ? stackLoggerNames(snapshot) : [];
  const visible = new Set(names.filter((name) => !hidden.has(name)));

  return (
    <div
      className="mobile-tab-screen mobile-history-screen"
      role="tabpanel"
      id="tabpanel-history"
      aria-labelledby="tab-history"
    >
      <nav className="grain" aria-label="History Grain">
        {HISTORY_GRAINS.map((item) => {
          const isCurrent = item.id === effectiveGrain;
          return (
            <a
              key={item.id}
              href={href(snapshot.selected_day, item.id)}
              aria-current={isCurrent ? "true" : undefined}
              onClick={(e) => {
                if (onSelectGrain) {
                  e.preventDefault();
                  onSelectGrain(item.id);
                  window.history.pushState({}, "", href(snapshot.selected_day, item.id));
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }
              }}
            >
              {item.label}
            </a>
          );
        })}
      </nav>

      {effectiveGrain !== "year" ? (
        <PeriodStepper
          label={period.label}
          prevHref={period.prevHref}
          nextHref={period.nextHref}
        />
      ) : null}

      <ChartModeBar
        mode={mode}
        onChoose={(next) => chooseChartMode(next, setMode)}
        unit={effectiveGrain}
      />

      <Chart
        snapshot={snapshot}
        unit={effectiveGrain}
        mode={mode}
        visible={visible}
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

      {effectiveGrain === "month" || effectiveGrain === "year" ? (
        <footer className="history-footer">
          <p className="history-footer-note">
            Wattloft History · from {formatDayMonth(historyStartOf(snapshot))}
          </p>
        </footer>
      ) : null}
    </div>
  );
}
