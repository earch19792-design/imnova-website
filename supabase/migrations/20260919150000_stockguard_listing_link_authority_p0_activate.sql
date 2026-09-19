-- ACTIVATE phase for StockGuard canonical listing authority enforcement.
-- Apply only after the authority-aware application release is deployed.
-- The PREPARE migration intentionally leaves these triggers absent so the
-- current Production worker contract remains compatible during rollout.

do $migration$
begin
  if to_regclass('public.seller_os_listing_product_link_authorities_v1') is null
    or to_regclass('public.seller_os_listing_identity_quarantines_v1') is null
    or to_regprocedure(
      'public.guard_seller_os_luna_stock_job_authority_p0()') is null then
    raise exception 'STOCKGUARD_AUTHORITY_PREPARE_REQUIRED';
  end if;
end;
$migration$;

create table if not exists
  public.seller_os_stockguard_legacy_job_dispositions_v1 (
  disposition_id text primary key,
  stock_check_job_id text not null unique references
    public.seller_os_luna_stock_check_jobs(stock_check_job_id)
    on delete restrict,
  account_key text not null,
  ebay_item_id text not null,
  linkage_id text not null,
  previous_workflow_state text not null,
  listing_status text null,
  authority_id text null references
    public.seller_os_listing_product_link_authorities_v1(authority_id)
    on delete restrict,
  safe_disposition text not null,
  terminal_workflow_state text not null,
  reason_code text not null,
  evaluated_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_stockguard_legacy_disposition_id_check check (
    disposition_id ~ '^stockguard-legacy-disposition-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_stockguard_legacy_disposition_check check (
    safe_disposition in (
      'BACKFILL_TO_PROVEN_ACTIVE_AUTHORITY',
      'ALLOW_SAFE_TERMINAL_COMPLETION_WITHOUT_CURRENT_AUTHORITY',
      'TERMINALIZE_USING_EXISTING_VALID_JOB_STATE',
      'BLOCK_REQUIRES_HUMAN_REVIEW')),
  constraint seller_os_stockguard_legacy_terminal_state_check check (
    terminal_workflow_state in ('BLOCKED','NOT_APPLICABLE')),
  constraint seller_os_stockguard_legacy_reason_check check (
    reason_code ~ '^[A-Z][A-Z0-9_]{2,119}$')
);

alter table public.seller_os_stockguard_legacy_job_dispositions_v1
  enable row level security;
alter table public.seller_os_stockguard_legacy_job_dispositions_v1
  force row level security;
revoke all on table public.seller_os_stockguard_legacy_job_dispositions_v1
  from public, anon, authenticated, service_role;
grant select on table public.seller_os_stockguard_legacy_job_dispositions_v1
  to service_role;
create policy seller_os_stockguard_legacy_dispositions_service_role_v1
  on public.seller_os_stockguard_legacy_job_dispositions_v1
  for select to service_role using (true);

create or replace function
  public.prevent_seller_os_stockguard_legacy_disposition_mutation_v1()
returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $function$
begin
  raise exception 'STOCKGUARD_LEGACY_JOB_DISPOSITION_IMMUTABLE';
end;
$function$;
drop trigger if exists seller_os_stockguard_legacy_disposition_immutable_v1
  on public.seller_os_stockguard_legacy_job_dispositions_v1;
create trigger seller_os_stockguard_legacy_disposition_immutable_v1
before update or delete
on public.seller_os_stockguard_legacy_job_dispositions_v1
for each row execute function
  public.prevent_seller_os_stockguard_legacy_disposition_mutation_v1();

-- Quiesce job/observation writes for the bounded activation transaction. This
-- preserves old observations and ensures no current worker can insert between
-- legacy classification and strict trigger installation.
lock table public.seller_os_luna_stock_check_jobs
  in share row exclusive mode;
lock table public.seller_os_luna_stock_observations
  in share row exclusive mode;

-- Acquire the same account namespace used by current-live ingestion,
-- quarantine reconciliation and lifecycle transitions. Accounts are sorted,
-- so a multi-account activation cannot introduce a deadlock cycle.
do $migration$
declare
  r record;
begin
  for r in
    select distinct job.account_key
    from public.seller_os_luna_stock_check_jobs job
    where job.workflow_state in
      ('NOT_STARTED','IN_PROGRESS','RETRYABLE_FAILURE')
    order by job.account_key
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'listing-link-authority-v1:account:' || r.account_key, 0));
  end loop;
end;
$migration$;

-- Record a durable disposition for every legacy nonterminal job that has no
-- exact current authority. No SKU/title inference and no authority creation is
-- permitted. Active listings use the existing BLOCKED state; ended or absent
-- listings use the existing NOT_APPLICABLE state.
insert into public.seller_os_stockguard_legacy_job_dispositions_v1 (
  disposition_id,stock_check_job_id,account_key,ebay_item_id,linkage_id,
  previous_workflow_state,listing_status,authority_id,safe_disposition,
  terminal_workflow_state,reason_code,evaluated_at)
select
  'stockguard-legacy-disposition-v1:sha256:' || encode(digest(convert_to(
    jsonb_build_array(job.stock_check_job_id,
      'STOCKGUARD_LISTING_LINK_AUTHORITY_P0_ACTIVATE_V1')::text,
    'UTF8'),'sha256'),'hex'),
  job.stock_check_job_id,job.account_key,job.ebay_item_id,job.linkage_id,
  job.workflow_state,listing.listing_status,null,
  'TERMINALIZE_USING_EXISTING_VALID_JOB_STATE',
  case when listing.listing_status='active' then 'BLOCKED'
    else 'NOT_APPLICABLE' end,
  case when listing.listing_status='active'
    then 'CANONICAL_ACTIVE_LINK_AUTHORITY_UNPROVEN'
    else 'LISTING_NOT_CURRENTLY_ACTIVE' end,
  clock_timestamp()
from public.seller_os_luna_stock_check_jobs job
left join lateral (
  select candidate.listing_status
  from public.ebay_active_listings candidate
  where candidate.account_key=job.account_key
    and candidate.ebay_item_id=job.ebay_item_id
  order by (candidate.listing_status='active') desc,
    candidate.updated_at desc,candidate.id desc
  limit 1
) listing on true
where job.workflow_state in
    ('NOT_STARTED','IN_PROGRESS','RETRYABLE_FAILURE')
  and not exists (
    select 1
    from public.seller_os_listing_product_link_authorities_v1 authority
    where authority.account_key=job.account_key
      and authority.marketplace_id='EBAY_US'
      and authority.ebay_item_id=job.ebay_item_id
      and authority.linkage_id=job.linkage_id
      and authority.lifecycle_state='ACTIVE')
on conflict (stock_check_job_id) do nothing;

update public.seller_os_luna_stock_check_jobs job
set workflow_state=disposition.terminal_workflow_state,
    lease_owner=null,
    lease_expires_at=null,
    updated_at=greatest(clock_timestamp(),job.created_at)
from public.seller_os_stockguard_legacy_job_dispositions_v1 disposition
where disposition.stock_check_job_id=job.stock_check_job_id
  and job.workflow_state in
    ('NOT_STARTED','IN_PROGRESS','RETRYABLE_FAILURE');

-- Fail closed before enforcement if any claimable job remains outside exact
-- ACTIVE authority. This assertion is evaluated while write locks are held.
do $migration$
begin
  if exists (
    select 1
    from public.seller_os_luna_stock_check_jobs job
    where job.workflow_state in
        ('NOT_STARTED','IN_PROGRESS','RETRYABLE_FAILURE')
      and not exists (
        select 1
        from public.seller_os_listing_product_link_authorities_v1 authority
        where authority.account_key=job.account_key
          and authority.marketplace_id='EBAY_US'
          and authority.ebay_item_id=job.ebay_item_id
          and authority.linkage_id=job.linkage_id
          and authority.lifecycle_state='ACTIVE')) then
    raise exception 'STOCKGUARD_LEGACY_NONTERMINAL_AUTHORITY_GAP';
  end if;
end;
$migration$;

drop trigger if exists seller_os_luna_stock_job_authority_p0
  on public.seller_os_luna_stock_check_jobs;
create trigger seller_os_luna_stock_job_authority_p0
before insert or update on public.seller_os_luna_stock_check_jobs
for each row execute function
  public.guard_seller_os_luna_stock_job_authority_p0();
drop trigger if exists seller_os_luna_stock_observation_authority_p0
  on public.seller_os_luna_stock_observations;
create trigger seller_os_luna_stock_observation_authority_p0
before insert on public.seller_os_luna_stock_observations
for each row execute function
  public.guard_seller_os_luna_stock_job_authority_p0();

revoke all on function
  public.prevent_seller_os_stockguard_legacy_disposition_mutation_v1()
  from public,anon,authenticated,service_role;

comment on table public.seller_os_stockguard_legacy_job_dispositions_v1 is
  'Immutable activation audit for pre-authority nonterminal StockGuard jobs; records terminal handling without granting current authority.';
