-- Second append-only amendment for position 4. It chains to the no-hands
-- amendment, supersedes the running-water clause, and grants no execution.
create table if not exists public.ebay_reference_guided_position_4_correction_amendments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  base_plan_id uuid not null references public.ebay_reference_guided_batch_plan_successors_v2(id),
  base_plan_hash text not null check (base_plan_hash ~ '^[0-9a-f]{64}$'),
  position integer not null check (position = 4),
  asset_role text not null check (asset_role = 'SECONDARY_USE_CONTEXT'),
  prior_amendment_id uuid not null references public.ebay_reference_guided_position_contract_amendments(id),
  prior_amendment_hash text not null check (prior_amendment_hash ~ '^[0-9a-f]{64}$'),
  amendment_type text not null check (
    amendment_type = 'WATER_FLOW_RESTRAINT_AND_IDENTITY_FIX'
  ),
  amendment_reason text not null check (
    amendment_reason = 'REJECTED_OVERDRAMATIC_DRAINAGE_AND_IDENTITY_UNCERTAINTY'
  ),
  rejected_verdict_event_id uuid not null references public.ebay_reference_guided_position_4_human_verdict_events(id),
  rejected_output_sha256 text not null check (rejected_output_sha256 ~ '^[0-9a-f]{64}$'),
  superseded_clause text not null check (superseded_clause = 'RUNNING_WATER_REQUIREMENT'),
  amendment_text text not null,
  amendment_hash text not null unique check (amendment_hash ~ '^[0-9a-f]{64}$'),
  chained_effective_contract_text text not null,
  chained_effective_contract_hash text not null unique check (
    chained_effective_contract_hash ~ '^[0-9a-f]{64}$'
  ),
  chained_effective_prompt_text text not null,
  chained_effective_prompt_hash text not null unique check (
    chained_effective_prompt_hash ~ '^[0-9a-f]{64}$'
  ),
  status text not null check (status = 'ACTIVE'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(prior_amendment_id, amendment_type)
);

drop trigger if exists ebay_reference_guided_position_4_correction_append_only
  on public.ebay_reference_guided_position_4_correction_amendments;
create trigger ebay_reference_guided_position_4_correction_append_only
before update or delete
  on public.ebay_reference_guided_position_4_correction_amendments
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_position_4_correction_amendments
  enable row level security;
alter table public.ebay_reference_guided_position_4_correction_amendments
  force row level security;
revoke all on table public.ebay_reference_guided_position_4_correction_amendments
  from public, anon, authenticated, service_role;
grant select, insert
  on table public.ebay_reference_guided_position_4_correction_amendments
  to service_role;

with base as (
  select plan.id as base_plan_id, plan.plan_hash as base_plan_hash,
    plan.attempt_id, plan.revision_id, plan.created_by,
    prior.id as prior_amendment_id, prior.amendment_hash as prior_amendment_hash,
    prior.effective_position_contract_hash as prior_contract_hash,
    prior.effective_position_contract_text::jsonb as prior_contract,
    prior.effective_prompt_hash as prior_prompt_hash,
    prior.effective_prompt_text as prior_prompt_text,
    verdict.id as rejected_verdict_event_id,
    verdict.output_sha256 as rejected_output_sha256
  from public.ebay_reference_guided_batch_plan_successors_v2 plan
  join public.ebay_reference_guided_position_contract_amendments prior
    on prior.base_plan_id = plan.id and prior.position = 4
    and prior.amendment_type = 'POSITION_CONTRACT_DISTINCTNESS_FIX'
    and prior.status = 'ACTIVE'
  join public.ebay_reference_guided_position_4_human_verdict_events verdict
    on verdict.attempt_id = plan.attempt_id and verdict.position = 4
    and verdict.human_verdict = 'REJECTED'
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
    and prior.id = '5fdc0614-8467-4d0c-97e9-9fc4c99828f7'::uuid
    and prior.amendment_hash =
      'd360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747'
    and prior.amendment_hash = encode(extensions.digest(
      convert_to(prior.amendment_text, 'UTF8'), 'sha256'), 'hex')
    and prior.effective_prompt_hash = encode(extensions.digest(
      convert_to(prior.effective_prompt_text, 'UTF8'), 'sha256'), 'hex')
    and prior.effective_position_contract_hash = encode(extensions.digest(
      convert_to(prior.effective_position_contract_text, 'UTF8'),
      'sha256'), 'hex')
    and verdict.verdict_reason =
      'OVERDRAMATIC_DRAINAGE_FLOW_AND_PRODUCT_IDENTITY_UNCERTAIN'
    and verdict.output_sha256 =
      '988304aedd2ce2c7ebcd505a5e812a930d550be99a5f8fb2d2b7e61561c5d123'
    and verdict.output_preserved and not verdict.reassigned
    and not verdict.replacement_authorized
    and a.provider_calls = 5 and a.max_provider_calls = 6
    and not a.retry_consumed and a.ebay_writes = 0
    and not a.production_changed
    and j4.status = 'BLOCKED_FIDELITY'
    and j4.output_sha256 = verdict.output_sha256
    and j4.output_storage_path = verdict.output_storage_path
    and j4.provider_request_id = verdict.provider_request_id
    and j6.status = 'PENDING' and j6.lease_owner is null
    and j6.lease_expires_at is null and j6.provider_request_id is null
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
      select 1 from storage.objects o
      where o.bucket_id = 'ebay-listing-image-staging'
        and o.name = verdict.output_storage_path
        and o.metadata->>'mimetype' = 'image/png'
    )
), amendment as (
  select base.*,
    jsonb_build_object(
      'version','POSITION_4_WATER_IDENTITY_CORRECTION_V1_2026_07_22',
      'basePlanId',base_plan_id,
      'basePlanHash',base_plan_hash,
      'position',4,
      'assetRole','SECONDARY_USE_CONTEXT',
      'priorAmendmentId',prior_amendment_id,
      'priorAmendmentHash',prior_amendment_hash,
      'priorEffectiveContractHash',prior_contract_hash,
      'priorEffectivePromptHash',prior_prompt_hash,
      'amendmentType','WATER_FLOW_RESTRAINT_AND_IDENTITY_FIX',
      'amendmentReason','REJECTED_OVERDRAMATIC_DRAINAGE_AND_IDENTITY_UNCERTAINTY',
      'rejectedOutputSha256',rejected_output_sha256,
      'supersededClause','RUNNING_WATER_REQUIREMENT',
      'resolution','MUST replace every prior visible, running, rinse, stream, or draining-water requirement with the corrected dry-faucet contract.'
    ) as amendment_manifest,
    jsonb_build_array(
      'MUST show a visible faucet that is switched off.',
      'MUST show the exact product with a light, dispersed single layer of exactly 4 to 6 freshly rinsed strawberries.',
      'MUST show only small residual droplets on the strawberries and product.',
      'MUST show zero running water, streams, jets, waterfalls, splashes, or drainage.',
      'MUST show zero water exiting the perforations, bottom, or base.',
      'MUST show no human hands, fingers, arms, people, or human body parts.',
      'MUST show the complete product with both handles, rim, base, and exact perforation pattern clearly visible.',
      'MUST explain ordinary colander context without demonstrating performance.'
    ) as corrected_must_include,
    jsonb_build_array(
      'MUST NOT show running water.',
      'MUST NOT show water streams.',
      'MUST NOT show water exiting perforations.',
      'MUST NOT show water exiting the base.',
      'MUST NOT show waterfalls.',
      'MUST NOT show dramatic splashes.',
      'MUST NOT show mixed or overflowing produce.',
      'MUST NOT alter the perforation pattern.',
      'MUST NOT alter the base geometry.',
      'MUST NOT show foods other than exactly 4 to 6 strawberries, utensils, or props.',
      'MUST NOT add text, new logos, badges, measurements, watermarks, or claims.'
    ) as corrected_must_exclude
  from base
), amendment_hashed as (
  select amendment.*,
    amendment_manifest::text as amendment_text,
    encode(extensions.digest(convert_to(
      amendment_manifest::text, 'UTF8'), 'sha256'), 'hex') as amendment_hash
  from amendment
), chained as (
  select amendment_hashed.*,
    prior_contract || jsonb_build_object(
      'version','POSITION_4_CHAINED_EFFECTIVE_CONTRACT_V2_2026_07_22',
      'priorEffectiveContractHash',prior_contract_hash,
      'correctionAmendmentHash',amendment_hash,
      'supersededClause','RUNNING_WATER_REQUIREMENT',
      'contractResolutionRule','The correction amendment MUST override every earlier running-water or visible-rinse-water clause.',
      'mustInclude',corrected_must_include,
      'mustExclude',(prior_contract->'mustExclude') || corrected_must_exclude,
      'automaticChecks',jsonb_build_array(
        'FAIL unless the faucet is visible and switched off.',
        'FAIL unless exactly 4 to 6 strawberries form one light dispersed layer.',
        'FAIL if any running water, stream, jet, waterfall, dramatic splash, or water exiting perforations, bottom, or base is visible.',
        'FAIL if produce is mixed, excessive, or overflowing.',
        'FAIL if the exact perforation pattern or base geometry cannot be confirmed.',
        'FAIL if any human part, other food, utensil, prop, text, new logo, or claim appears.'
      ),
      'humanChecks',jsonb_build_array(
        'MUST confirm the exact complete product, both handles, rim, base, and perforation pattern.',
        'MUST confirm faucet off, exactly 4 to 6 dispersed strawberries, residual droplets only, and no performance reading.'
      )
    ) as chained_contract_manifest,
    replace(replace(replace(replace(replace(replace(replace(
      prior_prompt_text,
      'MUST show gentle rinse water without dramatic splashing.',
      'MUST show a visible faucet that is switched off, with only small residual droplets on the product and strawberries.'),
      'MUST frame the full product during an ordinary gentle rinse with the use action immediately understandable.',
      'MUST frame the complete product beside a visible switched-off faucet; context is communicated by freshly rinsed strawberries and residual droplets only.'),
      'MUST treat all fruit, vegetables, water, and kitchen surroundings as non-included scene context.',
      'MUST treat exactly 4 to 6 strawberries, residual droplets, the switched-off faucet, and kitchen surroundings as non-included scene context.'),
      'MUST detect moderate generic produce inside the product and gentle visible rinse water.',
      'MUST detect exactly 4 to 6 strawberries in one light dispersed layer, a switched-off faucet, and residual droplets only.'),
      'MUST confirm unmistakable ordinary colander use, moderate produce, gentle rinse water, and complete product visibility.',
      'MUST confirm the complete product, exactly 4 to 6 dispersed strawberries, a switched-off faucet, residual droplets only, and no drainage-performance reading.'),
      'MUST show the exact complete product under a gentle stream of water.',
      'MUST show the exact complete product beside a visible faucet that is switched off.'),
      'MUST place a moderate quantity of generic fruit or vegetables inside the product.',
      'MUST place exactly 4 to 6 freshly rinsed strawberries in one light dispersed layer inside the product.')
      || E'\n\n' || $correction$
POSITION_4_CORRECTION_AMENDMENT=WATER_FLOW_RESTRAINT_AND_IDENTITY_FIX
SUPERSEDED_CLAUSE=RUNNING_WATER_REQUIREMENT
CONTRACT_RESOLUTION=This correction MUST override every earlier instruction that requests visible, running, rinse, stream, exiting, or draining water.
POSITION_MUST_INCLUDE_CORRECTION:
- MUST show a visible faucet that is switched off.
- MUST show the exact product with a light dispersed single layer of exactly 4 to 6 freshly rinsed strawberries.
- MUST show only small residual droplets on the strawberries and product.
- MUST show zero currents, streams, jets, waterfalls, splashes, or drainage.
- MUST show zero water exiting perforations, bottom, or base.
- MUST show no human hands, fingers, arms, people, or human body parts.
- MUST show the complete product with both handles, rim, base, and exact perforation pattern clearly visible.
- MUST explain context without demonstrating performance.
POSITION_MUST_EXCLUDE_CORRECTION=running water; water streams; water exiting perforations; water exiting the base; waterfalls; dramatic splashes; mixed or overflowing produce; altered perforation pattern; altered base geometry; other foods; utensils; props; text; new logos; badges; measurements; watermarks; claims.
$correction$ as chained_prompt_text
  from amendment_hashed
), final as (
  select chained.*,
    chained_contract_manifest::text as chained_contract_text,
    encode(extensions.digest(convert_to(
      chained_contract_manifest::text, 'UTF8'), 'sha256'), 'hex')
      as chained_contract_hash,
    encode(extensions.digest(convert_to(
      chained_prompt_text, 'UTF8'), 'sha256'), 'hex')
      as chained_prompt_hash
  from chained
)
insert into public.ebay_reference_guided_position_4_correction_amendments(
  attempt_id, revision_id, base_plan_id, base_plan_hash, position, asset_role,
  prior_amendment_id, prior_amendment_hash, amendment_type, amendment_reason,
  rejected_verdict_event_id, rejected_output_sha256, superseded_clause,
  amendment_text, amendment_hash, chained_effective_contract_text,
  chained_effective_contract_hash, chained_effective_prompt_text,
  chained_effective_prompt_hash, status, created_by
)
select attempt_id, revision_id, base_plan_id, base_plan_hash, 4,
  'SECONDARY_USE_CONTEXT', prior_amendment_id, prior_amendment_hash,
  'WATER_FLOW_RESTRAINT_AND_IDENTITY_FIX',
  'REJECTED_OVERDRAMATIC_DRAINAGE_AND_IDENTITY_UNCERTAINTY',
  rejected_verdict_event_id, rejected_output_sha256,
  'RUNNING_WATER_REQUIREMENT', amendment_text, amendment_hash,
  chained_contract_text, chained_contract_hash, chained_prompt_text,
  chained_prompt_hash, 'ACTIVE', created_by
from final
on conflict (prior_amendment_id, amendment_type) do nothing;

do $correction_check$
declare
  v public.ebay_reference_guided_position_4_correction_amendments%rowtype;
  v_contract jsonb;
begin
  select * into v
  from public.ebay_reference_guided_position_4_correction_amendments
  where prior_amendment_id = '5fdc0614-8467-4d0c-97e9-9fc4c99828f7'::uuid
    and amendment_type = 'WATER_FLOW_RESTRAINT_AND_IDENTITY_FIX';
  if not found or v.superseded_clause <> 'RUNNING_WATER_REQUIREMENT'
    or v.amendment_hash <> encode(extensions.digest(
      convert_to(v.amendment_text, 'UTF8'), 'sha256'), 'hex')
    or v.chained_effective_contract_hash <> encode(extensions.digest(
      convert_to(v.chained_effective_contract_text, 'UTF8'), 'sha256'), 'hex')
    or v.chained_effective_prompt_hash <> encode(extensions.digest(
      convert_to(v.chained_effective_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or v.chained_effective_prompt_text like '%MUST show gentle rinse water%'
    or v.chained_effective_prompt_text like '%gentle visible rinse water%'
    or v.chained_effective_prompt_text like '%under a gentle stream of water%'
    or v.chained_effective_prompt_text not like
      '%MUST show a visible faucet that is switched off.%'
    or v.chained_effective_prompt_text not like
      '%exactly 4 to 6 freshly rinsed strawberries%'
    or v.chained_effective_prompt_text not like
      '%MUST show zero water exiting perforations, bottom, or base.%' then
    raise exception 'POSITION_4_CORRECTION_AMENDMENT_INVALID';
  end if;
  begin v_contract := v.chained_effective_contract_text::jsonb;
  exception when others then
    raise exception 'POSITION_4_CHAINED_CONTRACT_JSON_INVALID';
  end;
  if v_contract->>'correctionAmendmentHash' <> v.amendment_hash
    or v_contract->>'supersededClause' <> 'RUNNING_WATER_REQUIREMENT'
    or not (v_contract->'mustExclude' @> jsonb_build_array(
      'MUST NOT show running water.',
      'MUST NOT show water streams.',
      'MUST NOT show water exiting perforations.',
      'MUST NOT show water exiting the base.',
      'MUST NOT show waterfalls.',
      'MUST NOT show dramatic splashes.',
      'MUST NOT show mixed or overflowing produce.',
      'MUST NOT alter the perforation pattern.',
      'MUST NOT alter the base geometry.'
    )) then
    raise exception 'POSITION_4_CHAINED_CONTRACT_CONTENT_INVALID';
  end if;
end;
$correction_check$;

create or replace function public.resolve_ebay_reference_guided_position_4_corrected_contract(
  p_attempt_id uuid
) returns table(
  correction_amendment_id uuid,
  correction_amendment_hash text,
  chained_effective_contract_hash text,
  chained_effective_prompt_text text,
  chained_effective_prompt_hash text,
  superseded_clause text
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.ebay_reference_guided_position_4_correction_amendments%rowtype;
begin
  if p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid then
    raise exception 'POSITION_4_CORRECTION_ATTEMPT_INVALID';
  end if;
  select * into v
  from public.ebay_reference_guided_position_4_correction_amendments
  where attempt_id = p_attempt_id and position = 4 and status = 'ACTIVE'
    and amendment_type = 'WATER_FLOW_RESTRAINT_AND_IDENTITY_FIX'
  for share;
  if not found
    or v.prior_amendment_id <>
      '5fdc0614-8467-4d0c-97e9-9fc4c99828f7'::uuid
    or v.prior_amendment_hash <>
      'd360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747'
    or v.superseded_clause <> 'RUNNING_WATER_REQUIREMENT'
    or v.amendment_hash <> encode(extensions.digest(
      convert_to(v.amendment_text, 'UTF8'), 'sha256'), 'hex')
    or v.chained_effective_contract_hash <> encode(extensions.digest(
      convert_to(v.chained_effective_contract_text, 'UTF8'), 'sha256'), 'hex')
    or v.chained_effective_prompt_hash <> encode(extensions.digest(
      convert_to(v.chained_effective_prompt_text, 'UTF8'), 'sha256'), 'hex')
    or not exists (
      select 1
      from public.ebay_reference_guided_position_4_human_verdict_events h
      join public.ebay_reference_guided_generation_jobs j on j.id = h.job_id
      join public.ebay_reference_guided_generation_attempts a
        on a.id = h.attempt_id
      where h.id = v.rejected_verdict_event_id
        and h.human_verdict = 'REJECTED' and h.output_preserved
        and not h.reassigned and not h.replacement_authorized
        and j.status = 'BLOCKED_FIDELITY'
        and j.output_sha256 = h.output_sha256
        and j.output_storage_path = h.output_storage_path
        and a.provider_calls = 5 and a.ebay_writes = 0
        and not a.production_changed
    ) or exists (
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
    raise exception 'POSITION_4_CORRECTION_STATE_INVALID';
  end if;
  return query select v.id, v.amendment_hash,
    v.chained_effective_contract_hash, v.chained_effective_prompt_text,
    v.chained_effective_prompt_hash, v.superseded_clause;
end;
$$;

revoke all on function public.resolve_ebay_reference_guided_position_4_corrected_contract(
  uuid) from public, anon, authenticated;
grant execute on function public.resolve_ebay_reference_guided_position_4_corrected_contract(
  uuid) to service_role;

notify pgrst, 'reload schema';
