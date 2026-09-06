-- One durable control plane for all LIVE-listing economic evidence.  Source
-- workers remain authoritative; this schema only coordinates their reads,
-- freshness, retry and derived economics.  It has no marketplace-write
-- primitive.

create table public.seller_os_live_economic_evidence_v1 (
  evidence_id text primary key,
  marketplace_account_key text not null,
  marketplace_id text not null,
  ebay_item_id text not null,
  evidence_type text not null,
  value_amount numeric(14,4) null,
  value_currency text null,
  source_authority text not null,
  source_entity_id text not null,
  captured_at timestamptz not null,
  fresh_until timestamptz null,
  freshness_status text not null,
  limitation_code text null,
  evidence_digest text not null,
  evidence_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_live_economic_evidence_id_check check (
    evidence_id ~ '^economic-evidence-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_live_economic_evidence_account_check check (
    marketplace_account_key <> 'default'
    and char_length(marketplace_account_key) between 8 and 200
    and marketplace_account_key !~ '[[:cntrl:]]'
  ),
  constraint seller_os_live_economic_evidence_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint seller_os_live_economic_evidence_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'
  ),
  constraint seller_os_live_economic_evidence_type_check check (
    evidence_type in (
      'EBAY_LIVE_PRICE', 'LUNA_CURRENT_COST', 'LUNA_CURRENT_SHIPPING',
      'EXPECTED_EBAY_FEE', 'OTHER_EXPLICIT_COSTS'
    )
  ),
  constraint seller_os_live_economic_evidence_money_check check (
    value_amount is null or value_amount >= 0
  ),
  constraint seller_os_live_economic_evidence_currency_check check (
    (value_amount is null and value_currency is null)
    or (value_amount is not null and value_currency = 'USD')
  ),
  constraint seller_os_live_economic_evidence_source_check check (
    char_length(source_authority) between 3 and 160
    and char_length(source_entity_id) between 1 and 500
    and source_authority !~ '[[:cntrl:]]'
    and source_entity_id !~ '[[:cntrl:]]'
  ),
  constraint seller_os_live_economic_evidence_freshness_check check (
    freshness_status in (
      'FRESH', 'STALE', 'MISSING', 'WAITING_FOR_WORKER', 'REFRESHING',
      'SOURCE_UNAVAILABLE', 'FAILED_RETRYABLE', 'FAILED_TERMINAL'
    )
    and (
      (freshness_status = 'FRESH' and value_amount is not null
        and fresh_until is not null and fresh_until > captured_at
        and limitation_code is null)
      or freshness_status <> 'FRESH'
    )
  ),
  constraint seller_os_live_economic_evidence_digest_check check (
    evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    and jsonb_typeof(evidence_metadata) = 'object'
  )
);

create index seller_os_live_economic_evidence_latest_v1_idx
  on public.seller_os_live_economic_evidence_v1 (
    marketplace_account_key, ebay_item_id, evidence_type,
    captured_at desc, created_at desc
  );

create table public.seller_os_economic_evidence_refresh_jobs_v1 (
  job_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  marketplace_account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  ebay_item_id text not null,
  evidence_type text not null,
  source_identity jsonb not null default '{}'::jsonb,
  status text not null,
  last_evidence_id text null references
    public.seller_os_live_economic_evidence_v1(evidence_id),
  failure_class text null,
  next_retry_at timestamptz null,
  attempt_count integer not null default 0,
  lease_owner text null,
  lease_expires_at timestamptz null,
  first_detected_at timestamptz not null default clock_timestamp(),
  last_detected_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_economic_refresh_job_key_check check (
    idempotency_key ~ '^economic-refresh-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_economic_refresh_job_identity_check check (
    marketplace_account_key <> 'default'
    and char_length(marketplace_account_key) between 8 and 200
    and marketplace_id = 'EBAY_US'
    and ebay_item_id ~ '^[0-9]{9,20}$'
    and jsonb_typeof(source_identity) = 'object'
  ),
  constraint seller_os_economic_refresh_job_type_check check (
    evidence_type in (
      'EBAY_LIVE_PRICE', 'LUNA_CURRENT_COST', 'LUNA_CURRENT_SHIPPING',
      'EXPECTED_EBAY_FEE', 'OTHER_EXPLICIT_COSTS'
    )
  ),
  constraint seller_os_economic_refresh_job_status_check check (
    status in (
      'FRESH', 'STALE', 'MISSING', 'WAITING_FOR_WORKER', 'REFRESHING',
      'SOURCE_UNAVAILABLE', 'FAILED_RETRYABLE', 'FAILED_TERMINAL'
    )
  ),
  constraint seller_os_economic_refresh_job_attempt_check check (
    attempt_count between 0 and 1000000
  ),
  constraint seller_os_economic_refresh_job_lease_check check (
    (lease_owner is null and lease_expires_at is null)
    or (lease_owner is not null and lease_expires_at is not null
      and char_length(lease_owner) between 8 and 160)
  ),
  unique (marketplace_account_key, marketplace_id, ebay_item_id, evidence_type)
);

create index seller_os_economic_refresh_claimable_v1_idx
  on public.seller_os_economic_evidence_refresh_jobs_v1 (
    status, next_retry_at, lease_expires_at, last_detected_at
  ) where status in ('STALE', 'MISSING', 'WAITING_FOR_WORKER',
    'FAILED_RETRYABLE');

create table public.seller_os_live_economics_readbacks_v1 (
  readback_id text primary key,
  marketplace_account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  ebay_item_id text not null,
  status text not null,
  live_price numeric(14,4) null,
  luna_cost numeric(14,4) null,
  luna_shipping numeric(14,4) null,
  expected_ebay_fee numeric(14,4) null,
  other_explicit_costs numeric(14,4) null,
  expected_profit numeric(14,4) null,
  margin_percent numeric(14,4) null,
  roi_percent numeric(14,4) null,
  input_evidence_ids jsonb not null,
  missing_economic_inputs text[] not null,
  formula_version text not null,
  market_price_status text not null default 'UNPROVEN',
  price_position_status text not null default 'POR_COMPROBAR',
  calculated_at timestamptz not null,
  calculation_digest text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_live_economics_readback_id_check check (
    readback_id ~ '^live-economics-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_live_economics_readback_identity_check check (
    marketplace_account_key <> 'default'
    and char_length(marketplace_account_key) between 8 and 200
    and marketplace_id = 'EBAY_US'
    and ebay_item_id ~ '^[0-9]{9,20}$'
  ),
  constraint seller_os_live_economics_readback_status_check check (
    status in ('PROVEN', 'PARTIAL', 'UNPROVEN')
  ),
  constraint seller_os_live_economics_readback_input_check check (
    jsonb_typeof(input_evidence_ids) = 'object'
    and array_position(missing_economic_inputs, null) is null
    and formula_version = 'SELLER_OS_LIVE_PRICE_ECONOMICS_V1'
    and market_price_status in ('PROVEN', 'UNPROVEN', 'STALE')
    and price_position_status in (
      'DENTRO_DEL_MERCADO', 'POR_ENCIMA_DEL_MERCADO',
      'POR_DEBAJO_DEL_MERCADO', 'POR_COMPROBAR', 'EVIDENCIA_VENCIDA'
    )
    and calculation_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_live_economics_readback_proven_check check (
    (status = 'PROVEN' and cardinality(missing_economic_inputs) = 0
      and live_price is not null and luna_cost is not null
      and luna_shipping is not null and expected_ebay_fee is not null
      and other_explicit_costs is not null and expected_profit is not null
      and margin_percent is not null and roi_percent is not null)
    or status <> 'PROVEN'
  )
);

create index seller_os_live_economics_readbacks_latest_v1_idx
  on public.seller_os_live_economics_readbacks_v1 (
    marketplace_account_key, ebay_item_id, calculated_at desc
  );

create or replace function public.reject_seller_os_economic_receipt_mutation_v1()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'SELLER_OS_ECONOMIC_RECEIPT_APPEND_ONLY';
end;
$$;

create trigger seller_os_live_economic_evidence_append_only_v1
before update or delete on public.seller_os_live_economic_evidence_v1
for each row execute function public.reject_seller_os_economic_receipt_mutation_v1();

create trigger seller_os_live_economics_readback_append_only_v1
before update or delete on public.seller_os_live_economics_readbacks_v1
for each row execute function public.reject_seller_os_economic_receipt_mutation_v1();

create or replace function public.claim_seller_os_economic_refresh_jobs_v1(
  p_marketplace_account_key text,
  p_worker_id text,
  p_evidence_types text[] default null,
  p_limit integer default 4,
  p_lease_seconds integer default 180
)
returns setof public.seller_os_economic_evidence_refresh_jobs_v1
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if p_marketplace_account_key is null
      or char_length(p_marketplace_account_key) not between 8 and 200
      or p_worker_id is null or char_length(p_worker_id) not between 8 and 160
      or p_limit not between 1 and 100
      or p_lease_seconds not between 30 and 900 then
    raise exception 'SELLER_OS_ECONOMIC_REFRESH_CLAIM_INVALID';
  end if;
  return query
  with selected as (
    select job_id from public.seller_os_economic_evidence_refresh_jobs_v1
    where marketplace_account_key = p_marketplace_account_key
      and status in ('STALE', 'MISSING', 'WAITING_FOR_WORKER',
        'FAILED_RETRYABLE')
      and (p_evidence_types is null or evidence_type = any(p_evidence_types))
      and (next_retry_at is null or next_retry_at <= clock_timestamp())
      and (lease_expires_at is null or lease_expires_at <= clock_timestamp())
    order by case status when 'MISSING' then 0 when 'STALE' then 1
      when 'FAILED_RETRYABLE' then 2 else 3 end,
      last_detected_at, ebay_item_id, evidence_type
    for update skip locked limit p_limit
  )
  update public.seller_os_economic_evidence_refresh_jobs_v1 job
  set status = 'REFRESHING', lease_owner = p_worker_id,
      lease_expires_at = clock_timestamp() +
        make_interval(secs => p_lease_seconds),
      attempt_count = job.attempt_count + 1,
      updated_at = clock_timestamp()
  from selected where job.job_id = selected.job_id
  returning job.*;
end;
$$;

create or replace function public.finish_seller_os_economic_refresh_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_status text,
  p_last_evidence_id text,
  p_failure_class text default null,
  p_next_retry_at timestamptz default null
)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_count integer;
begin
  if p_status not in ('FRESH', 'WAITING_FOR_WORKER', 'SOURCE_UNAVAILABLE',
      'FAILED_RETRYABLE', 'FAILED_TERMINAL') then
    raise exception 'SELLER_OS_ECONOMIC_REFRESH_FINISH_STATUS_INVALID';
  end if;
  update public.seller_os_economic_evidence_refresh_jobs_v1
  set status = p_status, last_evidence_id = p_last_evidence_id,
      failure_class = p_failure_class, next_retry_at = p_next_retry_at,
      lease_owner = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  where job_id = p_job_id and lease_owner = p_worker_id
    and lease_expires_at > clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

alter table public.seller_os_live_economic_evidence_v1 enable row level security;
alter table public.seller_os_live_economic_evidence_v1 force row level security;
alter table public.seller_os_economic_evidence_refresh_jobs_v1 enable row level security;
alter table public.seller_os_economic_evidence_refresh_jobs_v1 force row level security;
alter table public.seller_os_live_economics_readbacks_v1 enable row level security;
alter table public.seller_os_live_economics_readbacks_v1 force row level security;

revoke all on table public.seller_os_live_economic_evidence_v1
  from public, anon, authenticated;
revoke all on table public.seller_os_economic_evidence_refresh_jobs_v1
  from public, anon, authenticated;
revoke all on table public.seller_os_live_economics_readbacks_v1
  from public, anon, authenticated;
grant select, insert on table public.seller_os_live_economic_evidence_v1
  to service_role;
grant select, insert, update on table
  public.seller_os_economic_evidence_refresh_jobs_v1 to service_role;
grant select, insert on table public.seller_os_live_economics_readbacks_v1
  to service_role;

revoke all on function public.claim_seller_os_economic_refresh_jobs_v1(
  text, text, text[], integer, integer) from public, anon, authenticated;
revoke all on function public.finish_seller_os_economic_refresh_job_v1(
  uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_seller_os_economic_refresh_jobs_v1(
  text, text, text[], integer, integer) to service_role;
grant execute on function public.finish_seller_os_economic_refresh_job_v1(
  uuid, text, text, text, text, timestamptz) to service_role;

comment on table public.seller_os_economic_evidence_refresh_jobs_v1 is
  'Single durable LIVE economics refresh control plane. It coordinates existing read authorities and has no marketplace-write capability.';
comment on table public.seller_os_live_economic_evidence_v1 is
  'Append-only field-grain economic evidence. Null remains unknown and is never represented as zero.';
comment on table public.seller_os_live_economics_readbacks_v1 is
  'Append-only versioned economics calculation/readback independent from market-price validation.';

notify pgrst, 'reload schema';
