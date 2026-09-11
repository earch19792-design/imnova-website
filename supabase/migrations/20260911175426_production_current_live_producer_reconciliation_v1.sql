-- Targeted CURRENT LIVE producer subset, not a historical replay.
-- Sources: 20260713079000, 20260906224852, 20260908232657.
-- Account pinned; no credentials, default account backfill, data seed, RLS or table ACL changes.
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.ebay_active_listings add column if not exists sync_run_id uuid;
create unique index if not exists production_current_live_sync_key_unique_v1 on public.ebay_active_listings(sync_key);
alter table public.ebay_active_listing_sync_state
 add column if not exists current_live_evidence_digest text,
 add column if not exists current_live_receipt_run_id uuid;
-- Manual-pilot operation state for the read-only eBay active-listing sync.
-- This prevents concurrent operator runs and exposes last start/success/error.

alter table public.ebay_active_listing_sync_state
  add column if not exists active_run_id uuid null,
  add column if not exists active_run_started_at timestamptz null,
  add column if not exists active_run_lease_expires_at timestamptz null,
  add column if not exists last_success_run_id uuid null,
  add column if not exists last_success_at timestamptz null,
  add column if not exists last_error_run_id uuid null,
  add column if not exists last_error_at timestamptz null,
  add column if not exists last_error_code text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_active_listing_sync_state_lease_check'
      and conrelid = 'public.ebay_active_listing_sync_state'::regclass
  ) then
    alter table public.ebay_active_listing_sync_state
      add constraint ebay_active_listing_sync_state_lease_check check (
        (
          active_run_id is null
          and active_run_started_at is null
          and active_run_lease_expires_at is null
        )
        or (
          active_run_id is not null
          and active_run_started_at is not null
          and active_run_lease_expires_at is not null
          and active_run_lease_expires_at > active_run_started_at
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_active_listing_sync_state_error_code_check'
      and conrelid = 'public.ebay_active_listing_sync_state'::regclass
  ) then
    alter table public.ebay_active_listing_sync_state
      add constraint ebay_active_listing_sync_state_error_code_check check (
        last_error_code is null
        or last_error_code ~ '^[A-Z0-9_]{3,100}$'
      );
  end if;
end;
$$;

create or replace function public.claim_ebay_active_listing_sync_run(
  p_account_key text,
  p_run_id uuid,
  p_lease_seconds integer default 180
)
returns table(
  claimed boolean,
  active_run_id uuid,
  active_run_started_at timestamptz,
  active_run_lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed boolean := false;
  v_state public.ebay_active_listing_sync_state%rowtype;
begin
  if p_account_key is null
    or p_account_key is distinct from 'imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_run_id is null
    or p_lease_seconds is null
    or p_lease_seconds is null
    or p_lease_seconds not between 60 and 600 then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_CLAIM_INVALID';
  end if;

  insert into public.ebay_active_listing_sync_state as state (
    account_key, active_run_id, active_run_started_at,
    active_run_lease_expires_at
  ) values (
    p_account_key, p_run_id, now(),
    now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (account_key) do update set
    active_run_id = excluded.active_run_id,
    active_run_started_at = excluded.active_run_started_at,
    active_run_lease_expires_at = excluded.active_run_lease_expires_at
  where (state.active_run_id is null or state.active_run_lease_expires_at <= now())
    and (state.current_live_next_retry_at is null or state.current_live_next_retry_at <= now())
    and (state.last_certified_live_fresh_until is null or state.last_certified_live_fresh_until <= now())
  returning true into v_claimed;

  select * into v_state
  from public.ebay_active_listing_sync_state state
  where state.account_key = p_account_key;

  return query select
    coalesce(v_claimed,false),
    v_state.active_run_id,
    v_state.active_run_started_at,
    v_state.active_run_lease_expires_at;
end;
$$;

create or replace function public.finish_ebay_active_listing_sync_run(
  p_account_key text,
  p_run_id uuid,
  p_success boolean,
  p_error_code text default null
)
returns table(
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.ebay_active_listing_sync_state%rowtype;
begin
  if p_account_key is null
    or p_account_key is distinct from 'imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_run_id is null
    or p_success is null
    or (p_success and p_error_code is not null)
    or (
      not p_success
      and (
        p_error_code is null
        or p_error_code !~ '^[A-Z0-9_]{3,100}$'
      )
    ) then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_FINISH_INVALID';
  end if;

  select * into v_state
  from public.ebay_active_listing_sync_state state
  where state.account_key = p_account_key
    and state.active_run_id = p_run_id
  for update;
  if not found then
    select * into v_state from public.ebay_active_listing_sync_state state
    where state.account_key=p_account_key and state.active_run_id is null
      and ((p_success and state.last_success_run_id=p_run_id)
        or (not p_success and state.last_error_run_id=p_run_id and state.last_error_code=p_error_code));
    if found then return query select v_state.last_success_at,v_state.last_error_at,v_state.last_error_code; return; end if;
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_LEASE_NOT_OWNED';
  end if;

  update public.ebay_active_listing_sync_state state
  set active_run_id = null,
      active_run_started_at = null,
      active_run_lease_expires_at = null,
      last_success_run_id = case
        when p_success then p_run_id else state.last_success_run_id
      end,
      last_success_at = case
        when p_success then now() else state.last_success_at
      end,
      last_error_run_id = case
        when p_success then state.last_error_run_id else p_run_id
      end,
      last_error_at = case
        when p_success then state.last_error_at else now()
      end,
      last_error_code = case
        when p_success then state.last_error_code else p_error_code
      end
  where state.account_key = p_account_key
  returning state.* into v_state;

  return query select
    v_state.last_success_at,
    v_state.last_error_at,
    v_state.last_error_code;
end;
$$;

revoke all on function public.claim_ebay_active_listing_sync_run(
  text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.claim_ebay_active_listing_sync_run(
  text, uuid, integer
) to service_role;
revoke all on function public.finish_ebay_active_listing_sync_run(
  text, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.finish_ebay_active_listing_sync_run(
  text, uuid, boolean, text
) to service_role;


create or replace function public.record_ebay_current_live_authority_success_v1(
  p_account_key text,
  p_run_id uuid,
  p_scope_id text,
  p_observed_at timestamptz,
  p_fresh_until timestamptz,
  p_item_ids jsonb,
  p_rows jsonb
)
returns table(
  applied boolean,
  certified_live_count integer,
  authoritative_zero boolean,
  stale_rows_ended integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_count integer;
  v_digest text;
  v_ended integer := 0;
begin
  if p_account_key is distinct from 'imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_run_id is null
    or p_scope_id is null
    or p_scope_id !~ '^current-live:sha256:[0-9a-f]{64}$'
    or p_observed_at is null
    or p_observed_at > clock_timestamp() + interval '5 minutes'
    or p_observed_at < clock_timestamp() - interval '20 minutes'
    or p_fresh_until is null
    or p_fresh_until <= p_observed_at
    or p_fresh_until > p_observed_at + interval '60 minutes'
    or jsonb_typeof(p_item_ids) is distinct from 'array'
    or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'CURRENT_LIVE_AUTHORITY_SUCCESS_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_key, 417));
  v_count := jsonb_array_length(p_item_ids);
  if v_count > 5000
    or jsonb_array_length(p_rows) <> v_count
    or (
      select count(distinct value #>> '{}')
      from jsonb_array_elements(p_item_ids)
    ) <> v_count
    or exists (
      select 1 from jsonb_array_elements(p_item_ids) item(value)
      where jsonb_typeof(item.value) <> 'string'
        or item.value #>> '{}' !~ '^[0-9]{9,20}$'
    )
    or exists (
      select 1 from jsonb_array_elements(p_rows) row(value)
      where jsonb_typeof(row.value) <> 'object'
        or (row.value - array[
          'itemId', 'title', 'sku', 'quantity', 'price', 'currency',
          'variationKey', 'primaryImageUrl', 'observedAt'
        ]::text[]) <> '{}'::jsonb
        or not (row.value ?& array[
          'itemId', 'title', 'sku', 'quantity', 'price', 'currency',
          'variationKey', 'primaryImageUrl', 'observedAt'
        ]::text[])
        or coalesce(row.value ->> 'itemId', '') !~ '^[0-9]{9,20}$'
        or nullif(trim(row.value ->> 'title'), '') is null
        or char_length(row.value ->> 'title') > 1000
        or row.value ->> 'title' ~ '[[:cntrl:]]'
        or (
          row.value -> 'sku' <> 'null'::jsonb and (
            char_length(row.value ->> 'sku') not between 1 and 80
            or row.value ->> 'sku' ~ '[[:cntrl:]]'
          )
        )
        or (
          row.value -> 'variationKey' <> 'null'::jsonb and (
            jsonb_typeof(row.value -> 'variationKey') <> 'string'
            or char_length(row.value ->> 'variationKey') not between 1 and 120
            or row.value ->> 'variationKey' <>
              trim(row.value ->> 'variationKey')
            or row.value ->> 'variationKey' ~ '[[:cntrl:]]'
          )
        )
        or (
          row.value -> 'quantity' <> 'null'::jsonb
          and coalesce(row.value ->> 'quantity', '') !~ '^[0-9]+$'
        )
        or (
          row.value -> 'price' <> 'null'::jsonb
          and coalesce(row.value ->> 'price', '')
            !~ '^[0-9]+([.][0-9]{1,4})?$'
        )
        or coalesce(row.value ->> 'currency', '') !~ '^[A-Z]{3}$'
        or coalesce(row.value ->> 'observedAt', '')
          !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
        or (row.value ->> 'observedAt')::timestamptz
          is distinct from p_observed_at
    )
    or (
      select array_agg(value #>> '{}' order by value #>> '{}')
      from jsonb_array_elements(p_item_ids)
    ) is distinct from (
      select array_agg(value ->> 'itemId' order by value ->> 'itemId')
      from jsonb_array_elements(p_rows)
    ) then
    raise exception 'CURRENT_LIVE_AUTHORITY_SUCCESS_COHORT_INVALID';
  end if;

  v_digest := encode(sha256(convert_to(jsonb_build_array(p_account_key,p_scope_id,p_observed_at,p_fresh_until,p_item_ids,p_rows)::text,'UTF8')),'hex');
  if exists(select 1 from public.ebay_active_listing_sync_state s where s.account_key=p_account_key
      and s.current_live_evidence_digest=v_digest and s.current_live_receipt_run_id=p_run_id) then
    return query select false,v_count,v_count=0,0; return;
  end if;
  if exists(select 1 from public.ebay_active_listing_sync_state s where s.account_key=p_account_key
      and s.current_live_receipt_run_id=p_run_id) then raise exception 'CURRENT_LIVE_REPLAY_EVIDENCE_CONFLICT'; end if;
  if not exists(select 1 from public.ebay_active_listing_sync_state s where s.account_key=p_account_key
      and s.active_run_id=p_run_id and s.active_run_lease_expires_at>clock_timestamp()) then
    raise exception 'CURRENT_LIVE_PRODUCER_LEASE_REQUIRED';
  end if;
  if exists(select 1 from public.ebay_active_listing_sync_state s where s.account_key=p_account_key
      and s.last_certified_live_observed_at>p_observed_at) then raise exception 'CURRENT_LIVE_OLDER_EVIDENCE_DENIED'; end if;
  insert into public.ebay_active_listings as target (
    source, account_key, sync_key, sync_run_id, sync_generation,
    ebay_item_id, listing_status, title, ebay_sku,
    ebay_quantity, ebay_price, currency, last_ebay_sync_at,
    raw_payload, updated_at
  )
  select
    'EBAY_TRADING_GET_MY_EBAY_SELLING', p_account_key,
    concat('EBAY_TRADING_GET_MY_EBAY_SELLING:', p_account_key, ':',
      row.value ->> 'itemId'),
    p_run_id, 0, row.value ->> 'itemId', 'active',
    row.value ->> 'title', nullif(row.value ->> 'sku', ''),
    case when row.value -> 'quantity' = 'null'::jsonb then null
      else (row.value ->> 'quantity')::integer end,
    case when row.value -> 'price' = 'null'::jsonb then null
      else (row.value ->> 'price')::numeric end,
    row.value ->> 'currency', p_observed_at,
    jsonb_build_object(
      'source', 'EBAY_TRADING_GET_MY_EBAY_SELLING',
      'marketplaceId', 'EBAY_US',
      'listingState', 'ACTIVE',
      'variationKey', row.value -> 'variationKey',
      'primaryImageUrl', row.value -> 'primaryImageUrl',
      'observedAt', p_observed_at,
      'currentLiveScopeId', p_scope_id,
      'currentLiveAuthorityVersion',
        'SELLER_OS_CURRENT_LIVE_AUTHORITY_RECOVERY_V1'
    ), p_observed_at
  from jsonb_array_elements(p_rows) row(value)
  on conflict (sync_key) do update set
    sync_run_id = excluded.sync_run_id,
    listing_status = excluded.listing_status,
    title = excluded.title,
    ebay_sku = excluded.ebay_sku,
    ebay_quantity = excluded.ebay_quantity,
    ebay_price = excluded.ebay_price,
    currency = excluded.currency,
    last_ebay_sync_at = excluded.last_ebay_sync_at,
    raw_payload = excluded.raw_payload,
    updated_at = excluded.updated_at;

  update public.ebay_active_listings listing
  set listing_status = 'ended', updated_at = p_observed_at,
      raw_payload = listing.raw_payload || jsonb_build_object(
        'endedByCurrentLiveScopeId', p_scope_id,
        'endedByCurrentLiveObservedAt', p_observed_at
      )
  where listing.account_key = p_account_key
    and listing.source = 'EBAY_TRADING_GET_MY_EBAY_SELLING'
    and listing.listing_status = 'active'
    and not (p_item_ids ? listing.ebay_item_id);
  get diagnostics v_ended = row_count;

  insert into public.ebay_active_listing_sync_state as state (
    account_key, current_live_source_state, current_live_last_attempt_at,
    current_live_next_retry_at, current_live_last_error_code,
    last_certified_live_scope_id, last_certified_live_item_ids,
    last_certified_live_count, last_certified_live_observed_at,
    last_certified_live_fresh_until,
    last_certified_live_source_authority
  ) values (
    p_account_key, 'CURRENT_FRESH', clock_timestamp(), null, null,
    p_scope_id, p_item_ids, v_count, p_observed_at, p_fresh_until,
    'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION'
  )
  on conflict (account_key) do update set
    current_live_source_state = excluded.current_live_source_state,
    current_live_last_attempt_at = excluded.current_live_last_attempt_at,
    current_live_next_retry_at = null,
    current_live_last_error_code = null,
    last_certified_live_scope_id = excluded.last_certified_live_scope_id,
    last_certified_live_item_ids = excluded.last_certified_live_item_ids,
    last_certified_live_count = excluded.last_certified_live_count,
    last_certified_live_observed_at =
      excluded.last_certified_live_observed_at,
    last_certified_live_fresh_until = excluded.last_certified_live_fresh_until,
    last_certified_live_source_authority =
      excluded.last_certified_live_source_authority;

  update public.ebay_active_listing_sync_state set current_live_evidence_digest=v_digest,
    current_live_receipt_run_id=p_run_id where account_key=p_account_key;
  return query select true, v_count, v_count = 0, v_ended;
end;
$function$;

revoke all on function public.record_ebay_current_live_authority_success_v1(
  text, uuid, text, timestamptz, timestamptz, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.record_ebay_current_live_authority_success_v1(
  text, uuid, text, timestamptz, timestamptz, jsonb, jsonb
) to service_role;


create or replace function public.record_ebay_current_live_authority_failure_v1(
  p_account_key text,
  p_run_id uuid,
  p_error_code text,
  p_next_retry_at timestamptz
)
returns table(
  recorded boolean,
  preserved_live_count integer,
  last_certified_observed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if p_account_key is distinct from 'imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_run_id is null
    or p_error_code is null
    or p_error_code !~ '^[A-Z0-9_]{3,160}$'
    or p_next_retry_at is null
    or p_next_retry_at < clock_timestamp() + interval '14 minutes'
    or p_next_retry_at > clock_timestamp() + interval '24 hours' then
    raise exception 'CURRENT_LIVE_AUTHORITY_FAILURE_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_account_key,417));
  if not exists(select 1 from public.ebay_active_listing_sync_state s where s.account_key=p_account_key
      and s.active_run_id=p_run_id and s.active_run_lease_expires_at>clock_timestamp()) then
    raise exception 'CURRENT_LIVE_PRODUCER_LEASE_REQUIRED';
  end if;
  insert into public.ebay_active_listing_sync_state as state (
    account_key, current_live_source_state, current_live_last_attempt_at,
    current_live_next_retry_at, current_live_last_error_code
  ) values (
    p_account_key, 'CURRENT_UNAVAILABLE', clock_timestamp(),
    p_next_retry_at, p_error_code
  )
  on conflict (account_key) do update set
    current_live_source_state = excluded.current_live_source_state,
    current_live_last_attempt_at = excluded.current_live_last_attempt_at,
    current_live_next_retry_at = excluded.current_live_next_retry_at,
    current_live_last_error_code = excluded.current_live_last_error_code;

  return query
  select true, state.last_certified_live_count,
    state.last_certified_live_observed_at
  from public.ebay_active_listing_sync_state state
  where state.account_key = p_account_key;
end;
$function$;

revoke all on function public.record_ebay_current_live_authority_success_v1(
  text, uuid, text, timestamptz, timestamptz, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.record_ebay_current_live_authority_failure_v1(
  text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_ebay_current_live_authority_success_v1(
  text, uuid, text, timestamptz, timestamptz, jsonb, jsonb
) to service_role;
grant execute on function public.record_ebay_current_live_authority_failure_v1(
  text, uuid, text, timestamptz
) to service_role;


notify pgrst, 'reload schema';

-- Fixed, read-only dependency attestation for the normal production intake.
create or replace function public.get_production_stock_producer_readiness_v1()
returns jsonb language sql security invoker set search_path=pg_catalog,public,pg_temp as $function$
 select jsonb_build_object('missing',coalesce(jsonb_agg(name order by ordinal) filter(where missing),'[]'::jsonb))
 from (values
 (1,'public.claim_ebay_active_listing_sync_run',to_regprocedure('public.claim_ebay_active_listing_sync_run(text,uuid,integer)') is null),
 (2,'public.record_ebay_current_live_authority_success_v1',to_regprocedure('public.record_ebay_current_live_authority_success_v1(text,uuid,text,timestamptz,timestamptz,jsonb,jsonb)') is null),
 (3,'public.record_ebay_current_live_authority_failure_v1',to_regprocedure('public.record_ebay_current_live_authority_failure_v1(text,uuid,text,timestamptz)') is null),
 (4,'public.finish_ebay_active_listing_sync_run',to_regprocedure('public.finish_ebay_active_listing_sync_run(text,uuid,boolean,text)') is null),
 (5,'public.resolve_relist_supplier_handoff_v1',to_regprocedure('public.resolve_relist_supplier_handoff_v1(text,text,boolean)') is null),
 (6,'public.ebay_luna_opportunity_queue',to_regclass('public.ebay_luna_opportunity_queue') is null),
 (7,'public.ebay_listing_packages',to_regclass('public.ebay_listing_packages') is null),
 (8,'public.market_radar_latest_variants',to_regclass('public.market_radar_latest_variants') is null),
 (9,'public.seller_os_luna_linkage_review_candidates',to_regclass('public.seller_os_luna_linkage_review_candidates') is null),
 (10,'public.ensure_seller_os_luna_stock_check_job_v1',to_regprocedure('public.ensure_seller_os_luna_stock_check_job_v1(text,text,text,text,timestamptz,timestamptz,timestamptz,text)') is null),
 (11,'public.claim_seller_os_luna_stock_check_job_v1',to_regprocedure('public.claim_seller_os_luna_stock_check_job_v1(text,text,timestamptz,integer)') is null),
 (12,'public.verify_seller_os_luna_stock_check_lease_v1',to_regprocedure('public.verify_seller_os_luna_stock_check_lease_v1(text,text,timestamptz)') is null),
 (13,'public.ensure_seller_os_luna_stock_observation_v1',to_regprocedure('public.ensure_seller_os_luna_stock_observation_v1(text,text,text,text,text,text,text,text,text,integer,text,text,boolean,integer,text,text,text,integer,timestamptz,integer,text[],text,timestamptz)') is null),
 (14,'public.complete_seller_os_luna_stock_check_job_v1',to_regprocedure('public.complete_seller_os_luna_stock_check_job_v1(text,text,text,timestamptz)') is null)
 ) required(ordinal,name,missing);
$function$;
revoke all on function public.get_production_stock_producer_readiness_v1() from public,anon,authenticated;
grant execute on function public.get_production_stock_producer_readiness_v1() to service_role;
notify pgrst,'reload schema';

-- Exact stock repository control-plane fields; existing rows are not backfilled.
alter table public.seller_os_luna_stock_check_jobs
 add column if not exists contract_version text,
 add column if not exists due_at timestamptz,
 add column if not exists lease_owner text,
 add column if not exists lease_expires_at timestamptz,
 add column if not exists created_at timestamptz,
 add column if not exists updated_at timestamptz;
alter table public.seller_os_luna_stock_check_jobs alter column created_at set default clock_timestamp(), alter column updated_at set default clock_timestamp();
create unique index if not exists production_stock_job_logical_grain_v1 on public.seller_os_luna_stock_check_jobs(linkage_id,observation_window_start,contract_version);
alter table public.seller_os_luna_stock_observations add column if not exists contract_version text, add column if not exists created_at timestamptz;
alter table public.seller_os_luna_stock_observations alter column contract_version set default 'SELLER_OS_LUNA_STOCK_OBSERVATION_V1', alter column created_at set default clock_timestamp();
create or replace function public.ensure_seller_os_luna_stock_check_job_v1(
  p_stock_check_job_id text,
  p_linkage_id text,
  p_account_key text,
  p_ebay_item_id text,
  p_observation_window_start timestamptz,
  p_observation_window_end timestamptz,
  p_due_at timestamptz,
  p_contract_version text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.seller_os_luna_stock_check_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role'
    or coalesce(p_stock_check_job_id,'') !~
      '^luna-stock-check-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_linkage_id,'') !~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'
    or p_account_key is distinct from 'imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
    or coalesce(p_ebay_item_id,'') !~ '^[0-9]{9,19}$'
    or p_observation_window_start is null
    or p_observation_window_end is null
    or p_observation_window_end <= p_observation_window_start
    or p_due_at is null
    or p_contract_version is distinct from 'SELLER_OS_LUNA_STOCK_OBSERVATION_V1' then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_INPUT_INVALID';
  end if;
  if not exists(select 1 from public.seller_os_luna_linkage_decisions d
    join public.ebay_active_listings a on a.account_key=d.account_key and a.ebay_item_id=d.ebay_item_id and a.ebay_sku=d.ebay_sku
    join public.ebay_active_listing_sync_state live on live.account_key=d.account_key
    where d.account_key=p_account_key and d.ebay_item_id=p_ebay_item_id and d.linkage_id=p_linkage_id
      and d.decision='APPROVE_EXACT_LINKAGE' and d.marketplace_id='EBAY_US' and a.listing_status='active'
      and d.decision_version=(select max(x.decision_version) from public.seller_os_luna_linkage_decisions x
        where x.account_key=d.account_key and x.ebay_item_id=d.ebay_item_id and x.marketplace_id=d.marketplace_id)
      and live.current_live_source_state='CURRENT_FRESH' and live.last_certified_live_fresh_until>clock_timestamp()
      and live.last_certified_live_item_ids ? p_ebay_item_id) then
    raise exception 'CURRENT_LIVE_CERTIFIED_LINKAGE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_linkage_id || ':' || p_observation_window_start::text || ':' ||
      p_contract_version,
    0
  ));
  select * into v_job
  from public.seller_os_luna_stock_check_jobs job
  where job.linkage_id = p_linkage_id
    and job.observation_window_start = p_observation_window_start
    and job.contract_version = p_contract_version
  for update;
  if found then
    if v_job.stock_check_job_id is distinct from p_stock_check_job_id
      or v_job.account_key is distinct from p_account_key
      or v_job.ebay_item_id is distinct from p_ebay_item_id
      or v_job.observation_window_end is distinct from p_observation_window_end then
      raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_IDENTITY_CONFLICT';
    end if;
    return v_job.stock_check_job_id;
  end if;
  insert into public.seller_os_luna_stock_check_jobs (
    stock_check_job_id, linkage_id, account_key, ebay_item_id,
    observation_window_start, observation_window_end, contract_version,
    workflow_state, attempt_count, due_at
  ) values (
    p_stock_check_job_id, p_linkage_id, p_account_key, p_ebay_item_id,
    p_observation_window_start, p_observation_window_end, p_contract_version,
    'NOT_STARTED', 0, p_due_at
  );
  return p_stock_check_job_id;
end;
$$;

create or replace function public.ensure_seller_os_luna_stock_observation_v1(
  p_observation_id text,
  p_stock_check_job_id text,
  p_linkage_id text,
  p_account_key text,
  p_ebay_item_id text,
  p_component_identity_id text,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_luna_sku text,
  p_supplier_quantity_required integer,
  p_observation_state text,
  p_source_status text,
  p_observed_availability boolean,
  p_observed_supplier_quantity integer,
  p_evidence_class text,
  p_evidence_digest text,
  p_acquisition_method text,
  p_attempt_number integer,
  p_observed_at timestamptz,
  p_maximum_age_seconds integer,
  p_limitations text[],
  p_lease_owner text,
  p_now timestamptz default clock_timestamp()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.seller_os_luna_stock_check_jobs%rowtype;
  v_observation public.seller_os_luna_stock_observations%rowtype;
begin
  if auth.role() is distinct from 'service_role'
    or coalesce(p_observation_id,'') !~
      '^luna-stock-observation-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_stock_check_job_id,'') !~
      '^luna-stock-check-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_component_identity_id,'') !~
      '^luna-component-identity-v1:sha256:[0-9a-f]{64}$'
    or length(trim(coalesce(p_lease_owner, ''))) not between 8 and 160
    or p_attempt_number is null
    or p_observed_at is null or p_observed_at > clock_timestamp()+interval '5 minutes'
    or length(coalesce(p_luna_product_id,'')) not between 1 and 100
    or length(coalesce(p_luna_sku,'')) not between 1 and 120
    or p_luna_product_id ~ '[[:cntrl:]]' or p_luna_sku ~ '[[:cntrl:]]'
    or (p_luna_variant_id is not null and (length(p_luna_variant_id) not between 1 and 100 or p_luna_variant_id ~ '[[:cntrl:]]'))
    or cardinality(coalesce(p_limitations,'{}'::text[]))>40 or array_position(p_limitations,null) is not null
    or not coalesce((p_source_status='AVAILABLE' and p_evidence_class='SUPPLIER_STATED'
        and p_observation_state in ('OBSERVED_IN_STOCK','OBSERVED_OUT_OF_STOCK','OBSERVED_QUANTITY','UNKNOWN'))
      or (p_source_status<>'AVAILABLE' and p_evidence_class='UNAVAILABLE' and p_observed_availability is null
        and p_observed_supplier_quantity is null and p_observation_state in ('SOURCE_UNAVAILABLE','OBSERVATION_FAILED','UNKNOWN')),false)
    or p_now is null then
    raise exception 'SELLER_OS_LUNA_STOCK_OBSERVATION_INPUT_INVALID';
  end if;
  select * into v_job
  from public.seller_os_luna_stock_check_jobs job
  where job.stock_check_job_id = p_stock_check_job_id and job.account_key='imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
  for update;
  if not found then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_NOT_FOUND';
  end if;
  if v_job.workflow_state <> 'IN_PROGRESS'
    or v_job.lease_owner is distinct from trim(p_lease_owner)
    or v_job.lease_expires_at <= p_now
    or v_job.attempt_count <> p_attempt_number
    or v_job.linkage_id is distinct from p_linkage_id
    or v_job.account_key is distinct from p_account_key
    or v_job.ebay_item_id is distinct from p_ebay_item_id then
    raise exception 'SELLER_OS_LUNA_STOCK_OBSERVATION_LEASE_OR_IDENTITY_INVALID';
  end if;
  if p_account_key is distinct from 'imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12' or not exists(
    select 1 from public.seller_os_luna_linkage_decisions d cross join lateral jsonb_array_elements(d.components) c
    where d.account_key=p_account_key and d.ebay_item_id=p_ebay_item_id and d.linkage_id=p_linkage_id
      and d.decision='APPROVE_EXACT_LINKAGE' and d.marketplace_id='EBAY_US'
      and d.decision_version=(select max(x.decision_version) from public.seller_os_luna_linkage_decisions x
        where x.account_key=d.account_key and x.ebay_item_id=d.ebay_item_id and x.marketplace_id=d.marketplace_id)
      and ('luna-component-identity-v1:sha256:'||encode(sha256(convert_to('['||to_json(c->>'lunaProductId')::text||','||coalesce(to_json(c->>'lunaVariantId')::text,'null')||','||to_json(c->>'lunaSku')::text||']','UTF8')),'hex'))=p_component_identity_id
      and c->>'lunaProductId'=p_luna_product_id and (c->>'lunaVariantId') is not distinct from p_luna_variant_id
      and c->>'lunaSku'=p_luna_sku and (c->>'supplierQuantityRequired')::integer=p_supplier_quantity_required) then
    raise exception 'STOCK_OBSERVATION_EXACT_LINKAGE_REQUIRED';
  end if;
  select * into v_observation
  from public.seller_os_luna_stock_observations observation
  where observation.stock_check_job_id = p_stock_check_job_id
    and observation.component_identity_id = p_component_identity_id
    and observation.attempt_number = p_attempt_number;
  if found then
    if v_observation.observation_id is distinct from p_observation_id
      or v_observation.linkage_id is distinct from p_linkage_id
      or v_observation.account_key is distinct from p_account_key
      or v_observation.ebay_item_id is distinct from p_ebay_item_id
      or v_observation.luna_product_id is distinct from p_luna_product_id
      or v_observation.luna_variant_id is distinct from p_luna_variant_id
      or v_observation.luna_sku is distinct from p_luna_sku
      or v_observation.supplier_quantity_required is distinct from
        p_supplier_quantity_required
      or v_observation.evidence_digest is distinct from p_evidence_digest
      or v_observation.evidence_class is distinct from p_evidence_class
      or v_observation.observation_state is distinct from p_observation_state
      or v_observation.source_status is distinct from p_source_status
      or v_observation.observed_availability is distinct from
        p_observed_availability
      or v_observation.observed_supplier_quantity is distinct from
        p_observed_supplier_quantity
      or v_observation.acquisition_method is distinct from p_acquisition_method
      or v_observation.observed_at is distinct from p_observed_at
      or v_observation.maximum_age_seconds is distinct from
        p_maximum_age_seconds
      or v_observation.limitations is distinct from
        coalesce(p_limitations, '{}'::text[]) then
      raise exception 'SELLER_OS_LUNA_STOCK_OBSERVATION_IDENTITY_CONFLICT';
    end if;
    return v_observation.observation_id;
  end if;
  insert into public.seller_os_luna_stock_observations (
    observation_id, stock_check_job_id, linkage_id, account_key, ebay_item_id,
    component_identity_id, luna_product_id, luna_variant_id, luna_sku,
    supplier_quantity_required, observation_state, source_status,
    observed_availability, observed_supplier_quantity, evidence_class,
    evidence_digest, acquisition_method, attempt_number, observed_at,
    maximum_age_seconds, limitations
  ) values (
    p_observation_id, p_stock_check_job_id, p_linkage_id, p_account_key,
    p_ebay_item_id, p_component_identity_id, p_luna_product_id,
    p_luna_variant_id, p_luna_sku, p_supplier_quantity_required,
    p_observation_state, p_source_status, p_observed_availability,
    p_observed_supplier_quantity, p_evidence_class, p_evidence_digest,
    p_acquisition_method, p_attempt_number, p_observed_at,
    p_maximum_age_seconds, coalesce(p_limitations, '{}'::text[])
  );
  return p_observation_id;
end;
$$;

create or replace function public.claim_seller_os_luna_stock_check_job_v1(
  p_stock_check_job_id text,
  p_worker_id text,
  p_now timestamptz default clock_timestamp(),
  p_lease_seconds integer default 180
)
returns table(
  claimed boolean,
  reason text,
  attempt_number integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.seller_os_luna_stock_check_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role'
    or coalesce(p_stock_check_job_id, '') !~
      '^luna-stock-check-v1:sha256:[0-9a-f]{64}$'
    or length(trim(coalesce(p_worker_id, ''))) not between 8 and 160
    or p_worker_id ~ '[[:cntrl:]]'
    or p_now is null
    or p_lease_seconds is null
    or p_lease_seconds not between 60 and 600 then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_CLAIM_INVALID';
  end if;

  select * into v_job
  from public.seller_os_luna_stock_check_jobs job
  where job.stock_check_job_id = p_stock_check_job_id and job.account_key='imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
  for update;
  if not found then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_NOT_FOUND';
  end if;
  if v_job.success_receipt_digest is not null then
    return query select false, 'SUCCESS_RECEIPT_PRESENT'::text,
      v_job.attempt_count, null::timestamptz;
    return;
  end if;
  if v_job.workflow_state = 'IN_PROGRESS'
    and v_job.lease_expires_at > p_now then
    return query select false, 'ACTIVE_LEASE'::text,
      v_job.attempt_count, v_job.lease_expires_at;
    return;
  end if;
  if v_job.workflow_state not in (
      'NOT_STARTED', 'RETRYABLE_FAILURE', 'IN_PROGRESS'
    ) then
    return query select false, 'WORKFLOW_STATE_BLOCKED'::text,
      v_job.attempt_count, null::timestamptz;
    return;
  end if;
  if v_job.due_at > p_now then
    return query select false, 'NOT_DUE'::text,
      v_job.attempt_count, null::timestamptz;
    return;
  end if;
  if v_job.attempt_count >= 5 then
    return query select false, 'ATTEMPTS_EXHAUSTED'::text,
      v_job.attempt_count, null::timestamptz;
    return;
  end if;

  update public.seller_os_luna_stock_check_jobs job
  set workflow_state = 'IN_PROGRESS',
      attempt_count = job.attempt_count + 1,
      lease_owner = trim(p_worker_id),
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      updated_at = p_now
  where job.stock_check_job_id = p_stock_check_job_id and job.account_key='imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
  returning * into v_job;
  return query select true, 'CLAIMED'::text, v_job.attempt_count,
    v_job.lease_expires_at;
end;
$$;

create or replace function public.verify_seller_os_luna_stock_check_lease_v1(
  p_stock_check_job_id text,
  p_worker_id text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.role() = 'service_role',false) and exists (
    select 1
    from public.seller_os_luna_stock_check_jobs job
    where job.stock_check_job_id = p_stock_check_job_id and job.account_key='imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
      and job.workflow_state = 'IN_PROGRESS'
      and job.lease_owner = trim(p_worker_id)
      and job.lease_expires_at > p_now
      and job.success_receipt_digest is null
  );
$$;

create or replace function public.complete_seller_os_luna_stock_check_job_v1(
  p_stock_check_job_id text,
  p_worker_id text,
  p_success_receipt_digest text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.seller_os_luna_stock_check_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role'
    or coalesce(p_success_receipt_digest, '') !~
      '^luna-stock-package-v1:sha256:[0-9a-f]{64}$'
    or p_now is null then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_COMPLETE_INVALID';
  end if;
  select * into v_job
  from public.seller_os_luna_stock_check_jobs job
  where job.stock_check_job_id = p_stock_check_job_id and job.account_key='imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
  for update;
  if not found then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_JOB_NOT_FOUND';
  end if;
  if v_job.workflow_state = 'SUCCEEDED' then
    if v_job.success_receipt_digest = p_success_receipt_digest then
      return true;
    end if;
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_RECEIPT_CONFLICT';
  end if;
  if v_job.workflow_state <> 'IN_PROGRESS'
    or v_job.lease_owner is distinct from trim(p_worker_id)
    or v_job.lease_expires_at <= p_now then
    raise exception 'SELLER_OS_LUNA_STOCK_CHECK_LEASE_NOT_OWNED';
  end if;
  if not exists(select 1 from public.seller_os_luna_linkage_decisions d
    where d.account_key=v_job.account_key and d.ebay_item_id=v_job.ebay_item_id and d.linkage_id=v_job.linkage_id
      and d.decision='APPROVE_EXACT_LINKAGE' and jsonb_array_length(d.components)>0
      and d.decision_version=(select max(x.decision_version) from public.seller_os_luna_linkage_decisions x
        where x.account_key=d.account_key and x.ebay_item_id=d.ebay_item_id and x.marketplace_id=d.marketplace_id)
      and not exists(select 1 from jsonb_array_elements(d.components) c where not exists(
        select 1 from public.seller_os_luna_stock_observations o where o.stock_check_job_id=p_stock_check_job_id
        and o.attempt_number=v_job.attempt_count and o.component_identity_id=('luna-component-identity-v1:sha256:'||encode(sha256(convert_to('['||to_json(c->>'lunaProductId')::text||','||coalesce(to_json(c->>'lunaVariantId')::text,'null')||','||to_json(c->>'lunaSku')::text||']','UTF8')),'hex'))
        and o.luna_product_id=c->>'lunaProductId' and o.luna_variant_id is not distinct from c->>'lunaVariantId'
        and o.luna_sku=c->>'lunaSku' and o.supplier_quantity_required=(c->>'supplierQuantityRequired')::integer))) then
    raise exception 'STOCK_OBSERVATION_RECEIPT_REQUIRED';
  end if;
  update public.seller_os_luna_stock_check_jobs job
  set workflow_state = 'SUCCEEDED',
      lease_owner = null,
      lease_expires_at = null,
      success_receipt_digest = p_success_receipt_digest,
      updated_at = p_now
  where job.stock_check_job_id = p_stock_check_job_id;
  return true;
end;
$$;


revoke all on function public.ensure_seller_os_luna_stock_check_job_v1(
  text, text, text, text, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.ensure_seller_os_luna_stock_observation_v1(
  text, text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, text, text, text, integer, timestamptz, integer, text[],
  text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.claim_seller_os_luna_stock_check_job_v1(
  text, text, timestamptz, integer
) from public, anon, authenticated, service_role;
revoke all on function public.verify_seller_os_luna_stock_check_lease_v1(
  text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.complete_seller_os_luna_stock_check_job_v1(
  text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.claim_seller_os_luna_stock_check_job_v1(
  text, text, timestamptz, integer
) to service_role;
grant execute on function public.ensure_seller_os_luna_stock_check_job_v1(
  text, text, text, text, timestamptz, timestamptz, timestamptz, text
) to service_role;
grant execute on function public.ensure_seller_os_luna_stock_observation_v1(
  text, text, text, text, text, text, text, text, text, integer, text, text,
  boolean, integer, text, text, text, integer, timestamptz, integer, text[],
  text, timestamptz
) to service_role;
grant execute on function public.verify_seller_os_luna_stock_check_lease_v1(
  text, text, timestamptz
) to service_role;
grant execute on function public.complete_seller_os_luna_stock_check_job_v1(
  text, text, text, timestamptz
) to service_role;
notify pgrst,'reload schema';

create or replace function public.prevent_seller_os_luna_stock_observation_mutation_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
begin raise exception 'SELLER_OS_LUNA_STOCK_OBSERVATION_IMMUTABLE'; end;
$$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.seller_os_luna_stock_observations'::regclass
   and tgname='seller_os_luna_stock_observations_immutable') then
 create trigger seller_os_luna_stock_observations_immutable before update or delete on public.seller_os_luna_stock_observations
 for each row execute function public.prevent_seller_os_luna_stock_observation_mutation_v1();
 end if;
end $$;
revoke all on function public.prevent_seller_os_luna_stock_observation_mutation_v1() from public,anon,authenticated;
notify pgrst,'reload schema';
