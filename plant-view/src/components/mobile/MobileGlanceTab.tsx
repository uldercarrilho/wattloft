import { LastSample } from "../../LastSample";
import type { GlanceView } from "../../glanceModel";
import { ClearSkyMeter } from "../ClearSkyMeter";
import { KpiCard } from "../KpiCard";
import { StallBanner } from "../StallBanner";

export function MobileGlanceTab({
  view,
  currentPowerAt,
}: {
  view: GlanceView;
  currentPowerAt?: string;
}) {
  return (
    <div
      className="mobile-tab-screen mobile-glance-screen"
      role="tabpanel"
      id="tabpanel-glance"
      aria-labelledby="tab-glance"
    >
      {view.banner ? <StallBanner message={view.banner} /> : null}

      <div className="hero-plant-now">
        <span className="hero-label">Plant now</span>
        <div className="hero-watts">{view.wattsLabel}</div>
        {view.clearSky ? <ClearSkyMeter meter={view.clearSky} /> : null}
        {currentPowerAt ? (
          <div className="hero-as-of">
            as of <LastSample at={currentPowerAt} />
          </div>
        ) : null}
      </div>

      <div className="kpis">
        <KpiCard label="Today so far" value={view.todayLabel} />
        <KpiCard label="Lifetime energy" value={view.lifetimeLabel} />
      </div>

      {view.loggers.length > 0 ? (
        <div className="glance-loggers-card">
          <div className="glance-loggers-title">Loggers</div>
          <div className="glance-loggers-list">
            {view.loggers.map((logger, index) => (
              <div key={logger.name} className="glance-logger-row">
                <span
                  className={`logger-dot ${index % 2 === 0 ? "series-a" : "series-b"}`}
                  aria-hidden="true"
                />
                <span className="logger-name">{logger.displayName}</span>
                <span className="logger-watts">{logger.wattsLabel}</span>
                <span className="logger-cadence">
                  {logger.reporting
                    ? `reporting · ${logger.ageLabel}`
                    : `silent · last Sample ${logger.ageLabel}`}
                </span>
                {logger.driftAdvisory ? (
                  <p className="drift-advisory" role="note">
                    {logger.driftAdvisory}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
