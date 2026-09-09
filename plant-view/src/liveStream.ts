import type { LoggerNow, PlantPayload } from "./types";

export type SampleEvent = {
  type: "sample";
  logger_serial: string;
  received_at: string;
  ac_power_w: number;
  today_energy_kwh: number;
  lifetime_energy_kwh: number;
};

export function formatTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  try {
    const at = new Date(iso);
    if (isNaN(at.getTime())) return "--:--";
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${get("hour")}:${get("minute")}`;
  } catch {
    return "--:--";
  }
}

export function localMinute(iso: string): string {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00`;
}

export function applySample(
  state: Extract<PlantPayload, { empty: false }>,
  sample: SampleEvent,
): Extract<PlantPayload, { empty: false }> {
  // 1. Update loggers_now
  const existingRows = state.loggers_now ?? [];
  let found = false;
  const updatedLoggersNow: LoggerNow[] = existingRows.map((row) => {
    if (row.name === sample.logger_serial) {
      found = true;
      return {
        ...row,
        last_success_at: sample.received_at,
        power_w: sample.ac_power_w,
      };
    }
    return row;
  });
  if (!found) {
    updatedLoggersNow.push({
      name: sample.logger_serial,
      last_success_at: sample.received_at,
      power_w: sample.ac_power_w,
    });
  }

  // 2. Compute updated Current Power from fresh loggers
  const nowTime = new Date(sample.received_at).getTime();
  const freshRows = updatedLoggersNow.filter(
    (l) => nowTime - new Date(l.last_success_at).getTime() <= 15 * 60 * 1000 && l.power_w !== null,
  );
  const current_power_w =
    freshRows.length > 0
      ? freshRows.reduce((sum, l) => sum + (l.power_w ?? 0), 0)
      : sample.ac_power_w;

  // 3. Update curve if viewing Time grain on selected_day
  let updatedCurve = state.curve;
  const civil = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(sample.received_at));
  const getCivil = (t: Intl.DateTimeFormatPartTypes) =>
    civil.find((p) => p.type === t)?.value ?? "";
  const sampleDay = `${getCivil("year")}-${getCivil("month")}-${getCivil("day")}`;

  if (state.unit === "time" && state.selected_day === sampleDay) {
    const minuteAt = localMinute(sample.received_at);
    let loggerFound = false;

    updatedCurve = state.curve.map((series) => {
      if (series.name === sample.logger_serial) {
        loggerFound = true;
        const points = [...series.points];
        const last = points[points.length - 1];
        if (last && localMinute(last.at) === minuteAt) {
          points[points.length - 1] = {
            ...last,
            at: sample.received_at,
            watts: sample.ac_power_w,
            lifetime_kwh: sample.lifetime_energy_kwh,
          };
        } else {
          points.push({
            at: sample.received_at,
            watts: sample.ac_power_w,
            lifetime_kwh: sample.lifetime_energy_kwh,
          });
        }
        return { ...series, points };
      }
      return series;
    });

    if (!loggerFound) {
      updatedCurve = [
        ...updatedCurve,
        {
          name: sample.logger_serial,
          points: [
            {
              at: sample.received_at,
              watts: sample.ac_power_w,
              lifetime_kwh: sample.lifetime_energy_kwh,
            },
          ],
        },
      ];
    }

    // Update Plant curve series if present
    updatedCurve = updatedCurve.map((series) => {
      if (series.name === "Plant") {
        const points = [...series.points];
        const last = points[points.length - 1];
        if (last && localMinute(last.at) === minuteAt) {
          points[points.length - 1] = {
            ...last,
            at: sample.received_at,
            watts: current_power_w,
          };
        } else {
          points.push({
            at: sample.received_at,
            watts: current_power_w,
          });
        }
        return { ...series, points };
      }
      return series;
    });
  }

  return {
    ...state,
    current_power_w,
    current_power_at: sample.received_at,
    loggers_now: updatedLoggersNow,
    curve: updatedCurve,
  };
}
