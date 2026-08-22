from __future__ import annotations

import socket

import httpx

from conftest import OPERATOR_PASSWORD, WattloftProcess, _reset_history
from test_admitted_logger_sample import (
    _ADMITTED_SERIAL,
    _CONTROL_DATA,
    _SEQUENCE,
    _live_shaped_upload_header,
    _recv_exact,
    _v5_frame,
)

_SECOND_SERIAL = 3913630013


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


def _plant_view_html(wattloft: WattloftProcess, path: str = "/") -> str:
    with httpx.Client(base_url=wattloft.url, follow_redirects=False) as client:
        client.post("/login", data={"password": OPERATOR_PASSWORD})
        return client.get(path).text


def test_two_admitted_loggers_sum_only_those_that_answered(
    wattloft: WattloftProcess,
) -> None:
    _ingest(wattloft, _ADMITTED_SERIAL, _live_shaped_upload_header())
    _ingest(
        wattloft,
        _SECOND_SERIAL,
        _upload_header(today_cents=240, lifetime_tenths=1000, watts=400),
    )

    html = _plant_view_html(wattloft)

    assert "<dt>Today energy</dt><dd>3.50 kWh</dd>" in html
    assert "<dt>Current Power</dt><dd>1025 W</dd>" in html
    assert "<dt>Lifetime energy</dt><dd>5735.4 kWh</dd>" in html


def test_logger_with_no_sample_that_local_day_contributes_nothing_to_today_energy(
    postgres_url: str,
) -> None:
    _reset_history(postgres_url)
    process = WattloftProcess(postgres_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.now = "2026-08-22T10:00:00-03:00"
        process.restart()
        _ingest(
            process,
            _SECOND_SERIAL,
            _upload_header(today_cents=240, lifetime_tenths=1000, watts=400),
        )
        html = _plant_view_html(process)
    finally:
        process.stop()

    assert "<dt>Today energy</dt><dd>2.40 kWh</dd>" in html
    assert "<dt>Today energy</dt><dd>3.50 kWh</dd>" not in html
    assert "<dt>Today energy</dt><dd>1.10 kWh</dd>" not in html
    assert "0.00 kWh" not in html
    assert "<dt>Current Power</dt><dd>400 W</dd>" in html
    assert "<dt>Lifetime energy</dt><dd>5735.4 kWh</dd>" in html
    assert "2026-08-22 10:00:00" in html


def test_local_day_bars_use_last_successful_today_energy_then_sum(
    postgres_url: str,
) -> None:
    _reset_history(postgres_url)
    process = WattloftProcess(postgres_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.now = "2026-08-21T16:00:00-03:00"
        process.restart()
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
        process.now = "2026-08-22T10:00:00-03:00"
        process.restart()
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        html = _plant_view_html(process)
    finally:
        process.stop()

    assert 'href="/?day=2026-08-21"' in html
    assert "2026-08-21 3.90 kWh" in html
    assert 'href="/?day=2026-08-22"' in html
    assert "2026-08-22 0.20 kWh" in html
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in html
    assert "3.50 kWh" not in html
    assert "1.10 kWh" not in html


def test_selected_local_day_power_curve_shows_each_logger_and_plant(
    postgres_url: str,
) -> None:
    _reset_history(postgres_url)
    process = WattloftProcess(postgres_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.now = "2026-08-21T15:01:00-03:00"
        process.restart()
        _ingest(
            process,
            _SECOND_SERIAL,
            _upload_header(today_cents=240, lifetime_tenths=1000, watts=400),
        )
        process.now = "2026-08-22T10:00:00-03:00"
        process.restart()
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        html = _plant_view_html(process, "/?day=2026-08-21")
    finally:
        process.stop()

    assert 'data-series="3909309465"' in html
    assert 'data-series="3913630013"' in html
    assert 'data-series="Plant"' in html
    assert ">3909309465</li>" in html
    assert ">3913630013</li>" in html
    assert ">Plant</li>" in html
    assert 'data-at="2026-08-21 15:00:00" data-watts="625"' in html
    assert 'data-at="2026-08-21 15:01:00" data-watts="400"' in html
    assert 'data-at="2026-08-22 10:00:00"' not in html
    assert 'data-watts="50"' not in html
    second = html.split('data-series="3913630013"', 1)[1].split("</g>", 1)[0]
    assert 'data-at="2026-08-21 15:00:00"' not in second
    assert 'data-watts="0"' not in second
    plant = html.split('data-series="Plant"', 1)[1].split("</g>", 1)[0]
    assert 'data-at="2026-08-21 15:00:00" data-watts="625"' in plant
    assert 'data-at="2026-08-21 15:01:00" data-watts="400"' in plant
    assert 'data-watts="0"' not in plant
    assert 'data-watts="1025"' not in plant


def test_today_energy_dashes_when_no_logger_sampled_this_local_day(
    postgres_url: str,
) -> None:
    _reset_history(postgres_url)
    process = WattloftProcess(postgres_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.now = "2026-08-22T10:40:00-03:00"
        process.restart()
        html = _plant_view_html(process)
    finally:
        process.stop()

    assert "<dt>Today energy</dt><dd>-</dd>" in html
    assert "0.00 kWh" not in html
    assert "<dt>Current Power</dt><dd>625 W</dd>" in html
    assert "2026-08-21 15:00:00" in html
    assert "<dt>Lifetime energy</dt><dd>5635.4 kWh</dd>" in html


def test_plant_view_is_usable_on_a_small_phone_screen(
    wattloft: WattloftProcess,
) -> None:
    _ingest(wattloft, _ADMITTED_SERIAL, _live_shaped_upload_header())
    html = _plant_view_html(wattloft)
    assert 'name="viewport"' in html
    assert "width=device-width" in html
    assert "max-width:100%" in html.replace(" ", "")
    assert "Log out" in html
    assert "<svg" in html.lower()
    assert "<dt>Today energy</dt>" in html
    assert 'href="/?day=' in html
