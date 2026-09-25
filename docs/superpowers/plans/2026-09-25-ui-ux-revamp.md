# Wattloft UI/UX Revamp ("Azulejo Moderno") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Wattloft client (`plant-view`) with the "Azulejo Moderno" visual design system (Porcelain Day and Obsidian Midnight themes), a thumb-friendly 4-tab mobile bottom dock (`Glance`, `Power`, `History`, `Insights`), prominent solar passive diagnostics (clear-sky envelope, East/West balance ratio, inverter AC clipping), and flicker-free real-time SSE updates.

**Architecture:** Deconstruct monolithic view containers (`App.tsx`, `PlantMobile.tsx`, `plantChrome.tsx`) into modular desktop and mobile components with dedicated feature directories (`components/desktop/`, `components/mobile/`, `components/`). Isolate theme state in `useTheme`, diagnostics logic in `diagnosticsModel`, and 4-tab navigation in `mobilePage`. Ensure WCAG 2.1 AA compliance with minimum 48px touch targets, high contrast tokens, and semantic ARIA tab structures.

**Tech Stack:** React 19, TypeScript, Chart.js 4.5, Vitest, React Testing Library, CSS Custom Properties.

**Spec:** [2026-09-24-ui-ux-revamp-design.md](file:///c:/Users/ulder/GitHub/wattloft/docs/superpowers/specs/2026-09-24-ui-ux-revamp-design.md)

## Global Constraints

- Stylings must strictly use CSS custom properties defined on `:root` and overridden via `[data-theme="dark"]`.
- Desktop view breakpoint is strictly `60rem` (`960px`) managed by `useWideViewport`.
- Real-time SSE updates from `/api/plant/stream` must mutate state without re-mounting canvas or inducing layout reflow.
- Fixed-width typography (`IBM Plex Mono` with `font-variant-numeric: tabular-nums;`) must be used for all telemetry figures.
- Touch targets across all mobile buttons, bottom tabs, stepper links, and series badges must be $\ge 48 \times 48\text{px}$.
- No third-party weather APIs or external cloud sensors; all passive diagnostics run offline in-process.

## Review Focus

1. **Midday solar transition with zero data / missing loggers**: when a logger drops off or provides 0 watts during midday, `MobileGlanceTab` and `StallBanner` must display the stall alert without crashing or miscomputing total plant power.
2. **Missing or null diagnostics data**: `clipping` or `drift` or `ideal_curve` can be `null`, `undefined`, or empty on older history dates or newly commissioned systems; `DiagnosticsPanel` and `MobileInsightsTab` must gracefully display neutral fallback states without throwing errors.
3. **High-frequency SSE updates during touch scrubbing**: live SSE `sample` events arriving while the operator is scrubbing or interacting with the canvas must not reset or snap the crosshair / tooltip away from under the operator's finger.
4. **Theme preference mismatch / OS theme change**: system color scheme changes when user hasn't explicitly set localStorage preference should dynamically update the theme; if user has explicit preference, localStorage must override system preference.
5. **Deep-linking to specific grain/date on mobile**: visiting `/?day=2026-08-21&unit=month` directly on mobile should land on `History` tab with `Month` grain active and date `2026-08-21` preserved, rather than resetting to `glance` or `day`.

---

## File Structure

```
plant-view/src/
├── useTheme.ts                         # [NEW] Theme hook with localStorage & prefers-color-scheme
├── useTheme.test.ts                    # [NEW] Unit tests for theme initialization & toggling
├── diagnosticsModel.ts                 # [NEW] Pure calculation functions for solar diagnostics
├── diagnosticsModel.test.ts            # [NEW] Unit tests for balance ratio, clipping & efficiency
├── mobilePage.ts                       # [MODIFY] 4-tab model (glance, power, history, insights)
├── mobilePage.test.ts                  # [MODIFY] Tests for 4-tab navigation & grain preservation
├── styles.css                          # [MODIFY] Azulejo Moderno tokens, dark mode, cards, dock
├── plantChrome.tsx                     # [MODIFY] Header with theme toggle, LiveStatusBadge
├── PlantChart.tsx                      # [MODIFY] Theme-aware colors & crosshair scrubbing
├── PlantMobile.tsx                     # [MODIFY] Delegate to MobilePlantView
├── App.tsx                             # [MODIFY] Integration of theme provider & views
├── App.test.tsx                        # [MODIFY] Integration tests for revamp
├── components/
│   ├── KpiCard.tsx                     # [NEW] Reusable ceramic tile KPI card
│   ├── KpiCard.test.tsx                # [NEW] Unit tests for KpiCard
│   ├── LiveStatusBadge.tsx             # [NEW] SSE connection pulse badge
│   ├── LiveStatusBadge.test.tsx        # [NEW] Unit tests for LiveStatusBadge
│   ├── SeriesToggleChips.tsx           # [NEW] Series visibility toggles (Plant, East, West)
│   ├── SeriesToggleChips.test.tsx      # [NEW] Unit tests for series toggles
│   ├── StallBanner.tsx                 # [NEW] Midday stall alert banner
│   ├── StallBanner.test.tsx            # [NEW] Unit tests for StallBanner
│   ├── OfflineBanner.tsx               # [NEW] Offline cached telemetry notice
│   ├── OfflineBanner.test.tsx          # [NEW] Unit tests for OfflineBanner
│   ├── desktop/
│   │   ├── DesktopPlantView.tsx        # [NEW] Wide viewport dashboard container
│   │   ├── DesktopPlantView.test.tsx   # [NEW] Integration test for desktop layout
│   │   ├── ChartControls.tsx           # [NEW] Stepper, grain switcher, mode pills
│   │   ├── ChartControls.test.tsx      # [NEW] Unit tests for chart controls
│   │   ├── DiagnosticsPanel.tsx        # [NEW] ADR 0032 solar intelligence drawer
│   │   └── DiagnosticsPanel.test.tsx   # [NEW] Unit tests for diagnostics drawer
│   └── mobile/
│       ├── MobilePlantView.tsx         # [NEW] Mobile PWA shell with bottom dock
│       ├── MobilePlantView.test.tsx    # [NEW] Integration test for mobile view
│       ├── MobileTabBar.tsx            # [NEW] 4-tab bottom navigation dock
│       ├── MobileTabBar.test.tsx       # [NEW] Unit tests for MobileTabBar
│       ├── MobileGlanceTab.tsx         # [NEW] Hero card + logger status rows
│       ├── MobilePowerTab.tsx          # [NEW] Diurnal power curve view with scrubbing
│       ├── MobileHistoryTab.tsx        # [NEW] Historical Day/Month/Year bars + stepper
│       └── MobileInsightsTab.tsx       # [NEW] String balance & clipping diagnostics
```

---

### Task 1: CSS Design Tokens & Theming Hook

**Files:**
- Create: `plant-view/src/useTheme.ts`
- Create: `plant-view/src/useTheme.test.ts`
- Modify: `plant-view/src/styles.css:1-60`

**Interfaces:**
- Produces: `useTheme(): { theme: "light" | "dark", toggleTheme: () => void, setTheme: (t: "light" | "dark") => void }`
- Produces: CSS custom properties: `--paper`, `--surface`, `--surface-border`, `--surface-hover`, `--ink`, `--muted`, `--pigment`, `--on-pigment`, `--logger-a`, `--logger-b`, `--solar-arc`, `--status-live`, `--status-warn`, `--status-error` for both `:root` and `[data-theme="dark"]`.

- [ ] **Step 1: Write the failing test for useTheme**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement useTheme and update styles.css**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 2: Telemetry & Status Badges (LiveStatusBadge, OfflineBanner, StallBanner)

**Files:**
- Create: `plant-view/src/components/LiveStatusBadge.tsx`
- Create: `plant-view/src/components/LiveStatusBadge.test.tsx`
- Create: `plant-view/src/components/OfflineBanner.tsx`
- Create: `plant-view/src/components/OfflineBanner.test.tsx`
- Create: `plant-view/src/components/StallBanner.tsx`
- Create: `plant-view/src/components/StallBanner.test.tsx`
- Modify: `plant-view/src/styles.css`

**Interfaces:**
- Produces: `<LiveStatusBadge status="live" | "reconnecting" | "polling" | "offline" />`
- Produces: `<OfflineBanner at?: string />`
- Produces: `<StallBanner message: string />`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement components and add CSS**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

### Task 3: Solar Diagnostics Model & Analytics Logic (ADR 0032)

**Files:**
- Create: `plant-view/src/diagnosticsModel.ts`
- Create: `plant-view/src/diagnosticsModel.test.ts`

**Interfaces:**
- Produces: `computeSolarEnvelopeMetrics(snapshot: PlantSnapshot)`
- Produces: `computeArrayBalance(snapshot: PlantSnapshot)`
- Produces: `computeClippingSummary(snapshot: PlantSnapshot)`

- [ ] **Step 1: Write failing unit tests for diagnosticsModel**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement diagnosticsModel.ts**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 4: Modular UI Building Blocks (KpiCard & SeriesToggleChips)

**Files:**
- Create: `plant-view/src/components/KpiCard.tsx`
- Create: `plant-view/src/components/KpiCard.test.tsx`
- Create: `plant-view/src/components/SeriesToggleChips.tsx`
- Create: `plant-view/src/components/SeriesToggleChips.test.tsx`
- Modify: `plant-view/src/styles.css`

**Interfaces:**
- Produces: `<KpiCard title value subtitle? status? />`
- Produces: `<SeriesToggleChips snapshot names hidden onToggle />`

- [ ] **Step 1: Write failing tests for KpiCard and SeriesToggleChips**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement components and add CSS**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

### Task 5: Mobile Navigation & 4-Tab Dock Model

**Files:**
- Modify: `plant-view/src/mobilePage.ts`
- Modify: `plant-view/src/mobilePage.test.ts`

**Interfaces:**
- Produces: `MOBILE_TABS = ["glance", "power", "history", "insights"] as const`
- Produces: `type MobileTab = (typeof MOBILE_TABS)[number]`
- Produces: `mobileTabOf(search: string): { tab: MobileTab, grain: Grain }`
- Produces: `mobileTabHref(day: string, tab: MobileTab, grain?: Grain): string`

- [ ] **Step 1: Write failing tests for 4-tab mobile navigation**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement 4-tab logic in mobilePage.ts**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 6: Mobile Screen Components & 4-Tab Bottom Dock

**Files:**
- Create: `plant-view/src/components/mobile/MobileTabBar.tsx`
- Create: `plant-view/src/components/mobile/MobileTabBar.test.tsx`
- Create: `plant-view/src/components/mobile/MobileGlanceTab.tsx`
- Create: `plant-view/src/components/mobile/MobilePowerTab.tsx`
- Create: `plant-view/src/components/mobile/MobileHistoryTab.tsx`
- Create: `plant-view/src/components/mobile/MobileInsightsTab.tsx`
- Create: `plant-view/src/components/mobile/MobilePlantView.tsx`
- Create: `plant-view/src/components/mobile/MobilePlantView.test.tsx`
- Modify: `plant-view/src/styles.css`

**Interfaces:**
- Produces: `<MobileTabBar activeTab onSelectTab selectedDay activeGrain />`
- Produces: `<MobilePlantView payload busy offline? />`

- [ ] **Step 1: Write failing tests for MobileTabBar and MobilePlantView**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement MobileTabBar and the 4 Tab Views**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

### Task 7: Desktop Command Dashboard (ChartControls, DiagnosticsPanel, DesktopPlantView)

**Files:**
- Create: `plant-view/src/components/desktop/ChartControls.tsx`
- Create: `plant-view/src/components/desktop/ChartControls.test.tsx`
- Create: `plant-view/src/components/desktop/DiagnosticsPanel.tsx`
- Create: `plant-view/src/components/desktop/DiagnosticsPanel.test.tsx`
- Create: `plant-view/src/components/desktop/DesktopPlantView.tsx`
- Create: `plant-view/src/components/desktop/DesktopPlantView.test.tsx`
- Modify: `plant-view/src/styles.css`

**Interfaces:**
- Produces: `<ChartControls period unit mode idealEnvelope onChooseMode onToggleIdealEnvelope />`
- Produces: `<DiagnosticsPanel snapshot />`
- Produces: `<DesktopPlantView payload busy offline? />`

- [ ] **Step 1: Write failing tests for desktop dashboard components**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement desktop components**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

### Task 8: Header & Chart Theme-Aware Canvas Enhancements

**Files:**
- Modify: `plant-view/src/plantChrome.tsx`
- Modify: `plant-view/src/PlantChart.tsx`
- Modify: `plant-view/src/PlantChart.test.tsx`

**Interfaces:**
- Produces: `PlantHeader` with theme toggle button (Sun/Moon), `LiveStatusBadge`, and Passkey/Logout
- Produces: `PlantChart` with live crosshair scrubbing and theme-reactive palette updates

- [ ] **Step 1: Write failing tests for theme toggle in PlantHeader**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Update PlantHeader and PlantChart**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

---

### Task 9: App Shell Integration & Live SSE State Wiring

**Files:**
- Modify: `plant-view/src/App.tsx`
- Modify: `plant-view/src/PlantMobile.tsx`
- Modify: `plant-view/src/App.test.tsx`

**Interfaces:**
- Produces: `App` rendering `DesktopPlantView` on $\ge 60\text{rem}$ and `MobilePlantView` on $< 60\text{rem}$
- Produces: Synchronized connection status passed to `PlantHeader`

- [ ] **Step 1: Write integration tests in App.test.tsx**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Update App.tsx and PlantMobile.tsx**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 10: Full Test Suite Regression & End-to-End Build Verification

**Files:**
- Modify: `plant-view/src/App.test.tsx` (if needed for any regression fixes)
- Run: `npm test` and `npm run typecheck` and `npm run build`

- [ ] **Step 1: Run complete vitest test suite**
- [ ] **Step 2: Run typescript typecheck**
- [ ] **Step 3: Run production build**
- [ ] **Step 4: Commit any final cleanup**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-25-ui-ux-revamp.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.

For this plan I recommend **Subagent-driven**, because the tasks span distinct modular components (CSS tokens, pure diagnostics math, mobile tabs, desktop layouts, and Chart.js integration), and independent task verification prevents layout regressions across breakpoints. Does the plan capture what you want, and which approach should we use?
