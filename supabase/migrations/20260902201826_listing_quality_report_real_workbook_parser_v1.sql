-- Support the schema-discovered, multi-category official eBay workbook.
-- Only normalized signal semantics and safe worksheet/header metadata are
-- persisted. Raw workbook bytes and raw rows remain outside the database.

alter table public.ebay_listing_quality_report_upload_attempts
  add column if not exists recognized_sheet_names text[] not null default '{}',
  add column if not exists recognized_sheet_count integer not null default 0;

alter table public.ebay_listing_quality_report_upload_attempts
  add constraint ebay_quality_attempt_recognized_sheets_check check (
    recognized_sheet_count >= 0
    and recognized_sheet_count = cardinality(recognized_sheet_names)
    and cardinality(recognized_sheet_names) <= 20
  );

create index if not exists ebay_quality_attempt_valid_import_idx
  on public.ebay_listing_quality_report_upload_attempts(valid_import_id)
  where valid_import_id is not null;
create index if not exists ebay_quality_attempt_attempted_by_idx
  on public.ebay_listing_quality_report_upload_attempts(attempted_by);

alter table public.ebay_listing_quality_report_signals
  add column if not exists source_signal_semantics jsonb not null default '{}'::jsonb;

alter table public.ebay_listing_quality_report_signals
  add constraint ebay_quality_signal_semantics_check check (
    jsonb_typeof(source_signal_semantics) = 'object'
    and octet_length(source_signal_semantics::text) <= 4096
  );

alter table public.ebay_listing_quality_report_signals
  drop constraint if exists ebay_quality_signal_type_check;
alter table public.ebay_listing_quality_report_signals
  add constraint ebay_quality_signal_type_check check (
    signal_type in (
      'ITEM_SPECIFIC_MISSING', 'TITLE_REVIEW', 'IMAGE_REVIEW',
      'CATEGORY_REVIEW', 'DESCRIPTION_REVIEW', 'GENERAL_LISTING_QUALITY',
      'LISTING_QUALITY_SPECIFIC_RECOMMENDATION',
      'VISUAL_COVERAGE_REVIEW',
      'GOOGLE_SHOPPING_REJECTION',
      'PROMOTION_VISIBILITY_OPPORTUNITY'
    )
  );

create or replace function public.import_ebay_listing_quality_report_v1(
  p_import jsonb,
  p_signals jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_import_id uuid := gen_random_uuid();
  v_signal_count integer;
begin
  if jsonb_typeof(p_import) <> 'object'
      or jsonb_typeof(p_signals) <> 'array' then
    raise exception 'EBAY_QUALITY_REPORT_IMPORT_PAYLOAD_INVALID';
  end if;

  v_signal_count := jsonb_array_length(p_signals);
  if coalesce((p_import ->> 'signals_imported')::integer, -1) <>
      v_signal_count then
    raise exception 'EBAY_QUALITY_REPORT_SIGNAL_COUNT_MISMATCH';
  end if;

  insert into public.ebay_listing_quality_report_imports (
    id, marketplace_account_key, parser_version, source_file_fingerprint,
    file_name, report_account, report_date, report_observed_at, freshness,
    live_scope_id, live_scope_observed_at, current_live_count,
    report_row_count, live_listings_covered, signals_imported,
    signals_actionable, signals_need_evidence, nonlive_rows_excluded,
    imported_by
  ) values (
    v_import_id,
    p_import ->> 'marketplace_account_key',
    p_import ->> 'parser_version',
    p_import ->> 'source_file_fingerprint',
    p_import ->> 'file_name',
    p_import ->> 'report_account',
    (p_import ->> 'report_date')::date,
    (p_import ->> 'report_observed_at')::timestamptz,
    p_import ->> 'freshness',
    p_import ->> 'live_scope_id',
    (p_import ->> 'live_scope_observed_at')::timestamptz,
    (p_import ->> 'current_live_count')::integer,
    (p_import ->> 'report_row_count')::integer,
    (p_import ->> 'live_listings_covered')::integer,
    (p_import ->> 'signals_imported')::integer,
    (p_import ->> 'signals_actionable')::integer,
    (p_import ->> 'signals_need_evidence')::integer,
    (p_import ->> 'nonlive_rows_excluded')::integer,
    (p_import ->> 'imported_by')::uuid
  );

  insert into public.ebay_listing_quality_report_signals (
    report_import_id, marketplace_account_key, report_observed_at,
    item_id, sku, signal_type, raw_signal_reference, freshness,
    normalized_recommendation, what_is_happening, why_it_matters,
    seller_os_recommendation, what_to_do_now, priority_class,
    product_truth_supported, proposed_field, proposed_value,
    product_truth_reference, operator_action_required, sku_match_when_available,
    dedupe_key, source_signal_semantics
  )
  select
    v_import_id,
    p_import ->> 'marketplace_account_key',
    (p_import ->> 'report_observed_at')::timestamptz,
    row.item_id,
    row.sku,
    row.signal_type,
    row.raw_signal_reference,
    p_import ->> 'freshness',
    row.normalized_recommendation,
    row.what_is_happening,
    row.why_it_matters,
    row.seller_os_recommendation,
    row.what_to_do_now,
    row.priority_class,
    row.product_truth_supported,
    row.proposed_field,
    row.proposed_value,
    row.product_truth_reference,
    row.operator_action_required,
    row.sku_match_when_available,
    row.dedupe_key,
    coalesce(row.source_signal_semantics, '{}'::jsonb)
  from jsonb_to_recordset(p_signals) as row(
    item_id text,
    sku text,
    signal_type text,
    raw_signal_reference text,
    normalized_recommendation text,
    what_is_happening text,
    why_it_matters text,
    seller_os_recommendation text,
    what_to_do_now text,
    priority_class text,
    product_truth_supported boolean,
    proposed_field text,
    proposed_value text,
    product_truth_reference text,
    operator_action_required boolean,
    sku_match_when_available boolean,
    dedupe_key text,
    source_signal_semantics jsonb
  );

  return v_import_id;
end;
$$;

revoke all on function public.import_ebay_listing_quality_report_v1(jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.import_ebay_listing_quality_report_v1(jsonb,jsonb)
  to service_role;
