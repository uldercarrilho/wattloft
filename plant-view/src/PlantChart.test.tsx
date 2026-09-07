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

const loggerA = "3909309465";

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

  it("navigates with the model's href when a Day column is clicked", () => {
    const model = buildPlantChartModel(energySnapshot, "day", "overlay", new Set(["Plant"]));
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    const onBarNavigate = vi.fn();
    render(
      <PlantChart
        model={model}
        mode="overlay"
        onPointer={vi.fn()}
        onBarNavigate={onBarNavigate}
        onDrawError={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Energy bars" })).toBeTruthy();
    const onClick = chartState.instances[0]?.config.options?.onClick;
    expect(onClick).toBeTypeOf("function");
    onClick?.({}, [{ index: 0 }]);
    expect(onBarNavigate).toHaveBeenCalledWith("/?day=2026-08-21&unit=time");
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
});
