-- Append-only, one-shot Title-only maintenance for a verified ACTIVE listing.
-- The target title is derived server-side; this ledger never authorizes any
-- other Item field and never permits a blind retry after dispatch.

create table if not exists public.ebay_active_listing_title_revision_executions (
  id uuid primary key default gen_random_uuid(),
  listing_package_id uuid not null references public.ebay_listing_packages(id) on delete restrict,
  candidate_id uuid not null references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  opportunity_id uuid not null references public.ebay_luna_opportunity_queue(id) on delete restrict,
  manual_listing_link_id uuid not null references public.ebay_manual_listing_links(id) on delete restrict,
  active_listing_id uuid not null references public.ebay_active_listings(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  marketplace_account_key text not null,
  account_fingerprint text not null,
  ebay_item_id text not null,
  ebay_sku text not null,
  target_title text not null,
  target_title_hash text not null,
  title_strategy_version text not null,
  request_hash text not null,
  idempotency_key_hash text not null unique,
  phase text not null default 'preview_ready',
  ebay_write_attempt_count integer not null default 0,
  ebay_write_dispatched boolean not null default false,
  claim_token uuid null,
  lease_expires_at timestamptz null,
  preflight_snapshot jsonb null,
  postflight_snapshot jsonb null,
  write_http_status integer null,
  write_ack text null,
  last_error_code text null,
  reconciled boolean not null default false,
  write_started_at timestamptz null,
  write_acknowledged_at timestamptz null,
  applied_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_active_title_scope_check check (
    marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and right(marketplace_account_key, 64) = account_fingerprint
    and account_fingerprint ~ '^[0-9a-f]{64}$'
    and ebay_item_id ~ '^[0-9]{9,20}$'
    and char_length(ebay_sku) between 1 and 50
  ),
  constraint ebay_active_title_value_check check (
    char_length(target_title) between 1 and 80
    and target_title = btrim(target_title)
    and target_title !~ '[[:cntrl:]]'
    and target_title !~ '[[:space:]]{2,}'
    and target_title_hash ~ '^[0-9a-f]{64}$'
    and request_hash ~ '^[0-9a-f]{64}$'
    and idempotency_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_active_title_phase_check check (phase in (
    'preview_ready', 'write_in_flight', 'write_acknowledged',
    'outcome_unknown', 'applied_verified', 'terminal_failure'
  )),
  constraint ebay_active_title_write_limit_check check (
    ebay_write_attempt_count between 0 and 1
    and ebay_write_dispatched = (ebay_write_attempt_count = 1)
  ),
  constraint ebay_active_title_lease_check check (
    (phase = 'write_in_flight' and claim_token is not null and lease_expires_at is not null)
    or (phase <> 'write_in_flight' and claim_token is null and lease_expires_at is null)
  ),
  constraint ebay_active_title_error_check check (
    last_error_code is null or last_error_code ~ '^[A-Z0-9_]{3,160}$'
  ),
  constraint ebay_active_title_target_unique unique (active_listing_id, target_title_hash)
);

alter table public.ebay_active_listing_title_revision_executions enable row level security;
alter table public.ebay_active_listing_title_revision_executions force row level security;
revoke all on table public.ebay_active_listing_title_revision_executions from anon, authenticated;
revoke all on table public.ebay_active_listing_title_revision_executions from public, service_role;
grant select, insert, update on table public.ebay_active_listing_title_revision_executions to service_role;

create or replace function public.enforce_ebay_active_title_revision_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EBAY_ACTIVE_TITLE_REVISION_DELETE_FORBIDDEN';
  end if;
  if new.listing_package_id is distinct from old.listing_package_id
    or new.candidate_id is distinct from old.candidate_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.manual_listing_link_id is distinct from old.manual_listing_link_id
    or new.active_listing_id is distinct from old.active_listing_id
    or new.actor_user_id is distinct from old.actor_user_id
    or new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.account_fingerprint is distinct from old.account_fingerprint
    or new.ebay_item_id is distinct from old.ebay_item_id
    or new.ebay_sku is distinct from old.ebay_sku
    or new.target_title is distinct from old.target_title
    or new.target_title_hash is distinct from old.target_title_hash
    or new.title_strategy_version is distinct from old.title_strategy_version
    or new.request_hash is distinct from old.request_hash
    or new.idempotency_key_hash is distinct from old.idempotency_key_hash
    or new.created_at is distinct from old.created_at then
    raise exception 'EBAY_ACTIVE_TITLE_REVISION_SCOPE_IMMUTABLE';
  end if;
  if new.ebay_write_attempt_count < old.ebay_write_attempt_count
    or new.ebay_write_attempt_count > 1 then
    raise exception 'EBAY_ACTIVE_TITLE_REVISION_WRITE_LIMIT_REACHED';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_ebay_active_title_revision_append_only
  on public.ebay_active_listing_title_revision_executions;
create trigger enforce_ebay_active_title_revision_append_only
before update or delete on public.ebay_active_listing_title_revision_executions
for each row execute function public.enforce_ebay_active_title_revision_append_only();

revoke all on function public.enforce_ebay_active_title_revision_append_only() from public, anon, authenticated;
