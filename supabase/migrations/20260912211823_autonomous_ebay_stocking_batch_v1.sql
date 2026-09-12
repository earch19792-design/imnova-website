-- Sequential autonomous stocking batches reuse the certified GREENFIELD lane
-- without reopening or mutating its one-publication certification singleton.
-- Candidate identities can only be claimed by the service-role runtime after
-- normal Radar/Factory ordering; callers can start a batch but cannot provide
-- a product, variant, SKU, package, opportunity, or candidate identity.

create table public.seller_os_autonomous_stocking_batches_v1 (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  contract_version text not null default
    'AUTONOMOUS_EBAY_STOCKING_BATCH_V1',
  idempotency_key text not null,
  target_published_count integer not null,
  status text not null default 'ACTIVE',
  baseline_active_count bigint not null,
  final_active_count bigint null,
  publication_write_count integer not null default 0,
  ads_write_count integer not null default 0,
  evidence jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint autonomous_stocking_batch_account_check check (
    account_key ~ '^[A-Za-z0-9._:-]{3,120}$'),
  constraint autonomous_stocking_batch_version_check check (
    contract_version = 'AUTONOMOUS_EBAY_STOCKING_BATCH_V1'),
  constraint autonomous_stocking_batch_idempotency_check check (
    idempotency_key ~ '^[A-Za-z0-9._:-]{8,160}$'),
  constraint autonomous_stocking_batch_target_check check (
    target_published_count between 1 and 20),
  constraint autonomous_stocking_batch_status_check check (
    status in ('ACTIVE', 'COMPLETED', 'BLOCKED')),
  constraint autonomous_stocking_batch_counts_check check (
    publication_write_count between 0 and target_published_count
    and ads_write_count = 0),
  constraint autonomous_stocking_batch_completion_check check (
    status <> 'COMPLETED' or (
      completed_at is not null and final_active_count is not null
      and final_active_count = baseline_active_count + target_published_count
      and publication_write_count = target_published_count))
);

create unique index autonomous_stocking_batch_idempotency_uidx on
  public.seller_os_autonomous_stocking_batches_v1(
    account_key, idempotency_key);
create unique index autonomous_stocking_batch_one_active_uidx on
  public.seller_os_autonomous_stocking_batches_v1(account_key)
  where status = 'ACTIVE';

create table public.seller_os_autonomous_stocking_batch_children_v1 (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references
    public.seller_os_autonomous_stocking_batches_v1(id) on delete restrict,
  account_key text not null,
  sequence_no integer not null,
  status text not null default 'SELECTING',
  candidate_id text null,
  opportunity_id uuid null references public.ebay_luna_opportunity_queue(id),
  candidate_key text null,
  listing_package_id uuid null references public.ebay_listing_packages(id),
  product_id text null,
  variant_id text null,
  supplier_sku text null,
  publication_id uuid null references
    public.ebay_authorized_listing_publications(id),
  offer_id text null,
  listing_id text null,
  title text null,
  price numeric(12,2) null,
  quantity integer null,
  decision_profit numeric(12,2) null,
  decision_margin numeric(12,6) null,
  active_listing_count_before bigint null,
  active_listing_count_after bigint null,
  publication_write_count integer not null default 0,
  additional_publication_write_count integer not null default 0,
  official_readback_pass boolean not null default false,
  idempotent_replay_confirmed boolean not null default false,
  duplicate_listing_created boolean not null default false,
  duplicate_offer_created boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  selected_at timestamptz null,
  published_confirmed_at timestamptz null,
  replay_confirmed_at timestamptz null,
  updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint autonomous_stocking_child_sequence_check check (
    sequence_no between 1 and 20),
  constraint autonomous_stocking_child_status_check check (status in (
    'SELECTING', 'SELECTED', 'PREPUBLICATION_READY', 'PUBLISHING',
    'PUBLISHED_CONFIRMED', 'REPLAY_CONFIRMED', 'BLOCKED')),
  constraint autonomous_stocking_child_identity_check check (
    (candidate_id is null and opportunity_id is null and candidate_key is null
      and listing_package_id is null and product_id is null
      and variant_id is null and supplier_sku is null)
    or
    (candidate_id is not null and opportunity_id is not null
      and candidate_key is not null and listing_package_id is not null
      and product_id is not null and variant_id is not null
      and supplier_sku is not null)),
  constraint autonomous_stocking_child_listing_check check (
    listing_id is null or listing_id ~ '^[0-9]{9,20}$'),
  constraint autonomous_stocking_child_offer_check check (
    offer_id is null or offer_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  constraint autonomous_stocking_child_counts_check check (
    publication_write_count between 0 and 1
    and additional_publication_write_count = 0),
  constraint autonomous_stocking_child_publish_check check (
    status not in ('PUBLISHED_CONFIRMED', 'REPLAY_CONFIRMED') or (
      publication_id is not null and offer_id is not null
      and listing_id is not null and published_confirmed_at is not null
      and official_readback_pass
      and publication_write_count = 1
      and active_listing_count_before is not null
      and active_listing_count_after = active_listing_count_before + 1
      and not duplicate_listing_created and not duplicate_offer_created)),
  constraint autonomous_stocking_child_replay_check check (
    status <> 'REPLAY_CONFIRMED' or (
      replay_confirmed_at is not null and idempotent_replay_confirmed
      and additional_publication_write_count = 0)),
  unique (batch_id, sequence_no),
  unique (batch_id, candidate_id),
  unique (batch_id, listing_package_id),
  unique (batch_id, publication_id),
  unique (batch_id, listing_id)
);

create index autonomous_stocking_batch_children_state_idx on
  public.seller_os_autonomous_stocking_batch_children_v1(
    batch_id, sequence_no, status);

alter table public.seller_os_autonomous_stocking_batches_v1
  enable row level security;
alter table public.seller_os_autonomous_stocking_batches_v1
  force row level security;
alter table public.seller_os_autonomous_stocking_batch_children_v1
  enable row level security;
alter table public.seller_os_autonomous_stocking_batch_children_v1
  force row level security;
revoke all on table public.seller_os_autonomous_stocking_batches_v1
  from public, anon, authenticated;
revoke all on table public.seller_os_autonomous_stocking_batch_children_v1
  from public, anon, authenticated;
grant select, insert, update on table
  public.seller_os_autonomous_stocking_batches_v1 to service_role;
grant select, insert, update on table
  public.seller_os_autonomous_stocking_batch_children_v1 to service_role;

create or replace function public.start_autonomous_ebay_stocking_batch_v1(
  p_account_key text,
  p_target_published_count integer,
  p_baseline_active_count bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch public.seller_os_autonomous_stocking_batches_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or nullif(trim(coalesce(p_account_key, '')), '') is null
      or p_target_published_count not between 1 and 20
      or p_baseline_active_count < 0
      or coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9._:-]{8,160}$'
      then raise exception 'AUTONOMOUS_STOCKING_BATCH_START_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'autonomous-stocking-batch:' || trim(p_account_key), 0));
  select * into v_batch
  from public.seller_os_autonomous_stocking_batches_v1
  where account_key = trim(p_account_key)
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_batch.target_published_count <> p_target_published_count
        or v_batch.baseline_active_count <> p_baseline_active_count then
      raise exception 'AUTONOMOUS_STOCKING_BATCH_IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(v_batch);
  end if;
  if exists (select 1
      from public.seller_os_autonomous_stocking_batches_v1
      where account_key = trim(p_account_key) and status = 'ACTIVE') then
    raise exception 'AUTONOMOUS_STOCKING_BATCH_ALREADY_ACTIVE';
  end if;
  insert into public.seller_os_autonomous_stocking_batches_v1 (
    account_key, idempotency_key, target_published_count,
    baseline_active_count, evidence
  ) values (
    trim(p_account_key), p_idempotency_key, p_target_published_count,
    p_baseline_active_count,
    jsonb_build_object(
      'manualProductSelection', false,
      'manualProductIdInjection', false,
      'codexRuntimeDependency', false,
      'ownerRoutineApprovalRequired', false,
      'ownerActionRequired', false,
      'legacyDependencyCount', 0,
      'concurrency', 1,
      'adsWriteCount', 0)
  ) returning * into v_batch;
  return to_jsonb(v_batch);
end;
$$;

create or replace function public.ensure_autonomous_stocking_batch_child_v1(
  p_account_key text,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch public.seller_os_autonomous_stocking_batches_v1%rowtype;
  v_child public.seller_os_autonomous_stocking_batch_children_v1%rowtype;
  v_replayed integer;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'AUTONOMOUS_STOCKING_BATCH_SERVICE_ROLE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'autonomous-stocking-batch:' || p_batch_id::text, 0));
  select * into v_batch
  from public.seller_os_autonomous_stocking_batches_v1
  where id = p_batch_id and account_key = trim(p_account_key)
  for update;
  if not found or v_batch.status <> 'ACTIVE' then return null; end if;
  select * into v_child
  from public.seller_os_autonomous_stocking_batch_children_v1
  where batch_id = p_batch_id and status <> 'REPLAY_CONFIRMED'
  order by sequence_no
  limit 1
  for update;
  if found then return to_jsonb(v_child); end if;
  select count(*) into v_replayed
  from public.seller_os_autonomous_stocking_batch_children_v1
  where batch_id = p_batch_id and status = 'REPLAY_CONFIRMED';
  if v_replayed >= v_batch.target_published_count then return null; end if;
  insert into public.seller_os_autonomous_stocking_batch_children_v1 (
    batch_id, account_key, sequence_no
  ) values (p_batch_id, trim(p_account_key), v_replayed + 1)
  returning * into v_child;
  return to_jsonb(v_child);
end;
$$;

create or replace function public.claim_autonomous_stocking_batch_candidate_v1(
  p_account_key text,
  p_batch_id uuid,
  p_child_id uuid,
  p_candidate_id text,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_listing_package_id uuid,
  p_product_id text,
  p_variant_id text,
  p_supplier_sku text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_child public.seller_os_autonomous_stocking_batch_children_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or nullif(trim(coalesce(p_account_key, '')), '') is null
      or p_batch_id is null or p_child_id is null
      or nullif(trim(coalesce(p_candidate_id, '')), '') is null
      or p_opportunity_id is null or p_listing_package_id is null
      or nullif(trim(coalesce(p_candidate_key, '')), '') is null
      or nullif(trim(coalesce(p_product_id, '')), '') is null
      or nullif(trim(coalesce(p_variant_id, '')), '') is null
      or nullif(trim(coalesce(p_supplier_sku, '')), '') is null then
    raise exception 'AUTONOMOUS_STOCKING_BATCH_CLAIM_INVALID';
  end if;
  select child.* into v_child
  from public.seller_os_autonomous_stocking_batch_children_v1 child
  join public.seller_os_autonomous_stocking_batches_v1 batch
    on batch.id = child.batch_id
  where child.id = p_child_id and child.batch_id = p_batch_id
    and child.account_key = trim(p_account_key)
    and batch.status = 'ACTIVE'
  for update of child;
  if not found then
    raise exception 'AUTONOMOUS_STOCKING_BATCH_CHILD_NOT_ACTIVE';
  end if;
  if v_child.status = 'SELECTING' then
    if exists (select 1
      from public.seller_os_autonomous_stocking_batch_children_v1 prior
      where prior.batch_id = p_batch_id
        and prior.sequence_no < v_child.sequence_no
        and prior.status <> 'REPLAY_CONFIRMED') then
      raise exception 'AUTONOMOUS_STOCKING_BATCH_SEQUENCE_VIOLATION';
    end if;
    update public.seller_os_autonomous_stocking_batch_children_v1 set
      status = 'SELECTED', candidate_id = trim(p_candidate_id),
      opportunity_id = p_opportunity_id,
      candidate_key = trim(p_candidate_key),
      listing_package_id = p_listing_package_id,
      product_id = trim(p_product_id), variant_id = trim(p_variant_id),
      supplier_sku = trim(p_supplier_sku),
      evidence = evidence || coalesce(p_evidence, '{}'::jsonb),
      selected_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = p_child_id and status = 'SELECTING'
    returning * into v_child;
  end if;
  return to_jsonb(v_child);
end;
$$;

revoke all on function public.start_autonomous_ebay_stocking_batch_v1(
  text,integer,bigint,text) from public, anon, authenticated;
revoke all on function public.ensure_autonomous_stocking_batch_child_v1(
  text,uuid) from public, anon, authenticated;
revoke all on function public.claim_autonomous_stocking_batch_candidate_v1(
  text,uuid,uuid,text,uuid,text,uuid,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.start_autonomous_ebay_stocking_batch_v1(
  text,integer,bigint,text) to service_role;
grant execute on function public.ensure_autonomous_stocking_batch_child_v1(
  text,uuid) to service_role;
grant execute on function public.claim_autonomous_stocking_batch_candidate_v1(
  text,uuid,uuid,text,uuid,text,uuid,text,text,text,jsonb) to service_role;

comment on table public.seller_os_autonomous_stocking_batches_v1 is
  'Fail-closed autonomous multi-publication authority. It accepts a target count but never a candidate identity; the certified runtime lane selects all children.';
comment on table public.seller_os_autonomous_stocking_batch_children_v1 is
  'Sequential CURRENT publication children. Child N+1 cannot be created until child N has official publication confirmation and zero-write replay confirmation.';

notify pgrst, 'reload schema';
