from __future__ import annotations

import os
from datetime import datetime, timezone

ADMITTED_LOGGER_SERIALS = frozenset({"1000000001", "1000000002"})


def now_utc() -> datetime:
    raw = os.environ.get("WATTLOFT_NOW")
    if raw is None:
        return datetime.now(timezone.utc)
    stamped = datetime.fromisoformat(raw)
    if stamped.tzinfo is None:
        stamped = stamped.replace(tzinfo=timezone.utc)
    return stamped.astimezone(timezone.utc)
