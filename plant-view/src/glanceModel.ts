import { formatKwh, formatWatts } from "./grains";
import { lifetimeKwh, relativeAge } from "./LastSample";
import type { LoggerNow } from "./types";

export const FRESH_MS = 15 * 60 * 1000;

export type GlanceRing = {
  name: string;
  displayName: string;
  closed: boolean;
  wattsLabel: string;
};

export type GlanceView = {
  wattsLabel: string;
  hollow: boolean;
  banner: string | null;
  rings: GlanceRing[];
  todayLabel: string;
  lifetimeLabel: string;
};

export type GlanceSnapshot = {
  today_energy_kwh: number | null;
  current_power_w: number | null;
  lifetime_energy_kwh: number;
  loggers_now?: LoggerNow[];
};

function isFresh(at: string, now: Date): boolean {
  return now.getTime() - new Date(at).getTime() <= FRESH_MS;
}

function fromCurrentPower(watts: number | null): { wattsLabel: string; hollow: boolean } {
  const wattsLabel = watts === null ? "—" : formatWatts(watts);
  return { wattsLabel, hollow: watts === null || watts === 0 };
}

export function glanceModel(snapshot: GlanceSnapshot, now = new Date()): GlanceView {
  const watts = snapshot.current_power_w;
  const todayLabel = snapshot.today_energy_kwh === null ? "-" : formatKwh(snapshot.today_energy_kwh);
  const lifetimeLabel = lifetimeKwh(snapshot.lifetime_energy_kwh);
  const rows = snapshot.loggers_now;
  if (rows === undefined || rows.length === 0) {
    const hero = fromCurrentPower(watts);
    return {
      ...hero,
      banner: null,
      rings: [],
      todayLabel,
      lifetimeLabel,
    };
  }
  const rings: GlanceRing[] = rows.map((row) => ({
    name: row.name,
    displayName: row.display_name ?? row.name,
    closed: isFresh(row.last_success_at, now),
    wattsLabel: formatWatts(row.power_w),
  }));
  const closed = rows.filter((_, index) => rings[index]!.closed);
  const wattsLabel =
    closed.length === 0 ? "—" : formatWatts(closed.reduce((sum, row) => sum + row.power_w, 0));
  const hollow = wattsLabel === "—" || wattsLabel === "0 W";
  const nightZero = rings.every((ring) => ring.closed) && (wattsLabel === "0 W" || wattsLabel === "—");
  const silent = rows.filter((row, index) => !rings[index]!.closed || row.power_w === 0);
  const producing = rows.some((row, index) => rings[index]!.closed && row.power_w > 0);
  let banner: string | null = null;
  if (!nightZero && producing && silent.length > 0) {
    const stalest = silent.reduce((oldest, row) =>
      new Date(row.last_success_at).getTime() < new Date(oldest.last_success_at).getTime()
        ? row
        : oldest,
    );
    const names = silent.map((row) => row.display_name ?? row.name).join(", ");
    banner = `${names} silent · last Sample ${relativeAge(stalest.last_success_at, now)}`;
  }
  return {
    wattsLabel,
    hollow,
    banner,
    rings,
    todayLabel,
    lifetimeLabel,
  };
}
