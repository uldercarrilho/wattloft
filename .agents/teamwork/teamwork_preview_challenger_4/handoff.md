# Handoff Report — Challenger 4 (Empirical Code, Tests & Architecture Stress-Testing)

**Verdict**: **APPROVE**  
**Agent**: Challenger 4 (`teamwork_preview_challenger_4`)  
**Target Deliverable**: `c:\Users\ulder\GitHub\wattloft\AUDIT_REPORT.md`  
**Execution Timestamp**: 2026-10-09T16:15:00Z  

---

## 1. Observation

All commands and inspections were directly executed in the environment (`c:\Users\ulder\GitHub\wattloft`) without trusting prior claims.

### Observation 1: Working Tree Read-Only Guarantee
- **Command**: `git status --porcelain`
- **Output**:
  ```text
  ?? .agents/
  ?? AUDIT_REPORT.md
  ```
- **Finding**: Zero tracked files were modified, staged, or removed. The repository working tree remains completely clean and read-only.

### Observation 2: Section 9 Command 7 Pytest Suite Execution
- **Command**:
  ```powershell
  python -m pytest tests/test_solar_geometry.py tests/test_solar_clipping.py tests/test_solar_calibration.py tests/test_solar_drift.py tests/test_snapshot_payload.py tests/test_local_day_production.py tests/test_events_sse.py tests/test_loggers_now.py -q
  ```
- **Output**:
  ```text
  ..........................................                               [100%]
  42 passed in 0.69s
  ```
- **Finding**: Verbatim 42 unit tests executed and passed in 0.69 seconds, exactly confirming the Section 9 Command 7 claim in `AUDIT_REPORT.md`.

### Observation 3: Full Pytest Suite & Docker Coupling (ARCH-06)
- **Command**: `python -m pytest tests/`
- **Output**:
  ```text
  docker.errors.DockerException: Error while fetching server API version: (2, 'CreateFile', 'The system cannot find the file specified.')
  ...
  ======================= 44 passed, 48 errors in 13.95s ========================
  ```
- **Finding**: Running the complete test suite without a running Docker daemon failed on MySQL testcontainers fixtures (`tests/conftest.py:162: with MySqlContainer("mysql:8.4") as mysql`). This empirically validates Finding **ARCH-06** (*"Pytest Suite Docker Coupling & Developer Experience"*), which noted that pure-Python tests run cleanly while full tests fail without Docker.

### Observation 4: Frontend Test Suite (`npm test` in `plant-view`)
- **Command**: `npm test` inside `c:\Users\ulder\GitHub\wattloft\plant-view`
- **Output**:
  ```text
  Test Files  17 passed (17)
       Tests  181 passed (181)
    Start at  13:08:35
    Duration  5.12s (environment 59%, tests 17%, import 12%, transform 10%, worker 1%)
  ```
- **Finding**: Verbatim 17 test files and 181 unit/component/server tests executed and passed in 5.12 seconds, exactly confirming Section 9 Command 5 in `AUDIT_REPORT.md`.

### Observation 5: Mypy Static Type Checking
- **Command**: `python -m mypy src` (and `python -m mypy`)
- **Output**:
  ```text
  Success: no issues found in 17 source files
  ```
- **Finding**: Verbatim 17 source files passed strict type checking with zero type errors, confirming Section 9 Command 6 in `AUDIT_REPORT.md`.

### Observation 6: PyMySQL SSL Context Inspection & Behavior
- **Inspected Code**: `src/wattloft/history/_mysql.py:35-37`:
  ```python
  ssl: dict[str, object] | None = None
  if query.get("ssl", "").lower() in {"1", "true", "required"}:
      ssl = {"check_hostname": False}
  ```
- **Inspected Library Internals**: PyMySQL 2.2.8 (`pymysql.connections.Connection._create_ssl_ctx`, lines 381-410):
  ```python
  ca = sslp.get("ca")
  capath = sslp.get("capath")
  hasnoca = ca is None and capath is None
  ctx = ssl.create_default_context(cafile=ca, capath=capath)
  ...
  ctx.check_hostname = not hasnoca and sslp.get("check_hostname", True)
  if verify_mode_value is None:
      ctx.verify_mode = ssl.CERT_NONE if hasnoca else ssl.CERT_REQUIRED
  ```
- **Empirical Execution Results**:
  1. `ssl = {"check_hostname": False}` (no CA provided):
     - `ctx.check_hostname`: `False`
     - `ctx.verify_mode`: `0` (`ssl.CERT_NONE`)
  2. `ssl = {"check_hostname": True}` (naive fix without CA):
     - `hasnoca` is `True` -> `ctx.check_hostname` evaluated as `not True and True` = `False`
     - `ctx.verify_mode`: `0` (`ssl.CERT_NONE`)
     - *Empirical Confirmation*: PyMySQL forcibly overrides `check_hostname` to `False` and disables certificate verification unless a CA bundle (`ca` or `capath`) is provided.
  3. `ssl = {"check_hostname": True, "ca": ca_path}`:
     - `ctx.check_hostname`: `True`
     - `ctx.verify_mode`: `2` (`ssl.CERT_REQUIRED`)
- **Finding**: Finding **SEC-03** and Remediation **Fix 2** in `AUDIT_REPORT.md` are 100% verified down to the exact library runtime dynamics.

### Observation 7: Historical Serial Leaks & V5 Checksum Mathematics
- **Git History Query**: `git log --all --full-history -S"3909309465" --oneline` revealed 35 commits containing the serial number.
- **Git Commit Inspection**: `git show a286cc9:src/wattloft/config.py` contained `ADMITTED_LOGGER_SERIALS = frozenset({"3909309465", "3913630013"})`.
- **Protocol Checksum Verification**:
  - Historical frame `f1 = bytes.fromhex("a50a0010110400195403e9000000000000000000008815")`:
    `parse_v5(f1)` -> `logger_serial=3909309465`, checksum `0x88` (valid).
  - Sanitized replacement frame `f2 = bytes.fromhex("a50a001011040001ca9a3b00000000000000000000cf15")`:
    `parse_v5(f2)` -> `logger_serial=1000000001`, checksum `0xcf` (valid).
  - All replacement frames in Section 8.1 Step 3 (`0x88->0xcf`, `0x8e->0xd5`, `0x89->0xd0`) parse with zero protocol errors and preserve test integrity.

### Observation 8: Caddyfile Fallback & CQRS Mutation Verification
- **Caddyfile Inspection**: `deploy/Caddyfile:9`:
  `reverse_proxy 127.0.0.1:{$PLANT_VIEW_PORT:8000}`
  Defaults to unauthenticated Starlette API port 8000 rather than Node BFF port 3000.
- **CQRS Defect Inspection**: `src/wattloft/history/_snapshot.py:422` calls `update_day_summary_clipping(database_url, ...)` inside `load_plant_snapshot()`, mutating the database on read requests (`GET /snapshot`).

---

## 2. Logic Chain

1. **Test Suite Claims**:
   - `AUDIT_REPORT.md` claimed 42 Python offline unit tests pass (Section 9 Command 7).
   - Direct execution of `python -m pytest tests/test_solar_geometry.py ... tests/test_loggers_now.py -q` yielded `42 passed in 0.69s` (Observation 2).
   - Therefore, the unit test claim is empirically true.

2. **Frontend Test Claims**:
   - `AUDIT_REPORT.md` claimed 181 passing tests in `plant-view`.
   - Direct execution of `npm test` yielded `17 passed (17)`, `181 passed (181)` in 5.12s (Observation 4).
   - Therefore, the frontend test claim is empirically true.

3. **Type Checking Claims**:
   - `AUDIT_REPORT.md` claimed 17 source files pass `mypy`.
   - Direct execution of `python -m mypy src` and `python -m mypy` yielded `Success: no issues found in 17 source files` (Observation 5).
   - Therefore, the type checking claim is empirically true.

4. **Cryptographic & TLS Integrity Claims**:
   - `AUDIT_REPORT.md` claimed that PyMySQL 2.2.8 sets `check_hostname: False` and `verify_mode = CERT_NONE` when `ca`/`capath` are omitted, even if `check_hostname: True` is passed.
   - Direct execution of `Connection._create_ssl_ctx` with `check_hostname: True` without CA produced `ctx.check_hostname == False` and `ctx.verify_mode == CERT_NONE` (Observation 6).
   - Supplying a valid CA bundle produced `ctx.check_hostname == True` and `ctx.verify_mode == CERT_REQUIRED`.
   - Therefore, the report's security finding (SEC-03) and remediation advice (Fix 2) are verified.

5. **Read-Only Integrity Guarantee**:
   - `AUDIT_REPORT.md` and user instructions required zero modified tracked files.
   - `git status --porcelain` before and after testing confirmed zero tracked files touched (Observation 1).
   - Therefore, the integrity attestation is verified.

---

## 3. Caveats

1. **Docker Integration Tests**: The 48 integration tests requiring a live Docker daemon (`testcontainers[mysql]`) were not executed to completion because Docker was not running in the execution environment. However, this exact limitation is extensively analyzed and documented in `AUDIT_REPORT.md` under Finding ARCH-06.
2. **Pytest Path on Windows**: In pwsh, invoking `pytest` directly without `Scripts\` on PATH returns a command-not-found error, whereas invoking `python -m pytest` executes the runner. Section 9 Command 7 is written in POSIX bash syntax (`pytest ... -q`), which works in CI/CD and standard Linux environments.

---

## 4. Conclusion

**VERDICT**: **APPROVE**

The deliverable `AUDIT_REPORT.md` meets and exceeds all requirements:
1. Every test count (42 pytest, 181 vitest) and file count (17 mypy) is strictly accurate and empirically reproducible.
2. The PyMySQL SSL context vulnerability analysis is technically sound down to the Python `ssl` and PyMySQL internal implementation levels.
3. The forensic git history analysis, hardware serial disclosures, Solarman V5 checksum calculations, and Caddyfile routing defects are completely verified.
4. The working tree remains completely clean and read-only.

---

## 5. Verification Method

To reproduce all findings independently:

```powershell
# 1. Verify read-only guarantee
git status --porcelain
# Expected: Only untracked AUDIT_REPORT.md and .agents/

# 2. Run offline unit tests
python -m pytest tests/test_solar_geometry.py tests/test_solar_clipping.py tests/test_solar_calibration.py tests/test_solar_drift.py tests/test_snapshot_payload.py tests/test_local_day_production.py tests/test_events_sse.py tests/test_loggers_now.py -q
# Expected: 42 passed

# 3. Run frontend test suite
cd plant-view ; npm test ; cd ..
# Expected: 181 passed

# 4. Run static type checker
python -m mypy src
# Expected: Success: no issues found in 17 source files

# 5. Verify PyMySQL SSL behavior
python -c "from pymysql.connections import Connection; c=object.__new__(Connection); print('naive True:', c._create_ssl_ctx({'check_hostname': True}).check_hostname)"
# Expected: naive True: False
```
