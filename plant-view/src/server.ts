import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import webpush from "web-push";
import {
  issuePasskeyChallenge,
  parsePasskeyCredential,
  readPasskeyChallenge,
  verifyPasskeyAssertion,
  type OperatorPasskey,
  type PasskeyAssertion,
} from "./passkey";
import { PushSubscriptionStore, type PushSubscriptionRecord } from "./pushStore";
import { evaluateStallAlert, type StallAlert } from "./stallAlert";
import type { LoggerNow } from "./types";

const COOKIE = "wattloft";
const PASSKEY_COOKIE = "wattloft-pk";
const SESSION_PAYLOAD = "operator";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type SampleEvent = {
  type: "sample";
  logger_serial: string;
  received_at: string;
  ac_power_w: number;
  today_energy_kwh: number;
  lifetime_energy_kwh: number;
};

export class SampleHub {
  private _listeners: Set<(sample: SampleEvent) => void> = new Set();

  subscribe(listener: (sample: SampleEvent) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  async broadcast(sample: SampleEvent): Promise<void> {
    for (const listener of Array.from(this._listeners)) {
      try {
        await listener(sample);
      } catch {
        // ignore
      }
    }
  }
}

export type CreateAppOptions = {
  operatorPassword: string;
  apiUrl: string;
  cookieSecure: boolean;
  documentHtml: string;
  fetch?: typeof fetch;
  staticRoot?: string;
  passkey?: OperatorPasskey | null;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject?: string;
  pushStore?: PushSubscriptionStore;
  sampleHub?: SampleHub;
  sendNotification?: (sub: PushSubscriptionRecord, payload: string) => Promise<void>;
  cachedLoggersNow?: LoggerNow[];
  sentAlertKeys?: Set<string>;
  onStallAlert?: (alert: StallAlert) => void;
  heartbeatIntervalMs?: number;
  loginRateLimitMax?: number;
  loginRateLimitWindowMs?: number;
};

function sessionHmac(password: string, issuedAt: number): string {
  return createHmac("sha256", password)
    .update(`${SESSION_PAYLOAD}.${issuedAt}`)
    .digest("hex");
}

function sign(password: string, issuedAt: number): string {
  return `${issuedAt}.${sessionHmac(password, issuedAt)}`;
}

function passwordsEqual(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(b.length || 1);
    timingSafeEqual(dummy, dummy);
    return false;
  }
  return timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      return rest.join("=");
    }
  }
  return null;
}

function hasSession(cookieHeader: string | undefined, password: string): boolean {
  const offered = cookieValue(cookieHeader, COOKIE);
  if (offered === null) {
    return false;
  }
  const separator = offered.indexOf(".");
  if (separator <= 0) {
    return false;
  }
  const issuedRaw = offered.slice(0, separator);
  const offeredHmac = offered.slice(separator + 1);
  const issuedAt = Number(issuedRaw);
  if (!Number.isInteger(issuedAt) || issuedRaw !== String(issuedAt)) {
    return false;
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  if (ageSeconds < 0 || ageSeconds > SESSION_TTL_SECONDS) {
    return false;
  }
  const expected = Buffer.from(sessionHmac(password, issuedAt));
  const got = Buffer.from(offeredHmac);
  if (got.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(got, expected);
}

function setCookie(value: string, cookieSecure: boolean, maxAge?: number): string {
  const parts = [`${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (cookieSecure) {
    parts.push("Secure");
  }
  if (maxAge !== undefined) {
    parts.push(`Max-Age=${maxAge}`);
  }
  return parts.join("; ");
}

function persistSession(password: string, cookieSecure: boolean): string {
  return setCookie(
    sign(password, Math.floor(Date.now() / 1000)),
    cookieSecure,
    SESSION_TTL_SECONDS,
  );
}

function passkeyCookie(token: string, cookieSecure: boolean): string {
  const parts = [`${PASSKEY_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=300"];
  if (cookieSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function requestOrigin(c: { req: { header: (name: string) => string | undefined } }, cookieSecure: boolean): string {
  const origin = c.req.header("origin");
  if (origin) {
    return origin;
  }
  const host = c.req.header("host") ?? "localhost";
  return `${cookieSecure ? "https" : "http"}://${host}`;
}

function parseUnit(raw: string | undefined): string {
  if (raw === "time" || raw === "day" || raw === "month" || raw === "year") {
    return raw;
  }
  return "time";
}

function grantLogin(
  c: Context,
  opts: Pick<CreateAppOptions, "operatorPassword" | "cookieSecure">,
): Response {
  c.header("Set-Cookie", persistSession(opts.operatorPassword, opts.cookieSecure));
  if ((c.req.header("accept") ?? "").includes("application/json")) {
    return c.json({ ok: true });
  }
  return c.redirect("/", 303);
}

export function createApp(opts: CreateAppOptions): Hono {
  const fetchImpl = opts.fetch ?? fetch;
  const app = new Hono();
  app.use(
    secureHeaders({
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
      },
    })
  );
  const sampleHub = opts.sampleHub ?? new SampleHub();
  const pushStore = opts.pushStore ?? new PushSubscriptionStore();
  const cachedLoggersNow: LoggerNow[] = opts.cachedLoggersNow ?? [];
  const sentAlertKeys = opts.sentAlertKeys ?? new Set<string>();

  async function sendPushNotification(sub: PushSubscriptionRecord, payload: string): Promise<void> {
    if (opts.sendNotification) {
      return opts.sendNotification(sub, payload);
    }
    if (opts.vapidPublicKey && opts.vapidPrivateKey) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          payload,
        );
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 410) {
          pushStore.remove(sub.endpoint);
        }
      }
    }
  }

  sampleHub.subscribe((sample) => {
    const existingIndex = cachedLoggersNow.findIndex((l) => l.name === sample.logger_serial);
    if (existingIndex >= 0) {
      cachedLoggersNow[existingIndex] = {
        ...cachedLoggersNow[existingIndex]!,
        last_success_at: sample.received_at,
        power_w: sample.ac_power_w,
      };
    } else {
      cachedLoggersNow.push({
        name: sample.logger_serial,
        last_success_at: sample.received_at,
        power_w: sample.ac_power_w,
      });
    }

    const alert = evaluateStallAlert(new Date(sample.received_at), cachedLoggersNow, sentAlertKeys);
    if (alert) {
      sentAlertKeys.add(alert.key);
      opts.onStallAlert?.(alert);
      const payload = JSON.stringify(alert.notification);
      for (const sub of pushStore.list()) {
        void sendPushNotification(sub, payload);
      }
    }
  });

  const maxLoginAttempts = opts.loginRateLimitMax ?? 5;
  const loginWindowMs = opts.loginRateLimitWindowMs ?? 60_000;
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();

  function clientIp(c: Context): string {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]!.trim();
    }
    return (
      c.req.header("x-real-ip") ??
      c.req.header("cf-connecting-ip") ??
      "127.0.0.1"
    );
  }

  function checkLoginRateLimit(c: Context): Response | null {
    const ip = clientIp(c);
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (entry && entry.resetAt > now && entry.count >= maxLoginAttempts) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      const accept = c.req.header("accept") ?? "";
      if (accept.includes("application/json")) {
        return c.json(
          {
            error: "too-many-requests",
            message: "Too many failed login attempts. Please try again later.",
          },
          429,
        );
      }
      return c.text("Too many failed login attempts. Please try again later.", 429);
    }
    return null;
  }

  function recordLoginFailure(c: Context): void {
    const ip = clientIp(c);
    const now = Date.now();
    const entry = loginAttempts.get(ip);
    if (!entry || entry.resetAt <= now) {
      loginAttempts.set(ip, { count: 1, resetAt: now + loginWindowMs });
    } else {
      entry.count += 1;
    }
  }

  function recordLoginSuccess(c: Context): void {
    loginAttempts.delete(clientIp(c));
  }

  app.post("/login", async (c) => {
    const rateLimitResponse = checkLoginRateLimit(c);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    const text = await c.req.text();
    const offered = new URLSearchParams(text).get("password") ?? "";
    if (!passwordsEqual(offered, opts.operatorPassword)) {
      recordLoginFailure(c);
      const accept = c.req.header("accept") ?? "";
      if (accept.includes("application/json")) {
        return c.json({ error: "not-accepted" }, 401);
      }
      return c.html(opts.documentHtml, 401);
    }
    recordLoginSuccess(c);
    return grantLogin(c, opts);
  });

  app.get("/login/passkey/options", (c) => {
    if (!opts.passkey) {
      return c.json({ error: "unavailable" }, 404);
    }
    const { challenge, token } = issuePasskeyChallenge(opts.operatorPassword);
    c.header("Set-Cookie", passkeyCookie(token, opts.cookieSecure));
    return c.json({
      challenge,
      rpId: opts.passkey.rpId,
      timeout: 60_000,
      userVerification: "preferred",
      allowCredentials: [{ type: "public-key", id: opts.passkey.credentialId }],
    });
  });

  app.post("/login/passkey", async (c) => {
    if (!opts.passkey) {
      return c.json({ error: "unavailable" }, 404);
    }
    const rateLimitResponse = checkLoginRateLimit(c);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    const challenge = readPasskeyChallenge(
      opts.operatorPassword,
      cookieValue(c.req.header("cookie"), PASSKEY_COOKIE),
    );
    let assertion: PasskeyAssertion;
    try {
      assertion = (await c.req.json()) as PasskeyAssertion;
    } catch {
      recordLoginFailure(c);
      return c.json({ error: "not-accepted" }, 401);
    }
    const origin = requestOrigin(c, opts.cookieSecure);
    if (
      !challenge ||
      typeof assertion?.id !== "string" ||
      typeof assertion.response?.clientDataJSON !== "string" ||
      typeof assertion.response.authenticatorData !== "string" ||
      typeof assertion.response.signature !== "string" ||
      !verifyPasskeyAssertion(opts.passkey, assertion, challenge, origin)
    ) {
      recordLoginFailure(c);
      return c.json({ error: "not-accepted" }, 401);
    }
    recordLoginSuccess(c);
    return grantLogin(c, opts);
  });

  app.post("/logout", (c) => {
    c.header(
      "Set-Cookie",
      setCookie("", opts.cookieSecure, 0),
    );
    return c.redirect("/", 303);
  });

  app.get("/api/plant", async (c) => {
    if (!hasSession(c.req.header("cookie"), opts.operatorPassword)) {
      return c.body(null, 401);
    }
    c.header("Set-Cookie", persistSession(opts.operatorPassword, opts.cookieSecure));
    const unit = parseUnit(c.req.query("unit"));
    const day = c.req.query("day");
    const snapshotUrl = new URL("/snapshot", opts.apiUrl.endsWith("/") ? opts.apiUrl : `${opts.apiUrl}/`);
    if (day) {
      snapshotUrl.searchParams.set("day", day);
    }
    let response: Response;
    try {
      response = await fetchImpl(snapshotUrl);
    } catch {
      return c.body(null, 502);
    }
    if (response.status === 404) {
      return c.json({ empty: true });
    }
    if (!response.ok) {
      return c.body(null, 502);
    }
    const snapshot: unknown = await response.json();
    if (typeof snapshot !== "object" || snapshot === null) {
      return c.body(null, 502);
    }
    return c.json({ empty: false, unit, ...snapshot });
  });

  app.get("/api/plant/stream", async (c) => {
    if (!hasSession(c.req.header("cookie"), opts.operatorPassword)) {
      return c.body(null, 401);
    }
    c.header("Set-Cookie", persistSession(opts.operatorPassword, opts.cookieSecure));
    const day = c.req.query("day");
    const snapshotUrl = new URL("/snapshot", opts.apiUrl.endsWith("/") ? opts.apiUrl : `${opts.apiUrl}/`);
    if (day) {
      snapshotUrl.searchParams.set("day", day);
    }

    let initialSnapshot: Record<string, unknown> | null = null;
    try {
      const response = await fetchImpl(snapshotUrl);
      if (response.ok) {
        const body = (await response.json()) as Record<string, unknown>;
        if (body && !body.empty) {
          initialSnapshot = body;
          if (Array.isArray(body.loggers_now)) {
            for (const row of body.loggers_now as LoggerNow[]) {
              const idx = cachedLoggersNow.findIndex((l) => l.name === row.name);
              if (idx >= 0) {
                cachedLoggersNow[idx] = row;
              } else {
                cachedLoggersNow.push(row);
              }
            }
          }
        }
      }
    } catch {
      // offline/backend unreachable
    }

    return streamSSE(c, async (stream) => {
      const unsubscribe = sampleHub.subscribe(async (sample) => {
        try {
          await stream.writeSSE({
            event: "sample",
            data: JSON.stringify(sample),
          });
        } catch {
          // ignore
        }
      });

      if (initialSnapshot !== null) {
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify(initialSnapshot),
        });
      }

      const heartbeatInterval = opts.heartbeatIntervalMs ?? 30_000;
      const pingInterval = setInterval(() => {
        void stream.write(": ping\n\n");
      }, heartbeatInterval);

      stream.onAbort(() => {
        clearInterval(pingInterval);
        unsubscribe();
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
    });
  });

  app.post("/api/notifications/subscribe", async (c) => {
    if (!hasSession(c.req.header("cookie"), opts.operatorPassword)) {
      return c.body(null, 401);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid-json" }, 400);
    }
    try {
      pushStore.save(body as PushSubscriptionRecord);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "invalid-subscription" }, 400);
    }
  });

  app.get("/api/notifications/vapid-public-key", (c) => {
    return c.json({ publicKey: opts.vapidPublicKey ?? null });
  });

  if (opts.staticRoot) {
    const root = opts.staticRoot;
    app.use("/assets/*", serveStatic({ root }));
    app.use("/favicon.svg", serveStatic({ root }));
    app.use("/manifest.webmanifest", serveStatic({ root }));
    app.use("/apple-touch-icon.png", serveStatic({ root }));
    app.use("/sw.js", serveStatic({ root }));
  }

  app.get("*", (c) => c.html(opts.documentHtml));
  return app;
}

export async function listenToIngestEvents(
  apiUrl: string,
  sampleHub: SampleHub,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const eventsUrl = new URL("/events", apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  while (!signal?.aborted) {
    try {
      const response = await fetchImpl(eventsUrl.href, { signal });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal?.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          for (const line of block.split("\n")) {
            if (line.startsWith("data:")) {
              const rawData = line.slice(5).trim();
              if (rawData) {
                try {
                  const sample = JSON.parse(rawData);
                  if (sample && sample.type === "sample") {
                    sampleHub.broadcast(sample);
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
        }
      }
    } catch {
      if (signal?.aborted) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return (
      resolve(fileURLToPath(import.meta.url)).toLowerCase() ===
      resolve(entry).toLowerCase()
    );
  } catch {
    return false;
  }
}

export function start(): void {
  const operatorPassword = process.env.OPERATOR_PASSWORD;
  const apiUrl = process.env.WATTLOFT_API_URL ?? "http://127.0.0.1:8000";
  if (!operatorPassword) {
    throw new Error("OPERATOR_PASSWORD is required");
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const indexPath = join(here, "client", "index.html");
  const documentHtml = existsSync(indexPath)
    ? readFileSync(indexPath, "utf8")
    : "<!doctype html><title>Plant · Wattloft</title>";

  const vapidPublicKey = process.env.OPERATOR_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.OPERATOR_VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.OPERATOR_VAPID_SUBJECT ?? "mailto:operator@wattloft.dedyn.io";
  if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  }

  const sampleHub = new SampleHub();
  const pushStore = new PushSubscriptionStore();
  const cachedLoggersNow: LoggerNow[] = [];
  const sentAlertKeys = new Set<string>();

  const app = createApp({
    operatorPassword,
    apiUrl,
    cookieSecure: process.env.COOKIE_SECURE === "true",
    documentHtml,
    staticRoot: existsSync(join(here, "client")) ? join(here, "client") : undefined,
    passkey: parsePasskeyCredential(process.env.OPERATOR_PASSKEY_CREDENTIAL),
    vapidPublicKey,
    vapidPrivateKey,
    vapidSubject,
    pushStore,
    sampleHub,
    cachedLoggersNow,
    sentAlertKeys,
  });

  void listenToIngestEvents(apiUrl, sampleHub);

  setInterval(() => {
    const alert = evaluateStallAlert(new Date(), cachedLoggersNow, sentAlertKeys);
    if (alert) {
      sentAlertKeys.add(alert.key);
      const payload = JSON.stringify(alert.notification);
      for (const sub of pushStore.list()) {
        void webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: sub.keys,
        }, payload).catch(() => {});
      }
    }
  }, 5 * 60 * 1000);

  const hostname = process.env.PLANT_VIEW_HOST ?? "127.0.0.1";
  const port = Number(process.env.PLANT_VIEW_PORT ?? "3000");
  serve({ fetch: app.fetch, hostname, port });
}

if (isExecutedDirectly()) {
  start();
}
