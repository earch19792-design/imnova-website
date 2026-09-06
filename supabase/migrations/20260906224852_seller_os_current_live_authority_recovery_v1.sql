-- Extend the existing account-scoped active-listing sync authority with a
-- durable seller-wide LIVE snapshot. A failed official read never overwrites
-- the last certified cohort and never materializes an authoritative zero.

alter table public.ebay_active_listing_sync_state
  add column if not exists current_live_source_state text not null
    default 'CURRENT_UNAVAILABLE',
  add column if not exists current_live_last_attempt_at timestamptz null,
  add column if not exists current_live_next_retry_at timestamptz null,
  add column if not exists current_live_last_error_code text null,
  add column if not exists last_certified_live_scope_id text null,
  add column if not exists last_certified_live_item_ids jsonb null,
  add column if not exists last_certified_live_count integer null,
  add column if not exists last_certified_live_observed_at timestamptz null,
  add column if not exists last_certified_live_fresh_until timestamptz null,
  add column if not exists last_certified_live_source_authority text null;

alter table public.ebay_active_listing_sync_state
  drop constraint if exists ebay_active_listing_sync_state_current_live_check;

alter table public.ebay_active_listing_sync_state
  add constraint ebay_active_listing_sync_state_current_live_check check (
    current_live_source_state in ('CURRENT_FRESH', 'CURRENT_UNAVAILABLE')
    and (
      current_live_last_error_code is null
      or current_live_last_error_code ~ '^[A-Z0-9_]{3,160}$'
    )
    and (
      (
        last_certified_live_scope_id is null
        and last_certified_live_item_ids is null
        and last_certified_live_count is null
        and last_certified_live_observed_at is null
        and last_certified_live_fresh_until is null
        and last_certified_live_source_authority is null
      )
      or (
        last_certified_live_scope_id ~ '^current-live:sha256:[0-9a-f]{64}$'
        and jsonb_typeof(last_certified_live_item_ids) = 'array'
        and last_certified_live_count >= 0
        and jsonb_array_length(last_certified_live_item_ids) =
          last_certified_live_count
        and last_certified_live_observed_at is not null
        and last_certified_live_fresh_until >
          last_certified_live_observed_at
        and last_certified_live_source_authority =
          'EBAY_TRADING_GET_MY_EBAY_SELLING_PLUS_GET_ITEM_CERTIFICATION'
      )
    )
  );

create index if not exists ebay_active_listing_sync_state_live_retry_idx
  on public.ebay_active_listing_sync_state(
    current_live_next_retry_at, account_key
  ) where current_live_source_state = 'CURRENT_UNAVAILABLE';

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
  v_ended integer := 0;
begin
  if p_account_key is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_run_id is null
    or p_scope_id is null
    or p_scope_id !~ '^current-live:sha256:[0-9a-f]{64}$'
    or p_observed_at is null
    or p_observed_at > clock_timestamp() + interval '5 minutes'
    or p_observed_at < clock_timestamp() - interval '20 minutes'
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

  insert into public.ebay_active_listings as target (
    source, account_key, sync_key, sync_run_id, sync_generation,
    ebay_item_id, listing_status, title, ebay_sku, ebay_variation_key,
    ebay_quantity, ebay_price, currency, last_ebay_sync_at,
    raw_payload, updated_at
  )
  select
    'EBAY_TRADING_GET_MY_EBAY_SELLING', p_account_key,
    concat('EBAY_TRADING_GET_MY_EBAY_SELLING:', p_account_key, ':',
      row.value ->> 'itemId'),
    p_run_id, 0, row.value ->> 'itemId', 'active',
    row.value ->> 'title', nullif(row.value ->> 'sku', ''),
    nullif(row.value ->> 'variationKey', ''),
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
    ebay_variation_key = excluded.ebay_variation_key,
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

  return query select true, v_count, v_count = 0, v_ended;
end;
$function$;

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
  if p_account_key is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_run_id is null
    or p_error_code is null
    or p_error_code !~ '^[A-Z0-9_]{3,160}$'
    or p_next_retry_at <= clock_timestamp()
    or p_next_retry_at > clock_timestamp() + interval '24 hours' then
    raise exception 'CURRENT_LIVE_AUTHORITY_FAILURE_INPUT_INVALID';
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

comment on column public.ebay_active_listing_sync_state.last_certified_live_item_ids
is 'Last complete account-bound eBay Trading LIVE cohort; preserved on source failure.';

notify pgrst, 'reload schema';
