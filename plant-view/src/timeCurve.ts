import { curveWattsAt } from "./curveWatts";

type CurveData = {
  loggers: Record<string, { m: number; w: number; l?: number | null }[]>;
  tMin: number;
  tMax: number;
  window: number;
  pad: number;
};

export function activateTimeCurve(root: ParentNode = document): () => void {
  const el = root.querySelector("#curve-data");
  const svg = root.querySelector("#curve");
  const hair = root.querySelector("#hair");
  if (!(el instanceof HTMLElement) || svg === null || hair === null) {
    return () => undefined;
  }
  if (!(svg instanceof SVGElement)) {
    return () => undefined;
  }
  const data = JSON.parse(el.textContent || "null") as CurveData | null;
  if (!data?.loggers) {
    return () => undefined;
  }
  const curve: CurveData = data;
  const plot = svg;
  const line = hair;
  const pad = curve.pad || 18;
  const shown: Record<string, boolean> = { Plant: true };
  Object.keys(curve.loggers).forEach((n) => {
    shown[n] = true;
  });
  function xOf(t: number): number {
    const span = curve.tMax - curve.tMin;
    return span <= 0 ? pad : pad + ((t - curve.tMin) / span) * (400 - 2 * pad);
  }
  function loggerAt(
    points: { m: number; w: number; l?: number | null }[],
    t: number,
  ): number | null {
    return curveWattsAt(points, t, curve.window);
  }
  function fmtW(w: number | null | undefined): string {
    if (w == null) return "—";
    return (Math.abs(w - Math.round(w)) < 0.05 ? Math.round(w) : w.toFixed(1)) + " W";
  }
  function pad2(n: number): string {
    return String(n).padStart(2, "0");
  }
  function render(raw: number): void {
    const t = Math.max(curve.tMin, Math.min(curve.tMax, Math.round(raw)));
    const x = xOf(t);
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    let plant = 0;
    let any = false;
    const rows: Record<string, number | null> = {};
    for (const [name, pts] of Object.entries(curve.loggers)) {
      const got = loggerAt(pts, t);
      rows[name] = got;
      if (got != null) {
        plant += got;
        any = true;
      }
    }
    const when = pad2(Math.floor(t / 60)) + ":" + pad2(t % 60);
    const elWhen = root.querySelector("#readout-when");
    if (elWhen) elWhen.textContent = when;
    root.querySelectorAll("#readout [data-series]").forEach((node) => {
      const key = node.getAttribute("data-series");
      if (key === "Plant") {
        node.textContent = "Plant " + (any ? fmtW(plant) : "—");
      } else if (key) {
        node.textContent = key + " " + fmtW(rows[key]);
      }
    });
  }
  function fromEvent(ev: PointerEvent): void {
    if (typeof plot.getBoundingClientRect !== "function") return;
    const r = plot.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * 400;
    const span = curve.tMax - curve.tMin;
    const inner = 400 - 2 * pad;
    render(curve.tMin + ((x - pad) / inner) * span);
  }
  function onDown(ev: Event): void {
    const pointer = ev as PointerEvent;
    if (typeof plot.setPointerCapture === "function") {
      plot.setPointerCapture(pointer.pointerId);
    }
    fromEvent(pointer);
  }
  function onMove(ev: Event): void {
    const pointer = ev as PointerEvent;
    const captured =
      typeof plot.hasPointerCapture === "function" &&
      plot.hasPointerCapture(pointer.pointerId);
    if (!captured && !(pointer.buttons & 1)) return;
    fromEvent(pointer);
  }
  plot.addEventListener("pointerdown", onDown);
  plot.addEventListener("pointermove", onMove);
  function applyShown(): void {
    root.querySelectorAll("#curve [data-series]").forEach((node) => {
      const key = node.getAttribute("data-series");
      (node as HTMLElement).style.display = key && shown[key] ? "" : "none";
    });
    root.querySelectorAll("#readout [data-series]").forEach((node) => {
      const key = node.getAttribute("data-series");
      (node as HTMLElement).hidden = !(key && shown[key]);
    });
    root.querySelectorAll(".series-toggle").forEach((btn) => {
      const key = btn.getAttribute("data-series");
      const on = !!(key && shown[key]);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-off", !on);
    });
  }
  const toggles = [...root.querySelectorAll(".series-toggle")];
  const onToggle = (ev: Event) => {
    const key = (ev.currentTarget as Element).getAttribute("data-series");
    if (!key) return;
    shown[key] = !shown[key];
    applyShown();
  };
  toggles.forEach((btn) => btn.addEventListener("click", onToggle));
  applyShown();
  render(12 * 60);
  return () => {
    plot.removeEventListener("pointerdown", onDown);
    plot.removeEventListener("pointermove", onMove);
    toggles.forEach((btn) => btn.removeEventListener("click", onToggle));
  };
}
