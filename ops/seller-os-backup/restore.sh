#!/usr/bin/env bash

set -Eeuo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=ops/seller-os-backup/lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'EOF'
Usage:
  sudo ./restore.sh verify --backup-id BACKUP_ID [options]
  sudo ./restore.sh restore --backup-id BACKUP_ID --confirm "TOKEN" [options]

Commands:
  verify   Verify checksums, decrypt into a private temporary directory,
           validate exact tar members, and run pg_restore --list.
  restore  Perform verify, reject source=destination, require an empty NEW
           Supabase target, then restore roles, schema, data, and migration
           history with psql transactions and ON_ERROR_STOP.

Options:
  --backup-id ID        ID printed by backup.sh
  --backup-dir PATH     Root-owned 0700 directory ending in /seller-os
                        (default: /var/backups/seller-os)
  --env-file PATH       Root-owned restore config
                        (default: /etc/seller-os/restore.env)
  --confirm TOKEN       Exact token: RESTORE <ID> TO <DESTINATION_LABEL>
  --help                Show this help

No destination database is ever inferred or defaulted.
EOF
}

mode=${1:-}
case "$mode" in
  verify|restore) shift ;;
  --help|-h|"") usage; exit 0 ;;
  *) seller_os_die "RESTORE_COMMAND_MUST_BE_VERIFY_OR_RESTORE" ;;
esac

backup_id=""
backup_dir="$SELLER_OS_BACKUP_DEFAULT_DIR"
env_file="/etc/seller-os/restore.env"
confirmation=""
while (($#)); do
  case "$1" in
    --backup-id)
      (($# >= 2)) || seller_os_die "BACKUP_ID_ARGUMENT_REQUIRED"
      backup_id=$2
      shift 2
      ;;
    --backup-dir)
      (($# >= 2)) || seller_os_die "BACKUP_DIR_ARGUMENT_REQUIRED"
      backup_dir=$2
      shift 2
      ;;
    --env-file)
      (($# >= 2)) || seller_os_die "ENV_FILE_ARGUMENT_REQUIRED"
      env_file=$2
      shift 2
      ;;
    --confirm)
      (($# >= 2)) || seller_os_die "CONFIRMATION_ARGUMENT_REQUIRED"
      confirmation=$2
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *) seller_os_die "UNKNOWN_ARGUMENT" ;;
  esac
done

seller_os_validate_backup_id "$backup_id" || seller_os_die "BACKUP_ID_INVALID"
for requirement in \
  "gpg:GPG" "sha256sum:SHA256SUM" "tar:TAR" "pg_restore:PG_RESTORE" \
  "python3:PYTHON3" "realpath:REALPATH" "flock:FLOCK"; do
  seller_os_require_command "${requirement%%:*}" "${requirement##*:}"
done
backup_dir=$(seller_os_validate_backup_dir "$backup_dir" false)
exec 8>"$backup_dir/.restore.lock"
flock -n 8 || seller_os_die "RESTORE_ALREADY_RUNNING"

encrypted_name="${backup_id}.tar.gpg"
manifest_name="${backup_id}.manifest.json"
checksum_name="${backup_id}.sha256"
encrypted_path="$backup_dir/$encrypted_name"
manifest_path="$backup_dir/$manifest_name"
checksum_path="$backup_dir/$checksum_name"
audit_file="$backup_dir/restore-audit.log"
for artifact in "$encrypted_path" "$manifest_path" "$checksum_path"; do
  [[ -f "$artifact" && ! -L "$artifact" ]] || seller_os_die "BACKUP_ARTIFACT_MISSING_OR_UNSAFE"
  [[ "$(stat -c '%u' -- "$artifact")" == "0" ]] || seller_os_die "BACKUP_ARTIFACT_ROOT_OWNERSHIP_REQUIRED"
  artifact_mode=$(stat -c '%a' -- "$artifact")
  [[ "$artifact_mode" == "400" || "$artifact_mode" == "600" ]] \
    || seller_os_die "BACKUP_ARTIFACT_MODE_0400_OR_0600_REQUIRED"
done

source_label="unknown"
restore_outcome="FAILED"
action=${mode^^}
work_dir=$(mktemp -d "${TMPDIR:-/var/tmp}/seller-os-restore.XXXXXXXX")
cleanup_restore() {
  local exit_code=$?
  trap - EXIT
  rm -rf -- "$work_dir"
  set +e
  seller_os_audit "$audit_file" "$action" "$backup_id" "$source_label" \
    "${SELLER_OS_RESTORE_DESTINATION_LABEL:-none}" "$restore_outcome"
  exit "$exit_code"
}
trap cleanup_restore EXIT

seller_os_validate_checksum_file "$checksum_path" "$encrypted_name" "$manifest_name"
(cd -- "$backup_dir" && sha256sum --check --strict --status "$checksum_name") \
  || seller_os_die "BACKUP_CHECKSUM_VERIFICATION_FAILED"

manifest_fields=$(seller_os_read_manifest \
  "$manifest_path" "$backup_id" "$encrypted_name" "$checksum_name") \
  || seller_os_die "BACKUP_MANIFEST_VERIFICATION_FAILED"
IFS=$'\t' read -r source_label source_connection_fingerprint \
  source_live_fingerprint manifest_encrypted_sha <<< "$manifest_fields"
seller_os_safe_label "$source_label" || seller_os_die "MANIFEST_SOURCE_LABEL_INVALID"
actual_encrypted_sha=$(sha256sum "$encrypted_path" | awk '{print $1}')
[[ "$actual_encrypted_sha" == "$manifest_encrypted_sha" ]] \
  || seller_os_die "MANIFEST_ENCRYPTED_CHECKSUM_MISMATCH"

bundle_tar="$work_dir/${backup_id}.tar"
payload_dir="$work_dir/payload"
mkdir -m 0700 -- "$payload_dir"
gpg --batch --no-tty --decrypt --output "$bundle_tar" "$encrypted_path" \
  || seller_os_die "BACKUP_GPG_DECRYPT_FAILED"
tar --list --file "$bundle_tar" > "$work_dir/tar-members.txt" \
  || seller_os_die "BACKUP_TAR_LIST_FAILED"
seller_os_validate_tar_members "$work_dir/tar-members.txt" "$backup_id"
tar --extract --file "$bundle_tar" --directory "$payload_dir" \
  --no-same-owner --no-same-permissions \
  || seller_os_die "BACKUP_TAR_EXTRACT_FAILED"
while IFS= read -r member; do
  [[ -f "$payload_dir/$member" && ! -L "$payload_dir/$member" && -s "$payload_dir/$member" ]] \
    || seller_os_die "BACKUP_MEMBER_EMPTY_OR_UNSAFE"
done < <(seller_os_bundle_members "$backup_id")
pg_restore --list "$payload_dir/${backup_id}_database.custom" >/dev/null \
  || seller_os_die "BACKUP_CUSTOM_ARCHIVE_CATALOG_INVALID"

if [[ "$mode" == "verify" ]]; then
  restore_outcome="COMPLETED"
  printf 'Seller OS backup verified: %s\n' "$backup_id"
  exit 0
fi

seller_os_require_command "psql" "PSQL"
seller_os_load_root_env_file "$env_file" \
  SELLER_OS_RESTORE_DESTINATION_DATABASE_URL \
  SELLER_OS_RESTORE_DESTINATION_LABEL \
  SELLER_OS_RESTORE_ALLOW_PRODUCTION
: "${SELLER_OS_RESTORE_DESTINATION_DATABASE_URL:?DESTINATION_DATABASE_URL_REQUIRED}"
: "${SELLER_OS_RESTORE_DESTINATION_LABEL:?DESTINATION_LABEL_REQUIRED}"
seller_os_safe_label "$SELLER_OS_RESTORE_DESTINATION_LABEL" \
  || seller_os_die "DESTINATION_LABEL_INVALID"

if [[ "${SELLER_OS_RESTORE_DESTINATION_LABEL,,}" == *production* || \
      "${SELLER_OS_RESTORE_DESTINATION_LABEL,,}" == "prod" ]]; then
  [[ "${SELLER_OS_RESTORE_ALLOW_PRODUCTION:-}" == "I_ACKNOWLEDGE_EMPTY_PRODUCTION_TARGET" ]] \
    || seller_os_die "PRODUCTION_RESTORE_SEPARATE_ACKNOWLEDGEMENT_REQUIRED"
fi

expected_confirmation="RESTORE $backup_id TO $SELLER_OS_RESTORE_DESTINATION_LABEL"
[[ "$confirmation" == "$expected_confirmation" ]] \
  || seller_os_die "RESTORE_CONFIRMATION_TOKEN_MISMATCH"

destination_connection_fingerprint=$(seller_os_connection_fingerprint \
  "$SELLER_OS_RESTORE_DESTINATION_DATABASE_URL") \
  || seller_os_die "DESTINATION_CONNECTION_FINGERPRINT_FAILED"
destination_live_fingerprint=$(seller_os_live_database_fingerprint \
  "$SELLER_OS_RESTORE_DESTINATION_DATABASE_URL")
[[ "${source_label,,}" != "${SELLER_OS_RESTORE_DESTINATION_LABEL,,}" ]] \
  || seller_os_die "RESTORE_SOURCE_DESTINATION_LABEL_MATCH"
[[ "$source_connection_fingerprint" != "$destination_connection_fingerprint" ]] \
  || seller_os_die "RESTORE_SOURCE_DESTINATION_CONNECTION_MATCH"
[[ "$source_live_fingerprint" != "$destination_live_fingerprint" ]] \
  || seller_os_die "RESTORE_SOURCE_DESTINATION_DATABASE_MATCH"

# A new Supabase project contains managed auth/storage/platform schemas. The
# empty-target gate therefore rejects application relations outside that
# documented managed baseline and rejects any existing CLI migration history.
application_relation_count=$(psql "$SELLER_OS_RESTORE_DESTINATION_DATABASE_URL" \
  -X -A -t -q --set=ON_ERROR_STOP=1 --command "
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','p','v','m','S','f')
      and n.nspname not like 'pg_%'
      and n.nspname not in (
        'information_schema','auth','storage','realtime','extensions','graphql',
        'graphql_public','pgsodium','pgsodium_masks','supabase_functions',
        'supabase_migrations','vault','_analytics','_realtime'
      )") || seller_os_die "RESTORE_EMPTY_TARGET_RELATION_PREFLIGHT_FAILED"
[[ "$application_relation_count" =~ ^[[:space:]]*0[[:space:]]*$ ]] \
  || seller_os_die "RESTORE_TARGET_APPLICATION_RELATIONS_NOT_EMPTY"

migration_history_count=$(psql "$SELLER_OS_RESTORE_DESTINATION_DATABASE_URL" \
  -X -A -t -q --set=ON_ERROR_STOP=1 --command "
    select case
      when to_regclass('supabase_migrations.schema_migrations') is null then 0
      else (select count(*) from supabase_migrations.schema_migrations)
    end") || seller_os_die "RESTORE_EMPTY_TARGET_MIGRATION_PREFLIGHT_FAILED"
[[ "$migration_history_count" =~ ^[[:space:]]*0[[:space:]]*$ ]] \
  || seller_os_die "RESTORE_TARGET_MIGRATION_HISTORY_NOT_EMPTY"

roles_file="$payload_dir/${backup_id}_roles.sql"
schema_file="$payload_dir/${backup_id}_schema.sql"
data_file="$payload_dir/${backup_id}_data.sql"
history_schema_file="$payload_dir/${backup_id}_history_schema.sql"
history_data_file="$payload_dir/${backup_id}_history_data.sql"

# No --clean, DROP, or overwrite path exists. The target must pass the empty
# project preflight, and every restore phase aborts atomically on the first SQL
# error. This order follows Supabase's documented manual logical restore.
psql --single-transaction --variable=ON_ERROR_STOP=1 \
  --file "$roles_file" \
  --file "$schema_file" \
  --command 'SET session_replication_role = replica' \
  --file "$data_file" \
  --command 'SET session_replication_role = origin' \
  --file "$history_schema_file" \
  --file "$history_data_file" \
  --dbname "$SELLER_OS_RESTORE_DESTINATION_DATABASE_URL" \
  || seller_os_die "RESTORE_FULL_TRANSACTION_FAILED"

restore_outcome="COMPLETED"
printf 'Seller OS restore completed into explicitly named empty target: %s\n' \
  "$SELLER_OS_RESTORE_DESTINATION_LABEL"
