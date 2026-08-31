-- Refresh an existing canonical family from new official sold evidence without
-- creating a successor family ID. The existing writer remains authoritative;
-- its only new input shape is a bounded category overlay for the demand-first
-- adapter. Existing Product Truth/family identity fields remain immutable.

create or replace function public.put_seller_os_family_market_observation_v1(
  p_opportunity_case_id text,
  p_family_definition_version_id text,
  p_observation_window_start timestamptz,
  p_observation_window_end timestamptz,
  p_demand_evidence_class text,
  p_source_status text,
  p_aggregation_semantics text,
  p_demand_evidence_references text[],
  p_sold_comparable_count integer,
  p_sold_quantity integer,
  p_active_comparable_count integer,
  p_seller_diversity integer,
  p_price_currency text,
  p_price_band_minimum numeric,
  p_price_band_maximum numeric,
  p_price_median numeric,
  p_price_distribution_evidence text[],
  p_competition_state text,
  p_buyer_intent_terms text[],
  p_keyword_state text,
  p_attribute_profile jsonb,
  p_opportunity_types text[],
  p_evidence_observed_at timestamptz,
  p_source_updated_at timestamptz,
  p_maximum_age_seconds integer,
  p_source_adapter text,
  p_source_contract_version text,
  p_momentum_policy_version text,
  p_limitations text[]
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_case public.seller_os_market_opportunity_cases%rowtype;
  v_definition public.seller_os_market_family_definitions%rowtype;
  v_previous public.seller_os_family_market_observations%rowtype;
  v_existing public.seller_os_family_market_observations%rowtype;
  v_observation_id text;
  v_family_demand_status text;
  v_momentum_status text := 'INSUFFICIENT_HISTORY';
  v_momentum_fields text[] := '{}';
  v_sold_change numeric;
  v_active_change numeric;
  v_comparable_change numeric;
  v_sold_evidence jsonb;
  v_source_material_digest text;
  v_demand_evidence_digest text;
  v_input_digest text;
  v_references text[];
  v_price_evidence text[];
  v_buyer_intent text[];
  v_opportunity_types text[];
  v_limitations text[];
  v_binding jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_opportunity_case_id, '') !~
      '^opportunity-case-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_family_definition_version_id, '') !~
      '^market-family-definition-v1:sha256:[0-9a-f]{64}$'
    or p_observation_window_start is null
    or p_observation_window_end is null
    or p_observation_window_start >= p_observation_window_end
    or p_observation_window_end - p_observation_window_start >
      interval '366 days'
    or p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'
    or p_source_status not in ('AVAILABLE','UNAVAILABLE','FAILED')
    or p_aggregation_semantics not in (
      'WINDOW_DELTA','CUMULATIVE_SNAPSHOT'
    )
    or not public.seller_os_market_evidence_references_exist_v1(
      p_demand_evidence_references, p_demand_evidence_class
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      coalesce(p_price_distribution_evidence, '{}'), 0, 100
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_buyer_intent_terms, 1, 32
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_opportunity_types, 1, 16
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      coalesce(p_limitations, '{}'), 0, 64
    )
    or p_competition_state not in ('LOW','MODERATE','HIGH','UNPROVEN')
    or p_keyword_state not in ('AVAILABLE','UNPROVEN','UNAVAILABLE')
    or jsonb_typeof(p_attribute_profile) <> 'object'
    or p_evidence_observed_at is null
    or p_evidence_observed_at > p_observation_window_end + interval '5 minutes'
    or p_observation_window_start > now() + interval '5 minutes'
    or p_observation_window_end > now() + interval '5 minutes'
    or p_evidence_observed_at > now() + interval '5 minutes'
    or (p_source_updated_at is not null and (
      p_source_updated_at > now() + interval '5 minutes'
      or p_source_updated_at > p_evidence_observed_at + interval '5 minutes'
    ))
    or p_maximum_age_seconds not between 60 and 31622400
    or coalesce(p_source_adapter, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    or coalesce(p_source_contract_version, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    or coalesce(p_momentum_policy_version, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$' then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_INPUT_INVALID';
  end if;

  select array_agg(value order by value collate "C") into v_references
  from unnest(p_demand_evidence_references) item(value);
  select coalesce(array_agg(value order by value collate "C"), '{}')
    into v_price_evidence
  from unnest(coalesce(p_price_distribution_evidence, '{}')) item(value);
  select array_agg(value order by value collate "C") into v_buyer_intent
  from unnest(p_buyer_intent_terms) item(value);
  select array_agg(value order by value collate "C") into v_opportunity_types
  from unnest(p_opportunity_types) item(value);
  select coalesce(array_agg(value order by value collate "C"), '{}')
    into v_limitations
  from unnest(coalesce(p_limitations, '{}')) item(value);

  select * into v_case
  from public.seller_os_market_opportunity_cases
  where opportunity_case_id = p_opportunity_case_id for update;
  if not found then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_CASE_INVALID';
  end if;
  select * into v_definition
  from public.seller_os_market_family_definitions definition
  where definition.family_id = v_case.family_id
    and definition.opportunity_case_id = v_case.opportunity_case_id
    and definition.family_definition_version_id =
      p_family_definition_version_id;
  if not found
    or v_case.status <> 'MONITORING'
    or v_case.current_family_definition_version_id is distinct from
      p_family_definition_version_id
    or v_buyer_intent is distinct from
      v_definition.key_buyer_intent_terms
    or not (
      p_attribute_profile is not distinct from
        v_case.family_identity -> 'structuredDefinition'
      or (
        p_source_adapter = 'SELLER_OS_PRODUCT_RESEARCH_FAMILY_ADAPTER_V1'
        and p_source_contract_version =
          'EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE'
        and v_definition.adapter_contract =
          'SELLER_OS_DEMAND_FIRST_BROAD_NET_ORCHESTRATOR_V1'
        and p_attribute_profile @>
          (v_case.family_identity -> 'structuredDefinition')
        and (p_attribute_profile ->> 'category id') ~ '^[0-9]+$'
        and lower(p_attribute_profile ->> 'product family') =
          lower(v_case.family_name)
        and v_definition.key_product_attributes @>
          array['category id','product family']::text[]
        and not exists (
          select 1
          from jsonb_object_keys(p_attribute_profile) key(value)
          where not (v_case.family_identity -> 'structuredDefinition') ? key.value
            and key.value not in ('category id','product family')
        )
      )
    )
    or v_opportunity_types is distinct from
      array['DEMAND_FIRST_TEST_LAUNCH']::text[] then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_CASE_INVALID';
  end if;
  v_binding := public.seller_os_family_market_evidence_binding_v1(
    v_references, p_family_definition_version_id, p_demand_evidence_class
  );
  if v_binding is null
    or v_binding ->> 'familyId' is distinct from v_case.family_id
    or v_binding ->> 'familyDefinitionVersionId' is distinct from
      p_family_definition_version_id
    or p_observation_window_start is distinct from
      (v_binding ->> 'observationWindowStart')::timestamptz
    or p_observation_window_end is distinct from
      (v_binding ->> 'observationWindowEnd')::timestamptz
    or p_evidence_observed_at is distinct from
      (v_binding ->> 'evidenceObservedAt')::timestamptz
    or p_source_updated_at is distinct from
      (v_binding ->> 'sourceUpdatedAt')::timestamptz
    or p_maximum_age_seconds is distinct from
      (v_binding ->> 'maximumAgeSeconds')::integer
    or p_source_status is distinct from v_binding ->> 'sourceStatus'
    or p_aggregation_semantics is distinct from
      v_binding ->> 'aggregationSemantics'
    or p_source_adapter is distinct from v_binding ->> 'sourceAdapter'
    or p_source_contract_version is distinct from
      v_binding ->> 'sourceContractVersion'
    or p_momentum_policy_version is distinct from
      v_binding ->> 'momentumPolicyVersion'
    or v_binding ->> 'familyQueryBinding' <> 'MATCHED'
    or p_active_comparable_count is not null
    or p_competition_state <> 'UNPROVEN'
    or p_keyword_state <> 'AVAILABLE' then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_SOURCE_BINDING_INVALID';
  end if;
  if p_demand_evidence_class = 'OFFICIAL_SOLD_EVIDENCE' and (
      p_source_status <> 'AVAILABLE'
      or p_active_comparable_count is not null
      or p_competition_state <> 'UNPROVEN'
      or (p_price_band_minimum is not null and p_price_currency <> 'USD')
      or not public.seller_os_official_sold_evidence_summary_matches_v1(
        v_references, p_sold_comparable_count, p_sold_quantity,
        p_seller_diversity, p_price_band_minimum, p_price_band_maximum,
        p_price_median, v_price_evidence
      )
    ) then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_FACTS_UNVERIFIED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_case.family_id || ':I02R_OBSERVATION', 0
  ));

  v_source_material_digest :=
    public.seller_os_market_evidence_material_digest_v1(v_references);
  if v_source_material_digest is null then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_SOURCE_UNVERIFIED';
  end if;
  v_demand_evidence_digest := 'sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_FAMILY_MARKET_EVIDENCE_DIGEST_V1', E'\n',
      v_source_material_digest, E'\n', v_binding::text, E'\n',
      jsonb_build_object(
      'demandEvidenceClass',p_demand_evidence_class,
      'sourceStatus',p_source_status,
      'aggregationSemantics',p_aggregation_semantics,
      'demandEvidenceReferences',to_jsonb(v_references),
      'soldComparableCount',p_sold_comparable_count,
      'soldQuantity',p_sold_quantity,
      'activeComparableCount',p_active_comparable_count,
      'sellerDiversity',p_seller_diversity,
      'priceCurrency',p_price_currency,
      'priceBandMinimum',p_price_band_minimum,
      'priceBandMaximum',p_price_band_maximum,
      'priceMedian',p_price_median,
      'priceDistributionEvidence',to_jsonb(v_price_evidence)
    )::text), 'UTF8'), 'sha256'), 'hex'
  );

  v_input_digest := 'sha256:' || encode(extensions.digest(convert_to(
    jsonb_build_object(
      'opportunityCaseId',p_opportunity_case_id,
      'familyDefinitionVersionId',p_family_definition_version_id,
      'observationWindowStart',to_char(
        p_observation_window_start at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'observationWindowEnd',to_char(
        p_observation_window_end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'demandEvidenceClass',p_demand_evidence_class,
      'sourceStatus',p_source_status,
      'aggregationSemantics',p_aggregation_semantics,
      'demandEvidenceReferences',to_jsonb(v_references),
      'demandEvidenceDigest',v_demand_evidence_digest,
      'soldComparableCount',p_sold_comparable_count,
      'soldQuantity',p_sold_quantity,
      'activeComparableCount',p_active_comparable_count,
      'sellerDiversity',p_seller_diversity,
      'priceCurrency',p_price_currency,
      'priceBandMinimum',p_price_band_minimum,
      'priceBandMaximum',p_price_band_maximum,
      'priceMedian',p_price_median,
      'priceDistributionEvidence',to_jsonb(v_price_evidence),
      'competitionState',p_competition_state,
      'buyerIntentTerms',to_jsonb(v_buyer_intent),
      'keywordState',p_keyword_state,
      'attributeProfile',p_attribute_profile,
      'opportunityTypes',to_jsonb(v_opportunity_types),
      'evidenceObservedAt',to_char(p_evidence_observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'sourceUpdatedAt',case when p_source_updated_at is null then null else
        to_char(p_source_updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
      'maximumAgeSeconds',p_maximum_age_seconds,
      'sourceAdapter',p_source_adapter,
      'sourceContractVersion',p_source_contract_version,
      'momentumPolicyVersion',p_momentum_policy_version,
      'limitations',to_jsonb(v_limitations)
    )::text, 'UTF8'), 'sha256'), 'hex');

  v_observation_id := 'family-market-observation-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_FAMILY_MARKET_OBSERVATION_V1', E'\n', v_case.family_id,
      E'\n', to_char(p_observation_window_start at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), E'\n',
      to_char(p_observation_window_end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ), 'UTF8'), 'sha256'), 'hex'
  );
  select * into v_existing
  from public.seller_os_family_market_observations
  where observation_id = v_observation_id;
  if found then
    if v_existing.observation_input_digest is distinct from v_input_digest then
      raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object(
      'outcome','IDEMPOTENT_SUCCESS','familyId',v_existing.family_id,
      'opportunityCaseId',v_existing.opportunity_case_id,
      'observationId',v_existing.observation_id,
      'momentumStatus',v_existing.momentum_status,
      'writerEvidenceAuthority','OFFICIAL_SOLD_EVIDENCE_ONLY_V1'
    );
  end if;

  if exists (
    select 1 from public.seller_os_family_market_observations observation
    where observation.family_id = v_case.family_id
      and tstzrange(observation.observation_window_start,
        observation.observation_window_end, '[)') &&
        tstzrange(p_observation_window_start, p_observation_window_end, '[)')
      and not (
        observation.observation_window_start = p_observation_window_start
        and observation.observation_window_end = p_observation_window_end
      )
  ) then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_WINDOW_CONFLICT';
  end if;
  if exists (
    select 1 from public.seller_os_family_market_observations observation
    where observation.family_id = v_case.family_id
      and observation.observation_window_end > p_observation_window_start
  ) then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_BACKFILL_REJECTED';
  end if;

  v_family_demand_status := case
    when p_source_status = 'UNAVAILABLE' then 'FAMILY_DEMAND_UNAVAILABLE'
    when p_source_status = 'AVAILABLE'
      and p_demand_evidence_class = 'OFFICIAL_SOLD_EVIDENCE'
      and coalesce(p_sold_comparable_count, 0) >= 5
      and coalesce(p_sold_quantity, 0) >= 10
      then 'FAMILY_DEMAND_PROVEN'
    when p_source_status = 'AVAILABLE'
      and p_demand_evidence_class = 'OFFICIAL_SOLD_EVIDENCE'
      and coalesce(p_sold_comparable_count, 0) > 0
      and coalesce(p_sold_quantity, 0) > 0
      then 'FAMILY_DEMAND_SUPPORTED'
    else 'FAMILY_DEMAND_UNPROVEN'
  end;
  v_sold_evidence := case when p_sold_quantity is null then null else
    jsonb_build_object(
      'quantity', p_sold_quantity,
      'authorityClass', case when p_demand_evidence_class =
        'OFFICIAL_SOLD_EVIDENCE' then 'OFFICIAL_EXTERNAL_FACT'
        else 'UNPROVEN' end,
      'evidenceReferences', to_jsonb(v_references)
    ) end;

  select * into v_previous
  from public.seller_os_family_market_observations observation
  where observation.family_id = v_case.family_id
    and observation.observation_window_end <= p_observation_window_start
  order by observation.observation_window_end desc limit 1;

  if found
    and v_previous.demand_evidence_class = 'OFFICIAL_SOLD_EVIDENCE'
    and p_demand_evidence_class = 'OFFICIAL_SOLD_EVIDENCE'
    and v_previous.aggregation_semantics = p_aggregation_semantics
    and v_previous.family_definition_version_id =
      p_family_definition_version_id
    and v_previous.source_adapter = p_source_adapter
    and v_previous.source_contract_version = p_source_contract_version
    and v_previous.sold_quantity is not null
    and p_sold_quantity is not null
    and abs(extract(epoch from (
      (v_previous.observation_window_end -
        v_previous.observation_window_start) -
      (p_observation_window_end - p_observation_window_start)
    ))) <= least(
      86400.0,
      greatest(300.0, extract(epoch from (
        v_previous.observation_window_end -
        v_previous.observation_window_start
      )) * 0.10)
    ) then
    v_sold_change := case when v_previous.sold_quantity = 0 then
      case when p_sold_quantity = 0 then 0 else 1000000 end
      else (p_sold_quantity - v_previous.sold_quantity)::numeric /
        v_previous.sold_quantity end;
    v_active_change := case
      when v_previous.active_comparable_count is null
        or p_active_comparable_count is null then null
      when v_previous.active_comparable_count = 0 then
        case when p_active_comparable_count = 0 then 0 else 1000000 end
      else (p_active_comparable_count -
        v_previous.active_comparable_count)::numeric /
        v_previous.active_comparable_count end;
    v_comparable_change := case
      when v_previous.sold_comparable_count = 0 then
        case when p_sold_comparable_count = 0 then 0 else 1000000 end
      else (p_sold_comparable_count -
        v_previous.sold_comparable_count)::numeric /
        v_previous.sold_comparable_count end;
    v_momentum_fields := array[
      'soldQuantityEvidence.quantity','soldComparableCount',
      'observationWindowStart','observationWindowEnd'
    ];
    if v_active_change is not null then
      v_momentum_fields := v_momentum_fields || 'activeComparableCount';
    end if;
    v_momentum_status := case
      when v_previous.sold_quantity = 0 and p_sold_quantity > 0 then 'NEW'
      when (coalesce(v_active_change, -1000000) >= 0.25
        or v_comparable_change >= 0.25) and abs(v_sold_change) <= 0.05
        then 'SATURATING'
      when v_sold_change >= 0.20 then 'STRENGTHENING'
      when v_sold_change <= -0.20 then 'WEAKENING'
      else 'STABLE'
    end;
  end if;

  insert into public.seller_os_family_market_observations (
    observation_id, family_id, opportunity_case_id,
    family_definition_version_id, observation_window_start,
    observation_window_end, family_demand_status, demand_evidence_class,
    source_status, aggregation_semantics, demand_evidence_references,
    demand_evidence_digest, observation_input_digest,
    sold_comparable_count, sold_quantity,
    sold_quantity_evidence, active_comparable_count, seller_diversity,
    price_currency, price_band_minimum, price_band_maximum, price_median,
    price_distribution_evidence, competition_state, buyer_intent_terms,
    keyword_state, attribute_profile, opportunity_types,
    evidence_observed_at, source_updated_at, maximum_age_seconds,
    source_adapter, source_contract_version, previous_observation_id,
    momentum_status, momentum_evidence_fields, momentum_policy_version,
    limitations
  ) values (
    v_observation_id, v_case.family_id, v_case.opportunity_case_id,
    p_family_definition_version_id, p_observation_window_start,
    p_observation_window_end, v_family_demand_status,
    p_demand_evidence_class, p_source_status, p_aggregation_semantics,
    v_references, v_demand_evidence_digest, v_input_digest,
    p_sold_comparable_count, p_sold_quantity, v_sold_evidence,
    p_active_comparable_count, p_seller_diversity, p_price_currency,
    p_price_band_minimum, p_price_band_maximum, p_price_median,
    v_price_evidence, p_competition_state,
    v_buyer_intent, p_keyword_state, p_attribute_profile,
    v_opportunity_types, p_evidence_observed_at, p_source_updated_at,
    p_maximum_age_seconds, p_source_adapter, p_source_contract_version,
    v_previous.observation_id, v_momentum_status, v_momentum_fields,
    p_momentum_policy_version, v_limitations
  ) returning * into v_existing;

  return jsonb_build_object(
    'outcome','CREATED','familyId',v_existing.family_id,
    'opportunityCaseId',v_existing.opportunity_case_id,
    'observationId',v_existing.observation_id,
    'familyDemandStatus',v_existing.family_demand_status,
    'momentumStatus',v_existing.momentum_status,
    'writerEvidenceAuthority','OFFICIAL_SOLD_EVIDENCE_ONLY_V1',
    'phase7Authority','FUTURE_CANONICAL_AUTHORITY'
  );
end;
$function$;

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

