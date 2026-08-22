#!/usr/bin/env bash
# Write DATABASE_URL, OPERATOR_PASSWORD, GHCR pull token, and hostname to
# one Vault secret named wattloft-env. GitHub Actions is the source.
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

body=$(printf 'DATABASE_URL=%s\nOPERATOR_PASSWORD=%s\nGHCR_PULL_TOKEN=%s\nGHCR_USERNAME=%s\nWATTLOFT_HOSTNAME=%s\nWATTLOFT_IMAGE=%s\n' \
  "$DATABASE_URL" \
  "$OPERATOR_PASSWORD" \
  "$TOKEN" \
  "${GHCR_USERNAME:-uldercarrilho}" \
  "$HOSTNAME_VALUE" \
  "${WATTLOFT_IMAGE:-ghcr.io/uldercarrilho/wattloft:main}")
b64=$(printf '%s' "$body" | base64 | tr -d '\n')

SECRET_ID=$(ociq vault secret list --compartment-id "$COMP" \
  --name "$SECRET_NAME" \
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
else
  ociq vault secret update-base64 \
    --secret-id "$SECRET_ID" \
    --secret-content-content "$b64" >/dev/null
  echo "updated Vault secret ${SECRET_NAME}"
fi
