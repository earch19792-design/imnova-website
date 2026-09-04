-- Let an identical scheduler retry read the already-created observation before
-- the stale-current guard. Conflicting payloads for the same window still fail.

alter function public.put_seller_os_longitudinal_family_refresh_v1(
  text,text,timestamptz,text,integer,integer,integer,text,text,integer,
  integer,integer,numeric,numeric,numeric,integer,text[],text)
  rename to put_seller_os_longitudinal_family_refresh_v1_impl;

revoke all on function public.put_seller_os_longitudinal_family_refresh_v1_impl(
  text,text,timestamptz,text,integer,integer,integer,text,text,integer,
  integer,integer,numeric,numeric,numeric,integer,text[],text)
  from public,anon,authenticated,service_role;

create function public.put_seller_os_longitudinal_family_refresh_v1(
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
  v_expected public.seller_os_family_market_observations%rowtype;
  v_existing public.seller_os_family_market_observations%rowtype;
  v_observation_id text;
  v_reasons text[];
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'SELLER_OS_LONGITUDINAL_REFRESH_AUTH_REQUIRED';
  end if;
  select * into v_expected
  from public.seller_os_family_market_observations
  where family_id = p_family_id
    and observation_id = p_expected_current_observation_id;
  if found and p_observed_at = date_trunc('milliseconds',p_observed_at) then
    v_observation_id := 'family-market-observation-v1:sha256:' || encode(
      extensions.digest(convert_to(concat(
        'SELLER_OS_FAMILY_MARKET_OBSERVATION_V1',E'\n',p_family_id,E'\n',
        to_char(v_expected.observation_window_end at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),E'\n',
        to_char(p_observed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),'UTF8'),'sha256'),'hex');
    select * into v_existing
    from public.seller_os_family_market_observations
    where observation_id = v_observation_id;
    if found then
      select coalesce(array_agg(distinct reason order by reason),'{}')
        into v_reasons
      from unnest(coalesce(p_commercial_exclusion_reasons,'{}')) reason;
      if v_existing.family_id is distinct from p_family_id
        or v_existing.previous_observation_id is distinct from
          p_expected_current_observation_id
        or v_existing.active_evidence_digest is distinct from
          p_active_evidence_digest
        or v_existing.marketplace_read_count is distinct from
          p_marketplace_read_count
        or v_existing.active_comparable_count is distinct from
          p_active_comparable_count
        or v_existing.seller_diversity is distinct from p_seller_diversity
        or v_existing.competition_state is distinct from p_competition_state
        or v_existing.commercial_comparable_status is distinct from
          p_commercial_comparable_status
        or v_existing.commercial_comparable_count is distinct from
          p_commercial_comparable_count
        or v_existing.commercial_exact_count is distinct from
          p_commercial_exact_count
        or v_existing.commercial_strong_count is distinct from
          p_commercial_strong_count
        or v_existing.commercial_price_typical_low is distinct from
          p_commercial_price_typical_low
        or v_existing.commercial_price_typical_high is distinct from
          p_commercial_price_typical_high
        or v_existing.commercial_price_median is distinct from
          p_commercial_price_median
        or v_existing.raw_outliers_excluded_count is distinct from
          p_raw_outliers_excluded_count
        or v_existing.commercial_exclusion_reasons is distinct from v_reasons
        or v_existing.source_contract_version is distinct from
          p_source_contract_version then
        raise exception 'SELLER_OS_LONGITUDINAL_REFRESH_REPLAY_CONFLICT';
      end if;
      return jsonb_build_object('outcome','IDEMPOTENT_SUCCESS',
        'familyId',p_family_id,'observationId',v_existing.observation_id,
        'previousObservationId',v_existing.previous_observation_id,
        'momentumStatus',v_existing.momentum_status,
        'duplicateObservationCreated',false);
    end if;
  end if;
  return public.put_seller_os_longitudinal_family_refresh_v1_impl(
    p_family_id,p_expected_current_observation_id,p_observed_at,
    p_active_evidence_digest,p_marketplace_read_count,
    p_active_comparable_count,p_seller_diversity,p_competition_state,
    p_commercial_comparable_status,p_commercial_comparable_count,
    p_commercial_exact_count,p_commercial_strong_count,
    p_commercial_price_typical_low,p_commercial_price_typical_high,
    p_commercial_price_median,p_raw_outliers_excluded_count,
    p_commercial_exclusion_reasons,p_source_contract_version);
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

notify pgrst,'reload schema';
