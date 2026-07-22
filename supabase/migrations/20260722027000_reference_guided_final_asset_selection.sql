-- Final human selection of the two deterministic assets currently available.
-- Evidence is append-only and does not mutate generation jobs or publication.
create table if not exists public.ebay_reference_guided_final_asset_selection_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  primary_storage_path text not null,
  primary_sha256 text not null check (primary_sha256 ~ '^[0-9a-f]{64}$'),
  primary_verdict text not null check (primary_verdict = 'APPROVED'),
  primary_background text not null check (primary_background = '#FFFFFF'),
  primary_safe_margin_pixels integer not null check (primary_safe_margin_pixels >= 120),
  material_detail_storage_path text not null,
  material_detail_sha256 text not null check (material_detail_sha256 ~ '^[0-9a-f]{64}$'),
  material_detail_source text not null check (material_detail_source = 'SIDE'),
  material_detail_verdict text not null check (material_detail_verdict = 'APPROVED'),
  rejected_main_detail_storage_path text not null,
  rejected_main_detail_sha256 text not null check (rejected_main_detail_sha256 ~ '^[0-9a-f]{64}$'),
  rejected_main_detail_reason text not null check (
    rejected_main_detail_reason = 'EDGE_CLIPPING/INFERIOR_COMPOSITION'
  ),
  rejected_canary_storage_path text not null,
  rejected_canary_sha256 text not null check (rejected_canary_sha256 ~ '^[0-9a-f]{64}$'),
  rejected_canary_reason text not null check (
    rejected_canary_reason = 'COMMERCIAL_OBJECTIVE_MISMATCH'
  ),
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 2),
  positions_2_6_snapshot jsonb not null,
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

drop trigger if exists ebay_reference_guided_final_selection_append_only
  on public.ebay_reference_guided_final_asset_selection_events;
create trigger ebay_reference_guided_final_selection_append_only
before update or delete on public.ebay_reference_guided_final_asset_selection_events
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_final_asset_selection_events
  enable row level security;
alter table public.ebay_reference_guided_final_asset_selection_events
  force row level security;
revoke all on table public.ebay_reference_guided_final_asset_selection_events
  from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_final_asset_selection_events
  to service_role;

create or replace function public.record_ebay_reference_guided_final_asset_selection(
  p_attempt_id uuid,
  p_primary_sha256 text,
  p_material_detail_sha256 text,
  p_rejected_main_detail_sha256 text,
  p_rejected_canary_sha256 text
) returns table(selection_id uuid, reused boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_primary public.ebay_reference_guided_deterministic_asset_variants%rowtype;
  v_material public.ebay_reference_guided_deterministic_asset_variants%rowtype;
  v_main_detail public.ebay_reference_guided_deterministic_previews%rowtype;
  v_canary public.ebay_reference_guided_generation_jobs%rowtype;
  v_existing public.ebay_reference_guided_final_asset_selection_events%rowtype;
  v_snapshot jsonb;
  v_id uuid;
begin
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for update;
  if not found or v_attempt.provider_calls <> 2
    or v_attempt.retry_consumed <> false or v_attempt.ebay_writes <> 0
    or v_attempt.production_changed <> false then
    raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_ATTEMPT_INVALID';
  end if;

  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = v_attempt.revision_id for share;
  if not found or v_revision.strategy_version <> 'VISUAL_STRATEGY_V3'
    or v_revision.revision_contract <> 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1' then
    raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_REVISION_INVALID';
  end if;

  if (select count(*) from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id) <> 6
    or exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position between 2 and 6
        and (status <> 'PENDING' or lease_owner is not null
          or lease_expires_at is not null or output_storage_path is not null
          or output_sha256 is not null)
    ) then
    raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_POSITIONS_CHANGED';
  end if;
  select jsonb_agg(jsonb_build_object(
    'position', position, 'status', status, 'leaseOwner', lease_owner,
    'leaseExpiresAt', lease_expires_at, 'outputStoragePath', output_storage_path,
    'outputSha256', output_sha256
  ) order by position) into v_snapshot
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id and position between 2 and 6;

  select * into v_primary
  from public.ebay_reference_guided_deterministic_asset_variants
  where attempt_id = p_attempt_id and asset_ordinal = 0
    and variant_version = 'DETERMINISTIC_PRIMARY_VERTICAL_CENTER_V1'
  for share;
  if not found or v_primary.source_image_id <> 'MAIN'
    or v_primary.output_sha256 <> p_primary_sha256
    or v_primary.qa_metrics->>'exactWhiteCorners' <> 'true'
    or (v_primary.qa_metrics->'margins'->>'left')::integer < 120
    or (v_primary.qa_metrics->'margins'->>'right')::integer < 120 then
    raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_PRIMARY_INVALID';
  end if;

  select * into v_material
  from public.ebay_reference_guided_deterministic_asset_variants
  where attempt_id = p_attempt_id and asset_ordinal = 1
    and variant_version = 'DETERMINISTIC_SOURCE_CROP_SIDE_V1'
  for share;
  if not found or v_material.source_image_id <> 'SIDE'
    or v_material.output_sha256 <> p_material_detail_sha256 then
    raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_SIDE_INVALID';
  end if;

  select * into v_main_detail
  from public.ebay_reference_guided_deterministic_previews
  where attempt_id = p_attempt_id and asset_ordinal = 1
    and source_image_id = 'MAIN' for share;
  if not found or v_main_detail.output_sha256 <> p_rejected_main_detail_sha256 then
    raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_MAIN_DETAIL_INVALID';
  end if;

  select * into v_canary
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id and position = 1 for share;
  if not found or v_canary.status <> 'BLOCKED_FIDELITY'
    or v_canary.output_sha256 <> p_rejected_canary_sha256
    or not exists (
      select 1 from public.ebay_reference_guided_human_review_events h
      where h.attempt_id = p_attempt_id and h.job_id = v_canary.id
        and h.output_sha256 = p_rejected_canary_sha256
        and h.verdict = 'REJECTED'
        and h.reason = 'COMMERCIAL_OBJECTIVE_MISMATCH'
        and h.output_preserved = true
    ) then
    raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_CANARY_INVALID';
  end if;

  if exists (
    select 1 from (values
      (v_primary.output_storage_path), (v_material.output_storage_path),
      (v_main_detail.output_storage_path), (v_canary.output_storage_path)
    ) paths(path)
    where not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'ebay-listing-image-staging' and o.name = paths.path
        and o.metadata->>'mimetype' = 'image/png'
    )
  ) then
    raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_PRIVATE_OBJECT_MISSING';
  end if;

  select * into v_existing
  from public.ebay_reference_guided_final_asset_selection_events
  where attempt_id = p_attempt_id;
  if found then
    if v_existing.primary_sha256 <> p_primary_sha256
      or v_existing.material_detail_sha256 <> p_material_detail_sha256
      or v_existing.rejected_main_detail_sha256 <> p_rejected_main_detail_sha256
      or v_existing.rejected_canary_sha256 <> p_rejected_canary_sha256 then
      raise exception 'REFERENCE_GUIDED_FINAL_SELECTION_CONFLICT';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  insert into public.ebay_reference_guided_asset_review_events(
    attempt_id, revision_id, asset_ordinal, asset_role, preview_sha256,
    decision, reason, reviewer_id
  ) values
    (p_attempt_id, v_revision.id, 0, 'PRIMARY_MAIN', p_primary_sha256,
      'APPROVED', 'HUMAN_FINAL_SELECTION_PRIMARY_MAIN', v_revision.created_by),
    (p_attempt_id, v_revision.id, 1, 'SECONDARY_MATERIAL_DETAIL',
      p_material_detail_sha256, 'APPROVED',
      'HUMAN_FINAL_SELECTION_SIDE_MATERIAL_DETAIL', v_revision.created_by),
    (p_attempt_id, v_revision.id, 1, 'SECONDARY_MATERIAL_DETAIL',
      p_rejected_main_detail_sha256, 'REJECTED',
      'EDGE_CLIPPING/INFERIOR_COMPOSITION', v_revision.created_by);

  insert into public.ebay_reference_guided_final_asset_selection_events(
    attempt_id, revision_id, primary_storage_path, primary_sha256,
    primary_verdict, primary_background, primary_safe_margin_pixels,
    material_detail_storage_path, material_detail_sha256,
    material_detail_source, material_detail_verdict,
    rejected_main_detail_storage_path, rejected_main_detail_sha256,
    rejected_main_detail_reason, rejected_canary_storage_path,
    rejected_canary_sha256, rejected_canary_reason, provider_calls_snapshot,
    positions_2_6_snapshot, reviewer_id
  ) values (
    p_attempt_id, v_revision.id, v_primary.output_storage_path,
    p_primary_sha256, 'APPROVED', '#FFFFFF', 120,
    v_material.output_storage_path, p_material_detail_sha256, 'SIDE',
    'APPROVED', v_main_detail.output_storage_path,
    p_rejected_main_detail_sha256, 'EDGE_CLIPPING/INFERIOR_COMPOSITION',
    v_canary.output_storage_path, p_rejected_canary_sha256,
    'COMMERCIAL_OBJECTIVE_MISMATCH', 2, v_snapshot, v_revision.created_by
  ) returning id into v_id;
  return query select v_id, false;
end;
$$;

revoke all on function public.record_ebay_reference_guided_final_asset_selection(
  uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_ebay_reference_guided_final_asset_selection(
  uuid, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
