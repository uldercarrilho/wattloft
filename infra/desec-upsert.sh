#!/usr/bin/env bash
# Point the deSEC DNS-only A record at the reserved public IPv4.
set -euo pipefail

if [[ -f "${HOME}/.oci/wattloft.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${HOME}/.oci/wattloft.env"
  set +a
fi

: "${DESEC_TOKEN:?}"
: "${WATTLOFT_HOSTNAME:?}"
: "${WATTLOFT_RESERVED_IPV4:?}"

curl -fsS -X POST "https://desec.io/api/v1/domains/${WATTLOFT_HOSTNAME}/rrsets/" \
  -H "Authorization: Token ${DESEC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"subname\":\"\",\"type\":\"A\",\"ttl\":3600,\"records\":[\"${WATTLOFT_RESERVED_IPV4}\"]}" \
  && exit 0

curl -fsS -X PATCH "https://desec.io/api/v1/domains/${WATTLOFT_HOSTNAME}/rrsets/@/A/" \
  -H "Authorization: Token ${DESEC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"ttl\":3600,\"records\":[\"${WATTLOFT_RESERVED_IPV4}\"]}"
