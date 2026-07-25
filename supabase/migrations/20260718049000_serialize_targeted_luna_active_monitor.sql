-- Serialize the Preview-only targeted Luna monitor independently from the
-- manual eBay active-listing sync. The state is one row per seller account;
-- it stores heartbeats and sanitized errors, never Luna response bodies.

alter table public.ebay_active_listing_sync_state
  add column if not exists targeted_luna_active_run_id uuid null
    references public.ebay_seller_automation_runs(id) on delete set null,
  add column if not exists targeted_luna_active_started_at timestamptz null,
  add column if not exists targeted_luna_active_lease_expires_at timestamptz null,
  add column if not exists targeted_luna_last_success_run_id uuid null
    references public.ebay_seller_automation_runs(id) on delete set null,
  add column if not exists targeted_luna_last_success_at timestamptz null,
  add column if not exists targeted_luna_last_error_run_id uuid null
    references public.ebay_seller_automation_runs(id) on delete set null,
  add column if not exists targeted_luna_last_error_at timestamptz null,
  add column if not exists targeted_luna_last_error_code text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_active_listing_sync_state_targeted_luna_lease_check'
      and conrelid = 'public.ebay_active_listing_sync_state'::regclass
  ) then
    alter table public.ebay_active_listing_sync_state
      add constraint ebay_active_listing_sync_state_targeted_luna_lease_check check (
        (
          targeted_luna_active_run_id is null
          and targeted_luna_active_started_at is null
          and targeted_luna_active_lease_expires_at is null
        )
        or (
          targeted_luna_active_run_id is not null
          and targeted_luna_active_started_at is not null
          and targeted_luna_active_lease_expires_at is not null
          and targeted_luna_active_lease_expires_at > targeted_luna_active_started_at
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_active_listing_sync_state_targeted_luna_error_check'
      and conrelid = 'public.ebay_active_listing_sync_state'::regclass
  ) then
    alter table public.ebay_active_listing_sync_state
      add constraint ebay_active_listing_sync_state_targeted_luna_error_check check (
        targeted_luna_last_error_code is null
        or targeted_luna_last_error_code ~ '^[A-Z0-9_]{3,100}$'
      );
  end if;
end;
$$;

create or replace function public.claim_ebay_targeted_luna_monitor_run(
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
    raise exception 'EBAY_TARGETED_LUNA_MONITOR_CLAIM_INVALID';
  end if;

  insert into public.ebay_active_listing_sync_state as state (
    account_key,
    targeted_luna_active_run_id,
    targeted_luna_active_started_at,
    targeted_luna_active_lease_expires_at
  ) values (
    p_account_key,
    p_run_id,
    now(),
    now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (account_key) do update set
    targeted_luna_active_run_id = excluded.targeted_luna_active_run_id,
    targeted_luna_active_started_at = excluded.targeted_luna_active_started_at,
    targeted_luna_active_lease_expires_at = excluded.targeted_luna_active_lease_expires_at
  where state.targeted_luna_active_run_id is null
    or state.targeted_luna_active_lease_expires_at <= now()
  returning true into v_claimed;

  select * into v_state
  from public.ebay_active_listing_sync_state state
  where state.account_key = p_account_key;

  return query select
    v_claimed,
    v_state.targeted_luna_active_run_id,
    v_state.targeted_luna_active_started_at,
    v_state.targeted_luna_active_lease_expires_at;
end;
$$;

create or replace function public.finish_ebay_targeted_luna_monitor_run(
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
    raise exception 'EBAY_TARGETED_LUNA_MONITOR_FINISH_INVALID';
  end if;

  select * into v_state
  from public.ebay_active_listing_sync_state state
  where state.account_key = p_account_key
    and state.targeted_luna_active_run_id = p_run_id
  for update;
  if not found then
    raise exception 'EBAY_TARGETED_LUNA_MONITOR_LEASE_NOT_OWNED';
  end if;

  update public.ebay_active_listing_sync_state state
  set targeted_luna_active_run_id = null,
      targeted_luna_active_started_at = null,
      targeted_luna_active_lease_expires_at = null,
      targeted_luna_last_success_run_id = case
        when p_success then p_run_id else state.targeted_luna_last_success_run_id
      end,
      targeted_luna_last_success_at = case
        when p_success then now() else state.targeted_luna_last_success_at
      end,
      targeted_luna_last_error_run_id = case
        when p_success then state.targeted_luna_last_error_run_id else p_run_id
      end,
      targeted_luna_last_error_at = case
        when p_success then state.targeted_luna_last_error_at else now()
      end,
      targeted_luna_last_error_code = case
        when p_success then null else p_error_code
      end
  where state.account_key = p_account_key
  returning state.* into v_state;

  return query select
    v_state.targeted_luna_last_success_at,
    v_state.targeted_luna_last_error_at,
    v_state.targeted_luna_last_error_code;
end;
$$;

revoke all on function public.claim_ebay_targeted_luna_monitor_run(
  text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.claim_ebay_targeted_luna_monitor_run(
  text, uuid, integer
) to service_role;
revoke all on function public.finish_ebay_targeted_luna_monitor_run(
  text, uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.finish_ebay_targeted_luna_monitor_run(
  text, uuid, boolean, text
) to service_role;

comment on function public.claim_ebay_targeted_luna_monitor_run(text, uuid, integer) is
  'Claims the single Preview targeted Luna monitor lease for a seller account.';

notify pgrst, 'reload schema';
