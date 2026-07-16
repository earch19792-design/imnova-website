-- Assisted OAuth installation for the dedicated eBay tracking token. The
-- refresh token exists only as short-lived public-key ciphertext in staging;
-- the operator clears it atomically after installing the sensitive Preview
-- environment variable.

alter table public.ebay_fulfillment_tracking_oauth_handoffs
  add column if not exists fingerprint_match boolean null,
  add column if not exists refresh_success boolean null,
  add column if not exists token_installed_at timestamptz null,
  add column if not exists ciphertext_cleared_at timestamptz null,
  add column if not exists readiness_status text null,
  add column if not exists readiness_checked_at timestamptz null;

alter table public.ebay_fulfillment_tracking_oauth_handoffs
  add constraint ebay_fulfillment_tracking_oauth_readiness_status_v1b_check check (
    readiness_status is null or readiness_status in (
      'NOT_CONFIGURED','AUTHORIZATION_REQUIRED','AUTHORIZATION_IN_PROGRESS',
      'READY','SCOPE_MISSING','IDENTITY_MISMATCH','FINGERPRINT_MISMATCH',
      'EXPIRED_OR_REVOKED','ERROR'
    )
  ) not valid;
alter table public.ebay_fulfillment_tracking_oauth_handoffs
  validate constraint ebay_fulfillment_tracking_oauth_readiness_status_v1b_check;

alter table public.ebay_fulfillment_tracking_oauth_handoffs
  add constraint ebay_fulfillment_tracking_oauth_ciphertext_lifecycle_v1b_check check (
    (status = 'ready' and encrypted_refresh_token is not null and ready_at is not null)
    or (status = 'consumed' and encrypted_refresh_token is null and
      consumed_at is not null and token_installed_at is not null and
      ciphertext_cleared_at is not null)
    or status not in ('ready','consumed')
  ) not valid;
alter table public.ebay_fulfillment_tracking_oauth_handoffs
  validate constraint ebay_fulfillment_tracking_oauth_ciphertext_lifecycle_v1b_check;

create or replace function public.start_ebay_fulfillment_tracking_oauth_handoff_v1b(
  p_state_hash text,
  p_public_key_pem text,
  p_expires_at timestamptz
)
returns table(handoff_id uuid,handoff_status text,handoff_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_state_hash !~ '^[0-9a-f]{64}$' or
     char_length(p_public_key_pem) not between 700 and 1600 or
     p_public_key_pem not like '-----BEGIN PUBLIC KEY-----%' or
     p_expires_at <= v_now or p_expires_at > v_now + interval '30 minutes' then
    raise exception 'EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_HANDOFF_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'ebay-fulfillment-tracking-oauth-handoff-v1b',0
  ));

  update public.ebay_fulfillment_tracking_oauth_handoffs
  set status = 'expired',encrypted_refresh_token = null,updated_at = v_now
  where status in ('pending','claimed') and expires_at <= v_now;

  if exists (
    select 1 from public.ebay_fulfillment_tracking_oauth_handoffs
    where status in ('pending','claimed','ready') and expires_at > v_now
  ) then
    raise exception 'EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_HANDOFF_ACTIVE';
  end if;

  return query
  insert into public.ebay_fulfillment_tracking_oauth_handoffs(
    state_hash,public_key_pem,status,expires_at
  ) values (p_state_hash,p_public_key_pem,'pending',p_expires_at)
  returning id,status,expires_at;
end;
$$;

create or replace function public.consume_ebay_fulfillment_tracking_oauth_handoff_v1b(
  p_handoff_id uuid
)
returns table(handoff_status text,token_installed_at timestamptz,ciphertext_cleared boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  return query
  update public.ebay_fulfillment_tracking_oauth_handoffs handoff
  set status = 'consumed',encrypted_refresh_token = null,consumed_at = v_now,
      token_installed_at = v_now,ciphertext_cleared_at = v_now,updated_at = v_now
  where handoff.id = p_handoff_id and handoff.status = 'ready' and
        handoff.identity_match = true and handoff.fingerprint_match = true and
        handoff.fulfillment_scope_confirmed = true and
        handoff.encrypted_refresh_token is not null
  returning handoff.status,handoff.token_installed_at,
    handoff.encrypted_refresh_token is null;

  if not found then
    raise exception 'EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_CONSUME_INVALID';
  end if;
end;
$$;

revoke all on function public.start_ebay_fulfillment_tracking_oauth_handoff_v1b(
  text,text,timestamptz
) from public,anon,authenticated;
revoke all on function public.consume_ebay_fulfillment_tracking_oauth_handoff_v1b(
  uuid
) from public,anon,authenticated;
grant execute on function public.start_ebay_fulfillment_tracking_oauth_handoff_v1b(
  text,text,timestamptz
) to service_role;
grant execute on function public.consume_ebay_fulfillment_tracking_oauth_handoff_v1b(
  uuid
) to service_role;

notify pgrst, 'reload schema';
