# Dispatch: Forensic Auditor (Integrity Forensics & Read-Only Audit)

Working directory: c:\Users\ulder\GitHub\wattloft\.agents\teamwork\teamwork_preview_auditor_1
Original request path: c:\Users\ulder\GitHub\wattloft\.agents\teamwork\ORIGINAL_REQUEST.md
Deliverable to audit: c:\Users\ulder\GitHub\wattloft\AUDIT_REPORT.md

CRITICAL READ-ONLY GUARANTEE:
Under no circumstances should existing repository files be modified or committed.
Verify with `git status --porcelain` that ZERO tracked repository files are modified.

MISSION:
Perform comprehensive forensic integrity verification of the entire audit deliverable and process:
1. READ-ONLY VERIFICATION: Run `git status --porcelain`. Confirm that NO tracked files in the repository have been touched or modified. Only the deliverable `AUDIT_REPORT.md` and metadata under `.agents/` should be untracked.
2. INTEGRITY & ANTI-CHEATING VERIFICATION:
   - Verify that `AUDIT_REPORT.md` is a genuine, exhaustive synthesis of real findings and not a canned, mocked, or dummy report.
   - Cross-check citations, commit hashes (e.g. `a286cc9`, `a13c595`), line numbers, and file paths against the real git repository and filesystem.
   - Verify that no malicious or evasive instructions were introduced.
3. Verdict:
   - CLEAN: Zero tracked files modified, zero cheating detected, all citations verified authentic.
   - INTEGRITY VIOLATION: Any tracked file modified, fabrication of results, or cheating detected.
Report in your handoff.md with your full evidence ledger.


## 2026-10-09T15:40:50Z

You are Forensic Auditor conducting integrity verification on AUDIT_REPORT.md and the entire audit process.
Your working directory is: c:\Users\ulder\GitHub\wattloft\.agents\teamwork\teamwork_preview_auditor_1
Read the original request at: c:\Users\ulder\GitHub\wattloft\.agents\teamwork\ORIGINAL_REQUEST.md
Read your dispatch at: c:\Users\ulder\GitHub\wattloft\.agents\teamwork\teamwork_preview_auditor_1\DISPATCH.md
Read the deliverable at: c:\Users\ulder\GitHub\wattloft\AUDIT_REPORT.md
CRITICAL READ-ONLY GUARANTEE: Under no circumstances should existing repository files be modified or committed. Verify with `git status --porcelain`.
Perform forensic checks:
1. Verify git status --porcelain shows 0 modified tracked files.
2. Verify zero cheating, no dummy/facade implementations, no fake artifacts.
3. Validate authenticity of citations against real repository files and commit history.
Write your handoff report in your working directory (handoff.md) with an explicit verdict: CLEAN or INTEGRITY VIOLATION.
When finished, send a message to the orchestrator with your verdict and handoff path.
