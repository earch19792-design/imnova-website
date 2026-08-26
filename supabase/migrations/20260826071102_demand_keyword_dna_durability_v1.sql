-- Durable, evidence-bound keyword DNA for demand-first market families.
-- Existing family and observation rows remain readable with NULL DNA.

alter table public.seller_os_market_family_definitions
  add column demand_keyword_dna jsonb null;

alter table public.seller_os_family_market_observations
  add column demand_keyword_dna jsonb null;

create or replace function public.is_valid_seller_os_demand_keyword_dna_v1(
  p_value jsonb
)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_primary text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object'
    or p_value ->> 'contractVersion' <> 'SELLER_OS_DEMAND_KEYWORD_DNA_V1'
    or p_value ->> 'keywordEvidenceClass' <> 'OFFICIAL_SOLD_EVIDENCE'
    or coalesce(p_value ->> 'keywordEvidenceDigest','') !~
      '^sha256:[0-9a-f]{64}$'
    or coalesce(p_value ->> 'keywordEvidenceObservedAt','') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or jsonb_typeof(p_value -> 'soldWeightedTerms') <> 'array'
    or jsonb_array_length(p_value -> 'soldWeightedTerms') not between 1 and 30
    or jsonb_typeof(p_value -> 'highIntentModifiers') <> 'array'
    or jsonb_typeof(p_value -> 'attributeTerms') <> 'array'
    or jsonb_typeof(p_value -> 'useCaseTerms') <> 'array'
    or jsonb_typeof(p_value -> 'compatibilityTerms') <> 'array'
    or jsonb_typeof(p_value -> 'titleTokenStructure') <> 'array'
    or jsonb_array_length(p_value -> 'titleTokenStructure') not between 1 and 20
    or jsonb_typeof(p_value -> 'keywordEvidenceReferences') <> 'array'
    or jsonb_array_length(p_value -> 'keywordEvidenceReferences') not between 1 and 100
    or p_value #>> '{keywordDemandConfidence,scope}' <> 'FAMILY_LEVEL'
    or p_value #>> '{keywordDemandConfidence,status}' not in ('PROVEN','SUPPORTED')
    or (p_value #>> '{keywordDemandConfidence,exactProductDemandClaimed}')::boolean
       is distinct from false
    or p_value #>> '{keywordEvidenceFreshness,statusAtObservation}' <> 'FRESH'
    or coalesce(p_value #>> '{keywordEvidenceFreshness,maximumAgeSeconds}','')
       !~ '^[1-9][0-9]*$'
    or (p_value #>> '{keywordEvidenceFreshness,maximumAgeSeconds}')::integer
       not between 60 and 31622400 then
    return false;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_value -> 'keywordEvidenceReferences') item
    where jsonb_typeof(item) <> 'string'
      or length(trim(item #>> '{}')) not between 1 and 240
      or trim(item #>> '{}') ~ '[[:cntrl:]]'
  ) or exists (
    select 1 from jsonb_array_elements(p_value -> 'soldWeightedTerms')
      with ordinality item(value,ordinality)
    where jsonb_typeof(item.value) <> 'object'
      or length(trim(coalesce(item.value ->> 'term',''))) not between 1 and 120
      or item.value ->> 'familyType' not in (
        'CORE','FORM_FACTOR','FEATURE','USE_CASE','BENEFIT','PACK_FORMAT',
        'AUDIENCE','ATTRIBUTE'
      )
      or coalesce(item.value ->> 'soldListingsObserved','') !~ '^[1-9][0-9]*$'
      or coalesce(item.value ->> 'soldQuantityObserved','') !~ '^[1-9][0-9]*$'
      or item.value ->> 'weightRank' <> item.ordinality::text
      or jsonb_typeof(item.value -> 'evidenceReferences') <> 'array'
      or jsonb_array_length(item.value -> 'evidenceReferences') < 1
      or exists (
        select 1 from jsonb_array_elements_text(
          item.value -> 'evidenceReferences'
        ) reference(value)
        where not (p_value -> 'keywordEvidenceReferences') ? reference.value
      )
  ) or (
    select count(*) from jsonb_array_elements(p_value -> 'soldWeightedTerms') item
  ) <> (
    select count(distinct item ->> 'term')
    from jsonb_array_elements(p_value -> 'soldWeightedTerms') item
  ) then
    return false;
  end if;

  v_primary := p_value #>> '{soldWeightedTerms,0,term}';
  if length(trim(coalesce(p_value ->> 'primaryDemandKeyword',''))) not between 1 and 120
    or p_value ->> 'primaryDemandKeyword' is distinct from v_primary then
    return false;
  end if;

  if exists (
    select 1
    from unnest(array['highIntentModifiers','attributeTerms','useCaseTerms',
      'compatibilityTerms']) field(name)
    cross join lateral jsonb_array_elements(p_value -> field.name) item
    where jsonb_typeof(item) <> 'string'
      or not exists (
        select 1 from jsonb_array_elements(p_value -> 'soldWeightedTerms') term
        where term ->> 'term' = item #>> '{}'
      )
  ) or exists (
    select 1 from jsonb_array_elements(p_value -> 'titleTokenStructure') item
    where jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item -> 'tokens') <> 'array'
      or jsonb_array_length(item -> 'tokens') not between 1 and 30
      or exists (
        select 1 from jsonb_array_elements(item -> 'tokens') token
        where jsonb_typeof(token) <> 'string'
          or length(trim(token #>> '{}')) not between 1 and 60
      )
      or coalesce(item ->> 'soldQuantityObserved','') !~ '^[1-9][0-9]*$'
      or jsonb_typeof(item -> 'evidenceReferences') <> 'array'
      or jsonb_array_length(item -> 'evidenceReferences') < 1
      or exists (
        select 1 from jsonb_array_elements_text(
          item -> 'evidenceReferences'
        ) reference(value)
        where not (p_value -> 'keywordEvidenceReferences') ? reference.value
      )
  ) then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$function$;

create or replace function public.attach_seller_os_demand_keyword_dna_v1()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_setting text;
  v_dna jsonb;
  v_definition_dna jsonb;
begin
  v_setting := current_setting('seller_os.demand_keyword_dna', true);
  v_dna := case when coalesce(v_setting,'') = '' then null
    else v_setting::jsonb end;
  select definition.demand_keyword_dna into v_definition_dna
  from public.seller_os_market_family_definitions definition
  where definition.family_definition_version_id =
    new.family_definition_version_id;
  if v_definition_dna is distinct from v_dna then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_KEYWORD_DNA_MISMATCH';
  end if;
  new.demand_keyword_dna := v_dna;
  return new;
end;
$function$;

create trigger seller_os_family_market_observation_keyword_dna_attach
before insert on public.seller_os_family_market_observations
for each row execute function
  public.attach_seller_os_demand_keyword_dna_v1();

create function public.put_seller_os_family_market_observation_v1(
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
  p_limitations text[],
  p_demand_keyword_dna jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_definition public.seller_os_market_family_definitions%rowtype;
  v_existing public.seller_os_family_market_observations%rowtype;
  v_observation_id text;
  v_references text[];
  v_dna_references text[];
  v_expected_confidence text;
  v_result jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
    or not public.is_valid_seller_os_demand_keyword_dna_v1(
      p_demand_keyword_dna)
    or p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'
    or p_source_status <> 'AVAILABLE'
    or p_keyword_state <> 'AVAILABLE' then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_KEYWORD_DNA_INVALID';
  end if;
  select * into v_definition
  from public.seller_os_market_family_definitions definition
  where definition.family_definition_version_id =
      p_family_definition_version_id
    and definition.opportunity_case_id = p_opportunity_case_id;
  if not found or v_definition.demand_keyword_dna is distinct from
      p_demand_keyword_dna then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_KEYWORD_DNA_MISMATCH';
  end if;
  select array_agg(value order by value collate "C") into v_references
  from unnest(p_demand_evidence_references) item(value);
  select array_agg(value order by value collate "C") into v_dna_references
  from jsonb_array_elements_text(
    p_demand_keyword_dna -> 'keywordEvidenceReferences') item(value);
  v_expected_confidence := case
    when coalesce(p_sold_comparable_count,0) >= 5
      and coalesce(p_sold_quantity,0) >= 10 then 'PROVEN'
    else 'SUPPORTED' end;
  if v_dna_references is distinct from v_references
    or (p_demand_keyword_dna ->> 'keywordEvidenceObservedAt')::timestamptz
      is distinct from p_evidence_observed_at
    or (p_demand_keyword_dna #>>
      '{keywordEvidenceFreshness,maximumAgeSeconds}')::integer
      is distinct from p_maximum_age_seconds
    or p_demand_keyword_dna #>> '{keywordDemandConfidence,status}'
      is distinct from v_expected_confidence then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_KEYWORD_DNA_BINDING_INVALID';
  end if;

  v_observation_id := 'family-market-observation-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_FAMILY_MARKET_OBSERVATION_V1', E'\n',
      v_definition.family_id, E'\n',
      to_char(p_observation_window_start at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), E'\n',
      to_char(p_observation_window_end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ), 'UTF8'), 'sha256'), 'hex');
  select * into v_existing
  from public.seller_os_family_market_observations observation
  where observation.observation_id = v_observation_id;
  if found and v_existing.demand_keyword_dna is distinct from
      p_demand_keyword_dna then
    raise exception 'SELLER_OS_FAMILY_MARKET_OBSERVATION_REPLAY_CONFLICT';
  end if;

  perform set_config('seller_os.demand_keyword_dna',
    p_demand_keyword_dna::text, true);
  select public.put_seller_os_family_market_observation_v1(
    p_opportunity_case_id,p_family_definition_version_id,
    p_observation_window_start,p_observation_window_end,
    p_demand_evidence_class,p_source_status,p_aggregation_semantics,
    p_demand_evidence_references,p_sold_comparable_count,p_sold_quantity,
    p_active_comparable_count,p_seller_diversity,p_price_currency,
    p_price_band_minimum,p_price_band_maximum,p_price_median,
    p_price_distribution_evidence,p_competition_state,p_buyer_intent_terms,
    p_keyword_state,p_attribute_profile,p_opportunity_types,
    p_evidence_observed_at,p_source_updated_at,p_maximum_age_seconds,
    p_source_adapter,p_source_contract_version,p_momentum_policy_version,
    p_limitations
  ) into v_result;
  perform set_config('seller_os.demand_keyword_dna','',true);
  return v_result || jsonb_build_object(
    'demandKeywordDnaStatus','AVAILABLE',
    'keywordEvidenceDigest',p_demand_keyword_dna ->> 'keywordEvidenceDigest'
  );
end;
$function$;

alter table public.seller_os_market_family_definitions
  add constraint seller_os_market_family_definition_keyword_dna_check
  check (demand_keyword_dna is null or
    public.is_valid_seller_os_demand_keyword_dna_v1(demand_keyword_dna));

alter table public.seller_os_family_market_observations
  add constraint seller_os_family_market_observation_keyword_dna_check
  check (demand_keyword_dna is null or
    public.is_valid_seller_os_demand_keyword_dna_v1(demand_keyword_dna));

drop function public.put_seller_os_market_opportunity_case_v1(
  jsonb,text,text[],text[],text[],text,text
);

create function public.put_seller_os_market_opportunity_case_v1(
  p_family_identity jsonb,
  p_family_name text,
  p_family_query_set text[],
  p_key_product_attributes text[],
  p_key_buyer_intent_terms text[],
  p_adapter_contract text,
  p_adapter_version text,
  p_demand_keyword_dna jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_family_id text;
  v_case_id text;
  v_queries text[];
  v_attributes text[];
  v_intent text[];
  v_definition_digest text;
  v_definition_id text;
  v_definition_material text;
  v_existing public.seller_os_market_opportunity_cases%rowtype;
  v_definition public.seller_os_market_family_definitions%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or not public.is_valid_seller_os_market_family_identity_v1(p_family_identity)
    or length(trim(coalesce(p_family_name, ''))) not between 1 and 120
    or coalesce(p_family_name, '') ~ '[[:cntrl:]]'
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_family_query_set, 1, 16)
    or exists (select 1 from unnest(p_family_query_set) query(value)
      where query.value !~ '^[ -~]+$')
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_key_product_attributes, 1, 32)
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_key_buyer_intent_terms, 1, 32)
    or coalesce(p_adapter_contract, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    or coalesce(p_adapter_version, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    or (p_demand_keyword_dna is not null and not
      public.is_valid_seller_os_demand_keyword_dna_v1(
        p_demand_keyword_dna)) then
    raise exception 'SELLER_OS_MARKET_OPPORTUNITY_CASE_INPUT_INVALID';
  end if;

  select array_agg(value order by value collate "C") into v_queries
  from unnest(p_family_query_set) item(value);
  select array_agg(value order by value collate "C") into v_attributes
  from unnest(p_key_product_attributes) item(value);
  select array_agg(value order by value collate "C") into v_intent
  from unnest(p_key_buyer_intent_terms) item(value);

  v_family_id := public.seller_os_market_family_id_v1(p_family_identity);
  v_case_id := public.seller_os_opportunity_case_id_v1(v_family_id);
  v_definition_material := concat(
    'SELLER_OS_MARKET_FAMILY_DEFINITION_V1', E'\n', v_family_id, E'\n',
    trim(p_family_name), E'\n', array_to_json(v_queries)::text, E'\n',
    array_to_json(v_attributes)::text, E'\n', array_to_json(v_intent)::text,
    E'\n', p_adapter_contract, E'\n', p_adapter_version
  );
  if p_demand_keyword_dna is not null then
    v_definition_material := concat(v_definition_material, E'\n',
      p_demand_keyword_dna ->> 'contractVersion', E'\n',
      p_demand_keyword_dna ->> 'keywordEvidenceDigest');
  end if;
  v_definition_digest := 'sha256:' || encode(extensions.digest(
    convert_to(v_definition_material, 'UTF8'), 'sha256'), 'hex');
  v_definition_id := 'market-family-definition-v1:' || v_definition_digest;

  perform pg_advisory_xact_lock(hashtextextended(v_family_id, 0));
  set constraints seller_os_market_opportunity_case_current_definition_fk deferred;
  insert into public.seller_os_market_opportunity_cases (
    opportunity_case_id, family_id, family_identity, family_name,
    current_family_definition_version_id
  ) values (
    v_case_id, v_family_id, p_family_identity, trim(p_family_name), v_definition_id
  ) on conflict (family_id) do nothing;

  select * into v_existing from public.seller_os_market_opportunity_cases
  where family_id = v_family_id for update;
  if not found or v_existing.opportunity_case_id is distinct from v_case_id
    or v_existing.family_identity is distinct from p_family_identity then
    raise exception 'SELLER_OS_MARKET_OPPORTUNITY_CASE_REPLAY_CONFLICT';
  end if;

  insert into public.seller_os_market_family_definitions (
    family_definition_version_id, family_id, opportunity_case_id,
    family_name, family_query_set, key_product_attributes,
    key_buyer_intent_terms, adapter_contract, adapter_version,
    definition_digest, demand_keyword_dna
  ) values (
    v_definition_id, v_family_id, v_case_id, trim(p_family_name),
    v_queries, v_attributes, v_intent, p_adapter_contract,
    p_adapter_version, v_definition_digest, p_demand_keyword_dna
  ) on conflict (family_definition_version_id) do nothing;

  select * into v_definition from public.seller_os_market_family_definitions
  where family_definition_version_id = v_definition_id;
  if not found or v_definition.family_id is distinct from v_family_id
    or v_definition.opportunity_case_id is distinct from v_case_id
    or v_definition.demand_keyword_dna is distinct from p_demand_keyword_dna then
    raise exception 'SELLER_OS_MARKET_OPPORTUNITY_CASE_REPLAY_CONFLICT';
  end if;

  update public.seller_os_market_opportunity_cases
  set current_family_definition_version_id = v_definition_id,
      family_name = trim(p_family_name), updated_at = now()
  where family_id = v_family_id
    and current_family_definition_version_id is distinct from v_definition_id;

  return jsonb_build_object(
    'outcome',case when v_existing.current_family_definition_version_id =
      v_definition_id then 'IDEMPOTENT_SUCCESS' else 'DEFINITION_ADVANCED' end,
    'familyId',v_family_id,'opportunityCaseId',v_case_id,
    'familyDefinitionVersionId',v_definition_id,
    'demandKeywordDnaStatus',case when p_demand_keyword_dna is null then
      'LEGACY_UNAVAILABLE' else 'AVAILABLE' end,
    'phase7Authority','FUTURE_CANONICAL_AUTHORITY'
  );
end;
$function$;

alter function public.get_seller_os_family_market_radar_v1(text,integer)
  rename to get_seller_os_family_market_radar_legacy_v1;

create function public.get_seller_os_family_market_radar_v1(
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
          then 'LEGACY_UNAVAILABLE' else 'AVAILABLE' end
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

revoke all on function public.is_valid_seller_os_demand_keyword_dna_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.attach_seller_os_demand_keyword_dna_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.get_seller_os_family_market_radar_legacy_v1(
  text,integer) from public, anon, authenticated, service_role;
revoke all on function public.get_seller_os_family_market_radar_v1(text,integer)
  from public, anon, authenticated;
grant execute on function public.get_seller_os_family_market_radar_v1(text,integer)
  to service_role;
revoke all on function public.put_seller_os_market_opportunity_case_v1(
  jsonb,text,text[],text[],text[],text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.put_seller_os_market_opportunity_case_v1(
  jsonb,text,text[],text[],text[],text,text,jsonb
) to service_role;
revoke all on function public.put_seller_os_family_market_observation_v1(
  text,text,timestamptz,timestamptz,text,text,text,text[],integer,integer,
  integer,integer,text,numeric,numeric,numeric,text[],text,text[],text,jsonb,
  text[],timestamptz,timestamptz,integer,text,text,text,text[],jsonb
) from public, anon, authenticated;
grant execute on function public.put_seller_os_family_market_observation_v1(
  text,text,timestamptz,timestamptz,text,text,text,text[],integer,integer,
  integer,integer,text,numeric,numeric,numeric,text[],text,text[],text,jsonb,
  text[],timestamptz,timestamptz,integer,text,text,text,text[],jsonb
) to service_role;

comment on column public.seller_os_market_family_definitions.demand_keyword_dna is
  'Optional for legacy definitions; required by the demand-first sold-evidence adapter and immutable with its definition version.';
comment on column public.seller_os_family_market_observations.demand_keyword_dna is
  'Structured official-sold keyword evidence duplicated only as bounded durable DNA and bound exactly to the immutable observation.';

notify pgrst, 'reload schema';
