-- Compensating rollback: disable new mutations while preserving all audit rows.

begin;

revoke execute on function public.create_product_research_query_plan_v3(
  uuid, text, uuid, text, text, integer, jsonb
) from service_role;
revoke execute on function public.recompute_product_research_selector_v2(
  text, text[], text, timestamptz
) from service_role;

update public.marketplace_product_research_deferred_query_groups_v2
set status = 'CANCELLED',
    updated_at = clock_timestamp()
where status = 'DEFERRED';

update public.ebay_luna_opportunity_queue
set demand_validation_passed = false,
    assessment = jsonb_set(
      coalesce(assessment, '{}'::jsonb),
      '{demand,rollback}',
      jsonb_build_object(
        'code', 'PRODUCT_RESEARCH_SELECTOR_V2_DISABLED',
        'rolledBackAt', clock_timestamp()
      ),
      true
    ),
    updated_at = clock_timestamp()
where demand_policy_version is not null
  and demand_evaluated_at is not null;

notify pgrst, 'reload schema';

commit;
