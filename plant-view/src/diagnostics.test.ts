import { describe, expect, it } from "vitest";
import { computeDiagnostics, integrateCurveKwh } from "./diagnostics";
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
      { at: "2026-09-25T05:40:00", watts: 0 },
      { at: "2026-09-25T08:00:00", watts: 1600 },
      { at: "2026-09-25T10:00:00", watts: 1800 },
      { at: "2026-09-25T11:00:00", watts: 1820 },
      { at: "2026-09-25T12:00:00", watts: 1900 },
    ],
  };

  it("computes baseline clear-sky envelope efficiency when uncalibrated", () => {
    const diag = computeDiagnostics(baseSnapshot);
    expect(diag.solarEnvelope.actualPeakW).toBe(1800);
    expect(diag.solarEnvelope.idealPeakW).toBe(1900);
    expect(diag.solarEnvelope.actualKwh).toBe(8.5);
    expect(diag.solarEnvelope.idealKwh).toBe(8.94);
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

  describe("Clear-Sky Energy Efficiency Integration", () => {
    it("integrates curve points accurately using trapezoidal rule", () => {
      expect(integrateCurveKwh(undefined)).toBeNull();
      expect(integrateCurveKwh([])).toBeNull();

      // Single point: 600W for 1 min = 600 / 60000 = 0.01 kWh
      expect(integrateCurveKwh([{ at: "2026-09-25T12:00:00", watts: 600 }])).toBe(0.01);

      // Multi-point: 10:00 (1000W) to 11:00 (2000W) = avg 1500W * 1h = 1.50 kWh
      const points = [
        { at: "2026-09-25T10:00:00", watts: 1000 },
        { at: "2026-09-25T11:00:00", watts: 2000 },
      ];
      expect(integrateCurveKwh(points)).toBe(1.5);

      // Cutoff filtering: at 10:30, only points up to 10:30
      const filtered = integrateCurveKwh(points, "2026-09-25T10:00:00");
      expect(filtered).toBe(0.02); // only first point (1000/60000)
    });

    it("constrains ideal clear-sky energy to current power timestamp for daytime in-progress monitoring", () => {
      // At 09:00 AM on today, ideal curve has points up to 18:00
      // Ideal energy up to 09:00: (0 to 1000W over 3h) = 1.50 kWh
      // Ideal energy for full day up to 18:00: ~12.00 kWh
      // If actual energy so far is 1.45 kWh, efficiency should be 97% (1.45 / 1.50), NOT 12% (1.45 / 12.00)!
      const daytimeSnapshot: PlantSnapshot = {
        selected_day: "2026-09-25",
        current_power_w: 1000,
        lifetime_energy_kwh: 5000,
        current_power_at: "2026-09-25T09:00:00",
        today_energy_kwh: 1.45,
        local_day_bars: [
          {
            local_day: "2026-09-25",
            today_energy_kwh: 1.45,
            loggers: [
              { name: "East", today_energy_kwh: 1.1 },
              { name: "West", today_energy_kwh: 0.35 },
            ],
          },
        ],
        curve: [
          {
            name: "Plant",
            points: [
              { at: "2026-09-25T06:00:00", watts: 0 },
              { at: "2026-09-25T09:00:00", watts: 1000 },
            ],
          },
        ],
        ideal_curve: [
          { at: "2026-09-25T06:00:00", watts: 0 },
          { at: "2026-09-25T09:00:00", watts: 1000 },
          { at: "2026-09-25T12:00:00", watts: 2000 },
          { at: "2026-09-25T15:00:00", watts: 1500 },
          { at: "2026-09-25T18:00:00", watts: 0 },
        ],
      };

      const diag = computeDiagnostics(daytimeSnapshot);
      // Ideal energy up to 09:00 is (0 + 1000)/2 * 180 / 60000 = 1.50 kWh
      expect(diag.solarEnvelope.idealKwh).toBe(1.5);
      expect(diag.solarEnvelope.actualKwh).toBe(1.45);
      expect(diag.solarEnvelope.efficiencyPct).toBe(97);
      expect(diag.solarEnvelope.status).toBe("optimal");
    });

    it("integrates full day ideal curve for historical days in History tab", () => {
      // Historical day in the past (selected_day is 2026-09-24, while current_power_at is 2026-09-25)
      const historicalSnapshot: PlantSnapshot = {
        selected_day: "2026-09-24",
        current_power_w: 1200,
        lifetime_energy_kwh: 5000,
        current_power_at: "2026-09-25T12:00:00",
        today_energy_kwh: 8.5,
        local_day_bars: [
          {
            local_day: "2026-09-24",
            today_energy_kwh: 7.0,
            loggers: [
              { name: "East", today_energy_kwh: 3.5 },
              { name: "West", today_energy_kwh: 3.5 },
            ],
          },
        ],
        curve: [
          {
            name: "Plant",
            points: [{ at: "2026-09-24T12:00:00", watts: 1500 }],
          },
        ],
        ideal_curve: [
          { at: "2026-09-24T06:00:00", watts: 0 },
          { at: "2026-09-24T12:00:00", watts: 2000 },
          { at: "2026-09-24T18:00:00", watts: 0 },
        ],
      };

      const diag = computeDiagnostics(historicalSnapshot);
      // Full day ideal: (0+2000)/2 * 360/60000 + (2000+0)/2 * 360/60000 = 6.00 + 6.00 = 12.00 kWh
      expect(diag.solarEnvelope.idealKwh).toBe(12.0);
      expect(diag.solarEnvelope.actualKwh).toBe(7.0);
      // 7.0 / 12.0 = 58%
      expect(diag.solarEnvelope.efficiencyPct).toBe(58);
      expect(diag.solarEnvelope.status).toBe("reduced");
    });
  });
});

