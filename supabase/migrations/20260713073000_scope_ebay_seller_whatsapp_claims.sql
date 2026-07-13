-- Bind every WhatsApp delivery lease to the configured official eBay account.
-- Old unscoped rows are quarantined and cannot be claimed after account rotation.

alter table public.ebay_active_listings
  alter column account_key drop default;

update public.ebay_active_listings
set listing_status = 'unknown',
    updated_at = now(),
    raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
      'accountScopeQuarantined', true,
      'accountScopeQuarantineReason', 'LEGACY_DEFAULT_ACCOUNT_KEY'
    )
where account_key = 'default'
  and listing_status in ('active', 'paused');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ebay_active_listings_account_scope_check'
      and conrelid = 'public.ebay_active_listings'::regclass
  ) then
    alter table public.ebay_active_listings
      add constraint ebay_active_listings_account_scope_check
      check (
        account_key <> 'default'
        and length(account_key) between 66 and 145
        and account_key !~ '[[:cntrl:]]'
      ) not valid;
  end if;
end;
$$;

create index if not exists ebay_seller_alert_outbox_account_scope_idx
  on public.ebay_seller_alert_outbox ((payload ->> 'accountKey'), status, due_at)
  where status in ('pending', 'failed', 'leased', 'dead_letter');

-- Pre-scope WhatsApp rows have no trustworthy official-account binding. Keep
-- their audit history, but make pending/retry/in-flight rows non-deliverable.
with quarantined_legacy_alerts as (
  update public.ebay_seller_alert_outbox as alert
  set status = 'cancelled',
      last_error_code = 'LEGACY_ACCOUNT_SCOPE_QUARANTINED',
      lease_owner = null,
      lease_expires_at = null,
      updated_at = now()
  where alert.channel = 'whatsapp'
    and alert.status in ('pending', 'failed', 'leased')
    and (
      nullif(alert.payload ->> 'accountKey', '') is null
      or alert.payload ->> 'accountKey' = 'default'
      or length(alert.payload ->> 'accountKey') not between 66 and 145
    )
  returning alert.id, alert.attempts
)
update public.ebay_seller_alert_delivery_attempts as attempt
set status = 'failed',
    error_code = 'LEGACY_ACCOUNT_SCOPE_QUARANTINED',
    completed_at = now()
from quarantined_legacy_alerts
where attempt.alert_id = quarantined_legacy_alerts.id
  and attempt.attempt_number = quarantined_legacy_alerts.attempts
  and attempt.channel = 'whatsapp'
  and attempt.status = 'started';

create or replace function public.quarantine_ebay_manual_listing_after_failed_reverification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.verification_status = 'verified'
    and new.verification_status = 'pending_manual_verification' then
    if old.connector_listing_id is not null then
      update public.ebay_active_listings
      set listing_status = case
            when new.verification_reason = 'EBAY_ITEM_NOT_ACTIVE_IN_OFFICIAL_ACCOUNT'
              then 'ended'
            else 'unknown'
          end,
          last_ebay_sync_at = new.last_verification_at,
          updated_at = new.last_verification_at,
          raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
            'ownershipVerified', false,
            'productIdentityVerified', false,
            'lastManualVerificationReason', new.verification_reason,
            'lastManualVerificationAt', new.last_verification_at
          )
      where id = old.connector_listing_id
        and account_key = new.account_key;
    end if;

    update public.ebay_seller_listing_templates
    set status = 'superseded',
        updated_by = new.updated_by,
        updated_at = new.last_verification_at
    where source_link_id = new.id
      and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists ebay_manual_listing_quarantine_after_reverification
  on public.ebay_manual_listing_links;
create trigger ebay_manual_listing_quarantine_after_reverification
after update of verification_status on public.ebay_manual_listing_links
for each row execute function
  public.quarantine_ebay_manual_listing_after_failed_reverification();

revoke all on function public.quarantine_ebay_manual_listing_after_failed_reverification()
  from public, anon, authenticated;
grant execute on function public.quarantine_ebay_manual_listing_after_failed_reverification()
  to service_role;

drop function if exists public.claim_ebay_seller_whatsapp_alerts(text, integer, integer);

create or replace function public.claim_ebay_seller_whatsapp_alerts(
  p_worker_id text,
  p_account_key text,
  p_limit integer default 1,
  p_lease_seconds integer default 120
)
returns setof public.ebay_seller_alert_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'SELLER_WHATSAPP_WORKER_REQUIRED';
  end if;
  if nullif(trim(p_account_key), '') is null
    or length(p_account_key) not between 66 and 145
    or p_account_key = 'default'
    or p_account_key ~ '[[:cntrl:]]' then
    raise exception 'SELLER_WHATSAPP_ACCOUNT_SCOPE_REQUIRED';
  end if;

  with expired_leases as (
    update public.ebay_seller_alert_outbox as expired
    set status = case
          when expired.attempts >= expired.max_attempts then 'dead_letter'
          else 'failed'
        end,
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = case
          when expired.attempts >= expired.max_attempts
            then 'DELIVERY_LEASE_EXPIRED_MAX_ATTEMPTS'
          else 'DELIVERY_LEASE_EXPIRED'
        end,
        due_at = case
          when expired.attempts >= expired.max_attempts then expired.due_at
          else v_now
        end,
        updated_at = v_now
    where expired.channel = 'whatsapp'
      and expired.status = 'leased'
      and expired.lease_expires_at < v_now
      and expired.payload ->> 'accountKey' = p_account_key
    returning expired.id, expired.attempts,
      expired.last_error_code
  )
  update public.ebay_seller_alert_delivery_attempts as attempt
  set status = 'failed',
      error_code = expired_leases.last_error_code,
      completed_at = v_now
  from expired_leases
  where attempt.alert_id = expired_leases.id
    and attempt.attempt_number = expired_leases.attempts
    and attempt.channel = 'whatsapp'
    and attempt.status = 'started';

  return query
  with picked as (
    select candidate.id
    from public.ebay_seller_alert_outbox as candidate
    where candidate.channel = 'whatsapp'
      and candidate.status in ('pending', 'failed')
      and candidate.due_at <= clock_timestamp()
      and candidate.attempts < candidate.max_attempts
      and candidate.payload ->> 'accountKey' = p_account_key
    order by
      case candidate.delivery_class when 'immediate' then 0 else 1 end,
      case candidate.priority
        when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3
      end,
      candidate.due_at,
      candidate.created_at
    for update skip locked
    -- All callers have a 60-second ceiling while one Meta request may consume
    -- 20 seconds. Claim one row so no unprocessed lease is created up front.
    limit greatest(1, least(coalesce(p_limit, 1), 1))
  ), claimed as (
    update public.ebay_seller_alert_outbox as alert
    set status = 'leased',
        attempts = alert.attempts + 1,
        lease_owner = left(p_worker_id, 120),
        lease_expires_at = clock_timestamp() + make_interval(
          secs => greatest(30, least(coalesce(p_lease_seconds, 120), 300))
        ),
        updated_at = clock_timestamp()
    where alert.id in (select picked.id from picked)
    returning alert.*
  ), attempt_audit as (
    insert into public.ebay_seller_alert_delivery_attempts (
      alert_id, attempt_number, channel, status, attempted_at
    )
    select claimed.id, claimed.attempts, 'whatsapp', 'started', clock_timestamp()
    from claimed
    on conflict (alert_id, attempt_number, channel) do update
      set status = 'started', attempted_at = excluded.attempted_at,
          completed_at = null, provider_message_id = null,
          response_code = null, error_code = null
    returning alert_id
  )
  select claimed.* from claimed
  where exists (
    select 1 from attempt_audit where attempt_audit.alert_id = claimed.id
  );
end;
$$;

-- A Meta timeout is an indeterminate delivery outcome: the provider may have
-- accepted the message before the response was lost. Never auto-retry it.
create or replace function public.fail_ebay_seller_whatsapp_alert(
  p_alert_id uuid,
  p_attempt_number integer,
  p_error_code text,
  p_response_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_indeterminate boolean := upper(coalesce(p_error_code, '')) =
    'META_REQUEST_TIMEOUT';
  v_recorded_error text;
begin
  v_recorded_error := case
    when v_indeterminate then 'META_DELIVERY_OUTCOME_UNKNOWN_MANUAL_REVIEW'
    else left(coalesce(
      nullif(p_error_code, ''),
      'SELLER_WHATSAPP_DELIVERY_FAILED'
    ), 120)
  end;

  update public.ebay_seller_alert_outbox as alert
  set status = case
        when v_indeterminate or alert.attempts >= alert.max_attempts
          then 'dead_letter'
        else 'failed'
      end,
      due_at = case
        when v_indeterminate or alert.attempts >= alert.max_attempts
          then alert.due_at
        else v_now + make_interval(
          secs => least(3600, (
            30 * power(2, greatest(0, alert.attempts - 1))
          )::integer)
        )
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = v_recorded_error,
      updated_at = v_now
  where alert.id = p_alert_id
    and alert.channel = 'whatsapp'
    and alert.status = 'leased'
    and alert.attempts = p_attempt_number;

  if not found then return false; end if;

  update public.ebay_seller_alert_delivery_attempts as attempt
  set status = 'failed',
      response_code = nullif(left(coalesce(p_response_code, ''), 40), ''),
      error_code = v_recorded_error,
      completed_at = v_now
  where attempt.alert_id = p_alert_id
    and attempt.attempt_number = p_attempt_number
    and attempt.channel = 'whatsapp';
  return true;
end;
$$;

revoke all on function public.claim_ebay_seller_whatsapp_alerts(
  text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_ebay_seller_whatsapp_alerts(
  text, text, integer, integer
) to service_role;
revoke all on function public.fail_ebay_seller_whatsapp_alert(
  uuid, integer, text, text
) from public, anon, authenticated;
grant execute on function public.fail_ebay_seller_whatsapp_alert(
  uuid, integer, text, text
) to service_role;

notify pgrst, 'reload schema';
