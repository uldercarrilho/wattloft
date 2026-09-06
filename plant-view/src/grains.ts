import type { Grain, LocalDayBar, PlantSnapshot } from "./types";

export type EnergyBar = {
  href: string;
  label: string;
  kwh: number;
  current: boolean;
  width: number;
};

export type Stepper = {
  label: string;
  prevHref: string;
  nextHref: string;
};

type Ymd = { y: number; m: number; d: number };

function parseIsoDate(value: string): Ymd {
  const [y, m, d] = value.split("-").map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

function isoDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addMonths(day: string, delta: number): string {
  const { y, m, d } = parseIsoDate(day);
  let month = m - 1 + delta;
  const year = y + Math.floor(month / 12);
  month = ((month % 12) + 12) % 12 + 1;
  return isoDate(year, month, Math.min(d, daysInMonth(year, month)));
}

function addDays(day: string, delta: number): string {
  const { y, m, d } = parseIsoDate(day);
  const stamp = new Date(Date.UTC(y, m - 1, d + delta));
  return isoDate(
    stamp.getUTCFullYear(),
    stamp.getUTCMonth() + 1,
    stamp.getUTCDate(),
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function historySpan(bars: LocalDayBar[]): [string, string] {
  if (bars.length === 0) {
    return ["1970-01-01", "1970-01-01"];
  }
  return [bars[0]!.local_day, bars[bars.length - 1]!.local_day];
}

export function href(day: string, unit: Grain): string {
  return `/?day=${day}&unit=${unit}`;
}

export function parseUnit(raw: string | null | undefined): Grain {
  if (raw === "time" || raw === "day" || raw === "month" || raw === "year") {
    return raw;
  }
  return "time";
}

export function formatKwh(kwh: number): string {
  return `${kwh.toFixed(2)} kWh`;
}

export function formatWatts(watts: number): string {
  if (watts === Math.trunc(watts)) {
    return `${Math.trunc(watts)} W`;
  }
  return `${watts} W`;
}

function withWidths(
  rows: { href: string; label: string; kwh: number; current: boolean }[],
): EnergyBar[] {
  const peak = Math.max(0, ...rows.map((row) => row.kwh));
  return rows.map((row) => ({
    ...row,
    width: peak <= 0 ? 100 : Math.max(12, (row.kwh / peak) * 100),
  }));
}

function anchorInMonth(
  snapshot: PlantSnapshot,
  year: number,
  month: number,
  selectedDay: string,
): string {
  const selected = parseIsoDate(selectedDay);
  if (selected.y === year && selected.m === month) {
    return selectedDay;
  }
  for (const bar of snapshot.local_day_bars) {
    const day = parseIsoDate(bar.local_day);
    if (day.y === year && day.m === month) {
      return bar.local_day;
    }
  }
  return isoDate(year, month, 1);
}

function anchorInYear(
  snapshot: PlantSnapshot,
  year: number,
  selectedDay: string,
): string {
  if (parseIsoDate(selectedDay).y === year) {
    return selectedDay;
  }
  for (const bar of snapshot.local_day_bars) {
    if (parseIsoDate(bar.local_day).y === year) {
      return bar.local_day;
    }
  }
  return isoDate(year, 1, 1);
}

export function dayEnergyBars(
  snapshot: PlantSnapshot,
  selectedDay: string,
): EnergyBar[] {
  const selected = parseIsoDate(selectedDay);
  const monthBars = snapshot.local_day_bars.filter((bar) => {
    const day = parseIsoDate(bar.local_day);
    return day.y === selected.y && day.m === selected.m;
  });
  return withWidths(
    monthBars.map((bar) => ({
      href: href(bar.local_day, "time"),
      label: `${bar.local_day} ${formatKwh(bar.today_energy_kwh)}`,
      kwh: bar.today_energy_kwh,
      current: false,
    })),
  );
}

export function monthEnergyBars(
  snapshot: PlantSnapshot,
  selectedDay: string,
): EnergyBar[] {
  const selected = parseIsoDate(selectedDay);
  const byMonth = new Map<string, number>();
  for (const bar of snapshot.local_day_bars) {
    const day = parseIsoDate(bar.local_day);
    if (day.y !== selected.y) {
      continue;
    }
    const key = `${day.y}-${String(day.m).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + bar.today_energy_kwh);
  }
  const rows = [...byMonth.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([key, kwh]) => {
      const [yearText, monthText] = key.split("-");
      const year = Number(yearText);
      const month = Number(monthText);
      return {
        href: href(anchorInMonth(snapshot, year, month, selectedDay), "day"),
        label: `${key} ${formatKwh(kwh)}`,
        kwh,
        current: month === selected.m,
      };
    });
  return withWidths(rows);
}

export function yearEnergyBars(
  snapshot: PlantSnapshot,
  selectedDay: string,
): EnergyBar[] {
  const selected = parseIsoDate(selectedDay);
  const byYear = new Map<number, number>();
  for (const bar of snapshot.local_day_bars) {
    const year = parseIsoDate(bar.local_day).y;
    byYear.set(year, (byYear.get(year) ?? 0) + bar.today_energy_kwh);
  }
  const rows = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, kwh]) => ({
      href: href(anchorInYear(snapshot, year, selectedDay), "month"),
      label: `${year} ${formatKwh(kwh)}`,
      kwh,
      current: year === selected.y,
    }));
  return withWidths(rows);
}

export function stepper(
  snapshot: PlantSnapshot,
  selectedDay: string,
  unit: Grain,
): Stepper {
  const [first, last] = historySpan(snapshot.local_day_bars);
  const selected = parseIsoDate(selectedDay);
  const firstDay = parseIsoDate(first);
  const lastDay = parseIsoDate(last);
  if (unit === "day") {
    const prevMonth = addMonths(isoDate(selected.y, selected.m, 1), -1);
    const nextMonth = addMonths(isoDate(selected.y, selected.m, 1), 1);
    const prev = parseIsoDate(prevMonth);
    const next = parseIsoDate(nextMonth);
    const prevHref =
      prev.y > firstDay.y || (prev.y === firstDay.y && prev.m >= firstDay.m)
        ? href(prevMonth < first ? first : prevMonth, "day")
        : "";
    const nextHref =
      next.y < lastDay.y || (next.y === lastDay.y && next.m <= lastDay.m)
        ? href(nextMonth > last ? last : nextMonth, "day")
        : "";
    return {
      label: `${selected.y}-${String(selected.m).padStart(2, "0")}`,
      prevHref,
      nextHref,
    };
  }
  if (unit === "month") {
    return {
      label: String(selected.y),
      prevHref:
        selected.y - 1 >= firstDay.y
          ? href(anchorInYear(snapshot, selected.y - 1, selectedDay), "month")
          : "",
      nextHref:
        selected.y + 1 <= lastDay.y
          ? href(anchorInYear(snapshot, selected.y + 1, selectedDay), "month")
          : "",
    };
  }
  if (unit === "year") {
    return {
      label: firstDay.y === lastDay.y ? String(firstDay.y) : `${firstDay.y}–${lastDay.y}`,
      prevHref: "",
      nextHref: "",
    };
  }
  const prevDay = addDays(selectedDay, -1);
  const nextDay = addDays(selectedDay, 1);
  return {
    label: selectedDay,
    prevHref: prevDay >= first ? href(prevDay, "time") : "",
    nextHref: nextDay <= last ? href(nextDay, "time") : "",
  };
}
