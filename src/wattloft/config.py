from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

ADMITTED_LOGGER_SERIALS = frozenset({"1000000001", "1000000002"})


def now_utc() -> datetime:
    raw = os.environ.get("WATTLOFT_NOW")
    path = os.environ.get("WATTLOFT_NOW_FILE")
    if path is not None:
        raw = Path(path).read_text(encoding="utf-8").strip()
    if not raw:
        return datetime.now(timezone.utc)
    stamped = datetime.fromisoformat(raw)
    if stamped.tzinfo is None:
        stamped = stamped.replace(tzinfo=timezone.utc)
    return stamped.astimezone(timezone.utc)
