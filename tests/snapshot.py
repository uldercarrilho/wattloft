from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import httpx


def get_snapshot(base_url: str, day: str | None = None) -> httpx.Response:
    params = {"day": day} if day else None
    return httpx.get(f"{base_url}/snapshot", params=params, follow_redirects=False)


def snapshot_json(base_url: str, day: str | None = None) -> dict[str, Any]:
    response = get_snapshot(base_url, day)
    assert response.status_code == 200, response.text
    body = response.json()
    assert isinstance(body, dict)
    return body


def assert_empty_history(base_url: str) -> None:
    response = get_snapshot(base_url)
    assert response.status_code == 404
    assert response.content == b""


def assert_current_power_at(
    body: dict[str, Any], *, before: datetime, after: datetime
) -> None:
    at = datetime.fromisoformat(str(body["current_power_at"]))
    earliest = before.replace(microsecond=0) - timedelta(seconds=1)
    latest = after.replace(microsecond=0) + timedelta(seconds=1)
    assert earliest <= at <= latest


def curve_series(body: dict[str, Any], name: str) -> dict[str, Any]:
    for series in body["curve"]:
        assert isinstance(series, dict)
        if series["name"] == name:
            return series
    raise AssertionError(f"missing curve series {name}")


def bar_kwh(body: dict[str, Any], local_day: str) -> float:
    for bar in body["local_day_bars"]:
        assert isinstance(bar, dict)
        if bar["local_day"] == local_day:
            return float(bar["today_energy_kwh"])
    raise AssertionError(f"missing bar {local_day}")
