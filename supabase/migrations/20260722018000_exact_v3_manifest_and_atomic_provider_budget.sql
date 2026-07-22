-- Append-only correction for exact V3 prompts and atomic provider budgeting.
-- This migration supersedes the known invalid prepared attempt without editing
-- any of its six jobs, hashes or prompt metadata. It makes no provider/eBay call.

alter table public.ebay_reference_guided_generation_attempts
  add column if not exists composition_manifest_text text,
  add column if not exists source_pack_manifest_hash text,
  add column if not exists max_provider_calls integer not null default 6,
  add column if not exists invalid_manifest_reasons text[] not null default '{}',
  add column if not exists superseded_at timestamptz;

alter table public.ebay_reference_guided_generation_attempts
  drop constraint if exists ebay_reference_guided_generation_attempts_status_check;
alter table public.ebay_reference_guided_generation_attempts
  add constraint ebay_reference_guided_generation_attempts_status_check check (
    status in ('PENDING','GENERATING','READY_FOR_HUMAN_REVIEW',
      'FAILED_RETRYABLE','BLOCKED','PROVIDER_OUTCOME_UNKNOWN','QUARANTINED',
      'SUPERSEDED_INVALID_MANIFEST')
  ),
  add constraint ebay_reference_guided_attempt_provider_budget_check
    check (max_provider_calls = 6 and provider_calls between 0 and max_provider_calls),
  add constraint ebay_reference_guided_superseded_evidence_check check (
    status <> 'SUPERSEDED_INVALID_MANIFEST'
    or (
      superseded_at is not null
      and invalid_manifest_reasons = array[
        'PRODUCT_DOSSIER_HASH_NULL',
        'MARKET_VISUAL_BRIEF_HASH_MISMATCH',
        'PROMPT_HASH_NOT_EXACT_PROMPT'
      ]::text[]
    )
  );

alter table public.ebay_reference_guided_generation_jobs
  add column if not exists exact_prompt_text text,
  add column if not exists prompt_template_version text,
  add column if not exists allowed_product_facts jsonb,
  add column if not exists allowed_generated_context jsonb,
  add column if not exists prohibited_claims jsonb;

do $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_job_count integer;
begin
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = 'a17327c6-c26c-49ef-8c64-4ea33d64ab1f'::uuid
  for update;
  if not found then
    raise exception 'KNOWN_INVALID_REFERENCE_GUIDED_ATTEMPT_NOT_FOUND';
  end if;
  if v_attempt.revision_id <> '3a4a233e-d4bc-4a65-825f-c4882bceb9d1'::uuid
    or v_attempt.provider_calls <> 0
    or v_attempt.retry_consumed
    or v_attempt.ebay_writes <> 0
    or v_attempt.production_changed then
    raise exception 'KNOWN_INVALID_REFERENCE_GUIDED_ATTEMPT_STATE_MISMATCH';
  end if;
  select count(*) into v_job_count
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = v_attempt.id;
  if v_job_count <> 6 then
    raise exception 'KNOWN_INVALID_REFERENCE_GUIDED_JOB_HISTORY_INCOMPLETE';
  end if;
  update public.ebay_reference_guided_generation_attempts
  set status = 'SUPERSEDED_INVALID_MANIFEST',
      invalid_manifest_reasons = array[
        'PRODUCT_DOSSIER_HASH_NULL',
        'MARKET_VISUAL_BRIEF_HASH_MISMATCH',
        'PROMPT_HASH_NOT_EXACT_PROMPT'
      ]::text[],
      superseded_at = coalesce(superseded_at, now())
  where id = v_attempt.id;
end;
$$;

create or replace function public.create_ebay_reference_guided_generation_attempt_v2(
  p_revision_id uuid,
  p_composition_manifest_text text
) returns public.ebay_reference_guided_generation_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_binding public.luna_catalog_source_pack_dossier_bindings%rowtype;
  v_pack public.luna_catalog_authorized_source_packs%rowtype;
  v_manifest jsonb;
  v_manifest_hash text;
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_job jsonb;
  v_position_count integer;
  v_objective_count integer;
  v_job_count integer;
begin
  if p_composition_manifest_text is null
    or octet_length(p_composition_manifest_text) < 100 then
    raise exception 'REFERENCE_GUIDED_MANIFEST_TEXT_REQUIRED';
  end if;
  begin
    v_manifest := p_composition_manifest_text::jsonb;
  exception when others then
    raise exception 'REFERENCE_GUIDED_MANIFEST_JSON_INVALID';
  end;
  v_manifest_hash := encode(
    extensions.digest(convert_to(p_composition_manifest_text, 'UTF8'), 'sha256'),
    'hex'
  );

  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = p_revision_id
  for update;
  if not found then raise exception 'REFERENCE_GUIDED_REVISION_NOT_FOUND'; end if;
  if v_revision.status <> 'READY_FOR_PREPARE'
    or v_revision.strategy_version <> 'VISUAL_STRATEGY_V3'
    or v_revision.revision_contract <> 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
    or v_revision.product_dossier_hash is null
    or v_revision.market_visual_brief_hash is null then
    raise exception 'REFERENCE_GUIDED_PERSISTED_REVISION_INVALID';
  end if;

  select * into v_binding
  from public.luna_catalog_source_pack_dossier_bindings
  where listing_package_id = v_revision.listing_package_id
    and dossier_hash = v_revision.product_dossier_hash
    and policy_version = 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
  order by verified_at desc
  limit 1;
  if not found then raise exception 'SOURCE_PACK_DOSSIER_BINDING_REQUIRED'; end if;

  select * into v_pack
  from public.luna_catalog_authorized_source_packs
  where id = v_binding.source_pack_id
    and listing_package_id = v_revision.listing_package_id
  for share;
  if not found
    or v_pack.source_pack_hash <> v_binding.source_pack_manifest_hash
    or coalesce(v_pack.manifest_hash, v_pack.source_pack_hash)
      <> v_binding.source_pack_manifest_hash then
    raise exception 'SOURCE_PACK_BINDING_INVALID';
  end if;

  if v_manifest->>'version' <> 'REFERENCE_GUIDED_COMPOSITION_MANIFEST_V2'
    or v_manifest->>'revisionId' <> p_revision_id::text
    or v_manifest->>'strategyVersion' <> v_revision.strategy_version
    or v_manifest->>'revisionContract' <> v_revision.revision_contract
    or v_manifest->>'productDossierHash' <> v_binding.dossier_hash
    or v_manifest->>'marketVisualBriefHash' <> v_revision.market_visual_brief_hash
    or v_manifest->>'sourcePackManifestHash' <> v_binding.source_pack_manifest_hash
    or v_manifest->>'mainSourceHash' <> v_revision.main_source_hash
    or v_manifest->>'sideSourceHash' <> v_revision.side_source_hash
    or v_manifest->>'promptTemplateVersion'
      <> 'REFERENCE_GUIDED_EXACT_PROMPT_V2_2026_07_22'
    or jsonb_typeof(v_manifest->'jobs') <> 'array'
    or jsonb_array_length(v_manifest->'jobs') <> 6 then
    raise exception 'REFERENCE_GUIDED_MANIFEST_REVISION_MISMATCH';
  end if;

  select count(distinct (job->>'position')::integer),
         count(distinct job->>'commercialObjective')
  into v_position_count, v_objective_count
  from jsonb_array_elements(v_manifest->'jobs') job;
  if v_position_count <> 6 or v_objective_count <> 6
    or exists (
      select 1 from jsonb_array_elements(v_manifest->'jobs') job
      where (job->>'position')::integer not between 1 and 6
    ) then
    raise exception 'REFERENCE_GUIDED_JOB_OBJECTIVES_INVALID';
  end if;

  for v_job in select value from jsonb_array_elements(v_manifest->'jobs') loop
    if coalesce(v_job->>'exactPromptText', '') = ''
      or v_job->>'promptTemplateVersion'
        <> 'REFERENCE_GUIDED_EXACT_PROMPT_V2_2026_07_22'
      or v_job->>'promptHash' <> encode(
        extensions.digest(convert_to(v_job->>'exactPromptText', 'UTF8'), 'sha256'),
        'hex'
      )
      or jsonb_typeof(v_job->'allowedProductFacts') <> 'array'
      or jsonb_typeof(v_job->'allowedGeneratedContext') <> 'array'
      or jsonb_typeof(v_job->'prohibitedClaims') <> 'array' then
      raise exception 'REFERENCE_GUIDED_EXACT_PROMPT_MISMATCH';
    end if;
  end loop;

  insert into public.ebay_reference_guided_generation_attempts(
    revision_id, composition_manifest_hash, composition_manifest_text,
    source_pack_manifest_hash, max_provider_calls
  ) values (
    p_revision_id, v_manifest_hash, p_composition_manifest_text,
    v_binding.source_pack_manifest_hash, 6
  )
  on conflict (revision_id, composition_manifest_hash)
  do update set revision_id = excluded.revision_id
  returning * into v_attempt;

  if v_attempt.status = 'SUPERSEDED_INVALID_MANIFEST' then
    raise exception 'REFERENCE_GUIDED_MANIFEST_PERMANENTLY_SUPERSEDED';
  end if;

  insert into public.ebay_reference_guided_generation_jobs(
    generation_attempt_id, position, commercial_role, source_main_hash,
    source_side_hash, prompt_hash, market_visual_brief_hash,
    product_dossier_hash, exact_prompt_text, prompt_template_version,
    allowed_product_facts, allowed_generated_context, prohibited_claims
  )
  select v_attempt.id, (job->>'position')::integer,
    job->>'commercialObjective', v_revision.main_source_hash,
    v_revision.side_source_hash, job->>'promptHash',
    v_revision.market_visual_brief_hash, v_revision.product_dossier_hash,
    job->>'exactPromptText', job->>'promptTemplateVersion',
    job->'allowedProductFacts', job->'allowedGeneratedContext',
    job->'prohibitedClaims'
  from jsonb_array_elements(v_manifest->'jobs') job
  on conflict (generation_attempt_id, position) do nothing;

  select count(*) into v_job_count
  from public.ebay_reference_guided_generation_jobs j
  where j.generation_attempt_id = v_attempt.id
    and j.product_dossier_hash = v_revision.product_dossier_hash
    and j.market_visual_brief_hash = v_revision.market_visual_brief_hash
    and j.source_main_hash = v_revision.main_source_hash
    and j.source_side_hash = v_revision.side_source_hash
    and j.prompt_template_version =
      'REFERENCE_GUIDED_EXACT_PROMPT_V2_2026_07_22'
    and j.prompt_hash = encode(
      extensions.digest(convert_to(j.exact_prompt_text, 'UTF8'), 'sha256'),
      'hex'
    );
  if v_job_count <> 6 then
    raise exception 'REFERENCE_GUIDED_PERSISTED_JOB_MANIFEST_MISMATCH';
  end if;
  return v_attempt;
end;
$$;

create or replace function public.claim_ebay_reference_guided_generation_jobs(
  p_attempt_id uuid, p_manifest_hash text, p_lease_owner text,
  p_limit integer default 2, p_feature_enabled boolean default false
) returns setof public.ebay_reference_guided_generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_active integer;
  v_available integer;
begin
  if not p_feature_enabled then
    raise exception 'REFERENCE_GUIDED_GENERATION_DISABLED';
  end if;
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id
  for update;
  if not found then raise exception 'REFERENCE_GUIDED_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status = 'SUPERSEDED_INVALID_MANIFEST' then
    raise exception 'REFERENCE_GUIDED_MANIFEST_PERMANENTLY_SUPERSEDED';
  end if;
  if v_attempt.status not in ('PENDING','GENERATING')
    or v_attempt.composition_manifest_hash <> p_manifest_hash
    or v_attempt.composition_manifest_text is null
    or v_attempt.composition_manifest_hash <> encode(
      extensions.digest(
        convert_to(v_attempt.composition_manifest_text, 'UTF8'), 'sha256'
      ), 'hex'
    ) then
    raise exception 'REFERENCE_GUIDED_MANIFEST_MISMATCH';
  end if;
  if exists (
    select 1 from public.ebay_reference_guided_generation_jobs j
    where j.generation_attempt_id = p_attempt_id
      and j.status = 'PENDING'
      and (
        j.exact_prompt_text is null
        or j.prompt_hash <> encode(
          extensions.digest(convert_to(j.exact_prompt_text, 'UTF8'), 'sha256'),
          'hex'
        )
        or j.product_dossier_hash is distinct from
          (v_attempt.composition_manifest_text::jsonb->>'productDossierHash')
        or j.market_visual_brief_hash is distinct from
          (v_attempt.composition_manifest_text::jsonb->>'marketVisualBriefHash')
      )
  ) then
    raise exception 'REFERENCE_GUIDED_EXACT_PROMPT_MISMATCH';
  end if;
  select count(*) into v_active
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id
    and status in ('RESERVED','PROVIDER_CALLING')
    and lease_expires_at >= now();
  v_available := least(greatest(p_limit, 0), 2 - v_active);
  if v_available <= 0 then return; end if;
  return query
  with candidates as (
    select j.id
    from public.ebay_reference_guided_generation_jobs j
    where j.generation_attempt_id = p_attempt_id
      and j.status = 'PENDING'
      and (j.lease_expires_at is null or j.lease_expires_at < now())
    order by j.position
    limit v_available
    for update skip locked
  )
  update public.ebay_reference_guided_generation_jobs j
  set status = 'RESERVED', lease_owner = p_lease_owner,
      lease_expires_at = now() + interval '5 minutes', updated_at = now()
  from candidates c where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.reserve_ebay_reference_guided_provider_call(
  p_attempt_id uuid, p_job_id uuid, p_manifest_hash text,
  p_lease_owner text, p_exact_prompt_hash text,
  p_feature_enabled boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_provider_calls integer;
begin
  if not p_feature_enabled then
    raise exception 'REFERENCE_GUIDED_GENERATION_DISABLED';
  end if;
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id
  for update;
  if not found then raise exception 'REFERENCE_GUIDED_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status = 'SUPERSEDED_INVALID_MANIFEST' then
    raise exception 'REFERENCE_GUIDED_MANIFEST_PERMANENTLY_SUPERSEDED';
  end if;
  if v_attempt.status not in ('PENDING','GENERATING')
    or v_attempt.composition_manifest_hash <> p_manifest_hash
    or v_attempt.composition_manifest_text is null
    or v_attempt.composition_manifest_hash <> encode(
      extensions.digest(
        convert_to(v_attempt.composition_manifest_text, 'UTF8'), 'sha256'
      ), 'hex'
    ) then
    raise exception 'REFERENCE_GUIDED_MANIFEST_MISMATCH';
  end if;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where id = p_job_id and generation_attempt_id = p_attempt_id
  for update;
  if not found or v_job.status <> 'RESERVED'
    or v_job.lease_owner is distinct from p_lease_owner
    or v_job.lease_expires_at < now()
    or v_job.prompt_hash <> p_exact_prompt_hash
    or v_job.exact_prompt_text is null
    or v_job.prompt_hash <> encode(
      extensions.digest(convert_to(v_job.exact_prompt_text, 'UTF8'), 'sha256'),
      'hex'
    ) then
    raise exception 'REFERENCE_GUIDED_PROVIDER_RESERVATION_INVALID';
  end if;
  update public.ebay_reference_guided_generation_attempts
  set provider_calls = provider_calls + 1, status = 'GENERATING',
      started_at = coalesce(started_at, now())
  where id = p_attempt_id
    and provider_calls < max_provider_calls
    and max_provider_calls = 6
  returning provider_calls into v_provider_calls;
  if v_provider_calls is null then
    raise exception 'REFERENCE_GUIDED_PROVIDER_CALL_BUDGET_EXHAUSTED';
  end if;
  update public.ebay_reference_guided_generation_jobs
  set status = 'PROVIDER_CALLING', provider_call_started_at = now(),
      updated_at = now()
  where id = p_job_id;
  return v_provider_calls;
end;
$$;

revoke all on function public.create_ebay_reference_guided_generation_attempt(
  uuid, text, text[], text, text, text[], text, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_ebay_reference_guided_generation_attempt_v2(
  uuid, text
) from public, anon, authenticated;
revoke all on function public.claim_ebay_reference_guided_generation_jobs(
  uuid, text, text, integer, boolean
) from public, anon, authenticated;
revoke all on function public.reserve_ebay_reference_guided_provider_call(
  uuid, uuid, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.create_ebay_reference_guided_generation_attempt_v2(
  uuid, text
) to service_role;
grant execute on function public.claim_ebay_reference_guided_generation_jobs(
  uuid, text, text, integer, boolean
) to service_role;
grant execute on function public.reserve_ebay_reference_guided_provider_call(
  uuid, uuid, text, text, text, boolean
) to service_role;

notify pgrst, 'reload schema';
