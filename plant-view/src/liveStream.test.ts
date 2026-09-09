import { describe, expect, it } from "vitest";
import { applySample, formatTimeOfDay, localMinute } from "./liveStream";
import type { PlantPayload } from "./types";

describe("liveStream", () => {
  const baseState: Extract<PlantPayload, { empty: false }> = {
    empty: false,
    unit: "time",
    selected_day: "2026-09-09",
    today_energy_kwh: 3.5,
    current_power_w: 400,
    lifetime_energy_kwh: 5000,
    current_power_at: "2026-09-09T14:10:00-03:00",
    local_day_bars: [],
    loggers_now: [
      {
        name: "3909309465",
        display_name: "East",
        last_success_at: "2026-09-09T14:10:00-03:00",
        power_w: 400,
      },
      {
        name: "3913630013",
        display_name: "West",
        last_success_at: "2026-09-09T14:20:00-03:00",
        power_w: 300,
      },
    ],
    curve: [
      {
        name: "3909309465",
        points: [{ at: "2026-09-09T14:10:00-03:00", watts: 400 }],
      },
      {
        name: "Plant",
        points: [{ at: "2026-09-09T14:10:00-03:00", watts: 700 }],
      },
    ],
  };

  it("formats time of day in America/Sao_Paulo (HH:mm)", () => {
    expect(formatTimeOfDay("2026-09-09T14:32:00-03:00")).toBe("14:32");
    expect(formatTimeOfDay("2026-09-09T17:32:00Z")).toBe("14:32");
  });

  it("calculates local minute string", () => {
    expect(localMinute("2026-09-09T14:32:45-03:00")).toBe("2026-09-09T14:32:00");
  });

  it("applies sample updating Current Power, current_power_at, and loggers_now", () => {
    const updated = applySample(baseState, {
      type: "sample",
      logger_serial: "3909309465",
      received_at: "2026-09-09T14:32:00-03:00",
      ac_power_w: 450,
      today_energy_kwh: 3.8,
      lifetime_energy_kwh: 5001,
    });

    expect(updated.current_power_at).toBe("2026-09-09T14:32:00-03:00");
    // East = 450, West = 300 (fresh <= 15m) -> 750 W
    expect(updated.current_power_w).toBe(750);

    const east = updated.loggers_now?.find((l) => l.name === "3909309465");
    expect(east?.power_w).toBe(450);
    expect(east?.last_success_at).toBe("2026-09-09T14:32:00-03:00");

    // Curve point appended for new minute
    const eastCurve = updated.curve.find((c) => c.name === "3909309465");
    expect(eastCurve?.points).toHaveLength(2);
    expect(eastCurve?.points[1]?.watts).toBe(450);
  });

  it("updates existing minute point if multiple samples arrive in the same minute", () => {
    const step1 = applySample(baseState, {
      type: "sample",
      logger_serial: "3909309465",
      received_at: "2026-09-09T14:32:10-03:00",
      ac_power_w: 450,
      today_energy_kwh: 3.8,
      lifetime_energy_kwh: 5001,
    });

    const step2 = applySample(step1, {
      type: "sample",
      logger_serial: "3909309465",
      received_at: "2026-09-09T14:32:45-03:00",
      ac_power_w: 460,
      today_energy_kwh: 3.8,
      lifetime_energy_kwh: 5001,
    });

    const eastCurve = step2.curve.find((c) => c.name === "3909309465");
    expect(eastCurve?.points).toHaveLength(2); // not 3
    expect(eastCurve?.points[1]?.watts).toBe(460);
  });
});
