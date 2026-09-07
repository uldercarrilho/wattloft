import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  issuePasskeyChallenge,
  parsePasskeyCredential,
  readPasskeyChallenge,
  verifyPasskeyAssertion,
  type OperatorPasskey,
  type PasskeyAssertion,
} from "./passkey";

const COOKIE = "wattloft";
const PASSKEY_COOKIE = "wattloft-pk";
const SESSION_PAYLOAD = "operator";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type CreateAppOptions = {
  operatorPassword: string;
  apiUrl: string;
  cookieSecure: boolean;
  documentHtml: string;
  fetch?: typeof fetch;
  staticRoot?: string;
  passkey?: OperatorPasskey | null;
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

  app.post("/login", async (c) => {
    const text = await c.req.text();
    const offered = new URLSearchParams(text).get("password") ?? "";
    if (!passwordsEqual(offered, opts.operatorPassword)) {
      const accept = c.req.header("accept") ?? "";
      if (accept.includes("application/json")) {
        return c.json({ error: "not-accepted" }, 401);
      }
      return c.html(opts.documentHtml, 401);
    }
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
    const challenge = readPasskeyChallenge(
      opts.operatorPassword,
      cookieValue(c.req.header("cookie"), PASSKEY_COOKIE),
    );
    let assertion: PasskeyAssertion;
    try {
      assertion = (await c.req.json()) as PasskeyAssertion;
    } catch {
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
      return c.json({ error: "not-accepted" }, 401);
    }
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

  if (opts.staticRoot) {
    const root = opts.staticRoot;
    app.use("/assets/*", serveStatic({ root }));
    app.use("/favicon.svg", serveStatic({ root }));
    app.use("/manifest.webmanifest", serveStatic({ root }));
    app.use("/apple-touch-icon.png", serveStatic({ root }));
  }

  app.get("*", (c) => c.html(opts.documentHtml));
  return app;
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
  const app = createApp({
    operatorPassword,
    apiUrl,
    cookieSecure: process.env.COOKIE_SECURE === "true",
    documentHtml,
    staticRoot: existsSync(join(here, "client")) ? join(here, "client") : undefined,
    passkey: parsePasskeyCredential(process.env.OPERATOR_PASSKEY_CREDENTIAL),
  });
  const hostname = process.env.PLANT_VIEW_HOST ?? "127.0.0.1";
  const port = Number(process.env.PLANT_VIEW_PORT ?? "3000");
  serve({ fetch: app.fetch, hostname, port });
}

if (isExecutedDirectly()) {
  start();
}
