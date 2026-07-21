-- Replan one pending Same-Day Product Research query from an overly literal
-- supplier title to a bounded marketplace family alias. Existing captures,
-- processed tasks and image evidence remain untouched. No OpenAI call, eBay
-- write, Production mutation, table rebuild or deletion is performed.

create or replace function public.replan_same_day_product_research_family_alias_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_task_id uuid,
  p_expected_query text,
  p_family_query text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_query_task public.marketplace_product_research_query_tasks%rowtype;
  v_query_plan public.marketplace_product_research_query_plans%rowtype;
  v_human_task public.ebay_same_day_pilot_human_tasks%rowtype;
  v_new_query_hash text;
  v_new_plan_input_hash text;
  v_event_key text;
  v_query_plan_payload jsonb;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is null
    or p_expected_task_id is null
    or length(trim(coalesce(p_expected_query, ''))) < 3
    or length(trim(coalesce(p_family_query, ''))) not between 3 and 100
    or p_family_query ~ '[[:cntrl:]]'
    or lower(trim(p_expected_query)) = lower(trim(p_family_query))
    or p_now is null then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_CANDIDATE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ebay_same_day_pilot_run:' || v_run.id::text, 0)
  );

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_run.id
  for update;
  if not found
    or v_run.marketplace_account_key <> p_account_key
    or v_run.marketplace <> 'EBAY_US'
    or v_run.created_by is distinct from p_actor
    or v_run.status not in ('ACTIVE', 'PARTIALLY_READY', 'READY_FOR_OPERATOR')
    or v_run.worker_lease_token is not null
    or v_run.worker_lease_owner is not null then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_candidate.state <> 'NEEDS_PRODUCT_RESEARCH_CAPTURE'
    or v_candidate.machine_state not in (
      'PRODUCT_RESEARCH_PLAN_READY', 'WAITING_PRODUCT_RESEARCH_CAPTURE'
    )
    or v_candidate.product_research_capture_batch_id is not null then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_CANDIDATE_INVALID';
  end if;

  v_event_key := v_run.id::text || ':' || p_candidate_id::text
    || ':PRODUCT_RESEARCH_FAMILY_ALIAS_V2:' || p_expected_task_id::text;
  if lower(trim(v_candidate.product_research_query_plan ->> 'query'))
      = lower(trim(p_family_query))
    and exists (
      select 1 from public.ebay_same_day_pilot_events event
      where event.run_id = v_run.id
        and event.candidate_id = p_candidate_id
        and event.idempotency_key = v_event_key
    ) then
    return jsonb_build_object(
      'runId', v_run.id,
      'candidateId', p_candidate_id,
      'queryTaskId', p_expected_task_id,
      'query', trim(p_family_query),
      'idempotent', true,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    );
  end if;

  if lower(trim(v_candidate.product_research_query_plan ->> 'query'))
      <> lower(trim(p_expected_query)) then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_EXPECTED_QUERY_MISMATCH';
  end if;

  select query_task.* into v_query_task
  from public.marketplace_product_research_query_tasks query_task
  where query_task.id = p_expected_task_id
    and query_task.marketplace_account_key = p_account_key
    and query_task.marketplace = 'EBAY_US'
  for update;
  if not found
    or v_query_task.status <> 'PENDING'
    or v_query_task.capture_batch_id is not null
    or lower(trim(v_query_task.search_query)) <> lower(trim(p_expected_query))
    or v_query_task.plan_id::text
      <> coalesce(v_candidate.product_research_query_plan ->> 'productResearchPlanId', '')
    or exists (
      select 1
      from public.marketplace_product_research_query_tasks earlier_task
      where earlier_task.plan_id = v_query_task.plan_id
        and earlier_task.status = 'PENDING'
        and earlier_task.ordinal < v_query_task.ordinal
    ) then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_QUERY_TASK_INVALID';
  end if;

  select query_plan.* into v_query_plan
  from public.marketplace_product_research_query_plans query_plan
  where query_plan.id = v_query_task.plan_id
    and query_plan.marketplace_account_key = p_account_key
    and query_plan.marketplace = 'EBAY_US'
  for update;
  if not found
    or v_query_plan.status <> 'ACTIVE'
    or v_query_plan.openai_calls <> 0
    or v_query_plan.ebay_writes <> 0 then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_QUERY_PLAN_INVALID';
  end if;

  select task.* into v_human_task
  from public.ebay_same_day_pilot_human_tasks task
  where task.run_id = v_run.id
    and task.candidate_id = p_candidate_id
    and task.gate_type = 'PRODUCT_RESEARCH_CAPTURE_REQUIRED'
    and task.status = 'OPEN'
  order by task.created_at desc, task.id desc
  limit 1
  for update;
  if not found
    or lower(trim(v_human_task.action_schema ->> 'query'))
      <> lower(trim(p_expected_query)) then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_HUMAN_TASK_INVALID';
  end if;

  v_new_query_hash := 'sha256:' || encode(
    extensions.digest(lower(trim(p_family_query)), 'sha256'), 'hex'
  );
  if exists (
    select 1
    from public.marketplace_product_research_query_tasks duplicate_task
    where duplicate_task.plan_id = v_query_plan.id
      and duplicate_task.id <> v_query_task.id
      and duplicate_task.query_hash = v_new_query_hash
  ) then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_DUPLICATE_QUERY';
  end if;

  v_new_plan_input_hash := 'sha256:' || encode(
    extensions.digest(
      'SAME_DAY_PRODUCT_RESEARCH_FAMILY_ALIAS_V2:' || v_query_plan.id::text
        || ':' || v_query_task.id::text || ':' || lower(trim(p_family_query)),
      'sha256'
    ),
    'hex'
  );
  if exists (
    select 1
    from public.marketplace_product_research_query_plans duplicate_plan
    where duplicate_plan.marketplace_account_key = p_account_key
      and duplicate_plan.marketplace = 'EBAY_US'
      and duplicate_plan.id <> v_query_plan.id
      and duplicate_plan.input_hash = v_new_plan_input_hash
  ) then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_DUPLICATE_PLAN_INPUT';
  end if;

  v_query_plan_payload := v_candidate.product_research_query_plan
    || jsonb_build_object(
      'query', trim(p_family_query),
      'strictSupplierTitleQuery', trim(p_expected_query),
      'strategy', 'FAMILY_IDENTITY_RECONCILIATION',
      'reason',
        'Se usa la forma corta de la familia que emplean otros vendedores; tamaño, pack y variante se separan fila por fila.',
      'queryStrategyVersion',
        'MARKETPLACE_FAMILY_ALIAS_V2_2026_07_21',
      'familyAliasReplannedAt', p_now
    );

  update public.marketplace_product_research_query_tasks query_task
  set search_query = trim(p_family_query),
      query_hash = v_new_query_hash,
      last_error_code = 'FAMILY_ALIAS_REPLANNED',
      updated_at = p_now
  where query_task.id = v_query_task.id
    and query_task.status = 'PENDING';
  if not found then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_QUERY_TASK_PATCH_FAILED';
  end if;

  update public.marketplace_product_research_query_plans query_plan
  set plan_version = 'PILOT_3_LISTINGS_SAME_DAY_V1_QUERY_PLAN_V2',
      input_hash = v_new_plan_input_hash,
      updated_at = p_now
  where query_plan.id = v_query_plan.id
    and query_plan.status = 'ACTIVE';
  if not found then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_QUERY_PLAN_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set product_research_query_plan = v_query_plan_payload,
      next_automated_action =
        'Esperar la captura de la familia y reconciliar cada fila con la variante exacta.',
      next_human_action =
        'Abrir la consulta corta de familia indicada por Seller OS.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id;
  if not found then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_human_tasks task
  set evidence_summary = task.evidence_summary || jsonb_build_object(
        'queryPlan', v_query_plan_payload,
        'familyAliasReplanned', true,
        'strictSupplierTitleQueryRetained', true
      ),
      action_schema = task.action_schema || jsonb_build_object(
        'query', trim(p_family_query),
        'queryStrategyVersion', 'MARKETPLACE_FAMILY_ALIAS_V2_2026_07_21'
      ),
      why_needed =
        'La familia puede aparecer con títulos de vendedor abreviados; la identidad exacta se valida después por fila.',
      impact =
        'Permite encontrar ventas de la misma familia sin contar automáticamente otro tamaño, pack o color.',
      updated_at = p_now
  where task.id = v_human_task.id
    and task.status = 'OPEN';
  if not found then
    raise exception 'SAME_DAY_FAMILY_ALIAS_REPLAN_HUMAN_TASK_PATCH_FAILED';
  end if;

  insert into public.ebay_same_day_pilot_events(
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'PRODUCT_RESEARCH_FAMILY_ALIAS_REPLANNED',
    jsonb_build_object(
      'planId', v_query_plan.id,
      'queryTaskId', v_query_task.id,
      'previousQueryHash', v_query_task.query_hash,
      'familyQueryHash', v_new_query_hash,
      'queryStrategyVersion', 'MARKETPLACE_FAMILY_ALIAS_V2_2026_07_21',
      'strictSupplierTitleQueryRetained', true,
      'rowIdentityReconciliationRequired', true,
      'tableParserChanged', false,
      'extensionChanged', false,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    v_event_key,
    0, 0, 0, false
  );

  return jsonb_build_object(
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'planId', v_query_plan.id,
    'queryTaskId', v_query_task.id,
    'query', trim(p_family_query),
    'previousQueryRetained', true,
    'rowIdentityReconciliationRequired', true,
    'tableParserChanged', false,
    'extensionChanged', false,
    'idempotent', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.replan_same_day_product_research_family_alias_v1(
  text, uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.replan_same_day_product_research_family_alias_v1(
  text, uuid, uuid, uuid, text, text, timestamptz
) to service_role;

comment on function public.replan_same_day_product_research_family_alias_v1(
  text, uuid, uuid, uuid, text, text, timestamptz
) is
      'Replans one pending Same-Day Product Research query to a bounded marketplace family alias while preserving exact row-level identity gates and all prior evidence.';

notify pgrst, 'reload schema';
