# Glance: Plant + loggers

Wattloft still observes one household Plant. This spec **replaces only the mobile glance drawing** from [2026-09-07-plant-view-mobile-design.md](2026-09-07-plant-view-mobile-design.md). The pager, tabs, chart snaps, snapshot `loggers_now`, desktop Plant view, login, empty History, and 502 stay. The sun, rings, hollow core, and “East and West reporting” line go away.

The Operator already used a plant-plus-device list on Solarman / Intelbras Solar. Glance becomes that: Plant-now, then one row per Logger.

## Goal

- Below `60rem`, Glance is Plant-now as a labeled number, Today so far and Lifetime energy as quieter captions, and a **Loggers** list.
- Each Logger row makes cadence and production separate facts: **reporting** vs **silent** is last successful Sample within 15 minutes; watts on that row are that Logger’s last Power, shown as now only when reporting.
- Stall banner copy **silent** is only for a Logger that is not reporting while a sibling still has Power.
- Plant-now math, `loggers_now`, Last sample, and chart snaps do not change.

## Non-goals

- Desktop Plant view, login, empty History, 502 copy, Azulejo palette, chart library.
- Energy-flow diagrams (home, grid, battery, consumption). Wattloft does not observe those.
- Nameplate, theoretical max, dusk table, live power hair on Glance (that stays the Power snap).
- Changing how Today energy, Current Power, Lifetime energy, or `loggers_now` are computed.
- New cadence nouns beyond reporting / silent as presentation of the existing 15-minute rule.

## Page stack

Header **Plant** and log out, same as desktop. No chart, stepper, or Each/By Logger.

Portrait, top to bottom:

1. **Stall banner** — only when the model sends one. Role `status`. Copy unchanged for the stale case: `West silent · last Sample 41 min ago`. Several silent Loggers: names joined with commas, age of the stalest.
2. **Plant now** — label `Plant now`. Number is `formatWatts` of the sum of `power_w` for Loggers whose `last_success_at` is within 15 minutes of local now, or `—` if none are reporting. When `loggers_now` is missing or empty, the number is Current Power (or `—` if Current Power is absent). Under the number: `as of` Last sample (relative age of Plant `current_power_at`, ticking), same clock as desktop. Omit `as of` when `current_power_at` is absent.
3. **Today so far** and **Lifetime energy** — side by side, quieter than watts. Same formatters as today (`formatKwh`, `lifetimeKwh`).
4. **Loggers** — one row per `loggers_now` entry, serial order, `--logger-a` / `--logger-b` ticks (same as charts). Display names from the snapshot. Omit the whole list when `loggers_now` is missing or empty; never invent rows.

Labeled tabs Glance / Power / Day / Month / Year stay the grain switcher. Swipe rules stay.

Dropped: sun SVG, rings, hollow/glow, duplicate watts under the disc, `reportingLabel` (“East and West reporting”).

## Logger row

Cadence is the 15-minute rule that used to close a ring. Production is `power_w` from that row.

| State | Watts on the row | Cadence line |
| --- | --- | --- |
| Reporting (`last_success_at` within 15 minutes) | `formatWatts(power_w)` — this is now | `reporting · {relative age}` |
| Silent (older than 15 minutes) | `last {formatWatts(power_w)}` — not now | `silent · last Sample {relative age}` |

A failed parse is not a Sample and never becomes 0 W. A Logger with no successful Sample in History is omitted, not a row of zeros. Night-time 0 W with a successful parse is valid: the row shows `0 W` and `reporting`.

## Health

`glanceModel` (still DOM-free) maps `loggers_now` + Plant KPIs + now (`America/Sao_Paulo`) to Plant-now watts, logger rows, banner or none, captions. It no longer returns `hollow`, `rings`, or `reportingLabel`. It returns `loggers`: name, display name, `reporting`, watts label, age label.

**Banner** iff at least one Logger is reporting with `power_w` > 0 **and** another is **not reporting**. Do **not** banner a reporting Logger at 0 W: the row already shows `0 W`. That is the one behavior change from 2026-09-07 (which bannered fresh 0 W while a sibling produced and called it silent).

**Night zero:** every Logger in `loggers_now` is reporting and the reporting sum is 0 W. Plant now `0 W`. No banner. No civil dusk table.

**Whole Plant stale:** every `loggers_now` row is silent, or `loggers_now` is missing/empty. No stall banner. Plant now is `—` when every row is silent; if `loggers_now` is missing/empty, Plant now is Current Power (may be hours old) or `—` if Current Power is absent.

**West silent, East producing:** banner, West row silent with `last` watts, Plant now is East only. Desktop Current Power is unchanged.

**West 0 W, East producing, both reporting:** no banner. West row `0 W` · `reporting`. Plant now is East only (0 W does not add).

## Landscape

`max-height: 31.25rem`: Glance is a row — Plant now + captions on the left, logger list on the right. A stall banner, when present, spans the full width above that row. Tabs stay pinned. Drop the sun `min(40dvh, 16rem)` rule.

## Errors and empty states

- Login, empty History (“This Plant has no History yet.”), 502 (“Plant view cannot reach History.”): unchanged Azulejo pages; no pager, no logger list.
- After login on a phone: Glance (`/` with no `unit`).
- 502 while a Plant payload is already on screen: keep that payload.
- Current Power absent on a populated snapshot: Plant now `—` if no Logger is reporting; rows still draw from `loggers_now` if present.
- Narrow fetch failure: same as desktop (keep last Plant payload if any).

## Tests

**`glanceModel`**

- Healthy midday: Plant now is the sum, both reporting, no banner.
- West stale while East produces: banner, West not reporting, Plant now East only, West watts labeled as last.
- West 0 W fresh while East produces: both reporting, **no** banner, Plant now East only.
- Both fresh 0 W: Plant now `0 W`, no banner.
- All stale: no banner, Plant now `—`.
- Missing `loggers_now`: empty list, no invented stall, Plant now from Current Power.
- Current Power absent and empty `loggers_now`: Plant now `—`.

**`Glance`**

- No sun / ring SVG.
- Shows Plant now, Today so far, Lifetime energy, Last sample, logger names.
- Reporting row shows watts without `last`; silent row prefixes `last`.
- Stall banner only when the view includes one.

**Shell / desktop**

- Mobile pager, `unit` / `day`, and desktop Plant tests stay. `loggers_now` still does not change desktop KPIs or charts.

## CONTEXT.md

Replace the below-`60rem` clause of **Plant view**. Cadence on the glance is Last sample plus per-Logger reporting/silent rows from `loggers_now` and a stall banner when a Logger is silent while another still has Power — not a new domain noun, and not rings.

Suggested sentence: Below `60rem`: a glance that is always Plant-now — watts are the sum of fresh `loggers_now` Power (reporting: that Logger’s last successful Sample within 15 minutes), falling back to Current Power when `loggers_now` is missing; one row per Logger (reporting shows Power as now; silent shows last Power as last); a stall banner when one Logger is silent while another still has Power; Today so far; Lifetime energy; Last sample — then Power, Day, Month, and Year as horizontal snaps…

_Avoid_ calling the glance a dashboard. Do not restore sun/rings language.

## Out of scope

1. Cadence as a first-class desktop surface.
2. Theoretical max vs actual.
3. Energy-flow or house diagrams.
4. Astronomical dusk / dawn.
5. Putting a Power-curve hair on Glance.
