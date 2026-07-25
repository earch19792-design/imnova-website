-- Append-only position-4 contract amendment. The successor V2 plan and its
-- historical prompt remain immutable. No execution authority is granted here.
create table if not exists public.ebay_reference_guided_position_contract_amendments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  base_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  base_plan_hash text not null check (base_plan_hash ~ '^[0-9a-f]{64}$'),
  position integer not null check (position = 4),
  asset_role text not null check (asset_role = 'SECONDARY_USE_CONTEXT'),
  amendment_type text not null check (
    amendment_type = 'POSITION_CONTRACT_DISTINCTNESS_FIX'
  ),
  amendment_reason text not null check (
    amendment_reason = 'EXCLUDE_HANDS_TO_PRESERVE_DISTINCTION_FROM_POSITION_6'
  ),
  base_prompt_hash text not null check (base_prompt_hash ~ '^[0-9a-f]{64}$'),
  amendment_text text not null,
  amendment_hash text not null unique check (amendment_hash ~ '^[0-9a-f]{64}$'),
  must_include_additions jsonb not null,
  must_exclude_additions jsonb not null,
  automatic_checks_additions jsonb not null,
  effective_position_contract_text text not null,
  effective_position_contract_hash text not null unique check (
    effective_position_contract_hash ~ '^[0-9a-f]{64}$'
  ),
  effective_prompt_text text not null,
  effective_prompt_hash text not null unique check (
    effective_prompt_hash ~ '^[0-9a-f]{64}$'
  ),
  status text not null check (status = 'ACTIVE'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(base_plan_id, position, amendment_type)
);

drop trigger if exists ebay_reference_guided_position_amendments_append_only
  on public.ebay_reference_guided_position_contract_amendments;
create trigger ebay_reference_guided_position_amendments_append_only
before update or delete
  on public.ebay_reference_guided_position_contract_amendments
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_position_contract_amendments
  enable row level security;
alter table public.ebay_reference_guided_position_contract_amendments
  force row level security;
revoke all on table public.ebay_reference_guided_position_contract_amendments
  from public, anon, authenticated, service_role;
grant select, insert
  on table public.ebay_reference_guided_position_contract_amendments
  to service_role;

with base as (
  select
    gen_random_uuid() as amendment_id,
    plan.id as base_plan_id,
    plan.plan_hash as base_plan_hash,
    plan.attempt_id,
    plan.revision_id,
    plan.created_by,
    p4.exact_prompt_text as base_prompt_text,
    p4.exact_prompt_hash as base_prompt_hash,
    p4.must_include as base_must_include,
    p4.must_exclude as base_must_exclude,
    p4.automatic_checks as base_automatic_checks,
    p4.required_product_visibility,
    p4.contextual_objects_not_included,
    p4.camera_and_framing,
    p4.research_guidance_only,
    p4.distinct_commercial_composition,
    p6.exact_prompt_hash as position_6_prompt_hash,
    p6.must_include as position_6_must_include
  from public.ebay_reference_guided_batch_plan_successors_v2 plan
  join public.ebay_reference_guided_batch_plan_successor_positions_v2 p4
    on p4.successor_plan_id = plan.id and p4.position = 4
  join public.ebay_reference_guided_batch_plan_successor_positions_v2 p6
    on p6.successor_plan_id = plan.id and p6.position = 6
  join public.ebay_reference_guided_generation_attempts a
    on a.id = plan.attempt_id
  join public.ebay_reference_guided_generation_jobs j4
    on j4.generation_attempt_id = a.id and j4.position = 4
  join public.ebay_reference_guided_generation_jobs j6
    on j6.generation_attempt_id = a.id and j6.position = 6
  where plan.id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    and plan.plan_hash =
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    and plan.plan_hash = encode(extensions.digest(
      convert_to(plan.plan_text, 'UTF8'), 'sha256'), 'hex')
    and p4.attempt_id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    and p4.asset_role = 'SECONDARY_USE_CONTEXT'
    and p4.commercial_objective = 'PRIMARY_BENEFIT_IN_ACTION'
    and p4.exact_prompt_hash = encode(extensions.digest(
      convert_to(p4.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    and p6.asset_role = 'SECONDARY_HUMAN_CONTEXT'
    and p6.commercial_objective = 'REAL_HUMAN_USE'
    and p6.exact_prompt_hash = encode(extensions.digest(
      convert_to(p6.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    and p6.must_include @>
      '["MUST show two real human hands holding the two handles."]'::jsonb
    and a.provider_calls = 4 and a.max_provider_calls = 6
    and a.retry_consumed = false and a.ebay_writes = 0
    and a.production_changed = false
    and j4.status = 'PENDING' and j6.status = 'PENDING'
    and j4.lease_owner is null and j4.lease_expires_at is null
    and j6.lease_owner is null and j6.lease_expires_at is null
    and j4.provider_request_id is null and j6.provider_request_id is null
    and j4.output_storage_path is null and j6.output_storage_path is null
), amendment as (
  select base.*,
    jsonb_build_array(
      'MUST show the exact complete product under a gentle stream of water.',
      'MUST place a moderate quantity of generic fruit or vegetables inside the product.',
      'MUST allow a faucet or other water source to appear as non-included context.',
      'MUST make the scene work without any visible human interaction.',
      'MUST keep both handles, the rim, the base, and sufficient perforations visible.',
      'MUST explain ordinary colander use without any performance claim.'
    ) as must_include_additions,
    jsonb_build_array(
      'MUST NOT show human hands.',
      'MUST NOT show fingers.',
      'MUST NOT show arms.',
      'MUST NOT show people.',
      'MUST NOT show human body parts.'
    ) as must_exclude_additions,
    jsonb_build_array(
      'FAIL if any human hand, finger, arm, person, or human body part is visible.',
      'FAIL if position 4 is semantically equivalent to position 6.',
      'MUST verify that position 6 continues to require two human hands holding both handles.'
    ) as automatic_checks_additions,
    $effective_prompt_addition$POSITION_4_CONTRACT_AMENDMENT=POSITION_CONTRACT_DISTINCTNESS_FIX
POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image.
POSITION_MUST_INCLUDE_AMENDMENT:
- MUST show the exact complete product under a gentle stream of water.
- MUST place a moderate quantity of generic fruit or vegetables inside the product.
- MUST allow a faucet or other water source to appear as non-included context.
- MUST make the scene work without any visible human interaction.
- MUST keep both handles, the rim, the base, and sufficient perforations visible.
- MUST explain ordinary colander use without any performance claim.
QA_AMENDMENT:
- FAIL if any human hand, finger, arm, person, or human body part is visible.
- FAIL if position 4 is semantically equivalent to position 6.
- Position 6 MUST continue to require two real human hands holding both handles.$effective_prompt_addition$
      as effective_prompt_addition,
    jsonb_build_object(
      'version','POSITION_4_CONTRACT_AMENDMENT_V1_2026_07_22',
      'basePlanId',base_plan_id,
      'basePlanHash',base_plan_hash,
      'position',4,
      'assetRole','SECONDARY_USE_CONTEXT',
      'amendmentType','POSITION_CONTRACT_DISTINCTNESS_FIX',
      'amendmentReason','EXCLUDE_HANDS_TO_PRESERVE_DISTINCTION_FROM_POSITION_6',
      'basePromptHash',base_prompt_hash,
      'mustExcludeAdditions',jsonb_build_array(
        'human hands','fingers','arms','people','human body parts'),
      'effectivePromptAddition',
        'POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image.',
      'position6HandsRequirement',
        'MUST show two real human hands holding the two handles.'
    ) as amendment_manifest
  from base
), hashed as (
  select amendment.*,
    amendment_manifest::text as amendment_text,
    encode(extensions.digest(convert_to(
      amendment_manifest::text, 'UTF8'), 'sha256'), 'hex') as amendment_hash,
    base_prompt_text || E'\n\n' || effective_prompt_addition
      as effective_prompt_text
  from amendment
), prompt_hashed as (
  select hashed.*,
    encode(extensions.digest(convert_to(
      effective_prompt_text, 'UTF8'), 'sha256'), 'hex') as effective_prompt_hash
  from hashed
), effective as (
  select prompt_hashed.*,
    jsonb_build_object(
      'version','POSITION_4_EFFECTIVE_CONTRACT_V1_2026_07_22',
      'basePlanId',base_plan_id,
      'basePlanHash',base_plan_hash,
      'position',4,
      'assetRole','SECONDARY_USE_CONTEXT',
      'basePromptHash',base_prompt_hash,
      'amendmentHash',amendment_hash,
      'effectivePromptHash',effective_prompt_hash,
      'mustInclude',base_must_include || must_include_additions,
      'mustExclude',base_must_exclude || must_exclude_additions,
      'automaticChecks',base_automatic_checks || automatic_checks_additions,
      'requiredProductVisibility',required_product_visibility,
      'contextualObjectsNotIncluded',contextual_objects_not_included,
      'cameraAndFraming',camera_and_framing,
      'researchGuidanceOnly',research_guidance_only,
      'distinctCommercialComposition',distinct_commercial_composition,
      'position6PromptHash',position_6_prompt_hash,
      'position6MustInclude',position_6_must_include
    ) as effective_contract_manifest
  from prompt_hashed
), final as (
  select effective.*,
    effective_contract_manifest::text as effective_contract_text,
    encode(extensions.digest(convert_to(
      effective_contract_manifest::text, 'UTF8'), 'sha256'), 'hex')
      as effective_contract_hash
  from effective
)
insert into public.ebay_reference_guided_position_contract_amendments(
  id, attempt_id, revision_id, base_plan_id, base_plan_hash, position,
  asset_role, amendment_type, amendment_reason, base_prompt_hash,
  amendment_text, amendment_hash, must_include_additions,
  must_exclude_additions, automatic_checks_additions,
  effective_position_contract_text, effective_position_contract_hash,
  effective_prompt_text, effective_prompt_hash, status, created_by
)
select amendment_id, attempt_id, revision_id, base_plan_id, base_plan_hash, 4,
  'SECONDARY_USE_CONTEXT', 'POSITION_CONTRACT_DISTINCTNESS_FIX',
  'EXCLUDE_HANDS_TO_PRESERVE_DISTINCTION_FROM_POSITION_6', base_prompt_hash,
  amendment_text, amendment_hash, must_include_additions,
  must_exclude_additions, automatic_checks_additions,
  effective_contract_text, effective_contract_hash,
  effective_prompt_text, effective_prompt_hash, 'ACTIVE', created_by
from final
on conflict (base_plan_id, position, amendment_type) do nothing;

create or replace function public.resolve_ebay_reference_guided_position_4_effective_contract(
  p_attempt_id uuid
) returns table(
  amendment_id uuid,
  amendment_hash text,
  effective_position_contract_hash text,
  effective_prompt_text text,
  effective_prompt_hash text,
  main_source_hash text,
  side_source_hash text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_plan public.ebay_reference_guided_batch_plan_successors_v2%rowtype;
  v_position_4 public.ebay_reference_guided_batch_plan_successor_positions_v2%rowtype;
  v_position_6 public.ebay_reference_guided_batch_plan_successor_positions_v2%rowtype;
  v_amendment public.ebay_reference_guided_position_contract_amendments%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_contract jsonb;
begin
  if p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid then
    raise exception 'POSITION_4_AMENDMENT_ATTEMPT_INVALID';
  end if;
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for share;
  if not found or v_attempt.provider_calls <> 4
    or v_attempt.max_provider_calls <> 6 or v_attempt.retry_consumed
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed then
    raise exception 'POSITION_4_AMENDMENT_ATTEMPT_STATE_INVALID';
  end if;
  select * into v_plan
  from public.ebay_reference_guided_batch_plan_successors_v2
  where id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid for share;
  if not found or v_plan.attempt_id <> p_attempt_id
    or v_plan.plan_hash <>
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    or v_plan.plan_hash <> encode(extensions.digest(
      convert_to(v_plan.plan_text, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'POSITION_4_AMENDMENT_BASE_PLAN_INVALID';
  end if;
  select * into v_position_4
  from public.ebay_reference_guided_batch_plan_successor_positions_v2
  where successor_plan_id = v_plan.id and position = 4 for share;
  select * into v_position_6
  from public.ebay_reference_guided_batch_plan_successor_positions_v2
  where successor_plan_id = v_plan.id and position = 6 for share;
  if v_position_4.id is null or v_position_6.id is null
    or v_position_4.asset_role <> 'SECONDARY_USE_CONTEXT'
    or v_position_4.exact_prompt_hash <> encode(extensions.digest(
      convert_to(v_position_4.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_position_6.asset_role <> 'SECONDARY_HUMAN_CONTEXT'
    or not (v_position_6.must_include @>
      '["MUST show two real human hands holding the two handles."]'::jsonb) then
    raise exception 'POSITION_4_AMENDMENT_BASE_CONTRACT_INVALID';
  end if;
  select * into v_amendment
  from public.ebay_reference_guided_position_contract_amendments
  where base_plan_id = v_plan.id and position = 4
    and amendment_type = 'POSITION_CONTRACT_DISTINCTNESS_FIX'
    and status = 'ACTIVE' for share;
  if not found or v_amendment.base_plan_hash <> v_plan.plan_hash
    or v_amendment.base_prompt_hash <> v_position_4.exact_prompt_hash
    or v_amendment.amendment_hash <> encode(extensions.digest(
      convert_to(v_amendment.amendment_text, 'UTF8'), 'sha256'), 'hex')
    or v_amendment.effective_prompt_hash <> encode(extensions.digest(
      convert_to(v_amendment.effective_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_amendment.effective_position_contract_hash <>
      encode(extensions.digest(convert_to(
        v_amendment.effective_position_contract_text, 'UTF8'),
        'sha256'), 'hex')
    or v_amendment.effective_prompt_text not like
      '%POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts may appear anywhere in the image.%'
    or not (v_amendment.must_exclude_additions @>
      '["MUST NOT show human hands.","MUST NOT show fingers.","MUST NOT show arms.","MUST NOT show people.","MUST NOT show human body parts."]'::jsonb)
    or not (v_amendment.automatic_checks_additions @>
      '["FAIL if any human hand, finger, arm, person, or human body part is visible.","FAIL if position 4 is semantically equivalent to position 6."]'::jsonb) then
    raise exception 'POSITION_4_AMENDMENT_HASH_OR_CONTENT_INVALID';
  end if;
  begin
    v_contract := v_amendment.effective_position_contract_text::jsonb;
  exception when others then
    raise exception 'POSITION_4_EFFECTIVE_CONTRACT_JSON_INVALID';
  end;
  if v_contract->>'basePlanId' <> v_plan.id::text
    or v_contract->>'basePlanHash' <> v_plan.plan_hash
    or (v_contract->>'position')::integer <> 4
    or v_contract->>'amendmentHash' <> v_amendment.amendment_hash
    or v_contract->>'effectivePromptHash' <> v_amendment.effective_prompt_hash
    or not (v_contract->'mustExclude' @>
      '["MUST NOT show human hands.","MUST NOT show fingers.","MUST NOT show arms.","MUST NOT show people.","MUST NOT show human body parts."]'::jsonb)
    or not (v_contract->'position6MustInclude' @>
      '["MUST show two real human hands holding the two handles."]'::jsonb) then
    raise exception 'POSITION_4_EFFECTIVE_CONTRACT_BINDING_INVALID';
  end if;
  if exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id
        and (lease_owner is not null or lease_expires_at is not null)
    ) or exists (
      select 1
      from public.ebay_reference_guided_successor_provider_events consumed
      where consumed.attempt_id = p_attempt_id
        and consumed.event_type = 'CONSUMED'
        and not exists (
          select 1
          from public.ebay_reference_guided_successor_provider_events terminal
          where terminal.authorization_event_id = consumed.authorization_event_id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')
        )
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 4
        and status = 'PENDING' and lease_owner is null
        and lease_expires_at is null and provider_request_id is null
        and provider_call_started_at is null and output_storage_path is null
        and output_sha256 is null
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 6
        and status = 'PENDING' and lease_owner is null
        and lease_expires_at is null and provider_request_id is null
        and provider_call_started_at is null and output_storage_path is null
        and output_sha256 is null
    ) then
    raise exception 'POSITION_4_AMENDMENT_EXECUTION_STATE_INVALID';
  end if;
  if not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 2
        and status = 'PASSED' and output_sha256 =
          '7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 3
        and status = 'PASSED' and output_sha256 =
          '7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da'
    ) or not exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id and position = 5
        and status = 'PASSED' and output_sha256 =
          'c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c'
    ) then
    raise exception 'POSITION_4_AMENDMENT_PASSED_ASSETS_CHANGED';
  end if;
  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = v_plan.revision_id for share;
  if not found then
    raise exception 'POSITION_4_AMENDMENT_REVISION_INVALID';
  end if;
  return query select v_amendment.id, v_amendment.amendment_hash,
    v_amendment.effective_position_contract_hash,
    v_amendment.effective_prompt_text, v_amendment.effective_prompt_hash,
    v_revision.main_source_hash, v_revision.side_source_hash;
end;
$$;

-- A future worker cannot authorize or reserve position 4 unless it binds its
-- provider event to the active amendment and its exact effective hashes.
create or replace function public.enforce_ebay_reference_guided_position_4_amendment()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_amendment public.ebay_reference_guided_position_contract_amendments%rowtype;
  v_authorization public.ebay_reference_guided_successor_provider_events%rowtype;
begin
  if new.position <> 4 then return new; end if;
  select * into v_amendment
  from public.ebay_reference_guided_position_contract_amendments
  where base_plan_id = new.successor_plan_id and position = 4
    and amendment_type = 'POSITION_CONTRACT_DISTINCTNESS_FIX'
    and status = 'ACTIVE';
  if not found then
    raise exception 'POSITION_4_ACTIVE_AMENDMENT_REQUIRED';
  end if;
  if new.event_type = 'AUTHORIZED' and (
      new.evidence->>'amendmentId' is distinct from v_amendment.id::text
      or new.evidence->>'amendmentHash' is distinct from v_amendment.amendment_hash
      or new.evidence->>'effectivePositionContractHash' is distinct from
        v_amendment.effective_position_contract_hash
      or new.evidence->>'effectivePromptHash' is distinct from
        v_amendment.effective_prompt_hash
    ) then
    raise exception 'POSITION_4_AUTHORIZATION_AMENDMENT_MISMATCH';
  end if;
  if new.event_type = 'CONSUMED' then
    select * into v_authorization
    from public.ebay_reference_guided_successor_provider_events
    where id = new.authorization_event_id and event_type = 'AUTHORIZED'
      and position = 4;
    if not found
      or v_authorization.evidence->>'amendmentId' is distinct from v_amendment.id::text
      or v_authorization.evidence->>'amendmentHash' is distinct from v_amendment.amendment_hash
      or v_authorization.evidence->>'effectivePositionContractHash' is distinct from
        v_amendment.effective_position_contract_hash
      or v_authorization.evidence->>'effectivePromptHash' is distinct from
        v_amendment.effective_prompt_hash then
      raise exception 'POSITION_4_RESERVATION_AMENDMENT_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_reference_guided_position_4_amendment
  on public.ebay_reference_guided_successor_provider_events;
create trigger enforce_reference_guided_position_4_amendment
before insert on public.ebay_reference_guided_successor_provider_events
for each row when (new.position = 4)
execute function public.enforce_ebay_reference_guided_position_4_amendment();

revoke all on function public.resolve_ebay_reference_guided_position_4_effective_contract(
  uuid) from public, anon, authenticated;
grant execute on function public.resolve_ebay_reference_guided_position_4_effective_contract(
  uuid) to service_role;
revoke all on function public.enforce_ebay_reference_guided_position_4_amendment()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
