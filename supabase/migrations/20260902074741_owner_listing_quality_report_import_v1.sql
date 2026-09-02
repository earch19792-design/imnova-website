-- Durable, normalized owner import of the official eBay Listing Quality
-- Report. Raw files and raw CSV columns are deliberately not persisted.

create table if not exists public.ebay_listing_quality_report_imports (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  source text not null default 'EBAY_LISTING_QUALITY_REPORT',
  parser_version text not null,
  source_file_fingerprint text not null,
  file_name text not null,
  report_account text not null,
  report_date date not null,
  report_observed_at timestamptz not null,
  freshness text not null,
  live_scope_id text not null,
  live_scope_observed_at timestamptz not null,
  current_live_count integer not null,
  report_row_count integer not null,
  live_listings_covered integer not null,
  signals_imported integer not null,
  signals_actionable integer not null,
  signals_need_evidence integer not null,
  nonlive_rows_excluded integer not null,
  exact_item_id_match boolean not null default true,
  report_account_match boolean not null default true,
  raw_file_stored boolean not null default false,
  raw_report_exposed_to_remote boolean not null default false,
  marketplace_writes integer not null default 0,
  listing_mutations integer not null default 0,
  new_listing_publications integer not null default 0,
  buyer_messages integer not null default 0,
  postsale_actions integer not null default 0,
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  constraint ebay_quality_import_account_key_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_quality_import_marketplace_check check (
    marketplace = 'EBAY_US'
  ),
  constraint ebay_quality_import_source_check check (
    source = 'EBAY_LISTING_QUALITY_REPORT'
  ),
  constraint ebay_quality_import_fingerprint_check check (
    source_file_fingerprint ~ '^qlr_file_[0-9a-f]{32}$'
  ),
  constraint ebay_quality_import_freshness_check check (
    freshness in ('CURRENT', 'STALE')
  ),
  constraint ebay_quality_import_counts_check check (
    current_live_count >= 0
    and report_row_count > 0
    and live_listings_covered >= 0
    and live_listings_covered <= current_live_count
    and signals_imported >= 0
    and signals_actionable >= 0
    and signals_need_evidence >= 0
    and signals_actionable <= signals_imported
    and signals_need_evidence <= signals_imported
    and nonlive_rows_excluded >= 0
  ),
  constraint ebay_quality_import_guards_check check (
    exact_item_id_match
    and report_account_match
    and raw_file_stored = false
    and raw_report_exposed_to_remote = false
    and marketplace_writes = 0
    and listing_mutations = 0
    and new_listing_publications = 0
    and buyer_messages = 0
    and postsale_actions = 0
  ),
  constraint ebay_quality_import_fingerprint_unique unique (
    marketplace_account_key, source_file_fingerprint
  )
);

create table if not exists public.ebay_listing_quality_report_signals (
  id uuid primary key default gen_random_uuid(),
  report_import_id uuid not null references
    public.ebay_listing_quality_report_imports(id) on delete restrict,
  marketplace_account_key text not null,
  source text not null default 'EBAY_LISTING_QUALITY_REPORT',
  report_observed_at timestamptz not null,
  item_id text not null,
  sku text null,
  signal_type text not null,
  raw_signal_reference text not null,
  freshness text not null,
  normalized_recommendation text not null,
  what_is_happening text not null,
  why_it_matters text not null,
  seller_os_recommendation text not null,
  what_to_do_now text not null,
  priority_class text not null,
  product_truth_supported boolean not null,
  proposed_field text null,
  proposed_value text null,
  product_truth_reference text null,
  operator_action_required boolean not null,
  current_live boolean not null default true,
  exact_item_id_match boolean not null default true,
  sku_match_when_available boolean null,
  dedupe_key text not null,
  raw_signal_stored boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ebay_quality_signal_account_key_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_quality_signal_source_check check (
    source = 'EBAY_LISTING_QUALITY_REPORT'
  ),
  constraint ebay_quality_signal_item_check check (
    item_id ~ '^[0-9]{9,20}$'
  ),
  constraint ebay_quality_signal_type_check check (
    signal_type in (
      'ITEM_SPECIFIC_MISSING', 'TITLE_REVIEW', 'IMAGE_REVIEW',
      'CATEGORY_REVIEW', 'DESCRIPTION_REVIEW', 'GENERAL_LISTING_QUALITY'
    )
  ),
  constraint ebay_quality_signal_reference_check check (
    raw_signal_reference ~ '^qlr_row_[0-9a-f]{24}$'
  ),
  constraint ebay_quality_signal_freshness_check check (
    freshness in ('CURRENT', 'STALE')
  ),
  constraint ebay_quality_signal_priority_check check (
    priority_class in (
      'NEEDS_ATTENTION', 'CAN_IMPROVE', 'ENRICH', 'WAIT'
    )
  ),
  constraint ebay_quality_signal_product_truth_check check (
    (product_truth_supported and proposed_field is not null
      and proposed_value is not null and product_truth_reference is not null)
    or (not product_truth_supported and proposed_value is null
      and product_truth_reference is null and not operator_action_required)
    or (product_truth_supported and proposed_field is null
      and proposed_value is null and product_truth_reference is not null)
  ),
  constraint ebay_quality_signal_action_freshness_check check (
    not operator_action_required or freshness = 'CURRENT'
  ),
  constraint ebay_quality_signal_scope_check check (
    current_live and exact_item_id_match and raw_signal_stored = false
  ),
  constraint ebay_quality_signal_dedupe_check check (
    dedupe_key ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_quality_signal_import_dedupe unique (
    report_import_id, dedupe_key
  )
);

create index if not exists ebay_quality_import_account_date_idx
  on public.ebay_listing_quality_report_imports(
    marketplace_account_key, report_date desc, imported_at desc
  );

create index if not exists ebay_quality_signal_account_item_idx
  on public.ebay_listing_quality_report_signals(
    marketplace_account_key, item_id, report_observed_at desc
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
    dedupe_key
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
    row.dedupe_key
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
    dedupe_key text
  );

  return v_import_id;
end;
$$;

create or replace function public.reject_ebay_quality_report_mutation_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'EBAY_LISTING_QUALITY_REPORT_APPEND_ONLY';
end;
$$;

drop trigger if exists reject_ebay_quality_import_update
  on public.ebay_listing_quality_report_imports;
create trigger reject_ebay_quality_import_update
before update or delete on public.ebay_listing_quality_report_imports
for each row execute function public.reject_ebay_quality_report_mutation_v1();

drop trigger if exists reject_ebay_quality_signal_update
  on public.ebay_listing_quality_report_signals;
create trigger reject_ebay_quality_signal_update
before update or delete on public.ebay_listing_quality_report_signals
for each row execute function public.reject_ebay_quality_report_mutation_v1();

alter table public.ebay_listing_quality_report_imports enable row level security;
alter table public.ebay_listing_quality_report_imports force row level security;
alter table public.ebay_listing_quality_report_signals enable row level security;
alter table public.ebay_listing_quality_report_signals force row level security;

revoke all on table public.ebay_listing_quality_report_imports
  from anon, authenticated;
revoke all on table public.ebay_listing_quality_report_signals
  from anon, authenticated;
revoke all on table public.ebay_listing_quality_report_imports,
  public.ebay_listing_quality_report_signals from public;
grant select, insert on table public.ebay_listing_quality_report_imports,
  public.ebay_listing_quality_report_signals to service_role;

revoke all on function public.import_ebay_listing_quality_report_v1(jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.import_ebay_listing_quality_report_v1(jsonb,jsonb)
  to service_role;
revoke all on function public.reject_ebay_quality_report_mutation_v1()
  from public, anon, authenticated, service_role;

comment on table public.ebay_listing_quality_report_imports is
  'Owner-supplied official eBay Listing Quality Report metadata. Raw files are never stored or exposed to Remote Operator.';
comment on table public.ebay_listing_quality_report_signals is
  'Current-LIVE-only, exact Item ID, deduplicated human-first signals derived deterministically from the latest valid owner report.';
