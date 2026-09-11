-- Preserve the existing probe's explanation alongside its current lease.
-- This metadata is never used as capture/claim authority.
alter table public.seller_os_browser_workload_leases_v1
  add column shipping_probe_diagnostic jsonb
  check (shipping_probe_diagnostic is null or
    (jsonb_typeof(shipping_probe_diagnostic)='object' and
     shipping_probe_diagnostic->>'version'='SHIPPING_EXISTING_PROBE_DIAGNOSTIC_V1' and
     shipping_probe_diagnostic->>'captureAuthorized'='false' and
     octet_length(shipping_probe_diagnostic::text)<1024));
comment on column public.seller_os_browser_workload_leases_v1.shipping_probe_diagnostic is
  'Read-only interpretation of the same worker/leader/observed-at probe; never shipping readiness or claim authority.';
