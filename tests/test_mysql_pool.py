from __future__ import annotations

from queue import Queue
from unittest.mock import MagicMock, patch

import pytest

from wattloft.history._mysql import _ConnectionPool, _ssl_config


def test_ssl_config_none_when_ssl_param_missing() -> None:
    assert _ssl_config("mysql://user:pass@127.0.0.1:3306/db") is None
    assert _ssl_config("mysql://user:pass@10.0.1.64:3306/db?connect_timeout=5") is None


def test_ssl_config_defaults_to_unverified_hostname_for_private_ip() -> None:
    config = _ssl_config("mysql://user:pass@10.0.1.64:3306/db?ssl=true")
    assert config == {"check_hostname": False}

    config_1 = _ssl_config("mysql://user:pass@10.0.1.64:3306/db?ssl=1")
    assert config_1 == {"check_hostname": False}

    config_req = _ssl_config("mysql://user:pass@10.0.1.64:3306/db?ssl=required")
    assert config_req == {"check_hostname": False}


def test_ssl_config_explicit_check_hostname() -> None:
    config = _ssl_config("mysql://user:pass@db.example.com:3306/db?ssl=true&check_hostname=true")
    assert config is not None
    assert config.get("check_hostname") is True


def test_ssl_config_explicit_check_hostname_false() -> None:
    config = _ssl_config("mysql://user:pass@db.example.com:3306/db?ssl=true&check_hostname=false")
    assert config == {"check_hostname": False}


def test_ssl_config_custom_ca_bundle(monkeypatch: pytest.MonkeyPatch, tmp_path: pytest.TempPathFactory) -> None:
    ca_file = tmp_path / "custom_ca.pem"  # type: ignore[operator]
    ca_file.write_text("dummy-cert", encoding="utf-8")
    monkeypatch.setenv("WATTLOFT_DB_SSL_CA", str(ca_file))

    config = _ssl_config("mysql://user:pass@10.0.1.64:3306/db?ssl=true")
    assert config == {"ca": str(ca_file), "check_hostname": True}


def test_pool_creates_and_reuses_idle_connection() -> None:
    pool = _ConnectionPool("mysql://user:pass@127.0.0.1:3306/testdb")

    mock_conn = MagicMock()
    mock_conn.ping.return_value = None

    with patch("wattloft.history._mysql._connect", return_value=mock_conn):
        c1 = pool.acquire()
        assert c1 is mock_conn
        assert pool._created == 1

        pool.release(c1)
        assert pool._idle.qsize() == 1

        # Second acquire should retrieve the idle connection immediately
        c2 = pool.acquire(timeout=0.5)
        assert c2 is mock_conn
        assert pool._idle.qsize() == 0

        pool.release(c2)


def test_pool_times_out_when_all_connections_exhausted() -> None:
    pool = _ConnectionPool("mysql://user:pass@127.0.0.1:3306/testdb")

    mock_conns = [MagicMock() for _ in range(5)]
    with patch("wattloft.history._mysql._connect", side_effect=mock_conns):
        checked_out = [pool.acquire() for _ in range(5)]
        assert pool._created == 5
        assert pool._idle.qsize() == 0

        with pytest.raises(TimeoutError, match="Timed out waiting for an idle database connection"):
            pool.acquire(timeout=0.05)

        # Release one and verify acquire succeeds
        pool.release(checked_out[0])
        reacquired = pool.acquire(timeout=0.1)
        assert reacquired is checked_out[0]
