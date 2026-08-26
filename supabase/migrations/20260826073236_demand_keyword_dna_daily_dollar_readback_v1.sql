-- Complete the existing bounded Radar read authority for Daily Dollar.
-- Direct reads from the append-only family tables intentionally remain revoked.

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
    select coalesce(jsonb_agg(
      observation.value || jsonb_build_object(
        'demandKeywordDna',stored.demand_keyword_dna,
        'demandKeywordDnaStatus',case when stored.demand_keyword_dna is null
          then 'LEGACY_UNAVAILABLE' else 'AVAILABLE' end,
        'attributeProfile',stored.attribute_profile,
        'buyerIntentTerms',stored.buyer_intent_terms
      ) order by observation.ordinality
    ),'[]'::jsonb) as value
    from jsonb_array_elements(coalesce(
      family.value -> 'observationSeries','[]'::jsonb))
      with ordinality observation(value,ordinality)
    left join public.seller_os_family_market_observations stored
      on stored.observation_id = observation.value ->> 'observationId'
  ) observation_series on true;
  return jsonb_set(v_legacy,'{families}',v_families,true) ||
    jsonb_build_object('keywordDnaContractVersion',
      'SELLER_OS_DEMAND_KEYWORD_DNA_V1');
end;
$function$;

revoke all on function public.get_seller_os_family_market_radar_v1(text,integer)
  from public, anon, authenticated;
grant execute on function public.get_seller_os_family_market_radar_v1(text,integer)
  to service_role;

notify pgrst, 'reload schema';
