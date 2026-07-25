-- Final human approval for the immutable successor position-3 output.
-- Human evidence is append-only. Only the exact matching job advances.
create table if not exists public.ebay_reference_guided_position_3_human_verdict_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  successor_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  position integer not null check (position = 3),
  asset_role text not null check (asset_role = 'SECONDARY_SCALE_CAPACITY'),
  output_storage_path text not null,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  provider_request_id text not null,
  human_verdict text not null check (human_verdict = 'APPROVED'),
  verdict_reason text not null check (
    verdict_reason = 'HUMAN_CONFIRMED_NON_METRIC_SCALE_CONTEXT'
  ),
  evidence jsonb not null,
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 4),
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(attempt_id, position, output_sha256)
);

drop trigger if exists ebay_reference_guided_position_3_verdict_append_only
  on public.ebay_reference_guided_position_3_human_verdict_events;
create trigger ebay_reference_guided_position_3_verdict_append_only
before update or delete
  on public.ebay_reference_guided_position_3_human_verdict_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_position_3_human_verdict_events
  enable row level security;
alter table public.ebay_reference_guided_position_3_human_verdict_events
  force row level security;
revoke all on table public.ebay_reference_guided_position_3_human_verdict_events
  from public, anon, authenticated, service_role;
grant select, insert
  on table public.ebay_reference_guided_position_3_human_verdict_events
  to service_role;

create or replace function public.approve_ebay_reference_guided_successor_position_3(
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
  v_authorization public.ebay_reference_guided_successor_provider_events%rowtype;
  v_verdict public.ebay_reference_guided_position_3_human_verdict_events%rowtype;
  v_evidence jsonb := jsonb_build_object(
    'exactProductVisuallyConsistent', true,
    'completeAndEmptyProduct', true,
    'twoHandlesRimBasePerforationsWhiteEnamelAndProportionsPreserved', true,
    'exactlyOneCommonLemonBesideProduct', true,
    'lemonAndOtherObjectsInsideAbsent', true,
    'additionalObjectsAbsent', true,
    'handsAbsent', true,
    'waterAbsent', true,
    'textNumbersRulersLinesAndMeasurementsAbsent', true,
    'dimensionAndCapacityClaimsAbsent', true,
    'everydayVisualScaleReasonable', true,
    'distinctFromPrimaryMainAndAspirationalLifestyle', true
  );
begin
  if p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or p_output_sha256 <>
      '7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da'
    or p_reason <> 'HUMAN_CONFIRMED_NON_METRIC_SCALE_CONTEXT' then
    raise exception 'SUCCESSOR_POSITION_3_HUMAN_VERDICT_INVALID';
  end if;

  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'GENERATING'
    or v_attempt.provider_calls <> 4 or v_attempt.max_provider_calls <> 6
    or v_attempt.retry_consumed or v_attempt.ebay_writes <> 0
    or v_attempt.production_changed then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_ATTEMPT_INVALID';
  end if;

  select * into v_plan
  from public.ebay_reference_guided_batch_plan_successors_v2
  where attempt_id = p_attempt_id for share;
  if not found
    or v_plan.id <> 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    or v_plan.plan_hash <>
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    or v_plan.plan_hash <> encode(extensions.digest(
      convert_to(v_plan.plan_text, 'UTF8'), 'sha256'), 'hex')
    or v_plan.automatic_retries or v_plan.max_concurrency <> 2 then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_PLAN_INVALID';
  end if;

  select * into v_position
  from public.ebay_reference_guided_batch_plan_successor_positions_v2
  where successor_plan_id = v_plan.id and position = 3 for share;
  if not found or v_position.asset_role <> 'SECONDARY_SCALE_CAPACITY'
    or v_position.commercial_objective <> 'SCALE_AND_CAPACITY_CONTEXT'
    or v_position.execution_mode <> 'PROVIDER'
    or v_position.exact_prompt_hash <> encode(extensions.digest(
      convert_to(v_position.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_position.exact_prompt_text ~* 'unitGrossWeight'
    or v_position.exact_prompt_text not like
      '%POSITION_MUST_INCLUDE MUST take priority%'
    or not (v_position.must_include @>
      '["MUST show the exact complete product, empty and dominant, on a clean counter.","MUST keep the comparison strictly non-metric."]'::jsonb)
    or not (v_position.must_exclude @>
      '["MUST NOT show hands or water.","MUST NOT display or write any capacity value.","MUST NOT infer or depict dimensions, rulers, scales, measurement marks, or package dimensions."]'::jsonb) then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_CONTRACT_INVALID';
  end if;

  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id and position = 3 for update;
  if not found or v_job.commercial_role <> 'SCALE_AND_CAPACITY_CONTEXT'
    or v_job.status not in ('QA_PENDING','PASSED')
    or v_job.output_sha256 <> p_output_sha256
    or coalesce(v_job.output_storage_path,'') = ''
    or v_job.provider_request_id <> 'req_01ae9c4060c24ad781347d0d53b9d779'
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.qa_result->>'automaticStatus' <> 'HUMAN_REVIEW_REQUIRED'
    or (v_job.qa_result->>'humanApprovalRequired')::boolean is distinct from true
    or (v_job.qa_result->>'autoApproved')::boolean is distinct from false
    or (v_job.qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (v_job.qa_result->'technicalChecks'->>'width')::integer <> 1600
    or (v_job.qa_result->'technicalChecks'->>'height')::integer <> 1600 then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_JOB_INVALID';
  end if;

  select * into v_output
  from public.ebay_reference_guided_successor_provider_events
  where attempt_id = p_attempt_id and successor_plan_id = v_plan.id
    and job_id = v_job.id and position = 3 and provider_call_ordinal = 4
    and event_type = 'OUTPUT_PERSISTED' for share;
  select * into v_authorization
  from public.ebay_reference_guided_successor_provider_events
  where attempt_id = p_attempt_id and successor_plan_id = v_plan.id
    and job_id = v_job.id and position = 3 and provider_call_ordinal = 4
    and event_type = 'AUTHORIZED' for share;
  if v_output.id is null or v_authorization.id is null
    or v_output.authorization_event_id <> v_authorization.id
    or v_output.http_status <> 200
    or v_output.provider_request_id <> v_job.provider_request_id
    or v_output.output_storage_path <> v_job.output_storage_path
    or v_output.output_sha256 <> p_output_sha256
    or v_output.evidence->>'automaticStatus' <> 'HUMAN_REVIEW_REQUIRED'
    or v_authorization.evidence->>'basePromptHash' <> v_position.exact_prompt_hash
    or v_authorization.evidence->>'exactPromptHash' <> encode(extensions.digest(
      convert_to(v_authorization.evidence->>'exactPromptText', 'UTF8'),
      'sha256'), 'hex')
    or v_authorization.evidence->>'exactPromptText' not like
      '%MUST show exactly one common lemon beside the product, never inside it.%'
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'ebay-listing-image-staging'
        and o.name = v_job.output_storage_path
        and o.metadata->>'mimetype' = 'image/png'
    ) then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_OUTPUT_INVALID';
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
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_ACTIVE_EXECUTION';
  end if;

  if exists (
    select 1 from public.ebay_reference_guided_generation_jobs
    where generation_attempt_id = p_attempt_id and position in (4,6)
      and (status <> 'PENDING' or lease_owner is not null
        or lease_expires_at is not null or provider_request_id is not null
        or provider_call_started_at is not null
        or provider_call_completed_at is not null
        or output_storage_path is not null or output_sha256 is not null)
  ) then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_POSITIONS_4_6_CHANGED';
  end if;

  if not exists (
      select 1 from public.ebay_reference_guided_final_asset_selection_events s
      where s.attempt_id = p_attempt_id and s.primary_verdict = 'APPROVED'
        and s.material_detail_verdict = 'APPROVED'
        and s.primary_sha256 = v_plan.approved_primary_sha256
        and s.material_detail_sha256 = v_plan.approved_material_detail_sha256
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs j1
      where j1.generation_attempt_id = p_attempt_id and j1.position = 1
        and j1.status = 'BLOCKED_FIDELITY'
        and j1.output_sha256 =
          'cc0ef29aba4ea671d64811bd5126c3a6c9d387028e330f88330de3fc9fc8aa20'
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs j2
      where j2.generation_attempt_id = p_attempt_id and j2.position = 2
        and j2.status = 'PASSED'
        and j2.output_sha256 =
          '7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'
    ) or not exists (
      select 1
      from public.ebay_reference_guided_position_5_human_verdict_events h5
      join public.ebay_reference_guided_generation_jobs j5 on j5.id = h5.job_id
      where h5.attempt_id = p_attempt_id and h5.position = 5
        and h5.human_verdict = 'APPROVED'
        and h5.output_sha256 =
          'c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c'
        and j5.status = 'PASSED' and j5.output_sha256 = h5.output_sha256
    ) then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_POSITIONS_0_2_5_CHANGED';
  end if;

  if exists (
    select 1 from public.ebay_reference_guided_asset_review_events
    where attempt_id = p_attempt_id and asset_ordinal = 3
      and (preview_sha256 <> p_output_sha256 or decision <> 'APPROVED'
        or reason <> p_reason)
  ) or exists (
    select 1
    from public.ebay_reference_guided_position_3_human_verdict_events
    where attempt_id = p_attempt_id and position = 3
      and (output_sha256 <> p_output_sha256 or human_verdict <> 'APPROVED'
        or verdict_reason <> p_reason or evidence <> v_evidence)
  ) then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_CONFLICT';
  end if;

  insert into public.ebay_reference_guided_position_3_human_verdict_events(
    attempt_id, revision_id, successor_plan_id, job_id, position, asset_role,
    output_storage_path, output_sha256, provider_request_id, human_verdict,
    verdict_reason, evidence, provider_calls_snapshot, reviewer_id
  ) values (
    p_attempt_id, v_plan.revision_id, v_plan.id, v_job.id, 3,
    'SECONDARY_SCALE_CAPACITY', v_job.output_storage_path, p_output_sha256,
    v_job.provider_request_id, 'APPROVED', p_reason, v_evidence, 4,
    v_plan.created_by
  ) on conflict (attempt_id, position, output_sha256) do nothing;

  insert into public.ebay_reference_guided_asset_review_events(
    attempt_id, revision_id, asset_ordinal, asset_role, preview_sha256,
    decision, reason, reviewer_id
  ) values (
    p_attempt_id, v_plan.revision_id, 3, 'SECONDARY_SCALE_CAPACITY',
    p_output_sha256, 'APPROVED', p_reason, v_plan.created_by
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
  from public.ebay_reference_guided_position_3_human_verdict_events
  where attempt_id = p_attempt_id and position = 3
    and output_sha256 = p_output_sha256;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = v_job.id;
  if not found or v_verdict.human_verdict <> 'APPROVED'
    or v_verdict.verdict_reason <> p_reason or v_verdict.evidence <> v_evidence
    or v_job.status <> 'PASSED' or v_job.output_sha256 <> p_output_sha256
    or v_attempt.provider_calls <> 4 then
    raise exception 'SUCCESSOR_POSITION_3_APPROVAL_PERSISTENCE_FAILED';
  end if;

  return query select v_verdict.id, v_job.status, v_job.output_sha256,
    v_attempt.provider_calls;
end;
$$;

revoke all on function public.approve_ebay_reference_guided_successor_position_3(
  uuid,text,text) from public, anon, authenticated;
grant execute on function public.approve_ebay_reference_guided_successor_position_3(
  uuid,text,text) to service_role;

notify pgrst, 'reload schema';
