import { useEffect, useMemo, useState, type ReactNode } from "react";
import { type ChartMode, readModeHintSeen, writeChartMode, writeModeHintSeen } from "./chartMode";
import {
  energyReadout,
  buildPlantChartModel,
  parkedMinute,
  timeReadout,
} from "./plantChartModel";
import { PlantChart } from "./PlantChart";
import {
  displayNameOf,
  formatDayMonth,
  formatKwh,
  historyStartOf,
  localDayOf,
  selectedPeriodKwh,
} from "./grains";
import { lifetimeKwh } from "./LastSample";
import type { Grain, PlantSnapshot } from "./types";

export const GRAIN_LABEL: Record<Grain, string> = {
  time: "Power",
  day: "Day",
  month: "Month",
  year: "Year",
};

export function PlantHeader() {
  return (
    <header className="plant-header">
      <h1>Plant</h1>
      <form className="logout" method="post" action="/logout">
        <button type="submit">Log out</button>
      </form>
    </header>
  );
}

export function overlayTimeNames(snapshot: PlantSnapshot): string[] {
  const loggers = snapshot.curve
    .filter((series) => series.name !== "Plant")
    .map((series) => series.name)
    .sort((a, b) => a.localeCompare(b));
  return ["Plant", ...loggers];
}

function loggerClass(name: string, names: string[]): string {
  if (name === "Plant") return "series-plant";
  const loggers = names.filter((n) => n !== "Plant");
  return loggers.indexOf(name) % 2 === 0 ? "series-a" : "series-b";
}

function drillHint(unit: Grain): string | null {
  if (unit === "day") return "Tap a day to open its Power chart";
  if (unit === "month") return "Tap a month to open the Day chart";
  if (unit === "year") return "Tap a year to open the Month chart";
  return null;
}

export function Chart({
  snapshot,
  unit,
  mode,
  visible,
  chips,
}: {
  snapshot: PlantSnapshot;
  unit: Grain;
  mode: ChartMode;
  visible: ReadonlySet<string>;
  chips: ReactNode;
}) {
  const model = useMemo(
    () => buildPlantChartModel(snapshot, unit, mode, visible),
    [snapshot, unit, mode, visible],
  );
  const [pointer, setPointer] = useState<number | null>(null);
  useEffect(() => {
    setPointer(null);
  }, [snapshot.selected_day, unit, mode]);
  if (model.kind === "empty-time") {
    return <p className="empty">This Local day has no curve Samples.</p>;
  }
  const readout =
    model.kind === "time"
      ? timeReadout(model, pointer ?? parkedMinute(model), mode)
      : energyReadout(model, pointer ?? model.currentIndex);
  const nowDay = localDayOf(snapshot.current_power_at);
  const showPeriod = snapshot.selected_day !== nowDay;
  const periodKwh =
    mode === "stack"
      ? selectedPeriodKwh(snapshot, visible)
      : selectedPeriodKwh(snapshot);
  const partialCaption =
    model.kind === "energy" && model.partial.some(Boolean)
      ? unit === "day"
        ? "In progress"
        : unit === "year"
          ? "This year is incomplete in Wattloft"
          : "This month is incomplete in Wattloft"
      : null;
  const historyCaption =
    unit === "month" || unit === "year"
      ? `Wattloft History · from ${formatDayMonth(historyStartOf(snapshot))}`
      : null;
  const tapHint = drillHint(unit);
  return (
    <div className="plant-stage">
      <div className="plant-plot">
        {showPeriod ? (
          <p className="period">
            {formatDayMonth(snapshot.selected_day)} {formatKwh(periodKwh)}
          </p>
        ) : null}
        {historyCaption ? <p className="grain-title">{historyCaption}</p> : null}
        {unit === "year" ? (
          <p className="hint">
            Lifetime {lifetimeKwh(snapshot.lifetime_energy_kwh)} · before Wattloft
          </p>
        ) : null}
        <PlantChart
          model={model}
          mode={mode}
          onPointer={setPointer}
          onBarNavigate={(target) => {
            window.history.pushState({}, "", target);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          onDrawError={() => undefined}
        />
        {chips}
      </div>
      <div className="plant-aside">
        <div className="readout" aria-live="polite">
          <span className="when">{readout.when}</span>
          {readout.rows.map((row) => (
            <p
              key={row.name}
              data-series={row.name}
              className={row.name === "Plant" ? "series-plant" : ""}
            >
              {displayNameOf(snapshot, row.name)} {row.text}
            </p>
          ))}
        </div>
        {partialCaption ? <p className="hint">{partialCaption}</p> : null}
        {tapHint ? <p className="hint">{tapHint}</p> : null}
        {unit === "time" ? (
          <details className="hint gaps">
            <summary>Why gaps?</summary>
            <p>
              A gap where Lifetime energy still rose is interpolated as a smooth Power
              curve — that energy happened. Where Lifetime barely moved, the line valleys:
              no Samples and no estimate, possible Logger failure.
            </p>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function SeriesChips({
  snapshot,
  names,
  hidden,
  onToggle,
}: {
  snapshot: PlantSnapshot;
  names: string[];
  hidden: ReadonlySet<string>;
  onToggle: (name: string) => void;
}) {
  if (names.length === 0) {
    return null;
  }
  return (
    <div className="series-toggles">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          className={`series-toggle ${loggerClass(name, names)}${hidden.has(name) ? " is-off" : ""}`}
          data-series={name}
          title={name}
          aria-pressed={hidden.has(name) ? "false" : "true"}
          onClick={() => onToggle(name)}
        >
          <i />
          {displayNameOf(snapshot, name)}
        </button>
      ))}
    </div>
  );
}

export function PeriodStepper({
  label,
  prevHref,
  nextHref,
  hideChevrons,
}: {
  label: string;
  prevHref: string;
  nextHref: string;
  hideChevrons: boolean;
}) {
  return (
    <nav className="stepper" aria-label="Period">
      {hideChevrons ? null : prevHref ? (
        <a href={prevHref} aria-label="Previous">
          ‹
        </a>
      ) : (
        <span className="dead" aria-disabled="true">
          ‹
        </span>
      )}
      <span>{label}</span>
      {hideChevrons ? null : nextHref ? (
        <a href={nextHref} aria-label="Next">
          ›
        </a>
      ) : (
        <span className="dead" aria-disabled="true">
          ›
        </span>
      )}
    </nav>
  );
}

export function ChartModeBar({
  mode,
  onChoose,
}: {
  mode: ChartMode;
  onChoose: (next: ChartMode) => void;
}) {
  const [hint, setHint] = useState(() => !readModeHintSeen(window.localStorage));
  return (
    <>
      <nav className="grain chart-mode" aria-label="Chart mode">
        <button
          type="button"
          aria-pressed={mode === "overlay"}
          onClick={() => {
            onChoose("overlay");
            writeModeHintSeen(window.localStorage);
            setHint(false);
          }}
        >
          Each
        </button>
        <button
          type="button"
          aria-pressed={mode === "stack"}
          onClick={() => {
            onChoose("stack");
            writeModeHintSeen(window.localStorage);
            setHint(false);
          }}
        >
          By Logger
        </button>
      </nav>
      {hint ? (
        <p className="hint mode-hint">
          Each: Plant and Loggers on top of each other. By Logger: Loggers stacked; Plant is
          the height.
        </p>
      ) : null}
    </>
  );
}

export function chooseChartMode(next: ChartMode, setMode: (mode: ChartMode) => void): void {
  writeChartMode(window.localStorage, next);
  setMode(next);
}
