/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlantChartModel } from "./plantChartModel";
import type { PlantSnapshot } from "./types";

const chartState = vi.hoisted(() => ({
  throwNext: false,
  instances: [] as { config: { options?: { onClick?: Function } }; destroy: ReturnType<typeof vi.fn> }[],
}));

vi.mock("chart.js", () => {
  function Chart(_canvas: unknown, config: { options?: { onClick?: Function } }) {
    if (chartState.throwNext) {
      chartState.throwNext = false;
      throw new Error("chart failed");
    }
    const instance = { config, destroy: vi.fn() };
    chartState.instances.push(instance);
    return instance;
  }
  Chart.register = vi.fn();
  Chart.defaults = { locale: "en-US" };
  return {
    Chart,
    LineController: class LineController {},
    BarController: class BarController {},
    LineElement: class LineElement {},
    BarElement: class BarElement {},
    PointElement: class PointElement {},
    LinearScale: class LinearScale {},
    CategoryScale: class CategoryScale {},
    Filler: class Filler {},
  };
});

import { PlantChart } from "./PlantChart";

const loggerA = "1000000001";
const loggerB = "1000000002";

const energySnapshot: PlantSnapshot = {
  selected_day: "2026-08-21",
  today_energy_kwh: 0.2,
  current_power_w: 50,
  lifetime_energy_kwh: 5635.4,
  current_power_at: "2026-08-22T13:00:00+00:00",
  local_day_bars: [
    { local_day: "2026-08-21", today_energy_kwh: 3.9 },
    { local_day: "2026-08-22", today_energy_kwh: 0.2 },
  ],
  curve: [],
};

afterEach(() => {
  cleanup();
  chartState.instances = [];
  chartState.throwNext = false;
});

describe("PlantChart", () => {
  it("draws the canvas inside a sized plot slot, not as the slot itself", () => {
    const model = buildPlantChartModel(energySnapshot, "day", "overlay", new Set(["Plant"]));
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    render(
      <PlantChart
        model={model}
        mode="overlay"
        onPointer={vi.fn()}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );
    const canvas = screen.getByRole("img", { name: "Energy bars" });
    const slot = canvas.closest(".plant-chart");
    expect(slot).toBeTruthy();
    expect(slot).not.toBe(canvas);
    expect(slot?.className.split(" ")).toEqual(
      expect.arrayContaining(["plant-chart", "is-energy", "is-sparse"]),
    );
    expect((canvas as HTMLCanvasElement).style.touchAction).toBe("pan-y");
    const bars = (
      chartState.instances.at(-1)?.config as {
        data?: { datasets?: Array<{ borderWidth?: number[] }> };
      }
    ).data?.datasets?.[0]?.borderWidth;
    expect(bars).toContain(3);
  });

  it("shows draw-failure copy when Chart.js cannot init", () => {
    chartState.throwNext = true;
    const model = buildPlantChartModel(energySnapshot, "day", "overlay", new Set(["Plant"]));
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    const onDrawError = vi.fn();
    render(
      <PlantChart
        model={model}
        mode="overlay"
        onPointer={vi.fn()}
        onBarNavigate={vi.fn()}
        onDrawError={onDrawError}
      />,
    );
    expect(screen.getByText("Plant view cannot draw this chart.")).toBeTruthy();
    expect(onDrawError).toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("selects the column and notifies onPointer when a Day column is clicked", () => {
    const model = buildPlantChartModel(energySnapshot, "day", "overlay", new Set(["Plant"]));
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    const onPointer = vi.fn();
    render(
      <PlantChart
        model={model}
        mode="overlay"
        onPointer={onPointer}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Energy bars" })).toBeTruthy();
    const onClick = chartState.instances[0]?.config.options?.onClick;
    expect(onClick).toBeTypeOf("function");
    onClick?.({}, [{ index: 0 }]);
    expect(onPointer).toHaveBeenCalledWith(0);
  });

  it("reports the parked Time minute to onPointer", () => {
    const model = buildPlantChartModel(
      {
        ...energySnapshot,
        curve: [
          {
            name: loggerA,
            points: [{ at: "2026-08-21T12:00:00", watts: 100, lifetime_kwh: 10 }],
          },
        ],
      },
      "time",
      "overlay",
      new Set(["Plant", loggerA]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    const onPointer = vi.fn();
    render(
      <PlantChart
        model={model}
        mode="overlay"
        onPointer={onPointer}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Power curve" })).toBeTruthy();
    expect(onPointer).toHaveBeenCalledWith(12 * 60);
    fireEvent.pointerDown(screen.getByRole("img", { name: "Power curve" }), {
      clientX: 0,
      clientY: 10,
    });
    expect(onPointer).toHaveBeenCalled();
  });

  it("keeps the Time hair at the clicked minute after the parent rebuilds the model", () => {
    const snapshot: PlantSnapshot = {
      ...energySnapshot,
      curve: [
        {
          name: loggerA,
          points: [{ at: "2026-08-21T12:00:00", watts: 100, lifetime_kwh: 10 }],
        },
      ],
    };
    const onPointer = vi.fn();
    function Harness() {
      const [, setPointer] = useState<number | null>(null);
      const model = buildPlantChartModel(
        snapshot,
        "time",
        "overlay",
        new Set(["Plant", loggerA]),
      );
      if (model.kind !== "time") {
        throw new Error("expected time model");
      }
      return (
        <PlantChart
          model={model}
          mode="overlay"
          onPointer={(value) => {
            onPointer(value);
            setPointer(value);
          }}
          onBarNavigate={vi.fn()}
          onDrawError={vi.fn()}
        />
      );
    }
    render(<Harness />);
    const canvas = screen.getByRole("img", { name: "Power curve" });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 40,
      right: 120,
      width: 120,
      height: 40,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 10, pointerId: 1, buttons: 1 });
    expect(onPointer).toHaveBeenLastCalledWith(11 * 60);
  });

  it("moves the hair with arrow keys", () => {
    const model = buildPlantChartModel(
      {
        ...energySnapshot,
        curve: [
          {
            name: loggerA,
            points: [{ at: "2026-08-21T12:00:00", watts: 100, lifetime_kwh: 10 }],
          },
        ],
      },
      "time",
      "overlay",
      new Set(["Plant", loggerA]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    const onPointer = vi.fn();
    render(
      <PlantChart
        model={model}
        mode="overlay"
        onPointer={onPointer}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );
    const canvas = screen.getByRole("img", { name: "Power curve" });
    expect(canvas.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(onPointer).toHaveBeenCalledWith(12 * 60 + 1);
  });

  it("renders ideal envelope dataset with dashed line styling when present", () => {
    const model = buildPlantChartModel(
      {
        ...energySnapshot,
        curve: [
          {
            name: loggerA,
            points: [{ at: "2026-08-21T12:00:00", watts: 100, lifetime_kwh: 10 }],
          },
        ],
        ideal_curve: [{ at: "2026-08-21T12:00:00", watts: 1500 }],
      },
      "time",
      "overlay",
      new Set(["Plant", loggerA]),
      true,
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    render(
      <PlantChart
        model={model}
        mode="overlay"
        onPointer={vi.fn()}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );
    const chart = chartState.instances.at(-1)?.config as {
      data?: { datasets?: Array<{ label?: string; borderDash?: number[] }> };
    };
    const ideal = chart?.data?.datasets?.find((d) => d.label === "Ideal envelope");
    expect(ideal).toBeDefined();
    expect(ideal?.borderDash).toEqual([6, 4]);
  });

  it("renders previous year comparison dataset with hairline bar styling in day grain", () => {
    const model = buildPlantChartModel(
      {
        ...energySnapshot,
        local_day_bars: [
          { local_day: "2026-08-21", today_energy_kwh: 3.9, prev_year_today_energy_kwh: 3.2 },
          { local_day: "2026-08-22", today_energy_kwh: 0.2, prev_year_today_energy_kwh: 0.1 },
        ],
      },
      "day",
      "overlay",
      new Set(["Plant"]),
    );
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    render(
      <PlantChart
        model={model}
        mode="overlay"
        onPointer={vi.fn()}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );
    const chart = chartState.instances.at(-1)?.config as {
      data?: { datasets?: Array<{ label?: string; stack?: string; barPercentage?: number }> };
    };
    const comparison = chart?.data?.datasets?.find((d) => d.label === "Previous year");
    expect(comparison).toBeDefined();
    expect(comparison?.stack).toBe("comparison");
    expect(comparison?.barPercentage).toBe(0.3);
  });

  it("locks the vertical bar at user chosen pointer when model updates", () => {
    const model1 = buildPlantChartModel(
      {
        ...energySnapshot,
        curve: [
          {
            name: loggerA,
            points: [{ at: "2026-08-21T10:00:00", watts: 100, lifetime_kwh: 10 }],
          },
        ],
      },
      "time",
      "overlay",
      new Set(["Plant", loggerA]),
    );
    if (model1.kind !== "time") return;

    const onPointer = vi.fn();
    const { rerender } = render(
      <PlantChart
        model={model1}
        mode="overlay"
        pointer={10 * 60}
        onPointer={onPointer}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );

    // Live update arrives with later sample
    const model2 = buildPlantChartModel(
      {
        ...energySnapshot,
        curve: [
          {
            name: loggerA,
            points: [
              { at: "2026-08-21T10:00:00", watts: 100, lifetime_kwh: 10 },
              { at: "2026-08-21T12:00:00", watts: 500, lifetime_kwh: 10.5 },
            ],
          },
        ],
      },
      "time",
      "overlay",
      new Set(["Plant", loggerA]),
    );
    if (model2.kind !== "time") return;

    rerender(
      <PlantChart
        model={model2}
        mode="overlay"
        pointer={10 * 60}
        onPointer={onPointer}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );

    // onPointer should NOT have been called with parkedMinute (12 * 60)
    expect(onPointer).not.toHaveBeenCalledWith(12 * 60);
  });

  it("draws the dot on the highest visible production curve, ignoring ideal envelope", () => {
    const model = buildPlantChartModel(
      {
        ...energySnapshot,
        ideal_curve: [{ at: "2026-08-21T11:00:00", watts: 999 }],
        curve: [
          {
            name: loggerA,
            points: [{ at: "2026-08-21T11:00:00", watts: 200, lifetime_kwh: 10 }],
          },
          {
            name: loggerB,
            points: [{ at: "2026-08-21T11:00:00", watts: 500, lifetime_kwh: 5 }],
          },
        ],
      },
      "time",
      "overlay",
      new Set([loggerA, loggerB]),
      true,
    );
    if (model.kind !== "time") return;

    render(
      <PlantChart
        model={model}
        mode="overlay"
        pointer={11 * 60}
        onPointer={vi.fn()}
        onBarNavigate={vi.fn()}
        onDrawError={vi.fn()}
      />,
    );

    const instance = chartState.instances.at(-1);
    expect(instance).toBeDefined();
    const hairPlugin = instance?.config.plugins?.find((p: any) => p.id === "wattloft-hair");
    expect(hairPlugin).toBeDefined();

    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      globalAlpha: 1,
    };
    const mockChart = {
      ctx: mockCtx,
      scales: {
        x: { getPixelForValue: (v: number) => v },
        y: {
          top: 0,
          bottom: 300,
          getPixelForValue: vi.fn((v: number) => 300 - v),
        },
      },
    };

    hairPlugin.afterDraw(mockChart);

    // Highest production is loggerB (500W), NOT ideal (999W)
    expect(mockChart.scales.y.getPixelForValue).toHaveBeenCalledWith(500);
    expect(mockChart.scales.y.getPixelForValue).not.toHaveBeenCalledWith(999);
  });
});
