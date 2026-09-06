import type { ChartMode } from "./chartMode";
import { curveWattsAt, type LoggerPoint } from "./curveWatts";
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
    if (mode === "overlay") {
      return timeOverlay(snapshot, visible);
    }
  }
  return { kind: "empty-time" };
}
