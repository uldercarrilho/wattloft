# Live telemetry via loopback SSE and offline-first PWA

Amends [ADR 0028](0028-python-ingest-and-snapshot-api.md) and [ADR 0029](0029-caddy-proxies-to-node.md).

Server B ingest remains plaintext TCP push on port 10000. When a Sample is recorded, the Python ingest process broadcasts the sample event on an in-memory loopback endpoint (`GET /events` on localhost:8000). The Node BFF connects to this internal stream and exposes an authenticated Server-Sent Events (SSE) endpoint (`GET /api/plant/stream`) to the browser, secured by the Operator Passkey session cookie. Caddy proxies the stream with HTTP/2 multiplexing, and periodic `: ping` comments every 25 seconds prevent proxy timeouts.

The browser client connects via `EventSource` and updates Current Power and the active minute point on the Power curve within 150 ms of frame receipt. If SSE disconnects and fails after three reconnect attempts, the client falls back to 20-second polling.

A Service Worker (`sw.ts`) provides offline-first PWA resilience: core app shell assets (HTML, JS/CSS bundles, fonts, icons) are pre-cached, `/api/plant` uses a stale-while-revalidate caching strategy, and an offline banner renders if connectivity is lost. Midday logger stall detection dispatches Web Push notifications when one logger stalls while a sibling produces in daylight. WebSockets were rejected: SSE is unidirectional, requires zero custom proxy headers, and reconnects natively.
