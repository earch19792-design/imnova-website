-- Compensating ACL hardening for Preview environments where the title
-- revision ledger was created before its explicit role split.

revoke all on table public.ebay_active_listing_title_revision_executions
  from anon, authenticated;
revoke all on table public.ebay_active_listing_title_revision_executions
  from public, service_role;
grant select, insert, update on table public.ebay_active_listing_title_revision_executions
  to service_role;

notify pgrst, 'reload schema';
