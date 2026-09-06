# Plant view Chart.js plots

Wattloft still observes one household Plant. Overlay, Stack, grains, KPIs, curve watts, and Azulejo stay. This spec replaces custom Time SVG and Day/Month/Year CSS bars with **Chart.js** behind one Plant view module so the Operator gets professional axes, a real pointer, and one drawing stack. Cadence health, theoretical max production, and a broader icon language remain later specs.

## Goal

- One canvas for Time, Day, Month, and Year, Overlay and Stack.
- Chart.js draws series, axes, stacked area, stacked columns, crosshair, and column highlight. Wattloft still owns curve watts, period math, Overlay vs Stack meaning, chips, and the readout.
- Day, Month, and Year become vertical bar charts. Click a column to drill the same way today’s CSS list does.
- Time Overlay draws **curve watts** on the solar-minute grid (the line matches the hair). Raw Sample polylines and per-Sample dots go away.
- Own less drawing code: delete the custom SVG plots, `timeCurve.ts` hair, and CSS energy bars.

## Non-goals

- Ingest cadence / lag as a first-class surface.
- Theoretical max production, nameplate, or expected curves.
- New KPIs, grains, Overlay/Stack semantics, or a new Azulejo palette.
- Mode in the URL, a per-grain remembered mode, or persisting Logger toggles.
- Changing snapshot JSON, Python History, or the BFF.
- A Chart.js tooltip, a Chart.js legend, `react-chartjs-2`, ECharts, uPlot, or visx.
- A keyboard scrubber on the canvas.
- Admit-list editing, extra Operator surfaces, or a second hostname.

## Architecture

```
Operator  --HTTPS-->  plant-view
                        App (KPIs, stepper, grain, Overlay/Stack, chips, readout)
                          └─ PlantChart(snapshot, unit, mode, visible, onPointer, onBarNavigate)
                                ├─ plantChartModel   // domain → labels, series, nulls, hrefs
                                └─ Chart.js adapter  // canvas, axes, crosshair, clicks
                          |
                          +-- GET /api/plant --> BFF --> GET /snapshot (unchanged)
```

- **`wattloft` (Python)** and **BFF**: unchanged.
- **`plant-view`**: add `chart.js` (v4). Tree-shake: register only line, bar, filler, the scales we use, and the adapter’s crosshair. App, chips, readout, `curveWatts`, and `grains` do not import Chart.js.
- **`plantChartModel`**: snapshot + grain + mode + visible Loggers in; plot model out (X as solar minutes or period categories, datasets with `null` for omitted Loggers, energy hrefs). This is the test surface.
- **Chart.js adapter**: create a `Chart` on a canvas in `useEffect` (no React chart wrapper). Map Azulejo CSS variables onto options. Report pointer X / clicked category. Do not interpolate, sum Plant, or know Overlay vs Stack except as overlay vs stacked datasets already in the model.
- **Delete:** SVG in `curve.tsx` / `stackCurve.tsx`, `timeCurve.ts`, `EnergyList` bar markup, and CSS that styled those plots (`ol.days` bar chrome, `#curve` series strokes/fills). Keep solar-window helpers if the model still needs them (move next to the model; do not keep a second plotter).
- **Keep:** `curveWatts.ts`, `chartMode`, Azulejo chips, readout panel, stepper/grain nav, Time gap hint.

No new ADR. Chart.js is reversible drawing inside `plant-view`, same class as Overlay vs Stack.

Later specs may append a dataset to the model (cadence, expected curve). This spec does not add those series; it only keeps the model a list of datasets.

## Drawing

One canvas. Colors: Plant `--plant`, Loggers `--logger-a` / `--logger-b` in serial order. IBM Plex Mono ticks. No Chart.js legend, title, or tooltip.

**Time, Overlay.** Solar-hours X (same window as today). Y from 0 to the peak of **visible** series’ curve watts. Each visible Logger and the Plant (if its chip is on) is a line of curve watts sampled once per minute; `null` breaks the stroke (Lifetime-barely-moved valleys, ADR 0025). No per-Sample dots. Plant’s line is per-minute Plant curve watts: the sum of every Logger that has curve watts then, not the snapshot’s raw Plant polyline and not a restack of only visible Loggers. Hiding a Logger hides that Logger’s line only.

**Time, Stack.** Same window. Y peak is the stacked visible sum. Ordered Logger **areas** only (no Plant series). A Logger omitted at a minute is `null` so the stack drops; never a 0 W slab.

**Day / Month / Year, Overlay.** Vertical columns, one per period `grains.ts` already lists. Y is kWh from 0 to the peak Plant total in that grain. One Plant series, pigment fill. Every period gets an equal category slot; height encodes kWh (no CSS min-width). Current period is emphasized with an ink stroke (the `aria-current` equivalent). Category labels stay compact (day-of-month, `YYYY-MM`, year).

**Day / Month / Year, Stack.** Same categories. Y peak is the peak **visible** total. Stacked columns by Logger; an omitted Logger has no slice. Plant is height, not a series. Missing or empty `loggers` on the snapshot still draws Overlay’s solid Plant columns.

**Empty Time** is still “This Local day has no curve Samples.” — no canvas. Login, empty History, and 502 never construct a `Chart`.

## Pointer, readout, click-to-drill

Chart.js owns hit-testing. The readout panel stays Wattloft (IBM Plex Mono, same kind of copy as today). No floating tooltip. The adapter implements the Time crosshair (vertical line) and energy column highlight; it does not take a third-party tooltip plugin.

**Time.** Crosshair parked at 12:00, clamped to the solar window. Pointer down/move on the canvas (including touch; `touch-action: none`) maps X to a Local minute. Readout shows `HH:MM` and each **visible chip**’s curve watts. Overlay: Plant’s number is Plant curve watts at that minute (sum of Loggers that have curve watts then, including Loggers whose chips are off). Stack: Plant’s number is the sum of **visible** Loggers only; there is no Plant chip. A Logger omitted then dashes (`—`); that Overlay Plant sum omits it; that Stack Plant sum omits it. All Logger chips off: no series drawn; readout dashes. Toggling a chip redraws datasets; it does not refetch.

**Energy grains.** Hover/press highlights the nearest column. Readout shows that period’s label and the visible total (Overlay: Plant kWh; Stack: visible total plus per-Logger kWh). No vertical hair.

**Click / tap a column** navigates with the same `href()` helpers as today’s list: Day → Time that Local day, Month → Day of that month, Year → Month of that year. `pushState`, no full reload. The current period stays highlighted after navigation. Time is not a navigator.

**Chips.** Overlay Time: Plant and Logger chips (as today). Stack: Logger chips shared across every grain (as today). Overlay energy: no series control. No library legend.

**Keyboard.** Chips, Overlay/Stack, and grain/stepper stay the keyboard path. Canvas is `role="img"` with `aria-label` “Power curve” (Time) or “Energy bars” (Day/Month/Year). Readout is `aria-live="polite"`. No Chart.js keyboard scrubber.

**Hint** under Time is unchanged. Energy grains have no hint.

## Errors

If Chart.js fails to init or resize, KPIs, stepper, chips, and mode stay. The plot slot shows “Plant view cannot draw this chart.” and does not retry in a loop. Pointer outside the plot leaves the last readout. `localStorage` chart mode is unchanged.

## Tests

**`plantChartModel` (Vitest)**

- Time Overlay: Logger and Plant lines are curve watts; `null` on a Lifetime-barely-moved gap; hidden Logger absent from datasets; Plant line still present.
- Time Stack: no Plant dataset; hidden Logger shrinks the stack; omitted minute is `null`, not `0`.
- Energy Overlay: one Plant series; categories and hrefs match `grains.ts`.
- Energy Stack: segments match visible Loggers; missing `loggers` → solid Plant columns.
- Y peak uses visible series only (Stack energy and Time Stack).

**`curveWatts` / `grains` / `chartMode`:** existing tests stay.

**App (Testing Library)**

- Empty History and 502: no canvas; mode switch absent.
- Empty Time copy; no `Chart` constructed.
- Overlay vs Stack chips unchanged.
- Adapter `onBarNavigate` with the model’s href still moves Day → Time (and Month/Year the same way).
- Draw-failure copy when the adapter reports init failure.

Do not assert canvas pixels or Chart.js internals.

## Out of scope (later specs)

1. Ingest cadence / lag (Sample receive spacing, per-Logger Last sample).
2. Theoretical max vs actual (may append a dataset to this model).
3. Broader graphical language (icons, emoji) beyond Overlay / Stack drawing.
