-- OP-LAUNCH-I02R targeted artifact only. This extends the already-applied
-- OP-LAUNCH-I01 lineage with a stable commercial family identity, immutable
-- family market observations, bounded monitoring enrollment, and a current
-- observation-bound launch evaluation. Canonical raw sold/market facts remain
-- in their existing source tables; this artifact stores references, bounded
-- summaries and digests only. Phase 7 remains the future Radar authority.
-- This artifact cannot publish, mutate P2, read stock or create Product Case.

create or replace function public.is_valid_seller_os_market_family_identity_v1(
  p_identity jsonb
)
returns boolean
language sql immutable strict security invoker
set search_path = pg_catalog, pg_temp
as $function$
  select coalesce(
    jsonb_typeof(p_identity) = 'object'
    and p_identity ?& array[
      'productFunction','buyerUseCase','category','structuredDefinition'
    ]
    and (p_identity - array[
      'productFunction','buyerUseCase','category','structuredDefinition'
    ]::text[]) = '{}'::jsonb
    and case when jsonb_typeof(p_identity -> 'structuredDefinition') = 'object'
      then (select count(*) from jsonb_object_keys(
        p_identity -> 'structuredDefinition'
      )) between 1 and 32 else false end
    and length(p_identity ->> 'productFunction') between 1 and 120
    and length(p_identity ->> 'buyerUseCase') between 1 and 160
    and length(p_identity ->> 'category') between 1 and 120
    and p_identity ->> 'productFunction' = lower(trim(
      regexp_replace(p_identity ->> 'productFunction', '\s+', ' ', 'g')
    ))
    and p_identity ->> 'buyerUseCase' = lower(trim(
      regexp_replace(p_identity ->> 'buyerUseCase', '\s+', ' ', 'g')
    ))
    and p_identity ->> 'category' = lower(trim(
      regexp_replace(p_identity ->> 'category', '\s+', ' ', 'g')
    ))
    and case when jsonb_typeof(p_identity -> 'structuredDefinition') = 'object'
      then not exists (
        select 1
        from jsonb_each(p_identity -> 'structuredDefinition') item(key,value)
        where item.key !~ '^[a-z0-9][a-z0-9 _./:-]{0,79}$'
          or item.key <> lower(trim(regexp_replace(item.key, '\s+', ' ', 'g')))
          or jsonb_typeof(item.value) <> 'string'
          or length(item.value #>> '{}') not between 1 and 180
          or item.value #>> '{}' <> lower(trim(
            regexp_replace(item.value #>> '{}', '\s+', ' ', 'g')
          ))
      ) else false end, false
  );
$function$;

create or replace function public.put_seller_os_opportunity_monitor_enrollment_v1(
  p_opportunity_case_id text,
  p_monitor_policy_version text,
  p_enrolled_at timestamptz,
  p_status text,
  p_next_review_condition text,
  p_next_eligible_review_at timestamptz,
  p_last_observation_id text,
  p_last_evaluated_at timestamptz
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_case record;
  v_observation record;
  v_existing record;
  v_enrollment_id text;
  v_was_existing boolean := false;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_opportunity_case_id, '') !~
      '^opportunity-case-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_monitor_policy_version, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    or p_enrolled_at is null or p_enrolled_at > now() + interval '5 minutes'
    or p_status not in ('ENROLLED','PAUSED','BLOCKED','RETIRED')
    or (p_last_evaluated_at is not null
      and p_last_evaluated_at > now() + interval '5 minutes')
    or p_next_review_condition not in (
      'TIME_WINDOW_ELAPSED','NEW_SOLD_EVIDENCE','PRICE_SHIFT',
      'COMPETITOR_SHIFT','KEYWORD_SHIFT','ATTRIBUTE_SHIFT',
      'PRODUCT_LAUNCHED','OUTCOME_WINDOW_COMPLETE'
    ) then
    raise exception 'SELLER_OS_OPPORTUNITY_MONITOR_INPUT_INVALID';
  end if;
  select * into v_case from public.seller_os_market_opportunity_cases
  where opportunity_case_id = p_opportunity_case_id for update;
  if not found then
    raise exception 'SELLER_OS_OPPORTUNITY_MONITOR_CASE_NOT_FOUND';
  end if;
  if p_status = 'ENROLLED' and v_case.status <> 'MONITORING' then
    raise exception 'SELLER_OS_OPPORTUNITY_MONITOR_CASE_NOT_ACTIVE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_case.family_id || ':' || p_monitor_policy_version, 0
  ));
  if p_last_observation_id is not null then
    select * into v_observation
    from public.seller_os_family_market_observations
    where observation_id = p_last_observation_id;
    if not found or v_observation.family_id is distinct from v_case.family_id
      or v_observation.family_definition_version_id is distinct from
        v_case.current_family_definition_version_id
      or p_last_evaluated_at is null then
      raise exception 'SELLER_OS_OPPORTUNITY_MONITOR_OBSERVATION_INVALID';
    end if;
  elsif p_last_evaluated_at is not null then
    raise exception 'SELLER_OS_OPPORTUNITY_MONITOR_EVALUATION_INVALID';
  end if;
  v_enrollment_id := 'opportunity-monitor-enrollment-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_OPPORTUNITY_MONITOR_ENROLLMENT_V1', E'\n',
      v_case.family_id, E'\n', p_monitor_policy_version
    ), 'UTF8'), 'sha256'), 'hex'
  );
  select * into v_existing
  from public.seller_os_opportunity_monitor_enrollments
  where enrollment_id = v_enrollment_id for update;
  v_was_existing := found;
  if v_was_existing and (
      (v_existing.last_evaluated_at is not null and (
        p_last_evaluated_at is null
        or p_last_evaluated_at < v_existing.last_evaluated_at
      ))
      or (p_last_evaluated_at is not distinct from
          v_existing.last_evaluated_at
        and p_last_observation_id is distinct from
          v_existing.last_observation_id)
      or (v_existing.last_observation_id is not null and (
        p_last_observation_id is null
        or not exists (
          select 1
          from public.seller_os_family_market_observations next_observation
          join public.seller_os_family_market_observations prior_observation
            on prior_observation.observation_id =
              v_existing.last_observation_id
          where next_observation.observation_id = p_last_observation_id
            and next_observation.family_id = prior_observation.family_id
            and next_observation.observation_window_end >=
              prior_observation.observation_window_end
        )
      ))
  ) then
    raise exception 'SELLER_OS_OPPORTUNITY_MONITOR_STALE_REJECTED';
  end if;
  if v_was_existing and v_existing.enrolled_at is distinct from p_enrolled_at then
    raise exception 'SELLER_OS_OPPORTUNITY_MONITOR_ENROLLED_AT_IMMUTABLE';
  end if;
  if v_was_existing
    and v_existing.status is not distinct from p_status
    and v_existing.next_review_condition is not distinct from
      p_next_review_condition
    and v_existing.next_eligible_review_at is not distinct from
      p_next_eligible_review_at
    and v_existing.last_observation_id is not distinct from
      p_last_observation_id
    and v_existing.last_evaluated_at is not distinct from p_last_evaluated_at
  then
    return jsonb_build_object(
      'outcome','IDEMPOTENT_SUCCESS',
      'enrollmentId',v_existing.enrollment_id,
      'familyId',v_existing.family_id,
      'lastObservationId',v_existing.last_observation_id,
      'schedulerEnabled',false
    );
  end if;
  insert into public.seller_os_opportunity_monitor_enrollments (
    enrollment_id, family_id, opportunity_case_id, enrolled_at, status,
    next_review_condition, next_eligible_review_at, last_observation_id,
    last_evaluated_at, monitor_policy_version
  ) values (
    v_enrollment_id, v_case.family_id, v_case.opportunity_case_id,
    p_enrolled_at, p_status, p_next_review_condition,
    p_next_eligible_review_at, p_last_observation_id, p_last_evaluated_at,
    p_monitor_policy_version
  ) on conflict (enrollment_id) do update set
    status = excluded.status,
    next_review_condition = excluded.next_review_condition,
    next_eligible_review_at = excluded.next_eligible_review_at,
    last_observation_id = excluded.last_observation_id,
    last_evaluated_at = excluded.last_evaluated_at,
    updated_at = now()
  returning * into v_existing;
  return jsonb_build_object(
    'outcome', case when v_was_existing then 'ADVANCED' else 'CREATED' end,
    'enrollmentId',v_existing.enrollment_id,
    'familyId',v_existing.family_id,
    'lastObservationId',v_existing.last_observation_id,
    'schedulerEnabled',false
  );
end;
$function$;

create or replace function public.assert_seller_os_prelinked_current_test_launch_gate_v1(
  p_launch_candidate_id text
)
returns void
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_candidate record;
  v_evaluation record;
  v_source record;
  v_observation record;
  v_enrollment record;
  v_case record;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'SELLER_OS_PRELINKED_TEST_LAUNCH_AUTH_REQUIRED';
  end if;
  select * into v_candidate
  from public.seller_os_prelinked_launch_candidates
  where launch_candidate_id = p_launch_candidate_id for update;
  if not found or v_candidate.current_family_evaluation_id is null
    or v_candidate.launch_state <> 'READY_FOR_TEST_LAUNCH' then
    raise exception 'SELLER_OS_PRELINKED_TEST_LAUNCH_GATE_REQUIRED';
  end if;
  select * into v_evaluation
  from public.seller_os_prelinked_launch_family_evaluations
  where evaluation_id = v_candidate.current_family_evaluation_id
    and launch_candidate_id = v_candidate.launch_candidate_id;
  if not found
    or v_evaluation.launch_classification <> 'READY_FOR_TEST_LAUNCH'
    or cardinality(v_evaluation.hard_blockers) <> 0
    or v_evaluation.evaluated_at + make_interval(
      secs => v_evaluation.maximum_age_seconds
    ) < now()
    or v_evaluation.source_evidence_package_id is distinct from
      v_candidate.current_evidence_package_id
    or v_evaluation.source_evidence_digest is distinct from
      v_candidate.current_evidence_digest then
    raise exception 'SELLER_OS_PRELINKED_TEST_LAUNCH_CURRENT_GATE_REQUIRED';
  end if;
  select * into v_source
  from public.seller_os_prelinked_launch_evidence_packages source
  where source.evidence_package_id = v_evaluation.source_evidence_package_id
    and source.evidence_digest = v_evaluation.source_evidence_digest;
  if not found or v_source.evidence_evaluated_at + make_interval(
      secs => v_source.evidence_maximum_age_seconds
    ) < now()
  then
    raise exception 'SELLER_OS_PRELINKED_TEST_LAUNCH_SOURCE_EVIDENCE_STALE';
  end if;
  select * into v_observation
  from public.seller_os_family_market_observations
  where observation_id = v_evaluation.current_market_observation_id
    and family_id = v_evaluation.family_id
    and opportunity_case_id = v_evaluation.opportunity_case_id;
  if not found or v_observation.evidence_observed_at + make_interval(
      secs => v_observation.maximum_age_seconds
    ) < now()
  then
    raise exception 'SELLER_OS_PRELINKED_TEST_LAUNCH_MARKET_GATE_STALE';
  end if;
  select * into v_case
  from public.seller_os_market_opportunity_cases opportunity_case
  where opportunity_case.opportunity_case_id =
    v_observation.opportunity_case_id
  for share;
  if not found
    or v_case.status <> 'MONITORING'
    or v_case.current_family_definition_version_id is distinct from
      v_observation.family_definition_version_id
    or v_evaluation.family_definition_version_id is distinct from
      v_case.current_family_definition_version_id then
    raise exception 'SELLER_OS_PRELINKED_TEST_LAUNCH_MARKET_GATE_STALE';
  end if;
  select * into v_enrollment
  from public.seller_os_opportunity_monitor_enrollments enrollment
  where enrollment.family_id = v_observation.family_id
    and enrollment.opportunity_case_id = v_observation.opportunity_case_id
    and enrollment.last_observation_id = v_observation.observation_id
    and enrollment.status = 'ENROLLED'
  for share;
  if not found then
    raise exception 'SELLER_OS_PRELINKED_TEST_LAUNCH_MARKET_GATE_STALE';
  end if;
end;
$function$;

create or replace function public.guard_seller_os_prelinked_test_launch_sku_v1()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if old.canonical_sku is distinct from new.canonical_sku then
    if old.canonical_sku is not null then
      raise exception 'SELLER_OS_PRELINKED_CANONICAL_SKU_IMMUTABLE';
    end if;
    perform public.assert_seller_os_prelinked_current_test_launch_gate_v1(
      old.launch_candidate_id
    );
  end if;
  return new;
end;
$function$;

create trigger seller_os_prelinked_test_launch_sku_gate
before update of canonical_sku
on public.seller_os_prelinked_launch_candidates
for each row execute function
  public.guard_seller_os_prelinked_test_launch_sku_v1();

alter function public.reserve_seller_os_prelinked_launch_sku_v1(text,text)
  rename to reserve_seller_os_prelinked_launch_sku_i01_base_v1;
revoke all on function
  public.reserve_seller_os_prelinked_launch_sku_i01_base_v1(text,text)
  from public;
revoke all on function
  public.reserve_seller_os_prelinked_launch_sku_i01_base_v1(text,text)
  from anon;
revoke all on function
  public.reserve_seller_os_prelinked_launch_sku_i01_base_v1(text,text)
  from authenticated;
revoke all on function
  public.reserve_seller_os_prelinked_launch_sku_i01_base_v1(text,text)
  from service_role;

create or replace function public.reserve_seller_os_prelinked_launch_sku_v1(
  p_launch_candidate_id text,
  p_reservation_idempotency_key text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.assert_seller_os_prelinked_current_test_launch_gate_v1(
    p_launch_candidate_id
  );
  return public.reserve_seller_os_prelinked_launch_sku_i01_base_v1(
    p_launch_candidate_id, p_reservation_idempotency_key
  );
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

  select string_agg(item.key || '=' || item.value #>> '{}', E'\n'
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


create table public.seller_os_prelinked_launch_family_evaluations (
  evaluation_id text primary key,
  evaluation_input_digest text not null unique,
  launch_candidate_id text not null references
    public.seller_os_prelinked_launch_candidates(launch_candidate_id)
    on delete restrict,
  source_evidence_package_id text not null references
    public.seller_os_prelinked_launch_evidence_packages(evidence_package_id)
    on delete restrict,
  source_evidence_digest text not null,
  family_id text not null,
  opportunity_case_id text not null,
  current_market_observation_id text not null,
  family_definition_version_id text not null,
  family_demand_status text not null,
  target_product_profile jsonb not null,
  exact_product_demand_status text not null,
  product_fit text not null,
  economics_status text not null,
  supply_status text not null,
  listing_research_readiness text not null,
  launch_score numeric(6,2) null,
  score_version text null,
  hard_blockers text[] not null,
  pre_publish_requirements text[] not null,
  launch_classification text not null,
  evaluated_at timestamptz not null,
  maximum_age_seconds integer not null,
  p2_dependency_gate text not null default 'PREPUBLICATION_PRELINKED_ONLY',
  provenance jsonb not null default jsonb_build_object(
    'contractVersion','SELLER_OS_PRELINKED_FAMILY_DEMAND_GATE_V1',
    'authority','SERVER_GENERATED_CURRENT_OBSERVATION_BOUND',
    'phase7Authority','FUTURE_CANONICAL_AUTHORITY',
    'productCaseAuthority','PRODUCT_CASE_NON_AUTHORITATIVE',
    'publicationAuthority','NO_PUBLICATION_AUTHORITY'
  ),
  contract_version text not null default
    'SELLER_OS_PRELINKED_FAMILY_DEMAND_GATE_V1',
  created_at timestamptz not null default now(),
  constraint seller_os_prelinked_family_evaluation_candidate_pair_unique
    unique (launch_candidate_id, evaluation_id),
  constraint seller_os_prelinked_family_evaluation_logical_unique unique (
    launch_candidate_id, source_evidence_package_id,
    current_market_observation_id, evaluation_input_digest
  ),
  constraint seller_os_prelinked_family_evaluation_id_check check (
    evaluation_id =
      'prelinked-family-evaluation-v1:' || evaluation_input_digest
    and evaluation_input_digest ~ '^sha256:[0-9a-f]{64}$'
    and source_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    and family_id ~ '^market-family-v1:sha256:[0-9a-f]{64}$'
    and opportunity_case_id ~ '^opportunity-case-v1:sha256:[0-9a-f]{64}$'
    and current_market_observation_id ~
      '^family-market-observation-v1:sha256:[0-9a-f]{64}$'
    and family_definition_version_id ~
      '^market-family-definition-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_prelinked_family_evaluation_status_check check (
    family_demand_status in (
      'FAMILY_DEMAND_PROVEN','FAMILY_DEMAND_SUPPORTED',
      'FAMILY_DEMAND_UNPROVEN','FAMILY_DEMAND_UNAVAILABLE'
    )
    and exact_product_demand_status in (
      'EXACT_PRODUCT_DEMAND_PROVEN','EXACT_PRODUCT_DEMAND_SUPPORTED',
      'EXACT_PRODUCT_DEMAND_UNPROVEN','EXACT_PRODUCT_DEMAND_UNAVAILABLE'
    )
    and product_fit in ('STRONG','MEDIUM','WEAK','UNPROVEN')
    and economics_status in (
      'ECONOMICS_PROVISIONAL_PASS','ECONOMICS_PROVISIONAL_FAIL',
      'ECONOMICS_UNPROVEN'
    )
    and supply_status in (
      'SUPPLY_IDENTITY_READY','SUPPLY_EVIDENCE_AVAILABLE',
      'PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED','SUPPLY_BLOCKED',
      'SUPPLY_UNPROVEN'
    )
    and listing_research_readiness in ('PASS','BLOCKED')
    and launch_classification in (
      'READY_FOR_TEST_LAUNCH','NOT_READY_TO_TEST_LAUNCH'
    )
  ),
  constraint seller_os_prelinked_family_evaluation_ready_check check (
    (
      launch_classification = 'READY_FOR_TEST_LAUNCH'
      and family_demand_status in (
        'FAMILY_DEMAND_PROVEN','FAMILY_DEMAND_SUPPORTED'
      )
      and product_fit = 'STRONG'
      and economics_status = 'ECONOMICS_PROVISIONAL_PASS'
      and listing_research_readiness = 'PASS'
      and supply_status in (
        'SUPPLY_IDENTITY_READY','SUPPLY_EVIDENCE_AVAILABLE',
        'PRE_PUBLISH_SUPPLY_CONFIRMATION_REQUIRED'
      )
      and launch_score between 0 and 100
      and score_version = 'SELLER_OS_LAUNCH_SCORE_V1'
      and cardinality(hard_blockers) = 0
      and pre_publish_requirements @> array[
        'CANONICAL_PRE_PUBLISH_SUPPLY_CONFIRMATION',
        'HUMAN_LISTING_PACKAGE_APPROVAL','P2_LINKAGE_AFTER_EBAY_ITEM_ID'
      ]::text[]
    ) or (
      launch_classification = 'NOT_READY_TO_TEST_LAUNCH'
      and launch_score is null and score_version is null
      and cardinality(hard_blockers) between 1 and 64
    )
  ),
  constraint seller_os_prelinked_family_evaluation_arrays_check check (
    public.is_valid_seller_os_prelinked_launch_text_array_v1(
      hard_blockers, 0, 64
    )
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      pre_publish_requirements, 0, 32
    )
  ),
  constraint seller_os_prelinked_family_evaluation_time_check check (
    evaluated_at = date_trunc('milliseconds', evaluated_at)
    and maximum_age_seconds between 60 and 86400
  ),
  constraint seller_os_prelinked_family_evaluation_authority_check check (
    p2_dependency_gate = 'PREPUBLICATION_PRELINKED_ONLY'
    and provenance = jsonb_build_object(
      'contractVersion','SELLER_OS_PRELINKED_FAMILY_DEMAND_GATE_V1',
      'authority','SERVER_GENERATED_CURRENT_OBSERVATION_BOUND',
      'phase7Authority','FUTURE_CANONICAL_AUTHORITY',
      'productCaseAuthority','PRODUCT_CASE_NON_AUTHORITATIVE',
      'publicationAuthority','NO_PUBLICATION_AUTHORITY'
    )
    and contract_version = 'SELLER_OS_PRELINKED_FAMILY_DEMAND_GATE_V1'
    and jsonb_typeof(target_product_profile) = 'object'
    and target_product_profile ->> 'contractVersion' =
      'SELLER_OS_TARGET_PRODUCT_PROFILE_V1'
    and target_product_profile ->> 'familyId' = family_id
    and target_product_profile ->> 'opportunityCaseId' = opportunity_case_id
    and target_product_profile ->> 'currentMarketObservationId' =
      current_market_observation_id
    and target_product_profile ->> 'profileDigest' ~
      '^sha256:[0-9a-f]{64}$'
    and target_product_profile ->> 'authority' =
      'DERIVED_FROM_CURRENT_MARKET_OBSERVATION'
  )
);

create index seller_os_prelinked_family_evaluation_candidate_time_idx
  on public.seller_os_prelinked_launch_family_evaluations(
    launch_candidate_id, evaluated_at desc
  );
create index seller_os_prelinked_family_evaluation_case_time_idx
  on public.seller_os_prelinked_launch_family_evaluations(
    opportunity_case_id, evaluated_at desc
  );

alter table public.seller_os_prelinked_launch_candidates
  add column current_family_evaluation_id text null;

alter table public.seller_os_prelinked_launch_candidates
  add constraint seller_os_prelinked_launch_candidate_family_evaluation_fk
  foreign key (launch_candidate_id, current_family_evaluation_id)
  references public.seller_os_prelinked_launch_family_evaluations(
    launch_candidate_id, evaluation_id
  ) on delete restrict;

create unique index seller_os_prelinked_launch_candidate_family_current_unique
  on public.seller_os_prelinked_launch_candidates(current_family_evaluation_id)
  where current_family_evaluation_id is not null;

alter table public.seller_os_prelinked_launch_candidates
  drop constraint seller_os_prelinked_launch_candidate_safety_check;
alter table public.seller_os_prelinked_launch_candidates
  add constraint seller_os_prelinked_launch_candidate_safety_check check (
    launch_state in (
      'NEEDS_DATA','READY_FOR_TEST_LAUNCH','READY_TO_LIST',
      'LISTING_PACKAGE_BOUND','PUBLISHED'
    )
    and not p2_gate_bypass_allowed
    and (
      launch_state <> 'READY_FOR_TEST_LAUNCH'
      or (current_family_evaluation_id is not null
        and cardinality(hard_blockers) = 0
        and human_approval_required and not publish_allowed)
    )
  );


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
  select string_agg(item.key || '=' || item.value #>> '{}', E'\n'
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

create or replace function public.seller_os_opportunity_case_id_v1(
  p_family_id text
)
returns text
language sql immutable strict security invoker
set search_path = pg_catalog, extensions, pg_temp
as $function$
  select 'opportunity-case-v1:sha256:' || encode(extensions.digest(convert_to(
    concat(
      'SELLER_OS_OPPORTUNITY_CASE_ID_V1', E'\n', p_family_id, E'\n',
      'demand-first-test-launch'
    ), 'UTF8'), 'sha256'), 'hex');
$function$;

create table public.seller_os_market_opportunity_cases (
  opportunity_case_id text primary key,
  family_id text not null unique,
  family_identity jsonb not null unique,
  family_name text not null,
  current_family_definition_version_id text not null,
  opportunity_identity text not null default 'demand-first-test-launch',
  status text not null default 'MONITORING',
  provenance jsonb not null default jsonb_build_object(
    'authority', 'FAST_LANE_CANONICAL_ADAPTER',
    'phase7Authority', 'FUTURE_CANONICAL_AUTHORITY',
    'productCaseAuthority', 'PRODUCT_CASE_NON_AUTHORITATIVE'
  ),
  contract_version text not null default 'SELLER_OS_OPPORTUNITY_CASE_ID_V1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_os_market_opportunity_case_family_pair_unique unique (
    family_id, opportunity_case_id
  ),
  constraint seller_os_market_opportunity_case_identity_check check (
    public.is_valid_seller_os_market_family_identity_v1(family_identity)
    and family_id = public.seller_os_market_family_id_v1(family_identity)
    and opportunity_case_id = public.seller_os_opportunity_case_id_v1(family_id)
    and current_family_definition_version_id ~
      '^market-family-definition-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_market_opportunity_case_text_check check (
    length(family_name) between 1 and 120
    and family_name !~ '[[:cntrl:]]'
    and opportunity_identity = 'demand-first-test-launch'
    and status in ('MONITORING','PAUSED','RETIRED')
  ),
  constraint seller_os_market_opportunity_case_authority_check check (
    provenance = jsonb_build_object(
      'authority', 'FAST_LANE_CANONICAL_ADAPTER',
      'phase7Authority', 'FUTURE_CANONICAL_AUTHORITY',
      'productCaseAuthority', 'PRODUCT_CASE_NON_AUTHORITATIVE'
    )
    and contract_version = 'SELLER_OS_OPPORTUNITY_CASE_ID_V1'
  )
);

create table public.seller_os_market_family_definitions (
  family_definition_version_id text primary key,
  family_id text not null references public.seller_os_market_opportunity_cases(
    family_id
  ) on delete restrict,
  opportunity_case_id text not null references
    public.seller_os_market_opportunity_cases(opportunity_case_id)
    on delete restrict,
  family_name text not null,
  family_query_set text[] not null,
  key_product_attributes text[] not null,
  key_buyer_intent_terms text[] not null,
  adapter_contract text not null,
  adapter_version text not null,
  definition_digest text not null unique,
  contract_version text not null default
    'SELLER_OS_MARKET_FAMILY_DEFINITION_V1',
  created_at timestamptz not null default now(),
  constraint seller_os_market_family_definition_family_unique unique (
    family_id, family_definition_version_id
  ),
  constraint seller_os_market_family_definition_case_fk foreign key (
    family_id, opportunity_case_id
  ) references public.seller_os_market_opportunity_cases(
    family_id, opportunity_case_id
  ) on delete restrict,
  constraint seller_os_market_family_definition_id_check check (
    family_definition_version_id =
      'market-family-definition-v1:' || definition_digest
    and definition_digest ~ '^sha256:[0-9a-f]{64}$'
    and family_id ~ '^market-family-v1:sha256:[0-9a-f]{64}$'
    and opportunity_case_id ~ '^opportunity-case-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_market_family_definition_arrays_check check (
    public.is_valid_seller_os_prelinked_launch_text_array_v1(
      family_query_set, 1, 16
    )
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      key_product_attributes, 1, 32
    )
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      key_buyer_intent_terms, 1, 32
    )
  ),
  constraint seller_os_market_family_definition_text_check check (
    length(family_name) between 1 and 120
    and family_name !~ '[[:cntrl:]]'
    and adapter_contract ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    and adapter_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    and contract_version = 'SELLER_OS_MARKET_FAMILY_DEFINITION_V1'
  )
);

alter table public.seller_os_market_opportunity_cases
  add constraint seller_os_market_opportunity_case_current_definition_fk
  foreign key (family_id, current_family_definition_version_id)
  references public.seller_os_market_family_definitions(
    family_id, family_definition_version_id
  ) deferrable initially deferred;

create table public.seller_os_family_market_observations (
  observation_id text primary key,
  family_id text not null,
  opportunity_case_id text not null,
  family_definition_version_id text not null,
  observation_window_start timestamptz not null,
  observation_window_end timestamptz not null,
  family_demand_status text not null,
  demand_evidence_class text not null,
  source_status text not null,
  aggregation_semantics text not null,
  demand_evidence_references text[] not null,
  demand_evidence_digest text not null,
  observation_input_digest text not null unique,
  sold_comparable_count integer null,
  sold_quantity integer null,
  sold_quantity_evidence jsonb null,
  active_comparable_count integer null,
  seller_diversity integer null,
  price_currency text null,
  price_band_minimum numeric(14,2) null,
  price_band_maximum numeric(14,2) null,
  price_median numeric(14,2) null,
  price_distribution_evidence text[] not null default '{}',
  competition_state text not null,
  buyer_intent_terms text[] not null,
  keyword_state text not null,
  attribute_profile jsonb not null,
  opportunity_types text[] not null,
  evidence_observed_at timestamptz not null,
  source_updated_at timestamptz null,
  maximum_age_seconds integer not null,
  source_adapter text not null,
  source_contract_version text not null,
  previous_observation_id text null,
  momentum_status text not null,
  momentum_evidence_fields text[] not null default '{}',
  momentum_policy_version text not null,
  provenance jsonb not null default jsonb_build_object(
    'authority', 'CANONICAL_SOURCE_REFERENCES_ONLY',
    'rawMarketFactsDuplicated', false,
    'phase7Authority', 'FUTURE_CANONICAL_AUTHORITY'
  ),
  limitations text[] not null,
  contract_version text not null default
    'SELLER_OS_FAMILY_MARKET_OBSERVATION_V1',
  created_at timestamptz not null default now(),
  constraint seller_os_family_market_observation_case_fk foreign key (
    family_id, opportunity_case_id
  ) references public.seller_os_market_opportunity_cases(
    family_id, opportunity_case_id
  ) on delete restrict,
  constraint seller_os_family_market_observation_definition_fk foreign key (
    family_id, family_definition_version_id
  ) references public.seller_os_market_family_definitions(
    family_id, family_definition_version_id
  ) on delete restrict,
  constraint seller_os_family_market_observation_grain_unique unique (
    family_id, observation_window_start, observation_window_end,
    contract_version
  ),
  constraint seller_os_family_market_observation_identity_pair_unique unique (
    family_id, opportunity_case_id, observation_id
  ),
  constraint seller_os_family_market_observation_previous_fk foreign key (
    family_id, opportunity_case_id, previous_observation_id
  ) references public.seller_os_family_market_observations(
    family_id, opportunity_case_id, observation_id
  ) on delete restrict,
  constraint seller_os_family_market_observation_id_check check (
    observation_id = 'family-market-observation-v1:sha256:' || encode(
      extensions.digest(convert_to(concat(
        'SELLER_OS_FAMILY_MARKET_OBSERVATION_V1', E'\n', family_id, E'\n',
        to_char(observation_window_start at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), E'\n',
        to_char(observation_window_end at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ), 'UTF8'), 'sha256'), 'hex'
    )
    and demand_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    and observation_input_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_family_market_observation_window_check check (
    observation_window_start < observation_window_end
    and observation_window_start = date_trunc(
      'milliseconds', observation_window_start
    )
    and observation_window_end = date_trunc(
      'milliseconds', observation_window_end
    )
    and observation_window_end - observation_window_start <= interval '366 days'
    and evidence_observed_at <= observation_window_end + interval '5 minutes'
    and maximum_age_seconds between 60 and 31622400
  ),
  constraint seller_os_family_market_observation_demand_check check (
    family_demand_status in (
      'FAMILY_DEMAND_PROVEN','FAMILY_DEMAND_SUPPORTED',
      'FAMILY_DEMAND_UNPROVEN','FAMILY_DEMAND_UNAVAILABLE'
    )
    and demand_evidence_class in (
      'OFFICIAL_SOLD_EVIDENCE','DIRECT_MARKET_OBSERVATION',
      'DERIVED_NON_SALES_SIGNAL','UNPROVEN','UNAVAILABLE'
    )
    and source_status in ('AVAILABLE','UNAVAILABLE','FAILED')
    and aggregation_semantics in ('WINDOW_DELTA','CUMULATIVE_SNAPSHOT')
    and (
      family_demand_status not in (
        'FAMILY_DEMAND_PROVEN','FAMILY_DEMAND_SUPPORTED'
      ) or (
        demand_evidence_class = 'OFFICIAL_SOLD_EVIDENCE'
        and sold_comparable_count > 0 and sold_quantity > 0
        and sold_quantity_evidence ->> 'authorityClass' =
          'OFFICIAL_EXTERNAL_FACT'
      )
    )
    and (
      family_demand_status <> 'FAMILY_DEMAND_UNAVAILABLE'
      or (demand_evidence_class = 'UNAVAILABLE'
        and source_status = 'UNAVAILABLE')
    )
  ),
  constraint seller_os_family_market_observation_optional_facts_check check (
    (sold_comparable_count is null or sold_comparable_count >= 0)
    and (sold_quantity is null or sold_quantity >= 0)
    and (active_comparable_count is null or active_comparable_count >= 0)
    and (seller_diversity is null or seller_diversity >= 0)
    and (
      (price_currency is null and price_band_minimum is null
        and price_band_maximum is null and price_median is null)
      or (price_currency = 'USD' and price_band_minimum >= 0
        and price_band_maximum >= price_band_minimum
        and (price_median is null or price_median between
          price_band_minimum and price_band_maximum))
    )
  ),
  constraint seller_os_family_market_observation_arrays_check check (
    public.is_valid_seller_os_prelinked_launch_text_array_v1(
      demand_evidence_references, 1, 100
    )
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      price_distribution_evidence, 0, 100
    )
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      buyer_intent_terms, 1, 32
    )
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      opportunity_types, 1, 16
    )
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      momentum_evidence_fields, 0, 16
    )
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      limitations, 0, 64
    )
  ),
  constraint seller_os_family_market_observation_state_check check (
    competition_state in ('LOW','MODERATE','HIGH','UNPROVEN')
    and keyword_state in ('AVAILABLE','UNPROVEN','UNAVAILABLE')
    and momentum_status in (
      'INSUFFICIENT_HISTORY','NEW','STRENGTHENING','STABLE',
      'WEAKENING','SATURATING'
    )
    and (
      momentum_status = 'INSUFFICIENT_HISTORY'
      or previous_observation_id is not null
    )
    and source_adapter ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    and source_contract_version ~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    and momentum_policy_version ~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
  ),
  constraint seller_os_family_market_observation_authority_check check (
    jsonb_typeof(attribute_profile) = 'object'
    and provenance = jsonb_build_object(
      'authority', 'CANONICAL_SOURCE_REFERENCES_ONLY',
      'rawMarketFactsDuplicated', false,
      'phase7Authority', 'FUTURE_CANONICAL_AUTHORITY'
    )
    and contract_version = 'SELLER_OS_FAMILY_MARKET_OBSERVATION_V1'
  )
);

create index seller_os_family_market_observation_series_idx
  on public.seller_os_family_market_observations(
    family_id, observation_window_end desc
  );
create index seller_os_family_market_observation_case_idx
  on public.seller_os_family_market_observations(
    opportunity_case_id, observation_window_end desc
  );

create table public.seller_os_opportunity_monitor_enrollments (
  enrollment_id text primary key,
  family_id text not null,
  opportunity_case_id text not null,
  enrolled_at timestamptz not null,
  status text not null,
  next_review_condition text not null,
  next_eligible_review_at timestamptz null,
  last_observation_id text null,
  last_evaluated_at timestamptz null,
  monitor_policy_version text not null,
  scheduler_enabled boolean not null default false,
  provenance jsonb not null default jsonb_build_object(
    'authority', 'SERVER_OWNED',
    'continuousPolling', false,
    'phase7Authority', 'FUTURE_CANONICAL_AUTHORITY'
  ),
  contract_version text not null default
    'SELLER_OS_OPPORTUNITY_MONITOR_ENROLLMENT_V1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_os_opportunity_monitor_grain_unique unique (
    family_id, monitor_policy_version
  ),
  constraint seller_os_opportunity_monitor_case_fk foreign key (
    family_id, opportunity_case_id
  ) references public.seller_os_market_opportunity_cases(
    family_id, opportunity_case_id
  ) on delete restrict,
  constraint seller_os_opportunity_monitor_observation_fk foreign key (
    family_id, opportunity_case_id, last_observation_id
  ) references public.seller_os_family_market_observations(
    family_id, opportunity_case_id, observation_id
  ) on delete restrict,
  constraint seller_os_opportunity_monitor_id_check check (
    enrollment_id ~
      '^opportunity-monitor-enrollment-v1:sha256:[0-9a-f]{64}$'
    and family_id ~ '^market-family-v1:sha256:[0-9a-f]{64}$'
    and monitor_policy_version ~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
  ),
  constraint seller_os_opportunity_monitor_state_check check (
    status in ('ENROLLED','PAUSED','BLOCKED','RETIRED')
    and next_review_condition in (
      'TIME_WINDOW_ELAPSED','NEW_SOLD_EVIDENCE','PRICE_SHIFT',
      'COMPETITOR_SHIFT','KEYWORD_SHIFT','ATTRIBUTE_SHIFT',
      'PRODUCT_LAUNCHED','OUTCOME_WINDOW_COMPLETE'
    )
    and not scheduler_enabled
  ),
  constraint seller_os_opportunity_monitor_authority_check check (
    provenance = jsonb_build_object(
      'authority', 'SERVER_OWNED',
      'continuousPolling', false,
      'phase7Authority', 'FUTURE_CANONICAL_AUTHORITY'
    )
    and contract_version = 'SELLER_OS_OPPORTUNITY_MONITOR_ENROLLMENT_V1'
  )
);

create index seller_os_opportunity_monitor_due_idx
  on public.seller_os_opportunity_monitor_enrollments(
    next_eligible_review_at, family_id
  ) where status = 'ENROLLED';
create unique index seller_os_opportunity_monitor_one_enrolled_per_family
  on public.seller_os_opportunity_monitor_enrollments(family_id)
  where status = 'ENROLLED';

alter table public.seller_os_prelinked_launch_family_evaluations
  add constraint seller_os_prelinked_family_evaluation_case_fk
  foreign key (opportunity_case_id)
  references public.seller_os_market_opportunity_cases(opportunity_case_id)
  on delete restrict;
alter table public.seller_os_prelinked_launch_family_evaluations
  add constraint seller_os_prelinked_family_evaluation_observation_fk
  foreign key (family_id, opportunity_case_id, current_market_observation_id)
  references public.seller_os_family_market_observations(
    family_id, opportunity_case_id, observation_id
  )
  on delete restrict;

create or replace function public.put_seller_os_market_opportunity_case_v1(
  p_family_identity jsonb,
  p_family_name text,
  p_family_query_set text[],
  p_key_product_attributes text[],
  p_key_buyer_intent_terms text[],
  p_adapter_contract text,
  p_adapter_version text
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
  v_existing public.seller_os_market_opportunity_cases%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or not public.is_valid_seller_os_market_family_identity_v1(
      p_family_identity
    )
    or length(trim(coalesce(p_family_name, ''))) not between 1 and 120
    or coalesce(p_family_name, '') ~ '[[:cntrl:]]'
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_family_query_set, 1, 16
    )
    or exists (
      select 1 from unnest(p_family_query_set) query(value)
      where query.value !~ '^[ -~]+$'
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_key_product_attributes, 1, 32
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_key_buyer_intent_terms, 1, 32
    )
    or coalesce(p_adapter_contract, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    or coalesce(p_adapter_version, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$' then
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
  v_definition_digest := 'sha256:' || encode(extensions.digest(convert_to(
    concat(
      'SELLER_OS_MARKET_FAMILY_DEFINITION_V1', E'\n', v_family_id, E'\n',
      trim(p_family_name), E'\n', array_to_json(v_queries)::text, E'\n',
      array_to_json(v_attributes)::text, E'\n',
      array_to_json(v_intent)::text, E'\n', p_adapter_contract, E'\n',
      p_adapter_version
    ), 'UTF8'), 'sha256'), 'hex');
  v_definition_id := 'market-family-definition-v1:' || v_definition_digest;

  perform pg_advisory_xact_lock(hashtextextended(v_family_id, 0));
  set constraints seller_os_market_opportunity_case_current_definition_fk
    deferred;
  insert into public.seller_os_market_opportunity_cases (
    opportunity_case_id, family_id, family_identity, family_name,
    current_family_definition_version_id
  ) values (
    v_case_id, v_family_id, p_family_identity, trim(p_family_name),
    v_definition_id
  ) on conflict (family_id) do nothing;

  select * into v_existing
  from public.seller_os_market_opportunity_cases
  where family_id = v_family_id for update;
  if not found or v_existing.opportunity_case_id is distinct from v_case_id
    or v_existing.family_identity is distinct from p_family_identity then
    raise exception 'SELLER_OS_MARKET_OPPORTUNITY_CASE_REPLAY_CONFLICT';
  end if;

  insert into public.seller_os_market_family_definitions (
    family_definition_version_id, family_id, opportunity_case_id,
    family_name, family_query_set, key_product_attributes,
    key_buyer_intent_terms, adapter_contract, adapter_version,
    definition_digest
  ) values (
    v_definition_id, v_family_id, v_case_id, trim(p_family_name),
    v_queries, v_attributes, v_intent, p_adapter_contract,
    p_adapter_version, v_definition_digest
  ) on conflict (family_definition_version_id) do nothing;

  update public.seller_os_market_opportunity_cases
  set current_family_definition_version_id = v_definition_id,
      family_name = trim(p_family_name), updated_at = now()
  where family_id = v_family_id
    and current_family_definition_version_id is distinct from v_definition_id;

  return jsonb_build_object(
    'outcome', case when v_existing.current_family_definition_version_id =
      v_definition_id then 'IDEMPOTENT_SUCCESS' else 'DEFINITION_ADVANCED' end,
    'familyId', v_family_id,
    'opportunityCaseId', v_case_id,
    'familyDefinitionVersionId', v_definition_id,
    'phase7Authority', 'FUTURE_CANONICAL_AUTHORITY'
  );
end;
$function$;

create or replace function public.seller_os_market_evidence_references_exist_v1(
  p_references text[],
  p_demand_evidence_class text
)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_reference text;
  v_id uuid;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_references, 1, 100
    ) then
    return false;
  end if;
  foreach v_reference in array p_references loop
    begin
      if v_reference ~
        '^marketplace_product_research_capture_batches:[0-9a-f-]{36}$' then
        v_id := split_part(v_reference, ':', 2)::uuid;
        if not exists (select 1 from
          public.marketplace_product_research_capture_batches source_row
          where source_row.id = v_id and not source_row.raw_html_stored
            and not source_row.pii_stored
            and (p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'
              or exists (select 1 from
                public.marketplace_product_research_capture_observations o
                where o.capture_batch_id = source_row.id
                  and o.quality_status = 'VALID' and o.evidence_reviewed
                  and o.confirmed_sold_quantity > 0)
              or (source_row.source_row_count = 0
                and source_row.valid_count = 0
                and source_row.imported_count = 0
                and source_row.duplicate_count = 0
                and source_row.rejected_count = 0
                and coalesce((source_row.error_counts ->>
                  'OFFICIAL_NO_SOLD_RESULTS')::integer, 0) = 1)))
        then return false; end if;
      elsif v_reference ~
        '^marketplace_product_research_capture_observations:[0-9a-f-]{36}$' then
        v_id := split_part(v_reference, ':', 2)::uuid;
        if not exists (select 1 from
          public.marketplace_product_research_capture_observations source_row
          where source_row.id = v_id and source_row.quality_status = 'VALID'
            and source_row.evidence_reviewed and not source_row.raw_html_stored
            and not source_row.pii_stored
            and (p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'
              or source_row.confirmed_sold_quantity > 0))
        then return false; end if;
      elsif v_reference ~
        '^marketplace_sold_evidence_import_batches:[0-9a-f-]{36}$' then
        v_id := split_part(v_reference, ':', 2)::uuid;
        if not exists (select 1 from
          public.marketplace_sold_evidence_import_batches source_row
          where source_row.id = v_id
            and (p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'
              or (source_row.status = 'IMPORTED'
                and source_row.operator_attested
                and source_row.evidence_scope = 'MARKET_WIDE_SOLD_EVIDENCE'
                and source_row.confirmed_sale_count > 0)))
        then return false; end if;
      elsif v_reference ~
        '^marketplace_sold_evidence_observations:[0-9a-f-]{36}$' then
        v_id := split_part(v_reference, ':', 2)::uuid;
        if not exists (select 1 from
          public.marketplace_sold_evidence_observations source_row
          join public.marketplace_sold_evidence_import_batches source_batch
            on source_batch.id = source_row.import_batch_id
          where source_row.id = v_id and source_row.evidence_reviewed
            and not source_row.raw_file_stored and not source_row.pii_stored
            and (p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'
              or (source_batch.status = 'IMPORTED'
                and source_batch.operator_attested
                and source_batch.evidence_scope =
                  'MARKET_WIDE_SOLD_EVIDENCE'
                and source_row.evidence_scope = 'MARKET_WIDE_SOLD_EVIDENCE'
                and source_row.confirmed_sold_quantity > 0)))
        then return false; end if;
      elsif v_reference ~
        '^ebay_discovery_family_cache:[0-9a-f-]{36}$' then
        if p_demand_evidence_class = 'OFFICIAL_SOLD_EVIDENCE' then
          return false;
        end if;
        v_id := split_part(v_reference, ':', 2)::uuid;
        if not exists (select 1 from
          public.ebay_discovery_family_cache source_row
          where source_row.id = v_id) then return false; end if;
      else
        return false;
      end if;
    exception when others then
      return false;
    end;
  end loop;
  return true;
end;
$function$;

create or replace function public.seller_os_market_evidence_material_digest_v1(
  p_references text[]
)
returns text
language plpgsql stable security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_material text;
  v_material_count integer;
begin
  if not public.is_seller_os_service_role_request_v1()
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_references, 1, 100
    ) then
    return null;
  end if;
  with evidence_references as (
    select value as reference, split_part(value, ':', 1) as source_type,
      split_part(value, ':', 2)::uuid as source_id
    from unnest(p_references) item(value)
  ), material as (
    select reference.reference,
      concat('PRODUCT_RESEARCH_BATCH:', batch.id::text, ':',
        batch.capture_hash, ':', batch.capture_window_hash, ':',
        batch.search_query_hash, ':', batch.search_keyword_patterns::text, ':',
        batch.date_range::text, ':',
        to_char(batch.captured_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ':',
        batch.source_row_count::text, ':', batch.valid_count::text, ':',
        batch.imported_count::text, ':', batch.duplicate_count::text, ':',
        batch.rejected_count::text, ':', batch.error_counts::text)
        as material_identity
    from evidence_references reference
    join public.marketplace_product_research_capture_batches batch
      on reference.source_type =
        'marketplace_product_research_capture_batches'
      and batch.id = reference.source_id
    union all
    select reference.reference,
      concat('PRODUCT_RESEARCH_OBSERVATION:', observation.id::text, ':',
        observation.evidence_deduplication_key, ':',
        observation.identity_hash, ':', observation.source_listing_reference_hash,
        ':', batch.capture_hash) as material_identity
    from evidence_references reference
    join public.marketplace_product_research_capture_observations observation
      on reference.source_type =
        'marketplace_product_research_capture_observations'
      and observation.id = reference.source_id
    join public.marketplace_product_research_capture_batches batch
      on batch.id = observation.capture_batch_id
    union all
    select reference.reference,
      concat('SOLD_IMPORT_BATCH:', batch.id::text, ':',
        batch.source_file_hash, ':', batch.import_schema_version) as material_identity
    from evidence_references reference
    join public.marketplace_sold_evidence_import_batches batch
      on reference.source_type = 'marketplace_sold_evidence_import_batches'
      and batch.id = reference.source_id
    union all
    select reference.reference,
      concat('SOLD_IMPORT_OBSERVATION:', observation.id::text, ':',
        observation.evidence_deduplication_key, ':',
        observation.source_listing_reference_hash, ':',
        batch.source_file_hash) as material_identity
    from evidence_references reference
    join public.marketplace_sold_evidence_observations observation
      on reference.source_type = 'marketplace_sold_evidence_observations'
      and observation.id = reference.source_id
    join public.marketplace_sold_evidence_import_batches batch
      on batch.id = observation.import_batch_id
    union all
    select reference.reference,
      concat('DIRECT_MARKET_CACHE:', cache.id::text, ':',
        cache.family_fingerprint, ':', cache.query_fingerprint, ':',
        cache.query_strategy, ':', coalesce(cache.category_id, 'NULL'), ':',
        cache.result_count::text, ':',
        coalesce(cache.minimum_landed_price::text, 'NULL'), ':',
        coalesce(cache.maximum_landed_price::text, 'NULL'), ':',
        cache.seller_count::text, ':',
        cache.exact_compatible_signal_count::text, ':',
        cache.aggregate_signals::text, ':',
        to_char(cache.observed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as material_identity
    from evidence_references reference
    join public.ebay_discovery_family_cache cache
      on reference.source_type = 'ebay_discovery_family_cache'
      and cache.id = reference.source_id
  )
  select string_agg(material_identity, E'\n'
      order by reference collate "C"), count(*)::integer
    into v_material, v_material_count
  from material;
  if v_material_count <> cardinality(p_references) then
    return null;
  end if;
  return 'sha256:' || encode(extensions.digest(convert_to(concat(
    'SELLER_OS_MARKET_EVIDENCE_MATERIAL_V1', E'\n', v_material
  ), 'UTF8'), 'sha256'), 'hex');
exception when others then
  return null;
end;
$function$;

-- Resolve the only presently authoritative family-bound market source. The
-- existing sold-import ledger and discovery cache remain useful inputs, but
-- neither carries a stable market-family/query binding, so this adapter must
-- reject them rather than silently create a second Radar truth store.
create or replace function public.seller_os_family_market_evidence_binding_v1(
  p_references text[],
  p_family_definition_version_id text,
  p_demand_evidence_class text
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_definition public.seller_os_market_family_definitions%rowtype;
  v_reference_count integer;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_oldest_captured_at timestamptz;
  v_captured_at timestamptz;
  v_bad_count integer;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_demand_evidence_class <> 'OFFICIAL_SOLD_EVIDENCE'
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_references, 1, 100
    ) then
    return null;
  end if;

  select * into v_definition
  from public.seller_os_market_family_definitions definition
  where definition.family_definition_version_id =
    p_family_definition_version_id;
  if not found then return null; end if;

  with evidence_references as (
    select value as reference, split_part(value, ':', 1) as source_type,
      case when split_part(value, ':', 2) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(value, ':', 2)::uuid else null end as source_id
    from unnest(p_references) item(value)
  ), resolved as (
    select reference.reference, reference.source_type, batch.*,
      observation.id as referenced_observation_id
    from evidence_references reference
    left join public.marketplace_product_research_capture_observations
      observation on reference.source_type =
        'marketplace_product_research_capture_observations'
      and observation.id = reference.source_id
    join public.marketplace_product_research_capture_batches batch
      on (reference.source_type =
          'marketplace_product_research_capture_batches'
        and batch.id = reference.source_id)
      or (reference.source_type =
          'marketplace_product_research_capture_observations'
        and batch.id = observation.capture_batch_id)
  )
  select count(*)::integer,
    min(to_timestamp((resolved.date_range ->> 'start')::numeric / 1000.0)),
    max(to_timestamp((resolved.date_range ->> 'end')::numeric / 1000.0)),
    min(resolved.captured_at),
    max(resolved.captured_at),
    count(*) filter (where
      resolved.raw_html_stored or resolved.pii_stored
      or resolved.temporary_titles_stored
      or resolved.competitor_images_downloaded <> 0
      or resolved.marketplace <> 'EBAY_US'
      or resolved.source <> 'EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE'
      or resolved.listing_site <> 'www.ebay.com'
      or resolved.captured_at is null
      or resolved.captured_at > now() + interval '5 minutes'
      or resolved.captured_at + interval '30 days' < now()
      or resolved.captured_at > to_timestamp(
        (resolved.date_range ->> 'end')::numeric / 1000.0
      ) + interval '5 minutes'
      or not exists (
        select 1 from unnest(v_definition.family_query_set) query(value)
        where resolved.search_query_hash = 'sha256:' || encode(
            extensions.digest(convert_to(lower(query.value), 'UTF8'), 'sha256'),
            'hex'
          )
          and regexp_split_to_array(lower(query.value), '[^a-z0-9]+') @>
            resolved.search_keyword_patterns
      )
      or (resolved.source_type =
          'marketplace_product_research_capture_observations'
        and not exists (
          select 1
          from public.marketplace_product_research_capture_observations o
          where o.id = resolved.referenced_observation_id
            and o.quality_status = 'VALID' and o.evidence_reviewed
            and not o.raw_html_stored and not o.pii_stored
            and o.confirmed_sold_quantity > 0
        ))
      or (resolved.source_type =
          'marketplace_product_research_capture_batches'
        and not (
          exists (
            select 1
            from public.marketplace_product_research_capture_observations o
            where o.capture_batch_id = resolved.id
              and o.quality_status = 'VALID' and o.evidence_reviewed
              and not o.raw_html_stored and not o.pii_stored
              and o.confirmed_sold_quantity > 0
          )
          or (resolved.source_row_count = 0
            and resolved.valid_count = 0
            and resolved.imported_count = 0
            and resolved.duplicate_count = 0
            and resolved.rejected_count = 0
            and coalesce((resolved.error_counts ->>
              'OFFICIAL_NO_SOLD_RESULTS')::integer, 0) = 1)
        ))
    )::integer
  into v_reference_count, v_window_start, v_window_end,
    v_oldest_captured_at, v_captured_at, v_bad_count
  from resolved;

  if v_reference_count <> cardinality(p_references)
    or coalesce(v_bad_count, 0) <> 0
    or v_window_start is null or v_window_end is null
    or v_window_start >= v_window_end
    or v_window_end - v_window_start > interval '366 days'
    or v_window_end > now() + interval '5 minutes'
    or v_oldest_captured_at is null or v_captured_at is null
    or v_captured_at - v_oldest_captured_at > interval '1 day'
    or v_captured_at > v_window_end + interval '5 minutes'
    or v_captured_at > now() + interval '5 minutes'
    or v_oldest_captured_at + interval '30 days' < now() then
    return null;
  end if;

  return jsonb_build_object(
    'familyId',v_definition.family_id,
    'familyDefinitionVersionId',v_definition.family_definition_version_id,
    'observationWindowStart',to_char(v_window_start at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'observationWindowEnd',to_char(v_window_end at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'evidenceObservedAt',to_char(v_captured_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceUpdatedAt',to_char(v_captured_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'maximumAgeSeconds',2592000,
    'sourceStatus','AVAILABLE',
    'aggregationSemantics','CUMULATIVE_SNAPSHOT',
    'sourceAdapter','SELLER_OS_PRODUCT_RESEARCH_FAMILY_ADAPTER_V1',
    'sourceContractVersion','EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE',
    'momentumPolicyVersion','SELLER_OS_FAMILY_MARKET_MOMENTUM_POLICY_V1',
    'familyQueryBinding','MATCHED'
  );
exception when others then
  return null;
end;
$function$;

create or replace function public.seller_os_official_sold_evidence_summary_matches_v1(
  p_references text[],
  p_sold_comparable_count integer,
  p_sold_quantity integer,
  p_seller_diversity integer,
  p_price_band_minimum numeric,
  p_price_band_maximum numeric,
  p_price_median numeric,
  p_price_distribution_evidence text[]
)
returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_comparable_count integer;
  v_sold_quantity integer;
  v_seller_diversity integer;
  v_price_minimum numeric;
  v_price_maximum numeric;
  v_price_median numeric;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_sold_comparable_count is null or p_sold_quantity is null
    or (p_seller_diversity is not null and p_seller_diversity < 0)
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      p_references, 1, 100
    )
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      coalesce(p_price_distribution_evidence, '{}'), 0, 100
    )
    or not (coalesce(p_price_distribution_evidence, '{}') <@ p_references)
    or (
      p_price_band_minimum is not null
      and not (p_references <@ p_price_distribution_evidence)
    )
  then
    return false;
  end if;

  with evidence_references as (
    select split_part(value, ':', 1) as source_type,
      split_part(value, ':', 2)::uuid as source_id
    from unnest(p_references) item(value)
  ), product_rows as (
    select 'PRODUCT_RESEARCH:' || observation.evidence_deduplication_key
        as evidence_key,
      observation.confirmed_sold_quantity as sold_quantity,
      observation.average_sold_price as sold_price,
      observation.seller_reference_fingerprint as seller_fingerprint
    from evidence_references reference
    join public.marketplace_product_research_capture_observations observation
      on (reference.source_type =
          'marketplace_product_research_capture_observations'
        and observation.id = reference.source_id)
      or (reference.source_type =
          'marketplace_product_research_capture_batches'
        and observation.capture_batch_id = reference.source_id)
    where observation.quality_status = 'VALID'
      and observation.evidence_reviewed
      and not observation.raw_html_stored and not observation.pii_stored
      and observation.confirmed_sold_quantity > 0
  ), sold_import_rows as (
    select 'SOLD_IMPORT:' || observation.evidence_deduplication_key
        as evidence_key,
      observation.confirmed_sold_quantity as sold_quantity,
      observation.item_price as sold_price,
      null::text as seller_fingerprint
    from evidence_references reference
    join public.marketplace_sold_evidence_observations observation
      on (reference.source_type = 'marketplace_sold_evidence_observations'
        and observation.id = reference.source_id)
      or (reference.source_type = 'marketplace_sold_evidence_import_batches'
        and observation.import_batch_id = reference.source_id)
    join public.marketplace_sold_evidence_import_batches batch
      on batch.id = observation.import_batch_id
    where observation.evidence_reviewed
      and not observation.raw_file_stored and not observation.pii_stored
      and observation.evidence_scope = 'MARKET_WIDE_SOLD_EVIDENCE'
      and batch.status = 'IMPORTED' and batch.operator_attested
      and batch.evidence_scope = 'MARKET_WIDE_SOLD_EVIDENCE'
      and observation.confirmed_sold_quantity > 0
  ), deduplicated as (
    select distinct on (evidence_key) evidence_key, sold_quantity, sold_price,
      seller_fingerprint
    from (
      select * from product_rows
      union all
      select * from sold_import_rows
    ) source_rows
    order by evidence_key
  )
  select count(*)::integer,
    coalesce(sum(sold_quantity), 0)::integer,
    count(distinct seller_fingerprint)::integer,
    round(min(sold_price)::numeric, 2),
    round(max(sold_price)::numeric, 2),
    round((percentile_cont(0.5) within group (
      order by sold_price
    ))::numeric, 2)
  into v_comparable_count, v_sold_quantity, v_seller_diversity,
    v_price_minimum, v_price_maximum, v_price_median
  from deduplicated;

  return v_comparable_count = p_sold_comparable_count
    and v_sold_quantity = p_sold_quantity
    and (
      (v_seller_diversity = 0 and p_seller_diversity is null)
      or v_seller_diversity = p_seller_diversity
    )
    and v_price_minimum is not distinct from p_price_band_minimum
    and v_price_maximum is not distinct from p_price_band_maximum
    and v_price_median is not distinct from p_price_median;
exception when others then
  return false;
end;
$function$;

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
    or p_attribute_profile is distinct from
      v_case.family_identity -> 'structuredDefinition'
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

create or replace function public.get_seller_os_family_market_radar_v1(
  p_family_id text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_limit is null or p_limit not between 1 and 100
    or (p_family_id is not null and p_family_id !~
      '^market-family-v1:sha256:[0-9a-f]{64}$') then
    raise exception 'SELLER_OS_FAMILY_MARKET_RADAR_READ_INVALID';
  end if;

  with selected_cases as (
    select opportunity_case.*
    from public.seller_os_market_opportunity_cases opportunity_case
    where p_family_id is null or opportunity_case.family_id = p_family_id
    order by opportunity_case.updated_at desc,
      opportunity_case.family_id collate "C"
    limit p_limit
  ), family_items as (
    select opportunity_case.family_id,
      jsonb_build_object(
        'familyId',opportunity_case.family_id,
        'opportunityCaseId',opportunity_case.opportunity_case_id,
        'familyName',opportunity_case.family_name,
        'caseStatus',opportunity_case.status,
        'currentFamilyDefinitionVersionId',
          opportunity_case.current_family_definition_version_id,
        'phase7Authority','FUTURE_CANONICAL_AUTHORITY',
        'marketObservationCount',(
          select count(*)
          from public.seller_os_family_market_observations observation
          where observation.family_id = opportunity_case.family_id
        ),
        'observationSeries',(
          select coalesce(jsonb_agg(series.entry order by
            series.observation_window_end desc), '[]'::jsonb)
          from (
            select observation.observation_window_end,
              jsonb_build_object(
                'observationId',observation.observation_id,
                'familyDefinitionVersionId',
                  observation.family_definition_version_id,
                'observationWindowStart',observation.observation_window_start,
                'observationWindowEnd',observation.observation_window_end,
                'familyDemandStatus',observation.family_demand_status,
                'demandEvidenceClass',observation.demand_evidence_class,
                'demandEvidenceDigest',observation.demand_evidence_digest,
                'soldComparableCount',observation.sold_comparable_count,
                'soldQuantity',observation.sold_quantity,
                'activeComparableCount',observation.active_comparable_count,
                'sellerDiversity',observation.seller_diversity,
                'priceCurrency',observation.price_currency,
                'priceBandMinimum',observation.price_band_minimum,
                'priceBandMaximum',observation.price_band_maximum,
                'priceMedian',observation.price_median,
                'competitionState',observation.competition_state,
                'momentumStatus',observation.momentum_status,
                'previousObservationId',observation.previous_observation_id,
                'evidenceObservedAt',observation.evidence_observed_at,
                'sourceUpdatedAt',observation.source_updated_at,
                'maximumAgeSeconds',observation.maximum_age_seconds,
                'fresh',observation.evidence_observed_at + make_interval(
                  secs => observation.maximum_age_seconds
                ) >= now(),
                'limitations',to_jsonb(observation.limitations)
              ) as entry
            from public.seller_os_family_market_observations observation
            where observation.family_id = opportunity_case.family_id
            order by observation.observation_window_end desc
            limit 12
          ) series
        ),
        'monitorEnrollments',(
          select coalesce(jsonb_agg(enrollment_series.entry order by
            enrollment_series.monitor_policy_version collate "C"), '[]'::jsonb)
          from (
            select enrollment.monitor_policy_version,
              jsonb_build_object(
                'enrollmentId',enrollment.enrollment_id,
                'status',enrollment.status,
                'nextReviewCondition',enrollment.next_review_condition,
                'nextEligibleReviewAt',enrollment.next_eligible_review_at,
                'lastObservationId',enrollment.last_observation_id,
                'lastEvaluatedAt',enrollment.last_evaluated_at,
                'monitorPolicyVersion',enrollment.monitor_policy_version,
                'schedulerEnabled',false
              ) as entry
            from public.seller_os_opportunity_monitor_enrollments enrollment
            where enrollment.family_id = opportunity_case.family_id
            order by enrollment.monitor_policy_version collate "C"
            limit 100
          ) enrollment_series
        ),
        'currentEvaluations',(
          select coalesce(jsonb_agg(evaluation_series.entry order by
            evaluation_series.evaluated_at desc), '[]'::jsonb)
          from (
            select evaluation.evaluated_at,
              jsonb_build_object(
                'evaluationId',evaluation.evaluation_id,
                'launchCandidateId',evaluation.launch_candidate_id,
                'currentMarketObservationId',
                  evaluation.current_market_observation_id,
                'launchClassification',evaluation.launch_classification,
                'effectiveLaunchClassification',case
                  when evaluation.launch_classification =
                      'READY_FOR_TEST_LAUNCH'
                    and opportunity_case.status = 'MONITORING'
                    and candidate.launch_state = 'READY_FOR_TEST_LAUNCH'
                    and cardinality(candidate.hard_blockers) = 0
                    and candidate.current_evidence_package_id =
                      evaluation.source_evidence_package_id
                    and candidate.current_evidence_digest =
                      evaluation.source_evidence_digest
                    and source.evidence_digest = evaluation.source_evidence_digest
                    and source.evidence_evaluated_at + make_interval(
                      secs => source.evidence_maximum_age_seconds
                    ) >= now()
                    and evaluation.evaluated_at + make_interval(
                      secs => evaluation.maximum_age_seconds
                    ) >= now()
                    and evaluation.family_definition_version_id =
                      opportunity_case.current_family_definition_version_id
                    and observation.evidence_observed_at + make_interval(
                      secs => observation.maximum_age_seconds
                    ) >= now()
                    and enrollment.status = 'ENROLLED'
                    and enrollment.last_observation_id =
                      observation.observation_id
                  then 'READY_FOR_TEST_LAUNCH'
                  else 'NOT_READY_TO_TEST_LAUNCH'
                end,
                'sourceEvidenceDigest',evaluation.source_evidence_digest,
                'evaluatedAt',evaluation.evaluated_at,
                'maximumAgeSeconds',evaluation.maximum_age_seconds
              ) as entry
            from public.seller_os_prelinked_launch_family_evaluations evaluation
            join public.seller_os_prelinked_launch_candidates candidate
              on candidate.launch_candidate_id = evaluation.launch_candidate_id
              and candidate.current_family_evaluation_id =
                evaluation.evaluation_id
            join public.seller_os_prelinked_launch_evidence_packages source
              on source.evidence_package_id =
                evaluation.source_evidence_package_id
            join public.seller_os_family_market_observations observation
              on observation.observation_id =
                evaluation.current_market_observation_id
            left join lateral (
              select monitor.status, monitor.last_observation_id
              from public.seller_os_opportunity_monitor_enrollments monitor
              where monitor.family_id = evaluation.family_id
                and monitor.opportunity_case_id =
                  evaluation.opportunity_case_id
                and monitor.last_observation_id = observation.observation_id
                and monitor.status = 'ENROLLED'
              order by monitor.updated_at desc
              limit 1
            ) enrollment on true
            where evaluation.family_id = opportunity_case.family_id
            order by evaluation.evaluated_at desc
            limit 100
          ) evaluation_series
        )
      ) as item
    from selected_cases opportunity_case
  )
  select jsonb_build_object(
    'contractVersion','SELLER_OS_FAMILY_MARKET_RADAR_READ_V1',
    'status','AVAILABLE',
    'familyCount',count(*)::integer,
    'families',coalesce(jsonb_agg(item order by family_id collate "C"),
      '[]'::jsonb),
    'bounded',true,
    'limit',p_limit,
    'phase7Authority','FUTURE_CANONICAL_AUTHORITY'
  ) into v_result
  from family_items;
  return v_result;
end;
$function$;

create trigger seller_os_market_family_definition_append_only
before update or delete on public.seller_os_market_family_definitions
for each row execute function
  public.reject_seller_os_prelinked_launch_append_mutation_v1();
create trigger seller_os_family_market_observation_append_only
before update or delete on public.seller_os_family_market_observations
for each row execute function
  public.reject_seller_os_prelinked_launch_append_mutation_v1();
create trigger seller_os_prelinked_family_evaluation_append_only
before update or delete
on public.seller_os_prelinked_launch_family_evaluations
for each row execute function
  public.reject_seller_os_prelinked_launch_append_mutation_v1();

alter table public.seller_os_market_opportunity_cases enable row level security;
alter table public.seller_os_market_opportunity_cases force row level security;
alter table public.seller_os_market_family_definitions enable row level security;
alter table public.seller_os_market_family_definitions force row level security;
alter table public.seller_os_family_market_observations enable row level security;
alter table public.seller_os_family_market_observations force row level security;
alter table public.seller_os_opportunity_monitor_enrollments enable row level security;
alter table public.seller_os_opportunity_monitor_enrollments force row level security;
alter table public.seller_os_prelinked_launch_family_evaluations enable row level security;
alter table public.seller_os_prelinked_launch_family_evaluations force row level security;

revoke all on table public.seller_os_market_opportunity_cases
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_market_family_definitions
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_family_market_observations
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_opportunity_monitor_enrollments
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_prelinked_launch_family_evaluations
  from public, anon, authenticated, service_role;

grant select, insert, update on table
  public.seller_os_market_opportunity_cases to postgres;
grant select, insert on table
  public.seller_os_market_family_definitions to postgres;
grant select, insert on table
  public.seller_os_family_market_observations to postgres;
grant select, insert, update on table
  public.seller_os_opportunity_monitor_enrollments to postgres;
grant select, insert on table
  public.seller_os_prelinked_launch_family_evaluations to postgres;

create policy seller_os_market_opportunity_case_rpc_owner_all
  on public.seller_os_market_opportunity_cases for all to postgres
  using (public.is_seller_os_service_role_request_v1())
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_market_family_definition_rpc_owner_read
  on public.seller_os_market_family_definitions for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_market_family_definition_rpc_owner_insert
  on public.seller_os_market_family_definitions for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_family_market_observation_rpc_owner_read
  on public.seller_os_family_market_observations for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_family_market_observation_rpc_owner_insert
  on public.seller_os_family_market_observations for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_opportunity_monitor_rpc_owner_all
  on public.seller_os_opportunity_monitor_enrollments for all to postgres
  using (public.is_seller_os_service_role_request_v1())
  with check (public.is_seller_os_service_role_request_v1());
create policy seller_os_prelinked_family_evaluation_rpc_owner_read
  on public.seller_os_prelinked_launch_family_evaluations for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_prelinked_family_evaluation_rpc_owner_insert
  on public.seller_os_prelinked_launch_family_evaluations for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());

revoke all on function public.is_valid_seller_os_market_family_identity_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.seller_os_market_family_id_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.seller_os_opportunity_case_id_v1(text)
  from public, anon, authenticated;
revoke all on function public.seller_os_market_evidence_references_exist_v1(text[],text)
  from public, anon, authenticated, service_role;
revoke all on function public.seller_os_market_evidence_material_digest_v1(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.seller_os_family_market_evidence_binding_v1(
  text[],text,text
) from public, anon, authenticated, service_role;
revoke all on function public.seller_os_official_sold_evidence_summary_matches_v1(
  text[],integer,integer,integer,numeric,numeric,numeric,text[]
) from public, anon, authenticated, service_role;
revoke all on function public.assert_seller_os_prelinked_current_test_launch_gate_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function public.guard_seller_os_prelinked_test_launch_sku_v1()
  from public, anon, authenticated;

revoke all on function public.put_seller_os_market_opportunity_case_v1(
  jsonb,text,text[],text[],text[],text,text
) from public, anon, authenticated;
grant execute on function public.put_seller_os_market_opportunity_case_v1(
  jsonb,text,text[],text[],text[],text,text
) to service_role;
revoke all on function public.put_seller_os_family_market_observation_v1(
  text,text,timestamptz,timestamptz,text,text,text,text[],integer,integer,
  integer,integer,text,numeric,numeric,numeric,text[],text,text[],
  text,jsonb,text[],timestamptz,timestamptz,integer,text,text,text,text[]
) from public, anon, authenticated;
grant execute on function public.put_seller_os_family_market_observation_v1(
  text,text,timestamptz,timestamptz,text,text,text,text[],integer,integer,
  integer,integer,text,numeric,numeric,numeric,text[],text,text[],
  text,jsonb,text[],timestamptz,timestamptz,integer,text,text,text,text[]
) to service_role;
revoke all on function public.put_seller_os_opportunity_monitor_enrollment_v1(
  text,text,timestamptz,text,text,timestamptz,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.put_seller_os_opportunity_monitor_enrollment_v1(
  text,text,timestamptz,text,text,timestamptz,text,timestamptz
) to service_role;
revoke all on function public.put_seller_os_prelinked_launch_family_evaluation_v1(
  text,text,text,text,text,text,text,text,text,numeric,text,text[],text[],
  timestamptz,integer
) from public, anon, authenticated;
grant execute on function public.put_seller_os_prelinked_launch_family_evaluation_v1(
  text,text,text,text,text,text,text,text,text,numeric,text,text[],text[],
  timestamptz,integer
) to service_role;
revoke all on function public.get_seller_os_family_market_radar_v1(text,integer)
  from public, anon, authenticated;
grant execute on function public.get_seller_os_family_market_radar_v1(text,integer)
  to service_role;
revoke all on function public.reserve_seller_os_prelinked_launch_sku_v1(text,text)
  from public, anon, authenticated;
grant execute on function public.reserve_seller_os_prelinked_launch_sku_v1(text,text)
  to service_role;

comment on table public.seller_os_family_market_observations is
  'Immutable family/window references and bounded summaries; canonical raw market facts stay in existing sources and Phase 7 remains future Radar authority.';
comment on table public.seller_os_opportunity_monitor_enrollments is
  'Server-owned bounded review state only; scheduler_enabled is forced false and this is not continuous polling.';
comment on table public.seller_os_prelinked_launch_family_evaluations is
  'Immutable current-observation-bound I02 gate; READY_FOR_TEST_LAUNCH allows listing construction only, never publication or P2 bypass.';
comment on function public.put_seller_os_family_market_observation_v1(
  text,text,timestamptz,timestamptz,text,text,text,text[],integer,integer,
  integer,integer,text,numeric,numeric,numeric,text[],text,text[],
  text,jsonb,text[],timestamptz,timestamptz,integer,text,text,text,text[]
) is
  'V1 operational writer accepts only server-validated official Product Research sold evidence, including an explicit official-zero attestation; DIRECT/UNAVAILABLE adapters require a future family-bound canonical source.';

notify pgrst, 'reload schema';
