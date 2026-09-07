# Mobile Plant view implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below `60rem`, the populated Plant surface is a horizontal pager (sun glance, then Power / Day / Month / Year snaps); at `60rem` and above, today’s Plant view is unchanged.

**Architecture:** Python `build_plant_snapshot` adds `loggers_now` (last successful Sample per Logger). BFF stays pass-through. React `matchMedia('(min-width: 60rem)')` chooses `Plant` vs `PlantMobile`. Glance drawing is driven by a DOM-free `glanceModel`. Chart snaps reuse existing `Chart` / stepper / Each-By Logger.

**Tech stack:** Existing Python 3.12 snapshot + Starlette `GET /snapshot`; plant-view React, Vitest, Testing Library, Chart.js. No new libraries, no new ADR, no `/m` route.

**Spec:** [`docs/superpowers/specs/2026-09-07-plant-view-mobile-design.md`](../specs/2026-09-07-plant-view-mobile-design.md)

See the approved Cursor plan for task steps, file map, and verification commands.
