from __future__ import annotations

from dataclasses import dataclass

START = 0xA5
END = 0x15
CONTROL_DATA = 0x4210
HEADER_LEN = 11
ACK_PAYLOAD = bytes(10)


@dataclass(frozen=True)
class V5Frame:
    control_code: int
    sequence: int
    logger_serial: int
    payload: bytes


@dataclass(frozen=True)
class UploadHeader:
    ac_power_w: float
    today_energy_kwh: float
    lifetime_energy_kwh: float


def build_v5_frame(
    control_code: int, sequence: int, logger_serial: int, payload: bytes
) -> bytes:
    length = len(payload).to_bytes(2, "little")
    body = (
        bytes([START])
        + length
        + control_code.to_bytes(2, "little")
        + sequence.to_bytes(2, "little")
        + logger_serial.to_bytes(4, "little")
        + payload
    )
    checksum = sum(body[1:]) & 0xFF
    return body + bytes([checksum, END])


def parse_v5(raw: bytes) -> V5Frame | None:
    if len(raw) < HEADER_LEN + 2:
        return None
    if raw[0] != START or raw[-1] != END:
        return None
    payload_len = int.from_bytes(raw[1:3], "little")
    if len(raw) != HEADER_LEN + payload_len + 2:
        return None
    if (sum(raw[1:-2]) & 0xFF) != raw[-2]:
        return None
    return V5Frame(
        control_code=int.from_bytes(raw[3:5], "little"),
        sequence=int.from_bytes(raw[5:7], "little"),
        logger_serial=int.from_bytes(raw[7:11], "little"),
        payload=raw[11 : 11 + payload_len],
    )


def split_frames(buf: bytes) -> tuple[list[bytes], bytes]:
    frames: list[bytes] = []
    i = 0
    while True:
        start = buf.find(bytes([START]), i)
        if start < 0:
            return frames, b""
        if start + 3 > len(buf):
            return frames, buf[start:]
        payload_len = int.from_bytes(buf[start + 1 : start + 3], "little")
        total = HEADER_LEN + payload_len + 2
        if start + total > len(buf):
            return frames, buf[start:]
        frames.append(buf[start : start + total])
        i = start + total


def ack_control(control_code: int) -> int:
    return (control_code & 0x0FFF) | 0x1000


def build_ack(frame: V5Frame) -> bytes:
    return build_v5_frame(
        ack_control(frame.control_code), frame.sequence, frame.logger_serial, ACK_PAYLOAD
    )


def decode_upload_header(payload: bytes) -> UploadHeader | None:
    if len(payload) < 63:
        return None
    if not payload[21:31].isdigit():
        return None
    today_energy_kwh = int.from_bytes(payload[33:35], "little") / 100
    lifetime_energy_kwh = int.from_bytes(payload[37:41], "little") / 10
    ac_power_w = float(int.from_bytes(payload[59:63], "little"))
    return UploadHeader(ac_power_w, today_energy_kwh, lifetime_energy_kwh)
