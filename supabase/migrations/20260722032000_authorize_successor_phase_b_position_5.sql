-- One explicitly human-authorized provider call for successor V2 position 5.
-- Authorization is append-only. The provider budget, authorization consumption,
-- and the sole position-5 lease are committed in one transaction before HTTP.

create table if not exists public.ebay_reference_guided_successor_provider_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  successor_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  position integer not null check (position between 3 and 6),
  event_type text not null check (event_type in
    ('AUTHORIZED','CONSUMED','OUTPUT_PERSISTED','FAILED_FINAL')),
  authorization_event_id uuid null references public.ebay_reference_guided_successor_provider_events(id),
  provider_call_ordinal integer not null check (provider_call_ordinal between 3 and 6),
  human_authorized_by uuid null references auth.users(id),
  human_authorized_at timestamptz null,
  human_confirmation_hash text null,
  reason text not null,
  http_status integer null,
  provider_request_id text null,
  output_storage_path text null,
  output_sha256 text null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (event_type = 'AUTHORIZED' and authorization_event_id is null
      and human_authorized_by is not null and human_authorized_at is not null
      and human_confirmation_hash ~ '^[0-9a-f]{64}$')
    or
    (event_type <> 'AUTHORIZED' and authorization_event_id is not null
      and human_authorized_by is null and human_authorized_at is null
      and human_confirmation_hash is null)
  ),
  check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$')
);

create unique index if not exists ebay_reference_guided_successor_one_p5_auth_uidx
  on public.ebay_reference_guided_successor_provider_events(
    attempt_id, successor_plan_id, position, provider_call_ordinal)
  where event_type = 'AUTHORIZED';
create unique index if not exists ebay_reference_guided_successor_one_p5_consume_uidx
  on public.ebay_reference_guided_successor_provider_events(authorization_event_id)
  where event_type = 'CONSUMED';
create unique index if not exists ebay_reference_guided_successor_one_p5_terminal_uidx
  on public.ebay_reference_guided_successor_provider_events(authorization_event_id)
  where event_type in ('OUTPUT_PERSISTED','FAILED_FINAL');

drop trigger if exists ebay_reference_guided_successor_provider_events_append_only
  on public.ebay_reference_guided_successor_provider_events;
create trigger ebay_reference_guided_successor_provider_events_append_only
before update or delete on public.ebay_reference_guided_successor_provider_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_successor_provider_events enable row level security;
alter table public.ebay_reference_guided_successor_provider_events force row level security;
revoke all on table public.ebay_reference_guided_successor_provider_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_successor_provider_events
  to service_role;

insert into public.ebay_reference_guided_successor_provider_events(
  attempt_id, successor_plan_id, job_id, position, event_type,
  provider_call_ordinal, human_authorized_by, human_authorized_at,
  human_confirmation_hash, reason, evidence
)
select a.id, p.id, j.id, 5, 'AUTHORIZED', 3, r.created_by, now(),
  encode(extensions.digest(convert_to(
    'AUTHORIZE_SUCCESSOR_PHASE_B|ATTEMPT=f166b395-8d3a-4921-b273-1a62a6032707|PLAN=c54a0bbc-b16c-47b3-8f4e-93d2152e3b34|PLAN_HASH=a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7|POSITION=5|ASSET_ROLE=SECONDARY_ASPIRATIONAL_LIFESTYLE|MAX_CALLS=1',
    'UTF8'), 'sha256'), 'hex'),
  'EXPLICIT_HUMAN_AUTHORIZATION_SINGLE_POSITION_5_PROVIDER_CALL',
  jsonb_build_object('model','gpt-image-2','endpoint','/v1/images/edits',
    'size','1600x1600','quality','high','outputFormat','png',
    'automaticRetries',false,'maximumAuthorizedCallsThisPhase',1)
from public.ebay_reference_guided_generation_attempts a
join public.ebay_same_day_pilot_image_revisions r on r.id = a.revision_id
join public.ebay_reference_guided_batch_plan_successors_v2 p
  on p.attempt_id = a.id
join public.ebay_reference_guided_generation_jobs j
  on j.generation_attempt_id = a.id and j.position = 5
where a.id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
  and p.id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
  and p.plan_hash = 'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
  and not exists (
    select 1 from public.ebay_reference_guided_successor_provider_events e
    where e.attempt_id = a.id and e.successor_plan_id = p.id
      and e.position = 5 and e.provider_call_ordinal = 3
      and e.event_type = 'AUTHORIZED'
  );

create or replace function public.consume_ebay_reference_guided_successor_position_5(
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
begin
  if not p_feature_enabled then
    raise exception 'SUCCESSOR_POSITION_5_FEATURE_DISABLED';
  end if;
  if p_successor_plan_id <> 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    or coalesce(length(p_lease_owner),0) < 12 then
    raise exception 'SUCCESSOR_POSITION_5_SCOPE_INVALID';
  end if;
  select * into v_plan from public.ebay_reference_guided_batch_plan_successors_v2
  where id = p_successor_plan_id for share;
  if not found
    or v_plan.attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or v_plan.plan_hash <> 'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    or v_plan.plan_hash <> encode(extensions.digest(
      convert_to(v_plan.plan_text, 'UTF8'), 'sha256'), 'hex')
    or v_plan.automatic_retries or v_plan.max_concurrency <> 2
    or v_plan.lifetime_provider_budget_used <> 2
    or v_plan.lifetime_provider_budget_max <> 6
    or v_plan.lifetime_provider_budget_remaining <> 4 then
    raise exception 'SUCCESSOR_POSITION_5_PLAN_INVALID';
  end if;
  select * into v_attempt from public.ebay_reference_guided_generation_attempts
  where id = v_plan.attempt_id for update;
  if not found or v_attempt.provider_calls <> 2
    or v_attempt.max_provider_calls <> 6 or v_attempt.retry_consumed
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed
    or v_attempt.status <> 'GENERATING'
    or v_attempt.composition_manifest_hash <>
      v_plan.plan_text::jsonb->>'compositionManifestHash' then
    raise exception 'SUCCESSOR_POSITION_5_ATTEMPT_INVALID';
  end if;
  select * into v_revision from public.ebay_same_day_pilot_image_revisions
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
    raise exception 'SUCCESSOR_POSITION_5_REVISION_INVALID';
  end if;
  select * into v_position
  from public.ebay_reference_guided_batch_plan_successor_positions_v2
  where successor_plan_id = v_plan.id and position = 5 for share;
  if not found or v_position.asset_role <> 'SECONDARY_ASPIRATIONAL_LIFESTYLE'
    or v_position.commercial_objective <> 'ASPIRATIONAL_LIFESTYLE'
    or v_position.execution_mode <> 'PROVIDER'
    or v_position.execution_phase <>
      'PHASE_B_SINGLE_PROVIDER_VALIDATION_AFTER_POSITION_2_HUMAN_APPROVAL'
    or v_position.planned_provider_calls <> 1
    or v_position.exact_prompt_hash <> encode(extensions.digest(
      convert_to(v_position.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_position.exact_prompt_text ~* '\mmay\M'
    or v_position.exact_prompt_text not like
      '%POSITION_MUST_INCLUDE MUST take priority%'
    or v_position.exact_prompt_text not like '%POSITION_MUST_INCLUDE_JSON=%'
    or v_position.authorized_sources <> jsonb_build_array(
      jsonb_build_object('sourceImageId','MAIN','sha256',v_revision.main_source_hash),
      jsonb_build_object('sourceImageId','SIDE','sha256',v_revision.side_source_hash))
    or not (v_position.must_include @> '["MUST show the exact empty product as the protagonist.","MUST use a modern, bright, clean kitchen.","MUST use soft natural light.","MUST use a lightly blurred background.","MUST keep props minimal and physically separated from the product.","MUST create an editorial composition clearly distinct from positions 3, 4, and 6."]'::jsonb)
    or not (v_position.must_exclude @> '["MUST NOT show hands, water, or food inside the product.","MUST NOT show product interaction.","MUST NOT add text, captions, badges, measurements, watermarks, or new logos."]'::jsonb)
    or jsonb_array_length(v_position.automatic_checks) = 0
    or jsonb_array_length(v_position.human_checks) = 0
    or jsonb_array_length(v_position.distinct_commercial_composition) <> 5 then
    raise exception 'SUCCESSOR_POSITION_5_CONTRACT_INVALID';
  end if;
  select * into v_job from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = v_attempt.id and position = 5 for update;
  if not found or v_job.status <> 'PENDING'
    or v_job.commercial_role <> 'ASPIRATIONAL_LIFESTYLE'
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.provider_request_id is not null
    or v_job.provider_call_started_at is not null
    or v_job.provider_call_completed_at is not null
    or v_job.output_storage_path is not null or v_job.output_sha256 is not null then
    raise exception 'SUCCESSOR_POSITION_5_JOB_INVALID';
  end if;
  if not exists (select 1 from public.ebay_reference_guided_asset_review_events
      where attempt_id = v_attempt.id and asset_ordinal = 2
        and preview_sha256 =
          '7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'
        and decision = 'APPROVED'
        and reason = 'HUMAN_CONFIRMED_SINGLE_COMPLETE_UNIT_SIDE_VIEW')
    or not exists (select 1 from public.ebay_reference_guided_final_asset_selection_events
      where attempt_id = v_attempt.id and primary_verdict = 'APPROVED'
        and material_detail_verdict = 'APPROVED'
        and primary_sha256 = v_plan.approved_primary_sha256
        and material_detail_sha256 = v_plan.approved_material_detail_sha256)
    or exists (select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = v_attempt.id
        and status in ('RESERVED','PROVIDER_CALLING')
        and lease_expires_at >= now())
    or exists (select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = v_attempt.id and position in (3,4,6)
        and (status <> 'PENDING' or lease_owner is not null
          or lease_expires_at is not null or provider_request_id is not null
          or provider_call_started_at is not null
          or provider_call_completed_at is not null
          or output_storage_path is not null or output_sha256 is not null)) then
    raise exception 'SUCCESSOR_POSITION_5_BATCH_GATE_INVALID';
  end if;
  select * into v_binding from public.luna_catalog_source_pack_dossier_bindings
  where listing_package_id = v_revision.listing_package_id
    and dossier_hash = v_revision.product_dossier_hash
    and policy_version = 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
  order by verified_at desc limit 1;
  if not found then raise exception 'SUCCESSOR_POSITION_5_BINDING_INVALID'; end if;
  select * into v_pack from public.luna_catalog_authorized_source_packs
  where id = v_binding.source_pack_id
    and listing_package_id = v_revision.listing_package_id for share;
  if not found or v_pack.source_pack_hash <> v_binding.source_pack_manifest_hash
    or coalesce(v_pack.manifest_hash,v_pack.source_pack_hash) <>
      v_binding.source_pack_manifest_hash then
    raise exception 'SUCCESSOR_POSITION_5_SOURCE_PACK_INVALID';
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
    raise exception 'SUCCESSOR_POSITION_5_PROTECTED_SOURCES_INVALID';
  end if;
  select * into v_authorization
  from public.ebay_reference_guided_successor_provider_events
  where successor_plan_id = v_plan.id and job_id = v_job.id and position = 5
    and event_type = 'AUTHORIZED' and provider_call_ordinal = 3
    and human_confirmation_hash = p_human_confirmation_hash
  for update;
  if not found or exists (select 1
    from public.ebay_reference_guided_successor_provider_events e
    where e.authorization_event_id = v_authorization.id
      and e.event_type in ('CONSUMED','OUTPUT_PERSISTED','FAILED_FINAL')) then
    raise exception 'SUCCESSOR_POSITION_5_AUTHORIZATION_INVALID';
  end if;
  update public.ebay_reference_guided_generation_attempts
  set provider_calls = provider_calls + 1
  where id = v_attempt.id and provider_calls = 2 and max_provider_calls = 6
  returning ebay_reference_guided_generation_attempts.provider_calls into v_calls;
  if v_calls <> 3 then raise exception 'SUCCESSOR_POSITION_5_BUDGET_INVALID'; end if;
  update public.ebay_reference_guided_generation_jobs
  set status = 'PROVIDER_CALLING', lease_owner = p_lease_owner,
      lease_expires_at = now() + interval '5 minutes',
      provider_call_started_at = now(), updated_at = now()
  where id = v_job.id;
  insert into public.ebay_reference_guided_successor_provider_events(
    attempt_id, successor_plan_id, job_id, position, event_type,
    authorization_event_id, provider_call_ordinal, reason, evidence
  ) values (v_attempt.id, v_plan.id, v_job.id, 5, 'CONSUMED',
    v_authorization.id, 3, 'ATOMIC_SINGLE_PROVIDER_CALL_RESERVED',
    jsonb_build_object('leaseOwner',p_lease_owner,'automaticRetries',false,
      'maximumCallsThisPhase',1));
  return query select v_authorization.id, v_job.id,
    v_position.exact_prompt_text, v_position.exact_prompt_hash,
    v_revision.main_source_hash, v_main->>'storagePath',
    v_revision.side_source_hash, v_side->>'storagePath', v_calls;
end;
$$;

create or replace function public.complete_ebay_reference_guided_successor_position_5(
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
  select * into v_auth from public.ebay_reference_guided_successor_provider_events
  where id = p_authorization_event_id and event_type = 'AUTHORIZED'
    and position = 5 and provider_call_ordinal = 3 for share;
  select * into v_job from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = v_auth.attempt_id for update;
  if not found or v_job.position <> 5 or v_job.status <> 'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or not exists (select 1 from public.ebay_reference_guided_successor_provider_events
      where authorization_event_id = v_auth.id and event_type = 'CONSUMED')
    or (select provider_calls from public.ebay_reference_guided_generation_attempts
      where id = v_auth.attempt_id) <> 3
    or p_http_status <> 200 or coalesce(p_provider_request_id,'') = ''
    or p_output_sha256 !~ '^[0-9a-f]{64}$'
    or p_output_storage_path not like
      '%/reference-guided-successor/%/position-5/%/' || p_output_sha256 || '.png'
    or p_qa_result->>'automaticStatus' <> 'HUMAN_REVIEW_REQUIRED'
    or (p_qa_result->>'humanApprovalRequired')::boolean is distinct from true
    or (p_qa_result->>'autoApproved')::boolean is distinct from false
    or (p_qa_result->'technicalChecks'->>'png')::boolean is distinct from true
    or (p_qa_result->'technicalChecks'->>'width')::integer <> 1600
    or (p_qa_result->'technicalChecks'->>'height')::integer <> 1600 then
    raise exception 'SUCCESSOR_POSITION_5_COMPLETION_INVALID';
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
  ) values (v_auth.attempt_id, v_auth.successor_plan_id, v_job.id, 5,
    'OUTPUT_PERSISTED', v_auth.id, 3,
    'PRIVATE_STORAGE_ROUNDTRIP_VERIFIED_HUMAN_REVIEW_REQUIRED',
    p_http_status, p_provider_request_id, p_output_storage_path,
    p_output_sha256, p_qa_result);
  return v_job;
end;
$$;

create or replace function public.fail_ebay_reference_guided_successor_position_5(
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
  select * into v_auth from public.ebay_reference_guided_successor_provider_events
  where id = p_authorization_event_id and event_type = 'AUTHORIZED'
    and position = 5 and provider_call_ordinal = 3 for share;
  select * into v_job from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = v_auth.attempt_id for update;
  if not found or v_job.position <> 5 or v_job.status <> 'PROVIDER_CALLING'
    or v_job.lease_owner is distinct from p_lease_owner
    or coalesce(p_error_code,'') !~ '^[A-Z][A-Z0-9_:.-]{2,180}$'
    or (select provider_calls from public.ebay_reference_guided_generation_attempts
      where id = v_auth.attempt_id) <> 3 then
    raise exception 'SUCCESSOR_POSITION_5_FAILURE_RECORD_INVALID';
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
  ) values (v_auth.attempt_id, v_auth.successor_plan_id, v_job.id, 5,
    'FAILED_FINAL', v_auth.id, 3, p_error_code, p_http_status,
    nullif(p_provider_request_id,''),
    jsonb_build_object('automaticRetryOccurred',false));
  return v_job;
end;
$$;

revoke all on function public.consume_ebay_reference_guided_successor_position_5(
  uuid,text,text,boolean) from public, anon, authenticated;
revoke all on function public.complete_ebay_reference_guided_successor_position_5(
  uuid,uuid,text,integer,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.fail_ebay_reference_guided_successor_position_5(
  uuid,uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.consume_ebay_reference_guided_successor_position_5(
  uuid,text,text,boolean) to service_role;
grant execute on function public.complete_ebay_reference_guided_successor_position_5(
  uuid,uuid,text,integer,text,text,text,jsonb) to service_role;
grant execute on function public.fail_ebay_reference_guided_successor_position_5(
  uuid,uuid,text,integer,text,text) to service_role;

notify pgrst, 'reload schema';
