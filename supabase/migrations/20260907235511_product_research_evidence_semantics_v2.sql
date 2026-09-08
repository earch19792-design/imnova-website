-- Correct two over-broad lexical normalizations discovered by the physical V1
-- backfill. V1 values remain append-only history; V2 is appended and becomes
-- the current projection without changing source receipts.

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
    when p_token like '%ss' then p_token
    when char_length(p_token) > 3 and p_token like '%s'
      then left(p_token, -1)
    else p_token
  end;
$$;

create or replace function public.product_research_json_text_array_v1(
  p_value jsonb
) returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(array_agg(value order by value),'{}'::text[])
  from jsonb_array_elements_text(coalesce(p_value,'[]'::jsonb)) item(value);
$$;

create or replace function public.derive_product_research_evidence_semantics_v2(
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
  v_version constant text := 'PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V2_2026_09_07';
  v_base jsonb;
  v_target_normalized text := public.product_research_semantic_normalize_v1(p_target_title);
  v_target_support text := public.product_research_semantic_normalize_v1(p_target_supporting_evidence);
  v_observed_normalized text := public.product_research_semantic_normalize_v1(p_observed_title);
  v_bodies constant text[] := array['basket','bowl','chinois','colander','cone',
    'ear','ears','funnel','handle','handled','handles','screen','sieve','sifter',
    'skimmer','spoon','stopper'];
  v_shapes constant text[] := array['conical','flat','oval','rectangular','round',
    'square','triangular'];
  v_feature_vocabulary constant text[] := array['adjustable','ear','ears','folding',
    'handle','handled','handles','lid','nonstick','sealed','stackable','wide'];
  v_feature_target_span text;
  v_feature_observed_span text;
  v_target_features text[];
  v_observed_features text[];
  v_target_bodies text[];
  v_observed_bodies text[];
  v_target_shapes text[];
  v_observed_shapes text[];
  v_target_arch text[];
  v_observed_arch text[];
  v_target_use text[];
  v_observed_use text[];
  v_target_material text[];
  v_observed_material text[];
  v_target_sizes text[];
  v_observed_sizes text[];
  v_observed_tokens text[];
  v_target_entity text;
  v_target_count integer;
  v_observed_count integer;
  v_entity_compatible boolean;
  v_architecture_compatible boolean;
  v_use_compatible boolean;
  v_count_difference boolean;
  v_size_difference boolean;
  v_all_exact boolean;
  v_classification text;
  v_reasons text[] := '{}';
begin
  v_base := public.derive_product_research_evidence_semantics_v1(
    p_target_title,p_target_supporting_evidence,p_observed_title,
    p_unit_sold_price,p_unit_sold_price_currency,p_unit_sold_price_source,
    p_quantity_sold,p_legacy_ambiguous_price,p_cumulative_sales_value,
    p_shipping_price,p_free_shipping_percent,p_seller_identity_hash);
  v_feature_target_span := concat_ws(' ',
    substring(v_target_normalized from '\mwith\M[[:space:]]+([^.;:|,-]{2,60})'),
    substring(v_target_support from '([^.;:|,-]{2,40})[- ]design\M'));
  v_feature_observed_span := concat_ws(' ',
    substring(v_observed_normalized from '\mwith\M[[:space:]]+([^.;:|,-]{2,60})'),
    substring(v_observed_normalized from '([^.;:|,-]{2,40})[- ]design\M'));
  v_target_features := public.product_research_semantic_terms_v1(
    v_feature_target_span,v_feature_vocabulary);
  v_observed_features := public.product_research_semantic_terms_v1(
    v_feature_observed_span,v_feature_vocabulary);
  v_target_bodies := public.product_research_semantic_terms_v1(
    concat_ws(' ',p_target_title,array_to_string(v_target_features,' ')),v_bodies);
  v_observed_bodies := public.product_research_semantic_terms_v1(
    concat_ws(' ',p_observed_title,array_to_string(v_observed_features,' ')),v_bodies);
  v_target_shapes := public.product_research_semantic_terms_v1(
    concat_ws(' ',p_target_title,v_feature_target_span),v_shapes);
  v_observed_shapes := public.product_research_semantic_terms_v1(
    concat_ws(' ',p_observed_title,v_feature_observed_span),v_shapes);
  v_target_arch := public.product_research_json_text_array_v1(
    v_base#>'{structuralEvidence,PRODUCT_ARCHITECTURE,target}');
  v_observed_arch := public.product_research_json_text_array_v1(
    v_base#>'{structuralEvidence,PRODUCT_ARCHITECTURE,observed}');
  v_target_use := public.product_research_json_text_array_v1(
    v_base#>'{structuralEvidence,INTENDED_USE,target}');
  v_observed_use := public.product_research_json_text_array_v1(
    v_base#>'{structuralEvidence,INTENDED_USE,observed}');
  v_target_material := public.product_research_json_text_array_v1(
    v_base#>'{structuralEvidence,MATERIAL,target}');
  v_observed_material := public.product_research_json_text_array_v1(
    v_base#>'{structuralEvidence,MATERIAL,observed}');
  v_target_sizes := public.product_research_json_text_array_v1(
    v_base#>'{structuralEvidence,SIZE_SET,target}');
  v_observed_sizes := public.product_research_json_text_array_v1(
    v_base#>'{structuralEvidence,SIZE_SET,observed}');
  v_target_entity := v_base#>>'{structuralEvidence,PRODUCT_ENTITY,target}';
  v_target_count := (v_base#>>'{structuralEvidence,COUNT,target}')::integer;
  v_observed_count := (v_base#>>'{structuralEvidence,COUNT,observed}')::integer;
  select coalesce(array_agg(distinct public.product_research_semantic_stem_v1(token)),
    '{}'::text[]) into v_observed_tokens
  from unnest(regexp_split_to_array(v_observed_normalized,'[^a-z0-9.]+')) token;

  v_entity_compatible := v_target_entity is not null
    and v_target_entity=any(v_observed_tokens);
  v_architecture_compatible := v_entity_compatible
    and not exists(select 1 from unnest(v_observed_bodies) body
      where body<>all(v_target_bodies) and body<>all(array['ear','handle']))
    and not (cardinality(v_target_shapes)>0 and cardinality(v_observed_shapes)>0
      and not v_target_shapes&&v_observed_shapes)
    and not ('mesh'=any(v_target_arch)
      and v_observed_arch&&array['perforated','solid'])
    and not ('fine'=any(v_target_arch) and 'twill'=any(v_observed_arch));
  v_use_compatible := v_architecture_compatible and not (
    not (v_target_use&&array['bathroom','drain','plumbing','sewer','shower','sink','tub'])
      and v_observed_use&&array['bathroom','drain','plumbing','sewer','shower','sink','tub']
    or not (v_target_use&&array['cocktail','coffee','oil','paint','tea'])
      and v_observed_use&&array['cocktail','coffee','oil','paint','tea']);
  v_count_difference := v_target_count is not null and v_observed_count is not null
    and v_target_count<>v_observed_count;
  v_size_difference := cardinality(v_target_sizes)>0 and cardinality(v_observed_sizes)>0
    and v_target_sizes<>v_observed_sizes;
  v_all_exact := v_entity_compatible and v_architecture_compatible and v_use_compatible
    and cardinality(v_target_arch)>0 and cardinality(v_observed_arch)>0
    and cardinality(v_target_use)>0 and cardinality(v_observed_use)>0
    and cardinality(v_target_bodies||v_target_shapes)>0
    and cardinality(v_observed_bodies||v_observed_shapes)>0
    and v_target_count is not null and v_observed_count=v_target_count
    and cardinality(v_target_sizes)>0 and v_observed_sizes=v_target_sizes
    and cardinality(v_target_material)>0 and v_target_material<@v_observed_material
    and (v_target_arch||v_target_shapes)<@(v_observed_arch||v_observed_shapes)
    and cardinality(v_target_features)>0 and v_target_features<@v_observed_features
    and v_target_use<@v_observed_use;

  if not v_entity_compatible then
    v_classification := 'FALSE_POSITIVE'; v_reasons := array['PRODUCT_ENTITY_INCOMPATIBLE'];
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
    if v_count_difference then v_reasons := array_append(v_reasons,
      'EXPLICIT_TITLE_COUNT_DIFFERENCE'); end if;
    if v_size_difference then v_reasons := array_append(v_reasons,
      'EXPLICIT_TITLE_SIZE_DIFFERENCE'); end if;
  else
    v_classification := 'CORE_FAMILY_COMPARABLE';
    v_reasons := array['ENTITY_USE_AND_ARCHITECTURE_COMPATIBLE',
      'EXACT_DISCRIMINATORS_INCOMPLETE'];
  end if;

  v_base := jsonb_set(v_base,'{version}',to_jsonb(v_version));
  v_base := jsonb_set(v_base,'{structuralEvidence,FORM_FACTOR}',jsonb_build_object(
    'target',v_target_bodies||v_target_shapes,'observed',v_observed_bodies||v_observed_shapes,
    'status',case when cardinality(v_observed_bodies||v_observed_shapes)=0
      then 'UNPROVEN' else 'PROVEN' end));
  v_base := jsonb_set(v_base,'{structuralEvidence,FEATURES}',jsonb_build_object(
    'target',v_target_features,'observed',v_observed_features,
    'status',case when cardinality(v_observed_features)=0
      then 'UNPROVEN' else 'PROVEN' end));
  v_base := jsonb_set(v_base,'{structuralEvidence,FAMILY_QUALIFIERS}',jsonb_build_object(
    'target',v_target_arch||v_target_shapes,'observed',v_observed_arch||v_observed_shapes,
    'status',case when cardinality(v_observed_arch||v_observed_shapes)=0
      then 'UNPROVEN' else 'PROVEN' end));
  v_base := jsonb_set(v_base,'{classification}',to_jsonb(v_classification));
  v_base := jsonb_set(v_base,'{classificationReasons}',to_jsonb(v_reasons));
  v_base := jsonb_set(v_base,'{compatibility}',jsonb_build_object(
    'entityCompatible',v_entity_compatible,'architectureCompatible',v_architecture_compatible,
    'useCompatible',v_use_compatible,'explicitCountDifference',v_count_difference,
    'explicitSizeDifference',v_size_difference,
    'allExactDiscriminatorsProven',v_all_exact));
  return v_base;
end;
$$;

create or replace function public.reclassify_product_research_evidence_semantics_v2(
  p_marketplace_account_key text,p_plan_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_version constant text := 'PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V2_2026_09_07';
  v_target_title text; v_target_evidence text; v_row record; v_derived jsonb;
  v_appended integer := 0; v_reused integer := 0;
begin
  if char_length(trim(coalesce(p_marketplace_account_key,''))) not between 8 and 160
      or p_plan_id is null then
    raise exception 'PRODUCT_RESEARCH_EVIDENCE_RECLASSIFICATION_INVALID';
  end if;
  select opportunity.product_title,
    opportunity.assessment#>>'{productTruth,sourceEvidence,requiredItemSpecificsTruthV1,lunaExactProductEvidenceSetV1,description}'
  into v_target_title,v_target_evidence
  from public.marketplace_product_research_query_plans plan
  join public.ebay_luna_opportunity_queue opportunity on opportunity.id=plan.source_opportunity_id
  where plan.id=p_plan_id and plan.marketplace_account_key=p_marketplace_account_key
    and plan.marketplace='EBAY_US';
  if not found then return jsonb_build_object('status','TARGET_EVIDENCE_UNPROVEN'); end if;
  for v_row in
    select canonical.item_id,canonical.bounded_title_evidence,
      observation.*,md5(concat_ws('|',observation.id::text,
        observation.capture_batch_id::text,observation.evidence_deduplication_key,
        observation.bounded_title_evidence,observation.commercial_comparable_classification,
        observation.unit_sold_price::text,observation.unit_sold_price_currency,
        observation.unit_sold_price_source,observation.confirmed_sold_quantity::text,
        observation.average_sold_price::text,observation.item_sales::text,
        observation.average_shipping::text,observation.free_shipping_percent::text,
        observation.seller_reference_fingerprint)) source_receipt_checksum
    from public.seller_os_product_research_canonical_evidence_v1 canonical
    cross join lateral (
      select candidate.* from public.marketplace_product_research_query_tasks task
      join public.marketplace_product_research_query_plans plan on plan.id=task.plan_id
      join public.marketplace_product_research_capture_observations candidate
        on candidate.capture_batch_id=task.capture_batch_id
       and candidate.marketplace_account_key=task.marketplace_account_key
       and candidate.source_listing_id=canonical.item_id
      where task.plan_id=canonical.plan_id
        and task.strategy_version=plan.intelligence_contract_version
      order by candidate.created_at desc,candidate.id limit 1
    ) observation
    where canonical.plan_id=p_plan_id
      and canonical.marketplace_account_key=p_marketplace_account_key
  loop
    if exists(select 1 from jsonb_array_elements(v_row.evidence_semantics_versions) value
      where value->>'planId'=p_plan_id::text and value->>'version'=v_version) then
      v_reused := v_reused+1; continue;
    end if;
    v_derived := public.derive_product_research_evidence_semantics_v2(
      v_target_title,v_target_evidence,v_row.bounded_title_evidence,
      v_row.unit_sold_price,v_row.unit_sold_price_currency,v_row.unit_sold_price_source,
      v_row.confirmed_sold_quantity,v_row.average_sold_price,v_row.item_sales,
      v_row.average_shipping,v_row.free_shipping_percent,v_row.seller_reference_fingerprint)
      || jsonb_build_object('planId',p_plan_id,'itemId',v_row.item_id,
        'sourceReceipt',jsonb_build_object('checksum',v_row.source_receipt_checksum,
          'legacyClassification',v_row.commercial_comparable_classification));
    update public.marketplace_product_research_capture_observations
    set evidence_semantics_versions=evidence_semantics_versions||jsonb_build_array(v_derived)
    where id=v_row.id;
    v_appended := v_appended+1;
  end loop;
  return jsonb_build_object('status','RECLASSIFIED','version',v_version,
    'appended',v_appended,'reused',v_reused,'canonicalItems',v_appended+v_reused);
end;
$$;

revoke all on function public.product_research_json_text_array_v1(jsonb)
  from public,anon,authenticated;
revoke all on function public.derive_product_research_evidence_semantics_v2(
  text,text,text,numeric,text,text,integer,numeric,numeric,numeric,numeric,text)
  from public,anon,authenticated;
revoke all on function public.reclassify_product_research_evidence_semantics_v2(text,uuid)
  from public,anon,authenticated;
grant execute on function public.reclassify_product_research_evidence_semantics_v2(text,uuid)
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
    perform public.reclassify_product_research_evidence_semantics_v2(
      new.marketplace_account_key,new.plan_id);
  end if;
  return new;
end;
$$;

do $$
declare v_plan record;
begin
  for v_plan in select distinct canonical.marketplace_account_key,canonical.plan_id
    from public.seller_os_product_research_canonical_evidence_v1 canonical
    join public.marketplace_product_research_query_plans plan on plan.id=canonical.plan_id
    where plan.source_opportunity_id is not null
  loop
    perform public.reclassify_product_research_evidence_semantics_v2(
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
  select candidate.* from public.marketplace_product_research_query_tasks task
  join public.marketplace_product_research_query_plans plan on plan.id=task.plan_id
  join public.marketplace_product_research_capture_observations candidate
    on candidate.capture_batch_id=task.capture_batch_id
   and candidate.marketplace_account_key=task.marketplace_account_key
   and candidate.source_listing_id=canonical.item_id
  where task.plan_id=canonical.plan_id
    and task.strategy_version=plan.intelligence_contract_version
  order by candidate.created_at desc,candidate.id limit 1
) observation on true
left join lateral (
  select value from jsonb_array_elements(
    coalesce(observation.evidence_semantics_versions,'[]'::jsonb))
  where value->>'planId'=canonical.plan_id::text
    and value->>'version'='PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V2_2026_09_07'
  limit 1
) semantics on true;

notify pgrst,'reload schema';
