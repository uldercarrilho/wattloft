# Plant view as its own app

Wattloft stays one household Plant observer. Server B ingest and History stay in Python. Plant view becomes a React app with a Node BFF in this repo so the Operator UI can evolve on its own stack without changing ingest.

v1 Operator surfaces do not change: login, empty History, KPIs (Today energy, Current Power, Lifetime energy, Last sample), period stepper, Time / Day / Month / Year grains, Azulejo look, existing copy.

## Goal

- Two packages in this git repo: `wattloft` (Python) and `plant-view` (TypeScript).
- Two processes on the existing OCI pet VM, one public hostname.
- The Operator’s browser talks only to Node (via Caddy). Python is ingest plus a loopback JSON API.
- Node owns the Operator session cookie and checks `OPERATOR_PASSWORD`. Python does not authenticate the Operator.

## Non-goals

- A second git repository.
- Next.js, a separate BFF package, or a Node SSR renderer.
- Hosting Plant view on another origin.
- Docker bridge networking (compose stays `network_mode: host`).
- Splitting ingest out of the Python process.
- Changing Plant view behavior, copy, or grains.
- An identity provider (ADR 0007 still holds).
- OpenAPI/codegen or a shared types package. The JSON snapshot is the contract; `plant-view` hand-writes matching TypeScript types.

## Architecture

```
Logger --TCP 10000--> wattloft (ingest + History + GET /snapshot)
Operator --HTTPS 443--> Caddy --> plant-view Node (session + React + BFF)
                                      |
                                      +--HTTP 127.0.0.1:8000--> wattloft API
```

- **`wattloft`**: one Python process. Server B on `0.0.0.0:10000`. JSON API on `127.0.0.1:8000`. No HTML, no cookies, no `OPERATOR_PASSWORD`.
- **`plant-view`**: one Node process. Hono serves BFF routes and, in production, the Vite build. Binds `127.0.0.1:3000`.
- **Caddy**: TLS on 80/443; reverse-proxies the Operator hostname to `127.0.0.1:3000`. It does not proxy to Python.

Keep host networking. The API is private because it binds loopback, not because of a Docker network.

### ADR impact

Implementation records:

- **ADR 0027** supersedes ADR 0026: Plant view is a React app in `plant-view`, not server-rendered HTML/CSS/SVG with inline script in the Python process. Login and empty History may include the React bundle. Surfaces and copy stay.
- **ADR 0028** amends ADR 0015: one Python process still owns ingest, History writes, and the snapshot API. Plant view is not in that process. HeatWave is still not a reason to split ingest from the snapshot API.
- **ADR 0029** amends ADR 0016: Caddy proxies Plant view to the Node loopback port, not to Python.
- **ADR 0007 unchanged**: one Operator password, stored as a deploy secret. The checker moves to Node.

## Packages

### `src/wattloft` (Python)

`wattloft.history` is unchanged (`plant_snapshot`, Samples, HeatWave).

Starlette exposes:

| Method | Path | Meaning |
| --- | --- | --- |
| GET | `/snapshot` | Query `day` optional (`YYYY-MM-DD`). |

Behavior:

1. Call `plant_snapshot`. If it returns `None`, respond **404** with an empty body. That is empty History, not an error.
2. Clamp `day` with today’s `_parse_day` / `_selected_day` / `_history_span` rules (invalid or missing `day` → last Local day in History; out of range → first or last). If the clamped day differs from the requested day, rebuild the snapshot for the clamped day (curve is per Local day).
3. Respond **200** JSON. `unit` is not a Python query parameter.

Clamp helpers (`_parse_day`, `_selected_day`, `_history_span`) live in `wattloft.api` beside the route. They do not move to Node or React.

JSON object (snake_case):

```json
{
  "selected_day": "2026-08-21",
  "today_energy_kwh": 0.2,
  "current_power_w": 50.0,
  "lifetime_energy_kwh": 5635.4,
  "current_power_at": "2026-08-22T13:00:00+00:00",
  "local_day_bars": [
    {"local_day": "2026-08-21", "today_energy_kwh": 3.9}
  ],
  "curve": [
    {
      "name": "1000000001",
      "points": [
        {"at": "2026-08-21T10:00:00", "watts": 50.0, "lifetime_kwh": 1.1}
      ]
    },
    {"name": "Plant", "points": [{"at": "2026-08-21T10:00:00", "watts": 50.0}]}
  ]
}
```

Time semantics stay as today:

- `current_power_at` is Sample receive time (timezone-aware UTC).
- Curve point `at` is Local civil datetime in `America/Sao_Paulo`, naive (no UTC conversion). The Time grain already interpolates in the client from these points.
- `today_energy_kwh` may be `null` (no successful Today energy for the Local day). Missing Loggers are omitted, never coerced to 0.

`__main__.py` no longer reads `OPERATOR_PASSWORD`. Bind host/port from `WATTLOFT_API_HOST` (default `127.0.0.1`) and `WATTLOFT_API_PORT` (default `8000`). Ingest env names stay `INGEST_HOST` / `INGEST_PORT`. Replace `plant_view.py` with `api.py` (Starlette JSON app + ingest lifespan). No HTML, CSS, or browser script remains in Python.

### `plant-view/` (TypeScript)

One npm package at the repo root: Vite + React + Hono.

**BFF (Hono)** owns Operator HTTP:

| Method | Path | Meaning |
| --- | --- | --- |
| POST | `/login` | Form field `password`. Compare to `OPERATOR_PASSWORD` with a constant-time check. Success: set cookie, **303** to `/`. Failure: **401** and the same React document as `GET /`. |
| POST | `/logout` | Clear cookie, **303** to `/`. |
| GET | `/api/plant` | Require session. Query `day` and `unit` (`time` \| `day` \| `month` \| `year`; default `time`). Forward `day` to Python `GET /snapshot`. `unit` is for the client only. |

Session: httpOnly cookie named `wattloft`, signed with `OPERATOR_PASSWORD`, `Path=/`, `SameSite=Lax`. Set `Secure` when `COOKIE_SECURE=true` (compose sets this; local dev does not). Node itself listens on HTTP; Caddy is HTTPS, so production cookies must still be `Secure`.

`GET /` (and other non-API UI paths) always returns the React app **200**. The document is not access-controlled; `/api/plant` is. Unauthenticated Operator sees the password form because the app gets **401** from `/api/plant`.

`GET /api/plant` mapping:

- No/invalid cookie → **401**.
- Python **404** → **200** `{ "empty": true }`.
- Python **200** → **200** `{ "empty": false, "unit": "<grain>", ...snapshot }`.
- Python unreachable or non-404 failure → **502**. Do not invent KPIs or zeros.

Login is a real HTML form `POST` to `/login` (not a JSON fetch), so 303 + cookie behave as today.

Operator URLs stay query-string: `/?day=YYYY-MM-DD&unit=time|day|month|year`. Stepper and grain controls are client navigation that update those params and refetch `/api/plant`.

**React** implements the four v1 surfaces from snapshot JSON:

- Login form (same fields and labels: Password, Log in).
- Empty History: “This Plant has no History yet.”, Log out, no KPIs, no chart.
- KPIs, stepper, grains, Time curve (hair, series toggles, interpolation that today lives in `_TIME_JS`), Day/Month/Year bars (aggregate `local_day_bars` in the client; Python does not pre-sum months/years).
- Copy that today is tested against HTML stays: grain names Time/Day/Month/Year, “This Local day has no curve Samples.”, “Tap a name to show or hide its curve.”, Last sample as live relative age from `current_power_at`.

React calls only `/api/plant`. It never calls `127.0.0.1:8000`.

Production: one Node process on `127.0.0.1:3000` serves `dist/` static files and the Hono routes. Dev: Hono on `127.0.0.1:3000`, Vite on `127.0.0.1:5173` proxying `/login`, `/logout`, and `/api/*` to Hono; `wattloft` runs separately. Operator uses `http://127.0.0.1:5173` locally and Caddy in production.

## Deploy

Compose grows a `plant-view` service, still `network_mode: host`, `restart: unless-stopped`, same env file as today.

- **wattloft** image: existing GHCR `wattloft`. Env: `DATABASE_URL`, `WATTLOFT_API_HOST=127.0.0.1`, `WATTLOFT_API_PORT=8000`, ingest host/port. Does not need `OPERATOR_PASSWORD`.
- **plant-view** image: new GHCR `wattloft-plant-view` (same registry/owner). Env: `OPERATOR_PASSWORD`, `WATTLOFT_API_URL=http://127.0.0.1:8000`, `PLANT_VIEW_HOST=127.0.0.1`, `PLANT_VIEW_PORT=3000`, `COOKIE_SECURE=true`.
- **caddy**: `PLANT_VIEW_PORT=3000` (Node). Caddyfile upstream stays `127.0.0.1:{$PLANT_VIEW_PORT}`.

Cutover is one compose change: new container plus Caddy upstream to Node. Do not leave Caddy pointing at Python (Operator would see raw JSON). Python Dockerfile stays; add a Node multi-stage Dockerfile under `plant-view/`. CI publishes both images on `main` and deploys both.

Vault/cloud-init still inject `OPERATOR_PASSWORD` into `/etc/wattloft/wattloft.env`. Python may see the variable and must ignore it.

## Error handling

- **Empty History**: Python 404 after a successful store read with no usable Samples. React empty sentence. Not a dash of zeros.
- **Store unreachable at Python boot**: process exits non-zero, as today. Node may be up; Operator sees the **502** failure state, not empty History.
- **Python down while Node is up**: `/api/plant` is 502. React shows “Plant view cannot reach History.” plus Log out. Do not reuse the empty-History sentence.
- **Ingest vs view**: Loggers can write Samples while Plant view is down, and the reverse.
- **Unknown day / unknown unit**: Python clamps day. Unknown `unit` becomes `time` in the BFF (same as today’s `_parse_unit`).
- **Stranger Loggers**: unchanged; Node is not on the ingest path.
- **Wrong password / no session**: 401, login form, no session cookie.

## Testing

### Python (`pytest`)

Keep Server B and HeatWave tests. Stop scraping HTML from the Python process.

Assert `GET /snapshot` JSON for:

- empty History → 404
- admitted Logger KPIs, receive time as `current_power_at`
- two-Logger bars and curve series (Plant + serials)
- day clamp and per-day curve
- Server B honesty (no Sample ⇒ 404, not zeros)
- History surviving process restart (JSON still has the Sample)
- boot failure when the store is unreachable

`WattloftProcess` is the API + ingest process. It does not take `OPERATOR_PASSWORD`. No Python test starts Node.

### BFF (`plant-view`, Vitest)

Hono app tests with a fake snapshot origin:

- wrong password → 401
- good password → 303 + `wattloft` cookie
- logout clears cookie
- unauthenticated `/api/plant` → 401
- Python 404 → `{ "empty": true }`
- Python down → 502

No MySQL in these tests.

### React (`plant-view`, Vitest + Testing Library)

Fixture snapshots. Assert surfaces and copy: login, empty History, KPIs, grains, Last sample relative age, no-curve sentence. Do not assert “no `<script>` tags.”

### Caddy

One reverse-proxy test: Caddy → Node → Python. HTTPS `POST /login`, then `GET /api/plant` JSON contains the admitted Sample’s kWh and W. Grain matrix does not run through Caddy.

### CI

`main` runs `pytest` + `mypy` and `plant-view` install / test / typecheck. Two images push; compose starts both.

## Local develop

```bash
pip install -e ".[dev]"
export DATABASE_URL=…   # no OPERATOR_PASSWORD required for wattloft
wattloft
```

```bash
cd plant-view
npm install
export OPERATOR_PASSWORD=…
export WATTLOFT_API_URL=http://127.0.0.1:8000
npm run dev   # Vite :5173 and Hono :3000 together
```

README documents both. Plant view is no longer on Python port 8000.

## Success

- Operator on the existing hostname sees the same Plant view after login.
- Loggers still dial Server B on the same hostname and port.
- `plant-view` can change UI, tests, and Node dependencies without a Python package change, as long as the snapshot JSON holds.
- Python can change ingest/History without a frontend package change, as long as the snapshot JSON holds.
