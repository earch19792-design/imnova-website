create table if not exists public.ebay_commercial_improvement_executions (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  commercial_event_id uuid not null references public.commercial_alert_events(id) on delete restrict,
  active_listing_id uuid not null references public.ebay_active_listings(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  listing_id text not null,
  sku text null,
  action_type text not null,
  target_value jsonb not null,
  request_hash text not null,
  idempotency_key_hash text not null unique,
  phase text not null default 'preview_ready',
  preflight_snapshot jsonb null,
  postflight_snapshot jsonb null,
  ebay_resource_id text null,
  ebay_write_attempt_count integer not null default 0,
  ebay_write_dispatched boolean not null default false,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_verified_at timestamptz null,
  constraint ebay_commercial_improvement_event_unique unique (commercial_event_id),
  constraint ebay_commercial_improvement_action_check check (
    action_type in ('PRICE', 'PROMOTED_LISTINGS_GENERAL')
  ),
  constraint ebay_commercial_improvement_phase_check check (
    phase in ('preview_ready', 'write_in_flight', 'write_acknowledged',
      'applied_verified', 'outcome_unknown', 'terminal_failure')
  ),
  constraint ebay_commercial_improvement_write_count_check check (
    ebay_write_attempt_count between 0 and 2
  ),
  constraint ebay_commercial_improvement_hashes_check check (
    request_hash ~ '^[0-9a-f]{64}$'
    and idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_commercial_improvement_target_check check (
    jsonb_typeof(target_value) = 'object'
  )
);

create index if not exists ebay_commercial_improvement_account_time_idx
  on public.ebay_commercial_improvement_executions(
    marketplace_account_key, created_at desc
  );

alter table public.ebay_commercial_improvement_executions enable row level security;
revoke all on table public.ebay_commercial_improvement_executions from anon, authenticated;
grant all on table public.ebay_commercial_improvement_executions to service_role;

comment on table public.ebay_commercial_improvement_executions is
  'Human-approved Seller OS actions bound to immutable commercial evidence, with eBay preflight and readback verification.';
