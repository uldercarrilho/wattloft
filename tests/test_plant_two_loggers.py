from __future__ import annotations

import socket
from typing import Any

from conftest import WattloftProcess, _reset_history
from snapshot import bar_kwh, curve_series, snapshot_json
from test_admitted_logger_sample import (
    _ADMITTED_SERIAL,
    _CONTROL_DATA,
    _SEQUENCE,
    _live_shaped_upload_header,
    _recv_exact,
    _v5_frame,
)

_SECOND_SERIAL = 1000000002


def _upload_header(*, today_cents: int, lifetime_tenths: int, watts: int) -> bytes:
    payload = bytearray(_live_shaped_upload_header())
    payload[33:35] = today_cents.to_bytes(2, "little")
    payload[37:41] = lifetime_tenths.to_bytes(4, "little")
    payload[59:63] = watts.to_bytes(4, "little")
    return bytes(payload)


def _ingest(wattloft: WattloftProcess, serial: int, payload: bytes) -> None:
    frame = _v5_frame(_CONTROL_DATA, _SEQUENCE, serial, payload)
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        _recv_exact(sock, 23)


def _names(body: dict[str, Any]) -> set[str]:
    return {str(series["name"]) for series in body["curve"]}


def test_operator_snapshot_ignores_prototype_gate_and_variant(mysql_url: str) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(
        mysql_url,
        now="2026-08-21T15:00:00-03:00",
        extra_env={"WATTLOFT_PROTOTYPE": "1"},
    )
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        body = snapshot_json(process.url)
    finally:
        process.stop()

    assert body["today_energy_kwh"] == 1.1
    assert "Plant" in _names(body)


def test_time_grain_selected_day_curve_is_that_local_day(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
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
        body = snapshot_json(process.url, day="2026-08-21")
    finally:
        process.stop()

    assert body["selected_day"] == "2026-08-21"
    assert _names(body) == {"Plant", "1000000001", "1000000002"}
    plant = curve_series(body, "Plant")
    ats = [point["at"] for point in plant["points"]]
    assert "2026-08-21T15:00:00" in ats
    assert "2026-08-22T10:00:00" not in ats
    assert bar_kwh(body, "2026-08-21") == 3.5
    assert bar_kwh(body, "2026-08-22") == 0.2


def test_day_bars_are_last_successful_today_energy_then_sum(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-21T16:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=150, lifetime_tenths=56354, watts=625),
        )
        _ingest(
            process,
            _SECOND_SERIAL,
            _upload_header(today_cents=240, lifetime_tenths=1000, watts=400),
        )
        process.set_now("2026-09-01T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        body = snapshot_json(process.url, day="2026-08-21")
    finally:
        process.stop()

    assert body["selected_day"] == "2026-08-21"
    assert bar_kwh(body, "2026-08-21") == 3.9
    assert bar_kwh(body, "2026-09-01") == 0.2
    assert body["today_energy_kwh"] == 0.2
    assert body["current_power_w"] == 50


def test_out_of_range_day_clamps_to_history_span(mysql_url: str) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-22T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        early = snapshot_json(process.url, day="2026-08-01")
        late = snapshot_json(process.url, day="2026-09-01")
        bogus = snapshot_json(process.url, day="not-a-day")
    finally:
        process.stop()

    assert early["selected_day"] == "2026-08-21"
    assert late["selected_day"] == "2026-08-22"
    assert bogus["selected_day"] == "2026-08-22"


def test_local_day_with_no_curve_samples_has_empty_curve(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-23T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        body = snapshot_json(process.url, day="2026-08-22")
    finally:
        process.stop()

    assert body["selected_day"] == "2026-08-22"
    assert body["curve"] == []
    assert body["today_energy_kwh"] == 0.2
    days = [bar["local_day"] for bar in body["local_day_bars"]]
    assert "2026-08-21" in days
    assert "2026-08-23" in days


def test_two_admitted_loggers_sum_only_those_that_answered(
    wattloft: WattloftProcess,
) -> None:
    _ingest(wattloft, _ADMITTED_SERIAL, _live_shaped_upload_header())
    _ingest(
        wattloft,
        _SECOND_SERIAL,
        _upload_header(today_cents=240, lifetime_tenths=1000, watts=400),
    )

    body = snapshot_json(wattloft.url)
    assert body["today_energy_kwh"] == 3.5
    assert body["current_power_w"] == 1025
    assert body["lifetime_energy_kwh"] == 5735.4


def test_logger_with_no_sample_that_local_day_contributes_nothing_to_today_energy(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-22T10:00:00-03:00")
        _ingest(
            process,
            _SECOND_SERIAL,
            _upload_header(today_cents=240, lifetime_tenths=1000, watts=400),
        )
        body = snapshot_json(process.url)
    finally:
        process.stop()

    assert body["today_energy_kwh"] == 2.4
    assert body["current_power_w"] == 400
    assert body["lifetime_energy_kwh"] == 5735.4


def test_selected_local_day_power_curve_shows_each_logger_and_plant(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
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
        body = snapshot_json(process.url, day="2026-08-21")
    finally:
        process.stop()

    first = curve_series(body, "1000000001")["points"]
    second = curve_series(body, "1000000002")["points"]
    plant = curve_series(body, "Plant")["points"]
    assert first == [
        {"at": "2026-08-21T15:00:00", "watts": 625, "lifetime_kwh": 5635.4}
    ]
    assert second == [
        {"at": "2026-08-21T15:01:00", "watts": 400, "lifetime_kwh": 100.0}
    ]
    assert plant == [
        {"at": "2026-08-21T15:00:00", "watts": 625},
        {"at": "2026-08-21T15:01:00", "watts": 400},
    ]
    assert body["today_energy_kwh"] == 0.2
    assert body["current_power_w"] == 50
    assert body["lifetime_energy_kwh"] == 5735.6


def test_today_energy_is_null_when_no_logger_sampled_this_local_day(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-22T10:40:00-03:00")
        body = snapshot_json(process.url)
    finally:
        process.stop()

    assert body["today_energy_kwh"] is None
    assert body["current_power_w"] == 625
    assert body["lifetime_energy_kwh"] == 5635.4


def test_time_curve_samples_carry_lifetime_energy(mysql_url: str) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
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
        body = snapshot_json(process.url, day="2026-08-21")
    finally:
        process.stop()

    assert curve_series(body, "1000000001")["points"] == [
        {"at": "2026-08-21T15:00:00", "watts": 625, "lifetime_kwh": 5635.4}
    ]
    assert curve_series(body, "1000000002")["points"] == [
        {"at": "2026-08-21T15:01:00", "watts": 400, "lifetime_kwh": 100.0}
    ]
    assert "lifetime_kwh" not in curve_series(body, "Plant")["points"][0]


def _long_gap_snapshot(
    mysql_url: str,
    *,
    later_lifetime_tenths: int,
    hole_logger: bool,
) -> dict[str, Any]:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T10:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=100, lifetime_tenths=1000, watts=400),
        )
        if hole_logger:
            process.set_now("2026-08-21T10:20:00-03:00")
            _ingest(
                process,
                _SECOND_SERIAL,
                _upload_header(today_cents=50, lifetime_tenths=500, watts=300),
            )
        process.set_now("2026-08-21T10:40:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(
                today_cents=100,
                lifetime_tenths=later_lifetime_tenths,
                watts=400,
            ),
        )
        return snapshot_json(process.url, day="2026-08-21")
    finally:
        process.stop()


def test_failure_hole_keeps_raw_points_without_inventing_zero_watts(
    mysql_url: str,
) -> None:
    body = _long_gap_snapshot(
        mysql_url, later_lifetime_tenths=1000, hole_logger=True
    )
    logger = curve_series(body, "1000000001")["points"]
    plant = curve_series(body, "Plant")["points"]
    assert logger == [
        {"at": "2026-08-21T10:00:00", "watts": 400, "lifetime_kwh": 100.0},
        {"at": "2026-08-21T10:40:00", "watts": 400, "lifetime_kwh": 100.0},
    ]
    assert {"at": "2026-08-21T10:20:00", "watts": 300} in [
        {k: p[k] for k in ("at", "watts")} for p in plant
    ]
    assert all(point["watts"] != 0 for point in plant)


def test_lifetime_backed_gap_keeps_endpoint_points(
    mysql_url: str,
) -> None:
    body = _long_gap_snapshot(
        mysql_url, later_lifetime_tenths=1003, hole_logger=False
    )
    logger = curve_series(body, "1000000001")["points"]
    assert logger[0]["watts"] == 400
    assert logger[-1]["watts"] == 400
    assert logger[-1]["lifetime_kwh"] == 100.3
