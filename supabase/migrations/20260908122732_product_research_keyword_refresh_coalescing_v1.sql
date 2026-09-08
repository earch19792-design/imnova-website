-- Coalesce Product Research maintenance performed by one logical
-- create_or_reuse_quick_pick_product_research_plan_v2 call. The semantic
-- derivation functions and their durable outputs are intentionally unchanged.

create or replace function public.create_or_reuse_quick_pick_product_research_plan_v2(
  p_plan_id uuid,
  p_marketplace_account_key text,
  p_plan_version text,
  p_input_hash text,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_supplier_sku text,
  p_worker_capability_fresh boolean,
  p_observed_at timestamptz,
  p_queries jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_base jsonb;
  v_plan_id uuid;
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_base_ordinal integer := 0;
  v_inserted integer := 0;
  v_reopened boolean := false;
  v_state text;
  v_txid bigint := txid_current();
  v_context_inserted integer := 0;
  v_evidence_dirty boolean := false;
  v_keyword_dirty boolean := false;
begin
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_queries, '[]'::jsonb)) as q(
      query_intent text, evidence_basis jsonb, strategy_version text)
    where q.query_intent not in ('EXACT_PRODUCT_QUERY','CORE_FAMILY_QUERY',
      'SEMANTIC_EXPANSION_QUERY')
      or jsonb_typeof(coalesce(q.evidence_basis, '[]'::jsonb)) <> 'array'
      or char_length(trim(coalesce(q.strategy_version, ''))) < 8
  ) then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_QUERY_INTELLIGENCE_INVALID';
  end if;

  -- Session-private, transaction-bound state is not exposed as an RPC and
  -- cannot survive rollback. Exact account/candidate/plan binding prevents
  -- suppression from leaking to unrelated writes on the same backend.
  create temporary table if not exists seller_os_product_research_coalesce_v1(
    transaction_id bigint not null,
    account_key text not null,
    candidate_key text not null,
    requested_plan_id uuid not null,
    resolved_plan_id uuid null,
    evidence_dirty boolean not null default false,
    keyword_dirty boolean not null default false,
    primary key(transaction_id,account_key,candidate_key)
  ) on commit delete rows;

  insert into pg_temp.seller_os_product_research_coalesce_v1(
    transaction_id,account_key,candidate_key,requested_plan_id)
  values (v_txid,p_marketplace_account_key,p_candidate_key,p_plan_id)
  on conflict do nothing;
  get diagnostics v_context_inserted = row_count;
  if v_context_inserted <> 1 then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_COALESCE_REENTRY_DENIED';
  end if;

  v_base := public.create_or_reuse_quick_pick_product_research_plan_v1(
    p_plan_id,p_marketplace_account_key,p_plan_version,p_input_hash,
    p_opportunity_id,p_candidate_key,p_luna_product_id,p_luna_variant_id,
    p_supplier_sku,p_worker_capability_fresh,p_observed_at,p_queries);
  v_plan_id := (v_base ->> 'planId')::uuid;

  update pg_temp.seller_os_product_research_coalesce_v1
  set resolved_plan_id=v_plan_id
  where transaction_id=v_txid and account_key=p_marketplace_account_key
    and candidate_key=p_candidate_key and requested_plan_id=p_plan_id;
  if not found then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_COALESCE_CONTEXT_LOST';
  end if;

  select * into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.id = v_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
  for update;
  if not found then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_PLAN_SCOPE_INVALID';
  end if;

  -- UPDATE OF triggers fire even when assigned values are equal. Do not issue
  -- the statement unless at least one semantic input is materially different.
  update public.marketplace_product_research_query_tasks task
  set query_intent = q.query_intent,
      evidence_basis = q.evidence_basis,
      strategy_version = q.strategy_version,
      updated_at = greatest(task.updated_at, p_observed_at)
  from jsonb_to_recordset(p_queries) as q(
    ordinal integer, search_query text, query_hash text,
    cluster_key_hash text, category_id text, candidate_count integer,
    candidate_variant_hashes text[], query_intent text,
    evidence_basis jsonb, strategy_version text)
  where task.plan_id = v_plan_id and task.query_hash = q.query_hash
    and (task.query_intent,task.evidence_basis,task.strategy_version)
      is distinct from (q.query_intent,q.evidence_basis,q.strategy_version);

  select coalesce(max(ordinal), 0) into v_base_ordinal
  from public.marketplace_product_research_query_tasks where plan_id = v_plan_id;

  insert into public.marketplace_product_research_query_tasks(
    plan_id,marketplace_account_key,marketplace,ordinal,search_query,query_hash,
    cluster_key_hash,category_id,candidate_count,candidate_variant_hashes,
    query_intent,evidence_basis,strategy_version
  )
  select v_plan_id,p_marketplace_account_key,'EBAY_US',
    v_base_ordinal + row_number() over (order by q.ordinal),q.search_query,
    q.query_hash,q.cluster_key_hash,q.category_id,q.candidate_count,
    q.candidate_variant_hashes,q.query_intent,q.evidence_basis,q.strategy_version
  from jsonb_to_recordset(p_queries) as q(
    ordinal integer, search_query text, query_hash text,
    cluster_key_hash text, category_id text, candidate_count integer,
    candidate_variant_hashes text[], query_intent text,
    evidence_basis jsonb, strategy_version text)
  where not exists (
    select 1 from public.marketplace_product_research_query_tasks existing
    where existing.plan_id = v_plan_id and existing.query_hash = q.query_hash)
    and v_base_ordinal + q.ordinal <= 15
  on conflict (plan_id,query_hash) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    v_reopened := v_plan.status = 'COMPLETED';
    update public.marketplace_product_research_query_plans plan
    set status = 'ACTIVE', completed_at = null,
        plan_version = p_plan_version, input_hash = p_input_hash,
        query_count = (select count(*) from
          public.marketplace_product_research_query_tasks task
          where task.plan_id = v_plan_id),
        research_intelligence_status = 'RESEARCH_IN_PROGRESS',
        intelligence_contract_version = p_plan_version,
        worker_lease_owner = null, worker_lease_expires_at = null,
        worker_claim_count = 0, worker_next_retry_at = p_observed_at,
        worker_last_release_code = null,
        worker_last_result = jsonb_build_object(
          'state','RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT',
          'priorReceipt',v_plan.worker_last_result,
          'recoveryPolicy','BOUNDED_TYPED_QUERY_REFORMULATION',
          'observedAt',p_observed_at,'marketplaceWrites',0),
        updated_at = greatest(plan.updated_at,p_observed_at)
    where plan.id = v_plan_id;
  else
    -- Never name intelligence_contract_version in an UPDATE unless that
    -- trigger-observed value is materially different.
    update public.marketplace_product_research_query_plans plan
    set intelligence_contract_version = p_plan_version,
        updated_at = greatest(plan.updated_at,p_observed_at)
    where plan.id = v_plan_id
      and plan.intelligence_contract_version is distinct from p_plan_version;

    -- plan_version and timestamp are not observed by the Keyword Intelligence
    -- trigger. This statement therefore cannot manufacture a refresh when the
    -- intelligence contract itself is unchanged.
    update public.marketplace_product_research_query_plans plan
    set plan_version = p_plan_version,
        updated_at = greatest(plan.updated_at,p_observed_at)
    where plan.id = v_plan_id
      and (plan.plan_version is distinct from p_plan_version
        or plan.updated_at < p_observed_at);
  end if;

  select evidence_dirty,keyword_dirty into v_evidence_dirty,v_keyword_dirty
  from pg_temp.seller_os_product_research_coalesce_v1
  where transaction_id=v_txid and account_key=p_marketplace_account_key
    and candidate_key=p_candidate_key and resolved_plan_id=v_plan_id;
  if not found then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_COALESCE_CONTEXT_LOST';
  end if;

  if v_evidence_dirty then
    perform public.reclassify_product_research_evidence_semantics_v2(
      p_marketplace_account_key,v_plan_id);
  end if;

  -- Reclassification can mark Keyword Intelligence dirty through observation
  -- triggers. Read the final bit before ending suppression.
  select keyword_dirty into v_keyword_dirty
  from pg_temp.seller_os_product_research_coalesce_v1
  where transaction_id=v_txid and account_key=p_marketplace_account_key
    and candidate_key=p_candidate_key and resolved_plan_id=v_plan_id;

  delete from pg_temp.seller_os_product_research_coalesce_v1
  where transaction_id=v_txid and account_key=p_marketplace_account_key
    and candidate_key=p_candidate_key and resolved_plan_id=v_plan_id;
  if not found then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_COALESCE_CONTEXT_LOST';
  end if;

  if v_keyword_dirty then
    perform public.refresh_product_research_keyword_intelligence_v1(v_plan_id);
  end if;

  select case when status = 'COMPLETED' then 'COMPLETED'
    when p_worker_capability_fresh then 'CLAIMABLE'
    else 'WAITING_FOR_WORKER' end into v_state
  from public.marketplace_product_research_query_plans where id = v_plan_id;

  return v_base || jsonb_build_object(
    'planId',v_plan_id,'addedQueryCount',v_inserted,
    'planReopened',v_reopened,'researchState',v_state,
    'queryStrategyVersion',p_plan_version,'marketplaceWrites',0);
end;
$$;

create or replace function public.reclassify_product_research_task_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.strategy_version is not null
      and jsonb_array_length(new.commercial_evidence_entities)>0
      and to_regclass('pg_temp.seller_os_product_research_coalesce_v1') is not null then
    update pg_temp.seller_os_product_research_coalesce_v1 context
    set evidence_dirty=true,keyword_dirty=true
    where context.transaction_id=txid_current()
      and context.account_key=new.marketplace_account_key
      and context.resolved_plan_id=new.plan_id;
    if found then return new; end if;
  end if;
  if new.strategy_version is not null
      and jsonb_array_length(new.commercial_evidence_entities)>0 then
    perform public.reclassify_product_research_evidence_semantics_v2(
      new.marketplace_account_key,new.plan_id);
  end if;
  return new;
end;
$$;

create or replace function public.product_research_keyword_intelligence_trigger_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare p record;
begin
  if tg_table_name='marketplace_product_research_query_plans' then
    if to_regclass('pg_temp.seller_os_product_research_coalesce_v1') is not null then
      update pg_temp.seller_os_product_research_coalesce_v1 context
      set keyword_dirty=true
      where context.transaction_id=txid_current()
        and context.account_key=new.marketplace_account_key
        and (context.resolved_plan_id=new.id or
          (context.resolved_plan_id is null and
            (context.requested_plan_id=new.id or context.candidate_key=new.source_candidate_key)));
      if found then return new; end if;
    end if;
    if new.source_opportunity_id is not null then
      perform public.refresh_product_research_keyword_intelligence_v1(new.id);
    end if;
  elsif tg_table_name='ebay_luna_opportunity_queue' then
    if tg_op='UPDATE' and (new.assessment#>'{productTruth,fieldTruthV1}') is not distinct from
      (old.assessment#>'{productTruth,fieldTruthV1}') then return new; end if;
    for p in select id from public.marketplace_product_research_query_plans
      where source_opportunity_id=new.id order by id
    loop perform public.refresh_product_research_keyword_intelligence_v1(p.id); end loop;
  elsif tg_table_name='marketplace_product_research_query_tasks' then
    if to_regclass('pg_temp.seller_os_product_research_coalesce_v1') is not null then
      update pg_temp.seller_os_product_research_coalesce_v1 context
      set keyword_dirty=true
      from public.marketplace_product_research_query_plans plan
      where plan.id=new.plan_id and context.transaction_id=txid_current()
        and context.account_key=new.marketplace_account_key
        and (context.resolved_plan_id=new.plan_id or
          (context.resolved_plan_id is null and
            (context.requested_plan_id=new.plan_id or context.candidate_key=plan.source_candidate_key)));
      if found then return new; end if;
    end if;
    perform public.refresh_product_research_keyword_intelligence_v1(new.plan_id);
  else
    for p in select distinct plan_id from public.marketplace_product_research_query_tasks
      where capture_batch_id=new.capture_batch_id order by plan_id
    loop
      if to_regclass('pg_temp.seller_os_product_research_coalesce_v1') is not null then
        update pg_temp.seller_os_product_research_coalesce_v1 context
        set keyword_dirty=true
        where context.transaction_id=txid_current()
          and context.resolved_plan_id=p.plan_id;
        if found then continue; end if;
      end if;
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

-- Preserve the existing service-only execution boundary.
revoke all on function public.create_or_reuse_quick_pick_product_research_plan_v2(
  uuid,text,text,text,uuid,text,text,text,text,boolean,timestamptz,jsonb),
  public.reclassify_product_research_task_evidence_v1(),
  public.product_research_keyword_intelligence_trigger_v1()
  from public,anon,authenticated;
grant execute on function public.create_or_reuse_quick_pick_product_research_plan_v2(
  uuid,text,text,text,uuid,text,text,text,text,boolean,timestamptz,jsonb),
  public.reclassify_product_research_task_evidence_v1(),
  public.product_research_keyword_intelligence_trigger_v1()
  to service_role;

comment on function public.create_or_reuse_quick_pick_product_research_plan_v2(
  uuid,text,text,text,uuid,text,text,text,text,boolean,timestamptz,jsonb
) is 'Idempotent Product Research plan creation/reuse with transaction-private, exact-plan maintenance coalescing. External writes retain normal Evidence Semantics and Keyword Intelligence triggers.';
