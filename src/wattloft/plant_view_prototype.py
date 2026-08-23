"""PROTOTYPE (throwaway). Plant view looks.

Question: given stepper-grain layout D, which colour / type / palette
should Plant view wear?
Answer: F Azulejo — tin-glaze paper, cobalt pigment, Ibarra Real Nova.
"""

from __future__ import annotations

import json
import os
from calendar import monthrange
from datetime import date, datetime, timedelta
from html import escape
from typing import NamedTuple
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from wattloft.history import CurvePoint, CurveSeries, PlantSnapshot
from wattloft.history._snapshot import LocalDayBar

_LOCAL = ZoneInfo("America/Sao_Paulo")
_TODAY = date(2026, 8, 23)
_SERIAL_A = "1000000001"
_SERIAL_B = "1000000002"


class _Skin(NamedTuple):
    key: str
    name: str
    fonts: str
    paper: str
    ink: str
    pigment: str
    muted: str
    chip: str
    on_pigment: str
    body: str
    display: str
    mono: str
    plant: str
    logger_a: str
    logger_b: str


_SKIN = _Skin(
    key="F",
    name="Azulejo",
    fonts=(
        "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500"
        "&family=Ibarra+Real+Nova:wght@600"
        "&family=Source+Sans+3:wght@400;500&display=swap"
    ),
    paper="#E8EEF2",
    ink="#1A2A3A",
    pigment="#1E4F8C",
    muted="#5A6B78",
    chip="#F7FAFC",
    on_pigment="#F4F7FA",
    body='"Source Sans 3", sans-serif',
    display='"Ibarra Real Nova", serif',
    mono='"IBM Plex Mono", monospace',
    plant="#1A2A3A",
    logger_a="#9B2C2C",
    logger_b="#2A6B5A",
)
_GRAINS = ("time", "day", "month", "year")
_GAP_MIN = 15

# Azulejo skin of layout D, on / (fixture server) and on the real Plant view
# route when WATTLOFT_PROTOTYPE=1.


def prototype_enabled() -> bool:
    return os.environ.get("WATTLOFT_PROTOTYPE") == "1"


def _all_bars() -> tuple[LocalDayBar, ...]:
    start = date(2025, 8, 1)
    n = (_TODAY - start).days + 1
    return tuple(
        LocalDayBar(
            local_day=start + timedelta(days=i),
            today_energy_kwh=round(
                4.2 + (i * 5 % 13) * 0.9 + (0 if (start + timedelta(days=i)).weekday() == 6 else 0),
                2,
            ),
        )
        for i in range(n)
    )


_BARS = _all_bars()


def fixture_snapshot(selected_day: date | None = None) -> PlantSnapshot:
    day = selected_day or _TODAY
    bars = _BARS
    logger_a = _sun_points(day, peak=420, hole=(10 * 60, 10 * 60 + 40))
    logger_b = _sun_points(day, peak=380, skip_minute=14 * 60)
    plant = _plant_series(logger_a, logger_b)
    last = datetime.now(_LOCAL) - timedelta(seconds=30)
    return PlantSnapshot(
        today_energy_kwh=12.4,
        current_power_w=625,
        lifetime_energy_kwh=5635.4,
        current_power_at=last,
        local_day_bars=bars,
        curve=(
            CurveSeries(name=_SERIAL_A, points=logger_a),
            CurveSeries(name=_SERIAL_B, points=logger_b),
            CurveSeries(name="Plant", points=plant),
        ),
    )


def _sun_points(
    day: date,
    *,
    peak: float,
    hole: tuple[int, int] | None = None,
    skip_minute: int | None = None,
) -> tuple[CurvePoint, ...]:
    points: list[CurvePoint] = []
    for minute in range(6 * 60, 18 * 60, 5):
        if hole is not None and hole[0] <= minute < hole[1]:
            continue
        if skip_minute is not None and minute == skip_minute:
            continue
        noon = 12 * 60
        span = 6 * 60
        x = max(-1.0, min(1.0, (minute - noon) / span))
        watts = round(max(0.0, (1 - x * x) * peak), 1)
        points.append(
            CurvePoint(
                at=datetime(day.year, day.month, day.day, minute // 60, minute % 60),
                watts=watts,
            )
        )
    return tuple(points)


def _plant_series(*series: tuple[CurvePoint, ...]) -> tuple[CurvePoint, ...]:
    by_minute: dict[datetime, float] = {}
    for points in series:
        for point in points:
            by_minute[point.at] = by_minute.get(point.at, 0.0) + point.watts
    return tuple(
        CurvePoint(at=minute, watts=watts) for minute, watts in sorted(by_minute.items())
    )


def render_prototype(
    snapshot: PlantSnapshot,
    *,
    variant: str,
    selected_day: date,
    unit: str = "time",
) -> str:
    grain = unit if unit in _GRAINS else "time"
    return _plant_page(snapshot, selected_day, grain, _SKIN)


def _day_kwh(snapshot: PlantSnapshot, selected_day: date) -> float | None:
    for bar in snapshot.local_day_bars:
        if bar.local_day == selected_day:
            return bar.today_energy_kwh
    return None


def _format_watts(watts: float) -> str:
    if watts == int(watts):
        return f"{int(watts)} W"
    return f"{watts:.1f} W"


def _format_kwh(kwh: float) -> str:
    return f"{kwh:.2f} kWh"


def _ago(at: datetime, now: datetime | None = None) -> str:
    stamp = at.astimezone(_LOCAL)
    here = (now or datetime.now(_LOCAL)).astimezone(_LOCAL)
    secs = max(0, int((here - stamp).total_seconds()))
    if secs < 60:
        return f"{secs}s ago"
    mins = secs // 60
    if mins < 60:
        return "1 minute ago" if mins == 1 else f"{mins} minutes ago"
    hours = mins // 60
    if hours < 24:
        return "1 hour ago" if hours == 1 else f"{hours} hours ago"
    days = hours // 24
    return "1 day ago" if days == 1 else f"{days} days ago"


def _last_sample(snapshot: PlantSnapshot) -> str:
    return _ago(snapshot.current_power_at)


def _last_sample_html(snapshot: PlantSnapshot) -> str:
    iso = snapshot.current_power_at.astimezone(_LOCAL).isoformat()
    return (
        f'<time id="last-sample" datetime="{escape(iso)}">'
        f"{escape(_last_sample(snapshot))}</time>"
    )


def _series_toggles(skin: _Skin) -> str:
    chips = (
        ("Plant", skin.plant),
        (_SERIAL_A, skin.logger_a),
        (_SERIAL_B, skin.logger_b),
    )
    buttons: list[str] = []
    for name, color in chips:
        buttons.append(
            f'<button type="button" class="series-toggle" '
            f'data-series="{escape(name)}" aria-pressed="true">'
            f'<i style="background:{color}"></i>{escape(name)}</button>'
        )
    return (
        '<div class="series-toggles" role="group" aria-label="Show or hide curves">'
        f"{''.join(buttons)}</div>"
    )


def _readout_shell() -> str:
    return (
        '<div class="readout" id="readout">'
        '<p class="when" id="readout-when">12:00</p>'
        '<p class="plant-w" id="readout-plant" data-series="Plant">Plant —</p>'
        f'<p class="a" id="readout-a" data-series="{escape(_SERIAL_A)}">'
        f"{escape(_SERIAL_A)} —</p>"
        f'<p class="b" id="readout-b" data-series="{escape(_SERIAL_B)}">'
        f"{escape(_SERIAL_B)} —</p>"
        "</div>"
    )


def _kpis(snapshot: PlantSnapshot) -> dict[str, str]:
    today = (
        _format_kwh(snapshot.today_energy_kwh)
        if snapshot.today_energy_kwh is not None
        else "-"
    )
    return {
        "today": today,
        "power": _format_watts(snapshot.current_power_w),
        "life": f"{snapshot.lifetime_energy_kwh:.1f} kWh",
        "asof": _last_sample(snapshot),
    }


def _state_seed(
    snapshot: PlantSnapshot, variant: str, selected_day: date, day_kwh: float | None
) -> str:
    k = _kpis(snapshot)
    return (
        f"skin: {_SKIN.key} ({_SKIN.name})\n"
        f"selected Local day: {selected_day.isoformat()}\n"
        f"that day's kWh: {day_kwh if day_kwh is not None else '—'}\n"
        f"Today energy: {k['today']}\n"
        f"Current Power: {k['power']}\n"
        f"Lifetime energy: {k['life']}\n"
        f"Last sample: {k['asof']}\n"
        "hair: 12:00\n"
        "curve watts Plant: (pending scrub)\n"
        f"curve watts {_SERIAL_A}: (pending)\n"
        f"curve watts {_SERIAL_B}: (pending)"
    )


_ASOF_JS = r"""
(function () {
  const el = document.getElementById("last-sample");
  if (!el) return;
  const at = Date.parse(el.getAttribute("datetime") || "");
  if (!Number.isFinite(at)) return;
  function label(ms) {
    const secs = Math.max(0, Math.floor(ms / 1000));
    if (secs < 60) return secs + "s ago";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins === 1 ? "1 minute ago" : mins + " minutes ago";
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : hours + " hours ago";
    const days = Math.floor(hours / 24);
    return days === 1 ? "1 day ago" : days + " days ago";
  }
  function tick() {
    const txt = label(Date.now() - at);
    el.textContent = txt;
    const pre = document.getElementById("prototype-state");
    if (pre) {
      pre.textContent = pre.textContent.replace(/^Last sample:.*$/m, "Last sample: " + txt);
    }
  }
  tick();
  setInterval(tick, 1000);
})();
"""


def _chrome(
    *,
    variant: str,
    fonts: str,
    css: str,
    body: str,
    snapshot: PlantSnapshot,
    selected_day: date,
    extra_script: str = "",
    curve_json: str = "{}",
) -> str:
    day_kwh = _day_kwh(snapshot, selected_day)
    state = escape(_state_seed(snapshot, variant, selected_day, day_kwh))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plant · prototype {escape(variant)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="{escape(fonts)}" rel="stylesheet">
<style>
.prototype-state {{
  position: fixed; left: 0.4rem; bottom: 0.4rem; z-index: 30;
  max-width: 16rem; max-height: 8.5rem; overflow: auto;
  background: #1a0a24; color: #f4d6ff; border: 2px solid #ff3bd4;
  font: 11px/1.35 ui-monospace, monospace; padding: 0.4rem 0.5rem;
  white-space: pre-wrap; pointer-events: none;
}}
.prototype-state strong {{ display: block; color: #ff3bd4; margin-bottom: 0.2rem; }}
{css}
</style>
</head>
<body>
<aside class="prototype-state" aria-label="Prototype state"><strong>PROTOTYPE</strong><pre id="prototype-state">{state}</pre></aside>
{body}
<script type="application/json" id="curve-data">{curve_json}</script>
{f"<script>{extra_script}</script>" if extra_script else ""}
<script>{_ASOF_JS}</script>
</body>
</html>
"""


def _logout() -> str:
    return '<form class="logout" method="post" action="/logout"><button type="submit">Log out</button></form>'


def _add_months(day: date, delta: int) -> date:
    month = day.month - 1 + delta
    year = day.year + month // 12
    month = month % 12 + 1
    last = monthrange(year, month)[1]
    return date(year, month, min(day.day, last))


def _d_href(day: date, unit: str, variant: str) -> str:
    return "/?" + urlencode(
        {"variant": variant, "unit": unit, "day": day.isoformat()}
    )


def _rich_points(
    day: date,
    *,
    peak: float,
    life0: float,
    hole: tuple[int, int] | None = None,
    skip_minute: int | None = None,
    dead: tuple[int, int] | None = None,
) -> list[dict[str, float]]:
    points: list[dict[str, float]] = []
    life = life0
    dt_h = 5 / 60
    for minute in range(6 * 60, 18 * 60 + 1, 5):
        noon = 12 * 60
        span = 6 * 60
        x = max(-1.0, min(1.0, (minute - noon) / span))
        watts = round(max(0.0, (1 - x * x) * peak), 1)
        in_dead = dead is not None and dead[0] <= minute < dead[1]
        skipped = (hole is not None and hole[0] <= minute < hole[1]) or (
            skip_minute is not None and minute == skip_minute
        )
        if not in_dead:
            life += watts * dt_h / 1000
        if skipped or in_dead:
            continue
        points.append({"m": float(minute), "w": watts, "l": round(life, 4)})
    return points


def _solar_window(loggers: dict[str, list[dict[str, float]]]) -> tuple[int, int]:
    minutes = [
        int(p["m"]) for pts in loggers.values() for p in pts if p["w"] > 1
    ]
    if not minutes:
        return 5 * 60, 19 * 60
    lo = max(0, min(minutes) - 60)
    hi = min(24 * 60, max(minutes) + 60)
    if hi <= lo:
        hi = lo + 60
    return lo, hi


def _x_solar(minute: float, t_min: int, t_max: int) -> float:
    return (minute - t_min) / (t_max - t_min) * 400


def _y_w(watts: float, max_watts: float) -> float:
    return 190 - (watts / max_watts) * 160


def _lifetime_supports_interp(a: dict[str, float], b: dict[str, float]) -> bool:
    hours = (b["m"] - a["m"]) / 60
    if hours <= 0:
        return False
    delta = b["l"] - a["l"]
    if delta <= 0.02:
        return False
    implied = (delta / hours) * 1000
    floor = min(a["w"], b["w"]) * 0.4
    return implied >= max(20.0, floor)


def _hermite(p0: float, m0: float, p1: float, m1: float, s: float) -> float:
    s2 = s * s
    s3 = s2 * s
    watts = (
        (2 * s3 - 3 * s2 + 1) * p0
        + (s3 - 2 * s2 + s) * m0
        + (-2 * s3 + 3 * s2) * p1
        + (s3 - s2) * m1
    )
    return max(0.0, watts)


def _span_tangents(
    pts: list[dict[str, float]], index: int
) -> tuple[float, float]:
    a = pts[index]
    b = pts[index + 1]
    dt = b["m"] - a["m"]
    prev = pts[index - 1] if index > 0 else None
    nxt = pts[index + 2] if index + 2 < len(pts) else None
    if prev is not None and a["m"] != prev["m"]:
        m0 = (a["w"] - prev["w"]) / (a["m"] - prev["m"]) * dt
    else:
        m0 = b["w"] - a["w"]
    if nxt is not None and nxt["m"] != b["m"]:
        m1 = (nxt["w"] - b["w"]) / (nxt["m"] - b["m"]) * dt
    else:
        m1 = b["w"] - a["w"]
    return m0, m1


def _valley_watts(a: dict[str, float], b: dict[str, float], t: float) -> float:
    dt = b["m"] - a["m"]
    if dt <= 0:
        return 0.0
    s = (t - a["m"]) / dt
    if s <= 0.5:
        u = s / 0.5
        return a["w"] * (1 - u) * (1 - u)
    u = (s - 0.5) / 0.5
    return b["w"] * u * u


def _gap_mode(a: dict[str, float], b: dict[str, float]) -> str:
    if b["m"] - a["m"] <= _GAP_MIN:
        return "near"
    if _lifetime_supports_interp(a, b):
        return "smooth"
    return "fail"


def _d_time_svg(
    loggers: dict[str, list[dict[str, float]]],
    *,
    t_min: int,
    t_max: int,
    max_watts: float,
    plant: str,
    a: str,
    b: str,
) -> str:
    colors = {_SERIAL_A: a, _SERIAL_B: b}
    parts: list[str] = [
        '<line class="axis" x1="0" y1="190" x2="400" y2="190"/>',
        '<text class="tick" x="2" y="188">0</text>',
        f'<text class="tick" x="2" y="28">{int(max_watts)} W</text>',
    ]
    hour = (t_min + 59) // 60
    end_h = t_max // 60
    while hour <= end_h:
        x = _x_solar(hour * 60, t_min, t_max)
        if 0 <= x <= 400:
            parts.append(
                f'<line class="grid" x1="{x:.1f}" y1="24" x2="{x:.1f}" y2="190"/>'
            )
            parts.append(
                f'<text class="tick" x="{x:.1f}" y="199" text-anchor="middle">'
                f"{hour:02d}</text>"
            )
        hour += 1

    def xy(minute: float, watts: float) -> str:
        return (
            f"{_x_solar(minute, t_min, t_max):.1f},"
            f"{_y_w(min(watts, max_watts), max_watts):.1f}"
        )

    def emit(coords: list[str], color: str, width: str, kind: str, series: str) -> None:
        if len(coords) < 2:
            return
        extra = ' fail' if kind == "fail" else ""
        parts.append(
            f'<polyline class="series{extra}" data-series="{escape(series)}" '
            f'fill="none" stroke="{color}" stroke-width="{width}" '
            f'stroke-linejoin="round" points="{" ".join(coords)}"/>'
        )

    def raster(
        pts: list[dict[str, float]],
    ) -> list[tuple[str, list[str]]]:
        chunks: list[tuple[str, list[str]]] = []
        if not pts:
            return chunks
        for i in range(len(pts) - 1):
            left, right = pts[i], pts[i + 1]
            mode = _gap_mode(left, right)
            step = 2.0
            coords = [xy(left["m"], left["w"])]
            t = left["m"] + step
            m0, m1 = _span_tangents(pts, i)
            while t < right["m"]:
                s = (t - left["m"]) / (right["m"] - left["m"])
                if mode == "fail":
                    watts = _valley_watts(left, right, t)
                elif mode == "smooth":
                    watts = _hermite(left["w"], m0, right["w"], m1, s)
                else:
                    watts = left["w"] + s * (right["w"] - left["w"])
                coords.append(xy(t, watts))
                t += step
            coords.append(xy(right["m"], right["w"]))
            chunks.append((mode, coords))
        return chunks

    plant_chunks: list[tuple[str, list[str]]] = []
    plant_kind = "near"
    plant_coords: list[str] = []
    minutes = list(range(t_min, t_max + 1, 2))
    if minutes[-1] != t_max:
        minutes.append(t_max)

    def logger_w(pts: list[dict[str, float]], minute: int) -> float | None:
        for i, point in enumerate(pts):
            if int(point["m"]) == minute:
                return point["w"]
        for i in range(len(pts) - 1):
            left, right = pts[i], pts[i + 1]
            if not (left["m"] < minute < right["m"]):
                continue
            mode = _gap_mode(left, right)
            if mode == "fail":
                return None
            s = (minute - left["m"]) / (right["m"] - left["m"])
            if mode == "smooth":
                m0, m1 = _span_tangents(pts, i)
                return _hermite(left["w"], m0, right["w"], m1, s)
            return left["w"] + s * (right["w"] - left["w"])
        return None

    for serial, pts in loggers.items():
        color = colors.get(serial, a)
        for mode, coords in raster(pts):
            kind = "fail" if mode == "fail" else "near"
            emit(coords, color, "1.2", kind, serial)

    for minute in minutes:
        watts = 0.0
        any_live = False
        for pts in loggers.values():
            got = logger_w(pts, minute)
            if got is None:
                continue
            any_live = True
            watts += got
        if not any_live:
            if plant_coords:
                plant_chunks.append((plant_kind, plant_coords))
                plant_coords = []
            continue
        plant_coords.append(xy(float(minute), watts))
        plant_kind = "near"
    if plant_coords:
        plant_chunks.append((plant_kind, plant_coords))
    for kind, coords in plant_chunks:
        emit(coords, plant, "2.4", kind, "Plant")

    parts.append(
        '<line id="hair" x1="200" y1="24" x2="200" y2="190" stroke="currentColor" '
        'stroke-width="1.2" opacity="0.85"/>'
    )
    return (
        '<svg viewBox="0 0 400 204" role="img" aria-label="Power curve" id="curve">'
        f"{''.join(parts)}</svg>"
    )


def _bar_kwh_label(kwh: float) -> str:
    if kwh >= 100:
        return f"{kwh:.0f}"
    return f"{kwh:.1f}"


def _d_energy_svg(
    rows: list[tuple[str, float, str, bool]],
) -> str:
    peak = max((kwh for _, kwh, _, _ in rows), default=1.0) or 1.0
    n = max(len(rows), 1)
    dense = n > 12
    gap = 400 / n
    base = 192.0
    max_h = 148.0
    bars: list[str] = []
    for i, (label, kwh, href, selected) in enumerate(rows):
        h = max(4.0, kwh / peak * max_h)
        x = i * gap + gap * 0.15
        w = gap * 0.7
        y = base - h
        cx = x + w / 2
        cls = "is-on" if selected else ""
        value = _bar_kwh_label(kwh)
        if dense:
            value_txt = (
                f'<text class="vlab" text-anchor="start" dominant-baseline="middle" '
                f'transform="rotate(-90 {cx:.1f} {y - 3:.1f})" '
                f'x="{cx:.1f}" y="{y - 3:.1f}">{escape(value)}</text>'
            )
        else:
            value_txt = (
                f'<text class="vlab" text-anchor="middle" x="{cx:.1f}" y="{y - 4:.1f}">'
                f"{escape(value)}</text>"
            )
        bars.append(
            f'<a href="{escape(href)}">'
            f'<rect class="ebar {cls}" x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" '
            f'height="{h:.1f}"/>'
            f"{value_txt}"
            f'<text class="tick" x="{cx:.1f}" y="204" text-anchor="middle">'
            f"{escape(label)}</text></a>"
        )
    return (
        '<svg viewBox="0 0 400 214" role="img" aria-label="Energy bars">'
        f"{''.join(bars)}</svg>"
    )


_STEPPER_JS = r"""
(function () {
  const el = document.getElementById("curve-data");
  const svg = document.getElementById("curve");
  if (!el || !svg) return;
  const data = JSON.parse(el.textContent);
  const hair = document.getElementById("hair");
  if (!data.loggers || !hair) return;
  function hermite(p0, m0, p1, m1, s) {
    const s2 = s * s, s3 = s2 * s;
    const w = (2*s3 - 3*s2 + 1)*p0 + (s3 - 2*s2 + s)*m0
      + (-2*s3 + 3*s2)*p1 + (s3 - s2)*m1;
    return Math.max(0, w);
  }
  function lifetimeOk(a, b) {
    const hours = (b.m - a.m) / 60;
    if (hours <= 0) return false;
    const dL = b.l - a.l;
    if (dL <= 0.02) return false;
    const implied = (dL / hours) * 1000;
    const floor = Math.min(a.w, b.w) * 0.4;
    return implied >= Math.max(20, floor);
  }
  function loggerAt(points, t) {
    for (let i = 0; i < points.length; i++) {
      if (points[i].m === t) return { w: points[i].w, est: false };
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (!(a.m < t && t < b.m)) continue;
      const dt = b.m - a.m;
      const s = (t - a.m) / dt;
      if (dt <= data.window) {
        return { w: a.w + s * (b.w - a.w), est: false };
      }
      if (!lifetimeOk(a, b)) return null;
      const prev = i > 0 ? points[i - 1] : null;
      const nxt = i + 2 < points.length ? points[i + 2] : null;
      const m0 = prev && a.m !== prev.m
        ? (a.w - prev.w) / (a.m - prev.m) * dt
        : b.w - a.w;
      const m1 = nxt && nxt.m !== b.m
        ? (nxt.w - b.w) / (nxt.m - b.m) * dt
        : b.w - a.w;
      return { w: hermite(a.w, m0, b.w, m1, s), est: false };
    }
    return null;
  }
  function fmtW(w) {
    if (w == null) return "—";
    return (Math.abs(w - Math.round(w)) < 0.05 ? Math.round(w) : w.toFixed(1)) + " W";
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function render(t) {
    t = Math.max(data.tMin, Math.min(data.tMax, Math.round(t)));
    const span = data.tMax - data.tMin;
    const x = span <= 0 ? 0 : (t - data.tMin) / span * 400;
    hair.setAttribute("x1", x);
    hair.setAttribute("x2", x);
    let plant = 0;
    let any = false;
    let anyEst = false;
    const rows = {};
    const flags = {};
    for (const [name, pts] of Object.entries(data.loggers)) {
      const got = loggerAt(pts, t);
      rows[name] = got ? got.w : null;
      flags[name] = !!(got && got.est);
      if (got) { plant += got.w; any = true; if (got.est) anyEst = true; }
    }
    const when = pad(Math.floor(t / 60)) + ":" + pad(t % 60);
    const plantTxt = any ? fmtW(plant) + (anyEst ? " est." : "") : "—";
    const elWhen = document.getElementById("readout-when");
    const elPlant = document.getElementById("readout-plant");
    const elA = document.getElementById("readout-a");
    const elB = document.getElementById("readout-b");
    if (elWhen) elWhen.textContent = when;
    if (elPlant) elPlant.textContent = "Plant " + plantTxt;
    const names = Object.keys(data.loggers);
    if (elA && names[0]) {
      elA.textContent = names[0] + " " + fmtW(rows[names[0]])
        + (flags[names[0]] ? " est." : "");
    }
    if (elB && names[1]) {
      elB.textContent = names[1] + " " + fmtW(rows[names[1]])
        + (flags[names[1]] ? " est." : "");
    }
    const pre = document.getElementById("prototype-state");
    if (pre) {
      const lines = pre.textContent.split("\n").filter(function (l) {
        return !l.startsWith("hair:") && !l.startsWith("curve watts");
      });
      lines.push("hair: " + when);
      lines.push("curve watts Plant: " + plantTxt);
      names.forEach(function (n) {
        lines.push("curve watts " + n + ": " + fmtW(rows[n])
          + (flags[n] ? " est." : ""));
      });
      pre.textContent = lines.join("\n");
    }
  }
  function fromEvent(ev) {
    const p = ev.touches ? ev.touches[0] : ev;
    const r = svg.getBoundingClientRect();
    const x = (p.clientX - r.left) / r.width * 400;
    const span = data.tMax - data.tMin;
    render(data.tMin + (x / 400) * span);
  }
  svg.addEventListener("pointerdown", function (ev) {
    svg.setPointerCapture(ev.pointerId);
    fromEvent(ev);
  });
  svg.addEventListener("pointermove", fromEvent);
  const shown = { Plant: true };
  Object.keys(data.loggers).forEach(function (n) { shown[n] = true; });
  function applyShown() {
    document.querySelectorAll("#curve [data-series]").forEach(function (node) {
      const key = node.getAttribute("data-series");
      node.style.display = shown[key] ? "" : "none";
    });
    document.querySelectorAll("#readout [data-series]").forEach(function (node) {
      const key = node.getAttribute("data-series");
      node.hidden = !shown[key];
    });
    document.querySelectorAll(".series-toggle").forEach(function (btn) {
      const key = btn.getAttribute("data-series");
      const on = !!shown[key];
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.classList.toggle("is-off", !on);
    });
  }
  document.querySelectorAll(".series-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const key = btn.getAttribute("data-series");
      shown[key] = !shown[key];
      applyShown();
    });
  });
  applyShown();
  render(12 * 60);
})();
"""


def _layout_css(skin: _Skin) -> str:
    return f"""
:root {{
  --paper:{skin.paper}; --ink:{skin.ink}; --pigment:{skin.pigment}; --muted:{skin.muted};
  --chip:{skin.chip}; --on-pigment:{skin.on_pigment};
  --plant:{skin.plant}; --logger-a:{skin.logger_a}; --logger-b:{skin.logger_b};
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; padding: 0 0 1.5rem; background: var(--paper); color: var(--ink);
  font: 16px/1.4 {skin.body}; }}
main {{ padding: 0.75rem 1rem 1.5rem; max-width: 42rem; }}
.logout {{ margin: 0 0 0.6rem; }}
.logout button {{ font: 500 0.9rem/1 {skin.body}; background: none;
  border: 0; padding: 0; color: var(--muted); text-decoration: underline; cursor: pointer; }}
.now {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem 1rem; margin: 0 0 0.9rem; }}
.now div {{ margin: 0; }}
.now dt {{ font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }}
.now dd {{ margin: 0; font-family: {skin.mono}; font-size: 1.05rem; }}
.stepper {{ display: flex; align-items: center; justify-content: center; gap: 1rem;
  margin: 0 0 0.75rem; font: 600 1.45rem/1 {skin.display}; }}
.stepper a, .stepper .dead {{ font: 500 1.6rem/1 {skin.body};
  text-decoration: none; color: var(--pigment); width: 2rem; text-align: center; }}
.stepper .dead {{ color: var(--muted); opacity: 0.35; }}
.grain {{ display: flex; margin: 0 0 1rem; border: 1px solid var(--ink); padding: 0; }}
.grain a {{ flex: 1; text-align: center; padding: 0.45rem 0.2rem; font-size: 0.82rem;
  color: var(--ink); text-decoration: none; border-right: 1px solid var(--ink); }}
.grain a:last-child {{ border-right: 0; }}
.grain a[aria-current="true"] {{ background: var(--pigment); color: var(--on-pigment); }}
#curve {{ width: 100%; height: auto; display: block; touch-action: none; color: var(--pigment); }}
.axis, .grid {{ stroke: var(--ink); stroke-opacity: 0.18; }}
.tick {{ font: 8px {skin.mono}; fill: var(--muted); }}
.vlab {{ font: 7px {skin.mono}; fill: var(--ink); }}
.fail {{ stroke-dasharray: 3 3; stroke-opacity: 0.5; }}
.series-toggles {{ display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.65rem 0 0.2rem; }}
.series-toggle {{
  display: inline-flex; align-items: center; gap: 0.4rem;
  min-height: 2.4rem; padding: 0.3rem 0.7rem;
  border: 1px solid var(--ink); background: var(--chip); color: var(--ink);
  font: 500 0.78rem/1.2 {skin.mono}; cursor: pointer;
}}
.series-toggle i {{ width: 0.7rem; height: 0.7rem; border-radius: 50%; flex: none; }}
.series-toggle.is-off {{ opacity: 0.4; border-style: dashed; }}
.series-toggle.is-off i {{ background: transparent !important; box-shadow: inset 0 0 0 2px currentColor; }}
.ebar {{ fill: var(--ink); opacity: 0.45; }}
.ebar.is-on {{ fill: var(--pigment); opacity: 1; }}
.readout {{ display: grid; grid-template-columns: auto 1fr; gap: 0.1rem 1rem; margin: 0.6rem 0 0;
  font-family: {skin.mono}; font-size: 0.85rem; }}
.readout .when {{ font-weight: 500; }}
.readout .plant-w {{ font-weight: 500; }}
.readout .a, .readout .b {{ grid-column: 1 / -1; color: var(--muted); font-size: 0.75rem; }}
.hint {{ font-size: 0.78rem; color: var(--muted); margin: 0.7rem 0 0; max-width: 36rem; }}
"""


def _plant_page(
    snapshot: PlantSnapshot, selected_day: date, unit: str, skin: _Skin
) -> str:
    k = _kpis(snapshot)
    first = _BARS[0].local_day
    last = _BARS[-1].local_day
    key = skin.key
    if unit == "time":
        prev_day = selected_day - timedelta(days=1)
        next_day = selected_day + timedelta(days=1)
        label = selected_day.isoformat()
        prev_h = _d_href(max(prev_day, first), "time", key) if prev_day >= first else ""
        next_h = _d_href(min(next_day, last), "time", key) if next_day <= last else ""
    elif unit == "day":
        prev_m = _add_months(selected_day.replace(day=1), -1)
        next_m = _add_months(selected_day.replace(day=1), 1)
        label = selected_day.strftime("%Y-%m")
        prev_h = _d_href(prev_m, "day", key) if prev_m >= first.replace(day=1) else ""
        next_h = _d_href(next_m, "day", key) if next_m <= last.replace(day=1) else ""
    elif unit == "month":
        prev_y = date(selected_day.year - 1, 1, 1)
        next_y = date(selected_day.year + 1, 1, 1)
        label = str(selected_day.year)
        prev_h = _d_href(prev_y, "month", key) if prev_y.year >= first.year else ""
        next_h = _d_href(next_y, "month", key) if next_y.year <= last.year else ""
    else:
        label = f"{first.year}–{last.year}"
        prev_h = ""
        next_h = ""

    def _step(href: str, glyph: str, name: str) -> str:
        if not href:
            return f'<span class="dead" aria-hidden="true">{glyph}</span>'
        return f'<a href="{escape(href)}" aria-label="{name}">{glyph}</a>'

    grains = []
    for g, title in (
        ("time", "Time"),
        ("day", "Day"),
        ("month", "Month"),
        ("year", "Year"),
    ):
        cur = ' aria-current="true"' if g == unit else ""
        grains.append(
            f'<a href="{escape(_d_href(selected_day, g, key))}"{cur}>{title}</a>'
        )

    chart = ""
    readout = ""
    legend = ""
    extra = _STEPPER_JS if unit == "time" else ""
    payload: str | None = None
    if unit == "time":
        loggers = {
            _SERIAL_A: _rich_points(
                selected_day, peak=420, life0=4200.0, hole=(10 * 60, 10 * 60 + 40)
            ),
            _SERIAL_B: _rich_points(
                selected_day,
                peak=380,
                life0=3900.0,
                skip_minute=14 * 60,
                dead=(15 * 60, 15 * 60 + 35),
            ),
        }
        t_min, t_max = _solar_window(loggers)
        max_w = 800.0
        payload = json.dumps(
            {
                "loggers": loggers,
                "tMin": t_min,
                "tMax": t_max,
                "window": _GAP_MIN,
            }
        )
        chart = _d_time_svg(
            loggers,
            t_min=t_min,
            t_max=t_max,
            max_watts=max_w,
            plant=skin.plant,
            a=skin.logger_a,
            b=skin.logger_b,
        )
        readout = _readout_shell()
        legend = (
            '<p class="hint">Tap a name to show or hide its curve. '
            "A gap where Lifetime energy still rose is interpolated "
            "as a smooth Power curve — that energy happened. Where Lifetime barely "
            "moved, the line valleys: no Samples and no estimate, possible Logger failure.</p>"
        )
    elif unit == "day":
        month_rows: list[tuple[str, float, str, bool]] = []
        for bar in _BARS:
            if bar.local_day.year == selected_day.year and bar.local_day.month == selected_day.month:
                month_rows.append(
                    (
                        str(bar.local_day.day),
                        bar.today_energy_kwh,
                        _d_href(bar.local_day, "time", key),
                        bar.local_day == selected_day,
                    )
                )
        chart = _d_energy_svg(month_rows)
        legend = '<p class="hint">Today energy for each Local day this month. Tap a day to open Time.</p>'
    elif unit == "month":
        by_month: dict[tuple[int, int], float] = {}
        for bar in _BARS:
            if bar.local_day.year == selected_day.year:
                mkey = (bar.local_day.year, bar.local_day.month)
                by_month[mkey] = by_month.get(mkey, 0.0) + bar.today_energy_kwh
        month_rows = [
            (
                date(y, m, 1).strftime("%b"),
                kwh,
                _d_href(date(y, m, 1), "day", key),
                m == selected_day.month,
            )
            for (y, m), kwh in sorted(by_month.items())
        ]
        chart = _d_energy_svg(month_rows)
        legend = '<p class="hint">Sum of Local-day Today energy in this year. Prototype-only — not a v1 Plant view surface.</p>'
    else:
        by_year: dict[int, float] = {}
        for bar in _BARS:
            by_year[bar.local_day.year] = (
                by_year.get(bar.local_day.year, 0.0) + bar.today_energy_kwh
            )
        year_rows = [
            (str(y), kwh, _d_href(date(y, 1, 1), "month", key), y == selected_day.year)
            for y, kwh in sorted(by_year.items())
        ]
        chart = _d_energy_svg(year_rows)
        legend = '<p class="hint">Sum of Local-day Today energy per year. Prototype-only — not a v1 Plant view surface.</p>'

    body = f"""
<main>
{_logout()}
<dl class="now">
<div><dt>Today energy</dt><dd>{escape(k['today'])}</dd></div>
<div><dt>Current Power</dt><dd>{escape(k['power'])}</dd></div>
<div><dt>Lifetime energy</dt><dd>{escape(k['life'])}</dd></div>
<div><dt>Last sample</dt><dd>{_last_sample_html(snapshot)}</dd></div>
</dl>
<nav class="stepper" aria-label="Period">
{_step(prev_h, "‹", "Previous")}
<span>{escape(label)}</span>
{_step(next_h, "›", "Next")}
</nav>
<nav class="grain" aria-label="Chart grain">{"".join(grains)}</nav>
{chart}
{_series_toggles(skin) if unit == "time" else ""}
{readout}
{legend}
</main>
"""
    return _chrome(
        variant=skin.key,
        fonts=skin.fonts,
        css=_layout_css(skin),
        body=body,
        snapshot=snapshot,
        selected_day=selected_day,
        extra_script=extra,
        curve_json=payload if payload is not None else "{}",
    )


def _parse_day(raw: str | None) -> date | None:
    if raw is None:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


async def _prototype_page(request: Request) -> Response:
    variant = request.query_params.get("variant") or "F"
    selected = _parse_day(request.query_params.get("day")) or _TODAY
    snapshot = fixture_snapshot(selected)
    unit = request.query_params.get("unit") or "time"
    return HTMLResponse(
        render_prototype(snapshot, variant=variant, selected_day=selected, unit=unit)
    )


async def _logout_route(_request: Request) -> Response:
    return RedirectResponse("/", status_code=303)


def create_prototype_app() -> Starlette:
    return Starlette(
        routes=[
            Route("/", _prototype_page),
            Route("/logout", _logout_route, methods=["POST"]),
        ]
    )


def main() -> None:
    host = os.environ.get("PLANT_VIEW_HOST", "127.0.0.1")
    port = int(os.environ.get("PLANT_VIEW_PROTOTYPE_PORT", "8765"))
    print(f"Plant view prototype http://{host}:{port}/?variant=F")
    uvicorn.run(create_prototype_app(), host=host, port=port)


if __name__ == "__main__":
    main()
