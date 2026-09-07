export type ChartMode = "overlay" | "stack";

export const CHART_MODE_KEY = "wattloft.chartMode";
export const MODE_HINT_KEY = "wattloft.modeHintSeen";

export function parseChartMode(raw: string | null | undefined): ChartMode {
  return raw === "stack" ? "stack" : "overlay";
}

export function readChartMode(storage: { getItem(key: string): string | null }): ChartMode {
  try {
    return parseChartMode(storage.getItem(CHART_MODE_KEY));
  } catch {
    return "overlay";
  }
}

export function writeChartMode(
  storage: { setItem(key: string, value: string): void },
  mode: ChartMode,
): void {
  try {
    storage.setItem(CHART_MODE_KEY, mode);
  } catch {
    /* localStorage may be unavailable */
  }
}

export function readModeHintSeen(storage: { getItem(key: string): string | null }): boolean {
  try {
    return storage.getItem(MODE_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeModeHintSeen(storage: { setItem(key: string, value: string): void }): void {
  try {
    storage.setItem(MODE_HINT_KEY, "1");
  } catch {
    /* localStorage may be unavailable */
  }
}
