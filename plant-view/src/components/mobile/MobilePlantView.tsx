import { useEffect, useState } from "react";
import { type ChartMode, readChartMode } from "../../chartMode";
import { glanceModel } from "../../glanceModel";
import { formatTimeOfDay } from "../../liveStream";
import { grainOf, mobileHref, mobileTabOf, type MobileTab } from "../../mobilePage";
import { PlantHeader } from "../../plantChrome";
import type { Grain, PlantPayload } from "../../types";
import { OfflineBanner } from "../OfflineBanner";
import { MobileGlanceTab } from "./MobileGlanceTab";
import { MobileHistoryTab } from "./MobileHistoryTab";
import { MobileInsightsTab } from "./MobileInsightsTab";
import { MobilePowerTab } from "./MobilePowerTab";
import { MobileTabBar } from "./MobileTabBar";
import type { ConnectionStatus } from "../LiveStatusBadge";

export function MobilePlantView({
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
  const snapshot = payload;
  const [activeTab, setActiveTab] = useState<MobileTab>(() =>
    mobileTabOf(window.location.search),
  );
  const [historyGrain, setHistoryGrain] = useState<Grain>(() =>
    grainOf(window.location.search),
  );
  const [mode, setMode] = useState<ChartMode>(() =>
    readChartMode(window.localStorage),
  );
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

  useEffect(() => {
    const nextTab = mobileTabOf(window.location.search);
    const nextGrain = grainOf(window.location.search);
    setActiveTab(nextTab);
    setHistoryGrain(nextGrain);
  }, [payload.selected_day, payload.unit]);

  const view = glanceModel(snapshot, new Date());

  const handleSelectTab = (tab: MobileTab) => {
    setActiveTab(tab);
    const targetHref = mobileHref(
      snapshot.selected_day,
      tab,
      tab === "history" ? historyGrain : undefined,
    );
    window.history.pushState({}, "", targetHref);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const connectionStatus: ConnectionStatus = offline ? "offline" : status;

  return (
    <main className="plant-mobile" aria-busy={busy ? true : undefined}>
      <PlantHeader status={connectionStatus} />

      {offline ? (
        <OfflineBanner timestamp={formatTimeOfDay(snapshot.current_power_at)} />
      ) : null}

      <div className="plant-mobile-body">
        {activeTab === "glance" && (
          <MobileGlanceTab
            view={view}
            currentPowerAt={snapshot.current_power_at}
          />
        )}
        {activeTab === "power" && (
          <MobilePowerTab
            snapshot={snapshot}
            mode={mode}
            setMode={setMode}
            idealEnvelope={idealEnvelope}
            onToggleIdealEnvelope={toggleIdealEnvelope}
          />
        )}
        {activeTab === "history" && (
          <MobileHistoryTab
            snapshot={snapshot}
            grain={historyGrain}
            onSelectGrain={(g) => setHistoryGrain(g)}
            mode={mode}
            setMode={setMode}
          />
        )}
        {activeTab === "insights" && (
          <MobileInsightsTab snapshot={snapshot} />
        )}
      </div>

      <MobileTabBar activeTab={activeTab} onSelectTab={handleSelectTab} />
    </main>
  );
}
