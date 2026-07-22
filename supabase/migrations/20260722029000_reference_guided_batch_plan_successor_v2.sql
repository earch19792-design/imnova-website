-- Append-only successor. The V1 plan remains immutable in its original tables.
-- This migration only persists instructions; it grants no execution authority.
create table if not exists public.ebay_reference_guided_batch_plan_successors_v2 (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  predecessor_plan_id uuid not null unique references public.ebay_reference_guided_final_batch_plans(id),
  predecessor_plan_hash text not null check (predecessor_plan_hash ~ '^[0-9a-f]{64}$'),
  plan_version text not null check (
    plan_version = 'REFERENCE_GUIDED_FINAL_POSITIONS_2_6_V2_2026_07_22'
  ),
  plan_text text not null,
  plan_hash text not null unique check (plan_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (
    status = 'AWAITING_POSITION_2_DETERMINISTIC_EXECUTION_AUTHORIZATION'
  ),
  lifetime_provider_budget_used integer not null check (lifetime_provider_budget_used = 2),
  lifetime_provider_budget_max integer not null check (lifetime_provider_budget_max = 6),
  lifetime_provider_budget_remaining integer not null check (lifetime_provider_budget_remaining = 4),
  planned_provider_calls integer not null check (planned_provider_calls = 4),
  max_concurrency integer not null check (max_concurrency = 2),
  automatic_retries boolean not null check (automatic_retries = false),
  execution_sequence jsonb not null,
  approved_primary_sha256 text not null check (approved_primary_sha256 ~ '^[0-9a-f]{64}$'),
  approved_material_detail_sha256 text not null check (approved_material_detail_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.ebay_reference_guided_batch_plan_successor_positions_v2 (
  id uuid primary key default gen_random_uuid(),
  successor_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  position integer not null check (position between 2 and 6),
  asset_role text not null,
  commercial_objective text not null,
  execution_mode text not null check (execution_mode in ('DETERMINISTIC','PROVIDER')),
  execution_phase text not null,
  planned_provider_calls integer not null check (planned_provider_calls in (0,1)),
  must_include jsonb not null,
  must_exclude jsonb not null,
  camera_and_framing jsonb not null,
  required_product_visibility jsonb not null,
  contextual_objects_not_included jsonb not null,
  visual_product_facts jsonb not null,
  research_guidance_only jsonb not null,
  exact_prompt_text text not null,
  exact_prompt_hash text not null check (exact_prompt_hash ~ '^[0-9a-f]{64}$'),
  authorized_sources jsonb not null,
  automatic_checks jsonb not null,
  human_checks jsonb not null,
  distinct_commercial_composition jsonb not null,
  created_at timestamptz not null default now(),
  unique (successor_plan_id, position),
  unique (attempt_id, position),
  check (
    (position = 2 and asset_role = 'SECONDARY_PACKAGE_CONTENTS'
      and commercial_objective = 'CONFIRMED_PACKAGE_CONTENTS'
      and execution_mode = 'DETERMINISTIC' and planned_provider_calls = 0
      and execution_phase = 'PHASE_A_DETERMINISTIC_FIRST')
    or (position = 3 and asset_role = 'SECONDARY_SCALE_CAPACITY'
      and commercial_objective = 'SCALE_AND_CAPACITY_CONTEXT'
      and execution_mode = 'PROVIDER' and planned_provider_calls = 1
      and execution_phase = 'BLOCKED_UNTIL_POSITION_5_HUMAN_APPROVAL')
    or (position = 4 and asset_role = 'SECONDARY_USE_CONTEXT'
      and commercial_objective = 'PRIMARY_BENEFIT_IN_ACTION'
      and execution_mode = 'PROVIDER' and planned_provider_calls = 1
      and execution_phase = 'BLOCKED_UNTIL_POSITION_5_HUMAN_APPROVAL')
    or (position = 5 and asset_role = 'SECONDARY_ASPIRATIONAL_LIFESTYLE'
      and commercial_objective = 'ASPIRATIONAL_LIFESTYLE'
      and execution_mode = 'PROVIDER' and planned_provider_calls = 1
      and execution_phase = 'PHASE_B_SINGLE_PROVIDER_VALIDATION_AFTER_POSITION_2_HUMAN_APPROVAL')
    or (position = 6 and asset_role = 'SECONDARY_HUMAN_CONTEXT'
      and commercial_objective = 'REAL_HUMAN_USE'
      and execution_mode = 'PROVIDER' and planned_provider_calls = 1
      and execution_phase = 'BLOCKED_UNTIL_POSITION_5_HUMAN_APPROVAL')
  )
);

drop trigger if exists ebay_reference_guided_batch_successors_v2_append_only
  on public.ebay_reference_guided_batch_plan_successors_v2;
create trigger ebay_reference_guided_batch_successors_v2_append_only
before update or delete on public.ebay_reference_guided_batch_plan_successors_v2
for each row execute function public.prevent_reference_guided_human_evidence_mutation();
drop trigger if exists ebay_reference_guided_batch_successor_positions_v2_append_only
  on public.ebay_reference_guided_batch_plan_successor_positions_v2;
create trigger ebay_reference_guided_batch_successor_positions_v2_append_only
before update or delete on public.ebay_reference_guided_batch_plan_successor_positions_v2
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_batch_plan_successors_v2 enable row level security;
alter table public.ebay_reference_guided_batch_plan_successors_v2 force row level security;
alter table public.ebay_reference_guided_batch_plan_successor_positions_v2 enable row level security;
alter table public.ebay_reference_guided_batch_plan_successor_positions_v2 force row level security;
revoke all on table public.ebay_reference_guided_batch_plan_successors_v2,
  public.ebay_reference_guided_batch_plan_successor_positions_v2
  from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_batch_plan_successors_v2,
  public.ebay_reference_guided_batch_plan_successor_positions_v2 to service_role;

create or replace function public.prepare_ebay_reference_guided_batch_plan_successor_v2(
  p_attempt_id uuid,
  p_predecessor_plan_id uuid,
  p_plan_text text,
  p_plan_hash text
) returns table(successor_plan_id uuid, reused boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_old public.ebay_reference_guided_final_batch_plans%rowtype;
  v_selection public.ebay_reference_guided_final_asset_selection_events%rowtype;
  v_existing public.ebay_reference_guided_batch_plan_successors_v2%rowtype;
  v_plan jsonb;
  v_position jsonb;
  v_number integer;
  v_expected_sources jsonb;
  v_successor_id uuid;
begin
  begin v_plan := p_plan_text::jsonb;
  exception when others then raise exception 'SUCCESSOR_BATCH_PLAN_JSON_INVALID'; end;
  if p_plan_hash <> encode(extensions.digest(
      convert_to(p_plan_text, 'UTF8'), 'sha256'), 'hex')
    or v_plan->>'version' <> 'REFERENCE_GUIDED_FINAL_POSITIONS_2_6_V2_2026_07_22'
    or v_plan->>'status' <>
      'AWAITING_POSITION_2_DETERMINISTIC_EXECUTION_AUTHORIZATION'
    or v_plan->>'attemptId' <> p_attempt_id::text
    or v_plan->>'predecessorPlanId' <> p_predecessor_plan_id::text
    or (v_plan->>'lifetimeProviderBudgetUsed')::integer <> 2
    or (v_plan->>'lifetimeProviderBudgetMax')::integer <> 6
    or (v_plan->>'lifetimeProviderBudgetRemaining')::integer <> 4
    or (v_plan->>'plannedProviderCalls')::integer <> 4
    or (v_plan->>'maxConcurrency')::integer <> 2
    or (v_plan->>'automaticRetries')::boolean is distinct from false
    or jsonb_array_length(v_plan->'positions') <> 5
    or jsonb_array_length(v_plan->'executionSequence') <> 5 then
    raise exception 'SUCCESSOR_BATCH_PLAN_MANIFEST_INVALID';
  end if;
  if (select count(distinct (item->>'position')::integer)
      from jsonb_array_elements(v_plan->'positions') item) <> 5
    or exists (
      select 1 from generate_series(2, 6) required_position
      where not exists (
        select 1 from jsonb_array_elements(v_plan->'positions') item
        where (item->>'position')::integer = required_position
      )
    ) then
    raise exception 'SUCCESSOR_BATCH_PLAN_POSITIONS_INCOMPLETE';
  end if;

  select * into v_old from public.ebay_reference_guided_final_batch_plans
  where id = p_predecessor_plan_id for share;
  if not found or v_old.attempt_id <> p_attempt_id
    or v_old.plan_hash <> v_plan->>'predecessorPlanHash'
    or v_old.status <> 'AWAITING_HUMAN_BATCH_AUTHORIZATION' then
    raise exception 'SUCCESSOR_BATCH_PLAN_PREDECESSOR_INVALID';
  end if;
  select * into v_attempt from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for update;
  if not found or v_attempt.provider_calls <> 2 or v_attempt.max_provider_calls <> 6
    or v_attempt.retry_consumed <> false or v_attempt.ebay_writes <> 0
    or v_attempt.production_changed <> false
    or v_attempt.composition_manifest_hash <> v_plan->>'compositionManifestHash' then
    raise exception 'SUCCESSOR_BATCH_PLAN_ATTEMPT_INVALID';
  end if;
  select * into v_revision from public.ebay_same_day_pilot_image_revisions
  where id = v_attempt.revision_id for share;
  if not found or v_plan->>'revisionId' <> v_revision.id::text
    or v_plan->>'productDossierHash' <> v_revision.product_dossier_hash
    or v_plan->>'marketVisualBriefHash' <> v_revision.market_visual_brief_hash then
    raise exception 'SUCCESSOR_BATCH_PLAN_REVISION_INVALID';
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
    raise exception 'SUCCESSOR_BATCH_PLAN_APPROVED_ASSETS_INVALID';
  end if;
  if exists (select 1 from public.ebay_reference_guided_generation_jobs
    where generation_attempt_id = p_attempt_id and position between 2 and 6
      and (status <> 'PENDING' or lease_owner is not null
        or lease_expires_at is not null or provider_call_started_at is not null
        or output_storage_path is not null or output_sha256 is not null)) then
    raise exception 'SUCCESSOR_BATCH_PLAN_JOBS_NOT_PRISTINE';
  end if;

  select * into v_existing
  from public.ebay_reference_guided_batch_plan_successors_v2
  where predecessor_plan_id = p_predecessor_plan_id;
  if found then
    if v_existing.plan_hash <> p_plan_hash then
      raise exception 'SUCCESSOR_BATCH_PLAN_CONFLICT';
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  for v_position in select * from jsonb_array_elements(v_plan->'positions') loop
    v_number := (v_position->>'position')::integer;
    v_expected_sources := case when v_number = 2 then
      jsonb_build_array(jsonb_build_object('sourceImageId','SIDE',
        'sha256',v_revision.side_source_hash))
    else jsonb_build_array(
      jsonb_build_object('sourceImageId','MAIN','sha256',v_revision.main_source_hash),
      jsonb_build_object('sourceImageId','SIDE','sha256',v_revision.side_source_hash)
    ) end;
    if v_number not between 2 and 6
      or v_position->'authorizedSources' <> v_expected_sources
      or jsonb_array_length(v_position->'mustInclude') = 0
      or jsonb_array_length(v_position->'mustExclude') = 0
      or jsonb_array_length(v_position->'cameraAndFraming') = 0
      or jsonb_array_length(v_position->'requiredProductVisibility') = 0
      or jsonb_array_length(v_position->'automaticChecks') = 0
      or jsonb_array_length(v_position->'humanChecks') = 0
      or jsonb_array_length(v_position->'distinctCommercialComposition') <> 5
      or v_position->>'exactPromptHash' <> encode(extensions.digest(
        convert_to(v_position->>'exactPromptText', 'UTF8'), 'sha256'), 'hex')
      or (v_position->>'exactPromptText') ~* '\mmay\M'
      or (v_position->>'exactPromptText') not like '%POSITION_MUST_INCLUDE_JSON=%'
      or (v_position->>'exactPromptText') not like
        '%POSITION_MUST_INCLUDE MUST take priority%'
      or (v_number = 3 and (v_position->>'exactPromptText' ~*
        'unitGrossWeight|454|1\.5 quart')) then
      raise exception 'SUCCESSOR_BATCH_PLAN_POSITION_INVALID:%', v_number;
    end if;
  end loop;

  insert into public.ebay_reference_guided_batch_plan_successors_v2(
    attempt_id, revision_id, predecessor_plan_id, predecessor_plan_hash,
    plan_version, plan_text, plan_hash, status, lifetime_provider_budget_used,
    lifetime_provider_budget_max, lifetime_provider_budget_remaining,
    planned_provider_calls, max_concurrency, automatic_retries,
    execution_sequence, approved_primary_sha256,
    approved_material_detail_sha256, created_by
  ) values (
    p_attempt_id, v_revision.id, v_old.id, v_old.plan_hash, v_plan->>'version',
    p_plan_text, p_plan_hash,
    'AWAITING_POSITION_2_DETERMINISTIC_EXECUTION_AUTHORIZATION',
    2, 6, 4, 4, 2, false, v_plan->'executionSequence',
    v_selection.primary_sha256, v_selection.material_detail_sha256,
    v_revision.created_by
  ) returning id into v_successor_id;

  insert into public.ebay_reference_guided_batch_plan_successor_positions_v2(
    successor_plan_id, attempt_id, position, asset_role, commercial_objective,
    execution_mode, execution_phase, planned_provider_calls, must_include,
    must_exclude, camera_and_framing, required_product_visibility,
    contextual_objects_not_included, visual_product_facts,
    research_guidance_only, exact_prompt_text, exact_prompt_hash,
    authorized_sources, automatic_checks, human_checks,
    distinct_commercial_composition
  ) select v_successor_id, p_attempt_id, (item->>'position')::integer,
    item->>'assetRole', item->>'commercialObjective', item->>'mode',
    item->>'executionPhase', (item->>'plannedProviderCalls')::integer,
    item->'mustInclude', item->'mustExclude', item->'cameraAndFraming',
    item->'requiredProductVisibility', item->'contextualObjectsNotIncluded',
    item->'visualProductFacts', item->'researchGuidanceOnly',
    item->>'exactPromptText', item->>'exactPromptHash',
    item->'authorizedSources', item->'automaticChecks', item->'humanChecks',
    item->'distinctCommercialComposition'
  from jsonb_array_elements(v_plan->'positions') item;
  return query select v_successor_id, false;
end;
$$;

revoke all on function public.prepare_ebay_reference_guided_batch_plan_successor_v2(
  uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.prepare_ebay_reference_guided_batch_plan_successor_v2(
  uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
