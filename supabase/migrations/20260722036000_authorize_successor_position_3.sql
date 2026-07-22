-- One human-authorized provider call for successor V2 position 3.
-- The exact execution prompt is persisted in the append-only authorization
-- event. The base plan remains immutable; the added contract only tightens the
-- preferred scale object into the explicitly authorized single lemon.

with contract as (
  select
    p.*,
    p.exact_prompt_text || E'\n\n' || $position_3_contract$
AUTHORIZED_POSITION_3_EXECUTION_CONTRACT_V1
POSITION_MUST_INCLUDE_RUNTIME:
- MUST show the exact complete, empty product as the dominant subject on a clean neutral counter.
- MUST show exactly one common lemon beside the product, never inside it.
- MUST treat the lemon only as a non-metric everyday scale reference that is not included with the purchase.
- MUST keep the product complete with its exact form, two handles, metal rim, pedestal base, perforation pattern, white enamel finish, and proportions.
- MUST make this neutral scale-comparison composition clearly distinct from PRIMARY_MAIN and SECONDARY_ASPIRATIONAL_LIFESTYLE.
POSITION_MUST_EXCLUDE_RUNTIME:
- MUST NOT show hands, water, any other food, or any other prop.
- MUST NOT show a ruler, measurement line, number, text, badge, watermark, new logo, box, accessory, or included content.
- MUST NOT render or represent the capacity label "1.5 quart" or assert dimensions or capacity visually.
- MUST NOT use research as a product fact; research may guide only camera, lighting, environment, and composition.
$position_3_contract$ as execution_prompt_text
  from public.ebay_reference_guided_batch_plan_successor_positions_v2 p
  where p.successor_plan_id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    and p.attempt_id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    and p.position = 3
    and p.asset_role = 'SECONDARY_SCALE_CAPACITY'
    and p.commercial_objective = 'SCALE_AND_CAPACITY_CONTEXT'
    and p.execution_mode = 'PROVIDER'
    and p.planned_provider_calls = 1
    and p.exact_prompt_hash = encode(extensions.digest(
      convert_to(p.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    and p.exact_prompt_text !~* 'unitGrossWeight'
    and p.exact_prompt_text like
      '%POSITION_MUST_INCLUDE MUST take priority%'
), eligible as (
  select c.*, plan.created_by, j.id as job_id
  from contract c
  join public.ebay_reference_guided_batch_plan_successors_v2 plan
    on plan.id = c.successor_plan_id
  join public.ebay_reference_guided_generation_attempts a
    on a.id = c.attempt_id
  join public.ebay_reference_guided_generation_jobs j
    on j.generation_attempt_id = a.id and j.position = 3
  where plan.plan_hash =
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    and plan.plan_hash = encode(extensions.digest(
      convert_to(plan.plan_text, 'UTF8'), 'sha256'), 'hex')
    and plan.automatic_retries = false and plan.max_concurrency = 2
    and a.provider_calls = 3 and a.max_provider_calls = 6
    and a.retry_consumed = false and a.ebay_writes = 0
    and a.production_changed = false and a.status = 'GENERATING'
    and j.status = 'PENDING'
    and j.commercial_role = 'SCALE_AND_CAPACITY_CONTEXT'
    and j.lease_owner is null and j.lease_expires_at is null
    and j.provider_request_id is null
    and j.provider_call_started_at is null
    and j.provider_call_completed_at is null
    and j.output_storage_path is null and j.output_sha256 is null
    and exists (
      select 1
      from public.ebay_reference_guided_position_5_human_verdict_events h
      join public.ebay_reference_guided_generation_jobs j5
        on j5.id = h.job_id and j5.generation_attempt_id = a.id
      where h.attempt_id = a.id and h.position = 5
        and h.human_verdict = 'APPROVED'
        and h.output_sha256 =
          'c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c'
        and j5.position = 5 and j5.status = 'PASSED'
        and j5.output_sha256 = h.output_sha256
    )
    and not exists (
      select 1 from public.ebay_reference_guided_generation_jobs active
      where active.generation_attempt_id = a.id
        and (active.lease_owner is not null or active.lease_expires_at is not null)
    )
    and not exists (
      select 1
      from public.ebay_reference_guided_successor_provider_events consumed
      where consumed.attempt_id = a.id and consumed.event_type = 'CONSUMED'
        and not exists (
          select 1
          from public.ebay_reference_guided_successor_provider_events terminal
          where terminal.authorization_event_id = consumed.authorization_event_id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')
        )
    )
)
insert into public.ebay_reference_guided_successor_provider_events(
  attempt_id, successor_plan_id, job_id, position, event_type,
  provider_call_ordinal, human_authorized_by, human_authorized_at,
  human_confirmation_hash, reason, evidence
)
select attempt_id, successor_plan_id, job_id, 3, 'AUTHORIZED', 4,
  created_by, now(), encode(extensions.digest(convert_to(
    'AUTHORIZE_SUCCESSOR_POSITION_3|ATTEMPT=f166b395-8d3a-4921-b273-1a62a6032707|PLAN=c54a0bbc-b16c-47b3-8f4e-93d2152e3b34|PLAN_HASH=a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7|POSITION=3|ASSET_ROLE=SECONDARY_SCALE_CAPACITY|MAX_CALLS=1',
    'UTF8'), 'sha256'), 'hex'),
  'EXPLICIT_HUMAN_AUTHORIZATION_SINGLE_POSITION_3_PROVIDER_CALL',
  jsonb_build_object(
    'model','gpt-image-2', 'endpoint','/v1/images/edits',
    'size','1600x1600', 'quality','high', 'outputFormat','png',
    'sourceOrder',jsonb_build_array('MAIN','SIDE'),
    'automaticRetries',false, 'maximumAuthorizedCallsThisPhase',1,
    'basePromptHash',exact_prompt_hash,
    'exactPromptText',execution_prompt_text,
    'exactPromptHash',encode(extensions.digest(
      convert_to(execution_prompt_text, 'UTF8'), 'sha256'), 'hex'),
    'contractOverlayVersion','AUTHORIZED_POSITION_3_EXECUTION_CONTRACT_V1'
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
      and e.position = 3 and e.provider_call_ordinal = 4
      and e.event_type = 'AUTHORIZED'
      and e.reason =
        'EXPLICIT_HUMAN_AUTHORIZATION_SINGLE_POSITION_3_PROVIDER_CALL'
      and e.evidence->>'basePromptHash' =
        'd172430c9c326c1531a0c5459c7bf1a0689516bb862b91ba4cb53fad083aed5e'
      and e.evidence->>'exactPromptHash' = encode(extensions.digest(
        convert_to(e.evidence->>'exactPromptText', 'UTF8'), 'sha256'), 'hex')
      and e.evidence->>'exactPromptText' !~* 'unitGrossWeight'
      and e.evidence->>'exactPromptText' like
        '%MUST show exactly one common lemon beside the product, never inside it.%'
  ) then
    raise exception 'SUCCESSOR_POSITION_3_AUTHORIZATION_NOT_PERSISTED';
  end if;
end;
$authorization_check$;

create or replace function public.consume_ebay_reference_guided_successor_position_3(
  p_successor_plan_id uuid,
  p_human_confirmation_hash text,
  p_lease_owner text,
  p_feature_enabled boolean default false
) returns table(
  authorization_event_id uuid,
  job_id uuid,
  exact_prompt_text text,
  exact_prompt_hash text,
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
begin
  if not p_feature_enabled then
    raise exception 'SUCCESSOR_POSITION_3_FEATURE_DISABLED';
  end if;
  if p_successor_plan_id <> 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    or coalesce(length(p_lease_owner),0) < 12 then
    raise exception 'SUCCESSOR_POSITION_3_SCOPE_INVALID';
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
    raise exception 'SUCCESSOR_POSITION_3_PLAN_INVALID';
  end if;

  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = v_plan.attempt_id for update;
  if not found or v_attempt.provider_calls <> 3
    or v_attempt.max_provider_calls <> 6 or v_attempt.retry_consumed
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed
    or v_attempt.status <> 'GENERATING'
    or v_attempt.composition_manifest_hash <>
      v_plan.plan_text::jsonb->>'compositionManifestHash' then
    raise exception 'SUCCESSOR_POSITION_3_ATTEMPT_INVALID';
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
    raise exception 'SUCCESSOR_POSITION_3_REVISION_INVALID';
  end if;

  select * into v_position
  from public.ebay_reference_guided_batch_plan_successor_positions_v2
  where successor_plan_id = v_plan.id and position = 3 for share;
  if not found or v_position.asset_role <> 'SECONDARY_SCALE_CAPACITY'
    or v_position.commercial_objective <> 'SCALE_AND_CAPACITY_CONTEXT'
    or v_position.execution_mode <> 'PROVIDER'
    or v_position.execution_phase <> 'BLOCKED_UNTIL_POSITION_5_HUMAN_APPROVAL'
    or v_position.planned_provider_calls <> 1
    or v_position.exact_prompt_hash <> encode(extensions.digest(
      convert_to(v_position.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_position.exact_prompt_text ~* 'unitGrossWeight'
    or v_position.exact_prompt_text not like
      '%POSITION_MUST_INCLUDE MUST take priority%'
    or v_position.authorized_sources <> jsonb_build_array(
      jsonb_build_object('sourceImageId','MAIN','sha256',v_revision.main_source_hash),
      jsonb_build_object('sourceImageId','SIDE','sha256',v_revision.side_source_hash))
    or not (v_position.must_include @>
      '["MUST show the exact complete product, empty and dominant, on a clean counter.","MUST keep the comparison strictly non-metric."]'::jsonb)
    or jsonb_array_length(v_position.automatic_checks) = 0
    or jsonb_array_length(v_position.human_checks) = 0 then
    raise exception 'SUCCESSOR_POSITION_3_CONTRACT_INVALID';
  end if;

  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = v_attempt.id and position = 3 for update;
  if not found or v_job.status <> 'PENDING'
    or v_job.commercial_role <> 'SCALE_AND_CAPACITY_CONTEXT'
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.provider_request_id is not null
    or v_job.provider_call_started_at is not null
    or v_job.provider_call_completed_at is not null
    or v_job.output_storage_path is not null or v_job.output_sha256 is not null then
    raise exception 'SUCCESSOR_POSITION_3_JOB_INVALID';
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
      where generation_attempt_id = v_attempt.id and position in (4,6)
        and (status <> 'PENDING' or lease_owner is not null
          or lease_expires_at is not null or provider_request_id is not null
          or provider_call_started_at is not null
          or provider_call_completed_at is not null
          or output_storage_path is not null or output_sha256 is not null)
    ) then
    raise exception 'SUCCESSOR_POSITION_3_BATCH_GATE_INVALID';
  end if;

  select * into v_binding
  from public.luna_catalog_source_pack_dossier_bindings
  where listing_package_id = v_revision.listing_package_id
    and dossier_hash = v_revision.product_dossier_hash
    and policy_version = 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
  order by verified_at desc limit 1;
  if not found then
    raise exception 'SUCCESSOR_POSITION_3_BINDING_INVALID';
  end if;
  select * into v_pack
  from public.luna_catalog_authorized_source_packs
  where id = v_binding.source_pack_id
    and listing_package_id = v_revision.listing_package_id for share;
  if not found or v_pack.source_pack_hash <> v_binding.source_pack_manifest_hash
    or coalesce(v_pack.manifest_hash,v_pack.source_pack_hash) <>
      v_binding.source_pack_manifest_hash then
    raise exception 'SUCCESSOR_POSITION_3_SOURCE_PACK_INVALID';
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
    raise exception 'SUCCESSOR_POSITION_3_PROTECTED_SOURCES_INVALID';
  end if;

  select * into v_authorization
  from public.ebay_reference_guided_successor_provider_events e
  where e.successor_plan_id = v_plan.id and e.job_id = v_job.id
    and e.position = 3 and e.event_type = 'AUTHORIZED'
    and e.provider_call_ordinal = 4
    and e.human_confirmation_hash = p_human_confirmation_hash
  for update;
  v_execution_prompt := v_authorization.evidence->>'exactPromptText';
  v_execution_prompt_hash := v_authorization.evidence->>'exactPromptHash';
  if not found or coalesce(v_execution_prompt,'') = ''
    or v_authorization.evidence->>'basePromptHash' <> v_position.exact_prompt_hash
    or v_execution_prompt_hash <> encode(extensions.digest(
      convert_to(v_execution_prompt, 'UTF8'), 'sha256'), 'hex')
    or v_execution_prompt ~* 'unitGrossWeight'
    or v_execution_prompt not like
      '%MUST show exactly one common lemon beside the product, never inside it.%'
    or exists (
      select 1 from public.ebay_reference_guided_successor_provider_events e
      where e.authorization_event_id = v_authorization.id
        and e.event_type in ('CONSUMED','OUTPUT_PERSISTED','FAILED_FINAL')
    ) then
    raise exception 'SUCCESSOR_POSITION_3_AUTHORIZATION_INVALID';
  end if;

  update public.ebay_reference_guided_generation_attempts a
  set provider_calls = a.provider_calls + 1
  where a.id = v_attempt.id and a.provider_calls = 3
    and a.max_provider_calls = 6
  returning a.provider_calls into v_calls;
  if v_calls <> 4 then
    raise exception 'SUCCESSOR_POSITION_3_BUDGET_INVALID';
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
    v_attempt.id, v_plan.id, v_job.id, 3, 'CONSUMED', v_authorization.id, 4,
    'ATOMIC_SINGLE_PROVIDER_CALL_RESERVED',
    jsonb_build_object('leaseOwner',p_lease_owner,'automaticRetries',false,
      'maximumCallsThisPhase',1,'exactPromptHash',v_execution_prompt_hash)
  );
  return query select v_authorization.id, v_job.id, v_execution_prompt,
    v_execution_prompt_hash, v_revision.main_source_hash,
    v_main->>'storagePath', v_revision.side_source_hash,
    v_side->>'storagePath', v_calls;
end;
$$;

create or replace function public.complete_ebay_reference_guided_successor_position_3(
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
    and position = 3 and provider_call_ordinal = 4 for share;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = v_auth.attempt_id for update;
  if not found or v_job.position <> 3 or v_job.status <> 'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or not exists (
      select 1 from public.ebay_reference_guided_successor_provider_events
      where authorization_event_id = v_auth.id and event_type = 'CONSUMED'
    )
    or (select provider_calls
      from public.ebay_reference_guided_generation_attempts
      where id = v_auth.attempt_id) <> 4
    or p_http_status <> 200 or coalesce(p_provider_request_id,'') = ''
    or p_output_sha256 !~ '^[0-9a-f]{64}$'
    or p_output_storage_path not like
      '%/reference-guided-successor/%/position-3/%/' || p_output_sha256 || '.png'
    or p_qa_result->>'automaticStatus' <> 'HUMAN_REVIEW_REQUIRED'
    or (p_qa_result->>'humanApprovalRequired')::boolean is distinct from true
    or (p_qa_result->>'autoApproved')::boolean is distinct from false
    or (p_qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (p_qa_result->'technicalChecks'->>'width')::integer <> 1600
    or (p_qa_result->'technicalChecks'->>'height')::integer <> 1600 then
    raise exception 'SUCCESSOR_POSITION_3_COMPLETION_INVALID';
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
    v_auth.attempt_id, v_auth.successor_plan_id, v_job.id, 3,
    'OUTPUT_PERSISTED', v_auth.id, 4,
    'PRIVATE_STORAGE_ROUNDTRIP_VERIFIED_HUMAN_REVIEW_REQUIRED',
    p_http_status, p_provider_request_id, p_output_storage_path,
    p_output_sha256, p_qa_result
  );
  return v_job;
end;
$$;

create or replace function public.fail_ebay_reference_guided_successor_position_3(
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
    and position = 3 and provider_call_ordinal = 4 for share;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = v_auth.attempt_id for update;
  if not found or v_job.position <> 3 or v_job.status <> 'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or coalesce(p_error_code,'') !~ '^[A-Z][A-Z0-9_:.-]{2,180}$'
    or (select provider_calls
      from public.ebay_reference_guided_generation_attempts
      where id = v_auth.attempt_id) <> 4 then
    raise exception 'SUCCESSOR_POSITION_3_FAILURE_RECORD_INVALID';
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
    v_auth.attempt_id, v_auth.successor_plan_id, v_job.id, 3,
    'FAILED_FINAL', v_auth.id, 4, p_error_code, p_http_status,
    nullif(p_provider_request_id,''),
    jsonb_build_object('automaticRetryOccurred',false)
  );
  return v_job;
end;
$$;

revoke all on function public.consume_ebay_reference_guided_successor_position_3(
  uuid,text,text,boolean) from public, anon, authenticated;
revoke all on function public.complete_ebay_reference_guided_successor_position_3(
  uuid,uuid,text,integer,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.fail_ebay_reference_guided_successor_position_3(
  uuid,uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.consume_ebay_reference_guided_successor_position_3(
  uuid,text,text,boolean) to service_role;
grant execute on function public.complete_ebay_reference_guided_successor_position_3(
  uuid,uuid,text,integer,text,text,text,jsonb) to service_role;
grant execute on function public.fail_ebay_reference_guided_successor_position_3(
  uuid,uuid,text,integer,text,text) to service_role;

notify pgrst, 'reload schema';
