begin;

-- Compensating rollback: disable V2 and remove executable/read projections.
-- Audit tables and captured evidence remain intact.
update public.ebay_luna_selector_policies_v2
set enabled = false,
    shadow_mode = true,
    updated_at = now()
where policy_version = 'EBAY_LUNA_SELECTOR_V2_SHADOW_2026_07_26';

revoke all on function public.claim_ebay_commercial_scan_tasks_v2(
  uuid,
  text,
  integer,
  integer
) from service_role;
revoke all on function public.complete_ebay_commercial_scan_task_v2(
  uuid,
  uuid,
  text,
  jsonb
) from service_role;
revoke all on function public.defer_ebay_commercial_scan_task_v2(
  uuid,
  uuid,
  text,
  timestamptz,
  text
) from service_role;
revoke all on function public.create_ebay_luna_scan_cohort_v2(uuid, timestamptz)
  from service_role;

drop function if exists public.claim_ebay_commercial_scan_tasks_v2(
  uuid,
  text,
  integer,
  integer
);
drop function if exists public.complete_ebay_commercial_scan_task_v2(
  uuid,
  uuid,
  text,
  jsonb
);
drop function if exists public.defer_ebay_commercial_scan_task_v2(
  uuid,
  uuid,
  text,
  timestamptz,
  text
);
drop function if exists public.create_ebay_luna_scan_cohort_v2(
  uuid,
  timestamptz
);
drop view if exists public.ebay_luna_selector_v2_shadow_metrics;

commit;
