# Plant + loggers Glance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below `60rem`, Glance is Plant-now, Today/Lifetime captions, and a Loggers list (reporting vs silent). Drop the sun, rings, hollow core, and “East and West reporting” line.

**Architecture:** Keep DOM-free `glanceModel` as the only mapping from `loggers_now` + Plant KPIs + now. `Glance.tsx` becomes labeled type + rows. `PlantMobile` still calls `glanceModel(snapshot, new Date())` — no pager or snapshot changes.

**Tech stack:** Existing plant-view React, Vitest, Testing Library. No new libraries.

**Spec:** [`docs/superpowers/specs/2026-09-08-glance-plant-loggers-design.md`](../specs/2026-09-08-glance-plant-loggers-design.md)

See the approved Cursor plan for task steps, file map, and verification commands.
