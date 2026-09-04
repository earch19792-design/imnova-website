-- Wire the existing enrolled-family store to the existing scheduled runtime.
-- The append-only observation remains the authority; commercial comparable
-- metrics are derived separately and never upgrade family demand to exact demand.

alter table public.seller_os_family_market_observations
  add column if not exists active_evidence_digest text null,
  add column if not exists marketplace_read_count integer not null default 0,
  add column if not exists commercial_comparable_status text not null default 'UNPROVEN',
  add column if not exists commercial_comparable_count integer not null default 0,
  add column if not exists commercial_exact_count integer not null default 0,
  add column if not exists commercial_strong_count integer not null default 0,
  add column if not exists commercial_price_typical_low numeric(14,2) null,
  add column if not exists commercial_price_typical_high numeric(14,2) null,
  add column if not exists commercial_price_median numeric(14,2) null,
  add column if not exists raw_outliers_excluded_count integer not null default 0,
  add column if not exists commercial_exclusion_reasons text[] not null default '{}';

alter table public.seller_os_family_market_observations
  add constraint seller_os_family_market_observation_commercial_v1_check check (
    (active_evidence_digest is null or active_evidence_digest ~ '^sha256:[0-9a-f]{64}$')
    and marketplace_read_count between 0 and 1
    and commercial_comparable_status in ('AVAILABLE','UNPROVEN')
    and commercial_comparable_count >= 0
    and commercial_exact_count >= 0
    and commercial_strong_count >= 0
    and commercial_exact_count + commercial_strong_count = commercial_comparable_count
    and raw_outliers_excluded_count >= 0
    and public.is_valid_seller_os_prelinked_launch_text_array_v1(
      commercial_exclusion_reasons, 0, 32
    )
    and (
      (commercial_comparable_status = 'UNPROVEN'
        and commercial_price_typical_low is null
        and commercial_price_typical_high is null
        and commercial_price_median is null)
      or
      (commercial_comparable_status = 'AVAILABLE'
        and commercial_comparable_count >= 3
        and commercial_price_typical_low >= 0
        and commercial_price_typical_high >= commercial_price_typical_low
        and commercial_price_median between commercial_price_typical_low
          and commercial_price_typical_high)
    )
  );

alter table public.seller_os_family_market_observations
  drop constraint seller_os_family_market_observation_state_check;
alter table public.seller_os_family_market_observations
  add constraint seller_os_family_market_observation_state_check check (
    competition_state in ('LOW','MODERATE','HIGH','UNPROVEN')
    and keyword_state in ('AVAILABLE','UNPROVEN','UNAVAILABLE')
    and momentum_status in (
      'INSUFFICIENT_HISTORY','NEW','STRENGTHENING','STABLE',
      'WEAKENING','NEEDS_MORE_EVIDENCE','SATURATING'
    )
    and (momentum_status = 'INSUFFICIENT_HISTORY'
      or previous_observation_id is not null)
    and source_adapter ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    and source_contract_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    and momentum_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
  );

alter table public.seller_os_opportunity_monitor_enrollments
  drop constraint seller_os_opportunity_monitor_state_check;

create or replace function public.set_seller_os_opportunity_monitor_scheduler_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.status = 'ENROLLED' and new.last_observation_id is not null
      and new.last_evaluated_at is not null then
    new.next_eligible_review_at := coalesce(new.next_eligible_review_at,
      new.last_evaluated_at + interval '30 days');
    new.scheduler_enabled := true;
  else
    new.scheduler_enabled := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists seller_os_opportunity_monitor_scheduler_v1
  on public.seller_os_opportunity_monitor_enrollments;
create trigger seller_os_opportunity_monitor_scheduler_v1
before insert or update of status,next_eligible_review_at,last_observation_id,
  last_evaluated_at
on public.seller_os_opportunity_monitor_enrollments
for each row execute function
  public.set_seller_os_opportunity_monitor_scheduler_v1();

update public.seller_os_opportunity_monitor_enrollments
set next_eligible_review_at = coalesce(next_eligible_review_at,
      last_evaluated_at + interval '30 days'),
    scheduler_enabled = status = 'ENROLLED' and last_observation_id is not null
      and last_evaluated_at is not null,
    updated_at = now()
where scheduler_enabled is distinct from (status = 'ENROLLED'
      and last_observation_id is not null and last_evaluated_at is not null)
   or (status = 'ENROLLED' and next_eligible_review_at is null
      and last_evaluated_at is not null);

alter table public.seller_os_opportunity_monitor_enrollments
  drop constraint if exists seller_os_opportunity_monitor_scheduler_gate_check;
alter table public.seller_os_opportunity_monitor_enrollments
  add constraint seller_os_opportunity_monitor_scheduler_gate_check check (
    not scheduler_enabled or (status = 'ENROLLED'
      and next_eligible_review_at is not null
      and last_observation_id is not null and last_evaluated_at is not null)
  );

alter table public.seller_os_opportunity_monitor_enrollments
  add constraint seller_os_opportunity_monitor_state_check check (
    status in ('ENROLLED','PAUSED','BLOCKED','RETIRED')
    and next_review_condition in (
      'TIME_WINDOW_ELAPSED','NEW_SOLD_EVIDENCE','PRICE_SHIFT',
      'COMPETITOR_SHIFT','KEYWORD_SHIFT','ATTRIBUTE_SHIFT',
      'PRODUCT_LAUNCHED','OUTCOME_WINDOW_COMPLETE'
    )
    and scheduler_enabled = (status = 'ENROLLED'
      and next_eligible_review_at is not null
      and last_observation_id is not null and last_evaluated_at is not null)
  );

create or replace function public.put_seller_os_longitudinal_family_refresh_v1(
  p_family_id text,
  p_expected_current_observation_id text,
  p_observed_at timestamptz,
  p_active_evidence_digest text,
  p_marketplace_read_count integer,
  p_active_comparable_count integer,
  p_seller_diversity integer,
  p_competition_state text,
  p_commercial_comparable_status text,
  p_commercial_comparable_count integer,
  p_commercial_exact_count integer,
  p_commercial_strong_count integer,
  p_commercial_price_typical_low numeric,
  p_commercial_price_typical_high numeric,
  p_commercial_price_median numeric,
  p_raw_outliers_excluded_count integer,
  p_commercial_exclusion_reasons text[],
  p_source_contract_version text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_case public.seller_os_market_opportunity_cases%rowtype;
  v_previous public.seller_os_family_market_observations%rowtype;
  v_existing public.seller_os_family_market_observations%rowtype;
  v_enrollment public.seller_os_opportunity_monitor_enrollments%rowtype;
  v_observation_id text;
  v_input_digest text;
  v_demand_digest text;
  v_momentum text := 'NEEDS_MORE_EVIDENCE';
  v_change numeric;
  v_prior_count integer;
  v_reasons text[];
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(p_family_id,'') !~ '^market-family-v1:sha256:[0-9a-f]{64}$'
    or coalesce(p_expected_current_observation_id,'') !~
      '^family-market-observation-v1:sha256:[0-9a-f]{64}$'
    or p_observed_at is null or p_observed_at > now() + interval '5 minutes'
    or p_observed_at <> date_trunc('milliseconds',p_observed_at)
    or coalesce(p_active_evidence_digest,'') !~ '^sha256:[0-9a-f]{64}$'
    or p_marketplace_read_count <> 1
    or p_active_comparable_count < 0 or p_seller_diversity < 0
    or p_competition_state not in ('LOW','MODERATE','HIGH','UNPROVEN')
    or p_commercial_comparable_status not in ('AVAILABLE','UNPROVEN')
    or p_commercial_comparable_count < 0
    or p_commercial_exact_count < 0 or p_commercial_strong_count < 0
    or p_commercial_exact_count + p_commercial_strong_count <>
      p_commercial_comparable_count
    or p_raw_outliers_excluded_count < 0
    or not public.is_valid_seller_os_prelinked_launch_text_array_v1(
      coalesce(p_commercial_exclusion_reasons,'{}'),0,32)
    or coalesce(p_source_contract_version,'') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'
    or (p_commercial_comparable_status = 'AVAILABLE' and (
      p_commercial_comparable_count < 3
      or p_commercial_price_typical_low is null
      or p_commercial_price_typical_high is null
      or p_commercial_price_median is null
      or p_commercial_price_typical_high < p_commercial_price_typical_low
      or p_commercial_price_median not between
        p_commercial_price_typical_low and p_commercial_price_typical_high))
    or (p_commercial_comparable_status = 'UNPROVEN' and (
      p_commercial_price_typical_low is not null
      or p_commercial_price_typical_high is not null
      or p_commercial_price_median is not null)) then
    raise exception 'SELLER_OS_LONGITUDINAL_REFRESH_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_family_id ||
    ':LONGITUDINAL_RUNTIME_V1',0));
  select * into v_case from public.seller_os_market_opportunity_cases
  where family_id = p_family_id and status = 'MONITORING';
  if not found then
    raise exception 'SELLER_OS_LONGITUDINAL_REFRESH_CASE_NOT_ACTIVE';
  end if;
  select * into v_previous
  from public.seller_os_family_market_observations
  where family_id = p_family_id
  order by observation_window_end desc, evidence_observed_at desc,
    observation_id desc limit 1;
  if not found or v_previous.observation_id is distinct from
      p_expected_current_observation_id then
    raise exception 'SELLER_OS_LONGITUDINAL_REFRESH_STALE_CURRENT';
  end if;
  select * into v_enrollment
  from public.seller_os_opportunity_monitor_enrollments
  where family_id = p_family_id and status = 'ENROLLED'
  order by last_evaluated_at desc nulls last limit 1 for update;
  if not found or not v_enrollment.scheduler_enabled
    or v_enrollment.next_review_condition <> 'TIME_WINDOW_ELAPSED'
    or (v_previous.evidence_observed_at +
      make_interval(secs => v_previous.maximum_age_seconds) > p_observed_at
      and (v_enrollment.next_eligible_review_at is null
        or v_enrollment.next_eligible_review_at > p_observed_at)) then
    raise exception 'SELLER_OS_LONGITUDINAL_REFRESH_NOT_ELIGIBLE';
  end if;
  if p_observed_at <= v_previous.observation_window_end then
    raise exception 'SELLER_OS_LONGITUDINAL_REFRESH_TIME_INVALID';
  end if;

  v_observation_id := 'family-market-observation-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_FAMILY_MARKET_OBSERVATION_V1',E'\n',p_family_id,E'\n',
      to_char(v_previous.observation_window_end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),E'\n',
      to_char(p_observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),'UTF8'),'sha256'),'hex');
  select * into v_existing from public.seller_os_family_market_observations
  where observation_id = v_observation_id;
  if found then
    return jsonb_build_object('outcome','IDEMPOTENT_SUCCESS',
      'familyId',p_family_id,'observationId',v_existing.observation_id,
      'previousObservationId',v_existing.previous_observation_id,
      'momentumStatus',v_existing.momentum_status,
      'duplicateObservationCreated',false);
  end if;

  v_reasons := coalesce((select array_agg(distinct reason order by reason)
    from unnest(coalesce(p_commercial_exclusion_reasons,'{}')) reason),'{}');
  v_demand_digest := 'sha256:' || encode(extensions.digest(convert_to(
    concat(v_previous.demand_evidence_digest,E'\n',p_active_evidence_digest),
    'UTF8'),'sha256'),'hex');
  v_input_digest := 'sha256:' || encode(extensions.digest(convert_to(
    jsonb_build_object('familyId',p_family_id,
      'previousObservationId',v_previous.observation_id,
      'observationWindowStart',v_previous.observation_window_end,
      'observationWindowEnd',p_observed_at,
      'activeEvidenceDigest',p_active_evidence_digest,
      'activeComparableCount',p_active_comparable_count,
      'sellerDiversity',p_seller_diversity,
      'competitionState',p_competition_state,
      'commercialComparableStatus',p_commercial_comparable_status,
      'commercialComparableCount',p_commercial_comparable_count,
      'commercialExactCount',p_commercial_exact_count,
      'commercialStrongCount',p_commercial_strong_count,
      'commercialPriceTypicalLow',p_commercial_price_typical_low,
      'commercialPriceTypicalHigh',p_commercial_price_typical_high,
      'commercialPriceMedian',p_commercial_price_median,
      'rawOutliersExcludedCount',p_raw_outliers_excluded_count,
      'commercialExclusionReasons',to_jsonb(v_reasons),
      'sourceContractVersion',p_source_contract_version)::text,
    'UTF8'),'sha256'),'hex');

  select count(*) into v_prior_count
  from public.seller_os_family_market_observations
  where family_id = p_family_id;
  if v_prior_count < 1 then
    v_momentum := 'INSUFFICIENT_HISTORY';
  elsif v_previous.active_comparable_count is null then
    v_momentum := 'NEEDS_MORE_EVIDENCE';
  elsif v_previous.active_comparable_count = 0 then
    v_momentum := case when p_active_comparable_count > 0
      then 'NEW' else 'STABLE' end;
  else
    v_change := (p_active_comparable_count -
      v_previous.active_comparable_count)::numeric /
      v_previous.active_comparable_count;
    v_momentum := case when v_change >= 0.20 then 'STRENGTHENING'
      when v_change <= -0.20 then 'WEAKENING' else 'STABLE' end;
  end if;

  insert into public.seller_os_family_market_observations (
    observation_id,family_id,opportunity_case_id,
    family_definition_version_id,observation_window_start,
    observation_window_end,family_demand_status,demand_evidence_class,
    source_status,aggregation_semantics,demand_evidence_references,
    demand_evidence_digest,observation_input_digest,sold_comparable_count,
    sold_quantity,sold_quantity_evidence,active_comparable_count,
    seller_diversity,price_currency,price_band_minimum,
    price_band_maximum,price_median,price_distribution_evidence,
    competition_state,buyer_intent_terms,keyword_state,attribute_profile,
    opportunity_types,evidence_observed_at,source_updated_at,
    maximum_age_seconds,source_adapter,source_contract_version,
    previous_observation_id,momentum_status,momentum_evidence_fields,
    momentum_policy_version,limitations,active_evidence_digest,
    marketplace_read_count,commercial_comparable_status,
    commercial_comparable_count,commercial_exact_count,
    commercial_strong_count,commercial_price_typical_low,
    commercial_price_typical_high,commercial_price_median,
    raw_outliers_excluded_count,commercial_exclusion_reasons
  ) values (
    v_observation_id,p_family_id,v_case.opportunity_case_id,
    v_previous.family_definition_version_id,v_previous.observation_window_end,
    p_observed_at,v_previous.family_demand_status,
    v_previous.demand_evidence_class,'AVAILABLE','CUMULATIVE_SNAPSHOT',
    v_previous.demand_evidence_references,v_demand_digest,v_input_digest,
    v_previous.sold_comparable_count,v_previous.sold_quantity,
    v_previous.sold_quantity_evidence,p_active_comparable_count,
    p_seller_diversity,v_previous.price_currency,
    v_previous.price_band_minimum,v_previous.price_band_maximum,
    v_previous.price_median,v_previous.price_distribution_evidence,
    p_competition_state,v_previous.buyer_intent_terms,
    v_previous.keyword_state,v_previous.attribute_profile,
    v_previous.opportunity_types,p_observed_at,p_observed_at,2592000,
    'SELLER_OS_LONGITUDINAL_RADAR_RUNTIME_V1',p_source_contract_version,
    v_previous.observation_id,v_momentum,
    array['activeComparableCount','commercialComparableCount',
      'commercialPriceMedian','observationWindowStart',
      'observationWindowEnd']::text[],
    'SELLER_OS_LONGITUDINAL_MOMENTUM_POLICY_V1',
    array(select distinct limitation from unnest(v_previous.limitations ||
      array['EXACT_PRODUCT_DEMAND_NOT_CLAIMED']::text[]) limitation
      order by limitation),p_active_evidence_digest,
    p_marketplace_read_count,p_commercial_comparable_status,
    p_commercial_comparable_count,p_commercial_exact_count,
    p_commercial_strong_count,p_commercial_price_typical_low,
    p_commercial_price_typical_high,p_commercial_price_median,
    p_raw_outliers_excluded_count,v_reasons
  );

  update public.seller_os_opportunity_monitor_enrollments
  set last_observation_id = v_observation_id,
      last_evaluated_at = p_observed_at,
      next_eligible_review_at = p_observed_at + interval '30 days',
      next_review_condition = 'TIME_WINDOW_ELAPSED',
      scheduler_enabled = true,
      updated_at = now()
  where enrollment_id = v_enrollment.enrollment_id;

  return jsonb_build_object('outcome','CREATED','familyId',p_family_id,
    'observationId',v_observation_id,
    'previousObservationId',v_previous.observation_id,
    'momentumStatus',v_momentum,'duplicateObservationCreated',false,
    'nextEligibleReviewAt',p_observed_at + interval '30 days');
end;
$function$;

revoke all on function public.put_seller_os_longitudinal_family_refresh_v1(
  text,text,timestamptz,text,integer,integer,integer,text,text,integer,
  integer,integer,numeric,numeric,numeric,integer,text[],text)
  from public,anon,authenticated;
grant execute on function public.put_seller_os_longitudinal_family_refresh_v1(
  text,text,timestamptz,text,integer,integer,integer,text,text,integer,
  integer,integer,numeric,numeric,numeric,integer,text[],text)
  to service_role;

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
      'currentKeyProductAttributes',to_jsonb(definition.key_product_attributes),
      'currentMonitorEnrolledAt',current_enrollment.enrolled_at,
      'currentDemandKeywordDna',definition.demand_keyword_dna,
      'demandKeywordDnaStatus',case when definition.demand_keyword_dna is null
        then 'LEGACY_UNAVAILABLE' else 'AVAILABLE' end,
      'monitorEnrollments',coalesce(enrollment_series.value,'[]'::jsonb),
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
    order by enrollment.last_evaluated_at desc,enrollment.enrollment_id desc
    limit 1
  ) current_enrollment on true
  left join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
      'enrollmentId',enrollment.enrollment_id,'status',enrollment.status,
      'nextReviewCondition',enrollment.next_review_condition,
      'nextEligibleReviewAt',enrollment.next_eligible_review_at,
      'lastObservationId',enrollment.last_observation_id,
      'lastEvaluatedAt',enrollment.last_evaluated_at,
      'monitorPolicyVersion',enrollment.monitor_policy_version,
      'schedulerEnabled',enrollment.scheduler_enabled
    ) order by enrollment.last_evaluated_at desc nulls last),'[]'::jsonb) value
    from public.seller_os_opportunity_monitor_enrollments enrollment
    where enrollment.family_id = opportunity_case.family_id
  ) enrollment_series on true
  left join lateral (
    select coalesce(jsonb_agg(observation.value || jsonb_build_object(
      'demandKeywordDna',stored.demand_keyword_dna,
      'demandKeywordDnaStatus',case when stored.demand_keyword_dna is null
        then 'LEGACY_UNAVAILABLE' else 'AVAILABLE' end,
      'attributeProfile',stored.attribute_profile,
      'buyerIntentTerms',stored.buyer_intent_terms,
      'priceDistributionEvidence',to_jsonb(stored.price_distribution_evidence),
      'activeEvidenceDigest',stored.active_evidence_digest,
      'marketplaceReadCount',stored.marketplace_read_count,
      'commercialComparableStatus',stored.commercial_comparable_status,
      'commercialComparableCount',stored.commercial_comparable_count,
      'commercialExactCount',stored.commercial_exact_count,
      'commercialStrongCount',stored.commercial_strong_count,
      'commercialPriceTypicalLow',stored.commercial_price_typical_low,
      'commercialPriceTypicalHigh',stored.commercial_price_typical_high,
      'commercialPriceMedian',stored.commercial_price_median,
      'rawOutliersExcludedCount',stored.raw_outliers_excluded_count,
      'commercialExclusionReasons',to_jsonb(stored.commercial_exclusion_reasons)
    ) order by observation.ordinality),'[]'::jsonb) value
    from jsonb_array_elements(coalesce(
      family.value -> 'observationSeries','[]'::jsonb))
      with ordinality observation(value,ordinality)
    left join public.seller_os_family_market_observations stored
      on stored.observation_id = observation.value ->> 'observationId'
  ) observation_series on true;
  return jsonb_set(v_legacy,'{families}',v_families,true) ||
    jsonb_build_object(
      'longitudinalRuntimeContractVersion',
        'SELLER_OS_LONGITUDINAL_RADAR_RUNTIME_V1',
      'schedulerTrigger','VERCEL_CRON_MARKET_RADAR_LUNA_SYNC',
      'schedulerEnabled',true,
      'commercialComparableContractVersion',
        'SELLER_OS_COMMERCIAL_COMPARABLE_CLUSTER_V1',
      'keywordDnaContractVersion','SELLER_OS_DEMAND_KEYWORD_DNA_V1',
      'priceDistributionReadContractVersion',
        'RADAR_AUTOMATIC_PRICE_DISTRIBUTION_CONTINUATION_V1',
      'existingFamilyRefreshContractVersion',
        'RADAR_EXISTING_FAMILY_REFRESH_V1');
end;
$function$;

revoke all on function public.get_seller_os_family_market_radar_v1(text,integer)
  from public,anon,authenticated;
grant execute on function public.get_seller_os_family_market_radar_v1(text,integer)
  to service_role;

comment on function public.put_seller_os_longitudinal_family_refresh_v1(
  text,text,timestamptz,text,integer,integer,integer,text,text,integer,
  integer,integer,numeric,numeric,numeric,integer,text[],text) is
  'Append-only eligible-family refresh. Copies verified sold lineage, records one bounded official active read, advances the existing enrollment and never claims exact product demand.';

notify pgrst,'reload schema';
