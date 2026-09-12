-- Keep the complete accepted-term rationale and canonical evidence manifest,
-- but remove evidence copies repeated inside rejected terms. The rejected term,
-- classification, rank, reason, concept type and Product Truth support remain.

create or replace function public.compact_current_keyword_decision_v1(
  p_decision jsonb
) returns jsonb
language sql immutable parallel safe
set search_path=pg_catalog
as $$
  select case when p_decision is null then null else jsonb_set(
    p_decision,'{TERMS}',coalesce((select jsonb_agg(
      case when term->'WHY_REJECTED' is null or term->'WHY_REJECTED'='null'::jsonb
        then term
        else term-'SOURCE_RECEIPTS'-'ITEM_COVERAGE'-'MARKET_SUPPORT'
      end order by ordinal)
    from jsonb_array_elements(coalesce(p_decision->'TERMS','[]'::jsonb))
      with ordinality x(term,ordinal)),'[]'::jsonb),true) end;
$$;

create or replace function public.derive_current_plan_keyword_candidate_v2_1(
  p_plan_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_truth jsonb;
  v_evidence jsonb;
  v_queries jsonb;
  v_identity_matched boolean:=false;
begin
  if not public.is_seller_os_service_role_request_v1() or p_plan_id is null then
    raise exception 'CURRENT_KEYWORD_CUMULATIVE_CANDIDATE_INVALID';
  end if;
  select * into v_plan
  from public.marketplace_product_research_query_plans p
  where p.id=p_plan_id and p.source_context='QUICK_PICK_RESEARCH_REQUIRED';
  if not found then raise exception 'CURRENT_KEYWORD_CUMULATIVE_PLAN_NOT_FOUND'; end if;

  select q.assessment#>'{productTruth,fieldTruthV1}',
    q.supplier_product_id::text=v_plan.source_luna_product_id::text
      and q.supplier_variant_id::text=v_plan.subject_supplier_variant_id::text
      and q.candidate_key=v_plan.source_candidate_key
      and exists(select 1 from jsonb_array_elements(
        q.assessment#>'{productTruth,fieldTruthV1,fields}') f
        where f->>'FIELD'='LUNA_PRODUCT_ID'
          and f->>'VALUE'=v_plan.source_luna_product_id::text
          and f->>'SEMANTIC_CLASS'='FACT'
          and f->>'EVIDENCE_STATUS'='PROVEN')
      and exists(select 1 from jsonb_array_elements(
        q.assessment#>'{productTruth,fieldTruthV1,fields}') f
        where f->>'FIELD'='LUNA_VARIANT_ID'
          and f->>'VALUE'=v_plan.subject_supplier_variant_id::text
          and f->>'SEMANTIC_CLASS'='FACT'
          and f->>'EVIDENCE_STATUS'='PROVEN')
  into v_truth,v_identity_matched
  from public.ebay_luna_opportunity_queue q
  where q.id=v_plan.source_opportunity_id;

  select coalesce(jsonb_agg(to_jsonb(v) order by v.item_id),'[]'::jsonb)
  into v_evidence
  from public.seller_os_product_research_canonical_evidence_v2 v
  where v.plan_id=v_plan.id
    and v.marketplace_account_key=v_plan.marketplace_account_key;
  select coalesce(jsonb_agg(jsonb_build_object(
    'task_id',t.id,'query_hash',t.query_hash,'search_query',t.search_query,
    'query_intent',t.query_intent,'evidence_basis',t.evidence_basis,
    'strategy_version',t.strategy_version,
    'capture_batch_id',t.capture_batch_id) order by t.id),'[]'::jsonb)
  into v_queries
  from public.marketplace_product_research_query_tasks t
  where t.plan_id=v_plan.id
    and t.marketplace_account_key=v_plan.marketplace_account_key
    and t.strategy_version=v_plan.intelligence_contract_version
    and t.status in ('CAPTURED','PROCESSED');

  return public.compact_current_keyword_decision_v1(
    public.derive_product_research_keyword_intelligence_v2_1(
      v_truth,v_evidence,v_queries,jsonb_build_object(
        'identityMatched',coalesce(v_identity_matched,false),
        'researchComplete',true)));
end;
$$;

revoke all on function public.compact_current_keyword_decision_v1(jsonb),
  public.derive_current_plan_keyword_candidate_v2_1(uuid)
  from public,anon,authenticated;
grant execute on function public.compact_current_keyword_decision_v1(jsonb),
  public.derive_current_plan_keyword_candidate_v2_1(uuid)
  to service_role;

comment on function public.compact_current_keyword_decision_v1(jsonb) is
  'Losslessly preserves CURRENT Keyword authority and canonical evidence while removing redundant evidence copies from rejected terms.';

notify pgrst,'reload schema';
