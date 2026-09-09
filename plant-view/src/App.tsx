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
  localDayOf,
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
import { applySample, formatTimeOfDay } from "./liveStream";

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
    document.title = "Log in · Wattloft";
    return () => {
      document.title = "Plant · Wattloft";
    };
  }, []);
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
      <svg className="login-mark" viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="36" className="glance-core is-hollow" />
      </svg>
      <h1>Wattloft</h1>
      <p className="lede">Watch this Plant.</p>
      {passkeyReady ? (
        <div className="login">
          <button type="button" onClick={() => void onPasskey()}>
            Use passkey
          </button>
        </div>
      ) : null}
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
        <button type="submit" className={passkeyReady ? "passkey" : undefined}>
          {passkeyReady ? "Use password" : "Log in"}
        </button>
      </form>
      {passkeyRejected ? (
        <p role="alert">Passkey not accepted.</p>
      ) : null}
    </main>
  );
}

function Plant({
  payload,
  busy,
  offline,
}: {
  payload: Extract<PlantPayload, { empty: false }>;
  busy: boolean;
  offline?: boolean;
}) {
  const unit = payload.unit;
  const snapshot = payload;
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
  const period = stepper(snapshot, snapshot.selected_day, unit, localDayOf(new Date().toISOString()));
  useEffect(() => {
    setHidden(new Set());
  }, [payload.selected_day, payload.unit]);
  return (
    <main aria-busy={busy ? true : undefined}>
      <a className="skip" href="#plant-chart">
        Skip to chart
      </a>
      <PlantHeader />
      {offline ? (
        <p className="offline-banner" role="status">
          Offline · Showing cached plant state as of {formatTimeOfDay(snapshot.current_power_at)}
        </p>
      ) : null}
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
    </main>
  );
}

async function enablePushNotifications(registration: ServiceWorkerRegistration) {
  try {
    if (!("Notification" in window) || Notification.permission === "denied") return;
    const res = await fetch("/api/notifications/vapid-public-key");
    if (!res.ok) return;
    const { publicKey } = (await res.json()) as { publicKey?: string };
    if (!publicKey) return;

    let sub = await registration.pushManager.getSubscription();
    if (!sub && Notification.permission === "granted") {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToBuffer(publicKey),
      });
    }
    if (sub) {
      await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      });
    }
  } catch {
    // push notifications not configured or denied
  }
}

export function App() {
  const wide = useWideViewport();
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const [fallbackPolling, setFallbackPolling] = useState(() => typeof EventSource === "undefined");
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          void enablePushNotifications(registration);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setIsOffline(false);
      setTick((n) => n + 1);
    };
    const onOffline = () => {
      setIsOffline(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

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
      try {
        const response = await fetch(apiPath());
        if (cancelled) return;
        if (response.headers.get("X-Wattloft-Offline") === "true") {
          setIsOffline(true);
        } else if (typeof navigator !== "undefined" && navigator.onLine) {
          setIsOffline(false);
        }
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
      } catch {
        if (cancelled) return;
        if (hadPlant || stateRef.current.kind === "plant") {
          setIsOffline(true);
          setBusy(false);
        } else {
          setState({ kind: "error" });
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const isPlant = state.kind === "plant";
  useEffect(() => {
    if (!isPlant) {
      setFallbackPolling(typeof EventSource === "undefined");
      return undefined;
    }
    if (typeof EventSource === "undefined") {
      setFallbackPolling(true);
      return undefined;
    }

    let es: EventSource | null = null;
    let retryCount = 0;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource("/api/plant/stream");

      es.onopen = () => {
        retryCount = 0;
        setFallbackPolling(false);
      };

      es.addEventListener("snapshot", (event: MessageEvent) => {
        try {
          const snapshot = JSON.parse(event.data);
          setState((prev) => {
            if (prev.kind !== "plant") return prev;
            const queryDay = new URLSearchParams(window.location.search).get("day");
            if (queryDay && queryDay !== snapshot.selected_day) {
              return {
                kind: "plant",
                payload: {
                  ...prev.payload,
                  current_power_w: snapshot.current_power_w,
                  current_power_at: snapshot.current_power_at,
                  loggers_now: snapshot.loggers_now,
                  today_energy_kwh: snapshot.today_energy_kwh,
                  lifetime_energy_kwh: snapshot.lifetime_energy_kwh,
                },
              };
            }
            return {
              kind: "plant",
              payload: {
                ...snapshot,
                unit: prev.payload.unit ?? currentUnit(),
              },
            };
          });
        } catch {
          // ignore malformed snapshot
        }
      });

      es.addEventListener("sample", (event: MessageEvent) => {
        try {
          const sample = JSON.parse(event.data);
          setState((prev) => {
            if (prev.kind !== "plant") return prev;
            return {
              kind: "plant",
              payload: applySample(prev.payload, sample),
            };
          });
        } catch {
          // ignore malformed sample
        }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        retryCount++;
        if (retryCount > 3) {
          setFallbackPolling(true);
        }
        const backoffMs = Math.min(1000 * Math.pow(2, retryCount - 1), 16000);
        reconnectTimeout = setTimeout(() => {
          connect();
        }, backoffMs);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) {
        es.close();
        es = null;
      }
    };
  }, [isPlant]);

  useEffect(() => {
    if (state.kind !== "plant" && state.kind !== "empty") {
      return undefined;
    }
    if (!fallbackPolling) {
      return undefined;
    }
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setTick((n) => n + 1);
      }
    }, 20_000);
    return () => window.clearInterval(id);
  }, [state.kind, fallbackPolling]);

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
      <Plant payload={state.payload} busy={busy} offline={isOffline} />
    ) : (
      <PlantMobile payload={state.payload} busy={busy} offline={isOffline} />
    );
  }
  return <main />;
}
