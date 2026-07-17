-- Additive Preview/staging persistence for a one-click, resumable Loop 2 Top 20 scan.
-- No automatic cron, OpenAI call, marketplace write, buyer PII, credential or competitor content.

alter table public.marketplace_listing_approval_queue_runs
  add column if not exists automation_status text not null default 'NOT_STARTED',
  add column if not exists scan_phase text not null default 'DISCOVERY',
  add column if not exists continuation_token_hash text null,
  add column if not exists continuation_attempt_count integer not null default 0,
  add column if not exists current_batch integer not null default 0,
  add column if not exists batch_size integer not null default 3,
  add column if not exists time_budget_seconds integer not null default 45,
  add column if not exists last_activity_at timestamptz null,
  add column if not exists next_continuation_at timestamptz null,
  add column if not exists exact_match_count integer not null default 0,
  add column if not exists excluded_internal_count integer not null default 0,
  add column if not exists discovery_examined_count integer not null default 0,
  add column if not exists preselected_count integer not null default 0,
  add column if not exists deep_analyzed_count integer not null default 0,
  add column if not exists go_count integer not null default 0,
  add column if not exists go_with_changes_count integer not null default 0,
  add column if not exists no_go_count integer not null default 0,
  add column if not exists priority_counts jsonb not null default '{}'::jsonb,
  add column if not exists diagnostic_counts jsonb not null default '{}'::jsonb;

alter table public.marketplace_listing_approval_queue_runs
  add constraint marketplace_listing_approval_queue_runs_automation_status_check
    check (automation_status in (
      'NOT_STARTED','RUNNING','PAUSED_RATE_LIMIT','PARTIAL_AUTO_CONTINUING','COMPLETED','FAILED'
    )),
  add constraint marketplace_listing_approval_queue_runs_scan_phase_check
    check (scan_phase in ('DISCOVERY','PRESELECTION','LOOP1_ANALYSIS','COMPLETED')),
  add constraint marketplace_listing_approval_queue_runs_continuation_hash_check
    check (continuation_token_hash is null or continuation_token_hash ~ '^sha256:[0-9a-f]{64}$'),
  add constraint marketplace_listing_approval_queue_runs_automation_values_check
    check (least(continuation_attempt_count,current_batch,batch_size,time_budget_seconds,
      exact_match_count,excluded_internal_count,discovery_examined_count,
      preselected_count,deep_analyzed_count,go_count,go_with_changes_count,no_go_count) >= 0
      and batch_size between 1 and 10
      and time_budget_seconds between 10 and 240),
  add constraint marketplace_listing_approval_queue_runs_automation_json_check
    check (jsonb_typeof(priority_counts) = 'object' and jsonb_typeof(diagnostic_counts) = 'object');

create index if not exists marketplace_listing_approval_queue_runs_automation_idx
  on public.marketplace_listing_approval_queue_runs(
    marketplace_account_key, marketplace, automation_status, updated_at desc
  );

create table if not exists public.marketplace_listing_approval_queue_scan_targets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.marketplace_listing_approval_queue_runs(id) on delete cascade,
  marketplace_account_key text not null,
  marketplace text not null,
  ordinal integer not null,
  source_priority text not null,
  market_radar_product_id uuid not null references public.market_radar_products(id) on delete restrict,
  supplier_product_id text null,
  supplier_variant_id text null,
  supplier_sku text null,
  deduplication_key_hash text not null,
  status text not null default 'PENDING',
  processing_phase text null,
  discovery_score numeric(7,3) null,
  discovery_snapshot jsonb not null default '{}'::jsonb,
  preselected boolean not null default false,
  discovery_observed_at timestamptz null,
  deep_analyzed_at timestamptz null,
  attempt_count integer not null default 0,
  lease_owner text null,
  lease_expires_at timestamptz null,
  next_retry_at timestamptz null,
  last_error_code text null,
  claimed_at timestamptz null,
  processed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listing_approval_queue_targets_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_listing_approval_queue_targets_source_check
    check (source_priority in ('RADAR_TOP5','PRIOR_INTELLIGENCE','LUNA_CATALOG')),
  constraint marketplace_listing_approval_queue_targets_status_check
    check (status in ('PENDING','CLAIMED','DISCOVERED','PRESELECTED','PROCESSED','RETRY_REQUIRED','SKIPPED')),
  constraint marketplace_listing_approval_queue_targets_phase_check
    check (processing_phase is null or processing_phase in ('DISCOVERY','LOOP1_ANALYSIS')),
  constraint marketplace_listing_approval_queue_targets_values_check
    check (ordinal >= 0 and attempt_count >= 0
      and (discovery_score is null or discovery_score between 0 and 100)),
  constraint marketplace_listing_approval_queue_targets_snapshot_check
    check (jsonb_typeof(discovery_snapshot) = 'object'),
  constraint marketplace_listing_approval_queue_targets_hash_check
    check (deduplication_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint marketplace_listing_approval_queue_targets_error_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]+$'),
  constraint marketplace_listing_approval_queue_targets_ordinal_unique
    unique (run_id, ordinal),
  constraint marketplace_listing_approval_queue_targets_dedup_unique
    unique (run_id, deduplication_key_hash)
);

create index if not exists marketplace_listing_approval_queue_targets_claim_idx
  on public.marketplace_listing_approval_queue_scan_targets(
    run_id, status, next_retry_at, ordinal
  );
create index if not exists marketplace_listing_approval_queue_targets_identity_idx
  on public.marketplace_listing_approval_queue_scan_targets(
    marketplace_account_key, marketplace, market_radar_product_id, supplier_variant_id
  );

create or replace function public.claim_marketplace_listing_top20_targets(
  p_run_id uuid,
  p_marketplace_account_key text,
  p_worker_id text,
  p_limit integer,
  p_now timestamptz default now()
)
returns setof public.marketplace_listing_approval_queue_scan_targets
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limit < 1 or p_limit > 10 or length(trim(p_worker_id)) < 8 then
    raise exception 'TOP20_TARGET_CLAIM_INPUT_INVALID';
  end if;

  return query
  with candidates as (
    select target.id
    from public.marketplace_listing_approval_queue_scan_targets target
    join public.marketplace_listing_approval_queue_runs run on run.id = target.run_id
    where target.run_id = p_run_id
      and target.marketplace_account_key = p_marketplace_account_key
      and target.marketplace = 'EBAY_US'
      and (
        (run.scan_phase = 'DISCOVERY' and target.status = 'PENDING')
        or (run.scan_phase = 'LOOP1_ANALYSIS' and target.status = 'PRESELECTED')
        or (target.status = 'RETRY_REQUIRED' and coalesce(target.next_retry_at, p_now) <= p_now)
        or (target.status = 'CLAIMED' and target.lease_expires_at <= p_now)
      )
    order by target.ordinal
    for update skip locked
    limit p_limit
  )
  update public.marketplace_listing_approval_queue_scan_targets target
  set status = 'CLAIMED',
      processing_phase = (select run.scan_phase from public.marketplace_listing_approval_queue_runs run
        where run.id = target.run_id),
      attempt_count = target.attempt_count + 1,
      lease_owner = p_worker_id,
      lease_expires_at = p_now + interval '5 minutes',
      claimed_at = p_now,
      updated_at = p_now
  from candidates
  where target.id = candidates.id
  returning target.*;
end;
$$;

alter table public.marketplace_listing_approval_queue_scan_targets enable row level security;

revoke all on table public.marketplace_listing_approval_queue_scan_targets from anon, authenticated, service_role;
grant select, insert, update on table public.marketplace_listing_approval_queue_scan_targets to service_role;

revoke all on function public.claim_marketplace_listing_top20_targets(uuid,text,text,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_marketplace_listing_top20_targets(uuid,text,text,integer,timestamptz)
  to service_role;

notify pgrst, 'reload schema';
