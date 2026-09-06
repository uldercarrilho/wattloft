from __future__ import annotations

import httpx
import pytest

from conftest import WattloftProcess
from snapshot import assert_empty_history, get_snapshot


def test_empty_history_is_snapshot_not_found(wattloft: WattloftProcess) -> None:
    assert_empty_history(wattloft.url)


def test_empty_history_survives_process_restart(wattloft: WattloftProcess) -> None:
    assert_empty_history(wattloft.url)
    wattloft.restart()
    assert_empty_history(wattloft.url)


def test_snapshot_does_not_serve_when_history_store_is_unreachable() -> None:
    process = WattloftProcess(
        "mysql://wattloft:wattloft@127.0.0.1:1/wattloft?connect_timeout=2"
    )
    process.start()
    try:
        assert process.wait_until_exited() != 0
        with pytest.raises(httpx.TransportError):
            get_snapshot(process.url)
    finally:
        process.stop()
