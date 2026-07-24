-- Requeue only an unapproved seven-image V9 set whose light-neutral flood
-- matte removed a material part of an authorized white product. The exact
-- historical control and assets are officially rejected and preserved. A
-- replacement V10 facts-only handoff may change only the US description,
-- verified unit specifics, their optional warnings, version and timestamp.
-- No eBay, OpenAI or Production write is performed by this recovery.

create or replace function public.requeue_ambiguous_light_neutral_image_set_v1(
  p_account_key text,
  p_actor uuid,
  p_candidate_id uuid,
  p_expected_control_id uuid,
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
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_old_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_new_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_human_task public.ebay_same_day_pilot_human_tasks%rowtype;
  v_completed_job public.ebay_same_day_pilot_jobs%rowtype;
  v_last_transition public.ebay_same_day_pilot_transitions%rowtype;
  v_total_unit_fact jsonb;
  v_total_unit_count integer;
  v_expected_specifics jsonb;
  v_expected_warnings jsonb;
  v_review jsonb;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_transition_result text;
  v_transition_key text;
  v_job_key text;
  v_asset_ids uuid[];
begin
  if coalesce(p_account_key, '')
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_candidate_id is null
    or p_expected_control_id is null
    or p_replacement_package is null
    or jsonb_typeof(p_replacement_package) <> 'object'
    or coalesce(p_replacement_hash, '') !~ '^[0-9a-f]{64}$'
    or p_now is null then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_INPUT_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = run.id
  where candidate.id = p_candidate_id;
  if not found then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_CANDIDATE_NOT_FOUND';
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
    or v_run.status not in (
      'ACTIVE', 'PARTIALLY_READY', 'READY_FOR_OPERATOR'
    )
    or v_run.worker_lease_token is not null
    or v_run.worker_lease_owner is not null then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_RUN_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
  for update;
  if not found
    or v_candidate.machine_state <> 'WAITING_IMAGE_APPROVAL'
    or v_candidate.state <> 'READY_FOR_IMAGE_REVIEW'
    or cardinality(v_candidate.blockers) <> 0
    or v_candidate.image_package_summary ->> 'controlId'
      is distinct from p_expected_control_id::text
    or coalesce(
      (v_candidate.image_package_summary ->> 'approved')::boolean,
      false
    ) then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_CANDIDATE_INVALID';
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
    or v_control.generation_mode <> 'DETERMINISTIC_ONLY'
    or cardinality(v_control.asset_ids) <> 7
    or v_control.openai_calls <> 0
    or v_control.competitor_image_count <> 0
    or v_control.product_byte_count_sent <> 0
    or v_control.product_url_count_sent <> 0
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_CONTROL_INVALID';
  end if;
  v_asset_ids := v_control.asset_ids;

  if (
    select count(*)
    from public.ebay_listing_image_assets asset
    where asset.id = any(v_asset_ids)
      and asset.listing_package_id = v_control.listing_package_id
      and asset.account_key = p_account_key
      and asset.created_by = p_actor
      and asset.status = 'pending_review'
      and asset.output_width = 1600
      and asset.output_height = 1600
      and asset.rights_evidence_confirmed
      and asset.output_sha256 ~ '^[0-9a-f]{64}$'
      and asset.transformation ->> 'compositorContractVersion'
        = 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22'
      and asset.transformation ->> 'sourceVisualPolicy'
        = 'EXACT_AUTHORIZED_PIXELS_ONLY'
      and asset.qa_result ->> 'automaticStatus' = 'PASSED'
  ) <> 7 then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_ASSET_EVIDENCE_INVALID';
  end if;
  if (
    select count(*)
    from public.ebay_listing_image_assets asset
    where asset.id = any(v_asset_ids)
      and asset.position between 1 and 6
      and asset.transformation ->> 'foregroundMatteMethod'
        = 'EDGE_CONNECTED_LIGHT_NEUTRAL_V1'
      and coalesce(
        (asset.transformation
          ->> 'foregroundBackgroundRemovalRatio')::numeric,
        0
      ) >= 0.75
  ) <> 6 then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_DEFECT_NOT_PROVEN';
  end if;

  select handoff.* into v_old_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.id = v_control.handoff_id
    and handoff.run_id = v_run.id
    and handoff.candidate_id = p_candidate_id
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
  for key share;
  if not found
    or v_old_handoff.package_hash
      is distinct from v_control.handoff_hash
    or v_old_handoff.handoff_version
      <> 'SELLER_HUB_FACTS_ONLY_V9_2026_07_21'
    or v_old_handoff.openai_calls <> 0
    or v_old_handoff.ebay_writes <> 0
    or v_old_handoff.production_changed
    or v_candidate.manual_handoff_package ->> 'packageHash'
      is distinct from v_old_handoff.package_hash
    or v_candidate.manual_handoff_package -> 'package'
      is distinct from v_old_handoff.package_data then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_HANDOFF_INVALID';
  end if;

  select fact.value into v_total_unit_fact
  from jsonb_array_elements(
    coalesce(
      v_candidate.product_facts_summary
        -> 'authoritativeFactsPackage' -> 'facts',
      '[]'::jsonb
    )
  ) fact(value)
  where fact.value ->> 'scope' = 'OFFER_PACK'
    and fact.value ->> 'key' = 'totalUnitCount'
    and fact.value ->> 'unit' = 'count'
    and fact.value ->> 'verificationStatus' in (
      'VERIFIED', 'CORROBORATED', 'DERIVED_VERIFIED'
    )
  limit 1;
  if v_total_unit_fact is null
    or coalesce(v_total_unit_fact ->> 'value', '') !~ '^[1-9][0-9]*$'
    or (v_total_unit_fact ->> 'value')::numeric > 999 then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_UNIT_FACT_INVALID';
  end if;
  v_total_unit_count := (v_total_unit_fact ->> 'value')::integer;
  v_expected_specifics :=
    coalesce(
      v_old_handoff.package_data -> 'itemSpecifics',
      '{}'::jsonb
    ) || jsonb_build_object(
      'Unit Quantity', jsonb_build_array(v_total_unit_count::text),
      'Unit Type', jsonb_build_array('Unit')
    );
  v_expected_warnings :=
    coalesce(
      v_old_handoff.package_data -> 'qualityWarnings',
      '[]'::jsonb
    )
    - 'OPTIONAL_ASPECT_MISSING_UNIT_QUANTITY'
    - 'OPTIONAL_ASPECT_MISSING_UNIT_TYPE';

  if p_replacement_hash = v_old_handoff.package_hash
    or p_replacement_package ->> 'version'
      <> 'SELLER_HUB_FACTS_ONLY_V10_2026_07_24'
    or p_replacement_package ->> 'candidateId'
      is distinct from p_candidate_id::text
    or p_replacement_package ->> 'factRunId'
      is distinct from v_old_handoff.fact_run_id::text
    or p_replacement_package -> 'itemSpecifics'
      is distinct from v_expected_specifics
    or p_replacement_package -> 'qualityWarnings'
      is distinct from v_expected_warnings
    or coalesce(p_replacement_package ->> 'description', '') = ''
    or position(
      'Product details' in p_replacement_package ->> 'description'
    ) = 0
    or position(
      'Package quantity: ' || v_total_unit_count::text
      in p_replacement_package ->> 'description'
    ) = 0
    or p_replacement_package ->> 'description' ~
      '(Marca:|Condición:|Contenido total verificado:)'
    or coalesce(p_replacement_package ->> 'generatedAt', '') = ''
    or (
      p_replacement_package - array[
        'version', 'description', 'itemSpecifics',
        'qualityWarnings', 'generatedAt'
      ]::text[]
    ) is distinct from (
      v_old_handoff.package_data - array[
        'version', 'description', 'itemSpecifics',
        'qualityWarnings', 'generatedAt'
      ]::text[]
    ) then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_REPLACEMENT_INVALID';
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
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_TASK_INVALID';
  end if;

  select job.* into v_completed_job
  from public.ebay_same_day_pilot_jobs job
  where job.run_id = v_run.id
    and job.candidate_id = p_candidate_id
    and job.job_type = 'GENERATE_SIX_IMAGE_PACKAGE'
  order by job.created_at desc, job.id desc
  limit 1
  for update;
  if not found
    or v_completed_job.status <> 'COMPLETED'
    or v_completed_job.completed_at is null
    or v_completed_job.lease_owner is not null
    or v_completed_job.lease_token is not null
    or v_completed_job.lease_expires_at is not null
    or v_completed_job.checkpoint ->> 'packageHash'
      is distinct from v_old_handoff.package_hash then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_JOB_INVALID';
  end if;
  if exists (
    select 1
    from public.ebay_same_day_pilot_jobs active_job
    where active_job.run_id = v_run.id
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
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_LANE_BUSY';
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
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_TRANSITION_INVALID';
  end if;

  -- The official review primitive rejects exactly this unapproved control and
  -- its seven assets. It neither deletes evidence nor writes to eBay.
  v_review := public.review_ebay_same_day_pilot_image_package_set(
    p_expected_control_id, p_actor, 'REJECT', true, '[]'::jsonb
  );
  if v_review ->> 'status' is distinct from 'REJECTED'
    or v_review ->> 'controlId'
      is distinct from p_expected_control_id::text
    or v_review ->> 'ebayWrites' is distinct from '0'
    or v_review ->> 'productionChanged' is distinct from 'false' then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_REJECTION_FAILED';
  end if;
  if (
    select count(*)
    from public.ebay_listing_image_assets asset
    where asset.id = any(v_asset_ids)
      and asset.status = 'rejected'
      and asset.rejected_at is not null
  ) <> 7 then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_REJECTION_NOT_ATOMIC';
  end if;

  update public.ebay_same_day_pilot_human_tasks task
  set status = 'SUPERSEDED',
      completed_at = p_now,
      updated_at = p_now
  where task.id = v_human_task.id
    and task.status = 'OPEN';
  if not found then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_TASK_PATCH_FAILED';
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
    'SELLER_HUB_FACTS_ONLY_V10_2026_07_24',
    'AWAITING_IMAGE_APPROVAL',
    p_replacement_package,
    p_replacement_hash,
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
      and handoff.package_hash = p_replacement_hash
    for key share;
  end if;
  if not found
    or v_new_handoff.run_id <> v_run.id
    or v_new_handoff.fact_run_id <> v_old_handoff.fact_run_id
    or v_new_handoff.handoff_version
      <> 'SELLER_HUB_FACTS_ONLY_V10_2026_07_24'
    or v_new_handoff.package_data <> p_replacement_package
    or v_new_handoff.status <> 'AWAITING_IMAGE_APPROVAL'
    or v_new_handoff.openai_calls <> 0
    or v_new_handoff.ebay_writes <> 0
    or v_new_handoff.production_changed then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_HANDOFF_CREATE_FAILED';
  end if;

  v_checkpoint := v_completed_job.checkpoint || jsonb_build_object(
    'packageHash', p_replacement_hash,
    'recoveryVersion',
      'LIGHT_NEUTRAL_SEPARATION_GUARD_V1_2026_07_24',
    'recoveryFromJobId', v_completed_job.id,
    'recoveryFromControlId', p_expected_control_id,
    'previousHandoffId', v_old_handoff.id,
    'recoveryHandoffId', v_new_handoff.id,
    'previousAssetIds', to_jsonb(v_asset_ids),
    'originalDefect', 'AUTHORIZED_WHITE_PRODUCT_EROSION',
    'previousControlAndAssetsOfficiallyRejected', true,
    'previousCompletedJobPreserved', true,
    'requiredSeparationGuard',
      'AUTHORIZED_FOREGROUND_LIGHT_NEUTRAL_AMBIGUITY',
    'requiredHandoffVersion',
      'SELLER_HUB_FACTS_ONLY_V10_2026_07_24',
    'maximumOpenAiCalls', 1,
    'competitorImages', 0,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'), 'hex'
  );
  v_transition_key :=
    v_run.id::text || ':' || p_candidate_id::text
      || ':LIGHT_NEUTRAL_SEPARATION_GUARD:'
      || p_expected_control_id::text;
  v_job_key :=
    v_run.id::text || ':' || p_candidate_id::text
      || ':GENERATE_SIX_IMAGE_PACKAGE:LIGHT_NEUTRAL_SEPARATION_GUARD:'
      || p_expected_control_id::text;

  v_transition_result := public.advance_same_day_pilot_candidate(
    v_run.id,
    p_candidate_id,
    'WAITING_IMAGE_APPROVAL',
    'PREPARING_IMAGE_PACKAGE',
    'LIGHT_NEUTRAL_IMAGE_SET_SUPERSEDED',
    'RETRY',
    p_now,
    p_now,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Regenerar siete imágenes preservando el producto blanco autorizado.',
    'Ninguna hasta revisar el nuevo set completo.',
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
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_TRANSITION_BLOCKED';
  end if;

  update public.ebay_same_day_pilot_candidates candidate
  set state = 'READY_FOR_CONTENT',
      blockers = '{}'::text[],
      manual_handoff_package = jsonb_build_object(
        'status', 'AWAITING_IMAGE_APPROVAL',
        'version', v_new_handoff.handoff_version,
        'packageHash', v_new_handoff.package_hash,
        'package', v_new_handoff.package_data,
        'blockers', '[]'::jsonb,
        'warnings',
          coalesce(
            v_new_handoff.package_data -> 'qualityWarnings',
            '[]'::jsonb
          ),
        'openAiCalls', 0,
        'ebayWrites', 0,
        'lightNeutralSeparationRecovery',
          jsonb_build_object(
            'version',
              'LIGHT_NEUTRAL_SEPARATION_GUARD_V1_2026_07_24',
            'supersededControlId', p_expected_control_id,
            'historyPreserved', true
          )
      ),
      image_package_summary = jsonb_build_object(
        'status', 'PREPARING_LIGHT_NEUTRAL_SAFE_REGENERATION',
        'source', 'LUNA_AUTHORIZED_CATALOG',
        'count', v_old_handoff.image_count,
        'approved', false,
        'generatedImages', 0,
        'competitorImages', 0,
        'supersededControlId', p_expected_control_id,
        'preservedRejectedAssetIds', to_jsonb(v_asset_ids),
        'regenerationReason', 'AUTHORIZED_WHITE_PRODUCT_EROSION',
        'requiredSeparationGuard',
          'AUTHORIZED_FOREGROUND_LIGHT_NEUTRAL_AMBIGUITY',
        'openAiCalls', 0,
        'ebayWrites', 0
      ),
      next_automated_action =
        'Regenerar siete imágenes preservando el producto blanco autorizado.',
      next_human_action =
        'Ninguna hasta revisar el nuevo set completo.',
      updated_at = p_now
  where candidate.id = p_candidate_id
    and candidate.run_id = v_run.id
    and candidate.machine_state = 'PREPARING_IMAGE_PACKAGE';
  if not found then
    raise exception 'LIGHT_NEUTRAL_IMAGE_REQUEUE_CANDIDATE_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_runs run
  set status = 'ACTIVE',
      stage = 'PREPARING_IMAGE_PACKAGE',
      next_automated_action =
        'Regenerar siete imágenes preservando el producto blanco autorizado.',
      next_human_action =
        'Ninguna hasta revisar el nuevo set completo.',
      updated_at = p_now
  where run.id = v_run.id;

  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    p_candidate_id,
    'LIGHT_NEUTRAL_IMAGE_SET_SUPERSEDED',
    jsonb_build_object(
      'recoveryVersion',
        'LIGHT_NEUTRAL_SEPARATION_GUARD_V1_2026_07_24',
      'previousControlId', p_expected_control_id,
      'previousAssetCount', 7,
      'previousControlAndAssetsOfficiallyRejected', true,
      'historyPreserved', true,
      'requiredHandoffVersion',
        'SELLER_HUB_FACTS_ONLY_V10_2026_07_24',
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    'same-day-image:' || p_expected_control_id::text
      || ':light-neutral-separation-guard-v1',
    0, 0, false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'candidateId', p_candidate_id,
    'previousControlId', p_expected_control_id,
    'previousAssetCount', 7,
    'previousControlStatus', 'REJECTED',
    'newHandoffId', v_new_handoff.id,
    'newHandoffVersion', v_new_handoff.handoff_version,
    'machineState', 'PREPARING_IMAGE_PACKAGE',
    'jobStatus', 'PENDING',
    'historyPreserved', true,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.requeue_ambiguous_light_neutral_image_set_v1(
  text, uuid, uuid, uuid, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.requeue_ambiguous_light_neutral_image_set_v1(
  text, uuid, uuid, uuid, jsonb, text, timestamptz
) to service_role;

comment on function public.requeue_ambiguous_light_neutral_image_set_v1(
  text, uuid, uuid, uuid, jsonb, text, timestamptz
) is 'Officially rejects and preserves only a proven unapproved V9 light-neutral erosion set, binds the narrowly validated V10 facts-only package and requeues seven-image generation; zero eBay/OpenAI/Production effects.';

notify pgrst, 'reload schema';
