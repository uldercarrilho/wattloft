from __future__ import annotations

import socket
from datetime import datetime, timedelta, timezone

import httpx

from conftest import WattloftProcess, _reset_history
from test_admitted_logger_sample import (
    _ADMITTED_SERIAL,
    _CONTROL_DATA,
    _EXPECTED_ACK,
    _SEQUENCE,
    _live_shaped_upload_header,
    _recv_exact,
    _v5_frame,
)
from test_plant_two_loggers import _SECOND_SERIAL, _ingest, _upload_header


def test_snapshot_with_no_usable_samples_is_404_with_empty_body(
    plant_view_url: str,
) -> None:
    response = httpx.get(f"{plant_view_url}/snapshot")
    assert response.status_code == 404
    assert response.content == b""


def test_admitted_sample_snapshot_includes_kpis_and_receive_time(
    wattloft: WattloftProcess,
) -> None:
    frame = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    before = datetime.now(timezone.utc)
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        ack = _recv_exact(sock, len(_EXPECTED_ACK))
    after = datetime.now(timezone.utc)
    assert ack == _EXPECTED_ACK

    response = httpx.get(f"{wattloft.url}/snapshot")
    assert response.status_code == 200
    body = response.json()
    assert body["today_energy_kwh"] == 1.1
    assert body["current_power_w"] == 625
    assert body["lifetime_energy_kwh"] == 5635.4
    at = datetime.fromisoformat(body["current_power_at"])
    assert at.tzinfo is not None
    assert at.utcoffset() == timedelta(0)
    earliest = before.replace(microsecond=0) - timedelta(seconds=1)
    latest = after.replace(microsecond=0) + timedelta(seconds=1)
    assert earliest <= at <= latest


def _curve_points(body: dict[str, object], name: str) -> list[dict[str, object]]:
    curve = body["curve"]
    assert isinstance(curve, list)
    for series in curve:
        assert isinstance(series, dict)
        if series["name"] == name:
            points = series["points"]
            assert isinstance(points, list)
            return points
    raise AssertionError(f"no curve series named {name}")


def _two_local_day_history(mysql_url: str) -> WattloftProcess:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
    process.set_now("2026-08-21T15:01:00-03:00")
    _ingest(
        process,
        _SECOND_SERIAL,
        _upload_header(today_cents=240, lifetime_tenths=1000, watts=400),
    )
    process.set_now("2026-08-22T10:00:00-03:00")
    _ingest(
        process,
        _ADMITTED_SERIAL,
        _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
    )
    return process


def test_day_is_clamped_like_plant_view_and_curve_matches_selected_day(
    mysql_url: str,
) -> None:
    process = _two_local_day_history(mysql_url)
    try:
        missing = httpx.get(f"{process.url}/snapshot").json()
        invalid = httpx.get(f"{process.url}/snapshot", params={"day": "nope"}).json()
        before = httpx.get(
            f"{process.url}/snapshot", params={"day": "2026-08-20"}
        ).json()
        after = httpx.get(
            f"{process.url}/snapshot", params={"day": "2026-08-23"}
        ).json()
        exact = httpx.get(
            f"{process.url}/snapshot", params={"day": "2026-08-21"}
        ).json()
    finally:
        process.stop()

    assert missing["selected_day"] == "2026-08-22"
    assert invalid["selected_day"] == "2026-08-22"
    assert before["selected_day"] == "2026-08-21"
    assert after["selected_day"] == "2026-08-22"
    assert exact["selected_day"] == "2026-08-21"

    last_day = _curve_points(missing, "1000000001")
    assert last_day == [
        {"at": "2026-08-22T10:00:00", "watts": 50.0, "lifetime_kwh": 5635.6}
    ]
    assert _curve_points(invalid, "1000000001") == last_day
    assert _curve_points(after, "1000000001") == last_day

    first_day = _curve_points(before, "1000000001")
    assert first_day == [
        {"at": "2026-08-21T15:00:00", "watts": 625.0, "lifetime_kwh": 5635.4}
    ]
    assert _curve_points(exact, "1000000001") == first_day
    assert _curve_points(exact, "1000000002") == [
        {"at": "2026-08-21T15:01:00", "watts": 400.0, "lifetime_kwh": 100.0}
    ]
    assert _curve_points(exact, "Plant") == [
        {"at": "2026-08-21T15:00:00", "watts": 625.0},
        {"at": "2026-08-21T15:01:00", "watts": 400.0},
    ]


def test_snapshot_json_includes_local_day_bars_and_ignores_unit(
    mysql_url: str,
) -> None:
    process = _two_local_day_history(mysql_url)
    try:
        body = httpx.get(
            f"{process.url}/snapshot",
            params={"day": "2026-08-21", "unit": "year"},
        ).json()
    finally:
        process.stop()

    assert "unit" not in body
    assert body["selected_day"] == "2026-08-21"
    assert body["local_day_bars"] == [
        {"local_day": "2026-08-21", "today_energy_kwh": 3.5},
        {"local_day": "2026-08-22", "today_energy_kwh": 0.2},
    ]
    assert [series["name"] for series in body["curve"]] == [
        "1000000001",
        "1000000002",
        "Plant",
    ]
