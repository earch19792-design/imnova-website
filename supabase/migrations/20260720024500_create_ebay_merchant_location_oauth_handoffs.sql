-- One-shot OAuth handoff for creating the single verified Luna warehouse.
-- Authorization codes, access tokens, refresh tokens and the street address
-- are never persisted here.

create table if not exists public.ebay_merchant_location_oauth_handoffs (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  account_key text not null,
  actor_user_id uuid not null,
  purpose text not null,
  expected_identity_fingerprint text not null,
  payload_fingerprint text not null,
  status text not null default 'pending',
  result_code text null,
  error_code text null,
  ebay_writes smallint not null default 0,
  expires_at timestamptz not null,
  claimed_at timestamptz null,
  finished_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_merchant_location_oauth_state_hash_check check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_merchant_location_oauth_account_key_check check (
    account_key ~ '^[A-Za-z0-9._:-]{3,160}$'
  ),
  constraint ebay_merchant_location_oauth_purpose_check check (
    purpose = 'CREATE_LUNA_BOCA_RATON_LOCATION'
  ),
  constraint ebay_merchant_location_oauth_identity_check check (
    expected_identity_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_merchant_location_oauth_payload_check check (
    payload_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_merchant_location_oauth_status_check check (
    status in ('pending', 'claimed', 'ready', 'failed', 'expired')
  ),
  constraint ebay_merchant_location_oauth_result_check check (
    result_code is null or result_code ~ '^[A-Z0-9_]{3,80}$'
  ),
  constraint ebay_merchant_location_oauth_error_check check (
    error_code is null or error_code ~ '^[A-Z0-9_]{3,160}$'
  ),
  constraint ebay_merchant_location_oauth_writes_check check (
    ebay_writes in (0, 1)
  ),
  constraint ebay_merchant_location_oauth_expiry_check check (
    expires_at > created_at
  )
);

create index if not exists ebay_merchant_location_oauth_expiry_idx
  on public.ebay_merchant_location_oauth_handoffs (status, expires_at);

alter table public.ebay_merchant_location_oauth_handoffs enable row level security;
alter table public.ebay_merchant_location_oauth_handoffs force row level security;
revoke all on table public.ebay_merchant_location_oauth_handoffs from public;
revoke all on table public.ebay_merchant_location_oauth_handoffs
  from anon, authenticated;
grant select, insert, update, delete
  on table public.ebay_merchant_location_oauth_handoffs to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ebay_merchant_location_oauth_handoffs'
      and policyname = 'ebay_merchant_location_oauth_service_role'
  ) then
    create policy ebay_merchant_location_oauth_service_role
      on public.ebay_merchant_location_oauth_handoffs
      for all to service_role using (true) with check (true);
  end if;
end
$$;

comment on table public.ebay_merchant_location_oauth_handoffs is
  'State-only, one-shot sell.inventory consent for the fixed Luna Boca Raton warehouse; never stores OAuth credentials or address data.';

notify pgrst, 'reload schema';
