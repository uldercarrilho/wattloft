#!/usr/bin/env bash
# Pull GitHub Actions secrets from OCI Vault via instance principal and write
# a root-only env file. Compose reads that file; Wattloft does not speak OCI.
set -euo pipefail

ENV_FILE="${WATTLOFT_ENV_FILE:-/etc/wattloft/wattloft.env}"
COMPARTMENT_ID="${OCI_COMPARTMENT_OCID:?OCI_COMPARTMENT_OCID is required}"
SECRET_NAME="${WATTLOFT_VAULT_SECRET:-wattloft-env}"

mkdir -p "$(dirname "$ENV_FILE")"
chmod 700 "$(dirname "$ENV_FILE")"

secret_id=$(oci vault secret list \
  --auth instance_principal \
  --compartment-id "$COMPARTMENT_ID" \
  --name "$SECRET_NAME" \
  --query "data[?\"lifecycle-state\"=='ACTIVE'] | [0].id" \
  --raw-output)

if [[ -z "$secret_id" || "$secret_id" == "null" ]]; then
  echo "wattloft-env: no ACTIVE Vault secret named ${SECRET_NAME}" >&2
  exit 1
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
oci secrets secret-bundle get \
  --auth instance_principal \
  --secret-id "$secret_id" \
  --query "data.\"secret-bundle-content\".content" \
  --raw-output | base64 -d > "$tmp"

chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"

if grep -q '^GHCR_PULL_TOKEN=.\+' "$ENV_FILE"; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  printf '%s' "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-uldercarrilho}" --password-stdin >/dev/null
fi
