#!/usr/bin/env bash

set -Eeuo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=ops/seller-os-backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage: sudo ./backup.sh [options]

Creates one encrypted Seller OS Supabase logical-backup bundle.

Options:
  --env-file PATH       Root-owned 0400/0600 config file
                        (default: /etc/seller-os/backup.env)
  --backup-dir PATH     Secure root-owned 0700 directory ending in /seller-os
  --retention-days N    Retain completed bundles for 1..3650 days
  --help                Show this help

This command never prints database URLs and never writes an unencrypted dump
outside its private temporary directory.
EOF
}

env_file="/etc/seller-os/backup.env"
cli_backup_dir=""
cli_retention_days=""
while (($#)); do
  case "$1" in
    --env-file)
      (($# >= 2)) || seller_os_die "ENV_FILE_ARGUMENT_REQUIRED"
      env_file=$2
      shift 2
      ;;
    --backup-dir)
      (($# >= 2)) || seller_os_die "BACKUP_DIR_ARGUMENT_REQUIRED"
      cli_backup_dir=$2
      shift 2
      ;;
    --retention-days)
      (($# >= 2)) || seller_os_die "RETENTION_ARGUMENT_REQUIRED"
      cli_retention_days=$2
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *) seller_os_die "UNKNOWN_ARGUMENT" ;;
  esac
done

seller_os_load_root_env_file "$env_file" \
  SELLER_OS_BACKUP_SOURCE_DATABASE_URL \
  SELLER_OS_BACKUP_SOURCE_LABEL \
  SELLER_OS_BACKUP_GPG_RECIPIENT \
  SELLER_OS_BACKUP_DIR \
  SELLER_OS_BACKUP_RETENTION_DAYS

: "${SELLER_OS_BACKUP_SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL_REQUIRED}"
: "${SELLER_OS_BACKUP_SOURCE_LABEL:?SOURCE_LABEL_REQUIRED}"
: "${SELLER_OS_BACKUP_GPG_RECIPIENT:?GPG_RECIPIENT_REQUIRED}"
seller_os_safe_label "$SELLER_OS_BACKUP_SOURCE_LABEL" || seller_os_die "SOURCE_LABEL_INVALID"
[[ ${#SELLER_OS_BACKUP_GPG_RECIPIENT} -le 256 && "$SELLER_OS_BACKUP_GPG_RECIPIENT" != *$'\n'* ]] \
  || seller_os_die "GPG_RECIPIENT_INVALID"

backup_dir=${cli_backup_dir:-${SELLER_OS_BACKUP_DIR:-$SELLER_OS_BACKUP_DEFAULT_DIR}}
retention_days=${cli_retention_days:-${SELLER_OS_BACKUP_RETENTION_DAYS:-30}}
seller_os_validate_retention_days "$retention_days"

for requirement in \
  "supabase:SUPABASE_CLI" "docker:DOCKER" "psql:PSQL" "pg_dump:PG_DUMP" \
  "pg_restore:PG_RESTORE" "gpg:GPG" "sha256sum:SHA256SUM" "tar:TAR" \
  "flock:FLOCK" "python3:PYTHON3" "realpath:REALPATH" "install:INSTALL"; do
  seller_os_require_command "${requirement%%:*}" "${requirement##*:}"
done
docker info >/dev/null 2>&1 || seller_os_die "DOCKER_DAEMON_UNAVAILABLE"
supabase --version >/dev/null 2>&1 || seller_os_die "SUPABASE_CLI_UNAVAILABLE"
gpg --batch --list-keys "$SELLER_OS_BACKUP_GPG_RECIPIENT" >/dev/null 2>&1 \
  || seller_os_die "GPG_RECIPIENT_PUBLIC_KEY_UNAVAILABLE"

backup_dir=$(seller_os_validate_backup_dir "$backup_dir" true)
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || seller_os_die "BACKUP_ALREADY_RUNNING"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
backup_id="seller-os_${SELLER_OS_BACKUP_SOURCE_LABEL}_${stamp}"
seller_os_validate_backup_id "$backup_id" || seller_os_die "BACKUP_ID_INVALID"

encrypted_name="${backup_id}.tar.gpg"
manifest_name="${backup_id}.manifest.json"
checksum_name="${backup_id}.sha256"
encrypted_path="$backup_dir/$encrypted_name"
manifest_path="$backup_dir/$manifest_name"
checksum_path="$backup_dir/$checksum_name"
audit_file="$backup_dir/backup-audit.log"
for final_path in "$encrypted_path" "$manifest_path" "$checksum_path"; do
  [[ ! -e "$final_path" ]] || seller_os_die "BACKUP_ID_COLLISION"
done

work_dir=$(mktemp -d "${TMPDIR:-/var/tmp}/seller-os-backup.XXXXXXXX")
encrypted_partial="$backup_dir/.${encrypted_name}.partial"
manifest_partial="$backup_dir/.${manifest_name}.partial"
checksum_partial="$backup_dir/.${checksum_name}.partial"
backup_outcome="FAILED"
cleanup_backup() {
  local exit_code=$?
  trap - EXIT
  rm -rf -- "$work_dir"
  rm -f -- "$encrypted_partial" "$manifest_partial" "$checksum_partial"
  set +e
  seller_os_audit "$audit_file" "BACKUP" "$backup_id" \
    "$SELLER_OS_BACKUP_SOURCE_LABEL" "none" "$backup_outcome"
  exit "$exit_code"
}
trap cleanup_backup EXIT

connection_fingerprint=$(seller_os_connection_fingerprint "$SELLER_OS_BACKUP_SOURCE_DATABASE_URL") \
  || seller_os_die "SOURCE_CONNECTION_FINGERPRINT_FAILED"
live_fingerprint=$(seller_os_live_database_fingerprint "$SELLER_OS_BACKUP_SOURCE_DATABASE_URL")

roles_file="$work_dir/${backup_id}_roles.sql"
schema_file="$work_dir/${backup_id}_schema.sql"
data_file="$work_dir/${backup_id}_data.sql"
history_schema_file="$work_dir/${backup_id}_history_schema.sql"
history_data_file="$work_dir/${backup_id}_history_data.sql"
custom_file="$work_dir/${backup_id}_database.custom"

# Documented Supabase logical backup set. Docker is an explicit preflight
# dependency because the CLI uses it for database dump tooling.
supabase db dump --db-url "$SELLER_OS_BACKUP_SOURCE_DATABASE_URL" \
  -f "$roles_file" --role-only
supabase db dump --db-url "$SELLER_OS_BACKUP_SOURCE_DATABASE_URL" \
  -f "$schema_file"
supabase db dump --db-url "$SELLER_OS_BACKUP_SOURCE_DATABASE_URL" \
  -f "$data_file" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
supabase db dump --db-url "$SELLER_OS_BACKUP_SOURCE_DATABASE_URL" \
  -f "$history_schema_file" --schema supabase_migrations
supabase db dump --db-url "$SELLER_OS_BACKUP_SOURCE_DATABASE_URL" \
  -f "$history_data_file" --use-copy --data-only --schema supabase_migrations

# Supplemental custom archive satisfies catalog-level verification with
# pg_restore. The SQL files above remain authoritative for Supabase restore.
pg_dump --format=custom --no-owner --no-privileges \
  --file="$custom_file" --dbname="$SELLER_OS_BACKUP_SOURCE_DATABASE_URL"

while IFS= read -r member; do
  [[ -s "$work_dir/$member" ]] || seller_os_die "BACKUP_MEMBER_EMPTY_OR_MISSING"
done < <(seller_os_bundle_members "$backup_id")
pg_restore --list "$custom_file" >/dev/null || seller_os_die "CUSTOM_ARCHIVE_CATALOG_INVALID"

bundle_tar="$work_dir/${backup_id}.tar"
mapfile -t members < <(seller_os_bundle_members "$backup_id")
tar --create --format=posix --file "$bundle_tar" -C "$work_dir" -- "${members[@]}"
gpg --batch --no-tty --encrypt \
  --recipient "$SELLER_OS_BACKUP_GPG_RECIPIENT" \
  --output "$encrypted_partial" "$bundle_tar"
[[ -s "$encrypted_partial" ]] || seller_os_die "ENCRYPTED_BACKUP_EMPTY"

encrypted_sha=$(sha256sum "$encrypted_partial" | awk '{print $1}')
[[ "$encrypted_sha" =~ ^[0-9a-f]{64}$ ]] || seller_os_die "ENCRYPTED_CHECKSUM_INVALID"
seller_os_write_manifest "$manifest_partial" "$backup_id" "$created_at" \
  "$SELLER_OS_BACKUP_SOURCE_LABEL" "$connection_fingerprint" "$live_fingerprint" \
  "$encrypted_name" "$checksum_name" "$encrypted_sha" "$retention_days"
manifest_sha=$(sha256sum "$manifest_partial" | awk '{print $1}')
printf '%s  %s\n%s  %s\n' \
  "$encrypted_sha" "$encrypted_name" "$manifest_sha" "$manifest_name" \
  > "$checksum_partial"
chmod 0600 -- "$encrypted_partial" "$manifest_partial" "$checksum_partial"

mv -- "$encrypted_partial" "$encrypted_path"
mv -- "$manifest_partial" "$manifest_path"
mv -- "$checksum_partial" "$checksum_path"

# Retention is deliberately constrained to completed Seller OS bundle files in
# this one validated directory. Audit logs and lock files are never deleted.
find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'seller-os_*.tar.gpg' -o -name 'seller-os_*.manifest.json' -o -name 'seller-os_*.sha256' \) \
  -mtime "+$retention_days" -delete

backup_outcome="COMPLETED"
printf 'Seller OS backup completed: %s\n' "$backup_id"
printf 'Encrypted bundle: %s\n' "$encrypted_path"
