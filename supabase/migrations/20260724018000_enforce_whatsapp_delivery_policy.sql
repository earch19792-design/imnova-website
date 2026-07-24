-- Enforce the staging WhatsApp delivery contract at the database boundary.
-- Monitoring is immediate only for a confirmed sale or an exact Luna stock-out
-- affecting an active listing. A manually requested system test remains an
-- explicit non-monitoring exception. Everything else is due in the next
-- 00:00 UTC digest (18:00 Guatemala).

create or replace function public.enforce_ebay_whatsapp_delivery_policy()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_next_digest timestamptz := (
    date_trunc('day', clock_timestamp() at time zone 'UTC')
    + interval '1 day'
  ) at time zone 'UTC';
begin
  if new.channel <> 'whatsapp' or new.delivery_class <> 'immediate' then
    return new;
  end if;

  if tg_table_name = 'alert_delivery_outbox' then
    select event.event_type
      into v_event_type
    from public.commercial_alert_events as event
    where event.id = new.commercial_event_id;

    if coalesce(v_event_type, '') not in (
      'SALE_DETECTED',
      'ACTIVE_LISTING_OUT_OF_STOCK'
    ) then
      new.delivery_class := 'digest';
      new.due_at := v_next_digest;
    end if;
  elsif tg_table_name = 'ebay_seller_alert_outbox'
    and coalesce(new.alert_type, '') not in ('out_of_stock', 'system_test') then
    new.delivery_class := 'digest';
    new.due_at := v_next_digest;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_commercial_whatsapp_delivery_policy
  on public.alert_delivery_outbox;
create trigger enforce_commercial_whatsapp_delivery_policy
before insert or update of channel, delivery_class, due_at, commercial_event_id
on public.alert_delivery_outbox
for each row execute function public.enforce_ebay_whatsapp_delivery_policy();

drop trigger if exists enforce_seller_whatsapp_delivery_policy
  on public.ebay_seller_alert_outbox;
create trigger enforce_seller_whatsapp_delivery_policy
before insert or update of channel, delivery_class, due_at, alert_type
on public.ebay_seller_alert_outbox
for each row execute function public.enforce_ebay_whatsapp_delivery_policy();

update public.alert_delivery_outbox as outbox
set delivery_class = 'digest',
    due_at = (
      date_trunc('day', clock_timestamp() at time zone 'UTC')
      + interval '1 day'
    ) at time zone 'UTC'
from public.commercial_alert_events as event
where event.id = outbox.commercial_event_id
  and outbox.marketplace = 'EBAY_US'
  and outbox.channel = 'whatsapp'
  and outbox.delivery_class = 'immediate'
  and outbox.status in ('pending', 'failed', 'dead_letter')
  and event.event_type not in (
    'SALE_DETECTED',
    'ACTIVE_LISTING_OUT_OF_STOCK'
  );

update public.ebay_seller_alert_outbox
set delivery_class = 'digest',
    due_at = (
      date_trunc('day', clock_timestamp() at time zone 'UTC')
      + interval '1 day'
    ) at time zone 'UTC'
where channel = 'whatsapp'
  and delivery_class = 'immediate'
  and status in ('pending', 'failed', 'dead_letter', 'leased')
  and alert_type not in ('out_of_stock', 'system_test');

comment on function public.enforce_ebay_whatsapp_delivery_policy()
is 'Database guard for the eBay staging WhatsApp policy: monitoring is immediate only for SALE_DETECTED or exact active-listing stock-out; system_test is an explicit manual exception.';

revoke all on function public.enforce_ebay_whatsapp_delivery_policy()
from public, anon, authenticated;
