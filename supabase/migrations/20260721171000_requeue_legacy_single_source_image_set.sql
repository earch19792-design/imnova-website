-- Requeue only a proven legacy V3 single-source deterministic set. The old
-- evidence remains append-only and unapproved; a new handoff hash creates a
-- separate V4 control. No operator product approval is repeated and no eBay
-- or Production write is performed.

create or replace function public.requeue_legacy_single_source_image_set_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_replacement_package jsonb,
  p_replacement_hash text,
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
  v_old_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_new_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_task public.ebay_same_day_pilot_human_tasks%rowtype;
  v_job public.ebay_same_day_pilot_jobs%rowtype;
  v_revision jsonb;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_transition_result text;
begin
  if coalesce(p_account_key, '') !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is null
    or p_replacement_package is null
    or jsonb_typeof(p_replacement_package) <> 'object'
    or coalesce(p_replacement_hash, '') !~ '^[0-9a-f]{64}$'
    or p_now is null then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_CANDIDATE_NOT_FOUND'; end if;
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
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_candidate.machine_state <> 'WAITING_IMAGE_APPROVAL'
    or v_candidate.state <> 'READY_FOR_IMAGE_REVIEW'
    or coalesce(v_candidate.image_package_summary ->> 'controlId', '')
      !~ '^[0-9a-f-]{36}$' then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_CANDIDATE_INVALID';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = (v_candidate.image_package_summary ->> 'controlId')::uuid
    and control.candidate_id = p_candidate_id
    and control.marketplace_account_key = p_account_key
    and control.created_by = p_actor
  for update;
  if not found
    or v_control.status <> 'PENDING_REVIEW'
    or v_control.generation_mode <> 'DETERMINISTIC_ONLY'
    or v_control.openai_calls <> 0
    or cardinality(v_control.asset_ids) <> 6
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_CONTROL_INVALID';
  end if;
  if (
    select count(*)
    from public.ebay_listing_image_assets asset
    where asset.id = any(v_control.asset_ids)
      and asset.status = 'pending_review'
      and asset.transformation ->> 'presentationMode' = 'SINGLE_SOURCE_INFORMATIONAL'
      and asset.transformation ->> 'compositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V3_2026_07_20'
      and asset.transformation ->> 'generativeAiUsed' = 'false'
      and asset.transformation ->> 'competitorImageUsed' = 'false'
  ) <> 6 then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_LEGACY_EVIDENCE_INVALID';
  end if;

  select handoff.* into v_old_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.id = v_control.handoff_id
    and handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  for share;
  if not found
    or v_old_handoff.package_hash = p_replacement_hash
    or v_old_handoff.openai_calls <> 0
    or v_old_handoff.ebay_writes <> 0
    or v_old_handoff.production_changed then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_HANDOFF_INVALID';
  end if;

  v_revision := p_replacement_package -> 'imageGenerationRevision';
  if p_replacement_package - 'imageGenerationRevision'
      is distinct from v_old_handoff.package_data
    or jsonb_typeof(v_revision) <> 'object'
    or v_revision ->> 'version' <> 'DOSSIER_AWARE_COMMERCIAL_SCENE_BOARD_V2'
    or v_revision ->> 'reason' <> 'LEGACY_SINGLE_SOURCE_REPETITION'
    or v_revision ->> 'supersedesControlId' <> v_control.id::text
    or coalesce(v_revision ->> 'requestedAt', '') = '' then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_PACKAGE_INVALID';
  end if;

  select task.* into v_task
  from public.ebay_same_day_pilot_human_tasks task
  where task.run_id = v_run.id
    and task.candidate_id = p_candidate_id
    and task.gate_type = 'IMAGE_APPROVAL_REQUIRED'
    and task.status = 'OPEN'
  order by task.created_at desc, task.id desc
  limit 1
  for update;
  if not found then raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_TASK_INVALID'; end if;

  select job.* into v_job
  from public.ebay_same_day_pilot_jobs job
  where job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  order by job.created_at desc, job.id desc
  limit 1
  for update;
  if not found
    or v_job.status <> 'COMPLETED'
    or v_job.lease_owner is not null
    or v_job.lease_token is not null
    or v_job.lease_expires_at is not null then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_JOB_INVALID';
  end if;
  if exists (
    select 1 from public.ebay_same_day_pilot_jobs other_job
    where other_job.run_id = v_run.id
      and other_job.id <> v_job.id
      and other_job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
  ) then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_LANE_BUSY';
  end if;

  insert into public.ebay_same_day_pilot_handoffs (
    run_id, candidate_id, fact_run_id, handoff_version, status,
    package_data, package_hash, source_image_type, image_count,
    operator_price_approved, openai_calls, ebay_writes, production_changed
  ) values (
    v_old_handoff.run_id, v_old_handoff.candidate_id,
    v_old_handoff.fact_run_id, v_old_handoff.handoff_version,
    'AWAITING_IMAGE_APPROVAL', p_replacement_package, p_replacement_hash,
    'LUNA_AUTHORIZED_CATALOG', v_old_handoff.image_count,
    true, 0, 0, false
  ) returning * into v_new_handoff;

  v_checkpoint := jsonb_build_object(
    'recoveryVersion', 'DOSSIER_AWARE_SCENE_BOARD_REQUEUE_V1_2026_07_21',
    'legacyControlId', v_control.id,
    'legacyAssetCount', 6,
    'newHandoffId', v_new_handoff.id,
    'newHandoffHash', p_replacement_hash,
    'productApprovalPreserved', true,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
  v_evidence_hash := encode(extensions.digest(v_checkpoint::text, 'sha256'), 'hex');
  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id, p_candidate_id,
    'WAITING_IMAGE_APPROVAL', 'PREPARING_IMAGE_PACKAGE',
    'LEGACY_SINGLE_SOURCE_IMAGE_SET_SUPERSEDED', 'RETRY',
    p_now, p_now, 1, v_checkpoint, v_evidence_hash,
    v_run.id::text || ':' || p_candidate_id::text
      || ':DOSSIER_AWARE_SCENE_BOARD_REQUEUE:' || v_control.id::text,
    'Regenerar seis imágenes con el expediente y diversidad comercial.',
    'Ninguna hasta revisar el nuevo set.',
    null::text, null::text, null::jsonb, p_now, 4,
    null::text, null::text, null::text
  );
  if v_transition_result = 'STALE' then
    raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_human_tasks task
  set status = 'SUPERSEDED', updated_at = p_now
  where task.id = v_task.id and task.status = 'OPEN';
  if not found then raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_TASK_PATCH_FAILED'; end if;

  update public.ebay_same_day_pilot_jobs job
  set status = 'PENDING', attempt = 0, available_at = p_now,
      checkpoint = jsonb_set(
        jsonb_set(coalesce(job.checkpoint, '{}'::jsonb),
          '{packageHash}', to_jsonb(p_replacement_hash), true),
        '{imageGenerationVersion}',
        to_jsonb('DOSSIER_AWARE_COMMERCIAL_SCENE_BOARD_V2'::text), true
      ),
      lease_owner = null, lease_token = null, lease_expires_at = null,
      last_heartbeat_at = null, last_error_code = null, completed_at = null,
      updated_at = p_now
  where job.id = v_job.id and job.status = 'COMPLETED';
  if not found then raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_JOB_PATCH_FAILED'; end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_CONTENT', blockers = '{}'::text[],
      manual_handoff_package = jsonb_build_object(
        'status', 'AWAITING_IMAGE_APPROVAL',
        'version', v_new_handoff.handoff_version,
        'packageHash', v_new_handoff.package_hash,
        'package', v_new_handoff.package_data,
        'blockers', '[]'::jsonb,
        'warnings', coalesce(v_candidate.manual_handoff_package -> 'warnings', '[]'::jsonb),
        'openAiCalls', 0,
        'ebayWrites', 0
      ),
      image_package_summary = jsonb_build_object(
        'source', 'LUNA_AUTHORIZED_CATALOG',
        'count', v_new_handoff.image_count,
        'approved', false,
        'generatedImages', 0,
        'competitorImages', 0,
        'regenerationReason', 'LEGACY_SINGLE_SOURCE_REPETITION'
      ),
      next_automated_action =
        'Regenerar seis imágenes con el expediente y diversidad comercial.',
      next_human_action = 'Ninguna hasta revisar el nuevo set.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then raise exception 'SAME_DAY_IMAGE_V4_REQUEUE_CANDIDATE_PATCH_FAILED'; end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE', stage = 'PREPARING_IMAGE_PACKAGE',
      next_automated_action =
        'Regenerar seis imágenes con el expediente y diversidad comercial.',
      next_human_action = 'Ninguna hasta revisar el nuevo set.',
      updated_at = p_now
  where run.id = v_run.id;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id, p_candidate_id,
    'LEGACY_SINGLE_SOURCE_IMAGE_SET_SUPERSEDED', v_checkpoint,
    'same-day-image:' || v_control.id::text || ':dossier-aware-requeue',
    0, 0, false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'legacyControlId', v_control.id,
    'newHandoffId', v_new_handoff.id,
    'jobId', v_job.id,
    'machineState', 'PREPARING_IMAGE_PACKAGE',
    'jobStatus', 'PENDING',
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.requeue_legacy_single_source_image_set_v1(
  text, uuid, uuid, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.requeue_legacy_single_source_image_set_v1(
  text, uuid, uuid, jsonb, text, timestamptz
) to service_role;

comment on function public.requeue_legacy_single_source_image_set_v1(
  text, uuid, uuid, jsonb, text, timestamptz
) is 'Supersedes only a proven legacy V3 single-source pending set and requeues a new V4 dossier-aware image handoff; no eBay or Production write.';

notify pgrst, 'reload schema';
