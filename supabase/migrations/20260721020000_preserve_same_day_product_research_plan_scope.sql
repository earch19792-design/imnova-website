-- Preserve the original Product Research plan when an out-of-stock candidate
-- is replaced inside the same Same-Day run. This is additive and performs no
-- marketplace writes, raw competitor persistence, or catalog rescans.

create or replace function public.create_product_research_query_plan_v2(
  p_plan_id uuid,
  p_marketplace_account_key text,
  p_run_id uuid,
  p_plan_version text,
  p_input_hash text,
  p_candidate_count integer,
  p_queries jsonb,
  p_supersede_existing boolean default true
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_query_count integer := jsonb_array_length(coalesce(p_queries, '[]'::jsonb));
  v_plan_id uuid;
begin
  if length(trim(p_marketplace_account_key)) < 3
    or p_input_hash !~ '^sha256:[0-9a-f]{64}$'
    or length(trim(p_plan_version)) < 3
    or p_candidate_count < 1
    or v_query_count < 1 or v_query_count > 15 then
    raise exception 'PRODUCT_RESEARCH_QUERY_PLAN_INPUT_INVALID';
  end if;

  if p_supersede_existing then
    update public.marketplace_product_research_query_plans
    set status = 'SUPERSEDED', updated_at = clock_timestamp()
    where marketplace_account_key = p_marketplace_account_key
      and marketplace = 'EBAY_US' and run_id = p_run_id and status = 'ACTIVE'
      and input_hash <> p_input_hash;
  end if;

  insert into public.marketplace_product_research_query_plans(
    id,marketplace_account_key,marketplace,run_id,plan_version,input_hash,status,
    query_count,candidate_count
  ) values (
    p_plan_id,p_marketplace_account_key,'EBAY_US',p_run_id,p_plan_version,p_input_hash,
    'ACTIVE',v_query_count,p_candidate_count
  )
  on conflict (marketplace_account_key,marketplace,input_hash) do update
    set updated_at = clock_timestamp()
  returning id into v_plan_id;

  insert into public.marketplace_product_research_query_tasks(
    plan_id,marketplace_account_key,marketplace,ordinal,search_query,query_hash,
    cluster_key_hash,category_id,candidate_count,candidate_variant_hashes
  )
  select v_plan_id,p_marketplace_account_key,'EBAY_US',row.ordinal,row.search_query,
    row.query_hash,row.cluster_key_hash,row.category_id,row.candidate_count,
    row.candidate_variant_hashes
  from jsonb_to_recordset(p_queries) as row(
    ordinal integer,
    search_query text,
    query_hash text,
    cluster_key_hash text,
    category_id text,
    candidate_count integer,
    candidate_variant_hashes text[]
  )
  on conflict (plan_id,query_hash) do nothing;

  return v_plan_id;
end;
$$;

revoke all on function public.create_product_research_query_plan_v2(
  uuid,text,uuid,text,text,integer,jsonb,boolean
) from public, anon, authenticated;
grant execute on function public.create_product_research_query_plan_v2(
  uuid,text,uuid,text,text,integer,jsonb,boolean
) to service_role;

-- Repair only the narrow legacy shape produced by the former replacement
-- path: the run still points to a superseded plan, an OOS candidate owns an
-- earlier pending query, and the current open gate owns the next query. The
-- current in-stock candidate is never skipped.
with broken_scope as (
  select
    run.id as same_day_run_id,
    run.marketplace_account_key,
    plan.id as plan_id
  from public.ebay_same_day_pilot_runs as run
  join public.marketplace_product_research_query_plans as plan
    on plan.id = case
      when run.source_inventory->>'productResearchPlanId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (run.source_inventory->>'productResearchPlanId')::uuid
      else null
    end
   and plan.marketplace_account_key = run.marketplace_account_key
   and plan.marketplace = 'EBAY_US'
  where run.marketplace = 'EBAY_US'
    and plan.status = 'SUPERSEDED'
    and exists (
      select 1
      from public.ebay_same_day_pilot_human_tasks as human_task
      where human_task.run_id = run.id
        and human_task.gate_type = 'PRODUCT_RESEARCH_CAPTURE_REQUIRED'
        and human_task.status = 'OPEN'
    )
), out_of_stock_query as (
  select distinct
    scope.plan_id,
    scope.marketplace_account_key,
    lower(trim(candidate.product_research_query_plan->>'query')) as normalized_query
  from broken_scope as scope
  join public.ebay_same_day_pilot_candidates as candidate
    on candidate.run_id = scope.same_day_run_id
   and candidate.machine_state = 'REJECTED'
   and 'LUNA_OUT_OF_STOCK' = any(candidate.blockers)
  where lower(trim(candidate.product_research_query_plan->>'query')) <> ''
), skipped as (
  update public.marketplace_product_research_query_tasks as query_task
  set status = 'SKIPPED',
      processed_at = coalesce(query_task.processed_at, clock_timestamp()),
      last_error_code = 'LUNA_OUT_OF_STOCK',
      updated_at = clock_timestamp()
  from out_of_stock_query as out_of_stock
  where query_task.plan_id = out_of_stock.plan_id
    and query_task.marketplace_account_key = out_of_stock.marketplace_account_key
    and query_task.marketplace = 'EBAY_US'
    and query_task.status = 'PENDING'
    and lower(trim(query_task.search_query)) = out_of_stock.normalized_query
  returning query_task.id as query_task_id, query_task.plan_id
), eligible_scope as (
  select distinct scope.same_day_run_id, scope.marketplace_account_key, scope.plan_id
  from broken_scope as scope
  join public.ebay_same_day_pilot_human_tasks as human_task
    on human_task.run_id = scope.same_day_run_id
   and human_task.gate_type = 'PRODUCT_RESEARCH_CAPTURE_REQUIRED'
   and human_task.status = 'OPEN'
  join public.ebay_same_day_pilot_candidates as current_candidate
    on current_candidate.id = human_task.candidate_id
   and current_candidate.run_id = scope.same_day_run_id
   and current_candidate.machine_state = 'WAITING_PRODUCT_RESEARCH_CAPTURE'
  join public.marketplace_product_research_query_tasks as current_query
    on current_query.plan_id = scope.plan_id
   and current_query.marketplace_account_key = scope.marketplace_account_key
   and current_query.marketplace = 'EBAY_US'
   and current_query.status = 'PENDING'
   and lower(trim(current_query.search_query)) =
     lower(trim(current_candidate.product_research_query_plan->>'query'))
  where not exists (
    select 1
    from public.marketplace_product_research_query_tasks as earlier_query
    where earlier_query.plan_id = current_query.plan_id
      and earlier_query.status = 'PENDING'
      and earlier_query.ordinal < current_query.ordinal
      and earlier_query.id not in (select skipped.query_task_id from skipped)
  )
), reactivated as (
  update public.marketplace_product_research_query_plans as plan
  set status = 'ACTIVE', completed_at = null, updated_at = clock_timestamp()
  from eligible_scope as scope
  where plan.id = scope.plan_id and plan.status = 'SUPERSEDED'
  returning scope.same_day_run_id, scope.marketplace_account_key, plan.id as plan_id
)
insert into public.ebay_same_day_pilot_events(
  run_id,event_type,event_payload,idempotency_key,
  ebay_read_calls,openai_calls,ebay_writes,production_changed
)
select
  repair.same_day_run_id,
  'PRODUCT_RESEARCH_PLAN_SCOPE_REPAIRED',
  jsonb_build_object(
    'planId', repair.plan_id,
    'reasonCode', 'PREVIOUS_OOS_REPLACEMENT_SUPERSEDED_ACTIVE_BATCH',
    'currentCandidatePreserved', true,
    'ebayWrites', 0
  ),
  repair.same_day_run_id::text || ':PRODUCT_RESEARCH_PLAN_SCOPE_REPAIRED:' ||
    repair.plan_id::text,
  0,0,0,false
from reactivated as repair
on conflict (idempotency_key) do nothing;

notify pgrst, 'reload schema';
