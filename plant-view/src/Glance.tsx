import { LastSample } from "./LastSample";
import type { GlanceView } from "./glanceModel";

const RING_R = [88, 72];
const RING_C = RING_R.map((r) => 2 * Math.PI * r);

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
      <svg
        className="glance-sun"
        viewBox="0 0 200 200"
        data-testid="glance-sun"
        data-hollow={view.hollow ? "true" : "false"}
        aria-hidden="true"
      >
        {view.rings.map((ring, index) => {
          const r = RING_R[index] ?? RING_R[RING_R.length - 1]!;
          const c = RING_C[index] ?? RING_C[RING_C.length - 1]!;
          const dash = ring.closed ? c * 0.92 : c * 0.14;
          return (
            <circle
              key={ring.name}
              className={index % 2 === 0 ? "series-a" : "series-b"}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c}`}
              opacity={ring.closed ? 1 : 0.45}
              transform="rotate(-90 100 100)"
            />
          );
        })}
        {view.hollow ? (
          <circle cx="100" cy="100" r="36" className="glance-core is-hollow" />
        ) : (
          <>
            <circle cx="100" cy="100" r="52" className="glance-glow" />
            <circle cx="100" cy="100" r="36" className="glance-core" />
          </>
        )}
      </svg>
      <p className="glance-watts">{view.wattsLabel}</p>
      <ul className="glance-legend">
        {view.rings.map((ring, index) => (
          <li key={ring.name} className={index % 2 === 0 ? "series-a" : "series-b"}>
            {ring.displayName}
          </li>
        ))}
      </ul>
      <dl className="glance-captions">
        <div>
          <dt>Today so far</dt>
          <dd>{view.todayLabel}</dd>
        </div>
        <div>
          <dt>Lifetime energy</dt>
          <dd>{view.lifetimeLabel}</dd>
        </div>
        {currentPowerAt ? (
          <div>
            <dt>Last sample</dt>
            <dd>
              <LastSample at={currentPowerAt} />
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
