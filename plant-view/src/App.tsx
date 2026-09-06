import { useEffect, useState } from "react";
import {
  type ChartMode,
  readChartMode,
  writeChartMode,
} from "./chartMode";
import {
  energyReadout,
  buildPlantChartModel,
  parkedMinute,
  timeReadout,
} from "./plantChartModel";
import { PlantChart } from "./PlantChart";
import {
  formatKwh,
  formatWatts,
  href,
  parseUnit,
  stackLoggerNames,
  stepper,
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
  if (name === "Plant") return "series-plant";
  const loggers = names.filter((n) => n !== "Plant");
  return loggers.indexOf(name) % 2 === 0 ? "series-a" : "series-b";
}

function overlayTimeNames(snapshot: PlantSnapshot): string[] {
  const loggers = snapshot.curve
    .filter((series) => series.name !== "Plant")
    .map((series) => series.name)
    .sort((a, b) => a.localeCompare(b));
  return ["Plant", ...loggers];
}

function Chart({
  snapshot,
  unit,
  mode,
  visible,
}: {
  snapshot: PlantSnapshot;
  unit: Grain;
  mode: ChartMode;
  visible: ReadonlySet<string>;
}) {
  const model = buildPlantChartModel(snapshot, unit, mode, visible);
  const [pointer, setPointer] = useState<number | null>(null);
  useEffect(() => {
    setPointer(null);
  }, [snapshot.selected_day, unit, mode]);
  if (model.kind === "empty-time") {
    return <p className="empty">This Local day has no curve Samples.</p>;
  }
  const readout =
    model.kind === "time"
      ? timeReadout(model, pointer ?? parkedMinute(model), mode)
      : energyReadout(model, pointer ?? model.currentIndex);
  return (
    <>
      <PlantChart
        model={model}
        mode={mode}
        onPointer={setPointer}
        onBarNavigate={(href) => {
          window.history.pushState({}, "", href);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }}
        onDrawError={() => undefined}
      />
      <div className="readout" aria-live="polite">
        <span className="when">{readout.when}</span>
        {readout.rows.map((row) => (
          <p
            key={row.name}
            data-series={row.name}
            className={row.name === "Plant" ? "series-plant" : ""}
          >
            {row.name} {row.text}
          </p>
        ))}
      </div>
      {unit === "time" ? (
        <p className="hint">
          Tap a name to show or hide its curve. A gap where Lifetime energy still rose
          is interpolated as a smooth Power curve — that energy happened. Where Lifetime
          barely moved, the line valleys: no Samples and no estimate, possible Logger
          failure.
        </p>
      ) : null}
    </>
  );
}

function Plant({ payload }: { payload: Extract<PlantPayload, { empty: false }> }) {
  const unit = payload.unit;
  const snapshot = payload;
  const [mode, setMode] = useState<ChartMode>(() => readChartMode(window.localStorage));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
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
    snapshot.today_energy_kwh === null ? "-" : formatKwh(snapshot.today_energy_kwh);
  const period = stepper(snapshot, snapshot.selected_day, unit);
  function chooseMode(next: ChartMode) {
    writeChartMode(window.localStorage, next);
    setMode(next);
  }
  useEffect(() => {
    setHidden(new Set());
  }, [payload]);
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
      <Chart snapshot={snapshot} unit={unit} mode={mode} visible={visible} />
      {names.length > 0 ? (
        <div className="series-toggles">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              className={`series-toggle ${loggerClass(name, names)}${hidden.has(name) ? " is-off" : ""}`}
              data-series={name}
              aria-pressed={hidden.has(name) ? "false" : "true"}
              onClick={() => {
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                });
              }}
            >
              <i />
              {name}
            </button>
          ))}
        </div>
      ) : null}
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
