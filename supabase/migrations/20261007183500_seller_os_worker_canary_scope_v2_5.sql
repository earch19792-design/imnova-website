-- SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2.5
-- Scope functional-canary receipts to the exact ITEM6127 controlled cohort and
-- serialize canary scheduling through the existing operational ledger.

create or replace function public.is_seller_os_worker_functional_canary_plan_v2(
  p_marketplace_account_key text,p_plan_id uuid)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1
    from public.marketplace_product_research_query_plans plan
    join public.seller_os_luna_pre_research_rerun_cohorts_v1 cohort
      on cohort.cohort_id = plan.pre_research_rerun_cohort_id
    where plan.id = p_plan_id
      and plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context = 'LUNA_PRE_RESEARCH'
      and plan.source_luna_product_id = '9220801986784'
      and plan.subject_supplier_variant_id = '48809603137760'
      and plan.source_supplier_sku = 'ITEM6127'
      and cohort.account = p_marketplace_account_key
      and cohort.marketplace = 'EBAY_US'
      and cohort.reason_code = 'WORKER_V2_FUNCTIONAL_CANARY'
      and cohort.state = 'SEALED'
  )
$function$;

create or replace function public.claim_seller_os_worker_functional_canary_v2(
  p_marketplace_account_key text,p_owner_user_id uuid,
  p_window_start_ms bigint,p_code_version text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_expected_window bigint := floor(
    extract(epoch from clock_timestamp()) * 1000 / 21600000)::bigint * 21600000;
  v_fingerprint text;
  v_ledger public.seller_os_operational_learning_ledger_v1%rowtype;
  v_lease_owner text := 'functional-canary:' || p_owner_user_id::text;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_owner_user_id is null
      or p_window_start_ms is distinct from v_expected_window
      or p_code_version !~ '^[A-Za-z0-9._:-]{3,120}$' then
    raise exception 'PRODUCT_RESEARCH_FUNCTIONAL_CANARY_CLAIM_INVALID';
  end if;
  v_fingerprint := 'sha256:' || encode(extensions.digest(
    'PRODUCT_RESEARCH_FUNCTIONAL_CANARY_SCHEDULE:' ||
      p_marketplace_account_key || ':' || p_window_start_ms::text,
    'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-functional-canary:' || v_fingerprint,0));
  select ledger.* into v_ledger
  from public.seller_os_operational_learning_ledger_v1 ledger
  where ledger.marketplace_account_key = p_marketplace_account_key
    and ledger.invariant_code =
      'PRODUCT_RESEARCH_FUNCTIONAL_CANARY_SCHEDULE'
    and ledger.evidence_fingerprint = v_fingerprint
    and ledger.mechanism_version =
      'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2'
  for update;
  if found and v_ledger.lease_expires_at > v_now then
    return jsonb_build_object('claimed',false,'reasonCode',
      'FUNCTIONAL_CANARY_WINDOW_ALREADY_CLAIMED','windowStartMs',
      p_window_start_ms,'leaseExpiresAt',v_ledger.lease_expires_at,
      'marketplaceWrites',0);
  end if;
  if v_ledger.id is null then
    insert into public.seller_os_operational_learning_ledger_v1(
      marketplace_account_key,failure_class,invariant_code,mechanism_version,
      evidence_fingerprint,recovery_policy_version,retry_safety,
      recovery_class,recovery_outcome,regression_guard,evidence,status,
      lease_owner,lease_expires_at,recovery_attempt_count,first_observed_at,
      last_observed_at,incident_state,occurrence_count,consecutive_count,
      affected_task_count,code_version)
    values (p_marketplace_account_key,'FUNCTIONAL_CANARY',
      'PRODUCT_RESEARCH_FUNCTIONAL_CANARY_SCHEDULE',
      'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2',v_fingerprint,
      'SELLER_OS_WORKER_RECOVERY_POLICY_V2','NOT_APPLICABLE',
      'OBSERVATION_ONLY','CLAIMED',
      jsonb_build_object('windowStartMs',p_window_start_ms,
        'exactCandidateSku','ITEM6127'),
      jsonb_build_object('windowStartMs',p_window_start_ms,
        'exactCandidateSku','ITEM6127','marketplaceWrites',0),
      'OPEN',v_lease_owner,v_now + interval '2 minutes',1,v_now,v_now,
      'RECOVERING',1,1,0,p_code_version)
    returning * into v_ledger;
  else
    update public.seller_os_operational_learning_ledger_v1 ledger
    set lease_owner = v_lease_owner,
      lease_expires_at = v_now + interval '2 minutes',
      recovery_attempt_count = ledger.recovery_attempt_count + 1,
      last_recovery_attempt_at = v_now,last_observed_at = v_now,
      updated_at = v_now,incident_state = 'RECOVERING',
      recovery_outcome = 'CLAIMED',code_version = p_code_version
    where ledger.id = v_ledger.id returning * into v_ledger;
  end if;
  return jsonb_build_object('claimed',true,'reasonCode',
    'FUNCTIONAL_CANARY_WINDOW_CLAIMED','windowStartMs',p_window_start_ms,
    'leaseExpiresAt',v_ledger.lease_expires_at,'marketplaceWrites',0);
end
$function$;

do $patch_progress_recorder$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.record_seller_os_worker_progress_v2(text,text,uuid,text,text)'))
  into v_definition;
  if v_definition is null then
    raise exception 'PRODUCT_RESEARCH_PROGRESS_RECORDER_MISSING';
  end if;
  v_patched := replace(v_definition,
    $$if not found then raise exception 'PRODUCT_RESEARCH_PROGRESS_PLAN_MISSING'; end if;
  if p_stage = 'PENDING'$$,
    $$if not found then raise exception 'PRODUCT_RESEARCH_PROGRESS_PLAN_MISSING'; end if;
  if not public.is_seller_os_worker_functional_canary_plan_v2(
      p_marketplace_account_key,p_plan_id) then
    return jsonb_build_object('planId',p_plan_id,'stage',p_stage,
      'incidentState',null,'functionalCanary',false,'ignored',true,
      'reasonCode','NON_CANARY_PROGRESS_OBSERVATION','marketplaceWrites',0);
  end if;
  if p_stage = 'PENDING'$$);
  if v_patched = v_definition then
    raise exception 'PRODUCT_RESEARCH_CANARY_SCOPE_PATCH_NOT_APPLIED';
  end if;
  execute v_patched;
end
$patch_progress_recorder$;

-- Preserve the historical observations while removing them from the canary
-- authority. They were ordinary plans incorrectly classified by V2.0.
update public.seller_os_operational_learning_ledger_v1 ledger
set invariant_code = 'PRODUCT_RESEARCH_NON_CANARY_PROGRESS',
  status = 'RESOLVED',incident_state = 'RESOLVED',
  recovery_outcome = 'RESOLVED_BY_READBACK',
  resolved_at = coalesce(ledger.resolved_at,clock_timestamp()),
  lease_owner = null,lease_expires_at = null,
  evidence = ledger.evidence || jsonb_build_object(
    'classificationCorrection','NON_CANARY_PROGRESS_OBSERVATION',
    'correctedAt',clock_timestamp(),'marketplaceWrites',0),
  updated_at = clock_timestamp()
where ledger.invariant_code = 'PRODUCT_RESEARCH_FUNCTIONAL_CANARY'
  and ledger.mechanism_version =
    'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2'
  and coalesce(ledger.evidence->>'planId','') ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and not public.is_seller_os_worker_functional_canary_plan_v2(
    ledger.marketplace_account_key,(ledger.evidence->>'planId')::uuid);

revoke all on function public.is_seller_os_worker_functional_canary_plan_v2(
  text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_seller_os_worker_functional_canary_v2(
  text,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_seller_os_worker_functional_canary_v2(
  text,uuid,bigint,text) to service_role;

comment on function public.claim_seller_os_worker_functional_canary_v2(
  text,uuid,bigint,text)
  is 'Serializes one exact ITEM6127 functional-canary scheduler per six-hour window using the existing operational ledger; marketplace writes: zero.';
comment on function public.record_seller_os_worker_progress_v2(
  text,text,uuid,text,text)
  is 'Records functional-canary transitions only for the exact ITEM6127 WORKER_V2_FUNCTIONAL_CANARY cohort. Ordinary plan progress is ignored without error; marketplace writes: zero.';

notify pgrst, 'reload schema';
