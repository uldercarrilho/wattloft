import { describe, expect, it } from "vitest";
import { buildPlantChartModel, energyReadout, hourTickLabel, niceYMax, parkedMinute, timeReadout, type ChartDataset, type TimeChartModel } from "./plantChartModel";
import type { PlantSnapshot } from "./types";

const loggerA = "3909309465";
const loggerB = "3909310155";

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

describe("buildPlantChartModel Time Stack", () => {
  it("has no Plant dataset and stacks visible Loggers", () => {
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
      "stack",
      new Set([loggerA, loggerB]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    expect(model.datasets.map((d) => d.name)).toEqual([loggerA, loggerB]);
    expect(model.datasets.every((d) => d.stacked && d.role === "logger")).toBe(true);
    const at105 = model.minutes.indexOf(105);
    expect(model.datasets[0]?.values[at105]).toBe(150);
    expect(model.datasets[1]?.values[at105]).toBe(50);
    expect(model.yMax).toBe(250);
  });

  it("omits a hidden Logger and a null minute instead of a 0 slab", () => {
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
      "stack",
      new Set([loggerB]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    expect(model.datasets.map((d) => d.name)).toEqual([loggerB]);
    const at110 = model.minutes.indexOf(110);
    expect(model.datasets[0]?.values[at110]).toBe(50);
    const both = buildPlantChartModel(
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
      "stack",
      new Set([loggerA, loggerB]),
    );
    expect(both.kind).toBe("time");
    if (both.kind !== "time") return;
    expect(both.datasets.find((d) => d.name === loggerA)?.values[at110]).toBeNull();
    expect(both.datasets.find((d) => d.name === loggerB)?.values[at110]).toBe(50);
  });

  it("returns empty datasets when every Logger is hidden", () => {
    const model = buildPlantChartModel(
      snapshot([
        {
          name: loggerA,
          points: [{ at: "2026-08-21T15:00:00", watts: 100, lifetime_kwh: 10 }],
        },
      ]),
      "time",
      "stack",
      new Set(),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    expect(model.datasets).toEqual([]);
    expect(model.yMax).toBe(1);
  });
});

const energySnapshot: PlantSnapshot = {
  selected_day: "2026-08-21",
  today_energy_kwh: 0.2,
  current_power_w: 50,
  lifetime_energy_kwh: 5635.4,
  current_power_at: "2026-08-22T13:00:00+00:00",
  local_day_bars: [
    {
      local_day: "2026-08-21",
      today_energy_kwh: 3.9,
      loggers: [
        { name: loggerA, today_energy_kwh: 2.1 },
        { name: loggerB, today_energy_kwh: 1.8 },
      ],
    },
    {
      local_day: "2026-08-22",
      today_energy_kwh: 0.2,
      loggers: [{ name: loggerA, today_energy_kwh: 0.2 }],
    },
    {
      local_day: "2026-09-01",
      today_energy_kwh: 0.2,
      loggers: [{ name: loggerA, today_energy_kwh: 0.2 }],
    },
  ],
  curve: [],
};

describe("buildPlantChartModel energy Overlay", () => {
  it("maps Day to one Plant series with hrefs and the selected day current", () => {
    const model = buildPlantChartModel(
      energySnapshot,
      "day",
      "overlay",
      new Set(["Plant"]),
    );
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    expect(model.tickLabels).toEqual(["Fri 21", "Sat 22"]);
    expect(model.readoutLabels).toEqual(["21 Aug 3.90 kWh", "22 Aug 0.20 kWh"]);
    expect(model.hrefs).toEqual(["/?day=2026-08-21&unit=time", "/?day=2026-08-22&unit=time"]);
    expect(model.currentIndex).toBe(0);
    expect(model.yMax).toBe(5);
    expect(model.yUnit).toBe("kWh");
    expect(model.partial).toEqual([false, true]);
    expect(model.datasets).toEqual([
      { name: "Plant", role: "plant", stacked: false, swatch: "pigment", values: [3.9, 0.2] },
    ]);
  });

  it("keeps Month and Year drill hrefs from grains", () => {
    const month = buildPlantChartModel(energySnapshot, "month", "overlay", new Set(["Plant"]));
    expect(month.kind).toBe("energy");
    if (month.kind !== "energy") return;
    expect(month.tickLabels).toEqual(["Aug", "Sep"]);
    expect(month.readoutLabels).toEqual(["August 4.10 kWh", "September 0.20 kWh"]);
    expect(month.hrefs).toEqual(["/?day=2026-08-21&unit=day", "/?day=2026-09-01&unit=day"]);
    expect(month.currentIndex).toBe(0);
    const year = buildPlantChartModel(energySnapshot, "year", "overlay", new Set(["Plant"]));
    expect(year.kind).toBe("energy");
    if (year.kind !== "energy") return;
    expect(year.tickLabels).toEqual(["2026"]);
    expect(year.hrefs).toEqual(["/?day=2026-08-21&unit=month"]);
    expect(year.currentIndex).toBe(0);
  });
});

describe("buildPlantChartModel energy Stack", () => {
  it("splits Day columns by visible Loggers and nulls a missing slice", () => {
    const model = buildPlantChartModel(
      energySnapshot,
      "day",
      "stack",
      new Set([loggerA, loggerB]),
    );
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    expect(model.datasets.map((d) => d.name)).toEqual([loggerA, loggerB]);
    expect(model.datasets.every((d) => d.stacked && d.role === "logger")).toBe(true);
    expect(model.datasets[0]?.values).toEqual([2.1, 0.2]);
    expect(model.datasets[1]?.values).toEqual([1.8, null]);
    expect(model.yMax).toBe(5);
  });

  it("uses visible totals for yMax and a Plant column when loggers are missing", () => {
    const hidden = buildPlantChartModel(energySnapshot, "day", "stack", new Set([loggerA]));
    expect(hidden.kind).toBe("energy");
    if (hidden.kind !== "energy") return;
    expect(hidden.datasets.map((d) => d.name)).toEqual([loggerA]);
    expect(hidden.datasets[0]?.values).toEqual([2.1, 0.2]);
    expect(hidden.yMax).toBe(2.5);
    expect(hidden.readoutLabels[0]).toBe("21 Aug 2.10 kWh");
    const bare = snapshot([]);
    const missing = buildPlantChartModel(
      {
        ...bare,
        local_day_bars: [
          { local_day: "2026-08-21", today_energy_kwh: 3.9 },
          { local_day: "2026-08-22", today_energy_kwh: 0.2 },
        ],
      },
      "day",
      "stack",
      new Set([loggerA]),
    );
    expect(missing.kind).toBe("energy");
    if (missing.kind !== "energy") return;
    expect(missing.datasets).toEqual([
      { name: "Plant", role: "plant", stacked: false, swatch: "pigment", values: [3.9, 0.2] },
    ]);
  });
});

describe("parkedMinute", () => {
  it("parks on the last minute with curve watts, not a trailing hole", () => {
    const model = buildPlantChartModel(
      snapshot([
        {
          name: loggerA,
          points: [{ at: "2026-08-21T10:00:00", watts: 400, lifetime_kwh: 1 }],
        },
      ]),
      "time",
      "overlay",
      new Set(["Plant", loggerA]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    expect(model.minutes.at(-1)!).toBeGreaterThan(10 * 60);
    expect(parkedMinute(model)).toBe(10 * 60);
    const readout = timeReadout(model, parkedMinute(model), "overlay");
    expect(readout.when).toBe("10:00");
    expect(readout.rows.find((row) => row.name === loggerA)?.text).toBe("400 W");
  });

  it("labels a scrubbed hole as gap", () => {
    const model = buildPlantChartModel(
      snapshot([
        {
          name: loggerA,
          points: [{ at: "2026-08-21T10:00:00", watts: 400, lifetime_kwh: 1 }],
        },
      ]),
      "time",
      "overlay",
      new Set(["Plant", loggerA]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    const hole = model.minutes.at(-1)!;
    expect(hole).not.toBe(10 * 60);
    const readout = timeReadout(model, hole, "overlay");
    expect(readout.when.endsWith(" gap")).toBe(true);
    expect(readout.rows.every((row) => row.text === "—")).toBe(true);
  });
});

describe("timeReadout", () => {
  it("formats noon and dashes an omitted Logger", () => {
    const model = buildPlantChartModel(
      snapshot([
        {
          name: loggerA,
          points: [
            { at: "2026-08-21T11:40:00", watts: 100, lifetime_kwh: 10 },
            { at: "2026-08-21T12:20:00", watts: 80, lifetime_kwh: 10.01 },
          ],
        },
        {
          name: loggerB,
          points: [
            { at: "2026-08-21T11:40:00", watts: 50, lifetime_kwh: 4 },
            { at: "2026-08-21T12:20:00", watts: 50, lifetime_kwh: 4.2 },
          ],
        },
      ]),
      "time",
      "overlay",
      new Set(["Plant", loggerA, loggerB]),
    );
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    const readout = timeReadout(model, 12 * 60, "overlay");
    expect(readout.when).toBe("12:00");
    expect(readout.rows.find((row) => row.name === loggerA)?.text).toBe("—");
    expect(readout.rows.find((row) => row.name === loggerB)?.text).toBe("50 W");
    expect(readout.rows.find((row) => row.name === "Plant")?.text).toBe("50 W");
  });

  it("keeps Overlay Plant as all Loggers and Stack Plant as visible only", () => {
    const curve = [
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
    ];
    const overlay = buildPlantChartModel(
      snapshot(curve),
      "time",
      "overlay",
      new Set(["Plant", loggerB]),
    );
    expect(overlay.kind).toBe("time");
    if (overlay.kind !== "time") return;
    const overlayReadout = timeReadout(overlay, 105, "overlay");
    expect(overlayReadout.rows.find((row) => row.name === "Plant")?.text).toBe("200 W");
    expect(overlayReadout.rows.find((row) => row.name === loggerA)).toBeUndefined();
    const stacked = buildPlantChartModel(snapshot(curve), "time", "stack", new Set([loggerB]));
    expect(stacked.kind).toBe("time");
    if (stacked.kind !== "time") return;
    const stackReadout = timeReadout(stacked, 105, "stack");
    expect(stackReadout.rows.find((row) => row.name === "Plant")?.text).toBe("50 W");
    expect(stackReadout.rows.find((row) => row.name === loggerB)?.text).toBe("50 W");
  });
});

describe("parkedMinute", () => {
  function series(
    name: string,
    role: ChartDataset["role"],
    values: (number | null)[],
  ): ChartDataset {
    return {
      name,
      role,
      stacked: role === "logger",
      swatch: role === "plant" ? "plant" : "logger-a",
      values,
    };
  }

  function model(datasets: ChartDataset[]): TimeChartModel {
    return {
      kind: "time",
      minutes: [100, 110, 120],
      tickHours: [],
      yMax: 1000,
      yUnit: "W",
      datasets,
    };
  }

  it("parks on the last Plant minute, or any Logger when Plant is absent", () => {
    const plant = series("Plant", "plant", [10, 20, null]);
    const logger = series(loggerA, "logger", [10, 20, 30]);
    expect(parkedMinute(model([plant, logger]))).toBe(110);
    expect(parkedMinute(model([logger]))).toBe(120);
  });

  it("ignores ideal envelope and parks on actual production", () => {
    const logger = series(loggerA, "logger", [10, 20, null]);
    const ideal = series("Ideal envelope", "ideal", [10, 20, 30]);
    expect(parkedMinute(model([logger, ideal]))).toBe(110);
  });
});

describe("timeReadout hold", () => {
  it("keeps a Logger watt as est. when the hair is inside a short gap", () => {
    const chart: TimeChartModel = {
      kind: "time",
      minutes: [0, 5, 10, 20],
      tickHours: [],
      yMax: 1000,
      yUnit: "W",
      datasets: [
        {
          name: loggerA,
          role: "logger",
          stacked: false,
          swatch: "logger-a",
          values: [754, null, null, null],
        },
      ],
    };
    expect(timeReadout(chart, 10, "overlay").rows[0]?.text).toBe("est. 754 W");
    expect(timeReadout(chart, 20, "overlay").rows[0]?.text).toBe("—");
  });
});

describe("energyReadout", () => {
  it("uses the period label and Stack per-Logger kWh", () => {
    const overlay = buildPlantChartModel(energySnapshot, "day", "overlay", new Set(["Plant"]));
    expect(overlay.kind).toBe("energy");
    if (overlay.kind !== "energy") return;
    expect(energyReadout(overlay, 0)).toEqual({
      when: "21 Aug 3.90 kWh",
      rows: [{ name: "Plant", text: "3.90 kWh" }],
    });
    const stacked = buildPlantChartModel(
      energySnapshot,
      "day",
      "stack",
      new Set([loggerA, loggerB]),
    );
    expect(stacked.kind).toBe("energy");
    if (stacked.kind !== "energy") return;
    expect(energyReadout(stacked, 0)).toEqual({
      when: "21 Aug 3.90 kWh",
      rows: [
        { name: "Plant", text: "3.90 kWh" },
        { name: loggerA, text: "2.10 kWh" },
        { name: loggerB, text: "1.80 kWh" },
      ],
    });
    expect(energyReadout(stacked, 1).rows.find((row) => row.name === loggerB)?.text).toBe("—");
  });
});

describe("niceYMax and hour ticks", () => {
  it("rounds peaks onto a 1-2-2.5-5-10 ladder", () => {
    expect(niceYMax(0)).toBe(1);
    expect(niceYMax(1)).toBe(1);
    expect(niceYMax(3.9)).toBe(5);
    expect(niceYMax(250)).toBe(250);
    expect(niceYMax(2168)).toBe(2500);
  });

  it("labels whole hours as HH:00", () => {
    expect(hourTickLabel(12 * 60)).toBe("12:00");
    expect(hourTickLabel(12 * 60 + 1)).toBe("");
  });
});

describe("Ideal Envelope Model", () => {
  const idealCurve = [
    { at: "2026-08-21T06:00:00-03:00", watts: 100 },
    { at: "2026-08-21T12:00:00-03:00", watts: 1800 },
    { at: "2026-08-21T18:00:00-03:00", watts: 50 },
  ];
  const snapWithIdeal = {
    ...snapshot([
      {
        name: loggerA,
        points: [{ at: "2026-08-21T12:00:00-03:00", watts: 900, lifetime_kwh: 10 }],
      },
    ]),
    ideal_curve: idealCurve,
  };

  it("omits ideal envelope when toggled off", () => {
    const model = buildPlantChartModel(snapWithIdeal, "time", "overlay", new Set(["Plant"]), false);
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    expect(model.datasets.find((d) => d.role === "ideal")).toBeUndefined();
  });

  it("includes ideal envelope dataset when toggled on", () => {
    const model = buildPlantChartModel(snapWithIdeal, "time", "overlay", new Set(["Plant"]), true);
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    const ideal = model.datasets.find((d) => d.role === "ideal");
    expect(ideal).toBeDefined();
    expect(ideal?.role).toBe("ideal");
    expect(ideal?.swatch).toBe("muted");
    expect(ideal?.name).toBe("Ideal envelope");
    expect(model.yMax).toBe(2000);
  });

  it("does not stack ideal envelope in stack mode", () => {
    const model = buildPlantChartModel(snapWithIdeal, "time", "stack", new Set([loggerA]), true);
    expect(model.kind).toBe("time");
    if (model.kind !== "time") return;
    const ideal = model.datasets.find((d) => d.role === "ideal");
    expect(ideal).toBeDefined();
    expect(ideal?.stacked).toBe(false);
  });
});

describe("Clipping & Throttle Detection", () => {
  it("annotates readout when scrubbed minute is inside a clipping plateau", () => {
    const model: TimeChartModel = {
      kind: "time",
      minutes: [12 * 60 + 40, 12 * 60 + 45, 12 * 60 + 50],
      tickHours: [],
      yMax: 1000,
      yUnit: "W",
      datasets: [
        {
          name: "Plant",
          role: "plant",
          stacked: false,
          swatch: "plant",
          values: [998, 998, 998],
        },
      ],
      clippingPlateaus: [
        {
          logger_serial: "Plant",
          start_minute: 12 * 60 + 40,
          end_minute: 12 * 60 + 50,
          start_at: "2026-08-21T12:40:00-03:00",
          end_at: "2026-08-21T12:50:00-03:00",
          plateau_watts: 998,
          estimated_clipped_kwh: 0.35,
        },
      ],
    };

    const readout = timeReadout(model, 12 * 60 + 45, "overlay");
    expect(readout.when).toBe("12:45");
    expect(readout.rows[0]?.text).toBe("998 W (clipped · est. 0.35 kWh lost today)");
  });
});

describe("Historical Period Comparison Overlays", () => {
  const comparisonSnapshot = {
    ...energySnapshot,
    local_day_bars: [
      {
        local_day: "2026-08-21",
        today_energy_kwh: 3.9,
        prev_year_today_energy_kwh: 3.2,
      },
      {
        local_day: "2026-08-22",
        today_energy_kwh: 4.1,
        prev_year_today_energy_kwh: 3.8,
      },
      {
        local_day: "2025-08-21",
        today_energy_kwh: 3.2,
      },
      {
        local_day: "2025-08-22",
        today_energy_kwh: 3.8,
      },
    ],
  };

  it("adds previous year comparison dataset for day grain", () => {
    const model = buildPlantChartModel(comparisonSnapshot, "day", "overlay", new Set(["Plant"]));
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    const comparison = model.datasets.find((d) => d.role === "comparison");
    expect(comparison).toBeDefined();
    expect(comparison?.name).toBe("Previous year");
    expect(comparison?.swatch).toBe("muted");
    expect(comparison?.values).toEqual([3.2, 3.8]);

    const readout = energyReadout(model, 0);
    expect(readout.rows).toEqual([
      { name: "Plant", text: "3.90 kWh" },
      { name: "Previous year", text: "3.20 kWh" },
    ]);
  });

  it("calculates YoY percentage delta for month grain", () => {
    const model = buildPlantChartModel(comparisonSnapshot, "month", "overlay", new Set(["Plant"]));
    expect(model.kind).toBe("energy");
    if (model.kind !== "energy") return;
    expect(model.readoutLabels[0]).toContain("vs 2025");
    expect(model.readoutLabels[0]).toContain("+14%");
  });
});
