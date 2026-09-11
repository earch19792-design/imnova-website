-- CURRENT read-authority schema only; see production-stock-schema-attestation-v1.
-- No historical migration replay, producer RPC, evidence import, or account backfill.
-- Missing authority rows remain missing: this migration cannot certify LIVE/stock.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.ebay_active_listings
  add column if not exists account_key text null,
  add column if not exists source text null,
  add column if not exists sync_key text null,
  add column if not exists supplier_cost_at_linking numeric(12,2) null,
  add column if not exists sync_generation bigint null;

-- Do not alter existing ACLs/policies or populate an account for legacy rows.
-- A null account_key is deliberately invisible to the exact-account reader.
create index if not exists production_stock_registry_account_read_v1
  on public.ebay_active_listings(account_key, updated_at desc)
  where account_key is not null;

-- Only newly created read authorities receive these restricted ACLs. Replaying
-- this migration on a complete canonical schema preserves its existing grants,
-- policies, columns and producer contracts. No writer is installed here.
do $reconcile$
begin
  if to_regclass('public.ebay_active_listing_sync_state') is null then
    create table public.ebay_active_listing_sync_state (
      account_key text primary key check (account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'),
      current_live_source_state text not null default 'CURRENT_UNAVAILABLE'
        check (current_live_source_state in ('CURRENT_FRESH','CURRENT_UNAVAILABLE')),
      current_live_last_attempt_at timestamptz,
      current_live_next_retry_at timestamptz,
      current_live_last_error_code text,
      last_certified_live_scope_id text,
      last_certified_live_item_ids jsonb,
      last_certified_live_count integer,
      last_certified_live_observed_at timestamptz,
      last_certified_live_fresh_until timestamptz,
      last_certified_live_source_authority text,
      constraint production_stock_live_evidence_v1 check (
        (last_certified_live_scope_id is null and last_certified_live_item_ids is null
          and last_certified_live_count is null and last_certified_live_observed_at is null
          and last_certified_live_fresh_until is null and last_certified_live_source_authority is null
          and current_live_source_state = 'CURRENT_UNAVAILABLE')
        or coalesce((last_certified_live_scope_id ~ '^current-live:sha256:[0-9a-f]{64}$'
          and jsonb_typeof(last_certified_live_item_ids) = 'array'
          and last_certified_live_count >= 0
          and jsonb_array_length(last_certified_live_item_ids) = last_certified_live_count
          and last_certified_live_observed_at is not null
          and last_certified_live_fresh_until > last_certified_live_observed_at
          and last_certified_live_source_authority = 'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION'), false)
      )
    );
    alter table public.ebay_active_listing_sync_state enable row level security;
    alter table public.ebay_active_listing_sync_state force row level security;
    revoke all on public.ebay_active_listing_sync_state from public, anon, authenticated, service_role;
    grant select on public.ebay_active_listing_sync_state to service_role;
    create policy production_stock_live_service_read_v1 on public.ebay_active_listing_sync_state
      for select to service_role using (true);
  end if;

  if to_regclass('public.seller_os_luna_linkage_decisions') is null then
    create table public.seller_os_luna_linkage_decisions (
      decision_id text primary key,
      account_key text not null check (account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'),
      marketplace_id text not null check (marketplace_id = 'EBAY_US'),
      decision_version integer not null check (decision_version between 1 and 1000000),
      decision text not null check (decision in ('APPROVE_EXACT_LINKAGE','REJECT_CANDIDATE','KEEP_UNPROVEN')),
      decision_at timestamptz not null,
      ebay_item_id text not null check (ebay_item_id ~ '^[0-9]{9,20}$'),
      ebay_sku text,
      linkage_id text,
      components jsonb not null check (jsonb_typeof(components) = 'array'),
      evidence_digest text not null check (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
      evidence_references text[] not null,
      constraint production_stock_approved_linkage_evidence_v1 check (
        decision <> 'APPROVE_EXACT_LINKAGE' or coalesce((
          linkage_id ~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'
          and length(ebay_sku) > 0 and jsonb_array_length(components) > 0
          and length(evidence_digest) > 0 and cardinality(evidence_references) > 0), false)
      ),
      unique(account_key, marketplace_id, ebay_item_id, decision_version)
    );
    alter table public.seller_os_luna_linkage_decisions enable row level security;
    alter table public.seller_os_luna_linkage_decisions force row level security;
    revoke all on public.seller_os_luna_linkage_decisions from public, anon, authenticated, service_role;
    grant select on public.seller_os_luna_linkage_decisions to service_role;
    create policy production_stock_linkage_service_read_v1 on public.seller_os_luna_linkage_decisions
      for select to service_role using (true);
  end if;

  if to_regclass('public.seller_os_luna_stock_check_jobs') is null then
    create table public.seller_os_luna_stock_check_jobs (
      stock_check_job_id text primary key check (stock_check_job_id ~ '^luna-stock-check-v1:sha256:[0-9a-f]{64}$'),
      account_key text not null check (account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'),
      linkage_id text not null check (linkage_id ~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'),
      ebay_item_id text not null check (ebay_item_id ~ '^[0-9]{9,20}$'),
      observation_window_start timestamptz not null,
      observation_window_end timestamptz not null,
      workflow_state text not null check (workflow_state in
        ('NOT_STARTED','IN_PROGRESS','SUCCEEDED','RETRYABLE_FAILURE','TERMINAL_FAILURE','BLOCKED','SKIPPED','NOT_APPLICABLE')),
      attempt_count integer not null check (attempt_count between 0 and 5),
      success_receipt_digest text,
      check (observation_window_end > observation_window_start),
      check ((workflow_state = 'SUCCEEDED' and coalesce(success_receipt_digest ~ '^luna-stock-package-v1:sha256:[0-9a-f]{64}$', false))
        or (workflow_state <> 'SUCCEEDED' and success_receipt_digest is null)),
      unique(stock_check_job_id, linkage_id, account_key, ebay_item_id)
    );
    create index production_stock_jobs_account_read_v1 on public.seller_os_luna_stock_check_jobs
      (account_key, ebay_item_id, observation_window_end desc);
    alter table public.seller_os_luna_stock_check_jobs enable row level security;
    alter table public.seller_os_luna_stock_check_jobs force row level security;
    revoke all on public.seller_os_luna_stock_check_jobs from public, anon, authenticated, service_role;
    grant select on public.seller_os_luna_stock_check_jobs to service_role;
    create policy production_stock_jobs_service_read_v1 on public.seller_os_luna_stock_check_jobs
      for select to service_role using (true);
  end if;

  if to_regclass('public.seller_os_luna_stock_observations') is null then
    create table public.seller_os_luna_stock_observations (
      observation_id text primary key check (observation_id ~ '^luna-stock-observation-v1:sha256:[0-9a-f]{64}$'),
      stock_check_job_id text not null,
      linkage_id text not null,
      account_key text not null check (account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'),
      ebay_item_id text not null check (ebay_item_id ~ '^[0-9]{9,20}$'),
      component_identity_id text not null check (component_identity_id ~ '^luna-component-identity-v1:sha256:[0-9a-f]{64}$'),
      luna_product_id text not null,
      luna_variant_id text,
      luna_sku text not null,
      supplier_quantity_required integer not null check (supplier_quantity_required between 1 and 1000000),
      observation_state text not null check (observation_state in
        ('OBSERVED_IN_STOCK','OBSERVED_OUT_OF_STOCK','OBSERVED_QUANTITY','SOURCE_UNAVAILABLE','OBSERVATION_FAILED','UNKNOWN')),
      source_status text not null check (source_status in ('AVAILABLE','AUTH_REQUIRED','UNAVAILABLE','FAILED')),
      observed_availability boolean,
      observed_supplier_quantity integer check (observed_supplier_quantity between 0 and 1000000000),
      evidence_class text not null check (evidence_class in ('SUPPLIER_STATED','UNAVAILABLE')),
      evidence_digest text not null check (evidence_digest ~ '^luna-stock-evidence-v1:sha256:[0-9a-f]{64}$'),
      acquisition_method text not null check (acquisition_method in ('CANONICAL_SERVER_READ','CANONICAL_BROWSER_AUTOMATION')),
      attempt_number integer not null check (attempt_number between 1 and 5),
      observed_at timestamptz not null,
      maximum_age_seconds integer not null check (maximum_age_seconds between 60 and 604800),
      limitations text[] not null default '{}',
      check ((observation_state = 'OBSERVED_IN_STOCK' and coalesce(observed_availability, false))
        or (observation_state = 'OBSERVED_OUT_OF_STOCK' and coalesce(not observed_availability, false))
        or (observation_state = 'OBSERVED_QUANTITY' and observed_supplier_quantity is not null)
        or (observation_state in ('SOURCE_UNAVAILABLE','OBSERVATION_FAILED','UNKNOWN')
          and observed_availability is null and observed_supplier_quantity is null)),
      check (source_status = 'AVAILABLE' or (observed_availability is null and observed_supplier_quantity is null)),
      unique(stock_check_job_id, component_identity_id, attempt_number),
      foreign key(stock_check_job_id, linkage_id, account_key, ebay_item_id)
        references public.seller_os_luna_stock_check_jobs(stock_check_job_id, linkage_id, account_key, ebay_item_id)
        on delete restrict
    );
    create index production_stock_observations_account_read_v1 on public.seller_os_luna_stock_observations
      (account_key, ebay_item_id, observed_at desc);
    alter table public.seller_os_luna_stock_observations enable row level security;
    alter table public.seller_os_luna_stock_observations force row level security;
    revoke all on public.seller_os_luna_stock_observations from public, anon, authenticated, service_role;
    grant select on public.seller_os_luna_stock_observations to service_role;
    create policy production_stock_observations_service_read_v1 on public.seller_os_luna_stock_observations
      for select to service_role using (true);
  end if;
end
$reconcile$;

-- Fail atomically if an unexpected partially present table lacks a required column.
do $validate$
begin
  perform id,account_key,source,sync_key,ebay_item_id,ebay_sku,listing_status,title,ebay_quantity,ebay_price,currency,market_radar_product_id,supplier_variant_id,supplier_sku,supplier_cost_at_linking,last_ebay_sync_at,raw_payload,sync_generation,created_at,updated_at from public.ebay_active_listings limit 0;
  perform current_live_source_state,current_live_last_attempt_at,current_live_next_retry_at,current_live_last_error_code,last_certified_live_scope_id,last_certified_live_item_ids,last_certified_live_count,last_certified_live_observed_at,last_certified_live_fresh_until,last_certified_live_source_authority,account_key from public.ebay_active_listing_sync_state limit 0;
  perform decision_id,decision_version,decision,decision_at,ebay_item_id,ebay_sku,linkage_id,components,evidence_digest,evidence_references,account_key,marketplace_id from public.seller_os_luna_linkage_decisions limit 0;
  perform stock_check_job_id,linkage_id,ebay_item_id,observation_window_start,observation_window_end,workflow_state,attempt_count,success_receipt_digest,account_key from public.seller_os_luna_stock_check_jobs limit 0;
  perform observation_id,stock_check_job_id,linkage_id,ebay_item_id,component_identity_id,luna_product_id,luna_variant_id,luna_sku,supplier_quantity_required,observation_state,source_status,observed_availability,observed_supplier_quantity,evidence_class,evidence_digest,acquisition_method,attempt_number,observed_at,maximum_age_seconds,limitations,account_key from public.seller_os_luna_stock_observations limit 0;
end
$validate$;

notify pgrst, 'reload schema';
