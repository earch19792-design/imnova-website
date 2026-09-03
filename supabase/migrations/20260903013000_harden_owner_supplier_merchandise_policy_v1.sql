-- Keep the server boundary least-privilege even when project-level default
-- grants gave service_role broader table privileges at creation time.

revoke all on table public.seller_os_owner_supplier_policies_v1
  from anon, authenticated, service_role;

grant select, insert, update on table public.seller_os_owner_supplier_policies_v1
  to service_role;
