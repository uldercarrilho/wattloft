import { href } from "./grains";

export const MOBILE_PAGES = ["glance", "time", "day", "month", "year"] as const;

export type MobilePage = (typeof MOBILE_PAGES)[number];

export const PAGER_SWIPE_IGNORE =
  ".plant-chart, .stepper, .chart-mode, .series-toggles, .readout";

export function pagerSwipeIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(PAGER_SWIPE_IGNORE));
}

export function mobilePageOf(search: string): MobilePage {
  const unit = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("unit");
  if (unit === "time" || unit === "day" || unit === "month" || unit === "year") {
    return unit;
  }
  return "glance";
}

export function mobileHref(day: string, page: MobilePage): string {
  if (page === "glance") {
    return `/?day=${day}`;
  }
  return href(day, page);
}

export function adjacentMobilePage(page: MobilePage, delta: -1 | 1): MobilePage | null {
  const index = MOBILE_PAGES.indexOf(page) + delta;
  if (index < 0 || index >= MOBILE_PAGES.length) {
    return null;
  }
  return MOBILE_PAGES[index]!;
}
