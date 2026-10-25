# Original User Request

## 2026-10-09T15:15:58Z

Conduct a comprehensive security audit, git history secret scan, and senior-level architectural review of the `wattloft` repository to prepare it for public showcase on GitHub and LinkedIn, delivering a standalone audit report (`AUDIT_REPORT.md`) without modifying any existing repository files.

Working directory: c:\Users\ulder\GitHub\wattloft
Integrity mode: development

## Requirements

### R1. Secrets & Sensitive Data Audit (Working Tree & Full Git History)
Perform an exhaustive search across all files in the current working directory AND the complete Git commit history (`git log -p`) for hardcoded credentials, API keys, tokens, private keys, certificates, cloud account identifiers (OCI, deSEC, etc.), private IP addresses, and personal contact info.

### R2. Infrastructure & Deployment Configuration Security
Analyze all deployment and provisioning scripts (`deploy/`, `infra/`, `scripts/`) including systemd units, Caddyfile, cloud-init configurations, and shell scripts for privilege issues, insecure command executions, exposed ports, or configuration weaknesses.

### R3. Application Code & Security Posture
Inspect the backend Python service (`src/wattloft/`) and frontend TypeScript/Vite web application (`plant-view/`) for common application security risks, input validation flaws, error exposure, authentication/authorization boundaries, CORS settings, and dependency vulnerabilities.

### R4. Senior Software Engineer Architecture & System Design Review
Evaluate the architecture, system design, and engineering craftsmanship against production-grade standards. Review component decoupling, error handling/resilience, observability, telemetry/logging, test coverage and reliability, and identify technical debt or design bottlenecks.

### R5. Portfolio & Public Showcase Readiness
Assess the repository from the perspective of external engineering leaders, hiring managers, and tech recruiters on LinkedIn. Evaluate README impact, architectural clarity, setup instructions, diagrams, licensing (`LICENSE`), and GitHub hygiene (`.github/` templates, workflows).

### R6. Standalone Audit Report Deliverable (Read-Only Guarantee)
Compile all findings into a structured, standalone markdown report named `AUDIT_REPORT.md` (or saved in the artifact directory). Under no circumstances should existing repository files be modified or committed.

## Acceptance Criteria

### Audit Depth & Rigor
- [ ] Full Git commit history (`git log -p`) is audited for past credential/secret commits.
- [ ] Infrastructure configs (`deploy/`, `infra/`, `scripts/`) are evaluated for exposed tokens or insecure patterns.
- [ ] Application code (`src/`, `plant-view/`) is audited for OWASP/security weaknesses.
- [ ] Architectural evaluation grades the system against production-readiness benchmarks with concrete improvement areas.
- [ ] Showcase recommendations offer actionable advice to maximize professional impact on LinkedIn.

### Actionability & Integrity
- [ ] Every finding has an assigned severity (Critical, High, Medium, Low, Informational), affected file path (or commit hash), and step-by-step remediation guide (including git history cleaning commands if leaks exist).
- [ ] Standalone report document is generated with clear executive summary and categorized sections.
- [ ] Zero tracked repository files are modified (`git status --porcelain` is verified).
