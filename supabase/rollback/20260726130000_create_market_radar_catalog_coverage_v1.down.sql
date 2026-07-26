begin;

-- Non-destructive compensation: disable LUNA_CATALOG_COVERAGE_V1_ENABLED in
-- runtime configuration. Audit evidence and snapshot provenance are retained.
update public.market_radar_catalog_scan_runs
set status = 'CANCELLED',
    error_code = 'ROLLBACK_COMPENSATION_APPLIED',
    finished_at = coalesce(finished_at, now())
where status = 'RUNNING';

update public.market_radar_inventory_hydration_cursors
set lease_owner = null,
    lease_expires_at = null,
    updated_at = now()
where lease_owner is not null or lease_expires_at is not null;

revoke execute on function public.claim_market_radar_luna_hydration_window_v1(
  uuid, text, text, integer, integer, text, integer
) from service_role;
revoke execute on function public.release_market_radar_luna_hydration_window_v1(
  uuid, text, text
) from service_role;

comment on table public.market_radar_catalog_scan_runs is
  'Retained audit evidence after compensating rollback; runtime V1 must remain disabled.';

notify pgrst, 'reload schema';
commit;
