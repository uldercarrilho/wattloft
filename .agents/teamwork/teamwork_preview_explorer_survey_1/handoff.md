# Security Audit & Infrastructure Handoff Report: Wattloft

**Author**: Explorer 1 (Security, Secrets Discovery & Infrastructure Review)  
**Date**: 2026-10-09  
**Target Repository**: `wattloft` (Monorepo)  
**Status**: Completed  
**Read-Only Verification**: Verified with `git status --porcelain` (Zero tracked files modified; output: `?? .agents/`).

---

## 1. Observation

### 1.1 R1: Secrets & Sensitive Data Audit (Working Tree & Full Git History)

An exhaustive scan across all 135 commits (`git log --all --full-history -p`) and current working tree files revealed the following concrete observations:

#### Observation 1.1.1 — Hardware Inverter Logger Serials Committed in Past Commits
- **Locations & Commits**:
  - `src/wattloft/config.py` in commits prior to `4398e0ccd68522095390a89f72e12f359a05888d`:
    ```python
    # Commit a286cc96da7eca6e6acbfa9f952ff3e314b84a1a (and earlier)
    ADMITTED_LOGGER_SERIALS = frozenset({"3909309465", "3913630013"})
    LOGGER_DISPLAY_NAMES = {
        "3909309465": "East",
        "3913630013": "West",
    }
    ```
  - `tests/test_server_b_honesty.py` in commits prior to `0516adadfea27fb0e73728840394b2c20452d633`:
    ```python
    # Commit a13c595 (tests/test_server_b_honesty.py)
    _EXPECTED_HELLO_ACK = bytes.fromhex("a50a0010110400195403e9000000000000000000008815")
    _EXPECTED_HEARTBEAT_ACK = bytes.fromhex("a50a0010170400195403e9000000000000000000008e15")
    ```
    Note: Bytes `19 54 03 e9` (little-endian for `0xe9035419`) decode to integer `3909309465`.
  - Additional occurrences across historical test files and specs:
    - Serials `3909309465` and `3913630013`: `tests/test_snapshot_payload.py`, `tests/test_solar_history.py`, `tests/test_plant_two_loggers.py`, `plant-view/src/grains.test.ts`.
    - Third serial `3909310155`: `plant-view/src/PlantChart.test.tsx`, `plant-view/src/grains.test.ts`, `docs/superpowers/specs/2026-09-08-glance-plant-loggers-design.md`.
  - In commit `4398e0c` (`feat(security): harden repository for public showcase`), these were replaced in the working tree with dummy defaults `1000000001` and `1000000002` and environment variable overrides `WATTLOFT_ADMITTED_LOGGER_SERIALS`. However, the physical hardware serial numbers remain permanently visible in Git commit history.

#### Observation 1.1.2 — Personal Contact Information & Author PII in Git Metadata
- **Location**: Full Git commit history (`git log --format="%an <%ae>"`).
- **Finding**: 133 commits authored by `Ulder Carrilho Júnior <uldercarrilho@gmail.com>`.
- **Finding**: Working tree and commit history also contain references:
  - `LICENSE`: Line 3: `Copyright (c) 2026 Ulder Carrilho Júnior`
  - `.github/CODEOWNERS`: `@uldercarrilho`
  - Local Windows path leak in commit `0c31e7f` in `docs/superpowers/plans/2026-09-25-ui-ux-revamp.md`:
    ```markdown
    [2026-09-24-ui-ux-revamp-design.md](file:///c:/Users/ulder/GitHub/wattloft/docs/superpowers/specs/2026-09-24-ui-ux-revamp-design.md)
    ```
    (Sanitized from working tree in `4398e0c`, but still present in commit `0c31e7f`).

#### Observation 1.1.3 — Active Production Dynamic DNS Hostname Committed
- **Location**:
  - `scripts/enroll-operator-passkey.sh`: Lines 195, 197, 201, 210, 212, 255: `wattloft.dedyn.io`
  - `scripts/enroll-passkey-console.js`: Lines 2, 9, 36: `https://wattloft.dedyn.io` and `rpId: "wattloft.dedyn.io"`
  - `plant-view/src/server.ts`: Line 602:
    ```typescript
    const vapidSubject = process.env.OPERATOR_VAPID_SUBJECT ?? "mailto:operator@wattloft.dedyn.io";
    ```
  - `.github/workflows/deploy.yml`: Lines 188–189:
    ```yaml
    environment:
      name: production
      url: https://wattloft.dedyn.io
    ```
- **Finding**: The active deSEC dynDNS domain name `wattloft.dedyn.io` is hardcoded across infrastructure scripts, frontend enrollment scripts, server fallbacks, and GitHub Actions environments.

#### Observation 1.1.4 — Production VM Public IPv4 Stored as GitHub Actions Repository Variable
- **Location**: `infra/provision.sh` line 370:
  ```bash
  gh variable set WATTLOFT_RESERVED_IPV4 --body "$PUBLIC_IPV4"
  ```
  And in `.github/workflows/deploy.yml` line 205:
  ```yaml
  WATTLOFT_RESERVED_IPV4: ${{ secrets.WATTLOFT_RESERVED_IPV4 || vars.WATTLOFT_RESERVED_IPV4 }}
  ```
- **Finding**: When `infra/provision.sh` runs, the static reserved public IPv4 of the OCI VM is configured as a public repository variable (`vars.WATTLOFT_RESERVED_IPV4`), which is not masked in workflow output and is accessible in repository metadata.

#### Observation 1.1.5 — Local Plaintext Credential Storage in Operator Home Directory
- **Location**:
  - `scripts/setup-oci-agent.sh`: Lines 92, 143: Writes OCI API private key to `~/.oci/wattloft-agent.pem` and config to `~/.oci/config`.
  - `scripts/setup-desec.sh`: Line 140: Writes `DESEC_TOKEN` and `WATTLOFT_HOSTNAME` to `~/.oci/wattloft.env`.
  - `infra/provision.sh`: Lines 257–258: Writes MySQL admin root password to `~/.oci/wattloft-mysql-password`.
  - `infra/common.sh`: Line 33: Writes SSH private key to `~/.oci/wattloft_deploy`.
- **Finding**: All infrastructure credentials, database passwords, and API keys are persisted as unencrypted flat files under `~/.oci/`.

---

### 1.2 R2: Infrastructure & Deployment Configuration Security

#### Observation 1.2.1 — Caddyfile Reverse Proxy Port Default Mismatch (Auth Bypass Risk)
- **Location**: `deploy/Caddyfile` lines 8–10:
  ```caddyfile
  {$WATTLOFT_HOSTNAME} {
      reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:8000}
  }
  ```
- **Location**: `deploy/compose.yml` lines 9–10, 20–22:
  ```yaml
  wattloft:
    environment:
      WATTLOFT_API_HOST: "127.0.0.1"
      WATTLOFT_API_PORT: "8000"
  plant-view:
    environment:
      PLANT_VIEW_HOST: "127.0.0.1"
      PLANT_VIEW_PORT: "3000"
  ```
- **Finding**: The backend Python API (`wattloft`) runs on port `8000` and has NO authentication (routes `/snapshot` and `/events` in `src/wattloft/api.py` are unauthenticated). The Node.js BFF (`plant-view`) runs on port `3000` and enforces session cookies, password login, and passkey authentication. If `PLANT_VIEW_PORT` is not supplied to Caddy, Caddy defaults to port `8000`, proxying directly to the unauthenticated Python API and bypassing all authentication.

#### Observation 1.2.2 — Docker Host Networking (`network_mode: host`)
- **Location**: `deploy/compose.yml` lines 4, 15, 26:
  ```yaml
  wattloft:
    network_mode: host
  plant-view:
    network_mode: host
  caddy:
    network_mode: host
  ```
- **Finding**: All three containers share the host network namespace. There is no container network isolation. Any service bound to `127.0.0.1` inside any container is reachable by all processes on the host.

#### Observation 1.2.3 — Insecure Environment Sourcing in System Shell Scripts
- **Location**:
  - `deploy/history-dump.sh` lines 14–16:
    ```bash
    set -a
    source "$ENV_FILE"
    set +a
    ```
  - `deploy/install-host.sh` lines 30–35:
    ```bash
    set -a
    src=$(mktemp)
    trap 'rm -f "$src"' EXIT
    grep -vE '^OPERATOR_PASSKEY_CREDENTIAL=' "$ENV_FILE" > "$src" || true
    source "$src"
    ```
- **Finding**:
  1. `history-dump.sh` executes `source "$ENV_FILE"` directly as root without stripping `OPERATOR_PASSKEY_CREDENTIAL`. If `OPERATOR_PASSKEY_CREDENTIAL` is written into `$ENV_FILE` (a JSON string with quotes and braces), bash syntax parsing fails and crashes the daily history backup timer.
  2. Sourcing untrusted or unvalidated env files executes arbitrary shell code if variable values contain subshells (`$(...)`) or backticks.

#### Observation 1.2.4 — Bastion Port Forwarding with Host Key Verification Disabled
- **Location**: `infra/bastion-exec.sh` lines 70–77:
  ```bash
  ssh_opts=(
    -i "$SSH_KEY"
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o LogLevel=ERROR
    -o IdentitiesOnly=yes
    -o ProxyCommand="ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o IdentitiesOnly=yes -W %h:%p -p 22 ${SESSION_ID}@${BASTION_HOST}"
  )
  ```
- **Finding**: Host key verification is completely disabled (`StrictHostKeyChecking=no` and `/dev/null` known hosts). While used to accommodate ephemeral Bastion session IDs, it disables SSH authenticity verification.

#### Observation 1.2.5 — OCI Bastion Ingress CIDR Open to Global Internet
- **Location**: `infra/provision.sh` lines 327–333:
  ```bash
  BASTION_ID=$(ociq bastion bastion create \
    --bastion-type STANDARD \
    --compartment-id "$COMP" \
    --target-subnet-id "$PUBLIC_SUBNET" \
    --name "$BASTION_NAME" \
    --client-cidr-list '["0.0.0.0/0"]' \
    --query "data.id" --raw-output)
  ```
- **Finding**: The Bastion service client CIDR list allows connection requests from `0.0.0.0/0` (any IP on the internet).

#### Observation 1.2.6 — Overly Broad OCI IAM Policy on Dynamic Group
- **Location**: `infra/provision.sh` lines 217–221:
  ```bash
  --statements "[
    \"Allow dynamic-group ${DYN_GROUP_NAME} to read secret-family in compartment wattloft\",
    \"Allow dynamic-group ${DYN_GROUP_NAME} to manage objects in compartment wattloft where target.bucket.name='${BUCKET_NAME}'\",
    \"Allow dynamic-group ${DYN_GROUP_NAME} to read buckets in compartment wattloft\"
  ]"
  ```
- **Finding**: Any instance in the `wattloft-instances` dynamic group is granted permission to read the entire `secret-family` in compartment `wattloft`, rather than scoped to the specific secret `wattloft-env`.

#### Observation 1.2.7 — Caddyfile Missing TLS & Hardening Directives
- **Location**: `deploy/Caddyfile` lines 1–11:
  ```caddyfile
  {
      admin off
      skip_install_trust
      http_port {$WATTLOFT_HTTP_PORT:80}
      https_port {$WATTLOFT_HTTPS_PORT:443}
  }

  {$WATTLOFT_HOSTNAME} {
      reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:8000}
  }
  ```
- **Finding**: The reverse proxy configuration lacks:
  - Strict-Transport-Security (HSTS)
  - Access logging directives (`log { output file ... }`)
  - Explicit TLS version restrictions (defaults to Caddy TLS 1.2/1.3)
  - Security headers at proxy edge (relies solely on Hono middleware in `plant-view`).

---

## 2. Logic Chain

1. **Hardware Logger Serial Leak (Obs 1.1.1) → Telemetry Ingestion Spoofing Risk**:
   - The solar logger data ingestion service (`src/wattloft/ingest.py`, lines 42–44) verifies admitted frames using:
     `if logger_serial not in admitted_logger_serials: return None`.
   - The Solarman v5 ingestion protocol runs unencrypted over TCP port 10000 on the public internet (`deploy/compose.yml` line 12: `INGEST_HOST: "0.0.0.0"`, `INGEST_PORT: "10000"`).
   - In commit `4398e0c`, the code author moved admitted serials into environment variables, noting in the commit message: *"Externalize admitted logger serials and display names to environment variables with dummy fallbacks"*.
   - However, the real physical hardware logger serial numbers (`3909309465`, `3913630013`, and `3909310155`) were hardcoded in earlier commits (`a286cc9`, `3a3b2fd`, etc.) and remain visible in Git history.
   - If the operator continues to use these real serials in production, anyone cloning the public repository can inspect Git history, extract these exact serials, connect to `wattloft.dedyn.io:10000`, and inject spoofed solar power and energy frames directly into the MySQL database.

2. **Caddyfile Port Default Mismatch (Obs 1.2.1) → Complete Authentication Bypass**:
   - The backend Python service (`src/wattloft/api.py`) exposes `/snapshot` and `/events` without any authentication headers, cookies, or token checks.
   - All authentication logic (session HMAC cookies, rate limiting, and WebAuthn passkey verification) is located exclusively in the Node.js BFF (`plant-view/src/server.ts`).
   - `compose.yml` places Python API on port 8000 and Node BFF on port 3000.
   - `deploy/Caddyfile` proxies to `127.0.0.1:{$PLANT_VIEW_PORT:8000}`.
   - If `PLANT_VIEW_PORT` is absent in Caddy's environment, Caddy routes all public HTTPS traffic directly to port 8000 (Python API).
   - Consequently, public requests to `/snapshot` and `/events` will bypass the authentication barrier entirely.

3. **Insecure Environment Sourcing (Obs 1.2.3) → Service Denial in Backup Pipeline**:
   - `deploy/history-dump.sh` is executed by `history-dump.timer` daily.
   - Line 15 executes `source "$ENV_FILE"`.
   - When passkey authentication is configured, `OPERATOR_PASSKEY_CREDENTIAL` is saved into `$ENV_FILE` as a JSON string:
     `OPERATOR_PASSKEY_CREDENTIAL={"credentialId":"...","publicKey":"...","rpId":"wattloft.dedyn.io"}`.
   - In bash, unquoted JSON lines cause syntax errors (e.g. `syntax error near unexpected token '{'`).
   - This failure prevents `history-dump.sh` from executing, silently disabling daily automated backups to OCI Object Storage.

4. **Production Hostname & Public IP Exposure (Obs 1.1.3, 1.1.4) → Attack Surface Reconnaissance**:
   - Hardcoding `wattloft.dedyn.io` in public scripts and setting `WATTLOFT_RESERVED_IPV4` as a GitHub repository variable allows an external visitor to pinpoint the exact cloud infrastructure host.
   - Combined with port 10000 being open to the world, an attacker can directly target both the web interface (port 443) and the raw TCP ingest socket (port 10000).

---

## 3. Caveats

1. **Active OCI Deployment State**:
   - This audit was performed locally in read-only mode using Git history, code, and infrastructure configurations. Live OCI cloud console state (e.g., active Vault secret versions, current dynamic group memberships, running instance OCIDs) was not queried against live Oracle Cloud APIs to preserve zero-side-effect isolation.
2. **Physical Hardware Key Rotation**:
   - Inverter data loggers (Deye / Solarman / IGEN) have burned-in hardware serial numbers on physical stickers and EEPROM. Unlike API tokens, physical hardware serial numbers cannot be easily "rotated" without replacing the physical logger dongles. Sanitizing Git history is therefore the primary mitigation.
3. **No Dynamic Network Penetration**:
   - No packets were sent to `wattloft.dedyn.io` or live external endpoints during this audit.

---

## 4. Conclusion & Prioritized Remediation

### 4.1 Prioritized Findings Summary

| ID | Finding Title | Severity | Impact | Affected Artifacts |
|---|---|---|---|---|
| **SEC-01** | Hardware Inverter Logger Serials in Git History | **HIGH** | Ingestion spoofing via unauthenticated TCP 10000 | Commit `a286cc9` and history (`src/wattloft/config.py`, tests) |
| **SEC-02** | Caddyfile Default Port Auth Bypass | **HIGH** | Complete bypass of BFF authentication if port env unset | `deploy/Caddyfile:9` |
| **SEC-03** | Production DynDNS Hostname Committed in Repo | **MEDIUM** | Pinpoints live production target and infrastructure | `scripts/`, `plant-view/src/server.ts`, `deploy.yml` |
| **SEC-04** | Reserved IPv4 Stored as GitHub Actions Repo Variable | **MEDIUM** | Exposes production server IP address in public metadata | `infra/provision.sh:370`, `.github/workflows/deploy.yml:205` |
| **SEC-05** | Unprotected Environment Sourcing in Backup Script | **MEDIUM** | Crash of daily backup timer when passkey JSON is present | `deploy/history-dump.sh:15` |
| **SEC-06** | Docker Host Networking (`network_mode: host`) | **MEDIUM** | Lack of container network boundary and port isolation | `deploy/compose.yml` |
| **SEC-07** | Author Personal Email in Git Metadata | **LOW** | PII disclosure (personal email exposed to scrapers) | 133 commits (`uldercarrilho@gmail.com`) |
| **SEC-08** | Bastion Ingress CIDR Allowed from `0.0.0.0/0` | **LOW** | Open Bastion port-forwarding endpoint to global internet | `infra/provision.sh:332` |
| **SEC-09** | Broad IAM Policy on Dynamic Group | **LOW** | Instance principal can read all compartment secrets | `infra/provision.sh:218` |
| **SEC-10** | Missing Caddy TLS Hardening & Proxy Logging | **LOW** | Lack of defense-in-depth HSTS and audit logs | `deploy/Caddyfile` |

---

### 4.2 Step-by-Step Remediation Plan

#### Remediation 1: Purge Leaked Secrets & PII from Git History with `git-filter-repo`

Before making the repository public, run `git-filter-repo` on a fresh mirror clone:

1. **Install tool**:
   ```bash
   pip install git-filter-repo
   ```

2. **Prepare replacement expressions (`replacements.txt`)**:
   ```text
   3909309465==>1000000001
   3913630013==>1000000002
   3909310155==>1000000003
   file:///c:/Users/ulder/GitHub/wattloft/==>../
   ```

3. **Execute Git History Filter**:
   ```bash
   # In a clean clone of the repo:
   git filter-repo --replace-text replacements.txt \
     --email-callback 'return b"uldercarrilho@users.noreply.github.com" if b"uldercarrilho@gmail.com" in email else email' \
     --force
   ```

4. **Force-push rewritten branches and tags** (coordinate with any collaborator worktrees):
   ```bash
   git push origin --force --all
   git push origin --force --tags
   ```

#### Remediation 2: Correct Caddyfile Reverse Proxy Port
Change `deploy/Caddyfile` line 9 to default to `3000`:
```caddyfile
{$WATTLOFT_HOSTNAME} {
	reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:3000}
}
```

#### Remediation 3: Secure Environment Sourcing in `deploy/history-dump.sh`
Update lines 13–16 in `deploy/history-dump.sh` to safely filter passkey JSON and avoid bash syntax errors:
```bash
set -a
src=$(mktemp)
trap 'rm -f "$src"' EXIT
grep -vE '^OPERATOR_PASSKEY_CREDENTIAL=' "$ENV_FILE" > "$src" || true
source "$src"
rm -f "$src"
trap - EXIT
set +a
```

#### Remediation 4: Convert Public IP to GitHub Secret
In `infra/provision.sh` line 370:
```bash
# Before:
gh variable set WATTLOFT_RESERVED_IPV4 --body "$PUBLIC_IPV4"

# After:
printf '%s' "$PUBLIC_IPV4" | gh secret set WATTLOFT_RESERVED_IPV4
gh variable delete WATTLOFT_RESERVED_IPV4 >/dev/null 2>&1 || true
```

#### Remediation 5: Parameterize Production Hostname in Scripts
- In `scripts/enroll-passkey-console.js`, replace `location.origin !== "https://wattloft.dedyn.io"` with:
  ```javascript
  const expectedRpId = location.hostname;
  ```
- In `scripts/enroll-operator-passkey.sh`, accept `$WATTLOFT_HOSTNAME` from environment or prompt rather than hardcoding `wattloft.dedyn.io`.
- In `plant-view/src/server.ts`, default `vapidSubject` to `"mailto:operator@" + (process.env.WATTLOFT_HOSTNAME ?? "localhost")`.

#### Remediation 6: Scope OCI IAM Policy to Specific Secret
In `infra/provision.sh`, update the IAM dynamic-group policy:
```text
Allow dynamic-group wattloft-instances to read secret-family in compartment wattloft where target.secret.name='wattloft-env'
```

#### Remediation 7: Harden Caddyfile Headers
Add reverse proxy headers and HSTS to `deploy/Caddyfile`:
```caddyfile
{$WATTLOFT_HOSTNAME} {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options "nosniff"
	}
	reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:3000} {
		header_up Host {host}
		header_up X-Real-IP {remote_host}
	}
	log {
		output file /var/log/caddy/access.log
	}
}
```

---

## 5. Verification Method

To independently reproduce and verify each finding:

1. **Verify Git History Serial Leak**:
   ```bash
   git log --all --full-history -S"3909309465" --oneline
   git show a286cc9:src/wattloft/config.py
   git show 0516ada~1:tests/test_server_b_honesty.py | grep -E "EXPECTED.*ACK"
   ```

2. **Verify Personal Email in Git Authors**:
   ```bash
   git log --all --format="%an <%ae>" | sort -u
   ```

3. **Verify Caddyfile Port Default & BFF Auth Seam**:
   Inspect line 9 of `deploy/Caddyfile`:
   ```bash
   grep -n "reverse_proxy" deploy/Caddyfile
   ```
   Compare against `deploy/compose.yml` lines 9–10 (`WATTLOFT_API_PORT: "8000"`) and 21–22 (`PLANT_VIEW_PORT: "3000"`).

4. **Verify Sourcing Bug in `history-dump.sh`**:
   Inspect `deploy/history-dump.sh` lines 13–16:
   ```bash
   sed -n '13,17p' deploy/history-dump.sh
   ```
   Note the absence of `grep -vE '^OPERATOR_PASSKEY_CREDENTIAL='` which is present in `deploy/install-host.sh`.

5. **Verify Clean Repository State (Read-Only Guarantee)**:
   ```bash
   git status --porcelain
   ```
   Expected output: `?? .agents/` (only agent scratchpad files exist).
