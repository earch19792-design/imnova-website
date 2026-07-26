begin;

create extension if not exists pgcrypto;

alter table public.ebay_same_day_pilot_runs
  add column if not exists factory_policy_version text not null
    default 'EBAY_LISTING_FACTORY_V1',
  add column if not exists factory_status text not null default 'ACTIVE',
  add column if not exists factory_target_size integer not null default 5,
  add column if not exists factory_mode text not null default 'DRY_RUN',
  add column if not exists desired_active_slots integer not null default 5,
  add column if not exists reserve_enabled boolean not null default true,
  add column if not exists factory_scheduler_owner text not null
    default 'supabase_pg_cron',
  add column if not exists factory_correlation_id uuid not null default gen_random_uuid(),
  add column if not exists factory_config_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists publication_kill_switch_engaged boolean not null default true,
  add column if not exists automatic_publication_allowed boolean not null default false,
  add column if not exists factory_initialized_at timestamptz null,
  add column if not exists factory_last_success_at timestamptz null,
  add column if not exists factory_updated_at timestamptz not null default now();

alter table public.ebay_same_day_pilot_runs
  drop constraint if exists ebay_same_day_pilot_runs_factory_status_check;
alter table public.ebay_same_day_pilot_runs
  add constraint ebay_same_day_pilot_runs_factory_status_check check (
    factory_status in (
      'ACTIVE', 'COMPLETED', 'COMPLETED_WITH_HOLDS',
      'COMPLETED_WITH_QUARANTINE', 'PARTIAL_SUCCESS',
      'PAUSED_BY_GLOBAL_DEPENDENCY'
    )
  );
alter table public.ebay_same_day_pilot_runs
  drop constraint if exists ebay_same_day_pilot_runs_factory_target_size_check;
alter table public.ebay_same_day_pilot_runs
  add constraint ebay_same_day_pilot_runs_factory_target_size_check
    check (factory_target_size between 1 and 5);
alter table public.ebay_same_day_pilot_runs
  drop constraint if exists ebay_same_day_pilot_runs_factory_mode_check;
alter table public.ebay_same_day_pilot_runs
  add constraint ebay_same_day_pilot_runs_factory_mode_check check (
    factory_mode in ('DRY_RUN', 'DRAFT_ONLY', 'SUPERVISED_CANARY', 'AUTOMATIC_POLICY')
  );
alter table public.ebay_same_day_pilot_runs
  drop constraint if exists ebay_same_day_pilot_runs_factory_slots_check;
alter table public.ebay_same_day_pilot_runs
  add constraint ebay_same_day_pilot_runs_factory_slots_check
    check (desired_active_slots between 1 and 5);
alter table public.ebay_same_day_pilot_runs
  drop constraint if exists ebay_same_day_pilot_runs_factory_scheduler_check;
alter table public.ebay_same_day_pilot_runs
  add constraint ebay_same_day_pilot_runs_factory_scheduler_check check (
    factory_scheduler_owner in (
      'supabase_pg_cron', 'github_actions_manual_fallback', 'DISABLED'
    )
  );
alter table public.ebay_same_day_pilot_runs
  drop constraint if exists ebay_same_day_pilot_runs_factory_safety_check;
alter table public.ebay_same_day_pilot_runs
  add constraint ebay_same_day_pilot_runs_factory_safety_check check (
    factory_mode <> 'DRY_RUN'
    or (
      publication_kill_switch_engaged
      and not automatic_publication_allowed
    )
  );

alter table public.ebay_same_day_pilot_candidates
  add column if not exists factory_state text not null default 'QUEUED',
  add column if not exists factory_state_version bigint not null default 1,
  add column if not exists slot_index integer null,
  add column if not exists candidate_role text not null default 'ACTIVE',
  add column if not exists active_slot boolean not null default false,
  add column if not exists replaces_candidate_id uuid null,
  add column if not exists dossier_version integer not null default 0,
  add column if not exists dossier_hash text null,
  add column if not exists reserved_sku text null,
  add column if not exists factory_marketplace_account_key text null,
  add column if not exists factory_marketplace text null,
  add column if not exists factory_registered_at timestamptz null,
  add column if not exists commercial_generation integer not null default 1,
  add column if not exists frozen_payload_hash text null,
  add column if not exists last_factory_checkpoint jsonb not null default '{}'::jsonb,
  add column if not exists last_factory_checkpoint_at timestamptz null,
  add column if not exists factory_lease_owner text null,
  add column if not exists factory_lease_token uuid null,
  add column if not exists factory_lease_expires_at timestamptz null,
  add column if not exists factory_heartbeat_at timestamptz null,
  add column if not exists factory_attempt_count integer not null default 0,
  add column if not exists factory_last_error_code text null,
  add column if not exists factory_last_error_fingerprint text null,
  add column if not exists factory_updated_at timestamptz not null default now();

alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_ordinal_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_ordinal_check
    check (ordinal between 1 and 100);
alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_factory_state_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_factory_state_check check (
    factory_state in (
      'QUEUED', 'CLAIMED', 'MARKET_RESEARCH', 'IDENTITY_VERIFIED',
      'SUPPLY_VERIFIED', 'DEMAND_VALIDATED', 'ECONOMICS_PASSED',
      'CATEGORY_AND_COMPLIANCE_PASSED', 'LISTING_INTELLIGENCE_READY',
      'VISUAL_PACKAGE_READY', 'FINAL_QA_PASSED', 'DRAFT_READY',
      'APPROVED_TO_PUBLISH', 'PUBLISHING', 'PUBLISHED',
      'POST_PUBLISH_VERIFIED', 'COMMERCIAL_MONITORING',
      'WAITING_EXTERNAL_DEPENDENCY', 'RETRY_SCHEDULED',
      'BLOCKED_MISSING_EVIDENCE', 'HOLD_BUSINESS_RULE', 'STOCK_HOLD',
      'MARGIN_HOLD', 'COMPLIANCE_HOLD', 'IDENTITY_HOLD',
      'QUARANTINED_UNKNOWN_ERROR', 'REJECTED_TERMINAL', 'CANCELLED'
    )
  );
alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_role_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_role_check check (
    candidate_role in ('ACTIVE', 'RESERVE', 'REPLACEMENT')
  );
alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_slot_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_slot_check check (
    slot_index is null or slot_index between 1 and 5
  );
alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_factory_lease_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_factory_lease_check check (
    (factory_lease_owner is null and factory_lease_token is null
      and factory_lease_expires_at is null)
    or
    (factory_lease_owner is not null and factory_lease_token is not null
      and factory_lease_expires_at is not null)
  );
alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_hashes_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_hashes_check check (
    (dossier_hash is null or dossier_hash ~ '^[0-9a-f]{64}$')
    and (frozen_payload_hash is null or frozen_payload_hash ~ '^[0-9a-f]{64}$')
    and (
      factory_last_error_fingerprint is null
      or factory_last_error_fingerprint ~ '^[0-9a-f]{64}$'
    )
  );
alter table public.ebay_same_day_pilot_candidates
  drop constraint if exists ebay_same_day_pilot_candidates_sku_scope_check;
alter table public.ebay_same_day_pilot_candidates
  add constraint ebay_same_day_pilot_candidates_sku_scope_check check (
    reserved_sku is null
    or (
      nullif(trim(factory_marketplace_account_key), '') is not null
      and factory_marketplace = 'EBAY_US'
    )
  );

do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_same_day_pilot_candidates_replaces_fk'
  ) then
    alter table public.ebay_same_day_pilot_candidates
      add constraint ebay_same_day_pilot_candidates_replaces_fk
      foreign key (replaces_candidate_id)
      references public.ebay_same_day_pilot_candidates(id) on delete restrict;
  end if;
end
$migration$;

create or replace function public.sync_ebay_listing_factory_candidate_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select run.marketplace_account_key, run.marketplace
  into new.factory_marketplace_account_key, new.factory_marketplace
  from public.ebay_same_day_pilot_runs run
  where run.id = new.run_id;
  if not found then
    raise exception 'LISTING_FACTORY_RUN_NOT_FOUND';
  end if;
  return new;
end
$$;

drop trigger if exists ebay_listing_factory_candidate_scope_sync
  on public.ebay_same_day_pilot_candidates;
create trigger ebay_listing_factory_candidate_scope_sync
before insert or update of run_id, reserved_sku
on public.ebay_same_day_pilot_candidates
for each row execute function public.sync_ebay_listing_factory_candidate_scope();

drop index if exists public.ebay_same_day_pilot_one_lease_per_run_idx;
create unique index if not exists ebay_listing_factory_active_slot_idx
  on public.ebay_same_day_pilot_candidates(run_id, slot_index)
  where active_slot and slot_index is not null;
drop index if exists public.ebay_listing_factory_reserved_sku_idx;
create unique index if not exists ebay_listing_factory_reserved_sku_idx
  on public.ebay_same_day_pilot_candidates(
    factory_marketplace_account_key, factory_marketplace, reserved_sku
  )
  where reserved_sku is not null;
create index if not exists ebay_listing_factory_claim_idx
  on public.ebay_same_day_pilot_candidates(
    run_id, active_slot, factory_state, factory_lease_expires_at, slot_index
  );

update public.ebay_same_day_pilot_candidates
set factory_state = case machine_state
  when 'RUN_CREATED' then 'QUEUED'
  when 'LOCAL_FILTERING' then 'MARKET_RESEARCH'
  when 'CANDIDATE_SELECTION' then 'MARKET_RESEARCH'
  when 'PRODUCT_RESEARCH_PLAN_READY' then 'MARKET_RESEARCH'
  when 'WAITING_PRODUCT_RESEARCH_CAPTURE' then 'WAITING_EXTERNAL_DEPENDENCY'
  when 'IMPORTING_SOLD_EVIDENCE' then 'MARKET_RESEARCH'
  when 'RECONCILING_IDENTITY' then 'MARKET_RESEARCH'
  when 'MATCHING_LUNA' then 'IDENTITY_VERIFIED'
  when 'RUNNING_LOOP_1' then 'DEMAND_VALIDATED'
  when 'CALCULATING_ECONOMICS' then 'DEMAND_VALIDATED'
  when 'WAITING_LUNA_CONFIRMATION' then 'BLOCKED_MISSING_EVIDENCE'
  when 'ENRICHING_PRODUCT_FACTS' then 'SUPPLY_VERIFIED'
  when 'VALIDATING_TAXONOMY' then 'ECONOMICS_PASSED'
  when 'VALIDATING_REGULATION' then 'CATEGORY_AND_COMPLIANCE_PASSED'
  when 'BUILDING_OPENAI_INPUT' then 'LISTING_INTELLIGENCE_READY'
  when 'WAITING_PRODUCT_APPROVAL' then 'HOLD_BUSINESS_RULE'
  when 'GENERATING_LISTING_CONTENT' then 'LISTING_INTELLIGENCE_READY'
  when 'VALIDATING_LISTING_CONTENT' then 'LISTING_INTELLIGENCE_READY'
  when 'PREPARING_IMAGE_PACKAGE' then 'LISTING_INTELLIGENCE_READY'
  when 'WAITING_IMAGE_APPROVAL' then 'HOLD_BUSINESS_RULE'
  when 'BUILDING_SELLER_HUB_HANDOFF' then 'FINAL_QA_PASSED'
  when 'READY_FOR_MANUAL_PUBLICATION' then 'DRAFT_READY'
  when 'WAITING_ITEM_ID' then 'PUBLISHING'
  when 'VERIFYING_PUBLISHED_LISTING' then 'PUBLISHED'
  when 'REGISTERING_COMMERCIAL_MONITOR' then 'POST_PUBLISH_VERIFIED'
  when 'VERIFIED_ACTIVE' then 'COMMERCIAL_MONITORING'
  when 'BLOCKED' then 'HOLD_BUSINESS_RULE'
  when 'REJECTED' then 'REJECTED_TERMINAL'
  when 'COMPLETED' then 'COMMERCIAL_MONITORING'
  else factory_state
end
where factory_state = 'QUEUED';

update public.ebay_same_day_pilot_candidates candidate
set factory_marketplace_account_key = run.marketplace_account_key,
    factory_marketplace = run.marketplace,
    candidate_role = case
      when run.factory_initialized_at is not null
        and not candidate.active_slot
        and candidate.slot_index is null
        and candidate.factory_state = 'QUEUED'
        then 'RESERVE'
      else candidate.candidate_role
    end,
    factory_registered_at = case
      when run.factory_initialized_at is not null
        then coalesce(
          candidate.factory_registered_at,
          candidate.last_factory_checkpoint_at,
          run.factory_initialized_at
        )
      else candidate.factory_registered_at
    end
from public.ebay_same_day_pilot_runs run
where run.id = candidate.run_id
  and (
    candidate.factory_marketplace_account_key is distinct from run.marketplace_account_key
    or candidate.factory_marketplace is distinct from run.marketplace
    or (
      run.factory_initialized_at is not null
      and candidate.factory_registered_at is null
    )
  );

create table if not exists public.ebay_listing_factory_policies (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  policy_version text not null,
  status text not null default 'DRAFT',
  mode text not null default 'DRY_RUN',
  batch_size integer not null default 5,
  max_concurrent_products integer not null default 5,
  reserve_enabled boolean not null default true,
  maximum_product_attempts integer not null default 4,
  external_writes_allowed boolean not null default false,
  automatic_publish_allowed boolean not null default false,
  kill_switch_engaged boolean not null default true,
  minimum_net_profit_usd numeric(12,2) not null default 5,
  target_net_profit_usd numeric(12,2) not null default 7,
  minimum_roi_percent numeric(8,2) not null default 30,
  minimum_margin_percent numeric(8,2) not null default 20,
  policy_config jsonb not null default '{}'::jsonb,
  activated_by uuid null references auth.users(id) on delete restrict,
  activated_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (marketplace_account_key, marketplace, policy_version),
  check (marketplace = 'EBAY_US'),
  check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  check (mode in ('DRY_RUN', 'DRAFT_ONLY', 'SUPERVISED_CANARY', 'AUTOMATIC_POLICY')),
  check (batch_size = 5 and max_concurrent_products between 1 and 5),
  check (maximum_product_attempts between 1 and 10),
  check (
    mode <> 'DRY_RUN'
    or (not external_writes_allowed and not automatic_publish_allowed
      and kill_switch_engaged)
  )
);
create unique index if not exists ebay_listing_factory_one_active_policy_idx
  on public.ebay_listing_factory_policies(marketplace_account_key, marketplace)
  where status = 'ACTIVE';

create table if not exists public.ebay_listing_factory_dossiers (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null
    references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  version integer not null check (version between 1 and 10000),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'FROZEN', 'INVALIDATED')),
  dossier_hash text not null check (dossier_hash ~ '^[0-9a-f]{64}$'),
  identity jsonb not null,
  supplier_and_compliance jsonb not null,
  ebay_market jsonb not null,
  economics jsonb not null,
  listing_package jsonb not null,
  visual_package jsonb not null,
  traceability jsonb not null,
  completeness_score numeric(5,2) not null default 0
    check (completeness_score between 0 and 100),
  frozen_payload_hash text null
    check (frozen_payload_hash is null or frozen_payload_hash ~ '^[0-9a-f]{64}$'),
  evidence_observed_at timestamptz not null,
  evidence_expires_at timestamptz not null,
  invalidated_at timestamptz null,
  invalidation_reason text null,
  created_by_actor text not null,
  created_at timestamptz not null default now(),
  unique (candidate_id, version),
  unique (candidate_id, dossier_hash),
  check (evidence_expires_at > evidence_observed_at),
  check (
    status <> 'FROZEN'
    or (completeness_score = 100 and frozen_payload_hash is not null)
  )
);
create index if not exists ebay_listing_factory_dossier_current_idx
  on public.ebay_listing_factory_dossiers(candidate_id, version desc);

create table if not exists public.ebay_listing_factory_transition_rules (
  previous_state text not null,
  next_state text not null,
  transition_kind text not null default 'FORWARD',
  active boolean not null default true,
  primary key (previous_state, next_state),
  check (transition_kind in ('FORWARD', 'SIDE', 'REPLAY', 'INVALIDATION'))
);

create table if not exists public.ebay_listing_factory_transitions (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null
    references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  previous_state text not null,
  next_state text not null,
  cause_code text not null,
  dossier_version integer not null default 0,
  dossier_hash text null
    check (dossier_hash is null or dossier_hash ~ '^[0-9a-f]{64}$'),
  actor_kind text not null check (actor_kind in ('SYSTEM', 'USER', 'SCHEDULER', 'RETRY')),
  actor_id text not null,
  correlation_id uuid not null,
  checkpoint jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique
    check (idempotency_key ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now()
);
create index if not exists ebay_listing_factory_transition_timeline_idx
  on public.ebay_listing_factory_transitions(candidate_id, occurred_at, id);

create table if not exists public.ebay_listing_factory_error_fingerprints (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  category text not null,
  dependency text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count bigint not null default 1 check (occurrence_count > 0),
  known_handler_code text null,
  playbook_status text not null default 'UNKNOWN'
    check (playbook_status in ('UNKNOWN', 'PROPOSED', 'TESTED', 'APPROVED', 'RETIRED')),
  playbook jsonb not null default '{}'::jsonb,
  handler_approved_by uuid null references auth.users(id) on delete restrict,
  handler_approved_at timestamptz null
);

create table if not exists public.ebay_listing_factory_quarantine_cases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null
    references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  sku text null,
  phase text not null,
  last_checkpoint_state text not null,
  last_checkpoint jsonb not null default '{}'::jsonb,
  error_code text not null,
  error_category text not null,
  error_fingerprint text not null
    references public.ebay_listing_factory_error_fingerprints(fingerprint)
    on delete restrict,
  sanitized_message text not null check (length(sanitized_message) <= 500),
  dependency text not null,
  attempt_count integer not null check (attempt_count between 1 and 20),
  first_occurred_at timestamptz not null default now(),
  last_occurred_at timestamptz not null default now(),
  dossier_version integer not null default 0,
  dossier_hash text null
    check (dossier_hash is null or dossier_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text null
    check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  impact text not null,
  suggested_action text not null,
  resume_requirements jsonb not null default '[]'::jsonb,
  replay_safe boolean not null default false,
  owner_queue text not null default 'SELLER_OS_EXCEPTION_QUEUE',
  status text not null default 'OPEN'
    check (status in ('OPEN', 'REPLAYING', 'RECOVERED', 'REJECTED', 'CANCELLED')),
  replay_count integer not null default 0 check (replay_count between 0 and 20),
  recovered_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ebay_listing_factory_one_open_quarantine_idx
  on public.ebay_listing_factory_quarantine_cases(candidate_id)
  where status in ('OPEN', 'REPLAYING');

create table if not exists public.ebay_listing_factory_dependency_circuits (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  dependency text not null,
  status text not null default 'CLOSED'
    check (status in ('CLOSED', 'OPEN', 'HALF_OPEN')),
  failure_count integer not null default 0 check (failure_count >= 0),
  opened_at timestamptz null,
  retry_after timestamptz null,
  half_open_probe_owner text null,
  half_open_probe_expires_at timestamptz null,
  last_error_code text null,
  sanitized_error text null check (sanitized_error is null or length(sanitized_error) <= 500),
  updated_at timestamptz not null default now(),
  unique (marketplace_account_key, marketplace, dependency),
  check (marketplace = 'EBAY_US')
);

create table if not exists public.ebay_listing_factory_effect_outbox (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null
    references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  dossier_id uuid not null
    references public.ebay_listing_factory_dossiers(id) on delete restrict,
  authorized_publication_id uuid null
    references public.ebay_authorized_listing_publications(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  product_id text not null,
  sku text not null,
  commercial_generation integer not null check (commercial_generation > 0),
  dossier_version integer not null check (dossier_version > 0),
  action text not null check (
    action in (
      'PUT_INVENTORY_ITEM', 'CREATE_OFFER', 'PUBLISH_OFFER',
      'VERIFY_POST_PUBLISH'
    )
  ),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  safe_payload_summary jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique check (idempotency_key ~ '^[0-9a-f]{64}$'),
  status text not null default 'PREPARED' check (
    status in (
      'PREPARED', 'SENT', 'UNKNOWN_OUTCOME', 'CONFIRMED',
      'RECONCILED', 'FAILED', 'CANCELLED'
    )
  ),
  external_write_authorized boolean not null default false,
  attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  maximum_attempts integer not null default 2 check (maximum_attempts between 1 and 2),
  available_at timestamptz not null default now(),
  lease_owner text null,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  provider_request_id text null,
  offer_id text null,
  listing_id text null,
  last_error_code text null,
  sanitized_error text null check (sanitized_error is null or length(sanitized_error) <= 500),
  prepared_at timestamptz not null default now(),
  sent_at timestamptz null,
  confirmed_at timestamptz null,
  reconciled_at timestamptz null,
  updated_at timestamptz not null default now(),
  unique (
    marketplace_account_key, marketplace, product_id, sku,
    commercial_generation, action, dossier_version, payload_hash
  ),
  check (marketplace = 'EBAY_US'),
  check (
    (lease_owner is null and lease_token is null and lease_expires_at is null)
    or
    (lease_owner is not null and lease_token is not null and lease_expires_at is not null)
  ),
  check (action <> 'PUBLISH_OFFER' or authorized_publication_id is not null)
);
create index if not exists ebay_listing_factory_effect_claim_idx
  on public.ebay_listing_factory_effect_outbox(status, available_at, prepared_at)
  where status in ('PREPARED', 'FAILED');

create table if not exists public.ebay_listing_factory_effect_attempts (
  id bigint generated always as identity primary key,
  outbox_id uuid not null
    references public.ebay_listing_factory_effect_outbox(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 2),
  state text not null check (
    state in ('PREPARED', 'SENT', 'UNKNOWN_OUTCOME', 'CONFIRMED', 'RECONCILED', 'FAILED')
  ),
  request_id text null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  response_fingerprint text null,
  http_status integer null,
  error_code text null,
  sanitized_result jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (outbox_id, attempt_number, state)
);

insert into public.ebay_listing_factory_transition_rules
  (previous_state, next_state, transition_kind)
values
  ('QUEUED','CLAIMED','FORWARD'),
  ('CLAIMED','MARKET_RESEARCH','FORWARD'),
  ('MARKET_RESEARCH','IDENTITY_VERIFIED','FORWARD'),
  ('IDENTITY_VERIFIED','SUPPLY_VERIFIED','FORWARD'),
  ('SUPPLY_VERIFIED','DEMAND_VALIDATED','FORWARD'),
  ('DEMAND_VALIDATED','ECONOMICS_PASSED','FORWARD'),
  ('ECONOMICS_PASSED','CATEGORY_AND_COMPLIANCE_PASSED','FORWARD'),
  ('CATEGORY_AND_COMPLIANCE_PASSED','LISTING_INTELLIGENCE_READY','FORWARD'),
  ('LISTING_INTELLIGENCE_READY','VISUAL_PACKAGE_READY','FORWARD'),
  ('VISUAL_PACKAGE_READY','FINAL_QA_PASSED','FORWARD'),
  ('FINAL_QA_PASSED','DRAFT_READY','FORWARD'),
  ('DRAFT_READY','APPROVED_TO_PUBLISH','FORWARD'),
  ('APPROVED_TO_PUBLISH','PUBLISHING','FORWARD'),
  ('PUBLISHING','PUBLISHED','FORWARD'),
  ('PUBLISHED','POST_PUBLISH_VERIFIED','FORWARD'),
  ('POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING','FORWARD')
on conflict (previous_state, next_state) do update
set transition_kind = excluded.transition_kind, active = true;

insert into public.ebay_listing_factory_transition_rules
  (previous_state, next_state, transition_kind)
select side_state, main_state, 'REPLAY'
from unnest(array[
  'WAITING_EXTERNAL_DEPENDENCY','RETRY_SCHEDULED','BLOCKED_MISSING_EVIDENCE',
  'HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD','COMPLIANCE_HOLD','IDENTITY_HOLD'
]) as side(side_state)
cross join unnest(array[
  'MARKET_RESEARCH','IDENTITY_VERIFIED','SUPPLY_VERIFIED','DEMAND_VALIDATED',
  'ECONOMICS_PASSED','CATEGORY_AND_COMPLIANCE_PASSED',
  'LISTING_INTELLIGENCE_READY','VISUAL_PACKAGE_READY','FINAL_QA_PASSED','DRAFT_READY'
]) as main(main_state)
on conflict (previous_state, next_state) do update
set transition_kind = excluded.transition_kind, active = true;

insert into public.ebay_listing_factory_transition_rules
  (previous_state, next_state, transition_kind)
select source_state, side_state, 'SIDE'
from unnest(array[
  'QUEUED','CLAIMED','MARKET_RESEARCH','IDENTITY_VERIFIED','SUPPLY_VERIFIED',
  'DEMAND_VALIDATED','ECONOMICS_PASSED','CATEGORY_AND_COMPLIANCE_PASSED',
  'LISTING_INTELLIGENCE_READY','VISUAL_PACKAGE_READY','FINAL_QA_PASSED',
  'DRAFT_READY','APPROVED_TO_PUBLISH','PUBLISHING','PUBLISHED'
]) as source(source_state)
cross join unnest(array[
  'WAITING_EXTERNAL_DEPENDENCY','RETRY_SCHEDULED','BLOCKED_MISSING_EVIDENCE',
  'HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD','COMPLIANCE_HOLD',
  'IDENTITY_HOLD','QUARANTINED_UNKNOWN_ERROR','REJECTED_TERMINAL','CANCELLED'
]) as side(side_state)
on conflict (previous_state, next_state) do update
set transition_kind = excluded.transition_kind, active = true;

create or replace function public.prevent_listing_factory_immutable_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'LISTING_FACTORY_APPEND_ONLY_RECORD';
end
$$;

drop trigger if exists ebay_listing_factory_dossiers_immutable
  on public.ebay_listing_factory_dossiers;
create trigger ebay_listing_factory_dossiers_immutable
before update or delete on public.ebay_listing_factory_dossiers
for each row execute function public.prevent_listing_factory_immutable_mutation();

drop trigger if exists ebay_listing_factory_transitions_immutable
  on public.ebay_listing_factory_transitions;
create trigger ebay_listing_factory_transitions_immutable
before update or delete on public.ebay_listing_factory_transitions
for each row execute function public.prevent_listing_factory_immutable_mutation();

drop trigger if exists ebay_listing_factory_attempts_immutable
  on public.ebay_listing_factory_effect_attempts;
create trigger ebay_listing_factory_attempts_immutable
before update or delete on public.ebay_listing_factory_effect_attempts
for each row execute function public.prevent_listing_factory_immutable_mutation();

create or replace function public.append_ebay_listing_factory_dossier_v1(
  p_candidate_id uuid,
  p_dossier_hash text,
  p_identity jsonb,
  p_supplier_and_compliance jsonb,
  p_ebay_market jsonb,
  p_economics jsonb,
  p_listing_package jsonb,
  p_visual_package jsonb,
  p_traceability jsonb,
  p_completeness_score numeric,
  p_frozen_payload_hash text,
  p_evidence_observed_at timestamptz,
  p_evidence_expires_at timestamptz,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_existing public.ebay_listing_factory_dossiers%rowtype;
  v_dossier_id uuid;
  v_version integer;
  v_status text;
begin
  if p_dossier_hash !~ '^[0-9a-f]{64}$'
    or (
      p_frozen_payload_hash is not null
      and p_frozen_payload_hash !~ '^[0-9a-f]{64}$'
    )
    or p_completeness_score not between 0 and 100
    or p_evidence_expires_at <= p_evidence_observed_at
    or nullif(trim(p_actor), '') is null
    or jsonb_typeof(p_identity) <> 'object'
    or jsonb_typeof(p_supplier_and_compliance) <> 'object'
    or jsonb_typeof(p_ebay_market) <> 'object'
    or jsonb_typeof(p_economics) <> 'object'
    or jsonb_typeof(p_listing_package) <> 'object'
    or jsonb_typeof(p_visual_package) <> 'object'
    or jsonb_typeof(p_traceability) <> 'object' then
    raise exception 'LISTING_FACTORY_DOSSIER_INPUT_INVALID';
  end if;

  select * into v_candidate
  from public.ebay_same_day_pilot_candidates
  where id = p_candidate_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;

  select * into v_existing
  from public.ebay_listing_factory_dossiers
  where candidate_id = p_candidate_id
    and dossier_hash = p_dossier_hash;
  if found then
    update public.ebay_same_day_pilot_candidates
    set dossier_version = greatest(dossier_version, v_existing.version),
        dossier_hash = v_existing.dossier_hash,
        frozen_payload_hash = coalesce(
          v_existing.frozen_payload_hash,
          frozen_payload_hash
        ),
        factory_updated_at = now()
    where id = p_candidate_id;
    return jsonb_build_object(
      'id', v_existing.id,
      'version', v_existing.version,
      'dossierHash', v_existing.dossier_hash,
      'idempotentReplay', true
    );
  end if;

  select coalesce(max(version), 0) + 1
  into v_version
  from public.ebay_listing_factory_dossiers
  where candidate_id = p_candidate_id;
  v_status := case
    when p_completeness_score = 100 and p_frozen_payload_hash is not null
      then 'FROZEN'
    else 'DRAFT'
  end;

  insert into public.ebay_listing_factory_dossiers (
    run_id, candidate_id, version, status, dossier_hash, identity,
    supplier_and_compliance, ebay_market, economics, listing_package,
    visual_package, traceability, completeness_score, frozen_payload_hash,
    evidence_observed_at, evidence_expires_at, created_by_actor
  ) values (
    v_candidate.run_id, p_candidate_id, v_version, v_status, p_dossier_hash,
    p_identity, p_supplier_and_compliance, p_ebay_market, p_economics,
    p_listing_package, p_visual_package, p_traceability, p_completeness_score,
    p_frozen_payload_hash, p_evidence_observed_at, p_evidence_expires_at,
    p_actor
  ) returning id into v_dossier_id;

  update public.ebay_same_day_pilot_candidates
  set dossier_version = v_version,
      dossier_hash = p_dossier_hash,
      frozen_payload_hash = coalesce(
        p_frozen_payload_hash,
        frozen_payload_hash
      ),
      factory_updated_at = now()
  where id = p_candidate_id;

  return jsonb_build_object(
    'id', v_dossier_id,
    'version', v_version,
    'dossierHash', p_dossier_hash,
    'idempotentReplay', false
  );
end
$$;

create or replace function public.initialize_ebay_listing_factory_run_v1(
  p_run_id uuid,
  p_actor text,
  p_correlation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate_count integer;
  v_initialized_at timestamptz;
  v_mode text;
  v_free_slot integer;
  v_replacement_id uuid;
begin
  if nullif(trim(p_actor), '') is null then
    raise exception 'LISTING_FACTORY_ACTOR_REQUIRED';
  end if;

  select factory_initialized_at, factory_mode
  into v_initialized_at, v_mode
  from public.ebay_same_day_pilot_runs
  where id = p_run_id for update;
  if not found then
    raise exception 'LISTING_FACTORY_RUN_NOT_FOUND';
  end if;

  select count(*) into v_candidate_count
  from public.ebay_same_day_pilot_candidates
  where run_id = p_run_id;
  if v_candidate_count < 5 then
    raise exception 'LISTING_FACTORY_REQUIRES_FIVE_CANDIDATES';
  end if;

  update public.ebay_same_day_pilot_runs
  set factory_target_size = 5,
      desired_active_slots = 5,
      factory_status = case
        when factory_initialized_at is null then 'ACTIVE'
        else factory_status
      end,
      factory_mode = case
        when factory_initialized_at is null then 'DRY_RUN'
        else factory_mode
      end,
      publication_kill_switch_engaged = case
        when factory_initialized_at is null then true
        else publication_kill_switch_engaged
      end,
      automatic_publication_allowed = case
        when factory_initialized_at is null then false
        else automatic_publication_allowed
      end,
      factory_initialized_at = coalesce(factory_initialized_at, now()),
      factory_correlation_id = p_correlation_id,
      factory_updated_at = now()
  where id = p_run_id;

  with ranked_initial as (
    select id, row_number() over (order by ordinal, id) as position
    from public.ebay_same_day_pilot_candidates
    where run_id = p_run_id
      and factory_registered_at is null
      and v_initialized_at is null
  )
  update public.ebay_same_day_pilot_candidates candidate
  set slot_index = case
        when ranked_initial.position <= 5 then ranked_initial.position::integer
        else null
      end,
      candidate_role = case
        when ranked_initial.position <= 5 then 'ACTIVE'
        else 'RESERVE'
      end,
      active_slot = ranked_initial.position <= 5,
      factory_marketplace_account_key = run.marketplace_account_key,
      factory_marketplace = run.marketplace,
      factory_registered_at = now(),
      factory_state_version = factory_state_version + 1,
      last_factory_checkpoint_at = coalesce(last_factory_checkpoint_at, now())
  from ranked_initial
  join public.ebay_same_day_pilot_runs run on run.id = p_run_id
  where candidate.id = ranked_initial.id;

  update public.ebay_same_day_pilot_candidates candidate
  set slot_index = null,
      candidate_role = 'RESERVE',
      active_slot = false,
      factory_marketplace_account_key = run.marketplace_account_key,
      factory_marketplace = run.marketplace,
      factory_registered_at = now(),
      factory_state_version = factory_state_version + 1,
      last_factory_checkpoint_at = coalesce(last_factory_checkpoint_at, now())
  from public.ebay_same_day_pilot_runs run
  where run.id = p_run_id
    and candidate.run_id = run.id
    and candidate.factory_registered_at is null;

  insert into public.ebay_listing_factory_transitions (
    run_id, candidate_id, previous_state, next_state, cause_code,
    dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
    checkpoint, idempotency_key
  )
  select
    candidate.run_id, candidate.id, candidate.factory_state,
    candidate.factory_state,
    case
      when candidate.active_slot then 'BATCH5_INITIALIZED'
      else 'BATCH5_RESERVE_REGISTERED'
    end,
    candidate.dossier_version,
    candidate.dossier_hash, 'SYSTEM', p_actor, p_correlation_id,
    candidate.last_factory_checkpoint,
    encode(digest(
      'BATCH5_REGISTERED:' || candidate.id::text,
      'sha256'
    ), 'hex')
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.factory_registered_at is not null
  on conflict (idempotency_key) do nothing;

  loop
    select slots.slot_index
    into v_free_slot
    from generate_series(1, 5) as slots(slot_index)
    where not exists (
      select 1
      from public.ebay_same_day_pilot_candidates active_candidate
      where active_candidate.run_id = p_run_id
        and active_candidate.active_slot
        and active_candidate.slot_index = slots.slot_index
    )
    order by slots.slot_index
    limit 1;
    exit when v_free_slot is null;

    select candidate.id
    into v_replacement_id
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.run_id = p_run_id
      and candidate.candidate_role = 'RESERVE'
      and candidate.factory_registered_at is not null
      and not candidate.active_slot
      and candidate.factory_state not in (
        'QUARANTINED_UNKNOWN_ERROR','REJECTED_TERMINAL','CANCELLED',
        'PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
        'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD',
        'MARGIN_HOLD','COMPLIANCE_HOLD','IDENTITY_HOLD',
        'WAITING_EXTERNAL_DEPENDENCY'
      )
    order by candidate.priority desc, candidate.ordinal
    for update skip locked
    limit 1;
    exit when v_replacement_id is null;

    update public.ebay_same_day_pilot_candidates
    set active_slot = true,
        slot_index = v_free_slot,
        candidate_role = 'REPLACEMENT',
        factory_state_version = factory_state_version + 1,
        factory_updated_at = now()
    where id = v_replacement_id;

    insert into public.ebay_listing_factory_transitions (
      run_id, candidate_id, previous_state, next_state, cause_code,
      dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
      checkpoint, idempotency_key
    )
    select
      replacement.run_id, replacement.id, replacement.factory_state,
      replacement.factory_state, 'RESERVE_PROMOTED_TO_VACANT_SLOT',
      replacement.dossier_version, replacement.dossier_hash, 'SYSTEM',
      p_actor, p_correlation_id, replacement.last_factory_checkpoint,
      encode(digest(
        'RESERVE_PROMOTED_TO_VACANT_SLOT:' || replacement.id::text,
        'sha256'
      ), 'hex')
    from public.ebay_same_day_pilot_candidates replacement
    where replacement.id = v_replacement_id
    on conflict (idempotency_key) do nothing;

    v_free_slot := null;
    v_replacement_id := null;
  end loop;

  insert into public.ebay_listing_factory_transitions (
    run_id, candidate_id, previous_state, next_state, cause_code,
    dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
    checkpoint, idempotency_key
  )
  select
    candidate.run_id, candidate.id, candidate.factory_state,
    candidate.factory_state,
    case
      when candidate.active_slot then 'BATCH5_INITIALIZED'
      else 'BATCH5_RESERVE_REGISTERED'
    end,
    candidate.dossier_version,
    candidate.dossier_hash, 'SYSTEM', p_actor, p_correlation_id,
    candidate.last_factory_checkpoint,
    encode(digest(
      'BATCH5_REGISTERED:' || candidate.id::text,
      'sha256'
    ), 'hex')
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.factory_registered_at is not null
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'runId', p_run_id,
    'activeSlots', (
      select count(*) from public.ebay_same_day_pilot_candidates
      where run_id = p_run_id and active_slot
    ),
    'reserveCandidates', (
      select count(*) from public.ebay_same_day_pilot_candidates
      where run_id = p_run_id and candidate_role = 'RESERVE'
    ),
    'mode', case when v_initialized_at is null then 'DRY_RUN' else v_mode end,
    'externalWritesAllowed', false,
    'idempotentReplay', v_initialized_at is not null
  );
end
$$;

create or replace function public.claim_ebay_listing_factory_candidate_v1(
  p_run_id uuid,
  p_worker text,
  p_now timestamptz default now(),
  p_lease_seconds integer default 360
)
returns table (
  candidate_id uuid,
  run_id uuid,
  factory_state text,
  slot_index integer,
  dossier_version integer,
  dossier_hash text,
  reserved_sku text,
  commercial_generation integer,
  frozen_payload_hash text,
  checkpoint jsonb,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate_id uuid;
  v_lease_token uuid := gen_random_uuid();
  v_desired_slots integer;
  v_leased_count integer;
  v_account_key text;
  v_marketplace text;
  v_previous_state text;
begin
  if nullif(trim(p_worker), '') is null or p_lease_seconds not between 30 and 900 then
    raise exception 'LISTING_FACTORY_INVALID_LEASE_REQUEST';
  end if;

  select desired_active_slots, marketplace_account_key, marketplace
  into v_desired_slots, v_account_key, v_marketplace
  from public.ebay_same_day_pilot_runs
  where id = p_run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_RUN_NOT_FOUND'; end if;

  if exists (
    select 1
    from public.ebay_listing_factory_dependency_circuits circuit
    where circuit.marketplace_account_key = v_account_key
      and circuit.marketplace = v_marketplace
      and (
        circuit.status = 'OPEN'
        or (
          circuit.status = 'HALF_OPEN'
          and circuit.half_open_probe_owner is distinct from p_worker
        )
      )
  ) then
    return;
  end if;

  select count(*) into v_leased_count
  from public.ebay_same_day_pilot_candidates
  where run_id = p_run_id
    and factory_lease_expires_at > p_now;
  if v_leased_count >= v_desired_slots then return; end if;

  select candidate.id, candidate.factory_state
  into v_candidate_id, v_previous_state
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.active_slot
    and candidate.factory_state not in (
      'DRAFT_READY','PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD',
      'COMPLIANCE_HOLD','IDENTITY_HOLD','QUARANTINED_UNKNOWN_ERROR',
      'REJECTED_TERMINAL','CANCELLED','WAITING_EXTERNAL_DEPENDENCY'
    )
    and (
      candidate.factory_lease_expires_at is null
      or candidate.factory_lease_expires_at <= p_now
    )
  order by candidate.slot_index, candidate.ordinal
  for update skip locked
  limit 1;

  if v_candidate_id is null then return; end if;

  update public.ebay_same_day_pilot_candidates
  set factory_lease_owner = p_worker,
      factory_lease_token = v_lease_token,
      factory_lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      factory_heartbeat_at = p_now,
      factory_attempt_count = factory_attempt_count + 1,
      factory_state = case when factory_state = 'QUEUED' then 'CLAIMED' else factory_state end,
      factory_state_version = factory_state_version + 1
  where id = v_candidate_id;

  if v_previous_state = 'QUEUED' then
    insert into public.ebay_listing_factory_transitions (
      run_id, candidate_id, previous_state, next_state, cause_code,
      dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
      checkpoint, idempotency_key
    )
    select
      candidate.run_id, candidate.id, 'QUEUED', 'CLAIMED',
      'FACTORY_CANDIDATE_CLAIMED', candidate.dossier_version,
      candidate.dossier_hash, 'SYSTEM', p_worker, v_lease_token,
      candidate.last_factory_checkpoint,
      encode(digest(
        'FACTORY_CANDIDATE_CLAIMED:' || candidate.id::text || ':'
          || v_lease_token::text,
        'sha256'
      ), 'hex')
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.id = v_candidate_id;
  end if;

  return query
  select candidate.id, candidate.run_id, candidate.factory_state,
    candidate.slot_index, candidate.dossier_version, candidate.dossier_hash,
    candidate.reserved_sku, candidate.commercial_generation,
    candidate.frozen_payload_hash, candidate.last_factory_checkpoint,
    candidate.factory_lease_token
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = v_candidate_id;
end
$$;

create or replace function public.claim_ebay_listing_factory_candidate_by_id_v1(
  p_run_id uuid,
  p_candidate_id uuid,
  p_worker text,
  p_now timestamptz default now(),
  p_lease_seconds integer default 300
)
returns table (
  candidate_id uuid,
  run_id uuid,
  factory_state text,
  slot_index integer,
  dossier_version integer,
  dossier_hash text,
  reserved_sku text,
  commercial_generation integer,
  frozen_payload_hash text,
  checkpoint jsonb,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_token uuid := gen_random_uuid();
  v_desired_slots integer;
  v_leased_count integer;
  v_account_key text;
  v_marketplace text;
begin
  if nullif(trim(p_worker), '') is null or p_lease_seconds not between 30 and 900 then
    raise exception 'LISTING_FACTORY_INVALID_LEASE_REQUEST';
  end if;

  select desired_active_slots, marketplace_account_key, marketplace
  into v_desired_slots, v_account_key, v_marketplace
  from public.ebay_same_day_pilot_runs
  where id = p_run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_RUN_NOT_FOUND'; end if;

  if exists (
    select 1
    from public.ebay_listing_factory_dependency_circuits circuit
    where circuit.marketplace_account_key = v_account_key
      and circuit.marketplace = v_marketplace
      and (
        circuit.status = 'OPEN'
        or (
          circuit.status = 'HALF_OPEN'
          and circuit.half_open_probe_owner is distinct from p_worker
        )
      )
  ) then
    return;
  end if;

  select * into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.run_id = p_run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;

  if not v_candidate.active_slot
    or v_candidate.factory_state in (
      'DRAFT_READY','PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD',
      'COMPLIANCE_HOLD','IDENTITY_HOLD','QUARANTINED_UNKNOWN_ERROR',
      'REJECTED_TERMINAL','CANCELLED','WAITING_EXTERNAL_DEPENDENCY'
    )
    or (
      v_candidate.factory_lease_expires_at is not null
      and v_candidate.factory_lease_expires_at > p_now
    ) then
    return;
  end if;

  select count(*) into v_leased_count
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = p_run_id
    and candidate.id <> p_candidate_id
    and candidate.factory_lease_expires_at > p_now;
  if v_leased_count >= v_desired_slots then return; end if;

  update public.ebay_same_day_pilot_candidates
  set factory_lease_owner = p_worker,
      factory_lease_token = v_token,
      factory_lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      factory_heartbeat_at = p_now,
      factory_attempt_count = factory_attempt_count + 1,
      factory_state = case when factory_state = 'QUEUED' then 'CLAIMED' else factory_state end,
      factory_state_version = factory_state_version + 1,
      factory_updated_at = p_now
  where id = p_candidate_id;

  if v_candidate.factory_state = 'QUEUED' then
    insert into public.ebay_listing_factory_transitions (
      run_id, candidate_id, previous_state, next_state, cause_code,
      dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
      checkpoint, idempotency_key
    ) values (
      v_candidate.run_id, v_candidate.id, 'QUEUED', 'CLAIMED',
      'FACTORY_CANDIDATE_CLAIMED', v_candidate.dossier_version,
      v_candidate.dossier_hash, 'SYSTEM', p_worker, v_token,
      v_candidate.last_factory_checkpoint,
      encode(digest(
        'FACTORY_CANDIDATE_CLAIMED:' || v_candidate.id::text || ':'
          || v_token::text,
        'sha256'
      ), 'hex')
    );
  end if;

  return query
  select candidate.id, candidate.run_id, candidate.factory_state,
    candidate.slot_index, candidate.dossier_version, candidate.dossier_hash,
    candidate.reserved_sku, candidate.commercial_generation,
    candidate.frozen_payload_hash, candidate.last_factory_checkpoint,
    candidate.factory_lease_token
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id;
end
$$;

create or replace function public.release_ebay_listing_factory_candidate_v1(
  p_candidate_id uuid,
  p_worker text,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ebay_same_day_pilot_candidates
  set factory_lease_owner = null,
      factory_lease_token = null,
      factory_lease_expires_at = null,
      factory_heartbeat_at = null,
      factory_updated_at = p_now
  where id = p_candidate_id
    and factory_lease_owner = p_worker
    and factory_lease_token = p_lease_token;
  return found;
end
$$;

create or replace function public.heartbeat_ebay_listing_factory_candidate_v1(
  p_candidate_id uuid,
  p_worker text,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.ebay_same_day_pilot_candidates
  set factory_lease_expires_at = p_now + interval '6 minutes',
      factory_heartbeat_at = p_now
  where id = p_candidate_id
    and factory_lease_owner = p_worker
    and factory_lease_token = p_lease_token
    and factory_lease_expires_at > p_now - interval '30 seconds';
  return found;
end
$$;

create or replace function public.transition_ebay_listing_factory_candidate_v1(
  p_candidate_id uuid,
  p_expected_state text,
  p_next_state text,
  p_cause_code text,
  p_dossier_version integer,
  p_dossier_hash text,
  p_checkpoint jsonb,
  p_actor_kind text,
  p_actor_id text,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_worker text default null,
  p_lease_token uuid default null,
  p_payload_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_replacement_id uuid;
  v_released_slot integer;
begin
  if p_idempotency_key !~ '^[0-9a-f]{64}$'
    or p_dossier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'LISTING_FACTORY_INVALID_HASH';
  end if;

  select * into v_candidate
  from public.ebay_same_day_pilot_candidates
  where id = p_candidate_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;

  if exists (
    select 1 from public.ebay_listing_factory_transitions
    where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('candidateId', p_candidate_id, 'idempotentReplay', true);
  end if;
  if v_candidate.factory_state <> p_expected_state then
    raise exception 'LISTING_FACTORY_STATE_COMPARE_AND_SWAP_FAILED';
  end if;
  if p_worker is not null and (
    v_candidate.factory_lease_owner is distinct from p_worker
    or v_candidate.factory_lease_token is distinct from p_lease_token
    or v_candidate.factory_lease_expires_at <= now()
  ) then
    raise exception 'LISTING_FACTORY_LEASE_NOT_OWNED';
  end if;
  if p_worker is null
    and v_candidate.factory_lease_expires_at is not null
    and v_candidate.factory_lease_expires_at > now() then
    raise exception 'LISTING_FACTORY_ACTIVE_LEASE_REQUIRES_OWNER';
  end if;
  if not exists (
    select 1 from public.ebay_listing_factory_transition_rules
    where previous_state = p_expected_state and next_state = p_next_state and active
  ) then
    raise exception 'LISTING_FACTORY_TRANSITION_NOT_ALLOWED';
  end if;
  if p_expected_state in (
    'POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING','REJECTED_TERMINAL','CANCELLED'
  ) then
    raise exception 'LISTING_FACTORY_FINALIZED_STATE_IMMUTABLE';
  end if;
  if p_dossier_version > 0 and not exists (
    select 1 from public.ebay_listing_factory_dossiers
    where candidate_id = p_candidate_id
      and version = p_dossier_version
      and dossier_hash = p_dossier_hash
  ) then
    raise exception 'LISTING_FACTORY_DOSSIER_VERSION_NOT_FOUND';
  end if;

  v_released_slot := case
    when p_next_state in (
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD',
      'MARGIN_HOLD','COMPLIANCE_HOLD','IDENTITY_HOLD'
    ) then v_candidate.slot_index
    else null
  end;

  update public.ebay_same_day_pilot_candidates
  set factory_state = p_next_state,
      factory_state_version = factory_state_version + 1,
      dossier_version = p_dossier_version,
      dossier_hash = p_dossier_hash,
      frozen_payload_hash = coalesce(p_payload_hash, frozen_payload_hash),
      last_factory_checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
      last_factory_checkpoint_at = now(),
      active_slot = case when v_released_slot is not null then false else active_slot end,
      slot_index = case when v_released_slot is not null then null else slot_index end,
      factory_last_error_code = null,
      factory_updated_at = now()
  where id = p_candidate_id;

  if v_released_slot is not null then
    select candidate.id into v_replacement_id
    from public.ebay_same_day_pilot_candidates candidate
    join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
    where candidate.run_id = v_candidate.run_id
      and run.reserve_enabled
      and candidate.candidate_role = 'RESERVE'
      and candidate.factory_registered_at is not null
      and not candidate.active_slot
      and candidate.factory_state not in (
        'QUARANTINED_UNKNOWN_ERROR','REJECTED_TERMINAL','CANCELLED',
        'PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING'
      )
    order by candidate.priority desc, candidate.ordinal
    for update of candidate skip locked
    limit 1;

    if v_replacement_id is not null then
      update public.ebay_same_day_pilot_candidates
      set active_slot = true,
          slot_index = v_released_slot,
          candidate_role = 'REPLACEMENT',
          replaces_candidate_id = p_candidate_id,
          factory_state_version = factory_state_version + 1,
          factory_updated_at = now()
      where id = v_replacement_id;

      insert into public.ebay_listing_factory_transitions (
        run_id, candidate_id, previous_state, next_state, cause_code,
        dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
        checkpoint, idempotency_key
      )
      select
        replacement.run_id, replacement.id, replacement.factory_state,
        replacement.factory_state, 'RESERVE_PROMOTED_AFTER_HOLD',
        replacement.dossier_version, replacement.dossier_hash, 'SYSTEM',
        p_actor_id, p_correlation_id, replacement.last_factory_checkpoint,
        encode(digest(
          'RESERVE_PROMOTED_AFTER_HOLD:' || p_idempotency_key || ':'
            || replacement.id::text,
          'sha256'
        ), 'hex')
      from public.ebay_same_day_pilot_candidates replacement
      where replacement.id = v_replacement_id
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  insert into public.ebay_listing_factory_transitions (
    run_id, candidate_id, previous_state, next_state, cause_code,
    dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
    checkpoint, idempotency_key
  ) values (
    v_candidate.run_id, p_candidate_id, p_expected_state, p_next_state, p_cause_code,
    p_dossier_version, p_dossier_hash, p_actor_kind, p_actor_id, p_correlation_id,
    coalesce(p_checkpoint, '{}'::jsonb), p_idempotency_key
  );

  return jsonb_build_object(
    'candidateId', p_candidate_id, 'previousState', p_expected_state,
    'nextState', p_next_state, 'idempotentReplay', false
  );
end
$$;

create or replace function public.quarantine_ebay_listing_factory_candidate_v1(
  p_candidate_id uuid,
  p_worker text,
  p_lease_token uuid,
  p_error_code text,
  p_error_category text,
  p_error_fingerprint text,
  p_sanitized_message text,
  p_dependency text,
  p_checkpoint_state text,
  p_checkpoint jsonb,
  p_impact text,
  p_suggested_action text,
  p_resume_requirements jsonb,
  p_replay_safe boolean,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_case_id uuid;
  v_replacement_id uuid;
  v_slot integer;
begin
  if p_error_fingerprint !~ '^[0-9a-f]{64}$'
    or p_idempotency_key !~ '^[0-9a-f]{64}$'
    or length(p_sanitized_message) > 500 then
    raise exception 'LISTING_FACTORY_INVALID_QUARANTINE_INPUT';
  end if;
  select * into v_candidate
  from public.ebay_same_day_pilot_candidates
  where id = p_candidate_id for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;
  if v_candidate.factory_lease_owner is distinct from p_worker
    or v_candidate.factory_lease_token is distinct from p_lease_token then
    raise exception 'LISTING_FACTORY_LEASE_NOT_OWNED';
  end if;

  insert into public.ebay_listing_factory_error_fingerprints (
    fingerprint, category, dependency
  ) values (
    p_error_fingerprint, p_error_category, p_dependency
  )
  on conflict (fingerprint) do update
  set last_seen_at = now(),
      occurrence_count = ebay_listing_factory_error_fingerprints.occurrence_count + 1;

  select id into v_case_id
  from public.ebay_listing_factory_quarantine_cases
  where candidate_id = p_candidate_id and status in ('OPEN', 'REPLAYING')
  for update;

  if v_case_id is null then
    insert into public.ebay_listing_factory_quarantine_cases (
      run_id, candidate_id, sku, phase, last_checkpoint_state, last_checkpoint,
      error_code, error_category, error_fingerprint, sanitized_message, dependency,
      attempt_count, dossier_version, dossier_hash, payload_hash, impact,
      suggested_action, resume_requirements, replay_safe
    ) values (
      v_candidate.run_id, v_candidate.id, v_candidate.reserved_sku,
      v_candidate.factory_state, p_checkpoint_state, coalesce(p_checkpoint, '{}'::jsonb),
      p_error_code, p_error_category, p_error_fingerprint, p_sanitized_message,
      p_dependency, greatest(v_candidate.factory_attempt_count, 1),
      v_candidate.dossier_version, v_candidate.dossier_hash,
      v_candidate.frozen_payload_hash, p_impact, p_suggested_action,
      coalesce(p_resume_requirements, '[]'::jsonb), p_replay_safe
    ) returning id into v_case_id;
  else
    update public.ebay_listing_factory_quarantine_cases
    set last_occurred_at = now(),
        attempt_count = greatest(attempt_count, v_candidate.factory_attempt_count),
        sanitized_message = p_sanitized_message,
        updated_at = now()
    where id = v_case_id;
  end if;

  v_slot := v_candidate.slot_index;
  update public.ebay_same_day_pilot_candidates
  set factory_state = 'QUARANTINED_UNKNOWN_ERROR',
      factory_state_version = factory_state_version + 1,
      active_slot = false,
      slot_index = null,
      factory_lease_owner = null,
      factory_lease_token = null,
      factory_lease_expires_at = null,
      factory_heartbeat_at = null,
      factory_last_error_code = p_error_code,
      factory_last_error_fingerprint = p_error_fingerprint,
      last_factory_checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
      last_factory_checkpoint_at = now()
  where id = p_candidate_id;

  select candidate.id into v_replacement_id
  from public.ebay_same_day_pilot_candidates candidate
  join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
  where candidate.run_id = v_candidate.run_id
    and run.reserve_enabled
    and candidate.candidate_role = 'RESERVE'
    and candidate.factory_registered_at is not null
    and not candidate.active_slot
    and candidate.factory_state not in (
      'QUARANTINED_UNKNOWN_ERROR','REJECTED_TERMINAL','CANCELLED',
      'PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD',
      'MARGIN_HOLD','COMPLIANCE_HOLD','IDENTITY_HOLD',
      'WAITING_EXTERNAL_DEPENDENCY'
    )
  order by candidate.priority desc, candidate.ordinal
  for update of candidate skip locked
  limit 1;

  if v_replacement_id is not null and v_slot is not null then
    update public.ebay_same_day_pilot_candidates
    set active_slot = true, slot_index = v_slot, candidate_role = 'REPLACEMENT',
        replaces_candidate_id = p_candidate_id, factory_state_version = factory_state_version + 1
    where id = v_replacement_id;
  end if;

  insert into public.ebay_listing_factory_transitions (
    run_id, candidate_id, previous_state, next_state, cause_code,
    dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
    checkpoint, idempotency_key
  ) values (
    v_candidate.run_id, p_candidate_id, v_candidate.factory_state,
    'QUARANTINED_UNKNOWN_ERROR', p_error_code, v_candidate.dossier_version,
    v_candidate.dossier_hash, 'SYSTEM', p_worker, p_correlation_id,
    coalesce(p_checkpoint, '{}'::jsonb), p_idempotency_key
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'quarantineCaseId', v_case_id,
    'candidateId', p_candidate_id,
    'replacementCandidateId', v_replacement_id,
    'slot', v_slot
  );
end
$$;

create or replace function public.quarantine_ebay_listing_factory_legacy_dead_letter_v1(
  p_job_id uuid,
  p_error_fingerprint text,
  p_error_category text,
  p_dependency text,
  p_sanitized_message text,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.ebay_same_day_pilot_jobs%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_worker text;
  v_token uuid := gen_random_uuid();
begin
  select * into v_job
  from public.ebay_same_day_pilot_jobs
  where id = p_job_id
  for update;
  if not found or v_job.status <> 'DEAD_LETTER' then
    raise exception 'LISTING_FACTORY_LEGACY_DEAD_LETTER_REQUIRED';
  end if;
  select * into v_candidate
  from public.ebay_same_day_pilot_candidates
  where id = v_job.candidate_id and run_id = v_job.run_id
  for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;
  if v_candidate.factory_state = 'QUARANTINED_UNKNOWN_ERROR' then
    return jsonb_build_object(
      'candidateId', v_candidate.id,
      'idempotentReplay', true
    );
  end if;
  if v_candidate.factory_state in (
    'PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
    'REJECTED_TERMINAL','CANCELLED'
  ) then
    raise exception 'LISTING_FACTORY_FINALIZED_STATE_IMMUTABLE';
  end if;

  v_worker := 'legacy-dead-letter:' || p_job_id::text;
  update public.ebay_same_day_pilot_candidates
  set factory_lease_owner = v_worker,
      factory_lease_token = v_token,
      factory_lease_expires_at = now() + interval '1 minute',
      factory_heartbeat_at = now()
  where id = v_candidate.id;

  return public.quarantine_ebay_listing_factory_candidate_v1(
    v_candidate.id,
    v_worker,
    v_token,
    coalesce(v_job.last_error_code, 'UNKNOWN_LEGACY_JOB_ERROR'),
    p_error_category,
    p_error_fingerprint,
    left(p_sanitized_message, 500),
    p_dependency,
    v_candidate.factory_state,
    coalesce(v_job.checkpoint, '{}'::jsonb),
    'Un producto fallo; los otros slots continúan.',
    'Revisar el fingerprint y reanudar desde el ultimo checkpoint.',
    jsonb_build_array(
      'Verificar evidencia vigente',
      'Confirmar que no existe un efecto de publicacion confirmado'
    ),
    true,
    p_correlation_id,
    p_idempotency_key
  );
end
$$;

create or replace function public.replay_ebay_listing_factory_quarantine_v1(
  p_quarantine_case_id uuid,
  p_actor_id text,
  p_evidence_revalidated boolean,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.ebay_listing_factory_quarantine_cases%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
begin
  select * into v_case from public.ebay_listing_factory_quarantine_cases
  where id = p_quarantine_case_id for update;
  if not found or v_case.status <> 'OPEN' then
    raise exception 'LISTING_FACTORY_OPEN_QUARANTINE_NOT_FOUND';
  end if;
  select * into v_candidate from public.ebay_same_day_pilot_candidates
  where id = v_case.candidate_id for update;
  if v_candidate.factory_state <> 'QUARANTINED_UNKNOWN_ERROR' then
    raise exception 'LISTING_FACTORY_CANDIDATE_NOT_QUARANTINED';
  end if;
  if not v_case.replay_safe then raise exception 'LISTING_FACTORY_REPLAY_NOT_SAFE'; end if;
  if not p_evidence_revalidated then
    raise exception 'LISTING_FACTORY_EVIDENCE_REVALIDATION_REQUIRED';
  end if;
  if exists (
    select 1 from public.ebay_listing_factory_effect_outbox
    where candidate_id = v_candidate.id
      and action = 'PUBLISH_OFFER'
      and status in ('CONFIRMED', 'RECONCILED')
  ) then
    raise exception 'LISTING_FACTORY_CONFIRMED_PUBLICATION_MUST_NOT_REPLAY';
  end if;
  if v_case.last_checkpoint_state in (
    'PUBLISHED','POST_PUBLISH_VERIFIED','COMMERCIAL_MONITORING',
    'REJECTED_TERMINAL','CANCELLED'
  ) then
    raise exception 'LISTING_FACTORY_FINALIZED_CHECKPOINT_MUST_NOT_REPLAY';
  end if;

  update public.ebay_same_day_pilot_candidates
  set factory_state = v_case.last_checkpoint_state,
      factory_state_version = factory_state_version + 1,
      candidate_role = 'RESERVE',
      active_slot = false,
      slot_index = null,
      last_factory_checkpoint = v_case.last_checkpoint,
      last_factory_checkpoint_at = now(),
      factory_last_error_code = null,
      factory_last_error_fingerprint = null
  where id = v_candidate.id;
  update public.ebay_listing_factory_quarantine_cases
  set status = 'RECOVERED', replay_count = replay_count + 1,
      recovered_at = now(), updated_at = now()
  where id = v_case.id;
  insert into public.ebay_listing_factory_transitions (
    run_id, candidate_id, previous_state, next_state, cause_code,
    dossier_version, dossier_hash, actor_kind, actor_id, correlation_id,
    checkpoint, idempotency_key
  ) values (
    v_candidate.run_id, v_candidate.id, 'QUARANTINED_UNKNOWN_ERROR',
    v_case.last_checkpoint_state, 'REPLAY_FROM_LAST_CHECKPOINT',
    v_candidate.dossier_version, v_candidate.dossier_hash, 'USER', p_actor_id,
    p_correlation_id, v_case.last_checkpoint, p_idempotency_key
  ) on conflict (idempotency_key) do nothing;
  return jsonb_build_object(
    'candidateId', v_candidate.id,
    'resumedFrom', v_case.last_checkpoint_state,
    'repeatedConfirmedEffect', false
  );
end
$$;

create or replace function public.open_ebay_listing_factory_circuit_v1(
  p_marketplace_account_key text,
  p_marketplace text,
  p_dependency text,
  p_error_code text,
  p_sanitized_error text,
  p_retry_after timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if length(coalesce(p_sanitized_error, '')) > 500 then
    raise exception 'LISTING_FACTORY_SANITIZED_ERROR_TOO_LONG';
  end if;
  insert into public.ebay_listing_factory_dependency_circuits (
    marketplace_account_key, marketplace, dependency, status, failure_count,
    opened_at, retry_after, last_error_code, sanitized_error
  ) values (
    p_marketplace_account_key, p_marketplace, p_dependency, 'OPEN', 1,
    now(), coalesce(p_retry_after, now() + interval '5 minutes'),
    p_error_code, p_sanitized_error
  )
  on conflict (marketplace_account_key, marketplace, dependency) do update
  set status = 'OPEN',
      failure_count = ebay_listing_factory_dependency_circuits.failure_count + 1,
      opened_at = coalesce(ebay_listing_factory_dependency_circuits.opened_at, now()),
      retry_after = excluded.retry_after,
      last_error_code = excluded.last_error_code,
      sanitized_error = excluded.sanitized_error,
      half_open_probe_owner = null,
      half_open_probe_expires_at = null,
      updated_at = now()
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.claim_ebay_listing_factory_circuit_probe_v1(
  p_marketplace_account_key text,
  p_marketplace text,
  p_dependency text,
  p_worker text,
  p_now timestamptz default now(),
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_circuit public.ebay_listing_factory_dependency_circuits%rowtype;
begin
  if nullif(trim(p_worker), '') is null or p_lease_seconds not between 30 and 900 then
    raise exception 'LISTING_FACTORY_INVALID_CIRCUIT_PROBE';
  end if;

  select * into v_circuit
  from public.ebay_listing_factory_dependency_circuits
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and dependency = p_dependency
  for update;
  if not found or v_circuit.status = 'CLOSED' then return false; end if;
  if v_circuit.status = 'OPEN'
    and (v_circuit.retry_after is null or v_circuit.retry_after > p_now) then
    return false;
  end if;
  if v_circuit.status = 'HALF_OPEN'
    and v_circuit.half_open_probe_expires_at is not null
    and v_circuit.half_open_probe_expires_at > p_now then
    return false;
  end if;

  update public.ebay_listing_factory_dependency_circuits
  set status = 'HALF_OPEN',
      half_open_probe_owner = p_worker,
      half_open_probe_expires_at = p_now + make_interval(secs => p_lease_seconds),
      updated_at = p_now
  where id = v_circuit.id;
  return true;
end
$$;

create or replace function public.resolve_ebay_listing_factory_circuit_probe_v1(
  p_marketplace_account_key text,
  p_marketplace text,
  p_dependency text,
  p_worker text,
  p_recovered boolean,
  p_error_code text default null,
  p_sanitized_error text default null,
  p_retry_after timestamptz default null,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_circuit public.ebay_listing_factory_dependency_circuits%rowtype;
  v_waiting record;
  v_resume_state text;
begin
  if length(coalesce(p_sanitized_error, '')) > 500 then
    raise exception 'LISTING_FACTORY_SANITIZED_ERROR_TOO_LONG';
  end if;
  select * into v_circuit
  from public.ebay_listing_factory_dependency_circuits
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and dependency = p_dependency
  for update;
  if not found then raise exception 'LISTING_FACTORY_CIRCUIT_NOT_FOUND'; end if;
  if v_circuit.status <> 'HALF_OPEN'
    or v_circuit.half_open_probe_owner is distinct from p_worker
    or v_circuit.half_open_probe_expires_at <= p_now then
    raise exception 'LISTING_FACTORY_CIRCUIT_PROBE_NOT_OWNED';
  end if;

  if p_recovered then
    update public.ebay_listing_factory_dependency_circuits
    set status = 'CLOSED',
        failure_count = 0,
        opened_at = null,
        retry_after = null,
        half_open_probe_owner = null,
        half_open_probe_expires_at = null,
        last_error_code = null,
        sanitized_error = null,
        updated_at = p_now
    where id = v_circuit.id;
    if not exists (
      select 1
      from public.ebay_listing_factory_dependency_circuits circuit
      where circuit.marketplace_account_key = p_marketplace_account_key
        and circuit.marketplace = p_marketplace
        and circuit.status in ('OPEN', 'HALF_OPEN')
    ) then
      for v_waiting in
        select candidate.*
        from public.ebay_same_day_pilot_candidates candidate
        join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
        where run.marketplace_account_key = p_marketplace_account_key
          and run.marketplace = p_marketplace
          and candidate.factory_state = 'WAITING_EXTERNAL_DEPENDENCY'
        for update of candidate
      loop
        select transition.previous_state
        into v_resume_state
        from public.ebay_listing_factory_transitions transition
        where transition.candidate_id = v_waiting.id
          and transition.next_state = 'WAITING_EXTERNAL_DEPENDENCY'
        order by transition.occurred_at desc, transition.id desc
        limit 1;
        if v_resume_state in (
          'QUEUED','CLAIMED','MARKET_RESEARCH','IDENTITY_VERIFIED',
          'SUPPLY_VERIFIED','DEMAND_VALIDATED','ECONOMICS_PASSED',
          'CATEGORY_AND_COMPLIANCE_PASSED','LISTING_INTELLIGENCE_READY',
          'VISUAL_PACKAGE_READY','FINAL_QA_PASSED','DRAFT_READY',
          'APPROVED_TO_PUBLISH','PUBLISHING','PUBLISHED'
        ) then
          insert into public.ebay_listing_factory_transitions (
            run_id, candidate_id, previous_state, next_state, cause_code,
            dossier_version, dossier_hash, actor_kind, actor_id,
            correlation_id, checkpoint, idempotency_key
          ) values (
            v_waiting.run_id, v_waiting.id, 'WAITING_EXTERNAL_DEPENDENCY',
            v_resume_state, 'DEPENDENCY_CIRCUIT_RECOVERED',
            v_waiting.dossier_version, v_waiting.dossier_hash, 'RETRY',
            p_worker, gen_random_uuid(), v_waiting.last_factory_checkpoint,
            encode(digest(
              'DEPENDENCY_CIRCUIT_RECOVERED:' || v_circuit.id::text || ':'
                || v_waiting.id::text,
              'sha256'
            ), 'hex')
          ) on conflict (idempotency_key) do nothing;
          update public.ebay_same_day_pilot_candidates
          set factory_state = v_resume_state,
              factory_state_version = factory_state_version + 1,
              factory_updated_at = p_now
          where id = v_waiting.id
            and factory_state = 'WAITING_EXTERNAL_DEPENDENCY';
        end if;
      end loop;
    end if;
    return 'CLOSED';
  end if;

  update public.ebay_listing_factory_dependency_circuits
  set status = 'OPEN',
      failure_count = failure_count + 1,
      opened_at = coalesce(opened_at, p_now),
      retry_after = coalesce(p_retry_after, p_now + interval '5 minutes'),
      half_open_probe_owner = null,
      half_open_probe_expires_at = null,
      last_error_code = p_error_code,
      sanitized_error = p_sanitized_error,
      updated_at = p_now
  where id = v_circuit.id;
  return 'OPEN';
end
$$;

create or replace function public.prepare_ebay_listing_factory_effect_v1(
  p_candidate_id uuid,
  p_dossier_id uuid,
  p_authorized_publication_id uuid,
  p_marketplace_account_key text,
  p_marketplace text,
  p_product_id text,
  p_sku text,
  p_generation integer,
  p_action text,
  p_payload_hash text,
  p_safe_payload_summary jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_dossier public.ebay_listing_factory_dossiers%rowtype;
  v_id uuid;
begin
  select * into v_candidate from public.ebay_same_day_pilot_candidates
  where id = p_candidate_id for update;
  if not found then raise exception 'LISTING_FACTORY_CANDIDATE_NOT_FOUND'; end if;
  select * into v_dossier from public.ebay_listing_factory_dossiers
  where id = p_dossier_id and candidate_id = p_candidate_id;
  if not found or v_dossier.status <> 'FROZEN' then
    raise exception 'LISTING_FACTORY_FROZEN_DOSSIER_REQUIRED';
  end if;
  if v_dossier.frozen_payload_hash is distinct from p_payload_hash
    or v_candidate.frozen_payload_hash is distinct from p_payload_hash then
    raise exception 'LISTING_FACTORY_PAYLOAD_HASH_MISMATCH';
  end if;
  if p_action = 'PUBLISH_OFFER' and (
    v_candidate.factory_state <> 'APPROVED_TO_PUBLISH'
    or p_authorized_publication_id is null
  ) then
    raise exception 'LISTING_FACTORY_PUBLICATION_AUTHORITY_REQUIRED';
  end if;

  insert into public.ebay_listing_factory_effect_outbox (
    run_id, candidate_id, dossier_id, authorized_publication_id,
    marketplace_account_key, marketplace, product_id, sku,
    commercial_generation, dossier_version, action, payload_hash,
    safe_payload_summary, idempotency_key, external_write_authorized
  ) values (
    v_candidate.run_id, v_candidate.id, v_dossier.id, p_authorized_publication_id,
    p_marketplace_account_key, p_marketplace, p_product_id, p_sku,
    p_generation, v_dossier.version, p_action, p_payload_hash,
    coalesce(p_safe_payload_summary, '{}'::jsonb), p_idempotency_key, false
  )
  on conflict (idempotency_key) do update
  set updated_at = ebay_listing_factory_effect_outbox.updated_at
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.claim_ebay_listing_factory_effect_v1(
  p_worker text,
  p_now timestamptz default now()
)
returns setof public.ebay_listing_factory_effect_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_token uuid := gen_random_uuid();
begin
  select effect.id into v_id
  from public.ebay_listing_factory_effect_outbox effect
  join public.ebay_same_day_pilot_runs run on run.id = effect.run_id
  where effect.status in ('PREPARED', 'FAILED')
    and effect.external_write_authorized
    and effect.available_at <= p_now
    and effect.attempt_count < effect.maximum_attempts
    and run.factory_mode <> 'DRY_RUN'
    and not run.publication_kill_switch_engaged
    and not exists (
      select 1
      from public.ebay_listing_factory_dependency_circuits circuit
      where circuit.marketplace_account_key = effect.marketplace_account_key
        and circuit.marketplace = effect.marketplace
        and (
          circuit.status = 'OPEN'
          or (
            circuit.status = 'HALF_OPEN'
            and circuit.half_open_probe_owner is distinct from p_worker
          )
        )
    )
    and (
      effect.action <> 'PUBLISH_OFFER'
      or (
        run.automatic_publication_allowed
        and effect.authorized_publication_id is not null
      )
    )
  order by effect.available_at, effect.prepared_at
  for update of effect skip locked
  limit 1;
  if v_id is null then return; end if;

  update public.ebay_listing_factory_effect_outbox
  set status = 'SENT', attempt_count = attempt_count + 1,
      lease_owner = p_worker, lease_token = v_token,
      lease_expires_at = p_now + interval '6 minutes',
      sent_at = p_now, updated_at = p_now
  where id = v_id;
  insert into public.ebay_listing_factory_effect_attempts (
    outbox_id, attempt_number, state, payload_hash
  )
  select id, attempt_count, 'SENT', payload_hash
  from public.ebay_listing_factory_effect_outbox where id = v_id;
  return query select * from public.ebay_listing_factory_effect_outbox where id = v_id;
end
$$;

create or replace function public.record_ebay_listing_factory_effect_result_v1(
  p_outbox_id uuid,
  p_worker text,
  p_lease_token uuid,
  p_status text,
  p_request_id text,
  p_http_status integer,
  p_error_code text,
  p_sanitized_result jsonb,
  p_offer_id text default null,
  p_listing_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_effect public.ebay_listing_factory_effect_outbox%rowtype;
begin
  if p_status not in ('UNKNOWN_OUTCOME','CONFIRMED','RECONCILED','FAILED') then
    raise exception 'LISTING_FACTORY_INVALID_EFFECT_RESULT';
  end if;
  select * into v_effect from public.ebay_listing_factory_effect_outbox
  where id = p_outbox_id for update;
  if not found or v_effect.lease_owner is distinct from p_worker
    or v_effect.lease_token is distinct from p_lease_token then
    raise exception 'LISTING_FACTORY_EFFECT_LEASE_NOT_OWNED';
  end if;

  update public.ebay_listing_factory_effect_outbox
  set status = p_status,
      provider_request_id = p_request_id,
      offer_id = coalesce(p_offer_id, offer_id),
      listing_id = coalesce(p_listing_id, listing_id),
      last_error_code = p_error_code,
      sanitized_error = case when p_error_code is null then null
        else left(coalesce(p_sanitized_result->>'error', p_error_code), 500) end,
      confirmed_at = case when p_status = 'CONFIRMED' then now() else confirmed_at end,
      reconciled_at = case when p_status = 'RECONCILED' then now() else reconciled_at end,
      available_at = case
        when p_status = 'FAILED' then now() + make_interval(
          secs => least(3600, (power(2, attempt_count) * 30)::integer)
        )
        else available_at end,
      lease_owner = null, lease_token = null, lease_expires_at = null,
      updated_at = now()
  where id = p_outbox_id;

  insert into public.ebay_listing_factory_effect_attempts (
    outbox_id, attempt_number, state, request_id, payload_hash,
    http_status, error_code, sanitized_result
  ) values (
    p_outbox_id, v_effect.attempt_count, p_status, p_request_id,
    v_effect.payload_hash, p_http_status, p_error_code,
    coalesce(p_sanitized_result, '{}'::jsonb)
  );
  return jsonb_build_object(
    'outboxId', p_outbox_id, 'status', p_status,
    'blindRetryAllowed', p_status = 'FAILED' and v_effect.attempt_count < v_effect.maximum_attempts,
    'requiresReconciliation', p_status = 'UNKNOWN_OUTCOME'
  );
end
$$;

create or replace function public.recover_expired_ebay_listing_factory_effects_v1(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recovered integer;
begin
  with expired as (
    update public.ebay_listing_factory_effect_outbox
    set status = 'UNKNOWN_OUTCOME',
        last_error_code = 'EFFECT_LEASE_EXPIRED_AFTER_SENT',
        sanitized_error = 'Resultado externo incierto; conciliacion requerida.',
        lease_owner = null,
        lease_token = null,
        lease_expires_at = null,
        updated_at = p_now
    where status = 'SENT'
      and lease_expires_at is not null
      and lease_expires_at <= p_now
    returning id, attempt_count, payload_hash
  )
  insert into public.ebay_listing_factory_effect_attempts (
    outbox_id, attempt_number, state, payload_hash, error_code,
    sanitized_result
  )
  select
    expired.id, expired.attempt_count, 'UNKNOWN_OUTCOME',
    expired.payload_hash, 'EFFECT_LEASE_EXPIRED_AFTER_SENT',
    '{"requiresReconciliation":true,"blindRetryAllowed":false}'::jsonb
  from expired
  on conflict (outbox_id, attempt_number, state) do nothing;
  get diagnostics v_recovered = row_count;
  return v_recovered;
end
$$;

create or replace function public.recompute_ebay_listing_factory_run_v1(
  p_run_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_active integer;
  v_completed integer;
  v_holds integer;
  v_quarantine integer;
  v_in_progress integer;
  v_open_circuits integer;
  v_mode text;
  v_target integer;
begin
  select factory_mode, factory_target_size into v_mode, v_target
  from public.ebay_same_day_pilot_runs where id = p_run_id for update;
  if not found then raise exception 'LISTING_FACTORY_RUN_NOT_FOUND'; end if;
  select
    count(*) filter (where active_slot),
    count(*) filter (
      where active_slot
        and (
          factory_state = 'COMMERCIAL_MONITORING'
          or (
            v_mode in ('DRY_RUN', 'DRAFT_ONLY')
            and factory_state = 'DRAFT_READY'
          )
        )
    ),
    count(*) filter (where factory_state in (
      'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD',
      'COMPLIANCE_HOLD','IDENTITY_HOLD'
    )),
    count(*) filter (where factory_state = 'QUARANTINED_UNKNOWN_ERROR'),
    count(*) filter (where active_slot and factory_state not in (
      'COMMERCIAL_MONITORING','BLOCKED_MISSING_EVIDENCE',
      'HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD','COMPLIANCE_HOLD',
      'IDENTITY_HOLD','QUARANTINED_UNKNOWN_ERROR','REJECTED_TERMINAL','CANCELLED'
    ))
      and not (
        v_mode in ('DRY_RUN', 'DRAFT_ONLY')
        and factory_state = 'DRAFT_READY'
      )
  into v_active, v_completed, v_holds, v_quarantine, v_in_progress
  from public.ebay_same_day_pilot_candidates where run_id = p_run_id;

  select count(*) into v_open_circuits
  from public.ebay_listing_factory_dependency_circuits circuit
  join public.ebay_same_day_pilot_runs run
    on run.marketplace_account_key = circuit.marketplace_account_key
   and run.marketplace = circuit.marketplace
  where run.id = p_run_id and circuit.status in ('OPEN', 'HALF_OPEN');

  v_status := case
    when v_open_circuits > 0 then 'PAUSED_BY_GLOBAL_DEPENDENCY'
    when v_in_progress > 0 then 'ACTIVE'
    when v_completed = v_target and v_quarantine = 0 and v_holds = 0 then 'COMPLETED'
    when v_completed > 0 and v_quarantine > 0 then 'COMPLETED_WITH_QUARANTINE'
    when v_completed > 0 and v_holds > 0 then 'COMPLETED_WITH_HOLDS'
    when v_completed > 0 then 'PARTIAL_SUCCESS'
    when v_quarantine > 0 then 'COMPLETED_WITH_QUARANTINE'
    when v_holds > 0 then 'COMPLETED_WITH_HOLDS'
    else 'ACTIVE'
  end;
  update public.ebay_same_day_pilot_runs
  set factory_status = v_status,
      factory_last_success_at = case
        when v_status = 'COMPLETED' and v_completed = v_target then now()
        else factory_last_success_at end,
      factory_updated_at = now()
  where id = p_run_id;
  return v_status;
end
$$;

drop view if exists public.ebay_listing_factory_run_metrics_v1;
create view public.ebay_listing_factory_run_metrics_v1
with (security_invoker = true)
as
with candidate_metrics as (
  select
    candidate.run_id,
    count(*) as products_selected,
    count(*) filter (where candidate.factory_attempt_count > 0) as products_started,
    count(*) filter (
      where candidate.factory_state = 'COMMERCIAL_MONITORING'
        or (
          run.factory_mode in ('DRY_RUN', 'DRAFT_ONLY')
          and candidate.factory_state = 'DRAFT_READY'
        )
    ) as products_completed,
    count(*) filter (
      where candidate.factory_state = 'QUARANTINED_UNKNOWN_ERROR'
    ) as products_quarantined,
    count(*) filter (
      where candidate.factory_state in (
        'BLOCKED_MISSING_EVIDENCE','HOLD_BUSINESS_RULE','STOCK_HOLD','MARGIN_HOLD',
        'COMPLIANCE_HOLD','IDENTITY_HOLD'
      )
    ) as products_on_hold,
    count(*) filter (where candidate.candidate_role = 'REPLACEMENT')
      as reserve_replacements,
    coalesce(sum(candidate.factory_attempt_count), 0) as total_attempts
  from public.ebay_same_day_pilot_candidates candidate
  join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
  group by candidate.run_id, run.factory_mode
),
effect_metrics as (
  select
    effect.run_id,
    count(*) filter (
      where effect.status in ('CONFIRMED','RECONCILED')
    ) as confirmed_external_effects,
    count(*) filter (
      where effect.status = 'UNKNOWN_OUTCOME'
    ) as uncertain_external_effects,
    count(*) filter (
      where effect.external_write_authorized = false
    ) as effects_blocked_by_policy
  from public.ebay_listing_factory_effect_outbox effect
  group by effect.run_id
)
select
  run.id as run_id,
  run.marketplace_account_key,
  run.marketplace,
  run.operation_date,
  run.status as legacy_status,
  run.factory_status as status,
  run.factory_mode,
  run.factory_policy_version,
  run.factory_scheduler_owner,
  run.factory_correlation_id,
  run.factory_last_success_at,
  coalesce(candidate_metrics.products_selected, 0) as products_selected,
  coalesce(candidate_metrics.products_started, 0) as products_started,
  coalesce(candidate_metrics.products_completed, 0) as products_completed,
  coalesce(candidate_metrics.products_quarantined, 0) as products_quarantined,
  coalesce(candidate_metrics.products_on_hold, 0) as products_on_hold,
  coalesce(candidate_metrics.reserve_replacements, 0) as reserve_replacements,
  coalesce(candidate_metrics.total_attempts, 0) as total_attempts,
  coalesce(effect_metrics.confirmed_external_effects, 0) as confirmed_external_effects,
  coalesce(effect_metrics.uncertain_external_effects, 0) as uncertain_external_effects,
  coalesce(effect_metrics.effects_blocked_by_policy, 0) as effects_blocked_by_policy
from public.ebay_same_day_pilot_runs run
left join candidate_metrics on candidate_metrics.run_id = run.id
left join effect_metrics on effect_metrics.run_id = run.id;

do $security$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ebay_listing_factory_policies',
    'ebay_listing_factory_dossiers',
    'ebay_listing_factory_transition_rules',
    'ebay_listing_factory_transitions',
    'ebay_listing_factory_error_fingerprints',
    'ebay_listing_factory_quarantine_cases',
    'ebay_listing_factory_dependency_circuits',
    'ebay_listing_factory_effect_outbox',
    'ebay_listing_factory_effect_attempts'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
  end loop;
end
$security$;

revoke all on public.ebay_listing_factory_run_metrics_v1 from anon, authenticated;
revoke all on function public.sync_ebay_listing_factory_candidate_scope()
  from public, anon, authenticated;
revoke all on table public.ebay_listing_factory_policies from anon, authenticated;
revoke all on table public.ebay_listing_factory_dossiers from anon, authenticated;
revoke all on table public.ebay_listing_factory_transition_rules from anon, authenticated;
revoke all on table public.ebay_listing_factory_transitions from anon, authenticated;
revoke all on table public.ebay_listing_factory_error_fingerprints from anon, authenticated;
revoke all on table public.ebay_listing_factory_quarantine_cases from anon, authenticated;
revoke all on table public.ebay_listing_factory_dependency_circuits from anon, authenticated;
revoke all on table public.ebay_listing_factory_effect_outbox from anon, authenticated;
revoke all on table public.ebay_listing_factory_effect_attempts from anon, authenticated;
grant select, insert, update on public.ebay_listing_factory_policies to service_role;
grant select, insert on public.ebay_listing_factory_dossiers to service_role;
grant select on public.ebay_listing_factory_transition_rules to service_role;
grant select, insert on public.ebay_listing_factory_transitions to service_role;
grant select, insert, update on public.ebay_listing_factory_error_fingerprints to service_role;
grant select, insert, update on public.ebay_listing_factory_quarantine_cases to service_role;
grant select, insert, update on public.ebay_listing_factory_dependency_circuits to service_role;
grant select, insert, update on public.ebay_listing_factory_effect_outbox to service_role;
grant select, insert on public.ebay_listing_factory_effect_attempts to service_role;
grant select on public.ebay_listing_factory_run_metrics_v1 to service_role;

revoke all on function public.initialize_ebay_listing_factory_run_v1(uuid,text,uuid)
  from public, anon, authenticated;
revoke all on function public.append_ebay_listing_factory_dossier_v1(
  uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,numeric,text,
  timestamptz,timestamptz,text
) from public, anon, authenticated;
revoke all on function public.claim_ebay_listing_factory_candidate_v1(uuid,text,timestamptz,integer)
  from public, anon, authenticated;
revoke all on function public.claim_ebay_listing_factory_candidate_by_id_v1(
  uuid,uuid,text,timestamptz,integer
) from public, anon, authenticated;
revoke all on function public.release_ebay_listing_factory_candidate_v1(
  uuid,text,uuid,timestamptz
) from public, anon, authenticated;
revoke all on function public.heartbeat_ebay_listing_factory_candidate_v1(uuid,text,uuid,timestamptz)
  from public, anon, authenticated;
revoke all on function public.transition_ebay_listing_factory_candidate_v1(
  uuid,text,text,text,integer,text,jsonb,text,text,uuid,text,text,uuid,text
) from public, anon, authenticated;
revoke all on function public.quarantine_ebay_listing_factory_candidate_v1(
  uuid,text,uuid,text,text,text,text,text,text,jsonb,text,text,jsonb,boolean,uuid,text
) from public, anon, authenticated;
revoke all on function public.quarantine_ebay_listing_factory_legacy_dead_letter_v1(
  uuid,text,text,text,text,uuid,text
) from public, anon, authenticated;
revoke all on function public.replay_ebay_listing_factory_quarantine_v1(
  uuid,text,boolean,uuid,text
) from public, anon, authenticated;
revoke all on function public.open_ebay_listing_factory_circuit_v1(
  text,text,text,text,text,timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_ebay_listing_factory_circuit_probe_v1(
  text,text,text,text,timestamptz,integer
) from public, anon, authenticated;
revoke all on function public.resolve_ebay_listing_factory_circuit_probe_v1(
  text,text,text,text,boolean,text,text,timestamptz,timestamptz
) from public, anon, authenticated;
revoke all on function public.prepare_ebay_listing_factory_effect_v1(
  uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb,text
) from public, anon, authenticated;
revoke all on function public.claim_ebay_listing_factory_effect_v1(text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.record_ebay_listing_factory_effect_result_v1(
  uuid,text,uuid,text,text,integer,text,jsonb,text,text
) from public, anon, authenticated;
revoke all on function public.recover_expired_ebay_listing_factory_effects_v1(timestamptz)
  from public, anon, authenticated;
revoke all on function public.recompute_ebay_listing_factory_run_v1(uuid)
  from public, anon, authenticated;

grant execute on function public.initialize_ebay_listing_factory_run_v1(uuid,text,uuid)
  to service_role;
grant execute on function public.append_ebay_listing_factory_dossier_v1(
  uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,numeric,text,
  timestamptz,timestamptz,text
) to service_role;
grant execute on function public.claim_ebay_listing_factory_candidate_v1(uuid,text,timestamptz,integer)
  to service_role;
grant execute on function public.claim_ebay_listing_factory_candidate_by_id_v1(
  uuid,uuid,text,timestamptz,integer
) to service_role;
grant execute on function public.release_ebay_listing_factory_candidate_v1(
  uuid,text,uuid,timestamptz
) to service_role;
grant execute on function public.heartbeat_ebay_listing_factory_candidate_v1(uuid,text,uuid,timestamptz)
  to service_role;
grant execute on function public.transition_ebay_listing_factory_candidate_v1(
  uuid,text,text,text,integer,text,jsonb,text,text,uuid,text,text,uuid,text
) to service_role;
grant execute on function public.quarantine_ebay_listing_factory_candidate_v1(
  uuid,text,uuid,text,text,text,text,text,text,jsonb,text,text,jsonb,boolean,uuid,text
) to service_role;
grant execute on function public.quarantine_ebay_listing_factory_legacy_dead_letter_v1(
  uuid,text,text,text,text,uuid,text
) to service_role;
grant execute on function public.replay_ebay_listing_factory_quarantine_v1(
  uuid,text,boolean,uuid,text
) to service_role;
grant execute on function public.open_ebay_listing_factory_circuit_v1(
  text,text,text,text,text,timestamptz
) to service_role;
grant execute on function public.claim_ebay_listing_factory_circuit_probe_v1(
  text,text,text,text,timestamptz,integer
) to service_role;
grant execute on function public.resolve_ebay_listing_factory_circuit_probe_v1(
  text,text,text,text,boolean,text,text,timestamptz,timestamptz
) to service_role;
grant execute on function public.prepare_ebay_listing_factory_effect_v1(
  uuid,uuid,uuid,text,text,text,text,integer,text,text,jsonb,text
) to service_role;
grant execute on function public.claim_ebay_listing_factory_effect_v1(text,timestamptz)
  to service_role;
grant execute on function public.record_ebay_listing_factory_effect_result_v1(
  uuid,text,uuid,text,text,integer,text,jsonb,text,text
) to service_role;
grant execute on function public.recover_expired_ebay_listing_factory_effects_v1(timestamptz)
  to service_role;
grant execute on function public.recompute_ebay_listing_factory_run_v1(uuid)
  to service_role;

commit;
