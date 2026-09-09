import type { LoggerNow } from "./types";

export type StallAlert = {
  key: string;
  silentLogger: LoggerNow;
  siblingLogger: LoggerNow;
  minutesSilent: number;
  siblingWatts: number;
  notification: {
    title: string;
    body: string;
    icon: string;
  };
};

export function getLocalCivilTime(now: Date): { hour: number; minute: number; localDay: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const localDay = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { hour, minute, localDay };
}

export function evaluateStallAlert(
  now: Date,
  loggersNow: LoggerNow[],
  sentAlertKeys: Set<string>,
): StallAlert | null {
  const { hour, localDay } = getLocalCivilTime(now);
  if (hour < 7 || hour >= 18) {
    return null;
  }

  if (!loggersNow || loggersNow.length < 2) {
    return null;
  }

  for (const logger of loggersNow) {
    const lastSuccess = new Date(logger.last_success_at).getTime();
    const minutesSilent = Math.floor((now.getTime() - lastSuccess) / (60 * 1000));
    if (minutesSilent > 20) {
      const siblings = loggersNow.filter((l) => l.name !== logger.name);
      for (const sibling of siblings) {
        const siblingAgeMs = now.getTime() - new Date(sibling.last_success_at).getTime();
        const siblingIsReporting = siblingAgeMs <= 20 * 60 * 1000;
        const siblingWatts = sibling.power_w ?? 0;
        if (siblingIsReporting && siblingWatts > 50) {
          const alertKey = `${localDay}:${logger.name}`;
          if (sentAlertKeys.has(alertKey)) {
            continue;
          }

          const silentName = logger.display_name ?? logger.name;
          const siblingName = sibling.display_name ?? sibling.name;
          const formattedSilent = silentName.toLowerCase().endsWith("logger")
            ? silentName
            : `${silentName} logger`;

          return {
            key: alertKey,
            silentLogger: logger,
            siblingLogger: sibling,
            minutesSilent,
            siblingWatts,
            notification: {
              title: "Wattloft · Logger Stall",
              body: `${formattedSilent} has been silent for ${minutesSilent}m while ${siblingName} is producing ${Math.round(siblingWatts)} W.`,
              icon: "/favicon.svg",
            },
          };
        }
      }
    }
  }

  return null;
}
