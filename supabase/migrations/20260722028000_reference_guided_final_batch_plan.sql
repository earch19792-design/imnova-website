-- Immutable plan only. This migration cannot claim jobs, create leases,
-- reserve provider calls, invoke providers, or change publication state.
create table if not exists public.ebay_reference_guided_final_batch_plans (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  plan_version text not null check (
    plan_version = 'REFERENCE_GUIDED_FINAL_POSITIONS_2_6_V1_2026_07_22'
  ),
  plan_text text not null,
  plan_hash text not null unique check (plan_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status = 'AWAITING_HUMAN_BATCH_AUTHORIZATION'),
  lifetime_provider_budget_used integer not null check (lifetime_provider_budget_used = 2),
  lifetime_provider_budget_max integer not null check (lifetime_provider_budget_max = 6),
  lifetime_provider_budget_remaining integer not null check (lifetime_provider_budget_remaining = 4),
  planned_new_provider_calls integer not null check (planned_new_provider_calls = 4),
  max_concurrency integer not null check (max_concurrency = 2),
  automatic_retries boolean not null check (automatic_retries = false),
  approved_primary_sha256 text not null check (approved_primary_sha256 ~ '^[0-9a-f]{64}$'),
  approved_material_detail_sha256 text not null check (approved_material_detail_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.ebay_reference_guided_final_batch_plan_positions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ebay_reference_guided_final_batch_plans(id),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  position integer not null check (position between 2 and 6),
  asset_role text not null,
  commercial_objective text not null,
  execution_mode text not null check (execution_mode in ('DETERMINISTIC','PROVIDER')),
  planned_provider_calls integer not null check (planned_provider_calls in (0,1)),
  canonical_facts jsonb not null,
  research_guidance_only jsonb not null,
  prohibited_elements_and_claims jsonb not null,
  exact_prompt_text text not null,
  prompt_hash text not null check (prompt_hash ~ '^[0-9a-f]{64}$'),
  prior_job_prompt_hash text not null check (prior_job_prompt_hash ~ '^[0-9a-f]{64}$'),
  authorized_sources jsonb not null,
  automatic_qa jsonb not null,
  human_qa jsonb not null,
  created_at timestamptz not null default now(),
  unique (plan_id, position),
  unique (attempt_id, position),
  check (
    (position = 2 and asset_role = 'SECONDARY_PACKAGE_CONTENTS'
      and commercial_objective = 'CONFIRMED_PACKAGE_CONTENTS'
      and execution_mode = 'DETERMINISTIC' and planned_provider_calls = 0)
    or (position = 3 and asset_role = 'SECONDARY_SCALE_CAPACITY'
      and commercial_objective = 'SCALE_AND_CAPACITY_CONTEXT'
      and execution_mode = 'PROVIDER' and planned_provider_calls = 1)
    or (position = 4 and asset_role = 'SECONDARY_USE_CONTEXT'
      and commercial_objective = 'PRIMARY_BENEFIT_IN_ACTION'
      and execution_mode = 'PROVIDER' and planned_provider_calls = 1)
    or (position = 5 and asset_role = 'SECONDARY_ASPIRATIONAL_LIFESTYLE'
      and commercial_objective = 'ASPIRATIONAL_LIFESTYLE'
      and execution_mode = 'PROVIDER' and planned_provider_calls = 1)
    or (position = 6 and asset_role = 'SECONDARY_HUMAN_CONTEXT'
      and commercial_objective = 'REAL_HUMAN_USE'
      and execution_mode = 'PROVIDER' and planned_provider_calls = 1)
  )
);

drop trigger if exists ebay_reference_guided_final_batch_plans_append_only
  on public.ebay_reference_guided_final_batch_plans;
create trigger ebay_reference_guided_final_batch_plans_append_only
before update or delete on public.ebay_reference_guided_final_batch_plans
for each row execute function public.prevent_reference_guided_human_evidence_mutation();
drop trigger if exists ebay_reference_guided_final_batch_positions_append_only
  on public.ebay_reference_guided_final_batch_plan_positions;
create trigger ebay_reference_guided_final_batch_positions_append_only
before update or delete on public.ebay_reference_guided_final_batch_plan_positions
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_final_batch_plans enable row level security;
alter table public.ebay_reference_guided_final_batch_plans force row level security;
alter table public.ebay_reference_guided_final_batch_plan_positions enable row level security;
alter table public.ebay_reference_guided_final_batch_plan_positions force row level security;
revoke all on table public.ebay_reference_guided_final_batch_plans,
  public.ebay_reference_guided_final_batch_plan_positions
  from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_final_batch_plans,
  public.ebay_reference_guided_final_batch_plan_positions to service_role;

create or replace function public.prepare_ebay_reference_guided_final_batch_plan(
  p_attempt_id uuid,
  p_plan_text text,
  p_plan_hash text
) returns table(plan_id uuid, reused boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_selection public.ebay_reference_guided_final_asset_selection_events%rowtype;
  v_existing public.ebay_reference_guided_final_batch_plans%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_plan jsonb;
  v_position jsonb;
  v_position_number integer;
  v_plan_id uuid;
  v_expected_sources jsonb;
begin
  begin v_plan := p_plan_text::jsonb;
  exception when others then raise exception 'FINAL_BATCH_PLAN_JSON_INVALID'; end;
  if p_plan_hash <> encode(extensions.digest(
      convert_to(p_plan_text, 'UTF8'), 'sha256'), 'hex')
    or v_plan->>'version' <> 'REFERENCE_GUIDED_FINAL_POSITIONS_2_6_V1_2026_07_22'
    or v_plan->>'status' <> 'AWAITING_HUMAN_BATCH_AUTHORIZATION'
    or v_plan->>'attemptId' <> p_attempt_id::text
    or (v_plan->>'lifetimeProviderBudgetUsed')::integer <> 2
    or (v_plan->>'lifetimeProviderBudgetMax')::integer <> 6
    or (v_plan->>'lifetimeProviderBudgetRemaining')::integer <> 4
    or (v_plan->>'plannedNewProviderCalls')::integer <> 4
    or (v_plan->>'maxConcurrency')::integer <> 2
    or (v_plan->>'automaticRetries')::boolean is distinct from false
    or jsonb_array_length(v_plan->'positions') <> 5 then
    raise exception 'FINAL_BATCH_PLAN_MANIFEST_INVALID';
  end if;

  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for update;
  if not found or v_attempt.provider_calls <> 2
    or v_attempt.max_provider_calls <> 6 or v_attempt.retry_consumed <> false
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed <> false
    or v_attempt.composition_manifest_hash <> v_plan->>'compositionManifestHash' then
    raise exception 'FINAL_BATCH_PLAN_ATTEMPT_INVALID';
  end if;
  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = v_attempt.revision_id for share;
  if not found or v_plan->>'revisionId' <> v_revision.id::text
    or v_plan->>'productDossierHash' <> v_revision.product_dossier_hash
    or v_plan->>'marketVisualBriefHash' <> v_revision.market_visual_brief_hash
    or v_revision.strategy_version <> 'VISUAL_STRATEGY_V3'
    or v_revision.revision_contract <> 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1' then
    raise exception 'FINAL_BATCH_PLAN_REVISION_INVALID';
  end if;
  select * into v_selection
  from public.ebay_reference_guided_final_asset_selection_events
  where attempt_id = p_attempt_id for share;
  if not found or v_selection.primary_verdict <> 'APPROVED'
    or v_selection.material_detail_verdict <> 'APPROVED'
    or v_selection.material_detail_source <> 'SIDE'
    or v_plan->'approvedAssets'->>'primaryMainSha256' <>
      v_selection.primary_sha256
    or v_plan->'approvedAssets'->>'secondaryMaterialDetailSha256' <>
      v_selection.material_detail_sha256 then
    raise exception 'FINAL_BATCH_PLAN_APPROVED_ASSETS_INVALID';
  end if;
  if (select count(*) from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position between 2 and 6) <> 5
    or exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position between 2 and 6
        and (status <> 'PENDING' or lease_owner is not null
          or lease_expires_at is not null or provider_call_started_at is not null
          or output_storage_path is not null or output_sha256 is not null)
    ) then
    raise exception 'FINAL_BATCH_PLAN_JOBS_NOT_PRISTINE';
  end if;

  select * into v_existing
  from public.ebay_reference_guided_final_batch_plans
  where attempt_id = p_attempt_id;
  if found then
    if v_existing.plan_hash <> p_plan_hash then
      raise exception 'FINAL_BATCH_PLAN_CONFLICT';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  if (select count(distinct (item->>'position')::integer)
      from jsonb_array_elements(v_plan->'positions') item) <> 5
    or exists (
      select 1 from generate_series(2, 6) expected
      where not exists (select 1 from jsonb_array_elements(v_plan->'positions') item
        where (item->>'position')::integer = expected)
    ) then
    raise exception 'FINAL_BATCH_PLAN_POSITIONS_INVALID';
  end if;

  for v_position in select * from jsonb_array_elements(v_plan->'positions') loop
    v_position_number := (v_position->>'position')::integer;
    select * into v_job
    from public.ebay_reference_guided_generation_jobs
    where generation_attempt_id = p_attempt_id
      and position = v_position_number for share;
    if not found or v_position->>'commercialObjective' <> v_job.commercial_role
      or v_position->'canonicalFacts' <> v_job.allowed_product_facts
      or v_position->'researchGuidanceOnly' <> v_job.allowed_generated_context
      or v_position->>'priorJobPromptHash' <> v_job.prompt_hash
      or v_position->>'promptHash' <> encode(extensions.digest(
        convert_to(v_position->>'exactPromptText', 'UTF8'), 'sha256'), 'hex')
      or jsonb_array_length(v_position->'prohibitedElementsAndClaims') = 0
      or jsonb_array_length(v_position->'automaticQa') = 0
      or jsonb_array_length(v_position->'humanQa') = 0 then
      raise exception 'FINAL_BATCH_PLAN_POSITION_INVALID:%', v_position_number;
    end if;
    v_expected_sources := case when v_position_number = 2 then
      jsonb_build_array(jsonb_build_object('sourceImageId','SIDE',
        'sha256',v_revision.side_source_hash))
    else jsonb_build_array(
      jsonb_build_object('sourceImageId','MAIN','sha256',v_revision.main_source_hash),
      jsonb_build_object('sourceImageId','SIDE','sha256',v_revision.side_source_hash)
    ) end;
    if v_position->'authorizedSources' <> v_expected_sources
      or (v_position_number = 2 and (
        v_position->>'mode' <> 'DETERMINISTIC'
        or (v_position->>'plannedProviderCalls')::integer <> 0))
      or (v_position_number between 3 and 6 and (
        v_position->>'mode' <> 'PROVIDER'
        or (v_position->>'plannedProviderCalls')::integer <> 1)) then
      raise exception 'FINAL_BATCH_PLAN_EXECUTION_MODE_INVALID:%', v_position_number;
    end if;
  end loop;

  insert into public.ebay_reference_guided_final_batch_plans(
    attempt_id, revision_id, plan_version, plan_text, plan_hash, status,
    lifetime_provider_budget_used, lifetime_provider_budget_max,
    lifetime_provider_budget_remaining, planned_new_provider_calls,
    max_concurrency, automatic_retries, approved_primary_sha256,
    approved_material_detail_sha256, created_by
  ) values (
    p_attempt_id, v_revision.id, v_plan->>'version', p_plan_text, p_plan_hash,
    'AWAITING_HUMAN_BATCH_AUTHORIZATION', 2, 6, 4, 4, 2, false,
    v_selection.primary_sha256, v_selection.material_detail_sha256,
    v_revision.created_by
  ) returning id into v_plan_id;

  insert into public.ebay_reference_guided_final_batch_plan_positions(
    plan_id, attempt_id, position, asset_role, commercial_objective,
    execution_mode, planned_provider_calls, canonical_facts,
    research_guidance_only, prohibited_elements_and_claims,
    exact_prompt_text, prompt_hash, prior_job_prompt_hash,
    authorized_sources, automatic_qa, human_qa
  ) select v_plan_id, p_attempt_id, (item->>'position')::integer,
    item->>'assetRole', item->>'commercialObjective', item->>'mode',
    (item->>'plannedProviderCalls')::integer, item->'canonicalFacts',
    item->'researchGuidanceOnly', item->'prohibitedElementsAndClaims',
    item->>'exactPromptText', item->>'promptHash',
    item->>'priorJobPromptHash', item->'authorizedSources',
    item->'automaticQa', item->'humanQa'
  from jsonb_array_elements(v_plan->'positions') item;
  return query select v_plan_id, false;
end;
$$;

revoke all on function public.prepare_ebay_reference_guided_final_batch_plan(
  uuid, text, text) from public, anon, authenticated;
grant execute on function public.prepare_ebay_reference_guided_final_batch_plan(
  uuid, text, text) to service_role;

notify pgrst, 'reload schema';
