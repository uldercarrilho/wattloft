import { describe, expect, it } from "vitest";
import { glanceModel } from "./glanceModel";
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
  it("sums closed Logger watts even when Current Power is one Sample", () => {
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
    expect(view.hollow).toBe(false);
    expect(view.banner).toBeNull();
    expect(view.rings.map((ring) => [ring.displayName, ring.closed, ring.wattsLabel])).toEqual([
      ["East", true, "210 W"],
      ["West", true, "202 W"],
    ]);
    expect(view.todayLabel).toBe("3.90 kWh");
    expect(view.lifetimeLabel).toBe("5,635.4 kWh");
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
    expect(view.rings.find((ring) => ring.name === WEST)?.closed).toBe(false);
    expect(view.rings.find((ring) => ring.name === EAST)?.closed).toBe(true);
    expect(view.hollow).toBe(false);
    expect(view.wattsLabel).toBe("210 W");
  });

  it("banners a fresh 0 W Logger while a sibling produces, with rings still closed", () => {
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
    expect(view.banner).toBe("West silent · last Sample 1 minute ago");
    expect(view.rings.every((ring) => ring.closed)).toBe(true);
    expect(view.hollow).toBe(false);
  });

  it("uses a hollow sun and no banner when every Logger is fresh and Current Power is 0 W", () => {
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
    expect(view.hollow).toBe(true);
    expect(view.banner).toBeNull();
    expect(view.wattsLabel).toBe("0 W");
    expect(view.rings.every((ring) => ring.closed)).toBe(true);
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
    expect(view.rings.every((ring) => ring.closed)).toBe(false);
    expect(view.hollow).toBe(true);
    expect(view.wattsLabel).toBe("—");
  });

  it("does not invent a stall when loggers_now is missing", () => {
    const view = glanceModel(snapshot({ current_power_w: 412 }), NOW);
    expect(view.rings).toEqual([]);
    expect(view.banner).toBeNull();
    expect(view.hollow).toBe(false);
    expect(view.wattsLabel).toBe("412 W");
  });

  it("dashes Current Power when it is absent and hollows the sun", () => {
    const view = glanceModel(snapshot({ current_power_w: null, loggers_now: [] }), NOW);
    expect(view.wattsLabel).toBe("—");
    expect(view.hollow).toBe(true);
    expect(view.banner).toBeNull();
  });
});
