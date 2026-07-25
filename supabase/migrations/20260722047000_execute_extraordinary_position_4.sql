-- Execute support for the separately authorized extraordinary ordinal 7.
-- Applying this migration performs no authorization, reservation, lease,
-- provider request, output creation, eBay write, or production mutation.

alter table public.ebay_reference_guided_generation_attempts
  drop constraint if exists ebay_reference_guided_attempt_provider_budget_check;
alter table public.ebay_reference_guided_generation_attempts
  add constraint ebay_reference_guided_attempt_provider_budget_check check (
    (
      id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
      and max_provider_calls in (6,8)
      and provider_calls between 0 and max_provider_calls
    ) or (
      id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
      and max_provider_calls = 6
      and provider_calls between 0 and max_provider_calls
    )
  );

create or replace function public.consume_ebay_reference_guided_extraordinary_position_4(
  p_correction_plan_id uuid,
  p_authorization_event_id uuid,
  p_human_confirmation_hash text,
  p_lease_owner text,
  p_feature_enabled boolean default false
) returns table(
  authorization_event_id uuid,
  consumed_event_id uuid,
  job_id uuid,
  exact_prompt_text text,
  exact_prompt_hash text,
  amendment_id uuid,
  amendment_hash text,
  effective_contract_hash text,
  batch_plan_hash text,
  main_source_hash text,
  main_storage_path text,
  side_source_hash text,
  side_storage_path text,
  provider_calls integer
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
  v_main jsonb;
  v_side jsonb;
  v_calls integer;
  v_consumed_id uuid;
begin
  if not p_feature_enabled then
    raise exception 'EXTRAORDINARY_POSITION_4_FEATURE_DISABLED';
  end if;
  if p_correction_plan_id <> '7ac6e2f4-d1f7-44f8-a026-064ca474904b'::uuid
    or coalesce(length(p_lease_owner),0) < 12 then
    raise exception 'EXTRAORDINARY_POSITION_4_SCOPE_INVALID';
  end if;

  select * into v_plan
  from public.ebay_reference_guided_extraordinary_replacement_plans
  where id=p_correction_plan_id for share;
  if not found
    or v_plan.attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or v_plan.plan_hash <> '9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3'
    or v_plan.plan_hash <> encode(extensions.digest(convert_to(v_plan.plan_text,'UTF8'),'sha256'),'hex')
    or v_plan.plan_type <> 'CONTROLLED_TWO_POSITION_REPLACEMENT_V1'
    or v_plan.positions <> '[4,6]'::jsonb
    or v_plan.current_provider_calls <> 6 or v_plan.max_extra_calls <> 2
    or v_plan.absolute_cap <> 8 or v_plan.max_concurrency <> 1
    or v_plan.automatic_retries or not v_plan.requires_separate_human_authorization
    or not v_plan.human_checkpoint_between_calls or v_plan.feature_flags_enabled
    or v_plan.status <> 'AWAITING_POSITION_4_HUMAN_AUTHORIZATION' then
    raise exception 'EXTRAORDINARY_POSITION_4_BATCH_PLAN_INVALID';
  end if;

  select * into v_position
  from public.ebay_reference_guided_extraordinary_replacement_positions
  where correction_plan_id=v_plan.id and position=4 for share;
  if not found or v_position.attempt_id<>v_plan.attempt_id
    or v_position.asset_role<>'SECONDARY_USE_CONTEXT'
    or v_position.extraordinary_ordinal<>7
    or v_position.amendment_id<>'cc870df1-7d04-4fb3-ab9a-4f07c978ffde'::uuid
    or v_position.amendment_hash<>'8dbe3c4c8068a31d4c18153434faf7d7b88b25c17542cb67ad37f8aca80c1c8f'
    or v_position.final_effective_contract_hash<>'6cac13ae461915ba22d79b381c98eb53de93bd1f052e54716f67901013ca582a'
    or v_position.final_effective_prompt_hash<>'4aca1c9ca9623e238c2f3714a01ed8d8931779d8fd06741c8173f8e9786ced91'
    or v_position.final_effective_prompt_hash<>encode(extensions.digest(convert_to(v_position.final_effective_prompt_text,'UTF8'),'sha256'),'hex')
    or v_position.rejected_output_sha256<>'988304aedd2ce2c7ebcd505a5e812a930d550be99a5f8fb2d2b7e61561c5d123'
    or v_position.authorization_state<>'READY_FOR_SEPARATE_HUMAN_AUTHORIZATION'
    or v_position.requires_position_4_passed then
    raise exception 'EXTRAORDINARY_POSITION_4_BINDING_INVALID';
  end if;
  if v_position.final_effective_prompt_text not like '%MUST show a visible faucet that is switched off.%'
    or v_position.final_effective_prompt_text not like '%exactly 4 to 6 freshly rinsed strawberries%'
    or v_position.final_effective_prompt_text not like '%MUST show only small residual droplets%'
    or v_position.final_effective_prompt_text not like '%MUST show zero currents, streams, jets, waterfalls, splashes, or drainage.%'
    or v_position.final_effective_prompt_text not like '%MUST show no human hands, fingers, arms, people, or human body parts.%'
    or v_position.final_effective_prompt_text not like '%Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product.%'
    or v_position.final_effective_prompt_text not like '%MUST preserve exactly two handles.%'
    or v_position.final_effective_prompt_text not like '%MUST preserve the exact count, distribution, orientation, and relative position of all perforations.%'
    or v_position.final_effective_prompt_text not like '%MUST show the complete product without clipping or hidden parts.%' then
    raise exception 'EXTRAORDINARY_POSITION_4_EFFECTIVE_PROMPT_INVALID';
  end if;

  select * into v_attempt from public.ebay_reference_guided_generation_attempts
  where id=v_plan.attempt_id for update;
  if not found or v_attempt.status<>'GENERATING'
    or v_attempt.provider_calls<>6 or v_attempt.max_provider_calls<>6
    or v_attempt.retry_consumed or v_attempt.ebay_writes<>0
    or v_attempt.production_changed then
    raise exception 'EXTRAORDINARY_POSITION_4_ATTEMPT_INVALID';
  end if;

  select * into v_revision from public.ebay_same_day_pilot_image_revisions
  where id=v_plan.revision_id for share;
  if not found or v_revision.strategy_version<>'VISUAL_STRATEGY_V3'
    or v_revision.revision_contract<>'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
    or v_revision.main_source_hash<>'3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1'
    or v_revision.side_source_hash<>'f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21' then
    raise exception 'EXTRAORDINARY_POSITION_4_REVISION_INVALID';
  end if;

  select * into v_job from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id=v_attempt.id and position=4 for update;
  if not found or v_job.status<>'BLOCKED_FIDELITY'
    or v_job.output_sha256<>v_position.rejected_output_sha256
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null then
    raise exception 'EXTRAORDINARY_POSITION_4_JOB_INVALID';
  end if;

  if not exists(select 1 from public.ebay_reference_guided_asset_review_events
      where attempt_id=v_attempt.id and asset_ordinal=0 and decision='APPROVED')
    or not exists(select 1 from public.ebay_reference_guided_asset_review_events
      where attempt_id=v_attempt.id and asset_ordinal=1 and decision='APPROVED')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id=v_attempt.id and position=2 and status='PASSED'
        and output_sha256='7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id=v_attempt.id and position=3 and status='PASSED'
        and output_sha256='7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id=v_attempt.id and position=5 and status='PASSED'
        and output_sha256='c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c')
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id=v_attempt.id and position=6 and status='BLOCKED_FIDELITY'
        and output_sha256='0fb3b3241860c3f045ad822eb576cb0a8a11fb5b0f02cb522825c3d82bdfda14'
        and lease_owner is null and lease_expires_at is null)
    or exists(select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id=v_attempt.id and (lease_owner is not null or lease_expires_at is not null))
    or exists(select 1 from public.ebay_reference_guided_extraordinary_authorization_events
      where correction_plan_id=v_plan.id and position=6)
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events
      where correction_plan_id=v_plan.id and extraordinary_ordinal=8)
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events consumed
      where correction_plan_id=v_plan.id and event_type='CONSUMED'
        and not exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events terminal
          where terminal.consumed_event_id=consumed.id and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')))
    or exists(select 1 from public.ebay_reference_guided_successor_provider_events consumed
      where attempt_id=v_attempt.id and event_type='CONSUMED'
        and not exists(select 1 from public.ebay_reference_guided_successor_provider_events terminal
          where terminal.authorization_event_id=consumed.authorization_event_id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL'))) then
    raise exception 'EXTRAORDINARY_POSITION_4_BATCH_GATE_INVALID';
  end if;

  select * into v_authorization
  from public.ebay_reference_guided_extraordinary_authorization_events
  where id=p_authorization_event_id and correction_plan_id=v_plan.id
    and attempt_id=v_attempt.id and position=4 and extraordinary_ordinal=7
    and event_type='AUTHORIZED' and human_confirmation_hash=p_human_confirmation_hash
  for share;
  if not found or v_authorization.human_authorized_by<>v_plan.created_by
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events
      where authorization_event_id=v_authorization.id) then
    raise exception 'EXTRAORDINARY_POSITION_4_AUTHORIZATION_INVALID';
  end if;

  select * into v_binding from public.luna_catalog_source_pack_dossier_bindings
  where listing_package_id=v_revision.listing_package_id
    and dossier_hash=v_revision.product_dossier_hash
    and policy_version='REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
  order by verified_at desc limit 1;
  select * into v_pack from public.luna_catalog_authorized_source_packs
  where id=v_binding.source_pack_id and listing_package_id=v_revision.listing_package_id for share;
  if v_binding.id is null or v_pack.id is null
    or v_pack.source_pack_hash<>v_binding.source_pack_manifest_hash
    or coalesce(v_pack.manifest_hash,v_pack.source_pack_hash)<>v_binding.source_pack_manifest_hash then
    raise exception 'EXTRAORDINARY_POSITION_4_SOURCE_PACK_INVALID';
  end if;
  select value into v_main from jsonb_array_elements(v_pack.source_assets)
    where value->>'sourceImageId'='MAIN'
      and value->>'authorizationStatus'='AUTHORIZED_CATALOG_NATIVE_HIGH_RES';
  select value into v_side from jsonb_array_elements(v_pack.source_assets)
    where value->>'sourceImageId'='SIDE'
      and value->>'authorizationStatus'='AUTHORIZED_CATALOG_NATIVE_HIGH_RES';
  if v_main->>'sha256'<>v_revision.main_source_hash
    or v_side->>'sha256'<>v_revision.side_source_hash
    or coalesce(v_main->>'storagePath','')='' or coalesce(v_side->>'storagePath','')='' then
    raise exception 'EXTRAORDINARY_POSITION_4_PROTECTED_SOURCES_INVALID';
  end if;

  update public.ebay_reference_guided_generation_attempts a
  set max_provider_calls=8,provider_calls=7
  where a.id=v_attempt.id and a.provider_calls=6 and a.max_provider_calls=6
  returning a.provider_calls into v_calls;
  if v_calls<>7 then raise exception 'EXTRAORDINARY_POSITION_4_ATOMIC_BUDGET_INVALID'; end if;
  update public.ebay_reference_guided_generation_jobs
  set status='PROVIDER_CALLING',lease_owner=p_lease_owner,
      lease_expires_at=now()+interval '5 minutes',provider_call_started_at=now(),
      provider_call_completed_at=null,updated_at=now()
  where id=v_job.id;
  insert into public.ebay_reference_guided_extraordinary_provider_events(
    correction_plan_id,authorization_event_id,attempt_id,position,
    extraordinary_ordinal,event_type,evidence
  ) values(v_plan.id,v_authorization.id,v_attempt.id,4,7,'CONSUMED',
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

create or replace function public.complete_ebay_reference_guided_extraordinary_position_4(
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
  select * into v_auth from public.ebay_reference_guided_extraordinary_authorization_events
  where id=p_authorization_event_id and position=4 and extraordinary_ordinal=7 for share;
  select * into v_consumed from public.ebay_reference_guided_extraordinary_provider_events
  where id=p_consumed_event_id and authorization_event_id=v_auth.id
    and event_type='CONSUMED' and position=4 and extraordinary_ordinal=7 for share;
  select * into v_job from public.ebay_reference_guided_generation_jobs
  where id=p_job_id and generation_attempt_id=v_auth.attempt_id for update;
  if v_auth.id is null or v_consumed.id is null or v_job.id is null
    or v_job.position<>4 or v_job.status<>'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or (select provider_calls from public.ebay_reference_guided_generation_attempts where id=v_auth.attempt_id)<>7
    or (select max_provider_calls from public.ebay_reference_guided_generation_attempts where id=v_auth.attempt_id)<>8
    or p_http_status<>200 or coalesce(p_provider_request_id,'')=''
    or p_output_sha256!~'^[0-9a-f]{64}$'
    or p_output_storage_path not like '%/reference-guided-extraordinary/%/position-4/ordinal-7/%/'||p_output_sha256||'.png'
    or p_qa_result->>'automaticStatus'<>'HUMAN_REVIEW_REQUIRED'
    or p_qa_result->>'batchPlanHash'<>'9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3'
    or p_qa_result->>'amendmentHash'<>'8dbe3c4c8068a31d4c18153434faf7d7b88b25c17542cb67ad37f8aca80c1c8f'
    or p_qa_result->>'effectiveContractHash'<>'6cac13ae461915ba22d79b381c98eb53de93bd1f052e54716f67901013ca582a'
    or p_qa_result->>'effectivePromptHash'<>'4aca1c9ca9623e238c2f3714a01ed8d8931779d8fd06741c8173f8e9786ced91'
    or (p_qa_result->>'humanApprovalRequired')::boolean is distinct from true
    or (p_qa_result->>'autoApproved')::boolean is distinct from false
    or (p_qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (p_qa_result->'technicalChecks'->>'width')::integer<>1600
    or (p_qa_result->'technicalChecks'->>'height')::integer<>1600 then
    raise exception 'EXTRAORDINARY_POSITION_4_COMPLETION_INVALID';
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
  ) values(v_consumed.correction_plan_id,v_auth.id,v_auth.attempt_id,4,7,
    'OUTPUT_PERSISTED',v_consumed.id,jsonb_build_object(
      'httpStatus',p_http_status,'providerRequestId',p_provider_request_id,
      'outputStoragePath',p_output_storage_path,'outputSha256',p_output_sha256,
      'qa',p_qa_result));
  return v_job;
end;
$$;

create or replace function public.fail_ebay_reference_guided_extraordinary_position_4(
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
  select * into v_auth from public.ebay_reference_guided_extraordinary_authorization_events
  where id=p_authorization_event_id and position=4 and extraordinary_ordinal=7 for share;
  select * into v_consumed from public.ebay_reference_guided_extraordinary_provider_events
  where id=p_consumed_event_id and authorization_event_id=v_auth.id
    and event_type='CONSUMED' for share;
  select * into v_job from public.ebay_reference_guided_generation_jobs
  where id=p_job_id and generation_attempt_id=v_auth.attempt_id for update;
  if v_auth.id is null or v_consumed.id is null or v_job.id is null
    or v_job.position<>4 or v_job.status<>'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or coalesce(p_error_code,'')!~'^[A-Z][A-Z0-9_:.-]{2,180}$'
    or (select provider_calls from public.ebay_reference_guided_generation_attempts where id=v_auth.attempt_id)<>7 then
    raise exception 'EXTRAORDINARY_POSITION_4_FAILURE_RECORD_INVALID';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status=case when p_http_status=200 then 'PROVIDER_SUCCEEDED_PERSISTENCE_FAILED' else 'QUARANTINED' end,
      provider_request_id=nullif(p_provider_request_id,''),provider_call_completed_at=now(),
      error_code=p_error_code,lease_owner=null,lease_expires_at=null,updated_at=now()
  where id=v_job.id returning * into v_job;
  insert into public.ebay_reference_guided_extraordinary_provider_events(
    correction_plan_id,authorization_event_id,attempt_id,position,
    extraordinary_ordinal,event_type,consumed_event_id,evidence
  ) values(v_consumed.correction_plan_id,v_auth.id,v_auth.attempt_id,4,7,
    'FAILED_FINAL',v_consumed.id,jsonb_strip_nulls(jsonb_build_object(
      'httpStatus',p_http_status,'providerRequestId',nullif(p_provider_request_id,''),
      'errorCode',p_error_code,'outputStoragePath',p_output_storage_path,
      'outputSha256',p_output_sha256,'automaticRetryOccurred',false)));
  return v_job;
end;
$$;

revoke all on function public.consume_ebay_reference_guided_extraordinary_position_4(uuid,uuid,text,text,boolean) from public,anon,authenticated;
revoke all on function public.complete_ebay_reference_guided_extraordinary_position_4(uuid,uuid,uuid,text,integer,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.fail_ebay_reference_guided_extraordinary_position_4(uuid,uuid,uuid,text,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.consume_ebay_reference_guided_extraordinary_position_4(uuid,uuid,text,text,boolean) to service_role;
grant execute on function public.complete_ebay_reference_guided_extraordinary_position_4(uuid,uuid,uuid,text,integer,text,text,text,jsonb) to service_role;
grant execute on function public.fail_ebay_reference_guided_extraordinary_position_4(uuid,uuid,uuid,text,integer,text,text,text,text) to service_role;

notify pgrst,'reload schema';
