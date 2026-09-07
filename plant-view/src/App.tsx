import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  displayNameOf,
  formatKwh,
  formatWatts,
  historyStartOf,
  href,
  localDayOf,
  parseUnit,
  selectedPeriodKwh,
  stackLoggerNames,
  stepper,
} from "./grains";
import { LastSample, lifetimeKwh } from "./LastSample";
import type { Grain, PlantPayload, PlantSnapshot } from "./types";
import { useWideViewport } from "./useWideViewport";

type ViewState =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "plant"; payload: Extract<PlantPayload, { empty: false }> };

const GRAIN_LABEL: Record<Grain, string> = {
  time: "Power",
  day: "Day",
  month: "Month",
  year: "Year",
};

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

function PlantHeader() {
  return (
    <header className="plant-header">
      <h1>Plant</h1>
      <Logout />
    </header>
  );
}

function b64urlToBuffer(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToB64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function loginGranted(response: Response): boolean {
  return response.ok || response.status === 303 || response.type === "opaqueredirect";
}

function Login({ onGranted }: { onGranted: () => void }) {
  const [rejected, setRejected] = useState(false);
  const [passkeyReady, setPasskeyReady] = useState(false);
  const [passkeyRejected, setPasskeyRejected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/login/passkey/options", { credentials: "same-origin" }).then((response) => {
      const json = response.headers.get("content-type")?.includes("application/json");
      if (!cancelled && response.ok && json && typeof PublicKeyCredential !== "undefined") {
        setPasskeyReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const password = new FormData(form).get("password");
    const response = await fetch("/login", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({
        password: typeof password === "string" ? password : "",
      }),
    });
    if (loginGranted(response)) {
      setRejected(false);
      onGranted();
      return;
    }
    setRejected(true);
  }
  async function onPasskey() {
    const optionsRes = await fetch("/login/passkey/options", { credentials: "same-origin" });
    if (!optionsRes.ok) {
      setPasskeyRejected(true);
      return;
    }
    const options = (await optionsRes.json()) as {
      challenge: string;
      rpId: string;
      timeout: number;
      userVerification: UserVerificationRequirement;
      allowCredentials: { type: "public-key"; id: string }[];
    };
    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: b64urlToBuffer(options.challenge),
          rpId: options.rpId,
          timeout: options.timeout,
          userVerification: options.userVerification,
          allowCredentials: options.allowCredentials.map((item) => ({
            type: "public-key" as const,
            id: b64urlToBuffer(item.id),
          })),
        },
      });
      if (!credential || credential.type !== "public-key") {
        setPasskeyRejected(true);
        return;
      }
      const assertion = credential as PublicKeyCredential;
      const response = assertion.response as AuthenticatorAssertionResponse;
      const granted = await fetch("/login/passkey", {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
        headers: { "content-type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          id: assertion.id,
          response: {
            clientDataJSON: bufferToB64url(response.clientDataJSON),
            authenticatorData: bufferToB64url(response.authenticatorData),
            signature: bufferToB64url(response.signature),
          },
        }),
      });
      if (loginGranted(granted)) {
        setPasskeyRejected(false);
        onGranted();
        return;
      }
      setPasskeyRejected(true);
    } catch {
      setPasskeyRejected(true);
    }
  }
  return (
    <main>
      <h1>Wattloft</h1>
      <p className="lede">This Plant</p>
      <form className="login" onSubmit={onSubmit}>
        <label>
          Password{" "}
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            aria-invalid={rejected ? true : undefined}
            aria-describedby={rejected ? "login-error" : undefined}
          />
        </label>
        {rejected ? (
          <p id="login-error" role="alert">
            Password not accepted.
          </p>
        ) : null}
        <button type="submit">Log in</button>
      </form>
      {passkeyReady ? (
        <button type="button" className="passkey" onClick={() => void onPasskey()}>
          Use passkey
        </button>
      ) : null}
      {passkeyRejected ? (
        <p role="alert">Passkey not accepted.</p>
      ) : null}
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

function drillHint(unit: Grain): string | null {
  if (unit === "day") return "Tap a day to open its curve";
  if (unit === "month") return "Tap a month to open Day grain";
  if (unit === "year") return "Tap a year to open Month grain";
  return null;
}

function Chart({
  snapshot,
  unit,
  mode,
  visible,
  chips,
}: {
  snapshot: PlantSnapshot;
  unit: Grain;
  mode: ChartMode;
  visible: ReadonlySet<string>;
  chips: ReactNode;
}) {
  const model = useMemo(
    () => buildPlantChartModel(snapshot, unit, mode, visible),
    [snapshot, unit, mode, visible],
  );
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
  const nowDay = localDayOf(snapshot.current_power_at);
  const showPeriod = snapshot.selected_day !== nowDay;
  const periodKwh =
    mode === "stack"
      ? selectedPeriodKwh(snapshot, visible)
      : selectedPeriodKwh(snapshot);
  const partialCaption =
    model.kind === "energy" && model.partial.some(Boolean)
      ? unit === "day"
        ? "In progress"
        : "Partial History"
      : null;
  const historyCaption =
    unit === "month" || unit === "year"
      ? `History since ${historyStartOf(snapshot)}. Lifetime includes energy from before Wattloft.`
      : null;
  const tapHint = drillHint(unit);
  return (
    <div className="plant-stage">
      <div className="plant-plot">
        {showPeriod ? (
          <p className="period">
            {snapshot.selected_day} {formatKwh(periodKwh)}
          </p>
        ) : null}
        <PlantChart
          model={model}
          mode={mode}
          onPointer={setPointer}
          onBarNavigate={(target) => {
            window.history.pushState({}, "", target);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          onDrawError={() => undefined}
        />
        {chips}
      </div>
      <div className="plant-aside">
        <div className="readout" aria-live="polite">
          <span className="when">{readout.when}</span>
          {readout.rows.map((row) => (
            <p
              key={row.name}
              data-series={row.name}
              className={row.name === "Plant" ? "series-plant" : ""}
            >
              {displayNameOf(snapshot, row.name)} {row.text}
            </p>
          ))}
        </div>
        {historyCaption ? <p className="hint">{historyCaption}</p> : null}
        {partialCaption ? <p className="hint">{partialCaption}</p> : null}
        {tapHint ? <p className="hint">{tapHint}</p> : null}
        {unit === "time" ? (
          <details className="hint gaps">
            <summary>Why gaps?</summary>
            <p>
              Tap a name to show or hide its curve. A gap where Lifetime energy still rose
              is interpolated as a smooth Power curve — that energy happened. Where Lifetime
              barely moved, the line valleys: no Samples and no estimate, possible Logger
              failure.
            </p>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function SeriesChips({
  snapshot,
  names,
  hidden,
  onToggle,
}: {
  snapshot: PlantSnapshot;
  names: string[];
  hidden: ReadonlySet<string>;
  onToggle: (name: string) => void;
}) {
  if (names.length === 0) {
    return null;
  }
  return (
    <div className="series-toggles">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          className={`series-toggle ${loggerClass(name, names)}${hidden.has(name) ? " is-off" : ""}`}
          data-series={name}
          title={name}
          aria-pressed={hidden.has(name) ? "false" : "true"}
          onClick={() => onToggle(name)}
        >
          <i />
          {displayNameOf(snapshot, name)}
        </button>
      ))}
    </div>
  );
}

function PeriodStepper({
  label,
  prevHref,
  nextHref,
  hideChevrons,
}: {
  label: string;
  prevHref: string;
  nextHref: string;
  hideChevrons: boolean;
}) {
  return (
    <nav className="stepper" aria-label="Period">
      {hideChevrons ? null : prevHref ? (
        <a href={prevHref} aria-label="Previous">
          ‹
        </a>
      ) : (
        <span className="dead" aria-disabled="true">
          ‹
        </span>
      )}
      <span>{label}</span>
      {hideChevrons ? null : nextHref ? (
        <a href={nextHref} aria-label="Next">
          ›
        </a>
      ) : (
        <span className="dead" aria-disabled="true">
          ›
        </span>
      )}
    </nav>
  );
}

function Plant({
  payload,
  busy,
}: {
  payload: Extract<PlantPayload, { empty: false }>;
  busy: boolean;
}) {
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
  }, [payload.selected_day, payload.unit]);
  return (
    <main aria-busy={busy ? true : undefined}>
      <a className="skip" href="#plant-chart">
        Skip to chart
      </a>
      <PlantHeader />
      <dl className="kpis">
        <div>
          <dt>Today so far</dt>
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
      <PeriodStepper
        label={period.label}
        prevHref={period.prevHref}
        nextHref={period.nextHref}
        hideChevrons={unit === "year" && !period.prevHref && !period.nextHref}
      />
      <nav className="grain" aria-label="Grain">
        {(["time", "day", "month", "year"] as const).map((grain) => (
          <a
            key={grain}
            href={href(snapshot.selected_day, grain)}
            aria-current={grain === unit ? "true" : undefined}
            aria-label={
              grain === "time" ? "Power curve for this Local day" : undefined
            }
          >
            {GRAIN_LABEL[grain]}
          </a>
        ))}
      </nav>
      <nav className="grain chart-mode" aria-label="Chart mode">
        <button
          type="button"
          aria-pressed={mode === "overlay"}
          onClick={() => chooseMode("overlay")}
        >
          Each
        </button>
        <button
          type="button"
          aria-pressed={mode === "stack"}
          onClick={() => chooseMode("stack")}
        >
          By Logger
        </button>
      </nav>
      <p className="hint mode-hint">
        Each: Plant and Loggers on top of each other. By Logger: Loggers stacked; Plant is
        the height.
      </p>
      <Chart
        snapshot={snapshot}
        unit={unit}
        mode={mode}
        visible={visible}
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
    </main>
  );
}

export function App() {
  const wide = useWideViewport();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

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
      const rawHref = link.getAttribute("href") ?? "";
      if (rawHref.startsWith("#")) return;
      if (rawHref.startsWith("/?") || link.pathname === "/") {
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
    const hadPlant = stateRef.current.kind === "plant";
    if (stateRef.current.kind === "loading") {
      setBusy(false);
    } else {
      setBusy(true);
    }
    void (async () => {
      const response = await fetch(apiPath());
      if (cancelled) return;
      if (response.status === 401) {
        setState({ kind: "login" });
        setBusy(false);
        return;
      }
      if (response.status === 502) {
        if (!hadPlant && stateRef.current.kind !== "plant") {
          setState({ kind: "error" });
        }
        setBusy(false);
        return;
      }
      const body = (await response.json()) as PlantPayload;
      if (cancelled) return;
      if (body.empty) {
        setState({ kind: "empty" });
        setBusy(false);
        return;
      }
      setState({
        kind: "plant",
        payload: { ...body, unit: body.unit ?? currentUnit() },
      });
      setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    if (state.kind !== "plant" && state.kind !== "empty") {
      return undefined;
    }
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setTick((n) => n + 1);
      }
    }, 20_000);
    return () => window.clearInterval(id);
  }, [state.kind]);

  if (state.kind === "login") {
    return <Login onGranted={() => setTick((n) => n + 1)} />;
  }
  if (state.kind === "empty") {
    return (
      <main aria-busy={busy ? true : undefined}>
        <PlantHeader />
        <p className="empty">This Plant has no History yet.</p>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main>
        <PlantHeader />
        <p className="empty">Plant view cannot reach History.</p>
      </main>
    );
  }
  if (state.kind === "plant") {
    return wide ? (
      <Plant payload={state.payload} busy={busy} />
    ) : (
      <PlantMobile payload={state.payload} busy={busy} />
    );
  }
  return <main />;
}

function PlantMobile({
  payload,
  busy,
}: {
  payload: Extract<PlantPayload, { empty: false }>;
  busy: boolean;
}) {
  return <Plant payload={payload} busy={busy} />;
}
