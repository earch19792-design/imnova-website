-- Compensating ACL lockdown for Preview environments where the image revision
-- and authorized publication tables were created before their base migrations
-- gained the explicit Seller OS revoke pattern.

revoke all on table public.ebay_same_day_pilot_image_revisions
  from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_image_revisions
  from public, service_role;
grant select on table public.ebay_same_day_pilot_image_revisions
  to service_role;

revoke all on table public.ebay_authorized_listing_publications
  from anon, authenticated;
revoke all on table public.ebay_authorized_listing_publications
  from public, service_role;
grant select, insert, update on table public.ebay_authorized_listing_publications
  to service_role;

notify pgrst, 'reload schema';
