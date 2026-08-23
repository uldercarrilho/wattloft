from __future__ import annotations

import asyncio
import hmac
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
from wattloft.plant_view_prototype import prototype_enabled, render_prototype

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
svg, .curve-legend, dl, form { max-width: 100%; }
svg { width: 100%; height: auto; display: block; }
:focus-visible { outline: 2px solid var(--pigment); outline-offset: 2px; }
.curve-legend { list-style: none; padding: 0; display: flex; flex-wrap: wrap;
  gap: 0.5rem 1rem; font-family: "IBM Plex Mono", monospace; font-size: 0.8rem; }
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


def _series_color(index: int, name: str) -> str:
    if name == "Plant":
        return "#1A2A3A"
    return ("#9B2C2C", "#2A6B5A")[index % 2]


def _xy(point: CurvePoint, max_watts: float) -> tuple[float, float]:
    minutes = point.at.hour * 60 + point.at.minute
    return minutes / (24 * 60) * 400, 190 - (point.watts / max_watts) * 170


def _render_series(series: CurveSeries, max_watts: float, color: str) -> str:
    marks: list[str] = []
    line: list[str] = []
    for point in series.points:
        cx, cy = _xy(point, max_watts)
        line.append(f"{cx:.1f},{cy:.1f}")
        at = point.at.strftime("%Y-%m-%d %H:%M:%S")
        watts = _watts_attr(point.watts)
        title = escape(f"{series.name} {at} {_format_watts(point.watts)}")
        marks.append(
            f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="3" fill="{color}" '
            f'data-at="{escape(at)}" data-watts="{escape(watts)}">'
            f"<title>{title}</title></circle>"
        )
    polyline = ""
    if line:
        polyline = (
            f'<polyline fill="none" stroke="{color}" stroke-width="2" '
            f'points="{" ".join(line)}"/>'
        )
    return f'<g data-series="{escape(series.name)}">{polyline}{"".join(marks)}</g>'


def _render_curve(snapshot: PlantSnapshot) -> str:
    if not snapshot.curve:
        return ""
    max_watts = max(
        (point.watts for series in snapshot.curve for point in series.points),
        default=0,
    )
    if max_watts <= 0:
        max_watts = 1
    groups: list[str] = []
    legend: list[str] = []
    for index, series in enumerate(snapshot.curve):
        color = _series_color(index, series.name)
        groups.append(_render_series(series, max_watts, color))
        legend.append(f'<li style="color:{color}">{escape(series.name)}</li>')
    return (
        f'<svg viewBox="0 0 400 200" role="img">{"".join(groups)}</svg>'
        f'<ul class="curve-legend">{"".join(legend)}</ul>'
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
    return _document(body, script=_LAST_SAMPLE_JS)


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
        if prototype_enabled():
            return HTMLResponse(
                render_prototype(
                    snapshot,
                    variant=request.query_params.get("variant") or "F",
                    selected_day=selected,
                    unit=request.query_params.get("unit") or "time",
                )
            )
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
