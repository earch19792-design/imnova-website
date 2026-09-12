-- A CURRENT revalidation can exhaust descriptor-heavy queries before it has
-- enough market evidence to judge the product-family head concept. Queue one
-- bounded Product Truth-derived head query; Keyword V2.1 remains the only
-- authority that can accept the resulting decision.

create or replace function public.ensure_current_keyword_head_concept_recovery_v1(
  p_account_key text,p_listing_package_id uuid,p_plan_id uuid
) returns jsonb
language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_reference public.marketplace_product_research_query_tasks%rowtype;
  v_decision jsonb;
  v_head jsonb;
  v_query text;
  v_query_hash text;
  v_cluster_hash text;
  v_existing public.marketplace_product_research_query_tasks%rowtype;
  v_task_id uuid;
  v_next_ordinal integer;
  v_observed_at timestamptz:=clock_timestamp();
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'CURRENT_KEYWORD_HEAD_RECOVERY_SERVICE_ROLE_REQUIRED';
  end if;
  select p.* into v_plan
  from public.marketplace_product_research_query_plans p
  join public.ebay_current_listing_packages_v1 k
    on k.id=p.current_listing_package_id
    and k.account_key=p.marketplace_account_key
  where p.id=p_plan_id and p.marketplace_account_key=p_account_key
    and p.current_listing_package_id=p_listing_package_id
    and p.source_context='QUICK_PICK_RESEARCH_REQUIRED'
  for update of p;
  if not found then
    raise exception 'CURRENT_KEYWORD_HEAD_RECOVERY_BINDING_INVALID';
  end if;

  if v_plan.keyword_intelligence_decision->>'KEYWORD_DECISION_READY'='true' then
    return jsonb_build_object('planId',v_plan.id,'state','CURRENT_READY',
      'taskCreated',false,'taskId',null,'searchQuery',null,
      'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0);
  end if;
  if exists(select 1 from public.marketplace_product_research_query_tasks t
      where t.plan_id=v_plan.id and t.status='PENDING')
      or (v_plan.worker_lease_expires_at is not null
        and v_plan.worker_lease_expires_at>v_observed_at) then
    return jsonb_build_object('planId',v_plan.id,
      'state','CURRENT_RESEARCH_ALREADY_PENDING','taskCreated',false,
      'taskId',null,'searchQuery',null,
      'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0);
  end if;

  v_decision:=public.derive_current_plan_keyword_candidate_v2_1(v_plan.id);
  if v_decision->>'KEYWORD_DECISION_READY'='true' then
    return jsonb_build_object('planId',v_plan.id,
      'state','CURRENT_CUMULATIVE_RECONCILIATION_REQUIRED',
      'taskCreated',false,'taskId',null,'searchQuery',null,
      'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0);
  end if;
  if not (coalesce(v_decision->'BLOCKERS','[]'::jsonb) ?
      'INSUFFICIENT_CURRENT_COMPATIBLE_SOLD_ITEMS') then
    return jsonb_build_object('planId',v_plan.id,
      'state','CURRENT_HEAD_RECOVERY_NOT_APPLICABLE','taskCreated',false,
      'taskId',null,'searchQuery',null,
      'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0);
  end if;

  select term into v_head
  from jsonb_array_elements(coalesce(v_decision->'TERMS','[]'::jsonb)) term
  where term->>'CONCEPT_TYPE'='HEAD_CONCEPT'
    and term#>>'{PRODUCT_TRUTH_SUPPORT,SUPPORTED}'='true'
    and term->>'TERM' is distinct from 'UNPROVEN'
  order by coalesce((term->>'RANK')::integer,2147483647)
  limit 1;
  v_query:=lower(regexp_replace(trim(coalesce(v_head->>'TERM','')),
    '[[:space:]]+',' ','g'));
  if char_length(v_query) not between 3 and 100
      or v_query !~ '[[:alpha:]]' then
    return jsonb_build_object('planId',v_plan.id,
      'state','CURRENT_HEAD_CONCEPT_UNPROVEN','taskCreated',false,
      'taskId',null,'searchQuery',null,
      'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0);
  end if;
  v_query_hash:='sha256:'||encode(digest(convert_to(v_query,'UTF8'),'sha256'),'hex');
  v_cluster_hash:='sha256:'||encode(digest(convert_to(
    'current-keyword-head:'||v_plan.id::text||':'||v_query,'UTF8'),
    'sha256'),'hex');

  select * into v_existing
  from public.marketplace_product_research_query_tasks t
  where t.plan_id=v_plan.id and t.query_hash=v_query_hash
  limit 1;
  if found then
    return jsonb_build_object('planId',v_plan.id,
      'state',case when v_existing.status='PENDING'
        then 'CURRENT_HEAD_RESEARCH_REUSED'
        else 'CURRENT_HEAD_RESEARCH_EXHAUSTED' end,
      'taskCreated',false,'taskId',v_existing.id,
      'searchQuery',v_existing.search_query,
      'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0);
  end if;

  select * into v_reference
  from public.marketplace_product_research_query_tasks t
  where t.plan_id=v_plan.id
    and t.strategy_version=v_plan.intelligence_contract_version
  order by t.ordinal limit 1;
  if not found then
    raise exception 'CURRENT_KEYWORD_HEAD_RECOVERY_REFERENCE_REQUIRED';
  end if;
  select coalesce(max(t.ordinal),0)+1 into v_next_ordinal
  from public.marketplace_product_research_query_tasks t
  where t.plan_id=v_plan.id;
  if v_next_ordinal>15 then
    raise exception 'CURRENT_KEYWORD_HEAD_RECOVERY_PLAN_BOUNDED';
  end if;

  v_task_id=gen_random_uuid();
  insert into public.marketplace_product_research_query_tasks(
    id,plan_id,marketplace_account_key,marketplace,ordinal,search_query,
    query_hash,cluster_key_hash,category_id,candidate_count,
    candidate_variant_hashes,status,query_intent,evidence_basis,
    strategy_version,created_at,updated_at)
  values(v_task_id,v_plan.id,p_account_key,'EBAY_US',v_next_ordinal,v_query,
    v_query_hash,v_cluster_hash,v_reference.category_id,
    v_reference.candidate_count,v_reference.candidate_variant_hashes,
    'PENDING','CORE_FAMILY_QUERY',jsonb_build_array(jsonb_build_object(
      'term',v_query,'sourceField','productTruth.fieldTruthV1',
      'selectionReason','V2_1_PRODUCT_TRUTH_HEAD_CONCEPT_RECOVERY',
      'sourceAuthority','LUNA_PRODUCT_TRUTH')),
    v_plan.intelligence_contract_version,v_observed_at,v_observed_at);
  update public.marketplace_product_research_query_plans p set
    status='ACTIVE',completed_at=null,terminal_research_conclusion=null,
    research_intelligence_status='RESEARCH_IN_PROGRESS',
    query_count=(select count(*) from public.marketplace_product_research_query_tasks t
      where t.plan_id=v_plan.id),
    worker_claim_count=0,worker_lease_owner=null,worker_lease_expires_at=null,
    worker_next_retry_at=v_observed_at,worker_last_release_code=null,
    worker_last_result=jsonb_build_object(
      'state','CURRENT_KEYWORD_HEAD_CONCEPT_RESEARCH_QUEUED',
      'taskId',v_task_id,'queryHash',v_query_hash,'marketplaceWrites',0),
    current_keyword_revalidation_history=
      p.current_keyword_revalidation_history||jsonb_build_array(
        jsonb_build_object(
          'contractVersion','CURRENT_KEYWORD_HEAD_CONCEPT_RECOVERY_V1',
          'truthFingerprint',p.current_keyword_truth_fingerprint,
          'taskId',v_task_id,'queryHash',v_query_hash,
          'observedAt',v_observed_at,'marketplaceWrites',0)),
    updated_at=v_observed_at
  where p.id=v_plan.id;

  return jsonb_build_object('planId',v_plan.id,
    'state','CURRENT_HEAD_RESEARCH_CREATED','taskCreated',true,
    'taskId',v_task_id,'searchQuery',v_query,
    'marketplaceWrites',0,'publicationWrites',0,'adsWrites',0);
end;
$$;

revoke all on function public.ensure_current_keyword_head_concept_recovery_v1(
  text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ensure_current_keyword_head_concept_recovery_v1(
  text,uuid,uuid) to service_role;

comment on function public.ensure_current_keyword_head_concept_recovery_v1(
  text,uuid,uuid) is 'Queues at most one Product Truth-derived CURRENT head-concept evidence query after descriptor-heavy bounded research is insufficient. It never accepts keywords or writes marketplace/publication/ads state.';

notify pgrst,'reload schema';
