begin;

alter table public.ebay_luna_opportunity_queue
  add column if not exists lane text,
  add column if not exists risk_score numeric(7, 3);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ebay_luna_opportunity_queue_lane_check'
      and conrelid =
        'public.ebay_luna_opportunity_queue'::regclass
  ) then
    alter table public.ebay_luna_opportunity_queue
      add constraint ebay_luna_opportunity_queue_lane_check
      check (
        lane is null
        or lane in (
          'protection',
          'event',
          'hot',
          'baseline',
          'coverage'
        )
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ebay_luna_opportunity_queue_risk_score_check'
      and conrelid =
        'public.ebay_luna_opportunity_queue'::regclass
  ) then
    alter table public.ebay_luna_opportunity_queue
      add constraint ebay_luna_opportunity_queue_risk_score_check
      check (
        risk_score is null
        or risk_score between 0 and 100
      );
  end if;
end;
$$;

update public.ebay_luna_opportunity_queue opportunity
set lane = (
  select task.lane
  from public.ebay_seller_scan_tasks task
  where task.candidate_key = opportunity.candidate_key
  order by task.updated_at desc, task.id desc
  limit 1
)
where opportunity.lane is null
  and exists (
    select 1
    from public.ebay_seller_scan_tasks task
    where task.candidate_key = opportunity.candidate_key
  );

update public.ebay_luna_opportunity_queue
set risk_score = case
  when jsonb_typeof(
    assessment #> '{candidate,restrictionGuards}'
  ) = 'array'
    and jsonb_typeof(
      assessment #> '{taxonomyVerification,hardGuards}'
    ) = 'array'
  then case
    when jsonb_array_length(
      assessment #> '{candidate,restrictionGuards}'
    ) = 0
      and jsonb_array_length(
        assessment #> '{taxonomyVerification,hardGuards}'
      ) = 0
    then 0
    else 100
  end
  else null
end
where risk_score is null;

alter table public.ebay_luna_selector_ranking_snapshots_v2
  add column if not exists research_eligibility_score numeric(7, 3)
    not null default 0,
  add column if not exists consumable_research_boost numeric(7, 3)
    not null default 0,
  add column if not exists eligible_for_research boolean
    not null default false,
  add column if not exists eligible_for_bootstrap_canary boolean
    not null default false,
  add column if not exists selected_for_bootstrap_canary boolean
    not null default false,
  add column if not exists bootstrap_canary_position integer,
  add column if not exists selection_mode text
    not null default 'BLOCKED',
  add column if not exists forced_listing_quantity integer,
  add column if not exists promotion_rate_percent numeric(7, 3)
    not null default 0,
  add column if not exists price_decrease_allowed boolean
    not null default false,
  add column if not exists external_writes_allowed boolean
    not null default false,
  add column if not exists commercial_monitor_required boolean
    not null default false,
  add column if not exists one_variable_at_a_time boolean
    not null default false,
  add column if not exists execution_mode text
    not null default 'SHADOW';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'ebay_luna_selector_v2_bootstrap_canary_contract_check'
      and conrelid =
        'public.ebay_luna_selector_ranking_snapshots_v2'::regclass
  ) then
    alter table public.ebay_luna_selector_ranking_snapshots_v2
      add constraint
        ebay_luna_selector_v2_bootstrap_canary_contract_check
      check (
        not selected_for_bootstrap_canary
        or (
          eligible_for_bootstrap_canary
          and selection_mode = 'BOOTSTRAP_CANARY'
          and execution_mode = 'SHADOW'
          and forced_listing_quantity = 1
          and promotion_rate_percent = 0
          and not price_decrease_allowed
          and not external_writes_allowed
          and commercial_monitor_required
          and one_variable_at_a_time
          and hard_gate_codes <@ array[
            'CONFIRMED_SOLD_EXACT_REQUIRED',
            'LANDED_SOLD_PRICE_REQUIRED',
            'EXACT_IDENTITY_REQUIRED',
            'EXACT_PACK_REQUIRED',
            'EXACT_SIZE_REQUIRED',
            'EXACT_VARIANT_REQUIRED',
            'EXACT_CONDITION_REQUIRED'
          ]::text[]
        )
      );
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'ebay_luna_selector_v2_shadow_effects_disabled_check'
      and conrelid =
        'public.ebay_luna_selector_ranking_snapshots_v2'::regclass
  ) then
    alter table public.ebay_luna_selector_ranking_snapshots_v2
      add constraint
        ebay_luna_selector_v2_shadow_effects_disabled_check
      check (
        execution_mode = 'SHADOW'
        and promotion_rate_percent = 0
        and not price_decrease_allowed
        and not external_writes_allowed
        and consumable_research_boost between 0 and 5
      );
  end if;
end;
$$;

insert into public.ebay_luna_selector_policies_v2 (
  scope_key,
  marketplace,
  policy_version,
  enabled,
  shadow_mode,
  policy
)
values (
  'DEFAULT',
  'EBAY_US',
  'EBAY_LUNA_SELECTOR_V2_BOOTSTRAP_CANARY_V1_SHADOW_2026_07_26',
  false,
  true,
  jsonb_build_object(
    'targetBatchSize', 5,
    'minimumConfirmedDemandPreferred', 4,
    'maximumExploratory', 1,
    'bootstrapCanaryEnabled', false,
    'maximumBootstrapCanaries', 5,
    'maximumPerFamily', 2,
    'maximumPerCategory', 2,
    'minimumNetProfitUsd', 5,
    'minimumMarginRate', 0.20,
    'minimumRoiRate', 0.30,
    'minimumConfidenceScore', 70,
    'minimumReadyScore', 70,
    'maximumRiskScore', 35,
    'maximumSupplierEvidenceAgeHours', 72,
    'maximumSoldEvidenceAgeDays', 30,
    'explorationMinimumPotentialScore', 55,
    'fairnessMaximumBoost', 10
  )
)
on conflict (scope_key, marketplace) do update
set policy_version = excluded.policy_version,
    enabled = false,
    shadow_mode = true,
    policy = coalesce(
      public.ebay_luna_selector_policies_v2.policy,
      '{}'::jsonb
    ) || jsonb_build_object(
      'bootstrapCanaryEnabled', false,
      'maximumBootstrapCanaries', 5
    ),
    updated_at = now();

comment on column
  public.ebay_luna_selector_ranking_snapshots_v2
    .selected_for_bootstrap_canary is
  'Shadow-only BOOTSTRAP_CANARY_V1 selection. Quantity 1, promotion 0, no price decrease and no external writes are database-enforced.';

alter table public.ebay_luna_selector_ranking_snapshots_v2
  enable row level security;
alter table public.ebay_luna_selector_ranking_snapshots_v2
  force row level security;

revoke all on table public.ebay_luna_selector_ranking_snapshots_v2
  from public, anon, authenticated;
grant select, insert on table
  public.ebay_luna_selector_ranking_snapshots_v2
  to service_role;

notify pgrst, 'reload schema';

commit;
