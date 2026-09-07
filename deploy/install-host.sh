#!/usr/bin/env bash
# Install host units and bring the compose stack up. Runs on the pet as root.
set -euo pipefail

COMPOSE_DIR="${WATTLOFT_COMPOSE_DIR:-/opt/wattloft}"
ENV_FILE="${WATTLOFT_ENV_FILE:-/etc/wattloft/wattloft.env}"
DEPLOY_ENV_FILE="${WATTLOFT_DEPLOY_ENV_FILE:-/etc/wattloft/deploy.env}"
cd "$COMPOSE_DIR"

install -m 755 wattloft-env.sh /usr/local/sbin/wattloft-env
install -m 755 history-dump.sh /usr/local/sbin/wattloft-history-dump
install -m 644 wattloft-env.service /etc/systemd/system/wattloft-env.service
install -m 644 history-dump.service /etc/systemd/system/wattloft-history-dump.service
install -m 644 history-dump.timer /etc/systemd/system/wattloft-history-dump.timer

systemctl daemon-reload
systemctl enable wattloft-env.service wattloft-history-dump.timer
# RemainAfterExit oneshot: start is a no-op after the first success, so reclaim
# would keep a stale GHCR job token and compose pull would 401.
if ! systemctl restart wattloft-env.service; then
  journalctl -u wattloft-env.service -n 50 --no-pager >&2
  exit 1
fi

if [[ -f "${COMPOSE_DIR}/deploy.env" ]]; then
  install -m 600 "${COMPOSE_DIR}/deploy.env" "$DEPLOY_ENV_FILE"
fi

# shellcheck disable=SC1090
set -a
src=$(mktemp)
trap 'rm -f "$src"' EXIT
grep -vE '^OPERATOR_PASSKEY_CREDENTIAL=' "$ENV_FILE" > "$src" || true
# shellcheck disable=SC1090
source "$src"
if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV_FILE"
fi
set +a
rm -f "$src"
trap - EXIT
if [[ -z "${GHCR_PULL_TOKEN:-}" ]]; then
  echo "install-host: GHCR_PULL_TOKEN missing from ${ENV_FILE} / ${DEPLOY_ENV_FILE}" >&2
  exit 1
fi
printf '%s' "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-uldercarrilho}" --password-stdin

# OCI Ubuntu images REJECT new TCP except 22. NSG already allows 80/443/10000.
for port in 80 443 10000; do
  if ! iptables -C INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    iptables -I INPUT -p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save || true
elif [[ -d /etc/iptables ]]; then
  iptables-save > /etc/iptables/rules.v4
fi

compose_env=(--env-file "$ENV_FILE")
if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  compose_env+=(--env-file "$DEPLOY_ENV_FILE")
fi
docker compose "${compose_env[@]}" -f "${COMPOSE_DIR}/compose.yml" pull
docker compose "${compose_env[@]}" -f "${COMPOSE_DIR}/compose.yml" up -d
systemctl start wattloft-history-dump.timer
