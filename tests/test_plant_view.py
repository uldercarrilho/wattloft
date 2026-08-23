from __future__ import annotations

import httpx
import pytest

from conftest import WattloftProcess


def test_unauthenticated_get_of_plant_view_is_denied(plant_view_url: str) -> None:
    response = httpx.get(plant_view_url, follow_redirects=False)
    assert response.status_code == 401
    html = response.text
    assert 'lang="en"' in html
    assert "Password" in html
    assert "Log in" in html
    assert 'type="password"' in html
    assert "<script" not in html.lower()


def test_wrong_operator_password_is_rejected(plant_view_url: str) -> None:
    with httpx.Client(base_url=plant_view_url, follow_redirects=False) as client:
        rejected = client.post("/login", data={"password": "not-the-password"})
        assert rejected.status_code == 401
        still_denied = client.get("/")
        assert still_denied.status_code == 401


def test_correct_operator_password_grants_plant_view(plant_view_url: str) -> None:
    with httpx.Client(base_url=plant_view_url, follow_redirects=False) as client:
        granted = client.post("/login", data={"password": "correct-horse"})
        assert granted.status_code == 303
        view = client.get("/")
        assert view.status_code == 200


def test_logout_ends_the_operator_session(plant_view_url: str) -> None:
    with httpx.Client(base_url=plant_view_url, follow_redirects=False) as client:
        client.post("/login", data={"password": "correct-horse"})
        assert client.get("/").status_code == 200
        ended = client.post("/logout")
        assert ended.status_code == 303
        assert client.get("/").status_code == 401


def test_empty_history_shows_one_sentence_without_energy_power_or_chart_axes(
    plant_view_url: str,
) -> None:
    with httpx.Client(base_url=plant_view_url, follow_redirects=False) as client:
        client.post("/login", data={"password": "correct-horse"})
        html = client.get("/").text
        assert "This Plant has no History yet." in html
        assert "Today energy" not in html
        assert "Current Power" not in html
        assert "Lifetime energy" not in html
        assert "Log out" in html
        assert "<svg" not in html.lower()
        assert "<canvas" not in html.lower()
        assert "<script" not in html.lower()


def test_empty_history_survives_process_restart(wattloft: WattloftProcess) -> None:
    with httpx.Client(base_url=wattloft.url, follow_redirects=False) as client:
        client.post("/login", data={"password": "correct-horse"})
        assert "This Plant has no History yet." in client.get("/").text
    wattloft.restart()
    with httpx.Client(base_url=wattloft.url, follow_redirects=False) as client:
        client.post("/login", data={"password": "correct-horse"})
        html = client.get("/").text
        assert "This Plant has no History yet." in html
        assert "Today energy" not in html
        assert "Current Power" not in html


def test_plant_view_does_not_serve_when_history_store_is_unreachable() -> None:
    process = WattloftProcess(
        "mysql://wattloft:wattloft@127.0.0.1:1/wattloft?connect_timeout=2"
    )
    process.start()
    try:
        assert process.wait_until_exited() != 0
        with pytest.raises(httpx.TransportError):
            httpx.get(process.url, timeout=0.5)
    finally:
        process.stop()
