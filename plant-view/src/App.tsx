import { useEffect, useState } from "react";
import { TimeCurve } from "./curve";
import { TimeStack } from "./stackCurve";
import {
  type ChartMode,
  readChartMode,
  writeChartMode,
} from "./chartMode";
import {
  type EnergyBar,
  dayEnergyBars,
  formatKwh,
  formatWatts,
  href,
  monthEnergyBars,
  parseUnit,
  stackLoggerNames,
  stepper,
  yearEnergyBars,
} from "./grains";
import { LastSample, lifetimeKwh } from "./LastSample";
import type { Grain, PlantPayload, PlantSnapshot } from "./types";

type ViewState =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "plant"; payload: Extract<PlantPayload, { empty: false }> };

function apiPath(): string {
  const params = new URLSearchParams(window.location.search);
  const day = params.get("day");
  const unit = parseUnit(params.get("unit"));
  const query = new URLSearchParams();
  if (day) query.set("day", day);
  query.set("unit", unit);
  return `/api/plant?${query.toString()}`;
}

function currentUnit(): Grain {
  return parseUnit(new URLSearchParams(window.location.search).get("unit"));
}

function Logout() {
  return (
    <form className="logout" method="post" action="/logout">
      <button type="submit">Log out</button>
    </form>
  );
}

function Login() {
  return (
    <main>
      <h1>Plant</h1>
      <form className="login" method="post" action="/login">
        <label>
          Password <input type="password" name="password" required />
        </label>
        <button type="submit">Log in</button>
      </form>
    </main>
  );
}

function loggerClass(name: string, names: string[]): string {
  return names.indexOf(name) % 2 === 0 ? "series-a" : "series-b";
}

function EnergyList({ bars, names }: { bars: EnergyBar[]; names: string[] }) {
  return (
    <ol className="days">
      {bars.map((bar) => (
        <li key={bar.label}>
          <a
            href={bar.href}
            style={{ width: `${Math.round(bar.width)}%` }}
            aria-current={bar.current ? "true" : undefined}
          >
            {bar.segments.length > 0 ? (
              <span className="day-stack">
                {bar.segments.map((part) => (
                  <span
                    key={part.name}
                    data-series={part.name}
                    className={loggerClass(part.name, names)}
                    style={{ width: `${part.width}%` }}
                  />
                ))}
              </span>
            ) : null}
            <span className="day-label">{bar.label}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function Chart({
  snapshot,
  unit,
  mode,
}: {
  snapshot: PlantSnapshot;
  unit: Grain;
  mode: ChartMode;
}) {
  const names = stackLoggerNames(snapshot);
  const visible = mode === "stack" ? new Set(names) : undefined;
  if (unit === "day") {
    return <EnergyList bars={dayEnergyBars(snapshot, snapshot.selected_day, visible)} names={names} />;
  }
  if (unit === "month") {
    return (
      <EnergyList bars={monthEnergyBars(snapshot, snapshot.selected_day, visible)} names={names} />
    );
  }
  if (unit === "year") {
    return (
      <EnergyList bars={yearEnergyBars(snapshot, snapshot.selected_day, visible)} names={names} />
    );
  }
  if (snapshot.curve.length === 0) {
    return <p className="empty">This Local day has no curve Samples.</p>;
  }
  if (mode === "stack") {
    return <TimeStack snapshot={snapshot} visible={visible ?? new Set(names)} />;
  }
  return <TimeCurve snapshot={snapshot} />;
}

function Plant({ payload }: { payload: Extract<PlantPayload, { empty: false }> }) {
  const unit = payload.unit;
  const snapshot = payload;
  const [mode, setMode] = useState<ChartMode>(() => readChartMode(window.localStorage));
  const today =
    snapshot.today_energy_kwh === null ? "-" : formatKwh(snapshot.today_energy_kwh);
  const period = stepper(snapshot, snapshot.selected_day, unit);
  function chooseMode(next: ChartMode) {
    writeChartMode(window.localStorage, next);
    setMode(next);
  }
  return (
    <main>
      <Logout />
      <h1>Plant</h1>
      <dl className="kpis">
        <div>
          <dt>Today energy</dt>
          <dd>{today}</dd>
        </div>
        <div>
          <dt>Current Power</dt>
          <dd>{formatWatts(snapshot.current_power_w)}</dd>
        </div>
        <div>
          <dt>Lifetime energy</dt>
          <dd>{lifetimeKwh(snapshot.lifetime_energy_kwh)}</dd>
        </div>
        <div>
          <dt>Last sample</dt>
          <dd>
            <LastSample at={snapshot.current_power_at} />
          </dd>
        </div>
      </dl>
      <nav className="stepper" aria-label="Period">
        {period.prevHref ? (
          <a href={period.prevHref} aria-label="Previous">
            ‹
          </a>
        ) : (
          <span className="dead" aria-hidden="true">
            ‹
          </span>
        )}
        <span>{period.label}</span>
        {period.nextHref ? (
          <a href={period.nextHref} aria-label="Next">
            ›
          </a>
        ) : (
          <span className="dead" aria-hidden="true">
            ›
          </span>
        )}
      </nav>
      <nav className="grain" aria-label="Grain">
        {(["time", "day", "month", "year"] as const).map((grain) => (
          <a
            key={grain}
            href={href(snapshot.selected_day, grain)}
            aria-current={grain === unit ? "true" : undefined}
          >
            {grain[0]!.toUpperCase() + grain.slice(1)}
          </a>
        ))}
      </nav>
      <nav className="grain chart-mode" aria-label="Chart mode">
        <button
          type="button"
          aria-pressed={mode === "overlay"}
          onClick={() => chooseMode("overlay")}
        >
          Overlay
        </button>
        <button
          type="button"
          aria-pressed={mode === "stack"}
          onClick={() => chooseMode("stack")}
        >
          Stack
        </button>
      </nav>
      <Chart snapshot={snapshot} unit={unit} mode={mode} />
    </main>
  );
}

export function App() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onPop = () => setTick((n) => n + 1);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a");
      if (!link || link.origin !== window.location.origin) return;
      if (link.getAttribute("href")?.startsWith("/?") || link.pathname === "/") {
        event.preventDefault();
        window.history.pushState({}, "", link.href);
        setTick((n) => n + 1);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      const response = await fetch(apiPath());
      if (cancelled) return;
      if (response.status === 401) {
        setState({ kind: "login" });
        return;
      }
      if (response.status === 502) {
        setState({ kind: "error" });
        return;
      }
      const body = (await response.json()) as PlantPayload;
      if (body.empty) {
        setState({ kind: "empty" });
        return;
      }
      setState({
        kind: "plant",
        payload: { ...body, unit: body.unit ?? currentUnit() },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (state.kind === "login") {
    return <Login />;
  }
  if (state.kind === "empty") {
    return (
      <main>
        <Logout />
        <h1>Plant</h1>
        <p className="empty">This Plant has no History yet.</p>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main>
        <Logout />
        <h1>Plant</h1>
        <p className="empty">Plant view cannot reach History.</p>
      </main>
    );
  }
  if (state.kind === "plant") {
    return <Plant payload={state.payload} />;
  }
  return <main />;
}
