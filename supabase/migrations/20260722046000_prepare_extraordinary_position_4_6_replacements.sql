-- One append-only preparation transaction for the extraordinary position-4
-- and position-6 replacements. It creates no authorization, reservation,
-- lease, provider call, output, verdict mutation, eBay write, or production write.

create table if not exists public.ebay_reference_guided_position_4_fidelity_amendments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  base_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  base_plan_hash text not null check (base_plan_hash ~ '^[0-9a-f]{64}$'),
  position integer not null check (position = 4),
  asset_role text not null check (asset_role = 'SECONDARY_USE_CONTEXT'),
  prior_correction_amendment_id uuid not null references public.ebay_reference_guided_position_4_correction_amendments(id),
  prior_correction_amendment_hash text not null check (prior_correction_amendment_hash ~ '^[0-9a-f]{64}$'),
  prior_effective_contract_hash text not null check (prior_effective_contract_hash ~ '^[0-9a-f]{64}$'),
  prior_effective_prompt_hash text not null check (prior_effective_prompt_hash ~ '^[0-9a-f]{64}$'),
  amendment_type text not null check (
    amendment_type = 'PRODUCT_GEOMETRY_AND_IDENTITY_FIDELITY_FIX'
  ),
  rejected_output_sha256 text not null check (rejected_output_sha256 ~ '^[0-9a-f]{64}$'),
  amendment_text text not null,
  amendment_hash text not null unique check (amendment_hash ~ '^[0-9a-f]{64}$'),
  final_effective_contract_text text not null,
  final_effective_contract_hash text not null unique check (final_effective_contract_hash ~ '^[0-9a-f]{64}$'),
  final_effective_prompt_text text not null,
  final_effective_prompt_hash text not null unique check (final_effective_prompt_hash ~ '^[0-9a-f]{64}$'),
  must_preserve jsonb not null,
  must_exclude jsonb not null,
  status text not null check (status = 'ACTIVE'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(prior_correction_amendment_id, amendment_type)
);

create table if not exists public.ebay_reference_guided_position_6_correction_amendments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  base_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  base_plan_hash text not null check (base_plan_hash ~ '^[0-9a-f]{64}$'),
  position integer not null check (position = 6),
  asset_role text not null check (asset_role = 'SECONDARY_HUMAN_CONTEXT'),
  prior_amendment_id uuid not null references public.ebay_reference_guided_position_6_contract_amendments(id),
  prior_amendment_hash text not null check (prior_amendment_hash ~ '^[0-9a-f]{64}$'),
  prior_effective_contract_hash text not null check (prior_effective_contract_hash ~ '^[0-9a-f]{64}$'),
  prior_effective_prompt_hash text not null check (prior_effective_prompt_hash ~ '^[0-9a-f]{64}$'),
  rejected_verdict_event_id uuid not null references public.ebay_reference_guided_position_6_human_verdict_events(id),
  rejected_output_sha256 text not null check (rejected_output_sha256 ~ '^[0-9a-f]{64}$'),
  amendment_type text not null check (
    amendment_type = 'EMPTY_BACKGROUND_HUMAN_CONTEXT_FIX'
  ),
  amendment_text text not null,
  amendment_hash text not null unique check (amendment_hash ~ '^[0-9a-f]{64}$'),
  final_effective_contract_text text not null,
  final_effective_contract_hash text not null unique check (final_effective_contract_hash ~ '^[0-9a-f]{64}$'),
  final_effective_prompt_text text not null,
  final_effective_prompt_hash text not null unique check (final_effective_prompt_hash ~ '^[0-9a-f]{64}$'),
  must_include jsonb not null,
  must_exclude jsonb not null,
  status text not null check (status = 'ACTIVE'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(prior_amendment_id, amendment_type)
);

do $append_only_triggers$
begin
  execute 'drop trigger if exists ebay_reference_guided_position_4_fidelity_append_only on public.ebay_reference_guided_position_4_fidelity_amendments';
  execute 'create trigger ebay_reference_guided_position_4_fidelity_append_only before update or delete on public.ebay_reference_guided_position_4_fidelity_amendments for each row execute function public.prevent_reference_guided_human_evidence_mutation()';
  execute 'drop trigger if exists ebay_reference_guided_position_6_correction_append_only on public.ebay_reference_guided_position_6_correction_amendments';
  execute 'create trigger ebay_reference_guided_position_6_correction_append_only before update or delete on public.ebay_reference_guided_position_6_correction_amendments for each row execute function public.prevent_reference_guided_human_evidence_mutation()';
end;
$append_only_triggers$;

alter table public.ebay_reference_guided_position_4_fidelity_amendments enable row level security;
alter table public.ebay_reference_guided_position_4_fidelity_amendments force row level security;
alter table public.ebay_reference_guided_position_6_correction_amendments enable row level security;
alter table public.ebay_reference_guided_position_6_correction_amendments force row level security;
revoke all on table public.ebay_reference_guided_position_4_fidelity_amendments from public, anon, authenticated, service_role;
revoke all on table public.ebay_reference_guided_position_6_correction_amendments from public, anon, authenticated, service_role;
grant select, insert on table public.ebay_reference_guided_position_4_fidelity_amendments to service_role;
grant select, insert on table public.ebay_reference_guided_position_6_correction_amendments to service_role;

-- Position 4: chain an explicit geometric-identity amendment onto the existing
-- water/identity correction without changing either historical row.
with base as (
  select plan.id as base_plan_id, plan.plan_hash as base_plan_hash,
    plan.attempt_id, plan.revision_id, plan.created_by,
    prior.id as prior_correction_amendment_id,
    prior.amendment_hash as prior_correction_amendment_hash,
    prior.chained_effective_contract_hash as prior_effective_contract_hash,
    prior.chained_effective_contract_text::jsonb as prior_contract,
    prior.chained_effective_prompt_hash as prior_effective_prompt_hash,
    prior.chained_effective_prompt_text as prior_prompt_text,
    prior.rejected_output_sha256
  from public.ebay_reference_guided_batch_plan_successors_v2 plan
  join public.ebay_reference_guided_position_4_correction_amendments prior
    on prior.base_plan_id = plan.id and prior.position = 4 and prior.status = 'ACTIVE'
  join public.ebay_reference_guided_generation_attempts a on a.id = plan.attempt_id
  join public.ebay_reference_guided_generation_jobs j
    on j.generation_attempt_id = a.id and j.position = 4
  where plan.id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    and plan.plan_hash = 'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    and plan.plan_hash = encode(extensions.digest(convert_to(plan.plan_text,'UTF8'),'sha256'),'hex')
    and prior.id = '5654ac63-b582-4286-8be8-3323eea1aea6'::uuid
    and prior.amendment_hash = 'd08413455f6e4b533c693618281adf2ec6660850361ab2fd2832efe5fe2a816e'
    and prior.chained_effective_contract_hash = '1ee4f1d2bf1f752478fb9e37e96bd8dba1aba9e6a087cda773119f4aa15e3935'
    and prior.chained_effective_prompt_hash = 'a18a623c92f55a53e29d9c6b03161811e26012e2a6c48ed5b4f297c734b1cae1'
    and prior.amendment_hash = encode(extensions.digest(convert_to(prior.amendment_text,'UTF8'),'sha256'),'hex')
    and prior.chained_effective_contract_hash = encode(extensions.digest(convert_to(prior.chained_effective_contract_text,'UTF8'),'sha256'),'hex')
    and prior.chained_effective_prompt_hash = encode(extensions.digest(convert_to(prior.chained_effective_prompt_text,'UTF8'),'sha256'),'hex')
    and a.provider_calls = 6 and a.max_provider_calls = 6
    and not a.retry_consumed and a.ebay_writes = 0 and not a.production_changed
    and j.status = 'BLOCKED_FIDELITY'
    and j.output_sha256 = '988304aedd2ce2c7ebcd505a5e812a930d550be99a5f8fb2d2b7e61561c5d123'
    and j.output_sha256 = prior.rejected_output_sha256
    and j.lease_owner is null and j.lease_expires_at is null
), clauses as (
  select base.*,
    jsonb_build_array(
      'MUST preserve the exact vessel silhouette and overall proportions.',
      'MUST preserve the exact visual height, visual width, and apparent depth.',
      'MUST preserve exactly two handles.',
      'MUST preserve the exact shape, curvature, size, and attachment points of both handles.',
      'MUST preserve the continuous metal rim.',
      'MUST preserve the raised base, its shape, and its lower ring.',
      'MUST preserve the exact count, distribution, orientation, and relative position of all perforations.',
      'MUST preserve the white enamel finish.',
      'MUST preserve coherent metal details and reflections.',
      'MUST show the complete product without clipping or hidden parts.'
    ) as must_preserve,
    jsonb_build_array(
      'Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product.',
      'MUST NOT show deformed, duplicated, asymmetric, or displaced handles.',
      'MUST NOT add, remove, close, or reorder perforations.',
      'MUST NOT show an irregular or discontinuous rim.',
      'MUST NOT widen, narrow, twist, or separate the base.',
      'MUST NOT change color, material, texture, volume, or proportion.',
      'MUST NOT creatively reconstruct the product.'
    ) as must_exclude
  from base
), amendment as (
  select clauses.*,
    jsonb_build_object(
      'version','POSITION_4_PRODUCT_GEOMETRY_FIDELITY_V1_2026_07_22',
      'basePlanId',base_plan_id,'basePlanHash',base_plan_hash,
      'position',4,'assetRole','SECONDARY_USE_CONTEXT',
      'priorCorrectionAmendmentId',prior_correction_amendment_id,
      'priorCorrectionAmendmentHash',prior_correction_amendment_hash,
      'priorEffectiveContractHash',prior_effective_contract_hash,
      'priorEffectivePromptHash',prior_effective_prompt_hash,
      'amendmentType','PRODUCT_GEOMETRY_AND_IDENTITY_FIDELITY_FIX',
      'rejectedOutputSha256',rejected_output_sha256,
      'mustPreserve',must_preserve,'mustExclude',must_exclude
    ) as amendment_manifest
  from clauses
), hashed as (
  select amendment.*, amendment_manifest::text as amendment_text,
    encode(extensions.digest(convert_to(amendment_manifest::text,'UTF8'),'sha256'),'hex') as amendment_hash
  from amendment
), effective as (
  select hashed.*,
    prior_contract || jsonb_build_object(
      'version','POSITION_4_FINAL_EFFECTIVE_CONTRACT_V3_2026_07_22',
      'priorEffectiveContractHash',prior_effective_contract_hash,
      'fidelityAmendmentHash',amendment_hash,
      'contractPriority','This fidelity amendment MUST override any conflicting creative direction.',
      'mustInclude',(prior_contract->'mustInclude') || must_preserve,
      'mustExclude',(prior_contract->'mustExclude') || must_exclude,
      'automaticChecks',(prior_contract->'automaticChecks') || jsonb_build_array(
        'FAIL on any deformation, warp, stretch, compression, width change, rotation, duplication, removal, relocation, or redesign.',
        'FAIL unless exact handles, rim, base, perforations, enamel, proportions, and complete visibility are preserved.'
      )
    ) as final_contract,
    prior_prompt_text || E'\n\n' || $p4_fidelity$
POSITION_4_FIDELITY_AMENDMENT=PRODUCT_GEOMETRY_AND_IDENTITY_FIDELITY_FIX
CONTRACT_PRIORITY=This fidelity amendment MUST override any conflicting creative direction.
EXPLICIT_NO_DEFORMATION=Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product.
POSITION_MUST_PRESERVE_FIDELITY:
- MUST preserve the exact vessel silhouette and overall proportions.
- MUST preserve the exact visual height, visual width, and apparent depth.
- MUST preserve exactly two handles.
- MUST preserve the exact shape, curvature, size, and attachment points of both handles.
- MUST preserve the continuous metal rim.
- MUST preserve the raised base, its shape, and its lower ring.
- MUST preserve the exact count, distribution, orientation, and relative position of all perforations.
- MUST preserve the white enamel finish.
- MUST preserve coherent metal details and reflections.
- MUST show the complete product without clipping or hidden parts.
POSITION_MUST_EXCLUDE_FIDELITY:
- MUST NOT show deformed, duplicated, asymmetric, or displaced handles.
- MUST NOT add, remove, close, or reorder perforations.
- MUST NOT show an irregular or discontinuous rim.
- MUST NOT widen, narrow, twist, or separate the base.
- MUST NOT change color, material, texture, volume, or proportion.
- MUST NOT creatively reconstruct the product.
$p4_fidelity$ as final_prompt
  from hashed
), final as (
  select effective.*, final_contract::text as final_contract_text,
    encode(extensions.digest(convert_to(final_contract::text,'UTF8'),'sha256'),'hex') as final_contract_hash,
    encode(extensions.digest(convert_to(final_prompt,'UTF8'),'sha256'),'hex') as final_prompt_hash
  from effective
)
insert into public.ebay_reference_guided_position_4_fidelity_amendments(
  attempt_id,revision_id,base_plan_id,base_plan_hash,position,asset_role,
  prior_correction_amendment_id,prior_correction_amendment_hash,
  prior_effective_contract_hash,prior_effective_prompt_hash,amendment_type,
  rejected_output_sha256,amendment_text,amendment_hash,
  final_effective_contract_text,final_effective_contract_hash,
  final_effective_prompt_text,final_effective_prompt_hash,must_preserve,
  must_exclude,status,created_by
)
select attempt_id,revision_id,base_plan_id,base_plan_hash,4,
  'SECONDARY_USE_CONTEXT',prior_correction_amendment_id,
  prior_correction_amendment_hash,prior_effective_contract_hash,
  prior_effective_prompt_hash,'PRODUCT_GEOMETRY_AND_IDENTITY_FIDELITY_FIX',
  rejected_output_sha256,amendment_text,amendment_hash,final_contract_text,
  final_contract_hash,final_prompt,final_prompt_hash,must_preserve,must_exclude,
  'ACTIVE',created_by
from final
on conflict (prior_correction_amendment_id,amendment_type) do nothing;

do $validate_position_4_final$
declare v public.ebay_reference_guided_position_4_fidelity_amendments%rowtype;
begin
  select * into v from public.ebay_reference_guided_position_4_fidelity_amendments
  where prior_correction_amendment_id = '5654ac63-b582-4286-8be8-3323eea1aea6'::uuid
    and amendment_type = 'PRODUCT_GEOMETRY_AND_IDENTITY_FIDELITY_FIX';
  if not found
    or v.prior_correction_amendment_hash <> 'd08413455f6e4b533c693618281adf2ec6660850361ab2fd2832efe5fe2a816e'
    or v.prior_effective_contract_hash <> '1ee4f1d2bf1f752478fb9e37e96bd8dba1aba9e6a087cda773119f4aa15e3935'
    or v.prior_effective_prompt_hash <> 'a18a623c92f55a53e29d9c6b03161811e26012e2a6c48ed5b4f297c734b1cae1'
    or v.amendment_hash <> encode(extensions.digest(convert_to(v.amendment_text,'UTF8'),'sha256'),'hex')
    or v.final_effective_contract_hash <> encode(extensions.digest(convert_to(v.final_effective_contract_text,'UTF8'),'sha256'),'hex')
    or v.final_effective_prompt_hash <> encode(extensions.digest(convert_to(v.final_effective_prompt_text,'UTF8'),'sha256'),'hex')
    or v.final_effective_prompt_text not like '%Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product.%'
    or v.final_effective_prompt_text not like '%MUST preserve the exact vessel silhouette and overall proportions.%'
    or v.final_effective_prompt_text not like '%MUST preserve exactly two handles.%'
    or v.final_effective_prompt_text not like '%MUST preserve the exact shape, curvature, size, and attachment points of both handles.%'
    or v.final_effective_prompt_text not like '%MUST preserve the exact count, distribution, orientation, and relative position of all perforations.%'
    or v.final_effective_prompt_text not like '%MUST show the complete product without clipping or hidden parts.%'
    or v.final_effective_prompt_text not like '%MUST show a visible faucet that is switched off.%'
    or v.final_effective_prompt_text not like '%exactly 4 to 6 freshly rinsed strawberries%'
    or v.final_effective_prompt_text not like '%MUST show only small residual droplets%'
    or v.final_effective_prompt_text not like '%MUST show zero currents, streams, jets, waterfalls, splashes, or drainage.%'
    or v.final_effective_prompt_text not like '%MUST show no human hands, fingers, arms, people, or human body parts.%'
    or v.final_effective_prompt_text not like '%other foods; utensils; props; text; new logos; badges; measurements; watermarks; claims.%' then
    raise exception 'POSITION_4_FINAL_FIDELITY_CONTRACT_INVALID';
  end if;
end;
$validate_position_4_final$;

-- Position 6: chain the empty-background correction to the preserved rejected
-- canary and carry the same explicit product-fidelity protection.
with base as (
  select plan.id as base_plan_id,plan.plan_hash as base_plan_hash,
    plan.attempt_id,plan.revision_id,plan.created_by,
    prior.id as prior_amendment_id,prior.amendment_hash as prior_amendment_hash,
    prior.effective_contract_hash as prior_effective_contract_hash,
    prior.effective_contract_text::jsonb as prior_contract,
    prior.effective_prompt_hash as prior_effective_prompt_hash,
    prior.effective_prompt_text as prior_prompt_text,
    verdict.id as rejected_verdict_event_id,
    verdict.output_sha256 as rejected_output_sha256
  from public.ebay_reference_guided_batch_plan_successors_v2 plan
  join public.ebay_reference_guided_position_6_contract_amendments prior
    on prior.base_plan_id = plan.id and prior.position = 6 and prior.status = 'ACTIVE'
  join public.ebay_reference_guided_position_6_human_verdict_events verdict
    on verdict.attempt_id = plan.attempt_id and verdict.position = 6
    and verdict.human_verdict = 'REJECTED'
  join public.ebay_reference_guided_generation_attempts a on a.id = plan.attempt_id
  join public.ebay_reference_guided_generation_jobs j
    on j.generation_attempt_id = a.id and j.position = 6
  where plan.id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    and plan.plan_hash = 'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    and prior.id = '3bbe555c-6452-46c0-a6ad-8443207e1890'::uuid
    and prior.amendment_hash = 'd9aed20d4a22b109a2093da86d29c1b46bf461927b50c9891d80aee0b381d204'
    and prior.effective_contract_hash = '180408823f7544477176bebf70fc14fc610fd755bc85d117c3792eb15945b144'
    and prior.effective_prompt_hash = '27d40d2330ad3f33ca88ffde19b20021d5f91ef9d16105c0626a71153d3aaa52'
    and prior.amendment_hash = encode(extensions.digest(convert_to(prior.amendment_text,'UTF8'),'sha256'),'hex')
    and prior.effective_contract_hash = encode(extensions.digest(convert_to(prior.effective_contract_text,'UTF8'),'sha256'),'hex')
    and prior.effective_prompt_hash = encode(extensions.digest(convert_to(prior.effective_prompt_text,'UTF8'),'sha256'),'hex')
    and verdict.output_sha256 = '0fb3b3241860c3f045ad822eb576cb0a8a11fb5b0f02cb522825c3d82bdfda14'
    and verdict.verdict_reason = 'BACKGROUND_KITCHEN_UTENSILS_PRESENT'
    and verdict.failure_class = 'EFFECTIVE_CONTRACT_VIOLATION'
    and verdict.output_preserved and not verdict.reassigned
    and a.provider_calls = 6 and a.max_provider_calls = 6
    and not a.retry_consumed and a.ebay_writes = 0 and not a.production_changed
    and j.status = 'BLOCKED_FIDELITY' and j.output_sha256 = verdict.output_sha256
    and j.lease_owner is null and j.lease_expires_at is null
), clauses as (
  select base.*,
    jsonb_build_array(
      'MUST keep exactly two adult hands, one hand on each corresponding handle, with natural anatomy.',
      'MUST keep the exact product complete, empty, centered, and clearly visible.',
      'MUST show hands only through the wrists or minimal forearms.',
      'MUST use a bright, neutral, lightly blurred kitchen background that is completely empty.',
      'MUST use a clean simple surface with no accessories.',
      'MUST preserve exact product geometry and identity.'
    ) as must_include,
    jsonb_build_array(
      'MUST NOT show cutting boards in any plane.',
      'MUST NOT show jars, containers, or canisters in any plane.',
      'MUST NOT show plants or decoration in any plane.',
      'MUST NOT show utensils or appliances in any plane.',
      'MUST NOT show food, beverages, water, or droplets in any plane.',
      'MUST NOT show any recognizable background object.',
      'Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product.',
      'MUST NOT show deformed, duplicated, asymmetric, or displaced handles.',
      'MUST NOT add, remove, close, or reorder perforations.',
      'MUST NOT show an irregular or discontinuous rim.',
      'MUST NOT widen, narrow, twist, or separate the base.',
      'MUST NOT change color, material, texture, volume, or proportion.',
      'MUST NOT creatively reconstruct the product.'
    ) as must_exclude
  from base
), amendment as (
  select clauses.*,
    jsonb_build_object(
      'version','POSITION_6_EMPTY_BACKGROUND_CORRECTION_V1_2026_07_22',
      'basePlanId',base_plan_id,'basePlanHash',base_plan_hash,
      'position',6,'assetRole','SECONDARY_HUMAN_CONTEXT',
      'priorAmendmentId',prior_amendment_id,'priorAmendmentHash',prior_amendment_hash,
      'priorEffectiveContractHash',prior_effective_contract_hash,
      'priorEffectivePromptHash',prior_effective_prompt_hash,
      'rejectedVerdictEventId',rejected_verdict_event_id,
      'rejectedOutputSha256',rejected_output_sha256,
      'amendmentType','EMPTY_BACKGROUND_HUMAN_CONTEXT_FIX',
      'mustInclude',must_include,'mustExclude',must_exclude
    ) as amendment_manifest
  from clauses
), hashed as (
  select amendment.*,amendment_manifest::text as amendment_text,
    encode(extensions.digest(convert_to(amendment_manifest::text,'UTF8'),'sha256'),'hex') as amendment_hash
  from amendment
), effective as (
  select hashed.*,
    prior_contract || jsonb_build_object(
      'version','POSITION_6_FINAL_EFFECTIVE_CONTRACT_V2_2026_07_22',
      'priorEffectiveContractHash',prior_effective_contract_hash,
      'correctionAmendmentHash',amendment_hash,
      'contractPriority','This correction MUST override any background props or conflicting creative direction.',
      'mustInclude',(prior_contract->'mustInclude') || must_include,
      'mustExclude',(prior_contract->'mustExclude') || must_exclude,
      'automaticChecks',(prior_contract->'automaticChecks') || jsonb_build_array(
        'FAIL unless the background is completely empty and contains no recognizable object.',
        'FAIL on any cutting board, jar, container, canister, plant, decoration, utensil, appliance, food, beverage, water, or droplet.',
        'FAIL on any product deformation or identity change.'
      )
    ) as final_contract,
    prior_prompt_text || E'\n\n' || $p6_correction$
POSITION_6_CORRECTION_AMENDMENT=EMPTY_BACKGROUND_HUMAN_CONTEXT_FIX
CONTRACT_PRIORITY=This correction MUST override any background props or conflicting creative direction.
POSITION_MUST_INCLUDE_CORRECTION:
- MUST keep exactly two adult hands, one hand on each corresponding handle, with natural anatomy.
- MUST keep the exact product complete, empty, centered, and clearly visible.
- MUST show hands only through the wrists or minimal forearms.
- MUST use a bright, neutral, lightly blurred kitchen background that is completely empty.
- MUST use a clean simple surface with no accessories.
- MUST preserve the exact vessel silhouette, proportions, visual height, visual width, apparent depth, exactly two handles, handle geometry and attachment points, continuous rim, raised base and lower ring, perforation count/distribution/orientation/relative position, white enamel finish, metal details, and coherent reflections.
- MUST show the complete product without clipping or hidden parts.
POSITION_MUST_EXCLUDE_CORRECTION:
- MUST NOT show cutting boards in any plane.
- MUST NOT show jars, containers, or canisters in any plane.
- MUST NOT show plants or decoration in any plane.
- MUST NOT show utensils or appliances in any plane.
- MUST NOT show food, beverages, water, or droplets in any plane.
- MUST NOT show any recognizable background object.
- MUST NOT show any person, face, torso, jewelry, watch, bracelet, ring, conspicuous nails, text, new logo, or watermark.
- Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product.
- MUST NOT show deformed, duplicated, asymmetric, or displaced handles.
- MUST NOT add, remove, close, or reorder perforations.
- MUST NOT show an irregular or discontinuous rim.
- MUST NOT widen, narrow, twist, or separate the base.
- MUST NOT change color, material, texture, volume, or proportion.
- MUST NOT creatively reconstruct the product.
$p6_correction$ as final_prompt
  from hashed
), final as (
  select effective.*,final_contract::text as final_contract_text,
    encode(extensions.digest(convert_to(final_contract::text,'UTF8'),'sha256'),'hex') as final_contract_hash,
    encode(extensions.digest(convert_to(final_prompt,'UTF8'),'sha256'),'hex') as final_prompt_hash
  from effective
)
insert into public.ebay_reference_guided_position_6_correction_amendments(
  attempt_id,revision_id,base_plan_id,base_plan_hash,position,asset_role,
  prior_amendment_id,prior_amendment_hash,prior_effective_contract_hash,
  prior_effective_prompt_hash,rejected_verdict_event_id,rejected_output_sha256,
  amendment_type,amendment_text,amendment_hash,final_effective_contract_text,
  final_effective_contract_hash,final_effective_prompt_text,
  final_effective_prompt_hash,must_include,must_exclude,status,created_by
)
select attempt_id,revision_id,base_plan_id,base_plan_hash,6,
  'SECONDARY_HUMAN_CONTEXT',prior_amendment_id,prior_amendment_hash,
  prior_effective_contract_hash,prior_effective_prompt_hash,
  rejected_verdict_event_id,rejected_output_sha256,
  'EMPTY_BACKGROUND_HUMAN_CONTEXT_FIX',amendment_text,amendment_hash,
  final_contract_text,final_contract_hash,final_prompt,final_prompt_hash,
  must_include,must_exclude,'ACTIVE',created_by
from final
on conflict (prior_amendment_id,amendment_type) do nothing;

do $validate_position_6_final$
declare v public.ebay_reference_guided_position_6_correction_amendments%rowtype;
begin
  select * into v from public.ebay_reference_guided_position_6_correction_amendments
  where prior_amendment_id = '3bbe555c-6452-46c0-a6ad-8443207e1890'::uuid
    and amendment_type = 'EMPTY_BACKGROUND_HUMAN_CONTEXT_FIX';
  if not found
    or v.prior_amendment_hash <> 'd9aed20d4a22b109a2093da86d29c1b46bf461927b50c9891d80aee0b381d204'
    or v.prior_effective_contract_hash <> '180408823f7544477176bebf70fc14fc610fd755bc85d117c3792eb15945b144'
    or v.prior_effective_prompt_hash <> '27d40d2330ad3f33ca88ffde19b20021d5f91ef9d16105c0626a71153d3aaa52'
    or v.amendment_hash <> encode(extensions.digest(convert_to(v.amendment_text,'UTF8'),'sha256'),'hex')
    or v.final_effective_contract_hash <> encode(extensions.digest(convert_to(v.final_effective_contract_text,'UTF8'),'sha256'),'hex')
    or v.final_effective_prompt_hash <> encode(extensions.digest(convert_to(v.final_effective_prompt_text,'UTF8'),'sha256'),'hex')
    or v.final_effective_prompt_text not like '%MUST show exactly two real adult hands.%'
    or v.final_effective_prompt_text not like '%holding only the left handle.%'
    or v.final_effective_prompt_text not like '%holding only the right handle.%'
    or v.final_effective_prompt_text not like '%exact product empty, complete, centered%'
    or v.final_effective_prompt_text not like '%background that is completely empty.%'
    or v.final_effective_prompt_text not like '%MUST NOT show cutting boards in any plane.%'
    or v.final_effective_prompt_text not like '%MUST NOT show jars, containers, or canisters in any plane.%'
    or v.final_effective_prompt_text not like '%MUST NOT show plants or decoration in any plane.%'
    or v.final_effective_prompt_text not like '%MUST NOT show utensils or appliances in any plane.%'
    or v.final_effective_prompt_text not like '%MUST NOT show any recognizable background object.%'
    or v.final_effective_prompt_text not like '%Do not deform, warp, stretch, compress, widen, narrow, rotate, duplicate, remove, relocate or redesign any part of the product.%' then
    raise exception 'POSITION_6_FINAL_EMPTY_BACKGROUND_CONTRACT_INVALID';
  end if;
end;
$validate_position_6_final$;

create table if not exists public.ebay_reference_guided_extraordinary_replacement_plans (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  successor_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  successor_plan_hash text not null check (successor_plan_hash ~ '^[0-9a-f]{64}$'),
  plan_type text not null check (plan_type = 'CONTROLLED_TWO_POSITION_REPLACEMENT_V1'),
  positions jsonb not null check (positions = '[4, 6]'::jsonb),
  current_provider_calls integer not null check (current_provider_calls = 6),
  max_extra_calls integer not null check (max_extra_calls = 2),
  absolute_cap integer not null check (absolute_cap = 8),
  max_concurrency integer not null check (max_concurrency = 1),
  automatic_retries boolean not null check (not automatic_retries),
  requires_separate_human_authorization boolean not null check (requires_separate_human_authorization),
  human_checkpoint_between_calls boolean not null check (human_checkpoint_between_calls),
  feature_flags_enabled boolean not null check (not feature_flags_enabled),
  plan_text text not null,
  plan_hash text not null unique check (plan_hash ~ '^[0-9a-f]{64}$'),
  passed_assets_snapshot jsonb not null,
  status text not null check (status = 'AWAITING_POSITION_4_HUMAN_AUTHORIZATION'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(attempt_id,plan_type)
);

create table if not exists public.ebay_reference_guided_extraordinary_replacement_positions (
  id uuid primary key default gen_random_uuid(),
  correction_plan_id uuid not null references public.ebay_reference_guided_extraordinary_replacement_plans(id),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  position integer not null check (position in (4,6)),
  asset_role text not null,
  extraordinary_ordinal integer not null check (extraordinary_ordinal in (7,8)),
  amendment_id uuid not null,
  amendment_hash text not null check (amendment_hash ~ '^[0-9a-f]{64}$'),
  final_effective_contract_hash text not null check (final_effective_contract_hash ~ '^[0-9a-f]{64}$'),
  final_effective_prompt_text text not null,
  final_effective_prompt_hash text not null check (final_effective_prompt_hash ~ '^[0-9a-f]{64}$'),
  rejected_output_sha256 text not null check (rejected_output_sha256 ~ '^[0-9a-f]{64}$'),
  authorization_state text not null,
  requires_position_4_passed boolean not null,
  created_at timestamptz not null default now(),
  unique(correction_plan_id,position),
  unique(correction_plan_id,extraordinary_ordinal),
  check (
    (position=4 and asset_role='SECONDARY_USE_CONTEXT' and extraordinary_ordinal=7
      and authorization_state='READY_FOR_SEPARATE_HUMAN_AUTHORIZATION'
      and not requires_position_4_passed)
    or
    (position=6 and asset_role='SECONDARY_HUMAN_CONTEXT' and extraordinary_ordinal=8
      and authorization_state='BLOCKED_UNTIL_POSITION_4_PASSED'
      and requires_position_4_passed)
  )
);

create table if not exists public.ebay_reference_guided_extraordinary_authorization_events (
  id uuid primary key default gen_random_uuid(),
  correction_plan_id uuid not null references public.ebay_reference_guided_extraordinary_replacement_plans(id),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  position integer not null check (position in (4,6)),
  extraordinary_ordinal integer not null check (extraordinary_ordinal in (7,8)),
  event_type text not null check (event_type = 'AUTHORIZED'),
  human_authorized_by uuid not null references auth.users(id),
  human_confirmation_hash text not null check (human_confirmation_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((position=4 and extraordinary_ordinal=7)
    or (position=6 and extraordinary_ordinal=8)),
  unique(correction_plan_id,position,extraordinary_ordinal)
);

create table if not exists public.ebay_reference_guided_extraordinary_provider_events (
  id uuid primary key default gen_random_uuid(),
  correction_plan_id uuid not null references public.ebay_reference_guided_extraordinary_replacement_plans(id),
  authorization_event_id uuid not null references public.ebay_reference_guided_extraordinary_authorization_events(id),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  position integer not null check (position in (4,6)),
  extraordinary_ordinal integer not null check (extraordinary_ordinal in (7,8)),
  event_type text not null check (event_type in ('CONSUMED','OUTPUT_PERSISTED','FAILED_FINAL')),
  consumed_event_id uuid null references public.ebay_reference_guided_extraordinary_provider_events(id),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((position=4 and extraordinary_ordinal=7)
    or (position=6 and extraordinary_ordinal=8)),
  check ((event_type='CONSUMED' and consumed_event_id is null)
    or (event_type<>'CONSUMED' and consumed_event_id is not null)),
  unique(authorization_event_id,event_type)
);
create unique index if not exists ebay_reference_guided_extraordinary_ordinal_consumed_once
  on public.ebay_reference_guided_extraordinary_provider_events(correction_plan_id,extraordinary_ordinal)
  where event_type='CONSUMED';

do $plan_append_only_triggers$
begin
  execute 'drop trigger if exists ebay_reference_guided_extraordinary_plans_append_only on public.ebay_reference_guided_extraordinary_replacement_plans';
  execute 'create trigger ebay_reference_guided_extraordinary_plans_append_only before update or delete on public.ebay_reference_guided_extraordinary_replacement_plans for each row execute function public.prevent_reference_guided_human_evidence_mutation()';
  execute 'drop trigger if exists ebay_reference_guided_extraordinary_positions_append_only on public.ebay_reference_guided_extraordinary_replacement_positions';
  execute 'create trigger ebay_reference_guided_extraordinary_positions_append_only before update or delete on public.ebay_reference_guided_extraordinary_replacement_positions for each row execute function public.prevent_reference_guided_human_evidence_mutation()';
  execute 'drop trigger if exists ebay_reference_guided_extraordinary_authorizations_append_only on public.ebay_reference_guided_extraordinary_authorization_events';
  execute 'create trigger ebay_reference_guided_extraordinary_authorizations_append_only before update or delete on public.ebay_reference_guided_extraordinary_authorization_events for each row execute function public.prevent_reference_guided_human_evidence_mutation()';
  execute 'drop trigger if exists ebay_reference_guided_extraordinary_provider_append_only on public.ebay_reference_guided_extraordinary_provider_events';
  execute 'create trigger ebay_reference_guided_extraordinary_provider_append_only before update or delete on public.ebay_reference_guided_extraordinary_provider_events for each row execute function public.prevent_reference_guided_human_evidence_mutation()';
end;
$plan_append_only_triggers$;

alter table public.ebay_reference_guided_extraordinary_replacement_plans enable row level security;
alter table public.ebay_reference_guided_extraordinary_replacement_plans force row level security;
alter table public.ebay_reference_guided_extraordinary_replacement_positions enable row level security;
alter table public.ebay_reference_guided_extraordinary_replacement_positions force row level security;
alter table public.ebay_reference_guided_extraordinary_authorization_events enable row level security;
alter table public.ebay_reference_guided_extraordinary_authorization_events force row level security;
alter table public.ebay_reference_guided_extraordinary_provider_events enable row level security;
alter table public.ebay_reference_guided_extraordinary_provider_events force row level security;
revoke all on table public.ebay_reference_guided_extraordinary_replacement_plans from public,anon,authenticated,service_role;
revoke all on table public.ebay_reference_guided_extraordinary_replacement_positions from public,anon,authenticated,service_role;
revoke all on table public.ebay_reference_guided_extraordinary_authorization_events from public,anon,authenticated,service_role;
revoke all on table public.ebay_reference_guided_extraordinary_provider_events from public,anon,authenticated,service_role;
grant select,insert on table public.ebay_reference_guided_extraordinary_replacement_plans to service_role;
grant select,insert on table public.ebay_reference_guided_extraordinary_replacement_positions to service_role;
grant select,insert on table public.ebay_reference_guided_extraordinary_authorization_events to service_role;
grant select,insert on table public.ebay_reference_guided_extraordinary_provider_events to service_role;

with source as (
  select plan.attempt_id,plan.revision_id,plan.id as successor_plan_id,
    plan.plan_hash as successor_plan_hash,plan.created_by,
    p4.id as position_4_amendment_id,p4.amendment_hash as position_4_amendment_hash,
    p4.final_effective_contract_hash as position_4_contract_hash,
    p4.final_effective_prompt_hash as position_4_prompt_hash,
    p4.rejected_output_sha256 as position_4_rejected_sha,
    p6.id as position_6_amendment_id,p6.amendment_hash as position_6_amendment_hash,
    p6.final_effective_contract_hash as position_6_contract_hash,
    p6.final_effective_prompt_hash as position_6_prompt_hash,
    p6.rejected_output_sha256 as position_6_rejected_sha,
    jsonb_build_object(
      'primaryMain',jsonb_build_object('status',selection.primary_verdict,'sha256',selection.primary_sha256),
      'materialDetail',jsonb_build_object('status',selection.material_detail_verdict,'sha256',selection.material_detail_sha256),
      'position2',jsonb_build_object('status',j2.status,'sha256',j2.output_sha256),
      'position3',jsonb_build_object('status',j3.status,'sha256',j3.output_sha256),
      'position5',jsonb_build_object('status',j5.status,'sha256',j5.output_sha256)
    ) as passed_assets_snapshot
  from public.ebay_reference_guided_batch_plan_successors_v2 plan
  join public.ebay_reference_guided_position_4_fidelity_amendments p4
    on p4.base_plan_id=plan.id and p4.status='ACTIVE'
  join public.ebay_reference_guided_position_6_correction_amendments p6
    on p6.base_plan_id=plan.id and p6.status='ACTIVE'
  join public.ebay_reference_guided_final_asset_selection_events selection
    on selection.attempt_id=plan.attempt_id
  join public.ebay_reference_guided_generation_jobs j2 on j2.generation_attempt_id=plan.attempt_id and j2.position=2
  join public.ebay_reference_guided_generation_jobs j3 on j3.generation_attempt_id=plan.attempt_id and j3.position=3
  join public.ebay_reference_guided_generation_jobs j5 on j5.generation_attempt_id=plan.attempt_id and j5.position=5
  join public.ebay_reference_guided_generation_jobs j4 on j4.generation_attempt_id=plan.attempt_id and j4.position=4
  join public.ebay_reference_guided_generation_jobs j6 on j6.generation_attempt_id=plan.attempt_id and j6.position=6
  join public.ebay_reference_guided_generation_attempts a on a.id=plan.attempt_id
  where plan.id='c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    and plan.plan_hash='a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    and a.provider_calls=6 and a.max_provider_calls=6 and not a.retry_consumed
    and a.ebay_writes=0 and not a.production_changed
    and selection.primary_verdict='APPROVED' and selection.material_detail_verdict='APPROVED'
    and j2.status='PASSED' and j3.status='PASSED' and j5.status='PASSED'
    and j4.status='BLOCKED_FIDELITY' and j4.output_sha256=p4.rejected_output_sha256
    and j6.status='BLOCKED_FIDELITY' and j6.output_sha256=p6.rejected_output_sha256
    and not exists(select 1 from public.ebay_reference_guided_generation_jobs active
      where active.generation_attempt_id=a.id and (active.lease_owner is not null or active.lease_expires_at is not null))
    and not exists(select 1 from public.ebay_reference_guided_successor_provider_events consumed
      where consumed.attempt_id=a.id and consumed.event_type='CONSUMED'
      and not exists(select 1 from public.ebay_reference_guided_successor_provider_events terminal
        where terminal.authorization_event_id=consumed.authorization_event_id
          and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL')))
), manifest as (
  select source.*,jsonb_build_object(
    'version','CONTROLLED_TWO_POSITION_REPLACEMENT_V1_2026_07_22',
    'planType','CONTROLLED_TWO_POSITION_REPLACEMENT_V1',
    'attemptId',attempt_id,'successorPlanId',successor_plan_id,
    'successorPlanHash',successor_plan_hash,'positions',jsonb_build_array(4,6),
    'currentProviderCalls',6,'maxExtraCalls',2,'absoluteCap',8,
    'maxConcurrency',1,'automaticRetries',false,
    'requiresSeparateHumanAuthorization',true,'humanCheckpointBetweenCalls',true,
    'featureFlagsEnabled',false,
    'position4',jsonb_build_object('ordinal',7,'amendmentId',position_4_amendment_id,
      'amendmentHash',position_4_amendment_hash,'finalContractHash',position_4_contract_hash,
      'finalPromptHash',position_4_prompt_hash,'rejectedOutputSha256',position_4_rejected_sha),
    'position6',jsonb_build_object('ordinal',8,'amendmentId',position_6_amendment_id,
      'amendmentHash',position_6_amendment_hash,'finalContractHash',position_6_contract_hash,
      'finalPromptHash',position_6_prompt_hash,'rejectedOutputSha256',position_6_rejected_sha,
      'blockedUntilPosition4Passed',true),
    'passedAssetsSnapshot',passed_assets_snapshot
  ) as plan_manifest
  from source
), final as (
  select manifest.*,plan_manifest::text as plan_text,
    encode(extensions.digest(convert_to(plan_manifest::text,'UTF8'),'sha256'),'hex') as plan_hash
  from manifest
)
insert into public.ebay_reference_guided_extraordinary_replacement_plans(
  attempt_id,revision_id,successor_plan_id,successor_plan_hash,plan_type,
  positions,current_provider_calls,max_extra_calls,absolute_cap,max_concurrency,
  automatic_retries,requires_separate_human_authorization,
  human_checkpoint_between_calls,feature_flags_enabled,plan_text,plan_hash,
  passed_assets_snapshot,status,created_by
)
select attempt_id,revision_id,successor_plan_id,successor_plan_hash,
  'CONTROLLED_TWO_POSITION_REPLACEMENT_V1','[4,6]'::jsonb,6,2,8,1,false,
  true,true,false,plan_text,plan_hash,passed_assets_snapshot,
  'AWAITING_POSITION_4_HUMAN_AUTHORIZATION',created_by
from final
on conflict(attempt_id,plan_type) do nothing;

insert into public.ebay_reference_guided_extraordinary_replacement_positions(
  correction_plan_id,attempt_id,position,asset_role,extraordinary_ordinal,
  amendment_id,amendment_hash,final_effective_contract_hash,
  final_effective_prompt_text,final_effective_prompt_hash,rejected_output_sha256,
  authorization_state,requires_position_4_passed
)
select plan.id,plan.attempt_id,4,'SECONDARY_USE_CONTEXT',7,p4.id,
  p4.amendment_hash,p4.final_effective_contract_hash,
  p4.final_effective_prompt_text,p4.final_effective_prompt_hash,
  p4.rejected_output_sha256,'READY_FOR_SEPARATE_HUMAN_AUTHORIZATION',false
from public.ebay_reference_guided_extraordinary_replacement_plans plan
join public.ebay_reference_guided_position_4_fidelity_amendments p4
  on p4.attempt_id=plan.attempt_id and p4.status='ACTIVE'
where plan.attempt_id='f166b395-8d3a-4921-b273-1a62a6032707'::uuid
on conflict(correction_plan_id,position) do nothing;

insert into public.ebay_reference_guided_extraordinary_replacement_positions(
  correction_plan_id,attempt_id,position,asset_role,extraordinary_ordinal,
  amendment_id,amendment_hash,final_effective_contract_hash,
  final_effective_prompt_text,final_effective_prompt_hash,rejected_output_sha256,
  authorization_state,requires_position_4_passed
)
select plan.id,plan.attempt_id,6,'SECONDARY_HUMAN_CONTEXT',8,p6.id,
  p6.amendment_hash,p6.final_effective_contract_hash,
  p6.final_effective_prompt_text,p6.final_effective_prompt_hash,
  p6.rejected_output_sha256,'BLOCKED_UNTIL_POSITION_4_PASSED',true
from public.ebay_reference_guided_extraordinary_replacement_plans plan
join public.ebay_reference_guided_position_6_correction_amendments p6
  on p6.attempt_id=plan.attempt_id and p6.status='ACTIVE'
where plan.attempt_id='f166b395-8d3a-4921-b273-1a62a6032707'::uuid
on conflict(correction_plan_id,position) do nothing;

create or replace function public.authorize_ebay_reference_guided_extraordinary_replacement(
  p_attempt_id uuid,p_position integer,p_human_authorized_by uuid
) returns table(authorization_id uuid,authorized_position integer,
  extraordinary_ordinal integer,reused boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_plan public.ebay_reference_guided_extraordinary_replacement_plans%rowtype;
  v_position public.ebay_reference_guided_extraordinary_replacement_positions%rowtype;
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_existing public.ebay_reference_guided_extraordinary_authorization_events%rowtype;
  v_id uuid;
begin
  if p_attempt_id<>'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or p_position not in (4,6) then
    raise exception 'EXTRAORDINARY_REPLACEMENT_AUTHORIZATION_SCOPE_INVALID';
  end if;
  select * into v_plan from public.ebay_reference_guided_extraordinary_replacement_plans
    where attempt_id=p_attempt_id and plan_type='CONTROLLED_TWO_POSITION_REPLACEMENT_V1' for share;
  select * into v_position from public.ebay_reference_guided_extraordinary_replacement_positions
    where correction_plan_id=v_plan.id and position=p_position for share;
  select * into v_attempt from public.ebay_reference_guided_generation_attempts
    where id=p_attempt_id for update;
  if v_plan.id is null or v_position.id is null or v_attempt.id is null
    or p_human_authorized_by is distinct from v_plan.created_by
    or v_plan.plan_hash<>encode(extensions.digest(convert_to(v_plan.plan_text,'UTF8'),'sha256'),'hex')
    or v_attempt.provider_calls<>(case when p_position=4 then 6 else 7 end)
    or v_attempt.ebay_writes<>0 or v_attempt.production_changed or v_attempt.retry_consumed
    or exists(select 1 from public.ebay_reference_guided_generation_jobs j
      where j.generation_attempt_id=p_attempt_id and (j.lease_owner is not null or j.lease_expires_at is not null))
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events e
      where e.correction_plan_id=v_plan.id and e.event_type='CONSUMED'
        and not exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events t
          where t.consumed_event_id=e.id and t.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL'))) then
    raise exception 'EXTRAORDINARY_REPLACEMENT_AUTHORIZATION_GATE_INVALID';
  end if;
  if p_position=4 and not exists(select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id=p_attempt_id and position=4 and status='BLOCKED_FIDELITY'
        and output_sha256=v_position.rejected_output_sha256) then
    raise exception 'EXTRAORDINARY_POSITION_4_NOT_READY';
  end if;
  if p_position=6 and (not exists(select 1
      from public.ebay_reference_guided_generation_jobs j4
      where j4.generation_attempt_id=p_attempt_id and j4.position=4
        and j4.status='PASSED'
        and j4.output_sha256<>(select p4.rejected_output_sha256
          from public.ebay_reference_guided_extraordinary_replacement_positions p4
          where p4.correction_plan_id=v_plan.id and p4.position=4)
        and exists(select 1 from public.ebay_reference_guided_asset_review_events review
          where review.attempt_id=p_attempt_id and review.asset_ordinal=4
            and review.preview_sha256=j4.output_sha256
            and review.decision='APPROVED'))
    or not exists(select 1 from public.ebay_reference_guided_extraordinary_authorization_events
      where correction_plan_id=v_plan.id and position=4 and extraordinary_ordinal=7)
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs
      where generation_attempt_id=p_attempt_id and position=6 and status='BLOCKED_FIDELITY'
        and output_sha256=v_position.rejected_output_sha256)) then
    raise exception 'EXTRAORDINARY_POSITION_6_BLOCKED_UNTIL_POSITION_4_PASSED';
  end if;
  select * into v_existing from public.ebay_reference_guided_extraordinary_authorization_events
    where correction_plan_id=v_plan.id and position=p_position
      and extraordinary_ordinal=v_position.extraordinary_ordinal;
  if found then return query select v_existing.id,p_position,v_position.extraordinary_ordinal,true; return; end if;
  insert into public.ebay_reference_guided_extraordinary_authorization_events(
    correction_plan_id,attempt_id,position,extraordinary_ordinal,event_type,
    human_authorized_by,human_confirmation_hash
  ) values(v_plan.id,p_attempt_id,p_position,v_position.extraordinary_ordinal,
    'AUTHORIZED',p_human_authorized_by,encode(extensions.digest(convert_to(
      v_plan.plan_hash||'|'||p_position::text||'|'||v_position.extraordinary_ordinal::text||'|'||p_human_authorized_by::text,
      'UTF8'),'sha256'),'hex')) returning id into v_id;
  return query select v_id,p_position,v_position.extraordinary_ordinal,false;
end;
$$;

revoke all on function public.authorize_ebay_reference_guided_extraordinary_replacement(uuid,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.authorize_ebay_reference_guided_extraordinary_replacement(uuid,integer,uuid)
  to service_role;

do $validate_extraordinary_plan$
declare
  v_plan public.ebay_reference_guided_extraordinary_replacement_plans%rowtype;
  v_p4 public.ebay_reference_guided_extraordinary_replacement_positions%rowtype;
  v_p6 public.ebay_reference_guided_extraordinary_replacement_positions%rowtype;
begin
  select * into v_plan from public.ebay_reference_guided_extraordinary_replacement_plans
    where attempt_id='f166b395-8d3a-4921-b273-1a62a6032707'::uuid
      and plan_type='CONTROLLED_TWO_POSITION_REPLACEMENT_V1';
  select * into v_p4 from public.ebay_reference_guided_extraordinary_replacement_positions
    where correction_plan_id=v_plan.id and position=4;
  select * into v_p6 from public.ebay_reference_guided_extraordinary_replacement_positions
    where correction_plan_id=v_plan.id and position=6;
  if v_plan.id is null or v_p4.id is null or v_p6.id is null
    or v_plan.plan_hash<>encode(extensions.digest(convert_to(v_plan.plan_text,'UTF8'),'sha256'),'hex')
    or v_plan.current_provider_calls<>6 or v_plan.max_extra_calls<>2
    or v_plan.absolute_cap<>8 or v_plan.max_concurrency<>1
    or v_plan.automatic_retries or not v_plan.human_checkpoint_between_calls
    or v_plan.feature_flags_enabled
    or v_p4.extraordinary_ordinal<>7 or v_p4.authorization_state<>'READY_FOR_SEPARATE_HUMAN_AUTHORIZATION'
    or v_p6.extraordinary_ordinal<>8 or v_p6.authorization_state<>'BLOCKED_UNTIL_POSITION_4_PASSED'
    or not v_p6.requires_position_4_passed
    or v_p4.final_effective_prompt_hash<>encode(extensions.digest(convert_to(v_p4.final_effective_prompt_text,'UTF8'),'sha256'),'hex')
    or v_p6.final_effective_prompt_hash<>encode(extensions.digest(convert_to(v_p6.final_effective_prompt_text,'UTF8'),'sha256'),'hex')
    or exists(select 1 from public.ebay_reference_guided_extraordinary_authorization_events where correction_plan_id=v_plan.id)
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events where correction_plan_id=v_plan.id)
    or exists(select 1 from public.ebay_reference_guided_generation_jobs where generation_attempt_id=v_plan.attempt_id and (lease_owner is not null or lease_expires_at is not null))
    or (select provider_calls from public.ebay_reference_guided_generation_attempts where id=v_plan.attempt_id)<>6 then
    raise exception 'EXTRAORDINARY_REPLACEMENT_PLAN_INVALID';
  end if;
end;
$validate_extraordinary_plan$;

notify pgrst,'reload schema';
