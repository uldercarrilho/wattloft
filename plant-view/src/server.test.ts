import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp, SampleHub } from "./server";
import { PushSubscriptionStore } from "./pushStore";

const DOCUMENT = "<!doctype html><title>Plant</title>";
const PASSWORD = "correct-horse";

function operatorSessionCookie(issuedAt: number): string {
  const hmac = createHmac("sha256", PASSWORD)
    .update(`operator.${issuedAt}`)
    .digest("hex");
  return `wattloft=${issuedAt}.${hmac}`;
}

function app(fetchImpl?: typeof fetch) {
  return createApp({
    operatorPassword: PASSWORD,
    apiUrl: "http://127.0.0.1:9",
    cookieSecure: false,
    documentHtml: DOCUMENT,
    fetch: fetchImpl,
  });
}

describe("Operator BFF", () => {
  it("rejects the wrong Operator password", async () => {
    const rejected = await app().request("/login", {
      method: "POST",
      body: new URLSearchParams({ password: "not-the-password" }),
    });
    expect(rejected.status).toBe(401);
    expect(await rejected.text()).toBe(DOCUMENT);
    expect(rejected.headers.getSetCookie().join()).not.toContain("wattloft=");
  });

  it("rejects the wrong Operator password as JSON when asked", async () => {
    const rejected = await app().request("/login", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ password: "not-the-password" }),
    });
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ error: "not-accepted" });
    expect(rejected.headers.getSetCookie().join()).not.toContain("wattloft=");
  });

  it("sets a session cookie and redirects after the correct password", async () => {
    const granted = await app().request("/login", {
      method: "POST",
      body: new URLSearchParams({ password: PASSWORD }),
    });
    expect(granted.status).toBe(303);
    expect(granted.headers.get("location")).toBe("/");
    const cookie = granted.headers.getSetCookie().join("\n");
    expect(cookie).toMatch(/wattloft=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=2592000/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  it("returns JSON ok when the SPA asks for JSON after the correct password", async () => {
    const granted = await app().request("/login", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ password: PASSWORD }),
    });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({ ok: true });
    expect(granted.headers.getSetCookie().join("\n")).toMatch(/wattloft=/);
  });

  it("clears the session on logout", async () => {
    const client = app();
    const granted = await client.request("/login", {
      method: "POST",
      body: new URLSearchParams({ password: PASSWORD }),
    });
    const cookie = granted.headers.get("set-cookie") ?? "";
    const ended = await client.request("/logout", {
      method: "POST",
      headers: { cookie },
    });
    expect(ended.status).toBe(303);
    const cleared = ended.headers.getSetCookie().join("\n");
    expect(cleared).toMatch(/wattloft=/);
    expect(cleared).toMatch(/Max-Age=0/i);
  });

  it("denies plant data without a session", async () => {
    const denied = await app().request("/api/plant");
    expect(denied.status).toBe(401);
  });

  it("admits a recently issued Operator session to plant data", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("", { status: 404 });
    const issuedAt = Math.floor(Date.now() / 1000);
    const plant = await app(fetchImpl).request("/api/plant", {
      headers: { cookie: operatorSessionCookie(issuedAt) },
    });
    expect(plant.status).toBe(200);
  });

  it("denies an Operator session issued more than 30 days ago", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 31 * 24 * 60 * 60;
    const denied = await app().request("/api/plant", {
      headers: { cookie: operatorSessionCookie(issuedAt) },
    });
    expect(denied.status).toBe(401);
  });

  it("refreshes the Operator session cookie when plant data is fetched", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("", { status: 404 });
    const issuedAt = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const plant = await app(fetchImpl).request("/api/plant", {
      headers: { cookie: operatorSessionCookie(issuedAt) },
    });
    expect(plant.status).toBe(200);
    const cookie = plant.headers.getSetCookie().join("\n");
    expect(cookie).toMatch(/wattloft=/);
    expect(cookie).toMatch(/Max-Age=2592000/i);
    expect(cookie).not.toContain(`${issuedAt}.`);
  });

  it("denies a legacy Operator session cookie without an issued time", async () => {
    const legacy = createHmac("sha256", PASSWORD).update("operator").digest("hex");
    const denied = await app().request("/api/plant", {
      headers: { cookie: `wattloft=${legacy}` },
    });
    expect(denied.status).toBe(401);
  });

  it("denies an Operator session whose issued time does not match the signature", async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const [, hmac] = operatorSessionCookie(issuedAt).slice("wattloft=".length).split(".");
    const tampered = issuedAt - 60;
    const denied = await app().request("/api/plant", {
      headers: { cookie: `wattloft=${tampered}.${hmac}` },
    });
    expect(denied.status).toBe(401);
  });

  it("maps Python empty History to an empty plant payload", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("", { status: 404 });
    const client = app(fetchImpl);
    const granted = await client.request("/login", {
      method: "POST",
      body: new URLSearchParams({ password: PASSWORD }),
    });
    const plant = await client.request("/api/plant", {
      headers: { cookie: granted.headers.get("set-cookie") ?? "" },
    });
    expect(plant.status).toBe(200);
    expect(await plant.json()).toEqual({ empty: true });
  });

  it("returns 502 when the snapshot API is down", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const client = app(fetchImpl);
    const granted = await client.request("/login", {
      method: "POST",
      body: new URLSearchParams({ password: PASSWORD }),
    });
    const plant = await client.request("/api/plant", {
      headers: { cookie: granted.headers.get("set-cookie") ?? "" },
    });
    expect(plant.status).toBe(502);
  });

  it("forwards a snapshot and defaults unknown unit to time", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/snapshot");
      expect(url.searchParams.get("day")).toBe("2026-08-21");
      expect(url.searchParams.has("unit")).toBe(false);
      return Response.json({
        selected_day: "2026-08-21",
        today_energy_kwh: 0.2,
        current_power_w: 50,
        lifetime_energy_kwh: 5635.4,
        current_power_at: "2026-08-22T13:00:00+00:00",
        local_day_bars: [],
        curve: [],
      });
    };
    const client = app(fetchImpl);
    const granted = await client.request("/login", {
      method: "POST",
      body: new URLSearchParams({ password: PASSWORD }),
    });
    const plant = await client.request("/api/plant?day=2026-08-21&unit=week", {
      headers: { cookie: granted.headers.get("set-cookie") ?? "" },
    });
    expect(plant.status).toBe(200);
    const body = await plant.json();
    expect(body.empty).toBe(false);
    expect(body.unit).toBe("time");
    expect(body.today_energy_kwh).toBe(0.2);
  });
});

describe("passkey login", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const credentialId = Buffer.from("operator-passkey").toString("base64url");
  const passkey = {
    credentialId,
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    rpId: "localhost",
  };

  function passkeyApp() {
    return createApp({
      operatorPassword: PASSWORD,
      apiUrl: "http://127.0.0.1:9",
      cookieSecure: false,
      documentHtml: DOCUMENT,
      passkey,
    });
  }

  function assertionFor(challenge: string, origin: string) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin }),
      "utf8",
    );
    const rpIdHash = createHash("sha256").update(passkey.rpId).digest();
    const authenticatorData = Buffer.concat([
      rpIdHash,
      Buffer.from([0x01]),
      Buffer.from([0, 0, 0, 1]),
    ]);
    const clientHash = createHash("sha256").update(clientDataJSON).digest();
    const signature = sign("sha256", Buffer.concat([authenticatorData, clientHash]), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    return {
      id: credentialId,
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  }

  it("hides passkey options when Vault has no credential", async () => {
    const missing = await app().request("/login/passkey/options");
    expect(missing.status).toBe(404);
    const posted = await app().request("/login/passkey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "nope" }),
    });
    expect(posted.status).toBe(404);
  });

  it("issues a challenge and grants a session for a valid assertion", async () => {
    const client = passkeyApp();
    const options = await client.request("/login/passkey/options");
    expect(options.status).toBe(200);
    const body = await options.json();
    expect(body.rpId).toBe("localhost");
    expect(body.allowCredentials).toEqual([{ type: "public-key", id: credentialId }]);
    const cookie = options.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/wattloft-pk=/);
    const granted = await client.request("/login/passkey", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(assertionFor(body.challenge, "http://localhost")),
    });
    expect(granted.status).toBe(303);
    expect(granted.headers.get("location")).toBe("/");
    expect(granted.headers.getSetCookie().join("\n")).toMatch(/wattloft=/);
  });

  it("rejects a bad assertion", async () => {
    const client = passkeyApp();
    const options = await client.request("/login/passkey/options");
    const cookie = options.headers.get("set-cookie") ?? "";
    const rejected = await client.request("/login/passkey", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: credentialId,
        response: {
          clientDataJSON: Buffer.from("{}").toString("base64url"),
          authenticatorData: Buffer.alloc(37).toString("base64url"),
          signature: Buffer.alloc(64).toString("base64url"),
        },
      }),
    });
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ error: "not-accepted" });
  });
});

describe("static Plant view files", () => {
  it("serves the web app manifest from staticRoot instead of the HTML shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wattloft-static-"));
    await writeFile(join(dir, "manifest.webmanifest"), JSON.stringify({ name: "Wattloft" }));
    const client = createApp({
      operatorPassword: PASSWORD,
      apiUrl: "http://127.0.0.1:9",
      cookieSecure: false,
      documentHtml: DOCUMENT,
      staticRoot: dir,
    });
    const res = await client.request("/manifest.webmanifest");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Wattloft" });
  });
});

describe("Live Telemetry & Notifications", () => {
  it("denies live telemetry stream without a session", async () => {
    const denied = await app().request("/api/plant/stream");
    expect(denied.status).toBe(401);
  });

  it("streams snapshot and sample events to an authenticated Operator", async () => {
    const sampleHub = new SampleHub();
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ empty: false, current_power_w: 350 }), {
        headers: { "content-type": "application/json" },
      });
    const client = createApp({
      operatorPassword: PASSWORD,
      apiUrl: "http://127.0.0.1:9",
      cookieSecure: false,
      documentHtml: DOCUMENT,
      fetch: fetchImpl,
      sampleHub,
    });
    const cookie = operatorSessionCookie(Math.floor(Date.now() / 1000));
    const res = await client.request("/api/plant/stream", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.body).toBeDefined();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // First message should be the initial snapshot
    const first = await reader.read();
    const firstText = decoder.decode(first.value);
    expect(firstText).toContain("event: snapshot");
    expect(firstText).toContain('"current_power_w":350');

    // Broadcast a sample
    await sampleHub.broadcast({
      type: "sample",
      logger_serial: "1000000001",
      received_at: "2026-09-09T14:32:00Z",
      ac_power_w: 412.5,
      today_energy_kwh: 3.82,
      lifetime_energy_kwh: 1420.15,
    });

    const second = await reader.read();
    const secondText = decoder.decode(second.value);
    expect(secondText).toContain("event: sample");
    expect(secondText).toContain('"ac_power_w":412.5');

    await reader.cancel();
  });

  it("denies notifications subscribe without session", async () => {
    const denied = await app().request("/api/notifications/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: "https://push.example.com" }),
    });
    expect(denied.status).toBe(401);
  });

  it("saves web push subscription for authenticated operator", async () => {
    const pushStore = new PushSubscriptionStore();
    const client = createApp({
      operatorPassword: PASSWORD,
      apiUrl: "http://127.0.0.1:9",
      cookieSecure: false,
      documentHtml: DOCUMENT,
      pushStore,
      vapidPublicKey: "test-public-key",
    });
    const cookie = operatorSessionCookie(Math.floor(Date.now() / 1000));
    const subRes = await client.request("/api/notifications/subscribe", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://push.example.com/123",
        keys: { p256dh: "key-data", auth: "auth-data" },
      }),
    });
    expect(subRes.status).toBe(200);
    expect(await subRes.json()).toEqual({ ok: true });
    expect(pushStore.list()).toHaveLength(1);
    expect(pushStore.list()[0]!.endpoint).toBe("https://push.example.com/123");

    const keyRes = await client.request("/api/notifications/vapid-public-key");
    expect(await keyRes.json()).toEqual({ publicKey: "test-public-key" });
  });

  it("evaluates stall alert and triggers push notification during sample broadcast", async () => {
    const pushStore = new PushSubscriptionStore();
    pushStore.save({
      endpoint: "https://push.example.com/sub1",
      keys: { p256dh: "key1", auth: "auth1" },
    });
    const sentPushes: { sub: unknown; payload: string }[] = [];
    const sampleHub = new SampleHub();
    createApp({
      operatorPassword: PASSWORD,
      apiUrl: "http://127.0.0.1:9",
      cookieSecure: false,
      documentHtml: DOCUMENT,
      pushStore,
      sampleHub,
      sendNotification: async (sub, payload) => {
        sentPushes.push({ sub, payload });
      },
      cachedLoggersNow: [
        {
          name: "1000000002",
          display_name: "West",
          last_success_at: "2026-09-09T14:00:00-03:00",
          power_w: 0,
        },
      ],
    });

    // East reports at 14:32 (32m after West silent) with 420 W
    await sampleHub.broadcast({
      type: "sample",
      logger_serial: "1000000001",
      received_at: "2026-09-09T14:32:00-03:00",
      ac_power_w: 420,
      today_energy_kwh: 3.5,
      lifetime_energy_kwh: 5000,
    });

    expect(sentPushes).toHaveLength(1);
    const notification = JSON.parse(sentPushes[0]!.payload);
    expect(notification.title).toBe("Wattloft · Logger Stall");
    expect(notification.body).toContain("West logger has been silent");
  });

  it("serves HTTP security headers", async () => {
    const res = await app().request("/");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });
});

