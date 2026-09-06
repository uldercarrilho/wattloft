import { useEffect, useRef } from "react";
import type { CurvePoint, CurveSeries, PlantSnapshot } from "./types";
import { activateTimeCurve } from "./timeCurve";
import { GAP_MIN, minuteOfDay, solarWindow } from "./plantChartModel";

export { GAP_MIN, minuteOfDay, solarWindow } from "./plantChartModel";
export const PAD_X = 18;

export function xSolar(minute: number, tMin: number, tMax: number): number {
  const span = tMax - tMin;
  if (span <= 0) return PAD_X;
  return PAD_X + ((minute - tMin) / span) * (400 - 2 * PAD_X);
}

export function yWatts(watts: number, maxWatts: number): number {
  return 190 - (watts / maxWatts) * 160;
}

function cssClass(name: string, index: number): string {
  if (name === "Plant") return "series-plant";
  return index % 2 === 0 ? "series-a" : "series-b";
}

function ordered(snapshot: PlantSnapshot): CurveSeries[] {
  const loggers = snapshot.curve
    .filter((series) => series.name !== "Plant")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const plant = snapshot.curve.find((series) => series.name === "Plant");
  return plant ? [...loggers, plant] : loggers;
}

function dataAt(point: CurvePoint): string {
  return point.at.replace("T", " ");
}

function hourLabels(tMin: number, tMax: number): { x: number; label: string }[] {
  const start = Math.ceil(tMin / 60);
  const end = Math.floor(tMax / 60);
  const labels: { x: number; label: string }[] = [];
  for (let hour = start; hour <= end; hour++) {
    labels.push({ x: xSolar(hour * 60, tMin, tMax), label: String(hour) });
  }
  return labels;
}

export function TimeCurve({ snapshot }: { snapshot: PlantSnapshot }) {
  const root = useRef<HTMLDivElement>(null);
  const named = ordered(snapshot);
  const [tMin, tMax] = solarWindow(snapshot);
  const maxWatts = Math.max(
    1,
    ...snapshot.curve.flatMap((series) => series.points.map((point) => point.watts)),
  );
  const parked = Math.min(Math.max(12 * 60, tMin), tMax);
  const hairX = xSolar(parked, tMin, tMax);
  const payload = {
    loggers: Object.fromEntries(
      named
        .filter((series) => series.name !== "Plant")
        .map((series) => [
          series.name,
          series.points.map((point) => ({
            m: minuteOfDay(point.at),
            w: point.watts,
            l: point.lifetime_kwh ?? null,
          })),
        ]),
    ),
    tMin,
    tMax,
    window: GAP_MIN,
    pad: PAD_X,
  };

  useEffect(() => {
    if (!root.current) return;
    return activateTimeCurve(root.current);
  }, [snapshot]);

  return (
    <div ref={root}>
      <svg viewBox="0 0 400 214" role="img" aria-label="Power curve" id="curve">
        {hourLabels(tMin, tMax).map((tick) => (
          <text
            key={tick.label}
            className="tick"
            textAnchor="middle"
            x={tick.x}
            y="12"
          >
            {tick.label}
          </text>
        ))}
        {named.map((series, index) => (
          <g key={series.name} data-series={series.name} className={cssClass(series.name, index)}>
            <polyline
              fill="none"
              strokeWidth="1.8"
              points={series.points
                .map(
                  (point) =>
                    `${xSolar(minuteOfDay(point.at), tMin, tMax).toFixed(1)},${yWatts(point.watts, maxWatts).toFixed(1)}`,
                )
                .join(" ")}
            />
            {series.points.map((point) => (
              <circle
                key={point.at}
                data-at={dataAt(point)}
                data-watts={Number.isInteger(point.watts) ? String(point.watts) : String(point.watts)}
                cx={xSolar(minuteOfDay(point.at), tMin, tMax)}
                cy={yWatts(point.watts, maxWatts)}
                r="2.2"
              />
            ))}
          </g>
        ))}
        <line
          id="hair"
          x1={hairX}
          y1="24"
          x2={hairX}
          y2="190"
          stroke="currentColor"
          strokeWidth="1.2"
          opacity="0.85"
        />
      </svg>
      <div className="series-toggles">
        {named.map((series, index) => (
          <button
            key={series.name}
            type="button"
            className={`series-toggle ${cssClass(series.name, index)}`}
            data-series={series.name}
            aria-pressed="true"
          >
            <i />
            {series.name}
          </button>
        ))}
      </div>
      <div className="readout" id="readout">
        <span className="when" id="readout-when">
          12:00
        </span>
        {named.map((series) => (
          <p
            key={series.name}
            data-series={series.name}
            className={series.name === "Plant" ? "series-plant" : ""}
            id={series.name === "Plant" ? "readout-plant" : undefined}
          >
            {series.name} —
          </p>
        ))}
      </div>
      <p className="hint">
        Tap a name to show or hide its curve. A gap where Lifetime energy still rose
        is interpolated as a smooth Power curve — that energy happened. Where Lifetime
        barely moved, the line valleys: no Samples and no estimate, possible Logger
        failure.
      </p>
      <script type="application/json" id="curve-data">
        {JSON.stringify(payload)}
      </script>
    </div>
  );
}
