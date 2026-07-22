-- Append-only human verdict and deterministic Secondary 1 evidence.
-- The rejected provider output remains on its original job as canary evidence.
create table if not exists public.ebay_reference_guided_human_review_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  job_position integer not null check (job_position between 1 and 6),
  asset_ordinal integer not null check (asset_ordinal between 1 and 6),
  asset_role text not null check (asset_role in (
    'SECONDARY_MATERIAL_DETAIL','SECONDARY_PACKAGE_CONTENTS',
    'SECONDARY_SCALE_CAPACITY','SECONDARY_USE_CONTEXT',
    'SECONDARY_ASPIRATIONAL_LIFESTYLE','SECONDARY_HUMAN_CONTEXT'
  )),
  verdict text not null check (verdict in ('APPROVED','REJECTED')),
  reason text not null,
  identity_assessment text not null,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  output_preserved boolean not null,
  provider_calls_snapshot integer not null check (provider_calls_snapshot >= 0),
  human_reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(attempt_id, job_id, output_sha256, verdict)
);

create table if not exists public.ebay_reference_guided_deterministic_previews (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  job_id uuid not null references public.ebay_reference_guided_generation_jobs(id),
  job_position integer not null check (job_position = 1),
  asset_ordinal integer not null check (asset_ordinal = 1),
  asset_role text not null check (asset_role = 'SECONDARY_MATERIAL_DETAIL'),
  contract_version text not null check (contract_version = 'DETERMINISTIC_SOURCE_CROP_V1'),
  source_image_id text not null check (source_image_id = 'MAIN'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_storage_path text not null,
  crop_left integer not null check (crop_left >= 0),
  crop_top integer not null check (crop_top >= 0),
  crop_width integer not null check (crop_width > 0),
  crop_height integer not null check (crop_height > 0),
  upscale_factor numeric(8,4) not null check (upscale_factor > 0 and upscale_factor <= 2),
  output_width integer not null check (output_width = 1600),
  output_height integer not null check (output_height = 1600),
  output_storage_path text not null unique,
  output_sha256 text not null check (output_sha256 ~ '^[0-9a-f]{64}$'),
  transform_manifest_text text not null,
  transform_manifest_hash text not null check (transform_manifest_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status = 'PENDING_HUMAN_REVIEW'),
  original_canary_output_sha256 text not null check (original_canary_output_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(attempt_id, job_id, contract_version)
);

-- The seven publication assets are not the six generation jobs. Ordinal zero is
-- the deterministic eBay cover; job positions one through six are secondaries.
create table if not exists public.ebay_reference_guided_asset_contract_slots (
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  asset_ordinal integer not null check (asset_ordinal between 0 and 6),
  asset_role text not null,
  source_job_position integer,
  source_job_id uuid references public.ebay_reference_guided_generation_jobs(id),
  rendering_contract text not null,
  created_at timestamptz not null default now(),
  primary key (attempt_id, asset_ordinal),
  unique (attempt_id, asset_role),
  check (
    (asset_ordinal = 0 and asset_role = 'PRIMARY_MAIN'
      and source_job_position is null and source_job_id is null
      and rendering_contract = 'DETERMINISTIC_PRIMARY_MAIN_V1')
    or
    (asset_ordinal = 1 and asset_role = 'SECONDARY_MATERIAL_DETAIL'
      and source_job_position = 1 and source_job_id is not null
      and rendering_contract = 'DETERMINISTIC_SOURCE_CROP_V1')
    or
    (asset_ordinal = 2 and asset_role = 'SECONDARY_PACKAGE_CONTENTS'
      and source_job_position = 2 and source_job_id is not null
      and rendering_contract = 'REFERENCE_GUIDED_PROVIDER')
    or
    (asset_ordinal = 3 and asset_role = 'SECONDARY_SCALE_CAPACITY'
      and source_job_position = 3 and source_job_id is not null
      and rendering_contract = 'REFERENCE_GUIDED_PROVIDER')
    or
    (asset_ordinal = 4 and asset_role = 'SECONDARY_USE_CONTEXT'
      and source_job_position = 4 and source_job_id is not null
      and rendering_contract = 'REFERENCE_GUIDED_PROVIDER')
    or
    (asset_ordinal = 5 and asset_role = 'SECONDARY_ASPIRATIONAL_LIFESTYLE'
      and source_job_position = 5 and source_job_id is not null
      and rendering_contract = 'REFERENCE_GUIDED_PROVIDER')
    or
    (asset_ordinal = 6 and asset_role = 'SECONDARY_HUMAN_CONTEXT'
      and source_job_position = 6 and source_job_id is not null
      and rendering_contract = 'REFERENCE_GUIDED_PROVIDER')
  )
);

create or replace function public.prevent_reference_guided_human_evidence_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'REFERENCE_GUIDED_HUMAN_EVIDENCE_APPEND_ONLY';
end;
$$;

drop trigger if exists ebay_reference_guided_human_review_append_only
  on public.ebay_reference_guided_human_review_events;
create trigger ebay_reference_guided_human_review_append_only
before update or delete on public.ebay_reference_guided_human_review_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

drop trigger if exists ebay_reference_guided_deterministic_preview_append_only
  on public.ebay_reference_guided_deterministic_previews;
create trigger ebay_reference_guided_deterministic_preview_append_only
before update or delete on public.ebay_reference_guided_deterministic_previews
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

drop trigger if exists ebay_reference_guided_asset_contract_slots_append_only
  on public.ebay_reference_guided_asset_contract_slots;
create trigger ebay_reference_guided_asset_contract_slots_append_only
before update or delete on public.ebay_reference_guided_asset_contract_slots
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_human_review_events enable row level security;
alter table public.ebay_reference_guided_human_review_events force row level security;
alter table public.ebay_reference_guided_deterministic_previews enable row level security;
alter table public.ebay_reference_guided_deterministic_previews force row level security;
alter table public.ebay_reference_guided_asset_contract_slots enable row level security;
alter table public.ebay_reference_guided_asset_contract_slots force row level security;
revoke all on table public.ebay_reference_guided_human_review_events,
  public.ebay_reference_guided_deterministic_previews,
  public.ebay_reference_guided_asset_contract_slots
  from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_human_review_events,
  public.ebay_reference_guided_deterministic_previews,
  public.ebay_reference_guided_asset_contract_slots to service_role;

create or replace function public.record_ebay_reference_guided_position_1_rejection_and_crop(
  p_attempt_id uuid,
  p_source_sha256 text,
  p_source_storage_path text,
  p_crop_left integer,
  p_crop_top integer,
  p_crop_width integer,
  p_crop_height integer,
  p_upscale_factor numeric,
  p_output_storage_path text,
  p_output_sha256 text,
  p_transform_manifest_text text,
  p_transform_manifest_hash text
) returns public.ebay_reference_guided_deterministic_previews
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_preview public.ebay_reference_guided_deterministic_previews%rowtype;
  v_manifest jsonb;
begin
  select * into v_attempt from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for update;
  if not found or v_attempt.provider_calls <> 2 or v_attempt.retry_consumed <> false
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed <> false then
    raise exception 'REFERENCE_GUIDED_HUMAN_VERDICT_ATTEMPT_INVALID';
  end if;
  select * into v_revision from public.ebay_same_day_pilot_image_revisions
  where id = v_attempt.revision_id for share;
  select * into v_job from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id and position = 1 for update;
  if not found or v_job.commercial_role <> 'MATERIAL_AND_FINISH_DETAIL'
    or v_job.status not in ('QA_PENDING','BLOCKED_FIDELITY')
    or v_job.output_sha256 <> 'cc0ef29aba4ea671d64811bd5126c3a6c9d387028e330f88330de3fc9fc8aa20'
    or v_job.output_storage_path is null
    or v_job.source_main_hash <> p_source_sha256
    or v_revision.main_source_hash <> p_source_sha256 then
    raise exception 'REFERENCE_GUIDED_HUMAN_VERDICT_JOB_INVALID';
  end if;
  if not exists (select 1 from storage.objects o
      where o.bucket_id = 'ebay-listing-image-staging'
        and o.name = v_job.output_storage_path)
    or not exists (select 1 from storage.objects o
      where o.bucket_id = 'ebay-listing-image-staging'
        and o.name = p_output_storage_path
        and o.metadata->>'mimetype' = 'image/png') then
    raise exception 'REFERENCE_GUIDED_HUMAN_VERDICT_OUTPUT_NOT_PRESERVED';
  end if;
  if exists (select 1 from public.ebay_reference_guided_generation_jobs j
    where j.generation_attempt_id = p_attempt_id and j.position between 2 and 6
      and (j.status <> 'PENDING' or j.lease_owner is not null
        or j.lease_expires_at is not null or j.output_storage_path is not null)) then
    raise exception 'REFERENCE_GUIDED_SECONDARY_POSITIONS_CHANGED';
  end if;
  if exists (
    select 1 from public.ebay_reference_guided_generation_jobs j
    where j.generation_attempt_id = p_attempt_id and (
      (j.position = 1 and j.commercial_role <> 'MATERIAL_AND_FINISH_DETAIL') or
      (j.position = 2 and j.commercial_role <> 'CONFIRMED_PACKAGE_CONTENTS') or
      (j.position = 3 and j.commercial_role <> 'SCALE_AND_CAPACITY_CONTEXT') or
      (j.position = 4 and j.commercial_role <> 'PRIMARY_BENEFIT_IN_ACTION') or
      (j.position = 5 and j.commercial_role <> 'ASPIRATIONAL_LIFESTYLE') or
      (j.position = 6 and j.commercial_role <> 'REAL_HUMAN_USE')
    )
  ) then
    raise exception 'REFERENCE_GUIDED_SEVEN_ASSET_JOB_BINDING_INVALID';
  end if;
  begin v_manifest := p_transform_manifest_text::jsonb;
  exception when others then raise exception 'DETERMINISTIC_SOURCE_CROP_MANIFEST_INVALID'; end;
  if p_transform_manifest_hash <> encode(extensions.digest(
      convert_to(p_transform_manifest_text, 'UTF8'), 'sha256'), 'hex')
    or v_manifest->>'version' <> 'DETERMINISTIC_SOURCE_CROP_V1'
    or (v_manifest->>'position')::integer <> 1
    or v_manifest->>'commercialObjective' <> 'MATERIAL_AND_FINISH_DETAIL'
    or v_manifest->'source'->>'sourceImageId' <> 'MAIN'
    or v_manifest->'source'->>'sha256' <> p_source_sha256
    or v_manifest->'categorySignalsApplied' <> '[]'::jsonb
    or (v_manifest->>'generatedPixels')::boolean is distinct from false
    or (v_manifest->'crop'->>'left')::integer <> p_crop_left
    or (v_manifest->'crop'->>'top')::integer <> p_crop_top
    or (v_manifest->'crop'->>'width')::integer <> p_crop_width
    or (v_manifest->'crop'->>'height')::integer <> p_crop_height
    or (v_manifest->'output'->>'width')::integer <> 1600
    or (v_manifest->'output'->>'height')::integer <> 1600
    or (v_manifest->'output'->>'upscaleFactor')::numeric <> p_upscale_factor
    or p_crop_width <> p_crop_height or p_upscale_factor > 2 then
    raise exception 'DETERMINISTIC_SOURCE_CROP_MANIFEST_INVALID';
  end if;

  insert into public.ebay_reference_guided_human_review_events(
    attempt_id, job_id, job_position, asset_ordinal, asset_role, verdict,
    reason, identity_assessment, output_sha256, output_preserved,
    provider_calls_snapshot, human_reviewer_id
  ) values (
    p_attempt_id, v_job.id, 1, 1, 'SECONDARY_MATERIAL_DETAIL', 'REJECTED',
    'COMMERCIAL_OBJECTIVE_MISMATCH',
    'BROADLY_CONSISTENT_NOT_PIXEL_CERTIFIED', v_job.output_sha256, true,
    2, v_revision.created_by
  ) on conflict (attempt_id, job_id, output_sha256, verdict) do nothing;

  insert into public.ebay_reference_guided_deterministic_previews(
    attempt_id, job_id, job_position, asset_ordinal, asset_role,
    contract_version, source_image_id, source_sha256, source_storage_path,
    crop_left, crop_top, crop_width, crop_height, upscale_factor,
    output_width, output_height, output_storage_path, output_sha256,
    transform_manifest_text, transform_manifest_hash, status,
    original_canary_output_sha256
  ) values (
    p_attempt_id, v_job.id, 1, 1, 'SECONDARY_MATERIAL_DETAIL',
    'DETERMINISTIC_SOURCE_CROP_V1', 'MAIN', p_source_sha256,
    p_source_storage_path, p_crop_left, p_crop_top, p_crop_width,
    p_crop_height, p_upscale_factor, 1600, 1600, p_output_storage_path,
    p_output_sha256, p_transform_manifest_text, p_transform_manifest_hash,
    'PENDING_HUMAN_REVIEW', v_job.output_sha256
  ) on conflict (attempt_id, job_id, contract_version) do nothing;

  insert into public.ebay_reference_guided_asset_contract_slots(
    attempt_id, asset_ordinal, asset_role, source_job_position,
    source_job_id, rendering_contract
  )
  select p_attempt_id, slot.asset_ordinal, slot.asset_role,
    slot.job_position, jobs.id, slot.rendering_contract
  from (values
    (0, 'PRIMARY_MAIN', null::integer, 'DETERMINISTIC_PRIMARY_MAIN_V1'),
    (1, 'SECONDARY_MATERIAL_DETAIL', 1, 'DETERMINISTIC_SOURCE_CROP_V1'),
    (2, 'SECONDARY_PACKAGE_CONTENTS', 2, 'REFERENCE_GUIDED_PROVIDER'),
    (3, 'SECONDARY_SCALE_CAPACITY', 3, 'REFERENCE_GUIDED_PROVIDER'),
    (4, 'SECONDARY_USE_CONTEXT', 4, 'REFERENCE_GUIDED_PROVIDER'),
    (5, 'SECONDARY_ASPIRATIONAL_LIFESTYLE', 5, 'REFERENCE_GUIDED_PROVIDER'),
    (6, 'SECONDARY_HUMAN_CONTEXT', 6, 'REFERENCE_GUIDED_PROVIDER')
  ) as slot(asset_ordinal, asset_role, job_position, rendering_contract)
  left join public.ebay_reference_guided_generation_jobs jobs
    on jobs.generation_attempt_id = p_attempt_id
    and jobs.position = slot.job_position
  on conflict (attempt_id, asset_ordinal) do nothing;

  if (select count(*) from public.ebay_reference_guided_asset_contract_slots
      where attempt_id = p_attempt_id) <> 7 then
    raise exception 'REFERENCE_GUIDED_SEVEN_ASSET_CONTRACT_PERSISTENCE_FAILED';
  end if;

  update public.ebay_reference_guided_generation_jobs
  set status = 'BLOCKED_FIDELITY', error_code = 'COMMERCIAL_OBJECTIVE_MISMATCH',
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = v_job.id;

  select * into v_preview from public.ebay_reference_guided_deterministic_previews
  where attempt_id = p_attempt_id and job_id = v_job.id
    and contract_version = 'DETERMINISTIC_SOURCE_CROP_V1';
  return v_preview;
end;
$$;

revoke all on function public.record_ebay_reference_guided_position_1_rejection_and_crop(
  uuid,text,text,integer,integer,integer,integer,numeric,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.record_ebay_reference_guided_position_1_rejection_and_crop(
  uuid,text,text,integer,integer,integer,integer,numeric,text,text,text,text
) to service_role;

notify pgrst, 'reload schema';
