from __future__ import annotations

import asyncio
import os
from collections.abc import Iterable

from wattloft.config import now_utc
from wattloft.history import record_sample
from wattloft.v5 import (
    CONTROL_DATA,
    build_ack,
    decode_upload_header,
    parse_v5,
    split_frames,
)

IDLE_TIMEOUT_S = 300
MAX_BUF = 65536


def idle_timeout_s() -> float:
    raw = os.environ.get("INGEST_IDLE_TIMEOUT_S")
    return float(raw) if raw is not None else IDLE_TIMEOUT_S


def handle_frame(
    database_url: str, admitted_logger_serials: Iterable[str], raw: bytes
) -> bytes | None:
    frame = parse_v5(raw)
    if frame is None:
        return None
    logger_serial = str(frame.logger_serial)
    if logger_serial not in admitted_logger_serials:
        return None
    if frame.control_code == CONTROL_DATA:
        header = decode_upload_header(frame.payload)
        if header is not None:
            record_sample(
                database_url,
                logger_serial=logger_serial,
                received_at=now_utc(),
                ac_power_w=header.ac_power_w,
                today_energy_kwh=header.today_energy_kwh,
                lifetime_energy_kwh=header.lifetime_energy_kwh,
            )
    return build_ack(frame)


async def serve_logger(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    database_url: str,
    admitted_logger_serials: frozenset[str],
) -> None:
    buf = b""
    timeout_s = idle_timeout_s()
    try:
        while True:
            chunk = await asyncio.wait_for(reader.read(4096), timeout=timeout_s)
            if not chunk:
                break
            buf += chunk
            frames, buf = split_frames(buf)
            if len(buf) > MAX_BUF:
                buf = b""
            for raw in frames:
                ack = await asyncio.to_thread(
                    handle_frame, database_url, admitted_logger_serials, raw
                )
                if ack is None:
                    return
                writer.write(ack)
                await writer.drain()
    except (TimeoutError, ConnectionError, OSError):
        return
    finally:
        writer.close()
        await writer.wait_closed()


async def start_ingest(
    host: str,
    port: int,
    database_url: str,
    admitted_logger_serials: frozenset[str],
) -> asyncio.Server:
    async def _client(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        await serve_logger(reader, writer, database_url, admitted_logger_serials)

    return await asyncio.start_server(_client, host, port)
