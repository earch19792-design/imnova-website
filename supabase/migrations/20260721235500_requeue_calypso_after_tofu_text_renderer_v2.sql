-- Reject only the exact Calypso V6/high-quality set whose locally composited
-- copy rendered as LastResort/tofu glyphs in Vercel. Preserve the completed
-- job and all six rejected assets as durable evidence, then append a distinct
-- handoff/job that requires the packaged Pango/fontfile text renderer V2.
-- This function is staging-only, makes no provider call, performs no eBay
-- write, and locks/snapshots the exact Tesla lane to prove it is unchanged.

create or replace function public.requeue_calypso_after_tofu_text_renderer_v2_v1(
  p_confirm_project_ref text,
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_capture_batch_id uuid,
  p_expected_completed_job_id uuid,
  p_expected_control_id uuid,
  p_expected_tesla_candidate_id uuid,
  p_expected_tesla_control_id uuid,
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
  v_rejected_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_old_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_new_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_human_task public.ebay_same_day_pilot_human_tasks%rowtype;
  v_completed_job public.ebay_same_day_pilot_jobs%rowtype;
  v_new_job public.ebay_same_day_pilot_jobs%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_tesla_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_tesla_control public.ebay_same_day_pilot_image_package_runs%rowtype;
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
  v_completed_job_snapshot jsonb;
  v_control_evidence_snapshot jsonb;
  v_asset_evidence_snapshot jsonb;
  v_asset_evidence_after jsonb;
  v_tesla_candidate_snapshot jsonb;
  v_tesla_control_snapshot jsonb;
  v_tesla_asset_snapshot jsonb;
  v_tesla_asset_after jsonb;
  v_expected_asset_ids uuid[] := array[
    '2990cc06-6f7a-4592-9a07-8214b2a75023'::uuid,
    '39ac7564-2845-4117-8495-78cbefb7bac3'::uuid,
    '65f460df-a554-4630-bc1d-eb2223d102a4'::uuid,
    'a22dfdd8-8629-499c-bdf7-52909312c9e5'::uuid,
    '6613f83c-f189-4a47-a9eb-3262bf6ff6d7'::uuid,
    'db420ed9-2139-4200-8bbb-fd6edfd0f5e7'::uuid
  ];
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
      '081a8928-36f9-4dd1-a3f2-d40af96ecb75'::uuid
    or p_expected_control_id is distinct from
      'd10383d6-ee63-4ae5-bcb5-15cf2371df95'::uuid
    or p_expected_tesla_candidate_id is distinct from
      '4191f0ff-e545-4501-a33c-efd3d36b30d4'::uuid
    or p_expected_tesla_control_id is distinct from
      '9b1d992d-c236-4dac-8908-726fc1eb1e3e'::uuid
    or p_now is null then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_REQUEUE_INPUT_INVALID';
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
    raise exception 'CALYPSO_TEXT_RENDERER_V2_STAGING_SCOPE_REQUIRED';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found
    or v_run.id <> '88f48603-bc28-4ee7-b9ea-44d749ef4676'::uuid then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_RUN_NOT_FOUND';
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
    or v_run.status <> 'ACTIVE'
    or v_run.stage <> 'PREPARING_IMAGE_PACKAGE'
    or v_run.worker_lease_owner is not null
    or v_run.worker_lease_token is not null
    or coalesce(v_run.worker_lease_expires_at, '-infinity'::timestamptz)
      > p_now then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_CANDIDATE_NOT_FOUND';
  end if;

  -- Tesla shares the run. Lock and snapshot its exact candidate, control and
  -- six image rows before any Calypso mutation; compare them again at the end.
  select candidate.* into v_tesla_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_expected_tesla_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_tesla_candidate.state <> 'READY_FOR_CONTENT'
    or v_tesla_candidate.machine_state <> 'PREPARING_IMAGE_PACKAGE'
    or v_tesla_candidate.blockers <> '{}'::text[]
    or v_tesla_candidate.product_research_capture_batch_id
      is distinct from '8f7cee40-6c1f-4b88-9317-ec6b83f6d0d7'::uuid
    or v_tesla_candidate.manual_handoff_package ->> 'packageHash'
      is distinct from
        '68e3f80368f9d4e4a761eac7f43d19fc62108ea17c1e6678d12872ce4a2be232'
  then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TESLA_CANDIDATE_INVALID';
  end if;
  v_tesla_candidate_snapshot := to_jsonb(v_tesla_candidate);

  select control.* into v_tesla_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_expected_tesla_control_id
    and control.run_id = v_run.id
    and control.candidate_id = p_expected_tesla_candidate_id
    and control.marketplace_account_key = p_account_key
    and control.created_by = p_actor
  for update;
  if not found
    or v_tesla_control.status <> 'PENDING_REVIEW'
    or v_tesla_control.generation_mode <> 'DETERMINISTIC_ONLY'
    or v_tesla_control.openai_calls <> 0
    or cardinality(v_tesla_control.asset_ids) <> 6
    or v_tesla_control.ebay_writes <> 0
    or v_tesla_control.production_changed
    or v_tesla_control.completed_at is null
    or v_tesla_control.lease_token is not null
    or v_tesla_control.lease_expires_at is not null then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TESLA_CONTROL_INVALID';
  end if;
  v_tesla_control_snapshot := to_jsonb(v_tesla_control);

  select coalesce(jsonb_agg(to_jsonb(asset) order by asset.id), '[]'::jsonb)
  into v_tesla_asset_snapshot
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_tesla_control.asset_ids)
    and asset.listing_package_id = v_tesla_control.listing_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor
    and asset.status = 'pending_review';
  if jsonb_array_length(v_tesla_asset_snapshot) <> 6 then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TESLA_ASSETS_INVALID';
  end if;

  v_job_key := v_run.id::text || ':' || p_candidate_id::text
    || ':GENERATE_SIX_IMAGE_PACKAGE:TEXT_RENDERER_PANGO_FONTFILE_V2:'
    || p_expected_control_id::text;
  v_transition_key := v_job_key || ':TRANSITION';
  v_event_key := 'same-day-image:' || p_expected_control_id::text
    || ':text-renderer-pango-fontfile-v2-requeue';

  -- A committed replay is read-only and succeeds only when the exact old
  -- evidence, new lane and untouched Tesla snapshots are all still present.
  if exists (
    select 1
    from public.ebay_same_day_pilot_events event
    where event.idempotency_key = v_event_key
      and event.run_id = v_run.id
      and event.candidate_id = p_candidate_id
      and event.event_type =
        'SAME_DAY_IMAGE_TEXT_RENDERER_V2_REQUEUE_CREATED'
      and event.event_payload ->> 'previousControlId'
        = p_expected_control_id::text
      and event.event_payload ->> 'previousCompletedJobId'
        = p_expected_completed_job_id::text
      and event.event_payload ->> 'captureBatchId'
        = p_expected_capture_batch_id::text
      and event.event_payload ->> 'requiredTextRendererVersion'
        = 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
      and event.ebay_writes = 0
      and not event.production_changed
  ) then
    select job.* into v_new_job
    from public.ebay_same_day_pilot_jobs job
    where job.idempotency_key = v_job_key
      and job.run_id = v_run.id
      and job.candidate_id = p_candidate_id
      and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
      and job.checkpoint ->> 'requiredTextRendererVersion'
        = 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
      and job.checkpoint ->> 'requiredBackgroundPlateQuality' = 'high'
      and job.checkpoint ->> 'maximumOpenAiCalls' = '1';
    if not found
      or v_new_job.id::text is distinct from (
        select event.event_payload ->> 'newJobId'
        from public.ebay_same_day_pilot_events event
        where event.idempotency_key = v_event_key
      )
      or not exists (
        select 1
        from public.ebay_same_day_pilot_handoffs handoff
        where handoff.id = (
          select (event.event_payload ->> 'recoveryHandoffId')::uuid
          from public.ebay_same_day_pilot_events event
          where event.idempotency_key = v_event_key
        )
          and handoff.run_id = v_run.id
          and handoff.candidate_id = p_candidate_id
          and handoff.package_data -> 'imageTextRendererRecovery'
            ->> 'requiredTextRendererVersion'
            = 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
          and handoff.package_data -> 'imageTextRendererRecovery'
            ->> 'requiredBackgroundPlateQuality' = 'high'
          and handoff.package_data -> 'imageTextRendererRecovery'
            ->> 'maximumOpenAiCalls' = '1'
          and handoff.status = 'AWAITING_IMAGE_APPROVAL'
          and handoff.openai_calls = 0
          and handoff.ebay_writes = 0
          and not handoff.production_changed
      )
      or not exists (
        select 1
        from public.ebay_same_day_pilot_jobs old_job
        where old_job.id = p_expected_completed_job_id
          and old_job.run_id = v_run.id
          and old_job.candidate_id = p_candidate_id
          and old_job.status = 'COMPLETED'
          and old_job.attempt = 1
          and old_job.last_error_code is null
          and old_job.checkpoint ->> 'packageHash'
            = '4a4d37d9d2c0024632d104a2815e19763b80aae55ad92f50cb41ee5578f91228'
      )
      or not exists (
        select 1
        from public.ebay_same_day_pilot_image_package_runs old_control
        where old_control.id = p_expected_control_id
          and old_control.run_id = v_run.id
          and old_control.candidate_id = p_candidate_id
          and old_control.status = 'REJECTED'
          and old_control.human_decision = 'REJECTED'
          and old_control.asset_ids @> v_expected_asset_ids
          and old_control.asset_ids <@ v_expected_asset_ids
          and old_control.ebay_writes = 0
          and not old_control.production_changed
      )
      or (
        select count(*)
        from public.ebay_listing_image_assets asset
        where asset.id = any(v_expected_asset_ids)
          and asset.status = 'rejected'
      ) <> 6
      or to_jsonb(v_tesla_candidate) <> v_tesla_candidate_snapshot
      or to_jsonb(v_tesla_control) <> v_tesla_control_snapshot
    then
      raise exception 'CALYPSO_TEXT_RENDERER_V2_IDEMPOTENCY_INVALID';
    end if;
    return jsonb_build_object(
      'runId', v_run.id,
      'candidateId', p_candidate_id,
      'previousControlId', p_expected_control_id,
      'previousCompletedJobId', p_expected_completed_job_id,
      'newJobId', v_new_job.id,
      'jobStatus', v_new_job.status,
      'machineState', v_candidate.machine_state,
      'textRendererVersion',
        'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21',
      'idempotent', true,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    );
  end if;

  if v_candidate.state <> 'READY_FOR_IMAGE_REVIEW'
    or v_candidate.machine_state <> 'WAITING_IMAGE_APPROVAL'
    or v_candidate.blockers <> '{}'::text[]
    or v_candidate.product_research_capture_batch_id
      is distinct from p_expected_capture_batch_id
    or v_candidate.image_package_summary ->> 'controlId'
      is distinct from p_expected_control_id::text
    or v_candidate.image_package_summary ->> 'status'
      is distinct from 'PENDING_HUMAN_REVIEW'
    or v_candidate.manual_handoff_package ->> 'packageHash'
      is distinct from
        '4a4d37d9d2c0024632d104a2815e19763b80aae55ad92f50cb41ee5578f91228'
  then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_CANDIDATE_INVALID';
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
    raise exception 'CALYPSO_TEXT_RENDERER_V2_CAPTURE_INVALID';
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
    or v_control.attempt <> 1
    or v_control.openai_calls <> 1
    or v_control.listing_package_id is distinct from
      '34608f12-b90c-4241-ac11-3b86d20f0a3e'::uuid
    or v_control.handoff_id is distinct from
      'f285d371-c580-40df-a12e-b5b81637b9b2'::uuid
    or v_control.handoff_hash is distinct from
      '4a4d37d9d2c0024632d104a2815e19763b80aae55ad92f50cb41ee5578f91228'
    or v_control.image_set_hash is distinct from
      'd752342104dfc4dddb9d05cd1b64b76b2e1d561ab3bd17d9ca74736afc23d9d2'
    or cardinality(v_control.asset_ids) <> 6
    or not (v_control.asset_ids @> v_expected_asset_ids)
    or not (v_control.asset_ids <@ v_expected_asset_ids)
    or v_control.ebay_writes <> 0
    or v_control.production_changed
    or v_control.completed_at is null
    or v_control.reviewed_at is not null
    or v_control.reviewed_by is not null
    or v_control.human_decision is not null
    or v_control.lease_token is not null
    or v_control.lease_expires_at is not null then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_CONTROL_INVALID';
  end if;
  v_control_evidence_snapshot := to_jsonb(v_control) - array[
    'status', 'reviewed_at', 'reviewed_by', 'human_decision', 'updated_at'
  ]::text[];

  select
    count(asset.id),
    count(*) filter (where
      asset.transformation ->> 'slot' = 'MAIN_WHITE_BACKGROUND'
      and asset.position = 0
      and asset.transformation ->> 'generativeAiUsed' = 'false'
      and not (asset.transformation ? 'textRendererVersion')
      and not (asset.qa_result ? 'textGlyphsValidated')
    ),
    count(*) filter (where
      asset.transformation ->> 'slot' <> 'MAIN_WHITE_BACKGROUND'
      and asset.position between 1 and 5
      and asset.transformation ->> 'generativeAiUsed' = 'true'
      and asset.transformation ->> 'authorizedSourceTreatment'
        = 'LOCAL_AUTHORIZED_FOREGROUND'
      and asset.transformation ->> 'backgroundPlateQuality' = 'high'
      and asset.transformation ->> 'foregroundMatteVersion'
        = 'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21'
      and asset.qa_result ->> 'foregroundMatteValidated' = 'true'
      and asset.qa_result ->> 'opaqueSourceFrameRemoved' = 'true'
      and asset.qa_result ->> 'textSafeAreaVerified' = 'true'
      and not (asset.transformation ? 'textRendererVersion')
      and not (asset.qa_result ? 'textGlyphsValidated')
    )
  into v_asset_count, v_main_count, v_secondary_count
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_expected_asset_ids)
    and asset.id = any(v_control.asset_ids)
    and asset.listing_package_id = v_control.listing_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor
    and asset.status = 'pending_review'
    and asset.output_width = 1600
    and asset.output_height = 1600
    and asset.transformation ->> 'compositorContractVersion'
      = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
    and asset.transformation ->> 'competitorImageUsed' = 'false'
    and asset.transformation ->> 'originalPackagePixelsPreserved' = 'true'
    and asset.transformation ->> 'verifiedFactsOnly' = 'true';
  if v_asset_count <> 6 or v_main_count <> 1 or v_secondary_count <> 5 then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TOFU_EVIDENCE_INVALID';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(asset) - array[
      'status', 'approved_at', 'approved_by', 'rejected_at',
      'published_storage_path', 'public_url', 'updated_at'
    ]::text[] order by asset.id
  ), '[]'::jsonb)
  into v_asset_evidence_snapshot
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_expected_asset_ids);

  select handoff.* into v_old_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.id = 'f285d371-c580-40df-a12e-b5b81637b9b2'::uuid
    and handoff.id = v_control.handoff_id
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
    raise exception 'CALYPSO_TEXT_RENDERER_V2_HANDOFF_INVALID';
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
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TASK_INVALID';
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
    or v_completed_job.attempt <> 1
    or v_completed_job.last_error_code is not null
    or v_completed_job.completed_at is null
    or v_completed_job.lease_owner is not null
    or v_completed_job.lease_token is not null
    or v_completed_job.lease_expires_at is not null
    or v_completed_job.checkpoint ->> 'productResearchCaptureBatchId'
      is distinct from p_expected_capture_batch_id::text
    or v_completed_job.checkpoint ->> 'packageHash'
      is distinct from v_old_handoff.package_hash
    or v_completed_job.checkpoint ->> 'requiredCompositorContractVersion'
      is distinct from 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21'
    or v_completed_job.checkpoint ->> 'requiredForegroundMatteVersion'
      is distinct from 'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21'
    or v_completed_job.checkpoint ->> 'requiredTimeoutMilliseconds'
      is distinct from '230000'
    or v_completed_job.checkpoint ->> 'maximumOpenAiCalls'
      is distinct from '1' then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_COMPLETED_JOB_INVALID';
  end if;
  v_completed_job_snapshot := to_jsonb(v_completed_job);

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
    raise exception 'CALYPSO_TEXT_RENDERER_V2_LANE_BUSY';
  end if;

  select transition_row.* into v_last_transition
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.id =
      '7e2315b6-941f-4fcd-8b17-d8abd5e419bc'::uuid
    and transition_row.run_id = v_run.id
    and transition_row.candidate_id = p_candidate_id
  for key share;
  if not found
    or v_last_transition.previous_state <> 'PREPARING_IMAGE_PACKAGE'
    or v_last_transition.next_state <> 'WAITING_IMAGE_APPROVAL'
    or v_last_transition.reason_code
      <> 'SIX_IMAGE_SET_READY_ONE_SAFE_OPENAI_BACKGROUND'
    or v_last_transition.checkpoint ->> 'controlId'
      is distinct from p_expected_control_id::text
    or exists (
      select 1
      from public.ebay_same_day_pilot_transitions newer_transition
      where newer_transition.run_id = v_run.id
        and newer_transition.candidate_id = p_candidate_id
        and (newer_transition.created_at, newer_transition.id)
          > (v_last_transition.created_at, v_last_transition.id)
    ) then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TRANSITION_INVALID';
  end if;

  v_recovery_package := v_old_handoff.package_data || jsonb_build_object(
    'imageTextRendererRecovery', jsonb_build_object(
      'version',
        'TEXT_RENDERER_PANGO_FONTFILE_V2_RECOVERY_V1_2026_07_21',
      'reason', 'VERCEL_LASTRESORT_TOFU_GLYPHS',
      'supersedesControlId', p_expected_control_id,
      'previousCompletedJobId', p_expected_completed_job_id,
      'previousHandoffId', v_old_handoff.id,
      'previousAssetIds', to_jsonb(v_expected_asset_ids),
      'previousControlAndAssetsOfficiallyRejected', true,
      'previousCompletedJobPreserved', true,
      'requiredCompositorContractVersion',
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21',
      'requiredForegroundMatteVersion',
        'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21',
      'requiredTextRendererVersion',
        'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21',
      'requiredTextGlyphValidation', true,
      'requiredBackgroundPlateQuality', 'high',
      'maximumOpenAiCalls', 1,
      'historyPreserved', true
    )
  );
  v_recovery_package_hash := encode(
    extensions.digest(v_recovery_package::text, 'sha256'), 'hex'
  );
  if v_recovery_package_hash !~ '^[0-9a-f]{64}$'
    or v_recovery_package_hash = v_old_handoff.package_hash then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_HASH_INVALID';
  end if;

  -- The official review primitive rejects only this control and updates only
  -- its exact six assets from pending_review to rejected. No row is deleted.
  v_review := public.review_ebay_same_day_pilot_image_package_set(
    p_expected_control_id, p_actor, 'REJECT', true, '[]'::jsonb
  );
  if v_review ->> 'status' is distinct from 'REJECTED'
    or v_review ->> 'controlId' is distinct from p_expected_control_id::text
    or v_review ->> 'ebayWrites' is distinct from '0'
    or v_review ->> 'productionChanged' is distinct from 'false' then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_REJECTION_FAILED';
  end if;

  select control.* into v_rejected_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_expected_control_id
  for update;
  if not found
    or v_rejected_control.status <> 'REJECTED'
    or v_rejected_control.human_decision <> 'REJECTED'
    or v_rejected_control.reviewed_by is distinct from p_actor
    or v_rejected_control.reviewed_at is null
    or (
      to_jsonb(v_rejected_control) - array[
        'status', 'reviewed_at', 'reviewed_by', 'human_decision', 'updated_at'
      ]::text[]
    ) <> v_control_evidence_snapshot then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_CONTROL_EVIDENCE_MUTATED';
  end if;

  select coalesce(jsonb_agg(
    to_jsonb(asset) - array[
      'status', 'approved_at', 'approved_by', 'rejected_at',
      'published_storage_path', 'public_url', 'updated_at'
    ]::text[] order by asset.id
  ), '[]'::jsonb)
  into v_asset_evidence_after
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_expected_asset_ids)
    and asset.status = 'rejected'
    and asset.rejected_at is not null;
  if jsonb_array_length(v_asset_evidence_after) <> 6
    or v_asset_evidence_after <> v_asset_evidence_snapshot then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_ASSET_EVIDENCE_MUTATED';
  end if;

  update public.ebay_same_day_pilot_human_tasks task
  set status = 'SUPERSEDED',
      completed_at = p_now,
      updated_at = p_now
  where task.id = v_human_task.id
    and task.status = 'OPEN';
  if not found then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TASK_PATCH_FAILED';
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
    v_old_handoff.handoff_version || ':TEXT_RENDERER_PANGO_FONTFILE_V2_V1',
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
    raise exception 'CALYPSO_TEXT_RENDERER_V2_HANDOFF_CREATE_FAILED';
  end if;

  v_checkpoint := v_completed_job.checkpoint || jsonb_build_object(
    'packageHash', v_recovery_package_hash,
    'recoveryVersion',
      'TEXT_RENDERER_PANGO_FONTFILE_V2_RECOVERY_V1_2026_07_21',
    'recoveryFromJobId', p_expected_completed_job_id,
    'recoveryFromControlId', p_expected_control_id,
    'previousHandoffId', v_old_handoff.id,
    'recoveryHandoffId', v_new_handoff.id,
    'previousAssetIds', to_jsonb(v_expected_asset_ids),
    'originalDefect', 'VERCEL_LASTRESORT_TOFU_GLYPHS',
    'previousControlAndAssetsOfficiallyRejected', true,
    'previousCompletedJobPreserved', true,
    'requiredCompositorContractVersion',
      'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V6_2026_07_21',
    'requiredForegroundMatteVersion',
      'EBAY_AUTHORIZED_FOREGROUND_MATTE_V1_2026_07_21',
    'requiredTextRendererVersion',
      'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21',
    'requiredTextGlyphValidation', true,
    'requiredBackgroundPlateQuality', 'high',
    'requiredTimeoutMilliseconds', 230000,
    'maximumOpenAiCalls', 1,
    'generationAttemptVersion',
      'TEXT_RENDERER_PANGO_FONTFILE_V2_CAPTURE_BOUND_V1_2026_07_21',
    'competitorImages', 0,
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
    'TEXT_RENDERER_V2_REQUIRED_AFTER_TOFU_GLYPHS',
    'USER',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Regenerar seis imágenes high con texto Pango/fontfile verificado.',
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
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TRANSITION_BLOCKED';
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
          'imageTextRendererRecovery',
            v_recovery_package -> 'imageTextRendererRecovery'
        ),
      image_package_summary = jsonb_build_object(
        'status', 'PREPARING_TEXT_RENDERER_V2_REGENERATION',
        'source', 'LUNA_AUTHORIZED_CATALOG',
        'count', v_old_handoff.image_count,
        'approved', false,
        'generatedImages', 0,
        'competitorImages', 0,
        'supersededControlId', p_expected_control_id,
        'preservedRejectedAssetIds', to_jsonb(v_expected_asset_ids),
        'regenerationReason', 'VERCEL_LASTRESORT_TOFU_GLYPHS',
        'requiredTextRendererVersion',
          'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21',
        'requiredBackgroundPlateQuality', 'high',
        'maximumOpenAiCalls', 1,
        'openAiCalls', 0,
        'ebayWrites', 0
      ),
      next_automated_action =
        'Regenerar seis imágenes high con texto Pango/fontfile verificado.',
      next_human_action = 'Ninguna hasta revisar el nuevo set.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE',
      stage = 'PREPARING_IMAGE_PACKAGE',
      next_automated_action =
        'Procesar la regeneración de texto verificado de Calypso.',
      next_human_action = 'Ninguna hasta revisar el nuevo set.',
      updated_at = p_now
  where run.id = v_run.id;

  select job.* into v_new_job
  from public.ebay_same_day_pilot_jobs job
  where job.idempotency_key = v_job_key
    and job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE';
  if not found
    or v_new_job.id = p_expected_completed_job_id
    or v_new_job.status <> 'PENDING'
    or v_new_job.attempt <> 0
    or v_new_job.checkpoint ->> 'requiredTextRendererVersion'
      is distinct from 'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21'
    or v_new_job.checkpoint ->> 'requiredBackgroundPlateQuality'
      is distinct from 'high'
    or v_new_job.checkpoint ->> 'maximumOpenAiCalls'
      is distinct from '1' then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_NEW_JOB_MISSING';
  end if;

  if not exists (
    select 1
    from public.ebay_same_day_pilot_jobs old_job
    where old_job.id = p_expected_completed_job_id
      and to_jsonb(old_job) = v_completed_job_snapshot
  ) then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_COMPLETED_JOB_MUTATED';
  end if;

  select candidate.* into v_tesla_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_expected_tesla_candidate_id;
  select control.* into v_tesla_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.id = p_expected_tesla_control_id;
  select coalesce(jsonb_agg(to_jsonb(asset) order by asset.id), '[]'::jsonb)
  into v_tesla_asset_after
  from public.ebay_listing_image_assets asset
  where asset.id = any(v_tesla_control.asset_ids)
    and asset.listing_package_id = v_tesla_control.listing_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor
    and asset.status = 'pending_review';
  if to_jsonb(v_tesla_candidate) <> v_tesla_candidate_snapshot
    or to_jsonb(v_tesla_control) <> v_tesla_control_snapshot
    or v_tesla_asset_after <> v_tesla_asset_snapshot then
    raise exception 'CALYPSO_TEXT_RENDERER_V2_TESLA_MUTATED';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'SAME_DAY_IMAGE_TEXT_RENDERER_V2_REQUEUE_CREATED',
    jsonb_build_object(
      'captureBatchId', p_expected_capture_batch_id,
      'previousControlId', p_expected_control_id,
      'previousCompletedJobId', p_expected_completed_job_id,
      'previousHandoffId', v_old_handoff.id,
      'previousAssetIds', to_jsonb(v_expected_asset_ids),
      'recoveryHandoffId', v_new_handoff.id,
      'newJobId', v_new_job.id,
      'requiredTextRendererVersion',
        'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21',
      'requiredTextGlyphValidation', true,
      'requiredBackgroundPlateQuality', 'high',
      'maximumOpenAiCalls', 1,
      'previousControlAndAssetsOfficiallyRejected', true,
      'previousCompletedJobPreserved', true,
      'teslaCandidateId', p_expected_tesla_candidate_id,
      'teslaControlId', p_expected_tesla_control_id,
      'teslaUnchanged', true,
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
    'textRendererVersion',
      'EBAY_IMAGE_TEXT_PANGO_FONTFILE_V2_2026_07_21',
    'requiredBackgroundPlateQuality', 'high',
    'maximumOpenAiCalls', 1,
    'previousEvidencePreserved', true,
    'teslaUnchanged', true,
    'idempotent', false,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.requeue_calypso_after_tofu_text_renderer_v2_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.requeue_calypso_after_tofu_text_renderer_v2_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz
) to service_role;

comment on function public.requeue_calypso_after_tofu_text_renderer_v2_v1(
  text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, timestamptz
) is 'Staging-only and ID-bound: officially rejects the exact Calypso tofu-text V6 set, preserves its completed job and six asset rows, appends one high-quality Pango/fontfile V2 recovery lane, proves Tesla unchanged, and performs no eBay or Production write.';

notify pgrst, 'reload schema';
