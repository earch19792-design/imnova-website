-- SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2
--
-- This migration hardens the existing Product Research queue, plans, leases,
-- capability heartbeats and operational learning ledger. It deliberately does
-- not introduce a second queue, a second worker, marketplace writes, or a
-- commercial decision authority.

alter table public.seller_os_operational_learning_ledger_v1
  add column if not exists incident_state text not null default 'OPEN',
  add column if not exists occurrence_count integer not null default 1,
  add column if not exists consecutive_count integer not null default 1,
  add column if not exists affected_task_count integer not null default 0,
  add column if not exists first_recovery_attempt_at timestamptz,
  add column if not exists last_recovery_attempt_at timestamptz,
  add column if not exists recovery_succeeded_at timestamptz,
  add column if not exists code_version text,
  add column if not exists regression_after_fix boolean not null default false;

alter table public.seller_os_operational_learning_ledger_v1
  drop constraint if exists seller_os_operational_learning_incident_state_v2;
alter table public.seller_os_operational_learning_ledger_v1
  add constraint seller_os_operational_learning_incident_state_v2 check (
    incident_state in ('OPEN','RECOVERING','CANARY_PASS','RESOLVED')
    and occurrence_count between 0 and 1000000
    and consecutive_count between 0 and 1000000
    and affected_task_count between 0 and 1000000
    and (code_version is null or code_version ~ '^[A-Za-z0-9._:-]{3,120}$')
  );

alter table public.seller_os_pre_research_batch_members_v1
  drop constraint if exists seller_os_pre_research_batch_members_v1_execution_state_check;
alter table public.seller_os_pre_research_batch_members_v1
  add constraint seller_os_pre_research_member_execution_state_v2 check (
    execution_state in ('PENDING','RUNNING','RETRY_WAIT','NEEDS_ATTENTION',
      'QUARANTINED','COMPLETED','CANCELLED'));
alter table public.seller_os_pre_research_batch_members_v1
  drop constraint if exists seller_os_pre_research_batch_members_v1_retry_safety_check;
alter table public.seller_os_pre_research_batch_members_v1
  add constraint seller_os_pre_research_member_retry_safety_v2 check (
    retry_safety is null or retry_safety in
      ('SAFE_IDEMPOTENT_RUNTIME_RESUME','ENGINEERING_REQUIRED',
        'NOT_APPLICABLE'));

alter table public.seller_os_pre_research_batch_events_v1
  drop constraint if exists seller_os_pre_research_batch_events_v1_event_type_check;
alter table public.seller_os_pre_research_batch_events_v1
  add constraint seller_os_pre_research_batch_event_type_v2 check (
    event_type in ('REQUESTED','AUTHORIZED','PLAN_ATTACHED','RUNNING',
      'RETRY_WAIT','NEEDS_ATTENTION','QUARANTINED','RESUMED','COMPLETED',
      'CANCELLED'));

-- Historical incomplete batches were authorized before their plans existed.
-- Fail closed by returning them to REQUESTED. Their immutable candidate
-- identity remains available for an idempotent plan-attachment replay.
with incomplete as (
  select batch.batch_id
  from public.seller_os_pre_research_batches_v1 batch
  where batch.batch_state <> 'CANCELLED'
    and exists (select 1
      from public.seller_os_pre_research_batch_members_v1 member
      where member.batch_id = batch.batch_id and member.plan_id is null)
), demoted as (
  update public.seller_os_pre_research_batches_v1 batch
  set batch_state = 'REQUESTED', authorized_at = null, completed_at = null,
    updated_at = clock_timestamp()
  from incomplete
  where batch.batch_id = incomplete.batch_id
  returning batch.batch_id
)
insert into public.seller_os_pre_research_batch_events_v1(
  batch_id,event_type,actor_kind,actor_subject,detail)
select demoted.batch_id,'NEEDS_ATTENTION','DATABASE_RECONCILER',
  'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2',
  jsonb_build_object('failureCode','PLAN_ATTACHMENT_MISSING',
    'recovery','BATCH_RETURNED_TO_REQUESTED','marketplaceWrites',0)
from demoted;

create or replace function public.guard_seller_os_pre_research_authorization_v2()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.batch_state in ('AUTHORIZED','RUNNING','NEEDS_ATTENTION','COMPLETED')
      and exists (
        select 1
        from public.seller_os_pre_research_batch_members_v1 member
        left join public.marketplace_product_research_query_plans plan
          on plan.id = member.plan_id
          and plan.marketplace_account_key = new.marketplace_account_key
          and plan.marketplace = 'EBAY_US'
          and plan.source_context = 'LUNA_PRE_RESEARCH'
          and plan.pre_research_rerun_cohort_id is null
          and plan.source_luna_product_id = member.luna_product_id
          and plan.subject_supplier_variant_id = member.luna_variant_id
          and plan.source_supplier_sku = member.luna_sku
          and plan.source_candidate_key = member.source_candidate_key
          and plan.source_product_truth_fingerprint =
            member.product_truth_fingerprint
        where member.batch_id = new.batch_id and plan.id is null) then
    raise exception 'PLAN_ATTACHMENT_MISSING';
  end if;
  return new;
end
$function$;

drop trigger if exists seller_os_pre_research_authorization_guard_v2
  on public.seller_os_pre_research_batches_v1;
create trigger seller_os_pre_research_authorization_guard_v2
before insert or update of batch_state
on public.seller_os_pre_research_batches_v1 for each row
execute function public.guard_seller_os_pre_research_authorization_v2();

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
  where capability.capability_code = 'TEO_PRE_RESEARCH_NORMAL_BATCH_V1'
    and capability.marketplace_account_key = p_marketplace_account_key
    and capability.owner_user_id = p_owner_user_id
    and capability.command_client_id = p_command_client_id
    and capability.allowed_contract_version = p_contract_version
    and capability.enabled
    and (capability.expires_at is null
      or capability.expires_at > clock_timestamp())
  for update;
  if not found or v_count > v_capability.maximum_candidates then
    raise exception 'TEO_PRE_RESEARCH_CAPABILITY_DENIED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'teo-pre-research-batch:' || v_capability.capability_id::text || ':' ||
    p_snapshot_id::text || ':' || p_candidate_identity_digest || ':' ||
    p_client_idempotency_key, 0));
  if not exists (select 1 from public.luna_catalog_snapshots_v1 snapshot
    where snapshot.snapshot_id = p_snapshot_id
      and snapshot.snapshot_status = 'COMPLETE') then
    raise exception 'TEO_PRE_RESEARCH_SNAPSHOT_NOT_COMPLETE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_candidates) with ordinality c(value,ordinal)
    left join public.luna_catalog_snapshot_variants_v1 variant
      on variant.snapshot_id = p_snapshot_id
      and variant.product_id = c.value->>'productId'
      and variant.variant_id = c.value->>'variantId'
      and variant.sku = c.value->>'sku'
    where jsonb_typeof(c.value) is distinct from 'object'
      or (select array_agg(key order by key)
        from jsonb_object_keys(c.value) key) is distinct from
        array['productId','productTruthFingerprint','sku',
          'sourceCandidateKey','variantId']::text[]
      or coalesce(c.value->>'productId','') !~ '^[0-9]{1,30}$'
      or coalesce(c.value->>'variantId','') !~ '^[0-9]{1,30}$'
      or coalesce(c.value->>'sourceCandidateKey','') !~
        '^sha256:[0-9a-f]{64}$'
      or coalesce(c.value->>'productTruthFingerprint','') !~
        '^sha256:[0-9a-f]{64}$'
      or variant.snapshot_id is null
      or variant.preflight_status <> 'PREFLIGHT_PASS'
  ) or (select count(distinct concat_ws(E'\x1f',value->>'productId',
      value->>'variantId',value->>'sku'))
      from jsonb_array_elements(p_candidates)) <> v_count then
    raise exception 'TEO_PRE_RESEARCH_CANDIDATE_IDENTITY_INVALID';
  end if;

  select batch.* into v_batch
  from public.seller_os_pre_research_batches_v1 batch
  where batch.owner_authorization_id = v_capability.capability_id
    and batch.source_snapshot_id = p_snapshot_id
    and batch.candidate_identity_digest = p_candidate_identity_digest
    and batch.client_idempotency_key = p_client_idempotency_key
  for update;
  if found then
    if v_batch.contract_version is distinct from p_contract_version
      or v_batch.command_client_id is distinct from p_command_client_id
      or v_batch.owner_user_id is distinct from p_owner_user_id
      or v_batch.candidate_count <> v_count
      or exists (select 1 from jsonb_array_elements(p_candidates) c
        where not exists (select 1
          from public.seller_os_pre_research_batch_members_v1 member
          where member.batch_id = v_batch.batch_id
            and member.luna_product_id = c->>'productId'
            and member.luna_variant_id = c->>'variantId'
            and member.luna_sku = c->>'sku'
            and member.source_candidate_key = c->>'sourceCandidateKey'
            and member.product_truth_fingerprint =
              c->>'productTruthFingerprint')) then
      raise exception 'TEO_PRE_RESEARCH_BATCH_IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object('batchId',v_batch.batch_id,'created',false,
      'state',v_batch.batch_state,'candidateCount',v_batch.candidate_count,
      'planAttachmentComplete',not exists (select 1
        from public.seller_os_pre_research_batch_members_v1 member
        where member.batch_id = v_batch.batch_id and member.plan_id is null));
  end if;

  insert into public.seller_os_pre_research_batches_v1(
    marketplace_account_key,source_snapshot_id,candidate_identity_digest,
    candidate_count,contract_version,owner_authorization_id,owner_user_id,
    command_client_id,client_idempotency_key,batch_state)
  values (p_marketplace_account_key,p_snapshot_id,p_candidate_identity_digest,
    v_count,p_contract_version,v_capability.capability_id,p_owner_user_id,
    p_command_client_id,p_client_idempotency_key,'REQUESTED')
  returning * into v_batch;
  insert into public.seller_os_pre_research_batch_members_v1(
    batch_id,ordinal,luna_product_id,luna_variant_id,luna_sku,
    source_candidate_key,product_truth_fingerprint)
  select v_batch.batch_id,c.ordinal,c.value->>'productId',
    c.value->>'variantId',c.value->>'sku',c.value->>'sourceCandidateKey',
    c.value->>'productTruthFingerprint'
  from jsonb_array_elements(p_candidates) with ordinality c(value,ordinal);
  insert into public.seller_os_pre_research_batch_events_v1(
    batch_id,event_type,actor_kind,actor_subject,detail)
  values (v_batch.batch_id,'REQUESTED','COMMAND_CLIENT',p_command_client_id,
    jsonb_build_object('ownerUserId',p_owner_user_id,
      'candidateCount',v_count,'authorizationDeferredUntilPlanSeal',true));
  return jsonb_build_object('batchId',v_batch.batch_id,'created',true,
    'state','REQUESTED','candidateCount',v_count,
    'planAttachmentComplete',false);
end
$function$;

create or replace function public.attach_seller_os_pre_research_batch_plans_v1(
  p_batch_id uuid, p_owner_user_id uuid, p_command_client_id text,
  p_plans jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_batch public.seller_os_pre_research_batches_v1%rowtype;
  v_attached integer := 0;
  v_missing integer := 0;
  v_state text;
begin
  if not public.is_seller_os_service_role_request_v1()
      or jsonb_typeof(p_plans) is distinct from 'array'
      or jsonb_array_length(p_plans) > 50
      or exists (select 1 from jsonb_array_elements(p_plans) item
        where jsonb_typeof(item) is distinct from 'object'
          or coalesce(item->>'planId','') !~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or coalesce(item->>'productId','') !~ '^[0-9]{1,30}$'
          or coalesce(item->>'variantId','') !~ '^[0-9]{1,30}$'
          or char_length(coalesce(item->>'sku','')) not between 1 and 160)
      or (select count(distinct item->>'planId')
        from jsonb_array_elements(p_plans) item) <>
        jsonb_array_length(p_plans) then
    raise exception 'TEO_PRE_RESEARCH_PLAN_ATTACH_INVALID';
  end if;
  select batch.* into v_batch
  from public.seller_os_pre_research_batches_v1 batch
  join public.seller_os_pre_research_command_capabilities_v1 capability
    on capability.capability_id = batch.owner_authorization_id
  where batch.batch_id = p_batch_id
    and batch.owner_user_id = p_owner_user_id
    and batch.command_client_id = p_command_client_id
    and batch.batch_state <> 'CANCELLED'
    and capability.enabled
    and (capability.expires_at is null
      or capability.expires_at > clock_timestamp())
  for update of batch;
  if not found then
    raise exception 'TEO_PRE_RESEARCH_BATCH_AUTHORITY_DENIED';
  end if;
  if exists (select 1 from jsonb_array_elements(p_plans) item
    left join public.seller_os_pre_research_batch_members_v1 member
      on member.batch_id = p_batch_id
      and member.luna_product_id = item->>'productId'
      and member.luna_variant_id = item->>'variantId'
      and member.luna_sku = item->>'sku'
    left join public.marketplace_product_research_query_plans plan
      on plan.id = (item->>'planId')::uuid
      and plan.marketplace_account_key = v_batch.marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context = 'LUNA_PRE_RESEARCH'
      and plan.pre_research_rerun_cohort_id is null
      and plan.source_luna_product_id = member.luna_product_id
      and plan.subject_supplier_variant_id = member.luna_variant_id
      and plan.source_supplier_sku = member.luna_sku
      and plan.source_candidate_key = member.source_candidate_key
      and plan.source_product_truth_fingerprint =
        member.product_truth_fingerprint
    where member.member_id is null or plan.id is null
      or (member.plan_id is not null and member.plan_id <> plan.id)) then
    raise exception 'TEO_PRE_RESEARCH_PLAN_IDENTITY_MISMATCH';
  end if;
  update public.seller_os_pre_research_batch_members_v1 member
  set plan_id = plan.id,
    execution_state = case when plan.status = 'COMPLETED'
      then 'COMPLETED' else 'PENDING' end,
    completed_at = case when plan.status = 'COMPLETED'
      then plan.completed_at else null end,
    updated_at = clock_timestamp()
  from jsonb_array_elements(p_plans) item(value)
  join public.marketplace_product_research_query_plans plan
    on plan.id = (item.value->>'planId')::uuid
  where member.batch_id = p_batch_id
    and member.luna_product_id = item.value->>'productId'
    and member.luna_variant_id = item.value->>'variantId'
    and member.luna_sku = item.value->>'sku'
    and member.plan_id is null;
  get diagnostics v_attached = row_count;

  select count(*) into v_missing
  from public.seller_os_pre_research_batch_members_v1 member
  left join public.marketplace_product_research_query_plans plan
    on plan.id = member.plan_id
    and plan.marketplace_account_key = v_batch.marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'LUNA_PRE_RESEARCH'
    and plan.pre_research_rerun_cohort_id is null
    and plan.source_luna_product_id = member.luna_product_id
    and plan.subject_supplier_variant_id = member.luna_variant_id
    and plan.source_supplier_sku = member.luna_sku
    and plan.source_candidate_key = member.source_candidate_key
    and plan.source_product_truth_fingerprint = member.product_truth_fingerprint
  where member.batch_id = p_batch_id and plan.id is null;

  v_state := case
    when v_missing > 0 then 'REQUESTED'
    when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 member
      where member.batch_id = p_batch_id
        and member.execution_state <> 'COMPLETED') then 'COMPLETED'
    else 'AUTHORIZED' end;
  update public.seller_os_pre_research_batches_v1 batch
  set batch_state = v_state,
    authorized_at = case when v_missing = 0
      then coalesce(batch.authorized_at,clock_timestamp()) else null end,
    started_at = case when v_state = 'COMPLETED'
      then coalesce(batch.started_at,clock_timestamp()) else batch.started_at end,
    completed_at = case when v_state = 'COMPLETED'
      then coalesce(batch.completed_at,clock_timestamp()) else null end,
    updated_at = clock_timestamp()
  where batch.batch_id = p_batch_id;
  insert into public.seller_os_pre_research_batch_events_v1(
    batch_id,event_type,actor_kind,actor_subject,detail)
  values (p_batch_id,'PLAN_ATTACHED','COMMAND_CLIENT',p_command_client_id,
    jsonb_build_object('newPlanAttachments',v_attached,
      'missingPlanAttachments',v_missing,'sealed',v_missing = 0));
  if v_missing = 0 and v_batch.batch_state = 'REQUESTED' then
    insert into public.seller_os_pre_research_batch_events_v1(
      batch_id,event_type,actor_kind,actor_subject,detail)
    values (p_batch_id,'AUTHORIZED','COMMAND_CLIENT',p_command_client_id,
      jsonb_build_object('invariant',
        'BATCH_AUTHORIZED_EVERY_MEMBER_HAS_VALID_PLAN','candidateCount',
        v_batch.candidate_count));
  end if;
  return jsonb_build_object('batchId',p_batch_id,
    'newPlanAttachments',v_attached,
    'attachedPlanCount',(select count(*)
      from public.seller_os_pre_research_batch_members_v1
      where batch_id = p_batch_id and plan_id is not null),
    'missingPlanAttachments',v_missing,'planAttachmentComplete',v_missing = 0,
    'state',v_state);
end
$function$;

-- A sealed-batch replay may legitimately use its immutable historical Luna
-- snapshot. REQUESTED is now the pre-seal state, so extend the existing
-- canonical plan admission predicate without copying or forking that engine.
do $plan_admission_patch$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.create_or_reuse_luna_pre_research_plan_v1(uuid,text,text,text,text,uuid,text,text,text,text,text,text,timestamptz,jsonb)'))
  into v_definition;
  if v_definition is null then
    raise exception 'LUNA_PRE_RESEARCH_PLAN_AUTHORITY_MISSING';
  end if;
  v_patched := replace(v_definition,
    $$batch.batch_state in
              ('AUTHORIZED','RUNNING','NEEDS_ATTENTION','COMPLETED')$$,
    $$batch.batch_state in
              ('REQUESTED','AUTHORIZED','RUNNING','NEEDS_ATTENTION','COMPLETED')$$);
  if v_patched = v_definition then
    raise exception 'LUNA_PRE_RESEARCH_PLAN_ADMISSION_PATCH_NOT_APPLIED';
  end if;
  execute v_patched;
end
$plan_admission_patch$;

create or replace function public.classify_seller_os_worker_failure_v2(
  p_error_code text)
returns text language sql immutable set search_path = '' as $function$
  select case
    when p_error_code ~ '(SESSION_REQUIRED|SESSION_EXPIRED|LOGIN_REQUIRED|UNAUTHORIZED|AUTH_REQUIRED)'
      then 'SESSION'
    when p_error_code ~ '(NO_COMPARABLE|INSUFFICIENT_MARKET_EVIDENCE|PRODUCT_TRUTH_INCOMPLETE|CANDIDATE_DATA_INCOMPLETE)'
      then 'TASK_DATA'
    when p_error_code ~ '(PLAN_ATTACHMENT_MISSING|SCHEMA|INVARIANT|IDENTITY_MISMATCH|RESULT_INVALID)'
      then 'ENGINEERING'
    when p_error_code ~ '(TIMEOUT|VISIBLE_TABLE_NOT_FOUND|REQUEST_FAILED|NETWORK|CONNECTION_RESET|PAGE_STILL_LOADING|CONTENT_SCRIPT_MISSING|SOURCE_FORMAT_CHANGED)'
      then 'TRANSIENT'
    else 'ENGINEERING' end
$function$;

create or replace function public.release_seller_os_product_research_failure_v2(
  p_marketplace_account_key text,p_plan_id uuid,p_worker_id text,
  p_error_code text,p_code_version text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_class text;
  v_action text;
  v_invariant text;
  v_fingerprint text;
  v_ledger public.seller_os_operational_learning_ledger_v1%rowtype;
  v_next_retry timestamptz;
  v_retry_safe boolean;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_plan_id is null
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_error_code !~ '^[A-Z0-9_]{3,180}$'
      or p_code_version !~ '^[A-Za-z0-9._:-]{3,120}$' then
    raise exception 'PRODUCT_RESEARCH_WORKER_RELEASE_INVALID';
  end if;
  select plan.* into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.id = p_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in ('LIVE_LISTING_REVALIDATION',
      'QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
  for update;
  if not found or (v_plan.source_context <> 'LIVE_LISTING_REVALIDATION'
      and v_plan.worker_lease_owner is distinct from p_worker_id) then
    return jsonb_build_object('released',false,'planId',p_plan_id,
      'marketplaceWrites',0);
  end if;
  v_class := public.classify_seller_os_worker_failure_v2(p_error_code);
  v_invariant := case
    when p_error_code like '%VISIBLE_TABLE_NOT_FOUND%'
      or p_error_code like '%SOURCE_FORMAT_CHANGED%'
      then 'PRODUCT_RESEARCH_PAGE_CONTRACT'
    when v_class = 'SESSION' then 'PRODUCT_RESEARCH_SESSION'
    when v_class = 'TASK_DATA' then 'PRODUCT_RESEARCH_TASK_DATA'
    else 'PRODUCT_RESEARCH_ENGINEERING_CONTRACT' end;
  v_fingerprint := 'sha256:' || encode(extensions.digest(
    v_invariant || ':' || p_error_code,'sha256'),'hex');
  v_retry_safe := v_class in ('TRANSIENT','SESSION')
    and v_plan.worker_claim_count < 5;
  v_action := case
    when v_class = 'SESSION' and v_retry_safe then 'RENEW_SESSION_AND_RETRY'
    when v_class = 'TRANSIENT' and v_retry_safe then 'RETRY_WAIT'
    when v_class = 'TASK_DATA' then 'HOLD_UNPROVEN_CONTINUE'
    else 'QUARANTINE_TASK' end;
  v_next_retry := case when v_retry_safe then clock_timestamp() +
    make_interval(secs => least(900,30 * (2 ^ greatest(0,
      least(v_plan.worker_claim_count,5) - 1))::integer)) else null end;

  insert into public.seller_os_operational_learning_ledger_v1(
    marketplace_account_key,failure_class,invariant_code,mechanism_version,
    evidence_fingerprint,recovery_policy_version,retry_safety,recovery_class,
    recovery_outcome,regression_guard,evidence,status,incident_state,
    occurrence_count,consecutive_count,affected_task_count,code_version,
    first_observed_at,last_observed_at)
  values (p_marketplace_account_key,'WORKER_' || v_class,v_invariant,
    'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2',v_fingerprint,
    'SELLER_OS_WORKER_RECOVERY_POLICY_V2',
    case when v_retry_safe then 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
      when v_class = 'TASK_DATA' then 'NOT_APPLICABLE'
      else 'ENGINEERING_REQUIRED' end,
    case when v_retry_safe then 'AUTO_RECOVERABLE'
      when v_class = 'TASK_DATA' then 'OBSERVATION_ONLY'
      else 'ENGINEERING_REQUIRED' end,
    case when v_class = 'ENGINEERING' or not v_retry_safe
      then 'ENGINEERING_REQUIRED' else 'OBSERVED' end,
    jsonb_build_object('fixedByVersion',p_code_version,
      'detectRegressionAfterFix',true),
    jsonb_build_object('errorCode',p_error_code,'failureClass',v_class,
      'recoveryAction',v_action,'lastPlanId',p_plan_id,
      'affectedPlanIds',jsonb_build_array(p_plan_id),
      'marketplaceWrites',0),
    'OPEN','OPEN',1,1,1,p_code_version,clock_timestamp(),clock_timestamp())
  on conflict (marketplace_account_key,invariant_code,evidence_fingerprint,
    mechanism_version) do update set
      failure_class = excluded.failure_class,
      retry_safety = excluded.retry_safety,
      recovery_class = excluded.recovery_class,
      recovery_outcome = excluded.recovery_outcome,
      regression_after_fix =
        public.seller_os_operational_learning_ledger_v1.status = 'RESOLVED'
        or public.seller_os_operational_learning_ledger_v1.regression_after_fix,
      status = 'OPEN',incident_state = 'OPEN',resolved_at = null,
      occurrence_count =
        public.seller_os_operational_learning_ledger_v1.occurrence_count + 1,
      consecutive_count =
        public.seller_os_operational_learning_ledger_v1.consecutive_count + 1,
      affected_task_count =
        public.seller_os_operational_learning_ledger_v1.affected_task_count + 1,
      evidence = excluded.evidence || jsonb_build_object('previousEvidence',
        public.seller_os_operational_learning_ledger_v1.evidence),
      code_version = excluded.code_version,
      recovery_succeeded_at = null,last_observed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  returning * into v_ledger;

  if v_plan.source_context = 'LIVE_LISTING_REVALIDATION' then
    update public.seller_os_operational_learning_ledger_v1 ledger
    set lease_owner = null,lease_expires_at = null,
      recovery_outcome = case when v_retry_safe
        then 'STILL_VIOLATED' else 'ENGINEERING_REQUIRED' end,
      updated_at = clock_timestamp()
    where ledger.id = v_plan.request_receipt_id
      and ledger.lease_owner = p_worker_id;
  else
    update public.marketplace_product_research_query_plans plan
    set worker_lease_owner = null,worker_lease_expires_at = null,
      worker_last_release_code = p_error_code,
      worker_next_retry_at = v_next_retry,
      worker_last_result = jsonb_build_object(
        'state',case when v_retry_safe then 'RETRY_WAIT'
          else 'QUARANTINED' end,
        'errorCode',p_error_code,'failureClass',v_class,
        'recoveryAction',v_action,'failureFingerprint',v_fingerprint,
        'releasedAt',clock_timestamp(),'nextRetryAt',v_next_retry,
        'retrySafety',case when v_retry_safe
          then 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
          when v_class = 'TASK_DATA' then 'NOT_APPLICABLE'
          else 'ENGINEERING_REQUIRED' end,
        'incidentState','OPEN','occurrenceCount',v_ledger.occurrence_count,
        'marketplaceWrites',0),
      updated_at = clock_timestamp()
    where plan.id = p_plan_id and plan.worker_lease_owner = p_worker_id;
  end if;
  return jsonb_build_object('released',true,'planId',p_plan_id,
    'failureClass',v_class,'recoveryAction',v_action,
    'retrySafety',case when v_retry_safe
      then 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
      when v_class = 'TASK_DATA' then 'NOT_APPLICABLE'
      else 'ENGINEERING_REQUIRED' end,
    'nextRetryAt',v_next_retry,'failureFingerprint',v_fingerprint,
    'occurrenceCount',v_ledger.occurrence_count,
    'circuitState',case when v_invariant = 'PRODUCT_RESEARCH_PAGE_CONTRACT'
        and v_ledger.consecutive_count >= 10 then 'OPEN' else 'CLOSED' end,
    'marketplaceWrites',0);
end
$function$;

create or replace function public.record_seller_os_worker_progress_v2(
  p_marketplace_account_key text,p_worker_id text,p_plan_id uuid,
  p_stage text,p_code_version text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_fingerprint text;
  v_existing public.seller_os_operational_learning_ledger_v1%rowtype;
  v_previous text;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_plan_id is null
      or p_stage not in ('PENDING','CLAIMED','RUNNING','COMPLETED')
      or p_code_version !~ '^[A-Za-z0-9._:-]{3,120}$' then
    raise exception 'PRODUCT_RESEARCH_PROGRESS_INVALID';
  end if;
  select plan.* into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.id = p_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in ('LIVE_LISTING_REVALIDATION',
      'QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
  for update;
  if not found then raise exception 'PRODUCT_RESEARCH_PROGRESS_PLAN_MISSING'; end if;
  if p_stage = 'PENDING' and (v_plan.status <> 'ACTIVE'
      or not exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = p_plan_id and task.status = 'PENDING')) then
    raise exception 'PRODUCT_RESEARCH_PROGRESS_PENDING_UNPROVEN';
  end if;
  if p_stage in ('CLAIMED','RUNNING')
      and v_plan.source_context <> 'LIVE_LISTING_REVALIDATION'
      and (v_plan.worker_lease_owner is distinct from p_worker_id
        or v_plan.worker_lease_expires_at <= v_now) then
    raise exception 'PRODUCT_RESEARCH_PROGRESS_LEASE_UNPROVEN';
  end if;
  if p_stage = 'COMPLETED' and (v_plan.status <> 'COMPLETED'
      or exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = p_plan_id and task.status = 'PENDING')) then
    raise exception 'PRODUCT_RESEARCH_PROGRESS_COMPLETION_UNPROVEN';
  end if;
  v_fingerprint := 'sha256:' || encode(extensions.digest(
    'PRODUCT_RESEARCH_FUNCTIONAL_CANARY:' || p_plan_id::text,
    'sha256'),'hex');
  select ledger.* into v_existing
  from public.seller_os_operational_learning_ledger_v1 ledger
  where ledger.marketplace_account_key = p_marketplace_account_key
    and ledger.invariant_code = 'PRODUCT_RESEARCH_FUNCTIONAL_CANARY'
    and ledger.evidence_fingerprint = v_fingerprint
    and ledger.mechanism_version =
      'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2'
  for update;
  v_previous := case when found then v_existing.evidence->>'stage' else null end;
  if (p_stage = 'CLAIMED' and v_previous not in ('PENDING','CLAIMED'))
      or (p_stage = 'RUNNING' and v_previous not in ('CLAIMED','RUNNING'))
      or (p_stage = 'COMPLETED' and v_previous not in ('RUNNING','COMPLETED')) then
    raise exception 'PRODUCT_RESEARCH_CANARY_TRANSITION_INVALID';
  end if;
  if v_existing.id is null then
    insert into public.seller_os_operational_learning_ledger_v1(
      marketplace_account_key,failure_class,invariant_code,mechanism_version,
      evidence_fingerprint,recovery_policy_version,retry_safety,recovery_class,
      recovery_outcome,regression_guard,evidence,status,incident_state,
      occurrence_count,consecutive_count,affected_task_count,code_version,
      first_observed_at,last_observed_at)
    values (p_marketplace_account_key,'FUNCTIONAL_CANARY',
      'PRODUCT_RESEARCH_FUNCTIONAL_CANARY',
      'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2',v_fingerprint,
      'SELLER_OS_WORKER_RECOVERY_POLICY_V2','NOT_APPLICABLE',
      'OBSERVATION_ONLY','OBSERVED',
      jsonb_build_object('planId',p_plan_id,'readOnlyMarketplaceOperation',true),
      jsonb_build_object('planId',p_plan_id,'workerId',p_worker_id,
        'stage',p_stage,'transitionHistory',jsonb_build_array(
          jsonb_build_object('stage',p_stage,'observedAt',v_now)),
        'marketplaceWrites',0),
      'OPEN','OPEN',1,0,1,p_code_version,v_now,v_now)
    returning * into v_existing;
  elsif v_previous is distinct from p_stage then
    update public.seller_os_operational_learning_ledger_v1 ledger
    set evidence = ledger.evidence || jsonb_build_object('stage',p_stage,
        'workerId',p_worker_id,'transitionHistory',
        coalesce(ledger.evidence->'transitionHistory','[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object('stage',p_stage,
            'observedAt',v_now))),
      incident_state = case when p_stage = 'COMPLETED'
        then 'CANARY_PASS' when p_stage in ('CLAIMED','RUNNING')
        then 'RECOVERING' else 'OPEN' end,
      recovery_outcome = case when p_stage = 'COMPLETED'
        then 'RECOVERED' else ledger.recovery_outcome end,
      first_recovery_attempt_at = case when p_stage = 'CLAIMED'
        then coalesce(ledger.first_recovery_attempt_at,v_now)
        else ledger.first_recovery_attempt_at end,
      last_recovery_attempt_at = case when p_stage in ('CLAIMED','RUNNING')
        then v_now else ledger.last_recovery_attempt_at end,
      recovery_succeeded_at = case when p_stage = 'COMPLETED'
        then v_now else ledger.recovery_succeeded_at end,
      last_observed_at = v_now,updated_at = v_now
    where ledger.id = v_existing.id
    returning * into v_existing;
  end if;
  if p_stage = 'CLAIMED' then
    update public.seller_os_operational_learning_ledger_v1 ledger
    set incident_state = 'RECOVERING',
      first_recovery_attempt_at = coalesce(first_recovery_attempt_at,v_now),
      last_recovery_attempt_at = v_now,updated_at = v_now
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.mechanism_version =
        'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2'
      and ledger.failure_class in ('WORKER_TRANSIENT','WORKER_SESSION')
      and ledger.status = 'OPEN' and ledger.incident_state = 'OPEN';
  elsif p_stage = 'COMPLETED' then
    update public.seller_os_operational_learning_ledger_v1 ledger
    set incident_state = 'CANARY_PASS',recovery_outcome = 'RECOVERED',
      recovery_succeeded_at = v_now,updated_at = v_now
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.mechanism_version =
        'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2'
      and ledger.failure_class in ('WORKER_TRANSIENT','WORKER_SESSION')
      and ledger.status = 'OPEN'
      and ledger.incident_state in ('OPEN','RECOVERING');
  end if;
  return jsonb_build_object('planId',p_plan_id,'stage',p_stage,
    'incidentState',v_existing.incident_state,
    'functionalCanary',true,'marketplaceWrites',0);
end
$function$;

create or replace function public.reconcile_seller_os_worker_stuck_work_v2(
  p_marketplace_account_key text,p_worker_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_ready boolean := false;
  v_circuit_open boolean := false;
  v_retry_due integer := 0;
  v_expired integer := 0;
  v_stalled integer := 0;
  v_republished integer := 0;
  v_resolved integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$' then
    raise exception 'PRODUCT_RESEARCH_RECONCILER_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-worker-reconciler:' || p_marketplace_account_key ||
      ':PRODUCT_RESEARCH',0));
  select exists (select 1
    from public.seller_os_operational_learning_ledger_v1 ledger
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.invariant_code = 'PRODUCT_RESEARCH_PAGE_CONTRACT'
      and ledger.status = 'OPEN' and ledger.consecutive_count >= 10
      and ledger.incident_state in ('OPEN','RECOVERING'))
  into v_circuit_open;
  select not v_circuit_open
    and exists (select 1
      from public.seller_os_browser_worker_capabilities_v1 capability
      where capability.marketplace_account_key = p_marketplace_account_key
        and capability.worker_family = 'PRODUCT_RESEARCH'
        and capability.worker_instance_id = p_worker_id
        and capability.heartbeat_source = 'INDEPENDENT_WORKER_LIVENESS'
        and capability.physical_connection = 'PROVEN_AVAILABLE'
        and capability.extension_identity_match
        and capability.fresh_until > clock_timestamp()
      group by capability.heartbeat_receipt_id having count(*) = 2)
    and exists (select 1
      from public.seller_os_browser_workload_leader_heartbeats_v1 leader
      where leader.marketplace_account_key = p_marketplace_account_key
        and leader.worker_family = 'PRODUCT_RESEARCH'
        and leader.worker_instance_id = p_worker_id
        and leader.fresh_until > clock_timestamp())
  into v_ready;

  with candidates as (
    select plan.id from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context in ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.status = 'ACTIVE' and plan.worker_lease_owner is null
      and plan.worker_next_retry_at <= clock_timestamp()
      and plan.worker_claim_count < 5
      and exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = plan.id and task.status = 'PENDING')
    order by plan.worker_next_retry_at limit 20 for update skip locked
  )
  update public.marketplace_product_research_query_plans plan
  set worker_next_retry_at = null,
    worker_last_result = coalesce(plan.worker_last_result,'{}'::jsonb) ||
      jsonb_build_object('state','RECLAIMED_PENDING',
        'reconciledAt',clock_timestamp(),'marketplaceWrites',0),
    updated_at = clock_timestamp()
  from candidates where plan.id = candidates.id and v_ready;
  get diagnostics v_retry_due = row_count;

  with candidates as (
    select plan.id from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context in ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.status = 'ACTIVE' and plan.worker_lease_owner is not null
      and plan.worker_lease_expires_at <= clock_timestamp()
      and exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = plan.id and task.status = 'PENDING')
    order by plan.worker_lease_expires_at limit 20 for update skip locked
  )
  update public.marketplace_product_research_query_plans plan
  set worker_lease_owner = null,worker_lease_expires_at = null,
    worker_last_release_code = 'PRODUCT_RESEARCH_EXPIRED_LEASE_RECONCILED',
    worker_next_retry_at = case when plan.worker_claim_count < 5
      then clock_timestamp() else null end,
    worker_last_result = jsonb_build_object(
      'state',case when plan.worker_claim_count < 5
        then 'RETRY_WAIT' else 'QUARANTINED' end,
      'errorCode','PRODUCT_RESEARCH_EXPIRED_LEASE_RECONCILED',
      'failureClass','TRANSIENT','reconciledAt',clock_timestamp(),
      'retrySafety',case when plan.worker_claim_count < 5
        then 'SAFE_IDEMPOTENT_RUNTIME_RESUME' else 'ENGINEERING_REQUIRED' end,
      'marketplaceWrites',0),updated_at = clock_timestamp()
  from candidates where plan.id = candidates.id;
  get diagnostics v_expired = row_count;

  with candidates as (
    select plan.id from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context in ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.status = 'ACTIVE' and plan.worker_lease_owner is not null
      and plan.worker_lease_expires_at > clock_timestamp()
      and plan.worker_last_claimed_at < clock_timestamp() - interval '4 minutes'
      and exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = plan.id and task.status = 'PENDING')
    order by plan.worker_last_claimed_at limit 20 for update skip locked
  )
  update public.marketplace_product_research_query_plans plan
  set worker_lease_owner = null,worker_lease_expires_at = null,
    worker_last_release_code = 'PRODUCT_RESEARCH_RUNNING_NO_PROGRESS',
    worker_next_retry_at = case when plan.worker_claim_count < 5
      then clock_timestamp() + interval '30 seconds' else null end,
    worker_last_result = jsonb_build_object(
      'state',case when plan.worker_claim_count < 5
        then 'RETRY_WAIT' else 'QUARANTINED' end,
      'errorCode','PRODUCT_RESEARCH_RUNNING_NO_PROGRESS',
      'failureClass','TRANSIENT','reconciledAt',clock_timestamp(),
      'retrySafety',case when plan.worker_claim_count < 5
        then 'SAFE_IDEMPOTENT_RUNTIME_RESUME' else 'ENGINEERING_REQUIRED' end,
      'marketplaceWrites',0),updated_at = clock_timestamp()
  from candidates where plan.id = candidates.id;
  get diagnostics v_stalled = row_count;

  with candidates as (
    select plan.id from public.marketplace_product_research_query_plans plan
    where v_ready
      and plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context in ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.status = 'ACTIVE' and plan.worker_lease_owner is null
      and plan.worker_next_retry_at is null
      and plan.updated_at < clock_timestamp() - interval '3 minutes'
      and exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = plan.id and task.status = 'PENDING')
    order by plan.updated_at limit 20 for update skip locked
  )
  update public.marketplace_product_research_query_plans plan
  set worker_last_result = coalesce(plan.worker_last_result,'{}'::jsonb) ||
      jsonb_build_object('state','RECLAIMED_PENDING',
        'reconciledAt',clock_timestamp(),'marketplaceWrites',0),
    updated_at = clock_timestamp()
  from candidates where plan.id = candidates.id;
  get diagnostics v_republished = row_count;

  update public.seller_os_operational_learning_ledger_v1 ledger
  set status = 'RESOLVED',incident_state = 'RESOLVED',
    recovery_outcome = 'RESOLVED_BY_READBACK',resolved_at = clock_timestamp(),
    consecutive_count = 0,lease_owner = null,lease_expires_at = null,
    updated_at = clock_timestamp()
  where ledger.marketplace_account_key = p_marketplace_account_key
    and ledger.mechanism_version =
      'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2'
    and ledger.status = 'OPEN' and ledger.incident_state = 'CANARY_PASS'
    and ledger.recovery_succeeded_at <= clock_timestamp() - interval '1 second';
  get diagnostics v_resolved = row_count;
  return jsonb_build_object('readiness',case when v_ready then 'PASS'
      when v_circuit_open then 'CIRCUIT_OPEN' else 'UNAVAILABLE' end,
    'retryWaitReleased',v_retry_due,'expiredLeasesRecovered',v_expired,
    'runningStallsRecovered',v_stalled,'pendingPlansRepublished',v_republished,
    'incidentsAutoResolved',v_resolved,
    'circuitState',case when v_circuit_open then 'OPEN' else 'CLOSED' end,
    'marketplaceWrites',0);
end
$function$;

create or replace function public.read_seller_os_worker_resilience_v2(
  p_marketplace_account_key text)
returns jsonb language plpgsql security definer set search_path = '' stable
as $function$
declare
  v_liveness boolean := false;
  v_readiness boolean := false;
  v_circuit boolean := false;
  v_pending integer := 0;
  v_active integer := 0;
  v_retry_wait integer := 0;
  v_quarantined integer := 0;
  v_missing integer := 0;
  v_oldest_pending timestamptz;
  v_last_progress timestamptz;
  v_incident jsonb;
  v_canary jsonb;
  v_progress text;
  v_progress_reason text;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
    then raise exception 'PRODUCT_RESEARCH_RESILIENCE_READ_DENIED'; end if;
  select exists (select 1
    from public.seller_os_browser_worker_capabilities_v1 capability
    where capability.marketplace_account_key = p_marketplace_account_key
      and capability.worker_family = 'PRODUCT_RESEARCH'
      and capability.heartbeat_source = 'INDEPENDENT_WORKER_LIVENESS'
      and capability.physical_connection = 'PROVEN_AVAILABLE'
      and capability.extension_identity_match
      and capability.fresh_until > clock_timestamp()
    group by capability.worker_instance_id,capability.heartbeat_receipt_id
    having count(*) = 2) into v_liveness;
  select exists (select 1
    from public.seller_os_operational_learning_ledger_v1 ledger
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.invariant_code = 'PRODUCT_RESEARCH_PAGE_CONTRACT'
      and ledger.status = 'OPEN' and ledger.consecutive_count >= 10
      and ledger.incident_state in ('OPEN','RECOVERING')) into v_circuit;
  select v_liveness and not v_circuit and exists (select 1
    from public.seller_os_browser_workload_leader_heartbeats_v1 leader
    where leader.marketplace_account_key = p_marketplace_account_key
      and leader.worker_family = 'PRODUCT_RESEARCH'
      and leader.fresh_until > clock_timestamp()) into v_readiness;
  select count(*),min(task.created_at)
  into v_pending,v_oldest_pending
  from public.marketplace_product_research_query_tasks task
  join public.marketplace_product_research_query_plans plan
    on plan.id = task.plan_id
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in ('LIVE_LISTING_REVALIDATION',
      'QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
    and plan.status = 'ACTIVE' and task.status = 'PENDING';
  select max(coalesce(task.processed_at,task.captured_at))
  into v_last_progress
  from public.marketplace_product_research_query_tasks task
  join public.marketplace_product_research_query_plans plan
    on plan.id = task.plan_id
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in ('LIVE_LISTING_REVALIDATION',
      'QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
    and task.status in ('CAPTURED','PROCESSED');
  select count(*) into v_active
  from public.marketplace_product_research_query_plans plan
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in ('LIVE_LISTING_REVALIDATION',
      'QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
    and plan.worker_lease_owner is not null
    and plan.worker_lease_expires_at > clock_timestamp();
  select count(*) filter (where member.execution_state = 'RETRY_WAIT'),
    count(*) filter (where member.execution_state in
      ('QUARANTINED','NEEDS_ATTENTION')),
    count(*) filter (where member.plan_id is null)
  into v_retry_wait,v_quarantined,v_missing
  from public.seller_os_pre_research_batch_members_v1 member
  join public.seller_os_pre_research_batches_v1 batch
    on batch.batch_id = member.batch_id
  where batch.marketplace_account_key = p_marketplace_account_key
    and batch.batch_state <> 'CANCELLED';
  select jsonb_build_object('state',ledger.incident_state,
    'failureClass',ledger.failure_class,'invariantCode',ledger.invariant_code,
    'fingerprint',ledger.evidence_fingerprint,
    'occurrenceCount',ledger.occurrence_count,
    'consecutiveCount',ledger.consecutive_count,
    'firstSeenAt',ledger.first_observed_at,
    'lastSeenAt',ledger.last_observed_at,
    'recoveryAttemptedAt',ledger.last_recovery_attempt_at,
    'recoverySucceededAt',ledger.recovery_succeeded_at,
    'codeVersion',ledger.code_version,
    'regressionAfterFix',ledger.regression_after_fix)
  into v_incident
  from public.seller_os_operational_learning_ledger_v1 ledger
  where ledger.marketplace_account_key = p_marketplace_account_key
    and ledger.mechanism_version =
      'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2'
    and ledger.failure_class <> 'FUNCTIONAL_CANARY'
  order by (ledger.status = 'OPEN') desc,ledger.last_observed_at desc limit 1;
  select jsonb_build_object('state',ledger.incident_state,
    'planId',ledger.evidence->>'planId','stage',ledger.evidence->>'stage',
    'startedAt',ledger.first_observed_at,
    'completedAt',ledger.recovery_succeeded_at,
    'marketplaceWrites',0)
  into v_canary
  from public.seller_os_operational_learning_ledger_v1 ledger
  where ledger.marketplace_account_key = p_marketplace_account_key
    and ledger.invariant_code = 'PRODUCT_RESEARCH_FUNCTIONAL_CANARY'
  order by ledger.last_observed_at desc limit 1;
  if not v_readiness then
    v_progress := 'UNAVAILABLE';
    v_progress_reason := case when v_circuit then 'CIRCUIT_OPEN'
      when not v_liveness then 'WORKER_NOT_LIVE'
      else 'WORKER_NOT_READY' end;
  elsif v_pending > 0 and v_active = 0
      and v_oldest_pending < clock_timestamp() - interval '10 minutes' then
    v_progress := 'FAIL'; v_progress_reason := 'PENDING_WITHOUT_PROGRESS';
  else
    v_progress := 'PASS';
    v_progress_reason := case when v_pending = 0 and v_active = 0
      then 'IDLE_NO_PENDING_WORK' when v_active > 0 then 'WORK_IN_PROGRESS'
      else 'CLAIMABLE_WORK_PRESENT' end;
  end if;
  return jsonb_build_object(
    'contractVersion','SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2',
    'workerFamily','PRODUCT_RESEARCH',
    'liveness',jsonb_build_object('state',case when v_liveness
      then 'PASS' else 'FAIL' end,'authority','INDEPENDENT_WORKER_LIVENESS'),
    'readiness',jsonb_build_object('state',case when v_readiness
      then 'PASS' when v_circuit then 'FAIL' else 'UNAVAILABLE' end,
      'circuitState',case when v_circuit then 'OPEN' else 'CLOSED' end),
    'progress',jsonb_build_object('state',v_progress,
      'reasonCode',v_progress_reason,'pendingTaskCount',v_pending,
      'activeLeaseCount',v_active,'retryWaitCount',v_retry_wait,
      'quarantinedCount',v_quarantined,
      'missingPlanAttachmentCount',v_missing,
      'oldestPendingAt',v_oldest_pending,'lastProgressAt',v_last_progress),
    'latestIncident',v_incident,'functionalCanary',v_canary,
    'marketplaceWrites',0,'commercialDecisionWrites',0);
end
$function$;

create or replace function public.reconcile_seller_os_pre_research_batch_member_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_member public.seller_os_pre_research_batch_members_v1%rowtype;
  v_state text;
begin
  v_state := case
    when new.status = 'COMPLETED' then 'COMPLETED'
    when new.worker_lease_owner is not null
      and new.worker_lease_expires_at > clock_timestamp() then 'RUNNING'
    when new.worker_last_result->>'state' in
      ('RETRY_WAIT','RELEASED_RETRY_SAFE','STALE_LEASE_RECOVERED')
      and new.worker_last_result->>'retrySafety' =
        'SAFE_IDEMPOTENT_RUNTIME_RESUME' then 'RETRY_WAIT'
    when new.worker_last_result->>'state' in
      ('QUARANTINED','RECOVERY_POLICY_EXHAUSTED',
        'STALE_LEASE_REVIEW_REQUIRED') then 'QUARANTINED'
    else 'PENDING' end;
  for v_member in select *
    from public.seller_os_pre_research_batch_members_v1
    where plan_id = new.id order by batch_id,ordinal for update
  loop
    update public.seller_os_pre_research_batch_members_v1
    set execution_state = v_state,
      started_at = case when v_state in
        ('RUNNING','RETRY_WAIT','QUARANTINED','COMPLETED')
        then coalesce(started_at,new.worker_last_claimed_at,clock_timestamp())
        else started_at end,
      completed_at = case when v_state = 'COMPLETED'
        then new.completed_at else null end,
      bounded_failure_reason = case when v_state in
        ('RETRY_WAIT','QUARANTINED') then new.worker_last_release_code
        else null end,
      retry_safety = case when v_state in ('RETRY_WAIT','QUARANTINED')
        then new.worker_last_result->>'retrySafety' else null end,
      updated_at = clock_timestamp()
    where member_id = v_member.member_id;
    update public.seller_os_pre_research_batches_v1 batch
    set batch_state = case
        when not exists (select 1
          from public.seller_os_pre_research_batch_members_v1 m
          where m.batch_id = batch.batch_id
            and m.execution_state <> 'COMPLETED') then 'COMPLETED'
        when exists (select 1
          from public.seller_os_pre_research_batch_members_v1 m
          where m.batch_id = batch.batch_id
            and m.execution_state in ('PENDING','RUNNING','RETRY_WAIT'))
          then 'RUNNING'
        else 'NEEDS_ATTENTION' end,
      started_at = coalesce(batch.started_at,clock_timestamp()),
      completed_at = case when not exists (select 1
        from public.seller_os_pre_research_batch_members_v1 m
        where m.batch_id = batch.batch_id
          and m.execution_state in ('PENDING','RUNNING','RETRY_WAIT'))
        then coalesce(batch.completed_at,clock_timestamp()) else null end,
      updated_at = clock_timestamp()
    where batch.batch_id = v_member.batch_id;
    if v_state is distinct from v_member.execution_state
        and v_state in ('RUNNING','RETRY_WAIT','QUARANTINED','COMPLETED') then
      insert into public.seller_os_pre_research_batch_events_v1(
        batch_id,member_id,event_type,actor_kind,actor_subject,detail)
      values (v_member.batch_id,v_member.member_id,v_state,
        'DATABASE_RECONCILER',
        'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2',
        jsonb_build_object('planId',new.id,
          'failureCode',case when v_state in ('RETRY_WAIT','QUARANTINED')
            then new.worker_last_release_code else null end,
          'retrySafety',case when v_state in ('RETRY_WAIT','QUARANTINED')
            then new.worker_last_result->>'retrySafety' else null end));
    end if;
  end loop;
  return new;
end
$function$;

-- Put the circuit breaker in front of the existing canonical claimer without
-- duplicating any selection or lease logic.
alter function public.claim_next_live_listing_product_research_v2(
  text,text,jsonb,uuid,integer)
  rename to claim_next_live_listing_product_research_pre_self_healing_v2;

create or replace function public.claim_next_live_listing_product_research_v2(
  p_marketplace_account_key text,p_worker_id text,p_worker_capability jsonb,
  p_plan_id uuid default null,p_lease_seconds integer default 300)
returns table(claimed boolean,ledger_id uuid,plan_id uuid,
  lease_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $function$
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'PRODUCT_RESEARCH_WORKER_CLAIM_INVALID';
  end if;
  if exists (select 1
    from public.seller_os_operational_learning_ledger_v1 ledger
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.invariant_code = 'PRODUCT_RESEARCH_PAGE_CONTRACT'
      and ledger.status = 'OPEN' and ledger.consecutive_count >= 10
      and ledger.incident_state in ('OPEN','RECOVERING')) then
    return query select false,null::uuid,null::uuid,null::timestamptz;
    return;
  end if;
  return query select *
  from public.claim_next_live_listing_product_research_pre_self_healing_v2(
    p_marketplace_account_key,p_worker_id,p_worker_capability,p_plan_id,
    p_lease_seconds);
end
$function$;

revoke all on function public.guard_seller_os_pre_research_authorization_v2()
  from public,anon,authenticated,service_role;
revoke all on function public.classify_seller_os_worker_failure_v2(text)
  from public,anon,authenticated;
revoke all on function public.release_seller_os_product_research_failure_v2(
  text,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.record_seller_os_worker_progress_v2(
  text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.reconcile_seller_os_worker_stuck_work_v2(
  text,text) from public,anon,authenticated;
revoke all on function public.read_seller_os_worker_resilience_v2(text)
  from public,anon,authenticated;
revoke all on function public.claim_next_live_listing_product_research_pre_self_healing_v2(
  text,text,jsonb,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_next_live_listing_product_research_v2(
  text,text,jsonb,uuid,integer) from public,anon,authenticated;
revoke all on function public.request_seller_os_pre_research_batch_v1(
  text,uuid,text,uuid,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.attach_seller_os_pre_research_batch_plans_v1(
  uuid,uuid,text,jsonb) from public,anon,authenticated;

grant execute on function public.classify_seller_os_worker_failure_v2(text)
  to service_role;
grant execute on function public.release_seller_os_product_research_failure_v2(
  text,uuid,text,text,text) to service_role;
grant execute on function public.record_seller_os_worker_progress_v2(
  text,text,uuid,text,text) to service_role;
grant execute on function public.reconcile_seller_os_worker_stuck_work_v2(
  text,text) to service_role;
grant execute on function public.read_seller_os_worker_resilience_v2(text)
  to service_role;
grant execute on function public.claim_next_live_listing_product_research_v2(
  text,text,jsonb,uuid,integer) to service_role;
grant execute on function public.request_seller_os_pre_research_batch_v1(
  text,uuid,text,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.attach_seller_os_pre_research_batch_plans_v1(
  uuid,uuid,text,jsonb) to service_role;

comment on function public.reconcile_seller_os_worker_stuck_work_v2(text,text)
  is 'Bounded fail-isolated reconciler for the existing Product Research queue. Recovers retry waits, expired leases and stalled claims without marketplace writes.';
comment on function public.read_seller_os_worker_resilience_v2(text)
  is 'Read-only LIVENESS, READINESS and PROGRESS projection over canonical worker, queue, lease, incident and canary authorities.';
comment on function public.guard_seller_os_pre_research_authorization_v2()
  is 'Transactional invariant: BATCH_AUTHORIZED implies every member has one valid canonical plan.';

notify pgrst, 'reload schema';
