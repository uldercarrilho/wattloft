# Wattloft v2.0: Resilient History Engine & Scalable Aggregations

Wattloft observes production of one household solar Plant. This specification establishes the **multi-milestone evolution roadmap** for future Wattloft development and details the complete architecture and implementation for its biggest next release: **Wattloft v2.0 (Resilient History Engine & Scalable Aggregations)**.

---

## 1. Multi-Milestone Evolution Roadmap

Wattloft follows a staged roadmap to scale, modernize telemetry, and expand solar diagnostics while strictly adhering to the core domain invariants defined in `CONTEXT.md` (*single household solar plant, single operator, Server B push ingest only, HeatWave MySQL store, Azulejo UI aesthetic*):

| Milestone | Codename | Primary Focus | Scope & Key Deliverables |
| :--- | :--- | :--- | :--- |
| **v2.0** *(This Spec)* | **Resilient History** | **Data Scaling & Storage Engine** | B-tree indexing on `samples`, materialized `day_summaries` rollups, targeted $O(1)$ time-window curve queries, persistent DB connection pooling, constant-time snapshot generation. |
| **v2.1** | **Live Telemetry** | **Real-Time Push & PWA Shell** | Server-Sent Events (SSE) streaming updates from Python/Node to React (eliminating 20s polling), offline-ready PWA Service Worker caching, daytime logger stall Web Push notifications. |
| **v2.2** | **Solar Intelligence** | **Panel Diagnostics & Baselines** | East vs. West panel divergence drift detection, inverter clipping/thermal throttle identification, clear-sky production envelope comparison, year-over-year production overlay. |

---

## 2. Milestone 1 (v2.0): Problem & Objectives

### Problem Statement
In v1, the `samples` table has only `PRIMARY KEY (id)`. The columns `logger_serial`, `received_at`, and `parse_succeeded` are unindexed.

On every snapshot poll (`GET /snapshot` / `GET /api/plant` every 20 seconds while the web app is open):
1. `load_successful_samples()` executes:
   ```sql
   SELECT logger_serial, received_at, ac_power_w, today_energy_kwh, lifetime_energy_kwh
   FROM samples
   WHERE parse_succeeded
   ORDER BY received_at
   ```
   This performs a full sequential table scan across the entire database over the network.
2. In Python, `build_plant_snapshot` iterates over all historical samples to compute daily bars and the current day's curve.
3. Every sample ingested and every snapshot requested opens a new raw TCP connection to MySQL HeatWave (`_connect(database_url)`) and closes it immediately.

With two loggers pushing samples every 1–3 minutes (~1,000 samples/day, ~365,000 samples/year), this $O(N)$ architecture creates severe performance risks:
- After 1 year, each poll transfers ~25 MB of unindexed SQL rows and creates hundreds of thousands of Python dataclass instances in memory.
- Under Always Free OCI pet VM constraints (1–2 vCPUs, limited RAM), memory exhaustion and snapshot query timeouts are guaranteed.

### Objectives
1. **$O(1)$ Snapshot Generation:** Compute snapshots in under 25ms regardless of history size (1 year, 5 years, or 10 years).
2. **Indexed Range Scans:** Query only the selected Local Day's samples for curve drawing.
3. **Materialized Daily Summaries:** Maintain a persistent `day_summaries` rollup table updated incrementally during sample ingest.
4. **Connection Pooling:** Reuse persistent database connections across ingest frames and API requests.
5. **Zero Interface Breakage:** Maintain exact backwards-compatibility with the existing JSON snapshot payload contract and `plant-view` frontend.

---

## 3. Database Schema & Migration

### Schema DDL

```sql
-- 1. Hardened indexes on raw immutable samples table
ALTER TABLE samples
    ADD INDEX idx_samples_received_serial (received_at, logger_serial),
    ADD INDEX idx_samples_success_received (parse_succeeded, received_at);

-- 2. Materialized daily rollups (one record per admitted logger per Local Day)
CREATE TABLE IF NOT EXISTS day_summaries (
    local_day DATE NOT NULL,
    logger_serial VARCHAR(32) NOT NULL,
    first_received_at DATETIME(6) NOT NULL,
    last_received_at DATETIME(6) NOT NULL,
    start_lifetime_kwh DOUBLE,
    last_lifetime_kwh DOUBLE,
    last_today_energy_kwh DOUBLE,
    peak_power_w DOUBLE,
    sample_count INT NOT NULL DEFAULT 1,
    PRIMARY KEY (local_day, logger_serial),
    INDEX idx_day_summaries_day (local_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Automatic Backfill & Zero-Downtime Migration
`ensure_history(database_url)` handles table and index creation idempotently.
If `day_summaries` is empty while `samples` has existing data:
1. Wattloft executes an automated backfill chunked by local month or date range.
2. Production metrics are calculated strictly according to CONTEXT rules:
   - `local_day`: `DATE(CONVERT_TZ(received_at, '+00:00', '-03:00'))` (Zone `America/Sao_Paulo`).
   - `start_lifetime_kwh`: first non-null non-zero `lifetime_energy_kwh` on that Local Day.
   - `last_lifetime_kwh`: last non-null non-zero `lifetime_energy_kwh` on that Local Day.
   - `last_today_energy_kwh`: last non-null `today_energy_kwh` on that Local Day.
   - `peak_power_w`: `MAX(ac_power_w)` for successful samples.
3. Once the backfill finishes, the backfill state is marked complete.

---

## 4. Ingest Pipeline Updates

When an admitted frame arrives at `src/wattloft/ingest.py`:

1. **Raw Append:** Record into `samples` with `parse_succeeded = 1` (or `0` on corrupt frame).
2. **Synchronous Rollup Upsert:** In the same database transaction (or immediately following), upsert into `day_summaries`:
   ```sql
   INSERT INTO day_summaries (
       local_day, logger_serial, first_received_at, last_received_at,
       start_lifetime_kwh, last_lifetime_kwh, last_today_energy_kwh,
       peak_power_w, sample_count
   )
   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1)
   ON DUPLICATE KEY UPDATE
       last_received_at = VALUES(last_received_at),
       start_lifetime_kwh = COALESCE(start_lifetime_kwh, VALUES(start_lifetime_kwh)),
       last_lifetime_kwh = COALESCE(VALUES(last_lifetime_kwh), last_lifetime_kwh),
       last_today_energy_kwh = COALESCE(VALUES(last_today_energy_kwh), last_today_energy_kwh),
       peak_power_w = GREATEST(COALESCE(peak_power_w, 0), VALUES(peak_power_w)),
       sample_count = sample_count + 1;
   ```
3. Corrupt or unparseable frames (`parse_succeeded = 0`) are recorded only in `samples` and do **not** touch `day_summaries`.

---

## 5. Targeted Query Engine (`plant_snapshot`)

The snapshot builder is rewritten to execute three targeted, index-backed queries:

### Query 1: Day Bars from Rollups
```sql
SELECT local_day, logger_serial, start_lifetime_kwh, last_lifetime_kwh, last_today_energy_kwh
FROM day_summaries
ORDER BY local_day ASC, logger_serial ASC;
```
- For 5 years of history across 2 loggers, this returns only ~3,650 small rows (instead of ~3.6 million raw sample rows).
- Daily production per logger is computed using the exact CONTEXT formula:
  $$\text{production} = \text{last\_lifetime} - \text{prev\_lifetime}$$
  falling back to `last_today_energy_kwh` when no prior lifetime exists.

### Query 2: Selected Day Curve
A Local Day `YYYY-MM-DD` in `America/Sao_Paulo` (UTC-3) translates to the exact UTC window:
- Start UTC: `YYYY-MM-DD 03:00:00`
- End UTC: `(YYYY-MM-DD + 1) 03:00:00`

```sql
SELECT logger_serial, received_at, ac_power_w, lifetime_energy_kwh
FROM samples
WHERE received_at >= %s AND received_at < %s
  AND parse_succeeded = 1
ORDER BY received_at ASC;
```
- Uses `idx_samples_received_serial`.
- Reads only ~300–500 points for that day.
- Computes `CurveSeries` and interpolated curve points in microseconds.

### Query 3: Loggers Now & Plant KPIs
```sql
SELECT logger_serial, received_at, ac_power_w, lifetime_energy_kwh, today_energy_kwh
FROM samples
WHERE received_at >= %s AND parse_succeeded = 1
ORDER BY received_at DESC;
```
(where parameter is `now_utc - 24 hours`).
- Retrieves the latest state for each logger.
- Computes `loggers_now`, `current_power_w`, and `current_power_at` instantaneously.

---

## 6. Connection Management & Pooling

- Introduce a lightweight thread-safe connection pool in `wattloft.history._mysql` using `pymysql`.
- Set pool size to 5 connections with automatic reconnection and keepalive pings.
- Eliminates TCP handshake and TLS/auth negotiation latency between the Python app and MySQL HeatWave on every sample and request.

---

## 7. Dump & Restore Updates

- `dump_history`: Updated to dump `day_summaries` alongside `samples`.
- `restore_history`: Handles both schema definitions and re-populates both tables.
- `history-dump.sh`: Continues backing up the database to OCI Object Storage with zero interruption.

---

## 8. Verification & Test Plan

1. **Equivalence Tests:**
   - Run the snapshot builder against all historical test fixtures (e.g. `test_plant_two_loggers.py`, `test_local_day_production.py`, `test_loggers_now.py`) and verify bit-for-bit equivalence in output JSON.
2. **Migration & Backfill Tests:**
   - Seed `samples` with test rows without `day_summaries`.
   - Run `ensure_history` and assert that `day_summaries` accurately mirrors expected endpoints and peak values.
3. **Performance Benchmark:**
   - Synthetic benchmark test populating 365 days of data (~350,000 samples).
   - Verify `plant_snapshot` runtime is $< 25\text{ms}$ and process memory overhead is $< 50\text{MB}$.
4. **End-to-End Vitest & Pytest Suite:**
   - Ensure all 119 frontend Vitest tests and all unit Pytest tests pass cleanly.
