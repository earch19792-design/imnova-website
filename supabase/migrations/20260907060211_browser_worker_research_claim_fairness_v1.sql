-- The authenticated browser worker acquires Product Research, not completed
-- downstream reconciliation. A completed LIVE plan with a retryable readback
-- failure previously stayed at the head of this shared queue and starved every
-- ACTIVE/PENDING plan behind it. Keep one claimer, restrict it to pending
-- acquisition, and give retry-safe failures a bounded cooldown.

alter table public.marketplace_product_research_query_plans
  add column worker_next_retry_at timestamptz null;

create index marketplace_product_research_worker_retry_idx
  on public.marketplace_product_research_query_plans(
    marketplace_account_key, marketplace, worker_next_retry_at, created_at
  ) where status = 'ACTIVE'
    and source_context in (
      'LIVE_LISTING_REVALIDATION', 'QUICK_PICK_RESEARCH_REQUIRED');

create or replace function public.claim_next_live_listing_product_research_v2(
  p_marketplace_account_key text,
  p_worker_id text,
  p_worker_capability jsonb,
  p_plan_id uuid default null,
  p_lease_seconds integer default 900
)
returns table (
  claimed boolean,
  ledger_id uuid,
  plan_id uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
      or coalesce(p_worker_capability ->> 'extensionVersion', '') = '' then
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
          and capability.capability_id in (
            'PRODUCT_RESEARCH_EXTENSION',
            'PRODUCT_RESEARCH_BROWSER_WORKER')
          and capability.heartbeat_receipt_id = v_heartbeat_receipt_id
          and capability.heartbeat_source = 'INDEPENDENT_WORKER_LIVENESS'
          and capability.physical_connection = 'PROVEN_AVAILABLE'
          and capability.extension_identity_match = true
          and capability.observed_at = v_capability_observed_at
          and capability.fresh_until > clock_timestamp()
        group by capability.heartbeat_receipt_id
        having count(*) = 2
      ) then
    raise exception 'PRODUCT_RESEARCH_WORKER_CAPABILITY_STALE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'product-research-browser:' || p_marketplace_account_key, 0));

  if exists (
    select 1 from public.seller_os_operational_learning_ledger_v1 ledger
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.invariant_code = 'LIVE_LISTING_RESEARCH_REQUIRED'
      and ledger.status = 'OPEN'
      and ledger.lease_owner is not null
      and ledger.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1 from public.marketplace_product_research_query_plans plan
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
      and plan.worker_lease_owner is not null
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
    and plan.source_context in (
      'LIVE_LISTING_REVALIDATION', 'QUICK_PICK_RESEARCH_REQUIRED')
    and plan.status = 'ACTIVE'
    and (p_plan_id is null or plan.id = p_plan_id)
    and exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id
        and task.marketplace_account_key = p_marketplace_account_key
        and task.marketplace = 'EBAY_US'
        and task.status = 'PENDING')
    and (
      (plan.source_context = 'LIVE_LISTING_REVALIDATION'
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
      or
      (plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
        and plan.worker_claim_count < 5
        and (plan.worker_lease_expires_at is null
          or plan.worker_lease_expires_at <= clock_timestamp())
        and (plan.worker_next_retry_at is null
          or plan.worker_next_retry_at <= clock_timestamp()))
    )
  order by plan.created_at, plan.id
  limit 1
  for update of plan skip locked;

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
        evidence = ledger.evidence || jsonb_build_object(
          'workerAcquisition', p_worker_capability || jsonb_build_object(
            'workerId', p_worker_id,
            'claimedAt', clock_timestamp(),
            'claimState', 'CLAIMED')),
        last_observed_at = clock_timestamp(),
        updated_at = clock_timestamp()
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
        worker_last_release_code = null,
        worker_next_retry_at = null,
        updated_at = clock_timestamp()
    where plan.id = v_plan.id
      and plan.marketplace_account_key = p_marketplace_account_key
      and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED';
    v_ledger_id := null;
  end if;

  return query select true, v_ledger_id, v_plan.id, v_lease_expires_at;
end;
$$;

create or replace function public.release_live_listing_product_research_v1(
  p_marketplace_account_key text,
  p_plan_id uuid,
  p_worker_id text,
  p_error_code text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_updated integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key, '')) not between 8 and 160
      or p_plan_id is null
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_error_code !~ '^[A-Z0-9_]{3,180}$' then
    raise exception 'PRODUCT_RESEARCH_WORKER_RELEASE_INVALID';
  end if;

  select plan.* into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.id = p_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context in (
      'LIVE_LISTING_REVALIDATION', 'QUICK_PICK_RESEARCH_REQUIRED')
  for update;
  if not found then return false; end if;

  if v_plan.source_context = 'LIVE_LISTING_REVALIDATION' then
    update public.seller_os_operational_learning_ledger_v1 ledger
    set recovery_outcome = case
          when ledger.recovery_attempt_count >= 5
            then 'ENGINEERING_REQUIRED'
          else 'STILL_VIOLATED'
        end,
        evidence = ledger.evidence || jsonb_build_object(
          'workerAcquisition',
          coalesce(ledger.evidence -> 'workerAcquisition', '{}'::jsonb) ||
            jsonb_build_object('claimState', case
                when ledger.recovery_attempt_count >= 5
                  then 'RECOVERY_POLICY_EXHAUSTED'
                else 'RELEASED_RETRY_SAFE'
              end,
              'lastErrorCode', p_error_code,
              'releasedAt', clock_timestamp(),
              'nextRetryAt', case
                when ledger.recovery_attempt_count >= 5 then null
                else clock_timestamp() + interval '5 minutes'
              end)),
        lease_owner = null,
        lease_expires_at = null,
        last_observed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where ledger.id = v_plan.request_receipt_id
      and ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.status = 'OPEN'
      and ledger.lease_owner = p_worker_id;
  else
    update public.marketplace_product_research_query_plans plan
    set worker_lease_owner = null,
        worker_lease_expires_at = null,
        worker_last_release_code = p_error_code,
        worker_next_retry_at = case
          when plan.worker_claim_count >= 5 then null
          else clock_timestamp() + interval '5 minutes'
        end,
        worker_last_result = jsonb_build_object(
          'state', case
            when plan.worker_claim_count >= 5
              then 'RECOVERY_POLICY_EXHAUSTED'
            else 'RELEASED_RETRY_SAFE'
          end,
          'errorCode', p_error_code,
          'releasedAt', clock_timestamp(),
          'nextRetryAt', case
            when plan.worker_claim_count >= 5 then null
            else clock_timestamp() + interval '5 minutes'
          end,
          'retrySafety', case
            when plan.worker_claim_count >= 5 then 'ENGINEERING_REQUIRED'
            else 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
          end),
        updated_at = clock_timestamp()
    where plan.id = v_plan.id
      and plan.worker_lease_owner = p_worker_id;
  end if;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.complete_quick_pick_product_research_claim_v1(
  p_marketplace_account_key text,
  p_plan_id uuid,
  p_worker_id text,
  p_capture_batch_id uuid,
  p_completed_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key, '')) not between 8 and 160
      or p_plan_id is null
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_capture_batch_id is null
      or p_completed_at is null
      or p_completed_at > clock_timestamp() + interval '1 minute' then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_COMPLETION_INVALID';
  end if;

  update public.marketplace_product_research_query_plans plan
  set worker_lease_owner = null,
      worker_lease_expires_at = null,
      worker_next_retry_at = null,
      worker_last_release_code = null,
      worker_last_result = jsonb_build_object(
        'state', 'RESEARCH_RECEIPT_CREATED',
        'captureBatchId', p_capture_batch_id,
        'completedAt', p_completed_at,
        'marketplaceWrites', 0),
      updated_at = greatest(plan.updated_at, p_completed_at)
  where plan.id = p_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
    and plan.status = 'COMPLETED'
    and plan.worker_lease_owner = p_worker_id
    and plan.worker_lease_expires_at > clock_timestamp()
    and exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id
        and task.capture_batch_id = p_capture_batch_id
        and task.status in ('CAPTURED', 'PROCESSED'));
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

comment on function public.claim_next_live_listing_product_research_v2(
  text, text, jsonb, uuid, integer
) is 'Single fair Product Research claimer for ACTIVE/PENDING LIVE_LISTING_REVALIDATION and QUICK_PICK_RESEARCH_REQUIRED plans. Completed downstream work is never browser-acquired; retry-safe failures cool down without starving the shared queue.';

notify pgrst, 'reload schema';
