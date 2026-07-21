-- Reject one exact pending V5 set that proves the opaque-source-frame defect,
-- preserve every prior row, and create a distinct V6 handoff/job. The function
-- never promotes another candidate, reopens a completed job, deletes evidence,
-- invokes a provider, publishes to eBay, or changes Production.

create or replace function public.requeue_same_day_image_after_opaque_frame_compositor_v6_v1(
  p_confirm_project_ref text,
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_capture_batch_id uuid,
  p_expected_completed_job_id uuid,
  p_expected_control_id uuid,
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
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_old_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_new_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_human_task public.ebay_same_day_pilot_human_tasks%rowtype;
  v_completed_job public.ebay_same_day_pilot_jobs%rowtype;
  v_new_job public.ebay_same_day_pilot_jobs%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_review jsonb;
  v_recovery_package jsonb;
  v_recovery_package_hash text;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_job_key text;
  v_transition_key text;
  v_event_key text;
  v_transition_result text;
  v_asset_count integer;
  v_main_count integer;
  v_secondary_count integer;
begin
  if trim(coalesce(p_confirm_project_ref, ''))
      <> 'vsfthqydfrdzulldbfbe'
    or coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is distinct from
      'ab226a81-6d42-4404-a62a-b22d333be398'::uuid
    or p_expected_capture_batch_id is distinct from
      'afd79416-707a-457a-b0d7-ae308eb6589a'::uuid
    or p_expected_completed_job_id is distinct from
      '21e14946-7b81-4094-8466-58b87977a0bb'::uuid
    or p_expected_control_id is distinct from
      '94d5cf59-ebe5-4bad-ae22-062fbb297862'::uuid
    or p_now is null then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_INPUT_INVALID';
  end if;

  if not exists (
    select 1
    from public.ebay_same_day_pilot_scheduler_config config
    where config.singleton = true
      and config.enabled
      and config.environment = 'STAGING'
      and config.deployment_scope = 'PREVIEW'
      and config.supabase_project_ref = 'vsfthqydfrdzulldbfbe'
  ) then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_STAGING_SCOPE_REQUIRED';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_CANDIDATE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ebay_same_day_pilot_run:' || v_run.id::text, 0)
  );

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_run.id
  for update;
  if not found
    or v_run.id <> '88f48603-bc28-4ee7-b9ea-44d749ef4676'::uuid
    or v_run.marketplace_account_key <> p_account_key
    or v_run.marketplace <> 'EBAY_US'
    or v_run.created_by is distinct from p_actor
    or v_run.status not in ('ACTIVE', 'PARTIALLY_READY', 'READY_FOR_OPERATOR')
    or v_run.worker_lease_owner is not null
    or v_run.worker_lease_token is not null
    or coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz)
      > p_now then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_CANDIDATE_NOT_FOUND';
  end if;

  v_job_key := v_run.id::text || ':' || p_candidate_id::text
    || ':GENERATE_SIX_IMAGE_PACKAGE:OPAQUE_FRAME_COMPOSITOR_V6:'
    || p_expected_control_id::text;
  v_transition_key := v_job_key || ':TRANSITION';
  v_event_key := 'same-day-image:' || p_expected_control_id::text
    || ':opaque-frame-compositor-v6-requeue';

  -- A repeated call after the transaction committed is read-only and returns
  -- only when the exact append-only recovery evidence is present.
  if exists (
    select 1
    from public.ebay_same_day_pilot_events event
    where event.idempotency_key = v_event_key
      and event.run_id = v_run.id
      and event.candidate_id = p_candidate_id
      and event.event_type =
        'SAME_DAY_IMAGE_OPAQUE_FRAME_COMPOSITOR_V6_REQUEUE_CREATED'
      and event.ebay_writes = 0
      and not event.production_changed
      and event.event_payload ->> 'previousControlId'
        = p_expected_control_id::text
      and event.event_payload ->> 'previousCompletedJobId'
        = p_expected_completed_job_id::text
      and event.event_payload ->> 'captureBatchId'
        = p_expected_capture_batch_id::text
      and coalesce(event.event_payload ->> 'newJobId', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and coalesce(event.event_payload ->> 'recoveryHandoffId', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    select job.* into v_new_job
    from public.ebay_same_day_pilot_jobs job
    where job.idempotency_key = v_job_key
      and job.run_id = v_run.id
      and job.candidate_id = p_candidate_id
      and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
      and job.checkpoint ->> 'productResearchCaptureBatchId'
        = p_expected_capture_batch_id::text
      and job.checkpoint ->> 'requiredCompositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21';
    if not found
      or (
        select event.event_payload ->> 'newJobId'
        from public.ebay_same_day_pilot_events event
        where event.idempotency_key = v_event_key
      ) is distinct from v_new_job.id::text
      or not exists (
        select 1
        from public.ebay_same_day_pilot_events event
        join public.ebay_same_day_pilot_handoffs handoff
          on handoff.id = (event.event_payload ->> 'recoveryHandoffId')::uuid
        where event.idempotency_key = v_event_key
          and handoff.run_id = v_run.id
          and handoff.candidate_id = p_candidate_id
          and handoff.status = 'AWAITING_IMAGE_APPROVAL'
          and handoff.ebay_writes = 0
          and not handoff.production_changed
      )
      or not exists (
        select 1
        from public.ebay_same_day_pilot_image_package_runs control
        where control.id = p_expected_control_id
          and control.status = 'REJECTED'
          and control.candidate_id = p_candidate_id
      )
      or (
        select count(*)
        from public.ebay_listing_image_assets asset
        join public.ebay_same_day_pilot_image_package_runs control
          on control.id = p_expected_control_id
         and asset.id = any(control.asset_ids)
        where asset.status = 'rejected'
      ) <> 6 then
      raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_IDEMPOTENCY_INVALID';
    end if;
    return jsonb_build_object(
      'runId', v_run.id,
      'candidateId', p_candidate_id,
      'previousControlId', p_expected_control_id,
      'newJobId', v_new_job.id,
      'jobStatus', v_new_job.status,
      'machineState', v_candidate.machine_state,
      'idempotent', true,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    );
  end if;

  if v_candidate.machine_state <> 'WAITING_IMAGE_APPROVAL'
    or v_candidate.state <> 'READY_FOR_IMAGE_REVIEW'
    or v_candidate.product_research_capture_batch_id
      is distinct from p_expected_capture_batch_id
    or v_candidate.image_package_summary ->> 'controlId'
      is distinct from p_expected_control_id::text then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_CANDIDATE_INVALID';
  end if;

  if not exists (
    select 1
    from public.marketplace_product_research_capture_batches batch
    where batch.id = p_expected_capture_batch_id
      and batch.marketplace_account_key = p_account_key
      and batch.marketplace = 'EBAY_US'
      and batch.source_row_count > 0
      and batch.valid_count > 0
  ) then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_CAPTURE_INVALID';
  end if;

  select control.* into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_expected_control_id
    and control.run_id = v_run.id
    and control.candidate_id = p_candidate_id
    and control.marketplace_account_key = p_account_key
    and control.created_by = p_actor
  for update;
  if not found
    or v_control.status <> 'PENDING_REVIEW'
    or v_control.generation_mode <> 'OPENAI_CONTEXT_PLATE'
    or v_control.openai_calls <> 1
    or cardinality(v_control.asset_ids) <> 6
    or v_control.ebay_writes <> 0
    or v_control.production_changed
    or v_control.completed_at is null
    or v_control.lease_token is not null
    or v_control.lease_expires_at is not null then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_CONTROL_INVALID';
  end if;

  select
    count(asset.id),
    count(*) filter (where
      asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'generativeAiUsed' = 'false'
      and asset.transformation ->> 'authorizedSourceTreatment'
        = 'PRESERVED_FRAMED_SOURCE'
      and asset.qa_result ->> 'mainBackground' = 'FRAMED_AUTHORIZED_SOURCE'
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.transformation ->> 'generativeAiUsed' = 'true'
      and asset.transformation ->> 'authorizedSourceTreatment'
        = 'PRESERVED_FRAMED_SOURCE'
      and asset.transformation ->> 'backgroundPlateVersion'
        = 'EBAY_OPENAI_COMMERCIAL_SCENE_BOARD_V3'
      and asset.transformation ->> 'backgroundPlateQuality' = 'high'
      and not (asset.transformation ? 'foregroundMatteVersion')
      and not (asset.qa_result ? 'foregroundMatteValidated')
      and not (asset.qa_result ? 'opaqueSourceFrameRemoved')
    )
  into v_asset_count, v_main_count, v_secondary_count
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_control.asset_ids)
    and asset.listing_package_id = v_control.listing_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor
    and asset.status = 'pending_review'
    and asset.transformation ->> 'compositorContractVersion'
      = 'EBAY_IMAGE_COMPOSITOR_DIVERSITY_V5_2026_07_21'
    and asset.transformation ->> 'competitorImageUsed' = 'false'
    and asset.transformation ->> 'originalPackagePixelsPreserved' = 'true'
    and asset.transformation ->> 'verifiedFactsOnly' = 'true';
  if v_asset_count <> 6 or v_main_count <> 1 or v_secondary_count <> 5 then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_EVIDENCE_INVALID';
  end if;

  select handoff.* into v_old_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.id = v_control.handoff_id
    and handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.fact_run_id = v_control.fact_run_id
    and handoff.package_hash = v_control.handoff_hash
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  for key share;
  if not found
    or v_old_handoff.package_hash
      <> coalesce(v_candidate.manual_handoff_package ->> 'packageHash', '')
    or v_old_handoff.source_image_type <> 'LUNA_AUTHORIZED_CATALOG'
    or v_old_handoff.openai_calls <> 0
    or v_old_handoff.ebay_writes <> 0
    or v_old_handoff.production_changed then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_HANDOFF_INVALID';
  end if;

  select task.* into v_human_task
  from public.ebay_same_day_pilot_human_tasks task
  where task.run_id = v_run.id
    and task.candidate_id = p_candidate_id
    and task.gate_type = 'IMAGE_APPROVAL_REQUIRED'
    and task.status = 'OPEN'
  order by task.created_at desc, task.id desc
  limit 1
  for update;
  if not found or exists (
    select 1
    from public.ebay_same_day_pilot_human_tasks duplicate_task
    where duplicate_task.run_id = v_run.id
      and duplicate_task.candidate_id = p_candidate_id
      and duplicate_task.status = 'OPEN'
      and duplicate_task.id <> v_human_task.id
  ) then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_TASK_INVALID';
  end if;

  select job.* into v_completed_job
  from public.ebay_same_day_pilot_jobs job
  where job.id = p_expected_completed_job_id
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  for update;
  if not found
    or v_completed_job.status <> 'COMPLETED'
    or v_completed_job.completed_at is null
    or v_completed_job.lease_owner is not null
    or v_completed_job.lease_token is not null
    or v_completed_job.lease_expires_at is not null
    or v_completed_job.checkpoint ->> 'productResearchCaptureBatchId'
      is distinct from p_expected_capture_batch_id::text
    or v_completed_job.checkpoint ->> 'packageHash'
      is distinct from v_old_handoff.package_hash then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_JOB_INVALID';
  end if;

  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs active_job
    where active_job.run_id = v_run.id
      and active_job.candidate_id = p_candidate_id
      and active_job.status in (
        'PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER'
      )
  ) or exists (
    select 1
    from public.ebay_same_day_pilot_image_package_runs active_control
    where active_control.candidate_id = p_candidate_id
      and active_control.id <> p_expected_control_id
      and active_control.status in (
        'CLAIMED', 'FAILED_RETRYABLE', 'PENDING_REVIEW', 'APPROVED'
      )
  ) then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_LANE_BUSY';
  end if;

  select transition_row.* into v_last_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
  order by transition_row.created_at desc, transition_row.id desc
  limit 1
  for key share;
  if not found
    or v_last_transition.previous_state <> 'PREPARING_IMAGE_PACKAGE'
    or v_last_transition.next_state <> 'WAITING_IMAGE_APPROVAL'
    or v_last_transition.checkpoint ->> 'controlId'
      is distinct from p_expected_control_id::text then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_TRANSITION_INVALID';
  end if;

  v_recovery_package := v_old_handoff.package_data || jsonb_build_object(
    'imageCompositionRecovery', jsonb_build_object(
      'version', 'OPAQUE_FRAME_COMPOSITOR_V6_RECOVERY_V1_2026_07_21',
      'reason', 'OPAQUE_AUTHORIZED_SOURCE_FRAME_OVER_GENERATED_SCENE',
      'supersedesControlId', p_expected_control_id,
      'previousCompletedJobId', p_expected_completed_job_id,
      'requiredCompositorContractVersion',
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21',
      'requiredForegroundMatteVersion',
        'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21',
      'historyPreserved', true
    )
  );
  v_recovery_package_hash := encode(
    extensions.digest(v_recovery_package::text, 'sha256'), 'hex'
  );
  if v_recovery_package_hash !~ '^[0-9a-f]{64}$'
    or v_recovery_package_hash = v_old_handoff.package_hash then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_HASH_INVALID';
  end if;

  -- The review primitive rejects only this control's exact six assets.
  v_review := public.review_ebay_same_day_pilot_image_package_set(
    p_expected_control_id, p_actor, 'REJECT', true, '[]'::jsonb
  );
  if v_review ->> 'status' is distinct from 'REJECTED' then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_REJECTION_FAILED';
  end if;

  update public.ebay_same_day_pilot_human_tasks task
  set status = 'SUPERSEDED',
      completed_at = p_now,
      updated_at = p_now
  where task.id = v_human_task.id
    and task.status = 'OPEN';
  if not found then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_TASK_PATCH_FAILED';
  end if;

  insert into public.ebay_same_day_pilot_handoffs (
    run_id, candidate_id, fact_run_id, handoff_version, status,
    package_data, package_hash, source_image_type, image_count,
    operator_price_approved, openai_calls, ebay_writes,
    production_changed, created_at
  ) values (
    v_run.id,
    p_candidate_id,
    v_old_handoff.fact_run_id,
    v_old_handoff.handoff_version || ':FOREGROUND_V6_V1',
    'AWAITING_IMAGE_APPROVAL',
    v_recovery_package,
    v_recovery_package_hash,
    v_old_handoff.source_image_type,
    v_old_handoff.image_count,
    v_old_handoff.operator_price_approved,
    0, 0, false, p_now
  )
  on conflict (candidate_id, package_hash) do nothing
  returning * into v_new_handoff;
  if not found then
    select handoff.* into v_new_handoff
    from public.ebay_same_day_pilot_handoffs handoff
    where handoff.candidate_id = p_candidate_id
      and handoff.package_hash = v_recovery_package_hash
    for key share;
  end if;
  if not found
    or v_new_handoff.run_id <> v_run.id
    or v_new_handoff.fact_run_id <> v_old_handoff.fact_run_id
    or v_new_handoff.package_data <> v_recovery_package
    or v_new_handoff.status <> 'AWAITING_IMAGE_APPROVAL'
    or v_new_handoff.openai_calls <> 0
    or v_new_handoff.ebay_writes <> 0
    or v_new_handoff.production_changed then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_HANDOFF_CREATE_FAILED';
  end if;

  v_checkpoint := jsonb_build_object(
    'recoveryVersion', 'OPAQUE_FRAME_COMPOSITOR_V6_RECOVERY_V1_2026_07_21',
    'productResearchCaptureBatchId', p_expected_capture_batch_id,
    'factRunId', v_old_handoff.fact_run_id,
    'packageHash', v_recovery_package_hash,
    'previousControlId', p_expected_control_id,
    'previousCompletedJobId', p_expected_completed_job_id,
    'previousHandoffId', v_old_handoff.id,
    'recoveryHandoffId', v_new_handoff.id,
    'requiredCompositorContractVersion',
      'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21',
    'requiredForegroundMatteVersion',
      'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21',
    'generationAttemptVersion',
      'OPAQUE_FRAME_COMPOSITOR_V6_CAPTURE_BOUND_V1_2026_07_21',
    'maximumOpenAiCalls', 1,
    'competitorImages', 0,
    'previousControlPreserved', true,
    'previousCompletedJobPreserved', true,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'), 'hex'
  );

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'WAITING_IMAGE_APPROVAL',
    'PREPARING_IMAGE_PACKAGE',
    'COMPOSITOR_V6_REQUIRED_AFTER_OPAQUE_SOURCE_OVERLAY',
    'USER',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Regenerar seis imágenes con foreground transparente verificado.',
    'Ninguna hasta revisar el nuevo set.',
    'GENERATE_SIX_IMAGE_PACKAGE',
    v_job_key,
    v_checkpoint,
    p_now,
    4,
    null::text,
    null::text,
    null::text
  );
  if v_transition_result <> 'ADVANCED' then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_CONTENT',
      blockers = '{}'::text[],
      manual_handoff_package = candidate.manual_handoff_package
        || jsonb_build_object(
          'status', 'AWAITING_IMAGE_APPROVAL',
          'version', v_new_handoff.handoff_version,
          'packageHash', v_new_handoff.package_hash,
          'package', v_new_handoff.package_data,
          'blockers', '[]'::jsonb,
          'openAiCalls', 0,
          'ebayWrites', 0,
          'imageCompositionRecovery',
            v_recovery_package -> 'imageCompositionRecovery'
        ),
      image_package_summary = jsonb_build_object(
        'status', 'PREPARING_FOREGROUND_V6_REGENERATION',
        'source', 'LUNA_AUTHORIZED_CATALOG',
        'count', v_old_handoff.image_count,
        'approved', false,
        'generatedImages', 0,
        'competitorImages', 0,
        'supersededControlId', p_expected_control_id,
        'supersededAssetCount', 6,
        'regenerationReason', 'OPAQUE_AUTHORIZED_SOURCE_FRAME',
        'openAiCalls', 0,
        'ebayWrites', 0
      ),
      next_automated_action =
        'Regenerar seis imágenes con foreground transparente verificado.',
      next_human_action = 'Ninguna hasta revisar el nuevo set.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE',
      stage = 'PREPARING_IMAGE_PACKAGE',
      next_automated_action =
        'Procesar la regeneración visual segura de Calypso.',
      next_human_action = 'Ninguna hasta revisar el nuevo set.',
      updated_at = p_now
  where run.id = v_run.id;

  select job.* into v_new_job
  from public.ebay_same_day_pilot_jobs job
  where job.idempotency_key = v_job_key
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE';
  if not found or v_new_job.id = p_expected_completed_job_id then
    raise exception 'SAME_DAY_IMAGE_OPAQUE_V6_REQUEUE_NEW_JOB_MISSING';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'SAME_DAY_IMAGE_OPAQUE_FRAME_COMPOSITOR_V6_REQUEUE_CREATED',
    jsonb_build_object(
      'captureBatchId', p_expected_capture_batch_id,
      'previousControlId', p_expected_control_id,
      'previousCompletedJobId', p_expected_completed_job_id,
      'previousHandoffId', v_old_handoff.id,
      'recoveryHandoffId', v_new_handoff.id,
      'newJobId', v_new_job.id,
      'requiredCompositorContractVersion',
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21',
      'oldEvidencePreserved', true,
      'externalCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    v_event_key,
    0, 0, 0, false
  );

  return jsonb_build_object(
    'runId', v_run.id,
    'candidateId', p_candidate_id,
    'previousControlId', p_expected_control_id,
    'previousCompletedJobId', p_expected_completed_job_id,
    'recoveryHandoffId', v_new_handoff.id,
    'newJobId', v_new_job.id,
    'jobStatus', v_new_job.status,
    'machineState', 'PREPARING_IMAGE_PACKAGE',
    'idempotent', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.requeue_same_day_image_after_opaque_frame_compositor_v6_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.requeue_same_day_image_after_opaque_frame_compositor_v6_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.requeue_same_day_image_after_opaque_frame_compositor_v6_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, timestamptz
) is 'Staging-only, ID-bound Calypso recovery: rejects its exact pending V5 opaque-frame set and creates a separate append-only V6 foreground handoff/job; no promotion, provider call, eBay write, deletion or Production change.';

notify pgrst, 'reload schema';
