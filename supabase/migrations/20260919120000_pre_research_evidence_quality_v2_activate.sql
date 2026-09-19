-- PRE_RESEARCH_EVIDENCE_QUALITY_V2_ACTIVATE
-- Stage 2/2. Apply only after the V2 runtime is deployed and read back.
-- The completion authority independently derives comparable aggregates from
-- durable settled task evidence before reopening Luna Pre-Research intake.

lock table public.marketplace_product_research_query_plans
  in share row exclusive mode;
lock table public.marketplace_product_research_query_tasks
  in share mode;

do $block$
begin
  if not exists (
    select 1 from public.seller_os_pre_research_rollout_controls_v1 control
    where control.control_key = 'LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2'
      and control.rollout_state = 'QUIESCED_FOR_V2_DEPLOYMENT'
      and control.required_result_contract_version =
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
  ) then
    raise exception 'LUNA_PRE_RESEARCH_V2_PREPARE_REQUIRED';
  end if;
  if exists (
    select 1 from public.marketplace_product_research_query_plans plan
    where plan.marketplace = 'EBAY_US'
      and plan.source_context = 'LUNA_PRE_RESEARCH'
      and plan.status = 'COMPLETED'
      and coalesce(plan.pre_research_evidence ->> 'contractVersion','') <>
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
  ) then
    raise exception 'LUNA_PRE_RESEARCH_V1_COMPLETION_REMAINS';
  end if;
  if exists (
    select 1 from public.marketplace_product_research_query_plans plan
    where plan.marketplace = 'EBAY_US'
      and plan.source_context = 'LUNA_PRE_RESEARCH'
      and plan.status = 'ACTIVE'
      and plan.worker_lease_owner is not null
  ) then
    raise exception 'LUNA_PRE_RESEARCH_ACTIVE_LEASE_AT_ACTIVATION';
  end if;
end
$block$;

create or replace function public.complete_luna_pre_research_product_research_v1(
  p_marketplace_account_key text, p_plan_id uuid, p_worker_id text,
  p_capture_batch_id uuid, p_result text, p_trace_eligible boolean,
  p_evidence_digest text, p_evidence jsonb, p_completed_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_derived jsonb;
  v_exact_count integer;
  v_close_count integer;
  v_family_count integer;
  v_accepted_count integer;
  v_raw_sold numeric;
  v_accepted_sold numeric;
  v_derived_result text;
  v_derived_trace boolean;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_plan_id is null
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_capture_batch_id is null
      or p_result not in ('PRE_RESEARCH_HIGH','PRE_RESEARCH_MEDIUM',
        'PRE_RESEARCH_LOW','INSUFFICIENT_MARKET_EVIDENCE')
      or p_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(p_evidence) is distinct from 'object'
      or p_completed_at is null then
    raise exception 'LUNA_PRE_RESEARCH_COMPLETION_INVALID';
  end if;

  if p_evidence ->> 'contractVersion' is distinct from
      'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
      or p_evidence ->> 'comparablePolicyVersion' is distinct from
        'PRODUCT_RESEARCH_ACCEPTED_COMPARABLE_POLICY_V1_2026_09_19'
      or p_evidence ->> 'result' is distinct from p_result
      or coalesce(p_evidence ->> 'exactComparableCount','') !~ '^\d+$'
      or coalesce(p_evidence ->> 'closeVariantComparableCount','') !~ '^\d+$'
      or coalesce(p_evidence ->> 'familyComparableCount','') !~ '^\d+$'
      or coalesce(p_evidence ->> 'acceptedComparableCount','') !~ '^\d+$'
      or coalesce(p_evidence ->> 'rawObservedSoldQuantity','') !~ '^\d+$'
      or coalesce(p_evidence ->> 'acceptedComparableSoldQuantity','') !~ '^\d+$'
      or jsonb_typeof(p_evidence -> 'traceEligible') is distinct from 'boolean'
  then
    raise exception 'LUNA_PRE_RESEARCH_EVIDENCE_CONTRACT_INVALID';
  end if;

  select plan.* into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.id = p_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'LUNA_PRE_RESEARCH'
  for update;
  if not found then
    raise exception 'LUNA_PRE_RESEARCH_PLAN_NOT_FOUND';
  end if;

  if v_plan.status = 'COMPLETED' then
    if v_plan.pre_research_result is distinct from p_result
        or v_plan.pre_research_trace_eligible is distinct from p_trace_eligible
        or v_plan.pre_research_evidence_digest is distinct from p_evidence_digest
        or v_plan.pre_research_evidence is distinct from p_evidence then
      raise exception 'LUNA_PRE_RESEARCH_COMPLETION_IDEMPOTENCY_MISMATCH';
    end if;
    return jsonb_build_object('planId',v_plan.id,
      'result',v_plan.pre_research_result,
      'traceEligible',v_plan.pre_research_trace_eligible,'reused',true);
  end if;

  if v_plan.worker_lease_owner is distinct from p_worker_id
      or v_plan.worker_lease_expires_at is null
      or v_plan.worker_lease_expires_at <= clock_timestamp() then
    raise exception 'LUNA_PRE_RESEARCH_WORKER_LEASE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.marketplace_product_research_query_tasks task
    where task.plan_id = v_plan.id
      and task.capture_batch_id = p_capture_batch_id
      and task.status in ('CAPTURED','PROCESSED')
  ) or exists (
    select 1 from public.marketplace_product_research_query_tasks task
    where task.plan_id = v_plan.id
      and task.status not in ('CAPTURED','PROCESSED','SKIPPED')
  ) then
    raise exception 'LUNA_PRE_RESEARCH_CAPTURE_NOT_SETTLED';
  end if;

  v_derived := public.derive_luna_pre_research_evidence_v2(v_plan.id);
  v_exact_count := (v_derived ->> 'exactComparableCount')::integer;
  v_close_count := (v_derived ->> 'closeVariantComparableCount')::integer;
  v_family_count := (v_derived ->> 'familyComparableCount')::integer;
  v_accepted_count := (v_derived ->> 'acceptedComparableCount')::integer;
  v_raw_sold := (v_derived ->> 'rawObservedSoldQuantity')::numeric;
  v_accepted_sold :=
    (v_derived ->> 'acceptedComparableSoldQuantity')::numeric;
  v_derived_result := case
    when v_accepted_count = 0 then 'INSUFFICIENT_MARKET_EVIDENCE'
    when v_accepted_sold <= 0 then 'PRE_RESEARCH_LOW'
    when (v_derived ->> 'comparablePrecision')::numeric >= 0.5
      then 'PRE_RESEARCH_HIGH'
    else 'PRE_RESEARCH_MEDIUM'
  end;
  v_derived_trace := v_derived_result in
    ('PRE_RESEARCH_HIGH','PRE_RESEARCH_MEDIUM');

  if (p_evidence ->> 'exactComparableCount')::integer <> v_exact_count
      or (p_evidence ->> 'closeVariantComparableCount')::integer <>
        v_close_count
      or (p_evidence ->> 'familyComparableCount')::integer <> v_family_count
      or (p_evidence ->> 'acceptedComparableCount')::integer <>
        v_accepted_count
      or (p_evidence ->> 'rawObservedSoldQuantity')::numeric <> v_raw_sold
      or (p_evidence ->> 'acceptedComparableSoldQuantity')::numeric <>
        v_accepted_sold
      or v_accepted_count <> v_exact_count + v_close_count + v_family_count
      or v_accepted_sold > v_raw_sold
      or p_result is distinct from v_derived_result
      or p_trace_eligible is distinct from v_derived_trace
      or (p_evidence ->> 'traceEligible')::boolean is distinct from
        v_derived_trace
      or (v_accepted_count = 0 and
        (p_result <> 'INSUFFICIENT_MARKET_EVIDENCE' or p_trace_eligible))
      or (p_result in ('PRE_RESEARCH_HIGH','PRE_RESEARCH_MEDIUM') and
        (v_accepted_count <= 0 or v_accepted_sold <= 0)) then
    raise exception 'LUNA_PRE_RESEARCH_DURABLE_PROVENANCE_MISMATCH';
  end if;

  update public.marketplace_product_research_query_plans plan
  set status = 'COMPLETED', completed_at = p_completed_at,
    updated_at = p_completed_at, worker_lease_owner = null,
    worker_lease_expires_at = null, pre_research_result = p_result,
    pre_research_trace_eligible = p_trace_eligible,
    pre_research_evidence_digest = p_evidence_digest,
    pre_research_evidence = p_evidence,
    pre_research_completed_at = p_completed_at,
    worker_last_result = jsonb_build_object('state',p_result,
      'traceEligible',p_trace_eligible,'evidenceDigest',p_evidence_digest,
      'completedAt',p_completed_at,
      'provenanceValidation','DURABLE_SETTLED_TASK_EVIDENCE_V2')
  where plan.id = v_plan.id and plan.status = 'ACTIVE';
  if not found then
    raise exception 'LUNA_PRE_RESEARCH_COMPLETION_STATE_CHANGED';
  end if;

  return jsonb_build_object('planId',v_plan.id,'result',p_result,
    'traceEligible',p_trace_eligible,'reused',false,
    'provenanceValidation','PASS');
end;
$function$;

revoke all on function public.complete_luna_pre_research_product_research_v1(
  text,uuid,text,uuid,text,boolean,text,jsonb,timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_luna_pre_research_product_research_v1(
  text,uuid,text,uuid,text,boolean,text,jsonb,timestamptz)
  to service_role;

-- Re-open only after the durable V2 completion authority exists in the same
-- transaction. If any earlier assertion fails, Luna Pre-Research stays quiesced.
update public.seller_os_pre_research_rollout_controls_v1 control
set rollout_state = 'ACTIVE_V2', changed_at = clock_timestamp()
where control.control_key = 'LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2'
  and control.rollout_state = 'QUIESCED_FOR_V2_DEPLOYMENT';

do $block$
begin
  if not exists (
    select 1 from public.seller_os_pre_research_rollout_controls_v1 control
    where control.control_key = 'LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2'
      and control.rollout_state = 'ACTIVE_V2'
  ) then
    raise exception 'LUNA_PRE_RESEARCH_V2_ACTIVATION_INCOMPLETE';
  end if;
end
$block$;

notify pgrst, 'reload schema';
