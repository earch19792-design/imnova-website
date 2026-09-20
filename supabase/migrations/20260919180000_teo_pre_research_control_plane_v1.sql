-- TEO_PRE_RESEARCH_CONTROL_PLANE_V1
-- Additive orchestration authority for bounded NORMAL Luna Pre-Research only.
-- No marketplace, StockGuard, Commercial Trace, Publisher, or research capture
-- rows are written by this migration.

create table public.seller_os_pre_research_command_capabilities_v1 (
  capability_id uuid primary key default gen_random_uuid(),
  capability_code text not null
    check (capability_code = 'TEO_PRE_RESEARCH_NORMAL_BATCH_V1'),
  marketplace_account_key text not null
    check (char_length(marketplace_account_key) between 8 and 160),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  command_client_id text not null
    check (char_length(command_client_id) between 8 and 240
      and command_client_id !~ '[[:cntrl:]]'),
  allowed_contract_version text not null
    check (allowed_contract_version =
      'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'),
  maximum_candidates integer not null check (maximum_candidates between 1 and 50),
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz,
  expires_at timestamptz,
  constraint seller_os_pre_research_command_capability_state_v1 check (
    (enabled and disabled_at is null)
    or (not enabled and disabled_at is not null)),
  constraint seller_os_pre_research_command_capability_expiry_v1 check (
    expires_at is null or expires_at > created_at),
  unique (capability_code, marketplace_account_key, owner_user_id,
    command_client_id)
);

create table public.seller_os_pre_research_batches_v1 (
  batch_id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null
    check (char_length(marketplace_account_key) between 8 and 160),
  source_snapshot_id uuid not null references
    public.luna_catalog_snapshots_v1(snapshot_id) on delete restrict,
  candidate_identity_digest text not null
    check (candidate_identity_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_count integer not null check (candidate_count between 1 and 50),
  contract_version text not null check (contract_version =
    'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'),
  owner_authorization_id uuid not null references
    public.seller_os_pre_research_command_capabilities_v1(capability_id)
    on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  command_client_id text not null,
  client_idempotency_key text not null
    check (client_idempotency_key ~ '^[A-Za-z0-9._:-]{8,160}$'),
  batch_state text not null check (batch_state in
    ('REQUESTED','AUTHORIZED','RUNNING','NEEDS_ATTENTION','COMPLETED','CANCELLED')),
  created_at timestamptz not null default clock_timestamp(),
  authorized_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_pre_research_batch_timestamps_v1 check (
    (batch_state = 'REQUESTED' or authorized_at is not null)
    and (batch_state not in ('RUNNING','NEEDS_ATTENTION','COMPLETED')
      or started_at is not null)
    and (batch_state <> 'COMPLETED' or completed_at is not null)),
  unique (owner_authorization_id, source_snapshot_id,
    candidate_identity_digest, client_idempotency_key)
);

create table public.seller_os_pre_research_batch_members_v1 (
  member_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.seller_os_pre_research_batches_v1(batch_id)
    on delete restrict,
  ordinal integer not null check (ordinal between 1 and 50),
  luna_product_id text not null check (luna_product_id ~ '^[0-9]{1,30}$'),
  luna_variant_id text not null check (luna_variant_id ~ '^[0-9]{1,30}$'),
  luna_sku text not null check (char_length(luna_sku) between 1 and 160),
  source_candidate_key text not null
    check (source_candidate_key ~ '^sha256:[0-9a-f]{64}$'),
  product_truth_fingerprint text not null
    check (product_truth_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  plan_id uuid references public.marketplace_product_research_query_plans(id)
    on delete restrict,
  execution_state text not null default 'PENDING' check (execution_state in
    ('PENDING','RUNNING','NEEDS_ATTENTION','COMPLETED','CANCELLED')),
  bounded_failure_reason text check (bounded_failure_reason is null or
    bounded_failure_reason ~ '^[A-Z0-9_]{3,180}$'),
  retry_safety text check (retry_safety is null or retry_safety in
    ('SAFE_IDEMPOTENT_RUNTIME_RESUME','ENGINEERING_REQUIRED')),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (batch_id, ordinal),
  unique (batch_id, source_candidate_key),
  unique (batch_id, luna_product_id, luna_variant_id, luna_sku),
  unique (batch_id, plan_id)
);

create table public.seller_os_pre_research_batch_events_v1 (
  event_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.seller_os_pre_research_batches_v1(batch_id)
    on delete restrict,
  member_id uuid references public.seller_os_pre_research_batch_members_v1(member_id)
    on delete restrict,
  event_type text not null check (event_type in
    ('REQUESTED','AUTHORIZED','PLAN_ATTACHED','RUNNING','NEEDS_ATTENTION',
      'RESUMED','COMPLETED','CANCELLED')),
  actor_kind text not null check (actor_kind in
    ('OWNER_AUTHORIZATION','COMMAND_CLIENT','BROWSER_WORKER','DATABASE_RECONCILER')),
  actor_subject text not null check (char_length(actor_subject) between 1 and 240),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

create index seller_os_pre_research_batch_runner_v1_idx
  on public.seller_os_pre_research_batch_members_v1(execution_state, updated_at, ordinal)
  where execution_state in ('PENDING','RUNNING','NEEDS_ATTENTION');
create index seller_os_pre_research_batch_plan_v1_idx
  on public.seller_os_pre_research_batch_members_v1(plan_id)
  where plan_id is not null;
create index seller_os_pre_research_batch_state_v1_idx
  on public.seller_os_pre_research_batches_v1(
    marketplace_account_key, batch_state, created_at);

alter table public.seller_os_pre_research_command_capabilities_v1
  enable row level security;
alter table public.seller_os_pre_research_command_capabilities_v1
  force row level security;
alter table public.seller_os_pre_research_batches_v1 enable row level security;
alter table public.seller_os_pre_research_batches_v1 force row level security;
alter table public.seller_os_pre_research_batch_members_v1 enable row level security;
alter table public.seller_os_pre_research_batch_members_v1 force row level security;
alter table public.seller_os_pre_research_batch_events_v1 enable row level security;
alter table public.seller_os_pre_research_batch_events_v1 force row level security;

revoke all on table public.seller_os_pre_research_command_capabilities_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_pre_research_batches_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_pre_research_batch_members_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_pre_research_batch_events_v1
  from public, anon, authenticated, service_role;
grant select, insert, update on table
  public.seller_os_pre_research_command_capabilities_v1 to service_role;
grant select, insert, update on table public.seller_os_pre_research_batches_v1
  to service_role;
grant select, insert, update on table
  public.seller_os_pre_research_batch_members_v1 to service_role;
grant select, insert on table public.seller_os_pre_research_batch_events_v1
  to service_role;

create or replace function public.authorize_seller_os_pre_research_command_v1(
  p_marketplace_account_key text, p_owner_user_id uuid,
  p_command_client_id text, p_maximum_candidates integer,
  p_expires_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_capability public.seller_os_pre_research_command_capabilities_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_owner_user_id is null
      or char_length(coalesce(p_command_client_id,'')) not between 8 and 240
      or p_command_client_id ~ '[[:cntrl:]]'
      or p_maximum_candidates not between 1 and 50
      or (p_expires_at is not null and p_expires_at <= clock_timestamp()) then
    raise exception 'TEO_PRE_RESEARCH_CAPABILITY_INVALID';
  end if;
  insert into public.seller_os_pre_research_command_capabilities_v1(
    capability_code,marketplace_account_key,owner_user_id,command_client_id,
    allowed_contract_version,maximum_candidates,enabled,expires_at)
  values ('TEO_PRE_RESEARCH_NORMAL_BATCH_V1',p_marketplace_account_key,
    p_owner_user_id,p_command_client_id,
    'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19',p_maximum_candidates,true,p_expires_at)
  on conflict (capability_code,marketplace_account_key,owner_user_id,command_client_id)
  do update set enabled=true, disabled_at=null, expires_at=excluded.expires_at,
    maximum_candidates=excluded.maximum_candidates,updated_at=clock_timestamp()
  returning * into v_capability;
  return jsonb_build_object('capabilityId',v_capability.capability_id,
    'capabilityCode',v_capability.capability_code,'enabled',v_capability.enabled,
    'maximumCandidates',v_capability.maximum_candidates,
    'contractVersion',v_capability.allowed_contract_version,
    'commandClientId',v_capability.command_client_id);
end $function$;

create or replace function public.disable_seller_os_pre_research_command_v1(
  p_marketplace_account_key text, p_owner_user_id uuid,
  p_command_client_id text)
returns boolean language plpgsql security definer set search_path = '' as $function$
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_owner_user_id is null or coalesce(p_command_client_id,'') = '' then
    raise exception 'TEO_PRE_RESEARCH_CAPABILITY_DISABLE_INVALID';
  end if;
  update public.seller_os_pre_research_command_capabilities_v1 capability
  set enabled=false,disabled_at=clock_timestamp(),updated_at=clock_timestamp()
  where capability.capability_code='TEO_PRE_RESEARCH_NORMAL_BATCH_V1'
    and capability.marketplace_account_key=p_marketplace_account_key
    and capability.owner_user_id=p_owner_user_id
    and capability.command_client_id=p_command_client_id and capability.enabled;
  return found;
end $function$;

create or replace function public.request_seller_os_pre_research_batch_v1(
  p_marketplace_account_key text, p_owner_user_id uuid,
  p_command_client_id text, p_snapshot_id uuid,
  p_contract_version text, p_candidate_identity_digest text,
  p_client_idempotency_key text, p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_capability public.seller_os_pre_research_command_capabilities_v1%rowtype;
  v_batch public.seller_os_pre_research_batches_v1%rowtype;
  v_count integer := jsonb_array_length(coalesce(p_candidates,'[]'::jsonb));
  v_created boolean := false;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_contract_version <> 'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
      or p_candidate_identity_digest !~ '^sha256:[0-9a-f]{64}$'
      or p_client_idempotency_key !~ '^[A-Za-z0-9._:-]{8,160}$'
      or jsonb_typeof(p_candidates) is distinct from 'array'
      or v_count not between 1 and 50 then
    raise exception 'TEO_PRE_RESEARCH_BATCH_REQUEST_INVALID';
  end if;
  select capability.* into v_capability
  from public.seller_os_pre_research_command_capabilities_v1 capability
  where capability.capability_code='TEO_PRE_RESEARCH_NORMAL_BATCH_V1'
    and capability.marketplace_account_key=p_marketplace_account_key
    and capability.owner_user_id=p_owner_user_id
    and capability.command_client_id=p_command_client_id
    and capability.allowed_contract_version=p_contract_version
    and capability.enabled
    and (capability.expires_at is null or capability.expires_at > clock_timestamp())
  for update;
  if not found or v_count > v_capability.maximum_candidates then
    raise exception 'TEO_PRE_RESEARCH_CAPABILITY_DENIED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'teo-pre-research-batch:' || v_capability.capability_id::text || ':' ||
    p_snapshot_id::text || ':' || p_candidate_identity_digest || ':' ||
    p_client_idempotency_key, 0));
  if not exists (select 1 from public.luna_catalog_snapshots_v1 snapshot
    where snapshot.snapshot_id=p_snapshot_id and snapshot.snapshot_status='COMPLETE')
  then raise exception 'TEO_PRE_RESEARCH_SNAPSHOT_NOT_COMPLETE'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_candidates) with ordinality c(value,ordinal)
    left join public.luna_catalog_snapshot_variants_v1 variant
      on variant.snapshot_id=p_snapshot_id
      and variant.product_id=c.value->>'productId'
      and variant.variant_id=c.value->>'variantId'
      and variant.sku=c.value->>'sku'
    where jsonb_typeof(c.value) is distinct from 'object'
      or (select array_agg(key order by key) from jsonb_object_keys(c.value) key)
        is distinct from array['productId','productTruthFingerprint',
          'sku','sourceCandidateKey','variantId']::text[]
      or coalesce(c.value->>'productId','') !~ '^[0-9]{1,30}$'
      or coalesce(c.value->>'variantId','') !~ '^[0-9]{1,30}$'
      or coalesce(c.value->>'sourceCandidateKey','') !~ '^sha256:[0-9a-f]{64}$'
      or coalesce(c.value->>'productTruthFingerprint','') !~ '^sha256:[0-9a-f]{64}$'
      or variant.snapshot_id is null or variant.preflight_status <> 'PREFLIGHT_PASS'
  ) or (select count(distinct concat_ws(E'\x1f',value->>'productId',
      value->>'variantId',value->>'sku')) from jsonb_array_elements(p_candidates)) <> v_count
  then raise exception 'TEO_PRE_RESEARCH_CANDIDATE_IDENTITY_INVALID'; end if;

  select batch.* into v_batch from public.seller_os_pre_research_batches_v1 batch
  where batch.owner_authorization_id=v_capability.capability_id
    and batch.source_snapshot_id=p_snapshot_id
    and batch.candidate_identity_digest=p_candidate_identity_digest
    and batch.client_idempotency_key=p_client_idempotency_key for update;
  if found then
    if v_batch.contract_version is distinct from p_contract_version
      or v_batch.command_client_id is distinct from p_command_client_id
      or v_batch.owner_user_id is distinct from p_owner_user_id
      or v_batch.candidate_count <> v_count
      or exists (select 1 from jsonb_array_elements(p_candidates) c
        where not exists (select 1
          from public.seller_os_pre_research_batch_members_v1 member
          where member.batch_id=v_batch.batch_id
            and member.luna_product_id=c->>'productId'
            and member.luna_variant_id=c->>'variantId'
            and member.luna_sku=c->>'sku'
            and member.source_candidate_key=c->>'sourceCandidateKey'
            and member.product_truth_fingerprint=c->>'productTruthFingerprint')) then
      raise exception 'TEO_PRE_RESEARCH_BATCH_IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object('batchId',v_batch.batch_id,'created',false,
      'state',v_batch.batch_state,'candidateCount',v_batch.candidate_count);
  end if;

  insert into public.seller_os_pre_research_batches_v1(
    marketplace_account_key,source_snapshot_id,candidate_identity_digest,
    candidate_count,contract_version,owner_authorization_id,owner_user_id,
    command_client_id,client_idempotency_key,batch_state)
  values (p_marketplace_account_key,p_snapshot_id,p_candidate_identity_digest,
    v_count,p_contract_version,v_capability.capability_id,p_owner_user_id,
    p_command_client_id,p_client_idempotency_key,'REQUESTED') returning * into v_batch;
  insert into public.seller_os_pre_research_batch_members_v1(
    batch_id,ordinal,luna_product_id,luna_variant_id,luna_sku,
    source_candidate_key,product_truth_fingerprint)
  select v_batch.batch_id,c.ordinal,(c.value->>'productId'),
    (c.value->>'variantId'),(c.value->>'sku'),(c.value->>'sourceCandidateKey'),
    (c.value->>'productTruthFingerprint')
  from jsonb_array_elements(p_candidates) with ordinality c(value,ordinal);
  update public.seller_os_pre_research_batches_v1 set batch_state='AUTHORIZED',
    authorized_at=clock_timestamp(),updated_at=clock_timestamp()
  where batch_id=v_batch.batch_id returning * into v_batch;
  insert into public.seller_os_pre_research_batch_events_v1(
    batch_id,event_type,actor_kind,actor_subject,detail)
  values (v_batch.batch_id,'AUTHORIZED','COMMAND_CLIENT',p_command_client_id,
    jsonb_build_object('ownerUserId',p_owner_user_id,'candidateCount',v_count));
  return jsonb_build_object('batchId',v_batch.batch_id,'created',true,
    'state',v_batch.batch_state,'candidateCount',v_count);
end $function$;

create or replace function public.attach_seller_os_pre_research_batch_plans_v1(
  p_batch_id uuid, p_owner_user_id uuid, p_command_client_id text,
  p_plans jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_batch public.seller_os_pre_research_batches_v1%rowtype; v_attached integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or jsonb_typeof(p_plans) is distinct from 'array' then
    raise exception 'TEO_PRE_RESEARCH_PLAN_ATTACH_INVALID';
  end if;
  select batch.* into v_batch from public.seller_os_pre_research_batches_v1 batch
  join public.seller_os_pre_research_command_capabilities_v1 capability
    on capability.capability_id=batch.owner_authorization_id
  where batch.batch_id=p_batch_id and batch.owner_user_id=p_owner_user_id
    and batch.command_client_id=p_command_client_id and capability.enabled
    and (capability.expires_at is null or capability.expires_at > clock_timestamp())
  for update of batch;
  if not found then raise exception 'TEO_PRE_RESEARCH_BATCH_AUTHORITY_DENIED'; end if;
  if exists (select 1 from jsonb_array_elements(p_plans) item
    left join public.seller_os_pre_research_batch_members_v1 member
      on member.batch_id=p_batch_id
      and member.luna_product_id=item->>'productId'
      and member.luna_variant_id=item->>'variantId' and member.luna_sku=item->>'sku'
    left join public.marketplace_product_research_query_plans plan
      on plan.id=(item->>'planId')::uuid
      and plan.marketplace_account_key=v_batch.marketplace_account_key
      and plan.marketplace='EBAY_US' and plan.source_context='LUNA_PRE_RESEARCH'
      and plan.pre_research_rerun_cohort_id is null
      and plan.source_luna_snapshot_id=v_batch.source_snapshot_id
      and plan.source_luna_product_id=member.luna_product_id
      and plan.subject_supplier_variant_id=member.luna_variant_id
      and plan.source_supplier_sku=member.luna_sku
      and plan.source_candidate_key=member.source_candidate_key
      and plan.source_product_truth_fingerprint=member.product_truth_fingerprint
    where member.member_id is null or plan.id is null
      or (member.plan_id is not null and member.plan_id <> plan.id)) then
    raise exception 'TEO_PRE_RESEARCH_PLAN_IDENTITY_MISMATCH';
  end if;
  update public.seller_os_pre_research_batch_members_v1 member
  set plan_id=plan.id,
    execution_state=case when plan.status='COMPLETED' then 'COMPLETED'
      else 'PENDING' end,
    completed_at=case when plan.status='COMPLETED' then plan.completed_at else null end,
    updated_at=clock_timestamp()
  from jsonb_array_elements(p_plans) item(value)
  join public.marketplace_product_research_query_plans plan
    on plan.id=(item.value->>'planId')::uuid
  where member.batch_id=p_batch_id
    and member.luna_product_id=item.value->>'productId'
    and member.luna_variant_id=item.value->>'variantId'
    and member.luna_sku=item.value->>'sku' and member.plan_id is null;
  get diagnostics v_attached=row_count;
  update public.seller_os_pre_research_batches_v1 batch set
    batch_state=case when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 member
      where member.batch_id=p_batch_id and member.execution_state<>'COMPLETED')
      then 'COMPLETED' else batch.batch_state end,
    started_at=case when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 member
      where member.batch_id=p_batch_id and member.execution_state<>'COMPLETED')
      then coalesce(batch.started_at,clock_timestamp()) else batch.started_at end,
    completed_at=case when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 member
      where member.batch_id=p_batch_id and member.execution_state<>'COMPLETED')
      then coalesce(batch.completed_at,clock_timestamp()) else batch.completed_at end,
    updated_at=clock_timestamp() where batch.batch_id=p_batch_id;
  insert into public.seller_os_pre_research_batch_events_v1(
    batch_id,event_type,actor_kind,actor_subject,detail)
  values (p_batch_id,'PLAN_ATTACHED','COMMAND_CLIENT',p_command_client_id,
    jsonb_build_object('newPlanAttachments',v_attached));
  return jsonb_build_object('batchId',p_batch_id,'newPlanAttachments',v_attached,
    'attachedPlanCount',(select count(*) from public.seller_os_pre_research_batch_members_v1
      where batch_id=p_batch_id and plan_id is not null));
end $function$;

create or replace function public.guard_seller_os_pre_research_batch_immutability_v1()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_table_name='seller_os_pre_research_batches_v1' and (
      old.marketplace_account_key is distinct from new.marketplace_account_key
      or old.source_snapshot_id is distinct from new.source_snapshot_id
      or old.candidate_identity_digest is distinct from new.candidate_identity_digest
      or old.candidate_count is distinct from new.candidate_count
      or old.contract_version is distinct from new.contract_version
      or old.owner_authorization_id is distinct from new.owner_authorization_id
      or old.owner_user_id is distinct from new.owner_user_id
      or old.command_client_id is distinct from new.command_client_id
      or old.client_idempotency_key is distinct from new.client_idempotency_key) then
    raise exception 'TEO_PRE_RESEARCH_BATCH_IDENTITY_IMMUTABLE';
  end if;
  if tg_table_name='seller_os_pre_research_batch_members_v1' and (
      old.batch_id is distinct from new.batch_id
      or old.ordinal is distinct from new.ordinal
      or old.luna_product_id is distinct from new.luna_product_id
      or old.luna_variant_id is distinct from new.luna_variant_id
      or old.luna_sku is distinct from new.luna_sku
      or old.source_candidate_key is distinct from new.source_candidate_key
      or old.product_truth_fingerprint is distinct from new.product_truth_fingerprint
      or (old.plan_id is not null and old.plan_id is distinct from new.plan_id)) then
    raise exception 'TEO_PRE_RESEARCH_BATCH_MEMBERSHIP_IMMUTABLE';
  end if;
  return new;
end $function$;

create trigger seller_os_pre_research_batch_identity_immutable_v1
before update on public.seller_os_pre_research_batches_v1 for each row
execute function public.guard_seller_os_pre_research_batch_immutability_v1();
create trigger seller_os_pre_research_batch_member_identity_immutable_v1
before update on public.seller_os_pre_research_batch_members_v1 for each row
execute function public.guard_seller_os_pre_research_batch_immutability_v1();

create or replace function public.reconcile_seller_os_pre_research_batch_member_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_member public.seller_os_pre_research_batch_members_v1%rowtype; v_state text;
begin
  select * into v_member from public.seller_os_pre_research_batch_members_v1
    where plan_id=new.id for update;
  if not found then return new; end if;
  v_state := case
    when new.status='COMPLETED' then 'COMPLETED'
    when new.worker_lease_owner is not null and new.worker_lease_expires_at > clock_timestamp()
      then 'RUNNING'
    when new.worker_last_result->>'state'='RECOVERY_POLICY_EXHAUSTED'
      then 'NEEDS_ATTENTION'
    when new.worker_last_result->>'state'='RELEASED_RETRY_SAFE'
      then 'NEEDS_ATTENTION'
    else 'PENDING' end;
  update public.seller_os_pre_research_batch_members_v1 set execution_state=v_state,
    started_at=case when v_state in ('RUNNING','NEEDS_ATTENTION','COMPLETED')
      then coalesce(started_at,new.worker_last_claimed_at,clock_timestamp()) else started_at end,
    completed_at=case when v_state='COMPLETED' then new.completed_at else null end,
    bounded_failure_reason=case when v_state='NEEDS_ATTENTION'
      then new.worker_last_release_code else null end,
    retry_safety=case when v_state='NEEDS_ATTENTION'
      then new.worker_last_result->>'retrySafety' else null end,
    updated_at=clock_timestamp() where member_id=v_member.member_id;
  update public.seller_os_pre_research_batches_v1 batch set
    batch_state=case
      when not exists (select 1 from public.seller_os_pre_research_batch_members_v1 m
        where m.batch_id=batch.batch_id and m.execution_state<>'COMPLETED') then 'COMPLETED'
      when exists (select 1 from public.seller_os_pre_research_batch_members_v1 m
        where m.batch_id=batch.batch_id and m.execution_state='NEEDS_ATTENTION')
        then 'NEEDS_ATTENTION'
      when exists (select 1 from public.seller_os_pre_research_batch_members_v1 m
        where m.batch_id=batch.batch_id and m.execution_state='RUNNING') then 'RUNNING'
      else 'AUTHORIZED' end,
    started_at=case when v_state in ('RUNNING','NEEDS_ATTENTION','COMPLETED')
      then coalesce(batch.started_at,clock_timestamp()) else batch.started_at end,
    completed_at=case when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 m
      where m.batch_id=batch.batch_id and m.execution_state<>'COMPLETED')
      then coalesce(batch.completed_at,clock_timestamp()) else null end,
    updated_at=clock_timestamp() where batch.batch_id=v_member.batch_id;
  return new;
end $function$;

drop trigger if exists seller_os_pre_research_batch_plan_reconcile_v1
  on public.marketplace_product_research_query_plans;
create trigger seller_os_pre_research_batch_plan_reconcile_v1
after update of status,worker_lease_owner,worker_lease_expires_at,
  worker_last_result,worker_last_release_code,completed_at
on public.marketplace_product_research_query_plans for each row
execute function public.reconcile_seller_os_pre_research_batch_member_v1();

create or replace function public.next_seller_os_pre_research_batch_plan_v1(
  p_marketplace_account_key text)
returns jsonb language sql security definer set search_path = '' stable as $function$
  select case when not public.is_seller_os_service_role_request_v1() then
    null::jsonb else coalesce((select jsonb_build_object('batchId',batch.batch_id,
      'memberId',member.member_id,'planId',member.plan_id)
    from public.seller_os_pre_research_batches_v1 batch
    join public.seller_os_pre_research_command_capabilities_v1 capability
      on capability.capability_id=batch.owner_authorization_id
    join public.seller_os_pre_research_batch_members_v1 member
      on member.batch_id=batch.batch_id
    join public.marketplace_product_research_query_plans plan on plan.id=member.plan_id
    where batch.marketplace_account_key=p_marketplace_account_key
      and batch.batch_state in ('AUTHORIZED','RUNNING') and capability.enabled
      and (capability.expires_at is null or capability.expires_at>clock_timestamp())
      and member.execution_state='PENDING' and plan.status='ACTIVE'
      and plan.source_context='LUNA_PRE_RESEARCH'
      and plan.pre_research_rerun_cohort_id is null
      and plan.worker_lease_owner is null
      and (plan.worker_next_retry_at is null or plan.worker_next_retry_at<=clock_timestamp())
    order by batch.created_at,member.ordinal limit 1),
    jsonb_build_object('batchId',null,'memberId',null,'planId',null)) end
$function$;

create or replace function public.resume_seller_os_pre_research_batch_v1(
  p_batch_id uuid,p_owner_user_id uuid,p_command_client_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_batch public.seller_os_pre_research_batches_v1%rowtype; v_count integer;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'TEO_PRE_RESEARCH_RESUME_DENIED'; end if;
  select batch.* into v_batch from public.seller_os_pre_research_batches_v1 batch
  join public.seller_os_pre_research_command_capabilities_v1 capability
    on capability.capability_id=batch.owner_authorization_id
  where batch.batch_id=p_batch_id and batch.owner_user_id=p_owner_user_id
    and batch.command_client_id=p_command_client_id and capability.enabled
    and (capability.expires_at is null or capability.expires_at>clock_timestamp())
  for update of batch;
  if not found then raise exception 'TEO_PRE_RESEARCH_RESUME_DENIED'; end if;
  if exists (select 1 from public.seller_os_pre_research_batch_members_v1 member
    join public.marketplace_product_research_query_plans plan on plan.id=member.plan_id
    where member.batch_id=p_batch_id and member.execution_state='NEEDS_ATTENTION'
      and (member.retry_safety is distinct from 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
        or plan.status<>'ACTIVE' or plan.worker_lease_owner is not null
        or plan.worker_claim_count>=5)) then
    raise exception 'TEO_PRE_RESEARCH_NON_RETRY_SAFE_MEMBER';
  end if;
  update public.seller_os_pre_research_batch_members_v1 member set
    execution_state='PENDING',bounded_failure_reason=null,retry_safety=null,
    updated_at=clock_timestamp()
  where member.batch_id=p_batch_id and member.execution_state='NEEDS_ATTENTION';
  get diagnostics v_count=row_count;
  update public.seller_os_pre_research_batches_v1 set batch_state=case
    when v_count>0 then 'AUTHORIZED' else batch_state end,updated_at=clock_timestamp()
  where batch_id=p_batch_id;
  insert into public.seller_os_pre_research_batch_events_v1(
    batch_id,event_type,actor_kind,actor_subject,detail)
  values (p_batch_id,'RESUMED','COMMAND_CLIENT',p_command_client_id,
    jsonb_build_object('resumedMembers',v_count));
  return jsonb_build_object('batchId',p_batch_id,'resumedMembers',v_count);
end $function$;

-- Replace the shared Product Research claim function so plans attached to an
-- authorized control-plane batch can only be claimed by explicit plan ID while
-- their durable owner capability remains enabled. Non-batch claim behavior is
-- otherwise preserved byte-for-byte from the certified claim contract.
create or replace function public.claim_next_live_listing_product_research_v2(
  p_marketplace_account_key text, p_worker_id text,
  p_worker_capability jsonb, p_plan_id uuid default null,
  p_lease_seconds integer default 300)
returns table(claimed boolean, ledger_id uuid, plan_id uuid,
  lease_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_capability_observed_at timestamptz;
  v_heartbeat_receipt_id uuid;
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_ledger_id uuid;
  v_lease_expires_at timestamptz;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_marketplace_account_key is null
      or char_length(p_marketplace_account_key) not between 8 and 160
      or p_worker_id is null
      or char_length(p_worker_id) not between 8 and 160
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_lease_seconds not between 120 and 900
      or jsonb_typeof(p_worker_capability) is distinct from 'object'
      or p_worker_capability ->> 'handshakeStatus' is distinct from 'PASS'
      or p_worker_capability ->> 'workerCapability' is distinct from 'PASS'
      or p_worker_capability ->> 'extensionIdentityMatch' is distinct from 'true'
      or p_worker_capability ->> 'cookieAccess' is distinct from 'false'
      or p_worker_capability ->> 'marketplaceWrites' is distinct from '0'
      or p_worker_capability ->> 'heartbeatSource' is distinct from
        'INDEPENDENT_WORKER_LIVENESS'
      or coalesce(p_worker_capability ->> 'extensionVersion','') = '' then
    raise exception 'PRODUCT_RESEARCH_WORKER_CLAIM_INVALID';
  end if;
  begin
    v_capability_observed_at :=
      (p_worker_capability ->> 'observedAt')::timestamptz;
    v_heartbeat_receipt_id :=
      (p_worker_capability ->> 'heartbeatReceiptId')::uuid;
  exception when others then
    raise exception 'PRODUCT_RESEARCH_WORKER_CAPABILITY_TIME_INVALID';
  end;
  if v_capability_observed_at < clock_timestamp() - interval '5 minutes'
      or v_capability_observed_at > clock_timestamp() + interval '1 minute'
      or not exists (
        select 1
        from public.seller_os_browser_worker_capabilities_v1 capability
        where capability.marketplace_account_key = p_marketplace_account_key
          and capability.capability_id in
            ('PRODUCT_RESEARCH_EXTENSION','PRODUCT_RESEARCH_BROWSER_WORKER')
          and capability.worker_instance_id = p_worker_id
          and capability.heartbeat_receipt_id = v_heartbeat_receipt_id
          and capability.heartbeat_source = 'INDEPENDENT_WORKER_LIVENESS'
          and capability.physical_connection = 'PROVEN_AVAILABLE'
          and capability.extension_identity_match = true
          and capability.observed_at = v_capability_observed_at
          and capability.fresh_until > clock_timestamp()
        group by capability.heartbeat_receipt_id having count(*) = 2) then
    raise exception 'PRODUCT_RESEARCH_WORKER_CAPABILITY_STALE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'product-research-browser:' || p_marketplace_account_key, 0));
  if exists (
    select 1 from public.seller_os_operational_learning_ledger_v1 ledger
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.invariant_code = 'LIVE_LISTING_RESEARCH_REQUIRED'
      and ledger.status = 'OPEN' and ledger.lease_owner = p_worker_id
      and ledger.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1 from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context in
        ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.worker_lease_owner = p_worker_id
      and plan.worker_lease_expires_at > clock_timestamp()
  ) then
    return query select false, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  select plan.* into v_plan
  from public.marketplace_product_research_query_plans plan
  left join public.seller_os_operational_learning_ledger_v1 ledger
    on ledger.id = plan.request_receipt_id
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in
      ('LIVE_LISTING_REVALIDATION','QUICK_PICK_RESEARCH_REQUIRED',
        'LUNA_PRE_RESEARCH')
    and plan.status = 'ACTIVE'
    and (p_plan_id is null or plan.id = p_plan_id)
    and (p_plan_id is not null
      or plan.pre_research_rerun_cohort_id is null)
    and (
      not exists (
        select 1
        from public.seller_os_pre_research_batch_members_v1 batch_member
        where batch_member.plan_id = plan.id)
      or (p_plan_id is not null and exists (
        select 1
        from public.seller_os_pre_research_batch_members_v1 batch_member
        join public.seller_os_pre_research_batches_v1 batch
          on batch.batch_id = batch_member.batch_id
        join public.seller_os_pre_research_command_capabilities_v1 capability
          on capability.capability_id = batch.owner_authorization_id
        where batch_member.plan_id = plan.id
          and batch_member.execution_state = 'PENDING'
          and batch.batch_state in ('AUTHORIZED','RUNNING')
          and capability.enabled
          and (capability.expires_at is null
            or capability.expires_at > clock_timestamp())))
    )
    and exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id
        and task.marketplace_account_key = p_marketplace_account_key
        and task.marketplace = 'EBAY_US' and task.status = 'PENDING')
    and ((plan.source_context = 'LIVE_LISTING_REVALIDATION'
      and ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.invariant_code = 'LIVE_LISTING_RESEARCH_REQUIRED'
      and ledger.mechanism_version =
        'MAYEL_LIVE_MARKET_REVALIDATION_V1_2026_09_06'
      and ledger.status = 'OPEN'
      and ledger.recovery_class = 'AUTO_RECOVERABLE'
      and ledger.retry_safety = 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
      and ledger.recovery_attempt_count < 5
      and (ledger.lease_expires_at is null
        or ledger.lease_expires_at <= clock_timestamp())
      and (ledger.recovery_outcome <> 'STILL_VIOLATED'
        or ledger.last_observed_at <= clock_timestamp() - interval '5 minutes'))
      or plan.source_context in
        ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.worker_claim_count < 5
      and (plan.worker_lease_expires_at is null
        or plan.worker_lease_expires_at <= clock_timestamp())
      and (plan.worker_next_retry_at is null
        or plan.worker_next_retry_at <= clock_timestamp()))
  order by case when plan.source_context in
      ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      then plan.worker_claim_count else ledger.recovery_attempt_count end,
    plan.created_at, plan.id
  limit 1 for update of plan skip locked;
  if not found then
    return query select false, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  v_lease_expires_at := clock_timestamp() +
    make_interval(secs => p_lease_seconds);
  if v_plan.source_context = 'LIVE_LISTING_REVALIDATION' then
    update public.seller_os_operational_learning_ledger_v1 ledger
    set lease_owner = p_worker_id,
      lease_expires_at = v_lease_expires_at,
      recovery_attempt_count = ledger.recovery_attempt_count + 1,
      recovery_outcome = 'CLAIMED',
      evidence = ledger.evidence || jsonb_build_object('workerAcquisition',
        p_worker_capability || jsonb_build_object('workerId',p_worker_id,
          'claimedAt',clock_timestamp(),'claimState','CLAIMED')),
      last_observed_at = clock_timestamp(), updated_at = clock_timestamp()
    where ledger.id = v_plan.request_receipt_id
      and ledger.marketplace_account_key = p_marketplace_account_key
    returning ledger.id into v_ledger_id;
  else
    update public.marketplace_product_research_query_plans plan
    set worker_lease_owner = p_worker_id,
      worker_lease_expires_at = v_lease_expires_at,
      worker_claim_count = plan.worker_claim_count + 1,
      worker_last_claimed_at = clock_timestamp(),
      worker_capability_receipt_id = v_heartbeat_receipt_id,
      worker_last_release_code = null, worker_next_retry_at = null,
      updated_at = clock_timestamp()
    where plan.id = v_plan.id
      and plan.marketplace_account_key = p_marketplace_account_key
      and plan.source_context in
        ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH');
  end if;
  return query select true, v_ledger_id, v_plan.id, v_lease_expires_at;
end
$function$;

revoke all on function public.authorize_seller_os_pre_research_command_v1(
  text,uuid,text,integer,timestamptz) from public,anon,authenticated;
revoke all on function public.disable_seller_os_pre_research_command_v1(
  text,uuid,text) from public,anon,authenticated;
revoke all on function public.request_seller_os_pre_research_batch_v1(
  text,uuid,text,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.attach_seller_os_pre_research_batch_plans_v1(
  uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.next_seller_os_pre_research_batch_plan_v1(text)
  from public,anon,authenticated;
revoke all on function public.resume_seller_os_pre_research_batch_v1(
  uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.claim_next_live_listing_product_research_v2(
  text,text,jsonb,uuid,integer) from public,anon,authenticated;
grant execute on function public.authorize_seller_os_pre_research_command_v1(
  text,uuid,text,integer,timestamptz) to service_role;
grant execute on function public.disable_seller_os_pre_research_command_v1(
  text,uuid,text) to service_role;
grant execute on function public.request_seller_os_pre_research_batch_v1(
  text,uuid,text,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.attach_seller_os_pre_research_batch_plans_v1(
  uuid,uuid,text,jsonb) to service_role;
grant execute on function public.next_seller_os_pre_research_batch_plan_v1(text)
  to service_role;
grant execute on function public.resume_seller_os_pre_research_batch_v1(
  uuid,uuid,text) to service_role;
grant execute on function public.claim_next_live_listing_product_research_v2(
  text,text,jsonb,uuid,integer) to service_role;
revoke all on function public.reconcile_seller_os_pre_research_batch_member_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.guard_seller_os_pre_research_batch_immutability_v1()
  from public,anon,authenticated,service_role;

comment on table public.seller_os_pre_research_batches_v1 is
  'Bounded normal Pre-Research command batches; no marketplace authority.';
