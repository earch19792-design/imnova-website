-- One-time encrypted handoff for assisted eBay Commercial Orders OAuth.
-- Authorization codes and plaintext access/refresh tokens are never stored.

create table if not exists public.ebay_commercial_oauth_handoffs (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  public_key_pem text not null,
  encrypted_refresh_token text null,
  status text not null default 'pending',
  identity_match boolean null,
  fulfillment_scope_confirmed boolean null,
  error_code text null,
  expires_at timestamptz not null,
  claimed_at timestamptz null,
  ready_at timestamptz null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_commercial_oauth_handoffs_state_hash_check check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_commercial_oauth_handoffs_public_key_check check (
    char_length(public_key_pem) between 700 and 1600
    and public_key_pem like '-----BEGIN PUBLIC KEY-----%'
  ),
  constraint ebay_commercial_oauth_handoffs_ciphertext_check check (
    encrypted_refresh_token is null
    or char_length(encrypted_refresh_token) between 100 and 12000
  ),
  constraint ebay_commercial_oauth_handoffs_status_check check (
    status in ('pending', 'claimed', 'ready', 'consumed', 'failed', 'expired')
  ),
  constraint ebay_commercial_oauth_handoffs_error_code_check check (
    error_code is null or error_code ~ '^[A-Z0-9_]{3,160}$'
  ),
  constraint ebay_commercial_oauth_handoffs_expiry_check check (
    expires_at > created_at
  )
);

create index if not exists ebay_commercial_oauth_handoffs_expiry_idx
  on public.ebay_commercial_oauth_handoffs (status, expires_at);

alter table public.ebay_commercial_oauth_handoffs enable row level security;
alter table public.ebay_commercial_oauth_handoffs force row level security;

revoke all on table public.ebay_commercial_oauth_handoffs from public;
revoke all on table public.ebay_commercial_oauth_handoffs from anon, authenticated;
grant select, insert, update, delete
  on table public.ebay_commercial_oauth_handoffs to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ebay_commercial_oauth_handoffs'
      and policyname = 'ebay_commercial_oauth_handoffs_service_role'
  ) then
    create policy ebay_commercial_oauth_handoffs_service_role
      on public.ebay_commercial_oauth_handoffs
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end
$$;
