-- Compensating ACL hardening for Preview environments where 043000 ran before
-- the explicit table-grant guard was added. State mutations remain available
-- only through the narrowly scoped SECURITY DEFINER functions from 043000.

alter table public.ebay_active_listing_image_revision_executions
  enable row level security;
alter table public.ebay_active_listing_image_revision_executions
  force row level security;

revoke all on table public.ebay_active_listing_image_revision_executions
  from anon, authenticated;
revoke all on table public.ebay_active_listing_image_revision_executions
  from public, service_role;
grant select on table public.ebay_active_listing_image_revision_executions
  to service_role;

notify pgrst, 'reload schema';
