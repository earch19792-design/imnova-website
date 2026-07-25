-- Durable, idempotent control plane for the manually published 3-listing pilot.
-- It schedules no broad Discovery and introduces no eBay write capability.

create table if not exists public.ebay_same_day_pilot_runs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US' check (marketplace = 'EBAY_US'),
  operation_date date not null,
  run_key text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PARTIALLY_READY','READY_FOR_OPERATOR','COMPLETED','BLOCKED')),
  stage text not null default 'QUEUE_PREPARED',
  target_new_listings integer not null default 2 check (target_new_listings between 0 and 2),
  verified_existing_listings integer not null default 1 check (verified_existing_listings between 0 and 3),
  queue_count integer not null default 0 check (queue_count between 0 and 5),
  ready_for_manual_publication_count integer not null default 0 check (ready_for_manual_publication_count between 0 and 2),
  verified_new_listings integer not null default 0 check (verified_new_listings between 0 and 2),
  deep_discovery_frozen boolean not null default true check (deep_discovery_frozen),
  source_inventory jsonb not null default '{}'::jsonb,
  quota_snapshot jsonb not null default '{}'::jsonb,
  monitor_snapshot jsonb not null default '{}'::jsonb,
  next_automated_action text not null,
  next_human_action text not null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace_account_key, operation_date),
  unique (run_key)
);

create table if not exists public.ebay_same_day_pilot_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  opportunity_id uuid not null references public.ebay_luna_opportunity_queue(id) on delete restrict,
  queue_item_id uuid null references public.marketplace_listing_approval_queue_items(id) on delete set null,
  ordinal integer not null check (ordinal between 1 and 5),
  state text not null check (state in ('READY_TO_VALIDATE_TODAY','NEEDS_PRODUCT_RESEARCH_CAPTURE','NEEDS_LUNA_CONFIRMATION','NEEDS_ONE_CRITICAL_FACT','READY_FOR_CONTENT','READY_FOR_IMAGE_REVIEW','READY_FOR_MANUAL_PUBLICATION','PUBLISHED_PENDING_VERIFICATION','VERIFIED_ACTIVE','REJECTED_TODAY')),
  machine_state text not null default 'RUN_CREATED' check (machine_state in ('RUN_CREATED','LOCAL_FILTERING','CANDIDATE_SELECTION','PRODUCT_RESEARCH_PLAN_READY','WAITING_PRODUCT_RESEARCH_CAPTURE','IMPORTING_SOLD_EVIDENCE','RECONCILING_IDENTITY','MATCHING_LUNA','RUNNING_LOOP_1','CALCULATING_ECONOMICS','WAITING_LUNA_CONFIRMATION','ENRICHING_PRODUCT_FACTS','VALIDATING_TAXONOMY','VALIDATING_REGULATION','BUILDING_OPENAI_INPUT','WAITING_PRODUCT_APPROVAL','GENERATING_LISTING_CONTENT','VALIDATING_LISTING_CONTENT','PREPARING_IMAGE_PACKAGE','WAITING_IMAGE_APPROVAL','BUILDING_SELLER_HUB_HANDOFF','READY_FOR_MANUAL_PUBLICATION','WAITING_ITEM_ID','VERIFYING_PUBLISHED_LISTING','REGISTERING_COMMERCIAL_MONITOR','VERIFIED_ACTIVE','BLOCKED','REJECTED','COMPLETED')),
  candidate_key text not null,
  product_title text not null,
  supplier_sku text not null,
  supplier_variant_id text null,
  family_fingerprint text not null check (family_fingerprint ~ '^[0-9a-f]{64}$'),
  priority numeric(6,2) not null default 0 check (priority between 0 and 100),
  blockers text[] not null default '{}',
  evidence_summary jsonb not null default '{}'::jsonb,
  economics_summary jsonb not null default '{}'::jsonb,
  product_research_query_plan jsonb not null default '{}'::jsonb,
  product_facts_summary jsonb not null default '{}'::jsonb,
  image_package_summary jsonb not null default '{}'::jsonb,
  manual_handoff_package jsonb not null default '{}'::jsonb,
  calls_estimated integer not null default 0 check (calls_estimated between 0 and 20),
  listing_quantity integer null check (listing_quantity is null or listing_quantity between 1 and 1000),
  recheck_after_sale boolean not null default false,
  next_automated_action text not null,
  next_human_action text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, opportunity_id),
  unique (run_id, ordinal)
);

create table if not exists public.ebay_same_day_pilot_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid null references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  ebay_read_calls integer not null default 0 check (ebay_read_calls between 0 and 20),
  openai_calls integer not null default 0 check (openai_calls between 0 and 1),
  ebay_writes integer not null default 0 check (ebay_writes = 0),
  production_changed boolean not null default false check (not production_changed),
  created_at timestamptz not null default now()
);

create table if not exists public.ebay_same_day_pilot_transitions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid null references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  previous_state text null,
  next_state text not null,
  reason_code text not null,
  triggered_by text not null check (triggered_by in ('SYSTEM','USER','SCHEDULER','RETRY')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  attempt integer not null default 1 check (attempt between 1 and 20),
  checkpoint jsonb not null default '{}'::jsonb,
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null unique,
  next_automatic_action text not null,
  next_human_action text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ebay_same_day_pilot_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid null references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  job_type text not null,
  status text not null default 'PENDING' check (status in ('PENDING','LEASED','WAITING_RETRY','COMPLETED','DEAD_LETTER','CANCELLED')),
  idempotency_key text not null unique,
  checkpoint jsonb not null default '{}'::jsonb,
  attempt integer not null default 0 check (attempt between 0 and 20),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_owner text null,
  lease_expires_at timestamptz null,
  last_heartbeat_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ebay_same_day_pilot_human_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  gate_type text not null check (gate_type in ('PRODUCT_RESEARCH_CAPTURE_REQUIRED','LUNA_CONFIRMATION_REQUIRED','PRODUCT_APPROVAL_REQUIRED','IMAGE_APPROVAL_REQUIRED','MANUAL_PUBLICATION_REQUIRED','ITEM_ID_REQUIRED','CRITICAL_EXCEPTION_REQUIRED')),
  status text not null default 'OPEN' check (status in ('OPEN','COMPLETED','CANCELLED','SUPERSEDED')),
  title text not null,
  why_needed text not null,
  estimated_seconds integer not null check (estimated_seconds between 5 and 1800),
  impact text not null,
  evidence_summary jsonb not null default '{}'::jsonb,
  action_schema jsonb not null default '{}'::jsonb,
  continuation_job_type text not null,
  idempotency_key text not null unique,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ebay_same_day_pilot_candidates_state_idx on public.ebay_same_day_pilot_candidates(run_id,state,ordinal);
create index if not exists ebay_same_day_pilot_events_run_idx on public.ebay_same_day_pilot_events(run_id,created_at desc);
create index if not exists ebay_same_day_pilot_transitions_run_idx on public.ebay_same_day_pilot_transitions(run_id,created_at desc);
create index if not exists ebay_same_day_pilot_jobs_claim_idx on public.ebay_same_day_pilot_jobs(status,available_at,created_at);
create index if not exists ebay_same_day_pilot_tasks_inbox_idx on public.ebay_same_day_pilot_human_tasks(run_id,status,created_at);

alter table public.ebay_same_day_pilot_runs enable row level security;
alter table public.ebay_same_day_pilot_runs force row level security;
alter table public.ebay_same_day_pilot_candidates enable row level security;
alter table public.ebay_same_day_pilot_candidates force row level security;
alter table public.ebay_same_day_pilot_events enable row level security;
alter table public.ebay_same_day_pilot_events force row level security;
alter table public.ebay_same_day_pilot_transitions enable row level security;
alter table public.ebay_same_day_pilot_transitions force row level security;
alter table public.ebay_same_day_pilot_jobs enable row level security;
alter table public.ebay_same_day_pilot_jobs force row level security;
alter table public.ebay_same_day_pilot_human_tasks enable row level security;
alter table public.ebay_same_day_pilot_human_tasks force row level security;
revoke all on table public.ebay_same_day_pilot_runs from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_candidates from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_events from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_transitions from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_jobs from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_human_tasks from anon, authenticated;
grant all on table public.ebay_same_day_pilot_runs to service_role;
grant all on table public.ebay_same_day_pilot_candidates to service_role;
grant all on table public.ebay_same_day_pilot_events to service_role;
grant all on table public.ebay_same_day_pilot_transitions to service_role;
grant all on table public.ebay_same_day_pilot_jobs to service_role;
grant all on table public.ebay_same_day_pilot_human_tasks to service_role;

notify pgrst, 'reload schema';
