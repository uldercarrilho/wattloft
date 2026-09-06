import type { ChartMode } from "./chartMode";
import { curveWattsAt, type LoggerPoint } from "./curveWatts";
import {
  dayEnergyBars,
  formatKwh,
  formatWatts,
  monthEnergyBars,
  yearEnergyBars,
  type EnergyBar,
} from "./grains";
import type { CurveSeries, Grain, PlantSnapshot } from "./types";

export const GAP_MIN = 15;
const POWER_FLOOR = 1.0;

export type ChartDataset = {
  name: string;
  role: "plant" | "logger";
  stacked: boolean;
  values: (number | null)[];
};

export type TimeChartModel = {
  kind: "time";
  minutes: number[];
  tickHours: number[];
  yMax: number;
  datasets: ChartDataset[];
};

export type EnergyChartModel = {
  kind: "energy";
  tickLabels: string[];
  readoutLabels: string[];
  hrefs: string[];
  currentIndex: number;
  yMax: number;
  datasets: ChartDataset[];
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

function timeOverlay(snapshot: PlantSnapshot, visible: ReadonlySet<string>): TimeChartModel {
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
  const datasets: ChartDataset[] = [];
  for (const series of points) {
    if (!visible.has(series.name)) continue;
    datasets.push({
      name: series.name,
      role: "logger",
      stacked: false,
      values: minutes.map((t) => curveWattsAt(series.points, t, GAP_MIN)),
    });
  }
  if (visible.has("Plant")) {
    datasets.push({
      name: "Plant",
      role: "plant",
      stacked: false,
      values: plantValues,
    });
  }
  return {
    kind: "time",
    minutes,
    tickHours: hourTicks(tMin, tMax),
    yMax: peakVisible(datasets),
    datasets,
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

function timeStack(snapshot: PlantSnapshot, visible: ReadonlySet<string>): TimeChartModel {
  const loggers = loggerSeries(snapshot);
  const [tMin, tMax] = solarWindow(snapshot);
  const minutes: number[] = [];
  for (let t = tMin; t <= tMax; t++) minutes.push(t);
  const datasets: ChartDataset[] = [];
  for (const series of loggers) {
    if (!visible.has(series.name)) continue;
    const points = loggerPoints(series);
    datasets.push({
      name: series.name,
      role: "logger",
      stacked: true,
      values: minutes.map((t) => curveWattsAt(points, t, GAP_MIN)),
    });
  }
  return {
    kind: "time",
    minutes,
    tickHours: hourTicks(tMin, tMax),
    yMax: peakStacked(datasets, minutes),
    datasets,
  };
}

function energyBars(snapshot: PlantSnapshot, unit: Grain, visible?: ReadonlySet<string>): EnergyBar[] {
  if (unit === "month") return monthEnergyBars(snapshot, snapshot.selected_day, visible);
  if (unit === "year") return yearEnergyBars(snapshot, snapshot.selected_day, visible);
  return dayEnergyBars(snapshot, snapshot.selected_day, visible);
}

function tickLabel(unit: Grain, label: string): string {
  const head = label.split(" ")[0] ?? label;
  if (unit === "day") return head.slice(-2);
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
  const yMax = Math.max(1, ...bars.map((bar) => bar.kwh));
  const useStack = stacked && bars.some((bar) => bar.segments.length > 0);
  const datasets: ChartDataset[] = useStack
    ? [...visible]
        .filter((name) => name !== "Plant")
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          name,
          role: "logger" as const,
          stacked: true,
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
          values: bars.map((bar) => bar.kwh),
        },
      ];
  return {
    kind: "energy",
    tickLabels: bars.map((bar) => tickLabel(unit, bar.label)),
    readoutLabels: bars.map((bar) => bar.label),
    hrefs: bars.map((bar) => bar.href),
    currentIndex,
    yMax,
    datasets,
  };
}

export function buildPlantChartModel(
  snapshot: PlantSnapshot,
  unit: Grain,
  mode: ChartMode,
  visible: ReadonlySet<string>,
): PlantChartModel {
  if (unit === "time") {
    if (snapshot.curve.length === 0) {
      return { kind: "empty-time" };
    }
    if (mode === "stack") {
      return timeStack(snapshot, visible);
    }
    return timeOverlay(snapshot, visible);
  }
  return energyModel(snapshot, unit, mode, visible);
}

export type Readout = { when: string; rows: { name: string; text: string }[] };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
  const rows: Readout["rows"] = [];
  if (mode === "stack") {
    let plant = 0;
    let any = false;
    for (const dataset of model.datasets) {
      const value = index < 0 ? null : valueAt(dataset, index);
      if (value != null) {
        plant += value;
        any = true;
      }
    }
    rows.push({ name: "Plant", text: any ? wattsText(plant) : "—" });
  }
  for (const dataset of model.datasets) {
    rows.push({
      name: dataset.name,
      text: index < 0 ? "—" : wattsText(valueAt(dataset, index)),
    });
  }
  return {
    when: `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`,
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
      const value = valueAt(dataset, i);
      if (value != null) {
        plant += value;
        any = true;
      }
      rows.push({ name: dataset.name, text: kwhText(value) });
    }
    return {
      when,
      rows: [{ name: "Plant", text: any ? kwhText(plant) : "—" }, ...rows],
    };
  }
  const plant = model.datasets.find((dataset) => dataset.role === "plant");
  return {
    when,
    rows: [{ name: "Plant", text: kwhText(plant ? valueAt(plant, i) : null) }],
  };
}
