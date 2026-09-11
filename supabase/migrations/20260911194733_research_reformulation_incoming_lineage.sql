-- CURRENT bounded research continuation; preserves incoming lineage and all prior limits.
create or replace function public.persist_product_research_adaptive_decision_v1(
  p_marketplace_account_key text,
  p_plan_id uuid,
  p_parent_task_id uuid,
  p_decision_id uuid,
  p_decision jsonb,
  p_reformulation_ordinal integer,
  p_query_intent text,
  p_search_query text,
  p_query_hash text,
  p_cluster_key_hash text,
  p_category_id text,
  p_candidate_count integer,
  p_candidate_variant_hashes text[],
  p_evidence_basis jsonb,
  p_strategy_version text,
  p_terminal_conclusion text,
  p_observed_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_parent public.marketplace_product_research_query_tasks%rowtype;
  v_existing public.marketplace_product_research_query_tasks%rowtype;
  v_task_id uuid;
  v_next_ordinal integer;
  v_incoming_decision boolean;
  v_recorded_decision jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(trim(coalesce(p_marketplace_account_key, ''))) not between 8 and 160
      or p_plan_id is null or p_parent_task_id is null or p_decision_id is null
      or jsonb_typeof(coalesce(p_decision, 'null'::jsonb)) <> 'object'
      or octet_length(p_decision::text) > 20000
      or p_reformulation_ordinal not between 1 and 5
      or char_length(trim(coalesce(p_strategy_version, ''))) < 8
      or p_observed_at is null
      or p_observed_at > clock_timestamp() + interval '1 minute'
      or jsonb_typeof(coalesce(p_evidence_basis, '[]'::jsonb)) <> 'array'
      or octet_length(coalesce(p_evidence_basis, '[]'::jsonb)::text) > 12000 then
    raise exception 'PRODUCT_RESEARCH_REFORMULATION_DECISION_INVALID';
  end if;

  if p_terminal_conclusion is null then
    if p_query_intent not in (
        'REFORMULATED_CORE_FAMILY_QUERY','SEMANTIC_EXPANSION_QUERY')
        or char_length(trim(coalesce(p_search_query, ''))) not between 3 and 100
        or coalesce(p_query_hash, '') !~ '^sha256:[0-9a-f]{64}$'
        or coalesce(p_cluster_key_hash, '') !~ '^sha256:[0-9a-f]{64}$'
        or coalesce(p_candidate_count, 0) < 1
        or cardinality(coalesce(p_candidate_variant_hashes, '{}'::text[]))
          <> p_candidate_count then
      raise exception 'PRODUCT_RESEARCH_REFORMULATION_TASK_INVALID';
    end if;
  elsif p_terminal_conclusion not in (
      'DEMAND_REMAINS_UNPROVEN_AFTER_BOUNDED_RESEARCH',
      'RECOVERY_POLICY_EXHAUSTED')
      or p_query_intent is not null or p_search_query is not null
      or p_query_hash is not null or p_cluster_key_hash is not null then
    raise exception 'PRODUCT_RESEARCH_REFORMULATION_TERMINAL_INVALID';
  end if;

  select * into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.id = p_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
  for update;
  if not found then
    raise exception 'PRODUCT_RESEARCH_REFORMULATION_PLAN_SCOPE_INVALID';
  end if;

  select * into v_parent
  from public.marketplace_product_research_query_tasks task
  where task.id = p_parent_task_id and task.plan_id = p_plan_id
    and task.marketplace_account_key = p_marketplace_account_key
    and task.marketplace = 'EBAY_US'
    and task.strategy_version = p_strategy_version
    and task.status in ('CAPTURED','PROCESSED')
    and task.quality_status = 'LOW_PRECISION_REFORMULATION_REQUIRED'
  for update;
  if not found then
    raise exception 'PRODUCT_RESEARCH_REFORMULATION_PARENT_INVALID';
  end if;

  select * into v_existing
  from public.marketplace_product_research_query_tasks task
  where task.plan_id = p_plan_id
    and task.reformulation_parent_task_id = p_parent_task_id
  limit 1;
  if found then
    if v_plan.status <> 'ACTIVE' then
      update public.marketplace_product_research_query_plans plan
      set status = 'ACTIVE', completed_at = null,
          terminal_research_conclusion = null,
          research_intelligence_status = 'RESEARCH_IN_PROGRESS',
          worker_next_retry_at = least(coalesce(plan.worker_next_retry_at,
            p_observed_at), p_observed_at),
          updated_at = greatest(plan.updated_at, p_observed_at)
      where plan.id = p_plan_id;
    end if;
    return jsonb_build_object(
      'state','REFORMULATION_REUSED','planId',p_plan_id,
      'decisionId',v_existing.reformulation_decision_id,
      'taskId',v_existing.id,'taskCreated',false,
      'queryIntent',v_existing.query_intent,
      'searchQuery',v_existing.search_query,
      'terminalConclusion',null,'marketplaceWrites',0);
  end if;

  -- A child carries the decision that created it. That incoming lineage is
  -- not evidence that the child's own bounded continuation was performed.
  -- Unknown/contradictory markers retain the existing fail-closed behavior.
  v_incoming_decision := coalesce(
    v_parent.reformulation_parent_task_id is not null
    and v_parent.reformulation_decision->>'parentTaskId' = v_parent.reformulation_parent_task_id::text
    and exists (
      select 1 from public.marketplace_product_research_query_tasks origin
      where origin.id = v_parent.reformulation_parent_task_id
        and origin.plan_id = p_plan_id
        and origin.marketplace_account_key = p_marketplace_account_key
        and origin.marketplace = 'EBAY_US'
        and origin.reformulation_decision_id = v_parent.reformulation_decision_id
        and origin.reformulation_decision->>'parentTaskId' = origin.id::text
        and origin.reformulation_decision->>'outcome' = 'CREATE_TASK'
    ), false);
  v_recorded_decision := p_decision || case when v_incoming_decision
    then jsonb_build_object('priorIncomingDecision', v_parent.reformulation_decision)
    else '{}'::jsonb end;

  if v_parent.reformulation_decision_id is not null and not v_incoming_decision then
    return jsonb_build_object(
      'state','TERMINAL_UNPROVEN','planId',p_plan_id,
      'decisionId',v_parent.reformulation_decision_id,
      'taskId',null,'taskCreated',false,'queryIntent',null,
      'searchQuery',null,
      'terminalConclusion',v_plan.terminal_research_conclusion,
      'marketplaceWrites',0);
  end if;

  if p_reformulation_ordinal <> v_plan.reformulation_attempt_count + 1 then
    raise exception 'PRODUCT_RESEARCH_REFORMULATION_ORDINAL_INVALID';
  end if;

  if p_terminal_conclusion is null then
    if v_plan.reformulation_attempt_count >= v_plan.max_reformulation_attempts then
      raise exception 'PRODUCT_RESEARCH_REFORMULATION_ATTEMPTS_EXHAUSTED';
    end if;
    if exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = p_plan_id and task.status = 'PENDING'
    ) then
      raise exception 'PRODUCT_RESEARCH_REFORMULATION_PENDING_TASK_EXISTS';
    end if;
    if exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = p_plan_id and task.query_hash = p_query_hash
    ) then
      raise exception 'PRODUCT_RESEARCH_REFORMULATION_QUERY_DUPLICATE';
    end if;
    select coalesce(max(task.ordinal), 0) + 1 into v_next_ordinal
    from public.marketplace_product_research_query_tasks task
    where task.plan_id = p_plan_id;
    if v_next_ordinal > 15 then
      raise exception 'PRODUCT_RESEARCH_REFORMULATION_PLAN_BOUNDED';
    end if;
    v_task_id := gen_random_uuid();
    update public.marketplace_product_research_query_tasks task
    set reformulation_decision_id = p_decision_id,
        reformulation_decision = v_recorded_decision,
        reformulation_decided_at = p_observed_at,
        updated_at = greatest(task.updated_at, p_observed_at)
    where task.id = p_parent_task_id;
    insert into public.marketplace_product_research_query_tasks(
      id,plan_id,marketplace_account_key,marketplace,ordinal,search_query,
      query_hash,cluster_key_hash,category_id,candidate_count,
      candidate_variant_hashes,status,query_intent,evidence_basis,
      strategy_version,reformulation_parent_task_id,
      reformulation_decision_id,reformulation_ordinal,
      reformulation_decision,reformulation_decided_at,created_at,updated_at
    ) values (
      v_task_id,p_plan_id,p_marketplace_account_key,'EBAY_US',v_next_ordinal,
      p_search_query,p_query_hash,p_cluster_key_hash,p_category_id,
      p_candidate_count,p_candidate_variant_hashes,'PENDING',p_query_intent,
      p_evidence_basis,p_strategy_version,p_parent_task_id,p_decision_id,
      p_reformulation_ordinal,p_decision,p_observed_at,p_observed_at,p_observed_at
    );
    update public.marketplace_product_research_query_plans plan
    set status = 'ACTIVE', completed_at = null,
        query_count = (select count(*) from
          public.marketplace_product_research_query_tasks task
          where task.plan_id = p_plan_id),
        reformulation_attempt_count = p_reformulation_ordinal,
        terminal_research_conclusion = null,
        research_intelligence_status = 'RESEARCH_IN_PROGRESS',
        worker_next_retry_at = least(coalesce(plan.worker_next_retry_at,
          p_observed_at), p_observed_at),
        worker_last_release_code = null,
        worker_last_result = jsonb_build_object(
          'state','REFORMULATION_TASK_CREATED',
          'decisionId',p_decision_id,'taskId',v_task_id,
          'parentTaskId',p_parent_task_id,
          'reformulationOrdinal',p_reformulation_ordinal,
          'queryIntent',p_query_intent,'observedAt',p_observed_at,
          'retrySafety','SAFE_IDEMPOTENT_RUNTIME_RESUME',
          'marketplaceWrites',0),
        updated_at = greatest(plan.updated_at, p_observed_at)
    where plan.id = p_plan_id;
    return jsonb_build_object(
      'state','REFORMULATION_TASK_CREATED','planId',p_plan_id,
      'decisionId',p_decision_id,'taskId',v_task_id,'taskCreated',true,
      'queryIntent',p_query_intent,'searchQuery',p_search_query,
      'terminalConclusion',null,'marketplaceWrites',0);
  end if;

  update public.marketplace_product_research_query_tasks task
  set reformulation_decision_id = p_decision_id,
      reformulation_decision = v_recorded_decision,
      reformulation_decided_at = p_observed_at,
      updated_at = greatest(task.updated_at, p_observed_at)
  where task.id = p_parent_task_id;
  update public.marketplace_product_research_query_plans plan
  set status = 'COMPLETED', completed_at = p_observed_at,
      reformulation_attempt_count = least(p_reformulation_ordinal,
        plan.max_reformulation_attempts),
      terminal_research_conclusion = p_terminal_conclusion,
      research_intelligence_status =
        'RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT',
      worker_next_retry_at = null,
      worker_last_result = jsonb_build_object(
        'state','BOUNDED_RESEARCH_TERMINAL_UNPROVEN',
        'decisionId',p_decision_id,'parentTaskId',p_parent_task_id,
        'terminalConclusion',p_terminal_conclusion,
        'observedAt',p_observed_at,'marketplaceWrites',0),
      updated_at = greatest(plan.updated_at, p_observed_at)
  where plan.id = p_plan_id;
  return jsonb_build_object(
    'state','TERMINAL_UNPROVEN','planId',p_plan_id,
    'decisionId',p_decision_id,'taskId',null,'taskCreated',false,
    'queryIntent',null,'searchQuery',null,
    'terminalConclusion',p_terminal_conclusion,'marketplaceWrites',0);
end;
$$;

revoke all on function public.persist_product_research_adaptive_decision_v1(
  text,uuid,uuid,uuid,jsonb,integer,text,text,text,text,text,integer,text[],
  jsonb,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.persist_product_research_adaptive_decision_v1(
  text,uuid,uuid,uuid,jsonb,integer,text,text,text,text,text,integer,text[],
  jsonb,text,text,timestamptz
) to service_role;


notify pgrst, 'reload schema';
