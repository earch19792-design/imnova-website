-- Append-only position-6 amendment. It strengthens the human-context contract
-- without changing the successor plan, historical prompt, jobs, or assets.
create table if not exists public.ebay_reference_guided_position_6_contract_amendments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  base_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  base_plan_hash text not null check (base_plan_hash ~ '^[0-9a-f]{64}$'),
  position integer not null check (position = 6),
  asset_role text not null check (asset_role = 'SECONDARY_HUMAN_CONTEXT'),
  amendment_type text not null check (
    amendment_type = 'HUMAN_CONTEXT_ANATOMY_AND_DISTINCTNESS_FIX'
  ),
  amendment_reason text not null check (
    amendment_reason = 'MISSING_EXACT_HANDS_GRIP_EXCLUSIONS_AND_ANATOMY_REQUIREMENTS'
  ),
  base_prompt_hash text not null check (base_prompt_hash ~ '^[0-9a-f]{64}$'),
  amendment_text text not null,
  amendment_hash text not null unique check (amendment_hash ~ '^[0-9a-f]{64}$'),
  effective_contract_text text not null,
  effective_contract_hash text not null unique check (
    effective_contract_hash ~ '^[0-9a-f]{64}$'
  ),
  effective_prompt_text text not null,
  effective_prompt_hash text not null unique check (
    effective_prompt_hash ~ '^[0-9a-f]{64}$'
  ),
  must_include jsonb not null,
  must_exclude jsonb not null,
  camera_and_framing jsonb not null,
  automatic_checks jsonb not null,
  human_checks jsonb not null,
  passed_assets_snapshot jsonb not null,
  position_4_snapshot jsonb not null,
  status text not null check (status = 'ACTIVE'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(base_plan_id, position, amendment_type)
);

drop trigger if exists ebay_reference_guided_position_6_amendment_append_only
  on public.ebay_reference_guided_position_6_contract_amendments;
create trigger ebay_reference_guided_position_6_amendment_append_only
before update or delete
  on public.ebay_reference_guided_position_6_contract_amendments
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_position_6_contract_amendments
  enable row level security;
alter table public.ebay_reference_guided_position_6_contract_amendments
  force row level security;
revoke all on table public.ebay_reference_guided_position_6_contract_amendments
  from public, anon, authenticated, service_role;
grant select, insert
  on table public.ebay_reference_guided_position_6_contract_amendments
  to service_role;

with base as (
  select plan.id as base_plan_id, plan.plan_hash as base_plan_hash,
    plan.attempt_id, plan.revision_id, plan.created_by,
    p6.exact_prompt_text as base_prompt_text,
    p6.exact_prompt_hash as base_prompt_hash,
    p6.authorized_sources,
    jsonb_build_array(
      'MUST show exactly two real adult hands.',
      'MUST show one hand entering from the left and holding only the left handle.',
      'MUST show one hand entering from the right and holding only the right handle.',
      'MUST show a natural, relaxed grip.',
      'MUST show the exact product empty, complete, centered, and clearly visible.',
      'MUST show both handles completely.',
      'MUST keep the rim, base, body, and exact perforation pattern clearly visible.',
      'MUST use a neutral, lightly blurred kitchen background.',
      'MUST communicate human scale naturally without asserting a benefit.'
    ) as must_include,
    jsonb_build_array(
      'MUST NOT show any third hand.',
      'MUST NOT show additional, missing, fused, or deformed fingers.',
      'MUST NOT show duplicated hands.',
      'MUST NOT show full arms, a torso, a person, or a face.',
      'MUST NOT show jewelry, a watch, bracelets, or rings.',
      'MUST NOT show conspicuous nails.',
      'MUST NOT show water or droplets anywhere.',
      'MUST NOT show food anywhere.',
      'MUST NOT show utensils anywhere.',
      'MUST NOT show held props.',
      'MUST NOT show text, badges, new logos, or watermarks.',
      'MUST NOT assert comfort, ergonomics, safety, ease, strength, or performance.',
      'MUST NOT let hands hide the rim, perforations, base, or main product body.',
      'MUST NOT alter the handles, rim, base, perforation pattern, white enamel, or proportions.'
    ) as must_exclude,
    jsonb_build_array(
      'MUST use a natural front view.',
      'MUST keep the complete product inside the frame.',
      'MUST show hands only through the wrists or minimal forearms.',
      'MUST show exactly one hand per handle.',
      'MUST ensure no finger passes through metal or product pixels.',
      'MUST use a composition distinct from positions 3, 4, and 5.'
    ) as camera_and_framing,
    jsonb_build_array(
      'exactlyTwoHands', 'oneHandPerHandle', 'noExtraOrFusedFingers',
      'noPersonOrFace', 'noJewelry', 'productEmpty', 'noWater', 'noFood',
      'noUtensils', 'identityFeaturesVisible', 'noText',
      'distinctCommercialComposition'
    ) as automatic_checks,
    jsonb_build_array(
      'MUST confirm exactly two adult hands with one natural hand on each matching handle.',
      'MUST confirm natural anatomy without additional, missing, fused, duplicated, or deformed fingers or hands.',
      'MUST confirm no person, face, jewelry, water, droplets, food, utensils, held props, text, new logo, or claim.',
      'MUST confirm the exact empty complete product and all identity-critical features remain visible.',
      'MUST confirm commercial composition distinct from positions 3, 4, and 5.'
    ) as human_checks,
    (select jsonb_agg(jsonb_build_object(
      'position',j.position,'status',j.status,'outputSha256',j.output_sha256
    ) order by j.position)
    from public.ebay_reference_guided_generation_jobs j
    where j.generation_attempt_id = plan.attempt_id
      and j.position in (2,3,5)) as passed_assets_snapshot,
    (select jsonb_build_object(
      'position',j.position,'status',j.status,'outputSha256',j.output_sha256,
      'outputStoragePath',j.output_storage_path,'providerRequestId',j.provider_request_id,
      'correctionAmendmentId',c.id,'correctionAmendmentHash',c.amendment_hash,
      'chainedEffectiveContractHash',c.chained_effective_contract_hash,
      'chainedEffectivePromptHash',c.chained_effective_prompt_hash
    )
    from public.ebay_reference_guided_generation_jobs j
    join public.ebay_reference_guided_position_4_correction_amendments c
      on c.attempt_id = j.generation_attempt_id and c.position = 4
      and c.status = 'ACTIVE'
    where j.generation_attempt_id = plan.attempt_id and j.position = 4)
      as position_4_snapshot
  from public.ebay_reference_guided_batch_plan_successors_v2 plan
  join public.ebay_reference_guided_batch_plan_successor_positions_v2 p6
    on p6.successor_plan_id = plan.id and p6.position = 6
  join public.ebay_reference_guided_generation_attempts a
    on a.id = plan.attempt_id
  join public.ebay_reference_guided_generation_jobs j6
    on j6.generation_attempt_id = a.id and j6.position = 6
  where plan.id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    and plan.plan_hash =
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    and plan.plan_hash = encode(extensions.digest(
      convert_to(plan.plan_text, 'UTF8'), 'sha256'), 'hex')
    and p6.attempt_id = 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    and p6.asset_role = 'SECONDARY_HUMAN_CONTEXT'
    and p6.commercial_objective = 'REAL_HUMAN_USE'
    and p6.execution_mode = 'PROVIDER'
    and p6.planned_provider_calls = 1
    and p6.exact_prompt_hash =
      '2ab7951d891091657c80edca386c043147d69bc2c593b9540cf461113456fd92'
    and p6.exact_prompt_hash = encode(extensions.digest(
      convert_to(p6.exact_prompt_text, 'UTF8'), 'sha256'), 'hex')
    and p6.authorized_sources = jsonb_build_array(
      jsonb_build_object('sourceImageId','MAIN','sha256',
        '3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1'),
      jsonb_build_object('sourceImageId','SIDE','sha256',
        'f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21'))
    and a.provider_calls = 5 and a.max_provider_calls = 6
    and not a.retry_consumed and a.ebay_writes = 0
    and not a.production_changed and a.status = 'GENERATING'
    and j6.status = 'PENDING' and j6.lease_owner is null
    and j6.lease_expires_at is null and j6.provider_request_id is null
    and j6.provider_call_started_at is null
    and j6.provider_call_completed_at is null
    and j6.output_storage_path is null and j6.output_sha256 is null
    and not exists (
      select 1 from public.ebay_reference_guided_generation_jobs active
      where active.generation_attempt_id = a.id
        and (active.lease_owner is not null or active.lease_expires_at is not null)
    )
    and not exists (
      select 1 from public.ebay_reference_guided_successor_provider_events consumed
      where consumed.attempt_id = a.id and consumed.event_type = 'CONSUMED'
        and not exists (
          select 1 from public.ebay_reference_guided_successor_provider_events terminal
          where terminal.authorization_event_id = consumed.authorization_event_id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')
        )
    )
    and exists (
      select 1 from public.ebay_reference_guided_generation_jobs j2
      where j2.generation_attempt_id = a.id and j2.position = 2
        and j2.status = 'PASSED' and j2.output_sha256 =
          '7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2'
    )
    and exists (
      select 1 from public.ebay_reference_guided_generation_jobs j3
      where j3.generation_attempt_id = a.id and j3.position = 3
        and j3.status = 'PASSED' and j3.output_sha256 =
          '7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da'
    )
    and exists (
      select 1 from public.ebay_reference_guided_generation_jobs j5
      where j5.generation_attempt_id = a.id and j5.position = 5
        and j5.status = 'PASSED' and j5.output_sha256 =
          'c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c'
    )
    and exists (
      select 1
      from public.ebay_reference_guided_generation_jobs j4
      join public.ebay_reference_guided_position_4_correction_amendments c4
        on c4.attempt_id = j4.generation_attempt_id and c4.position = 4
        and c4.status = 'ACTIVE'
      where j4.generation_attempt_id = a.id and j4.position = 4
        and j4.status = 'BLOCKED_FIDELITY' and j4.output_sha256 =
          '988304aedd2ce2c7ebcd505a5e812a930d550be99a5f8fb2d2b7e61561c5d123'
        and c4.id = '5654ac63-b582-4286-8be8-3323eea1aea6'::uuid
        and c4.amendment_hash =
          'd08413455f6e4b533c693618281adf2ec6660850361ab2fd2832efe5fe2a816e'
        and c4.chained_effective_contract_hash =
          '1ee4f1d2bf1f752478fb9e37e96bd8dba1aba9e6a087cda773119f4aa15e3935'
        and c4.chained_effective_prompt_hash =
          'a18a623c92f55a53e29d9c6b03161811e26012e2a6c48ed5b4f297c734b1cae1'
    )
), amendment as (
  select base.*,
    jsonb_build_object(
      'version','POSITION_6_HUMAN_CONTEXT_AMENDMENT_V1_2026_07_22',
      'basePlanId',base_plan_id,
      'basePlanHash',base_plan_hash,
      'position',6,
      'assetRole','SECONDARY_HUMAN_CONTEXT',
      'amendmentType','HUMAN_CONTEXT_ANATOMY_AND_DISTINCTNESS_FIX',
      'amendmentReason','MISSING_EXACT_HANDS_GRIP_EXCLUSIONS_AND_ANATOMY_REQUIREMENTS',
      'basePromptHash',base_prompt_hash,
      'mustInclude',must_include,
      'mustExclude',must_exclude,
      'cameraAndFraming',camera_and_framing,
      'automaticChecks',automatic_checks,
      'humanChecks',human_checks
    ) as amendment_manifest
  from base
), amendment_hashed as (
  select amendment.*,
    amendment_manifest::text as amendment_text,
    encode(extensions.digest(convert_to(
      amendment_manifest::text, 'UTF8'), 'sha256'), 'hex') as amendment_hash
  from amendment
), effective as (
  select amendment_hashed.*,
    jsonb_build_object(
      'version','POSITION_6_EFFECTIVE_CONTRACT_V1_2026_07_22',
      'basePlanId',base_plan_id,
      'basePlanHash',base_plan_hash,
      'position',6,
      'assetRole','SECONDARY_HUMAN_CONTEXT',
      'basePromptHash',base_prompt_hash,
      'amendmentHash',amendment_hash,
      'authorizedSources',authorized_sources,
      'mustInclude',must_include,
      'mustExclude',must_exclude,
      'cameraAndFraming',camera_and_framing,
      'requiredProductVisibility',jsonb_build_array(
        'MUST keep the exact empty complete product, both complete handles, rim, body, base, and perforation pattern clearly visible.'
      ),
      'contextualObjectsNotIncluded',jsonb_build_array(
        'MUST treat the two adult hands and neutral kitchen background as non-included human-scale context.'
      ),
      'contractPriority','This position-6 amendment MUST override conflicting base-plan, research, market-brief, category-signal, or global creative instructions.',
      'automaticChecks',automatic_checks,
      'humanChecks',human_checks
    ) as effective_contract_manifest,
    base_prompt_text || E'\n\n' || $position_6_amendment$
POSITION_6_EFFECTIVE_AMENDMENT=HUMAN_CONTEXT_ANATOMY_AND_DISTINCTNESS_FIX
CONTRACT_PRIORITY=This position amendment MUST override conflicting base-plan, research, Market Visual Brief, category-signal, or global creative instructions.
POSITION_MUST_INCLUDE_AMENDMENT:
- MUST show exactly two real adult hands.
- MUST show one hand entering from the left and holding only the left handle.
- MUST show one hand entering from the right and holding only the right handle.
- MUST show a natural relaxed grip.
- MUST show the exact product empty, complete, centered, and clearly visible.
- MUST show both handles completely and keep the rim, base, body, and exact perforation pattern clearly visible.
- MUST use a neutral lightly blurred kitchen background.
- MUST communicate human scale naturally without asserting a benefit.
POSITION_MUST_EXCLUDE_AMENDMENT:
- MUST NOT show any third hand, duplicated hands, or additional, missing, fused, or deformed fingers.
- MUST NOT show full arms, a torso, a person, or a face.
- MUST NOT show jewelry, a watch, bracelets, rings, or conspicuous nails.
- MUST NOT show water, droplets, food, utensils, or held props anywhere.
- MUST NOT show text, badges, new logos, or watermarks.
- MUST NOT assert comfort, ergonomics, safety, ease, strength, or performance.
- MUST NOT let hands hide the rim, perforations, base, or main product body.
- MUST NOT alter handles, rim, base, perforation pattern, white enamel, or proportions.
CAMERA_AND_FRAMING_AMENDMENT:
- MUST use a natural front view with the complete product inside the frame.
- MUST show hands only through wrists or minimal forearms, with exactly one hand per handle.
- MUST ensure no finger passes through metal or product pixels.
- MUST use a composition distinct from positions 3, 4, and 5.
QA_KEYS=exactlyTwoHands; oneHandPerHandle; noExtraOrFusedFingers; noPersonOrFace; noJewelry; productEmpty; noWater; noFood; noUtensils; identityFeaturesVisible; noText; distinctCommercialComposition
$position_6_amendment$ as effective_prompt_text
  from amendment_hashed
), final as (
  select effective.*,
    effective_contract_manifest::text as effective_contract_text,
    encode(extensions.digest(convert_to(
      effective_contract_manifest::text, 'UTF8'), 'sha256'), 'hex')
      as effective_contract_hash,
    encode(extensions.digest(convert_to(
      effective_prompt_text, 'UTF8'), 'sha256'), 'hex')
      as effective_prompt_hash
  from effective
)
insert into public.ebay_reference_guided_position_6_contract_amendments(
  attempt_id, revision_id, base_plan_id, base_plan_hash, position, asset_role,
  amendment_type, amendment_reason, base_prompt_hash, amendment_text,
  amendment_hash, effective_contract_text, effective_contract_hash,
  effective_prompt_text, effective_prompt_hash, must_include, must_exclude,
  camera_and_framing, automatic_checks, human_checks,
  passed_assets_snapshot, position_4_snapshot, status, created_by
)
select attempt_id, revision_id, base_plan_id, base_plan_hash, 6,
  'SECONDARY_HUMAN_CONTEXT',
  'HUMAN_CONTEXT_ANATOMY_AND_DISTINCTNESS_FIX',
  'MISSING_EXACT_HANDS_GRIP_EXCLUSIONS_AND_ANATOMY_REQUIREMENTS',
  base_prompt_hash, amendment_text, amendment_hash, effective_contract_text,
  effective_contract_hash, effective_prompt_text, effective_prompt_hash,
  must_include, must_exclude, camera_and_framing, automatic_checks,
  human_checks, passed_assets_snapshot, position_4_snapshot, 'ACTIVE', created_by
from final
on conflict (base_plan_id, position, amendment_type) do nothing;

create or replace function public.resolve_ebay_reference_guided_position_6_effective_contract(
  p_attempt_id uuid
) returns table(
  position_6_amendment_id uuid,
  position_6_amendment_hash text,
  position_6_effective_contract_hash text,
  position_6_effective_prompt_text text,
  position_6_effective_prompt_hash text,
  main_source_hash text,
  side_source_hash text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_amendment public.ebay_reference_guided_position_6_contract_amendments%rowtype;
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_job public.ebay_reference_guided_generation_jobs%rowtype;
  v_contract jsonb;
begin
  if p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid then
    raise exception 'POSITION_6_AMENDMENT_ATTEMPT_INVALID';
  end if;
  select * into v_attempt
  from public.ebay_reference_guided_generation_attempts
  where id = p_attempt_id for share;
  select * into v_amendment
  from public.ebay_reference_guided_position_6_contract_amendments
  where attempt_id = p_attempt_id and position = 6 and status = 'ACTIVE'
    and amendment_type = 'HUMAN_CONTEXT_ANATOMY_AND_DISTINCTNESS_FIX'
  for share;
  select * into v_job
  from public.ebay_reference_guided_generation_jobs
  where generation_attempt_id = p_attempt_id and position = 6 for share;
  if v_attempt.id is null or v_amendment.id is null or v_job.id is null
    or v_attempt.provider_calls <> 5 or v_attempt.max_provider_calls <> 6
    or v_attempt.retry_consumed or v_attempt.ebay_writes <> 0
    or v_attempt.production_changed or v_job.status <> 'PENDING'
    or v_job.lease_owner is not null or v_job.lease_expires_at is not null
    or v_job.provider_request_id is not null
    or v_job.provider_call_started_at is not null
    or v_job.provider_call_completed_at is not null
    or v_job.output_storage_path is not null or v_job.output_sha256 is not null
    or v_amendment.amendment_hash <> encode(extensions.digest(
      convert_to(v_amendment.amendment_text, 'UTF8'), 'sha256'), 'hex')
    or v_amendment.effective_contract_hash <> encode(extensions.digest(
      convert_to(v_amendment.effective_contract_text, 'UTF8'), 'sha256'), 'hex')
    or v_amendment.effective_prompt_hash <> encode(extensions.digest(
      convert_to(v_amendment.effective_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v_amendment.effective_prompt_text not like
      '%MUST show exactly two real adult hands.%'
    or v_amendment.effective_prompt_text not like
      '%MUST show one hand entering from the left and holding only the left handle.%'
    or v_amendment.effective_prompt_text not like
      '%MUST show one hand entering from the right and holding only the right handle.%'
    or v_amendment.effective_prompt_text not like
      '%MUST NOT show water, droplets, food, utensils, or held props anywhere.%'
    or v_amendment.effective_prompt_text not like
      '%additional, missing, fused, or deformed fingers%'
    or exists (
      select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id = p_attempt_id
        and (lease_owner is not null or lease_expires_at is not null)
    ) or exists (
      select 1 from public.ebay_reference_guided_successor_provider_events consumed
      where consumed.attempt_id = p_attempt_id and consumed.event_type = 'CONSUMED'
        and not exists (
          select 1 from public.ebay_reference_guided_successor_provider_events terminal
          where terminal.authorization_event_id = consumed.authorization_event_id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')
        )
    ) then
    raise exception 'POSITION_6_AMENDMENT_STATE_OR_HASH_INVALID';
  end if;
  begin v_contract := v_amendment.effective_contract_text::jsonb;
  exception when others then
    raise exception 'POSITION_6_EFFECTIVE_CONTRACT_JSON_INVALID';
  end;
  if v_contract->>'amendmentHash' <> v_amendment.amendment_hash
    or not (v_contract->'mustInclude' @> v_amendment.must_include)
    or not (v_contract->'mustExclude' @> v_amendment.must_exclude)
    or not (v_contract->'automaticChecks' @> v_amendment.automatic_checks) then
    raise exception 'POSITION_6_EFFECTIVE_CONTRACT_CONTENT_INVALID';
  end if;
  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = v_amendment.revision_id for share;
  if not found or v_revision.main_source_hash <>
      '3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1'
    or v_revision.side_source_hash <>
      'f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21' then
    raise exception 'POSITION_6_AMENDMENT_SOURCES_INVALID';
  end if;
  return query select v_amendment.id, v_amendment.amendment_hash,
    v_amendment.effective_contract_hash, v_amendment.effective_prompt_text,
    v_amendment.effective_prompt_hash, v_revision.main_source_hash,
    v_revision.side_source_hash;
end;
$$;

-- No future AUTHORIZED or CONSUMED event for position 6 can omit or alter the
-- active amendment. The check runs before a reservation can exist.
create or replace function public.enforce_ebay_reference_guided_position_6_amendment()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_amendment public.ebay_reference_guided_position_6_contract_amendments%rowtype;
  v_authorization public.ebay_reference_guided_successor_provider_events%rowtype;
begin
  if new.position <> 6 then return new; end if;
  select * into v_amendment
  from public.ebay_reference_guided_position_6_contract_amendments
  where base_plan_id = new.successor_plan_id and position = 6
    and amendment_type = 'HUMAN_CONTEXT_ANATOMY_AND_DISTINCTNESS_FIX'
    and status = 'ACTIVE';
  if not found then raise exception 'POSITION_6_ACTIVE_AMENDMENT_REQUIRED'; end if;
  if new.event_type = 'AUTHORIZED' and (
      new.evidence->>'position6AmendmentId' is distinct from v_amendment.id::text
      or new.evidence->>'position6AmendmentHash' is distinct from v_amendment.amendment_hash
      or new.evidence->>'position6EffectiveContractHash' is distinct from
        v_amendment.effective_contract_hash
      or new.evidence->>'position6EffectivePromptHash' is distinct from
        v_amendment.effective_prompt_hash
    ) then
    raise exception 'POSITION_6_AUTHORIZATION_AMENDMENT_MISMATCH';
  end if;
  if new.event_type = 'CONSUMED' then
    select * into v_authorization
    from public.ebay_reference_guided_successor_provider_events
    where id = new.authorization_event_id and event_type = 'AUTHORIZED'
      and position = 6;
    if not found
      or v_authorization.evidence->>'position6AmendmentId' is distinct from
        v_amendment.id::text
      or v_authorization.evidence->>'position6AmendmentHash' is distinct from
        v_amendment.amendment_hash
      or v_authorization.evidence->>'position6EffectiveContractHash' is distinct from
        v_amendment.effective_contract_hash
      or v_authorization.evidence->>'position6EffectivePromptHash' is distinct from
        v_amendment.effective_prompt_hash then
      raise exception 'POSITION_6_RESERVATION_AMENDMENT_MISMATCH';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_reference_guided_position_6_amendment
  on public.ebay_reference_guided_successor_provider_events;
create trigger enforce_reference_guided_position_6_amendment
before insert on public.ebay_reference_guided_successor_provider_events
for each row when (new.position = 6)
execute function public.enforce_ebay_reference_guided_position_6_amendment();

revoke all on function public.resolve_ebay_reference_guided_position_6_effective_contract(
  uuid) from public, anon, authenticated;
grant execute on function public.resolve_ebay_reference_guided_position_6_effective_contract(
  uuid) to service_role;
revoke all on function public.enforce_ebay_reference_guided_position_6_amendment()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
