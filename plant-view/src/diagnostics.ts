import type { PlantSnapshot } from "./types";

export type DiagnosticsSummary = {
  arrayBalance: {
    ratio: number | null;
    baselineRatio: number | null;
    rollingRatio: number | null;
    driftPct: number | null;
    thresholdPct: number;
    advisory: string | null;
    affectedLogger: string | null;
    status: "balanced" | "divergent" | "unavailable";
  };
  clipping: {
    isClipped: boolean;
    durationMinutes: number;
    estimatedClippedKwh: number | null;
    plateauCount: number;
  };
  solarEnvelope: {
    actualPeakW: number;
    idealPeakW: number | null;
    efficiencyPct: number | null;
    status: "optimal" | "reduced" | "unavailable";
    calibration?: {
      calibrated: boolean;
      sunnyDaysCount: number;
      lastCalibratedAt: string | null;
    } | null;
  };
  historical: {
    prevYearKwh: number | null;
    currentPeriodKwh: number | null;
    deltaPct: number | null;
  };
};

export function computeDiagnostics(snapshot: PlantSnapshot): DiagnosticsSummary {
  // 1. Array Balance (ADR 0032)
  const drift = snapshot.drift;
  let ratio: number | null = null;

  // Attempt to compute today's East/West ratio from selected day bar
  const selectedBar = snapshot.local_day_bars.find((b) => b.local_day === snapshot.selected_day);
  if (selectedBar?.loggers && selectedBar.loggers.length >= 2) {
    const east = selectedBar.loggers.find((l) => l.name.toLowerCase().includes("east") || l.display_name?.toLowerCase().includes("east")) ?? selectedBar.loggers[0];
    const west = selectedBar.loggers.find((l) => l.name.toLowerCase().includes("west") || l.display_name?.toLowerCase().includes("west")) ?? selectedBar.loggers[1];
    if (east && west && west.today_energy_kwh > 0) {
      ratio = Number((east.today_energy_kwh / west.today_energy_kwh).toFixed(2));
    }
  }

  const baselineRatio = drift?.baseline_ratio ?? null;
  const rollingRatio = drift?.rolling_ratio ?? null;
  const driftPct = drift?.drift_pct ?? null;
  const thresholdPct = drift?.threshold_pct ?? 5;
  const advisory = drift?.advisory ?? null;
  const affectedLogger = drift?.affected_logger ?? null;

  let balanceStatus: "balanced" | "divergent" | "unavailable" = "unavailable";
  if (drift?.detected) {
    balanceStatus = "divergent";
  } else if (baselineRatio !== null || ratio !== null) {
    balanceStatus = "balanced";
  }

  // 2. Inverter AC Clipping (ADR 0032)
  const clipping = snapshot.clipping;
  const isClipped = Boolean(clipping?.clipped);
  const durationMinutes = clipping?.clipped_minutes ?? 0;
  const estimatedClippedKwh = clipping?.estimated_clipped_kwh ?? null;
  const plateauCount = clipping?.plateaus?.length ?? 0;

  // 3. Clear-Sky Astronomical Envelope Efficiency (ADR 0032)
  let actualPeakW = snapshot.current_power_w;
  for (const s of snapshot.curve) {
    if (s.name === "Plant") {
      for (const p of s.points) {
        if (p.watts > actualPeakW) actualPeakW = p.watts;
      }
    }
  }

  let idealPeakW: number | null = null;
  if (snapshot.ideal_curve && snapshot.ideal_curve.length > 0) {
    for (const p of snapshot.ideal_curve) {
      if (idealPeakW === null || p.watts > idealPeakW) {
        idealPeakW = p.watts;
      }
    }
  }

  let efficiencyPct: number | null = null;
  let envelopeStatus: "optimal" | "reduced" | "unavailable" = "unavailable";
  if (idealPeakW && idealPeakW > 0) {
    efficiencyPct = Math.min(100, Math.round((actualPeakW / idealPeakW) * 100));
    envelopeStatus = efficiencyPct >= 80 ? "optimal" : "reduced";
  }

  // 4. Historical Period Comparison
  let prevYearKwh: number | null = null;
  let currentPeriodKwh: number | null = selectedBar?.today_energy_kwh ?? snapshot.today_energy_kwh ?? null;
  if (selectedBar && selectedBar.prev_year_today_energy_kwh != null) {
    prevYearKwh = selectedBar.prev_year_today_energy_kwh;
  }

  let deltaPct: number | null = null;
  if (currentPeriodKwh !== null && prevYearKwh !== null && prevYearKwh > 0) {
    deltaPct = Math.round(((currentPeriodKwh - prevYearKwh) / prevYearKwh) * 100);
  }

  const cal = snapshot.envelope_calibration;
  const calibrationInfo = cal
    ? {
        calibrated: cal.calibrated,
        sunnyDaysCount: cal.sunny_days_count,
        lastCalibratedAt: cal.last_calibrated_at,
      }
    : null;

  return {
    arrayBalance: {
      ratio,
      baselineRatio,
      rollingRatio,
      driftPct,
      thresholdPct,
      advisory,
      affectedLogger,
      status: balanceStatus,
    },
    clipping: {
      isClipped,
      durationMinutes,
      estimatedClippedKwh,
      plateauCount,
    },
    solarEnvelope: {
      actualPeakW,
      idealPeakW,
      efficiencyPct,
      status: envelopeStatus,
      calibration: calibrationInfo,
    },
    historical: {
      prevYearKwh,
      currentPeriodKwh,
      deltaPct,
    },
  };
}
