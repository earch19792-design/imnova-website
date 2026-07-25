-- Atomic human approval for the immutable Phase A position-2 evidence.
-- The verdict is append-only; only the corresponding job state is advanced.
create or replace function public.approve_ebay_reference_guided_phase_a_position_2(
  p_attempt_id uuid,
  p_output_sha256 text,
  p_reason text
) returns public.ebay_reference_guided_asset_review_events
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_plan public.ebay_reference_guided_batch_plan_successors_v2%rowtype;
  v_asset public.ebay_reference_guided_phase_a_position_2_assets%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_review public.ebay_reference_guided_asset_review_events%rowtype;
  v_manifest jsonb;
begin
  if p_reason <> 'HUMAN_CONFIRMED_SINGLE_COMPLETE_UNIT_SIDE_VIEW'
    or p_output_sha256 <>
      '7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2' then
    raise exception 'PHASE_A_POSITION_2_HUMAN_VERDICT_INVALID';
  end if;
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for update;
  if not found or v_attempt.provider_calls <> 2
    or v_attempt.max_provider_calls <> 6 or v_attempt.retry_consumed
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_ATTEMPT_INVALID';
  end if;
  select * into v_plan
  from public.ebay_reference_guided_batch_plan_successors_v2
  where attempt_id = p_attempt_id for share;
  if not found
    or v_plan.id <> 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    or v_plan.plan_hash <>
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7' then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_PLAN_INVALID';
  end if;
  select * into v_asset
  from public.ebay_reference_guided_phase_a_position_2_assets
  where successor_plan_id = v_plan.id for share;
  if not found or v_asset.position <> 2 or v_asset.asset_ordinal <> 2
    or v_asset.asset_role <> 'SECONDARY_PACKAGE_CONTENTS'
    or v_asset.source_image_id <> 'SIDE'
    or v_asset.output_sha256 <> p_output_sha256
    or v_asset.status <> 'HUMAN_REVIEW_REQUIRED'
    or v_asset.output_width <> 1600 or v_asset.output_height <> 1600
    or v_asset.background_color <> '#FFFFFF'
    or (v_asset.qa_result->'boundingBox'->>'width')::integer <> 1346
    or (v_asset.qa_result->'boundingBox'->>'height')::integer <> 944
    or (v_asset.qa_result->'boundingBox'->>'left')::integer <> 127
    or (v_asset.qa_result->'boundingBox'->>'top')::integer <> 328
    or (v_asset.qa_result->'margins'->>'left')::integer <> 127
    or (v_asset.qa_result->'margins'->>'right')::integer <> 127
    or (v_asset.qa_result->'margins'->>'top')::integer <> 328
    or (v_asset.qa_result->'margins'->>'bottom')::integer <> 328
    or (v_asset.qa_result->>'backgroundPureWhite')::boolean is distinct from true
    or (v_asset.qa_result->>'singleCompleteUnit')::boolean is distinct from true
    or (v_asset.qa_result->>'sideAngleDifferentFromPrimary')::boolean
      is distinct from true
    or (v_asset.qa_result->>'safeMargins')::boolean is distinct from true
    or (v_asset.qa_result->>'clippingDetected')::boolean is distinct from false
    or (v_asset.qa_result->>'textDetected')::boolean is distinct from false then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_EVIDENCE_INVALID';
  end if;
  begin v_manifest := v_asset.transform_manifest_text::jsonb;
  exception when others then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_MANIFEST_INVALID';
  end;
  if v_asset.transform_manifest_hash <> encode(extensions.digest(convert_to(
      v_asset.transform_manifest_text, 'UTF8'), 'sha256'), 'hex')
    or v_manifest->'source'->>'sourceImageId' <> 'SIDE'
    or v_manifest->'source'->>'sha256' <> v_asset.source_sha256
    or (v_manifest->'operation'->>'compositeInputCount')::integer <> 1
    or (v_manifest->'operation'->>'generatedPixels')::boolean
      is distinct from false
    or (v_manifest->'operation'->>'productReconstruction')::boolean
      is distinct from false then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_MANIFEST_INVALID';
  end if;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = v_asset.job_id and generation_attempt_id = p_attempt_id
    and position = 2 for update;
  if not found or v_job.commercial_role <> 'CONFIRMED_PACKAGE_CONTENTS'
    or v_job.status not in ('QA_PENDING','PASSED')
    or v_job.output_sha256 <> p_output_sha256
    or v_job.output_storage_path <> v_asset.output_storage_path
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.provider_request_id is not null
    or v_job.provider_call_started_at is not null
    or v_job.provider_call_completed_at is not null then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_JOB_INVALID';
  end if;
  if exists (select 1 from public.ebay_reference_guided_generation_jobs
    where generation_attempt_id = p_attempt_id and position between 3 and 6
      and (status <> 'PENDING' or lease_owner is not null
        or lease_expires_at is not null or provider_request_id is not null
        or provider_call_started_at is not null
        or provider_call_completed_at is not null
        or output_storage_path is not null or output_sha256 is not null)) then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_POSITIONS_3_6_CHANGED';
  end if;
  if not exists (select 1
    from public.ebay_reference_guided_final_asset_selection_events s
    where s.attempt_id = p_attempt_id and s.primary_verdict = 'APPROVED'
      and s.material_detail_verdict = 'APPROVED'
      and s.primary_sha256 = v_plan.approved_primary_sha256
      and s.material_detail_sha256 = v_plan.approved_material_detail_sha256) then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_POSITIONS_0_1_CHANGED';
  end if;
  if exists (select 1 from public.ebay_reference_guided_asset_review_events
    where attempt_id = p_attempt_id and asset_ordinal = 2
      and (preview_sha256 <> p_output_sha256 or decision <> 'APPROVED'
        or reason <> p_reason)) then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_CONFLICT';
  end if;
  insert into public.ebay_reference_guided_asset_review_events(
    attempt_id, revision_id, asset_ordinal, asset_role, preview_sha256,
    decision, reason, reviewer_id
  ) values (
    p_attempt_id, v_plan.revision_id, 2, 'SECONDARY_PACKAGE_CONTENTS',
    p_output_sha256, 'APPROVED', p_reason, v_plan.created_by
  ) on conflict (attempt_id, asset_ordinal, preview_sha256, decision)
    do nothing;
  update public.ebay_reference_guided_generation_jobs
  set status = 'PASSED', qa_result = qa_result || jsonb_build_object(
      'humanVerdict','APPROVED', 'humanVerdictReason',p_reason,
      'selectedOutputSha256',p_output_sha256), updated_at = now()
  where id = v_job.id and status = 'QA_PENDING';
  select * into v_review
  from public.ebay_reference_guided_asset_review_events
  where attempt_id = p_attempt_id and asset_ordinal = 2
    and preview_sha256 = p_output_sha256 and decision = 'APPROVED';
  if not found or v_review.reason <> p_reason then
    raise exception 'PHASE_A_POSITION_2_APPROVAL_PERSISTENCE_FAILED';
  end if;
  return v_review;
end;
$$;

revoke all on function public.approve_ebay_reference_guided_phase_a_position_2(
  uuid,text,text) from public, anon, authenticated;
grant execute on function public.approve_ebay_reference_guided_phase_a_position_2(
  uuid,text,text) to service_role;

notify pgrst, 'reload schema';
