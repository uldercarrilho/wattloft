from __future__ import annotations

import asyncio
import hmac
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from html import escape
from zoneinfo import ZoneInfo

from starlette.applications import Starlette
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from wattloft.config import ADMITTED_LOGGER_SERIALS, now_utc
from wattloft.history import CurvePoint, CurveSeries, PlantSnapshot, plant_snapshot
from wattloft.ingest import start_ingest

_LOCAL = ZoneInfo("America/Sao_Paulo")
_FONTS = (
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500"
    "&family=Ibarra+Real+Nova:wght@600"
    "&family=Source+Sans+3:wght@400;500&display=swap"
)
_CSS = """
:root {
  --paper:#E8EEF2; --ink:#1A2A3A; --pigment:#1E4F8C; --muted:#5A6B78;
  --chip:#F7FAFC; --on-pigment:#F4F7FA;
  --plant:#1A2A3A; --logger-a:#9B2C2C; --logger-b:#2A6B5A;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 0 1.5rem; background: var(--paper); color: var(--ink);
  font: 16px/1.4 "Source Sans 3", sans-serif; max-width: 100%; }
main { padding: 0.75rem 1rem 1.5rem; max-width: 42rem; }
h1 { font: 600 1.7rem/1.1 "Ibarra Real Nova", serif; margin: 0 0 0.75rem; }
.logout { margin: 0 0 0.6rem; }
.logout button { font: 500 0.9rem/1 "Source Sans 3", sans-serif; background: none;
  border: 0; padding: 0; color: var(--muted); text-decoration: underline;
  cursor: pointer; min-height: 2.4rem; }
.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem 1rem; margin: 0 0 0.9rem; }
.kpis div { margin: 0; }
.kpis dt { font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
.kpis dd { margin: 0; font-family: "IBM Plex Mono", monospace; font-size: 1.05rem; }
.login { max-width: 22rem; }
.login label { display: block; font-size: 1rem; color: var(--ink); margin: 0 0 0.45rem; }
.login input { display: block; width: 100%; max-width: 100%; font-size: 1rem;
  padding: 0.65rem 0.75rem; border: 1px solid var(--ink); background: var(--chip); color: var(--ink); }
.login button { margin-top: 0.8rem; min-height: 2.6rem; padding: 0.5rem 1.1rem;
  font: 500 1rem/1 "Source Sans 3", sans-serif; border: 0; background: var(--pigment);
  color: var(--on-pigment); cursor: pointer; }
.empty { margin: 0; }
ol.days { list-style: none; padding: 0; margin: 0 0 1rem; max-width: 100%; }
ol.days a { display: block; box-sizing: border-box; max-width: 100%;
  padding: 0.5rem 0.7rem; margin: 0.25rem 0; background: var(--pigment);
  color: var(--on-pigment); text-decoration: none;
  font-family: "IBM Plex Mono", monospace; font-size: 0.85rem; }
svg, .series-toggles, .readout, dl, form { max-width: 100%; }
svg { width: 100%; height: auto; display: block; }
#curve { touch-action: none; color: var(--ink); }
.axis, .grid { stroke: var(--ink); stroke-opacity: 0.18; }
.tick { font: 8px "IBM Plex Mono", monospace; fill: var(--muted); }
#curve .series-plant { stroke: var(--plant); }
#curve .series-a { stroke: var(--logger-a); }
#curve .series-b { stroke: var(--logger-b); }
#curve circle.series-plant { fill: var(--plant); stroke: none; }
#curve circle.series-a { fill: var(--logger-a); stroke: none; }
#curve circle.series-b { fill: var(--logger-b); stroke: none; }
#curve polyline.fail { stroke-dasharray: 3 3; stroke-opacity: 0.5; }
:focus-visible { outline: 2px solid var(--pigment); outline-offset: 2px; }
.series-toggles { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.65rem 0 0.2rem; }
.series-toggle {
  display: inline-flex; align-items: center; gap: 0.4rem;
  min-height: 2.4rem; padding: 0.3rem 0.7rem;
  border: 1px solid var(--ink); background: var(--chip); color: var(--ink);
  font: 500 0.78rem/1.2 "IBM Plex Mono", monospace; cursor: pointer;
}
.series-toggle i { width: 0.7rem; height: 0.7rem; border-radius: 50%; flex: none; }
.series-toggle.series-plant i { background: var(--plant); }
.series-toggle.series-a i { background: var(--logger-a); }
.series-toggle.series-b i { background: var(--logger-b); }
.series-toggle.is-off { opacity: 0.4; border-style: dashed; }
.series-toggle.is-off i { background: transparent; box-shadow: inset 0 0 0 2px currentColor; }
.readout { display: grid; grid-template-columns: auto 1fr; gap: 0.1rem 1rem; margin: 0.6rem 0 0;
  font-family: "IBM Plex Mono", monospace; font-size: 0.85rem; }
.readout .when { font-weight: 500; }
.readout .series-plant { font-weight: 500; color: var(--plant); }
.readout .series-a, .readout .series-b { grid-column: 1 / -1; color: var(--muted); font-size: 0.75rem; }
.hint { font-size: 0.78rem; color: var(--muted); margin: 0.7rem 0 0; max-width: 36rem; }
.grain { display: flex; margin: 0 0 1rem; border: 1px solid var(--ink); padding: 0; }
.grain a { flex: 1; text-align: center; padding: 0.45rem 0.2rem; font-size: 0.82rem;
  color: var(--ink); text-decoration: none; border-right: 1px solid var(--ink); }
.grain a:last-child { border-right: 0; }
.grain a[aria-current="true"] { background: var(--pigment); color: var(--on-pigment); }
.stepper { display: flex; align-items: center; justify-content: center; gap: 1rem;
  margin: 0 0 0.75rem; font: 600 1.45rem/1 "Ibarra Real Nova", serif; }
.stepper a, .stepper .dead { font: 500 1.6rem/1 "Source Sans 3", sans-serif;
  text-decoration: none; color: var(--pigment); width: 2rem; text-align: center; }
.stepper .dead { color: var(--muted); opacity: 0.35; }
"""
_LAST_SAMPLE_JS = """
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
    el.textContent = label(Date.now() - at);
  }
  tick();
  setInterval(tick, 1000);
})();
"""
_TIME_JS = r"""
(function () {
  const el = document.getElementById("curve-data");
  const svg = document.getElementById("curve");
  const hair = document.getElementById("hair");
  if (!el || !svg || !hair) return;
  const data = JSON.parse(el.textContent);
  if (!data.loggers) return;
  const pad = data.pad || 18;
  const shown = { Plant: true };
  Object.keys(data.loggers).forEach(function (n) { shown[n] = true; });
  function xOf(t) {
    const span = data.tMax - data.tMin;
    return span <= 0 ? pad : pad + (t - data.tMin) / span * (400 - 2 * pad);
  }
  function hermite(p0, m0, p1, m1, s) {
    const s2 = s * s, s3 = s2 * s;
    const w = (2*s3 - 3*s2 + 1)*p0 + (s3 - 2*s2 + s)*m0
      + (-2*s3 + 3*s2)*p1 + (s3 - s2)*m1;
    return Math.max(0, w);
  }
  function lifetimeOk(a, b) {
    const hours = (b.m - a.m) / 60;
    if (hours <= 0) return false;
    if (a.l == null || b.l == null) return false;
    const dL = b.l - a.l;
    if (dL <= 0.02) return false;
    const implied = (dL / hours) * 1000;
    const floor = Math.min(a.w, b.w) * 0.4;
    return implied >= Math.max(20, floor);
  }
  function loggerAt(points, t) {
    for (let i = 0; i < points.length; i++) {
      if (points[i].m === t) return points[i].w;
    }
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (!(a.m < t && t < b.m)) continue;
      const dt = b.m - a.m;
      const s = (t - a.m) / dt;
      if (dt <= data.window) {
        return a.w + s * (b.w - a.w);
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
      return hermite(a.w, m0, b.w, m1, s);
    }
    return null;
  }
  function fmtW(w) {
    if (w == null) return "—";
    return (Math.abs(w - Math.round(w)) < 0.05 ? Math.round(w) : w.toFixed(1)) + " W";
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function render(t) {
    t = Math.max(data.tMin, Math.min(data.tMax, Math.round(t)));
    const x = xOf(t);
    hair.setAttribute("x1", x);
    hair.setAttribute("x2", x);
    let plant = 0;
    let any = false;
    const rows = {};
    for (const [name, pts] of Object.entries(data.loggers)) {
      const got = loggerAt(pts, t);
      rows[name] = got;
      if (got != null) { plant += got; any = true; }
    }
    const when = pad2(Math.floor(t / 60)) + ":" + pad2(t % 60);
    const elWhen = document.getElementById("readout-when");
    if (elWhen) elWhen.textContent = when;
    document.querySelectorAll("#readout [data-series]").forEach(function (node) {
      const key = node.getAttribute("data-series");
      if (key === "Plant") {
        node.textContent = "Plant " + (any ? fmtW(plant) : "—");
      } else {
        node.textContent = key + " " + fmtW(rows[key]);
      }
    });
  }
  function fromEvent(ev) {
    const p = ev.touches ? ev.touches[0] : ev;
    const r = svg.getBoundingClientRect();
    const x = (p.clientX - r.left) / r.width * 400;
    const span = data.tMax - data.tMin;
    const inner = 400 - 2 * pad;
    render(data.tMin + ((x - pad) / inner) * span);
  }
  svg.addEventListener("pointerdown", function (ev) {
    svg.setPointerCapture(ev.pointerId);
    fromEvent(ev);
  });
  svg.addEventListener("pointermove", function (ev) {
    if (!svg.hasPointerCapture(ev.pointerId) && !(ev.buttons & 1)) return;
    fromEvent(ev);
  });
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
_LOGOUT = (
    '<form class="logout" method="post" action="/logout">'
    '<button type="submit">Log out</button></form>'
)


def _document(body: str, *, script: str = "") -> str:
    script_tag = f"<script>{script}</script>" if script else ""
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "<title>Plant</title>\n"
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        f'<link href="{escape(_FONTS)}" rel="stylesheet">\n'
        f"<style>{_CSS}</style>\n"
        "</head>\n"
        f"<body>\n<main>\n{body}\n</main>\n{script_tag}\n</body>\n"
        "</html>\n"
    )


_LOGIN = _document(
    "<h1>Plant</h1>\n"
    '<form class="login" method="post" action="/login">\n'
    '<label>Password <input type="password" name="password" required></label>\n'
    '<button type="submit">Log in</button>\n'
    "</form>"
)
_EMPTY_HISTORY = _document(
    f"{_LOGOUT}\n<h1>Plant</h1>\n"
    '<p class="empty">This Plant has no History yet.</p>'
)


def _format_watts(watts: float) -> str:
    if watts == int(watts):
        return f"{int(watts)} W"
    return f"{watts} W"


def _watts_attr(watts: float) -> str:
    if watts == int(watts):
        return str(int(watts))
    return str(watts)


def _parse_day(raw: str | None) -> date | None:
    if raw is None:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _parse_unit(raw: str | None) -> str:
    if raw in ("time", "day", "month", "year"):
        return raw
    return "time"


def _history_span(snapshot: PlantSnapshot) -> tuple[date, date]:
    days = [bar.local_day for bar in snapshot.local_day_bars]
    if not days:
        today = now_utc().astimezone(_LOCAL).date()
        return today, today
    return days[0], days[-1]


def _selected_day(raw: str | None, snapshot: PlantSnapshot) -> date:
    first, last = _history_span(snapshot)
    requested = _parse_day(raw)
    if requested is None:
        requested = last
    if requested < first:
        return first
    if requested > last:
        return last
    return requested


def _href(day: date, unit: str) -> str:
    return f"/?day={day.isoformat()}&unit={unit}"


def _render_grain(selected_day: date, unit: str) -> str:
    links: list[str] = []
    for grain, title in (
        ("time", "Time"),
        ("day", "Day"),
        ("month", "Month"),
        ("year", "Year"),
    ):
        current = ' aria-current="true"' if grain == unit else ""
        links.append(
            f'<a href="{escape(_href(selected_day, grain))}"{current}>{title}</a>'
        )
    return f'<nav class="grain" aria-label="Grain">{"".join(links)}</nav>'


def _step_control(href: str, glyph: str, name: str) -> str:
    if not href:
        return f'<span class="dead" aria-hidden="true">{glyph}</span>'
    return f'<a href="{escape(href)}" aria-label="{name}">{glyph}</a>'


def _add_months(day: date, delta: int) -> date:
    month = day.month - 1 + delta
    year = day.year + month // 12
    month = month % 12 + 1
    last = monthrange(year, month)[1]
    return date(year, month, min(day.day, last))


def _render_stepper(
    selected_day: date, unit: str, snapshot: PlantSnapshot
) -> str:
    first, last = _history_span(snapshot)
    if unit == "day":
        label = selected_day.strftime("%Y-%m")
        prev_month = _add_months(selected_day.replace(day=1), -1)
        next_month = _add_months(selected_day.replace(day=1), 1)
        prev_href = (
            _href(max(prev_month, first), "day")
            if prev_month >= first.replace(day=1)
            else ""
        )
        next_href = (
            _href(min(next_month, last), "day")
            if next_month <= last.replace(day=1)
            else ""
        )
    elif unit == "month":
        label = str(selected_day.year)
        prev_year = selected_day.year - 1
        next_year = selected_day.year + 1
        prev_href = (
            _href(_anchor_in_year(snapshot, prev_year, selected_day), "month")
            if prev_year >= first.year
            else ""
        )
        next_href = (
            _href(_anchor_in_year(snapshot, next_year, selected_day), "month")
            if next_year <= last.year
            else ""
        )
    elif unit == "year":
        if first.year == last.year:
            label = str(first.year)
        else:
            label = f"{first.year}–{last.year}"
        prev_href = ""
        next_href = ""
    else:
        label = selected_day.isoformat()
        prev_day = selected_day - timedelta(days=1)
        next_day = selected_day + timedelta(days=1)
        prev_href = _href(prev_day, "time") if prev_day >= first else ""
        next_href = _href(next_day, "time") if next_day <= last else ""
    return (
        '<nav class="stepper" aria-label="Period">\n'
        f"{_step_control(prev_href, '‹', 'Previous')}\n"
        f"<span>{escape(label)}</span>\n"
        f"{_step_control(next_href, '›', 'Next')}\n"
        "</nav>"
    )


def _chart_body(snapshot: PlantSnapshot, selected_day: date, unit: str) -> str:
    if unit == "day":
        return f'<ol class="days">\n{_render_bars(snapshot, selected_day)}\n</ol>'
    if unit == "month":
        return (
            f'<ol class="days">\n{_render_month_bars(snapshot, selected_day)}\n</ol>'
        )
    if unit == "year":
        return f'<ol class="days">\n{_render_year_bars(snapshot, selected_day)}\n</ol>'
    if not snapshot.curve:
        return '<p class="empty">This Local day has no curve Samples.</p>'
    return _render_curve(snapshot)


def _format_kwh(kwh: float) -> str:
    return f"{kwh:.2f} kWh"


def _anchor_in_month(
    snapshot: PlantSnapshot, year: int, month: int, selected_day: date
) -> date:
    if selected_day.year == year and selected_day.month == month:
        return selected_day
    for bar in snapshot.local_day_bars:
        if bar.local_day.year == year and bar.local_day.month == month:
            return bar.local_day
    return date(year, month, 1)


def _anchor_in_year(
    snapshot: PlantSnapshot, year: int, selected_day: date
) -> date:
    if selected_day.year == year:
        return selected_day
    for bar in snapshot.local_day_bars:
        if bar.local_day.year == year:
            return bar.local_day
    return date(year, 1, 1)


def _energy_bars(
    rows: list[tuple[str, str, float, bool]], peak: float
) -> str:
    items: list[str] = []
    for href, label, kwh, current in rows:
        width = 100 if peak <= 0 else max(12.0, kwh / peak * 100)
        marked = ' aria-current="true"' if current else ""
        items.append(
            f'<li><a href="{escape(href)}"{marked} '
            f'style="width:{width:.0f}%">{escape(label)}</a></li>'
        )
    return "\n".join(items)


def _render_bars(snapshot: PlantSnapshot, selected_day: date) -> str:
    month_bars = tuple(
        bar
        for bar in snapshot.local_day_bars
        if bar.local_day.year == selected_day.year
        and bar.local_day.month == selected_day.month
    )
    peak = max((bar.today_energy_kwh for bar in month_bars), default=0)
    rows = [
        (
            _href(bar.local_day, "time"),
            f"{bar.local_day.isoformat()} {_format_kwh(bar.today_energy_kwh)}",
            bar.today_energy_kwh,
            False,
        )
        for bar in month_bars
    ]
    return _energy_bars(rows, peak)


def _render_month_bars(snapshot: PlantSnapshot, selected_day: date) -> str:
    by_month: dict[tuple[int, int], float] = {}
    for bar in snapshot.local_day_bars:
        if bar.local_day.year == selected_day.year:
            key = (bar.local_day.year, bar.local_day.month)
            by_month[key] = by_month.get(key, 0.0) + bar.today_energy_kwh
    peak = max(by_month.values(), default=0)
    rows = [
        (
            _href(_anchor_in_month(snapshot, year, month, selected_day), "day"),
            f"{year:04d}-{month:02d} {_format_kwh(kwh)}",
            kwh,
            month == selected_day.month,
        )
        for (year, month), kwh in sorted(by_month.items())
    ]
    return _energy_bars(rows, peak)


def _render_year_bars(snapshot: PlantSnapshot, selected_day: date) -> str:
    by_year: dict[int, float] = {}
    for bar in snapshot.local_day_bars:
        year = bar.local_day.year
        by_year[year] = by_year.get(year, 0.0) + bar.today_energy_kwh
    peak = max(by_year.values(), default=0)
    rows = [
        (
            _href(_anchor_in_year(snapshot, year, selected_day), "month"),
            f"{year} {_format_kwh(kwh)}",
            kwh,
            year == selected_day.year,
        )
        for year, kwh in sorted(by_year.items())
    ]
    return _energy_bars(rows, peak)


_GAP_MIN = 15
_PAD_X = 18
_POWER_FLOOR = 1.0


def _minute_of_day(point: CurvePoint) -> int:
    return point.at.hour * 60 + point.at.minute


def _solar_window(snapshot: PlantSnapshot) -> tuple[int, int]:
    minutes = [
        _minute_of_day(point)
        for series in snapshot.curve
        if series.name != "Plant"
        for point in series.points
        if point.watts > _POWER_FLOOR
    ]
    if not minutes:
        minutes = [
            _minute_of_day(point)
            for series in snapshot.curve
            if series.name != "Plant"
            for point in series.points
        ]
    if not minutes:
        return 0, 23 * 60 + 59
    lo = max(0, min(minutes) - 60)
    hi = min(23 * 60 + 59, max(minutes) + 60)
    if hi <= lo:
        hi = min(23 * 60 + 59, lo + 60)
    return lo, hi


def _x_solar(minute: float, t_min: int, t_max: int) -> float:
    span = t_max - t_min
    if span <= 0:
        return float(_PAD_X)
    return _PAD_X + (minute - t_min) / span * (400 - 2 * _PAD_X)


def _y_watts(watts: float, max_watts: float) -> float:
    return 190 - (watts / max_watts) * 160


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


def _valley_watts(left: CurvePoint, right: CurvePoint, minute: float) -> float:
    dt = _minute_of_day(right) - _minute_of_day(left)
    if dt <= 0:
        return 0.0
    s = (minute - _minute_of_day(left)) / dt
    if s <= 0.5:
        u = s / 0.5
        return left.watts * (1 - u) * (1 - u)
    u = (s - 0.5) / 0.5
    return right.watts * u * u


def _lifetime_ok(left: CurvePoint, right: CurvePoint) -> bool:
    hours = (_minute_of_day(right) - _minute_of_day(left)) / 60
    if hours <= 0:
        return False
    if left.lifetime_kwh is None or right.lifetime_kwh is None:
        return False
    delta = right.lifetime_kwh - left.lifetime_kwh
    if delta <= 0.02:
        return False
    implied = (delta / hours) * 1000
    floor = min(left.watts, right.watts) * 0.4
    return implied >= max(20.0, floor)


def _gap_mode(left: CurvePoint, right: CurvePoint) -> str:
    if _minute_of_day(right) - _minute_of_day(left) <= _GAP_MIN:
        return "near"
    if _lifetime_ok(left, right):
        return "smooth"
    return "fail"


def _span_tangents(
    points: tuple[CurvePoint, ...], index: int
) -> tuple[float, float]:
    left = points[index]
    right = points[index + 1]
    dt = float(_minute_of_day(right) - _minute_of_day(left))
    prev = points[index - 1] if index > 0 else None
    nxt = points[index + 2] if index + 2 < len(points) else None
    left_m = _minute_of_day(left)
    right_m = _minute_of_day(right)
    if prev is not None and left_m != _minute_of_day(prev):
        m0 = (left.watts - prev.watts) / (left_m - _minute_of_day(prev)) * dt
    else:
        m0 = right.watts - left.watts
    if nxt is not None and _minute_of_day(nxt) != right_m:
        m1 = (nxt.watts - right.watts) / (_minute_of_day(nxt) - right_m) * dt
    else:
        m1 = right.watts - left.watts
    return m0, m1


def _watts_between(
    points: tuple[CurvePoint, ...], index: int, minute: float, mode: str
) -> float:
    left, right = points[index], points[index + 1]
    span = _minute_of_day(right) - _minute_of_day(left)
    s = (minute - _minute_of_day(left)) / span
    if mode == "fail":
        return _valley_watts(left, right, minute)
    if mode == "smooth":
        m0, m1 = _span_tangents(points, index)
        return _hermite(left.watts, m0, right.watts, m1, s)
    return left.watts + s * (right.watts - left.watts)


def _series_class(name: str, logger_index: int) -> str:
    if name == "Plant":
        return "series-plant"
    return ("series-a", "series-b")[logger_index % 2]


def _ordered_series(snapshot: PlantSnapshot) -> list[tuple[CurveSeries, str]]:
    loggers = [series for series in snapshot.curve if series.name != "Plant"]
    plant = [series for series in snapshot.curve if series.name == "Plant"]
    named: list[tuple[CurveSeries, str]] = []
    for series in plant:
        named.append((series, _series_class(series.name, 0)))
    for index, series in enumerate(loggers):
        named.append((series, _series_class(series.name, index)))
    return named


def _xy(
    point: CurvePoint, max_watts: float, t_min: int, t_max: int
) -> tuple[float, float]:
    return (
        _x_solar(_minute_of_day(point), t_min, t_max),
        _y_watts(point.watts, max_watts),
    )


def _logger_watts_at(points: tuple[CurvePoint, ...], minute: int) -> float | None:
    stamps = [_minute_of_day(point) for point in points]
    for index, stamped in enumerate(stamps):
        if stamped == minute:
            return points[index].watts
    for index in range(len(points) - 1):
        start, end = stamps[index], stamps[index + 1]
        if not (start < minute < end):
            continue
        mode = _gap_mode(points[index], points[index + 1])
        if mode == "fail":
            return None
        return _watts_between(points, index, float(minute), mode)
    return None


def _plant_watts_at(loggers: list[CurveSeries], minute: int) -> float | None:
    watts = 0.0
    any_live = False
    for series in loggers:
        got = _logger_watts_at(series.points, minute)
        if got is None:
            continue
        any_live = True
        watts += got
    if not any_live:
        return None
    return watts


def _raster_plant(
    loggers: list[CurveSeries],
    max_watts: float,
    t_min: int,
    t_max: int,
) -> str:
    minutes = list(range(t_min, t_max + 1, 2))
    if minutes and minutes[-1] != t_max:
        minutes.append(t_max)
    chunks: list[list[str]] = []
    line: list[str] = []
    for minute in minutes:
        watts = _plant_watts_at(loggers, minute)
        if watts is None:
            if len(line) >= 2:
                chunks.append(line)
            line = []
            continue
        x = _x_solar(minute, t_min, t_max)
        y = _y_watts(watts, max_watts)
        line.append(f"{x:.1f},{y:.1f}")
    if len(line) >= 2:
        chunks.append(line)
    polylines = "".join(
        f'<polyline class="series-plant" fill="none" stroke-width="2.4" '
        f'stroke-linejoin="round" points="{" ".join(pts)}"/>'
        for pts in chunks
    )
    stamps: dict[int, datetime] = {}
    for series in loggers:
        for point in series.points:
            stamps.setdefault(_minute_of_day(point), point.at)
    marks: list[str] = []
    for minute, at in sorted(stamps.items()):
        if not (t_min <= minute <= t_max):
            continue
        watts = _plant_watts_at(loggers, minute)
        if watts is None:
            continue
        x = _x_solar(minute, t_min, t_max)
        y = _y_watts(watts, max_watts)
        stamped = at.strftime("%Y-%m-%d %H:%M:%S")
        attr = _watts_attr(watts)
        title = escape(f"Plant {stamped} {_format_watts(watts)}")
        marks.append(
            f'<circle class="series-plant" cx="{x:.1f}" cy="{y:.1f}" r="3" '
            f'data-at="{escape(stamped)}" data-watts="{escape(attr)}">'
            f"<title>{title}</title></circle>"
        )
    return f"{polylines}{''.join(marks)}"


def _render_series(
    series: CurveSeries,
    max_watts: float,
    css_class: str,
    t_min: int,
    t_max: int,
    *,
    connect: bool,
    extra: str = "",
) -> str:
    if not connect:
        return f'<g data-series="{escape(series.name)}">{extra}</g>'
    visible = tuple(
        point
        for point in series.points
        if t_min <= _minute_of_day(point) <= t_max
    )
    marks: list[str] = []
    parts: list[str] = []
    for index in range(len(visible) - 1):
        left, right = visible[index], visible[index + 1]
        mode = _gap_mode(left, right)
        start = float(_minute_of_day(left))
        end = float(_minute_of_day(right))
        coords: list[str] = []
        minute = start
        while minute < end:
            watts = (
                left.watts
                if minute == start
                else _watts_between(visible, index, minute, mode)
            )
            x = _x_solar(minute, t_min, t_max)
            y = _y_watts(watts, max_watts)
            coords.append(f"{x:.1f},{y:.1f}")
            minute += 2.0
        x = _x_solar(end, t_min, t_max)
        y = _y_watts(right.watts, max_watts)
        coords.append(f"{x:.1f},{y:.1f}")
        if len(coords) >= 2:
            fail = " fail" if mode == "fail" else ""
            parts.append(
                f'<polyline class="{css_class}{fail}" fill="none" '
                f'stroke-width="1.2" stroke-linejoin="round" '
                f'points="{" ".join(coords)}"/>'
            )
    for point in visible:
        cx, cy = _xy(point, max_watts, t_min, t_max)
        at = point.at.strftime("%Y-%m-%d %H:%M:%S")
        attr = _watts_attr(point.watts)
        title = escape(f"{series.name} {at} {_format_watts(point.watts)}")
        marks.append(
            f'<circle class="{css_class}" cx="{cx:.1f}" cy="{cy:.1f}" r="3" '
            f'data-at="{escape(at)}" data-watts="{escape(attr)}">'
            f"<title>{title}</title></circle>"
        )
    return (
        f'<g data-series="{escape(series.name)}">{extra}'
        f'{"".join(parts)}{"".join(marks)}</g>'
    )


def _hour_labels(t_min: int, t_max: int) -> str:
    parts: list[str] = [
        '<line class="axis" x1="0" y1="190" x2="400" y2="190"/>',
    ]
    hour = (t_min + 59) // 60
    end_h = t_max // 60
    while hour <= end_h and hour < 24:
        x = _x_solar(hour * 60, t_min, t_max)
        if 0 <= x <= 400:
            parts.append(
                f'<line class="grid" x1="{x:.1f}" y1="24" x2="{x:.1f}" y2="190"/>'
                f'<text class="tick" x="{x:.1f}" y="205" text-anchor="middle">'
                f"{hour:02d}</text>"
            )
        hour += 1
    return "".join(parts)


def _series_toggles(named: list[tuple[CurveSeries, str]]) -> str:
    buttons: list[str] = []
    for series, css_class in named:
        buttons.append(
            f'<button type="button" class="series-toggle {css_class}" '
            f'data-series="{escape(series.name)}" aria-pressed="true">'
            f"<i></i>{escape(series.name)}</button>"
        )
    return (
        '<div class="series-toggles" role="group" '
        'aria-label="Show or hide curves">'
        f"{''.join(buttons)}</div>"
    )


def _readout(named: list[tuple[CurveSeries, str]]) -> str:
    rows = ['<p class="when" id="readout-when">12:00</p>']
    for series, css_class in named:
        ident = 'id="readout-plant" ' if series.name == "Plant" else ""
        rows.append(
            f'<p {ident}data-series="{escape(series.name)}" class="{css_class}">'
            f"{escape(series.name)} —</p>"
        )
    return f'<div class="readout" id="readout">{"".join(rows)}</div>'


def _render_curve(snapshot: PlantSnapshot) -> str:
    if not snapshot.curve:
        return ""
    t_min, t_max = _solar_window(snapshot)
    max_watts = max(
        (point.watts for series in snapshot.curve for point in series.points),
        default=0,
    )
    if max_watts <= 0:
        max_watts = 1
    named = _ordered_series(snapshot)
    loggers = [series for series, _css in named if series.name != "Plant"]
    groups = [
        _render_series(
            series,
            max_watts,
            css_class,
            t_min,
            t_max,
            connect=series.name != "Plant",
            extra=(
                _raster_plant(loggers, max_watts, t_min, t_max)
                if series.name == "Plant"
                else ""
            ),
        )
        for series, css_class in named
    ]
    parked = min(max(12 * 60, t_min), t_max)
    hair_x = _x_solar(parked, t_min, t_max)
    payload = json.dumps(
        {
            "loggers": {
                series.name: [
                    {
                        "m": _minute_of_day(point),
                        "w": point.watts,
                        "l": point.lifetime_kwh,
                    }
                    for point in series.points
                ]
                for series, _css in named
                if series.name != "Plant"
            },
            "tMin": t_min,
            "tMax": t_max,
            "window": _GAP_MIN,
            "pad": _PAD_X,
        },
        separators=(",", ":"),
    )
    return (
        '<svg viewBox="0 0 400 214" role="img" aria-label="Power curve" '
        'id="curve">'
        f"{_hour_labels(t_min, t_max)}{''.join(groups)}"
        f'<line id="hair" x1="{hair_x:.1f}" y1="24" x2="{hair_x:.1f}" '
        'y2="190" stroke="currentColor" stroke-width="1.2" opacity="0.85"/>'
        "</svg>"
        f"{_series_toggles(named)}"
        f"{_readout(named)}"
        '<p class="hint">Tap a name to show or hide its curve. '
        "A gap where Lifetime energy still rose is interpolated "
        "as a smooth Power curve — that energy happened. Where Lifetime barely "
        "moved, the line valleys: no Samples and no estimate, possible Logger failure.</p>"
        f'<script type="application/json" id="curve-data">{payload}</script>'
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _ago(at: datetime) -> str:
    stamp = _as_utc(at).astimezone(_LOCAL)
    here = now_utc().astimezone(_LOCAL)
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


def _last_sample_html(snapshot: PlantSnapshot) -> str:
    iso = _as_utc(snapshot.current_power_at).astimezone(_LOCAL).isoformat(
        timespec="seconds"
    )
    return (
        f'<time id="last-sample" datetime="{escape(iso)}">'
        f"{escape(_ago(snapshot.current_power_at))}</time>"
    )


def _render_kpis(
    snapshot: PlantSnapshot, selected_day: date, unit: str
) -> str:
    today = (
        _format_kwh(snapshot.today_energy_kwh)
        if snapshot.today_energy_kwh is not None
        else "-"
    )
    body = (
        f"{_LOGOUT}\n"
        "<h1>Plant</h1>\n"
        '<dl class="kpis">\n'
        f"<div><dt>Today energy</dt><dd>{escape(today)}</dd></div>\n"
        f"<div><dt>Current Power</dt><dd>{escape(_format_watts(snapshot.current_power_w))}</dd></div>\n"
        f"<div><dt>Lifetime energy</dt><dd>{escape(f'{snapshot.lifetime_energy_kwh:.1f} kWh')}</dd></div>\n"
        f"<div><dt>Last sample</dt><dd>{_last_sample_html(snapshot)}</dd></div>\n"
        "</dl>\n"
        f"{_render_stepper(selected_day, unit, snapshot)}\n"
        f"{_render_grain(selected_day, unit)}\n"
        f"{_chart_body(snapshot, selected_day, unit)}"
    )
    script = _LAST_SAMPLE_JS
    if unit == "time" and snapshot.curve:
        script += _TIME_JS
    return _document(body, script=script)


def create_app(
    operator_password: str,
    database_url: str,
    *,
    ingest_host: str = "0.0.0.0",
    ingest_port: int = 10000,
    admitted_logger_serials: frozenset[str] = ADMITTED_LOGGER_SERIALS,
) -> Starlette:
    async def plant_view(request: Request) -> Response:
        if not request.session.get("operator"):
            return HTMLResponse(_LOGIN, status_code=401)
        day_raw = request.query_params.get("day")
        requested = _parse_day(day_raw)
        snapshot = await asyncio.to_thread(plant_snapshot, database_url, requested)
        if snapshot is None:
            return HTMLResponse(_EMPTY_HISTORY)
        selected = _selected_day(day_raw, snapshot)
        if selected != requested:
            snapshot = await asyncio.to_thread(plant_snapshot, database_url, selected)
            if snapshot is None:
                return HTMLResponse(_EMPTY_HISTORY)
        unit = _parse_unit(request.query_params.get("unit"))
        return HTMLResponse(_render_kpis(snapshot, selected, unit))

    async def login(request: Request) -> Response:
        form = await request.form()
        offered = form.get("password", "")
        if not isinstance(offered, str) or not hmac.compare_digest(
            offered, operator_password
        ):
            return HTMLResponse(_LOGIN, status_code=401)
        request.session["operator"] = True
        return RedirectResponse("/", status_code=303)

    async def logout(request: Request) -> Response:
        request.session.clear()
        return RedirectResponse("/", status_code=303)

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncIterator[None]:
        server = await start_ingest(
            ingest_host, ingest_port, database_url, admitted_logger_serials
        )
        async with server:
            yield

    app = Starlette(
        routes=[
            Route("/", plant_view),
            Route("/login", login, methods=["POST"]),
            Route("/logout", logout, methods=["POST"]),
        ],
        lifespan=lifespan,
    )
    app.add_middleware(SessionMiddleware, secret_key=operator_password, https_only=False)
    return app
