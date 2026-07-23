-- Execution primitives for the separately authorized final ordinal 8.
-- Applying this migration creates no authorization, reservation, lease,
-- provider request, output, eBay write, or Production mutation.

create or replace function public.consume_ebay_reference_guided_extraordinary_position_6(
  p_correction_plan_id uuid,p_authorization_event_id uuid,
  p_human_confirmation_hash text,p_lease_owner text,
  p_feature_enabled boolean default false
) returns table(
  authorization_event_id uuid,consumed_event_id uuid,job_id uuid,
  exact_prompt_text text,exact_prompt_hash text,amendment_id uuid,
  amendment_hash text,effective_contract_hash text,batch_plan_hash text,
  main_source_hash text,main_storage_path text,
  side_source_hash text,side_storage_path text,provider_calls integer
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_plan public.ebay_reference_guided_extraordinary_replacement_plans%rowtype;
  v_position public.ebay_reference_guided_extraordinary_replacement_positions%rowtype;
  v_authorization public.ebay_reference_guided_extraordinary_authorization_events%rowtype;
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_binding public.luna_catalog_source_pack_dossier_bindings%rowtype;
  v_pack public.luna_catalog_authorized_source_packs%rowtype;
  v_main jsonb; v_side jsonb; v_calls integer; v_consumed_id uuid;
begin
  if not p_feature_enabled then raise exception 'EXTRAORDINARY_POSITION_6_FEATURE_DISABLED'; end if;
  if p_correction_plan_id<>'7ac6e2f4-d1f7-44f8-a026-064ca474904b'::uuid
    or coalesce(length(p_lease_owner),0)<12 then
    raise exception 'EXTRAORDINARY_POSITION_6_SCOPE_INVALID';
  end if;

  select plan.* into v_plan
  from public.ebay_reference_guided_extraordinary_replacement_plans plan
  where plan.id=p_correction_plan_id for share;
  if not found or v_plan.attempt_id<>'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or v_plan.plan_hash<>'9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3'
    or v_plan.plan_hash<>encode(extensions.digest(convert_to(v_plan.plan_text,'UTF8'),'sha256'),'hex')
    or v_plan.absolute_cap<>8 or v_plan.max_extra_calls<>2
    or v_plan.max_concurrency<>1 or v_plan.automatic_retries
    or not v_plan.requires_separate_human_authorization
    or not v_plan.human_checkpoint_between_calls or v_plan.feature_flags_enabled then
    raise exception 'EXTRAORDINARY_POSITION_6_BATCH_PLAN_INVALID';
  end if;

  select binding.* into v_position
  from public.ebay_reference_guided_extraordinary_replacement_positions binding
  where binding.correction_plan_id=v_plan.id and binding.position=6 for share;
  if not found or v_position.attempt_id<>v_plan.attempt_id
    or v_position.asset_role<>'SECONDARY_HUMAN_CONTEXT'
    or v_position.extraordinary_ordinal<>8
    or v_position.amendment_id<>'322226f9-31d0-4881-987d-1040d56a650a'::uuid
    or v_position.amendment_hash<>'cfa89ed6ceebc0f6899af917d9cc114638d4b4840e46f0dd37990f0f291c049a'
    or v_position.final_effective_contract_hash<>'2f24eb0993cd71a076e1229fcf54cbdf629cecc85368157cf4247c8bc0909347'
    or v_position.final_effective_prompt_hash<>'ac8c72b757de68715bd7517460f5b69365305202b7a2a297e2636b128aecdb65'
    or v_position.final_effective_prompt_hash<>encode(extensions.digest(convert_to(v_position.final_effective_prompt_text,'UTF8'),'sha256'),'hex')
    or v_position.rejected_output_sha256<>'0fb3b3241860c3f045ad822eb576cb0a8a11fb5b0f02cb522825c3d82bdfda14'
    or v_position.authorization_state<>'BLOCKED_UNTIL_POSITION_4_PASSED'
    or not v_position.requires_position_4_passed then
    raise exception 'EXTRAORDINARY_POSITION_6_BINDING_INVALID';
  end if;
  if v_position.final_effective_prompt_text not like '%MUST show exactly two real adult hands.%'
    or v_position.final_effective_prompt_text not like '%holding only the left handle.%'
    or v_position.final_effective_prompt_text not like '%holding only the right handle.%'
    or v_position.final_effective_prompt_text not like '%MUST keep the exact product complete, empty, centered, and clearly visible.%'
    or v_position.final_effective_prompt_text not like '%background that is completely empty.%'
    or v_position.final_effective_prompt_text not like '%MUST NOT show cutting boards in any plane.%'
    or v_position.final_effective_prompt_text not like '%MUST NOT show jars, containers, or canisters in any plane.%'
    or v_position.final_effective_prompt_text not like '%MUST NOT show plants or decoration in any plane.%'
    or v_position.final_effective_prompt_text not like '%MUST NOT show utensils or appliances in any plane.%'
    or v_position.final_effective_prompt_text not like '%MUST NOT show food, beverages, water, or droplets in any plane.%'
    or v_position.final_effective_prompt_text not like '%MUST NOT show any recognizable background object.%'
    or v_position.final_effective_prompt_text not like '%Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product.%' then
    raise exception 'EXTRAORDINARY_POSITION_6_EFFECTIVE_PROMPT_INVALID';
  end if;

  select attempt.* into v_attempt
  from public.ebay_reference_guided_generation_attempts attempt
  where attempt.id=v_plan.attempt_id for update;
  if not found or v_attempt.status<>'GENERATING'
    or v_attempt.provider_calls<>7 or v_attempt.max_provider_calls<>8
    or v_attempt.retry_consumed or v_attempt.ebay_writes<>0 or v_attempt.production_changed then
    raise exception 'EXTRAORDINARY_POSITION_6_ATTEMPT_INVALID';
  end if;
  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id=v_plan.revision_id for share;
  if not found or v_revision.strategy_version<>'VISUAL_STRATEGY_V3'
    or v_revision.revision_contract<>'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
    or v_revision.main_source_hash<>'3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1'
    or v_revision.side_source_hash<>'f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21' then
    raise exception 'EXTRAORDINARY_POSITION_6_REVISION_INVALID';
  end if;

  select job.* into v_job from public.ebay_reference_guided_generation_jobs job
  where job.generation_attempt_id=v_attempt.id and job.position=6 for update;
  if not found or v_job.status<>'BLOCKED_FIDELITY'
    or v_job.output_sha256<>v_position.rejected_output_sha256
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null then
    raise exception 'EXTRAORDINARY_POSITION_6_JOB_INVALID';
  end if;

  if not exists(select 1 from public.ebay_reference_guided_position_4_extraordinary_human_verdict_events approval4
      join public.ebay_reference_guided_generation_jobs job4 on job4.id=approval4.job_id
      where approval4.correction_plan_id=v_plan.id and approval4.human_verdict='APPROVED'
        and approval4.extraordinary_ordinal=7
        and approval4.output_sha256='d2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24'
        and not approval4.position_6_authorized and job4.status='PASSED'
        and job4.output_sha256=approval4.output_sha256)
    or not exists(select 1 from public.ebay_reference_guided_final_asset_selection_events selection
      where selection.attempt_id=v_attempt.id and selection.primary_verdict='APPROVED'
        and selection.material_detail_verdict='APPROVED')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs job2
      where job2.generation_attempt_id=v_attempt.id and job2.position=2 and job2.status='PASSED')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs job3
      where job3.generation_attempt_id=v_attempt.id and job3.position=3 and job3.status='PASSED')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs job5
      where job5.generation_attempt_id=v_attempt.id and job5.position=5 and job5.status='PASSED')
    or exists(select 1 from public.ebay_reference_guided_generation_jobs active_job
      where active_job.generation_attempt_id=v_attempt.id
        and (active_job.lease_owner is not null or active_job.lease_expires_at is not null))
    or not exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events ordinal7
      where ordinal7.correction_plan_id=v_plan.id and ordinal7.position=4
        and ordinal7.extraordinary_ordinal=7 and ordinal7.event_type='OUTPUT_PERSISTED')
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events ordinal8
      where ordinal8.correction_plan_id=v_plan.id and ordinal8.extraordinary_ordinal=8)
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events consumed
      where consumed.correction_plan_id=v_plan.id and consumed.event_type='CONSUMED'
        and not exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events terminal
          where terminal.consumed_event_id=consumed.id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL'))) then
    raise exception 'EXTRAORDINARY_POSITION_6_ASSET_SEQUENCE_INVALID';
  end if;

  select auth_event.* into v_authorization
  from public.ebay_reference_guided_extraordinary_authorization_events auth_event
  where auth_event.id=p_authorization_event_id and auth_event.correction_plan_id=v_plan.id
    and auth_event.attempt_id=v_attempt.id and auth_event.position=6
    and auth_event.extraordinary_ordinal=8 and auth_event.event_type='AUTHORIZED'
    and auth_event.human_confirmation_hash=p_human_confirmation_hash for share;
  if not found or v_authorization.human_authorized_by<>v_plan.created_by then
    raise exception 'EXTRAORDINARY_POSITION_6_AUTHORIZATION_INVALID';
  end if;

  select dossier_binding.* into v_binding
  from public.luna_catalog_source_pack_dossier_bindings dossier_binding
  where dossier_binding.listing_package_id=v_revision.listing_package_id
    and dossier_binding.dossier_hash=v_revision.product_dossier_hash
    and dossier_binding.policy_version='REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
  order by dossier_binding.verified_at desc limit 1;
  select pack.* into v_pack from public.luna_catalog_authorized_source_packs pack
  where pack.id=v_binding.source_pack_id
    and pack.listing_package_id=v_revision.listing_package_id for share;
  if v_binding.id is null or v_pack.id is null
    or v_pack.source_pack_hash<>v_binding.source_pack_manifest_hash
    or coalesce(v_pack.manifest_hash,v_pack.source_pack_hash)<>v_binding.source_pack_manifest_hash then
    raise exception 'EXTRAORDINARY_POSITION_6_SOURCE_PACK_INVALID';
  end if;
  select asset.value into v_main from jsonb_array_elements(v_pack.source_assets) asset
    where asset.value->>'sourceImageId'='MAIN'
      and asset.value->>'authorizationStatus'='AUTHORIZED_CATALOG_NATIVE_HIGH_RES';
  select asset.value into v_side from jsonb_array_elements(v_pack.source_assets) asset
    where asset.value->>'sourceImageId'='SIDE'
      and asset.value->>'authorizationStatus'='AUTHORIZED_CATALOG_NATIVE_HIGH_RES';
  if v_main->>'sha256'<>v_revision.main_source_hash
    or v_side->>'sha256'<>v_revision.side_source_hash
    or coalesce(v_main->>'storagePath','')='' or coalesce(v_side->>'storagePath','')='' then
    raise exception 'EXTRAORDINARY_POSITION_6_PROTECTED_SOURCES_INVALID';
  end if;

  update public.ebay_reference_guided_generation_attempts attempt
  set provider_calls=8 where attempt.id=v_attempt.id
    and attempt.provider_calls=7 and attempt.max_provider_calls=8
  returning attempt.provider_calls into v_calls;
  if v_calls<>8 then raise exception 'EXTRAORDINARY_POSITION_6_ATOMIC_BUDGET_INVALID'; end if;
  update public.ebay_reference_guided_generation_jobs
  set status='PROVIDER_CALLING',lease_owner=p_lease_owner,
    lease_expires_at=now()+interval '5 minutes',provider_call_started_at=now(),
    provider_call_completed_at=null,updated_at=now() where id=v_job.id;
  insert into public.ebay_reference_guided_extraordinary_provider_events(
    correction_plan_id,authorization_event_id,attempt_id,position,
    extraordinary_ordinal,event_type,evidence
  ) values(v_plan.id,v_authorization.id,v_attempt.id,6,8,'CONSUMED',
    jsonb_build_object('leaseOwner',p_lease_owner,'automaticRetries',false,
      'maximumCallsThisPhase',1,'batchPlanHash',v_plan.plan_hash,
      'amendmentHash',v_position.amendment_hash,
      'effectiveContractHash',v_position.final_effective_contract_hash,
      'effectivePromptHash',v_position.final_effective_prompt_hash))
  returning id into v_consumed_id;
  return query select v_authorization.id,v_consumed_id,v_job.id,
    v_position.final_effective_prompt_text,v_position.final_effective_prompt_hash,
    v_position.amendment_id,v_position.amendment_hash,
    v_position.final_effective_contract_hash,v_plan.plan_hash,
    v_revision.main_source_hash,v_main->>'storagePath',
    v_revision.side_source_hash,v_side->>'storagePath',v_calls;
end;
$$;

create or replace function public.complete_ebay_reference_guided_extraordinary_position_6(
  p_authorization_event_id uuid,p_consumed_event_id uuid,p_job_id uuid,
  p_lease_owner text,p_http_status integer,p_provider_request_id text,
  p_output_storage_path text,p_output_sha256 text,p_qa_result jsonb
) returns public.ebay_reference_guided_generation_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_auth public.ebay_reference_guided_extraordinary_authorization_events%rowtype;
  v_consumed public.ebay_reference_guided_extraordinary_provider_events%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
begin
  select auth_event.* into v_auth
  from public.ebay_reference_guided_extraordinary_authorization_events auth_event
  where auth_event.id=p_authorization_event_id and auth_event.position=6
    and auth_event.extraordinary_ordinal=8 for share;
  select consumed.* into v_consumed
  from public.ebay_reference_guided_extraordinary_provider_events consumed
  where consumed.id=p_consumed_event_id and consumed.authorization_event_id=v_auth.id
    and consumed.event_type='CONSUMED' and consumed.position=6
    and consumed.extraordinary_ordinal=8 for share;
  select job.* into v_job from public.ebay_reference_guided_generation_jobs job
  where job.id=p_job_id and job.generation_attempt_id=v_auth.attempt_id for update;
  if v_auth.id is null or v_consumed.id is null or v_job.id is null
    or v_job.position<>6 or v_job.status<>'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or (select attempt.provider_calls from public.ebay_reference_guided_generation_attempts attempt where attempt.id=v_auth.attempt_id)<>8
    or p_http_status<>200 or coalesce(p_provider_request_id,'')=''
    or p_output_sha256!~'^[0-9a-f]{64}$'
    or p_output_storage_path not like '%/reference-guided-extraordinary/%/position-6/ordinal-8/%/'||p_output_sha256||'.png'
    or p_qa_result->>'automaticStatus'<>'HUMAN_REVIEW_REQUIRED'
    or p_qa_result->>'batchPlanHash'<>'9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3'
    or p_qa_result->>'amendmentHash'<>'cfa89ed6ceebc0f6899af917d9cc114638d4b4840e46f0dd37990f0f291c049a'
    or p_qa_result->>'effectiveContractHash'<>'2f24eb0993cd71a076e1229fcf54cbdf629cecc85368157cf4247c8bc0909347'
    or p_qa_result->>'effectivePromptHash'<>'ac8c72b757de68715bd7517460f5b69365305202b7a2a297e2636b128aecdb65'
    or (p_qa_result->>'humanApprovalRequired')::boolean is distinct from true
    or (p_qa_result->>'autoApproved')::boolean is distinct from false
    or (p_qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (p_qa_result->'technicalChecks'->>'width')::integer<>1600
    or (p_qa_result->'technicalChecks'->>'height')::integer<>1600 then
    raise exception 'EXTRAORDINARY_POSITION_6_COMPLETION_INVALID';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status='QA_PENDING',provider_request_id=p_provider_request_id,
    provider_call_completed_at=now(),output_storage_path=p_output_storage_path,
    output_sha256=p_output_sha256,qa_result=p_qa_result,error_code=null,
    lease_owner=null,lease_expires_at=null,updated_at=now()
  where id=v_job.id returning * into v_job;
  insert into public.ebay_reference_guided_extraordinary_provider_events(
    correction_plan_id,authorization_event_id,attempt_id,position,
    extraordinary_ordinal,event_type,consumed_event_id,evidence
  ) values(v_consumed.correction_plan_id,v_auth.id,v_auth.attempt_id,6,8,
    'OUTPUT_PERSISTED',v_consumed.id,jsonb_build_object(
      'httpStatus',p_http_status,'providerRequestId',p_provider_request_id,
      'outputStoragePath',p_output_storage_path,'outputSha256',p_output_sha256,
      'qa',p_qa_result));
  return v_job;
end;
$$;

create or replace function public.fail_ebay_reference_guided_extraordinary_position_6(
  p_authorization_event_id uuid,p_consumed_event_id uuid,p_job_id uuid,
  p_lease_owner text,p_http_status integer,p_provider_request_id text,
  p_error_code text,p_output_storage_path text default null,p_output_sha256 text default null
) returns public.ebay_reference_guided_generation_jobs
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_auth public.ebay_reference_guided_extraordinary_authorization_events%rowtype;
  v_consumed public.ebay_reference_guided_extraordinary_provider_events%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
begin
  select auth_event.* into v_auth
  from public.ebay_reference_guided_extraordinary_authorization_events auth_event
  where auth_event.id=p_authorization_event_id and auth_event.position=6
    and auth_event.extraordinary_ordinal=8 for share;
  select consumed.* into v_consumed
  from public.ebay_reference_guided_extraordinary_provider_events consumed
  where consumed.id=p_consumed_event_id and consumed.authorization_event_id=v_auth.id
    and consumed.event_type='CONSUMED' for share;
  select job.* into v_job from public.ebay_reference_guided_generation_jobs job
  where job.id=p_job_id and job.generation_attempt_id=v_auth.attempt_id for update;
  if v_auth.id is null or v_consumed.id is null or v_job.id is null
    or v_job.position<>6 or v_job.status<>'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or coalesce(p_error_code,'')!~'^[A-Z][A-Z0-9_:.-]{2,180}$'
    or (select attempt.provider_calls from public.ebay_reference_guided_generation_attempts attempt where attempt.id=v_auth.attempt_id)<>8 then
    raise exception 'EXTRAORDINARY_POSITION_6_FAILURE_RECORD_INVALID';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status=case when p_http_status=200 then 'PROVIDER_SUCCEEDED_PERSISTENCE_FAILED' else 'QUARANTINED' end,
    provider_request_id=nullif(p_provider_request_id,''),provider_call_completed_at=now(),
    error_code=p_error_code,lease_owner=null,lease_expires_at=null,updated_at=now()
  where id=v_job.id returning * into v_job;
  insert into public.ebay_reference_guided_extraordinary_provider_events(
    correction_plan_id,authorization_event_id,attempt_id,position,
    extraordinary_ordinal,event_type,consumed_event_id,evidence
  ) values(v_consumed.correction_plan_id,v_auth.id,v_auth.attempt_id,6,8,
    'FAILED_FINAL',v_consumed.id,jsonb_strip_nulls(jsonb_build_object(
      'httpStatus',p_http_status,'providerRequestId',nullif(p_provider_request_id,''),
      'errorCode',p_error_code,'outputStoragePath',p_output_storage_path,
      'outputSha256',p_output_sha256,'automaticRetryOccurred',false)));
  return v_job;
end;
$$;

revoke all on function public.consume_ebay_reference_guided_extraordinary_position_6(uuid,uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.complete_ebay_reference_guided_extraordinary_position_6(uuid,uuid,uuid,text,integer,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_ebay_reference_guided_extraordinary_position_6(uuid,uuid,uuid,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.consume_ebay_reference_guided_extraordinary_position_6(uuid,uuid,text,text,boolean) to service_role;
grant execute on function public.complete_ebay_reference_guided_extraordinary_position_6(uuid,uuid,uuid,text,integer,text,text,text,jsonb) to service_role;
grant execute on function public.fail_ebay_reference_guided_extraordinary_position_6(uuid,uuid,uuid,text,integer,text,text,text,text) to service_role;

notify pgrst,'reload schema';
