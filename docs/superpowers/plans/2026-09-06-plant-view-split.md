# Plant view split implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split Wattloft so Python owns Server B ingest, History, and `GET /snapshot`, while Plant view is a React app with a Node BFF on the same hostname.

**Architecture:** Caddy terminates TLS and proxies 443 to Node on `127.0.0.1:3000`. Node holds the Operator cookie and fetches Python on `127.0.0.1:8000`. Python still binds ingest on port 10000. Compose stays `network_mode: host`.

**Tech stack:** Python 3.12, Starlette/uvicorn, existing HeatWave History. Node 22, Vite, React, Hono, Vitest + Testing Library. No Next.js, no Docker bridge, no UI redesign.

**Spec:** [`docs/superpowers/specs/2026-09-06-plant-view-split-design.md`](docs/superpowers/specs/2026-09-06-plant-view-split-design.md)

See the approved Cursor plan for task steps, file map, and verification commands.
