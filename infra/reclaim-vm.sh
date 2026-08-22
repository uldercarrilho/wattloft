#!/usr/bin/env bash
# Simulated VM reclaim: terminate the pet, launch again, reassign the reserved
# public IPv4. History (HeatWave) and the hostname stay put.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

if [[ -f "${HOME}/.oci/wattloft.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${HOME}/.oci/wattloft.env"
  set +a
fi
require_oci

ensure_ssh_key
PUBLIC_SUBNET=$(id_by_display_name "$PUBLIC_SUBNET_NAME" network subnet list --compartment-id "$COMP")
NSG_VM=$(id_by_display_name "$NSG_VM_NAME" network nsg list --compartment-id "$COMP")
PUBLIC_IP_ID=$(ociq network public-ip list --compartment-id "$COMP" --lifetime RESERVED --scope REGION \
  --query "data[?\"display-name\"=='${IP_NAME}'].id | [0]" --raw-output)

OLD_ID=$(running_instance_id || true)
if [[ -n "$OLD_ID" && "$OLD_ID" != "null" ]]; then
  echo "terminating ${OLD_ID}"
  ociq compute instance terminate --instance-id "$OLD_ID" --preserve-boot-volume false --force \
    --wait-for-state TERMINATED --max-wait-seconds 900 >/dev/null
fi

CLOUD_INIT=$(mktemp)
trap 'rm -f "$CLOUD_INIT"' EXIT
sed "s|__OCI_COMPARTMENT_OCID__|${COMP}|g" "$ROOT/deploy/cloud-init.yaml" > "$CLOUD_INIT"

launch() {
  local shape=$1 image=$2
  shift 2
  ociq compute instance launch \
    --availability-domain "$AD" \
    --compartment-id "$COMP" \
    --display-name "$VM_NAME" \
    --shape "$shape" \
    --image-id "$image" \
    --subnet-id "$PUBLIC_SUBNET" \
    --assign-public-ip false \
    --nsg-ids "$(printf '["%s"]' "$NSG_VM")" \
    --ssh-authorized-keys-file "$(oci_file "${SSH_KEY}.pub")" \
    --user-data-file "$(oci_file "$CLOUD_INIT")" \
    --agent-config "file://$(oci_file "$SCRIPT_DIR/instance-agent-config.json")" \
    "$@" \
    --wait-for-state RUNNING \
    --max-wait-seconds 900 \
    --query "data.id" --raw-output
}

set +e
INSTANCE_ID=$(launch VM.Standard.A1.Flex "$IMAGE_A1" --shape-config '{"ocpus":2.0,"memoryInGBs":12.0}')
status=$?
set -e
if [[ $status -ne 0 || -z "${INSTANCE_ID:-}" ]]; then
  echo "Ampere A1 unavailable; falling back to VM.Standard.E2.1.Micro"
  INSTANCE_ID=$(launch VM.Standard.E2.1.Micro "$IMAGE_MICRO")
fi

VNIC_ID=$(ociq compute instance list-vnics --instance-id "$INSTANCE_ID" --query "data[0].id" --raw-output)
PRIVATE_IP_ID=$(ociq network private-ip list --vnic-id "$VNIC_ID" --query "data[0].id" --raw-output)
ociq network public-ip update --public-ip-id "$PUBLIC_IP_ID" --private-ip-id "$PRIVATE_IP_ID" >/dev/null

if command -v gh >/dev/null 2>&1; then
  gh variable set OCI_INSTANCE_OCID --body "$INSTANCE_ID"
fi
echo "rebuilt instance ${INSTANCE_ID}; reserved IPv4 reassigned"
