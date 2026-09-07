import { formatKwh, formatWatts } from "./grains";
import { lifetimeKwh, relativeAge } from "./LastSample";
import type { LoggerNow } from "./types";

export const FRESH_MS = 15 * 60 * 1000;

export type GlanceRing = {
  name: string;
  displayName: string;
  closed: boolean;
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

export function glanceModel(snapshot: GlanceSnapshot, now = new Date()): GlanceView {
  const watts = snapshot.current_power_w;
  const wattsLabel = watts === null ? "—" : formatWatts(watts);
  const todayLabel = snapshot.today_energy_kwh === null ? "-" : formatKwh(snapshot.today_energy_kwh);
  const lifetimeLabel = lifetimeKwh(snapshot.lifetime_energy_kwh);
  const rows = snapshot.loggers_now;
  if (rows === undefined) {
    return {
      wattsLabel,
      hollow: watts === null || watts === 0,
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
  }));
  const nightZero =
    rows.length > 0 && rings.every((ring) => ring.closed) && (watts === null || watts === 0);
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
    hollow: nightZero || watts === null || watts === 0,
    banner,
    rings,
    todayLabel,
    lifetimeLabel,
  };
}
