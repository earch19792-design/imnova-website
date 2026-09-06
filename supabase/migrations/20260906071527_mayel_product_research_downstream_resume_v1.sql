-- A Product Research task may have durably completed before a downstream
-- Radar/read-model receipt closes. Keep that exact unfinished stage
-- reclaimable without repeating the browser capture.

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
begin
  if p_marketplace_account_key is null
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
      or coalesce(p_worker_capability ->> 'extensionVersion', '') = '' then
    raise exception 'LIVE_PRODUCT_RESEARCH_WORKER_CLAIM_INVALID';
  end if;

  begin
    v_capability_observed_at :=
      (p_worker_capability ->> 'observedAt')::timestamptz;
  exception when others then
    raise exception 'LIVE_PRODUCT_RESEARCH_WORKER_CAPABILITY_TIME_INVALID';
  end;
  if v_capability_observed_at < pg_catalog.clock_timestamp() - interval '5 minutes'
      or v_capability_observed_at > pg_catalog.clock_timestamp() + interval '1 minute' then
    raise exception 'LIVE_PRODUCT_RESEARCH_WORKER_CAPABILITY_STALE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'mayel-live-product-research:' || p_marketplace_account_key, 0
    )
  );

  if exists (
    select 1
    from public.seller_os_operational_learning_ledger_v1 active
    where active.marketplace_account_key = p_marketplace_account_key
      and active.invariant_code = 'LIVE_LISTING_RESEARCH_REQUIRED'
      and active.status = 'OPEN'
      and active.lease_owner is not null
      and active.lease_expires_at > pg_catalog.clock_timestamp()
  ) then
    return query select false, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  return query
  with candidate as (
    select ledger.id as ledger_id, plan.id as plan_id
    from public.seller_os_operational_learning_ledger_v1 ledger
    join public.marketplace_product_research_query_plans plan
      on plan.request_receipt_id = ledger.id
    where ledger.marketplace_account_key = p_marketplace_account_key
      and ledger.invariant_code = 'LIVE_LISTING_RESEARCH_REQUIRED'
      and ledger.mechanism_version =
        'MAYEL_LIVE_MARKET_REVALIDATION_V1_2026_09_06'
      and ledger.status = 'OPEN'
      and ledger.recovery_class = 'AUTO_RECOVERABLE'
      and ledger.retry_safety = 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
      and (ledger.lease_expires_at is null
        or ledger.lease_expires_at <= pg_catalog.clock_timestamp())
      and plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.source_context = 'LIVE_LISTING_REVALIDATION'
      and plan.status in ('ACTIVE', 'COMPLETED')
      and (p_plan_id is null or plan.id = p_plan_id)
      and (
        (plan.status = 'ACTIVE' and exists (
          select 1
          from public.marketplace_product_research_query_tasks task
          where task.plan_id = plan.id
            and task.marketplace_account_key = p_marketplace_account_key
            and task.marketplace = 'EBAY_US'
            and task.status = 'PENDING'
        ))
        or
        (plan.status = 'COMPLETED' and exists (
          select 1
          from public.marketplace_product_research_query_tasks task
          where task.plan_id = plan.id
            and task.marketplace_account_key = p_marketplace_account_key
            and task.marketplace = 'EBAY_US'
            and task.status = 'PROCESSED'
            and task.capture_batch_id is not null
        ))
      )
    order by plan.created_at, plan.id
    for update of ledger skip locked
    limit 1
  ), claimed_row as (
    update public.seller_os_operational_learning_ledger_v1 ledger
    set lease_owner = p_worker_id,
        lease_expires_at = pg_catalog.clock_timestamp() +
          pg_catalog.make_interval(secs => p_lease_seconds),
        recovery_attempt_count = ledger.recovery_attempt_count + 1,
        recovery_outcome = 'CLAIMED',
        evidence = ledger.evidence || pg_catalog.jsonb_build_object(
          'workerAcquisition', p_worker_capability || pg_catalog.jsonb_build_object(
            'workerId', p_worker_id,
            'claimedAt', pg_catalog.clock_timestamp(),
            'claimState', 'CLAIMED'
          )
        ),
        last_observed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    from candidate
    where ledger.id = candidate.ledger_id
    returning ledger.id, candidate.plan_id, ledger.lease_expires_at
  )
  select true, claimed_row.id, claimed_row.plan_id,
    claimed_row.lease_expires_at
  from claimed_row;

  if not found then
    return query select false, null::uuid, null::uuid, null::timestamptz;
  end if;
end;
$$;

revoke all on function public.claim_next_live_listing_product_research_v2(
  text, text, jsonb, uuid, integer
) from public, anon, authenticated;
grant execute on function public.claim_next_live_listing_product_research_v2(
  text, text, jsonb, uuid, integer
) to service_role;

comment on function public.claim_next_live_listing_product_research_v2(
  text, text, jsonb, uuid, integer
) is 'Claims either a pending LIVE Product Research query or its exact unfinished downstream continuation. Completed captures are reused and never replayed. No marketplace writes.';

notify pgrst, 'reload schema';
