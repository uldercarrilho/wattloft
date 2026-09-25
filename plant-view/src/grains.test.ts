import { describe, expect, it } from "vitest";
import {
  displayNameOf,
  dayEnergyBars,
  formatDayMonth,
  formatKwh,
  formatMonthName,
  formatShortMonth,
  formatWatts,
  monthEnergyBars,
  parseUnit,
  stackLoggerNames,
  stepper,
  weekdayTick,
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
    {
      local_day: "2026-08-21",
      today_energy_kwh: 3.9,
      loggers: [
        { name: "1000000001", today_energy_kwh: 2.1 },
        { name: "1000000003", today_energy_kwh: 1.8 },
      ],
    },
    {
      local_day: "2026-08-22",
      today_energy_kwh: 0.2,
      loggers: [{ name: "1000000001", today_energy_kwh: 0.2 }],
    },
    {
      local_day: "2026-09-01",
      today_energy_kwh: 0.2,
      loggers: [{ name: "1000000001", today_energy_kwh: 0.2 }],
    },
  ],
  curve: [
    { name: "1000000002", points: [{ at: "2026-08-21T15:00:00", watts: 10 }] },
    { name: "Plant", points: [{ at: "2026-08-21T15:00:00", watts: 10 }] },
  ],
};

describe("grains", () => {
  it("formats energy and power the way Plant view did", () => {
    expect(formatKwh(3.9)).toBe("3.90 kWh");
    expect(formatKwh(0.2)).toBe("0.20 kWh");
    expect(formatKwh(11319.5)).toBe("11,319.50 kWh");
    expect(formatWatts(50)).toBe("50 W");
    expect(formatWatts(50.4)).toBe("50 W");
    expect(formatWatts(50.7)).toBe("51 W");
    expect(formatWatts(0)).toBe("0 W");
    expect(formatWatts(11319)).toBe("11,319 W");
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

  it("sums Local-day production per month in the stepper year", () => {
    const bars = monthEnergyBars(snapshot, "2026-08-21");
    expect(bars.map((bar) => bar.label)).toEqual([
      "2026-08 4.10 kWh",
      "2026-09 0.20 kWh",
    ]);
    expect(bars[0]?.href).toBe("/?day=2026-08-21&unit=day");
    expect(bars[1]?.href).toBe("/?day=2026-09-01&unit=day");
  });

  it("sums Local-day production per year in History", () => {
    const bars = yearEnergyBars(snapshot, "2026-08-21");
    expect(bars.map((bar) => bar.label)).toEqual(["2026 4.30 kWh"]);
    expect(bars[0]?.href).toBe("/?day=2026-08-21&unit=month");
  });

  it("Month and Year sum Local-day production, not a running Today energy total", () => {
    const production: PlantSnapshot = {
      ...snapshot,
      local_day_bars: [
        { local_day: "2026-09-01", today_energy_kwh: 10 },
        { local_day: "2026-09-02", today_energy_kwh: 12 },
        { local_day: "2026-09-03", today_energy_kwh: 8 },
        { local_day: "2025-12-31", today_energy_kwh: 5 },
      ],
    };
    expect(monthEnergyBars(production, "2026-09-02").map((bar) => bar.label)).toEqual([
      "2026-09 30.00 kWh",
    ]);
    expect(yearEnergyBars(production, "2026-09-02").map((bar) => bar.label)).toEqual([
      "2025 5.00 kWh",
      "2026 30.00 kWh",
    ]);
  });

  it("labels Power as Today or a day-month and stops at History ends", () => {
    const first = stepper(snapshot, "2026-08-21", "time", "2026-09-07");
    const today = stepper(snapshot, "2026-08-21", "time", "2026-08-21");
    const last = stepper(snapshot, "2026-09-01", "time");
    expect(first.label).toBe("21 Aug");
    expect(today.label).toBe("Today");
    expect(first.prevHref).toBe("");
    expect(first.nextHref).toBe("/?day=2026-08-22&unit=time");
    expect(last.nextHref).toBe("");
    expect(last.prevHref).toBe("/?day=2026-08-31&unit=time");
  });

  it("labels Day as the month name and Month as the year", () => {
    expect(stepper(snapshot, "2026-08-21", "day").label).toBe("August");
    expect(stepper(snapshot, "2026-08-21", "month").label).toBe("2026");
    expect(formatDayMonth("2026-09-07")).toBe("7 Sep");
    expect(formatMonthName("2026-09-07")).toBe("September");
    expect(formatShortMonth("2026-08")).toBe("Aug");
    expect(formatShortMonth("2026-09")).toBe("Sep");
  });

  it("Overlay Day bars keep Plant totals and empty segments", () => {
    const bars = dayEnergyBars(snapshot, "2026-08-21");
    expect(bars.map((bar) => bar.segments)).toEqual([[], []]);
    expect(bars[0]?.kwh).toBe(3.9);
  });

  it("Stack Day bars split a row by Logger and omit a hidden Logger from the total", () => {
    const both = new Set(["1000000001", "1000000003"]);
    const stacked = dayEnergyBars(snapshot, "2026-08-21", both);
    expect(stacked[0]?.kwh).toBe(3.9);
    expect(stacked[0]?.label).toBe("2026-08-21 3.90 kWh");
    expect(stacked[0]?.segments.map((part) => part.name)).toEqual([
      "1000000001",
      "1000000003",
    ]);
    expect(stacked[0]?.segments.reduce((sum, part) => sum + part.width, 0)).toBe(100);

    const one = dayEnergyBars(snapshot, "2026-08-21", new Set(["1000000001"]));
    expect(one[0]?.kwh).toBe(2.1);
    expect(one[0]?.label).toBe("2026-08-21 2.10 kWh");
    expect(one[0]?.segments).toEqual([
      { name: "1000000001", kwh: 2.1, width: 100 },
    ]);
    expect(one[0]?.width).toBe(100);
    expect(one[1]?.width).toBeGreaterThanOrEqual(12);
  });

  it("Stack Month sums Logger segments across Local days", () => {
    const both = new Set(["1000000001", "1000000003"]);
    const bars = monthEnergyBars(snapshot, "2026-08-21", both);
    const august = bars.find((bar) => bar.label.startsWith("2026-08 "));
    expect(august?.kwh).toBe(4.1);
    expect(august?.label).toBe("2026-08 4.10 kWh");
    expect(august?.segments).toEqual([
      { name: "1000000001", kwh: 2.3, width: (2.3 / 4.1) * 100 },
      { name: "1000000003", kwh: 1.8, width: (1.8 / 4.1) * 100 },
    ]);
  });

  it("lists Stack Logger names from bars and curve, excluding Plant", () => {
    expect(stackLoggerNames(snapshot)).toEqual([
      "1000000001",
      "1000000003",
      "1000000002",
    ]);
  });

  it("marks today's Local day bar in progress and incomplete History buckets as partial", () => {
    const days = dayEnergyBars(snapshot, "2026-08-21");
    expect(days.map((bar) => bar.partial)).toEqual([false, true]);
    const months = monthEnergyBars(snapshot, "2026-08-21");
    expect(months.find((bar) => bar.label.startsWith("2026-08 "))?.partial).toBe(true);
    expect(months.find((bar) => bar.label.startsWith("2026-09 "))?.partial).toBe(false);
    expect(yearEnergyBars(snapshot, "2026-08-21")[0]?.partial).toBe(true);
  });

  it("formats Day ticks as weekday and day without a comma", () => {
    expect(weekdayTick("2026-08-21")).toBe("Fri 21");
  });

  it("labels a late-start Logger with its alias only", () => {
    const late = {
      ...snapshot,
      history_start: "2026-08-21",
      local_day_bars: [
        { local_day: "2026-08-21", today_energy_kwh: 3.9, loggers: [] },
        {
          local_day: "2026-08-22",
          today_energy_kwh: 0.2,
          loggers: [{ name: "1000000001", display_name: "East", today_energy_kwh: 0.2 }],
        },
      ],
    };
    expect(displayNameOf(late, "1000000001")).toBe("East");
  });
});
