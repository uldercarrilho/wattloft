#!/usr/bin/env bash
# Dump History (samples and day_summaries) and put the gzip SQL in Always Free Object Storage.
# HeatWave's 1-day automatic backup is not enough.
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:${PATH}"

ENV_FILE="${WATTLOFT_ENV_FILE:-/etc/wattloft/wattloft.env}"
BUCKET="${WATTLOFT_DUMP_BUCKET:-wattloft-history-dumps}"
COMPOSE_DIR="${WATTLOFT_COMPOSE_DIR:-/opt/wattloft}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OBJECT="samples-${STAMP}.sql.gz"

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
docker compose --env-file "$ENV_FILE" -f "${COMPOSE_DIR}/compose.yml" exec -T wattloft \
  python -m wattloft.dump | gzip -c > "$tmp"

oci os object put \
  --auth instance_principal \
  --bucket-name "$BUCKET" \
  --name "$OBJECT" \
  --file "$tmp" \
  --force >/dev/null

echo "wattloft-dump: wrote ${OBJECT}"
