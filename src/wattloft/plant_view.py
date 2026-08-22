from __future__ import annotations

import asyncio
import hmac
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from html import escape
from zoneinfo import ZoneInfo

from starlette.applications import Starlette
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from wattloft.config import ADMITTED_LOGGER_SERIALS
from wattloft.history import PlantSnapshot, plant_snapshot
from wattloft.ingest import start_ingest

_LOCAL = ZoneInfo("America/Sao_Paulo")

_LOGIN = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Plant</title></head>
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
<head><meta charset="utf-8"><title>Plant</title></head>
<body>
<p>This Plant has no History yet.</p>
</body>
</html>
"""

_KPIS = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Plant</title></head>
<body>
<dl>
<dt>Today energy</dt><dd>{today_energy}</dd>
<dt>Current Power</dt><dd>{current_power}</dd>
<dt>Lifetime energy</dt><dd>{lifetime_energy}</dd>
<dt>Last sample</dt><dd>{last_sample}</dd>
</dl>
</body>
</html>
"""


def _format_watts(watts: float) -> str:
    if watts == int(watts):
        return f"{int(watts)} W"
    return f"{watts} W"


def _render_kpis(snapshot: PlantSnapshot) -> str:
    last_sample = snapshot.current_power_at.astimezone(_LOCAL).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    return _KPIS.format(
        today_energy=escape(f"{snapshot.today_energy_kwh:.2f} kWh"),
        current_power=escape(_format_watts(snapshot.current_power_w)),
        lifetime_energy=escape(f"{snapshot.lifetime_energy_kwh:.1f} kWh"),
        last_sample=escape(last_sample),
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
        snapshot = await asyncio.to_thread(plant_snapshot, database_url)
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
        ],
        lifespan=lifespan,
    )
    app.add_middleware(SessionMiddleware, secret_key=operator_password, https_only=False)
    return app
