import subprocess
import re
import json

def run_git(args):
    result = subprocess.run(["git"] + args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return result.stdout

commits_raw = run_git(["log", "--all", "--full-history", "--format=%H|%an|%ae|%ad|%s"])
commits = []
for line in commits_raw.strip().splitlines():
    if line:
        parts = line.split("|", 4)
        if len(parts) == 5:
            commits.append({
                "hash": parts[0],
                "author": parts[1],
                "email": parts[2],
                "date": parts[3],
                "subject": parts[4]
            })

# Authors
authors = sorted(list(set((c["author"], c["email"]) for c in commits)))

patterns = {
    "IPv4": re.compile(r'\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b'),
    "OCID": re.compile(r'ocid1\.[a-z0-9_.-]+'),
    "Email": re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
    "PrivateKey": re.compile(r'-----BEGIN[ A-Z_-]*PRIVATE KEY-----'),
    "Certificate": re.compile(r'-----BEGIN CERTIFICATE-----'),
    "deSEC_token": re.compile(r'(?i)desec[_-]?(?:token|secret|key)[\s:=]+["\']?([a-zA-Z0-9_\.-]{10,})'),
    "Password_assign": re.compile(r'(?i)(?:password|passwd|pwd)[\s:=]+["\']?([^"\';\s]{4,})'),
    "Secret_assign": re.compile(r'(?i)(?:secret|token|api_key|apikey)[\s:=]+["\']?([^"\';\s]{8,})'),
    "Database_url": re.compile(r'mysql(?:\+pymysql)?://[^\s"\']+'),
    "Logger_serial": re.compile(r'\b(?:3909309465|3913630013|1000000001|1000000002|[0-9]{10})\b'),
    "Windows_path": re.compile(r'[a-zA-Z]:\\(?:Users|Documents|GitHub|AppData)\\[^\s"\'>]+'),
    "Passkey_cred": re.compile(r'(?i)OPERATOR_PASSKEY[A-Za-z0-9_]*[\s:=]+["\']?([^"\';\s]{8,})'),
}

findings = {k: {} for k in patterns}

for c in commits:
    chash = c["hash"]
    csubj = c["subject"]
    diff = run_git(["show", "--full-history", "-p", chash])
    
    for line in diff.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            text = line[1:]
            for pat_name, pat in patterns.items():
                matches = pat.findall(text)
                for m in matches:
                    val = m if isinstance(m, str) else m[0]
                    if pat_name == "IPv4" and val in {"127.0.0.1", "0.0.0.0", "255.255.255.0", "1.1.1.1", "8.8.8.8"}:
                        continue
                    if pat_name == "IPv4" and (val.startswith("1.0.") or val.startswith("2.0.") or val.startswith("3.0.")):
                        continue
                    if pat_name == "Windows_path" and "..." in val:
                        continue
                    if val not in findings[pat_name]:
                        findings[pat_name][val] = []
                    if len(findings[pat_name][val]) < 5:
                        findings[pat_name][val].append({
                            "commit": chash,
                            "subject": csubj,
                            "line": text.strip()
                        })

out_data = {
    "total_commits": len(commits),
    "authors": [{"name": a, "email": e} for a, e in authors],
    "findings": findings
}

with open("findings.json", "w", encoding="utf-8") as f:
    json.dump(out_data, f, indent=2, ensure_ascii=False)

with open("findings_summary.txt", "w", encoding="utf-8") as f:
    f.write(f"Total commits analyzed: {len(commits)}\n\nAuthors:\n")
    for a, e in authors:
        f.write(f"  {a} <{e}>\n")
    for k, v in findings.items():
        f.write(f"\n================== [{k}] ({len(v)} unique values) ==================\n")
        for val, occurrences in v.items():
            f.write(f"VALUE: {val}\n")
            for occ in occurrences:
                f.write(f"  Commit {occ['commit'][:7]} ({occ['subject']}): {occ['line']}\n")

print("Analysis complete. Written to findings.json and findings_summary.txt")
