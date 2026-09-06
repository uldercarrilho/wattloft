from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date, datetime
from zoneinfo import ZoneInfo

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from wattloft.config import ADMITTED_LOGGER_SERIALS, now_utc
from wattloft.history import CurvePoint, CurveSeries, PlantSnapshot, plant_snapshot
from wattloft.ingest import start_ingest

_LOCAL = ZoneInfo("America/Sao_Paulo")


def _parse_day(raw: str | None) -> date | None:
    if raw is None:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


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


def _point_payload(point: CurvePoint) -> dict[str, object]:
    payload: dict[str, object] = {
        "at": point.at.isoformat(),
        "watts": point.watts,
    }
    if point.lifetime_kwh is not None:
        payload["lifetime_kwh"] = point.lifetime_kwh
    return payload


def _series_payload(series: CurveSeries) -> dict[str, object]:
    return {
        "name": series.name,
        "points": [_point_payload(point) for point in series.points],
    }


def _snapshot_payload(snapshot: PlantSnapshot, selected_day: date) -> dict[str, object]:
    current_power_at: datetime = snapshot.current_power_at
    return {
        "selected_day": selected_day.isoformat(),
        "today_energy_kwh": snapshot.today_energy_kwh,
        "current_power_w": snapshot.current_power_w,
        "lifetime_energy_kwh": snapshot.lifetime_energy_kwh,
        "current_power_at": current_power_at.isoformat(),
        "local_day_bars": [
            {
                "local_day": bar.local_day.isoformat(),
                "today_energy_kwh": bar.today_energy_kwh,
            }
            for bar in snapshot.local_day_bars
        ],
        "curve": [_series_payload(series) for series in snapshot.curve],
    }


def create_app(
    database_url: str,
    *,
    ingest_host: str = "0.0.0.0",
    ingest_port: int = 10000,
    admitted_logger_serials: frozenset[str] = ADMITTED_LOGGER_SERIALS,
) -> Starlette:
    async def snapshot(request: Request) -> Response:
        day_raw = request.query_params.get("day")
        requested = _parse_day(day_raw)
        loaded = await asyncio.to_thread(plant_snapshot, database_url, requested)
        if loaded is None:
            return Response(status_code=404)
        selected = _selected_day(day_raw, loaded)
        if selected != requested:
            loaded = await asyncio.to_thread(plant_snapshot, database_url, selected)
            if loaded is None:
                return Response(status_code=404)
        return JSONResponse(_snapshot_payload(loaded, selected))

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncIterator[None]:
        server = await start_ingest(
            ingest_host, ingest_port, database_url, admitted_logger_serials
        )
        async with server:
            yield

    return Starlette(
        routes=[Route("/snapshot", snapshot)],
        lifespan=lifespan,
    )
