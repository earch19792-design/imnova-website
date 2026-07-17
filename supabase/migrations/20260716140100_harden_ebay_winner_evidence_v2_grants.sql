-- Least-privilege correction for the service-only Winner Evidence V2 table.

revoke all on table public.marketplace_listing_decision_packages from service_role;
grant select, insert, update on table public.marketplace_listing_decision_packages to service_role;

notify pgrst, 'reload schema';
