-- Append-only human approval of extraordinary ordinal 8 and immutable
-- evidence of the exact seven-asset selected set. This migration does not
-- authorize or contact a provider, create a lease/reservation/output, approve
-- the V3 revision for publication, write to eBay, or mutate Production.

create table if not exists public.ebay_reference_guided_position_6_extraordinary_human_verdict_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  correction_plan_id uuid not null references public.ebay_reference_guided_extraordinary_replacement_plans(id),
  position_binding_id uuid not null references public.ebay_reference_guided_extraordinary_replacement_positions(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  authorization_event_id uuid not null references public.ebay_reference_guided_extraordinary_authorization_events(id),
  consumed_event_id uuid not null references public.ebay_reference_guided_extraordinary_provider_events(id),
  output_event_id uuid not null references public.ebay_reference_guided_extraordinary_provider_events(id),
  position integer not null check (position=6),
  asset_role text not null check (asset_role='SECONDARY_HUMAN_CONTEXT'),
  extraordinary_ordinal integer not null check (extraordinary_ordinal=8),
  output_storage_path text not null,
  output_sha256 text not null check (output_sha256~'^[0-9a-f]{64}$'),
  provider_request_id text not null,
  correction_batch_plan_hash text not null check (correction_batch_plan_hash~'^[0-9a-f]{64}$'),
  amendment_hash text not null check (amendment_hash~'^[0-9a-f]{64}$'),
  effective_contract_hash text not null check (effective_contract_hash~'^[0-9a-f]{64}$'),
  effective_prompt_hash text not null check (effective_prompt_hash~'^[0-9a-f]{64}$'),
  human_verdict text not null check (human_verdict='APPROVED'),
  verdict_reason text not null check (
    verdict_reason='HUMAN_CONFIRMED_EXACT_TWO_HANDS_ONE_PER_HANDLE_NATURAL_ANATOMY_EMPTY_PROP_FREE_BACKGROUND_PRODUCT_EMPTY_AND_IDENTITY_PRESERVED'
  ),
  evidence jsonb not null,
  rejected_output_preserved boolean not null check (rejected_output_preserved),
  selected_assets jsonb not null check (jsonb_typeof(selected_assets)='array'),
  final_set_hash text not null check (final_set_hash~'^[0-9a-f]{64}$'),
  final_set_atomic_gate boolean not null check (final_set_atomic_gate),
  publication_authorized boolean not null check (not publication_authorized),
  provider_calls_snapshot integer not null check (provider_calls_snapshot=8),
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(attempt_id,position,extraordinary_ordinal,output_sha256)
);

drop trigger if exists ebay_reference_guided_position_6_extraordinary_verdict_append_only
  on public.ebay_reference_guided_position_6_extraordinary_human_verdict_events;
create trigger ebay_reference_guided_position_6_extraordinary_verdict_append_only
before update or delete
  on public.ebay_reference_guided_position_6_extraordinary_human_verdict_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_position_6_extraordinary_human_verdict_events
  enable row level security;
alter table public.ebay_reference_guided_position_6_extraordinary_human_verdict_events
  force row level security;
revoke all on table public.ebay_reference_guided_position_6_extraordinary_human_verdict_events
  from public,anon,authenticated,service_role;
grant select,insert
  on table public.ebay_reference_guided_position_6_extraordinary_human_verdict_events
  to service_role;

create or replace function public.approve_ebay_reference_guided_extraordinary_position_6(
  p_attempt_id uuid,
  p_correction_plan_id uuid,
  p_output_sha256 text,
  p_reason text
) returns table(
  verdict_event_id uuid,
  job_status text,
  selected_output_sha256 text,
  selected_extraordinary_ordinal integer,
  all_seven_selected boolean,
  final_set_atomic_gate boolean,
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
  v_rejected public.ebay_reference_guided_position_6_human_verdict_events%rowtype;
  v_selection public.ebay_reference_guided_final_asset_selection_events%rowtype;
  v_primary public.ebay_reference_guided_deterministic_asset_variants%rowtype;
  v_material public.ebay_reference_guided_deterministic_asset_variants%rowtype;
  v_position_2 public.ebay_reference_guided_phase_a_position_2_assets%rowtype;
  v_position_3 public.ebay_reference_guided_generation_jobs%rowtype;
  v_position_4 public.ebay_reference_guided_generation_jobs%rowtype;
  v_position_5 public.ebay_reference_guided_generation_jobs%rowtype;
  v_position_4_verdict public.ebay_reference_guided_position_4_extraordinary_human_verdict_events%rowtype;
  v_verdict public.ebay_reference_guided_position_6_extraordinary_human_verdict_events%rowtype;
  v_selected_assets jsonb;
  v_final_set_hash text;
  v_evidence jsonb:=jsonb_build_object(
    'exactlyTwoAdultHands',true,
    'oneHandPerHandle',true,
    'naturalAnatomy',true,
    'productCompleteEmptyAndCentered',true,
    'emptyPropFreeKitchenBackground',true,
    'noWaterFoodUtensilsTextLogosOrJewelry',true,
    'productIdentityPreserved',true,
    'rejectedOutputPreserved',true,
    'publicationAuthorized',false
  );
begin
  if p_attempt_id<>'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or p_correction_plan_id<>'7ac6e2f4-d1f7-44f8-a026-064ca474904b'::uuid
    or p_output_sha256<>'a8fa2ce661850c386697cc762962c33376cdc2cd4d28b340f0c0c232de8b3c84'
    or p_reason<>'HUMAN_CONFIRMED_EXACT_TWO_HANDS_ONE_PER_HANDLE_NATURAL_ANATOMY_EMPTY_PROP_FREE_BACKGROUND_PRODUCT_EMPTY_AND_IDENTITY_PRESERVED' then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_INPUT_INVALID';
  end if;

  select attempt.* into v_attempt
  from public.ebay_reference_guided_generation_attempts attempt
  where attempt.id=p_attempt_id for update;
  if not found or v_attempt.status<>'GENERATING'
    or v_attempt.provider_calls<>8 or v_attempt.max_provider_calls<>8
    or v_attempt.retry_consumed or v_attempt.ebay_writes<>0
    or v_attempt.production_changed then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_ATTEMPT_INVALID';
  end if;

  select plan.* into v_plan
  from public.ebay_reference_guided_extraordinary_replacement_plans plan
  where plan.id=p_correction_plan_id for share;
  if not found or v_plan.attempt_id<>p_attempt_id
    or v_plan.plan_hash<>'9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3'
    or v_plan.plan_hash<>encode(extensions.digest(convert_to(v_plan.plan_text,'UTF8'),'sha256'),'hex')
    or v_plan.absolute_cap<>8 or v_plan.max_concurrency<>1
    or v_plan.automatic_retries or v_plan.feature_flags_enabled then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_PLAN_INVALID';
  end if;

  select binding.* into v_binding
  from public.ebay_reference_guided_extraordinary_replacement_positions binding
  where binding.correction_plan_id=v_plan.id and binding.position=6 for share;
  if not found or v_binding.attempt_id<>p_attempt_id
    or v_binding.asset_role<>'SECONDARY_HUMAN_CONTEXT'
    or v_binding.extraordinary_ordinal<>8
    or v_binding.amendment_id<>'322226f9-31d0-4881-987d-1040d56a650a'::uuid
    or v_binding.amendment_hash<>'cfa89ed6ceebc0f6899af917d9cc114638d4b4840e46f0dd37990f0f291c049a'
    or v_binding.final_effective_contract_hash<>'2f24eb0993cd71a076e1229fcf54cbdf629cecc85368157cf4247c8bc0909347'
    or v_binding.final_effective_prompt_hash<>'ac8c72b757de68715bd7517460f5b69365305202b7a2a297e2636b128aecdb65'
    or v_binding.final_effective_prompt_hash<>encode(extensions.digest(
      convert_to(v_binding.final_effective_prompt_text,'UTF8'),'sha256'),'hex') then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_BINDING_INVALID';
  end if;

  select job.* into v_job
  from public.ebay_reference_guided_generation_jobs job
  where job.generation_attempt_id=p_attempt_id and job.position=6 for update;
  if not found or v_job.commercial_role<>'REAL_HUMAN_USE'
    or v_job.status not in ('QA_PENDING','PASSED')
    or v_job.output_sha256<>p_output_sha256
    or v_job.provider_request_id<>'req_036716f8abc04cada1b3384c459ebf7b'
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
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_JOB_INVALID';
  end if;

  select auth_event.* into v_authorization
  from public.ebay_reference_guided_extraordinary_authorization_events auth_event
  where auth_event.correction_plan_id=v_plan.id and auth_event.attempt_id=p_attempt_id
    and auth_event.position=6 and auth_event.extraordinary_ordinal=8
    and auth_event.event_type='AUTHORIZED' for share;
  select consumed.* into v_consumed
  from public.ebay_reference_guided_extraordinary_provider_events consumed
  where consumed.authorization_event_id=v_authorization.id
    and consumed.event_type='CONSUMED' and consumed.position=6
    and consumed.extraordinary_ordinal=8 for share;
  select output_event.* into v_output
  from public.ebay_reference_guided_extraordinary_provider_events output_event
  where output_event.authorization_event_id=v_authorization.id
    and output_event.event_type='OUTPUT_PERSISTED'
    and output_event.consumed_event_id=v_consumed.id and output_event.position=6
    and output_event.extraordinary_ordinal=8 for share;
  if v_authorization.id is null or v_consumed.id is null or v_output.id is null
    or v_output.evidence->>'httpStatus'<>'200'
    or v_output.evidence->>'providerRequestId'<>v_job.provider_request_id
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
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_OUTPUT_INVALID';
  end if;

  if exists(select 1 from public.ebay_reference_guided_generation_jobs job
      where job.generation_attempt_id=p_attempt_id
        and (job.lease_owner is not null or job.lease_expires_at is not null))
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events consumed
      where consumed.correction_plan_id=v_plan.id and consumed.event_type='CONSUMED'
        and not exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events terminal
          where terminal.consumed_event_id=consumed.id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL'))) then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_EXECUTION_GATE_INVALID';
  end if;

  select verdict.* into v_rejected
  from public.ebay_reference_guided_position_6_human_verdict_events verdict
  where verdict.attempt_id=p_attempt_id and verdict.position=6
    and verdict.output_sha256=v_binding.rejected_output_sha256
    and verdict.human_verdict='REJECTED' and verdict.output_preserved for share;
  if v_rejected.id is null or v_rejected.reassigned or v_rejected.replacement_authorized
    or not exists(select 1 from storage.objects object
      where object.bucket_id='ebay-listing-image-staging'
        and object.name=v_rejected.output_storage_path
        and object.metadata->>'mimetype'='image/png') then
    raise exception 'EXTRAORDINARY_POSITION_6_REJECTED_HISTORY_NOT_PRESERVED';
  end if;

  select selection.* into v_selection
  from public.ebay_reference_guided_final_asset_selection_events selection
  where selection.attempt_id=p_attempt_id for share;
  select variant.* into v_primary
  from public.ebay_reference_guided_deterministic_asset_variants variant
  where variant.attempt_id=p_attempt_id and variant.asset_ordinal=0
    and variant.output_sha256=v_selection.primary_sha256 for share;
  select variant.* into v_material
  from public.ebay_reference_guided_deterministic_asset_variants variant
  where variant.attempt_id=p_attempt_id and variant.asset_ordinal=1
    and variant.output_sha256=v_selection.material_detail_sha256 for share;
  select asset.* into v_position_2
  from public.ebay_reference_guided_phase_a_position_2_assets asset
  where asset.attempt_id=p_attempt_id and asset.position=2 for share;
  select job.* into v_position_3 from public.ebay_reference_guided_generation_jobs job
  where job.generation_attempt_id=p_attempt_id and job.position=3 for share;
  select job.* into v_position_4 from public.ebay_reference_guided_generation_jobs job
  where job.generation_attempt_id=p_attempt_id and job.position=4 for share;
  select job.* into v_position_5 from public.ebay_reference_guided_generation_jobs job
  where job.generation_attempt_id=p_attempt_id and job.position=5 for share;
  select verdict.* into v_position_4_verdict
  from public.ebay_reference_guided_position_4_extraordinary_human_verdict_events verdict
  where verdict.attempt_id=p_attempt_id and verdict.position=4
    and verdict.extraordinary_ordinal=7 and verdict.human_verdict='APPROVED' for share;

  if v_selection.id is null or v_selection.primary_verdict<>'APPROVED'
    or v_selection.material_detail_verdict<>'APPROVED'
    or v_selection.primary_sha256<>'44c7c5d832c4dd655fcc4a4865c51779406662c438a3e6ff5239606360cef3ba'
    or v_selection.material_detail_sha256<>'38a8a2134ea3f1ce6415df061ee293690d09f6f8da82e66660b156eda6d53464'
    or v_primary.id is null or v_primary.asset_role<>'PRIMARY_MAIN'
    or v_material.id is null or v_material.asset_role<>'SECONDARY_MATERIAL_DETAIL'
    or v_position_2.id is null or v_position_2.asset_role<>'SECONDARY_PACKAGE_CONTENTS'
    or v_position_2.output_sha256<>'7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'
    or v_position_3.status<>'PASSED'
    or v_position_3.output_sha256<>'7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da'
    or v_position_4.status<>'PASSED'
    or v_position_4.output_sha256<>'d2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24'
    or v_position_4_verdict.id is null
    or v_position_5.status<>'PASSED'
    or v_position_5.output_sha256<>'c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c' then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_SELECTED_ASSETS_INVALID';
  end if;

  if (select count(*) from public.ebay_reference_guided_asset_review_events review
      where review.attempt_id=p_attempt_id and review.decision='APPROVED'
        and (review.asset_ordinal,review.asset_role,review.preview_sha256) in (
          (0,'PRIMARY_MAIN','44c7c5d832c4dd655fcc4a4865c51779406662c438a3e6ff5239606360cef3ba'),
          (1,'SECONDARY_MATERIAL_DETAIL','38a8a2134ea3f1ce6415df061ee293690d09f6f8da82e66660b156eda6d53464'),
          (2,'SECONDARY_PACKAGE_CONTENTS','7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'),
          (3,'SECONDARY_SCALE_CAPACITY','7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da'),
          (4,'SECONDARY_USE_CONTEXT','d2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24'),
          (5,'SECONDARY_ASPIRATIONAL_LIFESTYLE','c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c')
        ))<>6 then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_PRIOR_REVIEWS_INVALID';
  end if;

  v_selected_assets:=jsonb_build_array(
    jsonb_build_object('position',0,'assetRole','PRIMARY_MAIN','status','PASSED',
      'sha256',v_selection.primary_sha256,'storagePath',v_primary.output_storage_path),
    jsonb_build_object('position',1,'assetRole','SECONDARY_MATERIAL_DETAIL','status','PASSED',
      'sha256',v_selection.material_detail_sha256,'storagePath',v_material.output_storage_path),
    jsonb_build_object('position',2,'assetRole','SECONDARY_PACKAGE_CONTENTS','status','PASSED',
      'sha256',v_position_2.output_sha256,'storagePath',v_position_2.output_storage_path),
    jsonb_build_object('position',3,'assetRole','SECONDARY_SCALE_CAPACITY','status','PASSED',
      'sha256',v_position_3.output_sha256,'storagePath',v_position_3.output_storage_path),
    jsonb_build_object('position',4,'assetRole','SECONDARY_USE_CONTEXT','status','PASSED',
      'sha256',v_position_4.output_sha256,'storagePath',v_position_4.output_storage_path),
    jsonb_build_object('position',5,'assetRole','SECONDARY_ASPIRATIONAL_LIFESTYLE','status','PASSED',
      'sha256',v_position_5.output_sha256,'storagePath',v_position_5.output_storage_path),
    jsonb_build_object('position',6,'assetRole','SECONDARY_HUMAN_CONTEXT','status','PASSED',
      'sha256',v_job.output_sha256,'storagePath',v_job.output_storage_path)
  );
  v_final_set_hash:=encode(extensions.digest(
    convert_to(v_selected_assets::text,'UTF8'),'sha256'),'hex');
  if jsonb_array_length(v_selected_assets)<>7
    or (select count(distinct asset->>'sha256')
      from jsonb_array_elements(v_selected_assets) asset)<>7
    or (select count(*) from jsonb_array_elements(v_selected_assets) asset
      where asset->>'status'='PASSED')<>7
    or exists(select 1 from jsonb_array_elements(v_selected_assets) asset
      where not exists(select 1 from storage.objects object
        where object.bucket_id='ebay-listing-image-staging'
          and object.name=asset->>'storagePath'
          and object.metadata->>'mimetype'='image/png')) then
    raise exception 'EXTRAORDINARY_POSITION_6_FINAL_SET_ATOMIC_GATE_INVALID';
  end if;

  if exists(select 1
      from public.ebay_reference_guided_position_6_extraordinary_human_verdict_events verdict
      where verdict.attempt_id=p_attempt_id and verdict.position=6
        and (verdict.extraordinary_ordinal<>8 or verdict.output_sha256<>p_output_sha256
          or verdict.human_verdict<>'APPROVED' or verdict.verdict_reason<>p_reason
          or verdict.evidence<>v_evidence or not verdict.rejected_output_preserved
          or verdict.selected_assets<>v_selected_assets
          or verdict.final_set_hash<>v_final_set_hash
          or not verdict.final_set_atomic_gate or verdict.publication_authorized))
    or exists(select 1 from public.ebay_reference_guided_asset_review_events review
      where review.attempt_id=p_attempt_id and review.asset_ordinal=6
        and review.preview_sha256=p_output_sha256
        and (review.decision<>'APPROVED' or review.reason<>p_reason)) then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_CONFLICT';
  end if;

  insert into public.ebay_reference_guided_position_6_extraordinary_human_verdict_events(
    attempt_id,revision_id,correction_plan_id,position_binding_id,job_id,
    authorization_event_id,consumed_event_id,output_event_id,position,asset_role,
    extraordinary_ordinal,output_storage_path,output_sha256,provider_request_id,
    correction_batch_plan_hash,amendment_hash,effective_contract_hash,
    effective_prompt_hash,human_verdict,verdict_reason,evidence,
    rejected_output_preserved,selected_assets,final_set_hash,
    final_set_atomic_gate,publication_authorized,provider_calls_snapshot,reviewer_id
  ) values(p_attempt_id,v_plan.revision_id,v_plan.id,v_binding.id,v_job.id,
    v_authorization.id,v_consumed.id,v_output.id,6,'SECONDARY_HUMAN_CONTEXT',8,
    v_job.output_storage_path,p_output_sha256,v_job.provider_request_id,v_plan.plan_hash,
    v_binding.amendment_hash,v_binding.final_effective_contract_hash,
    v_binding.final_effective_prompt_hash,'APPROVED',p_reason,v_evidence,true,
    v_selected_assets,v_final_set_hash,true,false,8,v_plan.created_by)
  on conflict(attempt_id,position,extraordinary_ordinal,output_sha256) do nothing;

  insert into public.ebay_reference_guided_human_review_events(
    attempt_id,job_id,job_position,asset_ordinal,asset_role,verdict,reason,
    identity_assessment,output_sha256,output_preserved,provider_calls_snapshot,
    human_reviewer_id
  ) values(p_attempt_id,v_job.id,6,6,'SECONDARY_HUMAN_CONTEXT','APPROVED',p_reason,
    'HUMAN_CONFIRMED_PRODUCT_IDENTITY_AND_CONTRACT',p_output_sha256,true,8,
    v_plan.created_by)
  on conflict(attempt_id,job_id,output_sha256,verdict) do nothing;

  insert into public.ebay_reference_guided_asset_review_events(
    attempt_id,revision_id,asset_ordinal,asset_role,preview_sha256,decision,reason,reviewer_id
  ) values(p_attempt_id,v_plan.revision_id,6,'SECONDARY_HUMAN_CONTEXT',p_output_sha256,
    'APPROVED',p_reason,v_plan.created_by)
  on conflict(attempt_id,asset_ordinal,preview_sha256,decision) do nothing;

  update public.ebay_reference_guided_generation_jobs
  set status='PASSED',error_code=null,
    qa_result=qa_result||jsonb_build_object(
      'humanVerdict','APPROVED','humanVerdictReason',p_reason,
      'humanEvidence',v_evidence,'selectedOutputSha256',p_output_sha256,
      'selectedExtraordinaryOrdinal',8,'rejectedOutputPreserved',true,
      'finalSetHash',v_final_set_hash,'finalSetAtomicGate',true,
      'publicationAuthorized',false),updated_at=now()
  where id=v_job.id and status='QA_PENDING';

  select verdict.* into v_verdict
  from public.ebay_reference_guided_position_6_extraordinary_human_verdict_events verdict
  where verdict.attempt_id=p_attempt_id and verdict.position=6
    and verdict.extraordinary_ordinal=8 and verdict.output_sha256=p_output_sha256;
  select job.* into v_job_after
  from public.ebay_reference_guided_generation_jobs job where job.id=v_job.id;
  if v_verdict.id is null or v_verdict.human_verdict<>'APPROVED'
    or v_verdict.selected_assets<>v_selected_assets
    or not v_verdict.final_set_atomic_gate or v_verdict.publication_authorized
    or v_job_after.status<>'PASSED' or v_job_after.output_sha256<>p_output_sha256
    or (select attempt.provider_calls
      from public.ebay_reference_guided_generation_attempts attempt
      where attempt.id=p_attempt_id)<>8 then
    raise exception 'EXTRAORDINARY_POSITION_6_APPROVAL_PERSISTENCE_FAILED';
  end if;

  return query select v_verdict.id,v_job_after.status,v_job_after.output_sha256,
    8,true,true,8;
end;
$$;

revoke all on function public.approve_ebay_reference_guided_extraordinary_position_6(
  uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.approve_ebay_reference_guided_extraordinary_position_6(
  uuid,uuid,text,text) to service_role;

select * from public.approve_ebay_reference_guided_extraordinary_position_6(
  'f166b395-8d3a-4921-b273-1a62a6032707'::uuid,
  '7ac6e2f4-d1f7-44f8-a026-064ca474904b'::uuid,
  'a8fa2ce661850c386697cc762962c33376cdc2cd4d28b340f0c0c232de8b3c84',
  'HUMAN_CONFIRMED_EXACT_TWO_HANDS_ONE_PER_HANDLE_NATURAL_ANATOMY_EMPTY_PROP_FREE_BACKGROUND_PRODUCT_EMPTY_AND_IDENTITY_PRESERVED'
);

notify pgrst,'reload schema';
