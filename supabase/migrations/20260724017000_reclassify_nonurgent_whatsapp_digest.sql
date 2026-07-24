-- Preserve immediate WhatsApp delivery only for a confirmed sale or an exact
-- active-listing Luna stock-out. Older pending rows created before the policy
-- correction move once to the next 00:00 UTC digest (18:00 Guatemala).
-- Delivered history is immutable and this migration performs no provider,
-- eBay, or Production write.

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

comment on table public.alert_delivery_outbox is
  'Commercial delivery queue. WhatsApp is immediate only for SALE_DETECTED '
  'or ACTIVE_LISTING_OUT_OF_STOCK; all other actionable signals are digested.';
