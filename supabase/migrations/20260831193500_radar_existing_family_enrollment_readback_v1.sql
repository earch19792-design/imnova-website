-- Reuse the existing Radar read contract to expose the immutable identity,
-- current query lineage and enrollment metadata required by the bounded refresh.
create or replace function public.get_seller_os_family_market_radar_v1(
  p_family_id text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_legacy jsonb;
  v_families jsonb;
begin
  v_legacy := public.get_seller_os_family_market_radar_legacy_v1(
    p_family_id,p_limit);
  select coalesce(jsonb_agg(
    (family.value || jsonb_build_object(
      'familyIdentity',opportunity_case.family_identity,
      'currentFamilyQuerySet',to_jsonb(definition.family_query_set),
      'currentKeyProductAttributes',
        to_jsonb(definition.key_product_attributes),
      'currentMonitorEnrolledAt',current_enrollment.enrolled_at,
      'currentDemandKeywordDna',definition.demand_keyword_dna,
      'demandKeywordDnaStatus',case when definition.demand_keyword_dna is null
        then 'LEGACY_UNAVAILABLE' else 'AVAILABLE' end,
      'observationSeries',coalesce(observation_series.value,'[]'::jsonb)
    )) order by family.ordinality
  ),'[]'::jsonb) into v_families
  from jsonb_array_elements(coalesce(v_legacy -> 'families','[]'::jsonb))
    with ordinality family(value,ordinality)
  left join public.seller_os_market_opportunity_cases opportunity_case
    on opportunity_case.family_id = family.value ->> 'familyId'
  left join public.seller_os_market_family_definitions definition
    on definition.family_definition_version_id =
      opportunity_case.current_family_definition_version_id
  left join lateral (
    select enrollment.enrolled_at
    from public.seller_os_opportunity_monitor_enrollments enrollment
    where enrollment.family_id = opportunity_case.family_id
    order by enrollment.last_evaluated_at desc,
      enrollment.enrollment_id desc
    limit 1
  ) current_enrollment on true
  left join lateral (
    select coalesce(jsonb_agg(
      observation.value || jsonb_build_object(
        'demandKeywordDna',stored.demand_keyword_dna,
        'demandKeywordDnaStatus',case when stored.demand_keyword_dna is null
          then 'LEGACY_UNAVAILABLE' else 'AVAILABLE' end,
        'attributeProfile',stored.attribute_profile,
        'buyerIntentTerms',stored.buyer_intent_terms,
        'priceDistributionEvidence',
          to_jsonb(stored.price_distribution_evidence)
      ) order by observation.ordinality
    ),'[]'::jsonb) as value
    from jsonb_array_elements(coalesce(
      family.value -> 'observationSeries','[]'::jsonb))
      with ordinality observation(value,ordinality)
    left join public.seller_os_family_market_observations stored
      on stored.observation_id = observation.value ->> 'observationId'
  ) observation_series on true;
  return jsonb_set(v_legacy,'{families}',v_families,true) ||
    jsonb_build_object(
      'keywordDnaContractVersion','SELLER_OS_DEMAND_KEYWORD_DNA_V1',
      'priceDistributionReadContractVersion',
        'RADAR_AUTOMATIC_PRICE_DISTRIBUTION_CONTINUATION_V1',
      'existingFamilyRefreshContractVersion',
        'RADAR_EXISTING_FAMILY_REFRESH_V1'
    );
end;
$function$;

revoke all on function public.get_seller_os_family_market_radar_v1(text,integer)
  from public, anon, authenticated;
grant execute on function public.get_seller_os_family_market_radar_v1(text,integer)
  to service_role;

notify pgrst, 'reload schema';
