# Contributing to Wattloft

Thank you for contributing to Wattloft. Wattloft observes production of one household solar Plant without using the vendor cloud as the store.

## Guiding Principles & Domain Language

Before making changes, review [CONTEXT.md](file:///CONTEXT.md) and [AGENTS.md](file:///AGENTS.md).

- **Ubiquitous Language**: Always use domain nouns consistently as defined in [CONTEXT.md](file:///CONTEXT.md): **Plant**, **Microinverter**, **Logger**, **Admitted Logger**, **Sample**, **Power**, **Current Power**, **Today energy**, **Lifetime energy**, **History**, **Local day**, **Server A**, and **Server B**. Avoid forbidden terms listed in the glossary.
- **Architectural Decision Records**: Key technical decisions live in [docs/adr/](file:///docs/adr/). Read the relevant ADR before proposing substantial architectural changes.

---

## Issue Tracking & Triage

Wattloft uses GitHub issues as the single source of truth for specs and tasks.

- Use the GitHub CLI (`gh`) whenever possible for issue workflows. See [docs/agents/issue-tracker.md](file:///docs/agents/issue-tracker.md).
- Follow the five canonical triage labels specified in [docs/agents/triage-labels.md](file:///docs/agents/triage-labels.md):
  - `needs-triage`: Maintainer needs to evaluate this issue
  - `needs-info`: Waiting on reporter for more information
  - `ready-for-agent`: Fully specified, ready for an AFK agent
  - `ready-for-human`: Requires human implementation
  - `wontfix`: Will not be actioned

---

## Local Development & Verification

### Ingest and History API (Python)

Requires Python 3.12+.

```bash
# Install editable package with dev dependencies
pip install -e ".[dev]"

# Linting
ruff check src tests

# Static Type Checking
mypy

# Test Suite
pytest -q
```

### Plant View (TypeScript / React / Node)

Located in `plant-view/`. Requires Node.js 22+.

```bash
cd plant-view

# Install dependencies
npm ci

# Typecheck
npm run typecheck

# Unit & Component Tests
npm test

# Build Bundle
npm run build
```

---

## Pull Request Conventions

1. **Branch Names**: Use standard prefixes: `feat/<name>`, `fix/<name>`, `chore/<name>`.
2. **Commit Messages**: Follow Conventional Commits format (`feat: ...`, `fix: ...`, `chore: ...`).
3. **PR Template**: Complete all sections in [.github/pull_request_template.md](file:///.github/pull_request_template.md).
4. **CI Checks**: Ensure all CI gates pass (Lint & Typecheck, Unit & Integration Tests, SAST, Secret Scanning, SCA Audit).
