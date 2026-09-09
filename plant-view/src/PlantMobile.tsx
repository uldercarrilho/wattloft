import { useEffect, useRef, useState, type TouchEvent } from "react";
import { type ChartMode, readChartMode } from "./chartMode";
import { Glance } from "./Glance";
import { glanceModel } from "./glanceModel";
import { stackLoggerNames, stepper, localDayOf } from "./grains";
import {
  Chart,
  ChartModeBar,
  PeriodStepper,
  PlantHeader,
  SeriesChips,
  chooseChartMode,
  overlayTimeNames,
} from "./plantChrome";
import {
  MOBILE_PAGES,
  adjacentMobilePage,
  mobileHref,
  mobilePageOf,
  pagerSwipeIgnored,
  type MobilePage,
} from "./mobilePage";
import type { Grain, PlantPayload } from "./types";
import { formatTimeOfDay } from "./liveStream";

const DOT_LABEL: Record<MobilePage, string> = {
  glance: "Glance",
  time: "Power",
  day: "Day",
  month: "Month",
  year: "Year",
};

export function PlantMobile({
  payload,
  busy,
  offline,
}: {
  payload: Extract<PlantPayload, { empty: false }>;
  busy: boolean;
  offline?: boolean;
}) {
  const page = mobilePageOf(window.location.search);
  const snapshot = payload;
  const unit: Grain = page === "glance" ? "time" : page;
  const [mode, setMode] = useState<ChartMode>(() => readChartMode(window.localStorage));
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
  const touchX = useRef<number | null>(null);
  const ignoreSwipe = useRef(false);
  const names =
    page === "glance"
      ? []
      : unit === "time" && snapshot.curve.length === 0
        ? []
        : mode === "stack"
          ? stackLoggerNames(snapshot)
          : unit === "time"
            ? overlayTimeNames(snapshot)
            : [];
  const visible = new Set(names.filter((name) => !hidden.has(name)));
  const period = stepper(snapshot, snapshot.selected_day, unit, localDayOf(new Date().toISOString()));
  const view = glanceModel(snapshot, new Date());
  useEffect(() => {
    setHidden(new Set());
  }, [payload.selected_day, unit]);

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    ignoreSwipe.current = pagerSwipeIgnored(event.target);
    touchX.current = event.changedTouches[0]?.clientX ?? null;
  }
  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = touchX.current;
    const ignored = ignoreSwipe.current;
    touchX.current = null;
    ignoreSwipe.current = false;
    if (ignored) return;
    const end = event.changedTouches[0]?.clientX;
    if (start === null || end === undefined) return;
    const delta = end - start;
    if (Math.abs(delta) < 50) return;
    const next = adjacentMobilePage(page, delta < 0 ? 1 : -1);
    if (!next) return;
    window.history.pushState({}, "", mobileHref(snapshot.selected_day, next));
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <main
      className="plant-mobile"
      aria-busy={busy ? true : undefined}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <PlantHeader />
      {offline ? (
        <p className="offline-banner" role="status">
          Offline · Showing cached plant state as of {formatTimeOfDay(snapshot.current_power_at)}
        </p>
      ) : null}
      <div className="plant-mobile-body">
        {page === "glance" ? (
          <Glance
            view={view}
            currentPowerAt={snapshot.current_power_at}
          />
        ) : (
          <>
            <PeriodStepper
              label={period.label}
              prevHref={period.prevHref}
              nextHref={period.nextHref}
              hideChevrons={unit === "year" && !period.prevHref && !period.nextHref}
            />
            <ChartModeBar
              mode={mode}
              onChoose={(next) => chooseChartMode(next, setMode)}
              unit={unit}
              idealEnvelope={idealEnvelope}
              onToggleIdealEnvelope={toggleIdealEnvelope}
            />
            <Chart
              snapshot={snapshot}
              unit={unit}
              mode={mode}
              visible={visible}
              idealEnvelope={idealEnvelope}
              chips={
                <SeriesChips
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
          </>
        )}
      </div>
      <nav className="page-dots" aria-label="Pages">
        {MOBILE_PAGES.map((item) => (
          <a
            key={item}
            href={mobileHref(snapshot.selected_day, item)}
            aria-label={DOT_LABEL[item]}
            aria-current={item === page ? "true" : undefined}
          >
            {DOT_LABEL[item]}
          </a>
        ))}
      </nav>
    </main>
  );
}
