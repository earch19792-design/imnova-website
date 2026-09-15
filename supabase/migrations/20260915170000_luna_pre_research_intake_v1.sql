-- LUNA_PRE_RESEARCH_INTAKE_V1
-- Bounded internal scheduling only. This migration does not call eBay, create
-- marketplace writes, or use ebay_luna_opportunity_queue as a staging table.

alter table public.marketplace_product_research_query_plans
  add column if not exists source_luna_snapshot_id uuid,
  add column if not exists source_product_truth_fingerprint text,
  add column if not exists pre_research_policy_version text,
  add column if not exists pre_research_result text not null default 'PENDING',
  add column if not exists pre_research_trace_eligible boolean not null default false,
  add column if not exists pre_research_evidence_digest text,
  add column if not exists pre_research_evidence jsonb not null default '{}'::jsonb,
  add column if not exists pre_research_completed_at timestamptz;

alter table public.marketplace_product_research_query_plans
  drop constraint if exists marketplace_product_research_query_plans_context_check;
alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_query_plans_context_check check (
    (source_context = 'SAME_DAY_RUN'
      and run_id is not null and subject_listing_id is null
      and subject_item_id is null and subject_supplier_variant_id is null
      and request_receipt_id is null and source_candidate_key is null
      and source_luna_product_id is null and source_supplier_sku is null
      and source_opportunity_id is null and source_luna_snapshot_id is null
      and source_product_truth_fingerprint is null
      and pre_research_policy_version is null
      and pre_research_result = 'PENDING'
      and pre_research_trace_eligible = false
      and pre_research_evidence_digest is null
      and pre_research_evidence = '{}'::jsonb
      and pre_research_completed_at is null)
    or
    (source_context = 'LIVE_LISTING_REVALIDATION'
      and run_id is null and subject_listing_id is not null
      and subject_item_id ~ '^[0-9]{9,20}$'
      and char_length(subject_supplier_variant_id) between 1 and 160
      and request_receipt_id is not null and source_candidate_key is null
      and source_luna_product_id is null and source_supplier_sku is null
      and source_opportunity_id is null and source_luna_snapshot_id is null
      and source_product_truth_fingerprint is null
      and pre_research_policy_version is null
      and pre_research_result = 'PENDING'
      and pre_research_trace_eligible = false
      and pre_research_evidence_digest is null
      and pre_research_evidence = '{}'::jsonb
      and pre_research_completed_at is null)
    or
    (source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
      and run_id is null and subject_listing_id is null
      and subject_item_id is null and request_receipt_id is null
      and (source_candidate_key ~ '^sha256:[0-9a-f]{64}$'
        or source_candidate_key ~ '^luna-portex:[0-9]{1,30}:[0-9]{1,30}$')
      and source_luna_product_id ~ '^[0-9]{1,30}$'
      and subject_supplier_variant_id ~ '^[0-9]{1,30}$'
      and char_length(source_supplier_sku) between 1 and 160
      and source_opportunity_id is not null and source_luna_snapshot_id is null
      and source_product_truth_fingerprint is null
      and pre_research_policy_version is null
      and pre_research_result = 'PENDING'
      and pre_research_trace_eligible = false
      and pre_research_evidence_digest is null
      and pre_research_evidence = '{}'::jsonb
      and pre_research_completed_at is null)
    or
    (source_context = 'LUNA_PRE_RESEARCH'
      and run_id is null and subject_listing_id is null
      and subject_item_id is null and request_receipt_id is null
      and source_candidate_key ~ '^sha256:[0-9a-f]{64}$'
      and source_luna_product_id ~ '^[0-9]{1,30}$'
      and subject_supplier_variant_id ~ '^[0-9]{1,30}$'
      and char_length(source_supplier_sku) between 1 and 160
      and source_opportunity_id is null and source_luna_snapshot_id is not null
      and source_product_truth_fingerprint ~ '^sha256:[0-9a-f]{64}$'
      and pre_research_policy_version = 'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15'
      and pre_research_result in ('PENDING','PRE_RESEARCH_HIGH',
        'PRE_RESEARCH_MEDIUM','PRE_RESEARCH_LOW',
        'INSUFFICIENT_MARKET_EVIDENCE')
      and (pre_research_trace_eligible = false
        or pre_research_result in ('PRE_RESEARCH_HIGH','PRE_RESEARCH_MEDIUM'))
      and (pre_research_evidence_digest is null
        or pre_research_evidence_digest ~ '^sha256:[0-9a-f]{64}$')
      and jsonb_typeof(pre_research_evidence) = 'object')
  );

alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_luna_snapshot_fk
  foreign key (source_luna_snapshot_id)
  references public.luna_catalog_snapshots_v1(snapshot_id)
  on delete restrict;

alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_luna_truth_fingerprint_check
  check (source_product_truth_fingerprint is null
    or source_product_truth_fingerprint ~ '^sha256:[0-9a-f]{64}$');

alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_pre_result_check
  check (pre_research_result in ('PENDING','PRE_RESEARCH_HIGH',
    'PRE_RESEARCH_MEDIUM','PRE_RESEARCH_LOW',
    'INSUFFICIENT_MARKET_EVIDENCE'));

create unique index if not exists marketplace_product_research_luna_identity_uq
  on public.marketplace_product_research_query_plans
    (marketplace_account_key, marketplace, source_candidate_key)
  where source_context = 'LUNA_PRE_RESEARCH';

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
  v_created boolean := false;
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
      or p_pre_research_policy_version <> 'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15'
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
    'luna-pre-research:' || p_marketplace_account_key || ':' || p_identity_key, 0));

  select plan.* into v_existing
  from public.marketplace_product_research_query_plans plan
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'LUNA_PRE_RESEARCH'
    and plan.source_candidate_key = p_identity_key
  for update;

  if found then
    select count(*) into v_pending
    from public.marketplace_product_research_query_tasks task
    where task.plan_id = v_existing.id and task.status = 'PENDING';
    return jsonb_build_object(
      'planId', v_existing.id,
      'created', false,
      'sourceContext', v_existing.source_context,
      'preResearchResult', v_existing.pre_research_result,
      'pendingTaskCount', v_pending,
      'idempotencyKey', v_existing.source_candidate_key);
  end if;

  insert into public.marketplace_product_research_query_plans (
    id, marketplace_account_key, marketplace, run_id, plan_version,
    input_hash, status, query_count, candidate_count, source_context,
    subject_supplier_variant_id, source_candidate_key, source_luna_product_id,
    source_supplier_sku, source_luna_snapshot_id,
    source_product_truth_fingerprint, pre_research_policy_version,
    pre_research_result, pre_research_trace_eligible, pre_research_evidence,
    research_intelligence_status, intelligence_contract_version,
    raw_competitor_content_stored, pii_stored, openai_calls, ebay_writes)
  values (
    p_plan_id, p_marketplace_account_key, 'EBAY_US', null,
    p_plan_version, p_input_hash, 'ACTIVE', jsonb_array_length(p_queries), 1,
    'LUNA_PRE_RESEARCH', p_luna_variant_id, p_identity_key,
    p_luna_product_id, p_supplier_sku, p_luna_snapshot_id,
    p_product_truth_fingerprint, p_pre_research_policy_version, 'PENDING',
    false, '{}'::jsonb, 'RESEARCH_IN_PROGRESS',
    'LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15', false, false, 0, 0)
  returning id into v_plan_id;

  insert into public.marketplace_product_research_query_tasks (
    plan_id, marketplace_account_key, marketplace, ordinal, search_query,
    query_hash, cluster_key_hash, category_id, candidate_count,
    candidate_variant_hashes, query_intent, evidence_basis, strategy_version)
  select v_plan_id, p_marketplace_account_key, 'EBAY_US', q.ordinal,
    q.search_query, q.query_hash, q.cluster_key_hash, q.category_id,
    q.candidate_count, q.candidate_variant_hashes, q.query_intent,
    coalesce(q.evidence_basis, '[]'::jsonb), q.strategy_version
  from jsonb_to_recordset(p_queries) as q(
    ordinal integer, search_query text, query_hash text,
    cluster_key_hash text, category_id text, candidate_count integer,
    candidate_variant_hashes text[], query_intent text,
    evidence_basis jsonb, strategy_version text);

  get diagnostics v_pending = row_count;
  if v_pending <> jsonb_array_length(p_queries) then
    raise exception 'LUNA_PRE_RESEARCH_TASK_PERSISTENCE_INCOMPLETE';
  end if;
  v_created := true;
  return jsonb_build_object(
    'planId', v_plan_id, 'created', v_created,
    'sourceContext', 'LUNA_PRE_RESEARCH', 'preResearchResult', 'PENDING',
    'pendingTaskCount', v_pending, 'idempotencyKey', p_identity_key);
end;
$function$;

revoke all on function public.create_or_reuse_luna_pre_research_plan_v1(
  uuid,text,text,text,text,uuid,text,text,text,text,text,text,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_or_reuse_luna_pre_research_plan_v1(
  uuid,text,text,text,text,uuid,text,text,text,text,text,text,timestamptz,jsonb)
  to service_role;

create or replace function public.claim_next_live_listing_product_research_v2(
  p_marketplace_account_key text,
  p_worker_id text,
  p_worker_capability jsonb,
  p_plan_id uuid default null,
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
      or p_worker_capability ->> 'heartbeatSource' is distinct from 'INDEPENDENT_WORKER_LIVENESS'
      or coalesce(p_worker_capability ->> 'extensionVersion', '') = '' then
    raise exception 'PRODUCT_RESEARCH_WORKER_CLAIM_INVALID';
  end if;
  begin
    v_capability_observed_at := (p_worker_capability ->> 'observedAt')::timestamptz;
    v_heartbeat_receipt_id := (p_worker_capability ->> 'heartbeatReceiptId')::uuid;
  exception when others then
    raise exception 'PRODUCT_RESEARCH_WORKER_CAPABILITY_TIME_INVALID';
  end;
  if v_capability_observed_at < clock_timestamp() - interval '5 minutes'
      or v_capability_observed_at > clock_timestamp() + interval '1 minute'
      or not exists (
        select 1 from public.seller_os_browser_worker_capabilities_v1 capability
        where capability.marketplace_account_key = p_marketplace_account_key
          and capability.capability_id in ('PRODUCT_RESEARCH_EXTENSION','PRODUCT_RESEARCH_BROWSER_WORKER')
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
    select 1 from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context in ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.worker_lease_owner = p_worker_id
      and plan.worker_lease_expires_at > clock_timestamp()) then
    return query select false, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  select plan.* into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in ('LIVE_LISTING_REVALIDATION','QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
    and plan.status = 'ACTIVE'
    and (p_plan_id is null or plan.id = p_plan_id)
    and exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id and task.marketplace_account_key = p_marketplace_account_key
        and task.marketplace = 'EBAY_US' and task.status = 'PENDING')
    and ((plan.source_context = 'LIVE_LISTING_REVALIDATION' and exists (
      select 1 from public.seller_os_operational_learning_ledger_v1 ledger
      where ledger.id = plan.request_receipt_id
        and ledger.marketplace_account_key = p_marketplace_account_key
        and ledger.invariant_code = 'LIVE_LISTING_RESEARCH_REQUIRED'
        and ledger.mechanism_version = 'MAYEL_LIVE_MARKET_REVALIDATION_V1_2026_09_06'
        and ledger.status = 'OPEN' and ledger.recovery_class = 'AUTO_RECOVERABLE'
        and ledger.retry_safety = 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
        and ledger.recovery_attempt_count < 5
        and (ledger.lease_expires_at is null or ledger.lease_expires_at <= clock_timestamp())
        and (ledger.recovery_outcome <> 'STILL_VIOLATED'
          or ledger.last_observed_at <= clock_timestamp() - interval '5 minutes')))
      or plan.source_context in ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
        and plan.worker_claim_count < 5
        and (plan.worker_lease_expires_at is null or plan.worker_lease_expires_at <= clock_timestamp())
        and (plan.worker_next_retry_at is null or plan.worker_next_retry_at <= clock_timestamp()))
  order by plan.worker_claim_count, plan.created_at, plan.id
  limit 1 for update of plan skip locked;
  if not found then
    return query select false, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  v_lease_expires_at := clock_timestamp() + make_interval(secs => p_lease_seconds);
  if v_plan.source_context = 'LIVE_LISTING_REVALIDATION' then
    update public.seller_os_operational_learning_ledger_v1 ledger
    set lease_owner = p_worker_id, lease_expires_at = v_lease_expires_at,
      recovery_attempt_count = ledger.recovery_attempt_count + 1,
      recovery_outcome = 'CLAIMED', last_observed_at = clock_timestamp(),
      updated_at = clock_timestamp()
    where ledger.id = v_plan.request_receipt_id
      and ledger.marketplace_account_key = p_marketplace_account_key
    returning ledger.id into v_ledger_id;
  else
    update public.marketplace_product_research_query_plans plan
    set worker_lease_owner = p_worker_id, worker_lease_expires_at = v_lease_expires_at,
      worker_claim_count = plan.worker_claim_count + 1,
      worker_last_claimed_at = clock_timestamp(), worker_capability_receipt_id = v_heartbeat_receipt_id,
      worker_last_release_code = null, worker_next_retry_at = null,
      updated_at = clock_timestamp()
    where plan.id = v_plan.id and plan.marketplace_account_key = p_marketplace_account_key
      and plan.source_context in ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH');
  end if;
  return query select true, v_ledger_id, v_plan.id, v_lease_expires_at;
end;
$function$;

create or replace function public.release_live_listing_product_research_v1(
  p_marketplace_account_key text, p_plan_id uuid, p_worker_id text, p_error_code text)
returns boolean
language plpgsql security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_plan public.marketplace_product_research_query_plans%rowtype; v_updated integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_plan_id is null or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_error_code !~ '^[A-Z0-9_]{3,180}$' then
    raise exception 'PRODUCT_RESEARCH_WORKER_RELEASE_INVALID';
  end if;
  select plan.* into v_plan from public.marketplace_product_research_query_plans plan
  where plan.id = p_plan_id and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in ('LIVE_LISTING_REVALIDATION','QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
  for update;
  if not found then return false; end if;
  if v_plan.source_context = 'LIVE_LISTING_REVALIDATION' then
    update public.seller_os_operational_learning_ledger_v1 ledger
    set recovery_outcome = case when ledger.recovery_attempt_count >= 5 then 'ENGINEERING_REQUIRED' else 'STILL_VIOLATED' end,
      lease_owner = null, lease_expires_at = null, last_observed_at = clock_timestamp(), updated_at = clock_timestamp()
    where ledger.id = v_plan.request_receipt_id and ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.status = 'OPEN' and ledger.lease_owner = p_worker_id;
  else
    update public.marketplace_product_research_query_plans plan
    set worker_lease_owner = null, worker_lease_expires_at = null,
      worker_last_release_code = p_error_code,
      worker_next_retry_at = case when plan.worker_claim_count >= 5 then null else clock_timestamp() + interval '5 minutes' end,
      worker_last_result = jsonb_build_object('state', case when plan.worker_claim_count >= 5 then 'RECOVERY_POLICY_EXHAUSTED' else 'RELEASED_RETRY_SAFE' end,
        'errorCode', p_error_code, 'releasedAt', clock_timestamp()), updated_at = clock_timestamp()
    where plan.id = v_plan.id and plan.worker_lease_owner = p_worker_id;
  end if;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$function$;

create or replace function public.complete_luna_pre_research_product_research_v1(
  p_marketplace_account_key text, p_plan_id uuid, p_worker_id text,
  p_capture_batch_id uuid, p_result text, p_trace_eligible boolean,
  p_evidence_digest text, p_evidence jsonb, p_completed_at timestamptz)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_plan public.marketplace_product_research_query_plans%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_plan_id is null or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_capture_batch_id is null
      or p_result not in ('PRE_RESEARCH_HIGH','PRE_RESEARCH_MEDIUM','PRE_RESEARCH_LOW','INSUFFICIENT_MARKET_EVIDENCE')
      or p_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(p_evidence) is distinct from 'object'
      or p_completed_at is null then
    raise exception 'LUNA_PRE_RESEARCH_COMPLETION_INVALID';
  end if;
  select plan.* into v_plan from public.marketplace_product_research_query_plans plan
  where plan.id = p_plan_id and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US' and plan.source_context = 'LUNA_PRE_RESEARCH'
  for update;
  if not found then raise exception 'LUNA_PRE_RESEARCH_PLAN_NOT_FOUND'; end if;
  if v_plan.status = 'COMPLETED' then
    return jsonb_build_object('planId', v_plan.id, 'result', v_plan.pre_research_result,
      'traceEligible', v_plan.pre_research_trace_eligible, 'reused', true);
  end if;
  if v_plan.worker_lease_owner is distinct from p_worker_id
      or v_plan.worker_lease_expires_at is null
      or v_plan.worker_lease_expires_at <= clock_timestamp() then
    raise exception 'LUNA_PRE_RESEARCH_WORKER_LEASE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.marketplace_product_research_query_tasks task
    where task.plan_id = v_plan.id and task.capture_batch_id = p_capture_batch_id
      and task.status in ('CAPTURED','PROCESSED'))
      or exists (select 1 from public.marketplace_product_research_query_tasks task
        where task.plan_id = v_plan.id and task.status = 'PENDING') then
    raise exception 'LUNA_PRE_RESEARCH_CAPTURE_NOT_SETTLED';
  end if;
  update public.marketplace_product_research_query_plans plan
  set status = 'COMPLETED', completed_at = p_completed_at, updated_at = p_completed_at,
    worker_lease_owner = null, worker_lease_expires_at = null,
    pre_research_result = p_result,
    pre_research_trace_eligible = p_trace_eligible,
    pre_research_evidence_digest = p_evidence_digest,
    pre_research_evidence = p_evidence,
    pre_research_completed_at = p_completed_at,
    worker_last_result = jsonb_build_object('state', p_result, 'traceEligible', p_trace_eligible,
      'evidenceDigest', p_evidence_digest, 'completedAt', p_completed_at)
  where plan.id = v_plan.id and plan.status = 'ACTIVE';
  return jsonb_build_object('planId', v_plan.id, 'result', p_result,
    'traceEligible', p_trace_eligible, 'reused', false);
end;
$function$;

revoke all on function public.claim_next_live_listing_product_research_v2(text,text,jsonb,uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_next_live_listing_product_research_v2(text,text,jsonb,uuid,integer) to service_role;
revoke all on function public.release_live_listing_product_research_v1(text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.release_live_listing_product_research_v1(text,uuid,text,text) to service_role;
revoke all on function public.complete_luna_pre_research_product_research_v1(text,uuid,text,uuid,text,boolean,text,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.complete_luna_pre_research_product_research_v1(text,uuid,text,uuid,text,boolean,text,jsonb,timestamptz) to service_role;
