set local lock_timeout='3s';
set local statement_timeout='45s';
-- Preserve V1/V2 pure functions and frozen history; same refresh authority.

create function public.keyword_observed_concept_span_v2_1(
  p_title text,p_qualifier text,p_head text,p_allowed_gaps text[]
) returns jsonb language plpgsql immutable parallel safe
set search_path=pg_catalog,public as $$
declare words text[]; qual text[]:=public.keyword_tokens_v1(p_qualifier);
  head text[]:=public.keyword_tokens_v1(p_head); a integer; b integer; gap text[]; unfamiliar text[];
begin
  -- Do not transfer a modifier across accessory/use/brand clauses.
  -- Omission is market-language generalization, never attribute authorization.
  words:=public.keyword_tokens_v1(regexp_replace(lower(p_title),
    '\m(for|with|fits|fit|compatible|replacement|by|brand|model|mpn)\M.*$','','g'));
  if cardinality(qual)=0 or cardinality(head)=0 then return null; end if;
  for a in 1..greatest(cardinality(words)-cardinality(qual)+1,0) loop
    if words[a:a+cardinality(qual)-1]<>qual then continue; end if;
    for b in a+cardinality(qual)..least(a+cardinality(qual)+3,cardinality(words)-cardinality(head)+1) loop
      if words[b:b+cardinality(head)-1]<>head then continue; end if;
      gap:=coalesce(words[a+cardinality(qual):b-1],'{}');
      -- Comparator-only modifiers may be omitted (never asserted) when a
      -- shared lexical anchor still connects one proven attribute and head.
      -- At most one additional alphabetic word; no numeric/model identifiers.
      select coalesce(array_agg(w),'{}') into unfamiliar from unnest(gap) w
        where not w=any(coalesce(p_allowed_gaps,'{}'));
      if cardinality(unfamiliar)>0 and not (
        cardinality(unfamiliar)=1 and cardinality(gap)>1
        and unfamiliar[1]~'^[a-z]{3,20}$'
        and gap && coalesce(p_allowed_gaps,'{}')
      ) then continue; end if;
      return jsonb_build_object('MATCHED',true,'CONTIGUOUS',cardinality(gap)=0,
        'OBSERVED_SURFACE',array_to_string(words[a:b+cardinality(head)-1],' '),
        'ELIDED_TOKENS',to_jsonb(gap),'COMPARATOR_ONLY_OMITTED_TOKENS',to_jsonb(unfamiliar),
        'OMITTED_TOKENS_PROMOTED',false,'RELATIONSHIP',case when cardinality(gap)=0
          then 'CONTIGUOUS_QUALIFIED_HEAD' when cardinality(unfamiliar)>0 then 'ANCHORED_COMPARATOR_MODIFIER_OMISSION'
          else 'ORDERED_SHARED_MODIFIER_ELISION' end);
    end loop;
  end loop;
  return null;
end;
$$;

create function public.derive_product_research_keyword_intelligence_v2_1(
  p_truth jsonb,p_evidence jsonb,p_queries jsonb,p_prerequisites jsonb
) returns jsonb language plpgsql immutable parallel safe
set search_path=pg_catalog,public,extensions as $$
declare
  v_version constant text:='PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1';
  v_base jsonb; v_terms jsonb; v_ranked jsonb; v_winner jsonb; v_runner jsonb;
  v_head text; v_title text; v_gaps text[]; v_count integer; v_sold numeric;
  v_negative integer; v_blockers jsonb; v_ready boolean; v_margin numeric;
  v_limits constant jsonb:='["SELLER_DIVERSITY_UNPROVEN","PRICE_BAND_UNPROVEN", "BOUNDED_COMPARABLE_SAMPLE", "OBSERVED_SOLD_QUANTITY_NOT_SEARCH_VOLUME", "QUERY_DIVERSITY_NOT_INDEPENDENT_SELLER_DIVERSITY", "NO_DICTIONARY_ONLY_DEMAND_OR_UNLICENSED_SYNONYMS", "SCORE_IS_A_RANKING_HEURISTIC_NOT_CONVERSION_PROBABILITY"]';
begin
  -- V1 is retained as the immutable safety/input adapter, not a ranking oracle.
  -- Its structural classifier, source binding, dedup, provenance and claim gates
  -- are unchanged. No new observation can turn an adjacent item positive.
  v_base:=public.derive_product_research_keyword_intelligence_v1(p_truth,p_evidence,p_queries,p_prerequisites);
  if v_base->'CANONICAL_ITEMS' is null then
    return v_base||jsonb_build_object('DECISION_VERSION',v_version,'LIMITATIONS',v_limits);
  end if;
  select coalesce(jsonb_agg(b order by b::text),'[]') into v_blockers
    from jsonb_array_elements(v_base->'BLOCKERS') b
    where b#>>'{}'<>'PRIMARY_COMMERCIAL_CONCEPT_UNPROVEN';
  select f->>'VALUE' into v_title from jsonb_array_elements(p_truth->'fields') f
    where f->>'FIELD'='TITLE' and f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN';
  v_head:=public.product_research_semantic_entity_v1(v_title);
  v_gaps:=public.keyword_tokens_v1(v_title);
  -- An inherited structural token is not necessarily a commercial entity.
  -- Fail closed without changing the Research classifier or guessing a noun.
  if v_head ~ '^(oz|ounce|lb|lbs|pound|g|kg|mg|ml|cl|l|liter|litre|cm|mm|m|inch|in|ft|foot|pcs|pc|piece|pack|[0-9.]+)$' then
    v_blockers:=v_blockers||'"UNIT_OR_NUMERIC_TOKEN_IS_NOT_A_PRODUCT_ENTITY"'::jsonb;
  end if;
  v_count:=(v_base->>'COMPARABLE_ITEM_COUNT')::integer;
  v_sold:=(v_base->>'SOLD_EVIDENCE_QUANTITY')::numeric;
  select count(*) into v_negative from jsonb_array_elements(v_base->'CANONICAL_ITEMS') i where i->>'POSITIVE'<>'true';

  with items as materialized (select i from jsonb_array_elements(v_base->'CANONICAL_ITEMS') i),
  old_terms as (select t from jsonb_array_elements(v_base->'TERMS') t),
  facts as (
    select distinct t->>'TERM' term,f,
      case when f->>'FIELD' in ('MATERIAL','FORM_FACTOR','FEATURES') then 'ATTRIBUTE_QUALIFIER'
        when f->>'FIELD'='PACKAGE_CONTENTS' then 'SEMANTIC_ALTERNATIVE' else 'SECONDARY_ATTRIBUTE' end kind
    from old_terms cross join lateral jsonb_array_elements(t#>'{PRODUCT_TRUTH_SUPPORT,FIELDS}') f
    where f->>'FIELD'<>'TITLE' and f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN'
      -- Do not mistake a V1 mechanically concatenated phrase for a source fact.
      and (public.keyword_phrase_v1(f->>'VALUE')=t->>'TERM'
        or f->>'FIELD' in ('PACKAGE_CONTENTS','QUANTITY_OR_SET_COUNT','SIZE_SET','INTENDED_USES'))
  ), generated as (
    select v_head term,'HEAD_CONCEPT' kind,null::text qualifier,null::jsonb fact
    union all select term,kind,null,f from facts
    union all
    -- A candidate exists only after an observed marketplace span licenses it.
    -- One complete explicit attribute axis: never concatenate attribute lists.
    select distinct f.term||' '||v_head,'QUALIFIED_CONCEPT',f.term,f.f
      from facts f cross join items
      where f.kind='ATTRIBUTE_QUALIFIER' and i->>'POSITIVE'='true'
        and not public.keyword_contains_v1(f.term,v_head)
        and public.keyword_observed_concept_span_v2_1(i->>'TITLE',f.term,v_head,v_gaps) is not null
    union all
    -- Derivational morphology licenses equivalence only; market items still
    -- prove demand. No dictionary, model/brand inference or LLM synonym input.
    select distinct token,'SEMANTIC_ALTERNATIVE',null::text,null::jsonb
      from items cross join lateral unnest(public.keyword_tokens_v1(i->>'TITLE')) token
      where i->>'POSITIVE'='true' and token<>v_head
        and public.keyword_family_root_v2(token)=public.keyword_family_root_v2(v_head)
    union all
    select t->>'TERM','OBSERVED_OR_REJECTED',null,null from old_terms
  ), concepts as (
    select term,
      case when bool_or(kind='HEAD_CONCEPT') then 'HEAD_CONCEPT'
        when bool_or(kind='QUALIFIED_CONCEPT') then 'QUALIFIED_CONCEPT'
        when bool_or(kind='ATTRIBUTE_QUALIFIER') then 'ATTRIBUTE_QUALIFIER'
        when bool_or(kind='SECONDARY_ATTRIBUTE') then 'SECONDARY_ATTRIBUTE'
        when bool_or(kind='SEMANTIC_ALTERNATIVE') then 'SEMANTIC_ALTERNATIVE' else 'OBSERVED_OR_REJECTED' end kind,
      max(qualifier) qualifier,
      coalesce(jsonb_agg(distinct fact) filter(where fact is not null),'[]') fields
    from generated where term is not null and term<>'' group by term
  ), supported as (
    select c.*,i,
      case when kind='QUALIFIED_CONCEPT' then public.keyword_observed_concept_span_v2_1(i->>'TITLE',qualifier,v_head,v_gaps)
        when term like 'set of %' and public.product_research_semantic_count_v1(i->>'TITLE')::text=substring(term from 8)
          then jsonb_build_object('MATCHED',true,'CONTIGUOUS',true,'OBSERVED_SURFACE',i->>'TITLE','RELATIONSHIP','NORMALIZED_SET_COUNT')
        when public.keyword_contains_v1(i->>'TITLE',term) then jsonb_build_object('MATCHED',true,'CONTIGUOUS',true,
          'OBSERVED_SURFACE',term,'RELATIONSHIP','LITERAL_OR_PLURAL_NORMALIZATION')
        else null end span
    from concepts c cross join items
  ), measured as (
    select c.*,m.*,provenance.*,
      case when c.kind='HEAD_CONCEPT' then coalesce((select t->'PRODUCT_TRUTH_SUPPORT' from old_terms where t->>'TERM'=v_head),
        jsonb_build_object('SUPPORTED',false,'FIELDS','[]'::jsonb))
      when c.kind='SEMANTIC_ALTERNATIVE' and jsonb_array_length(c.fields)=0 then jsonb_build_object(
        'SUPPORTED',not exists(select 1 from jsonb_array_elements(p_truth->'fields') f
          where f->>'SEMANTIC_CLASS' in ('SUPPLIER_CLAIM','UNPROVEN','CONTRADICTED')
            and public.keyword_contains_v1(f->>'VALUE',c.term)),'BASIS','MORPHOLOGICAL_FAMILY_ROOT_WITH_CURRENT_STRUCTURAL_COMPATIBILITY',
        'FAMILY_ROOT',public.keyword_family_root_v2(v_head),
        'SEMANTIC_COMPATIBILITY_NOT_ADDITIONAL_PRODUCT_FACT',true,
        'FIELDS',coalesce((select t#>'{PRODUCT_TRUTH_SUPPORT,FIELDS}' from old_terms where t->>'TERM'=v_head),'[]'))
      when jsonb_array_length(c.fields)>0 then jsonb_build_object('SUPPORTED',true,'BASIS','EXPLICIT_FIELD_FACT',
        'FIELDS',c.fields,'ENTITY_EVIDENCE',case when c.kind='QUALIFIED_CONCEPT' then
          (select t->'PRODUCT_TRUTH_SUPPORT' from old_terms where t->>'TERM'=v_head) else null end)
      else coalesce((select t->'PRODUCT_TRUTH_SUPPORT' from old_terms where t->>'TERM'=c.term),
        jsonb_build_object('SUPPORTED',false,'FIELDS','[]'::jsonb)) end truth_support
    from concepts c cross join lateral (
      select count(*) filter(where i->>'POSITIVE'='true' and span is not null)::integer hits,
        count(*) filter(where i->>'POSITIVE'<>'true' and span is not null)::integer negative_hits,
        count(*) filter(where i->>'POSITIVE'='true' and span->>'CONTIGUOUS'='true')::integer contiguous_hits,
        coalesce(sum((i->>'SOLD_QUANTITY')::numeric) filter(where i->>'POSITIVE'='true' and span is not null),0) sold,
        coalesce(max((i->>'SOLD_QUANTITY')::numeric) filter(where i->>'POSITIVE'='true' and span is not null),0) largest_item_sales,
        coalesce(jsonb_agg(i->'ITEM_ID' order by i->>'ITEM_ID') filter(where i->>'POSITIVE'='true' and span is not null),'[]') item_ids,
        coalesce(jsonb_agg(jsonb_build_object('ITEM_ID',i->'ITEM_ID','POSITIVE',i->'POSITIVE',
          'OBSERVED_CONCEPT',span,'SOURCE_RECEIPTS',i->'SOURCE_RECEIPTS','QUERY_PROVENANCE',i->'QUERY_PROVENANCE',
          'SOLD_QUANTITY',case when i->>'POSITIVE'='true' then i->'SOLD_QUANTITY' else 'null'::jsonb end)
          order by i->>'ITEM_ID') filter(where span is not null),'[]') receipts
      from supported s where s.term=c.term
    ) m cross join lateral (
      select count(distinct h)::integer query_count,
        coalesce(jsonb_agg(distinct h order by h),'[]') hashes
      from supported s cross join lateral jsonb_array_elements(i->'QUERY_PROVENANCE') h
      where s.term=c.term and i->>'POSITIVE'='true' and span is not null
        and exists(select 1 from jsonb_array_elements(p_queries) q where q->'query_hash'=h)
    ) provenance
  ), factors as (
    select *,hits::numeric/greatest(v_count,1) coverage,
      sold/greatest(v_sold,1) sales_share,
      negative_hits::numeric/greatest(hits+negative_hits,1) ambiguity,
      case when kind='QUALIFIED_CONCEPT' then
        (contiguous_hits+0.8*(hits-contiguous_hits))/greatest(hits,1)::numeric else 1 end coherence,
      case when v_negative>0 then greatest(0,least(2,log(2,
        ((hits+1)::numeric/(v_count+2))/((negative_hits+1)::numeric/(v_negative+2))))) else 0 end information_gain,
      kind='QUALIFIED_CONCEPT' and hits>=3 and hits::numeric/greatest(v_count,1)>=0.5
        and cardinality(public.keyword_tokens_v1(term))<=4 and length(term)<=60
        and truth_support->>'SUPPORTED'='true' as viable_child
    from measured
  ), components as (
    select *,case when kind='HEAD_CONCEPT' and exists(select 1 from factors f where f.viable_child)
        then 15 else 0 end genericity,
      case when kind='QUALIFIED_CONCEPT' then 20 else 0 end specificity
    from factors
  ), scored as (
    select *,round(30*coverage+10*sales_share+specificity+15*coherence
      +10*least(hits::numeric/5,1)+5*least(query_count::numeric/2,1)
      +5*information_gain-genericity-15*ambiguity,2) score,
      jsonb_array_length(v_blockers)=0 and truth_support->>'SUPPORTED'='true'
        and ((kind='HEAD_CONCEPT' and hits>=2 and coverage>=0.6) or viable_child) primary_eligible
    from components
  ) select coalesce(jsonb_agg(jsonb_build_object('TERM',term,'CONCEPT_TYPE',kind,'QUALIFIER',qualifier,
    'SCORE',score,'PRIMARY_ELIGIBLE',primary_eligible,'PRODUCT_TRUTH_SUPPORT',truth_support,
    'ITEM_COVERAGE',jsonb_build_object('MATCHED',hits,'TOTAL',v_count,'RATIO',round(coverage,4),'ITEM_IDS',item_ids),
    'COMPARABLE_ITEM_COUNT',hits,'SOLD_EVIDENCE_SUPPORT',jsonb_build_object('CONFIRMED_QUANTITY',sold,
      'SUPPORTED',sold>0,'LARGEST_ITEM_SHARE',round(largest_item_sales/greatest(sold,1),4)),
    'MARKET_SUPPORT',jsonb_build_object('SUPPORTED',hits>0,'QUERY_CONCEPT_SUPPORT',hits,
      'CONTIGUOUS_ITEM_COUNT',contiguous_hits,'ORDERED_ELISION_ITEM_COUNT',hits-contiguous_hits,
      'COMPARATOR_OMISSION_NOT_ATTRIBUTE_PROOF',true,
      'NEGATIVE_ITEM_COUNT',negative_hits,'NEGATIVE_POSITIVE_WEIGHT',0,'QUERY_DIVERSITY',query_count),
    'SPECIFICITY_SCORE',specificity,'GENERICITY_PENALTY',genericity,
    'SCORING_COMPONENTS',jsonb_build_object('STRUCTURALLY_COMPATIBLE_ITEM_COVERAGE',round(30*coverage,4),
      'SOLD_EVIDENCE_SUPPORT',round(10*sales_share,4),'PRODUCT_TRUTH_COMPATIBILITY',truth_support->'SUPPORTED',
      'BUYER_INTENT_SPECIFICITY',specificity,'DISCRIMINATIVE_INFORMATION_GAIN',round(information_gain,4),
      'INFORMATION_GAIN_POINTS',round(5*information_gain,4),'GENERICITY_PENALTY',genericity,
      'QUERY_CONCEPT_COHERENCE',round(coherence,4),'COHERENCE_POINTS',round(15*coherence,4),
      'CROSS_COMPARABLE_SUPPORT',round(10*least(hits::numeric/5,1),4),
      'QUERY_DIVERSITY_POINTS',round(5*least(query_count::numeric/2,1),4),
      'AMBIGUITY',round(ambiguity,4),'AMBIGUITY_PENALTY',round(15*ambiguity,4),
      'FAMILY_HEAD_NOUN_SCORE',case when kind='HEAD_CONCEPT' then score+genericity else null end,
      'BUYER_QUERY_INFORMATION_GAIN',round(information_gain,4),'INFORMATION_GAIN_BASIS','LAPLACE_SMOOTHED_COMPATIBLE_VS_NEGATIVE_ITEM_LIFT'),
    'SEMANTIC_RELATIONSHIP',jsonb_build_object('HEAD_CONCEPT',v_head,
      'PARENT_CONCEPT',case when kind in ('QUALIFIED_CONCEPT','SEMANTIC_ALTERNATIVE') then v_head else null end,
      'CHILD_CONCEPT',case when kind='QUALIFIED_CONCEPT' then term else null end,
      'COMPOSITIONAL_RELATIONSHIP',case when kind='QUALIFIED_CONCEPT' then 'ONE_PROVEN_ATTRIBUTE_QUALIFIES_HEAD'
        when kind='ATTRIBUTE_QUALIFIER' then 'ATTRIBUTE_OF_HEAD'
        when kind='SEMANTIC_ALTERNATIVE' then case when jsonb_array_length(fields)>0 then 'PROVEN_PACKAGE_FAMILY_ALTERNATIVE'
          else 'MORPHOLOGICAL_FAMILY_VARIANT' end else kind end,
      'INCREMENTAL_MARKET_SUPPORT',jsonb_build_object('RETAINED_UNIQUE_ITEMS',hits,
        'NEW_UNIQUE_ITEMS_VS_HEAD',0,'LOST_ITEMS_VS_HEAD',greatest(v_count-hits,0),'ANCESTOR_COUNTS_ADDED',false),
      'INCREMENTAL_SPECIFICITY',specificity),
    'SOURCE_RECEIPTS',receipts,'QUERY_PROVENANCE',hashes,
    'LIMITATIONS',v_limits,'DECISION_VERSION',v_version) order by score desc,term),'[]') into v_terms from scored;

  select t into v_winner from jsonb_array_elements(v_terms) t where t->>'PRIMARY_ELIGIBLE'='true'
    order by (t->>'SCORE')::numeric desc,t->>'TERM' limit 1;
  select t into v_runner from jsonb_array_elements(v_terms) t where t->>'PRIMARY_ELIGIBLE'='true'
    order by (t->>'SCORE')::numeric desc,t->>'TERM' offset 1 limit 1;
  v_margin:=case when v_runner is null then null else (v_winner->>'SCORE')::numeric-(v_runner->>'SCORE')::numeric end;
  if v_winner is null then
    v_blockers:=v_blockers||'"NO_DEFENSIBLE_PRIMARY_QUERY_CONCEPT"'::jsonb;
  elsif v_margin is not null and v_margin<3 then
    v_blockers:=v_blockers||'"PRIMARY_CONCEPTS_NOT_DISTINGUISHABLE"'::jsonb;
    v_winner:=null;
  end if;
  v_ready:=v_winner is not null and jsonb_array_length(v_blockers)=0;

  with terms as (select t,
    case when jsonb_array_length(v_blockers)>0 then 'REJECTED_TERMS'
      when t#>>'{PRODUCT_TRUTH_SUPPORT,SUPPORTED}' is distinct from 'true' then 'REJECTED_TERMS'
      when (t->>'COMPARABLE_ITEM_COUNT')::integer=0 then 'REJECTED_TERMS'
      when t->>'TERM'=v_winner->>'TERM' then 'PRIMARY_KEYWORD'
      when t->>'CONCEPT_TYPE'='ATTRIBUTE_QUALIFIER' and (t->>'COMPARABLE_ITEM_COUNT')::integer>=2 then 'CORE_QUALIFIERS'
      when t->>'CONCEPT_TYPE'='SEMANTIC_ALTERNATIVE' and (t->>'COMPARABLE_ITEM_COUNT')::integer>=2
        and (t#>>'{ITEM_COVERAGE,RATIO}')::numeric>=0.25 then 'SEMANTIC_EXPANSIONS'
      when t->>'CONCEPT_TYPE'='SEMANTIC_ALTERNATIVE' then 'REJECTED_TERMS'
      when t->>'CONCEPT_TYPE' in ('HEAD_CONCEPT','QUALIFIED_CONCEPT','SECONDARY_ATTRIBUTE','ATTRIBUTE_QUALIFIER') then 'SECONDARY_KEYWORDS'
      else 'REJECTED_TERMS' end classification
    from jsonb_array_elements(v_terms) t
  ), explained as (
    select *,case when jsonb_array_length(v_blockers)>0 then 'PREREQUISITES_OR_PRIMARY_DISTINCTION_UNPROVEN'
      when t#>>'{PRODUCT_TRUTH_SUPPORT,SUPPORTED}' is distinct from 'true' then
        coalesce((select x->>'REASONING_BASIS' from jsonb_array_elements(v_base->'TERMS') x where x->>'TERM'=t->>'TERM'),
          'PRODUCT_TRUTH_COMPATIBILITY_UNPROVEN')
      when t->>'TERM'=v_winner->>'TERM' then case when t->>'CONCEPT_TYPE'='HEAD_CONCEPT'
        then 'STRONGEST_SUPPORTED_CONCEPT_NO_DISCRIMINATIVE_CHILD_CLEARS_EVIDENCE_GATES'
        else 'PROVEN_QUALIFICATION_WITH_COHERENT_CROSS_ITEM_SUPPORT_AND_WINNING_MARGIN' end
      when classification='CORE_QUALIFIERS' then 'PROVEN_ATTRIBUTE_REPEATED_MARKET_SUPPORT_COMPOSITIONAL_WITH_HEAD'
      when classification='SEMANTIC_EXPANSIONS' then 'LICENSED_FAMILY_EQUIVALENCE_AND_REPEATED_COMPATIBLE_MARKET_SUPPORT'
      when classification='SECONDARY_KEYWORDS' and t->>'CONCEPT_TYPE'='QUALIFIED_CONCEPT' then
        case when t->>'PRIMARY_ELIGIBLE'='true' then 'COMPOSITIONAL_CHILD_LOWER_MULTIFACTOR_SCORE'
          else 'COMPOSITIONAL_CHILD_INSUFFICIENT_PRIMARY_CROSS_ITEM_COVERAGE' end
      when classification='SECONDARY_KEYWORDS' and t->>'CONCEPT_TYPE'='HEAD_CONCEPT' then 'PARENT_HEAD_RETAINED_WITHOUT_DOUBLE_CREDIT'
      when classification='SECONDARY_KEYWORDS' then 'FACTUAL_SECONDARY_ATTRIBUTE_WEAKER_SEARCH_DISCRIMINATION'
      when t->>'CONCEPT_TYPE'='SEMANTIC_ALTERNATIVE' then 'SEMANTIC_EXPANSION_MARKET_SUPPORT_INSUFFICIENT'
      else coalesce((select x->>'REASONING_BASIS' from jsonb_array_elements(v_base->'TERMS') x where x->>'TERM'=t->>'TERM'),
        'UNSUPPORTED_ATTRIBUTE_OR_NO_MEANINGFUL_DEMAND') end reason from terms
  ) select jsonb_agg(t||jsonb_build_object('CLASSIFICATION',classification,'RANK',rank,
      'CLASSIFICATION_REASON',reason,'REASONING_BASIS',reason,
      'SEMANTIC_EXPANSION_MARKET_SUPPORT',classification='SEMANTIC_EXPANSIONS',
      'SEMANTIC_EQUIVALENCE_BASIS',t#>'{SEMANTIC_RELATIONSHIP,COMPOSITIONAL_RELATIONSHIP}',
      'COMPATIBLE_ITEM_COVERAGE',t->'ITEM_COVERAGE',
      'WHY_PRIMARY',case when classification='PRIMARY_KEYWORD' then reason else null end,
      'WHY_NOT_ALTERNATIVE',case when classification<>'PRIMARY_KEYWORD' then reason else null end,
      'WHY_CORE',case when classification='CORE_QUALIFIERS' then reason else null end,
      'WHY_SEMANTIC_EXPANSION',case when classification='SEMANTIC_EXPANSIONS' then reason else null end,
      'WHY_SECONDARY',case when classification='SECONDARY_KEYWORDS' then reason else null end,
      'WHY_REJECTED',case when classification='REJECTED_TERMS' then reason else null end,
      'CONFIDENCE',case when classification='REJECTED_TERMS' then 'NOT_PROMOTED'
        when (classification='PRIMARY_KEYWORD' and v_margin is not null and v_margin<5)
          or v_count<5 or (t#>>'{MARKET_SUPPORT,QUERY_DIVERSITY}')::integer<2
          or (t#>>'{SOLD_EVIDENCE_SUPPORT,LARGEST_ITEM_SHARE}')::numeric>0.5
          or (t#>>'{SCORING_COMPONENTS,AMBIGUITY}')::numeric>0.7 then 'LIMITED' else 'MODERATE' end)
      order by rank) into v_ranked
    from (select *,row_number() over(order by case classification when 'PRIMARY_KEYWORD' then 1
      when 'CORE_QUALIFIERS' then 2 when 'SEMANTIC_EXPANSIONS' then 3 when 'SECONDARY_KEYWORDS' then 4 else 5 end,
      (t->>'SCORE')::numeric desc,t->>'TERM') rank from explained) r;

  return v_base||jsonb_build_object('DECISION_VERSION',v_version,
    'INPUT_FINGERPRINT','sha256:'||encode(digest(jsonb_build_array(v_version,v_base->'INPUT_FINGERPRINT')::text,'sha256'),'hex'),
    'INPUT_AUTHORITY_FINGERPRINT',v_base->'INPUT_FINGERPRINT','TERMS',coalesce(v_ranked,'[]'),
    'PRIMARY_KEYWORD',case when v_ready then v_winner->>'TERM' else 'UNPROVEN' end,
    'PRIMARY_SCORE',case when v_ready then v_winner->'SCORE' else null end,
    'PRIMARY_WINNING_MARGIN',v_margin,'KEYWORD_DECISION_READY',v_ready,
    'KEYWORD_INTELLIGENCE',case when v_ready then 'READY' else 'UNPROVEN' end,
    'KEYWORD_INTELLIGENCE_CONFIDENCE',coalesce((select t->>'CONFIDENCE' from jsonb_array_elements(v_ranked) t
      where t->>'CLASSIFICATION'='PRIMARY_KEYWORD'),'UNPROVEN'),
    'CONFIDENCE_FACTORS',jsonb_build_object('COMPARABLE_SAMPLE_SIZE',v_count,'PRIMARY_WINNING_MARGIN',v_margin,
      'QUERY_DIVERSITY',v_winner#>'{MARKET_SUPPORT,QUERY_DIVERSITY}',
      'TERM_CONCENTRATION',v_winner#>'{ITEM_COVERAGE,RATIO}',
      'SALES_CONCENTRATION',v_winner#>'{SOLD_EVIDENCE_SUPPORT,LARGEST_ITEM_SHARE}',
      'SEMANTIC_AMBIGUITY',v_winner#>'{SCORING_COMPONENTS,AMBIGUITY}',
      'SELLER_DIVERSITY','UNPROVEN','PRICE_BAND','UNPROVEN','MAXIMUM_CONFIDENCE','MODERATE'),
    'SEMANTIC_EXPANSION_RECALL_AUDIT',jsonb_build_object('V1_LIMIT','PACKAGE_CONTENT_ENTITY_ONLY',
      'V2_EQUIVALENCE_PATHS',jsonb_build_array('EXPLICIT_PRODUCT_FAMILY_ALTERNATIVE','OBSERVED_DERIVATIONAL_FAMILY_VARIANT'),
      'MINIMUM_COMPATIBLE_ITEMS',2,'MINIMUM_COVERAGE',0.25,'DICTIONARY_PROVES_DEMAND',false,
      'CLASSIFIER_UNCHANGED',true,'UNLICENSED_CROSS_NOUN_SUBSTITUTION','UNPROVEN'),
    'DEMAND_COUNTING_UNIT','UNIQUE_MARKETPLACE_ITEM_ID','ANCESTOR_SUPPORT_ADDED',false,
    'BLOCKERS',v_blockers,'LIMITATIONS',v_limits);
end;
$$;

revoke all on function public.keyword_observed_concept_span_v2_1(text,text,text,text[]),
  public.derive_product_research_keyword_intelligence_v2_1(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.keyword_observed_concept_span_v2_1(text,text,text,text[]),
  public.derive_product_research_keyword_intelligence_v2_1(jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function public.refresh_product_research_keyword_intelligence_v1(p_plan_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p public.marketplace_product_research_query_plans%rowtype; t jsonb; e jsonb; q jsonb;
  d jsonb; matched boolean; changed boolean;
begin
  select * into p from public.marketplace_product_research_query_plans where id=p_plan_id for update;
  if not found then raise exception 'RESEARCH_PLAN_NOT_FOUND'; end if;
  select assessment#>'{productTruth,fieldTruthV1}',
    supplier_product_id::text=p.source_luna_product_id::text
    and supplier_variant_id::text=p.subject_supplier_variant_id::text
    and candidate_key=p.source_candidate_key
    and exists(select 1 from jsonb_array_elements(assessment#>'{productTruth,fieldTruthV1,fields}') f
      where f->>'FIELD'='LUNA_PRODUCT_ID' and f->>'VALUE'=p.source_luna_product_id::text
        and f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN')
    and exists(select 1 from jsonb_array_elements(assessment#>'{productTruth,fieldTruthV1,fields}') f
      where f->>'FIELD'='LUNA_VARIANT_ID' and f->>'VALUE'=p.subject_supplier_variant_id::text
        and f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN')
    into t,matched from public.ebay_luna_opportunity_queue where id=p.source_opportunity_id;
  if p.status is distinct from 'COMPLETED' or p.research_intelligence_status is distinct from 'COMMERCIALLY_SUFFICIENT' then
    d:=public.derive_product_research_keyword_intelligence_v2_1(t,'[]','[]',
      jsonb_build_object('identityMatched',coalesce(matched,false),'researchComplete',false));
    changed:=p.keyword_intelligence_decision is distinct from d;
    if changed then update public.marketplace_product_research_query_plans
      set keyword_intelligence_decision=d where id=p.id; end if;
    return jsonb_build_object('PLAN_ID',p.id,'CHANGED',changed,'READY',false,'BLOCKERS',d->'BLOCKERS');
  end if;
  select coalesce(jsonb_agg(to_jsonb(v) order by v.item_id),'[]') into e
    from public.seller_os_product_research_canonical_evidence_v2 v
    where v.plan_id=p.id and v.marketplace_account_key=p.marketplace_account_key;
  select coalesce(jsonb_agg(jsonb_build_object('task_id',id,'query_hash',query_hash,
    'search_query',search_query,'query_intent',query_intent,'evidence_basis',evidence_basis,
    'strategy_version',strategy_version,'capture_batch_id',capture_batch_id) order by id),'[]') into q
    from public.marketplace_product_research_query_tasks where plan_id=p.id
      and marketplace_account_key=p.marketplace_account_key and strategy_version=p.intelligence_contract_version;
  d:=public.derive_product_research_keyword_intelligence_v2_1(t,e,q,jsonb_build_object(
    'identityMatched',coalesce(matched,false),'researchComplete',p.status='COMPLETED'
      and p.research_intelligence_status='COMMERCIALLY_SUFFICIENT'
      and (p.terminal_research_conclusion is null or p.terminal_research_conclusion='EVIDENCE_SUFFICIENT')));
  changed:=p.keyword_intelligence_decision is distinct from d;
  if changed then update public.marketplace_product_research_query_plans
    set keyword_intelligence_decision=d where id=p.id; end if;
  return jsonb_build_object('PLAN_ID',p.id,'CHANGED',changed,'READY',d->'KEYWORD_DECISION_READY',
    'INPUT_FINGERPRINT',d->'INPUT_FINGERPRINT','BLOCKERS',d->'BLOCKERS');
end;
$$;

create or replace function public.product_research_keyword_intelligence_trigger_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p record;
begin
  if tg_table_name='marketplace_product_research_query_plans' then
    if new.source_opportunity_id is not null then perform public.refresh_product_research_keyword_intelligence_v1(new.id); end if;
  elsif tg_table_name='ebay_luna_opportunity_queue' then
    if tg_op='UPDATE' and (new.assessment#>'{productTruth,fieldTruthV1}') is not distinct from
      (old.assessment#>'{productTruth,fieldTruthV1}') then return new; end if;
    for p in select id from public.marketplace_product_research_query_plans where source_opportunity_id=new.id order by id
    loop perform public.refresh_product_research_keyword_intelligence_v1(p.id); end loop;
  elsif tg_table_name='marketplace_product_research_query_tasks' then
    perform public.refresh_product_research_keyword_intelligence_v1(new.plan_id);
  else
    for p in select distinct plan_id from public.marketplace_product_research_query_tasks
      where capture_batch_id=new.capture_batch_id order by plan_id
    loop
      -- Reclassification writes observations in a loop. Invalidate cheaply here;
      -- the existing task's AFTER trigger recomputes once reclassification ends.
      -- Standalone receipt updates remain truthfully UNPROVEN until cohort refresh.
      update public.marketplace_product_research_query_plans set keyword_intelligence_decision=
        jsonb_build_object('DECISION_VERSION','PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1',
          'KEYWORD_INTELLIGENCE','UNPROVEN','KEYWORD_DECISION_READY',false,
          'PRIMARY_KEYWORD','UNPROVEN','TERMS','[]'::jsonb,
          'BLOCKERS',jsonb_build_array('RESEARCH_EVIDENCE_CHANGED_RECOMPUTE_REQUIRED'))
        where id=p.plan_id and keyword_intelligence_decision->>'KEYWORD_DECISION_READY'='true';
    end loop;
  end if;
  return new;
end;
$$;
