#!/usr/bin/env bash
# Idempotent Always Free OCI provision for issue #7.
# Never creates PAYG SKUs, a Network Load Balancer, a virtual private vault,
# a public HeatWave IP, or public TCP 22.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

source_wattloft_env
require_oci

COMP="${OCI_COMPARTMENT_OCID:?}"
TENANCY="${OCI_CLI_TENANCY:?}"

echo "wattloft provision: compartment ${COMP} region ${REGION}"

ensure_ssh_key
CLOUD_INIT=$(mktemp)
trap 'rm -f "$CLOUD_INIT"' EXIT
sed "s|__OCI_COMPARTMENT_OCID__|${COMP}|g" \
  "$ROOT/deploy/cloud-init.yaml" > "$CLOUD_INIT"

existing() {
  local value
  value=$(id_by_display_name "$@")
  if [[ -n "$value" && "$value" != "null" ]]; then
    printf '%s' "$value"
    return 0
  fi
  return 1
}

echo "→ VCN"
if ! VCN_ID=$(existing "$VCN_NAME" network vcn list --compartment-id "$COMP"); then
  VCN_ID=$(ociq network vcn create \
    --compartment-id "$COMP" \
    --display-name "$VCN_NAME" \
    --cidr-block 10.0.0.0/16 \
    --dns-label wattloft \
    --wait-for-state AVAILABLE \
    --query "data.id" --raw-output)
fi
echo "  $VCN_ID"

echo "→ Internet gateway"
if ! IGW_ID=$(existing "$IGW_NAME" network internet-gateway list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  IGW_ID=$(ociq network internet-gateway create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name "$IGW_NAME" \
    --is-enabled true \
    --wait-for-state AVAILABLE \
    --query "data.id" --raw-output)
fi

echo "→ Route tables"
if ! PUBLIC_RT=$(existing "$PUBLIC_RT_NAME" network route-table list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  PUBLIC_RT=$(ociq network route-table create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name "$PUBLIC_RT_NAME" \
    --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"${IGW_ID}\"}]" \
    --query "data.id" --raw-output)
fi
if ! PRIVATE_RT=$(existing "$PRIVATE_RT_NAME" network route-table list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  PRIVATE_RT=$(ociq network route-table create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name "$PRIVATE_RT_NAME" \
    --route-rules "[]" \
    --query "data.id" --raw-output)
fi

echo "→ Service gateway (HeatWave backups use Oracle Services, not the internet)"
SERVICE_ID=$(ociq network service list \
  --query "data[?contains(name, 'Oracle Services Network')].id | [0]" \
  --raw-output)
SERVICE_CIDR=$(ociq network service get --service-id "$SERVICE_ID" --query "data.\"cidr-block\"" --raw-output)
if ! SGW_ID=$(existing "$SGW_NAME" network service-gateway list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  SGW_ID=$(ociq network service-gateway create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name "$SGW_NAME" \
    --services "[{\"serviceId\":\"${SERVICE_ID}\"}]" \
    --wait-for-state AVAILABLE \
    --query "data.id" --raw-output)
fi
ociq network route-table update --rt-id "$PRIVATE_RT" --force \
  --route-rules "[{\"destination\":\"${SERVICE_CIDR}\",\"destinationType\":\"SERVICE_CIDR_BLOCK\",\"networkEntityId\":\"${SGW_ID}\"}]" \
  >/dev/null

echo "→ Locked security list (no public 22; NSGs own product ports)"
if ! SL_ID=$(existing "$SL_NAME" network security-list list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  SL_ID=$(ociq network security-list create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name "$SL_NAME" \
    --egress-security-rules "[{\"destination\":\"0.0.0.0/0\",\"protocol\":\"all\",\"isStateless\":false}]" \
    --ingress-security-rules "[]" \
    --query "data.id" --raw-output)
fi

echo "→ Subnets"
if ! PUBLIC_SUBNET=$(existing "$PUBLIC_SUBNET_NAME" network subnet list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  PUBLIC_SUBNET=$(ociq network subnet create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name "$PUBLIC_SUBNET_NAME" \
    --cidr-block 10.0.0.0/24 \
    --dns-label public \
    --route-table-id "$PUBLIC_RT" \
    --security-list-ids "[\"${SL_ID}\"]" \
    --prohibit-public-ip-on-vnic false \
    --wait-for-state AVAILABLE \
    --query "data.id" --raw-output)
fi
if ! PRIVATE_SUBNET=$(existing "$PRIVATE_SUBNET_NAME" network subnet list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  PRIVATE_SUBNET=$(ociq network subnet create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name "$PRIVATE_SUBNET_NAME" \
    --cidr-block 10.0.1.0/24 \
    --dns-label private \
    --route-table-id "$PRIVATE_RT" \
    --security-list-ids "[\"${SL_ID}\"]" \
    --prohibit-public-ip-on-vnic true \
    --wait-for-state AVAILABLE \
    --query "data.id" --raw-output)
fi

add_nsg_rules() {
  local nsg_id=$1
  local rules=$2
  local count
  count=$(ociq network nsg rules list --nsg-id "$nsg_id" --query "length(data)" --raw-output) || true
  if [[ -z "$count" || "$count" == "null" || "$count" == "0" ]]; then
    ociq network nsg rules add --nsg-id "$nsg_id" --security-rules "$rules" >/dev/null
  fi
}

echo "→ NSGs"
if ! NSG_VM=$(existing "$NSG_VM_NAME" network nsg list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  NSG_VM=$(ociq network nsg create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name "$NSG_VM_NAME" \
    --query "data.id" --raw-output)
fi
add_nsg_rules "$NSG_VM" '[
  {"direction":"INGRESS","protocol":"6","source":"0.0.0.0/0","sourceType":"CIDR_BLOCK","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
  {"direction":"INGRESS","protocol":"6","source":"0.0.0.0/0","sourceType":"CIDR_BLOCK","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":443,"max":443}}},
  {"direction":"INGRESS","protocol":"6","source":"0.0.0.0/0","sourceType":"CIDR_BLOCK","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":10000,"max":10000}}},
  {"direction":"INGRESS","protocol":"6","source":"10.0.0.0/16","sourceType":"CIDR_BLOCK","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
  {"direction":"EGRESS","protocol":"all","destination":"0.0.0.0/0","destinationType":"CIDR_BLOCK","isStateless":false}
]'

echo "→ Reserved public IPv4"
if ! PUBLIC_IP_ID=$(ociq network public-ip list --compartment-id "$COMP" --lifetime RESERVED --scope REGION \
  --query "data[?\"display-name\"=='${IP_NAME}'].id | [0]" --raw-output) \
  || [[ -z "$PUBLIC_IP_ID" || "$PUBLIC_IP_ID" == "null" ]]; then
  PUBLIC_IP_ID=$(ociq network public-ip create \
    --compartment-id "$COMP" \
    --lifetime RESERVED \
    --display-name "$IP_NAME" \
    --query "data.id" --raw-output)
fi
PUBLIC_IPV4=$(ociq network public-ip get --public-ip-id "$PUBLIC_IP_ID" --query "data.\"ip-address\"" --raw-output)
echo "  $PUBLIC_IPV4"

echo "→ Object Storage bucket ${BUCKET_NAME}"
if ! ociq os bucket get --bucket-name "$BUCKET_NAME" >/dev/null 2>&1; then
  ociq os bucket create --name "$BUCKET_NAME" --compartment-id "$COMP" >/dev/null
fi

echo "→ Default Vault (not virtual private) + software key"
if ! VAULT_ID=$(existing "$VAULT_NAME" kms management vault list --compartment-id "$COMP"); then
  VAULT_ID=$(ociq kms management vault create \
    --compartment-id "$COMP" \
    --display-name "$VAULT_NAME" \
    --vault-type DEFAULT \
    --wait-for-state ACTIVE \
    --max-wait-seconds 1800 \
    --query "data.id" --raw-output)
fi
VAULT_MGMT=$(ociq kms management vault get --vault-id "$VAULT_ID" --query "data.\"management-endpoint\"" --raw-output)
if ! KEY_ID=$(ociq kms management key list --endpoint "$VAULT_MGMT" --compartment-id "$COMP" \
  --query "data[?\"display-name\"=='${KEY_NAME}'].id | [0]" --raw-output) \
  || [[ -z "$KEY_ID" || "$KEY_ID" == "null" ]]; then
  KEY_ID=$(ociq kms management key create \
    --endpoint "$VAULT_MGMT" \
    --compartment-id "$COMP" \
    --display-name "$KEY_NAME" \
    --protection-mode SOFTWARE \
    --key-shape '{"algorithm":"AES","length":32}' \
    --wait-for-state ENABLED \
    --query "data.id" --raw-output)
fi

echo "→ Dynamic group + instance-principal policy"
if ! ociq iam dynamic-group list --compartment-id "$TENANCY" \
  --query "data[?name=='${DYN_GROUP_NAME}'].id | [0]" --raw-output | grep -q ocid1; then
  ociq iam dynamic-group create \
    --compartment-id "$TENANCY" \
    --name "$DYN_GROUP_NAME" \
    --description "Wattloft pet VM instance principal" \
    --matching-rule "All {instance.compartment.id = '${COMP}'}" >/dev/null
fi
if ! ociq iam policy list --compartment-id "$COMP" \
  --query "data[?name=='${POLICY_NAME}'].id | [0]" --raw-output | grep -q ocid1; then
  ociq iam policy create \
    --compartment-id "$COMP" \
    --name "$POLICY_NAME" \
    --description "Vault read and History dumps for the pet VM" \
    --statements "[
      \"Allow dynamic-group ${DYN_GROUP_NAME} to read secret-family in compartment wattloft where target.secret.name='${SECRET_NAME}'\",
      \"Allow dynamic-group ${DYN_GROUP_NAME} to manage objects in compartment wattloft where target.bucket.name='${BUCKET_NAME}'\",
      \"Allow dynamic-group ${DYN_GROUP_NAME} to read buckets in compartment wattloft\"
    ]" >/dev/null
fi

echo "→ HeatWave subnet security list (3306 from the VM subnet only; no NSG)"
if ! SL_DB=$(existing "wattloft-history-sl" network security-list list --compartment-id "$COMP" --vcn-id "$VCN_ID"); then
  SL_DB=$(ociq network security-list create \
    --compartment-id "$COMP" \
    --vcn-id "$VCN_ID" \
    --display-name wattloft-history-sl \
    --egress-security-rules "[{\"destination\":\"0.0.0.0/0\",\"protocol\":\"all\",\"isStateless\":false}]" \
    --ingress-security-rules "[
      {\"source\":\"10.0.0.0/24\",\"protocol\":\"6\",\"isStateless\":false,\"tcpOptions\":{\"destinationPortRange\":{\"min\":3306,\"max\":3306}}},
      {\"source\":\"10.0.0.0/24\",\"protocol\":\"6\",\"isStateless\":false,\"tcpOptions\":{\"destinationPortRange\":{\"min\":33060,\"max\":33060}}}
    ]" \
    --query "data.id" --raw-output)
fi
ociq network subnet update --subnet-id "$PRIVATE_SUBNET" --security-list-ids "[\"${SL_DB}\"]" --force >/dev/null
MYSQL_PASSWORD_FILE="${HOME}/.oci/wattloft-mysql-password"
FAILED_DB=$(ociq mysql db-system list --compartment-id "$COMP" \
  --query "data[?\"display-name\"=='${DB_NAME}' && \"lifecycle-state\"=='FAILED'].id | [0]" \
  --raw-output) || true
if [[ -n "$FAILED_DB" && "$FAILED_DB" != "null" ]]; then
  echo "  deleting FAILED ${FAILED_DB}"
  ociq mysql db-system delete --db-system-id "$FAILED_DB" --force >/dev/null
  wait_lifecycle DELETED 1800 mysql db-system get --db-system-id "$FAILED_DB" || true
fi
if ! DB_ID=$(ociq mysql db-system list --compartment-id "$COMP" \
  --query "data[?\"display-name\"=='${DB_NAME}' && \"lifecycle-state\"=='ACTIVE'].id | [0]" \
  --raw-output) || [[ -z "$DB_ID" || "$DB_ID" == "null" ]]; then
  DB_ID=""
fi
if [[ -z "$DB_ID" ]]; then
  if [[ -f "$MYSQL_PASSWORD_FILE" ]]; then
    MYSQL_PASSWORD=$(cat "$MYSQL_PASSWORD_FILE")
  else
    MYSQL_PASSWORD=$(mysql_password)
    printf '%s' "$MYSQL_PASSWORD" > "$MYSQL_PASSWORD_FILE"
    chmod 600 "$MYSQL_PASSWORD_FILE" 2>/dev/null || true
  fi
  DB_ID=$(ociq mysql db-system create \
    --compartment-id "$COMP" \
    --shape-name MySQL.Free \
    --subnet-id "$PRIVATE_SUBNET" \
    --availability-domain "$AD" \
    --admin-username wattloftadmin \
    --admin-password "$MYSQL_PASSWORD" \
    --display-name "$DB_NAME" \
    --query "data.id" --raw-output)
  echo "  creating ${DB_ID}"
else
  MYSQL_PASSWORD=$(cat "$MYSQL_PASSWORD_FILE")
fi
wait_lifecycle ACTIVE 3600 mysql db-system get --db-system-id "$DB_ID"
DB_IP=$(ociq mysql db-system get --db-system-id "$DB_ID" --query "data.\"ip-address\"" --raw-output)
if [[ -z "$DB_IP" || "$DB_IP" == "null" ]]; then
  DB_IP=$(ociq mysql db-system get --db-system-id "$DB_ID" --query "data.endpoints[0].ip-address" --raw-output)
fi
echo "  HeatWave ${DB_IP} (analytics attached: $(ociq mysql db-system get --db-system-id "$DB_ID" --query "data.\"is-heat-wave-cluster-attached\"" --raw-output))"

DATABASE_URL="mysql://wattloftadmin:$(
  python -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$MYSQL_PASSWORD"
)@${DB_IP}:3306/wattloft?ssl=true"

echo "→ Compute (Ampere A1 2 OCPU / 12 GB, then E2.1.Micro)"
INSTANCE_ID=$(running_instance_id || true)
if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "null" ]]; then
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
  echo "  trying Ampere A1"
  INSTANCE_ID=$(launch VM.Standard.A1.Flex "$IMAGE_A1" --shape-config '{"ocpus":2.0,"memoryInGBs":12.0}')
  status=$?
  set -e
  if [[ $status -ne 0 || -z "$INSTANCE_ID" ]]; then
    echo "  Ampere A1 unavailable; falling back to VM.Standard.E2.1.Micro"
    INSTANCE_ID=$(launch VM.Standard.E2.1.Micro "$IMAGE_MICRO")
  fi
fi
echo "  $INSTANCE_ID"

echo "→ Assign reserved public IPv4"
assign_reserved_ipv4 "$INSTANCE_ID" "$PUBLIC_IP_ID"
echo "  attached"

echo "→ Bastion (no public TCP 22 on the VM)"
if ! BASTION_ID=$(ociq bastion bastion list --compartment-id "$COMP" --all \
  --query "data[?name=='${BASTION_NAME}' && \"lifecycle-state\"!='DELETED'].id | [0]" --raw-output) \
  || [[ -z "$BASTION_ID" || "$BASTION_ID" == "null" ]]; then
  BASTION_CLIENT_CIDRS="${BASTION_CLIENT_CIDR_LIST:-${OPERATOR_CLIENT_CIDR:-${OPERATOR_CIDR:-}}}"
  if [[ -n "$BASTION_CLIENT_CIDRS" ]]; then
    if [[ "$BASTION_CLIENT_CIDRS" != \[* ]]; then
      BASTION_CLIENT_CIDRS="[\"${BASTION_CLIENT_CIDRS}\"]"
    fi
  else
    BASTION_CLIENT_CIDRS='["198.51.100.0/24"]'
  fi
  BASTION_ID=$(ociq bastion bastion create \
    --bastion-type STANDARD \
    --compartment-id "$COMP" \
    --target-subnet-id "$PUBLIC_SUBNET" \
    --name "$BASTION_NAME" \
    --client-cidr-list "$BASTION_CLIENT_CIDRS" \
    --query "data.id" --raw-output)
  echo "  creating ${BASTION_ID}"
fi
wait_lifecycle ACTIVE 600 bastion bastion get --bastion-id "$BASTION_ID"

if [[ -z "${OPERATOR_PASSWORD:-}" ]]; then
  OPERATOR_PASSWORD=$(operator_password)
fi

ENV_FILE="${HOME}/.oci/wattloft.env"
touch "$ENV_FILE"
upsert_env() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}
upsert_env OCI_COMPARTMENT_OCID "$COMP"
upsert_env WATTLOFT_RESERVED_IPV4 "$PUBLIC_IPV4"
upsert_env WATTLOFT_INSTANCE_OCID "$INSTANCE_ID"
upsert_env WATTLOFT_BASTION_OCID "$BASTION_ID"
upsert_env WATTLOFT_VAULT_OCID "$VAULT_ID"
upsert_env WATTLOFT_KEY_OCID "$KEY_ID"
upsert_env WATTLOFT_DB_OCID "$DB_ID"
upsert_env DATABASE_URL "$DATABASE_URL"
upsert_env OPERATOR_PASSWORD "$OPERATOR_PASSWORD"
if [[ -n "${OPERATOR_PASSKEY_CREDENTIAL:-}" ]]; then
  upsert_env OPERATOR_PASSKEY_CREDENTIAL "$OPERATOR_PASSKEY_CREDENTIAL"
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  printf '%s' "$DATABASE_URL" | gh secret set DATABASE_URL
  printf '%s' "$OPERATOR_PASSWORD" | gh secret set OPERATOR_PASSWORD
  gh secret set OCI_SSH_PRIVATE_KEY < "$SSH_KEY"
  gh variable set OCI_BASTION_OCID --body "$BASTION_ID"
  gh variable set OCI_INSTANCE_OCID --body "$INSTANCE_ID"
  printf '%s' "$PUBLIC_IPV4" | gh secret set WATTLOFT_RESERVED_IPV4
  gh variable delete WATTLOFT_RESERVED_IPV4 >/dev/null 2>&1 || true
  gh variable set OCI_VAULT_OCID --body "$VAULT_ID"
  gh variable set OCI_KEY_OCID --body "$KEY_ID"
fi

if [[ -n "${DESEC_TOKEN:-}" && -n "${WATTLOFT_HOSTNAME:-}" ]]; then
  echo "→ deSEC DNS-only A record"
  WATTLOFT_RESERVED_IPV4="$PUBLIC_IPV4" bash "$SCRIPT_DIR/desec-upsert.sh" || \
    echo "  deSEC upsert failed; set the A record to ${PUBLIC_IPV4} by hand"
fi

echo
echo "Always Free pet is up."
echo "  reserved IPv4: ${PUBLIC_IPV4}"
echo "  instance:      ${INSTANCE_ID}"
echo "  HeatWave:      ${DB_ID} @ ${DB_IP}"
echo "  bastion:       ${BASTION_ID}"
echo "Plant view: https://${WATTLOFT_HOSTNAME:-<deSEC hostname>}"
echo "Operator password is in ${ENV_FILE} and the GitHub secret OPERATOR_PASSWORD."
echo "If Ampere A1 stays out of capacity for a week, stop and use Lightsail dual-stack nano (ADR 0020); do not buy PAYG."
