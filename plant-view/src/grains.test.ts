import { describe, expect, it } from "vitest";
import {
  dayEnergyBars,
  formatKwh,
  formatWatts,
  monthEnergyBars,
  parseUnit,
  stepper,
  yearEnergyBars,
} from "./grains";
import type { PlantSnapshot } from "./types";

const snapshot: PlantSnapshot = {
  selected_day: "2026-08-21",
  today_energy_kwh: 0.2,
  current_power_w: 50,
  lifetime_energy_kwh: 5635.4,
  current_power_at: "2026-08-22T13:00:00+00:00",
  local_day_bars: [
    { local_day: "2026-08-21", today_energy_kwh: 3.9 },
    { local_day: "2026-08-22", today_energy_kwh: 0.2 },
    { local_day: "2026-09-01", today_energy_kwh: 0.2 },
  ],
  curve: [],
};

describe("grains", () => {
  it("formats energy and power the way Plant view did", () => {
    expect(formatKwh(3.9)).toBe("3.90 kWh");
    expect(formatKwh(0.2)).toBe("0.20 kWh");
    expect(formatWatts(50)).toBe("50 W");
    expect(formatWatts(0)).toBe("0 W");
  });

  it("treats unknown unit as time", () => {
    expect(parseUnit("week")).toBe("time");
    expect(parseUnit("day")).toBe("day");
  });

  it("builds Day bars for the stepper month only", () => {
    const bars = dayEnergyBars(snapshot, "2026-08-21");
    expect(bars.map((bar) => bar.label)).toEqual([
      "2026-08-21 3.90 kWh",
      "2026-08-22 0.20 kWh",
    ]);
    expect(bars[0]?.href).toBe("/?day=2026-08-21&unit=time");
  });

  it("sums Local-day Today energy per month in the stepper year", () => {
    const bars = monthEnergyBars(snapshot, "2026-08-21");
    expect(bars.map((bar) => bar.label)).toEqual([
      "2026-08 4.10 kWh",
      "2026-09 0.20 kWh",
    ]);
    expect(bars[0]?.href).toBe("/?day=2026-08-21&unit=day");
    expect(bars[1]?.href).toBe("/?day=2026-09-01&unit=day");
  });

  it("sums Local-day Today energy per year in History", () => {
    const bars = yearEnergyBars(snapshot, "2026-08-21");
    expect(bars.map((bar) => bar.label)).toEqual(["2026 4.30 kWh"]);
    expect(bars[0]?.href).toBe("/?day=2026-08-21&unit=month");
  });

  it("labels the Time stepper with the ISO Local day and stops at History ends", () => {
    const first = stepper(snapshot, "2026-08-21", "time");
    const last = stepper(snapshot, "2026-09-01", "time");
    expect(first.label).toBe("2026-08-21");
    expect(first.prevHref).toBe("");
    expect(first.nextHref).toBe("/?day=2026-08-22&unit=time");
    expect(last.nextHref).toBe("");
    expect(last.prevHref).toBe("/?day=2026-08-31&unit=time");
  });
});
