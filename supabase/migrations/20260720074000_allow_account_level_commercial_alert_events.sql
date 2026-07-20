-- Monitoring-heartbeat alerts describe account-wide reader health, not one
-- listing. Keep listing-bound commercial events unchanged while allowing the
-- heartbeat reconciler to persist an event with no invented listing identity.

alter table public.commercial_alert_events
  alter column listing_id drop not null;

comment on column public.commercial_alert_events.listing_id is
  'Exact listing identity when applicable; null only for account-level events such as monitoring heartbeats.';
