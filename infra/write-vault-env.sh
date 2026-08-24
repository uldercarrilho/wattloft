#!/usr/bin/env bash
# Write DATABASE_URL, OPERATOR_PASSWORD, GHCR pull token, and hostname to
# one Vault secret named wattloft-env. GitHub Actions is the source.
# WATTLOFT_IMAGE is not stored here: Always Free allows 20 active versions
# per secret, and a new SHA every deploy would exhaust that. The host overlay
# (deploy.env) pins the image.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

if [[ -z "${DATABASE_URL:-}" ]]; then
  source_wattloft_env
fi
require_oci

: "${DATABASE_URL:?}"
: "${OPERATOR_PASSWORD:?}"
VAULT_ID="${OCI_VAULT_OCID:-${WATTLOFT_VAULT_OCID:?}}"
KEY_ID="${OCI_KEY_OCID:-${WATTLOFT_KEY_OCID:?}}"
HOSTNAME_VALUE="${WATTLOFT_HOSTNAME:-}"
TOKEN="${GHCR_PULL_TOKEN:-}"

body=$(printf 'DATABASE_URL=%s\nOPERATOR_PASSWORD=%s\nGHCR_PULL_TOKEN=%s\nGHCR_USERNAME=%s\nWATTLOFT_HOSTNAME=%s\n' \
  "$DATABASE_URL" \
  "$OPERATOR_PASSWORD" \
  "$TOKEN" \
  "${GHCR_USERNAME:-uldercarrilho}" \
  "$HOSTNAME_VALUE")
b64=$(printf '%s' "$body" | base64 | tr -d '\n')

# Always Free: 20 active versions + 20 pending deletion per secret. Only
# DEPRECATED versions can be scheduled for deletion; the floor is one day.
schedule_deprecated_version_deletions() {
  local secret_id=$1
  local payload nums deletion_time n
  payload=$(ociq vault secret-version list --secret-id "$secret_id" --all)
  nums=$(printf '%s' "$payload" | python3 -c '
import json, sys
doc = json.load(sys.stdin)
rows = doc["data"] if isinstance(doc, dict) else doc
for row in rows:
    stages = row.get("stages") or []
    if "DEPRECATED" not in stages:
        continue
    if row.get("time-of-deletion"):
        continue
    print(row["version-number"])
')
  if [[ -z "$nums" ]]; then
    return 0
  fi
  deletion_time=$(python3 -c 'from datetime import datetime, timedelta, timezone; print((datetime.now(timezone.utc) + timedelta(days=1, minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
  while IFS= read -r n; do
    [[ -z "$n" ]] && continue
    if ociq vault secret-version schedule-deletion \
      --secret-id "$secret_id" \
      --secret-version-number "$n" \
      --time-of-deletion "$deletion_time" >/dev/null; then
      echo "scheduled deletion of Vault secret version ${n} at ${deletion_time}"
    else
      echo "could not schedule deletion of Vault secret version ${n}" >&2
    fi
  done <<< "$nums"
  # Give Vault a moment to move versions into pending-deletion before update.
  sleep 2
}

current_secret_body() {
  local secret_id=$1
  local content
  content=$(ociq secrets secret-bundle get --secret-id "$secret_id" \
    --query 'data."secret-bundle-content".content' --raw-output 2>/dev/null || true)
  if [[ -z "$content" || "$content" == "null" ]]; then
    return 1
  fi
  printf '%s' "$content" | tr -d '\n' | base64 -d
}

SECRET_ID=$(ociq vault secret list --compartment-id "$COMP" \
  --name "$SECRET_NAME" \
  --all \
  --query "data[?\"lifecycle-state\"=='ACTIVE'].id | [0]" \
  --raw-output)

if [[ -z "$SECRET_ID" || "$SECRET_ID" == "null" ]]; then
  ociq vault secret create-base64 \
    --compartment-id "$COMP" \
    --vault-id "$VAULT_ID" \
    --key-id "$KEY_ID" \
    --secret-name "$SECRET_NAME" \
    --secret-content-content "$b64" \
    --wait-for-state ACTIVE >/dev/null
  echo "created Vault secret ${SECRET_NAME}"
  exit 0
fi

schedule_deprecated_version_deletions "$SECRET_ID"

if current=$(current_secret_body "$SECRET_ID") && [[ "$current" == "$body" ]]; then
  echo "Vault secret ${SECRET_NAME} unchanged"
  exit 0
fi

err=$(mktemp)
trap 'rm -f "$err"' EXIT
if ociq vault secret update-base64 \
  --secret-id "$SECRET_ID" \
  --secret-content-content "$b64" >/dev/null 2>"$err"; then
  echo "updated Vault secret ${SECRET_NAME}"
  exit 0
fi
if grep -q LimitExceeded "$err"; then
  echo "Vault secret ${SECRET_NAME}: version limit exceeded after pruning; keeping the existing secret" >&2
  cat "$err" >&2
  exit 0
fi
cat "$err" >&2
exit 1
