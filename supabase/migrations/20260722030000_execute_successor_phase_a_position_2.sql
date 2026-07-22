-- Append-only Phase A evidence for the explicitly authorized deterministic
-- position 2. This migration creates no provider execution authority.
create table if not exists public.ebay_reference_guided_phase_a_position_2_assets (
  id uuid primary key default gen_random_uuid(),
  successor_plan_id uuid not null unique
    references public.ebay_reference_guided_batch_plan_successors_v2(id),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  job_id uuid not null unique references public.ebay_reference_guided_generation_jobs(id),
  position integer not null check (position = 2),
  asset_ordinal integer not null check (asset_ordinal = 2),
  asset_role text not null check (asset_role = 'SECONDARY_PACKAGE_CONTENTS'),
  execution_mode text not null check (execution_mode = 'DETERMINISTIC'),
  authorization_scope text not null check (
    authorization_scope = 'PHASE_A_POSITION_2_ONLY'),
  authorization_hash text not null check (authorization_hash ~ '^[0-9a-f]{64}$'),
  source_image_id text not null check (source_image_id = 'SIDE'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_storage_path text not null,
  source_width integer not null check (source_width = 1500),
  source_height integer not null check (source_height = 1051),
  transform_manifest_text text not null,
  transform_manifest_hash text not null check (transform_manifest_hash ~ '^[0-9a-f]{64}$'),
  output_storage_path text not null unique,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  output_width integer not null check (output_width = 1600),
  output_height integer not null check (output_height = 1600),
  background_color text not null check (background_color = '#FFFFFF'),
  qa_result jsonb not null,
  status text not null check (status = 'HUMAN_REVIEW_REQUIRED'),
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 2),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

drop trigger if exists ebay_reference_guided_phase_a_position_2_append_only
  on public.ebay_reference_guided_phase_a_position_2_assets;
create trigger ebay_reference_guided_phase_a_position_2_append_only
before update or delete on public.ebay_reference_guided_phase_a_position_2_assets
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_phase_a_position_2_assets
  enable row level security;
alter table public.ebay_reference_guided_phase_a_position_2_assets
  force row level security;
revoke all on table public.ebay_reference_guided_phase_a_position_2_assets
  from public, anon, authenticated, service_role;
grant select, insert on table
  public.ebay_reference_guided_phase_a_position_2_assets to service_role;

create or replace function public.record_ebay_reference_guided_phase_a_position_2(
  p_plan_id uuid,
  p_plan_hash text,
  p_authorization_hash text,
  p_source_sha256 text,
  p_source_storage_path text,
  p_output_storage_path text,
  p_output_sha256 text,
  p_transform_manifest_text text,
  p_transform_manifest_hash text,
  p_qa_result jsonb
) returns public.ebay_reference_guided_phase_a_position_2_assets
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan public.ebay_reference_guided_batch_plan_successors_v2%rowtype;
  v_position public.ebay_reference_guided_batch_plan_successor_positions_v2%rowtype;
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_existing public.ebay_reference_guided_phase_a_position_2_assets%rowtype;
  v_manifest jsonb;
  v_expected_authorization_hash text;
begin
  select * into v_plan
  from public.ebay_reference_guided_batch_plan_successors_v2
  where id = p_plan_id for share;
  if not found or v_plan.plan_hash <> p_plan_hash or v_plan.status <>
      'AWAITING_POSITION_2_DETERMINISTIC_EXECUTION_AUTHORIZATION' then
    raise exception 'PHASE_A_SUCCESSOR_PLAN_INVALID';
  end if;
  v_expected_authorization_hash := encode(extensions.digest(convert_to(
    'AUTHORIZE_PHASE_A|' || p_plan_id::text || '|' || p_plan_hash ||
    '|POSITION=2|ASSET_ROLE=SECONDARY_PACKAGE_CONTENTS|MODE=DETERMINISTIC',
    'UTF8'), 'sha256'), 'hex');
  if p_authorization_hash <> v_expected_authorization_hash then
    raise exception 'PHASE_A_HUMAN_AUTHORIZATION_INVALID';
  end if;
  select * into v_existing
  from public.ebay_reference_guided_phase_a_position_2_assets
  where successor_plan_id = p_plan_id;
  if found then
    if v_existing.output_sha256 <> p_output_sha256
      or v_existing.transform_manifest_hash <> p_transform_manifest_hash then
      raise exception 'PHASE_A_POSITION_2_CONFLICT';
    end if;
    return v_existing;
  end if;
  select * into v_position
  from public.ebay_reference_guided_batch_plan_successor_positions_v2
  where successor_plan_id = p_plan_id and position = 2 for share;
  if not found or v_position.asset_role <> 'SECONDARY_PACKAGE_CONTENTS'
    or v_position.commercial_objective <> 'CONFIRMED_PACKAGE_CONTENTS'
    or v_position.execution_mode <> 'DETERMINISTIC'
    or v_position.execution_phase <> 'PHASE_A_DETERMINISTIC_FIRST'
    or v_position.planned_provider_calls <> 0 then
    raise exception 'PHASE_A_POSITION_CONTRACT_INVALID';
  end if;
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = v_plan.attempt_id for update;
  if not found or v_attempt.provider_calls <> 2
    or v_attempt.max_provider_calls <> 6 or v_attempt.retry_consumed
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed then
    raise exception 'PHASE_A_ATTEMPT_INVALID';
  end if;
  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = v_plan.revision_id for share;
  if not found or v_revision.id <> v_attempt.revision_id
    or v_revision.side_source_hash <> p_source_sha256
    or p_source_sha256 <> 'f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21'
    or p_source_storage_path <>
      '75c9d5d5-03d2-478e-8999-714ba84ee994/catalog-source-packs/content-addressed/f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21-native.jpg'
    or v_position.authorized_sources <> jsonb_build_array(jsonb_build_object(
      'sourceImageId','SIDE','sha256',p_source_sha256)) then
    raise exception 'PHASE_A_PROTECTED_SIDE_INVALID';
  end if;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = v_attempt.id and position = 2 for update;
  if not found or v_job.commercial_role <> 'CONFIRMED_PACKAGE_CONTENTS'
    or v_job.status <> 'PENDING' or v_job.lease_owner is not null
    or v_job.lease_expires_at is not null
    or v_job.provider_call_started_at is not null
    or v_job.provider_call_completed_at is not null
    or v_job.provider_request_id is not null
    or v_job.output_storage_path is not null or v_job.output_sha256 is not null then
    raise exception 'PHASE_A_POSITION_2_NOT_PRISTINE';
  end if;
  if exists (select 1 from public.ebay_reference_guided_generation_jobs
    where generation_attempt_id = v_attempt.id and position between 3 and 6
      and (status <> 'PENDING' or lease_owner is not null
        or lease_expires_at is not null or provider_call_started_at is not null
        or provider_call_completed_at is not null or provider_request_id is not null
        or output_storage_path is not null or output_sha256 is not null)) then
    raise exception 'PHASE_A_POSITIONS_3_6_CHANGED';
  end if;
  if not exists (select 1
    from public.ebay_reference_guided_final_asset_selection_events s
    where s.attempt_id = v_attempt.id and s.primary_verdict = 'APPROVED'
      and s.material_detail_verdict = 'APPROVED'
      and s.primary_sha256 = v_plan.approved_primary_sha256
      and s.material_detail_sha256 = v_plan.approved_material_detail_sha256) then
    raise exception 'PHASE_A_POSITIONS_0_1_INVALID';
  end if;
  if not exists (select 1 from storage.objects
    where bucket_id = 'ebay-listing-image-sources'
      and name = p_source_storage_path)
    or not exists (select 1 from storage.objects
      where bucket_id = 'ebay-listing-image-staging'
        and name = p_output_storage_path
        and metadata->>'mimetype' = 'image/png')
    or not exists (select 1 from storage.buckets
      where id = 'ebay-listing-image-staging' and public = false) then
    raise exception 'PHASE_A_PRIVATE_STORAGE_INVALID';
  end if;
  begin v_manifest := p_transform_manifest_text::jsonb;
  exception when others then raise exception 'PHASE_A_TRANSFORM_MANIFEST_INVALID'; end;
  if p_transform_manifest_hash <> encode(extensions.digest(convert_to(
      p_transform_manifest_text, 'UTF8'), 'sha256'), 'hex')
    or p_output_storage_path not like
      '%/reference-guided-deterministic/' || v_attempt.id::text ||
      '/phase-a-position-2/' || p_transform_manifest_hash || '/' ||
      p_output_sha256 || '.png'
    or v_manifest->>'version' <> 'DETERMINISTIC_PACKAGE_CONTENTS_SIDE_V2'
    or v_manifest->>'planId' <> p_plan_id::text
    or v_manifest->>'planHash' <> p_plan_hash
    or (v_manifest->>'position')::integer <> 2
    or v_manifest->>'assetRole' <> 'SECONDARY_PACKAGE_CONTENTS'
    or v_manifest->>'mode' <> 'DETERMINISTIC'
    or v_manifest->'source'->>'sourceImageId' <> 'SIDE'
    or v_manifest->'source'->>'sha256' <> p_source_sha256
    or v_manifest->'source'->>'storagePath' <> p_source_storage_path
    or (v_manifest->'source'->>'nativeWidth')::integer <> 1500
    or (v_manifest->'source'->>'nativeHeight')::integer <> 1051
    or (v_manifest->'operation'->'crop'->>'left')::integer <> 0
    or (v_manifest->'operation'->'crop'->>'top')::integer <> 0
    or (v_manifest->'operation'->'crop'->>'width')::integer <> 1500
    or (v_manifest->'operation'->'crop'->>'height')::integer <> 1051
    or (v_manifest->'operation'->>'resizedWidth')::integer <> 1360
    or (v_manifest->'operation'->>'resizedHeight')::integer <> 953
    or (v_manifest->'operation'->'placement'->>'left')::integer <> 120
    or (v_manifest->'operation'->'placement'->>'top')::integer <> 323
    or (v_manifest->'operation'->>'compositeInputCount')::integer <> 1
    or (v_manifest->'operation'->>'generatedPixels')::boolean
      is distinct from false
    or (v_manifest->'operation'->>'productReconstruction')::boolean
      is distinct from false
    or (v_manifest->'operation'->>'textAdded')::boolean
      is distinct from false
    or (v_manifest->'output'->>'width')::integer <> 1600
    or (v_manifest->'output'->>'height')::integer <> 1600
    or v_manifest->'output'->>'format' <> 'png'
    or v_manifest->'output'->>'background' <> '#FFFFFF'
    or v_manifest->'qa' <> p_qa_result
    or (p_qa_result->>'backgroundPureWhite')::boolean is distinct from true
    or (p_qa_result->>'singleCompleteUnit')::boolean is distinct from true
    or (p_qa_result->>'safeMargins')::boolean is distinct from true
    or (p_qa_result->>'clippingDetected')::boolean is distinct from false
    or (p_qa_result->>'textDetected')::boolean is distinct from false
    or (p_qa_result->>'sideAngleDifferentFromPrimary')::boolean is distinct from true then
    raise exception 'PHASE_A_TRANSFORM_MANIFEST_INVALID';
  end if;
  insert into public.ebay_reference_guided_phase_a_position_2_assets(
    successor_plan_id, attempt_id, revision_id, job_id, position,
    asset_ordinal, asset_role, execution_mode, authorization_scope,
    authorization_hash, source_image_id, source_sha256, source_storage_path,
    source_width, source_height, transform_manifest_text,
    transform_manifest_hash, output_storage_path, output_sha256, output_width,
    output_height, background_color, qa_result, status,
    provider_calls_snapshot, created_by
  ) values (
    v_plan.id, v_attempt.id, v_revision.id, v_job.id, 2, 2,
    'SECONDARY_PACKAGE_CONTENTS', 'DETERMINISTIC',
    'PHASE_A_POSITION_2_ONLY', p_authorization_hash, 'SIDE', p_source_sha256,
    p_source_storage_path, 1500, 1051, p_transform_manifest_text,
    p_transform_manifest_hash, p_output_storage_path, p_output_sha256,
    1600, 1600, '#FFFFFF', p_qa_result, 'HUMAN_REVIEW_REQUIRED', 2,
    v_plan.created_by
  ) returning * into v_existing;
  update public.ebay_reference_guided_generation_jobs
  set status = 'QA_PENDING', output_storage_path = p_output_storage_path,
      output_sha256 = p_output_sha256,
      qa_result = p_qa_result || jsonb_build_object(
        'automaticStatus','PASSED_DETERMINISTIC_QA',
        'humanApprovalRequired',true,
        'assetStatus','HUMAN_REVIEW_REQUIRED'),
      error_code = null, updated_at = now()
  where id = v_job.id;
  return v_existing;
end;
$$;

revoke all on function public.record_ebay_reference_guided_phase_a_position_2(
  uuid,text,text,text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_ebay_reference_guided_phase_a_position_2(
  uuid,text,text,text,text,text,text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
