-- The Title-only service persists its idempotency ledger directly with the
-- backend service role. Application roles remain fully revoked; trigger and
-- check constraints keep updates append-only and phase-monotonic.

revoke all on table public.ebay_active_listing_title_revision_executions
  from anon, authenticated;
revoke all on table public.ebay_active_listing_title_revision_executions
  from public, service_role;
grant select, insert, update
  on table public.ebay_active_listing_title_revision_executions
  to service_role;

notify pgrst, 'reload schema';
