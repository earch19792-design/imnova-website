-- A prior sufficient task cannot override a newer explicit non-terminal
-- quality result. The terminal decision follows the latest settled task.

create or replace function public.complete_quick_pick_product_research_claim_v1(
  p_marketplace_account_key text,
  p_plan_id uuid,
  p_worker_id text,
  p_capture_batch_id uuid,
  p_completed_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_pending boolean;
  v_latest_quality text;
  v_state text;
  v_intelligence_status text;
  v_terminal text;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key, '')) not between 8 and 160
      or p_plan_id is null
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_capture_batch_id is null or p_completed_at is null
      or p_completed_at > clock_timestamp() + interval '1 minute' then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_COMPLETION_INVALID';
  end if;
  select * into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.id = p_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
    and plan.worker_lease_owner = p_worker_id
    and plan.worker_lease_expires_at > clock_timestamp()
  for update;
  if not found or not exists (
    select 1 from public.marketplace_product_research_query_tasks task
    where task.plan_id = p_plan_id
      and task.capture_batch_id = p_capture_batch_id
      and task.status in ('CAPTURED','PROCESSED')
  ) then return false; end if;

  select exists (
    select 1 from public.marketplace_product_research_query_tasks task
    where task.plan_id = p_plan_id and task.status = 'PENDING'
  ) into v_pending;
  select task.quality_status into v_latest_quality
  from public.marketplace_product_research_query_tasks task
  where task.plan_id = p_plan_id
    and task.strategy_version = v_plan.intelligence_contract_version
    and task.status in ('CAPTURED','PROCESSED')
  order by task.ordinal desc limit 1;

  if v_pending then
    v_state := 'QUERY_RECEIPT_CREATED';
    v_intelligence_status := 'RESEARCH_IN_PROGRESS';
    v_terminal := null;
  elsif v_plan.terminal_research_conclusion is not null then
    v_state := 'RESEARCH_RECEIPT_CREATED';
    v_intelligence_status := case
      when v_plan.terminal_research_conclusion = 'EVIDENCE_SUFFICIENT'
        then 'COMMERCIALLY_SUFFICIENT'
      else 'RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT'
    end;
    v_terminal := v_plan.terminal_research_conclusion;
  elsif v_latest_quality = 'COMMERCIALLY_SUFFICIENT' then
    v_state := 'RESEARCH_RECEIPT_CREATED';
    v_intelligence_status := 'COMMERCIALLY_SUFFICIENT';
    v_terminal := 'EVIDENCE_SUFFICIENT';
  elsif v_latest_quality = 'NO_EVIDENCE_UNPROVEN' then
    v_state := 'RESEARCH_RECEIPT_CREATED';
    v_intelligence_status :=
      'RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT';
    v_terminal := 'NO_EVIDENCE_AFTER_BOUNDED_ATTEMPTS';
  elsif v_latest_quality = 'LOW_PRECISION_REFORMULATION_REQUIRED'
      and v_plan.reformulation_attempt_count >=
        v_plan.max_reformulation_attempts then
    v_state := 'RESEARCH_RECEIPT_CREATED';
    v_intelligence_status :=
      'RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT';
    v_terminal := 'DEMAND_REMAINS_UNPROVEN_AFTER_BOUNDED_RESEARCH';
  else
    v_state := 'REFORMULATION_DECISION_REQUIRED';
    v_intelligence_status := 'RESEARCH_IN_PROGRESS';
    v_terminal := null;
  end if;

  update public.marketplace_product_research_query_plans plan
  set status = case when v_pending or v_terminal is null
        then 'ACTIVE' else 'COMPLETED' end,
      completed_at = case when v_pending or v_terminal is null
        then null else p_completed_at end,
      terminal_research_conclusion = v_terminal,
      worker_lease_owner = null, worker_lease_expires_at = null,
      worker_next_retry_at = case when v_pending or v_terminal is null
        then p_completed_at else null end,
      worker_last_release_code = null,
      research_intelligence_status = v_intelligence_status,
      worker_last_result = jsonb_build_object(
        'state',v_state,'captureBatchId',p_capture_batch_id,
        'completedAt',p_completed_at,
        'intelligenceStatus',v_intelligence_status,
        'terminalConclusion',v_terminal,
        'latestQualityStatus',v_latest_quality,
        'retrySafety',case when v_pending or v_terminal is null
          then 'SAFE_IDEMPOTENT_RUNTIME_RESUME' else 'NOT_APPLICABLE' end,
        'marketplaceWrites',0),
      updated_at = greatest(plan.updated_at,p_completed_at)
  where plan.id = p_plan_id;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.complete_quick_pick_product_research_claim_v1(
  text,uuid,text,uuid,timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_quick_pick_product_research_claim_v1(
  text,uuid,text,uuid,timestamptz
) to service_role;

comment on function public.complete_quick_pick_product_research_claim_v1(
  text,uuid,text,uuid,timestamptz
) is 'Completes from the latest settled semantic quality result. Historical sufficient tasks cannot mask a newer non-terminal low-precision result.';

notify pgrst, 'reload schema';
