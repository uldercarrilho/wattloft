# Plant view Overlay and Stack

Wattloft still observes one household Plant. This spec adds **production composition**: the Operator can draw the same KPIs, grains, and History as **Overlay** (today’s charts) or **Stack** (Loggers stacked; Plant is the height). Ingest, login, and Azulejo stay. Cadence health, theoretical max production, a chart library, and a broader icon language are later specs.

## Goal

- One chart mode for every grain, chosen in Plant view, remembered in this browser.
- **Overlay**: Time is the Power curve of each Logger and the Plant; Day, Month, and Year are Plant-total energy bars. This is today’s drawing and the default until the Operator switches.
- **Stack**: Time is a stacked area of curve watts (Loggers only). Day, Month, and Year are the same period list, each bar split by Logger. Plant is the stack height, not a series.
- History returns per-Logger energy on each Local-day bar so Month and Year can stack from the same payload. Time Stack uses curve series already in the snapshot.

## Non-goals

- Ingest cadence / lag as a first-class surface.
- Theoretical max production, nameplate, or expected curves (no such data in History).
- A chart library (uPlot, Chart.js, ECharts, visx, or similar).
- New KPIs, grains, copy for login / empty History / 502, or a new Azulejo palette.
- Mode in the URL, a per-grain remembered mode, or persisting Logger toggles.
- Changing how Today energy / production is *computed* — only how it is *returned* and *drawn*.
- Admit-list editing, extra Operator surfaces, or a second hostname.

## Architecture

```
Operator  --HTTPS-->  plant-view (mode switch, Overlay/Stack drawing, localStorage)
                          |
                          +-- GET /api/plant --> BFF --> GET /snapshot
                                                          |
                                                          History (same Samples;
                                                          local_day_bars grow loggers)
```

- **`wattloft` (Python)**: additive snapshot field `loggers` on each Local-day bar. Curve series unchanged. Ingest unchanged.
- **`plant-view` (React + BFF)**: Overlay | Stack control; Overlay renderers stay; Stack renderers added; BFF remains a JSON pass-through; TypeScript types gain `loggers`.
- **Caddy / session / password**: unchanged.

No new ADR. Overlay vs Stack is reversible drawing, not a hard-to-reverse store or process split.

## Chart mode

- Operator copy: **Overlay** and **Stack**. Internal values: `overlay` | `stack`.
- One mode for Time, Day, Month, and Year. Switching grain does not change mode.
- Control: a second segmented control, same Azulejo chrome as the grain switcher, **under** Time / Day / Month / Year and **above** the chart. Buttons, not links.
- Shown only on the populated Plant surface. Hidden on login, empty History, and “Plant view cannot reach History.”
- Stored in `localStorage` key `wattloft.chartMode`. Missing, unreadable, or any other value → Overlay. Write failures leave the in-memory mode as-is.
- Changing mode redraws only. It does not refetch `/api/plant`. Reload keeps the stored mode. Query `day` and `unit` stay the URL; mode is never a query parameter.

KPIs (Today energy, Current Power, Lifetime energy, Last sample) always show snapshot Plant figures. Logger toggles never change KPIs.

## Snapshot

`GET /snapshot` path, existing fields, and curve JSON stay. Each `local_day_bars` element gains `loggers`:

```json
{
  "local_day": "2026-08-21",
  "today_energy_kwh": 3.9,
  "loggers": [
    { "name": "3909309465", "today_energy_kwh": 2.1 },
    { "name": "3909310155", "today_energy_kwh": 1.8 }
  ]
}
```

Rules:

- `name` is the Logger serial, sorted the same way as Time Logger series (locale compare).
- `today_energy_kwh` on the bar is still Plant production for that Local day (same `_local_day_production` rules as today).
- Each Logger’s value uses those same rules for that serial only.
- The sum of `loggers[].today_energy_kwh` equals the bar’s `today_energy_kwh`.
- A Logger with no successful energy that Local day is **omitted**, not `0`.
- Month and Year Stack sum these day segments in `plant-view`. The snapshot does not add month or year objects.

Time Stack needs no new curve fields. Overlay ignores `loggers` and looks as it does today.

If `loggers` is missing or empty (older snapshot during deploy): Time Stack still stacks Logger curve series; Day / Month / Year Stack draws Overlay’s solid Plant-total bars. Never invent slices.

BFF `/api/plant` does not reshape the snapshot.

## Time, Stack

Same solar-hours window, hair, and readout as Overlay. Drawing is a stacked area of **curve watts**:

- Ordered Logger series only (exclude `name === "Plant"`). Colors stay `--logger-a` / `--logger-b` by that order.
- At each Local time, a visible Logger contributes curve watts or is omitted. Plant height is the sum of contributors. Never a 0 W slab for an omitted Logger.
- Gap rules stay ADR 0025: consecutive Samples ≤ 15 minutes interpolate linearly; a longer gap where Lifetime energy still rose (delta above 0.02 kWh and implied average watts at least max(20 W, 40% of the quieter endpoint Power)) is a smooth band; a longer gap where Lifetime barely moved omits that Logger (band breaks, stack drops). A failed parse does not close a gap.
- In Stack, Logger toggles are the sorted union of serials in `local_day_bars[].loggers` and Time curve series (excluding Plant). Same set on every grain. Hiding a Logger removes its band and the stack shrinks. Toggles are not persisted (they reset on remount, same as Overlay today).
- No Plant series and no Plant toggle.
- The Overlay Time hint still explains gaps. Stack Time keeps that hint (the same gap rules apply).
- Hair reports each visible Logger’s curve watts at that Local time, plus Plant as their sum. If a Logger is omitted then, that Logger dashes (same as Overlay) and Plant omits it.
- All Loggers toggled off: no bands, readout dashes (same idea as Overlay with every series off).
- Empty curve: “This Local day has no curve Samples.” in both modes.
- Overlay Time is unchanged: Plant + Logger polylines, current toggles, current hint.

## Day / Month / Year, Stack

The list stays: one row per period, same hrefs (click the row to move as today), `aria-current` unchanged on Month / Year.

- Label is the **visible** total for that row (`2026-08-21 3.90 kWh` format as today). With all Loggers visible, that equals the Plant total.
- Outer bar width still scales to the peak **visible** total in that grain, with today’s minimum width so a tiny period stays tappable.
- Inner segments split that width by each visible Logger’s share of **that row**. No per-segment minimum width.
- A Logger with no energy in that period is omitted from the row, not a 0 slice.
- Month rows sum Logger segments across Local days in that month of the stepper’s year. Year rows sum across History years the same way.
- In Stack, the same Logger toggles as Time appear on these grains. Hiding a Logger drops its segment everywhere; labels and outer widths recompute from visible Loggers.
- Overlay on these grains stays a solid Plant-total bar and has no toggles.

## Errors and empty states

- Login, empty History (“This Plant has no History yet.”), and 502 (“Plant view cannot reach History.”) unchanged. No mode switch.
- `localStorage` unavailable: behave as Overlay until a successful in-session switch; do not crash.

## Tests

**Python (`wattloft.history` / snapshot JSON)**

- Two-Logger Local day: `loggers` has both serials; values match per-Logger production; sum equals `today_energy_kwh`.
- Logger with no successful energy that day is absent from `loggers`.
- Existing Plant totals and curve series stay (no Overlay regression).

**`plant-view` (Vitest + Testing Library)**

- Types accept `loggers`.
- Month / Year Stack sums day `loggers` correctly.
- Default Overlay; after choosing Stack, reload still shows Stack.
- Time Stack has no Plant toggle; Logger toggle shrinks the stack.
- Day Stack renders segments; Overlay Day has no segments and no toggles.
- Missing `loggers` → energy Stack looks like Overlay bars.
- Empty History and 502 copy unchanged; mode switch absent there.

## Out of scope (later specs)

1. Ingest cadence / lag (Sample receive spacing, per-Logger Last sample).
2. Theoretical max vs actual.
3. Professional chart library replacing custom SVG / CSS.
4. Broader graphical language (icons, emoji) beyond Overlay / Stack drawing.
