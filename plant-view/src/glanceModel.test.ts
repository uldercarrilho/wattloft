import { describe, expect, it } from "vitest";
import { computeClearSkyInstant, glanceModel } from "./glanceModel";
import type { LoggerNow } from "./types";

const EAST = "3909309465";
const WEST = "3913630013";
const NOW = new Date("2026-09-07T16:04:00.000Z");

function logger(
  name: string,
  display_name: string,
  last_success_at: string,
  power_w: number,
): LoggerNow {
  return { name, display_name, last_success_at, power_w };
}

function snapshot(parts: {
  current_power_w: number | null;
  today_energy_kwh?: number | null;
  lifetime_energy_kwh?: number;
  loggers_now?: LoggerNow[];
}) {
  return {
    today_energy_kwh: parts.today_energy_kwh ?? 3.9,
    current_power_w: parts.current_power_w,
    lifetime_energy_kwh: parts.lifetime_energy_kwh ?? 5635.4,
    loggers_now: parts.loggers_now,
  };
}

describe("glanceModel", () => {
  it("sums reporting Logger watts even when Current Power is one Sample", () => {
    const view = glanceModel(
      snapshot({
        current_power_w: 210,
        loggers_now: [
          logger(EAST, "East", "2026-09-07T16:03:00.000Z", 210),
          logger(WEST, "West", "2026-09-07T16:03:00.000Z", 202),
        ],
      }),
      NOW,
    );
    expect(view.wattsLabel).toBe("412 W");
    expect(view.banner).toBeNull();
    expect(
      view.loggers.map((row) => [row.displayName, row.reporting, row.wattsLabel, row.ageLabel]),
    ).toEqual([
      ["East", true, "210 W", "1 minute ago"],
      ["West", true, "202 W", "1 minute ago"],
    ]);
    expect(view.todayLabel).toBe("3.90 kWh");
    expect(view.lifetimeLabel).toBe("5,635.40 kWh");
  });

  it("banners a stale Logger while a sibling still produces", () => {
    const view = glanceModel(
      snapshot({
        current_power_w: 210,
        loggers_now: [
          logger(EAST, "East", "2026-09-07T16:03:00.000Z", 210),
          logger(WEST, "West", "2026-09-07T15:23:00.000Z", 0),
        ],
      }),
      NOW,
    );
    expect(view.banner).toBe("West silent · last Sample 41 minutes ago");
    expect(view.loggers.find((row) => row.name === WEST)?.reporting).toBe(false);
    expect(view.loggers.find((row) => row.name === EAST)?.reporting).toBe(true);
    expect(view.loggers.find((row) => row.name === WEST)?.wattsLabel).toBe("last 0 W");
    expect(view.wattsLabel).toBe("210 W");
  });

  it("does not banner a fresh 0 W Logger while a sibling produces", () => {
    const view = glanceModel(
      snapshot({
        current_power_w: 210,
        loggers_now: [
          logger(EAST, "East", "2026-09-07T16:03:00.000Z", 210),
          logger(WEST, "West", "2026-09-07T16:03:00.000Z", 0),
        ],
      }),
      NOW,
    );
    expect(view.banner).toBeNull();
    expect(view.loggers.every((row) => row.reporting)).toBe(true);
    expect(view.wattsLabel).toBe("210 W");
    expect(view.loggers.find((row) => row.name === WEST)?.wattsLabel).toBe("0 W");
  });

  it("shows 0 W and no banner when every Logger is reporting night zero", () => {
    const view = glanceModel(
      snapshot({
        current_power_w: 0,
        today_energy_kwh: 18.2,
        loggers_now: [
          logger(EAST, "East", "2026-09-07T16:03:00.000Z", 0),
          logger(WEST, "West", "2026-09-07T16:03:00.000Z", 0),
        ],
      }),
      NOW,
    );
    expect(view.banner).toBeNull();
    expect(view.wattsLabel).toBe("0 W");
    expect(view.loggers.every((row) => row.reporting)).toBe(true);
  });

  it("does not banner when every Logger is stale", () => {
    const view = glanceModel(
      snapshot({
        current_power_w: 50,
        loggers_now: [
          logger(EAST, "East", "2026-09-07T14:00:00.000Z", 50),
          logger(WEST, "West", "2026-09-07T14:00:00.000Z", 40),
        ],
      }),
      NOW,
    );
    expect(view.banner).toBeNull();
    expect(view.loggers.every((row) => row.reporting)).toBe(false);
    expect(view.wattsLabel).toBe("—");
    expect(view.loggers.map((row) => row.wattsLabel)).toEqual(["last 50 W", "last 40 W"]);
  });

  it("does not invent a stall when loggers_now is missing", () => {
    const view = glanceModel(snapshot({ current_power_w: 412 }), NOW);
    expect(view.loggers).toEqual([]);
    expect(view.banner).toBeNull();
    expect(view.wattsLabel).toBe("412 W");
  });

  it("dashes Plant now when Current Power is absent and loggers_now is empty", () => {
    const view = glanceModel(snapshot({ current_power_w: null, loggers_now: [] }), NOW);
    expect(view.wattsLabel).toBe("—");
    expect(view.loggers).toEqual([]);
    expect(view.banner).toBeNull();
  });

  it("populates drift advisory on affected logger when drift is detected", () => {
    const view = glanceModel(
      {
        ...snapshot({
          current_power_w: 210,
          loggers_now: [
            logger(EAST, "East", "2026-09-07T16:03:00.000Z", 150),
            logger(WEST, "West", "2026-09-07T16:03:00.000Z", 200),
          ],
        }),
        drift: {
          detected: true,
          advisory: "East array underperforming relative to West by 14% (check for soiling or obstruction)",
          affected_logger: EAST,
          drift_pct: 14,
        },
      },
      NOW,
    );
    expect(view.loggers.find((l) => l.name === EAST)?.driftAdvisory).toBe(
      "East array underperforming relative to West by 14% (check for soiling or obstruction)",
    );
    expect(view.loggers.find((l) => l.name === WEST)?.driftAdvisory).toBeNull();
  });

  describe("computeClearSkyInstant", () => {
    const idealCurve = [
      { at: "2026-09-07T06:30:00", watts: 400 },
      { at: "2026-09-07T11:30:00", watts: 3840 },
      { at: "2026-09-07T12:00:00", watts: 4000 },
      { at: "2026-09-07T17:30:00", watts: 350 },
    ];

    it("returns null when current watts is null or idealCurve is missing", () => {
      expect(computeClearSkyInstant(null, "2026-09-07T14:30:00Z", idealCurve)).toBeNull();
      expect(computeClearSkyInstant(3000, undefined, idealCurve)).toBeNull();
      expect(computeClearSkyInstant(3000, "2026-09-07T14:30:00Z", undefined)).toBeNull();
      expect(computeClearSkyInstant(3000, "2026-09-07T14:30:00Z", [])).toBeNull();
    });

    it("computes optimal condition and percentage with kW ideal label", () => {
      // 14:30 UTC = 11:30 America/Sao_Paulo -> matches 11:30:00 (watts: 3840)
      const res = computeClearSkyInstant(3420, "2026-09-07T14:30:00Z", idealCurve);
      expect(res).not.toBeNull();
      expect(res?.efficiencyPct).toBe(89);
      expect(res?.barWidthPct).toBe(89);
      expect(res?.idealWatts).toBe(3840);
      expect(res?.idealLabel).toBe("3.8 kW ideal");
      expect(res?.condition).toBe("optimal");
    });

    it("computes reduced condition for 50-79% efficiency", () => {
      const res = computeClearSkyInstant(2300, "2026-09-07T14:30:00Z", idealCurve);
      expect(res).not.toBeNull();
      expect(res?.efficiencyPct).toBe(60);
      expect(res?.barWidthPct).toBe(60);
      expect(res?.condition).toBe("reduced");
    });

    it("computes overcast condition for <50% efficiency and formats sub-kW labels in W", () => {
      // 09:30 UTC = 06:30 Sao Paulo -> matches 06:30:00 (watts: 400)
      const res = computeClearSkyInstant(100, "2026-09-07T09:30:00Z", idealCurve);
      expect(res).not.toBeNull();
      expect(res?.efficiencyPct).toBe(25);
      expect(res?.barWidthPct).toBe(25);
      expect(res?.idealLabel).toBe("400 W ideal");
      expect(res?.condition).toBe("overcast");
    });

    it("caps barWidthPct at 100 while preserving real percentage above 100%", () => {
      const res = computeClearSkyInstant(4200, "2026-09-07T14:30:00Z", idealCurve);
      expect(res).not.toBeNull();
      expect(res?.efficiencyPct).toBe(109);
      expect(res?.barWidthPct).toBe(100);
      expect(res?.condition).toBe("optimal");
    });

    it("returns null at night or when timestamp is far from daylight points", () => {
      // 03:00 UTC = 00:00 midnight Sao Paulo
      const res = computeClearSkyInstant(0, "2026-09-07T03:00:00Z", idealCurve);
      expect(res).toBeNull();
    });

    it("integrates clearSky inside glanceModel output when ideal_curve is provided", () => {
      const view = glanceModel(
        {
          ...snapshot({ current_power_w: 3420 }),
          current_power_at: "2026-09-07T14:30:00Z",
          ideal_curve: idealCurve,
        },
        NOW,
      );
      expect(view.clearSky).not.toBeNull();
      expect(view.clearSky?.efficiencyPct).toBe(89);
      expect(view.clearSky?.idealLabel).toBe("3.8 kW ideal");
    });
  });
});
