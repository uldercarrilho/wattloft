import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  type ChartMode,
  readChartMode,
} from "./chartMode";
import {
  formatKwh,
  formatWatts,
  href,
  parseUnit,
  stackLoggerNames,
  stepper,
} from "./grains";
import { LastSample, lifetimeKwh } from "./LastSample";
import { PlantMobile } from "./PlantMobile";
import {
  Chart,
  ChartModeBar,
  GRAIN_LABEL,
  PeriodStepper,
  PlantHeader,
  SeriesChips,
  chooseChartMode,
  overlayTimeNames,
} from "./plantChrome";
import type { Grain, PlantPayload } from "./types";
import { useWideViewport } from "./useWideViewport";

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
      <ChartModeBar mode={mode} onChoose={(next) => chooseChartMode(next, setMode)} />
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
