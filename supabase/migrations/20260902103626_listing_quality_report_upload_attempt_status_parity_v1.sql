-- Durable, append-only outcomes for every owner Listing Quality Report upload.
-- The raw report and raw cells are never stored. Failed attempts remain
-- separate from the last valid import so a parser failure cannot masquerade
-- as a fresh report or replace normalized signals consumed by Remote Operator.

create table if not exists public.ebay_listing_quality_report_upload_attempts (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  attempted_by uuid not null references auth.users(id) on delete restrict,
  attempted_at timestamptz not null default now(),
  file_type text not null,
  source_file_fingerprint text null,
  source_file_size_bytes integer null,
  attempt_status text not null,
  safe_failure_code text null,
  technical_reason_code text null,
  diagnostics_capture_status text not null,
  workbook_sheet_names text[] not null default '{}',
  observed_header_names text[] not null default '{}',
  recognized_sheet text null,
  header_match_status text not null,
  rows_parsed integer not null default 0,
  current_live_rows_matched integer not null default 0,
  nonlive_rows_excluded integer not null default 0,
  valid_import_id uuid null references
    public.ebay_listing_quality_report_imports(id) on delete restrict,
  request_correlation_reference text not null unique,
  raw_file_stored boolean not null default false,
  raw_report_exposed_to_remote boolean not null default false,
  marketplace_writes integer not null default 0,
  listing_mutations integer not null default 0,
  buyer_messages integer not null default 0,
  postsale_actions integer not null default 0,
  constraint ebay_quality_attempt_account_key_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_quality_attempt_file_type_check check (
    file_type in ('CSV', 'XLSX', 'JSON')
  ),
  constraint ebay_quality_attempt_fingerprint_check check (
    source_file_fingerprint is null
    or source_file_fingerprint ~ '^qlr_file_[0-9a-f]{32}$'
  ),
  constraint ebay_quality_attempt_size_check check (
    source_file_size_bytes is null or source_file_size_bytes > 0
  ),
  constraint ebay_quality_attempt_status_check check (
    attempt_status in ('FAILED_VALIDATION', 'IMPORTED')
  ),
  constraint ebay_quality_attempt_capture_check check (
    diagnostics_capture_status in ('CAPTURED', 'NOT_CAPTURED_LEGACY')
  ),
  constraint ebay_quality_attempt_header_check check (
    header_match_status in (
      'MATCHED', 'NO_VALID_SHEET', 'HEADER_ROW_NOT_FOUND',
      'ITEM_ID_COLUMN_NOT_FOUND', 'RECOMMENDATION_COLUMNS_NOT_FOUND',
      'HUMAN_SELECTION_REQUIRED', 'NOT_REACHED', 'OTHER'
    )
  ),
  constraint ebay_quality_attempt_sheet_bound_check check (
    cardinality(workbook_sheet_names) <= 20
    and cardinality(observed_header_names) <= 250
    and (recognized_sheet is null or length(recognized_sheet) between 1 and 120)
  ),
  constraint ebay_quality_attempt_counts_check check (
    rows_parsed >= 0
    and current_live_rows_matched >= 0
    and current_live_rows_matched <= rows_parsed
    and nonlive_rows_excluded >= 0
    and nonlive_rows_excluded <= rows_parsed
  ),
  constraint ebay_quality_attempt_outcome_check check (
    (attempt_status = 'IMPORTED'
      and valid_import_id is not null
      and safe_failure_code is null
      and technical_reason_code is null
      and header_match_status = 'MATCHED')
    or
    (attempt_status = 'FAILED_VALIDATION'
      and valid_import_id is null
      and safe_failure_code is not null
      and technical_reason_code is not null)
  ),
  constraint ebay_quality_attempt_correlation_check check (
    request_correlation_reference ~ '^qlr_attempt_[0-9a-f]{32}$'
  ),
  constraint ebay_quality_attempt_zero_effect_check check (
    raw_file_stored = false
    and raw_report_exposed_to_remote = false
    and marketplace_writes = 0
    and listing_mutations = 0
    and buyer_messages = 0
    and postsale_actions = 0
  )
);

create index if not exists ebay_quality_attempt_account_time_idx
  on public.ebay_listing_quality_report_upload_attempts(
    marketplace_account_key, attempted_at desc, id desc
  );

drop trigger if exists reject_ebay_quality_attempt_mutation
  on public.ebay_listing_quality_report_upload_attempts;
create trigger reject_ebay_quality_attempt_mutation
before update or delete on public.ebay_listing_quality_report_upload_attempts
for each row execute function public.reject_ebay_quality_report_mutation_v1();

alter table public.ebay_listing_quality_report_upload_attempts
  enable row level security;
alter table public.ebay_listing_quality_report_upload_attempts
  force row level security;

revoke all on table public.ebay_listing_quality_report_upload_attempts
  from anon, authenticated;
revoke all on table public.ebay_listing_quality_report_upload_attempts
  from public;
grant select, insert on table
  public.ebay_listing_quality_report_upload_attempts to service_role;

comment on table public.ebay_listing_quality_report_upload_attempts is
  'Append-only sanitized owner upload outcomes. Raw report bytes and raw columns are never stored; Remote Operator has no access.';
