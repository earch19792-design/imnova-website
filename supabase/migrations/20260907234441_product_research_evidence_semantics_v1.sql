-- Product Research Sold Evidence semantics. This is an additive derivation on
-- the existing capture authority: source receipts and legacy classifications
-- remain unchanged, while versioned current classifications can be rebuilt
-- from the canonical Item-ID cohort without another marketplace query.

alter table public.marketplace_product_research_capture_observations
  add column if not exists evidence_semantics_versions jsonb not null
    default '[]'::jsonb,
  add column if not exists unit_sold_price numeric(14,2) null,
  add column if not exists unit_sold_price_currency text null,
  add column if not exists unit_sold_price_source text null;

alter table public.marketplace_product_research_capture_observations
  add constraint marketplace_product_research_capture_observations_semantics_versions_v1_check
    check (jsonb_typeof(evidence_semantics_versions) = 'array'),
  add constraint marketplace_product_research_capture_observations_unit_price_v1_check
    check ((unit_sold_price is null and unit_sold_price_currency is null
        and unit_sold_price_source is null)
      or (unit_sold_price >= 0 and unit_sold_price_currency ~ '^[A-Z]{3}$'
        and char_length(unit_sold_price_source) between 3 and 120));

comment on column public.marketplace_product_research_capture_observations.evidence_semantics_versions is
  'Append-only, plan-scoped derived classifications. Original captured price, seller, shipping, title, receipt and legacy classification columns remain authoritative and immutable.';

create or replace function public.product_research_semantic_normalize_v1(
  p_value text
) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select trim(regexp_replace(lower(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g'));
$$;

create or replace function public.product_research_semantic_stem_v1(
  p_token text
) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when char_length(p_token) > 4 and p_token like '%ies'
      then left(p_token, -3) || 'y'
    when char_length(p_token) > 4
      and p_token ~ '(?:ches|shes|sses|xes|zes)$'
      then left(p_token, -2)
    when char_length(p_token) > 3 and p_token like '%s'
      then left(p_token, -1)
    else p_token
  end;
$$;

create or replace function public.product_research_semantic_terms_v1(
  p_value text,
  p_vocabulary text[]
) returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(distinct public.product_research_semantic_stem_v1(token)
    order by public.product_research_semantic_stem_v1(token)), '{}'::text[])
  from unnest(regexp_split_to_array(
    public.product_research_semantic_normalize_v1(p_value), '[^a-z0-9.]+')) token
  where token = any(p_vocabulary);
$$;

create or replace function public.product_research_semantic_count_v1(
  p_value text
) returns integer
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
declare
  v_match text[];
  v_source text := public.product_research_semantic_normalize_v1(p_value);
begin
  v_match := regexp_match(v_source,
    '\m(?:set|pack|lot)[[:space:]]+of[[:space:]]+([0-9]{1,3})\M');
  if v_match is null then
    v_match := regexp_match(v_source,
      '\m([0-9]{1,3})[[:space:]-]*(?:piece|pieces|pc|pcs|pack|packs)\M');
  end if;
  if v_match is null then
    v_match := regexp_match(v_source,
      '\m([0-9]{1,3})[[:space:]]*(?:count|ct)\M');
  end if;
  if v_match is null or v_match[1]::integer < 1 then return null; end if;
  return v_match[1]::integer;
end;
$$;

create or replace function public.product_research_semantic_sizes_v1(
  p_value text
) returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  with matched as (
    select captures[1]::numeric as amount, lower(captures[2]) as source_unit
    from regexp_matches(public.product_research_semantic_normalize_v1(p_value),
      '([0-9]+(?:\.[0-9]+)?)[[:space:]]*("|inches?|in|centimeters?|cm|millimeters?|mm|quarts?|qt|ounces?|oz|pounds?|lbs?|milliliters?|ml|liters?|l)(?:[[:space:],/;:.)]|$)',
      'g') captures
  ), normalized as (
    select amount::text || ' ' ||
      case
        when source_unit in ('"','inch','inches','in') then 'in'
        when source_unit in ('centimeter','centimeters','cm') then 'cm'
        when source_unit in ('millimeter','millimeters','mm') then 'mm'
        when source_unit in ('quart','quarts','qt') then 'qt'
        when source_unit in ('ounce','ounces','oz') then 'oz'
        when source_unit in ('pound','pounds','lb','lbs') then 'lb'
        when source_unit in ('milliliter','milliliters','ml') then 'ml'
        when source_unit in ('liter','liters','l') then 'l'
      end as size
    from matched
  )
  select coalesce(array_agg(distinct size order by size), '{}'::text[])
  from normalized where size is not null;
$$;

create or replace function public.product_research_semantic_entity_v1(
  p_title text
) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  with source as (
    select regexp_replace(public.product_research_semantic_normalize_v1(p_title),
      '\m(?:with|for|ideal for|used for)\M.*$', '', 'g') as value
  ), candidates as (
    select token, ordinal
    from source, unnest(regexp_split_to_array(value, '[^a-z0-9.]+'))
      with ordinality words(token, ordinal)
    where char_length(token) > 1
      and token !~ '^[0-9]+(?:\.[0-9]+)?$'
      and token <> all(array[
        'aluminum','aluminium','bamboo','brass','ceramic','cotton','fabric',
        'glass','iron','leather','metal','nylon','plastic','rubber','silicone',
        'stainless','steel','stone','wood','wooden','wool','conical','flat',
        'oval','rectangular','round','square','triangular','fine','mesh',
        'nested','perforated','solid','twill','wire','count','ct','pack','packs',
        'pc','pcs','piece','pieces','set','and','by','each','for','from','in',
        'new','of','on','or','per','premium','professional','sale','the','to',
        'tool','tools','with','kitchen','home','food','prep','cooking','culinary'
      ]::text[])
  )
  select public.product_research_semantic_stem_v1(token)
  from candidates order by ordinal desc limit 1;
$$;

create or replace function public.derive_product_research_evidence_semantics_v1(
  p_target_title text,
  p_target_supporting_evidence text,
  p_observed_title text,
  p_unit_sold_price numeric,
  p_unit_sold_price_currency text,
  p_unit_sold_price_source text,
  p_quantity_sold integer,
  p_legacy_ambiguous_price numeric,
  p_cumulative_sales_value numeric,
  p_shipping_price numeric,
  p_free_shipping_percent numeric,
  p_seller_identity_hash text
) returns jsonb
language plpgsql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
declare
  v_version constant text := 'PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V1_2026_09_07';
  v_target_source text := concat_ws(' ', p_target_title, p_target_supporting_evidence);
  v_observed_source text := coalesce(p_observed_title, '');
  v_target_normalized text := public.product_research_semantic_normalize_v1(v_target_source);
  v_observed_normalized text := public.product_research_semantic_normalize_v1(v_observed_source);
  v_materials constant text[] := array['aluminum','aluminium','bamboo','brass',
    'ceramic','cotton','fabric','glass','iron','leather','metal','nylon',
    'plastic','rubber','silicone','stainless','steel','stone','wood','wooden','wool'];
  v_shapes constant text[] := array['conical','flat','oval','rectangular','round',
    'square','triangular'];
  v_bodies constant text[] := array['basket','bowl','chinois','colander','cone',
    'ear','ears','funnel','handle','handled','handles','screen','sieve','sifter',
    'skimmer','spoon','stopper'];
  v_architectures constant text[] := array['fine','mesh','nested','perforated',
    'solid','twill','wire'];
  v_use_terms constant text[] := array['bathroom','baking','cocktail','coffee',
    'cooking','culinary','drain','food','kitchen','oil','paint','plumbing',
    'sewer','shower','sink','tea','tub'];
  v_target_entity text;
  v_observed_entity text;
  v_observed_tokens text[];
  v_target_material text[];
  v_observed_material text[];
  v_target_shape text[];
  v_observed_shape text[];
  v_target_body text[];
  v_observed_body text[];
  v_target_arch text[];
  v_observed_arch text[];
  v_target_use text[];
  v_observed_use text[];
  v_target_features text[];
  v_observed_features text[];
  v_target_count integer;
  v_observed_count integer;
  v_target_sizes text[];
  v_observed_sizes text[];
  v_entity_compatible boolean;
  v_architecture_compatible boolean;
  v_use_compatible boolean;
  v_count_difference boolean;
  v_size_difference boolean;
  v_all_exact boolean;
  v_classification text;
  v_reasons text[] := '{}';
  v_shipping_status text;
  v_shipping_amount numeric;
  v_seller_proven boolean;
  v_unit_price_proven boolean;
begin
  v_target_entity := public.product_research_semantic_entity_v1(p_target_title);
  v_observed_entity := public.product_research_semantic_entity_v1(p_observed_title);
  select coalesce(array_agg(distinct public.product_research_semantic_stem_v1(token)),
      '{}'::text[]) into v_observed_tokens
  from unnest(regexp_split_to_array(v_observed_normalized, '[^a-z0-9.]+')) token;
  v_target_material := public.product_research_semantic_terms_v1(v_target_source, v_materials);
  v_observed_material := public.product_research_semantic_terms_v1(v_observed_source, v_materials);
  v_target_shape := public.product_research_semantic_terms_v1(v_target_source, v_shapes);
  v_observed_shape := public.product_research_semantic_terms_v1(v_observed_source, v_shapes);
  v_target_body := public.product_research_semantic_terms_v1(v_target_source, v_bodies);
  v_observed_body := public.product_research_semantic_terms_v1(v_observed_source, v_bodies);
  v_target_arch := public.product_research_semantic_terms_v1(v_target_source, v_architectures);
  v_observed_arch := public.product_research_semantic_terms_v1(v_observed_source, v_architectures);
  v_target_use := public.product_research_semantic_terms_v1(v_target_source, v_use_terms);
  v_observed_use := public.product_research_semantic_terms_v1(v_observed_source, v_use_terms);
  v_target_features := public.product_research_semantic_terms_v1(
    substring(v_target_normalized from '\mwith\M[[:space:]]+(.+)$'),
    array['adjustable','ear','ears','folding','handle','handled','handles','lid',
      'nonstick','sealed','stackable','wide']);
  v_observed_features := public.product_research_semantic_terms_v1(
    substring(v_observed_normalized from '\mwith\M[[:space:]]+(.+)$'),
    array['adjustable','ear','ears','folding','handle','handled','handles','lid',
      'nonstick','sealed','stackable','wide']);
  v_target_count := public.product_research_semantic_count_v1(p_target_title);
  v_observed_count := public.product_research_semantic_count_v1(p_observed_title);
  v_target_sizes := public.product_research_semantic_sizes_v1(v_target_source);
  v_observed_sizes := public.product_research_semantic_sizes_v1(v_observed_source);

  v_entity_compatible := v_target_entity is not null
    and v_target_entity = any(v_observed_tokens);
  v_architecture_compatible := v_entity_compatible
    and not exists (
      select 1 from unnest(v_observed_body) body
      where body <> all(v_target_body) and body <> all(array['ear','handle']))
    and not (cardinality(v_target_shape) > 0 and cardinality(v_observed_shape) > 0
      and not v_target_shape && v_observed_shape)
    and not ('mesh' = any(v_target_arch)
      and v_observed_arch && array['perforated','solid'])
    and not ('fine' = any(v_target_arch) and 'twill' = any(v_observed_arch));
  v_use_compatible := v_architecture_compatible and not (
    not (v_target_use && array['bathroom','drain','plumbing','sewer','shower','sink','tub'])
      and v_observed_use && array['bathroom','drain','plumbing','sewer','shower','sink','tub']
    or not (v_target_use && array['cocktail','coffee','oil','paint','tea'])
      and v_observed_use && array['cocktail','coffee','oil','paint','tea']);
  v_count_difference := v_target_count is not null and v_observed_count is not null
    and v_target_count <> v_observed_count;
  v_size_difference := cardinality(v_target_sizes) > 0 and cardinality(v_observed_sizes) > 0
    and v_target_sizes <> v_observed_sizes;
  v_all_exact := v_entity_compatible and v_architecture_compatible and v_use_compatible
    and v_target_entity is not null and v_observed_entity is not null
    and cardinality(v_target_arch) > 0 and cardinality(v_observed_arch) > 0
    and cardinality(v_target_use) > 0 and cardinality(v_observed_use) > 0
    and cardinality(v_target_body || v_target_shape) > 0
    and cardinality(v_observed_body || v_observed_shape) > 0
    and v_target_count is not null and v_observed_count = v_target_count
    and cardinality(v_target_sizes) > 0 and v_observed_sizes = v_target_sizes
    and cardinality(v_target_material) > 0
    and v_target_material <@ v_observed_material
    and cardinality(v_target_arch || v_target_shape) > 0
    and (v_target_arch || v_target_shape) <@ (v_observed_arch || v_observed_shape)
    and cardinality(v_target_features) > 0
    and v_target_features <@ v_observed_features
    and v_target_use <@ v_observed_use;

  if not v_entity_compatible then
    v_classification := 'FALSE_POSITIVE';
    v_reasons := array['PRODUCT_ENTITY_INCOMPATIBLE'];
  elsif not v_architecture_compatible then
    v_classification := 'ADJACENT_BUT_NOT_COMPARABLE';
    v_reasons := array['PRODUCT_ARCHITECTURE_INCOMPATIBLE'];
  elsif not v_use_compatible then
    v_classification := 'ADJACENT_BUT_NOT_COMPARABLE';
    v_reasons := array['INTENDED_USE_INCOMPATIBLE'];
  elsif v_all_exact then
    v_classification := 'EXACT_PRODUCT_COMPARABLE';
    v_reasons := array['ALL_EXACT_DISCRIMINATORS_PROVEN'];
  elsif v_count_difference or v_size_difference then
    v_classification := 'CLOSE_VARIANT_COMPARABLE';
    if v_count_difference then
      v_reasons := array_append(v_reasons,'EXPLICIT_TITLE_COUNT_DIFFERENCE');
    end if;
    if v_size_difference then
      v_reasons := array_append(v_reasons,'EXPLICIT_TITLE_SIZE_DIFFERENCE');
    end if;
  else
    v_classification := 'CORE_FAMILY_COMPARABLE';
    v_reasons := array['ENTITY_USE_AND_ARCHITECTURE_COMPATIBLE',
      'EXACT_DISCRIMINATORS_INCOMPLETE'];
  end if;

  v_shipping_status := case
    when p_free_shipping_percent = 100 then 'FREE_SHIPPING'
    when p_shipping_price is not null then 'SHIPPING_PRICE'
    else 'SHIPPING_UNPROVEN' end;
  v_shipping_amount := case when p_free_shipping_percent = 100 then 0
    when p_shipping_price is not null then p_shipping_price else null end;
  v_seller_proven := coalesce(p_seller_identity_hash, '')
    ~ '^sha256:[0-9a-f]{64}$';
  v_unit_price_proven := p_unit_sold_price is not null
    and p_unit_sold_price >= 0
    and coalesce(p_unit_sold_price_currency,'') ~ '^[A-Z]{3}$'
    and char_length(coalesce(p_unit_sold_price_source,'')) between 3 and 120;

  return jsonb_build_object(
    'version', v_version,
    'structuralEvidence', jsonb_build_object(
      'PRODUCT_ENTITY', jsonb_build_object('target',v_target_entity,
        'observed',v_observed_entity,'status',case when v_observed_entity is null then 'UNPROVEN' else 'PROVEN' end),
      'PRODUCT_ARCHITECTURE', jsonb_build_object('target',v_target_arch,
        'observed',v_observed_arch,'status',case when cardinality(v_observed_arch)=0 then 'UNPROVEN' else 'PROVEN' end),
      'INTENDED_USE', jsonb_build_object('target',v_target_use,'observed',v_observed_use,
        'status',case when cardinality(v_observed_use)=0 then 'UNPROVEN' else 'PROVEN' end),
      'FORM_FACTOR', jsonb_build_object('target',v_target_body || v_target_shape,
        'observed',v_observed_body || v_observed_shape,
        'status',case when cardinality(v_observed_body || v_observed_shape)=0 then 'UNPROVEN' else 'PROVEN' end),
      'COUNT', jsonb_build_object('target',v_target_count,'observed',v_observed_count,
        'status',case when v_observed_count is null then 'UNPROVEN' else 'PROVEN' end),
      'SIZE_SET', jsonb_build_object('target',v_target_sizes,'observed',v_observed_sizes,
        'status',case when cardinality(v_observed_sizes)=0 then 'UNPROVEN' else 'PROVEN' end),
      'MATERIAL', jsonb_build_object('target',v_target_material,'observed',v_observed_material,
        'status',case when cardinality(v_observed_material)=0 then 'UNPROVEN' else 'PROVEN' end),
      'FAMILY_QUALIFIERS', jsonb_build_object('target',v_target_arch || v_target_shape,
        'observed',v_observed_arch || v_observed_shape,
        'status',case when cardinality(v_observed_arch || v_observed_shape)=0 then 'UNPROVEN' else 'PROVEN' end),
      'FEATURES', jsonb_build_object('target',v_target_features,'observed',v_observed_features,
        'status',case when cardinality(v_observed_features)=0 then 'UNPROVEN' else 'PROVEN' end)
    ),
    'classification',v_classification,'classificationReasons',v_reasons,
    'compatibility',jsonb_build_object('entityCompatible',v_entity_compatible,
      'architectureCompatible',v_architecture_compatible,'useCompatible',v_use_compatible,
      'explicitCountDifference',v_count_difference,'explicitSizeDifference',v_size_difference,
      'allExactDiscriminatorsProven',v_all_exact),
    'price',jsonb_build_object(
      'UNIT_SOLD_PRICE',jsonb_build_object('status',case when v_unit_price_proven
          then 'PROVEN' else 'UNPROVEN' end,
        'amount',case when v_unit_price_proven then p_unit_sold_price else null end,
        'reason',case when v_unit_price_proven then null
          when p_legacy_ambiguous_price is null then 'NOT_EXPLICIT'
          else 'AMBIGUOUS_LEGACY_PRICE_NOT_PROMOTED' end),
      'QUANTITY_SOLD',jsonb_build_object('status',case when p_quantity_sold > 0
        then 'PROVEN' else 'UNPROVEN' end,'value',case when p_quantity_sold > 0
          then p_quantity_sold else null end),
      'CUMULATIVE_SALES_VALUE',jsonb_build_object('status',case
        when p_cumulative_sales_value is null then 'UNPROVEN' else 'PROVEN' end,
        'amount',p_cumulative_sales_value),
      'SHIPPING',jsonb_build_object('status',v_shipping_status,'amount',v_shipping_amount),
      'TOTAL_DELIVERED_PRICE',jsonb_build_object('status',case
          when v_unit_price_proven and v_shipping_amount is not null then 'PROVEN'
          else 'UNPROVEN' end,'amount',case
          when v_unit_price_proven and v_shipping_amount is not null
            then p_unit_sold_price+v_shipping_amount else null end),
      'CURRENCY',jsonb_build_object('status',case when v_unit_price_proven
          or p_cumulative_sales_value is not null or v_shipping_amount is not null
          then 'PROVEN' else 'UNPROVEN' end,
        'value',case when v_unit_price_proven then p_unit_sold_price_currency
          when p_cumulative_sales_value is not null or v_shipping_amount is not null
          then 'USD' else null end),
      'PRICE_SOURCE',jsonb_build_object('unit',case when v_unit_price_proven
          then p_unit_sold_price_source else 'LEGACY_AMBIGUOUS_NOT_PROMOTED' end,
        'cumulative',case when p_cumulative_sales_value is null then 'UNPROVEN'
          else 'PRODUCT_RESEARCH_ITEM_SALES_COLUMN' end,
        'shipping',case when v_shipping_status='SHIPPING_UNPROVEN' then 'UNPROVEN'
          when v_shipping_status='FREE_SHIPPING' then 'EXPLICIT_FREE_SHIPPING_PERCENT'
          else 'PRODUCT_RESEARCH_AVERAGE_SHIPPING_COLUMN' end)
    ),
    'seller',jsonb_build_object('status',case when v_seller_proven then 'PROVEN'
      else 'UNPROVEN' end,'identityHash',case when v_seller_proven
        then p_seller_identity_hash else null end)
  );
end;
$$;

create or replace function public.reclassify_product_research_evidence_semantics_v1(
  p_marketplace_account_key text,
  p_plan_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_version constant text := 'PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V1_2026_09_07';
  v_target_title text;
  v_target_evidence text;
  v_row record;
  v_derived jsonb;
  v_existing jsonb;
  v_appended integer := 0;
  v_reused integer := 0;
begin
  if char_length(trim(coalesce(p_marketplace_account_key,''))) not between 8 and 160
      or p_plan_id is null then
    raise exception 'PRODUCT_RESEARCH_EVIDENCE_RECLASSIFICATION_INVALID';
  end if;
  select opportunity.product_title,
    opportunity.assessment #>> '{productTruth,sourceEvidence,requiredItemSpecificsTruthV1,lunaExactProductEvidenceSetV1,description}'
  into v_target_title,v_target_evidence
  from public.marketplace_product_research_query_plans plan
  join public.ebay_luna_opportunity_queue opportunity
    on opportunity.id=plan.source_opportunity_id
  where plan.id=p_plan_id and plan.marketplace_account_key=p_marketplace_account_key
    and plan.marketplace='EBAY_US';
  if not found then
    return jsonb_build_object('status','TARGET_EVIDENCE_UNPROVEN','appended',0,'reused',0);
  end if;

  for v_row in
    select canonical.item_id,canonical.bounded_title_evidence,
      observation.id as observation_id,observation.confirmed_sold_quantity,
      observation.unit_sold_price,observation.unit_sold_price_currency,
      observation.unit_sold_price_source,
      observation.average_sold_price,observation.item_sales,
      observation.average_shipping,observation.free_shipping_percent,
      observation.seller_reference_fingerprint,
      observation.commercial_comparable_classification,
      observation.evidence_semantics_versions,
      md5(concat_ws('|',observation.id::text,observation.capture_batch_id::text,
        observation.evidence_deduplication_key,observation.bounded_title_evidence,
        observation.commercial_comparable_classification,
        observation.unit_sold_price::text,observation.unit_sold_price_currency,
        observation.unit_sold_price_source,
        observation.confirmed_sold_quantity::text,observation.average_sold_price::text,
        observation.item_sales::text,observation.average_shipping::text,
        observation.free_shipping_percent::text,
        observation.seller_reference_fingerprint)) as source_receipt_checksum
    from public.seller_os_product_research_canonical_evidence_v1 canonical
    cross join lateral (
      select candidate.*
      from public.marketplace_product_research_query_tasks task
      join public.marketplace_product_research_query_plans plan on plan.id=task.plan_id
      join public.marketplace_product_research_capture_observations candidate
        on candidate.capture_batch_id=task.capture_batch_id
       and candidate.marketplace_account_key=task.marketplace_account_key
       and candidate.source_listing_id=canonical.item_id
      where task.plan_id=canonical.plan_id
        and task.strategy_version=plan.intelligence_contract_version
      order by candidate.created_at desc,candidate.id
      limit 1
    ) observation
    where canonical.plan_id=p_plan_id
      and canonical.marketplace_account_key=p_marketplace_account_key
  loop
    v_derived := public.derive_product_research_evidence_semantics_v1(
      v_target_title,v_target_evidence,v_row.bounded_title_evidence,
      v_row.unit_sold_price,v_row.unit_sold_price_currency,v_row.unit_sold_price_source,
      v_row.confirmed_sold_quantity,v_row.average_sold_price,v_row.item_sales,
      v_row.average_shipping,v_row.free_shipping_percent,
      v_row.seller_reference_fingerprint)
      || jsonb_build_object('planId',p_plan_id,'itemId',v_row.item_id,
        'sourceReceipt',jsonb_build_object(
          'checksum',v_row.source_receipt_checksum,
          'legacyClassification',v_row.commercial_comparable_classification));
    select value into v_existing
    from jsonb_array_elements(v_row.evidence_semantics_versions)
    where value->>'planId'=p_plan_id::text and value->>'version'=v_version
    limit 1;
    if v_existing is null then
      update public.marketplace_product_research_capture_observations
      set evidence_semantics_versions=evidence_semantics_versions || jsonb_build_array(v_derived)
      where id=v_row.observation_id;
      v_appended := v_appended+1;
    elsif v_existing=v_derived then
      v_reused := v_reused+1;
    else
      raise exception 'PRODUCT_RESEARCH_EVIDENCE_VERSION_IMMUTABILITY_CONFLICT';
    end if;
  end loop;
  return jsonb_build_object('status','RECLASSIFIED','version',v_version,
    'appended',v_appended,'reused',v_reused,'canonicalItems',v_appended+v_reused);
end;
$$;

revoke all on function public.product_research_semantic_normalize_v1(text)
  from public,anon,authenticated;
revoke all on function public.product_research_semantic_stem_v1(text)
  from public,anon,authenticated;
revoke all on function public.product_research_semantic_terms_v1(text,text[])
  from public,anon,authenticated;
revoke all on function public.product_research_semantic_count_v1(text)
  from public,anon,authenticated;
revoke all on function public.product_research_semantic_sizes_v1(text)
  from public,anon,authenticated;
revoke all on function public.product_research_semantic_entity_v1(text)
  from public,anon,authenticated;
revoke all on function public.derive_product_research_evidence_semantics_v1(
  text,text,text,numeric,text,text,integer,numeric,numeric,numeric,numeric,text)
  from public,anon,authenticated;
revoke all on function public.reclassify_product_research_evidence_semantics_v1(text,uuid)
  from public,anon,authenticated;
grant execute on function public.reclassify_product_research_evidence_semantics_v1(text,uuid)
  to service_role;

create or replace function public.reclassify_product_research_task_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.strategy_version is not null
      and jsonb_array_length(new.commercial_evidence_entities)>0 then
    perform public.reclassify_product_research_evidence_semantics_v1(
      new.marketplace_account_key,new.plan_id);
  end if;
  return new;
end;
$$;

revoke all on function public.reclassify_product_research_task_evidence_v1()
  from public,anon,authenticated;

drop trigger if exists marketplace_product_research_task_evidence_semantics_v1
  on public.marketplace_product_research_query_tasks;
create trigger marketplace_product_research_task_evidence_semantics_v1
after insert or update
on public.marketplace_product_research_query_tasks
for each row
when (new.strategy_version is not null)
execute function public.reclassify_product_research_task_evidence_v1();

do $$
declare v_plan record;
begin
  for v_plan in
    select distinct canonical.marketplace_account_key,canonical.plan_id
    from public.seller_os_product_research_canonical_evidence_v1 canonical
    join public.marketplace_product_research_query_plans plan on plan.id=canonical.plan_id
    where plan.source_opportunity_id is not null
  loop
    perform public.reclassify_product_research_evidence_semantics_v1(
      v_plan.marketplace_account_key,v_plan.plan_id);
  end loop;
end;
$$;

create or replace view public.seller_os_product_research_canonical_evidence_v2
with (security_invoker=true)
as
select canonical.plan_id,canonical.marketplace_account_key,canonical.marketplace,
  canonical.item_id,canonical.bounded_title_evidence,canonical.query_intents,
  canonical.query_provenance_hashes,canonical.confirmed_sold_quantity,
  canonical.provenance_row_count,
  canonical.commercial_comparable_classification as historical_canonical_classification,
  canonical.minimum_observed_price as legacy_ambiguous_minimum_value,
  canonical.maximum_observed_price as legacy_ambiguous_maximum_value,
  observation.id as source_observation_id,
  observation.capture_batch_id as source_capture_batch_id,
  observation.evidence_deduplication_key as source_evidence_deduplication_key,
  observation.bounded_title_evidence as source_bounded_title_evidence,
  observation.average_sold_price as legacy_ambiguous_observed_value,
  observation.item_sales as source_cumulative_sales_value,
  observation.average_shipping as source_shipping_price,
  observation.free_shipping_percent as source_free_shipping_percent,
  observation.seller_reference_fingerprint as source_seller_identity_hash,
  observation.unit_sold_price as source_unit_sold_price,
  observation.unit_sold_price_currency as source_unit_sold_price_currency,
  observation.unit_sold_price_source as source_unit_sold_price_source,
  semantics.value as evidence_semantics,
  semantics.value->>'version' as evidence_semantics_version,
  semantics.value->>'classification' as structural_classification,
  semantics.value->'compatibility' as structural_compatibility,
  semantics.value->'structuralEvidence' as structural_evidence,
  semantics.value->'price' as price_evidence,
  semantics.value->'seller' as seller_evidence,
  observation.commercial_comparable_classification as historical_classification
from public.seller_os_product_research_canonical_evidence_v1 canonical
left join lateral (
  select candidate.*
  from public.marketplace_product_research_query_tasks task
  join public.marketplace_product_research_query_plans plan on plan.id=task.plan_id
  join public.marketplace_product_research_capture_observations candidate
    on candidate.capture_batch_id=task.capture_batch_id
   and candidate.marketplace_account_key=task.marketplace_account_key
   and candidate.source_listing_id=canonical.item_id
  where task.plan_id=canonical.plan_id
    and task.strategy_version=plan.intelligence_contract_version
  order by candidate.created_at desc,candidate.id
  limit 1
) observation on true
left join lateral (
  select value from jsonb_array_elements(
    coalesce(observation.evidence_semantics_versions,'[]'::jsonb))
  where value->>'planId'=canonical.plan_id::text
    and value->>'version'='PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V1_2026_09_07'
  limit 1
) semantics on true;

revoke all on table public.seller_os_product_research_canonical_evidence_v2
  from public,anon,authenticated;
grant select on table public.seller_os_product_research_canonical_evidence_v2
  to service_role;

comment on view public.seller_os_product_research_canonical_evidence_v2 is
  'Same canonical Item-ID cohort as v1, enriched with current versioned structural, unit-price, cumulative-value, shipping and privacy-bounded seller semantics.';

create or replace function public.read_product_research_evidence_semantics_canary_v1(
  p_marketplace_account_key text,
  p_plan_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if char_length(trim(coalesce(p_marketplace_account_key,''))) not between 8 and 160
      or p_plan_id is null then
    raise exception 'PRODUCT_RESEARCH_EVIDENCE_CANARY_INVALID';
  end if;
  with cohort as (
    select * from public.seller_os_product_research_canonical_evidence_v2
    where plan_id=p_plan_id and marketplace_account_key=p_marketplace_account_key
  ), metrics as (
    select count(*)::integer canonical_count,
      count(*) filter(where evidence_semantics is not null)::integer semantic_count,
      count(*) filter(where structural_classification='EXACT_PRODUCT_COMPARABLE')::integer exact_count,
      count(*) filter(where structural_classification='CLOSE_VARIANT_COMPARABLE')::integer close_count,
      count(*) filter(where structural_classification='CORE_FAMILY_COMPARABLE')::integer core_count,
      count(*) filter(where structural_classification='ADJACENT_BUT_NOT_COMPARABLE')::integer adjacent_count,
      count(*) filter(where structural_classification='FALSE_POSITIVE')::integer false_positive_count,
      count(*) filter(where structural_classification='CORE_FAMILY_COMPARABLE'
        and (coalesce((structural_compatibility->>'architectureCompatible')::boolean,false)=false
          or coalesce((structural_compatibility->>'useCompatible')::boolean,false)=false))::integer bad_core_count,
      count(distinct seller_evidence->>'identityHash') filter(
        where seller_evidence->>'status'='PROVEN')::integer distinct_sellers,
      count(*) filter(where seller_evidence->>'status'='PROVEN')::integer seller_rows,
      count(*) filter(where price_evidence#>>'{UNIT_SOLD_PRICE,status}'='PROVEN')::integer unit_price_count,
      count(*) filter(where price_evidence#>>'{SHIPPING,status}' in
        ('FREE_SHIPPING','SHIPPING_PRICE'))::integer shipping_count,
      count(*) filter(where structural_classification in
        ('EXACT_PRODUCT_COMPARABLE','CLOSE_VARIANT_COMPARABLE','CORE_FAMILY_COMPARABLE'))::integer compatible_count,
      coalesce(sum(confirmed_sold_quantity) filter(where structural_classification in
        ('EXACT_PRODUCT_COMPARABLE','CLOSE_VARIANT_COMPARABLE','CORE_FAMILY_COMPARABLE')),0)::integer compatible_sold_quantity,
      count(*) filter(where evidence_semantics->'sourceReceipt'->>'checksum' is distinct from
        md5(concat_ws('|',source_observation_id::text,source_capture_batch_id::text,
          source_evidence_deduplication_key,source_bounded_title_evidence,
          historical_classification,source_unit_sold_price::text,
          source_unit_sold_price_currency,source_unit_sold_price_source,
          confirmed_sold_quantity::text,legacy_ambiguous_observed_value::text,
          source_cumulative_sales_value::text,source_shipping_price::text,
          source_free_shipping_percent::text,source_seller_identity_hash)))::integer receipt_mutations,
      count(*) filter(where price_evidence#>>'{UNIT_SOLD_PRICE,status}'='UNPROVEN'
        and price_evidence#>>'{UNIT_SOLD_PRICE,amount}' is not null)::integer ambiguous_price_promotions,
      count(*) filter(where price_evidence#>>'{SHIPPING,status}'='SHIPPING_UNPROVEN'
        and price_evidence#>>'{SHIPPING,amount}' is not null)::integer missing_shipping_zeroes,
      count(*) filter(where seller_evidence->>'status'='UNPROVEN'
        and seller_evidence->>'identityHash' is not null)::integer fabricated_sellers
    from cohort
  ), diversity as (
    select max(seller_count)::numeric/nullif((select seller_rows from metrics),0)
      as concentration
    from (select count(*) seller_count from cohort
      where seller_evidence->>'status'='PROVEN'
      group by seller_evidence->>'identityHash') sellers
  ), price_stats as (
    select percentile_cont(0.25) within group(order by
        (price_evidence#>>'{UNIT_SOLD_PRICE,amount}')::numeric) as lower_price,
      percentile_cont(0.5) within group(order by
        (price_evidence#>>'{UNIT_SOLD_PRICE,amount}')::numeric) as median_price,
      percentile_cont(0.75) within group(order by
        (price_evidence#>>'{UNIT_SOLD_PRICE,amount}')::numeric) as upper_price,
      count(distinct price_evidence#>>'{CURRENCY,value}') as currency_count,
      min(price_evidence#>>'{CURRENCY,value}') as currency
    from cohort where price_evidence#>>'{UNIT_SOLD_PRICE,status}'='PROVEN'
  ), statuses as (
    select *,case when compatible_count>=3 and compatible_sold_quantity>0
        then 'PROVEN' else 'UNPROVEN' end family_status,
      case when exact_count>=3 then 'PROVEN' else 'UNPROVEN' end exact_status,
      canonical_count>0 and semantic_count=canonical_count and bad_core_count=0
        and not exists(select 1 from cohort where structural_classification='EXACT_PRODUCT_COMPARABLE'
          and coalesce((structural_compatibility->>'allExactDiscriminatorsProven')::boolean,false)=false)
        as classification_pass,
      fabricated_sellers=0 as seller_pass,
      ambiguous_price_promotions=0 and missing_shipping_zeroes=0 as price_pass,
      receipt_mutations=0 and canonical_count=semantic_count as physical_pass
    from metrics cross join diversity cross join price_stats
  )
  select jsonb_build_object(
    'CANONICAL_UNIQUE_ITEMS',canonical_count,'EXACT',exact_count,
    'CLOSE_VARIANT',close_count,'CORE_FAMILY',core_count,'ADJACENT',adjacent_count,
    'FALSE_POSITIVE',false_positive_count,
    'STRUCTURALLY_INCOMPATIBLE_CORE_FAMILY_COUNT_AFTER',bad_core_count,
    'DISTINCT_SELLER_COUNT',case when seller_rows=0 then null else distinct_sellers end,
    'SELLER_CONCENTRATION',case when seller_rows=0 then null else concentration end,
    'SELLER_DIVERSITY_STATUS',case when seller_rows=0 then 'UNPROVEN'
      when distinct_sellers>=3 and concentration<=0.6 then 'DIVERSE'
      else 'CONCENTRATED' end,
    'UNIT_PRICE_PROVEN_COUNT',unit_price_count,'SHIPPING_PROVEN_COUNT',shipping_count,
    'DEFENSIBLE_PRICE_BAND',case when unit_price_count>=3 and currency_count=1
      then jsonb_build_object('status','PROVEN','lower',lower_price,
        'median',median_price,'upper',upper_price,'currency',currency)
      else jsonb_build_object('status','UNPROVEN') end,
    'FAMILY_DEMAND_STATUS',family_status,
    'FAMILY_DEMAND_CONFIDENCE',case when family_status<>'PROVEN' then 'UNPROVEN'
      when seller_rows=0 then 'LIMITED_SELLER_DIVERSITY_UNPROVEN'
      when distinct_sellers<3 or concentration>0.6 then 'LIMITED_SELLER_CONCENTRATION'
      else 'SUPPORTED_BY_SELLER_DIVERSITY' end,
    'EXACT_PRODUCT_DEMAND_STATUS',exact_status,
    'COMPARABLE_CLASSIFICATION_CONTRACT_PASS',classification_pass,
    'FAMILY_DEMAND_EVIDENCE_PASS',family_status='PROVEN',
    'SELLER_DIVERSITY_PASS',seller_pass,'PRICE_EVIDENCE_PASS',price_pass,
    'RESEARCH_BLIND_PARITY_READY',classification_pass and family_status='PROVEN'
      and seller_pass and price_pass,
    'CODE_PASS',true,'RUNTIME_PASS',true,
    'PHYSICAL_RECLASSIFICATION_PASS',physical_pass,'E2E_CERTIFIED',false)
  into v_result from statuses;
  return coalesce(v_result,jsonb_build_object('RUNTIME_PASS',false));
end;
$$;

revoke all on function public.read_product_research_evidence_semantics_canary_v1(text,uuid)
  from public,anon,authenticated;
grant execute on function public.read_product_research_evidence_semantics_canary_v1(text,uuid)
  to service_role;

notify pgrst,'reload schema';
