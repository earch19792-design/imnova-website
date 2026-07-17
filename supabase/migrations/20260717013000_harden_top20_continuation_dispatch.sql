-- Additive Preview/staging reliability state for the Loop 2 Top 20 continuation
-- dispatcher. Dispatch diagnostics are sanitized and never contain tokens,
-- cookies, authorization headers, response bodies, buyer PII, or marketplace data.

alter table public.marketplace_listing_approval_queue_runs
  add column if not exists continuation_generation integer not null default 0,
  add column if not exists continuation_dispatch_status text not null default 'NOT_SCHEDULED',
  add column if not exists dispatch_attempt_count integer not null default 0,
  add column if not exists dispatch_recovery_count integer not null default 0,
  add column if not exists last_checkpoint_at timestamptz null,
  add column if not exists last_dispatch_error_class text null,
  add column if not exists last_dispatch_http_status integer null,
  add column if not exists last_dispatch_elapsed_ms integer null,
  add column if not exists last_dispatch_observed_at timestamptz null,
  add column if not exists last_dispatch_host_fingerprint text null,
  add column if not exists last_dispatch_bypass_configured boolean not null default false,
  add column if not exists last_dispatch_protection_cookie_present boolean not null default false,
  add column if not exists last_dispatch_x_vercel_id text null,
  add column if not exists last_queue_message_fingerprint text null,
  add column if not exists ebay_first_status text not null default 'NOT_STARTED',
  add column if not exists ebay_first_category_count integer not null default 0,
  add column if not exists ebay_first_signal_count integer not null default 0,
  add column if not exists ebay_first_exact_luna_match_count integer not null default 0,
  add column if not exists ebay_first_match_counts jsonb not null default '{}'::jsonb,
  add column if not exists ebay_first_observed_at timestamptz null;

alter table public.marketplace_listing_approval_queue_runs
  add constraint marketplace_listing_approval_queue_runs_dispatch_status_check
    check (continuation_dispatch_status in (
      'NOT_SCHEDULED','DISPATCHING','RETRY_SCHEDULED','QUEUED',
      'PAUSED_DISPATCH_RECOVERABLE','COMPLETED'
    )),
  add constraint marketplace_listing_approval_queue_runs_dispatch_counts_check
    check (least(continuation_generation, dispatch_attempt_count, dispatch_recovery_count) >= 0),
  add constraint marketplace_listing_approval_queue_runs_dispatch_error_class_check
    check (last_dispatch_error_class is null or last_dispatch_error_class in (
      'PROTECTION_REJECTED','AUTH_REJECTED','TOKEN_REJECTED','RATE_LIMITED',
      'TIMEOUT','NETWORK_ERROR','SERVER_ERROR','INVALID_ORIGIN'
    )),
  add constraint marketplace_listing_approval_queue_runs_dispatch_http_check
    check (last_dispatch_http_status is null or last_dispatch_http_status between 100 and 599),
  add constraint marketplace_listing_approval_queue_runs_dispatch_elapsed_check
    check (last_dispatch_elapsed_ms is null or last_dispatch_elapsed_ms between 0 and 300000),
  add constraint marketplace_listing_approval_queue_runs_dispatch_host_check
    check (last_dispatch_host_fingerprint is null or
      last_dispatch_host_fingerprint ~ '^sha256:[0-9a-f]{16}$'),
  add constraint marketplace_listing_approval_queue_runs_dispatch_message_check
    check (last_queue_message_fingerprint is null or
      last_queue_message_fingerprint ~ '^sha256:[0-9a-f]{16}$'),
  add constraint marketplace_listing_approval_queue_runs_dispatch_vercel_id_check
    check (last_dispatch_x_vercel_id is null or (
      char_length(last_dispatch_x_vercel_id) between 1 and 256
      and last_dispatch_x_vercel_id !~ '[[:cntrl:]]'
    )),
  add constraint marketplace_listing_approval_queue_runs_ebay_first_status_check
    check (ebay_first_status in (
      'NOT_STARTED','RUNNING','COMPLETED','UNAVAILABLE','FAILED_RECOVERABLE'
    )),
  add constraint marketplace_listing_approval_queue_runs_ebay_first_counts_check
    check (least(ebay_first_category_count, ebay_first_signal_count,
      ebay_first_exact_luna_match_count) >= 0),
  add constraint marketplace_listing_approval_queue_runs_ebay_first_match_counts_check
    check (jsonb_typeof(ebay_first_match_counts) = 'object');

alter table public.marketplace_listing_approval_queue_scan_targets
  add column if not exists discovery_strategy text not null default 'LUNA_FIRST',
  add column if not exists ebay_first_rank integer null,
  add column if not exists ebay_first_luna_match_status text not null default 'NOT_APPLICABLE',
  add column if not exists ebay_first_evidence_snapshot jsonb not null default '{}'::jsonb;

alter table public.marketplace_listing_approval_queue_scan_targets
  add constraint marketplace_listing_approval_queue_targets_strategy_check
    check (discovery_strategy in ('EBAY_FIRST','LUNA_FIRST')),
  add constraint marketplace_listing_approval_queue_targets_ebay_rank_check
    check (ebay_first_rank is null or ebay_first_rank between 1 and 1000000),
  add constraint marketplace_listing_approval_queue_targets_luna_match_check
    check (ebay_first_luna_match_status in (
      'NOT_APPLICABLE','EXACT_LUNA_MATCH','NEAR_LUNA_MATCH','DIFFERENT_VARIANT',
      'DIFFERENT_SIZE','DIFFERENT_PACK','NO_LUNA_MATCH','CONFLICTED'
    )),
  add constraint marketplace_listing_approval_queue_targets_ebay_evidence_check
    check (jsonb_typeof(ebay_first_evidence_snapshot) = 'object');

alter table public.marketplace_listing_approval_queue_items
  add column if not exists discovery_strategy text not null default 'LUNA_FIRST',
  add column if not exists luna_match_status text not null default 'NOT_APPLICABLE';

alter table public.marketplace_listing_approval_queue_items
  add constraint marketplace_listing_approval_queue_items_strategy_check
    check (discovery_strategy in ('EBAY_FIRST','LUNA_FIRST')),
  add constraint marketplace_listing_approval_queue_items_luna_match_check
    check (luna_match_status in (
      'NOT_APPLICABLE','EXACT_LUNA_MATCH','NEAR_LUNA_MATCH','DIFFERENT_VARIANT',
      'DIFFERENT_SIZE','DIFFERENT_PACK','NO_LUNA_MATCH','CONFLICTED'
    ));

create index if not exists marketplace_listing_approval_queue_targets_strategy_idx
  on public.marketplace_listing_approval_queue_scan_targets(
    run_id, status, discovery_strategy, ebay_first_rank, ordinal
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
    order by
      case target.discovery_strategy when 'EBAY_FIRST' then 0 else 1 end,
      target.ebay_first_rank nulls last,
      case target.source_priority
        when 'RADAR_TOP5' then 0
        when 'PRIOR_INTELLIGENCE' then 1
        else 2
      end,
      target.ordinal
    for update skip locked
    limit p_limit
  )
  update public.marketplace_listing_approval_queue_scan_targets target
  set status = 'CLAIMED',
      processing_phase = (select run.scan_phase
        from public.marketplace_listing_approval_queue_runs run where run.id = target.run_id),
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

revoke all on function public.claim_marketplace_listing_top20_targets(uuid,text,text,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_marketplace_listing_top20_targets(uuid,text,text,integer,timestamptz)
  to service_role;

create table if not exists public.marketplace_listing_approval_queue_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.marketplace_listing_approval_queue_runs(id) on delete cascade,
  marketplace_account_key text not null,
  marketplace text not null,
  continuation_generation integer not null,
  attempt_number integer not null,
  transport text not null,
  outcome text not null,
  http_status integer null,
  error_class text null,
  elapsed_ms integer not null,
  host_fingerprint text null,
  bypass_configured boolean not null default false,
  protection_cookie_present boolean not null default false,
  x_vercel_id text null,
  queue_message_fingerprint text null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint marketplace_listing_approval_queue_dispatch_attempts_identity
    unique (run_id, continuation_generation, attempt_number, transport),
  constraint marketplace_listing_approval_queue_dispatch_attempts_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_listing_approval_queue_dispatch_attempts_generation_check
    check (continuation_generation >= 0 and attempt_number between 1 and 1000000),
  constraint marketplace_listing_approval_queue_dispatch_attempts_transport_check
    check (transport in ('VERCEL_QUEUE','HTTP_FALLBACK')),
  constraint marketplace_listing_approval_queue_dispatch_attempts_outcome_check
    check (outcome in ('ACCEPTED','RETRYABLE_ERROR','PERMANENT_ERROR','PAUSED_RECOVERABLE')),
  constraint marketplace_listing_approval_queue_dispatch_attempts_error_class_check
    check (error_class is null or error_class in (
      'PROTECTION_REJECTED','AUTH_REJECTED','TOKEN_REJECTED','RATE_LIMITED',
      'TIMEOUT','NETWORK_ERROR','SERVER_ERROR','INVALID_ORIGIN'
    )),
  constraint marketplace_listing_approval_queue_dispatch_attempts_http_check
    check (http_status is null or http_status between 100 and 599),
  constraint marketplace_listing_approval_queue_dispatch_attempts_elapsed_check
    check (elapsed_ms between 0 and 300000),
  constraint marketplace_listing_approval_queue_dispatch_attempts_host_check
    check (host_fingerprint is null or host_fingerprint ~ '^sha256:[0-9a-f]{16}$'),
  constraint marketplace_listing_approval_queue_dispatch_attempts_message_check
    check (queue_message_fingerprint is null or queue_message_fingerprint ~ '^sha256:[0-9a-f]{16}$'),
  constraint marketplace_listing_approval_queue_dispatch_attempts_vercel_id_check
    check (x_vercel_id is null or (
      char_length(x_vercel_id) between 1 and 256 and x_vercel_id !~ '[[:cntrl:]]'
    ))
);

create index if not exists marketplace_listing_approval_queue_dispatch_attempts_run_idx
  on public.marketplace_listing_approval_queue_dispatch_attempts(
    marketplace_account_key, marketplace, run_id, observed_at desc
  );

create index if not exists marketplace_listing_approval_queue_runs_dispatch_idx
  on public.marketplace_listing_approval_queue_runs(
    marketplace_account_key, marketplace, continuation_dispatch_status, updated_at desc
  );

alter table public.marketplace_listing_approval_queue_dispatch_attempts enable row level security;

revoke all on table public.marketplace_listing_approval_queue_dispatch_attempts
  from anon, authenticated, service_role;
grant select, insert on table public.marketplace_listing_approval_queue_dispatch_attempts
  to service_role;

notify pgrst, 'reload schema';
