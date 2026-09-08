set local lock_timeout='3s';
set local statement_timeout='45s';

-- Product-specific decision on the existing Research authority. No package,
-- opportunity status, reference, price, publication or marketplace writes.
alter table public.marketplace_product_research_query_plans
  add column keyword_intelligence_decision jsonb;

create function public.keyword_tokens_v1(p_text text) returns text[]
language sql immutable parallel safe set search_path=pg_catalog,public as $$
  select coalesce(array_agg(public.product_research_semantic_stem_v1(t) order by n),'{}')
  from regexp_split_to_table(lower(coalesce(p_text,'')), '[^a-z0-9.]+') with ordinality s(t,n)
  where t<>'';
$$;

create function public.keyword_phrase_v1(p_text text) returns text
language sql immutable parallel safe set search_path=pg_catalog,public as $$
  select array_to_string(public.keyword_tokens_v1(p_text),' ');
$$;

create function public.keyword_contains_v1(p_text text,p_term text) returns boolean
language sql immutable parallel safe set search_path=pg_catalog,public as $$
  select p_term<>'' and position(' '||p_term||' ' in ' '||public.keyword_phrase_v1(p_text)||' ')>0;
$$;

-- Pure derivation is also the regression-test boundary. Production callers use
-- refresh below, which obtains inputs itself; it accepts no keyword suggestions.
create function public.derive_product_research_keyword_intelligence_v1(
  p_truth jsonb,p_evidence jsonb,p_queries jsonb,p_prerequisites jsonb
) returns jsonb language plpgsql immutable parallel safe
set search_path=pg_catalog,public,extensions as $$
declare
  v_version constant text := 'PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V1';
  v_entity text;
  v_title text;
  v_support text;
  v_structural_title text;
  v_fields jsonb;
  v_items jsonb;
  v_terms jsonb;
  v_primary jsonb;
  v_ready boolean;
  v_blockers jsonb := '[]';
  v_fingerprint text;
  v_count integer;
  v_sold numeric;
  v_limits constant jsonb := '["SELLER_DIVERSITY_UNPROVEN","PRICE_BAND_UNPROVEN","OBSERVED_SOLD_QUANTITY_NOT_SEARCH_VOLUME","BOUNDED_RESEARCH_SAMPLE","LEXICAL_EQUIVALENCE_ONLY_NO_UNSUPPORTED_SYNONYMS"]';
begin
  if jsonb_typeof(p_truth->'fields') is distinct from 'array'
    or jsonb_typeof(p_evidence) is distinct from 'array'
    or jsonb_typeof(p_queries) is distinct from 'array' then
    return jsonb_build_object('DECISION_VERSION',v_version,'KEYWORD_INTELLIGENCE','UNPROVEN',
      'KEYWORD_DECISION_READY',false,'PRIMARY_KEYWORD','UNPROVEN','TERMS','[]'::jsonb,
      'BLOCKERS',jsonb_build_array('CANONICAL_INPUT_MISSING'),'LIMITATIONS',v_limits);
  end if;
  if jsonb_array_length(p_evidence)>1000 or jsonb_array_length(p_queries)>100
    or jsonb_array_length(p_truth->'fields')>100 then
    return jsonb_build_object('DECISION_VERSION',v_version,'KEYWORD_INTELLIGENCE','UNPROVEN',
      'KEYWORD_DECISION_READY',false,'PRIMARY_KEYWORD','UNPROVEN','TERMS','[]'::jsonb,
      'BLOCKERS',jsonb_build_array('BOUNDED_INPUT_LIMIT_EXCEEDED'),'LIMITATIONS',v_limits);
  end if;
  select coalesce(jsonb_agg(f order by f->>'FIELD'),'[]') into v_fields
  from jsonb_array_elements(p_truth->'fields') f
  where f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN'
    and f->'VALUE' is not null and f->'VALUE'<>'null'::jsonb
    and nullif(f->>'EVIDENCE_ID','') is not null
    and jsonb_typeof(f->'SOURCE_EVIDENCE')='array'
    and jsonb_array_length(f->'SOURCE_EVIDENCE')>0
    and coalesce((f->>'CONTRADICTION')::boolean,false)=false;
  select public.product_research_semantic_entity_v1(f->>'VALUE'),f->>'VALUE' into v_entity,v_title
    from jsonb_array_elements(v_fields) f where f->>'FIELD'='TITLE';
  select string_agg(f->>'VALUE',' ' order by f->>'FIELD') into v_support
    from jsonb_array_elements(v_fields) f where f->>'FIELD' in
      ('MATERIAL','FORM_FACTOR','SIZE_SET','QUANTITY_OR_SET_COUNT','INTENDED_USES','FEATURES');
  v_structural_title:=concat_ws(' ',(select f->>'VALUE' from jsonb_array_elements(v_fields) f
    where f->>'FIELD'='FORM_FACTOR'),v_title);
  if p_truth->>'contractVersion' is distinct from 'LUNA_FIELD_PRODUCT_TRUTH_V1'
    or v_entity is null or v_entity='' or p_prerequisites->>'identityMatched' is distinct from 'true' then
    v_blockers:=v_blockers||'"PRODUCT_TRUTH_IDENTITY_OR_ENTITY_UNPROVEN"'::jsonb;
  end if;
  if exists(select 1 from jsonb_array_elements(p_truth->'fields') f
    where f->>'SEMANTIC_CLASS'='CONTRADICTED' and f->>'FIELD' in
      ('TITLE','MATERIAL','FORM_FACTOR','QUANTITY_OR_SET_COUNT','LUNA_PRODUCT_ID','LUNA_VARIANT_ID')) then
    v_blockers:=v_blockers||'"DEFINING_PRODUCT_TRUTH_CONTRADICTED"'::jsonb;
  end if;
  if p_prerequisites->>'researchComplete' is distinct from 'true' then
    v_blockers:=v_blockers||'"RESEARCH_NOT_COMMERCIALLY_SUFFICIENT"'::jsonb;
  end if;
  -- Defensive second dedup. Conflicting current classifications/titles cannot
  -- gain positive weight. Query provenance is a union, sales are MAX per Item ID.
  with raw as (
    select e, e->>'item_id' id,
      coalesce(e->>'source_bounded_title_evidence',e->>'bounded_title_evidence','') title,
      coalesce((e->>'confirmed_sold_quantity')::numeric,0) sold,
      e->>'structural_classification' class,
      coalesce(e#>>'{structural_evidence,PRODUCT_ENTITY,target}','') entity,
      public.derive_product_research_evidence_semantics_v2(v_structural_title,v_support,
        coalesce(e->>'source_bounded_title_evidence',e->>'bounded_title_evidence',''),
        null,null,null,null,null,null,null,null,null)->>'classification' current_class
    from jsonb_array_elements(p_evidence) e
    where e->>'item_id' ~ '^[0-9]{9,20}$'
  ), grouped as (
    select id,max(title) title,max(sold) sold,
      count(distinct class)=1 and count(distinct title)=1
      and bool_and(coalesce(class in ('EXACT_PRODUCT_COMPARABLE','CLOSE_VARIANT_COMPARABLE','CORE_FAMILY_COMPARABLE')
        and e#>>'{structural_compatibility,entityCompatible}'='true'
        and e#>>'{structural_compatibility,architectureCompatible}'='true'
        and e#>>'{structural_compatibility,useCompatible}'='true'
        and current_class in ('EXACT_PRODUCT_COMPARABLE','CLOSE_VARIANT_COMPARABLE','CORE_FAMILY_COMPARABLE')
        and entity=v_entity and nullif(e->>'source_observation_id','') is not null
        and nullif(e->>'source_capture_batch_id','') is not null
        and e->>'evidence_semantics_version'='PRODUCT_RESEARCH_EVIDENCE_SEMANTICS_V2_2026_09_07',false)) eligible,
      jsonb_agg(distinct to_jsonb(class)) classes,
      jsonb_agg(distinct jsonb_build_object('OBSERVATION_ID',e->'source_observation_id',
        'CAPTURE_BATCH_ID',e->'source_capture_batch_id','DEDUPLICATION_KEY',e->'source_evidence_deduplication_key',
        'SEMANTICS_VERSION',e->'evidence_semantics_version')) receipts
    from raw group by id
  ) select coalesce(jsonb_agg(jsonb_build_object('ITEM_ID',g.id,'TITLE',g.title,
    'SOLD_QUANTITY',g.sold,'POSITIVE',g.eligible and g.sold>0,'CLASSES',g.classes,
    'SOURCE_RECEIPTS',g.receipts,
    'QUERY_PROVENANCE',(select coalesce(jsonb_agg(distinct h order by h),'[]')
      from raw r cross join lateral jsonb_array_elements(coalesce(r.e->'query_provenance_hashes','[]')) h where r.id=g.id),
    'QUERY_INTENTS',(select coalesce(jsonb_agg(distinct h order by h),'[]')
      from raw r cross join lateral jsonb_array_elements(coalesce(r.e->'query_intents','[]')) h where r.id=g.id)
    ) order by g.id),'[]') into v_items from grouped g;
  select count(*),coalesce(sum((i->>'SOLD_QUANTITY')::numeric),0) into v_count,v_sold
    from jsonb_array_elements(v_items) i where i->>'POSITIVE'='true';
  if v_count<2 then v_blockers:=v_blockers||'"INSUFFICIENT_CURRENT_COMPATIBLE_SOLD_ITEMS"'::jsonb; end if;
  if exists(select 1 from jsonb_array_elements(v_items) i where i->>'POSITIVE'='true'
    and not exists(select 1 from jsonb_array_elements(i->'QUERY_PROVENANCE') h
      join jsonb_array_elements(p_queries) q on q->'query_hash'=h)) then
    v_blockers:=v_blockers||'"QUERY_PROVENANCE_UNBOUND"'::jsonb;
  end if;
  -- Only explicit attribute fields confer qualifier truth. A TITLE proves the
  -- entity; other title words cannot prove brand, model, MPN or supplier claims.
  with fields as (select f from jsonb_array_elements(v_fields) f),
  values_expanded as (
    select f,case when jsonb_typeof(f->'VALUE')='array' then x
      else f->'VALUE' end val
    from fields cross join lateral jsonb_array_elements(case when jsonb_typeof(f->'VALUE')='array'
      then f->'VALUE' else jsonb_build_array(f->'VALUE') end) x
    where f->>'FIELD' in ('MATERIAL','COLOR','FORM_FACTOR','SIZE_SET','QUANTITY_OR_SET_COUNT',
      'INTENDED_USES','BRAND','MODEL','MPN','FEATURES','PACKAGE_CONTENTS')
  ), fact_terms as (
    select v_entity term,f,'ENTITY' kind from fields where f->>'FIELD'='TITLE'
    union all
    select case when f->>'FIELD'='QUANTITY_OR_SET_COUNT' then 'set of '||(val#>>'{}')
      when f->>'FIELD'='SIZE_SET' and jsonb_typeof(val)='object' then
        public.keyword_phrase_v1(concat_ws(' ',val->>'NORMALIZED_VALUE',val->>'UNIT'))
      when f->>'FIELD'='PACKAGE_CONTENTS' then public.product_research_semantic_entity_v1(val#>>'{}')
      else public.keyword_phrase_v1(val#>>'{}') end,f,
      case when f->>'FIELD'='PACKAGE_CONTENTS' then 'EXPANSION'
        when f->>'FIELD' in ('MATERIAL','FORM_FACTOR','SIZE_SET','QUANTITY_OR_SET_COUNT','FEATURES')
        then 'CORE' else 'SECONDARY' end
    from values_expanded where jsonb_typeof(val) in ('string','number') or f->>'FIELD'='SIZE_SET'
  ), candidates as (
    select term,f,kind from fact_terms where term is not null and term<>'' and length(term)<=100
    union all
    -- Buyer-language phrases already present in a proven structure/material;
    -- support still requires contiguous occurrence on compatible sold items.
    select public.keyword_phrase_v1(term||' '||v_entity),f,'ENTITY_PHRASE'
      from fact_terms where kind='CORE' and f->>'FIELD' in ('MATERIAL','FORM_FACTOR')
      and cardinality(public.keyword_tokens_v1(term))<=3
      and not public.keyword_contains_v1(term,v_entity)
    union all
    select t,null,'OBSERVED' from jsonb_array_elements(v_items) i
      cross join lateral unnest(public.keyword_tokens_v1(i->>'TITLE')) t
      where length(t)>2 and t !~ '^[0-9.]+' and t<>all(array['and','the','for','with','from','new','of','to','in','by'])
    union all
    select public.keyword_phrase_v1(x#>>'{}'),f,'CLAIM'
      from jsonb_array_elements(p_truth->'fields') f
      cross join lateral jsonb_array_elements(case when jsonb_typeof(f->'VALUE')='array'
        then f->'VALUE' else jsonb_build_array(f->'VALUE') end) x
      where f->>'SEMANTIC_CLASS'='SUPPLIER_CLAIM' and jsonb_typeof(x)='string'
  ), unique_terms as (
    select term,bool_or(kind='ENTITY') is_entity,bool_or(kind='ENTITY_PHRASE') entity_phrase,
      bool_or(kind='CORE') core,bool_or(kind='EXPANSION') expansion,
      bool_or(kind='CLAIM') claim,
      coalesce(jsonb_agg(distinct f) filter(where f is not null and kind<>'CLAIM'),'[]') truth,
      coalesce(jsonb_agg(distinct f) filter(where kind='CLAIM'),'[]') claims
    from candidates where term is not null and term<>'' group by term
  ), measured as (
    select u.*,m.*,
      (jsonb_array_length(u.truth)>0) fact_supported
    from unique_terms u cross join lateral (
      select count(*) filter(where i->>'POSITIVE'='true')::integer hits,
        coalesce(sum((i->>'SOLD_QUANTITY')::numeric) filter(where i->>'POSITIVE'='true'),0) sold,
        count(*) filter(where i->>'POSITIVE'<>'true')::integer negative_hits,
        coalesce(jsonb_agg(i->'ITEM_ID' order by i->>'ITEM_ID') filter(where i->>'POSITIVE'='true'),'[]') item_ids,
        coalesce(jsonb_agg(jsonb_build_object('ITEM_ID',i->'ITEM_ID','SOURCE_RECEIPTS',i->'SOURCE_RECEIPTS',
          'QUERY_PROVENANCE',i->'QUERY_PROVENANCE','QUERY_INTENTS',i->'QUERY_INTENTS',
          'POSITIVE',i->'POSITIVE') order by i->>'ITEM_ID'),'[]') sources
      from jsonb_array_elements(v_items) i
      where case when u.term like 'set of %' then
        public.product_research_semantic_count_v1(i->>'TITLE')::text=substring(u.term from 8)
        else public.keyword_contains_v1(i->>'TITLE',u.term) end
    ) m
  ), scored as (
    select *,round(100*(0.55*hits/greatest(v_count,1)::numeric
      +0.25*sold/greatest(v_sold,1)
      +case when entity_phrase then 0.20 when is_entity then 0.12 else 0 end
      -0.10*negative_hits/greatest(hits+negative_hits,1)::numeric),2) score,
      (fact_supported and expansion and not claim and term<>v_entity and hits>=2
        and hits::numeric/greatest(v_count,1)>=0.25
        and not exists(select 1 from jsonb_array_elements(p_truth->'fields') f
          where f->>'FIELD' in ('BRAND','MODEL','MPN','FEATURES')
            and public.keyword_contains_v1(f->>'VALUE',term))) expansion_supported
    from measured
  ), winner as (
    select term from scored where (is_entity or entity_phrase) and fact_supported and hits>=2
      and hits::numeric/greatest(v_count,1)>=0.5 and jsonb_array_length(v_blockers)=0
    order by score desc,entity_phrase desc,term limit 1
  ), classified as (
    select *,case
      when jsonb_array_length(v_blockers)>0 then 'REJECTED_TERMS'
      when claim and not fact_supported then 'REJECTED_TERMS'
      when hits=0 then 'REJECTED_TERMS'
      when term=(select term from winner) then 'PRIMARY_KEYWORD'
      when fact_supported and core and hits>=2 then 'CORE_QUALIFIERS'
      when expansion_supported then 'SEMANTIC_EXPANSIONS'
      when fact_supported then 'SECONDARY_KEYWORDS'
      else 'REJECTED_TERMS' end classification,
      case when jsonb_array_length(v_blockers)>0 then 'PREREQUISITES_UNPROVEN'
        when claim and not fact_supported then 'SUPPLIER_CLAIM_NOT_SAFE_FOR_KEYWORD_PROMOTION'
        when hits=0 and negative_hits>0 then 'STRUCTURALLY_INCOMPATIBLE_OR_ADJACENT_ONLY'
        when hits=0 then 'NO_MEANINGFUL_DEMAND_SUPPORT'
        when fact_supported and (is_entity or entity_phrase) then 'PROVEN_PRODUCT_ENTITY_AND_COMPATIBLE_SOLD_COVERAGE'
        when fact_supported and core and hits>=2 then 'EXPLICIT_PRODUCT_ATTRIBUTE_AND_REPEATED_COMPATIBLE_SOLD_SUPPORT'
        when expansion_supported then 'PROVEN_PACKAGE_ENTITY_ALTERNATIVE_WITH_COMPATIBLE_SOLD_SUPPORT'
        when fact_supported then 'PROVEN_ATTRIBUTE_WITH_SECONDARY_DEMAND_RELEVANCE'
        else 'PRODUCT_TRUTH_UNPROVEN_BRAND_MODEL_MPN_OR_AMBIGUOUS_BUYER_INTENT' end reason
    from scored
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'TERM',term,'CLASSIFICATION',classification,'RANK',rank,
    'MARKET_SUPPORT',jsonb_build_object('SUPPORTED',hits>0,'TERM_FREQUENCY',hits,
      'NEGATIVE_ITEM_COUNT',negative_hits,'NEGATIVE_POSITIVE_WEIGHT',0,'SCORE',score,
      'SCORE_COMPONENTS',jsonb_build_object('PRODUCT_ENTITY_MATCH',is_entity or entity_phrase,
        'FAMILY_RELEVANCE','CURRENT_STRUCTURALLY_COMPATIBLE_ONLY',
        'COMPARABLE_COVERAGE_WEIGHT',0.55,'SOLD_SUPPORT_WEIGHT',0.25,
        'BUYER_INTENT_SPECIFICITY_BONUS',case when entity_phrase then 20 when is_entity then 12 else 0 end,
        'AMBIGUITY_PENALTY',round(10*negative_hits/greatest(hits+negative_hits,1)::numeric,2))),
    'PRODUCT_TRUTH_SUPPORT',jsonb_build_object('SUPPORTED',fact_supported or expansion_supported,
      'BASIS',case when expansion_supported then 'CANONICAL_SAME_FAMILY_COREFERENCE' else 'EXPLICIT_FIELD_FACT' end,
      'FIELDS',truth,'CLAIMS_NOT_FACTS',claims),
    'COMPARABLE_ITEM_COUNT',hits,'COMPARABLE_COVERAGE',jsonb_build_object('MATCHED',hits,'TOTAL',v_count,
      'RATIO',round(hits::numeric/greatest(v_count,1),4),'ITEM_IDS',item_ids),
    'SOLD_EVIDENCE_SUPPORT',jsonb_build_object('CONFIRMED_QUANTITY',sold,'SUPPORTED',sold>0),
    'SOURCE_RECEIPTS',sources,'REASONING_BASIS',reason,'CLASSIFICATION_REASON',reason,
    'SEMANTIC_RELATIONSHIP',case when classification='SEMANTIC_EXPANSIONS' then 'SAME_FAMILY_COREFERENCE' else null end,
    'CONFIDENCE',case when classification='REJECTED_TERMS' then 'NOT_PROMOTED'
      when hits>=5 and hits::numeric/greatest(v_count,1)>=0.5 then 'MODERATE' else 'LIMITED' end,
    'LIMITATIONS',v_limits,'DECISION_VERSION',v_version) order by rank),'[]') into v_terms
  from (select *,row_number() over(order by case classification when 'PRIMARY_KEYWORD' then 1
    when 'CORE_QUALIFIERS' then 2 when 'SEMANTIC_EXPANSIONS' then 3 when 'SECONDARY_KEYWORDS' then 4 else 5 end,
    score desc,term) rank from classified) ranked;
  select t into v_primary from jsonb_array_elements(v_terms) t where t->>'CLASSIFICATION'='PRIMARY_KEYWORD';
  v_ready:=v_primary is not null and jsonb_array_length(v_blockers)=0;
  if not v_ready and jsonb_array_length(v_blockers)=0 then
    v_blockers:=v_blockers||'"PRIMARY_COMMERCIAL_CONCEPT_UNPROVEN"'::jsonb;
  end if;
  v_fingerprint:='sha256:'||encode(digest(jsonb_build_array(v_version,p_truth,v_items,
    (select jsonb_agg(q order by q::text) from jsonb_array_elements(p_queries) q),p_prerequisites)::text,'sha256'),'hex');
  return jsonb_build_object('DECISION_VERSION',v_version,'INPUT_FINGERPRINT',v_fingerprint,
    'KEYWORD_INTELLIGENCE',case when v_ready then 'READY' else 'UNPROVEN' end,
    'KEYWORD_DECISION_READY',v_ready,'PRIMARY_KEYWORD',coalesce(v_primary->>'TERM','UNPROVEN'),
    'KEYWORD_INTELLIGENCE_CONFIDENCE',case when v_ready then v_primary->>'CONFIDENCE' else 'UNPROVEN' end,
    'TERMS',v_terms,'CANONICAL_ITEMS',v_items,'QUERY_PROVENANCE',p_queries,
    'PRODUCT_TRUTH_SOURCE_RECEIPTS',p_truth->'sourceReceiptIds',
    'PRODUCT_TRUTH_FINGERPRINT',p_truth->'sourceFingerprint',
    'FIELD_PROMOTION_BLOCKERS',(select coalesce(jsonb_agg(jsonb_build_object('FIELD',f->>'FIELD',
      'REASON',case when f->>'SEMANTIC_CLASS'='SUPPLIER_CLAIM' then 'SUPPLIER_CLAIM_NOT_SAFE_FOR_KEYWORD_PROMOTION'
        else f->>'FIELD'||'_UNPROVEN' end) order by f->>'FIELD'),'[]')
      from jsonb_array_elements(p_truth->'fields') f where f->>'FIELD' in ('BRAND','MODEL','MPN','FEATURES')
        and (f->>'SEMANTIC_CLASS'<>'FACT' or f->>'EVIDENCE_STATUS'<>'PROVEN')),
    'COMPARABLE_ITEM_COUNT',v_count,'SOLD_EVIDENCE_QUANTITY',v_sold,
    'SELLER_DIVERSITY',jsonb_build_object('STATUS','UNPROVEN','VALUE',null),
    'PRICE_BAND',jsonb_build_object('STATUS','UNPROVEN','VALUE',null),
    'BLOCKERS',v_blockers,'LIMITATIONS',v_limits,'DOWNSTREAM_ADVANCEMENTS',0);
end;
$$;

create function public.refresh_product_research_keyword_intelligence_v1(p_plan_id uuid)
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
    d:=public.derive_product_research_keyword_intelligence_v1(t,'[]','[]',
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
  d:=public.derive_product_research_keyword_intelligence_v1(t,e,q,jsonb_build_object(
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

create function public.recover_product_research_keyword_intelligence_v1(p_after_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p record; results jsonb:='[]'; last_id uuid;
begin
  if p_limit<1 or p_limit>100 then raise exception 'KEYWORD_COHORT_LIMIT_INVALID'; end if;
  for p in select id from public.marketplace_product_research_query_plans
    where source_opportunity_id is not null and status='COMPLETED'
      and research_intelligence_status='COMMERCIALLY_SUFFICIENT'
      and (p_after_id is null or id>p_after_id) order by id limit p_limit
  loop
    results:=results||jsonb_build_array(public.refresh_product_research_keyword_intelligence_v1(p.id));
    last_id:=p.id;
  end loop;
  return jsonb_build_object('RESULTS',results,'PROCESSED_COUNT',jsonb_array_length(results),
    'NEXT_AFTER_ID',last_id);
end;
$$;

create function public.product_research_keyword_intelligence_trigger_v1()
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
        jsonb_build_object('DECISION_VERSION','PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V1',
          'KEYWORD_INTELLIGENCE','UNPROVEN','KEYWORD_DECISION_READY',false,
          'PRIMARY_KEYWORD','UNPROVEN','TERMS','[]'::jsonb,
          'BLOCKERS',jsonb_build_array('RESEARCH_EVIDENCE_CHANGED_RECOMPUTE_REQUIRED'))
        where id=p.plan_id and keyword_intelligence_decision->>'KEYWORD_DECISION_READY'='true';
    end loop;
  end if;
  return new;
end;
$$;

create trigger zz_product_research_keyword_plan_v1 after insert or update of status,
  research_intelligence_status,terminal_research_conclusion,source_opportunity_id,intelligence_contract_version,
  source_luna_product_id,subject_supplier_variant_id,source_candidate_key,marketplace_account_key
  on public.marketplace_product_research_query_plans for each row
  execute function public.product_research_keyword_intelligence_trigger_v1();
create trigger zz_product_research_keyword_truth_v1 after insert or update of assessment
  on public.ebay_luna_opportunity_queue for each row
  execute function public.product_research_keyword_intelligence_trigger_v1();
create trigger zz_product_research_keyword_task_v1 after insert or update of commercial_evidence_entities,
  quality_status,query_hash,query_intent,evidence_basis,capture_batch_id,strategy_version
  on public.marketplace_product_research_query_tasks for each row
  execute function public.product_research_keyword_intelligence_trigger_v1();
create trigger zz_product_research_keyword_semantics_v1 after update of evidence_semantics_versions
  on public.marketplace_product_research_capture_observations for each row
  when (old.evidence_semantics_versions is distinct from new.evidence_semantics_versions)
  execute function public.product_research_keyword_intelligence_trigger_v1();

revoke all on function public.keyword_tokens_v1(text),public.keyword_phrase_v1(text),
  public.keyword_contains_v1(text,text),
  public.derive_product_research_keyword_intelligence_v1(jsonb,jsonb,jsonb,jsonb),
  public.refresh_product_research_keyword_intelligence_v1(uuid),
  public.recover_product_research_keyword_intelligence_v1(uuid,integer),
  public.product_research_keyword_intelligence_trigger_v1() from public,anon,authenticated;
grant execute on function public.keyword_tokens_v1(text),public.keyword_phrase_v1(text),
  public.keyword_contains_v1(text,text),
  public.derive_product_research_keyword_intelligence_v1(jsonb,jsonb,jsonb,jsonb),
  public.refresh_product_research_keyword_intelligence_v1(uuid),
  public.recover_product_research_keyword_intelligence_v1(uuid,integer),
  public.product_research_keyword_intelligence_trigger_v1() to service_role;

comment on column public.marketplace_product_research_query_plans.keyword_intelligence_decision is
  'Versioned deterministic keyword decision from current canonical Truth and deduplicated Research. No title generation or downstream advancement. Rebuild with recover_product_research_keyword_intelligence_v1.';
