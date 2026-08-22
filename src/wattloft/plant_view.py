from __future__ import annotations

import asyncio
import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from html import escape
from zoneinfo import ZoneInfo

from starlette.applications import Starlette
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from wattloft.config import ADMITTED_LOGGER_SERIALS
from wattloft.history import CurvePoint, CurveSeries, PlantSnapshot, plant_snapshot
from wattloft.ingest import start_ingest

_LOCAL = ZoneInfo("America/Sao_Paulo")

_LOGIN = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plant</title>
<style>
body { margin: 0; padding: 1rem; font: 16px/1.4 sans-serif; max-width: 100%; }
button { font-size: 1rem; padding: 0.5rem 1rem; }
input { font-size: 1rem; max-width: 100%; }
</style>
</head>
<body>
<form method="post" action="/login">
<label>Password <input type="password" name="password" required></label>
<button type="submit">Log in</button>
</form>
</body>
</html>
"""

_EMPTY_HISTORY = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plant</title>
<style>
body { margin: 0; padding: 1rem; font: 16px/1.4 sans-serif; max-width: 100%; }
button { font-size: 1rem; padding: 0.5rem 1rem; }
</style>
</head>
<body>
<form method="post" action="/logout"><button type="submit">Log out</button></form>
<p>This Plant has no History yet.</p>
</body>
</html>
"""

_KPIS = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plant</title>
<style>
body {{ margin: 0; padding: 1rem; font: 16px/1.4 sans-serif; max-width: 100%; }}
svg, ol, dl, form {{ max-width: 100%; }}
svg {{ width: 100%; height: auto; display: block; }}
ol {{ list-style: none; padding: 0; }}
ol a {{ display: block; box-sizing: border-box; max-width: 100%; padding: 0.5rem; margin: 0.25rem 0; background: #2a7; color: #fff; text-decoration: none; }}
.curve-legend {{ list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; }}
button {{ font-size: 1rem; padding: 0.5rem 1rem; }}
</style>
</head>
<body>
<form method="post" action="/logout"><button type="submit">Log out</button></form>
<dl>
<dt>Today energy</dt><dd>{today_energy}</dd>
<dt>Current Power</dt><dd>{current_power}</dd>
<dt>Lifetime energy</dt><dd>{lifetime_energy}</dd>
<dt>Last sample</dt><dd>{last_sample}</dd>
</dl>
<ol>
{bars}
</ol>
{curve}
</body>
</html>
"""


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


def _format_kwh(kwh: float) -> str:
    return f"{kwh:.2f} kWh"


def _render_bars(snapshot: PlantSnapshot) -> str:
    items: list[str] = []
    peak = max((bar.today_energy_kwh for bar in snapshot.local_day_bars), default=0)
    for bar in snapshot.local_day_bars:
        day = bar.local_day.isoformat()
        label = escape(f"{day} {_format_kwh(bar.today_energy_kwh)}")
        width = 100 if peak <= 0 else max(12.0, bar.today_energy_kwh / peak * 100)
        items.append(
            f'<li><a href="/?day={escape(day)}" style="width:{width:.0f}%">{label}</a></li>'
        )
    return "\n".join(items)


def _series_color(index: int, name: str) -> str:
    if name == "Plant":
        return "#1a1a1a"
    return ("#c45c4a", "#2a6fbf")[index % 2]


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


def _render_kpis(snapshot: PlantSnapshot) -> str:
    last_sample = snapshot.current_power_at.astimezone(_LOCAL).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    return _KPIS.format(
        today_energy=escape(
            _format_kwh(snapshot.today_energy_kwh)
            if snapshot.today_energy_kwh is not None
            else "-"
        ),
        current_power=escape(_format_watts(snapshot.current_power_w)),
        lifetime_energy=escape(f"{snapshot.lifetime_energy_kwh:.1f} kWh"),
        last_sample=escape(last_sample),
        bars=_render_bars(snapshot),
        curve=_render_curve(snapshot),
    )


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
        snapshot = await asyncio.to_thread(
            plant_snapshot, database_url, _parse_day(request.query_params.get("day"))
        )
        if snapshot is None:
            return HTMLResponse(_EMPTY_HISTORY)
        return HTMLResponse(_render_kpis(snapshot))

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
