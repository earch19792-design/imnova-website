begin;

-- Compensating rollback for the shadow observability layer.
-- No factory, legacy, dossier, transition or effect data is removed.
drop function if exists public.shadow_initialize_ebay_listing_factory_run_v1(
  uuid,text,uuid,timestamptz
);
drop view if exists public.ebay_listing_factory_shadow_bridge_coverage_v1;
drop view if exists public.ebay_listing_factory_dossier_utilization_v1;
drop view if exists public.ebay_listing_factory_intervention_baseline_v1;

notify pgrst, 'reload schema';

commit;
