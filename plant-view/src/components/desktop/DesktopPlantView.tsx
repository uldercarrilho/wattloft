import { useEffect, useState } from "react";
import type { ChartMode } from "../../chartMode";
import { readChartMode } from "../../chartMode";
import { computeDiagnostics } from "../../diagnostics";
import {
  formatKwh,
  formatWatts,
  localDayOf,
  stackLoggerNames,
  stepper,
} from "../../grains";
import { LastSample, lifetimeKwh } from "../../LastSample";
import { formatTimeOfDay } from "../../liveStream";
import {
  Chart,
  PlantHeader,
  overlayTimeNames,
} from "../../plantChrome";
import type { PlantPayload } from "../../types";
import { KpiCard } from "../KpiCard";
import type { ConnectionStatus } from "../LiveStatusBadge";
import { OfflineBanner } from "../OfflineBanner";
import { SeriesToggleChips } from "../SeriesToggleChips";
import { ChartControls } from "./ChartControls";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

export function DesktopPlantView({
  payload,
  busy,
  offline,
  status = "live",
}: {
  payload: Extract<PlantPayload, { empty: false }>;
  busy: boolean;
  offline?: boolean;
  status?: ConnectionStatus;
}) {
  const unit = payload.unit;
  const snapshot = payload;
  const [mode, setMode] = useState<ChartMode>(() =>
    readChartMode(window.localStorage),
  );
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [idealEnvelope, setIdealEnvelope] = useState(() => {
    try {
      return window.localStorage.getItem("wattloft.ideal-envelope") === "true";
    } catch {
      return false;
    }
  });

  const toggleIdealEnvelope = () => {
    setIdealEnvelope((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("wattloft.ideal-envelope", String(next));
      } catch {}
      return next;
    });
  };

  const names =
    unit === "time" && snapshot.curve.length === 0
      ? []
      : mode === "stack"
        ? stackLoggerNames(snapshot)
        : unit === "time"
          ? overlayTimeNames(snapshot)
          : [];

  const visible = new Set(names.filter((name) => !hidden.has(name)));
  const today =
    snapshot.today_energy_kwh === null
      ? "-"
      : formatKwh(snapshot.today_energy_kwh);

  const period = stepper(
    snapshot,
    snapshot.selected_day,
    unit,
    localDayOf(new Date().toISOString()),
  );

  useEffect(() => {
    setHidden(new Set());
  }, [payload.selected_day, payload.unit]);

  const diag = computeDiagnostics(snapshot);
  const connectionStatus: ConnectionStatus = offline ? "offline" : status;

  return (
    <main aria-busy={busy ? true : undefined}>
      <a className="skip" href="#plant-chart">
        Skip to chart
      </a>

      <PlantHeader status={connectionStatus} />

      {offline ? (
        <OfflineBanner timestamp={formatTimeOfDay(snapshot.current_power_at)} />
      ) : null}

      {/* 4-Metric KPI Grid */}
      <div className="desktop-kpi-grid">
        <KpiCard
          label="Current Power"
          value={formatWatts(snapshot.current_power_w)}
          secondary={
            <span>
              as of <LastSample at={snapshot.current_power_at} />
            </span>
          }
        />
        <KpiCard
          label="Today so far"
          value={today}
          secondary={
            diag.historical.deltaPct !== null ? (
              <span>
                {diag.historical.deltaPct >= 0 ? "+" : ""}
                {diag.historical.deltaPct}% vs prior year
              </span>
            ) : undefined
          }
        />
        <KpiCard
          label="Lifetime energy"
          value={lifetimeKwh(snapshot.lifetime_energy_kwh)}
          secondary="Cumulative AC production"
        />
        <KpiCard
          label="Solar Envelope"
          value={
            diag.solarEnvelope.efficiencyPct !== null
              ? `${diag.solarEnvelope.efficiencyPct}% Clear-Sky`
              : "Calculated"
          }
          secondary={
            diag.clipping.isClipped
              ? `${diag.clipping.durationMinutes} min AC clipping`
              : "Nominal tracking"
          }
          badge={diag.clipping.isClipped ? "Clipping" : "Nominal"}
        />
      </div>

      <ChartControls
        snapshot={snapshot}
        unit={unit}
        mode={mode}
        setMode={setMode}
        idealEnvelope={idealEnvelope}
        onToggleIdealEnvelope={toggleIdealEnvelope}
        period={period}
      />

      <Chart
        snapshot={snapshot}
        unit={unit}
        mode={mode}
        visible={visible}
        idealEnvelope={idealEnvelope}
        chips={
          <SeriesToggleChips
            snapshot={snapshot}
            names={names}
            hidden={hidden}
            onToggle={(name) => {
              setHidden((prev) => {
                const next = new Set(prev);
                if (next.has(name)) next.delete(name);
                else next.add(name);
                return next;
              });
            }}
          />
        }
      />

      <DiagnosticsPanel snapshot={snapshot} />
    </main>
  );
}
