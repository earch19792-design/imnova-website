-- Human approval must never be consumed before its candidate transition and
-- continuation job exist. This RPC commits the three effects atomically.

create or replace function public.complete_and_advance_same_day_pilot_gate_v1(
  p_task_id uuid,
  p_run_id uuid,
  p_candidate_id uuid,
  p_expected_gate_type text,
  p_expected_previous_state text,
  p_next_state text,
  p_reason_code text,
  p_triggered_by text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_attempt integer,
  p_checkpoint jsonb,
  p_evidence_hash text,
  p_transition_idempotency_key text,
  p_next_automatic_action text,
  p_next_human_action text,
  p_candidate_patch jsonb default '{}'::jsonb,
  p_job_type text default null,
  p_job_idempotency_key text default null,
  p_job_checkpoint jsonb default '{}'::jsonb,
  p_job_available_at timestamptz default null,
  p_job_max_attempts integer default 4,
  p_api_family text default null,
  p_api_operation text default null,
  p_owner_lane text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.ebay_same_day_pilot_human_tasks%rowtype;
  v_transition_result text;
  v_unknown_patch_key text;
begin
  if jsonb_typeof(coalesce(p_candidate_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'SAME_DAY_PILOT_GATE_PATCH_INVALID';
  end if;
  select key into v_unknown_patch_key
  from jsonb_object_keys(coalesce(p_candidate_patch, '{}'::jsonb)) key
  where key not in (
    'listingQuantity', 'recheckAfterSale', 'economicsSummary', 'state',
    'productResearchCaptureBatchId', 'evidenceSummary', 'imagePackageSummary',
    'manualHandoffPackage', 'blockers'
  )
  limit 1;
  if v_unknown_patch_key is not null then
    raise exception 'SAME_DAY_PILOT_GATE_PATCH_KEY_BLOCKED';
  end if;
  if (p_candidate_patch ? 'economicsSummary'
      and jsonb_typeof(p_candidate_patch->'economicsSummary') <> 'object')
    or (p_candidate_patch ? 'evidenceSummary'
      and jsonb_typeof(p_candidate_patch->'evidenceSummary') <> 'object')
    or (p_candidate_patch ? 'imagePackageSummary'
      and jsonb_typeof(p_candidate_patch->'imagePackageSummary') <> 'object')
    or (p_candidate_patch ? 'manualHandoffPackage'
      and jsonb_typeof(p_candidate_patch->'manualHandoffPackage') <> 'object')
    or (p_candidate_patch ? 'blockers'
      and jsonb_typeof(p_candidate_patch->'blockers') <> 'array') then
    raise exception 'SAME_DAY_PILOT_GATE_PATCH_TYPE_INVALID';
  end if;

  select * into v_task
  from public.ebay_same_day_pilot_human_tasks
  where id = p_task_id
    and run_id = p_run_id
    and candidate_id = p_candidate_id
    and gate_type = p_expected_gate_type
  for update;
  if v_task.id is null then
    raise exception 'SAME_DAY_PILOT_GATE_TASK_MISSING';
  end if;
  if v_task.status = 'COMPLETED' then
    if exists (
      select 1 from public.ebay_same_day_pilot_transitions transition_row
      where transition_row.run_id = p_run_id
        and transition_row.candidate_id = p_candidate_id
        and transition_row.idempotency_key = p_transition_idempotency_key
        and transition_row.next_state = p_next_state
    ) then
      return 'IDEMPOTENT';
    end if;
    raise exception 'SAME_DAY_PILOT_GATE_TASK_ALREADY_CONSUMED';
  end if;
  if v_task.status <> 'OPEN' then
    raise exception 'SAME_DAY_PILOT_GATE_TASK_NOT_OPEN';
  end if;

  v_transition_result := public.advance_same_day_pilot_candidate(
    p_run_id, p_candidate_id, p_expected_previous_state, p_next_state,
    p_reason_code, p_triggered_by, p_started_at, p_completed_at, p_attempt,
    coalesce(p_checkpoint, '{}'::jsonb), p_evidence_hash,
    p_transition_idempotency_key, p_next_automatic_action, p_next_human_action,
    p_job_type, p_job_idempotency_key, coalesce(p_job_checkpoint, '{}'::jsonb),
    p_job_available_at, p_job_max_attempts, p_api_family, p_api_operation,
    p_owner_lane
  );
  if v_transition_result = 'STALE' then
    raise exception 'SAME_DAY_PILOT_GATE_TRANSITION_STALE';
  end if;

  update public.ebay_same_day_pilot_candidates
  set listing_quantity = case when p_candidate_patch ? 'listingQuantity'
        then (p_candidate_patch->>'listingQuantity')::integer else listing_quantity end,
      recheck_after_sale = case when p_candidate_patch ? 'recheckAfterSale'
        then (p_candidate_patch->>'recheckAfterSale')::boolean else recheck_after_sale end,
      economics_summary = case when p_candidate_patch ? 'economicsSummary'
        then p_candidate_patch->'economicsSummary' else economics_summary end,
      state = case when p_candidate_patch ? 'state'
        then p_candidate_patch->>'state' else state end,
      product_research_capture_batch_id = case when p_candidate_patch ? 'productResearchCaptureBatchId'
        then nullif(p_candidate_patch->>'productResearchCaptureBatchId', '')::uuid
        else product_research_capture_batch_id end,
      evidence_summary = case when p_candidate_patch ? 'evidenceSummary'
        then p_candidate_patch->'evidenceSummary' else evidence_summary end,
      image_package_summary = case when p_candidate_patch ? 'imagePackageSummary'
        then p_candidate_patch->'imagePackageSummary' else image_package_summary end,
      manual_handoff_package = case when p_candidate_patch ? 'manualHandoffPackage'
        then p_candidate_patch->'manualHandoffPackage' else manual_handoff_package end,
      blockers = case when p_candidate_patch ? 'blockers'
        then array(select jsonb_array_elements_text(p_candidate_patch->'blockers'))
        else blockers end,
      updated_at = p_completed_at
  where id = p_candidate_id and run_id = p_run_id;
  if not found then
    raise exception 'SAME_DAY_PILOT_GATE_CANDIDATE_MISSING';
  end if;

  update public.ebay_same_day_pilot_human_tasks
  set status = 'COMPLETED', completed_at = p_completed_at, updated_at = p_completed_at
  where id = p_task_id and status = 'OPEN';
  if not found then
    raise exception 'SAME_DAY_PILOT_GATE_TASK_COMPLETION_FAILED';
  end if;
  return v_transition_result;
end;
$$;

revoke all on function public.complete_and_advance_same_day_pilot_gate_v1(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,integer,jsonb,
  text,text,text,text,jsonb,text,text,jsonb,timestamptz,integer,text,text,text
) from public, anon, authenticated;
grant execute on function public.complete_and_advance_same_day_pilot_gate_v1(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,integer,jsonb,
  text,text,text,text,jsonb,text,text,jsonb,timestamptz,integer,text,text,text
) to service_role;

comment on function public.complete_and_advance_same_day_pilot_gate_v1(
  uuid,uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,integer,jsonb,
  text,text,text,text,jsonb,text,text,jsonb,timestamptz,integer,text,text,text
) is 'Atomically consumes one human gate, advances its candidate, applies an allowlisted patch and enqueues the continuation.';

notify pgrst, 'reload schema';
