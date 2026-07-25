#!/usr/bin/env bash

# Shared fail-closed helpers for Seller OS database backup and restore.
# This file intentionally contains no connection strings, credentials, or
# environment-specific identifiers.

set -Eeuo pipefail
umask 077

SELLER_OS_BACKUP_DEFAULT_DIR="/var/backups/seller-os"
SELLER_OS_BACKUP_FORMAT_VERSION="SELLER_OS_SUPABASE_LOGICAL_BACKUP_V1"

seller_os_die() {
  printf 'Seller OS backup error: %s\n' "$1" >&2
  exit 1
}

seller_os_require_command() {
  command -v "$1" >/dev/null 2>&1 || seller_os_die "REQUIRED_COMMAND_MISSING_$2"
}

seller_os_safe_label() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$ ]]
}

seller_os_validate_backup_id() {
  [[ "$1" =~ ^seller-os_[A-Za-z0-9][A-Za-z0-9._-]{1,63}_[0-9]{8}T[0-9]{6}Z$ ]]
}

seller_os_validate_root_env_file() {
  local env_file=$1 owner mode
  [[ "$env_file" == /* ]] || seller_os_die "ENV_FILE_ABSOLUTE_PATH_REQUIRED"
  [[ -f "$env_file" && ! -L "$env_file" ]] || seller_os_die "ENV_FILE_REGULAR_ROOT_FILE_REQUIRED"
  owner=$(stat -c '%u' -- "$env_file") || seller_os_die "ENV_FILE_OWNER_READ_FAILED"
  mode=$(stat -c '%a' -- "$env_file") || seller_os_die "ENV_FILE_MODE_READ_FAILED"
  [[ "$owner" == "0" ]] || seller_os_die "ENV_FILE_ROOT_OWNERSHIP_REQUIRED"
  [[ "$mode" == "400" || "$mode" == "600" ]] || seller_os_die "ENV_FILE_MODE_0400_OR_0600_REQUIRED"
}

# Parse a deliberately small KEY=value format without sourcing or evaluating
# shell code. URLs must be percent-encoded and remain on one line.
seller_os_load_root_env_file() {
  local env_file=$1
  shift
  seller_os_validate_root_env_file "$env_file"
  local allowed=" $* " line key value
  local -A seen=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || seller_os_die "ENV_FILE_LINE_INVALID"
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    [[ "$allowed" == *" $key "* ]] || seller_os_die "ENV_FILE_KEY_NOT_ALLOWED_$key"
    [[ -z "${seen[$key]+present}" ]] || seller_os_die "ENV_FILE_KEY_DUPLICATED_$key"
    seen[$key]=1
    [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || seller_os_die "ENV_FILE_VALUE_INVALID_$key"
    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$env_file"
}

seller_os_validate_retention_days() {
  [[ "$1" =~ ^[0-9]{1,4}$ ]] || seller_os_die "RETENTION_DAYS_INVALID"
  (( 10#$1 >= 1 && 10#$1 <= 3650 )) || seller_os_die "RETENTION_DAYS_OUT_OF_RANGE"
}

seller_os_validate_backup_dir() {
  local requested=$1 create=${2:-false} normalized resolved owner mode
  [[ "$requested" == /* ]] || seller_os_die "BACKUP_DIR_ABSOLUTE_PATH_REQUIRED"
  [[ "$(basename -- "$requested")" == "seller-os" ]] || seller_os_die "BACKUP_DIR_BASENAME_MUST_BE_SELLER_OS"
  normalized=$(realpath -m -- "$requested") || seller_os_die "BACKUP_DIR_NORMALIZATION_FAILED"
  [[ "$normalized" != "/" && "$normalized" != "/var" && "$normalized" != "/var/backups" ]] || seller_os_die "BACKUP_DIR_SCOPE_TOO_BROAD"
  if [[ "$create" == "true" ]]; then
    install -d -m 0700 -- "$normalized" || seller_os_die "BACKUP_DIR_CREATE_FAILED"
  fi
  [[ -d "$normalized" && ! -L "$normalized" ]] || seller_os_die "BACKUP_DIR_SECURE_DIRECTORY_REQUIRED"
  resolved=$(realpath -e -- "$normalized") || seller_os_die "BACKUP_DIR_RESOLUTION_FAILED"
  [[ "$resolved" == "$normalized" ]] || seller_os_die "BACKUP_DIR_SYMLINK_COMPONENT_REJECTED"
  owner=$(stat -c '%u' -- "$resolved") || seller_os_die "BACKUP_DIR_OWNER_READ_FAILED"
  mode=$(stat -c '%a' -- "$resolved") || seller_os_die "BACKUP_DIR_MODE_READ_FAILED"
  [[ "$owner" == "0" ]] || seller_os_die "BACKUP_DIR_ROOT_OWNERSHIP_REQUIRED"
  [[ "$mode" == "700" ]] || seller_os_die "BACKUP_DIR_MODE_0700_REQUIRED"
  printf '%s\n' "$resolved"
}

# Hash the endpoint identity without retaining or printing hostname, username,
# database name, query parameters, or password. Password changes intentionally
# produce the same fingerprint.
seller_os_connection_fingerprint() {
  local database_url=$1
  python3 - "$database_url" <<'PY'
import hashlib
import sys
from urllib.parse import unquote, urlsplit

try:
    parsed = urlsplit(sys.argv[1])
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError()
    if not parsed.hostname or parsed.username is None or not parsed.path.strip("/"):
        raise ValueError()
    hostname = parsed.hostname.lower()
    username = unquote(parsed.username)
    project_ref = None
    if username.startswith("postgres.") and len(username.split(".", 1)[1]) > 0:
        project_ref = username.split(".", 1)[1].lower()
    elif hostname.startswith("db.") and hostname.endswith(".supabase.co"):
        project_ref = hostname[3:-len(".supabase.co")].lower()
    endpoint_identity = f"supabase-project:{project_ref}" if project_ref else "\x1e".join([
        hostname,
        str(parsed.port or 5432),
        username,
    ])
    canonical = "\x1f".join([
        endpoint_identity,
        unquote(parsed.path.lstrip("/")),
    ])
except Exception:
    print("DATABASE_URL_INVALID", file=sys.stderr)
    raise SystemExit(2)
print(hashlib.sha256(canonical.encode("utf-8")).hexdigest())
PY
}

# A second, live fingerprint helps reject aliases that point to the same
# database. Only its SHA-256 digest leaves this function.
seller_os_live_database_fingerprint() {
  local database_url=$1 identity
  identity=$(psql "$database_url" -X -A -t -q \
    --set=ON_ERROR_STOP=1 \
    --command "select current_database() || chr(31) || coalesce(inet_server_addr()::text, 'local') || chr(31) || coalesce(inet_server_port()::text, '0')" \
    2>/dev/null) \
    || seller_os_die "DATABASE_IDENTITY_PREFLIGHT_FAILED"
  [[ -n "$identity" && "$identity" != *$'\n'* ]] || seller_os_die "DATABASE_IDENTITY_PREFLIGHT_INVALID"
  printf '%s' "$identity" | sha256sum | awk '{print $1}'
}

seller_os_audit() {
  local audit_file=$1 action=$2 backup_id=$3 source_label=$4 destination_label=$5 outcome=$6
  seller_os_safe_label "$source_label" || seller_os_die "AUDIT_SOURCE_LABEL_INVALID"
  if [[ "$destination_label" != "none" ]]; then
    seller_os_safe_label "$destination_label" || seller_os_die "AUDIT_DESTINATION_LABEL_INVALID"
  fi
  seller_os_validate_backup_id "$backup_id" || seller_os_die "AUDIT_BACKUP_ID_INVALID"
  [[ "$action" =~ ^[A-Z_]+$ && "$outcome" =~ ^[A-Z_]+$ ]] || seller_os_die "AUDIT_VALUE_INVALID"
  printf '%s\taction=%s\tbackup_id=%s\tsource_label=%s\tdestination_label=%s\toutcome=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$action" "$backup_id" "$source_label" "$destination_label" "$outcome" \
    >> "$audit_file"
  chmod 0600 -- "$audit_file"
}

seller_os_bundle_members() {
  local backup_id=$1
  printf '%s\n' \
    "${backup_id}_roles.sql" \
    "${backup_id}_schema.sql" \
    "${backup_id}_data.sql" \
    "${backup_id}_history_schema.sql" \
    "${backup_id}_history_data.sql" \
    "${backup_id}_database.custom"
}

seller_os_write_manifest() {
  local manifest=$1 backup_id=$2 created_at=$3 source_label=$4 connection_fingerprint=$5
  local live_fingerprint=$6 encrypted_name=$7 checksum_name=$8 encrypted_sha=$9 retention_days=${10}
  python3 - "$manifest" "$backup_id" "$created_at" "$source_label" \
    "$connection_fingerprint" "$live_fingerprint" "$encrypted_name" "$checksum_name" \
    "$encrypted_sha" "$retention_days" "$SELLER_OS_BACKUP_FORMAT_VERSION" <<'PY'
import json
import re
import sys

(path, backup_id, created_at, source_label, connection_fingerprint,
 live_fingerprint, encrypted_name, checksum_name, encrypted_sha,
 retention_days, version) = sys.argv[1:]
safe_name = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,180}$")
sha = re.compile(r"^[0-9a-f]{64}$")
if not all(safe_name.fullmatch(value) for value in (backup_id, source_label, encrypted_name, checksum_name)):
    raise SystemExit("MANIFEST_SAFE_VALUE_INVALID")
if not all(sha.fullmatch(value) for value in (connection_fingerprint, live_fingerprint, encrypted_sha)):
    raise SystemExit("MANIFEST_FINGERPRINT_INVALID")
members = [
    f"{backup_id}_roles.sql",
    f"{backup_id}_schema.sql",
    f"{backup_id}_data.sql",
    f"{backup_id}_history_schema.sql",
    f"{backup_id}_history_data.sql",
    f"{backup_id}_database.custom",
]
manifest = {
    "version": version,
    "backupId": backup_id,
    "createdAtUtc": created_at,
    "sourceLabel": source_label,
    "sourceConnectionFingerprintSha256": connection_fingerprint,
    "sourceDatabaseFingerprintSha256": live_fingerprint,
    "encryptedFile": encrypted_name,
    "checksumFile": checksum_name,
    "encryptedSha256": encrypted_sha,
    "retentionDays": int(retention_days),
    "format": "supabase-cli-logical-set+pg_dump-custom-supplement",
    "members": members,
    "restoreOrder": ["roles", "schema", "data", "migration-history"],
    "dataExclusions": ["storage.buckets_vectors", "storage.vector_indexes"],
    "coverage": {
        "databaseLogicalSchemaAndData": True,
        "supabaseMigrationHistory": True,
        "customArchiveSupplement": True,
        "storageObjectBytes": False,
        "customAuthStorageSchemaChanges": False,
    },
}
with open(path, "x", encoding="utf-8") as output:
    json.dump(manifest, output, sort_keys=True, separators=(",", ":"))
    output.write("\n")
PY
  chmod 0600 -- "$manifest"
}

seller_os_read_manifest() {
  local manifest=$1 expected_backup_id=$2 expected_encrypted=$3 expected_checksum=$4
  python3 - "$manifest" "$expected_backup_id" "$expected_encrypted" "$expected_checksum" "$SELLER_OS_BACKUP_FORMAT_VERSION" <<'PY'
import json
import re
import sys

path, expected_id, expected_encrypted, expected_checksum, expected_version = sys.argv[1:]
with open(path, "r", encoding="utf-8") as source:
    manifest = json.load(source)
if manifest.get("version") != expected_version or manifest.get("backupId") != expected_id:
    raise SystemExit("MANIFEST_IDENTITY_MISMATCH")
if manifest.get("encryptedFile") != expected_encrypted or manifest.get("checksumFile") != expected_checksum:
    raise SystemExit("MANIFEST_FILE_MISMATCH")
sha = re.compile(r"^[0-9a-f]{64}$")
for key in ("sourceConnectionFingerprintSha256", "sourceDatabaseFingerprintSha256", "encryptedSha256"):
    if not sha.fullmatch(str(manifest.get(key, ""))):
        raise SystemExit("MANIFEST_FINGERPRINT_INVALID")
expected_members = [
    f"{expected_id}_roles.sql",
    f"{expected_id}_schema.sql",
    f"{expected_id}_data.sql",
    f"{expected_id}_history_schema.sql",
    f"{expected_id}_history_data.sql",
    f"{expected_id}_database.custom",
]
if manifest.get("members") != expected_members:
    raise SystemExit("MANIFEST_MEMBERS_INVALID")
serialized = json.dumps(manifest).lower()
if "postgresql://" in serialized or "postgres://" in serialized or "password" in serialized or "databaseurl" in serialized:
    raise SystemExit("MANIFEST_SECRET_MATERIAL_REJECTED")
print("\t".join([
    str(manifest["sourceLabel"]),
    str(manifest["sourceConnectionFingerprintSha256"]),
    str(manifest["sourceDatabaseFingerprintSha256"]),
    str(manifest["encryptedSha256"]),
]))
PY
}

seller_os_validate_checksum_file() {
  local checksum_file=$1 encrypted_name=$2 manifest_name=$3
  python3 - "$checksum_file" "$encrypted_name" "$manifest_name" <<'PY'
import re
import sys

path, encrypted_name, manifest_name = sys.argv[1:]
with open(path, "r", encoding="ascii") as source:
    lines = [line.rstrip("\n") for line in source]
pattern = re.compile(r"^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]{1,180})$")
if len(lines) != 2:
    raise SystemExit("CHECKSUM_FILE_LINE_COUNT_INVALID")
parsed = [pattern.fullmatch(line) for line in lines]
if not all(parsed):
    raise SystemExit("CHECKSUM_FILE_FORMAT_INVALID")
if [match.group(2) for match in parsed] != [encrypted_name, manifest_name]:
    raise SystemExit("CHECKSUM_FILE_TARGET_INVALID")
PY
}

seller_os_validate_tar_members() {
  local listing_file=$1 backup_id=$2
  python3 - "$listing_file" "$backup_id" <<'PY'
import sys

path, backup_id = sys.argv[1:]
expected = [
    f"{backup_id}_roles.sql",
    f"{backup_id}_schema.sql",
    f"{backup_id}_data.sql",
    f"{backup_id}_history_schema.sql",
    f"{backup_id}_history_data.sql",
    f"{backup_id}_database.custom",
]
with open(path, "r", encoding="utf-8") as source:
    members = [line.rstrip("\n") for line in source]
if members != expected:
    raise SystemExit("BACKUP_TAR_MEMBERS_INVALID")
PY
}
