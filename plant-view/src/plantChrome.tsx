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
  localDayOf,
  selectedPeriodKwh,
  stackLoggerNames,
} from "./grains";
import type { Grain, PlantSnapshot } from "./types";

import { LiveStatusBadge, type ConnectionStatus } from "./components/LiveStatusBadge";
import { useTheme, type Theme } from "./useTheme";

export const GRAIN_LABEL: Record<Grain, string> = {
  time: "Power",
  day: "Day",
  month: "Month",
  year: "Year",
};

export function PlantHeader({
  status = "live",
  theme: propTheme,
  onToggleTheme: propToggleTheme,
}: {
  status?: ConnectionStatus;
  theme?: Theme;
  onToggleTheme?: () => void;
} = {}) {
  const localTheme = useTheme();
  const theme = propTheme ?? localTheme.theme;
  const toggleTheme = propToggleTheme ?? localTheme.toggleTheme;

  const onLogout = () => {
    if (typeof caches !== "undefined") {
      caches.keys().then((keys) => {
        return Promise.all(keys.map((k) => caches.delete(k)));
      }).catch(() => {});
    }
  };
  return (
    <header className="plant-header">
      <div className="header-brand-group">
        <h1>Plant</h1>
        <LiveStatusBadge status={status} />
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="theme-toggle-btn"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? "☼" : "☾"}
        </button>
        <form className="logout" method="post" action="/logout" onSubmit={onLogout}>
          <button type="submit">Log out</button>
        </form>
      </div>
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

function detailButtonLabel(unit: Grain): string {
  if (unit === "day") return "View Power curve";
  if (unit === "month") return "View Days";
  if (unit === "year") return "View Months";
  return "View details";
}

export function Chart({
  snapshot,
  unit,
  mode,
  visible,
  chips,
  idealEnvelope = false,
}: {
  snapshot: PlantSnapshot;
  unit: Grain;
  mode: ChartMode;
  visible: ReadonlySet<string>;
  chips: ReactNode;
  idealEnvelope?: boolean;
}) {
  const model = useMemo(
    () => buildPlantChartModel(snapshot, unit, mode, visible, idealEnvelope),
    [snapshot, unit, mode, visible, idealEnvelope],
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
  const showPeriod = unit === "time" && snapshot.selected_day !== nowDay;
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

  const seriesNames =
    mode === "stack" ? stackLoggerNames(snapshot) : overlayTimeNames(snapshot);
  const plantRow = readout.rows.find((r) => r.name === "Plant");
  const otherRows = readout.rows.filter((r) => r.name !== "Plant");
  const isGap = readout.when.includes("gap");

  const selectedIdx = pointer ?? (model.kind === "energy" ? model.currentIndex : 0);
  const targetHref = model.kind === "energy" ? model.hrefs[selectedIdx] : null;

  return (
    <div className="plant-stage">
      <div className="plant-plot">
        {showPeriod ? (
          <p className="period">
            {formatDayMonth(snapshot.selected_day)} {formatKwh(periodKwh)}
          </p>
        ) : null}
        <PlantChart
          model={model}
          mode={mode}
          pointer={pointer}
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
          <div className="readout-header">
            <span className="when">{readout.when}</span>
            {unit === "time" ? (
              <span className={`readout-status ${isGap ? "is-gap" : "is-active"}`}>
                {isGap ? "Gap" : "Production"}
              </span>
            ) : null}
          </div>
          {plantRow ? (
            <div className="readout-summary series-plant" data-series="Plant">
              <div className="readout-label">
                <span className="readout-dot series-plant" />
                <span>{displayNameOf(snapshot, "Plant")}</span>
              </div>
              <span className="readout-val">{plantRow.text}</span>
            </div>
          ) : null}
          {otherRows.length > 0 ? (
            <div className="readout-breakdown">
              {otherRows.map((row) => {
                const isIdeal = row.name === "Ideal envelope";
                const dotClass = isIdeal
                  ? "series-ideal"
                  : loggerClass(row.name, seriesNames);
                return (
                  <div
                    key={row.name}
                    className={`readout-row ${isIdeal ? "is-ideal" : ""}`}
                    data-series={row.name}
                  >
                    <div className="readout-label">
                      <span className={`readout-dot ${dotClass}`} />
                      <span>{displayNameOf(snapshot, row.name)}</span>
                    </div>
                    <span className="readout-val">{row.text}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {targetHref ? (
            <div className="readout-actions">
              <a
                href={targetHref}
                className="readout-details-btn"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState({}, "", targetHref);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
              >
                {detailButtonLabel(unit)}
              </a>
            </div>
          ) : null}
        </div>
        {snapshot.drift?.detected && snapshot.drift.advisory ? (
          <p className="drift-advisory" role="note">
            {snapshot.drift.advisory}
          </p>
        ) : null}
        {partialCaption ? <p className="hint">{partialCaption}</p> : null}
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
  hideChevrons = false,
}: {
  label: string;
  prevHref: string;
  nextHref: string;
  hideChevrons?: boolean;
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
  unit,
  idealEnvelope = false,
  onToggleIdealEnvelope,
}: {
  mode: ChartMode;
  onChoose: (next: ChartMode) => void;
  unit?: Grain;
  idealEnvelope?: boolean;
  onToggleIdealEnvelope?: () => void;
}) {
  const [hint, setHint] = useState(() => !readModeHintSeen(window.localStorage));
  return (
    <>
      <div className="chart-mode-row">
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
        {unit === "time" && onToggleIdealEnvelope ? (
          <button
            type="button"
            className={`ideal-toggle${idealEnvelope ? " is-active" : ""}`}
            aria-pressed={idealEnvelope ? "true" : "false"}
            onClick={onToggleIdealEnvelope}
          >
            Ideal envelope
          </button>
        ) : null}
      </div>
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
