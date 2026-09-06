# Overlay and Stack implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Operator switch Overlay (today’s charts) and Stack (Loggers stacked; Plant is the height) on every grain, with History exposing per-Logger energy on Local-day bars.

**Architecture:** Python snapshot stays additive: each `local_day_bars` row gains `loggers`. The BFF still pass-throughs JSON. React owns chart mode (`localStorage` key `wattloft.chartMode`), Stack energy lists, and a new Time stacked-area drawing that reuses extracted curve-watts interpolation. Overlay renderers stay.

**Tech stack:** Existing Python 3.12 snapshot (`build_plant_snapshot`), Starlette `GET /snapshot`, plant-view React + Vitest. No chart library.

**Spec:** [`docs/superpowers/specs/2026-09-06-plant-view-production-composition-design.md`](../specs/2026-09-06-plant-view-production-composition-design.md)

See the approved Cursor plan for task steps, file map, and verification commands.
