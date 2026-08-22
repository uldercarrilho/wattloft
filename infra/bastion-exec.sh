#!/usr/bin/env bash
# Open a time-limited Bastion managed-SSH session, copy deploy files, run a
# remote command as ubuntu (sudo), then delete the session.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

source_wattloft_env
require_oci

ensure_ssh_key
BASTION_ID="${OCI_BASTION_OCID:-${WATTLOFT_BASTION_OCID:?}}"
# Prefer the RUNNING pet. After reclaim the GitHub Actions env still holds the
# terminated instance OCID until the next workflow run.
INSTANCE_ID=$(running_instance_id || true)
if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "null" ]]; then
  INSTANCE_ID="${OCI_INSTANCE_OCID:-${WATTLOFT_INSTANCE_OCID:?}}"
fi
REMOTE_CMD="${*:-sudo bash /opt/wattloft/install-host.sh}"

PRIVATE_IP=$(ociq compute instance list-vnics --instance-id "$INSTANCE_ID" \
  --query "data[0].\"private-ip\"" --raw-output)
BASTION_HOST="host.bastion.${REGION}.oci.oraclecloud.com"

SESSION_ID=$(ociq bastion session create-managed-ssh \
  --bastion-id "$BASTION_ID" \
  --target-resource-id "$INSTANCE_ID" \
  --target-os-username ubuntu \
  --target-port 22 \
  --target-private-ip "$PRIVATE_IP" \
  --ssh-public-key-file "$(oci_file "${SSH_KEY}.pub")" \
  --session-ttl 3600 \
  --query "data.id" --raw-output)
if [[ "$SESSION_ID" != ocid1.* ]]; then
  echo "bastion session create failed: ${SESSION_ID}" >&2
  exit 1
fi

cleanup() {
  ociq bastion session delete --session-id "$SESSION_ID" --force >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Poll session lifecycle. Do not --wait-for-state on create: that waits on the
# work request and hangs the whole 20 minutes while the session stays CREATING.
for _ in $(seq 1 120); do
  state=$(ociq bastion session get --session-id "$SESSION_ID" --query "data.\"lifecycle-state\"" --raw-output)
  echo "  bastion session ${state}"
  if [[ "$state" == "ACTIVE" ]]; then
    break
  fi
  if [[ "$state" == "FAILED" || "$state" == "DELETED" ]]; then
    echo "bastion session ${state}" >&2
    exit 1
  fi
  sleep 5
done
if [[ "${state:-}" != "ACTIVE" ]]; then
  echo "bastion session never became ACTIVE (last ${state:-unknown})" >&2
  exit 1
fi

ssh_opts=(
  -i "$SSH_KEY"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o IdentitiesOnly=yes
  -o ProxyCommand="ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -W %h:%p -p 22 ${SESSION_ID}@${BASTION_HOST}"
)

# Wait until cloud-init has docker.
for _ in $(seq 1 60); do
  if ssh "${ssh_opts[@]}" "ubuntu@${PRIVATE_IP}" "command -v docker >/dev/null && sudo docker info >/dev/null 2>&1"; then
    break
  fi
  sleep 10
done

ssh "${ssh_opts[@]}" "ubuntu@${PRIVATE_IP}" "sudo mkdir -p /opt/wattloft && sudo chown ubuntu:ubuntu /opt/wattloft"
scp "${ssh_opts[@]}" \
  "$ROOT/deploy/compose.yml" \
  "$ROOT/deploy/Caddyfile" \
  "$ROOT/deploy/wattloft-env.sh" \
  "$ROOT/deploy/wattloft-env.service" \
  "$ROOT/deploy/history-dump.sh" \
  "$ROOT/deploy/history-dump.service" \
  "$ROOT/deploy/history-dump.timer" \
  "$ROOT/deploy/install-host.sh" \
  "ubuntu@${PRIVATE_IP}:/opt/wattloft/"

ssh "${ssh_opts[@]}" "ubuntu@${PRIVATE_IP}" "$REMOTE_CMD"
