from __future__ import annotations

import asyncio
import os
from collections.abc import Callable, Iterable

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
HANDSHAKE_TIMEOUT_S = 10.0
MAX_BUF = 65536
MAX_CONCURRENT_CONNECTIONS = 20
MAX_CONNECTIONS_PER_IP = 2


def max_concurrent_connections() -> int:
    raw = os.environ.get("INGEST_MAX_CONCURRENT_CONNECTIONS")
    return int(raw) if raw is not None else MAX_CONCURRENT_CONNECTIONS


def max_connections_per_ip() -> int:
    raw = os.environ.get("INGEST_MAX_CONNECTIONS_PER_IP")
    return int(raw) if raw is not None else MAX_CONNECTIONS_PER_IP


def idle_timeout_s() -> float:
    raw = os.environ.get("INGEST_IDLE_TIMEOUT_S")
    return float(raw) if raw is not None else IDLE_TIMEOUT_S


def handshake_timeout_s() -> float:
    raw = os.environ.get("INGEST_HANDSHAKE_TIMEOUT_S")
    return float(raw) if raw is not None else HANDSHAKE_TIMEOUT_S


def handle_frame(
    database_url: str,
    admitted_logger_serials: Iterable[str],
    raw: bytes,
    *,
    on_sample: Callable[[dict[str, object]], None] | None = None,
) -> bytes | None:
    frame = parse_v5(raw)
    if frame is None:
        return None
    logger_serial = str(frame.logger_serial)
    if logger_serial not in admitted_logger_serials:
        return None
    if frame.control_code == CONTROL_DATA:
        header = decode_upload_header(frame.payload)
        received_at = now_utc()
        if header is None:
            record_sample(
                database_url,
                logger_serial=logger_serial,
                received_at=received_at,
                ac_power_w=None,
                today_energy_kwh=None,
                lifetime_energy_kwh=None,
                parse_succeeded=False,
            )
        else:
            record_sample(
                database_url,
                logger_serial=logger_serial,
                received_at=received_at,
                ac_power_w=header.ac_power_w,
                today_energy_kwh=header.today_energy_kwh,
                lifetime_energy_kwh=header.lifetime_energy_kwh,
            )
            if on_sample is not None:
                received_str = received_at.isoformat().replace("+00:00", "Z")
                on_sample({
                    "type": "sample",
                    "logger_serial": logger_serial,
                    "received_at": received_str,
                    "ac_power_w": header.ac_power_w,
                    "today_energy_kwh": header.today_energy_kwh,
                    "lifetime_energy_kwh": header.lifetime_energy_kwh,
                })
    return build_ack(frame)


async def serve_logger(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    database_url: str,
    admitted_logger_serials: frozenset[str],
    *,
    on_sample: Callable[[dict[str, object]], None] | None = None,
) -> None:
    buf = b""
    timeout_s = idle_timeout_s()
    hs_timeout_s = handshake_timeout_s()
    first_chunk = True
    try:
        while True:
            cur_timeout = min(timeout_s, hs_timeout_s) if first_chunk else timeout_s
            chunk = await asyncio.wait_for(reader.read(4096), timeout=cur_timeout)
            if not chunk:
                break
            first_chunk = False
            buf += chunk
            frames, buf = split_frames(buf)
            if len(buf) > MAX_BUF:
                buf = b""
            for raw in frames:
                ack = await asyncio.to_thread(
                    handle_frame,
                    database_url,
                    admitted_logger_serials,
                    raw,
                    on_sample=on_sample,
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
    *,
    on_sample: Callable[[dict[str, object]], None] | None = None,
) -> asyncio.Server:
    max_connections = max_concurrent_connections()
    max_per_ip = max_connections_per_ip()
    active_connections = 0
    ip_connections: dict[str, int] = {}
    lock = asyncio.Lock()

    async def _client(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        nonlocal active_connections
        peer = writer.get_extra_info("peername")
        client_ip = str(peer[0]) if isinstance(peer, (tuple, list)) and len(peer) > 0 else "unknown"

        async with lock:
            if (
                active_connections >= max_connections
                or ip_connections.get(client_ip, 0) >= max_per_ip
            ):
                writer.close()
                await writer.wait_closed()
                return
            active_connections += 1
            ip_connections[client_ip] = ip_connections.get(client_ip, 0) + 1
        try:
            await serve_logger(
                reader, writer, database_url, admitted_logger_serials, on_sample=on_sample
            )
        finally:
            async with lock:
                active_connections -= 1
                count = ip_connections.get(client_ip, 0) - 1
                if count <= 0:
                    ip_connections.pop(client_ip, None)
                else:
                    ip_connections[client_ip] = count

    return await asyncio.start_server(_client, host, port)

