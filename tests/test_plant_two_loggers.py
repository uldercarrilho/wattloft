from __future__ import annotations

import json
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


def test_after_login_with_history_the_page_offers_time_day_month_and_year(
    wattloft: WattloftProcess,
) -> None:
    _ingest(wattloft, _ADMITTED_SERIAL, _live_shaped_upload_header())
    html = _plant_view_html(wattloft)
    assert ">Time<" in html
    assert ">Day<" in html
    assert ">Month<" in html
    assert ">Year<" in html


def test_operator_plant_view_ignores_prototype_gate_and_variant(
    mysql_url: str,
) -> None:
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
        html = _plant_view_html(process, "/?variant=F")
    finally:
        process.stop()

    assert "<title>Plant</title>" in html
    assert ">Time<" in html
    assert ">Day<" in html
    assert ">Month<" in html
    assert ">Year<" in html
    assert "Last sample" in html
    assert "prototype-state" not in html
    assert "PROTOTYPE" not in html
    assert "Plant · prototype" not in html
    assert "variant=" not in html


def test_time_grain_stepper_shows_iso_local_day_and_that_days_power_curve(
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
        html = _plant_view_html(process, "/?day=2026-08-21")
    finally:
        process.stop()

    assert ">2026-08-21<" in html
    assert 'data-series="Plant"' in html
    assert 'data-series="3909309465"' in html
    assert "2026-08-21 3.50 kWh" not in html
    assert "2026-08-22 0.20 kWh" not in html
    assert 'aria-current="true">Time<' in html
    assert 'href="/?day=2026-08-21&amp;unit=day"' in html
    assert 'href="/?day=2026-08-21&amp;unit=month"' in html
    assert 'href="/?day=2026-08-21&amp;unit=year"' in html


def test_day_grain_shows_today_energy_bars_for_the_stepper_month(
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
        html = _plant_view_html(process, "/?day=2026-08-21&unit=day")
    finally:
        process.stop()

    assert ">2026-08<" in html
    assert 'aria-current="true">Day<' in html
    assert "2026-08-21 3.90 kWh" in html
    assert "2026-09-01 0.20 kWh" not in html
    days = html.split('<ol class="days">', 1)[1].split("</ol>", 1)[0]
    assert "2026-09-01" not in days
    assert 'data-series="Plant"' not in html
    assert 'href="/?day=2026-08-21&amp;unit=time"' in html
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in html
    assert "<dt>Current Power</dt><dd>50 W</dd>" in html


def test_time_stepper_previous_and_next_stop_at_first_and_last_local_day(
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
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        first = _plant_view_html(process, "/?day=2026-08-21&unit=time")
        last = _plant_view_html(process, "/?day=2026-08-22&unit=time")
    finally:
        process.stop()

    assert 'aria-label="Previous"' not in first
    assert 'href="/?day=2026-08-22&amp;unit=time"' in first
    assert 'href="/?day=2026-08-20' not in first
    assert 'aria-label="Next"' not in last
    assert 'href="/?day=2026-08-21&amp;unit=time"' in last
    assert 'href="/?day=2026-08-23' not in last


def test_day_stepper_previous_and_next_stop_at_first_and_last_history_month(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-09-01T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        august = _plant_view_html(process, "/?day=2026-08-21&unit=day")
        september = _plant_view_html(process, "/?day=2026-09-01&unit=day")
    finally:
        process.stop()

    assert ">2026-08<" in august
    assert 'aria-label="Previous"' not in august
    assert 'href="/?day=2026-09-01&amp;unit=day"' in august
    assert ">2026-09<" in september
    assert 'aria-label="Next"' not in september
    assert 'href="/?day=2026-08-21&amp;unit=day"' in september
    assert "2026-07" not in august
    assert "2026-10" not in september


def test_month_stepper_previous_and_next_stop_at_first_and_last_history_year(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2025-12-15T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-21T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        late = _plant_view_html(process, "/?day=2026-08-21&unit=month")
        early = _plant_view_html(process, "/?day=2025-12-15&unit=month")
    finally:
        process.stop()

    assert ">2026<" in late
    assert 'aria-label="Next"' not in late
    assert 'href="/?day=2025-12-15&amp;unit=month"' in late
    assert 'href="/?day=2027' not in late
    assert ">2025<" in early
    assert 'aria-label="Previous"' not in early
    assert 'href="/?day=2026-08-21&amp;unit=month"' in early
    assert 'href="/?day=2024' not in early
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in late
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in early


def test_year_grain_stepper_shows_history_year_range_and_has_no_previous_or_next(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2025-12-15T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-21T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        html = _plant_view_html(process, "/?day=2026-08-21&unit=year")
    finally:
        process.stop()

    assert ">2025–2026<" in html
    assert 'aria-label="Previous"' not in html
    assert 'aria-label="Next"' not in html
    assert "2025 1.10 kWh" in html
    assert "2026 0.20 kWh" in html
    assert 'href="/?day=2025-12-15&amp;unit=month"' in html
    assert 'href="/?day=2026-08-21&amp;unit=month"' in html
    bars = html.split('<ol class="days">', 1)[1].split("</ol>", 1)[0]
    assert bars.count('aria-current="true"') == 1
    assert 'aria-current="true"' in bars.split("2026 0.20 kWh", 1)[0]
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in html
    assert "<dt>Current Power</dt><dd>50 W</dd>" in html


def test_local_day_with_no_curve_samples_shows_one_sentence_and_no_empty_axes(
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
        html = _plant_view_html(process, "/?day=2026-08-22&unit=time")
    finally:
        process.stop()

    assert "This Local day has no curve Samples." in html
    assert "<svg" not in html.lower()
    assert "<canvas" not in html.lower()
    assert "<dt>Today energy</dt>" in html
    assert ">2026-08-22<" in html


def test_unknown_unit_is_time_grain(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        html = _plant_view_html(process, "/?day=2026-08-21&unit=week")
    finally:
        process.stop()

    assert 'aria-current="true">Time<' in html
    assert 'data-series="Plant"' in html


def test_month_grain_sums_local_day_today_energy_per_month_in_the_stepper_year(
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
        process.set_now("2026-08-22T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        process.set_now("2026-09-01T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56358, watts=50),
        )
        html = _plant_view_html(process, "/?day=2026-08-21&unit=month")
    finally:
        process.stop()

    assert ">2026<" in html
    assert 'aria-current="true">Month<' in html
    assert 'aria-label="Previous"' not in html
    assert 'aria-label="Next"' not in html
    assert "2026-08 4.10 kWh" in html
    assert "2026-09 0.20 kWh" in html
    assert 'href="/?day=2026-08-21&amp;unit=day"' in html
    assert 'href="/?day=2026-09-01&amp;unit=day"' in html
    assert "2026-08-21 3.90 kWh" not in html
    assert 'data-series="Plant"' not in html
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in html
    assert "<dt>Current Power</dt><dd>50 W</dd>" in html
    assert 'href="/?day=2026-08-21&amp;unit=time"' in html
    assert 'href="/?day=2026-08-21&amp;unit=year"' in html


def test_year_grain_sums_local_day_today_energy_per_year_in_history(
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
        process.set_now("2026-08-22T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        process.set_now("2026-09-01T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56358, watts=50),
        )
        html = _plant_view_html(process, "/?day=2026-08-21&unit=year")
    finally:
        process.stop()

    assert ">2026<" in html
    assert "2025" not in html
    assert 'aria-current="true">Year<' in html
    assert "2026 4.30 kWh" in html
    bars = html.split('<ol class="days">', 1)[1].split("</ol>", 1)[0]
    assert 'href="/?day=2026-08-21&amp;unit=month"' in bars
    assert bars.count('aria-current="true"') == 1
    assert "2026-08 4.10 kWh" not in html
    assert "2026-08-21 3.90 kWh" not in html
    assert 'data-series="Plant"' not in html
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in html
    assert "<dt>Current Power</dt><dd>50 W</dd>" in html
    assert 'href="/?day=2026-08-21&amp;unit=month"' in html


def test_last_sample_is_relative_age_of_current_power_not_a_clock(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-22T10:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-22T10:00:30-03:00")
        html = _plant_view_html(process)
    finally:
        process.stop()

    assert "Last sample" in html
    assert 'datetime="2026-08-22T10:00:00-03:00"' in html
    assert ">30s ago<" in html
    assert "<dt>Last sample</dt><dd>2026-08-22 10:00:00</dd>" not in html


def test_last_sample_ticks_from_inline_script_without_auto_refresh(
    wattloft: WattloftProcess,
) -> None:
    _ingest(wattloft, _ADMITTED_SERIAL, _live_shaped_upload_header())
    html = _plant_view_html(wattloft)
    assert "<script>" in html
    assert "setInterval" in html
    assert "last-sample" in html
    assert "http-equiv" not in html.lower()
    assert "prototype-state" not in html
    assert "PROTOTYPE" not in html


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
        html = _plant_view_html(process)
    finally:
        process.stop()

    assert "<dt>Today energy</dt><dd>2.40 kWh</dd>" in html
    assert "<dt>Today energy</dt><dd>3.50 kWh</dd>" not in html
    assert "<dt>Today energy</dt><dd>1.10 kWh</dd>" not in html
    assert "0.00 kWh" not in html
    assert "<dt>Current Power</dt><dd>400 W</dd>" in html
    assert "<dt>Lifetime energy</dt><dd>5735.4 kWh</dd>" in html
    assert 'datetime="2026-08-22T10:00:00-03:00"' in html
    assert ">0s ago<" in html


def test_local_day_bars_use_last_successful_today_energy_then_sum(
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
        process.set_now("2026-08-22T10:00:00-03:00")
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=20, lifetime_tenths=56356, watts=50),
        )
        html = _plant_view_html(process, "/?unit=day")
    finally:
        process.stop()

    assert 'href="/?day=2026-08-21&amp;unit=time"' in html
    assert "2026-08-21 3.90 kWh" in html
    assert 'href="/?day=2026-08-22&amp;unit=time"' in html
    assert "2026-08-22 0.20 kWh" in html
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in html
    assert "3.50 kWh" not in html
    assert "1.10 kWh" not in html


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
        html = _plant_view_html(process, "/?day=2026-08-21")
    finally:
        process.stop()

    assert 'data-series="3909309465"' in html
    assert 'data-series="3913630013"' in html
    assert 'data-series="Plant"' in html
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
    assert "<dt>Today energy</dt><dd>0.20 kWh</dd>" in html
    assert "<dt>Current Power</dt><dd>50 W</dd>" in html
    assert "<dt>Lifetime energy</dt><dd>5735.6 kWh</dd>" in html
    assert 'datetime="2026-08-22T10:00:00-03:00"' in html


def test_today_energy_dashes_when_no_logger_sampled_this_local_day(
    mysql_url: str,
) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        process.set_now("2026-08-22T10:40:00-03:00")
        html = _plant_view_html(process)
    finally:
        process.stop()

    assert "<dt>Today energy</dt><dd>-</dd>" in html
    assert "0.00 kWh" not in html
    assert "<dt>Current Power</dt><dd>625 W</dd>" in html
    assert 'datetime="2026-08-21T15:00:00-03:00"' in html
    assert ">19 hours ago<" in html
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


def _two_logger_selected_day_html(mysql_url: str) -> str:
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
        return _plant_view_html(process, "/?day=2026-08-21")
    finally:
        process.stop()


def _curve_data(html: str) -> dict[str, object]:
    raw = html.split('id="curve-data">', 1)[1].split("</script>", 1)[0]
    payload = json.loads(raw)
    assert isinstance(payload, dict)
    return payload


def test_time_curve_samples_carry_lifetime_energy(mysql_url: str) -> None:
    html = _two_logger_selected_day_html(mysql_url)
    payload = _curve_data(html)
    loggers = payload["loggers"]
    assert isinstance(loggers, dict)
    assert loggers["3909309465"] == [{"m": 15 * 60, "w": 625, "l": 5635.4}]
    assert loggers["3913630013"] == [{"m": 15 * 60 + 1, "w": 400, "l": 100.0}]
    assert "Plant" not in loggers


def test_time_curve_is_solar_hours_with_hair_and_series_toggles(mysql_url: str) -> None:
    html = _two_logger_selected_day_html(mysql_url)

    assert 'aria-current="true">Time<' in html
    assert 'text-anchor="middle">14</text>' in html
    assert 'text-anchor="middle">15</text>' in html
    assert 'text-anchor="middle">16</text>' in html
    assert 'text-anchor="middle">00</text>' not in html
    assert 'text-anchor="middle">18</text>' not in html
    assert 'text-anchor="middle">23</text>' not in html

    assert 'id="hair"' in html
    assert 'id="readout-when">12:00</' in html
    assert 'id="readout-plant" data-series="Plant"' in html
    assert 'data-series="3909309465"' in html
    assert 'data-series="3913630013"' in html
    readout = html.split('id="readout"', 1)[1].split("</div>", 1)[0]
    assert "Plant" in readout
    assert "3909309465" in readout
    assert "3913630013" in readout
    assert "—" in readout

    assert 'data-series="Plant" aria-pressed="true"' in html
    assert 'data-series="3909309465" aria-pressed="true"' in html
    assert 'data-series="3913630013" aria-pressed="true"' in html

    hint = html.split('class="hint"', 1)[1].split("</p>", 1)[0]
    assert "hide" in hint.lower()
    assert "Lifetime" in hint
    assert "valley" in hint.lower()

    assert "pointerdown" in html
    assert "http-equiv" not in html.lower()
    assert "location.reload" not in html
    assert "<script>" in html


def test_time_hour_label_eighteen_is_a_complete_centred_tick(mysql_url: str) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T17:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(
            process,
            _ADMITTED_SERIAL,
            _upload_header(today_cents=110, lifetime_tenths=56354, watts=200),
        )
        html = _plant_view_html(process, "/?day=2026-08-21&unit=time")
    finally:
        process.stop()

    assert 'text-anchor="middle">18</text>' in html
    assert 'text-anchor="middle">16</text>' in html
    assert 'text-anchor="middle">1</text>' not in html


def test_series_toggles_and_hair_are_time_grain_only(mysql_url: str) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, now="2026-08-21T15:00:00-03:00")
    process.start()
    process.wait_until_listening()
    try:
        _ingest(process, _ADMITTED_SERIAL, _live_shaped_upload_header())
        html = _plant_view_html(process, "/?day=2026-08-21&unit=day")
    finally:
        process.stop()

    assert 'aria-current="true">Day<' in html
    assert "aria-pressed" not in html
    assert 'id="hair"' not in html
    assert "Tap a name to show or hide its curve." not in html
    assert "pointerdown" not in html


def _svg_series(html: str, name: str) -> str:
    svg = html.split("<svg", 1)[1].split("</svg>", 1)[0]
    return svg.split(f'data-series="{name}"', 1)[1].split("</g>", 1)[0]


def _long_gap_html(
    mysql_url: str,
    *,
    later_lifetime_tenths: int,
    hole_logger: bool,
) -> str:
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
        return _plant_view_html(process, "/?day=2026-08-21")
    finally:
        process.stop()


def test_failure_hole_does_not_coerce_plant_to_include_zero_watts(
    mysql_url: str,
) -> None:
    html = _long_gap_html(
        mysql_url, later_lifetime_tenths=1000, hole_logger=True
    )
    assert 'data-series="3909309465"' in html
    logger = _svg_series(html, "3909309465")
    plant = _svg_series(html, "Plant")
    assert "<polyline" in logger
    assert "fail" in logger
    assert "fail" not in plant
    assert 'data-at="2026-08-21 10:20:00" data-watts="300"' in plant
    assert 'data-watts="0"' not in plant
    assert 'data-watts="400"' not in plant.split('data-at="2026-08-21 10:20:00"', 1)[1].split(">", 1)[0]


def test_lifetime_backed_gap_draws_smooth_logger_curve_not_a_valley(
    mysql_url: str,
) -> None:
    html = _long_gap_html(
        mysql_url, later_lifetime_tenths=1003, hole_logger=False
    )
    logger = _svg_series(html, "3909309465")
    plant = _svg_series(html, "Plant")
    assert "<polyline" in logger
    assert "fail" not in logger
    assert "fail" not in plant
    assert "<polyline" in plant
