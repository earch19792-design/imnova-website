-- P0: claim only durable owner-sale WhatsApp obligations. This lane is
-- intentionally independent of active-listing monitoring authorization.
-- Other commercial alert types continue to use claim_alert_delivery_outbox
-- and therefore remain behind the existing monitoring-state gate.
create or replace function public.claim_owner_sale_alert_delivery_outbox_v1(
  p_marketplace_account_key text,
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 120
)
returns setof public.alert_delivery_outbox
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  with expired as (
    update public.alert_delivery_outbox alert
    set status = case when alert.attempts >= alert.max_attempts
          then 'dead_letter' else 'failed' end,
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = case when alert.attempts >= alert.max_attempts
          then 'DELIVERY_LEASE_EXPIRED_MAX_ATTEMPTS'
          else 'DELIVERY_LEASE_EXPIRED' end,
        due_at = case when alert.attempts >= alert.max_attempts
          then alert.due_at else v_now end,
        updated_at = v_now
    from public.commercial_alert_events event
    where alert.marketplace_account_key = p_marketplace_account_key
      and alert.marketplace = 'EBAY_US'
      and alert.channel = 'whatsapp'
      and alert.status = 'leased'
      and alert.lease_expires_at < v_now
      and alert.commercial_event_id = event.id
      and event.marketplace_account_key = p_marketplace_account_key
      and event.marketplace = 'EBAY_US'
      and event.event_type = 'SALE_DETECTED'
      and event.marketplace_order_id is not null
      and event.marketplace_line_item_id is not null
      and (
        event.evidence ->> 'source' = 'EBAY_SELL_FULFILLMENT_GET_ORDERS'
        or (
          event.evidence ->> 'sourceSystem' = 'EBAY_SELL_FULFILLMENT'
          and event.evidence ->> 'sourceOperation' = 'GET_ORDERS'
        )
      )
    returning alert.id, alert.attempts, alert.last_error_code
  )
  update public.alert_delivery_attempts attempt
  set status = 'failed',
      error_code = expired.last_error_code,
      completed_at = v_now
  from expired
  where attempt.outbox_id = expired.id
    and attempt.attempt_number = expired.attempts
    and attempt.status = 'started';

  return query
  with picked as (
    select alert.id
    from public.alert_delivery_outbox alert
    join public.commercial_alert_events event
      on event.id = alert.commercial_event_id
    where alert.marketplace_account_key = p_marketplace_account_key
      and alert.marketplace = 'EBAY_US'
      and alert.channel = 'whatsapp'
      and alert.status in ('pending', 'failed')
      and alert.due_at <= v_now
      and alert.attempts < alert.max_attempts
      and event.marketplace_account_key = p_marketplace_account_key
      and event.marketplace = 'EBAY_US'
      and event.event_type = 'SALE_DETECTED'
      and event.marketplace_order_id is not null
      and event.marketplace_line_item_id is not null
      and (
        event.evidence ->> 'source' = 'EBAY_SELL_FULFILLMENT_GET_ORDERS'
        or (
          event.evidence ->> 'sourceSystem' = 'EBAY_SELL_FULFILLMENT'
          and event.evidence ->> 'sourceOperation' = 'GET_ORDERS'
        )
      )
    order by alert.due_at, alert.created_at
    for update of alert skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 10))
  ), claimed as (
    update public.alert_delivery_outbox alert
    set status = 'leased',
        attempts = alert.attempts + 1,
        lease_owner = left(p_worker_id, 160),
        lease_expires_at = v_now + make_interval(
          secs => greatest(30, least(coalesce(p_lease_seconds, 120), 300))
        ),
        updated_at = v_now
    where alert.id in (select picked.id from picked)
    returning alert.*
  ), attempts as (
    insert into public.alert_delivery_attempts (
      outbox_id, attempt_number, channel, status, attempted_at
    )
    select claimed.id, claimed.attempts, claimed.channel, 'started', v_now
    from claimed
    on conflict (outbox_id, attempt_number, channel) do update
      set status = 'started',
          attempted_at = excluded.attempted_at,
          completed_at = null,
          provider_message_id = null,
          response_code = null,
          error_code = null
    returning outbox_id
  )
  select claimed.*
  from claimed
  where exists (
    select 1 from attempts where attempts.outbox_id = claimed.id
  );
end;
$$;

comment on function public.claim_owner_sale_alert_delivery_outbox_v1(
  text, text, integer, integer
) is 'Claims only official paid-order owner sale alerts; no active-listing monitoring authorization dependency.';

revoke all on function public.claim_owner_sale_alert_delivery_outbox_v1(
  text, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.claim_owner_sale_alert_delivery_outbox_v1(
  text, text, integer, integer
) to service_role;

notify pgrst, 'reload schema';
