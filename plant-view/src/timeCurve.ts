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
  function hermite(p0: number, m0: number, p1: number, m1: number, s: number): number {
    const s2 = s * s;
    const s3 = s2 * s;
    const w =
      (2 * s3 - 3 * s2 + 1) * p0 +
      (s3 - 2 * s2 + s) * m0 +
      (-2 * s3 + 3 * s2) * p1 +
      (s3 - s2) * m1;
    return Math.max(0, w);
  }
  function lifetimeOk(
    a: { m: number; w: number; l?: number | null },
    b: { m: number; w: number; l?: number | null },
  ): boolean {
    const hours = (b.m - a.m) / 60;
    if (hours <= 0) return false;
    if (a.l == null || b.l == null) return false;
    const dL = b.l - a.l;
    if (dL <= 0.02) return false;
    const implied = (dL / hours) * 1000;
    const floor = Math.min(a.w, b.w) * 0.4;
    return implied >= Math.max(20, floor);
  }
  function loggerAt(
    points: { m: number; w: number; l?: number | null }[],
    t: number,
  ): number | null {
    for (let i = 0; i < points.length; i++) {
      if (points[i]!.m === t) return points[i]!.w;
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (!(a.m < t && t < b.m)) continue;
      const dt = b.m - a.m;
      const s = (t - a.m) / dt;
      if (dt <= curve.window) {
        return a.w + s * (b.w - a.w);
      }
      if (!lifetimeOk(a, b)) return null;
      const prev = i > 0 ? points[i - 1] : null;
      const nxt = i + 2 < points.length ? points[i + 2] : null;
      const m0 =
        prev && a.m !== prev.m ? ((a.w - prev.w) / (a.m - prev.m)) * dt : b.w - a.w;
      const m1 =
        nxt && nxt.m !== b.m ? ((nxt.w - b.w) / (nxt.m - b.m)) * dt : b.w - a.w;
      return hermite(a.w, m0, b.w, m1, s);
    }
    return null;
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
