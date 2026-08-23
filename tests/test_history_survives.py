from __future__ import annotations

import socket
from datetime import datetime

import httpx

from conftest import OPERATOR_PASSWORD, WattloftProcess, _reset_history
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


def _plant_view_html(wattloft: WattloftProcess) -> str:
    with httpx.Client(base_url=wattloft.url, follow_redirects=False) as client:
        client.post("/login", data={"password": OPERATOR_PASSWORD})
        return client.get("/").text


def _assert_sample_on_plant_view(
    html: str, *, before: datetime, after: datetime
) -> None:
    assert "This Plant has no History yet." not in html
    assert "1.10 kWh" in html
    assert "625 W" in html
    assert "5635.4 kWh" in html
    assert_last_sample_is_receive_time(html, before=before, after=after)


def test_operator_sees_history_after_process_restart(
    wattloft: WattloftProcess,
) -> None:
    before, after = _ingest_one_sample(wattloft)
    _assert_sample_on_plant_view(_plant_view_html(wattloft), before=before, after=after)

    wattloft.restart()

    with httpx.Client(base_url=wattloft.url, follow_redirects=False) as client:
        denied = client.get("/")
        assert denied.status_code == 401
        client.post("/login", data={"password": OPERATOR_PASSWORD})
        html = client.get("/").text
    _assert_sample_on_plant_view(html, before=before, after=after)


def test_dumped_history_restores_onto_plant_view(
    mysql_url: str, wattloft: WattloftProcess
) -> None:
    before, after = _ingest_one_sample(wattloft)
    _assert_sample_on_plant_view(_plant_view_html(wattloft), before=before, after=after)

    dump = dump_history(mysql_url)
    _reset_history(mysql_url)
    wattloft.restart()
    assert "This Plant has no History yet." in _plant_view_html(wattloft)

    restore_history(mysql_url, dump)
    wattloft.restart()
    _assert_sample_on_plant_view(_plant_view_html(wattloft), before=before, after=after)
