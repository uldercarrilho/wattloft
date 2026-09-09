import type { Grain, LocalDayBar, PlantSnapshot } from "./types";

export type EnergySegment = {
  name: string;
  kwh: number;
  width: number;
};

export type EnergyBar = {
  href: string;
  label: string;
  kwh: number;
  current: boolean;
  partial: boolean;
  width: number;
  segments: EnergySegment[];
  prevYearKwh?: number | null;
  deltaPct?: number | null;
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

export function localDayOf(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function weekdayTick(isoDay: string): string {
  const stamp = new Date(`${isoDay}T12:00:00-03:00`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "numeric",
  }).formatToParts(stamp);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${weekday} ${day}`;
}

export function historyStartOf(snapshot: PlantSnapshot): string {
  return snapshot.history_start ?? historySpan(snapshot.local_day_bars)[0];
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
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kwh)} kWh`;
}

export function formatWatts(watts: number): string {
  const value = watts === Math.trunc(watts) ? Math.trunc(watts) : watts;
  return `${new Intl.NumberFormat("en-US").format(value)} W`;
}

export function formatDayMonth(isoDay: string): string {
  const stamp = new Date(`${isoDay}T12:00:00-03:00`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "short",
  }).formatToParts(stamp);
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${day} ${month}`;
}

export function formatMonthName(isoDay: string): string {
  const stamp = new Date(`${isoDay}T12:00:00-03:00`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    month: "long",
  }).format(stamp);
}

export function formatShortMonth(isoYearMonth: string): string {
  const isoDay = /^\d{4}-\d{2}$/.test(isoYearMonth) ? `${isoYearMonth}-01` : isoYearMonth;
  const stamp = new Date(`${isoDay}T12:00:00-03:00`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    month: "short",
  }).format(stamp);
}

export function selectedPeriodKwh(
  snapshot: PlantSnapshot,
  visible?: ReadonlySet<string>,
): number {
  const bar = snapshot.local_day_bars.find((row) => row.local_day === snapshot.selected_day);
  if (!bar) {
    return 0;
  }
  return partsForBar(bar, visible).kwh;
}

export function displayNameOf(snapshot: PlantSnapshot, serial: string): string {
  if (serial === "Plant") {
    return "Plant";
  }
  for (const series of snapshot.curve) {
    if (series.name === serial && series.display_name) {
      return series.display_name;
    }
  }
  for (const bar of snapshot.local_day_bars) {
    for (const logger of bar.loggers ?? []) {
      if (logger.name === serial && logger.display_name) {
        return logger.display_name;
      }
    }
  }
  for (const row of snapshot.loggers_now ?? []) {
    if (row.name === serial && row.display_name) {
      return row.display_name;
    }
  }
  return serial;
}

export function stackLoggerNames(snapshot: PlantSnapshot): string[] {
  const names = new Set<string>();
  for (const bar of snapshot.local_day_bars) {
    for (const part of bar.loggers ?? []) {
      names.add(part.name);
    }
  }
  for (const series of snapshot.curve) {
    if (series.name !== "Plant") {
      names.add(series.name);
    }
  }
  return [...names].sort();
}

type EnergyPart = { name: string; kwh: number };

function roundedKwh(value: number): number {
  return Math.round(value * 100) / 100;
}

function partsForBar(
  bar: LocalDayBar,
  visible?: ReadonlySet<string>,
): { kwh: number; parts: EnergyPart[] } {
  const loggers = bar.loggers;
  if (visible === undefined || loggers === undefined || loggers.length === 0) {
    return { kwh: bar.today_energy_kwh, parts: [] };
  }
  const parts = loggers
    .filter((part) => visible.has(part.name))
    .map((part) => ({ name: part.name, kwh: part.today_energy_kwh }));
  return {
    kwh: roundedKwh(parts.reduce((sum, part) => sum + part.kwh, 0)),
    parts,
  };
}

function withWidths(
  rows: {
    href: string;
    label: string;
    kwh: number;
    current: boolean;
    partial: boolean;
    parts: EnergyPart[];
    prevYearKwh?: number | null;
    deltaPct?: number | null;
  }[],
): EnergyBar[] {
  const peak = Math.max(0, ...rows.map((row) => Math.max(row.kwh, row.prevYearKwh ?? 0)));
  return rows.map((row) => ({
    href: row.href,
    label: row.label,
    kwh: row.kwh,
    current: row.current,
    partial: row.partial,
    width: peak <= 0 ? 100 : Math.max(12, (row.kwh / peak) * 100),
    segments:
      row.kwh <= 0
        ? []
        : row.parts.map((part) => ({
            name: part.name,
            kwh: part.kwh,
            width: (part.kwh / row.kwh) * 100,
          })),
    prevYearKwh: row.prevYearKwh,
    deltaPct: row.deltaPct,
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
  visible?: ReadonlySet<string>,
): EnergyBar[] {
  const selected = parseIsoDate(selectedDay);
  const monthBars = snapshot.local_day_bars.filter((bar) => {
    const day = parseIsoDate(bar.local_day);
    return day.y === selected.y && day.m === selected.m;
  });
  return withWidths(
    monthBars.map((bar) => {
      const { kwh, parts } = partsForBar(bar, visible);
      const nowDay = localDayOf(snapshot.current_power_at);
      return {
        href: href(bar.local_day, "time"),
        label: `${bar.local_day} ${formatKwh(kwh)}`,
        kwh,
        current: false,
        partial: bar.local_day === nowDay,
        parts,
        prevYearKwh: bar.prev_year_today_energy_kwh ?? null,
      };
    }),
  );
}

function mergeParts(
  bars: LocalDayBar[],
  visible: ReadonlySet<string> | undefined,
  include: (day: Ymd) => boolean,
): { kwh: number; parts: EnergyPart[] } {
  const byName = new Map<string, number>();
  let kwh = 0;
  for (const bar of bars) {
    if (!include(parseIsoDate(bar.local_day))) {
      continue;
    }
    const row = partsForBar(bar, visible);
    kwh += row.kwh;
    for (const part of row.parts) {
      byName.set(part.name, (byName.get(part.name) ?? 0) + part.kwh);
    }
  }
  return {
    kwh: roundedKwh(kwh),
    parts: [...byName.entries()]
      .sort(([a], [b]) => cmp(a, b))
      .map(([name, partKwh]) => ({ name, kwh: roundedKwh(partKwh) })),
  };
}

export function monthEnergyBars(
  snapshot: PlantSnapshot,
  selectedDay: string,
  visible?: ReadonlySet<string>,
): EnergyBar[] {
  const selected = parseIsoDate(selectedDay);
  const keys = new Set<string>();
  for (const bar of snapshot.local_day_bars) {
    const day = parseIsoDate(bar.local_day);
    if (day.y !== selected.y) {
      continue;
    }
    keys.add(`${day.y}-${String(day.m).padStart(2, "0")}`);
  }
  const rows = [...keys]
    .sort(cmp)
    .map((key) => {
      const [yearText, monthText] = key.split("-");
      const year = Number(yearText);
      const month = Number(monthText);
      const { kwh, parts } = mergeParts(
        snapshot.local_day_bars,
        visible,
        (day) => day.y === year && day.m === month,
      );
      const prevYear = year - 1;
      const { kwh: prevYearKwh } = mergeParts(
        snapshot.local_day_bars,
        visible,
        (day) => day.y === prevYear && day.m === month,
      );
      let deltaPct: number | null = null;
      let deltaText = "";
      if (prevYearKwh > 0) {
        deltaPct = Math.round(((kwh - prevYearKwh) / prevYearKwh) * 100);
        deltaText = deltaPct >= 0 ? ` (+${deltaPct}% vs ${prevYear})` : ` (${deltaPct}% vs ${prevYear})`;
      }
      const start = parseIsoDate(historyStartOf(snapshot));
      const partial = start.y === year && start.m === month && start.d > 1;
      return {
        href: href(anchorInMonth(snapshot, year, month, selectedDay), "day"),
        label: `${key} ${formatKwh(kwh)}${deltaText}`,
        kwh,
        current: month === selected.m,
        partial,
        parts,
        prevYearKwh: prevYearKwh > 0 ? prevYearKwh : null,
        deltaPct,
      };
    });
  return withWidths(rows);
}

export function yearEnergyBars(
  snapshot: PlantSnapshot,
  selectedDay: string,
  visible?: ReadonlySet<string>,
): EnergyBar[] {
  const selected = parseIsoDate(selectedDay);
  const years = new Set<number>();
  for (const bar of snapshot.local_day_bars) {
    years.add(parseIsoDate(bar.local_day).y);
  }
  const rows = [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const { kwh, parts } = mergeParts(
        snapshot.local_day_bars,
        visible,
        (day) => day.y === year,
      );
      const start = parseIsoDate(historyStartOf(snapshot));
      const partial = start.y === year && (start.m > 1 || start.d > 1);
      return {
        href: href(anchorInYear(snapshot, year, selectedDay), "month"),
        label: `${year} ${formatKwh(kwh)}`,
        kwh,
        current: year === selected.y,
        partial,
        parts,
      };
    });
  return withWidths(rows);
}

export function stepper(
  snapshot: PlantSnapshot,
  selectedDay: string,
  unit: Grain,
  today?: string,
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
      label: formatMonthName(isoDate(selected.y, selected.m, 1)),
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
    label: today && selectedDay === today ? "Today" : formatDayMonth(selectedDay),
    prevHref: prevDay >= first ? href(prevDay, "time") : "",
    nextHref: nextDay <= last ? href(nextDay, "time") : "",
  };
}
