-- Browser worker liveness is operational capability evidence, not commercial
-- output. Existing Product Research capture batches and Luna Shipping traces
-- cannot represent an idle-but-observable worker without falsifying their
-- business semantics. This bounded current-state authority therefore stores
-- only the latest independently proven heartbeat for each existing worker.

create table public.seller_os_browser_worker_capabilities_v1 (
  marketplace_account_key text not null,
  capability_id text not null,
  worker_family text not null,
  worker_instance_id text not null,
  heartbeat_receipt_id uuid not null,
  heartbeat_source text not null,
  physical_connection text not null,
  worker_state text not null,
  extension_identity_match boolean not null,
  extension_version text not null,
  observed_at timestamptz not null,
  fresh_until timestamptz not null,
  last_heartbeat_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (marketplace_account_key, capability_id),
  constraint seller_os_browser_worker_capability_id_check check (
    capability_id in (
      'PRODUCT_RESEARCH_EXTENSION',
      'PRODUCT_RESEARCH_BROWSER_WORKER',
      'LUNA_SHIPPING'
    )
  ),
  constraint seller_os_browser_worker_family_check check (
    worker_family in ('PRODUCT_RESEARCH', 'LUNA_SHIPPING')
  ),
  constraint seller_os_browser_worker_family_capability_check check (
    (worker_family = 'PRODUCT_RESEARCH' and capability_id in (
      'PRODUCT_RESEARCH_EXTENSION', 'PRODUCT_RESEARCH_BROWSER_WORKER'))
    or (worker_family = 'LUNA_SHIPPING' and capability_id = 'LUNA_SHIPPING')
  ),
  constraint seller_os_browser_worker_source_check check (
    heartbeat_source = 'INDEPENDENT_WORKER_LIVENESS'
  ),
  constraint seller_os_browser_worker_connection_check check (
    physical_connection = 'PROVEN_AVAILABLE'
  ),
  constraint seller_os_browser_worker_state_check check (
    worker_state in ('AVAILABLE', 'IDLE', 'WORKING')
  ),
  constraint seller_os_browser_worker_identity_check check (
    extension_identity_match = true
    and char_length(extension_version) between 1 and 40
    and char_length(worker_instance_id) between 8 and 160
  ),
  constraint seller_os_browser_worker_freshness_check check (
    fresh_until > observed_at
    and fresh_until <= observed_at + interval '5 minutes'
    and last_heartbeat_at = observed_at
  )
);

create index seller_os_browser_worker_capabilities_fresh_idx
  on public.seller_os_browser_worker_capabilities_v1(
    marketplace_account_key, fresh_until desc
  );

alter table public.seller_os_browser_worker_capabilities_v1
  enable row level security;
alter table public.seller_os_browser_worker_capabilities_v1
  force row level security;
revoke all on table public.seller_os_browser_worker_capabilities_v1
  from public, anon, authenticated, service_role;
grant select, insert, update
  on table public.seller_os_browser_worker_capabilities_v1 to service_role;

comment on table public.seller_os_browser_worker_capabilities_v1 is
  'Bounded current liveness authority for existing authenticated browser workers. Never stores or substitutes Product Research or Shipping business output.';

create or replace function public.record_seller_os_browser_worker_heartbeat_v1(
  p_marketplace_account_key text,
  p_worker_family text,
  p_worker_instance_id text,
  p_extension_version text,
  p_extension_identity_match boolean,
  p_worker_state text,
  p_observed_at timestamptz,
  p_ttl_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt_id uuid := extensions.gen_random_uuid();
  v_fresh_until timestamptz;
  v_capability_ids text[];
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(trim(coalesce(p_marketplace_account_key, '')))
        not between 8 and 160
      or p_worker_family not in ('PRODUCT_RESEARCH', 'LUNA_SHIPPING')
      or char_length(trim(coalesce(p_worker_instance_id, '')))
        not between 8 and 160
      or char_length(trim(coalesce(p_extension_version, '')))
        not between 1 and 40
      or p_extension_identity_match is distinct from true
      or p_worker_state not in ('AVAILABLE', 'IDLE', 'WORKING')
      or p_observed_at is null
      or p_observed_at < clock_timestamp() - interval '2 minutes'
      or p_observed_at > clock_timestamp() + interval '1 minute'
      or p_ttl_seconds not between 120 and 300 then
    raise exception 'SELLER_OS_BROWSER_WORKER_HEARTBEAT_INVALID';
  end if;

  v_fresh_until := p_observed_at + make_interval(secs => p_ttl_seconds);
  v_capability_ids := case p_worker_family
    when 'PRODUCT_RESEARCH' then array[
      'PRODUCT_RESEARCH_EXTENSION', 'PRODUCT_RESEARCH_BROWSER_WORKER']
    else array['LUNA_SHIPPING'] end;

  insert into public.seller_os_browser_worker_capabilities_v1(
    marketplace_account_key, capability_id, worker_family,
    worker_instance_id, heartbeat_receipt_id, heartbeat_source,
    physical_connection, worker_state, extension_identity_match,
    extension_version, observed_at, fresh_until, last_heartbeat_at
  )
  select p_marketplace_account_key, capability_id, p_worker_family,
    p_worker_instance_id, v_receipt_id, 'INDEPENDENT_WORKER_LIVENESS',
    'PROVEN_AVAILABLE', p_worker_state, true,
    trim(p_extension_version), p_observed_at, v_fresh_until, p_observed_at
  from unnest(v_capability_ids) capability_id
  on conflict (marketplace_account_key, capability_id) do update set
    worker_family = excluded.worker_family,
    worker_instance_id = excluded.worker_instance_id,
    heartbeat_receipt_id = excluded.heartbeat_receipt_id,
    heartbeat_source = excluded.heartbeat_source,
    physical_connection = excluded.physical_connection,
    worker_state = excluded.worker_state,
    extension_identity_match = excluded.extension_identity_match,
    extension_version = excluded.extension_version,
    observed_at = excluded.observed_at,
    fresh_until = excluded.fresh_until,
    last_heartbeat_at = excluded.last_heartbeat_at,
    updated_at = clock_timestamp()
  where excluded.observed_at >=
    public.seller_os_browser_worker_capabilities_v1.observed_at;

  return jsonb_build_object(
    'heartbeatReceiptId', v_receipt_id,
    'heartbeatSource', 'INDEPENDENT_WORKER_LIVENESS',
    'workerFamily', p_worker_family,
    'workerState', p_worker_state,
    'capabilityIds', to_jsonb(v_capability_ids),
    'observedAt', p_observed_at,
    'freshUntil', v_fresh_until,
    'capabilityFresh', true,
    'marketplaceWrites', 0
  );
end;
$$;

revoke all on function public.record_seller_os_browser_worker_heartbeat_v1(
  text, text, text, text, boolean, text, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.record_seller_os_browser_worker_heartbeat_v1(
  text, text, text, text, boolean, text, timestamptz, integer
) to service_role;

comment on function public.record_seller_os_browser_worker_heartbeat_v1(
  text, text, text, text, boolean, text, timestamptz, integer
) is 'Persists a bounded independent liveness heartbeat after a fresh extension identity handshake. It never records commercial output or performs marketplace writes.';

-- Quick Pick plans remain in the existing Product Research authority. These
-- columns add the same bounded lease semantics already used by LIVE plans;
-- they do not create a second queue or task runtime.
alter table public.marketplace_product_research_query_plans
  add column worker_lease_owner text null,
  add column worker_lease_expires_at timestamptz null,
  add column worker_claim_count integer not null default 0,
  add column worker_last_claimed_at timestamptz null,
  add column worker_capability_receipt_id uuid null,
  add column worker_last_release_code text null,
  add column worker_last_result jsonb not null default '{}'::jsonb,
  add constraint marketplace_product_research_worker_lease_check check (
    (worker_lease_owner is null and worker_lease_expires_at is null)
    or (char_length(worker_lease_owner) between 8 and 160
      and worker_lease_expires_at is not null)
  ),
  add constraint marketplace_product_research_worker_claim_count_check
    check (worker_claim_count >= 0),
  add constraint marketplace_product_research_worker_release_code_check
    check (worker_last_release_code is null
      or worker_last_release_code ~ '^[A-Z0-9_]{3,180}$');

create index marketplace_product_research_quick_pick_claim_idx
  on public.marketplace_product_research_query_plans(
    marketplace_account_key, marketplace, created_at, worker_lease_expires_at
  ) where source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
    and status = 'ACTIVE';

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
    and plan.status in ('ACTIVE', 'COMPLETED')
    and (p_plan_id is null or plan.id = p_plan_id)
    and (
      (plan.source_context = 'LIVE_LISTING_REVALIDATION'
        and ledger.marketplace_account_key = p_marketplace_account_key
        and ledger.invariant_code = 'LIVE_LISTING_RESEARCH_REQUIRED'
        and ledger.mechanism_version =
          'MAYEL_LIVE_MARKET_REVALIDATION_V1_2026_09_06'
        and ledger.status = 'OPEN'
        and ledger.recovery_class = 'AUTO_RECOVERABLE'
        and ledger.retry_safety = 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
        and (ledger.lease_expires_at is null
          or ledger.lease_expires_at <= clock_timestamp()))
      or
      (plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
        and plan.status = 'ACTIVE'
        and (plan.worker_lease_expires_at is null
          or plan.worker_lease_expires_at <= clock_timestamp()))
    )
    and (
      (plan.status = 'ACTIVE' and exists (
        select 1 from public.marketplace_product_research_query_tasks task
        where task.plan_id = plan.id
          and task.marketplace_account_key = p_marketplace_account_key
          and task.marketplace = 'EBAY_US'
          and task.status = 'PENDING'))
      or
      (plan.source_context = 'LIVE_LISTING_REVALIDATION'
        and plan.status = 'COMPLETED' and exists (
          select 1 from public.marketplace_product_research_query_tasks task
          where task.plan_id = plan.id
            and task.marketplace_account_key = p_marketplace_account_key
            and task.marketplace = 'EBAY_US'
            and task.status = 'PROCESSED'
            and task.capture_batch_id is not null))
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
    set recovery_outcome = 'STILL_VIOLATED',
        evidence = ledger.evidence || jsonb_build_object(
          'workerAcquisition',
          coalesce(ledger.evidence -> 'workerAcquisition', '{}'::jsonb) ||
            jsonb_build_object('claimState', 'RELEASED_RETRY_SAFE',
              'lastErrorCode', p_error_code,
              'releasedAt', clock_timestamp())),
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
        worker_last_result = jsonb_build_object(
          'state', 'RELEASED_RETRY_SAFE',
          'errorCode', p_error_code,
          'releasedAt', clock_timestamp(),
          'retrySafety', 'SAFE_IDEMPOTENT_RUNTIME_RESUME'),
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

revoke all on function public.claim_next_live_listing_product_research_v2(
  text, text, jsonb, uuid, integer
) from public, anon, authenticated;
grant execute on function public.claim_next_live_listing_product_research_v2(
  text, text, jsonb, uuid, integer
) to service_role;
revoke all on function public.release_live_listing_product_research_v1(
  text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.release_live_listing_product_research_v1(
  text, uuid, text, text
) to service_role;
revoke all on function public.complete_quick_pick_product_research_claim_v1(
  text, uuid, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_quick_pick_product_research_claim_v1(
  text, uuid, text, uuid, timestamptz
) to service_role;

comment on function public.claim_next_live_listing_product_research_v2(
  text, text, jsonb, uuid, integer
) is 'Single existing Product Research claimer for LIVE_LISTING_REVALIDATION and QUICK_PICK_RESEARCH_REQUIRED. Requires durable independent worker liveness, preserves account single-flight and performs zero marketplace writes.';
comment on function public.release_live_listing_product_research_v1(
  text, uuid, text, text
) is 'Releases either legitimate Product Research context retry-safely without deleting its plan or task.';
comment on function public.complete_quick_pick_product_research_claim_v1(
  text, uuid, text, uuid, timestamptz
) is 'Closes a Quick Pick browser lease only after the existing Product Research capture receipt is durably linked and read back.';

notify pgrst, 'reload schema';
