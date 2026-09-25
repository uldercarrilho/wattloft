import { LastSample } from "./LastSample";
import type { GlanceView } from "./glanceModel";
import { ClearSkyMeter } from "./components/ClearSkyMeter";

export function Glance({
  view,
  currentPowerAt,
}: {
  view: GlanceView;
  currentPowerAt?: string;
}) {
  return (
    <section className="glance" data-glance>
      {view.banner ? (
        <p className="glance-banner" role="status">
          {view.banner}
        </p>
      ) : null}
      <div className="glance-now">
        <p className="glance-now-label">Plant now</p>
        <p className="glance-watts">{view.wattsLabel}</p>
        {view.clearSky ? <ClearSkyMeter meter={view.clearSky} /> : null}
        {currentPowerAt ? (
          <p className="glance-as-of">
            as of <LastSample at={currentPowerAt} />
          </p>
        ) : null}
      </div>
      <dl className="glance-captions">
        <div>
          <dt>Today so far</dt>
          <dd>{view.todayLabel}</dd>
        </div>
        <div>
          <dt>Lifetime energy</dt>
          <dd>{view.lifetimeLabel}</dd>
        </div>
      </dl>
      {view.loggers.length > 0 ? (
        <div className="glance-loggers">
          <p className="glance-loggers-label">Loggers</p>
          <ul>
            {view.loggers.map((row, index) => (
              <li key={row.name} className={index % 2 === 0 ? "series-a" : "series-b"}>
                <span className="glance-logger-name">{row.displayName}</span>
                <span className="glance-logger-watts">{row.wattsLabel}</span>
                <span className="glance-logger-cadence">
                  {row.reporting
                    ? `reporting · ${row.ageLabel}`
                    : `silent · last Sample ${row.ageLabel}`}
                </span>
                {row.driftAdvisory ? (
                  <p className="drift-advisory" role="note">
                    {row.driftAdvisory}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
