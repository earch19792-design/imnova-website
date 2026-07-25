-- Append-only human approval of extraordinary ordinal 7. This migration does
-- not authorize ordinal 8, reserve provider budget, create a lease/output,
-- contact a provider, write to eBay, or mutate Production.

create table if not exists public.ebay_reference_guided_position_4_extraordinary_human_verdict_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  correction_plan_id uuid not null references public.ebay_reference_guided_extraordinary_replacement_plans(id),
  position_binding_id uuid not null references public.ebay_reference_guided_extraordinary_replacement_positions(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  authorization_event_id uuid not null references public.ebay_reference_guided_extraordinary_authorization_events(id),
  consumed_event_id uuid not null references public.ebay_reference_guided_extraordinary_provider_events(id),
  output_event_id uuid not null references public.ebay_reference_guided_extraordinary_provider_events(id),
  position integer not null check (position=4),
  asset_role text not null check (asset_role='SECONDARY_USE_CONTEXT'),
  extraordinary_ordinal integer not null check (extraordinary_ordinal=7),
  output_storage_path text not null,
  output_sha256 text not null check (output_sha256~'^[0-9a-f]{64}$'),
  provider_request_id text not null,
  correction_batch_plan_hash text not null check (correction_batch_plan_hash~'^[0-9a-f]{64}$'),
  amendment_hash text not null check (amendment_hash~'^[0-9a-f]{64}$'),
  effective_contract_hash text not null check (effective_contract_hash~'^[0-9a-f]{64}$'),
  effective_prompt_hash text not null check (effective_prompt_hash~'^[0-9a-f]{64}$'),
  human_verdict text not null check (human_verdict='APPROVED'),
  verdict_reason text not null check (
    verdict_reason='HUMAN_CONFIRMED_CONTROLLED_USE_CONTEXT_NO_RUNNING_WATER_AND_PRODUCT_FIDELITY'
  ),
  identity_assessment text not null check (
    identity_assessment='HUMAN_CONFIRMED_PRODUCT_FIDELITY'
  ),
  evidence jsonb not null,
  rejected_outputs_preserved boolean not null check (rejected_outputs_preserved),
  position_6_authorized boolean not null check (not position_6_authorized),
  provider_calls_snapshot integer not null check (provider_calls_snapshot=7),
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(attempt_id,position,extraordinary_ordinal,output_sha256)
);

drop trigger if exists ebay_reference_guided_position_4_extraordinary_verdict_append_only
  on public.ebay_reference_guided_position_4_extraordinary_human_verdict_events;
create trigger ebay_reference_guided_position_4_extraordinary_verdict_append_only
before update or delete
  on public.ebay_reference_guided_position_4_extraordinary_human_verdict_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_position_4_extraordinary_human_verdict_events
  enable row level security;
alter table public.ebay_reference_guided_position_4_extraordinary_human_verdict_events
  force row level security;
revoke all on table public.ebay_reference_guided_position_4_extraordinary_human_verdict_events
  from public,anon,authenticated,service_role;
grant select,insert
  on table public.ebay_reference_guided_position_4_extraordinary_human_verdict_events
  to service_role;

create or replace function public.approve_ebay_reference_guided_extraordinary_position_4(
  p_attempt_id uuid,
  p_correction_plan_id uuid,
  p_output_sha256 text,
  p_provider_request_id text,
  p_reason text
) returns table(
  verdict_event_id uuid,
  job_status text,
  selected_output_sha256 text,
  selected_extraordinary_ordinal integer,
  position_6_now_eligible boolean,
  provider_calls integer
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_plan public.ebay_reference_guided_extraordinary_replacement_plans%rowtype;
  v_binding public.ebay_reference_guided_extraordinary_replacement_positions%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_job_after public.ebay_reference_guided_generation_jobs%rowtype;
  v_authorization public.ebay_reference_guided_extraordinary_authorization_events%rowtype;
  v_consumed public.ebay_reference_guided_extraordinary_provider_events%rowtype;
  v_output public.ebay_reference_guided_extraordinary_provider_events%rowtype;
  v_verdict public.ebay_reference_guided_position_4_extraordinary_human_verdict_events%rowtype;
  v_evidence jsonb:=jsonb_build_object(
    'faucetVisibleAndOff',true,
    'strawberryCountBetween4And6',true,
    'onlySmallStaticDroplets',true,
    'noRunningWaterJetsWaterfallsOrActiveDrainage',true,
    'noHandsOrHumanParts',true,
    'noTextOrAddedLogos',true,
    'completeProduct',true,
    'handlesRimBasePerforationsColorAndProportionsFaithful',true,
    'noDeformation',true,
    'noPerformanceClaims',true
  );
begin
  if p_attempt_id<>'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or p_correction_plan_id<>'7ac6e2f4-d1f7-44f8-a026-064ca474904b'::uuid
    or p_output_sha256<>'d2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24'
    or p_provider_request_id<>'req_1c6c97c6febf4af8b7af5a09d47758ac'
    or p_reason<>'HUMAN_CONFIRMED_CONTROLLED_USE_CONTEXT_NO_RUNNING_WATER_AND_PRODUCT_FIDELITY' then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_INPUT_INVALID';
  end if;

  select attempt.* into v_attempt
  from public.ebay_reference_guided_generation_attempts attempt
  where attempt.id=p_attempt_id for update;
  if not found or v_attempt.status<>'GENERATING'
    or v_attempt.provider_calls<>7 or v_attempt.max_provider_calls<>8
    or v_attempt.retry_consumed or v_attempt.ebay_writes<>0
    or v_attempt.production_changed then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_ATTEMPT_INVALID';
  end if;

  select plan.* into v_plan
  from public.ebay_reference_guided_extraordinary_replacement_plans plan
  where plan.id=p_correction_plan_id for share;
  if not found or v_plan.attempt_id<>p_attempt_id
    or v_plan.plan_hash<>'9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3'
    or v_plan.plan_hash<>encode(extensions.digest(convert_to(v_plan.plan_text,'UTF8'),'sha256'),'hex')
    or v_plan.absolute_cap<>8 or v_plan.max_concurrency<>1
    or v_plan.automatic_retries or v_plan.feature_flags_enabled then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_PLAN_INVALID';
  end if;

  select binding.* into v_binding
  from public.ebay_reference_guided_extraordinary_replacement_positions binding
  where binding.correction_plan_id=v_plan.id and binding.position=4 for share;
  if not found or v_binding.attempt_id<>p_attempt_id
    or v_binding.asset_role<>'SECONDARY_USE_CONTEXT'
    or v_binding.extraordinary_ordinal<>7
    or v_binding.amendment_id<>'cc870df1-7d04-4fb3-ab9a-4f07c978ffde'::uuid
    or v_binding.amendment_hash<>'8dbe3c4c8068a31d4c18153434faf7d7b88b25c17542cb67ad37f8aca80c1c8f'
    or v_binding.final_effective_contract_hash<>'6cac13ae461915ba22d79b381c98eb53de93bd1f052e54716f67901013ca582a'
    or v_binding.final_effective_prompt_hash<>'4aca1c9ca9623e238c2f3714a01ed8d8931779d8fd06741c8173f8e9786ced91'
    or v_binding.final_effective_prompt_hash<>encode(extensions.digest(convert_to(v_binding.final_effective_prompt_text,'UTF8'),'sha256'),'hex') then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_BINDING_INVALID';
  end if;

  select job.* into v_job from public.ebay_reference_guided_generation_jobs job
  where job.generation_attempt_id=p_attempt_id and job.position=4 for update;
  if not found or v_job.status not in ('QA_PENDING','PASSED')
    or v_job.output_sha256<>p_output_sha256
    or v_job.provider_request_id<>p_provider_request_id
    or coalesce(v_job.output_storage_path,'')=''
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.qa_result->>'automaticStatus'<>'HUMAN_REVIEW_REQUIRED'
    or v_job.qa_result->>'batchPlanHash'<>v_plan.plan_hash
    or v_job.qa_result->>'amendmentHash'<>v_binding.amendment_hash
    or v_job.qa_result->>'effectiveContractHash'<>v_binding.final_effective_contract_hash
    or v_job.qa_result->>'effectivePromptHash'<>v_binding.final_effective_prompt_hash
    or (v_job.qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (v_job.qa_result->'technicalChecks'->>'width')::integer<>1600
    or (v_job.qa_result->'technicalChecks'->>'height')::integer<>1600 then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_JOB_INVALID';
  end if;

  select auth_event.* into v_authorization
  from public.ebay_reference_guided_extraordinary_authorization_events auth_event
  where auth_event.correction_plan_id=v_plan.id and auth_event.attempt_id=p_attempt_id
    and auth_event.position=4 and auth_event.extraordinary_ordinal=7
    and auth_event.event_type='AUTHORIZED' for share;
  select consumed.* into v_consumed
  from public.ebay_reference_guided_extraordinary_provider_events consumed
  where consumed.authorization_event_id=v_authorization.id
    and consumed.event_type='CONSUMED' and consumed.position=4
    and consumed.extraordinary_ordinal=7 for share;
  select output_event.* into v_output
  from public.ebay_reference_guided_extraordinary_provider_events output_event
  where output_event.authorization_event_id=v_authorization.id
    and output_event.event_type='OUTPUT_PERSISTED'
    and output_event.consumed_event_id=v_consumed.id and output_event.position=4
    and output_event.extraordinary_ordinal=7 for share;
  if v_authorization.id is null or v_consumed.id is null or v_output.id is null
    or v_output.evidence->>'httpStatus'<>'200'
    or v_output.evidence->>'providerRequestId'<>p_provider_request_id
    or v_output.evidence->>'outputSha256'<>p_output_sha256
    or v_output.evidence->>'outputStoragePath'<>v_job.output_storage_path
    or v_consumed.evidence->>'batchPlanHash'<>v_plan.plan_hash
    or v_consumed.evidence->>'amendmentHash'<>v_binding.amendment_hash
    or v_consumed.evidence->>'effectiveContractHash'<>v_binding.final_effective_contract_hash
    or v_consumed.evidence->>'effectivePromptHash'<>v_binding.final_effective_prompt_hash
    or not exists(select 1 from storage.objects object
      where object.bucket_id='ebay-listing-image-staging'
        and object.name=v_job.output_storage_path
        and object.metadata->>'mimetype'='image/png') then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_OUTPUT_INVALID';
  end if;

  if exists(select 1 from public.ebay_reference_guided_generation_jobs job
      where job.generation_attempt_id=p_attempt_id
        and (job.lease_owner is not null or job.lease_expires_at is not null))
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events consumed
      where consumed.correction_plan_id=v_plan.id and consumed.event_type='CONSUMED'
        and not exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events terminal
          where terminal.consumed_event_id=consumed.id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')))
    or exists(select 1 from public.ebay_reference_guided_extraordinary_authorization_events authorization6
      where authorization6.correction_plan_id=v_plan.id and authorization6.position=6)
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events provider6
      where provider6.correction_plan_id=v_plan.id and provider6.position=6)
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs job6
      where job6.generation_attempt_id=p_attempt_id and job6.position=6
        and job6.status='BLOCKED_FIDELITY'
        and job6.output_sha256='0fb3b3241860c3f045ad822eb576cb0a8a11fb5b0f02cb522825c3d82bdfda14'
        and job6.lease_owner is null and job6.lease_expires_at is null) then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_POSITION_6_GATE_INVALID';
  end if;

  if not exists(select 1 from public.ebay_reference_guided_final_asset_selection_events selection
      where selection.attempt_id=p_attempt_id and selection.primary_verdict='APPROVED'
        and selection.material_detail_verdict='APPROVED')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs job2
      where job2.generation_attempt_id=p_attempt_id and job2.position=2 and job2.status='PASSED'
        and job2.output_sha256='7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs job3
      where job3.generation_attempt_id=p_attempt_id and job3.position=3 and job3.status='PASSED'
        and job3.output_sha256='7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs job5
      where job5.generation_attempt_id=p_attempt_id and job5.position=5 and job5.status='PASSED'
        and job5.output_sha256='c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c') then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_PASSED_ASSETS_CHANGED';
  end if;

  if not exists(select 1 from public.ebay_reference_guided_position_4_human_verdict_events rejected
      join storage.objects object on object.bucket_id='ebay-listing-image-staging'
        and object.name=rejected.output_storage_path
      where rejected.attempt_id=p_attempt_id and rejected.position=4
        and rejected.human_verdict='REJECTED' and rejected.output_preserved
        and rejected.output_sha256=v_binding.rejected_output_sha256
        and object.metadata->>'mimetype'='image/png') then
    raise exception 'EXTRAORDINARY_POSITION_4_REJECTED_HISTORY_NOT_PRESERVED';
  end if;

  if exists(select 1 from public.ebay_reference_guided_position_4_extraordinary_human_verdict_events verdict
      where verdict.attempt_id=p_attempt_id and verdict.position=4
        and (verdict.extraordinary_ordinal<>7 or verdict.output_sha256<>p_output_sha256
          or verdict.provider_request_id<>p_provider_request_id
          or verdict.human_verdict<>'APPROVED' or verdict.verdict_reason<>p_reason
          or verdict.evidence<>v_evidence or not verdict.rejected_outputs_preserved
          or verdict.position_6_authorized))
    or exists(select 1 from public.ebay_reference_guided_asset_review_events review
      where review.attempt_id=p_attempt_id and review.asset_ordinal=4
        and review.preview_sha256=p_output_sha256
        and (review.decision<>'APPROVED' or review.reason<>p_reason)) then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_CONFLICT';
  end if;

  insert into public.ebay_reference_guided_position_4_extraordinary_human_verdict_events(
    attempt_id,revision_id,correction_plan_id,position_binding_id,job_id,
    authorization_event_id,consumed_event_id,output_event_id,position,asset_role,
    extraordinary_ordinal,output_storage_path,output_sha256,provider_request_id,
    correction_batch_plan_hash,amendment_hash,effective_contract_hash,
    effective_prompt_hash,human_verdict,verdict_reason,identity_assessment,evidence,
    rejected_outputs_preserved,position_6_authorized,provider_calls_snapshot,reviewer_id
  ) values(p_attempt_id,v_plan.revision_id,v_plan.id,v_binding.id,v_job.id,
    v_authorization.id,v_consumed.id,v_output.id,4,'SECONDARY_USE_CONTEXT',7,
    v_job.output_storage_path,p_output_sha256,p_provider_request_id,v_plan.plan_hash,
    v_binding.amendment_hash,v_binding.final_effective_contract_hash,
    v_binding.final_effective_prompt_hash,'APPROVED',p_reason,
    'HUMAN_CONFIRMED_PRODUCT_FIDELITY',v_evidence,true,false,7,v_plan.created_by)
  on conflict(attempt_id,position,extraordinary_ordinal,output_sha256) do nothing;

  insert into public.ebay_reference_guided_human_review_events(
    attempt_id,job_id,job_position,asset_ordinal,asset_role,verdict,reason,
    identity_assessment,output_sha256,output_preserved,provider_calls_snapshot,
    human_reviewer_id
  ) values(p_attempt_id,v_job.id,4,4,'SECONDARY_USE_CONTEXT','APPROVED',p_reason,
    'HUMAN_CONFIRMED_PRODUCT_FIDELITY',p_output_sha256,true,7,v_plan.created_by)
  on conflict(attempt_id,job_id,output_sha256,verdict) do nothing;

  insert into public.ebay_reference_guided_asset_review_events(
    attempt_id,revision_id,asset_ordinal,asset_role,preview_sha256,decision,reason,reviewer_id
  ) values(p_attempt_id,v_plan.revision_id,4,'SECONDARY_USE_CONTEXT',p_output_sha256,
    'APPROVED',p_reason,v_plan.created_by)
  on conflict(attempt_id,asset_ordinal,preview_sha256,decision) do nothing;

  update public.ebay_reference_guided_generation_jobs
  set status='PASSED',error_code=null,
    qa_result=qa_result||jsonb_build_object(
      'humanVerdict','APPROVED','humanVerdictReason',p_reason,
      'humanIdentityAssessment','HUMAN_CONFIRMED_PRODUCT_FIDELITY',
      'humanEvidence',v_evidence,'selectedOutputSha256',p_output_sha256,
      'selectedExtraordinaryOrdinal',7,'rejectedOutputsPreserved',true,
      'position6Authorized',false,'publicationAuthorized',false),updated_at=now()
  where id=v_job.id and status='QA_PENDING';

  select verdict.* into v_verdict
  from public.ebay_reference_guided_position_4_extraordinary_human_verdict_events verdict
  where verdict.attempt_id=p_attempt_id and verdict.position=4
    and verdict.extraordinary_ordinal=7 and verdict.output_sha256=p_output_sha256;
  select job.* into v_job_after from public.ebay_reference_guided_generation_jobs job
  where job.id=v_job.id;
  if v_verdict.id is null or v_verdict.human_verdict<>'APPROVED'
    or v_verdict.evidence<>v_evidence or v_job_after.status<>'PASSED'
    or v_job_after.output_sha256<>p_output_sha256
    or (select attempt.provider_calls from public.ebay_reference_guided_generation_attempts attempt
      where attempt.id=p_attempt_id)<>7
    or exists(select 1 from public.ebay_reference_guided_extraordinary_authorization_events authorization6
      where authorization6.correction_plan_id=v_plan.id and authorization6.position=6) then
    raise exception 'EXTRAORDINARY_POSITION_4_APPROVAL_PERSISTENCE_FAILED';
  end if;

  return query select v_verdict.id,v_job_after.status,v_job_after.output_sha256,7,true,7;
end;
$$;

revoke all on function public.approve_ebay_reference_guided_extraordinary_position_4(
  uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.approve_ebay_reference_guided_extraordinary_position_4(
  uuid,uuid,text,text,text) to service_role;

select * from public.approve_ebay_reference_guided_extraordinary_position_4(
  'f166b395-8d3a-4921-b273-1a62a6032707'::uuid,
  '7ac6e2f4-d1f7-44f8-a026-064ca474904b'::uuid,
  'd2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24',
  'req_1c6c97c6febf4af8b7af5a09d47758ac',
  'HUMAN_CONFIRMED_CONTROLLED_USE_CONTEXT_NO_RUNNING_WATER_AND_PRODUCT_FIDELITY'
);

notify pgrst,'reload schema';
