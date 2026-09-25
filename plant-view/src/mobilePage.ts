import { href } from "./grains";
import type { Grain } from "./types";

export const MOBILE_PAGES = ["glance", "time", "day", "month", "year"] as const;
export type MobilePage = (typeof MOBILE_PAGES)[number];

export const MOBILE_TABS = ["glance", "power", "history", "insights"] as const;
export type MobileTab = (typeof MOBILE_TABS)[number];

export const PAGER_SWIPE_IGNORE =
  ".plant-chart, .stepper, .chart-mode, .series-toggles, .readout";

export function pagerSwipeIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(PAGER_SWIPE_IGNORE));
}

export function mobilePageOf(search: string): MobilePage {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const unit = params.get("unit");
  if (unit === "time" || unit === "day" || unit === "month" || unit === "year") {
    return unit;
  }
  return "glance";
}

export function mobileTabOf(search: string): MobileTab {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const unit = params.get("unit");
  const tab = params.get("tab");
  if (unit === "time" || tab === "power") return "power";
  if (unit === "day" || unit === "month" || unit === "year" || tab === "history") return "history";
  if (unit === "insights" || tab === "insights") return "insights";
  return "glance";
}

export function grainOf(search: string): Grain {
  const unit = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("unit");
  if (unit === "day" || unit === "month" || unit === "year") return unit;
  return "day";
}

export function mobileHref(day: string, page: MobilePage | MobileTab, grain?: Grain): string {
  if (page === "glance") {
    return `/?day=${day}`;
  }
  if (page === "power" || page === "time") {
    return `/?day=${day}&unit=time`;
  }
  if (page === "history") {
    return `/?day=${day}&unit=${grain ?? "day"}`;
  }
  if (page === "insights") {
    return `/?day=${day}&unit=insights`;
  }
  return href(day, page as Grain);
}

export function adjacentMobilePage(page: MobilePage, delta: -1 | 1): MobilePage | null {
  const index = MOBILE_PAGES.indexOf(page) + delta;
  if (index < 0 || index >= MOBILE_PAGES.length) {
    return null;
  }
  return MOBILE_PAGES[index]!;
}
