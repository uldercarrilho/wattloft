from __future__ import annotations

import socket
from datetime import datetime

from conftest import WattloftProcess, _reset_history
from snapshot import assert_empty_history, snapshot_json
from test_admitted_logger_sample import (
    _ADMITTED_SERIAL,
    _CONTROL_DATA,
    _EXPECTED_ACK,
    _LOCAL,
    _SEQUENCE,
    _live_shaped_upload_header,
    _recv_exact,
    _v5_frame,
    assert_last_sample_is_receive_time,
)
from wattloft.history import dump_history, restore_history


def _ingest_one_sample(wattloft: WattloftProcess) -> tuple[datetime, datetime]:
    frame = _v5_frame(
        _CONTROL_DATA, _SEQUENCE, _ADMITTED_SERIAL, _live_shaped_upload_header()
    )
    before = datetime.now(_LOCAL)
    with socket.create_connection(("127.0.0.1", wattloft.ingest_port), timeout=5) as sock:
        sock.sendall(frame)
        ack = _recv_exact(sock, len(_EXPECTED_ACK))
    after = datetime.now(_LOCAL)
    assert ack == _EXPECTED_ACK
    return before, after


def _assert_sample_on_snapshot(
    wattloft: WattloftProcess, *, before: datetime, after: datetime
) -> None:
    body = snapshot_json(wattloft.url)
    assert body["today_energy_kwh"] == 1.1
    assert body["current_power_w"] == 625
    assert body["lifetime_energy_kwh"] == 5635.4
    assert_last_sample_is_receive_time(body, before=before, after=after)


def test_operator_sees_history_after_process_restart(
    wattloft: WattloftProcess,
) -> None:
    before, after = _ingest_one_sample(wattloft)
    _assert_sample_on_snapshot(wattloft, before=before, after=after)
    wattloft.restart()
    _assert_sample_on_snapshot(wattloft, before=before, after=after)


def test_dumped_history_restores_onto_plant_view(
    mysql_url: str, wattloft: WattloftProcess
) -> None:
    before, after = _ingest_one_sample(wattloft)
    _assert_sample_on_snapshot(wattloft, before=before, after=after)

    dump = dump_history(mysql_url)
    _reset_history(mysql_url)
    wattloft.restart()
    assert_empty_history(wattloft.url)

    restore_history(mysql_url, dump)
    wattloft.restart()
    _assert_sample_on_snapshot(wattloft, before=before, after=after)
