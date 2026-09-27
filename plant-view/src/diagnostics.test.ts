import { describe, expect, it } from "vitest";
import { computeDiagnostics } from "./diagnostics";
import type { PlantSnapshot } from "./types";

describe("computeDiagnostics - Hybrid Solar Envelope Calibration", () => {
  const baseSnapshot: PlantSnapshot = {
    selected_day: "2026-09-25",
    current_power_w: 1200,
    lifetime_energy_kwh: 5000,
    current_power_at: "2026-09-25T12:00:00",
    today_energy_kwh: 8.5,
    local_day_bars: [
      {
        local_day: "2026-09-25",
        today_energy_kwh: 8.5,
        loggers: [
          { name: "East", today_energy_kwh: 4.3 },
          { name: "West", today_energy_kwh: 4.2 },
        ],
      },
    ],
    curve: [
      {
        name: "Plant",
        points: [
          { at: "2026-09-25T11:00:00", watts: 1500 },
          { at: "2026-09-25T12:00:00", watts: 1800 },
        ],
      },
    ],
    ideal_curve: [
      { at: "2026-09-25T11:00:00", watts: 1600 },
      { at: "2026-09-25T12:00:00", watts: 1900 },
    ],
  };

  it("computes baseline clear-sky envelope efficiency when uncalibrated", () => {
    const diag = computeDiagnostics(baseSnapshot);
    expect(diag.solarEnvelope.actualPeakW).toBe(1800);
    expect(diag.solarEnvelope.idealPeakW).toBe(1900);
    expect(diag.solarEnvelope.efficiencyPct).toBe(95);
    expect(diag.solarEnvelope.status).toBe("optimal");
    expect(diag.solarEnvelope.calibration).toBeNull();
  });

  it("surfaces calibration metadata when snapshot includes calibrated envelope", () => {
    const snapshotWithCal: PlantSnapshot = {
      ...baseSnapshot,
      envelope_calibration: {
        calibrated: true,
        sunny_days_count: 4,
        last_calibrated_at: "2026-09-24T23:59:00",
        scale: 0.95,
        tilt_deg: 18.0,
        azimuth_offset_deg: 2.0,
        elevation_cutoff_deg: 6.0,
        ac_cap_w: 2000.0,
      },
    };

    const diag = computeDiagnostics(snapshotWithCal);
    expect(diag.solarEnvelope.calibration).not.toBeNull();
    expect(diag.solarEnvelope.calibration?.calibrated).toBe(true);
    expect(diag.solarEnvelope.calibration?.sunnyDaysCount).toBe(4);
    expect(diag.solarEnvelope.calibration?.lastCalibratedAt).toBe("2026-09-24T23:59:00");
  });

  it("computes array balance with default and custom thresholdPct", () => {
    // Default fallback to 5%
    const diagDefault = computeDiagnostics(baseSnapshot);
    expect(diagDefault.arrayBalance.thresholdPct).toBe(5);
    expect(diagDefault.arrayBalance.status).toBe("balanced");
    expect(diagDefault.arrayBalance.ratio).toBe(1.02);

    // Custom threshold from drift payload
    const snapshotWithDrift: PlantSnapshot = {
      ...baseSnapshot,
      drift: {
        detected: true,
        advisory: "East array underperforming relative to West by 6% (check for soiling or obstruction)",
        affected_logger: "East",
        drift_pct: 6,
        baseline_ratio: 1.0,
        rolling_ratio: 0.94,
        threshold_pct: 5,
      },
    };
    const diagDrift = computeDiagnostics(snapshotWithDrift);
    expect(diagDrift.arrayBalance.thresholdPct).toBe(5);
    expect(diagDrift.arrayBalance.status).toBe("divergent");
    expect(diagDrift.arrayBalance.driftPct).toBe(6);
    expect(diagDrift.arrayBalance.advisory).toContain("underperforming");
  });
});

