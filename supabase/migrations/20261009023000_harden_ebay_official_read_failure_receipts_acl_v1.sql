-- Supabase default privileges grant service_role full table access at CREATE.
-- Revoke that inherited ACL explicitly so failure evidence remains append-only.

revoke all on public.seller_os_ebay_official_read_failure_receipts_v1
  from service_role;
grant select, insert on
  public.seller_os_ebay_official_read_failure_receipts_v1 to service_role;

revoke all on public.seller_os_ebay_official_read_failure_receipts_v1
  from public, anon, authenticated;

comment on table
  public.seller_os_ebay_official_read_failure_receipts_v1 is
  'Append-only service-role receipts for bounded redacted original eBay Trading failure metadata. service_role has SELECT and INSERT only; raw XML, credentials and PII are never stored.';

notify pgrst, 'reload schema';
