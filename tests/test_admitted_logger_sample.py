from __future__ import annotations

import socket
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from conftest import OPERATOR_PASSWORD, WattloftProcess

_LOCAL = ZoneInfo("America/Sao_Paulo")
_START = 0xA5
_END = 0x15
_CONTROL_DATA = 0x4210
_ADMITTED_SERIAL = 1000000001
_SEQUENCE = 4
# Proven 23-byte ACK: 10 zero-byte payload, control 0x1210, same sequence and logger serial.
_EXPECTED_ACK = bytes.fromhex("a50a001012040001ca9a3b00000000000000000000d015")


def _v5_frame(control: int, sequence: int, logger_serial: int, payload: bytes) -> bytes:
    length = len(payload).to_bytes(2, "little")
    body = (
        bytes([_START])
        + length
        + control.to_bytes(2, "little")
        + sequence.to_bytes(2, "little")
        + logger_serial.to_bytes(4, "little")
        + payload
    )
    checksum = sum(body[1:]) & 0xFF
    return body + bytes([checksum, _END])


def _live_shaped_upload_header() -> bytes:
    payload = bytearray(534)
    payload[21:31] = b"1234567890"
    payload[33:35] = (110).to_bytes(2, "little")
    payload[37:41] = (56354).to_bytes(4, "little")
    payload[59:63] = (625).to_bytes(4, "little")
    payload[245:251] = bytes([26, 8, 20, 11, 39, 15])
    return bytes(payload)


def _local_stamps(start: datetime, end: datetime) -> set[str]:
    stamps: set[str] = set()
    tick = start.replace(microsecond=0) - timedelta(seconds=1)
    last = end.replace(microsecond=0) + timedelta(seconds=1)
    while tick <= last:
        stamps.add(tick.strftime("%Y-%m-%d %H:%M:%S"))
        tick += timedelta(seconds=1)
    return stamps


def _recv_exact(sock: socket.socket, size: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < size:
        piece = sock.recv(size - len(chunks))
        if not piece:
            break
        chunks.extend(piece)
    return bytes(chunks)


def test_admitted_logger_data_frame_becomes_a_sample_on_plant_view(
    wattloft: WattloftProcess,
) -> None:
    frame = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    before = datetime.now(_LOCAL)
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        ack = _recv_exact(sock, len(_EXPECTED_ACK))
    after = datetime.now(_LOCAL)

    assert ack == _EXPECTED_ACK

    with httpx.Client(base_url=wattloft.url, follow_redirects=False) as client:
        client.post("/login", data={"password": OPERATOR_PASSWORD})
        html = client.get("/").text

    assert "This Plant has no History yet." not in html
    assert "Today energy" in html
    assert "1.10 kWh" in html
    assert "Current Power" in html
    assert "625 W" in html
    assert "Lifetime energy" in html
    assert "5635.4 kWh" in html
    assert "Last sample" in html
    assert "2026-08-20 11:39:15" not in html
    assert any(stamp in html for stamp in _local_stamps(before, after))
