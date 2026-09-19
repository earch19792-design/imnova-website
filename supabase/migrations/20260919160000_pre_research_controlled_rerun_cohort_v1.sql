-- PRE_RESEARCH_CONTROLLED_RERUN_COHORT_V1
-- Dedicated, privileged rerun identity for Luna Pre-Research. This migration
-- does not reuse approval-queue run_id, mutate historical plans, claim work,
-- call eBay, or create marketplace/Commercial Trace/Publisher authority.

do $block$
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null
      or to_regprocedure('public.is_seller_os_service_role_request_v1()') is null
      or to_regclass('public.marketplace_product_research_query_plans') is null
      or to_regclass('public.marketplace_product_research_query_tasks') is null
      or to_regclass('public.luna_catalog_snapshots_v1') is null
      or to_regclass('public.luna_catalog_snapshot_variants_v1') is null
      or to_regclass('public.seller_os_pre_research_rollout_controls_v1') is null
  then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_SCHEMA_DEPENDENCY_MISSING';
  end if;
  if not exists (
    select 1
    from public.seller_os_pre_research_rollout_controls_v1 control
    where control.control_key = 'LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2'
      and control.rollout_state = 'ACTIVE_V2'
      and control.required_result_contract_version =
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
  ) then
    raise exception 'LUNA_PRE_RESEARCH_V2_ACTIVE_CONTRACT_REQUIRED';
  end if;
end
$block$;

create table public.seller_os_luna_pre_research_rerun_cohorts_v1 (
  cohort_id uuid primary key,
  account text not null,
  marketplace text not null,
  contract_version text not null,
  reason_code text not null,
  actor_subject text not null,
  actor_client_id text not null,
  snapshot_id uuid not null references
    public.luna_catalog_snapshots_v1(snapshot_id) on delete restrict,
  policy_version text not null,
  maximum_members integer not null,
  membership_digest text not null,
  state text not null,
  created_at timestamptz not null default clock_timestamp(),
  sealed_at timestamptz null,
  constraint seller_os_luna_pre_research_rerun_cohort_account_check
    check (char_length(account) between 8 and 160
      and account !~ '[[:cntrl:]]'),
  constraint seller_os_luna_pre_research_rerun_cohort_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint seller_os_luna_pre_research_rerun_cohort_contract_check
    check (contract_version = 'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'),
  constraint seller_os_luna_pre_research_rerun_cohort_reason_check
    check (reason_code ~ '^[A-Z0-9_]{3,80}$'),
  constraint seller_os_luna_pre_research_rerun_cohort_actor_check
    check (char_length(actor_subject) between 3 and 240
      and actor_subject !~ '[[:cntrl:]]'
      and char_length(actor_client_id) between 3 and 240
      and actor_client_id !~ '[[:cntrl:]]'),
  constraint seller_os_luna_pre_research_rerun_cohort_policy_check
    check (policy_version =
      'LUNA_PRE_RESEARCH_CONTROLLED_RERUN_POLICY_V1_2026_09_19'),
  constraint seller_os_luna_pre_research_rerun_cohort_member_limit_check
    check (maximum_members between 1 and 10),
  constraint seller_os_luna_pre_research_rerun_cohort_digest_check
    check (membership_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_luna_pre_research_rerun_cohort_state_check
    check (state in ('CREATING','SEALED')),
  constraint seller_os_luna_pre_research_rerun_cohort_seal_check
    check ((state = 'CREATING' and sealed_at is null)
      or (state = 'SEALED' and sealed_at is not null))
);

alter table public.marketplace_product_research_query_plans
  add column pre_research_rerun_cohort_id uuid null references
    public.seller_os_luna_pre_research_rerun_cohorts_v1(cohort_id)
    on delete restrict;

alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_rerun_context_check check (
    source_context = 'LUNA_PRE_RESEARCH'
    or pre_research_rerun_cohort_id is null
  );

create table public.seller_os_luna_pre_research_rerun_members_v1 (
  cohort_id uuid not null references
    public.seller_os_luna_pre_research_rerun_cohorts_v1(cohort_id)
    on delete restrict,
  product_id text not null,
  variant_id text not null,
  luna_sku text not null,
  source_candidate_key text not null,
  product_truth_fingerprint text not null,
  prior_plan_id uuid not null references
    public.marketplace_product_research_query_plans(id) on delete restrict,
  prior_plan_input_hash text not null,
  rerun_plan_id uuid not null references
    public.marketplace_product_research_query_plans(id) on delete restrict,
  base_input_hash text not null,
  execution_input_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (cohort_id, product_id, variant_id, luna_sku),
  constraint seller_os_luna_pre_research_rerun_member_plan_unique
    unique (rerun_plan_id),
  constraint seller_os_luna_pre_research_rerun_member_source_unique
    unique (cohort_id, source_candidate_key),
  constraint seller_os_luna_pre_research_rerun_member_identity_check check (
    product_id ~ '^[0-9]{1,30}$'
    and variant_id ~ '^[0-9]{1,30}$'
    and char_length(luna_sku) between 1 and 160
    and luna_sku !~ '[[:cntrl:]]'
    and source_candidate_key ~ '^sha256:[0-9a-f]{64}$'
    and product_truth_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and prior_plan_input_hash ~ '^sha256:[0-9a-f]{64}$'
    and base_input_hash ~ '^sha256:[0-9a-f]{64}$'
    and execution_input_hash ~ '^sha256:[0-9a-f]{64}$')
);

create index seller_os_luna_pre_research_rerun_cohort_account_idx
  on public.seller_os_luna_pre_research_rerun_cohorts_v1
    (account, marketplace, created_at desc);
create index seller_os_luna_pre_research_rerun_members_prior_plan_idx
  on public.seller_os_luna_pre_research_rerun_members_v1(prior_plan_id);
create index marketplace_product_research_rerun_cohort_fk_idx
  on public.marketplace_product_research_query_plans(
    pre_research_rerun_cohort_id)
  where pre_research_rerun_cohort_id is not null;

drop index public.marketplace_product_research_luna_identity_uq;
create unique index marketplace_product_research_luna_normal_identity_uq
  on public.marketplace_product_research_query_plans
    (marketplace_account_key, marketplace, source_candidate_key)
  where source_context = 'LUNA_PRE_RESEARCH'
    and pre_research_rerun_cohort_id is null;
create unique index marketplace_product_research_luna_rerun_identity_uq
  on public.marketplace_product_research_query_plans
    (marketplace_account_key, marketplace, source_candidate_key,
      pre_research_rerun_cohort_id)
  where source_context = 'LUNA_PRE_RESEARCH'
    and pre_research_rerun_cohort_id is not null;

alter table public.seller_os_luna_pre_research_rerun_cohorts_v1
  enable row level security;
alter table public.seller_os_luna_pre_research_rerun_cohorts_v1
  force row level security;
alter table public.seller_os_luna_pre_research_rerun_members_v1
  enable row level security;
alter table public.seller_os_luna_pre_research_rerun_members_v1
  force row level security;

revoke all on table public.seller_os_luna_pre_research_rerun_cohorts_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_luna_pre_research_rerun_members_v1
  from public, anon, authenticated, service_role;
grant select on table public.seller_os_luna_pre_research_rerun_cohorts_v1
  to service_role;
grant select on table public.seller_os_luna_pre_research_rerun_members_v1
  to service_role;

create function public.guard_luna_pre_research_rerun_cohort_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_COHORT_IMMUTABLE';
  end if;
  if old.state = 'SEALED' then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_COHORT_SEALED_IMMUTABLE';
  end if;
  if new.cohort_id is distinct from old.cohort_id
      or new.account is distinct from old.account
      or new.marketplace is distinct from old.marketplace
      or new.contract_version is distinct from old.contract_version
      or new.reason_code is distinct from old.reason_code
      or new.actor_subject is distinct from old.actor_subject
      or new.actor_client_id is distinct from old.actor_client_id
      or new.snapshot_id is distinct from old.snapshot_id
      or new.policy_version is distinct from old.policy_version
      or new.maximum_members is distinct from old.maximum_members
      or new.membership_digest is distinct from old.membership_digest
      or new.created_at is distinct from old.created_at
      or new.state <> 'SEALED'
      or new.sealed_at is null then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_COHORT_TRANSITION_INVALID';
  end if;
  return new;
end
$function$;

create trigger guard_luna_pre_research_rerun_cohort_v1
before update or delete
on public.seller_os_luna_pre_research_rerun_cohorts_v1
for each row execute function
  public.guard_luna_pre_research_rerun_cohort_v1();

create function public.guard_luna_pre_research_rerun_member_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_state text;
  v_limit integer;
  v_count integer;
begin
  if tg_op <> 'INSERT' then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_MEMBERSHIP_IMMUTABLE';
  end if;
  select cohort.state, cohort.maximum_members into v_state, v_limit
  from public.seller_os_luna_pre_research_rerun_cohorts_v1 cohort
  where cohort.cohort_id = new.cohort_id for update;
  if not found or v_state <> 'CREATING' then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_COHORT_NOT_OPEN';
  end if;
  select count(*) into v_count
  from public.seller_os_luna_pre_research_rerun_members_v1 member
  where member.cohort_id = new.cohort_id;
  if v_count >= v_limit then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_MEMBER_LIMIT_EXCEEDED';
  end if;
  return new;
end
$function$;

create trigger guard_luna_pre_research_rerun_member_v1
before insert or update or delete
on public.seller_os_luna_pre_research_rerun_members_v1
for each row execute function
  public.guard_luna_pre_research_rerun_member_v1();

create function public.guard_product_research_rerun_identity_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.pre_research_rerun_cohort_id is distinct from
      old.pre_research_rerun_cohort_id then
    raise exception 'PRODUCT_RESEARCH_RERUN_COHORT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end
$function$;

create trigger guard_product_research_rerun_identity_v1
before update of pre_research_rerun_cohort_id
on public.marketplace_product_research_query_plans
for each row execute function
  public.guard_product_research_rerun_identity_v1();

create function public.create_or_reuse_luna_pre_research_rerun_cohort_v1(
  p_cohort_id uuid,
  p_marketplace_account_key text,
  p_marketplace text,
  p_contract_version text,
  p_reason_code text,
  p_actor_subject text,
  p_actor_client_id text,
  p_snapshot_id uuid,
  p_policy_version text,
  p_maximum_members integer,
  p_membership_digest text,
  p_members jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cohort public.seller_os_luna_pre_research_rerun_cohorts_v1%rowtype;
  v_member jsonb;
  v_prior public.marketplace_product_research_query_plans%rowtype;
  v_member_line text;
  v_calculated_digest text;
  v_expected_input_hash text;
  v_member_count integer;
  v_new_plan_count integer := 0;
  v_existing_plan_count integer := 0;
  v_pending_count integer;
  v_plans jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_cohort_id is null
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_marketplace <> 'EBAY_US'
      or p_contract_version <>
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
      or p_reason_code !~ '^[A-Z0-9_]{3,80}$'
      or char_length(coalesce(p_actor_subject,'')) not between 3 and 240
      or p_actor_subject ~ '[[:cntrl:]]'
      or char_length(coalesce(p_actor_client_id,'')) not between 3 and 240
      or p_actor_client_id ~ '[[:cntrl:]]'
      or p_snapshot_id is null
      or p_policy_version <>
        'LUNA_PRE_RESEARCH_CONTROLLED_RERUN_POLICY_V1_2026_09_19'
      or p_maximum_members not between 1 and 10
      or p_membership_digest !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(p_members) is distinct from 'array'
      or jsonb_array_length(p_members) <> p_maximum_members then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_COHORT_INPUT_INVALID';
  end if;

  if not exists (
    select 1
    from public.seller_os_pre_research_rollout_controls_v1 control
    where control.control_key = 'LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2'
      and control.rollout_state = 'ACTIVE_V2'
      and control.required_result_contract_version = p_contract_version
  ) then
    raise exception 'LUNA_PRE_RESEARCH_V2_ACTIVE_CONTRACT_REQUIRED';
  end if;

  select count(*) into v_member_count
  from (
    select distinct member.product_id, member.variant_id, member.luna_sku,
      member.source_candidate_key
    from jsonb_to_recordset(p_members) as member(
      product_id text, variant_id text, luna_sku text,
      source_candidate_key text)
  ) distinct_members;
  if v_member_count <> p_maximum_members then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_DUPLICATE_MEMBER';
  end if;

  select 'sha256:' || encode(extensions.digest(convert_to(
    'LUNA_PRE_RESEARCH_RERUN_MEMBERSHIP_V1' || E'\n' ||
    string_agg(concat_ws(chr(31), member.product_id, member.variant_id,
      member.luna_sku, member.source_candidate_key,
      member.product_truth_fingerprint, member.prior_plan_id::text,
      member.prior_plan_input_hash, member.base_input_hash,
      member.execution_input_hash), E'\n'
      order by member.product_id, member.variant_id, member.luna_sku),
    'UTF8'), 'sha256'), 'hex')
  into v_calculated_digest
  from jsonb_to_recordset(p_members) as member(
    product_id text, variant_id text, luna_sku text,
    source_candidate_key text, product_truth_fingerprint text,
    prior_plan_id uuid, prior_plan_input_hash text,
    base_input_hash text, execution_input_hash text);
  if v_calculated_digest is distinct from p_membership_digest then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_MEMBERSHIP_DIGEST_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'luna-pre-research-rerun:' || p_marketplace_account_key || ':' ||
      p_cohort_id::text, 0));

  select cohort.* into v_cohort
  from public.seller_os_luna_pre_research_rerun_cohorts_v1 cohort
  where cohort.cohort_id = p_cohort_id for update;
  if found then
    if v_cohort.account is distinct from p_marketplace_account_key
        or v_cohort.marketplace is distinct from p_marketplace
        or v_cohort.contract_version is distinct from p_contract_version
        or v_cohort.reason_code is distinct from p_reason_code
        or v_cohort.actor_subject is distinct from p_actor_subject
        or v_cohort.actor_client_id is distinct from p_actor_client_id
        or v_cohort.snapshot_id is distinct from p_snapshot_id
        or v_cohort.policy_version is distinct from p_policy_version
        or v_cohort.maximum_members is distinct from p_maximum_members
        or v_cohort.membership_digest is distinct from p_membership_digest
        or v_cohort.state <> 'SEALED'
        or (select count(*)
          from public.seller_os_luna_pre_research_rerun_members_v1 member
          where member.cohort_id = p_cohort_id) <> p_maximum_members then
      raise exception 'LUNA_PRE_RESEARCH_RERUN_COHORT_REPLAY_MISMATCH';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'productId', member.product_id,
      'variantId', member.variant_id,
      'lunaSku', member.luna_sku,
      'priorPlanId', member.prior_plan_id,
      'planId', member.rerun_plan_id,
      'created', false)
      order by member.product_id, member.variant_id, member.luna_sku), '[]'::jsonb)
    into v_plans
    from public.seller_os_luna_pre_research_rerun_members_v1 member
    where member.cohort_id = p_cohort_id;
    return jsonb_build_object('cohortId',p_cohort_id,'cohortCreated',false,
      'newPlanCount',0,'existingPlanCount',p_maximum_members,'plans',v_plans);
  end if;

  if not exists (
    select 1 from public.luna_catalog_snapshots_v1 snapshot
    where snapshot.snapshot_id = p_snapshot_id
      and snapshot.snapshot_status = 'COMPLETE'
      and not exists (
        select 1 from public.luna_catalog_snapshots_v1 newer
        where newer.snapshot_status = 'COMPLETE'
          and newer.snapshot_completed_at > snapshot.snapshot_completed_at)
  ) then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_LATEST_SNAPSHOT_REQUIRED';
  end if;

  insert into public.seller_os_luna_pre_research_rerun_cohorts_v1 (
    cohort_id, account, marketplace, contract_version, reason_code,
    actor_subject, actor_client_id, snapshot_id, policy_version,
    maximum_members, membership_digest, state)
  values (p_cohort_id, p_marketplace_account_key, p_marketplace,
    p_contract_version, p_reason_code, p_actor_subject, p_actor_client_id,
    p_snapshot_id, p_policy_version, p_maximum_members,
    p_membership_digest, 'CREATING');

  for v_member in
    select value from jsonb_array_elements(p_members)
    order by value ->> 'product_id', value ->> 'variant_id',
      value ->> 'luna_sku'
  loop
    if coalesce(v_member ->> 'product_id','') !~ '^[0-9]{1,30}$'
        or coalesce(v_member ->> 'variant_id','') !~ '^[0-9]{1,30}$'
        or char_length(coalesce(v_member ->> 'luna_sku','')) not between 1 and 160
        or coalesce(v_member ->> 'source_candidate_key','')
          !~ '^sha256:[0-9a-f]{64}$'
        or coalesce(v_member ->> 'product_truth_fingerprint','')
          !~ '^sha256:[0-9a-f]{64}$'
        or coalesce(v_member ->> 'prior_plan_input_hash','')
          !~ '^sha256:[0-9a-f]{64}$'
        or coalesce(v_member ->> 'base_input_hash','')
          !~ '^sha256:[0-9a-f]{64}$'
        or coalesce(v_member ->> 'execution_input_hash','')
          !~ '^sha256:[0-9a-f]{64}$'
        or coalesce(v_member ->> 'source_fingerprint','')
          !~ '^sha256:[0-9a-f]{64}$'
        or coalesce(v_member ->> 'observed_at','') = ''
        or jsonb_typeof(v_member -> 'queries') is distinct from 'array'
        or jsonb_array_length(v_member -> 'queries') not between 1 and 15 then
      raise exception 'LUNA_PRE_RESEARCH_RERUN_MEMBER_INPUT_INVALID';
    end if;

    select plan.* into v_prior
    from public.marketplace_product_research_query_plans plan
    where plan.id = (v_member ->> 'prior_plan_id')::uuid
      and plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = p_marketplace
      and plan.source_context = 'LUNA_PRE_RESEARCH'
      and plan.pre_research_rerun_cohort_id is null
      and plan.source_candidate_key = v_member ->> 'source_candidate_key'
      and plan.source_product_truth_fingerprint =
        v_member ->> 'product_truth_fingerprint'
      and plan.input_hash = v_member ->> 'prior_plan_input_hash'
      and plan.source_luna_product_id = v_member ->> 'product_id'
      and plan.subject_supplier_variant_id = v_member ->> 'variant_id'
      and plan.source_supplier_sku = v_member ->> 'luna_sku'
    for share;
    if not found then
      raise exception 'LUNA_PRE_RESEARCH_RERUN_PRIOR_IDENTITY_MISMATCH';
    end if;

    if not exists (
      select 1
      from public.luna_catalog_snapshot_variants_v1 variant
      where variant.snapshot_id = p_snapshot_id
        and variant.product_id = v_member ->> 'product_id'
        and variant.variant_id = v_member ->> 'variant_id'
        and variant.sku = v_member ->> 'luna_sku'
        and variant.source_fingerprint = v_member ->> 'source_fingerprint'
        and variant.observed_at = (v_member ->> 'observed_at')::timestamptz
        and variant.preflight_status = 'PREFLIGHT_PASS'
    ) then
      raise exception 'LUNA_PRE_RESEARCH_RERUN_AUTHORITATIVE_CANDIDATE_REQUIRED';
    end if;

    v_expected_input_hash := 'sha256:' || encode(extensions.digest(convert_to(
      'LUNA_PRE_RESEARCH_RERUN_INPUT_V1' || E'\n' ||
      (v_member ->> 'base_input_hash') || E'\n' || p_cohort_id::text || E'\n' ||
      p_contract_version, 'UTF8'), 'sha256'), 'hex');
    if v_member ->> 'execution_input_hash' is distinct from
        v_expected_input_hash then
      raise exception 'LUNA_PRE_RESEARCH_RERUN_INPUT_HASH_MISMATCH';
    end if;

    insert into public.marketplace_product_research_query_plans (
      id, marketplace_account_key, marketplace, run_id, plan_version,
      input_hash, status, query_count, candidate_count, source_context,
      subject_supplier_variant_id, source_candidate_key,
      source_luna_product_id, source_supplier_sku, source_luna_snapshot_id,
      source_product_truth_fingerprint, pre_research_policy_version,
      pre_research_result, pre_research_trace_eligible,
      pre_research_evidence, research_intelligence_status,
      intelligence_contract_version, raw_competitor_content_stored,
      pii_stored, openai_calls, ebay_writes,
      pre_research_rerun_cohort_id)
    values ((v_member ->> 'rerun_plan_id')::uuid,
      p_marketplace_account_key, p_marketplace, null,
      'LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15',
      v_expected_input_hash, 'ACTIVE',
      jsonb_array_length(v_member -> 'queries'), 1, 'LUNA_PRE_RESEARCH',
      v_member ->> 'variant_id', v_member ->> 'source_candidate_key',
      v_member ->> 'product_id', v_member ->> 'luna_sku', p_snapshot_id,
      v_member ->> 'product_truth_fingerprint',
      'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15', 'PENDING', false,
      '{}'::jsonb, 'RESEARCH_IN_PROGRESS',
      'LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15', false, false, 0, 0,
      p_cohort_id);

    insert into public.marketplace_product_research_query_tasks (
      plan_id, marketplace_account_key, marketplace, ordinal, search_query,
      query_hash, cluster_key_hash, category_id, candidate_count,
      candidate_variant_hashes, query_intent, evidence_basis,
      strategy_version)
    select (v_member ->> 'rerun_plan_id')::uuid,
      p_marketplace_account_key, p_marketplace, query.ordinal,
      query.search_query, query.query_hash, query.cluster_key_hash,
      query.category_id, query.candidate_count,
      query.candidate_variant_hashes, query.query_intent,
      coalesce(query.evidence_basis, '[]'::jsonb), query.strategy_version
    from jsonb_to_recordset(v_member -> 'queries') as query(
      ordinal integer, search_query text, query_hash text,
      cluster_key_hash text, category_id text, candidate_count integer,
      candidate_variant_hashes text[], query_intent text,
      evidence_basis jsonb, strategy_version text);
    get diagnostics v_pending_count = row_count;
    if v_pending_count <> jsonb_array_length(v_member -> 'queries') then
      raise exception 'LUNA_PRE_RESEARCH_RERUN_TASK_PERSISTENCE_INCOMPLETE';
    end if;

    insert into public.seller_os_luna_pre_research_rerun_members_v1 (
      cohort_id, product_id, variant_id, luna_sku, source_candidate_key,
      product_truth_fingerprint, prior_plan_id, rerun_plan_id,
      prior_plan_input_hash, base_input_hash, execution_input_hash)
    values (p_cohort_id, v_member ->> 'product_id',
      v_member ->> 'variant_id', v_member ->> 'luna_sku',
      v_member ->> 'source_candidate_key',
      v_member ->> 'product_truth_fingerprint',
      (v_member ->> 'prior_plan_id')::uuid,
      (v_member ->> 'rerun_plan_id')::uuid,
      v_member ->> 'prior_plan_input_hash',
      v_member ->> 'base_input_hash', v_expected_input_hash);
    v_new_plan_count := v_new_plan_count + 1;
  end loop;

  if v_new_plan_count <> p_maximum_members then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_COHORT_INCOMPLETE';
  end if;
  update public.seller_os_luna_pre_research_rerun_cohorts_v1 cohort
  set state = 'SEALED', sealed_at = clock_timestamp()
  where cohort.cohort_id = p_cohort_id and cohort.state = 'CREATING';
  if not found then
    raise exception 'LUNA_PRE_RESEARCH_RERUN_COHORT_SEAL_FAILED';
  end if;

  select jsonb_agg(jsonb_build_object(
    'productId', member.product_id,
    'variantId', member.variant_id,
    'lunaSku', member.luna_sku,
    'priorPlanId', member.prior_plan_id,
    'planId', member.rerun_plan_id,
    'created', true)
    order by member.product_id, member.variant_id, member.luna_sku)
  into v_plans
  from public.seller_os_luna_pre_research_rerun_members_v1 member
  where member.cohort_id = p_cohort_id;
  return jsonb_build_object('cohortId',p_cohort_id,'cohortCreated',true,
    'newPlanCount',v_new_plan_count,
    'existingPlanCount',v_existing_plan_count,'plans',v_plans);
end
$function$;

revoke all on function
  public.create_or_reuse_luna_pre_research_rerun_cohort_v1(
    uuid,text,text,text,text,text,text,uuid,text,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function
  public.create_or_reuse_luna_pre_research_rerun_cohort_v1(
    uuid,text,text,text,text,text,text,uuid,text,integer,text,jsonb)
  to service_role;

-- Keep normal intake semantics unchanged while explicitly excluding rerun
-- executions from its historical-plan lookup.
create or replace function public.create_or_reuse_luna_pre_research_plan_v1(
  p_plan_id uuid,
  p_marketplace_account_key text,
  p_plan_version text,
  p_input_hash text,
  p_identity_key text,
  p_luna_snapshot_id uuid,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_supplier_sku text,
  p_product_truth_fingerprint text,
  p_pre_research_policy_version text,
  p_source_fingerprint text,
  p_observed_at timestamptz,
  p_queries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_existing public.marketplace_product_research_query_plans%rowtype;
  v_plan_id uuid;
  v_pending integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_plan_id is null
      or char_length(coalesce(p_marketplace_account_key, '')) not between 8 and 160
      or p_plan_version <> 'LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15'
      or p_input_hash !~ '^sha256:[0-9a-f]{64}$'
      or p_identity_key !~ '^sha256:[0-9a-f]{64}$'
      or p_luna_snapshot_id is null
      or p_luna_product_id !~ '^[0-9]{1,30}$'
      or p_luna_variant_id !~ '^[0-9]{1,30}$'
      or char_length(coalesce(p_supplier_sku, '')) not between 1 and 160
      or p_product_truth_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_pre_research_policy_version <>
        'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15'
      or p_source_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_observed_at is null
      or jsonb_typeof(p_queries) is distinct from 'array'
      or jsonb_array_length(p_queries) not between 1 and 15 then
    raise exception 'LUNA_PRE_RESEARCH_PLAN_INPUT_INVALID';
  end if;
  if not exists (
    select 1
    from public.luna_catalog_snapshots_v1 snapshot
    join public.luna_catalog_snapshot_variants_v1 variant
      on variant.snapshot_id = snapshot.snapshot_id
    where snapshot.snapshot_id = p_luna_snapshot_id
      and snapshot.snapshot_status = 'COMPLETE'
      and variant.product_id = p_luna_product_id
      and variant.variant_id = p_luna_variant_id
      and variant.sku = p_supplier_sku
      and variant.source_fingerprint = p_source_fingerprint
      and variant.preflight_status = 'PREFLIGHT_PASS'
      and not exists (
        select 1 from public.luna_catalog_snapshots_v1 newer
        where newer.snapshot_status = 'COMPLETE'
          and newer.snapshot_completed_at > snapshot.snapshot_completed_at)
  ) then
    raise exception 'LUNA_PRE_RESEARCH_AUTHORITATIVE_CANDIDATE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'luna-pre-research:' || p_marketplace_account_key || ':' ||
      p_identity_key, 0));
  select plan.* into v_existing
  from public.marketplace_product_research_query_plans plan
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'LUNA_PRE_RESEARCH'
    and plan.source_candidate_key = p_identity_key
    and plan.pre_research_rerun_cohort_id is null
  for update;
  if found then
    select count(*) into v_pending
    from public.marketplace_product_research_query_tasks task
    where task.plan_id = v_existing.id and task.status = 'PENDING';
    return jsonb_build_object('planId',v_existing.id,'created',false,
      'sourceContext',v_existing.source_context,
      'preResearchResult',v_existing.pre_research_result,
      'pendingTaskCount',v_pending,
      'idempotencyKey',v_existing.source_candidate_key);
  end if;
  insert into public.marketplace_product_research_query_plans (
    id, marketplace_account_key, marketplace, run_id, plan_version,
    input_hash, status, query_count, candidate_count, source_context,
    subject_supplier_variant_id, source_candidate_key,
    source_luna_product_id, source_supplier_sku, source_luna_snapshot_id,
    source_product_truth_fingerprint, pre_research_policy_version,
    pre_research_result, pre_research_trace_eligible,
    pre_research_evidence, research_intelligence_status,
    intelligence_contract_version, raw_competitor_content_stored,
    pii_stored, openai_calls, ebay_writes, pre_research_rerun_cohort_id)
  values (p_plan_id, p_marketplace_account_key, 'EBAY_US', null,
    p_plan_version, p_input_hash, 'ACTIVE', jsonb_array_length(p_queries), 1,
    'LUNA_PRE_RESEARCH', p_luna_variant_id, p_identity_key,
    p_luna_product_id, p_supplier_sku, p_luna_snapshot_id,
    p_product_truth_fingerprint, p_pre_research_policy_version, 'PENDING',
    false, '{}'::jsonb, 'RESEARCH_IN_PROGRESS',
    'LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15', false, false, 0, 0, null)
  returning id into v_plan_id;
  insert into public.marketplace_product_research_query_tasks (
    plan_id, marketplace_account_key, marketplace, ordinal, search_query,
    query_hash, cluster_key_hash, category_id, candidate_count,
    candidate_variant_hashes, query_intent, evidence_basis, strategy_version)
  select v_plan_id, p_marketplace_account_key, 'EBAY_US', query.ordinal,
    query.search_query, query.query_hash, query.cluster_key_hash,
    query.category_id, query.candidate_count,
    query.candidate_variant_hashes, query.query_intent,
    coalesce(query.evidence_basis, '[]'::jsonb), query.strategy_version
  from jsonb_to_recordset(p_queries) as query(
    ordinal integer, search_query text, query_hash text,
    cluster_key_hash text, category_id text, candidate_count integer,
    candidate_variant_hashes text[], query_intent text,
    evidence_basis jsonb, strategy_version text);
  get diagnostics v_pending = row_count;
  if v_pending <> jsonb_array_length(p_queries) then
    raise exception 'LUNA_PRE_RESEARCH_TASK_PERSISTENCE_INCOMPLETE';
  end if;
  return jsonb_build_object('planId',v_plan_id,'created',true,
    'sourceContext','LUNA_PRE_RESEARCH','preResearchResult','PENDING',
    'pendingTaskCount',v_pending,'idempotencyKey',p_identity_key);
end
$function$;

revoke all on function public.create_or_reuse_luna_pre_research_plan_v1(
  uuid,text,text,text,text,uuid,text,text,text,text,text,text,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_or_reuse_luna_pre_research_plan_v1(
  uuid,text,text,text,text,uuid,text,text,text,text,text,text,timestamptz,jsonb)
  to service_role;

-- Rerun cohorts are absent from autonomous/global acquisition. Only a caller
-- supplying the exact plan UUID can acquire one; p_plan_id never falls back.
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

revoke all on function public.claim_next_live_listing_product_research_v2(
  text,text,jsonb,uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_next_live_listing_product_research_v2(
  text,text,jsonb,uuid,integer) to service_role;
