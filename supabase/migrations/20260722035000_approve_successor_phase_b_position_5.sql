-- Final human approval for the immutable Phase B position-5 output.
-- Human evidence is append-only. Only the matching job may advance to PASSED.
create table if not exists public.ebay_reference_guided_position_5_human_verdict_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  successor_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  position integer not null check (position = 5),
  asset_role text not null check (
    asset_role = 'SECONDARY_ASPIRATIONAL_LIFESTYLE'
  ),
  output_storage_path text not null,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  provider_request_id text not null,
  human_verdict text not null check (human_verdict = 'APPROVED'),
  verdict_reason text not null check (
    verdict_reason =
      'HUMAN_CONFIRMED_ASPIRATIONAL_LIFESTYLE_IDENTITY_AND_CONTRACT'
  ),
  evidence jsonb not null,
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 3),
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(attempt_id, position, output_sha256)
);

drop trigger if exists ebay_reference_guided_position_5_verdict_append_only
  on public.ebay_reference_guided_position_5_human_verdict_events;
create trigger ebay_reference_guided_position_5_verdict_append_only
before update or delete
  on public.ebay_reference_guided_position_5_human_verdict_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_position_5_human_verdict_events
  enable row level security;
alter table public.ebay_reference_guided_position_5_human_verdict_events
  force row level security;
revoke all on table public.ebay_reference_guided_position_5_human_verdict_events
  from public, anon, authenticated, service_role;
grant select, insert
  on table public.ebay_reference_guided_position_5_human_verdict_events
  to service_role;

create or replace function public.approve_ebay_reference_guided_successor_position_5(
  p_attempt_id uuid,
  p_output_sha256 text,
  p_reason text
) returns table(
  verdict_event_id uuid,
  job_status text,
  selected_output_sha256 text,
  provider_calls integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_plan public.ebay_reference_guided_batch_plan_successors_v2%rowtype;
  v_position public.ebay_reference_guided_batch_plan_successor_positions_v2%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_output public.ebay_reference_guided_successor_provider_events%rowtype;
  v_verdict public.ebay_reference_guided_position_5_human_verdict_events%rowtype;
  v_evidence jsonb := jsonb_build_object(
    'exactProductVisuallyConsistent', true,
    'completeAndEmptyProduct', true,
    'twoCorrectHandles', true,
    'rimBasePerforationsWhiteEnamelAndProportionsPreserved', true,
    'modernBrightKitchen', true,
    'softNaturalLight', true,
    'lightlyBlurredBackground', true,
    'minimalSeparatedPropsNotIncluded', true,
    'handsAbsent', true,
    'waterAbsent', true,
    'foodInsideAbsent', true,
    'textLogosBadgesAndWatermarksAbsent', true,
    'claimsAbsent', true,
    'distinctFromPrimaryMainAndOtherPositions', true
  );
begin
  if p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or p_output_sha256 <>
      'c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c'
    or p_reason <>
      'HUMAN_CONFIRMED_ASPIRATIONAL_LIFESTYLE_IDENTITY_AND_CONTRACT' then
    raise exception 'SUCCESSOR_POSITION_5_HUMAN_VERDICT_INVALID';
  end if;

  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'GENERATING'
    or v_attempt.provider_calls <> 3 or v_attempt.max_provider_calls <> 6
    or v_attempt.retry_consumed or v_attempt.ebay_writes <> 0
    or v_attempt.production_changed then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_ATTEMPT_INVALID';
  end if;

  select * into v_plan
  from public.ebay_reference_guided_batch_plan_successors_v2
  where attempt_id = p_attempt_id for share;
  if not found
    or v_plan.id <> 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    or v_plan.plan_hash <>
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    or v_plan.automatic_retries or v_plan.max_concurrency <> 2 then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_PLAN_INVALID';
  end if;

  select * into v_position
  from public.ebay_reference_guided_batch_plan_successor_positions_v2
  where successor_plan_id = v_plan.id and position = 5 for share;
  if not found
    or v_position.asset_role <> 'SECONDARY_ASPIRATIONAL_LIFESTYLE'
    or v_position.commercial_objective <> 'ASPIRATIONAL_LIFESTYLE'
    or v_position.execution_mode <> 'PROVIDER'
    or v_position.exact_prompt_hash <> encode(extensions.digest(
      convert_to(v_position.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_position.exact_prompt_text not like
      '%POSITION_MUST_INCLUDE MUST take priority%'
    or not (v_position.must_include @>
      '["MUST show the exact empty product as the protagonist.","MUST use a modern, bright, clean kitchen.","MUST use soft natural light.","MUST use a lightly blurred background.","MUST keep props minimal and physically separated from the product."]'::jsonb)
    or not (v_position.must_exclude @>
      '["MUST NOT show hands, water, or food inside the product.","MUST NOT show product interaction.","MUST NOT add text, captions, badges, measurements, watermarks, or new logos."]'::jsonb) then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_CONTRACT_INVALID';
  end if;

  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id and position = 5 for update;
  if not found or v_job.commercial_role <> 'ASPIRATIONAL_LIFESTYLE'
    or v_job.status not in ('QA_PENDING','PASSED')
    or v_job.output_sha256 <> p_output_sha256
    or coalesce(v_job.output_storage_path,'') = ''
    or v_job.provider_request_id <> 'req_648e232719a34969986a2d93180d7bf9'
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.qa_result->>'automaticStatus' <> 'HUMAN_REVIEW_REQUIRED'
    or (v_job.qa_result->>'humanApprovalRequired')::boolean is distinct from true
    or (v_job.qa_result->>'autoApproved')::boolean is distinct from false
    or (v_job.qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (v_job.qa_result->'technicalChecks'->>'width')::integer <> 1600
    or (v_job.qa_result->'technicalChecks'->>'height')::integer <> 1600 then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_JOB_INVALID';
  end if;

  select * into v_output
  from public.ebay_reference_guided_successor_provider_events
  where attempt_id = p_attempt_id and successor_plan_id = v_plan.id
    and job_id = v_job.id and position = 5 and provider_call_ordinal = 3
    and event_type = 'OUTPUT_PERSISTED' for share;
  if not found or v_output.http_status <> 200
    or v_output.provider_request_id <> v_job.provider_request_id
    or v_output.output_storage_path <> v_job.output_storage_path
    or v_output.output_sha256 <> p_output_sha256
    or v_output.evidence->>'automaticStatus' <> 'HUMAN_REVIEW_REQUIRED'
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'ebay-listing-image-staging'
        and o.name = v_job.output_storage_path
        and o.metadata->>'mimetype' = 'image/png'
    ) then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_OUTPUT_INVALID';
  end if;

  if exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id
        and (lease_owner is not null or lease_expires_at is not null)
    ) or exists (
      select 1
      from public.ebay_reference_guided_successor_provider_events consumed
      where consumed.attempt_id = p_attempt_id
        and consumed.event_type = 'CONSUMED'
        and not exists (
          select 1
          from public.ebay_reference_guided_successor_provider_events terminal
          where terminal.authorization_event_id = consumed.authorization_event_id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')
        )
    ) then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_ACTIVE_EXECUTION';
  end if;

  if exists (
    select 1 from public.ebay_reference_guided_generation_jobs
    where generation_attempt_id = p_attempt_id and position in (3,4,6)
      and (status <> 'PENDING' or lease_owner is not null
        or lease_expires_at is not null or provider_request_id is not null
        or provider_call_started_at is not null
        or provider_call_completed_at is not null
        or output_storage_path is not null or output_sha256 is not null)
  ) then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_POSITIONS_3_4_6_CHANGED';
  end if;

  if not exists (
      select 1 from public.ebay_reference_guided_final_asset_selection_events s
      where s.attempt_id = p_attempt_id and s.primary_verdict = 'APPROVED'
        and s.material_detail_verdict = 'APPROVED'
        and s.primary_sha256 = v_plan.approved_primary_sha256
        and s.material_detail_sha256 = v_plan.approved_material_detail_sha256
    ) or not exists (
      select 1 from public.ebay_reference_guided_asset_review_events r
      where r.attempt_id = p_attempt_id and r.asset_ordinal = 2
        and r.preview_sha256 =
          '7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'
        and r.decision = 'APPROVED'
        and r.reason = 'HUMAN_CONFIRMED_SINGLE_COMPLETE_UNIT_SIDE_VIEW'
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs j
      where j.generation_attempt_id = p_attempt_id and j.position = 2
        and j.status = 'PASSED'
        and j.output_sha256 =
          '7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'
    ) then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_POSITIONS_0_2_CHANGED';
  end if;

  if exists (
    select 1 from public.ebay_reference_guided_asset_review_events
    where attempt_id = p_attempt_id and asset_ordinal = 5
      and (preview_sha256 <> p_output_sha256 or decision <> 'APPROVED'
        or reason <> p_reason)
  ) or exists (
    select 1
    from public.ebay_reference_guided_position_5_human_verdict_events
    where attempt_id = p_attempt_id and position = 5
      and (output_sha256 <> p_output_sha256 or human_verdict <> 'APPROVED'
        or verdict_reason <> p_reason or evidence <> v_evidence)
  ) then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_CONFLICT';
  end if;

  insert into public.ebay_reference_guided_position_5_human_verdict_events(
    attempt_id, revision_id, successor_plan_id, job_id, position, asset_role,
    output_storage_path, output_sha256, provider_request_id, human_verdict,
    verdict_reason, evidence, provider_calls_snapshot, reviewer_id
  ) values (
    p_attempt_id, v_plan.revision_id, v_plan.id, v_job.id, 5,
    'SECONDARY_ASPIRATIONAL_LIFESTYLE', v_job.output_storage_path,
    p_output_sha256, v_job.provider_request_id, 'APPROVED', p_reason,
    v_evidence, 3, v_plan.created_by
  ) on conflict (attempt_id, position, output_sha256) do nothing;

  insert into public.ebay_reference_guided_asset_review_events(
    attempt_id, revision_id, asset_ordinal, asset_role, preview_sha256,
    decision, reason, reviewer_id
  ) values (
    p_attempt_id, v_plan.revision_id, 5,
    'SECONDARY_ASPIRATIONAL_LIFESTYLE', p_output_sha256, 'APPROVED',
    p_reason, v_plan.created_by
  ) on conflict (attempt_id, asset_ordinal, preview_sha256, decision)
    do nothing;

  update public.ebay_reference_guided_generation_jobs
  set status = 'PASSED',
      qa_result = qa_result || jsonb_build_object(
        'humanVerdict', 'APPROVED',
        'humanVerdictReason', p_reason,
        'selectedOutputSha256', p_output_sha256,
        'humanEvidence', v_evidence,
        'publicationAuthorized', false
      ),
      updated_at = now()
  where id = v_job.id and status = 'QA_PENDING';

  select * into v_verdict
  from public.ebay_reference_guided_position_5_human_verdict_events
  where attempt_id = p_attempt_id and position = 5
    and output_sha256 = p_output_sha256;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = v_job.id;
  if not found or v_verdict.human_verdict <> 'APPROVED'
    or v_verdict.verdict_reason <> p_reason or v_verdict.evidence <> v_evidence
    or v_job.status <> 'PASSED' or v_job.output_sha256 <> p_output_sha256
    or v_attempt.provider_calls <> 3 then
    raise exception 'SUCCESSOR_POSITION_5_APPROVAL_PERSISTENCE_FAILED';
  end if;

  return query select v_verdict.id, v_job.status, v_job.output_sha256,
    v_attempt.provider_calls;
end;
$$;

revoke all on function public.approve_ebay_reference_guided_successor_position_5(
  uuid,text,text) from public, anon, authenticated;
grant execute on function public.approve_ebay_reference_guided_successor_position_5(
  uuid,text,text) to service_role;

notify pgrst, 'reload schema';
