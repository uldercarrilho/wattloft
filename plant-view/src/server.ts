import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const COOKIE = "wattloft";
const SESSION_PAYLOAD = "operator";

export type CreateAppOptions = {
  operatorPassword: string;
  apiUrl: string;
  cookieSecure: boolean;
  documentHtml: string;
  fetch?: typeof fetch;
};

function sign(password: string): string {
  return createHmac("sha256", password).update(SESSION_PAYLOAD).digest("hex");
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
  const expected = Buffer.from(sign(password));
  const got = Buffer.from(offered);
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
      return c.html(opts.documentHtml, 401);
    }
    c.header("Set-Cookie", setCookie(sign(opts.operatorPassword), opts.cookieSecure));
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
  });
  const hostname = process.env.PLANT_VIEW_HOST ?? "127.0.0.1";
  const port = Number(process.env.PLANT_VIEW_PORT ?? "3000");
  serve({ fetch: app.fetch, hostname, port });
}

if (isExecutedDirectly()) {
  start();
}
