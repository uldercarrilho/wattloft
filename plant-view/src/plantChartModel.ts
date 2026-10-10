import type { ChartMode } from "./chartMode";
import { curveWattsAt, type LoggerPoint } from "./curveWatts";
import {
  dayEnergyBars,
  formatDayMonth,
  formatKwh,
  formatMonthName,
  formatShortMonth,
  formatWatts,
  monthEnergyBars,
  stackLoggerNames,
  weekdayTick,
  yearEnergyBars,
  type EnergyBar,
} from "./grains";
import type { ClippingPlateau, CurveSeries, Grain, PlantSnapshot } from "./types";

export const GAP_MIN = 15;
const POWER_FLOOR = 1.0;

export function niceYMax(peak: number): number {
  if (!(peak > 0) || peak <= 1) return 1;
  const exp = Math.floor(Math.log10(peak));
  const base = 10 ** exp;
  const frac = peak / base;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return nice * base;
}

export type ChartDataset = {
  name: string;
  role: "plant" | "logger" | "ideal" | "comparison";
  stacked: boolean;
  swatch: "plant" | "pigment" | "logger-a" | "logger-b" | "muted";
  values: (number | null)[];
};

export type TimeChartModel = {
  kind: "time";
  minutes: number[];
  tickHours: number[];
  yMax: number;
  yUnit: "W" | "kWh";
  datasets: ChartDataset[];
  clippingPlateaus?: ClippingPlateau[];
};

export type EnergyChartModel = {
  kind: "energy";
  tickLabels: string[];
  readoutLabels: string[];
  hrefs: string[];
  currentIndex: number;
  yMax: number;
  yUnit: "W" | "kWh";
  partial: boolean[];
  datasets: ChartDataset[];
  bars?: EnergyBar[];
};

export type PlantChartModel = TimeChartModel | EnergyChartModel | { kind: "empty-time" };

export function minuteOfDay(at: string): number {
  const time = at.includes("T") ? at.split("T")[1] : at.split(" ")[1];
  const [h, m] = (time ?? "00:00").split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function solarWindow(snapshot: PlantSnapshot): [number, number] {
  const loggers = snapshot.curve.filter((series) => series.name !== "Plant");
  let minutes = loggers.flatMap((series) =>
    series.points.filter((point) => point.watts > POWER_FLOOR).map((point) => minuteOfDay(point.at)),
  );
  if (minutes.length === 0) {
    minutes = loggers.flatMap((series) => series.points.map((point) => minuteOfDay(point.at)));
  }
  if (minutes.length === 0) {
    return [0, 23 * 60 + 59];
  }
  const lo = Math.max(0, Math.min(...minutes) - 60);
  let hi = Math.min(23 * 60 + 59, Math.max(...minutes) + 60);
  if (hi <= lo) {
    hi = Math.min(23 * 60 + 59, lo + 60);
  }
  return [lo, hi];
}

function loggerSeries(snapshot: PlantSnapshot): CurveSeries[] {
  return snapshot.curve
    .filter((series) => series.name !== "Plant")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loggerPoints(series: CurveSeries): LoggerPoint[] {
  return series.points.map((point) => ({
    m: minuteOfDay(point.at),
    w: point.watts,
    l: point.lifetime_kwh ?? null,
  }));
}

function loggerSwatch(name: string, ordered: string[]): "logger-a" | "logger-b" {
  return ordered.indexOf(name) % 2 === 0 ? "logger-a" : "logger-b";
}

function hourTicks(tMin: number, tMax: number): number[] {
  const ticks: number[] = [];
  for (let hour = Math.ceil(tMin / 60); hour <= Math.floor(tMax / 60); hour++) {
    ticks.push(hour);
  }
  return ticks;
}

function peakVisible(datasets: ChartDataset[]): number {
  let max = 1;
  for (const dataset of datasets) {
    for (const value of dataset.values) {
      if (value != null && value > max) max = value;
    }
  }
  return max;
}

function timeOverlay(
  snapshot: PlantSnapshot,
  visible: ReadonlySet<string>,
  idealEnvelope = false,
): TimeChartModel {
  const loggers = loggerSeries(snapshot);
  const [tMin, tMax] = solarWindow(snapshot);
  const minutes: number[] = [];
  for (let t = tMin; t <= tMax; t++) minutes.push(t);
  const points = loggers.map((series) => ({
    name: series.name,
    points: loggerPoints(series),
  }));
  const plantValues = minutes.map((t) => {
    let sum = 0;
    let any = false;
    for (const series of points) {
      const watts = curveWattsAt(series.points, t, GAP_MIN);
      if (watts != null) {
        sum += watts;
        any = true;
      }
    }
    return any ? sum : null;
  });
  const ordered = points.map((series) => series.name);
  const datasets: ChartDataset[] = [];
  for (const series of points) {
    if (!visible.has(series.name)) continue;
    datasets.push({
      name: series.name,
      role: "logger",
      stacked: false,
      swatch: loggerSwatch(series.name, ordered),
      values: minutes.map((t) => curveWattsAt(series.points, t, GAP_MIN)),
    });
  }
  if (visible.has("Plant")) {
    datasets.push({
      name: "Plant",
      role: "plant",
      stacked: false,
      swatch: "plant",
      values: plantValues,
    });
  }
  if (idealEnvelope) {
    const visibleLoggers = Array.from(visible).filter((name) => name !== "Plant");
    const singleIsolatedLogger = visibleLoggers.length === 1 && !visible.has("Plant") ? visibleLoggers[0] : null;

    if (
      singleIsolatedLogger &&
      snapshot.logger_ideal_curves &&
      snapshot.logger_ideal_curves[singleIsolatedLogger] &&
      snapshot.logger_ideal_curves[singleIsolatedLogger].length > 0
    ) {
      const loggerCurve = snapshot.logger_ideal_curves[singleIsolatedLogger];
      const idealMap = new Map(loggerCurve.map((p) => [minuteOfDay(p.at), p.watts]));
      datasets.push({
        name: `${singleIsolatedLogger} envelope`,
        role: "ideal",
        stacked: false,
        swatch: "muted",
        values: minutes.map((t) => idealMap.get(t) ?? null),
      });
    } else if (snapshot.ideal_curve && snapshot.ideal_curve.length > 0) {
      const idealMap = new Map(snapshot.ideal_curve.map((p) => [minuteOfDay(p.at), p.watts]));
      datasets.push({
        name: "Ideal envelope",
        role: "ideal",
        stacked: false,
        swatch: "muted",
        values: minutes.map((t) => idealMap.get(t) ?? null),
      });
    }
  }
  return {
    kind: "time",
    minutes,
    tickHours: hourTicks(tMin, tMax),
    yMax: niceYMax(peakVisible(datasets)),
    yUnit: "W",
    datasets,
    clippingPlateaus: snapshot.clipping?.plateaus ?? [],
  };
}

function peakStacked(datasets: ChartDataset[], minutes: number[]): number {
  let max = 1;
  for (let i = 0; i < minutes.length; i++) {
    let sum = 0;
    for (const dataset of datasets) {
      const value = dataset.values[i];
      if (value != null) sum += value;
    }
    if (sum > max) max = sum;
  }
  return max;
}

function timeStack(
  snapshot: PlantSnapshot,
  visible: ReadonlySet<string>,
  idealEnvelope = false,
): TimeChartModel {
  const loggers = loggerSeries(snapshot);
  const [tMin, tMax] = solarWindow(snapshot);
  const minutes: number[] = [];
  for (let t = tMin; t <= tMax; t++) minutes.push(t);
  const ordered = loggers.map((series) => series.name);
  const datasets: ChartDataset[] = [];
  for (const series of loggers) {
    if (!visible.has(series.name)) continue;
    const points = loggerPoints(series);
    datasets.push({
      name: series.name,
      role: "logger",
      stacked: true,
      swatch: loggerSwatch(series.name, ordered),
      values: minutes.map((t) => curveWattsAt(points, t, GAP_MIN)),
    });
  }
  if (idealEnvelope && snapshot.ideal_curve && snapshot.ideal_curve.length > 0) {
    const idealMap = new Map(snapshot.ideal_curve.map((p) => [minuteOfDay(p.at), p.watts]));
    datasets.push({
      name: "Ideal envelope",
      role: "ideal",
      stacked: false,
      swatch: "muted",
      values: minutes.map((t) => idealMap.get(t) ?? null),
    });
  }
  const stackedMax = peakStacked(datasets.filter((d) => d.role !== "ideal"), minutes);
  const idealMax = peakVisible(datasets.filter((d) => d.role === "ideal"));
  return {
    kind: "time",
    minutes,
    tickHours: hourTicks(tMin, tMax),
    yMax: niceYMax(Math.max(stackedMax, idealMax)),
    yUnit: "W",
    datasets,
    clippingPlateaus: snapshot.clipping?.plateaus ?? [],
  };
}

function energyBars(snapshot: PlantSnapshot, unit: Grain, visible?: ReadonlySet<string>): EnergyBar[] {
  if (unit === "month") return monthEnergyBars(snapshot, snapshot.selected_day, visible);
  if (unit === "year") return yearEnergyBars(snapshot, snapshot.selected_day, visible);
  return dayEnergyBars(snapshot, snapshot.selected_day, visible);
}

function tickLabel(unit: Grain, label: string): string {
  const head = label.split(" ")[0] ?? label;
  if (unit === "day") return weekdayTick(head);
  if (unit === "month") return formatShortMonth(head);
  return head;
}

function energyModel(
  snapshot: PlantSnapshot,
  unit: Grain,
  mode: ChartMode,
  visible: ReadonlySet<string>,
): EnergyChartModel {
  const stacked = mode === "stack";
  const bars = energyBars(snapshot, unit, stacked ? visible : undefined);
  const currentIndex =
    unit === "day"
      ? Math.max(
          0,
          bars.findIndex((bar) => bar.href.includes(`day=${snapshot.selected_day}`)),
        )
      : Math.max(0, bars.findIndex((bar) => bar.current));
  const yMax = niceYMax(Math.max(1, ...bars.map((bar) => Math.max(bar.kwh, bar.prevYearKwh ?? 0))));
  const useStack = stacked && bars.some((bar) => bar.segments.length > 0);
  const ordered = stackLoggerNames(snapshot);
  const datasets: ChartDataset[] = useStack
    ? [...visible]
        .filter((name) => name !== "Plant")
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          name,
          role: "logger" as const,
          stacked: true,
          swatch: loggerSwatch(name, ordered),
          values: bars.map((bar) => {
            const part = bar.segments.find((segment) => segment.name === name);
            return part ? part.kwh : null;
          }),
        }))
    : [
        {
          name: "Plant",
          role: "plant",
          stacked: false,
          swatch: "pigment",
          values: bars.map((bar) => bar.kwh),
        },
      ];

  if (unit === "day" && bars.some((bar) => bar.prevYearKwh != null)) {
    datasets.push({
      name: "Previous year",
      role: "comparison",
      stacked: false,
      swatch: "muted",
      values: bars.map((bar) => bar.prevYearKwh ?? null),
    });
  }

  return {
    kind: "energy",
    tickLabels: bars.map((bar) => tickLabel(unit, bar.label)),
    readoutLabels: bars.map((bar) => formatEnergyWhen(unit, bar.label)),
    hrefs: bars.map((bar) => bar.href),
    currentIndex,
    yMax,
    yUnit: "kWh",
    partial: bars.map((bar) => bar.partial),
    datasets,
    bars,
  };
}

export function buildPlantChartModel(
  snapshot: PlantSnapshot,
  unit: Grain,
  mode: ChartMode,
  visible: ReadonlySet<string>,
  idealEnvelope = false,
): PlantChartModel {
  if (unit === "time") {
    if (snapshot.curve.length === 0) {
      return { kind: "empty-time" };
    }
    if (mode === "stack") {
      return timeStack(snapshot, visible, idealEnvelope);
    }
    return timeOverlay(snapshot, visible, idealEnvelope);
  }
  return energyModel(snapshot, unit, mode, visible);
}

export function parkedMinute(model: TimeChartModel): number {
  const production = model.datasets.filter(
    (dataset) => dataset.role === "plant" || dataset.role === "logger",
  );
  const plant = production.find((dataset) => dataset.role === "plant");
  const series = plant ? [plant] : production.length > 0 ? production : model.datasets;
  let last: number | null = null;
  for (let i = 0; i < model.minutes.length; i++) {
    if (series.some((dataset) => dataset.values[i] != null)) {
      last = model.minutes[i]!;
    }
  }
  return last ?? model.minutes.at(-1) ?? 0;
}

export type Readout = { when: string; rows: { name: string; text: string }[] };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function hourTickLabel(value: string | number): string {
  const n = Number(value);
  return n % 60 === 0 ? `${pad2(n / 60)}:00` : "";
}

function formatEnergyWhen(unit: Grain, label: string): string {
  const [head, ...rest] = label.split(" ");
  const tail = rest.join(" ");
  if (!head) return label;
  if (unit === "day") return `${formatDayMonth(head)} ${tail}`;
  if (unit === "month" && /^\d{4}-\d{2}$/.test(head)) return `${formatMonthName(`${head}-01`)} ${tail}`;
  return label;
}

function heldWattsText(dataset: ChartDataset, index: number, minutes: number[]): string {
  if (index < 0) return "—";
  const exact = valueAt(dataset, index);
  if (exact != null) return wattsText(exact);
  const t = minutes[index]!;
  for (let i = index - 1; i >= 0; i--) {
    const value = valueAt(dataset, i);
    if (value == null) continue;
    if (t - minutes[i]! <= GAP_MIN) return `est. ${formatWatts(value)}`;
    return "—";
  }
  return "—";
}

function wattsText(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatWatts(value);
}

function kwhText(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatKwh(value);
}

function valueAt(dataset: ChartDataset, index: number): number | null {
  const value = dataset.values[index];
  return value === undefined ? null : value;
}

export function timeReadout(model: TimeChartModel, minute: number, mode: ChartMode): Readout {
  const t = Math.max(model.minutes[0] ?? 0, Math.min(model.minutes.at(-1) ?? 0, Math.round(minute)));
  const index = model.minutes.indexOf(t);
  const plateau = model.clippingPlateaus?.find((p) => t >= p.start_minute && t <= p.end_minute);
  const rows: Readout["rows"] = [];
  if (mode === "stack") {
    let plant = 0;
    let any = false;
    for (const dataset of model.datasets) {
      if (dataset.role === "ideal") continue;
      const value = index < 0 ? null : valueAt(dataset, index);
      if (value != null) {
        plant += value;
        any = true;
      }
    }
    let text = any ? wattsText(plant) : "—";
    if (plateau && any) {
      text += ` (clipped · est. ${formatKwh(plateau.estimated_clipped_kwh)} lost today)`;
    }
    rows.push({ name: "Plant", text });
  }
  for (const dataset of model.datasets) {
    let text = index < 0 ? "—" : heldWattsText(dataset, index, model.minutes);
    if (
      plateau &&
      text !== "—" &&
      (dataset.role === "plant" || dataset.name === plateau.logger_serial)
    ) {
      text += ` (clipped · est. ${formatKwh(plateau.estimated_clipped_kwh)} lost today)`;
    }
    rows.push({
      name: dataset.name,
      text,
    });
  }
  const dashed = rows.every((row) => row.text === "—");
  return {
    when: `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}${dashed ? " gap" : ""}`,
    rows,
  };
}

export function energyReadout(model: EnergyChartModel, index: number): Readout {
  const i = Math.max(0, Math.min(model.readoutLabels.length - 1, index));
  const when = model.readoutLabels[i] ?? "";
  if (model.datasets.some((dataset) => dataset.stacked)) {
    const rows: Readout["rows"] = [];
    let plant = 0;
    let any = false;
    for (const dataset of model.datasets) {
      if (dataset.role === "comparison") continue;
      const value = valueAt(dataset, i);
      if (value != null) {
        plant += value;
        any = true;
      }
      rows.push({ name: dataset.name, text: kwhText(value) });
    }
    const comparison = model.datasets.find((d) => d.role === "comparison");
    const comparisonRow =
      comparison && valueAt(comparison, i) != null
        ? [{ name: "Previous year", text: kwhText(valueAt(comparison, i)) }]
        : [];
    return {
      when,
      rows: [{ name: "Plant", text: any ? kwhText(plant) : "—" }, ...rows, ...comparisonRow],
    };
  }
  const plant = model.datasets.find((dataset) => dataset.role === "plant");
  const rows: Readout["rows"] = [{ name: "Plant", text: kwhText(plant ? valueAt(plant, i) : null) }];
  const comparison = model.datasets.find((d) => d.role === "comparison");
  if (comparison && valueAt(comparison, i) != null) {
    rows.push({ name: "Previous year", text: kwhText(valueAt(comparison, i)) });
  }
  return {
    when,
    rows,
  };
}
