import { describe, expect, it } from "vitest";
import { buildPlantChartModel } from "./plantChartModel";
import type { PlantSnapshot } from "./types";

const loggerA = "1000000001";
const loggerB = "1000000003";

function snapshot(curve: PlantSnapshot["curve"]): PlantSnapshot {
  return {
    selected_day: "2026-08-21",
    today_energy_kwh: 0.2,
    current_power_w: 50,
    lifetime_energy_kwh: 5635.4,
    current_power_at: "2026-08-22T13:00:00+00:00",
    local_day_bars: [{ local_day: "2026-08-21", today_energy_kwh: 3.9 }],
    curve,
  };
}

describe("buildPlantChartModel Time Overlay", () => {
  it("samples Plant as the sum of Logger curve watts", () => {
    const model = buildPlantChartModel(
      snapshot([
        {
          name: loggerA,
          points: [
            { at: "2026-08-21T01:40:00", watts: 100, lifetime_kwh: 10 },
            { at: "2026-08-21T01:50:00", watts: 200, lifetime_kwh: 10.1 },
          ],
        },
        {
          name: loggerB,
          points: [
            { at: "2026-08-21T01:40:00", watts: 50, lifetime_kwh: 4 },
            { at: "2026-08-21T01:50:00", watts: 50, lifetime_kwh: 4.05 },
          ],
        },
        { name: "Plant", points: [{ at: "2026-08-21T01:40:00", watts: 999 }] },
      ]),
      "time",
      "overlay",
      new Set(["Plant", loggerA, loggerB]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    const at105 = model.minutes.indexOf(105);
    expect(at105).toBeGreaterThanOrEqual(0);
    const plant = model.datasets.find((d) => d.name === "Plant");
    const a = model.datasets.find((d) => d.name === loggerA);
    const b = model.datasets.find((d) => d.name === loggerB);
    expect(a?.role).toBe("logger");
    expect(a?.stacked).toBe(false);
    expect(a?.values[at105]).toBe(150);
    expect(b?.values[at105]).toBe(50);
    expect(plant?.role).toBe("plant");
    expect(plant?.stacked).toBe(false);
    expect(plant?.values[at105]).toBe(200);
  });

  it("nulls a Lifetime-barely-moved gap on that Logger and omits it from Plant", () => {
    const model = buildPlantChartModel(
      snapshot([
        {
          name: loggerA,
          points: [
            { at: "2026-08-21T01:40:00", watts: 100, lifetime_kwh: 10 },
            { at: "2026-08-21T02:00:00", watts: 80, lifetime_kwh: 10.01 },
          ],
        },
        {
          name: loggerB,
          points: [
            { at: "2026-08-21T01:40:00", watts: 50, lifetime_kwh: 4 },
            { at: "2026-08-21T02:00:00", watts: 50, lifetime_kwh: 4.2 },
          ],
        },
      ]),
      "time",
      "overlay",
      new Set(["Plant", loggerA, loggerB]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    const at110 = model.minutes.indexOf(110);
    const plant = model.datasets.find((d) => d.name === "Plant");
    const a = model.datasets.find((d) => d.name === loggerA);
    const b = model.datasets.find((d) => d.name === loggerB);
    expect(a?.values[at110]).toBeNull();
    expect(b?.values[at110]).toBe(50);
    expect(plant?.values[at110]).toBe(50);
  });

  it("hides a Logger dataset but keeps Plant including that Logger", () => {
    const model = buildPlantChartModel(
      snapshot([
        {
          name: loggerA,
          points: [
            { at: "2026-08-21T01:40:00", watts: 100, lifetime_kwh: 10 },
            { at: "2026-08-21T01:50:00", watts: 200, lifetime_kwh: 10.1 },
          ],
        },
        {
          name: loggerB,
          points: [
            { at: "2026-08-21T01:40:00", watts: 50, lifetime_kwh: 4 },
            { at: "2026-08-21T01:50:00", watts: 50, lifetime_kwh: 4.05 },
          ],
        },
      ]),
      "time",
      "overlay",
      new Set(["Plant", loggerB]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    expect(model.datasets.map((d) => d.name)).toEqual([loggerB, "Plant"]);
    const at105 = model.minutes.indexOf(105);
    expect(model.datasets.find((d) => d.name === "Plant")?.values[at105]).toBe(200);
  });

  it("returns empty-time when the curve has no Samples", () => {
    const model = buildPlantChartModel(snapshot([]), "time", "overlay", new Set(["Plant"]));
    expect(model).toEqual({ kind: "empty-time" });
  });
});
