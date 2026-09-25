from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date, datetime
from zoneinfo import ZoneInfo

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from wattloft.config import ADMITTED_LOGGER_SERIALS, LOGGER_DISPLAY_NAMES, now_utc
from wattloft.history import CurvePoint, CurveSeries, PlantSnapshot, plant_snapshot
from wattloft.ingest import start_ingest

_LOCAL = ZoneInfo("America/Sao_Paulo")


class EventBroadcaster:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, object]]] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue[dict[str, object]]:
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, object]]) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: dict[str, object]) -> None:
        if self._loop is not None:
            try:
                running_loop = asyncio.get_running_loop()
            except RuntimeError:
                running_loop = None
            if running_loop != self._loop:
                self._loop.call_soon_threadsafe(self._publish_now, event)
                return
        self._publish_now(event)

    def _publish_now(self, event: dict[str, object]) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass



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


def _named_payload(name: str) -> dict[str, object]:
    payload: dict[str, object] = {"name": name}
    label = LOGGER_DISPLAY_NAMES.get(name)
    if label:
        payload["display_name"] = label
    return payload


def _series_payload(series: CurveSeries) -> dict[str, object]:
    payload = _named_payload(series.name)
    payload["points"] = [_point_payload(point) for point in series.points]
    return payload


def _snapshot_payload(snapshot: PlantSnapshot, selected_day: date) -> dict[str, object]:
    current_power_at: datetime = snapshot.current_power_at
    first, _last = _history_span(snapshot)
    return {
        "selected_day": selected_day.isoformat(),
        "history_start": first.isoformat(),
        "today_energy_kwh": snapshot.today_energy_kwh,
        "current_power_w": snapshot.current_power_w,
        "lifetime_energy_kwh": snapshot.lifetime_energy_kwh,
        "current_power_at": current_power_at.isoformat(),
        "local_day_bars": [
            {
                "local_day": bar.local_day.isoformat(),
                "today_energy_kwh": bar.today_energy_kwh,
                "prev_year_today_energy_kwh": bar.prev_year_today_energy_kwh,
                "loggers": [
                    {
                        **_named_payload(part.name),
                        "today_energy_kwh": part.today_energy_kwh,
                    }
                    for part in bar.loggers
                ],
            }
            for bar in snapshot.local_day_bars
        ],
        "curve": [_series_payload(series) for series in snapshot.curve],
        "ideal_curve": [_point_payload(point) for point in snapshot.ideal_curve],
        "clipping": (
            {
                "clipped": snapshot.clipping.clipped,
                "clipped_minutes": snapshot.clipping.clipped_minutes,
                "estimated_clipped_kwh": snapshot.clipping.estimated_clipped_kwh,
                "plateaus": [
                    {
                        "logger_serial": p.logger_serial,
                        "start_minute": p.start_minute,
                        "end_minute": p.end_minute,
                        "start_at": p.start_at.isoformat(),
                        "end_at": p.end_at.isoformat(),
                        "plateau_watts": p.plateau_watts,
                        "estimated_clipped_kwh": p.estimated_clipped_kwh,
                    }
                    for p in snapshot.clipping.plateaus
                ],
            }
            if snapshot.clipping is not None
            else None
        ),
        "drift": (
            {
                "detected": snapshot.drift.detected,
                "advisory": snapshot.drift.advisory,
                "affected_logger": snapshot.drift.affected_logger,
                "drift_pct": snapshot.drift.drift_pct,
                "baseline_ratio": snapshot.drift.baseline_ratio,
                "rolling_ratio": snapshot.drift.rolling_ratio,
            }
            if snapshot.drift is not None
            else None
        ),
        "loggers_now": [
            {
                **_named_payload(row.name),
                "last_success_at": row.last_success_at.isoformat(),
                "power_w": row.power_w,
            }
            for row in snapshot.loggers_now
        ],
        "envelope_calibration": (
            {
                "calibrated": snapshot.envelope_calibration.calibrated,
                "sunny_days_count": snapshot.envelope_calibration.sunny_days_count,
                "last_calibrated_at": (
                    snapshot.envelope_calibration.last_calibrated_at.isoformat()
                    if snapshot.envelope_calibration.last_calibrated_at
                    else None
                ),
                "scale": snapshot.envelope_calibration.scale,
                "tilt_deg": snapshot.envelope_calibration.tilt_deg,
                "azimuth_offset_deg": snapshot.envelope_calibration.azimuth_offset_deg,
                "elevation_cutoff_deg": snapshot.envelope_calibration.elevation_cutoff_deg,
                "ac_cap_w": snapshot.envelope_calibration.ac_cap_w,
            }
            if snapshot.envelope_calibration is not None
            else None
        ),
    }


def create_app(
    database_url: str,
    *,
    ingest_host: str = "0.0.0.0",
    ingest_port: int = 10000,
    admitted_logger_serials: frozenset[str] = ADMITTED_LOGGER_SERIALS,
    broadcaster: EventBroadcaster | None = None,
) -> Starlette:
    event_bus = broadcaster if broadcaster is not None else EventBroadcaster()

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

    async def events(request: Request) -> Response:
        queue = event_bus.subscribe()

        async def event_stream() -> AsyncIterator[str]:
            try:
                while True:
                    payload = await queue.get()
                    yield f"data: {json.dumps(payload)}\n\n"
            except (asyncio.CancelledError, GeneratorExit):
                pass
            finally:
                event_bus.unsubscribe(queue)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncIterator[None]:
        event_bus.set_loop(asyncio.get_running_loop())
        server = await start_ingest(
            ingest_host,
            ingest_port,
            database_url,
            admitted_logger_serials,
            on_sample=event_bus.publish,
        )

        async def _calibration_worker() -> None:
            from wattloft.solar import run_calibration

            try:
                await asyncio.to_thread(run_calibration, database_url)
            except Exception:
                pass
            while True:
                try:
                    await asyncio.sleep(3600)
                    await asyncio.to_thread(run_calibration, database_url)
                except asyncio.CancelledError:
                    break
                except Exception:
                    pass

        cal_task = asyncio.create_task(_calibration_worker())
        try:
            async with server:
                yield
        finally:
            cal_task.cancel()

    return Starlette(
        routes=[
            Route("/snapshot", snapshot),
            Route("/events", events),
        ],
        lifespan=lifespan,
    )
