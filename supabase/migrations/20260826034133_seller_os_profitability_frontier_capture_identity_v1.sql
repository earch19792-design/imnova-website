-- Preserve historical append-only profitability snapshots while binding all
-- future uniqueness and RPC identities to the authoritative capture digest.

do $precondition$
begin
  if not exists (
    select 1
    from pg_constraint constraint_record
    join pg_class table_record on table_record.oid = constraint_record.conrelid
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'public'
      and table_record.relname = 'seller_os_profitability_frontier_snapshots'
      and constraint_record.conname =
        'seller_os_profitability_frontier_snapshot_unique'
      and pg_get_constraintdef(constraint_record.oid, true) =
        'UNIQUE (account_key, marketplace_id, family_id, luna_product_id, luna_variant_id, market_price_evidence_digest, economic_policy_digest, shipping_status, shipping_value, contract_version)'
  ) then
    raise exception 'SELLER_OS_PROFITABILITY_FRONTIER_UNIQUE_PRECONDITION_FAILED';
  end if;
end
$precondition$;

alter table public.seller_os_profitability_frontier_snapshots
  drop constraint seller_os_profitability_frontier_snapshot_unique;

alter table public.seller_os_profitability_frontier_snapshots
  add constraint seller_os_profitability_frontier_snapshot_unique unique (
    account_key, marketplace_id, family_id, luna_product_id, luna_variant_id,
    market_price_evidence_digest, economic_policy_digest, shipping_status,
    shipping_value, frontier_digest, contract_version
  );

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
      'SELLER_OS_PROFITABILITY_FRONTIER_CAPTURE_ID_V1', E'\n',
      v_family_id, E'\n', v_product_id, E'\n', v_variant_id, E'\n',
      p_market_price_evidence_digest, E'\n', p_economic_policy_digest, E'\n',
      v_shipping_status, E'\n', coalesce(v_shipping_value::text, 'UNPROVEN'),
      E'\n', p_frontier ->> 'frontierDigest'
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
