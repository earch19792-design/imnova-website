-- SELLER_OS_888LOTS_SUPPLIER_ONBOARDING_V1
-- Register 888 Lots in the existing canonical supplier/radar source registry.
-- It remains inactive until account approval and an authorized export/API path
-- are certified. This migration creates no scraper, scheduler, purchase or
-- marketplace capability.

insert into public.market_radar_sources (
  key,
  name,
  base_url,
  is_active,
  poll_interval_minutes
)
values (
  '888lots',
  '888 Lots',
  'https://888lots.com',
  false,
  1440
)
on conflict (key) do update set
  name = excluded.name,
  base_url = excluded.base_url,
  is_active = false,
  poll_interval_minutes = excluded.poll_interval_minutes,
  updated_at = now();

notify pgrst, 'reload schema';
