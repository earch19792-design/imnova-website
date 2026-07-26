-- Account-scoped acquisition exclusion for Luna opportunities that already
-- crossed publication. Additive, immutable and read-only with respect to eBay.

begin;

create table if not exists
  public.ebay_luna_opportunity_acquisition_dispositions (
    id uuid primary key default gen_random_uuid(),
    opportunity_id uuid not null
      references public.ebay_luna_opportunity_queue(id) on delete restrict,
    published_identity_id uuid not null
      references public.ebay_published_acquisition_identities(id)
      on delete restrict,
    account_key text not null,
    marketplace text not null,
    disposition text not null,
    blocker_code text not null,
    policy_version text not null,
    match_method text not null,
    prior_queue_status text not null,
    evidence_hash text not null,
    idempotency_key text not null unique,
    observed_at timestamptz not null,
    ebay_writes integer not null default 0,
    production_changed boolean not null default false,
    created_at timestamptz not null default clock_timestamp(),
    constraint ebay_luna_opportunity_disposition_scope_check check (
      length(trim(account_key)) between 3 and 145
      and marketplace ~ '^[A-Z0-9_-]{3,32}$'
    ),
    constraint ebay_luna_opportunity_disposition_value_check check (
      disposition = 'SUPERSEDED_ALREADY_PUBLISHED'
    ),
    constraint ebay_luna_opportunity_disposition_blocker_check check (
      blocker_code = 'ALREADY_PUBLISHED_AND_MONITORED'
    ),
    constraint ebay_luna_opportunity_disposition_match_method_check check (
      match_method in ('PRODUCT_VARIANT', 'SUPPLIER_SKU')
    ),
    constraint ebay_luna_opportunity_disposition_prior_status_check check (
      prior_queue_status in (
        'watchlist',
        'review',
        'ready',
        'hold',
        'rejected',
        'listed',
        'archived'
      )
    ),
    constraint ebay_luna_opportunity_disposition_evidence_hash_check check (
      evidence_hash ~ '^[0-9a-f]{64}$'
    ),
    constraint ebay_luna_opportunity_disposition_idempotency_check check (
      idempotency_key ~ '^[0-9a-f]{64}$'
    ),
    constraint ebay_luna_opportunity_disposition_no_ebay_write_check check (
      ebay_writes = 0
    ),
    constraint ebay_luna_opportunity_disposition_no_production_change_check
      check (not production_changed),
    unique (
      account_key,
      marketplace,
      opportunity_id,
      published_identity_id,
      policy_version
    )
  );

create index if not exists
  ebay_luna_opportunity_acquisition_dispositions_scope_idx
  on public.ebay_luna_opportunity_acquisition_dispositions (
    account_key,
    marketplace,
    opportunity_id
  );

create index if not exists
  ebay_luna_opportunity_acquisition_dispositions_identity_idx
  on public.ebay_luna_opportunity_acquisition_dispositions (
    published_identity_id,
    created_at desc
  );

alter table public.ebay_luna_opportunity_acquisition_dispositions
  enable row level security;
alter table public.ebay_luna_opportunity_acquisition_dispositions
  force row level security;

revoke all on table
  public.ebay_luna_opportunity_acquisition_dispositions
  from public, anon, authenticated, service_role;
revoke all on table
  public.ebay_luna_opportunity_acquisition_dispositions
  from anon, authenticated;
grant select, insert on table
  public.ebay_luna_opportunity_acquisition_dispositions
  to service_role;

create or replace function
  public.reject_ebay_luna_opportunity_disposition_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'EBAY_LUNA_OPPORTUNITY_DISPOSITION_IMMUTABLE';
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname =
      'ebay_luna_opportunity_acquisition_dispositions_immutable'
      and tgrelid =
        'public.ebay_luna_opportunity_acquisition_dispositions'::regclass
  ) then
    create trigger
      ebay_luna_opportunity_acquisition_dispositions_immutable
      before update or delete
      on public.ebay_luna_opportunity_acquisition_dispositions
      for each row execute function
        public.reject_ebay_luna_opportunity_disposition_mutation_v1();
  end if;
end;
$$;

-- Exact backfill only. A title, fuzzy text, related pack or active-market
-- similarity can never create a disposition.
with exact_matches as (
  select
    opportunity.id as opportunity_id,
    identity.id as published_identity_id,
    identity.account_key,
    identity.marketplace,
    opportunity.queue_status as prior_queue_status,
    identity.last_observed_at as identity_last_observed_at,
    identity.observed_at as identity_observed_at,
    identity.evidence_hash as identity_evidence_hash,
    case
      when opportunity.market_radar_product_id is not null
        and nullif(trim(coalesce(opportunity.supplier_variant_id, '')), '')
          is not null
        and opportunity.market_radar_product_id::text =
          identity.market_radar_product_id
        and trim(opportunity.supplier_variant_id) =
          trim(identity.supplier_variant_id)
      then 'PRODUCT_VARIANT'
      else 'SUPPLIER_SKU'
    end as match_method
  from public.ebay_luna_opportunity_queue opportunity
  join public.ebay_published_acquisition_identities identity
    on identity.identity_status <> 'ENDED'
    and (
      (
        opportunity.market_radar_product_id is not null
        and nullif(trim(coalesce(opportunity.supplier_variant_id, '')), '')
          is not null
        and nullif(trim(coalesce(identity.market_radar_product_id, '')), '')
          is not null
        and nullif(trim(coalesce(identity.supplier_variant_id, '')), '')
          is not null
        and opportunity.market_radar_product_id::text =
          identity.market_radar_product_id
        and trim(opportunity.supplier_variant_id) =
          trim(identity.supplier_variant_id)
      )
      or
      (
        nullif(trim(coalesce(opportunity.supplier_sku, '')), '') is not null
        and (
          upper(trim(opportunity.supplier_sku)) =
            upper(trim(identity.supplier_sku))
          or upper(trim(opportunity.supplier_sku)) =
            upper(trim(identity.ebay_sku))
        )
      )
    )
  where identity.identity_status in (
    'ACTIVE',
    'PUBLISHED_PENDING_VERIFICATION',
    'MONITOR_REGISTERED',
    'PUBLISHED_VERIFIED'
  )
)
insert into public.ebay_luna_opportunity_acquisition_dispositions (
  opportunity_id,
  published_identity_id,
  account_key,
  marketplace,
  disposition,
  blocker_code,
  policy_version,
  match_method,
  prior_queue_status,
  evidence_hash,
  idempotency_key,
  observed_at,
  ebay_writes,
  production_changed
)
select
  exact_match.opportunity_id,
  exact_match.published_identity_id,
  exact_match.account_key,
  exact_match.marketplace,
  'SUPERSEDED_ALREADY_PUBLISHED',
  'ALREADY_PUBLISHED_AND_MONITORED',
  'EBAY_PUBLISHED_ACQUISITION_POLICY_V1_2026_07_26',
  exact_match.match_method,
  exact_match.prior_queue_status,
  encode(
    extensions.digest(
      convert_to(
        concat_ws(
          ':',
          exact_match.account_key,
          exact_match.marketplace,
          exact_match.opportunity_id::text,
          exact_match.published_identity_id::text,
          exact_match.match_method,
          exact_match.identity_evidence_hash
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  encode(
    extensions.digest(
      convert_to(
        concat_ws(
          ':',
          'EBAY_LUNA_OPPORTUNITY_ACQUISITION_DISPOSITION_V1',
          exact_match.account_key,
          exact_match.marketplace,
          exact_match.opportunity_id::text,
          exact_match.published_identity_id::text,
          'EBAY_PUBLISHED_ACQUISITION_POLICY_V1_2026_07_26'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  coalesce(
    exact_match.identity_last_observed_at,
    exact_match.identity_observed_at,
    clock_timestamp()
  ),
  0,
  false
from exact_matches exact_match
on conflict do nothing;

-- The anti-join is evaluated before ordering and LIMIT, preventing published
-- opportunities from consuming the finite candidate window.
create or replace function
  public.read_eligible_ebay_luna_opportunities_v2(
    p_account_key text,
    p_marketplace text,
    p_limit integer default 70,
    p_offset integer default 0
  )
returns setof public.ebay_luna_opportunity_queue
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select opportunity.*
  from public.ebay_luna_opportunity_queue opportunity
  where length(trim(coalesce(p_account_key, ''))) between 3 and 145
    and p_marketplace ~ '^[A-Z0-9_-]{3,32}$'
    and p_limit between 1 and 1000
    and p_offset between 0 and 1000000
    and opportunity.queue_status in ('watchlist', 'review', 'ready')
    and not exists (
      select 1
      from public.ebay_luna_opportunity_acquisition_dispositions disposition
      where disposition.opportunity_id = opportunity.id
        and disposition.account_key = p_account_key
        and disposition.marketplace = p_marketplace
        and disposition.disposition =
          'SUPERSEDED_ALREADY_PUBLISHED'
        and disposition.blocker_code =
          'ALREADY_PUBLISHED_AND_MONITORED'
    )
  order by
    opportunity.opportunity_score desc,
    opportunity.last_scanned_at desc,
    opportunity.candidate_key,
    opportunity.id
  limit p_limit
  offset p_offset;
$$;

revoke all on function
  public.reject_ebay_luna_opportunity_disposition_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  public.read_eligible_ebay_luna_opportunities_v2(
    text,
    text,
    integer,
    integer
  )
  from public, anon, authenticated, service_role;
grant execute on function
  public.read_eligible_ebay_luna_opportunities_v2(
    text,
    text,
    integer,
    integer
  )
  to service_role;

comment on table
  public.ebay_luna_opportunity_acquisition_dispositions is
  'Immutable account-scoped audit of Luna opportunities excluded from new acquisition because the exact product is already published.';

notify pgrst, 'reload schema';

commit;
