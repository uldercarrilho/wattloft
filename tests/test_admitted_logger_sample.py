from __future__ import annotations

import socket
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from conftest import WattloftProcess
from snapshot import assert_current_power_at, snapshot_json

_LOCAL = ZoneInfo("America/Sao_Paulo")
_START = 0xA5
_END = 0x15
_CONTROL_DATA = 0x4210
_ADMITTED_SERIAL = 3909309465
_SEQUENCE = 4
# Proven 23-byte ACK: 10 zero-byte payload, control 0x1210, same sequence and logger serial.
_EXPECTED_ACK = bytes.fromhex("a50a0010120400195403e9000000000000000000008915")


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
    payload[21:31] = b"2301296636"
    payload[33:35] = (110).to_bytes(2, "little")
    payload[37:41] = (56354).to_bytes(4, "little")
    payload[59:63] = (625).to_bytes(4, "little")
    payload[245:251] = bytes([26, 8, 20, 11, 39, 15])
    return bytes(payload)


def assert_last_sample_is_receive_time(
    body: dict[str, object], *, before: datetime, after: datetime
) -> None:
    assert_current_power_at(body, before=before, after=after)
    earliest = before.replace(microsecond=0) - timedelta(seconds=1)
    latest = after.replace(microsecond=0) + timedelta(seconds=1)
    at = datetime.fromisoformat(str(body["current_power_at"]))
    assert earliest <= at <= latest


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

    body = snapshot_json(wattloft.url)
    assert body["today_energy_kwh"] == 1.1
    assert body["current_power_w"] == 625
    assert body["lifetime_energy_kwh"] == 5635.4
    assert "2026-08-20T11:39:15" not in str(body["current_power_at"])
    assert_last_sample_is_receive_time(body, before=before, after=after)
