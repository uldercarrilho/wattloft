export type LoggerPoint = { m: number; w: number; l?: number | null };

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

function lifetimeOk(a: LoggerPoint, b: LoggerPoint): boolean {
  const hours = (b.m - a.m) / 60;
  if (hours <= 0) return false;
  if (a.l == null || b.l == null) return false;
  const dL = b.l - a.l;
  if (dL <= 0.02) return false;
  const implied = (dL / hours) * 1000;
  const floor = Math.min(a.w, b.w) * 0.4;
  return implied >= Math.max(20, floor);
}

export function curveWattsAt(
  points: LoggerPoint[],
  t: number,
  windowMinutes: number,
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
    if (dt <= windowMinutes) {
      return a.w + s * (b.w - a.w);
    }
    if (!lifetimeOk(a, b)) return null;
    const prev = i > 0 ? points[i - 1] : null;
    const nxt = i + 2 < points.length ? points[i + 2] : null;
    const m0 = prev && a.m !== prev.m ? ((a.w - prev.w) / (a.m - prev.m)) * dt : b.w - a.w;
    const m1 = nxt && nxt.m !== b.m ? ((nxt.w - b.w) / (nxt.m - b.m)) * dt : b.w - a.w;
    return hermite(a.w, m0, b.w, m1, s);
  }
  return null;
}
