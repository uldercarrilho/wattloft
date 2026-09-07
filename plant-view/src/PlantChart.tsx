import { useEffect, useRef, useState } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
} from "chart.js";
import type { ActiveElement, ChartConfiguration, ChartEvent, Plugin } from "chart.js";
import type { ChartMode } from "./chartMode";
import {
  hourTickLabel,
  parkedMinute,
  type ChartDataset,
  type EnergyChartModel,
  type PlantChartModel,
  type TimeChartModel,
} from "./plantChartModel";

Chart.register(
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
);
if (Chart.defaults) {
  Chart.defaults.locale = "en-US";
}

const FALLBACK: Record<ChartDataset["swatch"], [string, string]> = {
  plant: ["--plant", "#1A2A3A"],
  pigment: ["--pigment", "#1E4F8C"],
  "logger-a": ["--logger-a", "#1E4F8C"],
  "logger-b": ["--logger-b", "#C4841D"],
};

function cssColor(swatch: ChartDataset["swatch"]): string {
  const [variable, fallback] = FALLBACK[swatch];
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

function inkColor(): string {
  if (typeof document === "undefined") return "#1A2A3A";
  return getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#1A2A3A";
}

function mutedColor(): string {
  if (typeof document === "undefined") return "#5A6B78";
  return getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#5A6B78";
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (hex.startsWith("#") && (hex.length === 7 || hex.length === 4)) {
    const full =
      hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    const r = Number.parseInt(full.slice(1, 3), 16);
    const g = Number.parseInt(full.slice(3, 5), 16);
    const b = Number.parseInt(full.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export function PlantChart({
  model,
  mode,
  onPointer,
  onBarNavigate,
  onDrawError,
}: {
  model: Exclude<PlantChartModel, { kind: "empty-time" }>;
  mode: ChartMode;
  onPointer: (value: number) => void;
  onBarNavigate: (href: string) => void;
  onDrawError: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const hairRef = useRef(0);
  const highlightRef = useRef(0);
  const onPointerRef = useRef(onPointer);
  const onBarNavigateRef = useRef(onBarNavigate);
  const onDrawErrorRef = useRef(onDrawError);
  const [failed, setFailed] = useState(false);
  onPointerRef.current = onPointer;
  onBarNavigateRef.current = onBarNavigate;
  onDrawErrorRef.current = onDrawError;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || failed) return undefined;
    const ink = inkColor();
    const muted = mutedColor();
    hairRef.current = model.kind === "time" ? parkedMinute(model) : model.currentIndex;
    highlightRef.current = model.kind === "energy" ? model.currentIndex : 0;
    if (model.kind === "time") {
      onPointerRef.current(hairRef.current);
    } else {
      onPointerRef.current(model.currentIndex);
    }
    const hairPlugin: Plugin = {
      id: "wattloft-hair",
      afterDraw(chart) {
        if (model.kind !== "time") return;
        const xScale = chart.scales.x;
        if (!xScale) return;
        const x = xScale.getPixelForValue(hairRef.current);
        const yScale = chart.scales.y;
        if (!yScale || Number.isNaN(x)) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, yScale.top);
        ctx.lineTo(x, yScale.bottom);
        ctx.stroke();
        ctx.restore();
      },
    };
    try {
      chartRef.current = new Chart(
        canvas,
        chartConfig(model, mode, ink, muted, hairPlugin, {
          onPointer: (value) => {
            if (model.kind === "time") hairRef.current = value;
            else highlightRef.current = value;
            onPointerRef.current(value);
            chartRef.current?.update?.("none");
          },
          onBarNavigate: (href) => onBarNavigateRef.current(href),
          highlight: () => highlightRef.current,
        }) as ChartConfiguration,
      );
    } catch {
      setFailed(true);
      onDrawErrorRef.current();
      return undefined;
    }
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [model, mode, failed]);

  useEffect(() => {
    const host = canvasRef.current;
    if (!host || model.kind !== "time" || failed) return undefined;
    const plot: HTMLCanvasElement = host;
    function report(ev: PointerEvent): void {
      if (model.kind !== "time") return;
      const rect = plot.getBoundingClientRect();
      if (rect.width <= 0) return;
      const tMin = model.minutes[0] ?? 0;
      const tMax = model.minutes.at(-1) ?? 0;
      const raw = tMin + ((ev.clientX - rect.left) / rect.width) * (tMax - tMin);
      const minute = Math.max(tMin, Math.min(tMax, Math.round(raw)));
      hairRef.current = minute;
      onPointerRef.current(minute);
      chartRef.current?.update?.("none");
    }
    function onDown(ev: PointerEvent): void {
      if (typeof plot.setPointerCapture === "function") {
        plot.setPointerCapture(ev.pointerId);
      }
      report(ev);
    }
    function onMove(ev: PointerEvent): void {
      const captured =
        typeof plot.hasPointerCapture === "function" && plot.hasPointerCapture(ev.pointerId);
      if (captured || ev.buttons & 1) report(ev);
    }
    plot.addEventListener("pointerdown", onDown);
    plot.addEventListener("pointermove", onMove);
    return () => {
      plot.removeEventListener("pointerdown", onDown);
      plot.removeEventListener("pointermove", onMove);
    };
  }, [model, failed]);

  useEffect(() => {
    const plot = canvasRef.current;
    if (!plot || failed) return undefined;
    function onKey(ev: KeyboardEvent): void {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      const delta = ev.key === "ArrowRight" ? 1 : -1;
      if (model.kind === "time") {
        const tMin = model.minutes[0] ?? 0;
        const tMax = model.minutes.at(-1) ?? 0;
        const next = Math.max(tMin, Math.min(tMax, hairRef.current + delta));
        hairRef.current = next;
        onPointerRef.current(next);
      } else {
        const next = Math.max(
          0,
          Math.min(model.tickLabels.length - 1, highlightRef.current + delta),
        );
        highlightRef.current = next;
        onPointerRef.current(next);
      }
      chartRef.current?.update?.("none");
    }
    plot.addEventListener("keydown", onKey);
    return () => plot.removeEventListener("keydown", onKey);
  }, [model, failed]);

  if (failed) {
    return <p className="empty">Plant view cannot draw this chart.</p>;
  }
  const label = model.kind === "time" ? "Power curve" : "Energy bars";
  return (
    <div
      className={model.kind === "energy" ? "plant-chart is-energy" : "plant-chart"}
      id="plant-chart"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        tabIndex={0}
        style={{ touchAction: "none" }}
      />
    </div>
  );
}

function chartConfig(
  model: TimeChartModel | EnergyChartModel,
  _mode: ChartMode,
  ink: string,
  muted: string,
  hairPlugin: Plugin,
  handlers: {
    onPointer: (value: number) => void;
    onBarNavigate: (href: string) => void;
    highlight: () => number;
  },
) {
  const stacked = model.datasets.some((dataset) => dataset.stacked);
  const yTitle = {
    display: true,
    text: model.yUnit,
    color: muted,
    font: { family: '"IBM Plex Mono", monospace', size: 10 },
  };
  if (model.kind === "time") {
    return {
      type: "line" as const,
      data: {
        datasets: timeDatasets(model, stacked),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false as const,
        spanGaps: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
        scales: {
          x: {
            type: "linear" as const,
            min: model.minutes[0],
            max: model.minutes.at(-1),
            ticks: {
              color: muted,
              font: { family: '"IBM Plex Mono", monospace', size: 10 },
              callback(value: string | number) {
                return hourTickLabel(value);
              },
            },
            grid: { color: "rgba(26, 42, 58, 0.12)" },
          },
          y: {
            min: 0,
            max: model.yMax,
            stacked,
            title: yTitle,
            ticks: {
              color: muted,
              font: { family: '"IBM Plex Mono", monospace', size: 10 },
            },
            grid: { color: "rgba(26, 42, 58, 0.12)" },
          },
        },
      },
      plugins: [hairPlugin],
    };
  }
  const highlight = handlers.highlight();
  return {
    type: "bar" as const,
    data: {
      labels: model.tickLabels,
      datasets: model.datasets.map((dataset) => {
        const fill = cssColor(dataset.swatch);
        return {
          label: dataset.name,
          data: dataset.values,
          backgroundColor: model.partial.map((partial) =>
            withAlpha(fill, partial ? 0.45 : 1),
          ),
          borderColor: model.tickLabels.map((_, index) => (index === highlight ? ink : fill)),
          borderWidth: model.tickLabels.map((_, index) => (index === highlight ? 2 : 0)),
          stack: stacked ? "energy" : undefined,
        };
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      skipNull: true,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      onClick(_event: ChartEvent, elements: ActiveElement[]) {
        const index = elements[0]?.index;
        if (index == null) return;
        const href = model.hrefs[index];
        if (href) handlers.onBarNavigate(href);
      },
      onHover(_event: ChartEvent, elements: ActiveElement[]) {
        const index = elements[0]?.index;
        if (index == null) return;
        handlers.onPointer(index);
      },
      scales: {
        x: {
          stacked,
          ticks: {
            color: muted,
            font: { family: '"IBM Plex Mono", monospace', size: 10 },
          },
          grid: { display: false },
        },
        y: {
          stacked,
          min: 0,
          max: model.yMax,
          title: yTitle,
          ticks: {
            color: muted,
            font: { family: '"IBM Plex Mono", monospace', size: 10 },
          },
          grid: { color: "rgba(26, 42, 58, 0.12)" },
        },
      },
    },
  };
}

function timeDatasets(model: TimeChartModel, stacked: boolean) {
  const dashedLogger = model.datasets.find((dataset) => dataset.role === "logger")?.name;
  return model.datasets.flatMap((dataset) => {
    const stroke = cssColor(dataset.swatch);
    const style = {
      label: dataset.name,
      borderColor: stroke,
      backgroundColor: stacked ? stroke : "transparent",
      fill: stacked,
      pointRadius: 0,
      tension: 0,
      spanGaps: false,
      borderDash:
        !stacked && dataset.role === "logger" && dataset.name === dashedLogger
          ? [6, 4]
          : undefined,
      stack: stacked ? "power" : undefined,
    };
    if (!stacked) {
      return [
        {
          ...style,
          data: model.minutes.map((x, i) => ({ x, y: dataset.values[i] })),
        },
      ];
    }
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    model.minutes.forEach((x, i) => {
      const y = dataset.values[i];
      if (y == null) {
        if (run.length > 0) {
          runs.push(run);
          run = [];
        }
        return;
      }
      run.push({ x, y });
    });
    if (run.length > 0) runs.push(run);
    return runs.map((data) => ({ ...style, data }));
  });
}
