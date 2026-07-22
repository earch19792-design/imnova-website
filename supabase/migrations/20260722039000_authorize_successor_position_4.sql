-- One human-authorized provider call for successor V2 position 4. The exact
-- effective prompt and contract are resolved from the active append-only
-- amendment. Browser input never supplies any visual authority.
with resolved as (
  select * from public.resolve_ebay_reference_guided_position_4_effective_contract(
    'f166b395-8d3a-4921-b273-1a62a6032707'::uuid)
), eligible as (
  select plan.id as successor_plan_id, plan.attempt_id, plan.created_by,
    j.id as job_id, r.*
  from resolved r
  join public.ebay_reference_guided_batch_plan_successors_v2 plan
    on plan.id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
  join public.ebay_reference_guided_generation_jobs j
    on j.generation_attempt_id = plan.attempt_id and j.position = 4
  where plan.plan_hash =
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    and r.amendment_id = '5fdc0614-8467-4d0c-97e9-9fc4c99828f7'::uuid
    and r.amendment_hash =
      'd360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747'
    and r.effective_position_contract_hash =
      'f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2'
    and r.effective_prompt_hash =
      '54a052f05f8724cd43c9c3db8ce9da6409ee53cfdc057ba5762be6aea7872d40'
)
insert into public.ebay_reference_guided_successor_provider_events(
  attempt_id, successor_plan_id, job_id, position, event_type,
  provider_call_ordinal, human_authorized_by, human_authorized_at,
  human_confirmation_hash, reason, evidence
)
select attempt_id, successor_plan_id, job_id, 4, 'AUTHORIZED', 5,
  created_by, now(), encode(extensions.digest(convert_to(
    'AUTHORIZE_SUCCESSOR_POSITION_4|ATTEMPT=f166b395-8d3a-4921-b273-1a62a6032707|PLAN=c54a0bbc-b16c-47b3-8f4e-93d2152e3b34|PLAN_HASH=a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7|POSITION=4|ASSET_ROLE=SECONDARY_USE_CONTEXT|AMENDMENT_ID=5fdc0614-8467-4d0c-97e9-9fc4c99828f7|AMENDMENT_HASH=d360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747|EFFECTIVE_CONTRACT_HASH=f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2|EFFECTIVE_PROMPT_HASH=54a052f05f8724cd43c9c3db8ce9da6409ee53cfdc057ba5762be6aea7872d40|MAX_CALLS=1',
    'UTF8'), 'sha256'), 'hex'),
  'EXPLICIT_HUMAN_AUTHORIZATION_SINGLE_POSITION_4_PROVIDER_CALL',
  jsonb_build_object(
    'model','gpt-image-2', 'endpoint','/v1/images/edits',
    'size','1600x1600', 'quality','high', 'outputFormat','png',
    'sourceOrder',jsonb_build_array('MAIN','SIDE'),
    'automaticRetries',false, 'maximumAuthorizedCallsThisPhase',1,
    'amendmentId',amendment_id,
    'amendmentHash',amendment_hash,
    'effectivePositionContractHash',effective_position_contract_hash,
    'exactPromptText',effective_prompt_text,
    'effectivePromptHash',effective_prompt_hash,
    'contractOverlayVersion','POSITION_4_CONTRACT_AMENDMENT_V1_2026_07_22'
  )
from eligible
on conflict do nothing;

do $authorization_check$
begin
  if not exists (
    select 1
    from public.ebay_reference_guided_successor_provider_events e
    where e.attempt_id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
      and e.successor_plan_id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
      and e.position = 4 and e.provider_call_ordinal = 5
      and e.event_type = 'AUTHORIZED'
      and e.reason =
        'EXPLICIT_HUMAN_AUTHORIZATION_SINGLE_POSITION_4_PROVIDER_CALL'
      and e.evidence->>'amendmentHash' =
        'd360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747'
      and e.evidence->>'effectivePositionContractHash' =
        'f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2'
      and e.evidence->>'effectivePromptHash' = encode(extensions.digest(
        convert_to(e.evidence->>'exactPromptText', 'UTF8'), 'sha256'), 'hex')
      and e.evidence->>'exactPromptText' like
        '%POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image.%'
  ) then
    raise exception 'SUCCESSOR_POSITION_4_AUTHORIZATION_NOT_PERSISTED';
  end if;
end;
$authorization_check$;

create or replace function public.consume_ebay_reference_guided_successor_position_4(
  p_successor_plan_id uuid,
  p_human_confirmation_hash text,
  p_lease_owner text,
  p_feature_enabled boolean default false
) returns table(
  authorization_event_id uuid,
  job_id uuid,
  exact_prompt_text text,
  exact_prompt_hash text,
  amendment_id uuid,
  amendment_hash text,
  effective_position_contract_hash text,
  main_source_hash text,
  main_storage_path text,
  side_source_hash text,
  side_storage_path text,
  provider_calls integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_plan public.ebay_reference_guided_batch_plan_successors_v2%rowtype;
  v_position public.ebay_reference_guided_batch_plan_successor_positions_v2%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_binding public.luna_catalog_source_pack_dossier_bindings%rowtype;
  v_pack public.luna_catalog_authorized_source_packs%rowtype;
  v_authorization public.ebay_reference_guided_successor_provider_events%rowtype;
  v_main jsonb;
  v_side jsonb;
  v_calls integer;
  v_execution_prompt text;
  v_execution_prompt_hash text;
  v_resolved record;
begin
  if not p_feature_enabled then
    raise exception 'SUCCESSOR_POSITION_4_FEATURE_DISABLED';
  end if;
  if p_successor_plan_id <> 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    or coalesce(length(p_lease_owner),0) < 12 then
    raise exception 'SUCCESSOR_POSITION_4_SCOPE_INVALID';
  end if;

  select * into v_resolved
  from public.resolve_ebay_reference_guided_position_4_effective_contract(
    'f166b395-8d3a-4921-b273-1a62a6032707'::uuid);
  if not found
    or v_resolved.amendment_id <>
      '5fdc0614-8467-4d0c-97e9-9fc4c99828f7'::uuid
    or v_resolved.amendment_hash <>
      'd360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747'
    or v_resolved.effective_position_contract_hash <>
      'f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2'
    or v_resolved.effective_prompt_hash <>
      '54a052f05f8724cd43c9c3db8ce9da6409ee53cfdc057ba5762be6aea7872d40'
    or v_resolved.effective_prompt_hash <> encode(extensions.digest(
      convert_to(v_resolved.effective_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_resolved.effective_prompt_text not like
      '%POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image.%' then
    raise exception 'SUCCESSOR_POSITION_4_EFFECTIVE_AMENDMENT_INVALID';
  end if;

  select * into v_plan
  from public.ebay_reference_guided_batch_plan_successors_v2
  where id = p_successor_plan_id for share;
  if not found
    or v_plan.attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or v_plan.plan_hash <>
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    or v_plan.plan_hash <> encode(extensions.digest(
      convert_to(v_plan.plan_text, 'UTF8'), 'sha256'), 'hex')
    or v_plan.automatic_retries or v_plan.max_concurrency <> 2 then
    raise exception 'SUCCESSOR_POSITION_4_PLAN_INVALID';
  end if;

  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = v_plan.attempt_id for update;
  if not found or v_attempt.provider_calls <> 4
    or v_attempt.max_provider_calls <> 6 or v_attempt.retry_consumed
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed
    or v_attempt.status <> 'GENERATING'
    or v_attempt.composition_manifest_hash <>
      v_plan.plan_text::jsonb->>'compositionManifestHash' then
    raise exception 'SUCCESSOR_POSITION_4_ATTEMPT_INVALID';
  end if;

  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = v_plan.revision_id for share;
  if not found or v_revision.strategy_version <> 'VISUAL_STRATEGY_V3'
    or v_revision.revision_contract <> 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
    or v_revision.product_dossier_hash <>
      v_plan.plan_text::jsonb->>'productDossierHash'
    or v_revision.market_visual_brief_hash <>
      v_plan.plan_text::jsonb->>'marketVisualBriefHash'
    or v_revision.main_source_hash <>
      '3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1'
    or v_revision.side_source_hash <>
      'f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21' then
    raise exception 'SUCCESSOR_POSITION_4_REVISION_INVALID';
  end if;

  select * into v_position
  from public.ebay_reference_guided_batch_plan_successor_positions_v2
  where successor_plan_id = v_plan.id and position = 4 for share;
  if not found or v_position.asset_role <> 'SECONDARY_USE_CONTEXT'
    or v_position.commercial_objective <> 'PRIMARY_BENEFIT_IN_ACTION'
    or v_position.execution_mode <> 'PROVIDER'
    or v_position.planned_provider_calls <> 1
    or v_position.exact_prompt_hash <> encode(extensions.digest(
      convert_to(v_position.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_position.exact_prompt_text not like
      '%POSITION_MUST_INCLUDE MUST take priority%'
    or v_position.authorized_sources <> jsonb_build_array(
      jsonb_build_object('sourceImageId','MAIN','sha256',v_revision.main_source_hash),
      jsonb_build_object('sourceImageId','SIDE','sha256',v_revision.side_source_hash))
    or jsonb_array_length(v_position.automatic_checks) = 0
    or jsonb_array_length(v_position.human_checks) = 0 then
    raise exception 'SUCCESSOR_POSITION_4_CONTRACT_INVALID';
  end if;

  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = v_attempt.id and position = 4 for update;
  if not found or v_job.status <> 'PENDING'
    or v_job.commercial_role <> 'PRIMARY_BENEFIT_IN_ACTION'
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.provider_request_id is not null
    or v_job.provider_call_started_at is not null
    or v_job.provider_call_completed_at is not null
    or v_job.output_storage_path is not null or v_job.output_sha256 is not null then
    raise exception 'SUCCESSOR_POSITION_4_JOB_INVALID';
  end if;

  if not exists (
      select 1
      from public.ebay_reference_guided_position_5_human_verdict_events h
      join public.ebay_reference_guided_generation_jobs j5 on j5.id = h.job_id
      where h.attempt_id = v_attempt.id and h.position = 5
        and h.human_verdict = 'APPROVED'
        and h.output_sha256 =
          'c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c'
        and j5.generation_attempt_id = v_attempt.id
        and j5.position = 5 and j5.status = 'PASSED'
        and j5.output_sha256 = h.output_sha256
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = v_attempt.id and position = 3
        and status = 'PASSED' and output_sha256 =
          '7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da'
    ) or exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = v_attempt.id
        and (lease_owner is not null or lease_expires_at is not null)
    ) or exists (
      select 1
      from public.ebay_reference_guided_successor_provider_events consumed
      where consumed.attempt_id = v_attempt.id and consumed.event_type = 'CONSUMED'
        and not exists (
          select 1 from public.ebay_reference_guided_successor_provider_events terminal
          where terminal.authorization_event_id = consumed.authorization_event_id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')
        )
    ) or exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = v_attempt.id and position = 6
        and (status <> 'PENDING' or lease_owner is not null
          or lease_expires_at is not null or provider_request_id is not null
          or provider_call_started_at is not null
          or provider_call_completed_at is not null
          or output_storage_path is not null or output_sha256 is not null)
    ) then
    raise exception 'SUCCESSOR_POSITION_4_BATCH_GATE_INVALID';
  end if;

  select * into v_binding
  from public.luna_catalog_source_pack_dossier_bindings
  where listing_package_id = v_revision.listing_package_id
    and dossier_hash = v_revision.product_dossier_hash
    and policy_version = 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
  order by verified_at desc limit 1;
  if not found then
    raise exception 'SUCCESSOR_POSITION_4_BINDING_INVALID';
  end if;
  select * into v_pack
  from public.luna_catalog_authorized_source_packs
  where id = v_binding.source_pack_id
    and listing_package_id = v_revision.listing_package_id for share;
  if not found or v_pack.source_pack_hash <> v_binding.source_pack_manifest_hash
    or coalesce(v_pack.manifest_hash,v_pack.source_pack_hash) <>
      v_binding.source_pack_manifest_hash then
    raise exception 'SUCCESSOR_POSITION_4_SOURCE_PACK_INVALID';
  end if;
  select value into v_main from jsonb_array_elements(v_pack.source_assets)
  where value->>'sourceImageId' = 'MAIN'
    and value->>'authorizationStatus' = 'AUTHORIZED_CATALOG_NATIVE_HIGH_RES';
  select value into v_side from jsonb_array_elements(v_pack.source_assets)
  where value->>'sourceImageId' = 'SIDE'
    and value->>'authorizationStatus' = 'AUTHORIZED_CATALOG_NATIVE_HIGH_RES';
  if v_main->>'sha256' <> v_revision.main_source_hash
    or v_side->>'sha256' <> v_revision.side_source_hash
    or coalesce(v_main->>'storagePath','') = ''
    or coalesce(v_side->>'storagePath','') = '' then
    raise exception 'SUCCESSOR_POSITION_4_PROTECTED_SOURCES_INVALID';
  end if;

  select * into v_authorization
  from public.ebay_reference_guided_successor_provider_events e
  where e.successor_plan_id = v_plan.id and e.job_id = v_job.id
    and e.position = 4 and e.event_type = 'AUTHORIZED'
    and e.provider_call_ordinal = 5
    and e.human_confirmation_hash = p_human_confirmation_hash
  for update;
  v_execution_prompt := v_authorization.evidence->>'exactPromptText';
  v_execution_prompt_hash := v_authorization.evidence->>'effectivePromptHash';
  if not found or coalesce(v_execution_prompt,'') = ''
    or v_authorization.evidence->>'amendmentId' <> v_resolved.amendment_id::text
    or v_authorization.evidence->>'amendmentHash' <> v_resolved.amendment_hash
    or v_authorization.evidence->>'effectivePositionContractHash' <>
      v_resolved.effective_position_contract_hash
    or v_execution_prompt_hash <> encode(extensions.digest(
      convert_to(v_execution_prompt, 'UTF8'), 'sha256'), 'hex')
    or v_execution_prompt_hash <> v_resolved.effective_prompt_hash
    or v_execution_prompt not like
      '%POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image.%'
    or exists (
      select 1 from public.ebay_reference_guided_successor_provider_events e
      where e.authorization_event_id = v_authorization.id
        and e.event_type in ('CONSUMED','OUTPUT_PERSISTED','FAILED_FINAL')
    ) then
    raise exception 'SUCCESSOR_POSITION_4_AUTHORIZATION_INVALID';
  end if;

  update public.ebay_reference_guided_generation_attempts a
  set provider_calls = a.provider_calls + 1
  where a.id = v_attempt.id and a.provider_calls = 4
    and a.max_provider_calls = 6
  returning a.provider_calls into v_calls;
  if v_calls <> 5 then
    raise exception 'SUCCESSOR_POSITION_4_BUDGET_INVALID';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status = 'PROVIDER_CALLING', lease_owner = p_lease_owner,
      lease_expires_at = now() + interval '5 minutes',
      provider_call_started_at = now(), updated_at = now()
  where id = v_job.id;
  insert into public.ebay_reference_guided_successor_provider_events(
    attempt_id, successor_plan_id, job_id, position, event_type,
    authorization_event_id, provider_call_ordinal, reason, evidence
  ) values (
    v_attempt.id, v_plan.id, v_job.id, 4, 'CONSUMED', v_authorization.id, 5,
    'ATOMIC_SINGLE_PROVIDER_CALL_RESERVED',
    jsonb_build_object('leaseOwner',p_lease_owner,'automaticRetries',false,
      'maximumCallsThisPhase',1,
      'amendmentHash',v_resolved.amendment_hash,
      'effectivePositionContractHash',v_resolved.effective_position_contract_hash,
      'effectivePromptHash',v_execution_prompt_hash)
  );
  return query select v_authorization.id, v_job.id, v_execution_prompt,
    v_execution_prompt_hash, v_resolved.amendment_id,
    v_resolved.amendment_hash, v_resolved.effective_position_contract_hash,
    v_revision.main_source_hash,
    v_main->>'storagePath', v_revision.side_source_hash,
    v_side->>'storagePath', v_calls;
end;
$$;

create or replace function public.complete_ebay_reference_guided_successor_position_4(
  p_authorization_event_id uuid,
  p_job_id uuid,
  p_lease_owner text,
  p_http_status integer,
  p_provider_request_id text,
  p_output_storage_path text,
  p_output_sha256 text,
  p_qa_result jsonb
) returns public.ebay_reference_guided_generation_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_auth public.ebay_reference_guided_successor_provider_events%rowtype;
begin
  select * into v_auth
  from public.ebay_reference_guided_successor_provider_events
  where id = p_authorization_event_id and event_type = 'AUTHORIZED'
    and position = 4 and provider_call_ordinal = 5 for share;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = v_auth.attempt_id for update;
  if not found or v_job.position <> 4 or v_job.status <> 'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or not exists (
      select 1 from public.ebay_reference_guided_successor_provider_events
      where authorization_event_id = v_auth.id and event_type = 'CONSUMED'
    )
    or (select provider_calls
      from public.ebay_reference_guided_generation_attempts
      where id = v_auth.attempt_id) <> 5
    or p_http_status <> 200 or coalesce(p_provider_request_id,'') = ''
    or p_output_sha256 !~ '^[0-9a-f]{64}$'
    or p_output_storage_path not like
      '%/reference-guided-successor/%/position-4/%/' || p_output_sha256 || '.png'
    or p_qa_result->>'automaticStatus' <> 'HUMAN_REVIEW_REQUIRED'
    or p_qa_result->>'amendmentHash' <>
      'd360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747'
    or p_qa_result->>'effectivePositionContractHash' <>
      'f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2'
    or p_qa_result->>'effectivePromptHash' <>
      '54a052f05f8724cd43c9c3db8ce9da6409ee53cfdc057ba5762be6aea7872d40'
    or (p_qa_result->>'humanApprovalRequired')::boolean is distinct from true
    or (p_qa_result->>'autoApproved')::boolean is distinct from false
    or (p_qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (p_qa_result->'technicalChecks'->>'width')::integer <> 1600
    or (p_qa_result->'technicalChecks'->>'height')::integer <> 1600 then
    raise exception 'SUCCESSOR_POSITION_4_COMPLETION_INVALID';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status = 'QA_PENDING', provider_request_id = p_provider_request_id,
      provider_call_completed_at = now(), output_storage_path = p_output_storage_path,
      output_sha256 = p_output_sha256, qa_result = p_qa_result,
      error_code = null, lease_owner = null, lease_expires_at = null,
      updated_at = now()
  where id = v_job.id returning * into v_job;
  insert into public.ebay_reference_guided_successor_provider_events(
    attempt_id, successor_plan_id, job_id, position, event_type,
    authorization_event_id, provider_call_ordinal, reason, http_status,
    provider_request_id, output_storage_path, output_sha256, evidence
  ) values (
    v_auth.attempt_id, v_auth.successor_plan_id, v_job.id, 4,
    'OUTPUT_PERSISTED', v_auth.id, 5,
    'PRIVATE_STORAGE_ROUNDTRIP_VERIFIED_HUMAN_REVIEW_REQUIRED',
    p_http_status, p_provider_request_id, p_output_storage_path,
    p_output_sha256, p_qa_result
  );
  return v_job;
end;
$$;

create or replace function public.fail_ebay_reference_guided_successor_position_4(
  p_authorization_event_id uuid,
  p_job_id uuid,
  p_lease_owner text,
  p_http_status integer,
  p_provider_request_id text,
  p_error_code text
) returns public.ebay_reference_guided_generation_jobs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_auth public.ebay_reference_guided_successor_provider_events%rowtype;
begin
  select * into v_auth
  from public.ebay_reference_guided_successor_provider_events
  where id = p_authorization_event_id and event_type = 'AUTHORIZED'
    and position = 4 and provider_call_ordinal = 5 for share;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = v_auth.attempt_id for update;
  if not found or v_job.position <> 4 or v_job.status <> 'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or coalesce(p_error_code,'') !~ '^[A-Z][A-Z0-9_:.-]{2,180}$'
    or (select provider_calls
      from public.ebay_reference_guided_generation_attempts
      where id = v_auth.attempt_id) <> 5 then
    raise exception 'SUCCESSOR_POSITION_4_FAILURE_RECORD_INVALID';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status = case when p_http_status = 200
      then 'PROVIDER_SUCCEEDED_PERSISTENCE_FAILED' else 'QUARANTINED' end,
      provider_request_id = nullif(p_provider_request_id,''),
      provider_call_completed_at = now(), error_code = p_error_code,
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = v_job.id returning * into v_job;
  insert into public.ebay_reference_guided_successor_provider_events(
    attempt_id, successor_plan_id, job_id, position, event_type,
    authorization_event_id, provider_call_ordinal, reason, http_status,
    provider_request_id, evidence
  ) values (
    v_auth.attempt_id, v_auth.successor_plan_id, v_job.id, 4,
    'FAILED_FINAL', v_auth.id, 5, p_error_code, p_http_status,
    nullif(p_provider_request_id,''),
    jsonb_build_object('automaticRetryOccurred',false)
  );
  return v_job;
end;
$$;

revoke all on function public.consume_ebay_reference_guided_successor_position_4(
  uuid,text,text,boolean) from public, anon, authenticated;
revoke all on function public.complete_ebay_reference_guided_successor_position_4(
  uuid,uuid,text,integer,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.fail_ebay_reference_guided_successor_position_4(
  uuid,uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.consume_ebay_reference_guided_successor_position_4(
  uuid,text,text,boolean) to service_role;
grant execute on function public.complete_ebay_reference_guided_successor_position_4(
  uuid,uuid,text,integer,text,text,text,jsonb) to service_role;
grant execute on function public.fail_ebay_reference_guided_successor_position_4(
  uuid,uuid,text,integer,text,text) to service_role;

notify pgrst, 'reload schema';
