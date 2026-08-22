#!/usr/bin/env bash
# Shared OCI helpers for provision, reclaim, Vault write, and Bastion exec.
# shellcheck disable=SC2034

set -euo pipefail
set +H
export OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING=True

REGION="${OCI_CLI_REGION:-sa-saopaulo-1}"
AD="${OCI_AVAILABILITY_DOMAIN:-BNTx:SA-SAOPAULO-1-AD-1}"
COMP="${OCI_COMPARTMENT_OCID:-}"
TENANCY="${OCI_CLI_TENANCY:-}"

VCN_NAME=wattloft-vcn
PUBLIC_SUBNET_NAME=wattloft-public
PRIVATE_SUBNET_NAME=wattloft-private
SGW_NAME=wattloft-sgw
IGW_NAME=wattloft-igw
PUBLIC_RT_NAME=wattloft-public-rt
PRIVATE_RT_NAME=wattloft-private-rt
SL_NAME=wattloft-locked
NSG_VM_NAME=wattloft-vm
NSG_DB_NAME=wattloft-history
IP_NAME=wattloft-ip
VM_NAME=wattloft-vm
DB_NAME=wattloft-history
BASTION_NAME=wattloft-bastion
VAULT_NAME=wattloft-vault
KEY_NAME=wattloft-env-key
BUCKET_NAME=wattloft-history-dumps
SECRET_NAME=wattloft-env
DYN_GROUP_NAME=wattloft-instances
POLICY_NAME=wattloft-instance
SSH_KEY="${WATTLOFT_SSH_KEY:-${HOME}/.oci/wattloft_deploy}"

IMAGE_A1="ocid1.image.oc1.sa-saopaulo-1.aaaaaaaauynsc4hq5gh2pqes4op5ewmaaambnj6hhqht4b7vrnzu4f34qaca"
IMAGE_MICRO="ocid1.image.oc1.sa-saopaulo-1.aaaaaaaak3ahcvhqirlkqrf65raspxiegcyqxkiu3cvcv4ha6rwebmnv3bgq"

require_oci() {
  COMP="${OCI_COMPARTMENT_OCID:?set OCI_COMPARTMENT_OCID}"
  TENANCY="${OCI_CLI_TENANCY:?set OCI_CLI_TENANCY}"
  REGION="${OCI_CLI_REGION:-$REGION}"
}

oci_file() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

ociq() {
  oci --region "$REGION" "$@"
}

id_by_display_name() {
  local name=$1
  shift
  local value=""
  value=$(ociq "$@" --query "data[?\"display-name\"=='${name}'].id | [0]" --raw-output) || true
  printf '%s' "$value"
}

running_instance_id() {
  ociq compute instance list --compartment-id "$COMP" \
    --lifecycle-state RUNNING \
    --query "data[?\"display-name\"=='${VM_NAME}'].id | [0]" \
    --raw-output
}

wait_lifecycle() {
  local want=$1
  local seconds=$2
  shift 2
  local elapsed=0 state
  while (( elapsed < seconds )); do
    state=$(ociq "$@" --query "data.\"lifecycle-state\"" --raw-output) || true
    echo "  $state"
    if [[ "$state" == "$want" ]]; then
      return 0
    fi
    if [[ "$want" != "DELETED" && ( "$state" == "FAILED" || "$state" == "DELETED" ) ]]; then
      return 1
    fi
    sleep 20
    elapsed=$((elapsed + 20))
  done
  return 1
}

ensure_ssh_key() {
  if [[ ! -f "$SSH_KEY" ]]; then
    mkdir -p "$(dirname "$SSH_KEY")"
    ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "wattloft-ci"
  fi
  [[ -f "${SSH_KEY}.pub" ]]
}

mysql_password() {
  # HeatWave admin password: upper, lower, digit, special, 8–32 chars.
  # Avoid '!' so bash history expansion cannot eat the value.
  printf 'Wl1#%s' "$(openssl rand -hex 12)"
}

operator_password() {
  openssl rand -base64 24 | tr -d '\n'
}
