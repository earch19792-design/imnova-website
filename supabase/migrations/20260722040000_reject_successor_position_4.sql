-- Append-only human rejection for the amended position-4 output. The provider
-- output, request, effective prompt, amendment, and all hashes remain evidence.
create table if not exists public.ebay_reference_guided_position_4_human_verdict_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  successor_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  amendment_id uuid not null references public.ebay_reference_guided_position_contract_amendments(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  authorization_event_id uuid not null references public.ebay_reference_guided_successor_provider_events(id),
  output_event_id uuid not null references public.ebay_reference_guided_successor_provider_events(id),
  position integer not null check (position = 4),
  asset_role text not null check (asset_role = 'SECONDARY_USE_CONTEXT'),
  output_storage_path text not null,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  provider_request_id text not null,
  amendment_hash text not null check (amendment_hash ~ '^[0-9a-f]{64}$'),
  effective_contract_hash text not null check (effective_contract_hash ~ '^[0-9a-f]{64}$'),
  effective_prompt_hash text not null check (effective_prompt_hash ~ '^[0-9a-f]{64}$'),
  human_verdict text not null check (human_verdict = 'REJECTED'),
  verdict_reason text not null check (
    verdict_reason = 'OVERDRAMATIC_DRAINAGE_FLOW_AND_PRODUCT_IDENTITY_UNCERTAIN'
  ),
  identity_assessment text not null check (
    identity_assessment = 'PRODUCT_IDENTITY_UNCERTAIN'
  ),
  evidence jsonb not null,
  output_preserved boolean not null check (output_preserved),
  reassigned boolean not null check (not reassigned),
  replacement_authorized boolean not null check (not replacement_authorized),
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 5),
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(attempt_id, position, output_sha256)
);

drop trigger if exists ebay_reference_guided_position_4_verdict_append_only
  on public.ebay_reference_guided_position_4_human_verdict_events;
create trigger ebay_reference_guided_position_4_verdict_append_only
before update or delete
  on public.ebay_reference_guided_position_4_human_verdict_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_position_4_human_verdict_events
  enable row level security;
alter table public.ebay_reference_guided_position_4_human_verdict_events
  force row level security;
revoke all on table public.ebay_reference_guided_position_4_human_verdict_events
  from public, anon, authenticated, service_role;
grant select, insert
  on table public.ebay_reference_guided_position_4_human_verdict_events
  to service_role;

create or replace function public.reject_ebay_reference_guided_successor_position_4(
  p_attempt_id uuid,
  p_output_sha256 text,
  p_reason text
) returns table(
  verdict_event_id uuid,
  job_status text,
  rejected_output_sha256 text,
  provider_calls integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_plan public.ebay_reference_guided_batch_plan_successors_v2%rowtype;
  v_amendment public.ebay_reference_guided_position_contract_amendments%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_job_after public.ebay_reference_guided_generation_jobs%rowtype;
  v_authorization public.ebay_reference_guided_successor_provider_events%rowtype;
  v_output public.ebay_reference_guided_successor_provider_events%rowtype;
  v_verdict public.ebay_reference_guided_position_4_human_verdict_events%rowtype;
  v_evidence jsonb := jsonb_build_object(
    'gentleWaterRequirementMet', false,
    'overdramaticWaterFlow', true,
    'jetsVisibleBelowBase', true,
    'unverifiedDrainagePerformanceImplied', true,
    'produceQuantityModerate', false,
    'exactPerforationPatternConfirmed', false,
    'baseValidatedAgainstProtectedSources', false,
    'waterBehaviorValidatedAgainstProtectedSources', false,
    'eligibleForPassed', false,
    'eligibleForPublication', false
  );
begin
  if p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or p_output_sha256 <>
      '988304aedd2ce2c7ebcd505a5e812a930d550be99a5f8fb2d2b7e61561c5d123'
    or p_reason <>
      'OVERDRAMATIC_DRAINAGE_FLOW_AND_PRODUCT_IDENTITY_UNCERTAIN' then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_INPUT_INVALID';
  end if;

  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'GENERATING'
    or v_attempt.provider_calls <> 5 or v_attempt.max_provider_calls <> 6
    or v_attempt.retry_consumed or v_attempt.ebay_writes <> 0
    or v_attempt.production_changed then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_ATTEMPT_INVALID';
  end if;

  select * into v_plan
  from public.ebay_reference_guided_batch_plan_successors_v2
  where id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid for share;
  if not found or v_plan.attempt_id <> p_attempt_id
    or v_plan.plan_hash <>
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    or v_plan.plan_hash <> encode(extensions.digest(
      convert_to(v_plan.plan_text, 'UTF8'), 'sha256'), 'hex')
    or v_plan.automatic_retries or v_plan.max_concurrency <> 2 then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_PLAN_INVALID';
  end if;

  select * into v_amendment
  from public.ebay_reference_guided_position_contract_amendments
  where id = '5fdc0614-8467-4d0c-97e9-9fc4c99828f7'::uuid
    and base_plan_id = v_plan.id and position = 4 and status = 'ACTIVE'
  for share;
  if not found or v_amendment.amendment_hash <>
      'd360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747'
    or v_amendment.effective_position_contract_hash <>
      'f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2'
    or v_amendment.effective_prompt_hash <>
      '54a052f05f8724cd43c9c3db8ce9da6409ee53cfdc057ba5762be6aea7872d40'
    or v_amendment.amendment_hash <> encode(extensions.digest(
      convert_to(v_amendment.amendment_text, 'UTF8'), 'sha256'), 'hex')
    or v_amendment.effective_prompt_hash <> encode(extensions.digest(
      convert_to(v_amendment.effective_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_amendment.effective_position_contract_hash <> encode(extensions.digest(
      convert_to(v_amendment.effective_position_contract_text, 'UTF8'),
      'sha256'), 'hex') then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_AMENDMENT_INVALID';
  end if;

  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id and position = 4 for update;
  if not found or v_job.commercial_role <> 'PRIMARY_BENEFIT_IN_ACTION'
    or v_job.status not in ('QA_PENDING','BLOCKED_FIDELITY')
    or v_job.output_sha256 <> p_output_sha256
    or coalesce(v_job.output_storage_path,'') = ''
    or v_job.provider_request_id <> 'req_204b2c7dff174a2cb395c063eb0232cd'
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.qa_result->>'automaticStatus' <> 'HUMAN_REVIEW_REQUIRED'
    or v_job.qa_result->>'amendmentHash' <> v_amendment.amendment_hash
    or v_job.qa_result->>'effectivePositionContractHash' <>
      v_amendment.effective_position_contract_hash
    or v_job.qa_result->>'effectivePromptHash' <> v_amendment.effective_prompt_hash
    or (v_job.qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (v_job.qa_result->'technicalChecks'->>'width')::integer <> 1600
    or (v_job.qa_result->'technicalChecks'->>'height')::integer <> 1600 then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_JOB_INVALID';
  end if;

  select * into v_authorization
  from public.ebay_reference_guided_successor_provider_events
  where attempt_id = p_attempt_id and successor_plan_id = v_plan.id
    and job_id = v_job.id and position = 4 and provider_call_ordinal = 5
    and event_type = 'AUTHORIZED' for share;
  select * into v_output
  from public.ebay_reference_guided_successor_provider_events
  where attempt_id = p_attempt_id and successor_plan_id = v_plan.id
    and job_id = v_job.id and position = 4 and provider_call_ordinal = 5
    and event_type = 'OUTPUT_PERSISTED' for share;
  if v_authorization.id is null or v_output.id is null
    or v_output.authorization_event_id <> v_authorization.id
    or v_output.http_status <> 200
    or v_output.provider_request_id <> v_job.provider_request_id
    or v_output.output_storage_path <> v_job.output_storage_path
    or v_output.output_sha256 <> p_output_sha256
    or v_authorization.evidence->>'amendmentHash' <> v_amendment.amendment_hash
    or v_authorization.evidence->>'effectivePositionContractHash' <>
      v_amendment.effective_position_contract_hash
    or v_authorization.evidence->>'effectivePromptHash' <>
      v_amendment.effective_prompt_hash
    or encode(extensions.digest(convert_to(
      v_authorization.evidence->>'exactPromptText', 'UTF8'), 'sha256'), 'hex') <>
      v_amendment.effective_prompt_hash
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'ebay-listing-image-staging'
        and o.name = v_job.output_storage_path
        and o.metadata->>'mimetype' = 'image/png'
    ) then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_OUTPUT_INVALID';
  end if;

  if exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id
        and (lease_owner is not null or lease_expires_at is not null)
    ) or exists (
      select 1 from public.ebay_reference_guided_successor_provider_events consumed
      where consumed.attempt_id = p_attempt_id and consumed.event_type = 'CONSUMED'
        and not exists (
          select 1 from public.ebay_reference_guided_successor_provider_events terminal
          where terminal.authorization_event_id = consumed.authorization_event_id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')
        )
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 6
        and status = 'PENDING' and lease_owner is null and lease_expires_at is null
        and provider_request_id is null and provider_call_started_at is null
        and provider_call_completed_at is null and output_storage_path is null
        and output_sha256 is null
    ) or exists (
      select 1 from public.ebay_reference_guided_successor_provider_events
      where attempt_id = p_attempt_id and position = 6
    ) then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_EXECUTION_GATE_INVALID';
  end if;

  if not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 1
        and status = 'BLOCKED_FIDELITY' and output_sha256 =
          'cc0ef29aba4ea671d64811bd5126c3a6c9d387028e330f88330de3fc9fc8aa20'
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 2
        and status = 'PASSED' and output_sha256 =
          '7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 3
        and status = 'PASSED' and output_sha256 =
          '7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da'
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 5
        and status = 'PASSED' and output_sha256 =
          'c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c'
    ) then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_OTHER_ASSETS_CHANGED';
  end if;

  if exists (
      select 1 from public.ebay_reference_guided_position_4_human_verdict_events
      where attempt_id = p_attempt_id and position = 4
        and (output_sha256 <> p_output_sha256 or human_verdict <> 'REJECTED'
          or verdict_reason <> p_reason or evidence <> v_evidence
          or output_preserved is distinct from true or reassigned
          or replacement_authorized)
    ) or exists (
      select 1 from public.ebay_reference_guided_asset_review_events
      where attempt_id = p_attempt_id and asset_ordinal = 4
        and (preview_sha256 <> p_output_sha256 or decision <> 'REJECTED'
          or reason <> p_reason)
    ) then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_CONFLICT';
  end if;

  insert into public.ebay_reference_guided_position_4_human_verdict_events(
    attempt_id, revision_id, successor_plan_id, amendment_id, job_id,
    authorization_event_id, output_event_id, position, asset_role,
    output_storage_path, output_sha256, provider_request_id, amendment_hash,
    effective_contract_hash, effective_prompt_hash, human_verdict,
    verdict_reason, identity_assessment, evidence, output_preserved,
    reassigned, replacement_authorized, provider_calls_snapshot, reviewer_id
  ) values (
    p_attempt_id, v_plan.revision_id, v_plan.id, v_amendment.id, v_job.id,
    v_authorization.id, v_output.id, 4, 'SECONDARY_USE_CONTEXT',
    v_job.output_storage_path, p_output_sha256, v_job.provider_request_id,
    v_amendment.amendment_hash, v_amendment.effective_position_contract_hash,
    v_amendment.effective_prompt_hash, 'REJECTED', p_reason,
    'PRODUCT_IDENTITY_UNCERTAIN', v_evidence, true, false, false, 5,
    v_plan.created_by
  ) on conflict (attempt_id, position, output_sha256) do nothing;

  insert into public.ebay_reference_guided_human_review_events(
    attempt_id, job_id, job_position, asset_ordinal, asset_role, verdict,
    reason, identity_assessment, output_sha256, output_preserved,
    provider_calls_snapshot, human_reviewer_id
  ) values (
    p_attempt_id, v_job.id, 4, 4, 'SECONDARY_USE_CONTEXT', 'REJECTED',
    p_reason, 'PRODUCT_IDENTITY_UNCERTAIN', p_output_sha256, true, 5,
    v_plan.created_by
  ) on conflict (attempt_id, job_id, output_sha256, verdict) do nothing;

  insert into public.ebay_reference_guided_asset_review_events(
    attempt_id, revision_id, asset_ordinal, asset_role, preview_sha256,
    decision, reason, reviewer_id
  ) values (
    p_attempt_id, v_plan.revision_id, 4, 'SECONDARY_USE_CONTEXT',
    p_output_sha256, 'REJECTED', p_reason, v_plan.created_by
  ) on conflict (attempt_id, asset_ordinal, preview_sha256, decision)
    do nothing;

  update public.ebay_reference_guided_generation_jobs
  set status = 'BLOCKED_FIDELITY', error_code = p_reason,
      qa_result = qa_result || jsonb_build_object(
        'humanVerdict','REJECTED', 'humanVerdictReason',p_reason,
        'humanIdentityAssessment','PRODUCT_IDENTITY_UNCERTAIN',
        'humanEvidence',v_evidence, 'rejectedOutputPreserved',true,
        'reassigned',false, 'replacementAuthorized',false,
        'publicationAuthorized',false
      ),
      updated_at = now()
  where id = v_job.id and status = 'QA_PENDING';

  select * into v_verdict
  from public.ebay_reference_guided_position_4_human_verdict_events
  where attempt_id = p_attempt_id and position = 4
    and output_sha256 = p_output_sha256;
  select * into v_job_after
  from public.ebay_reference_guided_generation_jobs where id = v_job.id;
  if v_verdict.id is null or v_verdict.human_verdict <> 'REJECTED'
    or v_verdict.verdict_reason <> p_reason or v_verdict.evidence <> v_evidence
    or v_job_after.status <> 'BLOCKED_FIDELITY'
    or v_job_after.error_code <> p_reason
    or v_job_after.output_sha256 <> v_job.output_sha256
    or v_job_after.output_storage_path <> v_job.output_storage_path
    or v_job_after.provider_request_id <> v_job.provider_request_id
    or v_job_after.qa_result->>'amendmentHash' <> v_amendment.amendment_hash
    or v_job_after.qa_result->>'effectivePositionContractHash' <>
      v_amendment.effective_position_contract_hash
    or v_job_after.qa_result->>'effectivePromptHash' <>
      v_amendment.effective_prompt_hash
    or (select a.provider_calls
      from public.ebay_reference_guided_generation_attempts a
      where a.id = p_attempt_id) <> 5 then
    raise exception 'SUCCESSOR_POSITION_4_REJECTION_PERSISTENCE_FAILED';
  end if;

  return query select v_verdict.id, v_job_after.status,
    v_job_after.output_sha256, 5;
end;
$$;

revoke all on function public.reject_ebay_reference_guided_successor_position_4(
  uuid,text,text) from public, anon, authenticated;
grant execute on function public.reject_ebay_reference_guided_successor_position_4(
  uuid,text,text) to service_role;

select * from public.reject_ebay_reference_guided_successor_position_4(
  'f166b395-8d3a-4921-b273-1a62a6032707'::uuid,
  '988304aedd2ce2c7ebcd505a5e812a930d550be99a5f8fb2d2b7e61561c5d123',
  'OVERDRAMATIC_DRAINAGE_FLOW_AND_PRODUCT_IDENTITY_UNCERTAIN'
);

notify pgrst, 'reload schema';
