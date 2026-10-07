-- SELLER_OS_WORKER_RESILIENCE_RUNTIME_CERTIFICATION_V2_1
--
-- Runtime certification found historical ACTIVE plans whose bounded five
-- attempts had already been exhausted. They were correctly unclaimable, but
-- the V2 reconciler projected them as RECLAIMED_PENDING and the health reader
-- counted their pending task rows as runnable work. Keep the original task
-- evidence intact, quarantine the exhausted plan, and only report work that a
-- canonical claimer can actually consume.

update public.marketplace_product_research_query_plans plan
set worker_next_retry_at = null,
  worker_last_result = coalesce(plan.worker_last_result, '{}'::jsonb) ||
    jsonb_build_object(
      'state','QUARANTINED',
      'recoveryAction','QUARANTINE_TASK',
      'retrySafety','ENGINEERING_REQUIRED',
      'quarantinedAt',clock_timestamp(),
      'quarantineReason','PRODUCT_RESEARCH_RETRY_BUDGET_EXHAUSTED',
      'marketplaceWrites',0),
  updated_at = clock_timestamp()
where plan.marketplace = 'EBAY_US'
  and plan.source_context in
    ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
  and plan.status = 'ACTIVE'
  and plan.worker_claim_count >= 5
  and plan.worker_lease_owner is null
  and exists (select 1
    from public.marketplace_product_research_query_tasks task
    where task.plan_id = plan.id and task.status = 'PENDING')
  and coalesce(plan.worker_last_result->>'state','') <> 'QUARANTINED';

create or replace function public.reconcile_seller_os_worker_stuck_work_v2(
  p_marketplace_account_key text,p_worker_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_ready boolean := false;
  v_circuit_open boolean := false;
  v_retry_due integer := 0;
  v_expired integer := 0;
  v_stalled integer := 0;
  v_exhausted integer := 0;
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
      and plan.source_context in
        ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.status = 'ACTIVE' and plan.worker_lease_owner is null
      and plan.worker_claim_count >= 5
      and coalesce(plan.worker_last_result->>'state','') <> 'QUARANTINED'
      and exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = plan.id and task.status = 'PENDING')
    order by plan.updated_at limit 100 for update skip locked
  )
  update public.marketplace_product_research_query_plans plan
  set worker_next_retry_at = null,
    worker_last_result = coalesce(plan.worker_last_result,'{}'::jsonb) ||
      jsonb_build_object('state','QUARANTINED',
        'recoveryAction','QUARANTINE_TASK',
        'retrySafety','ENGINEERING_REQUIRED',
        'quarantinedAt',clock_timestamp(),
        'quarantineReason','PRODUCT_RESEARCH_RETRY_BUDGET_EXHAUSTED',
        'marketplaceWrites',0),
    updated_at = clock_timestamp()
  from candidates where plan.id = candidates.id;
  get diagnostics v_exhausted = row_count;

  with candidates as (
    select plan.id from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context in
        ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
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
      and plan.source_context in
        ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
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
      and plan.source_context in
        ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
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
      and plan.source_context in
        ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
      and plan.status = 'ACTIVE' and plan.worker_lease_owner is null
      and plan.worker_claim_count < 5
      and plan.worker_next_retry_at is null
      and coalesce(plan.worker_last_result->>'state','') <> 'QUARANTINED'
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
    'runningStallsRecovered',v_stalled,
    'exhaustedPlansQuarantined',v_exhausted,
    'pendingPlansRepublished',v_republished,
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
  v_exhausted integer := 0;
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
    and plan.status = 'ACTIVE' and task.status = 'PENDING'
    and (
      (plan.source_context in
          ('QUICK_PICK_RESEARCH_REQUIRED','LUNA_PRE_RESEARCH')
        and plan.worker_claim_count < 5
        and coalesce(plan.worker_last_result->>'state','') <> 'QUARANTINED')
      or (plan.source_context = 'LIVE_LISTING_REVALIDATION'
        and exists (select 1
          from public.seller_os_operational_learning_ledger_v1 ledger
          where ledger.id = plan.request_receipt_id
            and ledger.status = 'OPEN'
            and ledger.recovery_attempt_count < 5))
    );
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
  select count(*) into v_retry_wait from (
    select 'member:' || member.member_id::text as work_key
    from public.seller_os_pre_research_batch_members_v1 member
    join public.seller_os_pre_research_batches_v1 batch
      on batch.batch_id = member.batch_id
    where batch.marketplace_account_key = p_marketplace_account_key
      and batch.batch_state <> 'CANCELLED'
      and member.execution_state = 'RETRY_WAIT'
    union
    select 'plan:' || plan.id::text
    from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US' and plan.status = 'ACTIVE'
      and plan.worker_claim_count < 5
      and plan.worker_last_result->>'state' = 'RETRY_WAIT'
  ) retrying;
  select count(*) into v_quarantined from (
    select 'member:' || member.member_id::text as work_key
    from public.seller_os_pre_research_batch_members_v1 member
    join public.seller_os_pre_research_batches_v1 batch
      on batch.batch_id = member.batch_id
    where batch.marketplace_account_key = p_marketplace_account_key
      and batch.batch_state <> 'CANCELLED'
      and member.execution_state in ('QUARANTINED','NEEDS_ATTENTION')
    union
    select 'plan:' || plan.id::text
    from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US' and plan.status = 'ACTIVE'
      and plan.worker_claim_count >= 5
      and exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = plan.id and task.status = 'PENDING')
  ) quarantined;
  select count(*) into v_exhausted
  from public.marketplace_product_research_query_plans plan
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US' and plan.status = 'ACTIVE'
    and plan.worker_claim_count >= 5
    and exists (select 1
      from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id and task.status = 'PENDING');
  select count(*) into v_missing
  from public.seller_os_pre_research_batch_members_v1 member
  join public.seller_os_pre_research_batches_v1 batch
    on batch.batch_id = member.batch_id
  where batch.marketplace_account_key = p_marketplace_account_key
    and batch.batch_state <> 'CANCELLED' and member.plan_id is null;
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
      'exhaustedPlanCount',v_exhausted,
      'missingPlanAttachmentCount',v_missing,
      'oldestPendingAt',v_oldest_pending,'lastProgressAt',v_last_progress),
    'latestIncident',v_incident,'functionalCanary',v_canary,
    'marketplaceWrites',0,'commercialDecisionWrites',0);
end
$function$;

revoke all on function public.reconcile_seller_os_worker_stuck_work_v2(
  text,text) from public,anon,authenticated;
revoke all on function public.read_seller_os_worker_resilience_v2(text)
  from public,anon,authenticated;
grant execute on function public.reconcile_seller_os_worker_stuck_work_v2(
  text,text) to service_role;
grant execute on function public.read_seller_os_worker_resilience_v2(text)
  to service_role;

comment on function public.reconcile_seller_os_worker_stuck_work_v2(text,text)
  is 'V2.1 bounded reconciler: quarantines exhausted plans and only republishes canonically claimable work; no marketplace writes.';
comment on function public.read_seller_os_worker_resilience_v2(text)
  is 'V2.1 read-only LIVENESS, READINESS and actionable PROGRESS projection. Exhausted evidence is reported as quarantine, never as runnable backlog.';

notify pgrst, 'reload schema';
