-- Existing LIVE listings do not necessarily have a Seller OS publication
-- package. Admit that absence only for the certified delegated Trading image
-- executor. Exact active-registry/task/manifest/delegation FKs and official
-- preflight/readback constraints remain mandatory. No execution is created.
begin;
alter table public.ebay_mayel_visual_phase_b_executions_v1
  alter column listing_package_id drop not null;
alter table public.ebay_mayel_visual_phase_b_executions_v1
  add constraint mayel_visual_existing_listing_package_scope_v1 check (
    listing_package_id is not null or (
      management_model = 'TRADING_MANAGED'
      and delegation_authority_id is not null
      and active_listing_id is not null
      and visual_task_id is not null
      and visual_manifest_id is not null
    )
  );
comment on constraint mayel_visual_existing_listing_package_scope_v1
  on public.ebay_mayel_visual_phase_b_executions_v1 is
  'An existing officially verified Trading listing can receive delegated images without inventing its original publication package. All execution guards remain in force.';
commit;
