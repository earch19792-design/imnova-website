-- Retain the title from the same authenticated official read that certified
-- each listing case. The existing ebay_observed_at timestamps this value.
alter table public.seller_os_listing_cases_v1
  add column if not exists ebay_title text;
