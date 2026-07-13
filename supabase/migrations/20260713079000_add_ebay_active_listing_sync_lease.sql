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
    or p_account_key = 'default'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_run_id is null
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
  where state.active_run_id is null
    or state.active_run_lease_expires_at <= now()
  returning true into v_claimed;

  select * into v_state
  from public.ebay_active_listing_sync_state state
  where state.account_key = p_account_key;

  return query select
    v_claimed,
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
    or p_account_key = 'default'
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

comment on table public.ebay_active_listing_sync_state is
  'Account-scoped monotonic snapshot state plus manual-pilot execution lease and last success/error evidence.';

notify pgrst, 'reload schema';
