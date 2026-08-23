#!/usr/bin/env bash
# Install host units and bring the compose stack up. Runs on the pet as root.
set -euo pipefail

COMPOSE_DIR="${WATTLOFT_COMPOSE_DIR:-/opt/wattloft}"
ENV_FILE="${WATTLOFT_ENV_FILE:-/etc/wattloft/wattloft.env}"
cd "$COMPOSE_DIR"

install -m 755 wattloft-env.sh /usr/local/sbin/wattloft-env
install -m 755 history-dump.sh /usr/local/sbin/wattloft-history-dump
install -m 644 wattloft-env.service /etc/systemd/system/wattloft-env.service
install -m 644 history-dump.service /etc/systemd/system/wattloft-history-dump.service
install -m 644 history-dump.timer /etc/systemd/system/wattloft-history-dump.timer

systemctl daemon-reload
systemctl enable wattloft-env.service wattloft-history-dump.timer
if ! systemctl start wattloft-env.service; then
  journalctl -u wattloft-env.service -n 50 --no-pager >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ -n "${GHCR_PULL_TOKEN:-}" ]]; then
  printf '%s' "$GHCR_PULL_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-uldercarrilho}" --password-stdin
fi

docker compose --env-file "$ENV_FILE" -f "${COMPOSE_DIR}/compose.yml" pull
docker compose --env-file "$ENV_FILE" -f "${COMPOSE_DIR}/compose.yml" up -d
systemctl start wattloft-history-dump.timer
