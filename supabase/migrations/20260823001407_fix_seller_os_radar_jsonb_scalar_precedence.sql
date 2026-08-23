-- OP-LAUNCH-I02S targeted corrective artifact only.
-- The applied I02R artifact remains immutable. These replacements preserve the
-- existing signatures, volatility, security, search_path and grants while
-- making JSONB scalar extraction bind before text concatenation.

create or replace function public.seller_os_market_family_id_v1(
  p_identity jsonb
)
returns text
language plpgsql immutable strict security invoker
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_structured text;
begin
  if not public.is_valid_seller_os_market_family_identity_v1(p_identity) then
    raise exception 'SELLER_OS_MARKET_FAMILY_IDENTITY_INVALID';
  end if;
  select string_agg(item.key || '=' || (item.value #>> '{}'), E'\n'
                    order by item.key collate "C")
    into v_structured
  from jsonb_each(p_identity -> 'structuredDefinition') item(key,value);
  return 'market-family-v1:sha256:' || encode(extensions.digest(convert_to(
    concat(
      'SELLER_OS_MARKET_FAMILY_ID_V1', E'\n',
      p_identity ->> 'productFunction', E'\n',
      p_identity ->> 'buyerUseCase', E'\n',
      p_identity ->> 'category', E'\n', v_structured
    ), 'UTF8'), 'sha256'), 'hex');
end;
$function$;

create or replace function public.put_seller_os_prelinked_launch_family_evaluation_v1(
  p_launch_candidate_id text,
  p_source_evidence_package_id text,
  p_source_evidence_digest text,
  p_current_market_observation_id text,
  p_exact_product_demand_status text,
  p_product_fit text,
  p_economics_status text,
  p_supply_status text,
  p_listing_research_readiness text,
  p_launch_score numeric,
  p_score_version text,
  p_hard_blockers text[],
  p_pre_publish_requirements text[],
  p_evaluated_at timestamptz,
  p_maximum_age_seconds integer
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_candidate record;
  v_source record;
  v_observation record;
  v_case record;
  v_enrollment record;
  v_existing record;
  v_current record;
  v_target_product_profile jsonb;
  v_profile_attributes text;
  v_profile_digest text;
  v_hard_blockers text[];
  v_requirements text[];
  v_ready boolean;
  v_input_digest text;
  v_evaluation_id text;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_launch_candidate_id, '') !~
      '^prelinked-candidate-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_source_evidence_package_id, '') !~
      '^launch-evidence-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_source_evidence_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_current_market_observation_id, '') !~
      '^family-market-observation-v1:sha256:[0-9a-f]{64}$'
    or p_exact_product_demand_status not in (
      'EXACT_PRODUCT_DEMAND_PROVEN','EXACT_PRODUCT_DEMAND_SUPPORTED',
      'EXACT_PRODUCT_DEMAND_UNPROVEN','EXACT_PRODUCT_DEMAND_UNAVAILABLE'
    )
    or p_product_fit not in ('STRONG','MEDIUM','WEAK','UNPROVEN')
    or p_economics_status not in (
      'ECONOMICS_PROVISIONAL_PASS','ECONOMICS_PROVISIONAL_FAIL',
      'ECONOMICS_UNPROVEN'
    )
    or p_supply_status not in (
      'SUPPLY_IDENTITY_READY','SUPPLY_EVIDENCE_AVAILABLE',
      'PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED','SUPPLY_BLOCKED',
      'SUPPLY_UNPROVEN'
    )
    or p_listing_research_readiness not in ('PASS','BLOCKED')
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_hard_blockers, 0, 64
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_pre_publish_requirements, 0, 32
    )
    or p_evaluated_at is distinct from date_trunc(
      'milliseconds', p_evaluated_at
    )
    or p_evaluated_at > now() + interval '5 minutes'
    or p_maximum_age_seconds not between 60 and 86400
    or p_evaluated_at + make_interval(
      secs => p_maximum_age_seconds
    ) < now() then
    raise exception 'SELLER_OS_PRELINKED_FAMILY_EVALUATION_INPUT_INVALID';
  end if;

  select coalesce(array_agg(value order by value collate "C"), '{}')
    into v_hard_blockers from unnest(p_hard_blockers) item(value);
  select coalesce(array_agg(value order by value collate "C"), '{}')
    into v_requirements
  from unnest(p_pre_publish_requirements) item(value);

  select * into v_candidate
  from public.seller_os_prelinked_launch_candidates
  where launch_candidate_id = p_launch_candidate_id for update;
  if not found then
    raise exception 'SELLER_OS_PRELINKED_LAUNCH_CANDIDATE_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_candidate.launch_candidate_id || ':OP_LAUNCH_I02R', 0
  ));

  select * into v_source
  from public.seller_os_prelinked_launch_evidence_packages
  where evidence_package_id = p_source_evidence_package_id;
  if not found
    or v_candidate.current_evidence_package_id is distinct from
      v_source.evidence_package_id
    or v_candidate.current_evidence_digest is distinct from
      p_source_evidence_digest
    or v_source.evidence_digest is distinct from p_source_evidence_digest
    or v_source.account_key is distinct from v_candidate.account_key
    or v_source.marketplace_id is distinct from v_candidate.marketplace_id
    or v_source.configuration_id is distinct from v_candidate.configuration_id
    or v_source.evidence_evaluated_at + make_interval(
      secs => v_source.evidence_maximum_age_seconds
    ) < now() then
    raise exception 'SELLER_OS_PRELINKED_FAMILY_EVALUATION_STALE_SOURCE';
  end if;

  select * into v_observation
  from public.seller_os_family_market_observations
  where observation_id = p_current_market_observation_id;
  if not found
    or v_observation.evidence_observed_at + make_interval(
      secs => v_observation.maximum_age_seconds
    ) < now()
    or not (v_observation.demand_evidence_references <@
      v_source.evidence_references) then
    raise exception 'SELLER_OS_PRELINKED_FAMILY_EVALUATION_OBSERVATION_STALE';
  end if;
  select * into v_case from public.seller_os_market_opportunity_cases
  where opportunity_case_id = v_observation.opportunity_case_id for share;
  if not found or v_case.family_id is distinct from v_observation.family_id
    or v_case.status <> 'MONITORING'
    or v_case.current_family_definition_version_id is distinct from
      v_observation.family_definition_version_id then
    raise exception 'SELLER_OS_PRELINKED_FAMILY_EVALUATION_ENROLLMENT_REQUIRED';
  end if;
  select * into v_enrollment
  from public.seller_os_opportunity_monitor_enrollments enrollment
  where enrollment.family_id = v_observation.family_id
    and enrollment.opportunity_case_id = v_observation.opportunity_case_id
    and enrollment.status = 'ENROLLED'
    and enrollment.last_observation_id = v_observation.observation_id
  for share;
  if not found then
    raise exception 'SELLER_OS_PRELINKED_FAMILY_EVALUATION_ENROLLMENT_REQUIRED';
  end if;

  select string_agg(item.key || '=' || (item.value #>> '{}'), E'\n'
      order by item.key collate "C")
    into v_profile_attributes
  from jsonb_each(v_observation.attribute_profile) item(key,value);
  v_profile_digest := 'sha256:' || encode(extensions.digest(convert_to(
    concat(
      'SELLER_OS_TARGET_PRODUCT_PROFILE_V1', E'\n',
      v_observation.family_id, E'\n', v_observation.observation_id, E'\n',
      v_profile_attributes, E'\n',
      array_to_string(v_observation.buyer_intent_terms, E'\n')
    ), 'UTF8'), 'sha256'), 'hex');
  v_target_product_profile := jsonb_build_object(
    'contractVersion','SELLER_OS_TARGET_PRODUCT_PROFILE_V1',
    'familyId',v_observation.family_id,
    'opportunityCaseId',v_observation.opportunity_case_id,
    'currentMarketObservationId',v_observation.observation_id,
    'attributeProfile',v_observation.attribute_profile,
    'buyerIntentTerms',to_jsonb(v_observation.buyer_intent_terms),
    'profileDigest',v_profile_digest,
    'authority','DERIVED_FROM_CURRENT_MARKET_OBSERVATION'
  );

  v_ready := v_observation.family_demand_status in (
      'FAMILY_DEMAND_PROVEN','FAMILY_DEMAND_SUPPORTED'
    )
    and p_product_fit = 'STRONG'
    and p_economics_status = 'ECONOMICS_PROVISIONAL_PASS'
    and p_listing_research_readiness = 'PASS'
    and p_supply_status in (
      'SUPPLY_IDENTITY_READY','SUPPLY_EVIDENCE_AVAILABLE',
      'PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED'
    )
    and cardinality(v_hard_blockers) = 0
    and v_source.gate_statuses ->> 'SUPPLY' = 'READY'
    and v_source.gate_statuses ->> 'MARKET' = 'READY'
    and v_source.gate_statuses ->> 'ECONOMICS' = 'READY'
    and v_source.gate_statuses ->> 'LISTING' = 'READY'
    and not exists (
      select 1 from jsonb_array_elements(v_candidate.components) item(value)
      where item.value ->> 'supplierIdentityStatus' <> 'EXACT_PRELINKED'
    );
  if (v_ready and (
      p_launch_score is null or p_launch_score not between 0 and 100
      or p_score_version is distinct from 'SELLER_OS_LAUNCH_SCORE_V1'
      or not (
        'CANONICAL_PRE_PUBLISH_SUPPLY_CONFIRMATION' = any(v_requirements)
        and 'HUMAN_LISTING_PACKAGE_APPROVAL' = any(v_requirements)
        and 'P2_LINKAGE_AFTER_EBAY_ITEM_ID' = any(v_requirements)
      )
    )) or (not v_ready and (
      p_launch_score is not null or p_score_version is not null
      or cardinality(v_hard_blockers) = 0
    )) then
    raise exception 'SELLER_OS_PRELINKED_FAMILY_EVALUATION_GATE_MISMATCH';
  end if;

  v_input_digest := 'sha256:' || encode(extensions.digest(convert_to(concat(
    'SELLER_OS_PRELINKED_FAMILY_EVALUATION_INPUT_V1', E'\n',
    v_candidate.launch_candidate_id, E'\n', v_source.evidence_package_id,
    E'\n', v_source.evidence_digest, E'\n', v_observation.observation_id,
    E'\n', v_observation.demand_evidence_digest, E'\n',
    p_exact_product_demand_status, E'\n', p_product_fit, E'\n',
    p_economics_status, E'\n', p_supply_status, E'\n',
    p_listing_research_readiness, E'\n', coalesce(p_launch_score::text,'NULL'),
    E'\n', coalesce(p_score_version,'NULL'), E'\n',
    array_to_json(v_hard_blockers)::text, E'\n',
    array_to_json(v_requirements)::text, E'\n',
    to_char(p_evaluated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), E'\n',
    p_maximum_age_seconds::text
  ), 'UTF8'), 'sha256'), 'hex');
  v_evaluation_id := 'prelinked-family-evaluation-v1:' || v_input_digest;

  select * into v_existing
  from public.seller_os_prelinked_launch_family_evaluations
  where evaluation_id = v_evaluation_id;
  if found then
    return jsonb_build_object(
      'outcome','IDEMPOTENT_SUCCESS',
      'evaluationId',v_existing.evaluation_id,
      'launchCandidateId',v_existing.launch_candidate_id,
      'currentMarketObservationId',v_existing.current_market_observation_id,
      'launchClassification',v_existing.launch_classification
    );
  end if;
  if v_candidate.current_family_evaluation_id is not null then
    select * into v_current
    from public.seller_os_prelinked_launch_family_evaluations
    where evaluation_id = v_candidate.current_family_evaluation_id;
    if not found or p_evaluated_at <= v_current.evaluated_at then
      raise exception 'SELLER_OS_PRELINKED_FAMILY_EVALUATION_STALE_REJECTED';
    end if;
  end if;

  insert into public.seller_os_prelinked_launch_family_evaluations (
    evaluation_id, evaluation_input_digest, launch_candidate_id,
    source_evidence_package_id, source_evidence_digest, family_id,
    opportunity_case_id, current_market_observation_id,
    family_definition_version_id, family_demand_status,
    target_product_profile,
    exact_product_demand_status, product_fit, economics_status,
    supply_status, listing_research_readiness, launch_score, score_version,
    hard_blockers, pre_publish_requirements, launch_classification,
    evaluated_at, maximum_age_seconds
  ) values (
    v_evaluation_id, v_input_digest, v_candidate.launch_candidate_id,
    v_source.evidence_package_id, v_source.evidence_digest,
    v_observation.family_id, v_observation.opportunity_case_id,
    v_observation.observation_id, v_observation.family_definition_version_id,
    v_observation.family_demand_status, v_target_product_profile,
    p_exact_product_demand_status,
    p_product_fit, p_economics_status, p_supply_status,
    p_listing_research_readiness, p_launch_score, p_score_version,
    v_hard_blockers, v_requirements,
    case when v_ready then 'READY_FOR_TEST_LAUNCH'
      else 'NOT_READY_TO_TEST_LAUNCH' end,
    p_evaluated_at, p_maximum_age_seconds
  ) returning * into v_existing;

  update public.seller_os_prelinked_launch_candidates
  set current_family_evaluation_id = v_existing.evaluation_id,
      ranking_score = coalesce(v_existing.launch_score, 0),
      score_version = coalesce(v_existing.score_version,
        'SELLER_OS_LAUNCH_SCORE_NOT_EVALUATED_V1'),
      hard_blockers = v_existing.hard_blockers,
      launch_state = case when v_ready then 'READY_FOR_TEST_LAUNCH'
        else 'NEEDS_DATA' end,
      human_approval_required = true, publish_allowed = false,
      p2_gate_bypass_allowed = false, updated_at = now()
  where launch_candidate_id = v_candidate.launch_candidate_id;

  return jsonb_build_object(
    'outcome','CREATED','evaluationId',v_existing.evaluation_id,
    'launchCandidateId',v_existing.launch_candidate_id,
    'familyId',v_existing.family_id,
    'opportunityCaseId',v_existing.opportunity_case_id,
    'currentMarketObservationId',v_existing.current_market_observation_id,
    'targetProductProfile',v_existing.target_product_profile,
    'launchClassification',v_existing.launch_classification,
    'publishAllowed',false,'p2GateBypassAllowed',false
  );
end;
$function$;
