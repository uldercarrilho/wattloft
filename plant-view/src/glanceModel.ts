import { formatKwh, formatWatts } from "./grains";
import { lifetimeKwh, relativeAge } from "./LastSample";
import type { CurvePoint, DriftInfo, LoggerNow } from "./types";

export const FRESH_MS = 15 * 60 * 1000;

export type GlanceLogger = {
  name: string;
  displayName: string;
  reporting: boolean;
  wattsLabel: string;
  ageLabel: string;
  driftAdvisory?: string | null;
};

export type ClearSkyCondition = "optimal" | "reduced" | "overcast";

export type ClearSkyInstant = {
  efficiencyPct: number;
  barWidthPct: number;
  idealWatts: number;
  idealLabel: string;
  condition: ClearSkyCondition;
};

export type GlanceView = {
  wattsLabel: string;
  banner: string | null;
  loggers: GlanceLogger[];
  todayLabel: string;
  lifetimeLabel: string;
  clearSky?: ClearSkyInstant | null;
};

export type GlanceSnapshot = {
  today_energy_kwh: number | null;
  current_power_w: number | null;
  lifetime_energy_kwh: number;
  loggers_now?: LoggerNow[];
  drift?: DriftInfo | null;
  ideal_curve?: CurvePoint[];
  current_power_at?: string;
};

export function localMinuteOfDay(iso: string): number | null {
  if (!iso) return null;
  if (!iso.endsWith("Z") && !/[+-]\d{2}(:\d{2})?$/.test(iso)) {
    const time = iso.includes("T") ? iso.split("T")[1] : iso.split(" ")[1];
    const [h, m] = (time ?? "00:00").split(":").map(Number);
    if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }
  try {
    const at = new Date(iso);
    if (isNaN(at.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(at);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    return null;
  }
}

export function computeClearSkyInstant(
  currentWatts: number | null,
  currentPowerAt: string | undefined,
  idealCurve: CurvePoint[] | undefined,
): ClearSkyInstant | null {
  if (currentWatts === null || !currentPowerAt || !idealCurve || idealCurve.length === 0) {
    return null;
  }
  const currentMinute = localMinuteOfDay(currentPowerAt);
  if (currentMinute === null) return null;

  let closestPoint: CurvePoint | null = null;
  let minDiff = Infinity;
  for (const point of idealCurve) {
    const time = point.at.includes("T") ? point.at.split("T")[1] : point.at.split(" ")[1];
    const [h, m] = (time ?? "00:00").split(":").map(Number);
    if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) continue;
    const ptMinute = h * 60 + m;
    const diff = Math.abs(ptMinute - currentMinute);
    if (diff < minDiff) {
      minDiff = diff;
      closestPoint = point;
    }
  }

  if (!closestPoint || minDiff > 30 || closestPoint.watts <= 0) {
    return null;
  }

  const idealWatts = closestPoint.watts;
  const actualWatts = Math.max(0, currentWatts);
  const efficiencyPct = Math.round((actualWatts / idealWatts) * 100);
  const barWidthPct = Math.min(100, efficiencyPct);

  let condition: ClearSkyCondition = "overcast";
  if (efficiencyPct >= 80) {
    condition = "optimal";
  } else if (efficiencyPct >= 50) {
    condition = "reduced";
  }

  const idealLabel =
    idealWatts >= 1000
      ? `${(idealWatts / 1000).toFixed(1)} kW ideal`
      : `${Math.round(idealWatts)} W ideal`;

  return {
    efficiencyPct,
    barWidthPct,
    idealWatts,
    idealLabel,
    condition,
  };
}

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
    const clearSky = computeClearSkyInstant(
      watts,
      snapshot.current_power_at,
      snapshot.ideal_curve,
    );
    return {
      ...fromCurrentPower(watts),
      banner: null,
      loggers: [],
      todayLabel,
      lifetimeLabel,
      clearSky,
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
  const totalReportingWatts = reportingRows.reduce((sum, row) => sum + row.power_w, 0);
  const wattsLabel = reportingRows.length === 0 ? "—" : formatWatts(totalReportingWatts);
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

  const effectiveWatts = reportingRows.length > 0 ? totalReportingWatts : watts;
  const effectiveAt =
    snapshot.current_power_at ??
    (reportingRows.length > 0 ? reportingRows[0]!.last_success_at : undefined);

  const clearSky = computeClearSkyInstant(
    effectiveWatts,
    effectiveAt,
    snapshot.ideal_curve,
  );

  return {
    wattsLabel,
    banner,
    loggers,
    todayLabel,
    lifetimeLabel,
    clearSky,
  };
}
