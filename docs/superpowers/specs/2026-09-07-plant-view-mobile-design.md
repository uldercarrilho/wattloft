# Plant view mobile glance and chart snaps

Wattloft still observes one household Plant. This spec adds a **layout fork**: a narrow viewport gets a mobile Plant surface (sun glance, then horizontal chart snaps). Desktop Plant view (KPIs, grain nav, chart) stays. Login, empty History, Azulejo, Overlay/Stack, and ingest stay. Theoretical max production and a broader icon language remain later specs.

## Goal

- Below `60rem`, the populated Plant surface is five full-viewport pages, swiped **horizontally**: glance → Power → Day → Month → Year.
- The glance is Plant-now: the sun’s watts are the sum of fresh Logger Power from `loggers_now`, Logger rings for cadence, Today so far, quieter Lifetime energy, Last sample, and a stall banner when production sense says so.
- Chart snaps keep today’s `PlantChart`, period stepper, Each/By Logger, chips, and readout. The grain segmented control is gone on the phone; labeled tabs Glance / Power / Day / Month / Year *are* the grain switcher.
- At `60rem` and above, Plant view is unchanged.
- One hostname, one session, one `/api/plant`. Snapshot grows `loggers_now` so the glance is not inferred from the selected-day curve.

## Non-goals

- Redesigning desktop Plant view, login, empty History, or 502 copy.
- A second hostname, `/m` route, or user-agent sniffing.
- Theoretical max, nameplate, expected curves, or a solar-ephemeris dusk table.
- A new Azulejo palette or a new chart library.
- Admit-list editing.
- Persisting Logger toggles or putting Overlay/Stack in the URL.
- Changing how Today energy, Current Power, or Lifetime energy are *computed* — only adding per-Logger now rows and a new presentation.

## Architecture

```
Operator  --HTTPS-->  plant-view
                        matchMedia (60rem)
                          ├─ < 60rem:  PlantMobile (pager: Glance | PlantChart snaps)
                          │              glanceModel(loggers_now, Plant KPIs, now)
                          └─ ≥ 60rem:  Plant (today’s KPIs, grain nav, chart)
                        |
                        +-- GET /api/plant --> BFF --> GET /snapshot
                                                        History (+ loggers_now)
```

- **`wattloft` (Python)**: additive snapshot field `loggers_now`. Ingest unchanged. Plant KPIs unchanged.
- **`plant-view`**: `matchMedia('(min-width: 60rem)')` chooses the shell. Shared: fetch, session, `PlantChart`, `plantChartModel`, `chartMode`, stepper math, Azulejo tokens. New: mobile pager, glance drawing, `glanceModel`. BFF remains a JSON pass-through.
- **Caddy / Operator password / passkey**: unchanged.

No new ADR. The fork is reversible presentation. `loggers_now` is the same class of additive JSON as Local-day `loggers`.

Resize or rotate across `60rem` swaps the shell live without a new login. A 502 while a Plant payload is already on screen keeps that payload (same as today).

## URL

`day` and `unit` stay the query. Overlay/Stack stays in `localStorage`.

On a **narrow** viewport, the pager key is the **raw** `unit` query, not `parseUnit` (missing `unit` must not become Power):

| Query | Mobile page |
| --- | --- |
| no `unit` | Glance |
| `unit=time` | Power |
| `unit=day` | Day |
| `unit=month` | Month |
| `unit=year` | Year |
| any other `unit` | Glance (treat as absent) |

Swiping a page `pushState`s the same way grain links do today, so Back steps through snaps. Glance URL **preserves** `day` when present and **omits** `unit`. Opening `/?unit=day` on a phone skips the glance and lands on Day.

On a **wide** viewport, missing `unit` remains Power, as today. A phone `/` opened on a laptop is desktop Plant view, not the sun. `/?unit=month` is Month on both.

The glance is always Plant-now. It does not follow `day`. Chart snaps share `day` and the stepper; stepping ‹ › on Power changes Day/Month/Year too. Swiping back to the glance does not clear `day`.

Fetch: when the URL has no `unit`, the client may still request `/api/plant` with `unit=time` so the payload is ready for the Power snap. The shell must key off the URL, not `payload.unit`.

## Glance

First full-screen page. Header **Plant** and log out, same as desktop. No chart, stepper, or Each/By Logger.

- **Sun (inner glow):** Plant-now watts. When `loggers_now` is present and non-empty, center copy is the sum of `power_w` for **closed** rings (`last_success_at` within 15 minutes), `formatWatts`, or `—` if no ring is closed. When `loggers_now` is missing or empty, center copy is Current Power (or `—` if Current Power is absent). Fill tracks that number. It is not a gauge against nameplate (Wattloft has none). Watts sit in the sun core.
- **Rings:** one per `loggers_now` row, serial order, colors `--logger-a` / `--logger-b` (same as charts). Legend uses snapshot display names plus that Logger’s watts. Completeness is **cadence**, not that Logger’s share of watts: **closed** iff `last_success_at` is within **15 minutes** of local now (full circumference). Open (short arc, dimmed) otherwise.
- **Today so far** under the sun (secondary). **Lifetime energy** a quieter caption under that (`lifetimeKwh` as today). **Last sample** is the relative age of Plant `current_power_at`, ticking, as today.
- **Labeled tabs** at the bottom: Glance / Power / Day / Month / Year. The current tab is pigment. Tabs are **controls** (not decoration): activating one goes to that snap, so the pager is not swipe-only. Horizontal swipe still changes page except when it starts on the chart, stepper, mode bar, chips, or readout. Honor `prefers-reduced-motion` (no slide).
- **Landscape** (`max-height: 31.25rem`): glance is a row — sun `min(40dvh, 16rem)`, captions to the right, pager stays pinned. Portrait stack is unchanged.

## Health

A pure `glanceModel` (no DOM) maps `loggers_now` + Plant KPIs + now (`America/Sao_Paulo`) to disc watts, ring open/closed, banner or none, hollow vs filled glow, captions.

A failed parse is not a Sample and never becomes 0 W. A missing Logger is omitted from Plant Power, not coerced to 0 W. Night-time 0 W with a successful parse is valid.

**Banner** iff at least one Logger has `power_w` > 0 and a closed ring **and** another is **stale** (ring open) **or** has `power_w` == 0 with a closed ring (and this is not a valid night zero). Copy uses display names and relative age: `West silent · last Sample 41 min ago`. Several silent Loggers: one banner, names joined with commas, age of the stalest. The sun **stays pigment**; center watts stay the closed-ring sum (do not re-sum for the banner). Desktop Current Power is unchanged.

**Night zero (hollow sun, no banner):** every Logger in `loggers_now` is fresh **and** the closed-ring sum is 0 W. Glow empties; rings stay closed. No civil dusk table.

**Whole Plant stale:** every `loggers_now` ring is open (or `loggers_now` is missing/empty). No stall banner. Center is `—` when every ring is open; if `loggers_now` is missing/empty, center still shows Current Power and Last sample age (may be hours), or `—` if Current Power is absent. Hollow glow if watts are 0 or absent.

**Daytime 0 W, sibling producing, both fresh:** rings stay closed (cadence is fine). Banner still shows for the 0 W Logger. That is production sense, not cadence.

## Chart snaps

Each grain is one full-viewport page: labeled tab (Power / Day / Month / Year), period stepper, `PlantChart`, pointer readout, series chips, Each / By Logger. Same Overlay/Stack semantics and `localStorage` key as desktop. The sun does not ride along. Vertical scroll is only for overflow, not for changing page.

Login, empty History (“This Plant has no History yet.”), and 502 (“Plant view cannot reach History.”) stay current Azulejo pages on every viewport. They are not pager pages and they do not show a sun. After login on a phone, land on the glance (`/` with no `unit`).

## Snapshot

`GET /snapshot` path, existing fields, and curve JSON stay. The object gains `loggers_now`:

```json
{
  "loggers_now": [
    {
      "name": "3909309465",
      "display_name": "East",
      "last_success_at": "2026-09-07T16:03:00+00:00",
      "power_w": 210.0
    },
    {
      "name": "3909310155",
      "display_name": "West",
      "last_success_at": "2026-09-07T16:03:00+00:00",
      "power_w": 202.0
    }
  ]
}
```

Rules:

- One row per Admitted Logger that has a successful Sample in History. `name` is the logger serial, sorted the same way as Time Logger series (locale compare).
- `display_name` is the same display name the curve already ships (config). If missing, Plant view falls back the same way as charts.
- `last_success_at` is that Logger’s last successful Sample receive time (not the selected-day curve, not an in-frame clock).
- `power_w` is AC Power from that Sample. **0 W is kept.** A Sample with no Power does not count as 0 W: walk back to that Logger’s last successful Power. A trailing zero does not wipe an earlier successful Power **unless** that zero is itself a successful Power (night 0 is real).
- A Logger with no successful Sample in History is **omitted**, not a row of zeros.
- Plant `current_power_w` / `current_power_at` stay Plant aggregates as today. Desktop Current Power uses those fields. The glance hero is the sum of closed `loggers_now` watts when that list is present and non-empty.

If `loggers_now` is missing (older Python during deploy): draw the sun from Plant KPIs only; rings omitted; **never invent a stall banner**.

Desktop ignores `loggers_now`. BFF `/api/plant` does not reshape it.

## Errors and empty states

- Login, empty History, 502: unchanged copy and layout; no pager, no sun.
- Current Power absent on a populated snapshot: center `—`, hollow disc, rings from `loggers_now` if present.
- `localStorage` Overlay/Stack: same as desktop.
- Narrow fetch failure: same as desktop (keep last Plant payload if any).

## Tests

**Python (`wattloft.history` / snapshot JSON)**

- Two-Logger now: `loggers_now` has both serials, `last_success_at` is each Logger’s last successful receive time, `power_w` matches that Sample (including 0 W).
- Logger with no successful Sample is absent.
- Trailing zero Lifetime still does not wipe Plant Lifetime; 0 W Power on a successful Sample appears as `power_w` 0.
- Existing Plant totals and curve series stay.

**`plant-view` (Vitest + Testing Library)**

- `glanceModel`: healthy midday (filled sun, closed rings, no banner); West stale while East produces (banner, West ring open, sun stays pigment); West 0 W fresh while East produces (banner, rings closed); both fresh 0 W (hollow, no banner); all stale (no banner); missing `loggers_now` (no invented stall).
- Mobile shell: no `unit` → glance; `unit=day` → Day snap; changing page updates `unit`; `day` survives returning to glance; wide viewport still shows desktop grain nav and no sun.
- Desktop: existing Plant tests still pass; `loggers_now` does not change KPIs or charts.
- Empty History and 502 copy unchanged; pager absent there.

## CONTEXT.md

Implementation updates the **Plant view** paragraph: below `60rem` the Operator sees the glance (sun watts as the sum of fresh `loggers_now`, rings, stall banner, Today, Lifetime, Last sample) then Power / Day / Month / Year as horizontal snaps with labeled tabs; at `60rem` and above the current KPI + grain + chart surface stays, including Current Power as the last successful Plant Power Sample. Do not call the glance a dashboard. Cadence on the glance is Last sample plus per-Logger ring/banner from `loggers_now`, not a new domain noun.

## Out of scope (later specs)

1. Cadence as a first-class **desktop** surface (desktop keeps today’s four KPIs).
2. Theoretical max vs actual.
3. Broader graphical language beyond the sun, rings, and stall banner.
4. Astronomical dusk / dawn or a clock-window definition of night.
