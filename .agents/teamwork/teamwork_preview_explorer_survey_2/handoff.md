# Application Security, OWASP Risk, and Dependency Health Audit Report

**Target Repository**: `wattloft` (`src/wattloft/`, `plant-view/`, `deploy/`, `.github/`)  
**Auditor**: Explorer 2 (Application Security & Vulnerability Analysis)  
**Date**: 2026-10-09  
**Mode**: Read-Only Source Code Analysis (Zero Tracked Files Modified)

---

## 1. Observation

### 1.1 Ingest Layer (TCP 10000) & Availability Architecture
- **File**: `src/wattloft/ingest.py`
  - Lines 17–19:
    ```python
    IDLE_TIMEOUT_S = 300
    MAX_BUF = 65536
    MAX_CONCURRENT_CONNECTIONS = 20
    ```
  - Lines 126–148:
    ```python
    async def start_ingest(...):
        max_connections = max_concurrent_connections()
        active_connections = 0
        lock = asyncio.Lock()

        async def _client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            nonlocal active_connections
            async with lock:
                if active_connections >= max_connections:
                    writer.close()
                    await writer.wait_closed()
                    return
                active_connections += 1
            try:
                await serve_logger(...)
            finally:
                async with lock:
                    active_connections -= 1
    ```
- **File**: `deploy/install-host.sh`
  - Lines 49–54:
    ```bash
    # OCI Ubuntu images REJECT new TCP except 22. NSG already allows 80/443/10000.
    for port in 80 443 10000; do
      if ! iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null; then
        iptables -I INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
      fi
    done
    ```
- **Tool Result**: Port 10000 is open to the public internet (`0.0.0.0`) without connection rate limiting, IP whitelisting, or firewall source restrictions. An attacker opening 20 concurrent idle TCP connections holding them open for 300 seconds saturates `max_connections`, dropping all legitimate logger connections.

### 1.2 Database TLS Configuration & Man-In-The-Middle Risk
- **File**: `src/wattloft/history/_mysql.py`
  - Lines 35–37:
    ```python
    ssl: dict[str, object] | None = None
    if query.get("ssl", "").lower() in {"1", "true", "required"}:
        ssl = {"check_hostname": False}
    ```
- **Tool Result**: When SSL/TLS is enabled in `DATABASE_URL` via query parameter `?ssl=true` or `?ssl=required`, PyMySQL explicitly sets `check_hostname: False`. Hostname verification is disabled, leaving database TLS connections vulnerable to Man-In-The-Middle (MITM) attacks if communicating with cloud-managed databases (e.g., OCI MySQL HeatWave or AWS RDS) across network boundaries.

### 1.3 Outbound Web Push Notifications & Blind SSRF
- **File**: `plant-view/src/server.ts`
  - Lines 211–233:
    ```typescript
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
    ```
  - Lines 491–507:
    ```typescript
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
    ```
- **File**: `plant-view/src/pushStore.ts`
  - Lines 13–22:
    ```typescript
    save(sub: PushSubscriptionRecord): void {
      if (
        !sub ||
        typeof sub.endpoint !== "string" ||
        !sub.keys ||
        typeof sub.keys.p256dh !== "string" ||
        typeof sub.keys.auth !== "string"
      ) {
        throw new Error("Invalid push subscription");
      }
      ...
    ```
- **File**: `deploy/compose.yml`
  - Line 15: `network_mode: host`
- **Tool Result**: `sub.endpoint` is accepted from client JSON without scheme (`https:`), domain allowlist (Google FCM, Apple Push, Mozilla autopush), or IP restriction (blocking RFC 1918 / loopback / cloud metadata IP `169.254.169.254`). Because `plant-view` runs with `network_mode: host` on OCI, an attacker who obtains session access can register an internal IP/metadata endpoint, triggering outbound POST requests from the host network when stall alerts evaluate.

### 1.4 Rate Limit Bypass via Client IP Header Spoofing
- **File**: `plant-view/src/server.ts`
  - Lines 266–276:
    ```typescript
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
    ```
  - Lines 278–298 & 315–329: Rate limits `/login` and `/login/passkey` to 5 attempts per 60 seconds keyed on `clientIp(c)`.
- **Tool Result**: The server extracts client IP directly from unverified request headers without checking whether the connection came from a trusted reverse proxy. An attacker can supply random `X-Forwarded-For` or `X-Real-IP` headers on every attempt, completely bypassing the 5-attempt brute-force threshold.

### 1.5 Session Revocation & Password-as-HMAC-Key
- **File**: `plant-view/src/server.ts`
  - Lines 26–27:
    ```typescript
    const SESSION_PAYLOAD = "operator";
    const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
    ```
  - Lines 79–87:
    ```typescript
    function sessionHmac(password: string, issuedAt: number): string {
      return createHmac("sha256", password)
        .update(`${SESSION_PAYLOAD}.${issuedAt}`)
        .digest("hex");
    }

    function sign(password: string, issuedAt: number): string {
      return `${issuedAt}.${sessionHmac(password, issuedAt)}`;
    }
    ```
  - Lines 384–390:
    ```typescript
    app.post("/logout", (c) => {
      c.header(
        "Set-Cookie",
        setCookie("", opts.cookieSecure, 0),
      );
      return c.redirect("/", 303);
    });
    ```
- **Tool Result**:
  1. The session token is completely stateless and signed using the operator's plaintext password (`opts.operatorPassword`) rather than an isolated high-entropy server signing secret (`SESSION_SECRET`).
  2. Logout merely instructs the browser to delete the cookie by setting `Max-Age=0`. The server maintains no revocation list, session nonce, or version counter. A captured session cookie remains cryptographically valid for up to 30 days after logout.

### 1.6 Reverse Proxy Fallback Port Mismatch
- **File**: `deploy/Caddyfile`
  - Lines 8–10:
    ```caddy
    {$WATTLOFT_HOSTNAME} {
    	reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:8000}
    }
    ```
- **File**: `plant-view/src/server.ts`
  - Line 645: `const port = Number(process.env.PLANT_VIEW_PORT ?? "3000");`
- **File**: `src/wattloft/__main__.py`
  - Line 15: `port = int(os.environ.get("WATTLOFT_API_PORT", "8000"))`
- **File**: `src/wattloft/api.py`
  - Lines 280–286:
    ```python
    return Starlette(
        routes=[
            Route("/snapshot", snapshot),
            Route("/events", events),
        ],
        lifespan=lifespan,
    )
    ```
- **Tool Result**: The Starlette backend API has zero authentication middleware. The Node BFF (`plant-view`) enforces operator authentication on port 3000. In `deploy/Caddyfile`, the default fallback port is `8000` (`{$PLANT_VIEW_PORT:8000}`). If `PLANT_VIEW_PORT` is unset when Caddy runs independently, Caddy proxies public HTTPS traffic directly to the unauthenticated Python API on port 8000, exposing plant production history, serials, and real-time SSE stream without authentication.

### 1.7 Content Security Policy & Security Headers
- **File**: `plant-view/src/server.ts`
  - Lines 197–205:
    ```typescript
    app.use(
      secureHeaders({
        permissionsPolicy: {
          camera: [],
          microphone: [],
          geolocation: [],
        },
      })
    );
    ```
- **File**: `deploy/Caddyfile`: Contains no header directives (no HSTS, no X-Content-Type-Options, no CSP).
- **Tool Result**: Hono's `secureHeaders` does not configure `contentSecurityPolicy` by default unless explicitly specified. Neither the Node BFF nor Caddy sets a `Content-Security-Policy` header.

### 1.8 WebAuthn Passkey Challenge Lifecycle
- **File**: `plant-view/src/server.ts`
  - Lines 338–347 & 349–382: Passkey login flow issues challenge via cookie `wattloft-pk` with 5-minute TTL signed by password HMAC.
  - In `grantLogin` (lines 183–192): Sets `wattloft` session cookie, but does NOT clear or expire the `wattloft-pk` challenge cookie.
- **File**: `plant-view/src/passkey.ts`
  - Lines 80–112: Challenges are verified statelessly via HMAC.
  - The challenge is not recorded as consumed upon successful assertion verification.
- **Tool Result**: An authenticator assertion and challenge token remain valid across the entire 5-minute challenge window without server-side single-use invalidation.

### 1.9 Dependency Vulnerability Scan
- **Command**: `npm audit` in `plant-view`
  - Output:
    ```
    shell-quote  1.8.4 - 1.10.0
    Severity: critical
    shell-quote: `quote()` command injection via a line terminator in a token after a `{ comment }` token - https://github.com/advisories/GHSA-pqg4-j6r4-53mv
    node_modules/shell-quote
      concurrently  9.2.3 - 9.2.4 || 10.0.0 - 10.0.5

    source-map-js  1.0.0 - 1.2.1
    Severity: high
    source-map-js allows event-loop denial of service through indexed source-map section offsets - https://github.com/advisories/GHSA-68fv-2mgg-jv7q
    node_modules/source-map-js
    ```
- **Command**: `npm audit --omit=dev` in `plant-view`
  - Output: `found 0 vulnerabilities`
- **Command**: OSV query on Python environment (`pymysql 1.2.0`, `starlette 1.6.0`, `uvicorn 0.52.4`, `urllib3 2.7.0`)
  - Output:
    - Production runtime dependencies (`pymysql`, `starlette`, `uvicorn`): `0 vulnerabilities found`
    - Development environment dependency `urllib3 2.7.0`: `6 vulnerabilities found` (GHSA-8988-9cw3-xx77, GHSA-gh4c-6fx4-qh6g, GHSA-vxq7-64xx-v4gw)
- **File**: `plant-view/Dockerfile`
  - Line 15: `RUN npm ci --omit=dev`
  - Line 23: `USER node`
  - Line 18: `RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm ...`
- **Tool Result**: Production Docker images build without dev dependencies and have zero known runtime vulnerabilities. However, local developer workstations and CI runners carry critical/high vulnerabilities in `concurrently -> shell-quote` and `source-map-js`.

### 1.10 CI/CD Security Workflows & Non-Blocking Scans
- **File**: `.github/workflows/ci.yml`
  - Line 80: `bandit -r src/ -s B104 -f txt -o sast-reports/bandit.txt || true`
  - Line 85: `docker run --rm ... semgrep scan ... || true`
- **File**: `.github/workflows/deploy.yml`
  - Line 172: `ghcr.io/zaproxy/zaproxy:stable zap-baseline.py ... -I || true`
- **Tool Result**: Bandit, Semgrep, and OWASP ZAP are run with `|| true` and ignore flags, completely suppressing scan failures. Security vulnerabilities identified by these tools will not fail pull requests or stop production deployments.

---

## 2. Logic Chain

```
[Observation 1.1: TCP 10000 open globally, max_connections=20, timeout=300s]
  └─> [Step 1: Any remote host can open 20 concurrent TCP sockets and send slow bytes]
  └─> [Step 2: active_connections reaches 20, triggering writer.close() on all subsequent connections]
  └─> [Deduction 1: Legitimate solar microinverters cannot connect to Server B; DoS achieved with minimal bandwidth]

[Observation 1.2: PyMySQL connection sets ssl={'check_hostname': False}]
  └─> [Step 1: TLS negotiation accepts any certificate presenting a valid signature chain regardless of SAN/CN]
  └─> [Step 2: Database connections routed over the public internet to cloud DBs are vulnerable to on-path interception]
  └─> [Deduction 2: MITM adversary can intercept DB credentials and query data]

[Observation 1.3: Web push endpoint accepts arbitrary client URL; container runs network_mode: host]
  └─> [Step 1: Operator session submits internal RFC1918 or metadata IP (169.254.169.254) as endpoint]
  └─> [Step 2: Server evaluates stall alert and executes outbound HTTP POST via webpush.sendNotification]
  └─> [Deduction 3: Blind SSRF against host localhost and cloud instance metadata service]

[Observation 1.4: clientIp trusts X-Forwarded-For / X-Real-IP without proxy verification]
  └─> [Step 1: Rate limiter keys attempts on IP extracted from untrusted client headers]
  └─> [Step 2: Brute-force attacker alternates X-Forwarded-For IP per attempt]
  └─> [Deduction 4: Login rate limiting is completely bypassed]

[Observation 1.5: Sessions are stateless HMAC(password, issuedAt) with 30-day TTL; logout only clears cookie]
  └─> [Step 1: Server lacks session storage or revocation list]
  └─> [Step 2: Logout sets Max-Age=0 in response header without invalidating HMAC token]
  └─> [Deduction 5: Intercepted session cookie remains valid for up to 30 days regardless of operator logout]

[Observation 1.6: Caddyfile fallback reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:8000}]
  └─> [Step 1: Plant-view BFF runs on 3000 (authenticated); Wattloft API runs on 8000 (unauthenticated)]
  └─> [Step 2: If PLANT_VIEW_PORT is missing, Caddy routes external traffic directly to port 8000]
  └─> [Deduction 6: Unauthenticated access to full solar history and telemetry stream via public hostname]

[Observation 1.7: Hono secureHeaders omits CSP; Caddyfile omits security headers]
  └─> [Step 1: Web application sends no Content-Security-Policy header]
  └─> [Deduction 7: Lack of defense-in-depth against client-side injection or untrusted third-party scripts]

[Observation 1.9: devDependencies carry shell-quote (Critical) and source-map-js (High); prod deps clean]
  └─> [Step 1: Docker multi-stage build omits dev dependencies (npm ci --omit=dev)]
  └─> [Step 2: Dev workstations and CI runners run vulnerable packages during npm ci and npm test]
  └─> [Deduction 8: Production runtime is secure, but development and CI supply chain require updates]

[Observation 1.10: CI/CD runs Bandit, Semgrep, and ZAP with || true]
  └─> [Step 1: Exit codes from SAST and DAST scanners are discarded]
  └─> [Deduction 9: Automated vulnerability gating is effectively disabled in CI/CD]
```

---

## 3. Caveats

1. **Physical Solar Inverter Constraints**: Solarman V5 protocol is constrained by legacy hardware firmware running on the Wi-Fi stick (Server B push over TCP). Plaintext transmission and lack of mutual TLS on port 10000 are hardware limitations of the physical loggers; application defenses must focus on network isolation and packet validation.
2. **Single-Operator Household Scope**: Wattloft is designed for a single operator monitoring one residential plant. Certain multi-tenant concerns (RBAC, tenant isolation) are deliberately out of scope per `CONTEXT.md`.
3. **Local Docker Daemon Availability**: Tests utilizing `testcontainers[mysql]` require a running Docker daemon. During this audit on the host Windows environment without Docker Desktop running, containerized integration tests could not boot MySQL; however, static code analysis, unit test suites (`vitest` 181/181 passed), and AST inspection were comprehensively executed.

---

## 4. Conclusion

The application architecture demonstrates strong baseline security practices in several critical areas:
- **Zero SQL Injection**: Universal use of parameterized SQL queries (`%s`), strict regex validation on database names, and no dynamic string interpolation in user-controlled queries.
- **XSS Immunity**: React 19 JSX auto-escaping, zero use of `dangerouslySetInnerHTML`, and no unsafe DOM manipulation.
- **Container Hardening**: Docker images drop privileges (`USER nobody` in Python backend, `USER node` in plant-view), strip build tooling (`npm`, `yarn`), and exclude development dependencies.
- **Timing Attack Resistance**: WebAuthn passkeys and password logins utilize `timingSafeEqual`.

However, the audit identified **13 specific vulnerabilities and security posture weaknesses** that should be remediated prior to public repository showcase:

| ID | Finding | Severity | Affected Component | OWASP Category |
|---|---|---|---|---|
| **SEC-01** | Denial of Service via TCP Ingest Connection Starvation | **High** | `src/wattloft/ingest.py:19`, `deploy/install-host.sh:50` | A04: Insecure Design |
| **SEC-02** | Insecure DB TLS Configuration (`check_hostname: False`) | **High** | `src/wattloft/history/_mysql.py:37` | A02: Cryptographic Failures |
| **SEC-03** | Blind SSRF via Web Push Subscription Endpoint | **High** | `plant-view/src/server.ts:211`, `pushStore.ts` | A10: Server-Side Request Forgery |
| **SEC-04** | Authentication Bypass of Login Rate Limit via IP Header Spoofing | **Medium** | `plant-view/src/server.ts:266-276` | A07: Identification & Auth |
| **SEC-05** | Stateless Rolling 30-Day Session Without Revocation on Logout | **Medium** | `plant-view/src/server.ts:27, 384` | A07: Identification & Auth |
| **SEC-06** | Reverse Proxy Fallback Port Discrepancy Exposing Unauth API | **Medium** | `deploy/Caddyfile:9` | A05: Security Misconfiguration |
| **SEC-07** | Missing Content Security Policy (CSP) & Defense-in-Depth Headers | **Medium** | `plant-view/src/server.ts:197`, `deploy/Caddyfile` | A05: Security Misconfiguration |
| **SEC-08** | Plaintext Password Reused as HMAC Signing Secret | **Low** | `plant-view/src/server.ts:79` | A02: Cryptographic Failures |
| **SEC-09** | Passkey Challenge Interception & Replay Risk / Incomplete Lifecycle | **Low** | `plant-view/src/passkey.ts:80-112`, `server.ts` | A07: Identification & Auth |
| **SEC-10** | Non-Blocking Security Scans in CI/CD Workflows (`\|\| true`) | **Low** | `.github/workflows/ci.yml:80, 85`, `deploy.yml:172` | A05: Security Misconfiguration |
| **SEC-11** | Known Vulnerabilities in Dev Dependencies (`shell-quote`, `source-map-js`, `urllib3`) | **Low** | `plant-view/package.json:28-33`, `.venv` | A06: Outdated Components |
| **SEC-12** | Ingest Security Audit Logging and Silent Connection Dropping | **Info** | `src/wattloft/ingest.py:43, 111` | A09: Security Logging |
| **SEC-13** | Unbounded Memory in In-Memory Push Subscription Store | **Info** | `plant-view/src/pushStore.ts:10-44` | A04: Insecure Design |

### Detailed Remediation Proposals

#### Remediation for SEC-01 (TCP Ingest DoS)
Restrict incoming traffic on port 10000 at the host firewall level (`iptables` / OCI Network Security Group) to known logger IP ranges if static, or implement per-IP connection limits in `ingest.py`:
```python
# Track connections per IP and shorten initial handshake deadline:
HANDSHAKE_TIMEOUT_S = 10.0
MAX_CONNECTIONS_PER_IP = 2
```

#### Remediation for SEC-02 (Database TLS Verification)
In `src/wattloft/history/_mysql.py`, enable hostname verification and require valid CA certificates:
```python
# Before:
if query.get("ssl", "").lower() in {"1", "true", "required"}:
    ssl = {"check_hostname": False}

# After:
if query.get("ssl", "").lower() in {"1", "true", "required"}:
    ssl = {"check_hostname": True}
```

#### Remediation for SEC-03 (Web Push SSRF)
Validate that `sub.endpoint` uses `https:` and matches approved push gateway domains before saving or dispatching:
```typescript
const ALLOWED_PUSH_DOMAINS = [
  "fcm.googleapis.com",
  "push.apple.com",
  "updates.push.services.mozilla.com",
  "notify.windows.com",
];

function isValidPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && ALLOWED_PUSH_DOMAINS.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
```

#### Remediation for SEC-04 (Rate Limiting IP Spoofing)
Do not trust `X-Forwarded-For` unless requests are validated as originating from the local reverse proxy (`127.0.0.1` / Caddy). Configure Caddy to overwrite (not append) `X-Forwarded-For` and `X-Real-IP`, or inspect socket remote address.

#### Remediation for SEC-05 & SEC-08 (Session Management & Signing Secret)
1. Introduce a dedicated `SESSION_SECRET` environment variable (32-byte hex) instead of hashing the password directly.
2. Maintain a session version / epoch in memory or DB (e.g., `session_version` integer). Incrementing the version on `/logout` instantly revokes all existing sessions server-side.

#### Remediation for SEC-06 (Caddyfile Port Fallback)
In `deploy/Caddyfile`:
```caddy
# Before:
reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:8000}

# After:
reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:3000}
```

#### Remediation for SEC-07 (Content Security Policy)
Add a strict CSP in `plant-view/src/server.ts`:
```typescript
app.use(
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
    },
  })
);
```

#### Remediation for SEC-10 & SEC-11 (CI/CD Scans & Dev Dependencies)
1. Run `npm update concurrently jsdom vite` and `npm audit fix` in `plant-view` to resolve `shell-quote` and `source-map-js`.
2. Remove `|| true` from Bandit and Semgrep in `.github/workflows/ci.yml` to ensure high/critical security findings fail the CI pipeline.

---

## 5. Verification Method

To independently reproduce and verify the findings in this report:

1. **Verify Read-Only Integrity**:
   ```pwsh
   git status --porcelain
   ```
   *Expected result*: Only `.agents/` contains untracked metadata; zero repository source files modified.

2. **Verify Frontend Test Suite**:
   ```pwsh
   cd plant-view
   npm test
   ```
   *Expected result*: 17 test files passed, 181 tests passed.

3. **Verify Dev vs Production Dependency Vulnerabilities**:
   ```pwsh
   cd plant-view
   npm audit                  # Reports 3 vulnerabilities (1 high, 2 critical)
   npm audit --omit=dev       # Reports 0 vulnerabilities
   ```

4. **Verify Backend Python Code & Unit Tests**:
   ```pwsh
   .venv\Scripts\pytest -k "not testcontainers and not mysql_url"
   ```
   *Expected result*: All offline unit tests pass (44 passed).

5. **Verify Hostname Verification Bypass in MySQL**:
   Inspect line 37 in `src/wattloft/history/_mysql.py`:
   ```python
   ssl = {"check_hostname": False}
   ```

6. **Verify Reverse Proxy Fallback Port Discrepancy**:
   Inspect line 9 in `deploy/Caddyfile`:
   ```caddy
   reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:8000}
   ```
