import { useEffect, useState } from "react";

export function lastSampleDatetime(iso: string): string {
  const at = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}-03:00`;
}

export function relativeAge(iso: string, now = new Date()): string {
  const secs = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function LastSample({ at }: { at: string }) {
  const [label, setLabel] = useState(() => relativeAge(at));
  useEffect(() => {
    setLabel(relativeAge(at));
    const id = window.setInterval(() => setLabel(relativeAge(at)), 1000);
    return () => window.clearInterval(id);
  }, [at]);
  return (
    <time id="last-sample" dateTime={lastSampleDatetime(at)}>
      {label}
    </time>
  );
}

export function lifetimeKwh(kwh: number): string {
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(kwh)} kWh`;
}
