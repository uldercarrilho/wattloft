import { formatKwh, formatWatts } from "./grains";
import { lifetimeKwh, relativeAge } from "./LastSample";
import type { DriftInfo, LoggerNow } from "./types";

export const FRESH_MS = 15 * 60 * 1000;

export type GlanceLogger = {
  name: string;
  displayName: string;
  reporting: boolean;
  wattsLabel: string;
  ageLabel: string;
  driftAdvisory?: string | null;
};

export type GlanceView = {
  wattsLabel: string;
  banner: string | null;
  loggers: GlanceLogger[];
  todayLabel: string;
  lifetimeLabel: string;
};

export type GlanceSnapshot = {
  today_energy_kwh: number | null;
  current_power_w: number | null;
  lifetime_energy_kwh: number;
  loggers_now?: LoggerNow[];
  drift?: DriftInfo | null;
};

function isFresh(at: string, now: Date): boolean {
  return now.getTime() - new Date(at).getTime() <= FRESH_MS;
}

function fromCurrentPower(watts: number | null): { wattsLabel: string } {
  return { wattsLabel: watts === null ? "—" : formatWatts(watts) };
}

export function glanceModel(snapshot: GlanceSnapshot, now = new Date()): GlanceView {
  const watts = snapshot.current_power_w;
  const todayLabel = snapshot.today_energy_kwh === null ? "-" : formatKwh(snapshot.today_energy_kwh);
  const lifetimeLabel = lifetimeKwh(snapshot.lifetime_energy_kwh);
  const rows = snapshot.loggers_now;
  if (rows === undefined || rows.length === 0) {
    return {
      ...fromCurrentPower(watts),
      banner: null,
      loggers: [],
      todayLabel,
      lifetimeLabel,
    };
  }
  const loggers: GlanceLogger[] = rows.map((row) => {
    const reporting = isFresh(row.last_success_at, now);
    const wattsLabel = formatWatts(row.power_w);
    const isDrifted =
      Boolean(snapshot.drift?.detected) &&
      (snapshot.drift?.affected_logger === row.name ||
        snapshot.drift?.affected_logger === row.display_name);
    const driftAdvisory = isDrifted ? (snapshot.drift?.advisory ?? null) : null;
    return {
      name: row.name,
      displayName: row.display_name ?? row.name,
      reporting,
      wattsLabel: reporting ? wattsLabel : `last ${wattsLabel}`,
      ageLabel: relativeAge(row.last_success_at, now),
      driftAdvisory,
    };
  });
  const reportingRows = rows.filter((_, index) => loggers[index]!.reporting);
  const wattsLabel =
    reportingRows.length === 0
      ? "—"
      : formatWatts(reportingRows.reduce((sum, row) => sum + row.power_w, 0));
  const producing = rows.some((row, index) => loggers[index]!.reporting && row.power_w > 0);
  const silent = rows.filter((_, index) => !loggers[index]!.reporting);
  let banner: string | null = null;
  if (producing && silent.length > 0) {
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
    banner,
    loggers,
    todayLabel,
    lifetimeLabel,
  };
}
