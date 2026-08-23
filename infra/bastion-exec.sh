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
if [[ $# -eq 0 ]]; then
  # Diagnostic one-liners may skip copy; a default install always deploys files
  # and waits for docker. Inherited SKIP_* from a prior shell must not leak.
  unset SKIP_COPY SKIP_DOCKER_WAIT
fi

PRIVATE_IP=$(ociq compute instance list-vnics --instance-id "$INSTANCE_ID" \
  --query "data[0].\"private-ip\"" --raw-output)
BASTION_HOST="host.bastion.${REGION}.oci.oraclecloud.com"

SESSION_ID=$(ociq bastion session create-port-forwarding \
  --bastion-id "$BASTION_ID" \
  --target-resource-id "$INSTANCE_ID" \
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

# Port-forward to sshd. Managed SSH stays CREATING when the plugin cannot
# finish localhost SSH on a 1 GB Micro still running cloud-init.
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
  echo "bastion session did not become ACTIVE" >&2
  exit 1
fi

ssh_opts=(
  -i "$SSH_KEY"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o IdentitiesOnly=yes
  -o ProxyCommand="ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -W %h:%p -p 22 ${SESSION_ID}@${BASTION_HOST}"
)

# First hop through Bastion sometimes rejects the key once; retry.
for _ in $(seq 1 30); do
  if ssh "${ssh_opts[@]}" "ubuntu@${PRIVATE_IP}" true; then
    break
  fi
  sleep 5
done

# Wait until cloud-init has docker and oci-cli (wattloft-env needs both).
if [[ -z "${SKIP_DOCKER_WAIT:-}" ]]; then
  ready=0
  for _ in $(seq 1 90); do
    if ssh "${ssh_opts[@]}" "ubuntu@${PRIVATE_IP}" \
      "command -v docker >/dev/null && sudo docker info >/dev/null 2>&1 && command -v oci >/dev/null"; then
      ready=1
      break
    fi
    sleep 10
  done
  if [[ "$ready" != 1 ]]; then
    echo "docker/oci-cli not ready after cloud-init wait" >&2
    exit 1
  fi
fi

if [[ -z "${SKIP_COPY:-}" ]]; then
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
  ssh "${ssh_opts[@]}" "ubuntu@${PRIVATE_IP}" "sed -i 's/\r$//' /opt/wattloft/*.sh"
fi

ssh "${ssh_opts[@]}" "ubuntu@${PRIVATE_IP}" "$REMOTE_CMD"
