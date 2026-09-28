from __future__ import annotations

import asyncio
import json

import pytest
from starlette.requests import Request

from wattloft.api import EventBroadcaster, create_app
from wattloft.ingest import handle_frame
from wattloft.v5 import CONTROL_DATA, build_v5_frame


def _sample_v5_frame(serial: int = 1000000001, power_w: int = 625) -> bytes:
    payload = bytearray(534)
    payload[21:31] = b"1234567890"
    payload[33:35] = (110).to_bytes(2, "little")  # 1.1 kWh
    payload[37:41] = (56354).to_bytes(4, "little")  # 5635.4 kWh
    payload[59:63] = (power_w).to_bytes(4, "little")  # 625 W
    payload[245:251] = bytes([26, 8, 20, 11, 39, 15])
    return build_v5_frame(CONTROL_DATA, 1, serial, bytes(payload))


@pytest.mark.anyio
async def test_event_broadcaster_subscribe_publish_unsubscribe() -> None:
    broadcaster = EventBroadcaster()
    broadcaster.set_loop(asyncio.get_running_loop())
    queue = broadcaster.subscribe()

    event = {
        "type": "sample",
        "logger_serial": "1000000001",
        "received_at": "2026-09-09T14:32:00Z",
        "ac_power_w": 412.5,
        "today_energy_kwh": 3.82,
        "lifetime_energy_kwh": 1420.15,
    }

    broadcaster.publish(event)
    received = await asyncio.wait_for(queue.get(), timeout=1.0)
    assert received == event

    broadcaster.unsubscribe(queue)
    broadcaster.publish(event)
    assert queue.empty()


def test_handle_frame_invokes_on_sample(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("wattloft.ingest.record_sample", lambda *args, **kwargs: None)
    samples: list[dict[str, object]] = []
    frame = _sample_v5_frame(1000000001, power_w=450)

    ack = handle_frame(
        "mysql://dummy",
        frozenset({"1000000001"}),
        frame,
        on_sample=samples.append,
    )
    assert ack is not None
    assert len(samples) == 1
    sample = samples[0]
    assert sample["type"] == "sample"
    assert sample["logger_serial"] == "1000000001"
    assert sample["ac_power_w"] == 450.0
    assert sample["today_energy_kwh"] == 1.1
    assert sample["lifetime_energy_kwh"] == 5635.4
    assert str(sample["received_at"]).endswith("Z")


def test_handle_frame_unadmitted_serial_does_not_invoke_on_sample(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("wattloft.ingest.record_sample", lambda *args, **kwargs: None)
    samples: list[dict[str, object]] = []
    frame = _sample_v5_frame(2000000000)

    ack = handle_frame(
        "mysql://dummy",
        frozenset({"1000000001"}),
        frame,
        on_sample=samples.append,
    )
    assert ack is None
    assert len(samples) == 0


@pytest.mark.anyio
async def test_events_route_creates_streaming_response() -> None:
    broadcaster = EventBroadcaster()
    broadcaster.set_loop(asyncio.get_running_loop())
    app = create_app("mysql://dummy", ingest_port=0, broadcaster=broadcaster)

    # Locate /events route endpoint
    events_route = next(
        route for route in app.routes if getattr(route, "path", None) == "/events"
    )
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/events",
        "headers": [],
    }
    req = Request(scope)
    res = await events_route.endpoint(req)

    assert res.status_code == 200
    assert res.media_type == "text/event-stream"
    assert res.headers["cache-control"] == "no-cache"

    # Publish an event
    broadcaster.publish({
        "type": "sample",
        "logger_serial": "1000000001",
        "received_at": "2026-09-09T14:32:00Z",
        "ac_power_w": 412.5,
        "today_energy_kwh": 3.82,
        "lifetime_energy_kwh": 1420.15,
    })

    # Read the body iterator
    gen = res.body_iterator
    chunk = await anext(gen)
    assert chunk.startswith("data: ")
    data = json.loads(chunk[6:].strip())
    assert data["type"] == "sample"
    assert data["logger_serial"] == "1000000001"
    assert data["ac_power_w"] == 412.5

    # Close generator
    await gen.aclose()
