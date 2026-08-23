-- OP-LAUNCH-I02W1: durable provisional profitability frontiers and the
-- approved-but-disabled commercial time policy.
--
-- This migration is intentionally ordered after 20260823023000. It does not
-- register or enable a scheduler, run the autopilot, or bootstrap operational
-- frontier rows. Phase 6 retains canonical economics authority.

create table public.seller_os_profitability_frontier_snapshots (
  frontier_id text primary key,
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  configuration_id text not null,
  family_id text not null,
  opportunity_case_id text null,
  luna_product_id text not null,
  luna_variant_id text not null,
  luna_sku text not null,
  product_fit text not null,
  market_price_evidence_reference text not null,
  market_price_evidence_digest text not null,
  market_price_low numeric(14,2) null,
  market_price_median numeric(14,2) null,
  market_price_high numeric(14,2) null,
  luna_cost numeric(14,2) null,
  supplier_quantity_required integer null,
  total_product_cost numeric(14,2) null,
  shipping_status text not null,
  shipping_value numeric(14,2) null,
  ebay_fee_policy_reference text not null,
  economic_policy_reference text not null,
  economic_policy_digest text not null,
  contribution_profit_median numeric(14,2) null,
  contribution_margin_median numeric(9,4) null,
  break_even_price numeric(14,2) null,
  max_shipping_break_even numeric(14,2) null,
  max_shipping_target_margin numeric(14,2) null,
  max_product_cost_target_margin numeric(14,2) null,
  min_price_target_margin numeric(14,2) null,
  economic_classification text not null,
  hard_blockers jsonb not null,
  next_best_evidence text not null,
  next_evidence_value text not null,
  source_updated_at timestamptz not null,
  evidence_cutoff_at timestamptz not null,
  calculated_at timestamptz not null,
  frontier_digest text not null,
  snapshot_digest text not null,
  frontier_payload jsonb not null,
  provisional_fast_lane_economics boolean not null default true,
  phase_6_canonical_authority boolean not null default false,
  created_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  contract_version text not null default 'SELLER_OS_PROFITABILITY_FRONTIER_V1',
  constraint seller_os_profitability_frontier_id_check check (
    frontier_id ~ '^profitability-frontier-v1:sha256:[0-9a-f]{64}$'
  ),
  constraint seller_os_profitability_frontier_scope_check check (
    account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
  ),
  constraint seller_os_profitability_frontier_identity_check check (
    configuration_id ~ '^launch-configuration-v1:sha256:[0-9a-f]{64}$'
    and family_id ~ '^market-family-v1:sha256:[0-9a-f]{64}$'
    and (opportunity_case_id is null or opportunity_case_id ~
      '^opportunity-case-v1:sha256:[0-9a-f]{64}$')
    and luna_product_id ~ '^[0-9]{1,30}$'
    and luna_variant_id ~ '^[0-9]{1,30}$'
    and luna_sku ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$'
  ),
  constraint seller_os_profitability_frontier_enum_check check (
    product_fit in ('STRONG', 'MEDIUM', 'WEAK', 'UNPROVEN')
    and shipping_status in (
      'SHIPPING_OBSERVED', 'SHIPPING_DURABLY_PERSISTED',
      'SHIPPING_PROVISIONAL_RESERVE', 'SHIPPING_UNPROVEN'
    )
    and economic_classification in (
      'ECONOMICALLY_DEAD', 'ECONOMICALLY_RECOVERABLE',
      'ECONOMICALLY_PROMISING', 'ECONOMICS_UNPROVEN'
    )
    and next_best_evidence in (
      'ACTUAL_LUNA_SHIPPING', 'BETTER_PRICE_DISTRIBUTION',
      'CURRENT_EBAY_COMPETITION', 'EXACT_SUBTYPE_DEMAND',
      'COMPLIANCE', 'LUNA_COST_CONFIRMATION', 'NONE'
    )
    and next_evidence_value in ('HIGH', 'MEDIUM', 'LOW', 'NEAR_ZERO')
  ),
  constraint seller_os_profitability_frontier_money_check check (
    (market_price_low is null or market_price_low >= 0)
    and (market_price_median is null or market_price_median >= 0)
    and (market_price_high is null or market_price_high >= 0)
    and (market_price_low is null or market_price_median is null
      or market_price_low <= market_price_median)
    and (market_price_median is null or market_price_high is null
      or market_price_median <= market_price_high)
    and (luna_cost is null or luna_cost >= 0)
    and (supplier_quantity_required is null
      or supplier_quantity_required between 1 and 10000)
    and (total_product_cost is null or total_product_cost >= 0)
    and (shipping_value is null or shipping_value >= 0)
    and (break_even_price is null or break_even_price >= 0)
    and (max_shipping_break_even is null or max_shipping_break_even >= 0)
    and (min_price_target_margin is null or min_price_target_margin >= 0)
    and (shipping_status <> 'SHIPPING_UNPROVEN' or shipping_value is null)
    and (shipping_status = 'SHIPPING_UNPROVEN' or shipping_value is not null)
  ),
  constraint seller_os_profitability_frontier_evidence_check check (
    market_price_evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
    and market_price_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    and ebay_fee_policy_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
    and economic_policy_reference ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
    and economic_policy_digest ~ '^sha256:[0-9a-f]{64}$'
    and frontier_digest ~ '^sha256:[0-9a-f]{64}$'
    and snapshot_digest ~ '^sha256:[0-9a-f]{64}$'
    and source_updated_at <= evidence_cutoff_at
    and evidence_cutoff_at <= calculated_at
  ),
  constraint seller_os_profitability_frontier_blockers_check check (
    jsonb_typeof(hard_blockers) = 'array'
    and jsonb_array_length(hard_blockers) <= 20
  ),
  constraint seller_os_profitability_frontier_payload_check check (
    jsonb_typeof(frontier_payload) = 'object'
    and frontier_payload ->> 'contractVersion' =
      'SELLER_OS_PROFITABILITY_FRONTIER_V1'
    and frontier_payload ->> 'configurationId' = configuration_id
    and frontier_payload ->> 'familyId' = family_id
    and frontier_payload ->> 'lunaProductId' = luna_product_id
    and frontier_payload ->> 'lunaVariantId' = luna_variant_id
    and frontier_payload ->> 'lunaSku' = luna_sku
    and frontier_payload ->> 'productFit' = product_fit
    and frontier_payload ->> 'shippingStatus' = shipping_status
    and frontier_payload ->> 'economicClassification' = economic_classification
    and frontier_payload ->> 'frontierDigest' = frontier_digest
    and frontier_payload -> 'currentHardBlockers' = hard_blockers
    and frontier_payload ->> 'nextBestEvidence' = next_best_evidence
    and frontier_payload ->> 'nextEvidenceValue' = next_evidence_value
    and frontier_payload ->> 'evaluatedAt' =
      to_char(calculated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    and frontier_payload -> 'phase6CanonicalEconomicsAuthority' = 'false'::jsonb
    and frontier_payload -> 'unknownShippingTreatedAsZero' = 'false'::jsonb
    and frontier_payload -> 'listingAuthorized' = 'false'::jsonb
  ),
  constraint seller_os_profitability_frontier_authority_check check (
    provisional_fast_lane_economics
    and not phase_6_canonical_authority
    and contract_version = 'SELLER_OS_PROFITABILITY_FRONTIER_V1'
  ),
  constraint seller_os_profitability_frontier_snapshot_unique unique (
    account_key, marketplace_id, family_id, luna_product_id, luna_variant_id,
    market_price_evidence_digest, economic_policy_digest, shipping_status,
    shipping_value, contract_version
  )
);

create index seller_os_profitability_frontier_latest_idx
  on public.seller_os_profitability_frontier_snapshots (
    account_key, marketplace_id, family_id, luna_product_id, luna_variant_id,
    calculated_at desc, frontier_id
  );

create or replace function public.reject_seller_os_profitability_frontier_mutation_v1()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_APPEND_ONLY';
end;
$function$;

create trigger seller_os_profitability_frontier_append_only
before update or delete on public.seller_os_profitability_frontier_snapshots
for each row execute function
  public.reject_seller_os_profitability_frontier_mutation_v1();

create or replace function public.put_seller_os_profitability_frontier_v1(
  p_account_key text,
  p_marketplace_id text,
  p_opportunity_case_id text,
  p_market_price_evidence_reference text,
  p_market_price_evidence_digest text,
  p_ebay_fee_policy_reference text,
  p_economic_policy_reference text,
  p_economic_policy_digest text,
  p_source_updated_at timestamptz,
  p_evidence_cutoff_at timestamptz,
  p_frontier jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_account_key text := trim(coalesce(p_account_key, ''));
  v_configuration_id text := trim(coalesce(p_frontier ->> 'configurationId', ''));
  v_family_id text := trim(coalesce(p_frontier ->> 'familyId', ''));
  v_product_id text := trim(coalesce(p_frontier ->> 'lunaProductId', ''));
  v_variant_id text := trim(coalesce(p_frontier ->> 'lunaVariantId', ''));
  v_sku text := trim(coalesce(p_frontier ->> 'lunaSku', ''));
  v_shipping_status text := trim(coalesce(p_frontier ->> 'shippingStatus', ''));
  v_shipping_value numeric;
  v_calculated_at timestamptz;
  v_frontier_id text;
  v_snapshot_digest text;
  v_existing public.seller_os_profitability_frontier_snapshots%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or jsonb_typeof(p_frontier) <> 'object'
    or v_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_marketplace_id <> 'EBAY_US'
    or v_configuration_id !~ '^launch-configuration-v1:sha256:[0-9a-f]{64}$'
    or v_family_id !~ '^market-family-v1:sha256:[0-9a-f]{64}$'
    or (p_opportunity_case_id is not null and p_opportunity_case_id !~
      '^opportunity-case-v1:sha256:[0-9a-f]{64}$')
    or v_product_id !~ '^[0-9]{1,30}$'
    or v_variant_id !~ '^[0-9]{1,30}$'
    or v_sku !~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$'
    or coalesce(p_market_price_evidence_reference, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
    or coalesce(p_market_price_evidence_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_ebay_fee_policy_reference, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
    or coalesce(p_economic_policy_reference, '') !~
      '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,239}$'
    or coalesce(p_economic_policy_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_frontier ->> 'frontierDigest', '') !~ '^sha256:[0-9a-f]{64}$'
    or p_source_updated_at is distinct from
      date_trunc('milliseconds', p_source_updated_at)
    or p_evidence_cutoff_at is distinct from
      date_trunc('milliseconds', p_evidence_cutoff_at) then
    raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_INPUT_INVALID';
  end if;

  begin
    v_shipping_value := (p_frontier ->> 'shippingValue')::numeric;
  exception when others then
    if p_frontier -> 'shippingValue' <> 'null'::jsonb then
      raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_INPUT_INVALID';
    end if;
    v_shipping_value := null;
  end;

  begin
    v_calculated_at := (p_frontier ->> 'evaluatedAt')::timestamptz;
  exception when others then
    raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_INPUT_INVALID';
  end;
  v_calculated_at := date_trunc('milliseconds', v_calculated_at);

  if p_source_updated_at > p_evidence_cutoff_at
    or p_evidence_cutoff_at > v_calculated_at
    or p_frontier ->> 'contractVersion' <>
      'SELLER_OS_PROFITABILITY_FRONTIER_V1'
    or p_frontier -> 'phase6CanonicalEconomicsAuthority' <> 'false'::jsonb
    or p_frontier -> 'unknownShippingTreatedAsZero' <> 'false'::jsonb
    or p_frontier -> 'listingAuthorized' <> 'false'::jsonb
    or jsonb_typeof(p_frontier -> 'currentHardBlockers') <> 'array'
    or jsonb_array_length(p_frontier -> 'currentHardBlockers') > 20
    or exists (
      select 1 from jsonb_array_elements_text(
        p_frontier -> 'currentHardBlockers') blocker(value)
      where blocker.value !~ '^[A-Z][A-Z0-9_]{2,119}$'
    ) then
    raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_INPUT_INVALID';
  end if;

  v_frontier_id := 'profitability-frontier-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_PROFITABILITY_FRONTIER_ID_V1', E'\n',
      v_family_id, E'\n', v_product_id, E'\n', v_variant_id, E'\n',
      p_market_price_evidence_digest, E'\n', p_economic_policy_digest, E'\n',
      v_shipping_status, E'\n', coalesce(v_shipping_value::text, 'UNPROVEN')
    ), 'UTF8'), 'sha256'), 'hex'
  );
  v_snapshot_digest := 'sha256:' || encode(extensions.digest(convert_to(concat(
    p_frontier::text, E'\n', p_market_price_evidence_reference, E'\n',
    p_ebay_fee_policy_reference, E'\n', p_economic_policy_reference, E'\n',
    p_source_updated_at::text, E'\n', p_evidence_cutoff_at::text
  ), 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(v_frontier_id, 0));
  select * into v_existing
  from public.seller_os_profitability_frontier_snapshots
  where frontier_id = v_frontier_id
  for update;
  if found then
    if v_existing.snapshot_digest <> v_snapshot_digest then
      raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object('outcome', 'IDEMPOTENT_SUCCESS',
      'frontierId', v_existing.frontier_id,
      'frontierDigest', v_existing.frontier_digest,
      'snapshotDigest', v_existing.snapshot_digest);
  end if;

  insert into public.seller_os_profitability_frontier_snapshots (
    frontier_id, account_key, marketplace_id, configuration_id, family_id,
    opportunity_case_id, luna_product_id, luna_variant_id, luna_sku, product_fit,
    market_price_evidence_reference, market_price_evidence_digest,
    market_price_low, market_price_median, market_price_high,
    luna_cost, supplier_quantity_required, total_product_cost,
    shipping_status, shipping_value, ebay_fee_policy_reference,
    economic_policy_reference, economic_policy_digest,
    contribution_profit_median, contribution_margin_median, break_even_price,
    max_shipping_break_even, max_shipping_target_margin,
    max_product_cost_target_margin, min_price_target_margin,
    economic_classification, hard_blockers, next_best_evidence,
    next_evidence_value, source_updated_at, evidence_cutoff_at, calculated_at,
    frontier_digest, snapshot_digest, frontier_payload
  ) values (
    v_frontier_id, v_account_key, p_marketplace_id, v_configuration_id,
    v_family_id, p_opportunity_case_id, v_product_id, v_variant_id, v_sku,
    p_frontier ->> 'productFit', p_market_price_evidence_reference,
    p_market_price_evidence_digest,
    nullif(p_frontier ->> 'marketPriceMin', '')::numeric,
    nullif(p_frontier ->> 'marketPriceMedian', '')::numeric,
    nullif(p_frontier ->> 'marketPriceMax', '')::numeric,
    nullif(p_frontier ->> 'lunaUnitCost', '')::numeric,
    nullif(p_frontier ->> 'supplierQuantityRequired', '')::integer,
    nullif(p_frontier ->> 'totalProductCost', '')::numeric,
    v_shipping_status, v_shipping_value, p_ebay_fee_policy_reference,
    p_economic_policy_reference, p_economic_policy_digest,
    nullif(p_frontier ->> 'contributionProfitAtMarketMedian', '')::numeric,
    nullif(p_frontier ->> 'contributionMarginAtMarketMedian', '')::numeric,
    nullif(p_frontier ->> 'breakEvenSellingPrice', '')::numeric,
    nullif(p_frontier ->> 'maxShippingAtBreakEven', '')::numeric,
    nullif(p_frontier ->> 'maxShippingAtTargetMargin', '')::numeric,
    nullif(p_frontier ->> 'maxProductCostAtTargetMargin', '')::numeric,
    nullif(p_frontier ->> 'minSellingPriceAtTargetMargin', '')::numeric,
    p_frontier ->> 'economicClassification',
    p_frontier -> 'currentHardBlockers', p_frontier ->> 'nextBestEvidence',
    p_frontier ->> 'nextEvidenceValue', p_source_updated_at,
    p_evidence_cutoff_at, v_calculated_at, p_frontier ->> 'frontierDigest',
    v_snapshot_digest, p_frontier
  );

  return jsonb_build_object('outcome', 'CREATED', 'frontierId', v_frontier_id,
    'frontierDigest', p_frontier ->> 'frontierDigest',
    'snapshotDigest', v_snapshot_digest);
exception when unique_violation then
  raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_IDENTITY_CONFLICT';
end;
$function$;

create or replace function public.get_seller_os_latest_profitability_frontiers_v1(
  p_account_key text,
  p_marketplace_id text default 'EBAY_US',
  p_family_ids jsonb default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_rows jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
    or coalesce(trim(p_account_key), '') !~
      '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_marketplace_id <> 'EBAY_US'
    or p_limit not between 1 and 100
    or (p_family_ids is not null and (
      jsonb_typeof(p_family_ids) <> 'array'
      or jsonb_array_length(p_family_ids) > 100
      or exists (
        select 1 from jsonb_array_elements_text(p_family_ids) family(value)
        where family.value !~ '^market-family-v1:sha256:[0-9a-f]{64}$'
      )
    )) then
    raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_SELECTOR_INVALID';
  end if;

  with ranked as (
    select snapshot.*,
      row_number() over (
        partition by snapshot.family_id, snapshot.luna_product_id,
          snapshot.luna_variant_id
        order by snapshot.calculated_at desc, snapshot.frontier_id collate "C"
      ) as rank
    from public.seller_os_profitability_frontier_snapshots snapshot
    where snapshot.account_key = trim(p_account_key)
      and snapshot.marketplace_id = p_marketplace_id
      and (p_family_ids is null or snapshot.family_id in (
        select jsonb_array_elements_text(p_family_ids)
      ))
  ), selected as (
    select * from ranked where rank = 1
    order by family_id collate "C", luna_product_id collate "C",
      luna_variant_id collate "C"
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'frontierId', frontier_id,
    'accountKey', account_key,
    'marketplaceId', marketplace_id,
    'opportunityCaseId', opportunity_case_id,
    'marketPriceEvidenceReference', market_price_evidence_reference,
    'marketPriceEvidenceDigest', market_price_evidence_digest,
    'ebayFeePolicyReference', ebay_fee_policy_reference,
    'economicPolicyReference', economic_policy_reference,
    'economicPolicyDigest', economic_policy_digest,
    'sourceUpdatedAt', source_updated_at,
    'evidenceCutoffAt', evidence_cutoff_at,
    'calculatedAt', calculated_at,
    'snapshotDigest', snapshot_digest,
    'provisionalFastLaneEconomics', provisional_fast_lane_economics,
    'phase6CanonicalAuthority', phase_6_canonical_authority,
    'frontier', frontier_payload
  ) order by family_id collate "C", luna_product_id collate "C",
    luna_variant_id collate "C"), '[]'::jsonb)
  into v_rows from selected;

  return jsonb_build_object(
    'status', case when jsonb_array_length(v_rows) > 0 then 'AVAILABLE'
      else 'UNAVAILABLE' end,
    'reason', case when jsonb_array_length(v_rows) > 0 then null
      else 'COMPLETE_CANONICAL_I02V_FRONTIER_DURABILITY_UNAVAILABLE' end,
    'resultCount', jsonb_array_length(v_rows),
    'frontiers', v_rows,
    'provisionalFastLaneEconomics', true,
    'phase6CanonicalAuthority', false,
    'contractVersion', 'SELLER_OS_PROFITABILITY_FRONTIER_READ_V1'
  );
end;
$function$;

alter table public.seller_os_profitability_frontier_snapshots
  enable row level security;
alter table public.seller_os_profitability_frontier_snapshots
  force row level security;
revoke all on table public.seller_os_profitability_frontier_snapshots
  from public, anon, authenticated, service_role;
grant select, insert on table public.seller_os_profitability_frontier_snapshots
  to postgres;
create policy seller_os_profitability_frontier_rpc_owner_read
  on public.seller_os_profitability_frontier_snapshots for select to postgres
  using (public.is_seller_os_service_role_request_v1());
create policy seller_os_profitability_frontier_rpc_owner_insert
  on public.seller_os_profitability_frontier_snapshots for insert to postgres
  with check (public.is_seller_os_service_role_request_v1());

revoke all on function public.reject_seller_os_profitability_frontier_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.put_seller_os_profitability_frontier_v1(
  text,text,text,text,text,text,text,text,timestamptz,timestamptz,jsonb
) from public, anon, authenticated;
grant execute on function public.put_seller_os_profitability_frontier_v1(
  text,text,text,text,text,text,text,text,timestamptz,timestamptz,jsonb
) to service_role;
revoke all on function public.get_seller_os_latest_profitability_frontiers_v1(
  text,text,jsonb,integer
) from public, anon, authenticated;
grant execute on function public.get_seller_os_latest_profitability_frontiers_v1(
  text,text,jsonb,integer
) to service_role;

-- Freeze the commercial money-engine schedule policy without granting runtime
-- authority. The trigger is restored immediately after the one-time migration
-- update, keeping this singleton immutable at runtime.
drop trigger seller_os_daily_dollar_scheduler_policy_immutable
  on public.seller_os_daily_dollar_radar_scheduler_policy;
alter table public.seller_os_daily_dollar_radar_scheduler_policy
  drop constraint seller_os_daily_dollar_radar_scheduler__scheduler_enabled_check,
  drop constraint seller_os_daily_dollar_radar_scheduler_poli_policy_status_check,
  drop constraint seller_os_daily_dollar_radar_scheduler__business_timezone_check,
  drop constraint seller_os_daily_dollar_radar_scheduler__utc_cron_schedule_check,
  drop constraint seller_os_daily_dollar_radar_scheduler_p_policy_reference_check;
update public.seller_os_daily_dollar_radar_scheduler_policy
set scheduler_enabled = false,
    policy_status = 'PREFLIGHT_APPROVED_DISABLED_PENDING_STORAGE_APPLY',
    business_timezone = 'America/New_York',
    utc_cron_schedule = '0 9 * * *',
    policy_reference =
      'SELLER_OS_COMMERCIAL_TIMEZONE_V1:America/New_York:READY_BY_06:00'
where singleton;
alter table public.seller_os_daily_dollar_radar_scheduler_policy
  alter column business_timezone set not null,
  alter column utc_cron_schedule set not null,
  alter column policy_reference set not null,
  alter column business_timezone set default 'America/New_York',
  alter column utc_cron_schedule set default '0 9 * * *',
  alter column policy_reference set default
    'SELLER_OS_COMMERCIAL_TIMEZONE_V1:America/New_York:READY_BY_06:00';
alter table public.seller_os_daily_dollar_radar_scheduler_policy
  add constraint seller_os_daily_dollar_scheduler_disabled_check check (
    not scheduler_enabled
  ),
  add constraint seller_os_daily_dollar_scheduler_policy_status_check check (
    policy_status = 'PREFLIGHT_APPROVED_DISABLED_PENDING_STORAGE_APPLY'
  ),
  add constraint seller_os_daily_dollar_scheduler_timezone_check check (
    business_timezone = 'America/New_York'
  ),
  add constraint seller_os_daily_dollar_scheduler_cron_check check (
    utc_cron_schedule = '0 9 * * *'
  ),
  add constraint seller_os_daily_dollar_scheduler_reference_check check (
    policy_reference =
      'SELLER_OS_COMMERCIAL_TIMEZONE_V1:America/New_York:READY_BY_06:00'
  );
create trigger seller_os_daily_dollar_scheduler_policy_immutable
before update or delete
on public.seller_os_daily_dollar_radar_scheduler_policy
for each row execute function
  public.reject_seller_os_daily_dollar_append_mutation_v1();

-- A New York calendar day can contain 23, 24, or 25 elapsed hours. Replace the
-- exact-24-hour checks without changing the existing public RPC signature.
alter table public.seller_os_daily_dollar_radar_runs
  drop constraint seller_os_daily_dollar_radar_window_check;
alter table public.seller_os_daily_dollar_radar_runs
  add constraint seller_os_daily_dollar_radar_window_check check (
    logical_window_end > logical_window_start
    and logical_window_end - logical_window_start between interval '23 hours'
      and interval '25 hours'
    and (logical_window_start at time zone 'America/New_York')::time = time '00:00'
    and (logical_window_end at time zone 'America/New_York')::time = time '00:00'
    and (logical_window_end at time zone 'America/New_York')::date =
      (logical_window_start at time zone 'America/New_York')::date + 1
    and evidence_cutoff_at = logical_window_end
  );

create or replace function public.claim_seller_os_daily_dollar_radar_run_v1(
  p_account_key text,
  p_marketplace_id text,
  p_logical_window_start timestamptz,
  p_logical_window_end timestamptz,
  p_evidence_cutoff_at timestamptz,
  p_worker_id text,
  p_input_digest text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $function$
declare
  v_now timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_account_key text := trim(coalesce(p_account_key, ''));
  v_worker_id text := trim(coalesce(p_worker_id, ''));
  v_logical_date date;
  v_run_id text;
  v_lease_token text;
  v_lease_token_hash text;
  v_run public.seller_os_daily_dollar_radar_runs%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
    or v_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_marketplace_id <> 'EBAY_US'
    or v_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    or coalesce(p_input_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or p_logical_window_start is distinct from
      date_trunc('milliseconds', p_logical_window_start)
    or p_logical_window_end is distinct from
      date_trunc('milliseconds', p_logical_window_end)
    or p_evidence_cutoff_at is distinct from
      date_trunc('milliseconds', p_evidence_cutoff_at)
    or p_logical_window_end - p_logical_window_start not between
      interval '23 hours' and interval '25 hours'
    or (p_logical_window_start at time zone 'America/New_York')::time <>
      time '00:00'
    or (p_logical_window_end at time zone 'America/New_York')::time <>
      time '00:00'
    or (p_logical_window_end at time zone 'America/New_York')::date <>
      (p_logical_window_start at time zone 'America/New_York')::date + 1
    or p_evidence_cutoff_at <> p_logical_window_end
    or p_lease_seconds not between 60 and 900 then
    raise exception 'SELLER_OS_DAILY_DOLLAR_RUN_INPUT_INVALID';
  end if;

  v_logical_date :=
    (p_logical_window_start at time zone 'America/New_York')::date;
  v_run_id := 'daily-dollar-radar-run-v1:sha256:' || encode(
    extensions.digest(convert_to(concat(
      'SELLER_OS_DAILY_DOLLAR_RADAR_RUN_ID_V1', E'\n',
      v_account_key, E'\n', p_marketplace_id, E'\n', v_logical_date::text,
      E'\n', to_char(p_logical_window_start at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS'), E'Z\n',
      to_char(p_logical_window_end at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS'), 'Z'
    ), 'UTF8'), 'sha256'), 'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended(concat(
    'SELLER_OS_DAILY_DOLLAR_RADAR_RUN_V1:', v_account_key, ':',
    p_marketplace_id, ':', v_logical_date::text
  ), 0));
  select * into v_run
  from public.seller_os_daily_dollar_radar_runs
  where account_key = v_account_key
    and marketplace_id = p_marketplace_id
    and logical_run_date = v_logical_date
    and contract_version = 'SELLER_OS_DAILY_DOLLAR_RADAR_AUTOPILOT_V1'
  for update;

  if found and (
    v_run.run_id <> v_run_id
    or v_run.logical_window_start <> p_logical_window_start
    or v_run.logical_window_end <> p_logical_window_end
    or v_run.evidence_cutoff_at <> p_evidence_cutoff_at
    or v_run.input_digest <> p_input_digest
  ) then
    raise exception 'SELLER_OS_DAILY_DOLLAR_LOGICAL_RUN_CONFLICT';
  end if;
  if found and v_run.status = 'COMPLETED' then
    return jsonb_build_object('outcome', 'IDEMPOTENT_COMPLETED',
      'runId', v_run.run_id, 'status', v_run.status,
      'attemptCount', v_run.attempt_count, 'leaseToken', null,
      'queueSnapshotId', v_run.queue_snapshot_id,
      'inputDigest', v_run.input_digest, 'outputDigest', v_run.output_digest);
  end if;
  if found and v_run.status = 'FAILED_TERMINAL' then
    return jsonb_build_object('outcome', 'TERMINAL_FAILURE',
      'runId', v_run.run_id, 'status', v_run.status,
      'attemptCount', v_run.attempt_count, 'leaseToken', null,
      'lastErrorCode', v_run.last_error_code);
  end if;
  if found and v_run.status = 'RUNNING'
    and v_run.lease_expires_at > v_now then
    return jsonb_build_object('outcome', 'LEASE_HELD',
      'runId', v_run.run_id, 'status', v_run.status,
      'attemptCount', v_run.attempt_count, 'leaseToken', null,
      'leaseExpiresAt', v_run.lease_expires_at);
  end if;
  if found and v_run.status = 'RETRY_WAIT'
    and v_run.next_retry_at > v_now then
    return jsonb_build_object('outcome', 'RETRY_NOT_DUE',
      'runId', v_run.run_id, 'status', v_run.status,
      'attemptCount', v_run.attempt_count, 'leaseToken', null,
      'nextRetryAt', v_run.next_retry_at);
  end if;
  if found and v_run.status = 'RUNNING' then
    perform public.append_seller_os_daily_dollar_run_receipt_v1(
      v_run.run_id, 'LEASE_EXPIRED', 'LEASE_EXPIRED', v_now);
  end if;
  if found and v_run.attempt_count >= v_run.maximum_attempts then
    update public.seller_os_daily_dollar_radar_runs
    set status = 'FAILED_TERMINAL', lease_expires_at = null,
        next_retry_at = null, last_error_code = 'MAXIMUM_ATTEMPTS_EXHAUSTED',
        failure_stage = 'LEASE_CONTROL', failed_at = v_now, updated_at = v_now
    where run_id = v_run.run_id returning * into v_run;
    perform public.append_seller_os_daily_dollar_run_receipt_v1(
      v_run.run_id, 'FAILED_TERMINAL', v_run.last_error_code, v_now);
    return jsonb_build_object('outcome', 'TERMINAL_FAILURE',
      'runId', v_run.run_id, 'status', v_run.status,
      'attemptCount', v_run.attempt_count, 'leaseToken', null,
      'lastErrorCode', v_run.last_error_code);
  end if;

  v_lease_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_lease_token_hash := 'sha256:' || encode(extensions.digest(
    convert_to(v_lease_token, 'UTF8'), 'sha256'), 'hex');
  if not found then
    insert into public.seller_os_daily_dollar_radar_runs (
      run_id, account_key, marketplace_id, logical_run_date,
      logical_window_start, logical_window_end, evidence_cutoff_at,
      input_digest, status, attempt_count, worker_id, lease_token_hash,
      lease_expires_at, started_at, created_at, updated_at
    ) values (
      v_run_id, v_account_key, p_marketplace_id, v_logical_date,
      p_logical_window_start, p_logical_window_end, p_evidence_cutoff_at,
      p_input_digest, 'RUNNING', 1, v_worker_id, v_lease_token_hash,
      v_now + make_interval(secs => p_lease_seconds), v_now, v_now, v_now
    ) returning * into v_run;
  else
    update public.seller_os_daily_dollar_radar_runs
    set status = 'RUNNING', attempt_count = attempt_count + 1,
        worker_id = v_worker_id, lease_token_hash = v_lease_token_hash,
        lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
        next_retry_at = null, last_error_code = null,
        family_input_count = 0, eligible_family_count = 0,
        configuration_input_count = 0, queue_count = 0,
        escalation_count = 0, radar_family_rows = 0,
        product_research_rows = 0, luna_variant_rows = 0,
        family_evaluation_rows = 0, families_evaluated = 0,
        new_families_discovered = 0, demand_proven_count = 0,
        demand_supported_count = 0, luna_match_count = 0,
        product_fit_strong_count = 0, economically_dead_count = 0,
        economically_recoverable_count = 0, economically_promising_count = 0,
        economics_unproven_count = 0, morning_queue_count = 0,
        needs_fresh_ebay_verification_count = 0, failure_stage = null,
        failed_at = null, updated_at = v_now
    where run_id = v_run.run_id returning * into v_run;
  end if;
  perform public.append_seller_os_daily_dollar_run_receipt_v1(
    v_run.run_id, 'CLAIMED', null, v_now);
  return jsonb_build_object('outcome', 'CLAIMED', 'runId', v_run.run_id,
    'status', v_run.status, 'attemptCount', v_run.attempt_count,
    'maximumAttempts', v_run.maximum_attempts, 'leaseToken', v_lease_token,
    'leaseExpiresAt', v_run.lease_expires_at,
    'inputDigest', v_run.input_digest);
end;
$function$;

comment on table public.seller_os_profitability_frontier_snapshots is
  'Append-only provisional Fast Lane economics snapshots. Phase 6 remains the canonical economics authority; every replay is evidence/policy/shipping-state bound.';
