# Audit Plan: wattloft Showcase Preparation

## Objective
Execute a comprehensive audit of the `wattloft` codebase and git history covering all 6 requirements in `ORIGINAL_REQUEST.md`, producing a high-impact, actionable `AUDIT_REPORT.md` while maintaining a strict read-only guarantee on existing tracked repository files.

## Execution Steps

### Step 1: Parallel Exploration (R1 - R5)
Dispatch 5 parallel specialist explorers to conduct rigorous deep-dives:
1. **Explorer 1 (Secrets & Sensitive Data)**:
   - Full git history scan (`git log -p`, `git log --all --full-history`)
   - Working tree scan for credentials, tokens, OCI/deSEC IDs, private IPs, personal info, emails, API keys.
   - Exact commit hashes, file paths, diff snippets, and step-by-step git history remediation commands (e.g. `git-filter-repo` / BFG).
2. **Explorer 2 (Infrastructure & Deployment Configuration Security)**:
   - Detailed review of `deploy/`, `infra/`, `scripts/`, systemd unit files, Caddyfile, cloud-init configurations.
   - Assessment of privilege management, execution boundaries, port exposure, tls config, secret handling in scripts.
3. **Explorer 3 (Application Code & Security Posture)**:
   - Python backend service (`src/wattloft/`) and frontend app (`plant-view/`).
   - OWASP Top 10 analysis, input validation, error handling/leakage, auth/authz boundaries, CORS, headers, dependency vulnerabilities (`pyproject.toml`, `package.json`).
4. **Explorer 4 (Senior Software Engineer Architecture & System Design)**:
   - Component decoupling, system architecture, error resilience, retry policies, data flow, telemetry & structured logging.
   - Test coverage & reliability, CI testing patterns, code smells, performance bottlenecks, technical debt.
5. **Explorer 5 (Portfolio & Public Showcase Readiness)**:
   - Evaluated from the perspective of Staff/Principal engineers and hiring managers on LinkedIn.
   - README narrative & visual impact, architectural diagrams, quickstart reproducibility, LICENSE, `.github/` workflows/templates, issue tracker alignment.

### Step 2: Synthesis & Report Generation (R6)
- Aggregate all 5 specialist reports into a cohesive finding catalog.
- Dispatch a Worker to write `AUDIT_REPORT.md` at repo root (`c:\Users\ulder\GitHub\wattloft\AUDIT_REPORT.md`).
- Report will include Executive Summary, Severity Matrix (Critical, High, Medium, Low, Info), Detailed Findings by Category, Architecture Evaluation, Portfolio/Showcase Recommendations, and Comprehensive Remediation Action Plan.

### Step 3: Review & Forensic Integrity Audit
- Dispatch 2 independent Reviewers to audit report accuracy, depth, and remediation practicality.
- Dispatch a Forensic Auditor to verify integrity and run `git status --porcelain` to ensure read-only compliance on tracked files.

### Step 4: Final Handover
- Verify gate pass.
- Send completion message to Sentinel with executive summary and deliverable path.
