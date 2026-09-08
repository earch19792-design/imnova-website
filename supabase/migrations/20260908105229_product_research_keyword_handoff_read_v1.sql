-- Read-only handoff. No Keyword Intelligence derivation, refresh or writes.
create function public.read_product_research_keyword_handoff_v1(
 p_account_key text,p_product_id text,p_variant_id text,p_candidate_key text,
 p_opportunity_id uuid,p_plan_id uuid default null
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog,public,extensions as $$
declare p public.marketplace_product_research_query_plans%rowtype;
 t jsonb; d jsonb; q jsonb; items jsonb; binding jsonb; failures jsonb:='[]';
 n integer; raw_count integer; invalid_positive boolean; expected_input text; expected_version text;
 v_version constant text:='PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V2_1';
begin
 select count(*) into n from (select id from public.marketplace_product_research_query_plans
  where marketplace_account_key=p_account_key and source_opportunity_id=p_opportunity_id
   and source_luna_product_id=p_product_id and subject_supplier_variant_id=p_variant_id
   and source_candidate_key=p_candidate_key and (p_plan_id is null or id=p_plan_id)
  limit 2) bounded;
 if n<>1 then return jsonb_build_object('READ_CONTRACT_VERSION','PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1',
  'STATUS','UNAVAILABLE','BLOCKERS',jsonb_build_array(case when n=0 then 'KEYWORD_PLAN_BINDING_NOT_FOUND' else 'KEYWORD_PLAN_AMBIGUOUS' end)); end if;
 select * into p from public.marketplace_product_research_query_plans
  where marketplace_account_key=p_account_key and source_opportunity_id=p_opportunity_id
   and source_luna_product_id=p_product_id and subject_supplier_variant_id=p_variant_id
   and source_candidate_key=p_candidate_key and (p_plan_id is null or id=p_plan_id) limit 1;
 binding:=jsonb_build_object('ACCOUNT_KEY',p.marketplace_account_key,'PLAN_ID',p.id,
  'OPPORTUNITY_ID',p.source_opportunity_id,'PRODUCT_ID',p.source_luna_product_id,
  'VARIANT_ID',p.subject_supplier_variant_id,'CANDIDATE_KEY',p.source_candidate_key);
 d:=p.keyword_intelligence_decision;
 if octet_length(d::text)>1500000 then return jsonb_build_object(
  'READ_CONTRACT_VERSION','PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1','STATUS','BLOCKED',
  'BLOCKERS',jsonb_build_array('KEYWORD_DECISION_SIZE_BOUND_EXCEEDED')); end if;
 if d->>'DECISION_VERSION' is distinct from v_version then
  failures:=failures||'"KEYWORD_DECISION_VERSION_UNSUPPORTED"'::jsonb;
 else
  select assessment#>'{productTruth,fieldTruthV1}' into t from public.ebay_luna_opportunity_queue
   where id=p_opportunity_id and candidate_key=p_candidate_key
    and supplier_product_id::text=p_product_id and supplier_variant_id::text=p_variant_id;
  if t is null or not exists(select 1 from jsonb_array_elements(t->'fields') f
    where f->>'FIELD'='LUNA_PRODUCT_ID' and f->>'VALUE'=p_product_id and f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN')
   or not exists(select 1 from jsonb_array_elements(t->'fields') f
    where f->>'FIELD'='LUNA_VARIANT_ID' and f->>'VALUE'=p_variant_id and f->>'SEMANTIC_CLASS'='FACT' and f->>'EVIDENCE_STATUS'='PROVEN') then
   failures:=failures||'"KEYWORD_TRUTH_BINDING_INVALID"'::jsonb;
  end if;
  if p.status is distinct from 'COMPLETED' or p.research_intelligence_status is distinct from 'COMMERCIALLY_SUFFICIENT'
   or (p.terminal_research_conclusion is not null and p.terminal_research_conclusion<>'EVIDENCE_SUFFICIENT') then
   failures:=failures||'"KEYWORD_DECISION_STALE_RESEARCH_STATE"'::jsonb;
  end if;
  if exists(select 1 from jsonb_array_elements(t->'fields') f
   where nullif(f->>'FRESH_UNTIL','') is not null and (f->>'FRESH_UNTIL')::timestamptz<statement_timestamp()) then
   failures:=failures||'"KEYWORD_DECISION_STALE_TRUTH_EXPIRED"'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('task_id',id,'query_hash',query_hash,
   'search_query',search_query,'query_intent',query_intent,'evidence_basis',evidence_basis,
   'strategy_version',strategy_version,'capture_batch_id',capture_batch_id) order by id),'[]') into q
   from (select * from public.marketplace_product_research_query_tasks where plan_id=p.id
    and marketplace_account_key=p_account_key and strategy_version=p.intelligence_contract_version limit 101) bounded;
  if jsonb_array_length(q)>100 then failures:=failures||'"KEYWORD_QUERY_READ_BOUND_EXCEEDED"'::jsonb; end if;
  -- Compare the current evidence manifest with the stored input manifest.
  -- No term extraction, scoring, ranking, promotion or keyword recomputation.
  with raw as materialized (select * from public.seller_os_product_research_canonical_evidence_v2
    where plan_id=p.id and marketplace_account_key=p_account_key limit 501), grouped as (
   select item_id,max(source_bounded_title_evidence) title,max(confirmed_sold_quantity) sold,
    jsonb_agg(distinct to_jsonb(structural_classification)) classes,
    jsonb_agg(distinct jsonb_build_object('OBSERVATION_ID',source_observation_id,
      'CAPTURE_BATCH_ID',source_capture_batch_id,'DEDUPLICATION_KEY',source_evidence_deduplication_key,
      'SEMANTICS_VERSION',evidence_semantics_version)) receipts
    from raw group by item_id
  ) select coalesce(jsonb_agg(jsonb_build_object('ITEM_ID',item_id,'TITLE',title,
    'SOLD_QUANTITY',sold,'CLASSES',classes,'SOURCE_RECEIPTS',receipts,
    'QUERY_PROVENANCE',(select coalesce(jsonb_agg(distinct h order by h),'[]') from raw r
      cross join lateral jsonb_array_elements(r.query_provenance_hashes) h where r.item_id=g.item_id),
    'QUERY_INTENTS',(select coalesce(jsonb_agg(distinct h order by h),'[]') from raw r
      cross join lateral jsonb_array_elements(r.query_intents) h where r.item_id=g.item_id)
   ) order by item_id),'[]'),(select count(*) from raw),
   exists(select 1 from raw r join jsonb_array_elements(d->'CANONICAL_ITEMS') i
     on i->>'ITEM_ID'=r.item_id where i->>'POSITIVE'='true' and (
      r.structural_compatibility->>'entityCompatible' is distinct from 'true' or
      r.structural_compatibility->>'architectureCompatible' is distinct from 'true' or
      r.structural_compatibility->>'useCompatible' is distinct from 'true'))
   into items,raw_count,invalid_positive from grouped g;
  if raw_count>500 or invalid_positive or items is distinct from
    (select coalesce(jsonb_agg(i-'POSITIVE' order by i->>'ITEM_ID'),'[]') from jsonb_array_elements(d->'CANONICAL_ITEMS') i) then
   failures:=failures||'"KEYWORD_DECISION_STALE_EVIDENCE_MANIFEST"'::jsonb;
  end if;
  -- PostgreSQL jsonb canonical serialization is the certified fingerprint format.
  expected_input:='sha256:'||encode(digest(jsonb_build_array('PRODUCT_RESEARCH_KEYWORD_INTELLIGENCE_V1',t,
   d->'CANONICAL_ITEMS',(select jsonb_agg(x order by x::text) from jsonb_array_elements(q) x),
   jsonb_build_object('identityMatched',true,'researchComplete',true))::text,'sha256'),'hex');
  expected_version:='sha256:'||encode(digest(jsonb_build_array(v_version,expected_input)::text,'sha256'),'hex');
  if d->>'INPUT_AUTHORITY_FINGERPRINT' is distinct from expected_input then
   failures:=failures||'"KEYWORD_DECISION_STALE_INPUT_FINGERPRINT"'::jsonb;
  end if;
  if d->>'INPUT_FINGERPRINT' is distinct from expected_version then
   failures:=failures||'"KEYWORD_DECISION_FINGERPRINT_INVALID"'::jsonb;
  end if;
 end if;
 return jsonb_build_object('READ_CONTRACT_VERSION','PRODUCT_RESEARCH_KEYWORD_HANDOFF_READ_V1',
  'STATUS',case when jsonb_array_length(failures)>0 then 'BLOCKED'
    when d->>'KEYWORD_DECISION_READY'='true' and d->'BLOCKERS'='[]' then 'READY' else 'UNPROVEN' end,
  'BINDING',binding,'VALIDATION_BLOCKERS',failures,'BLOCKERS',failures||coalesce(d->'BLOCKERS','[]'),
  'VALIDATION',jsonb_build_object('CURRENT_INPUTS_MATCH',jsonb_array_length(failures)=0,
    'DECISION_DIGEST','sha256:'||encode(digest(d::text,'sha256'),'hex'),
    'FRESHNESS_BASIS','CURRENT_TRUTH_QUERY_AND_EVIDENCE_MANIFEST'),
  'DECISION_SERIALIZED',d::text,'KEYWORD_RECOMPUTATIONS',0,'DATABASE_WRITES',0);
end;
$$;
revoke all on function public.read_product_research_keyword_handoff_v1(text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_product_research_keyword_handoff_v1(text,text,text,text,uuid,uuid) to service_role;
