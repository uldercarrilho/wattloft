import { useEffect, useMemo, useRef } from "react";
import { GAP_MIN, PAD_X, minuteOfDay, solarWindow, xSolar, yWatts } from "./curve";
import { curveWattsAt, type LoggerPoint } from "./curveWatts";
import type { PlantSnapshot } from "./types";

function loggerClass(index: number): string {
  return index % 2 === 0 ? "series-a" : "series-b";
}

function fmtW(w: number | null | undefined): string {
  if (w == null) return "—";
  return (Math.abs(w - Math.round(w)) < 0.05 ? Math.round(w) : w.toFixed(1)) + " W";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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

function loggerPoints(snapshot: PlantSnapshot): { name: string; points: LoggerPoint[] }[] {
  return snapshot.curve
    .filter((series) => series.name !== "Plant")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((series) => ({
      name: series.name,
      points: series.points.map((point) => ({
        m: minuteOfDay(point.at),
        w: point.watts,
        l: point.lifetime_kwh ?? null,
      })),
    }));
}

function polygonForRun(
  run: { x: number; base: number; top: number }[],
): string {
  const bottom = run.map((pt) => `${pt.x.toFixed(1)},${pt.base.toFixed(1)}`);
  const top = [...run].reverse().map((pt) => `${pt.x.toFixed(1)},${pt.top.toFixed(1)}`);
  return [...bottom, ...top].join(" ");
}

export function TimeStack({
  snapshot,
  visible,
}: {
  snapshot: PlantSnapshot;
  visible: ReadonlySet<string>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const loggers = useMemo(() => loggerPoints(snapshot), [snapshot]);
  const shown = loggers.filter((series) => visible.has(series.name));
  const [tMin, tMax] = solarWindow(snapshot);
  const minutes: number[] = [];
  for (let t = tMin; t <= tMax; t++) minutes.push(t);

  const samples = minutes.map((t) => {
    const watts: (number | null)[] = shown.map((series) =>
      curveWattsAt(series.points, t, GAP_MIN),
    );
    return { t, watts };
  });

  let maxWatts = 1;
  for (const sample of samples) {
    const sum = sample.watts.reduce<number>((total, w) => total + (w ?? 0), 0);
    if (sum > maxWatts) maxWatts = sum;
  }

  const bands = shown.map((series, index) => {
    const polygons: string[] = [];
    let run: { x: number; base: number; top: number }[] = [];
    const flush = () => {
      if (run.length > 0) {
        polygons.push(polygonForRun(run));
        run = [];
      }
    };
    for (const sample of samples) {
      const watts = sample.watts[index];
      if (watts == null) {
        flush();
        continue;
      }
      let baseWatts = 0;
      for (let below = 0; below < index; below++) {
        const lower = sample.watts[below];
        if (lower != null) baseWatts += lower;
      }
      run.push({
        x: xSolar(sample.t, tMin, tMax),
        base: yWatts(baseWatts, maxWatts),
        top: yWatts(baseWatts + watts, maxWatts),
      });
    }
    flush();
    return { name: series.name, className: loggerClass(index), polygons };
  });

  const parked = Math.min(Math.max(12 * 60, tMin), tMax);
  const hairX = xSolar(parked, tMin, tMax);

  useEffect(() => {
    const el = root.current;
    const svg = el?.querySelector("#curve");
    const hair = el?.querySelector("#hair");
    if (!el || !(svg instanceof SVGElement) || hair === null) {
      return () => undefined;
    }
    const line = hair;
    function render(raw: number): void {
      const t = Math.max(tMin, Math.min(tMax, Math.round(raw)));
      const x = xSolar(t, tMin, tMax);
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
      let plant = 0;
      let any = false;
      const when = pad2(Math.floor(t / 60)) + ":" + pad2(t % 60);
      const elWhen = el.querySelector("#readout-when");
      if (elWhen) elWhen.textContent = when;
      for (const series of shown) {
        const got = curveWattsAt(series.points, t, GAP_MIN);
        const node = el.querySelector(`#readout [data-series="${series.name}"]`);
        if (node) node.textContent = `${series.name} ${fmtW(got)}`;
        if (got != null) {
          plant += got;
          any = true;
        }
      }
      const plantNode = el.querySelector("#readout-plant");
      if (plantNode) plantNode.textContent = `Plant ${any ? fmtW(plant) : "—"}`;
    }
    function fromEvent(ev: PointerEvent): void {
      if (typeof svg.getBoundingClientRect !== "function") return;
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 400;
      const span = tMax - tMin;
      const inner = 400 - 2 * PAD_X;
      render(tMin + ((x - PAD_X) / inner) * span);
    }
    function onDown(ev: Event): void {
      const pointer = ev as PointerEvent;
      if (typeof svg.setPointerCapture === "function") {
        svg.setPointerCapture(pointer.pointerId);
      }
      fromEvent(pointer);
    }
    function onMove(ev: Event): void {
      const pointer = ev as PointerEvent;
      const captured =
        typeof svg.hasPointerCapture === "function" &&
        svg.hasPointerCapture(pointer.pointerId);
      if (!captured && !(pointer.buttons & 1)) return;
      fromEvent(pointer);
    }
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    render(12 * 60);
    return () => {
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
    };
  }, [shown, tMin, tMax]);

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
        {bands.map((band) => (
          <g key={band.name} data-series={band.name} className={band.className}>
            {band.polygons.map((points) => (
              <polygon key={points} className={band.className} points={points} />
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
      <div className="readout" id="readout">
        <span className="when" id="readout-when">
          12:00
        </span>
        <p className="series-plant" id="readout-plant" data-series="Plant">
          Plant —
        </p>
        {shown.map((series) => (
          <p key={series.name} data-series={series.name}>
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
    </div>
  );
}
