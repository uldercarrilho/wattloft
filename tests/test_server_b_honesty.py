from __future__ import annotations

import socket
import time

import httpx
import pytest

from conftest import OPERATOR_PASSWORD, WattloftProcess, _reset_history
from wattloft.ingest import IDLE_TIMEOUT_S
from test_admitted_logger_sample import (
    _ADMITTED_SERIAL,
    _CONTROL_DATA,
    _EXPECTED_ACK,
    _SEQUENCE,
    _live_shaped_upload_header,
    _recv_exact,
    _v5_frame,
)

_CONTROL_HELLO = 0x4110
_CONTROL_HEARTBEAT = 0x4710
_UNKNOWN_SERIAL = 1111111111
# Proven 23-byte ACK: 10 zero-byte payload, control 0x1110, same sequence and logger serial.
_EXPECTED_HELLO_ACK = bytes.fromhex("a50a001011040001ca9a3b00000000000000000000cf15")
# Proven 23-byte ACK: 10 zero-byte payload, control 0x1710, same sequence and logger serial.
_EXPECTED_HEARTBEAT_ACK = bytes.fromhex("a50a001017040001ca9a3b00000000000000000000d515")


def _plant_view_html(wattloft: WattloftProcess) -> str:
    with httpx.Client(base_url=wattloft.url, follow_redirects=False) as client:
        client.post("/login", data={"password": OPERATOR_PASSWORD})
        return client.get("/").text


def _no_ack(sock: socket.socket) -> bytes:
    sock.settimeout(1)
    try:
        return sock.recv(23)
    except socket.timeout:
        return b""


def _night_shaped_upload_header() -> bytes:
    payload = bytearray(_live_shaped_upload_header())
    payload[59:63] = (0).to_bytes(4, "little")
    return bytes(payload)


def _stranger_shaped_upload_header() -> bytes:
    payload = bytearray(_live_shaped_upload_header())
    payload[33:35] = (999).to_bytes(2, "little")
    payload[37:41] = (1000).to_bytes(4, "little")
    payload[59:63] = (50).to_bytes(4, "little")
    return bytes(payload)


def _undecodable_upload_header() -> bytes:
    return bytes(534)


def test_hello_is_acked_and_does_not_appear_as_a_sample(
    wattloft: WattloftProcess,
) -> None:
    frame = _v5_frame(
        _CONTROL_HELLO, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        ack = _recv_exact(sock, len(_EXPECTED_HELLO_ACK))

    assert ack == _EXPECTED_HELLO_ACK

    html = _plant_view_html(wattloft)
    assert "This Plant has no History yet." in html
    assert "625 W" not in html
    assert "1.10 kWh" not in html
    assert "5635.4 kWh" not in html


def test_heartbeat_is_acked_and_does_not_appear_as_a_sample(
    wattloft: WattloftProcess,
) -> None:
    frame = _v5_frame(
        _CONTROL_HEARTBEAT, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        ack = _recv_exact(sock, len(_EXPECTED_HEARTBEAT_ACK))

    assert ack == _EXPECTED_HEARTBEAT_ACK

    html = _plant_view_html(wattloft)
    assert "This Plant has no History yet." in html
    assert "625 W" not in html
    assert "1.10 kWh" not in html
    assert "5635.4 kWh" not in html


def test_truncated_frame_is_not_acked_and_plant_view_gains_no_zero_power(
    wattloft: WattloftProcess,
) -> None:
    frame = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame[:-10])
        sock.settimeout(0.2)
        with pytest.raises(socket.timeout):
            sock.recv(23)

    html = _plant_view_html(wattloft)
    assert "This Plant has no History yet." in html
    assert "0 W" not in html
    assert "0.00 kWh" not in html
    assert "0.0 kWh" not in html


def test_bad_checksum_frame_is_not_acked_and_plant_view_gains_no_zero_power(
    wattloft: WattloftProcess,
) -> None:
    frame = bytearray(
        _v5_frame(
            _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
        )
    )
    frame[-2] = (frame[-2] + 1) & 0xFF
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        ack = _no_ack(sock)

    assert ack == b""

    html = _plant_view_html(wattloft)
    assert "This Plant has no History yet." in html
    assert "0 W" not in html
    assert "0.00 kWh" not in html
    assert "0.0 kWh" not in html


def test_unknown_logger_serial_is_closed_with_no_ack_and_plant_view_unchanged(
    wattloft: WattloftProcess,
) -> None:
    admitted = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(admitted)
        assert _recv_exact(sock, len(_EXPECTED_ACK)) == _EXPECTED_ACK

    before = _plant_view_html(wattloft)
    assert "625 W" in before
    assert "1.10 kWh" in before

    stranger = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _UNKNOWN_SERIAL, _stranger_shaped_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(stranger)
        sock.settimeout(2)
        ack = sock.recv(23)

    assert ack == b""

    html = _plant_view_html(wattloft)
    assert "625 W" in html
    assert "1.10 kWh" in html
    assert "5635.4 kWh" in html
    assert "50 W" not in html
    assert "9.99 kWh" not in html
    assert "100.0 kWh" not in html
    assert "This Plant has no History yet." not in html


def test_night_zero_watt_data_frame_shows_current_power_as_zero_watts_not_a_dash(
    wattloft: WattloftProcess,
) -> None:
    frame = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _night_shaped_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        ack = _recv_exact(sock, len(_EXPECTED_ACK))

    assert ack == _EXPECTED_ACK

    html = _plant_view_html(wattloft)
    assert "<dt>Current Power</dt><dd>0 W</dd>" in html
    assert "1.10 kWh" in html
    assert "5635.4 kWh" in html
    assert "This Plant has no History yet." not in html


def test_failed_parse_is_acked_but_does_not_display_as_zero(
    wattloft: WattloftProcess,
) -> None:
    frame = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _undecodable_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        ack = _recv_exact(sock, len(_EXPECTED_ACK))

    assert ack == _EXPECTED_ACK

    html = _plant_view_html(wattloft)
    assert "This Plant has no History yet." in html
    assert "0 W" not in html
    assert "0.00 kWh" not in html
    assert "0.0 kWh" not in html


def test_failed_parse_does_not_zero_an_existing_sample(
    wattloft: WattloftProcess,
) -> None:
    good = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(good)
        assert _recv_exact(sock, len(_EXPECTED_ACK)) == _EXPECTED_ACK

    bad = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _undecodable_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(bad)
        ack = _recv_exact(sock, len(_EXPECTED_ACK))

    assert ack == _EXPECTED_ACK

    html = _plant_view_html(wattloft)
    assert "625 W" in html
    assert "1.10 kWh" in html
    assert "0 W" not in html
    assert "0.00 kWh" not in html


def test_ingest_idle_timeout_default_is_300_seconds() -> None:
    assert IDLE_TIMEOUT_S == 300


def _hello_after_idle(wattloft: WattloftProcess, idle_s: float) -> bytes:
    frame = _v5_frame(
        _CONTROL_HELLO, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        time.sleep(idle_s)
        try:
            sock.sendall(frame)
            sock.settimeout(1)
            return _recv_exact(sock, len(_EXPECTED_HELLO_ACK))
        except (TimeoutError, ConnectionError, OSError):
            return b""


def test_ingest_idle_timeout_keeps_connection_until_deadline(mysql_url: str) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, extra_env={"INGEST_IDLE_TIMEOUT_S": "0.4"})
    process.start()
    process.wait_until_listening()
    try:
        ack = _hello_after_idle(process, 0.2)
    finally:
        process.stop()

    assert ack == _EXPECTED_HELLO_ACK


def test_ingest_idle_timeout_closes_after_deadline(mysql_url: str) -> None:
    _reset_history(mysql_url)
    process = WattloftProcess(mysql_url, extra_env={"INGEST_IDLE_TIMEOUT_S": "0.4"})
    process.start()
    process.wait_until_listening()
    try:
        ack = _hello_after_idle(process, 0.6)
    finally:
        process.stop()

    assert ack == b""
