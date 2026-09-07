import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const COOKIE = "wattloft";
const SESSION_PAYLOAD = "operator";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type CreateAppOptions = {
  operatorPassword: string;
  apiUrl: string;
  cookieSecure: boolean;
  documentHtml: string;
  fetch?: typeof fetch;
  staticRoot?: string;
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

function parseUnit(raw: string | undefined): string {
  if (raw === "time" || raw === "day" || raw === "month" || raw === "year") {
    return raw;
  }
  return "time";
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
    c.header("Set-Cookie", persistSession(opts.operatorPassword, opts.cookieSecure));
    return c.redirect("/", 303);
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
    app.use("/assets/*", serveStatic({ root: opts.staticRoot }));
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
    : "<!doctype html><title>Plant</title>";
  const app = createApp({
    operatorPassword,
    apiUrl,
    cookieSecure: process.env.COOKIE_SECURE === "true",
    documentHtml,
    staticRoot: existsSync(join(here, "client")) ? join(here, "client") : undefined,
  });
  const hostname = process.env.PLANT_VIEW_HOST ?? "127.0.0.1";
  const port = Number(process.env.PLANT_VIEW_PORT ?? "3000");
  serve({ fetch: app.fetch, hostname, port });
}

if (isExecutedDirectly()) {
  start();
}
