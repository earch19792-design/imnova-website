-- A successful CURRENT LIVE cohort expires after twenty minutes. Permit its
-- bounded refresh inside the existing hourly window after the same durable
-- fifteen-minute spacing used by source-failure retries.

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
set search_path = ''
as $function$
declare
  v_claimed boolean := false;
  v_state public.ebay_active_listing_sync_state%rowtype;
begin
  if p_account_key is distinct from
      'imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_run_id is null
    or p_lease_seconds is null
    or p_lease_seconds not between 60 and 600 then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_CLAIM_INVALID';
  end if;

  insert into public.ebay_active_listing_sync_state as state (
    account_key, active_run_id, active_run_started_at,
    active_run_lease_expires_at, seller_wide_acquisition_count,
    seller_wide_window_until
  ) values (
    p_account_key, p_run_id, pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
    1, pg_catalog.clock_timestamp() + interval '60 minutes'
  )
  on conflict (account_key) do update set
    active_run_id = excluded.active_run_id,
    active_run_started_at = excluded.active_run_started_at,
    active_run_lease_expires_at = excluded.active_run_lease_expires_at,
    seller_wide_acquisition_count = case
      when state.seller_wide_window_until is null
        or state.seller_wide_window_until <= pg_catalog.clock_timestamp()
      then 1
      else state.seller_wide_acquisition_count + 1
    end,
    seller_wide_window_until = case
      when state.seller_wide_window_until is null
        or state.seller_wide_window_until <= pg_catalog.clock_timestamp()
      then excluded.seller_wide_window_until
      else state.seller_wide_window_until
    end
  where (state.active_run_id is null or
      state.active_run_lease_expires_at <= pg_catalog.clock_timestamp())
    and (state.last_certified_live_fresh_until is null or
      state.last_certified_live_fresh_until <= pg_catalog.clock_timestamp())
    and (
      state.seller_wide_window_until is null or
      state.seller_wide_window_until <= pg_catalog.clock_timestamp() or
      (
        coalesce(state.seller_wide_acquisition_count, 0) < 4 and
        (
          (
            state.current_live_source_state = 'CURRENT_UNAVAILABLE' and
            state.current_live_next_retry_at is not null and
            state.current_live_next_retry_at <= pg_catalog.clock_timestamp()
          ) or (
            state.current_live_source_state = 'CURRENT_FRESH' and
            state.current_live_last_attempt_at is not null and
            state.current_live_last_attempt_at <=
              pg_catalog.clock_timestamp() - interval '15 minutes'
          )
        )
      )
    )
  returning true into v_claimed;

  select * into v_state from public.ebay_active_listing_sync_state state
  where state.account_key = p_account_key;

  return query select coalesce(v_claimed, false),
    v_state.active_run_id, v_state.active_run_started_at,
    v_state.active_run_lease_expires_at;
end;
$function$;

comment on function public.claim_ebay_active_listing_sync_run(text, uuid, integer)
is 'Single-flight CURRENT LIVE acquisition with a fixed hourly window, fifteen-minute spacing and at most four refresh or retry admissions.';

notify pgrst, 'reload schema';
