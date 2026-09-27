from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

ADMITTED_LOGGER_SERIALS = frozenset({"3909309465", "3913630013"})
LOGGER_DISPLAY_NAMES = {
    "3909309465": "East",
    "3913630013": "West",
}

PLANT_LATITUDE = float(os.environ.get("WATTLOFT_PLANT_LATITUDE", "-23.5505"))
PLANT_LONGITUDE = float(os.environ.get("WATTLOFT_PLANT_LONGITUDE", "-46.6333"))
MICROINVERTER_NAMEPLATE_W = float(os.environ.get("WATTLOFT_MICROINVERTER_NAMEPLATE_W", "1000.0"))
PLANT_PEAK_DC_CAPACITY_W = float(os.environ.get("WATTLOFT_PLANT_PEAK_DC_CAPACITY_W", "2000.0"))
DRIFT_VARIANCE_THRESHOLD = float(os.environ.get("WATTLOFT_DRIFT_VARIANCE_THRESHOLD", "0.05"))



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
