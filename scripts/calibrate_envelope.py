"""CLI script to inspect history, identify reference sunny days, and calibrate the solar envelope."""
from __future__ import annotations

import os
import sys

from wattloft.solar.calibration import find_sunny_days, load_calibration, run_calibration


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL environment variable is required", file=sys.stderr)
        sys.exit(1)

    print("Searching for reference sunny days in History...")
    sunny_days = find_sunny_days(database_url)
    print(f"Found {len(sunny_days)} reference clear-sky sunny days:")
    for local_day, points in sunny_days:
        peak_w = max(w for _, w in points) if points else 0.0
        energy_kwh = sum(w / 60000.0 for _, w in points)
        print(f"  - {local_day}: peak={peak_w:.1f}W, energy={energy_kwh:.2f}kWh, samples={len(points)}")

    print("\nRunning envelope calibration...")
    cal = run_calibration(database_url)
    print("\nCalibration result:")
    print(f"  Calibrated: {cal.calibrated}")
    print(f"  Sunny days used: {cal.sunny_days_count}")
    print(f"  Scale multiplier: {cal.scale}")
    print(f"  Effective tilt: {cal.tilt_deg} deg")
    print(f"  Azimuth offset: {cal.azimuth_offset_deg} deg")
    print(f"  Elevation cutoff: {cal.elevation_cutoff_deg} deg")
    print(f"  AC nameplate cap: {cal.ac_cap_w} W")
    print(f"  Calibrated at: {cal.last_calibrated_at}")


if __name__ == "__main__":
    main()
