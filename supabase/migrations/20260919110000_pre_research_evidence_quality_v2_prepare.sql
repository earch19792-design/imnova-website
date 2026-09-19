-- PRE_RESEARCH_EVIDENCE_QUALITY_V2_PREPARE
-- Stage 1/2. Quiesces only Luna Pre-Research, preserves every V1 envelope,
-- derives V2 aggregates from durable settled task evidence, and backfills
-- incompatible completed plans without deleting capture/task observations.

do $block$
begin
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'PRE_RESEARCH_V2_DIGEST_AUTHORITY_REQUIRED';
  end if;
end
$block$;

create table if not exists public.seller_os_pre_research_rollout_controls_v1 (
  control_key text primary key,
  rollout_state text not null,
  required_result_contract_version text not null,
  changed_at timestamptz not null,
  constraint seller_os_pre_research_rollout_controls_v1_key_check
    check (control_key = 'LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2'),
  constraint seller_os_pre_research_rollout_controls_v1_state_check
    check (rollout_state in ('QUIESCED_FOR_V2_DEPLOYMENT','ACTIVE_V2')),
  constraint seller_os_pre_research_rollout_controls_v1_contract_check
    check (required_result_contract_version =
      'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19')
);

alter table public.seller_os_pre_research_rollout_controls_v1
  enable row level security;
alter table public.seller_os_pre_research_rollout_controls_v1
  force row level security;
revoke all on table public.seller_os_pre_research_rollout_controls_v1
  from public, anon, authenticated, service_role;
grant select on table public.seller_os_pre_research_rollout_controls_v1
  to service_role;

drop policy if exists seller_os_pre_research_rollout_controls_service_read_v1
  on public.seller_os_pre_research_rollout_controls_v1;
create policy seller_os_pre_research_rollout_controls_service_read_v1
  on public.seller_os_pre_research_rollout_controls_v1
  for select to service_role using (true);

create table if not exists public.seller_os_pre_research_v1_backfills_v2 (
  plan_id uuid primary key references
    public.marketplace_product_research_query_plans(id) on delete restrict,
  marketplace_account_key text not null,
  prior_contract_version text null,
  prior_result text not null,
  prior_trace_eligible boolean not null,
  prior_evidence_digest text null,
  prior_evidence jsonb not null,
  backfill_version text not null,
  recomputed_evidence_digest text not null,
  recomputed_evidence jsonb not null,
  migrated_at timestamptz not null,
  constraint seller_os_pre_research_v1_backfills_v2_version_check
    check (backfill_version =
      'LUNA_PRE_RESEARCH_V1_TO_V2_BACKFILL_2026_09_19'),
  constraint seller_os_pre_research_v1_backfills_v2_digest_check
    check (recomputed_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_pre_research_v1_backfills_v2_evidence_check
    check (jsonb_typeof(prior_evidence) = 'object'
      and jsonb_typeof(recomputed_evidence) = 'object')
);

alter table public.seller_os_pre_research_v1_backfills_v2
  enable row level security;
alter table public.seller_os_pre_research_v1_backfills_v2
  force row level security;
revoke all on table public.seller_os_pre_research_v1_backfills_v2
  from public, anon, authenticated, service_role;
grant select on table public.seller_os_pre_research_v1_backfills_v2
  to service_role;

drop policy if exists seller_os_pre_research_v1_backfills_service_read_v2
  on public.seller_os_pre_research_v1_backfills_v2;
create policy seller_os_pre_research_v1_backfills_service_read_v2
  on public.seller_os_pre_research_v1_backfills_v2
  for select to service_role using (true);

create or replace function public.reject_pre_research_v1_backfill_mutation_v2()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'PRE_RESEARCH_V1_BACKFILL_HISTORY_IMMUTABLE';
end;
$function$;

drop trigger if exists seller_os_pre_research_v1_backfills_immutable_v2
  on public.seller_os_pre_research_v1_backfills_v2;
create trigger seller_os_pre_research_v1_backfills_immutable_v2
before update or delete on public.seller_os_pre_research_v1_backfills_v2
for each row execute function
  public.reject_pre_research_v1_backfill_mutation_v2();

revoke all on function public.reject_pre_research_v1_backfill_mutation_v2()
  from public, anon, authenticated, service_role;

-- One derivation authority is shared by PREPARE and the activated completion
-- RPC. It reads all settled task evidence, deduplicates by eBay Item ID, and
-- never accepts contamination or an unqualified family comparison.
create or replace function public.derive_luna_pre_research_evidence_v2(
  p_plan_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
with evidence_rows as (
  select task.id as task_id,
    task.ordinal as task_ordinal,
    entity.ordinality as entity_ordinal,
    entity.value,
    entity.value ->> 'itemId' as item_id,
    entity.value ->> 'classification' as classification,
    case
      when coalesce(entity.value ->> 'soldQuantity','')
        ~ '^[0-9]+(?:\.[0-9]+)?$'
      then floor((entity.value ->> 'soldQuantity')::numeric)
      else 0::numeric
    end as sold_quantity,
    case when jsonb_typeof(entity.value -> 'classificationReasons') = 'array'
      then entity.value -> 'classificationReasons' else '[]'::jsonb end
      as classification_reasons
  from public.marketplace_product_research_query_tasks task
  cross join lateral jsonb_array_elements(task.commercial_evidence_entities)
    with ordinality entity(value, ordinality)
  where task.plan_id = p_plan_id
    and task.status in ('CAPTURED','PROCESSED','SKIPPED')
), classified as (
  select row.*,
    case
      when row.item_id !~ '^[0-9]{9,20}$' then false
      when row.classification not in ('EXACT_PRODUCT_COMPARABLE',
        'CLOSE_VARIANT_COMPARABLE','CORE_FAMILY_COMPARABLE') then false
      when exists (
        select 1
        from jsonb_array_elements_text(row.classification_reasons) reason(value)
        where upper(reason.value) ~
          '(BRAND|IP)_CONTAMINATION'
          or upper(reason.value) ~
            'PREMIUM_MATERIAL_(CONTAMINATION|MISMATCH)'
          or upper(reason.value) ~ 'PACK.*(DIFFERS|MISMATCH)'
      ) then false
      when row.classification = 'CORE_FAMILY_COMPARABLE'
        and not exists (
          select 1
          from jsonb_array_elements_text(row.classification_reasons) reason(value)
          where upper(reason.value) =
            'PRODUCT_ENTITY_FAMILY_AND_STRUCTURE_MATCH'
        ) then false
      else true
    end as accepted,
    case row.classification
      when 'EXACT_PRODUCT_COMPARABLE' then 5
      when 'CLOSE_VARIANT_COMPARABLE' then 4
      when 'CORE_FAMILY_COMPARABLE' then 3
      when 'ADJACENT_BUT_NOT_COMPARABLE' then 2
      when 'FALSE_POSITIVE' then 1
      else 0
    end as classification_rank
  from evidence_rows row
  where row.item_id ~ '^[0-9]{9,20}$'
), ranked as (
  select classified.*,
    max(sold_quantity) over (partition by item_id) as raw_item_sold_quantity,
    row_number() over (partition by item_id order by accepted desc,
      classification_rank desc, sold_quantity desc, task_ordinal, task_id,
      entity_ordinal) as canonical_ordinal
  from classified
), canonical as (
  select * from ranked where canonical_ordinal = 1
), aggregate as (
  select
    count(*) filter (where accepted
      and classification = 'EXACT_PRODUCT_COMPARABLE')::integer
      as exact_count,
    count(*) filter (where accepted
      and classification = 'CLOSE_VARIANT_COMPARABLE')::integer
      as close_count,
    count(*) filter (where accepted
      and classification = 'CORE_FAMILY_COMPARABLE')::integer
      as family_count,
    count(*) filter (where accepted)::integer as accepted_count,
    coalesce(sum(raw_item_sold_quantity),0)::numeric as raw_sold,
    coalesce(sum(sold_quantity) filter (where accepted),0)::numeric
      as accepted_sold,
    count(*)::integer as observed_count
  from canonical
)
select jsonb_build_object(
  'comparablePolicyVersion',
    'PRODUCT_RESEARCH_ACCEPTED_COMPARABLE_POLICY_V1_2026_09_19',
  'exactComparableCount', exact_count,
  'closeVariantComparableCount', close_count,
  'familyComparableCount', family_count,
  'acceptedComparableCount', accepted_count,
  'rawObservedSoldQuantity', raw_sold,
  'acceptedComparableSoldQuantity', accepted_sold,
  'observedItemCount', observed_count,
  'comparablePrecision', case when observed_count = 0 then 0
    else accepted_count::numeric / observed_count end
)
from aggregate;
$function$;

revoke all on function public.derive_luna_pre_research_evidence_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.derive_luna_pre_research_evidence_v2(uuid)
  to service_role;

-- Drain any earlier writer before freezing Luna Pre-Research. The lock is
-- transaction-scoped and does not block reads or unrelated Product Research
-- after this migration commits.
lock table public.marketplace_product_research_query_plans
  in share row exclusive mode;
lock table public.marketplace_product_research_query_tasks
  in share mode;

do $block$
declare
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_derived jsonb;
  v_next_evidence jsonb;
  v_next_result text;
  v_next_trace boolean;
  v_next_digest text;
  v_migrated_at timestamptz;
begin
  if exists (
    select 1 from public.marketplace_product_research_query_plans plan
    where plan.marketplace = 'EBAY_US'
      and plan.source_context = 'LUNA_PRE_RESEARCH'
      and plan.status = 'ACTIVE'
  ) then
    raise exception 'LUNA_PRE_RESEARCH_ACTIVE_PLAN_PREPARE_BLOCKED';
  end if;

  for v_plan in
    select plan.*
    from public.marketplace_product_research_query_plans plan
    where plan.marketplace = 'EBAY_US'
      and plan.source_context = 'LUNA_PRE_RESEARCH'
      and plan.status = 'COMPLETED'
      and coalesce(plan.pre_research_evidence ->> 'contractVersion','') <>
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
    order by plan.id
    for update
  loop
    if exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = v_plan.id
        and task.status not in ('CAPTURED','PROCESSED','SKIPPED')
    ) then
      raise exception 'LUNA_PRE_RESEARCH_V1_BACKFILL_TASKS_NOT_SETTLED:%',
        v_plan.id;
    end if;

    v_migrated_at := clock_timestamp();
    v_derived := public.derive_luna_pre_research_evidence_v2(v_plan.id);
    v_next_result := case
      when (v_derived ->> 'acceptedComparableCount')::integer = 0
        then 'INSUFFICIENT_MARKET_EVIDENCE'
      when (v_derived ->> 'acceptedComparableSoldQuantity')::numeric <= 0
        then 'PRE_RESEARCH_LOW'
      when (v_derived ->> 'comparablePrecision')::numeric >= 0.5
        then 'PRE_RESEARCH_HIGH'
      else 'PRE_RESEARCH_MEDIUM'
    end;
    v_next_trace := v_next_result in
      ('PRE_RESEARCH_HIGH','PRE_RESEARCH_MEDIUM');
    v_next_evidence := v_plan.pre_research_evidence || v_derived ||
      jsonb_build_object(
        'contractVersion','LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19',
        'result',v_next_result,
        'traceEligible',v_next_trace,
        'backfillLineage',jsonb_build_object(
          'priorContractVersion',
            v_plan.pre_research_evidence ->> 'contractVersion',
          'priorResult',v_plan.pre_research_result,
          'priorEvidenceDigest',v_plan.pre_research_evidence_digest,
          'backfillVersion',
            'LUNA_PRE_RESEARCH_V1_TO_V2_BACKFILL_2026_09_19',
          'migratedAt',v_migrated_at));
    v_next_digest := 'sha256:' || encode(extensions.digest(
      convert_to(v_next_evidence::text,'UTF8'),'sha256'),'hex');

    insert into public.seller_os_pre_research_v1_backfills_v2 (
      plan_id, marketplace_account_key, prior_contract_version,
      prior_result, prior_trace_eligible, prior_evidence_digest,
      prior_evidence, backfill_version, recomputed_evidence_digest,
      recomputed_evidence, migrated_at)
    values (
      v_plan.id, v_plan.marketplace_account_key,
      v_plan.pre_research_evidence ->> 'contractVersion',
      v_plan.pre_research_result, v_plan.pre_research_trace_eligible,
      v_plan.pre_research_evidence_digest, v_plan.pre_research_evidence,
      'LUNA_PRE_RESEARCH_V1_TO_V2_BACKFILL_2026_09_19',
      v_next_digest, v_next_evidence, v_migrated_at)
    on conflict (plan_id) do nothing;

    if not exists (
      select 1 from public.seller_os_pre_research_v1_backfills_v2 history
      where history.plan_id = v_plan.id
        and history.prior_evidence is not distinct from
          v_plan.pre_research_evidence
        and history.recomputed_evidence is not distinct from v_next_evidence
    ) then
      raise exception 'LUNA_PRE_RESEARCH_V1_BACKFILL_IDEMPOTENCY_MISMATCH:%',
        v_plan.id;
    end if;

    update public.marketplace_product_research_query_plans plan
    set pre_research_result = v_next_result,
      pre_research_trace_eligible = v_next_trace,
      pre_research_evidence_digest = v_next_digest,
      pre_research_evidence = v_next_evidence,
      worker_last_result = jsonb_build_object(
        'state',v_next_result,
        'traceEligible',v_next_trace,
        'evidenceDigest',v_next_digest,
        'completedAt',coalesce(v_plan.pre_research_completed_at,
          v_plan.completed_at),
        'backfillVersion',
          'LUNA_PRE_RESEARCH_V1_TO_V2_BACKFILL_2026_09_19'),
      updated_at = greatest(plan.updated_at,v_migrated_at)
    where plan.id = v_plan.id;
  end loop;

  if exists (
    select 1 from public.marketplace_product_research_query_plans plan
    where plan.marketplace = 'EBAY_US'
      and plan.source_context = 'LUNA_PRE_RESEARCH'
      and plan.status = 'COMPLETED'
      and coalesce(plan.pre_research_evidence ->> 'contractVersion','') <>
        'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
  ) then
    raise exception 'LUNA_PRE_RESEARCH_V1_BACKFILL_INCOMPLETE';
  end if;
end
$block$;

insert into public.seller_os_pre_research_rollout_controls_v1 (
  control_key, rollout_state, required_result_contract_version, changed_at)
values ('LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2',
  'QUIESCED_FOR_V2_DEPLOYMENT',
  'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19',clock_timestamp())
on conflict (control_key) do update
set rollout_state = case
    when seller_os_pre_research_rollout_controls_v1.rollout_state = 'ACTIVE_V2'
      then 'ACTIVE_V2' else excluded.rollout_state end,
  required_result_contract_version = excluded.required_result_contract_version,
  changed_at = case
    when seller_os_pre_research_rollout_controls_v1.rollout_state = 'ACTIVE_V2'
      or seller_os_pre_research_rollout_controls_v1.rollout_state =
        excluded.rollout_state
    then seller_os_pre_research_rollout_controls_v1.changed_at
    else excluded.changed_at end;

create or replace function public.guard_luna_pre_research_rollout_v2()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_state text;
begin
  if (case when tg_op = 'INSERT' then new.source_context
      else coalesce(new.source_context,old.source_context) end) <>
      'LUNA_PRE_RESEARCH' then
    return new;
  end if;
  select control.rollout_state into v_state
  from public.seller_os_pre_research_rollout_controls_v1 control
  where control.control_key = 'LUNA_PRE_RESEARCH_EVIDENCE_QUALITY_V2';
  if v_state is distinct from 'ACTIVE_V2' then
    raise exception 'LUNA_PRE_RESEARCH_QUIESCED_FOR_V2_DEPLOYMENT';
  end if;
  return new;
end;
$function$;

drop trigger if exists zz_guard_luna_pre_research_rollout_v2
  on public.marketplace_product_research_query_plans;
create trigger zz_guard_luna_pre_research_rollout_v2
before insert or update on public.marketplace_product_research_query_plans
for each row execute function public.guard_luna_pre_research_rollout_v2();

revoke all on function public.guard_luna_pre_research_rollout_v2()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
