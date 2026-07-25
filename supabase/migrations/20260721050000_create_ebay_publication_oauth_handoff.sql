-- One-time, operator-assisted OAuth consent for the isolated eBay publication
-- credential profile. The callback stores only an RSA-encrypted credential
-- bundle; plaintext credentials never enter Postgres.

create table if not exists public.ebay_publication_oauth_handoffs (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  public_key_pem text not null,
  account_key text not null,
  expected_identity_fingerprint text not null,
  requested_by uuid null,
  status text not null default 'pending',
  encrypted_credential_bundle text null,
  credential_bundle_version text null,
  credential_fingerprint text null,
  identity_match boolean null,
  fingerprint_match boolean null,
  inventory_scope_confirmed boolean null,
  account_scope_confirmed boolean null,
  error_code text null,
  expires_at timestamptz not null,
  claimed_at timestamptz null,
  ready_at timestamptz null,
  installed_at timestamptz null,
  ciphertext_cleared_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ebay_publication_oauth_state_hash_check check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_publication_oauth_account_key_check check (
    char_length(account_key) between 66 and 160
  ),
  constraint ebay_publication_oauth_identity_fingerprint_check check (
    expected_identity_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_publication_oauth_credential_fingerprint_check check (
    credential_fingerprint is null
    or credential_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_publication_oauth_status_check check (status in (
    'pending', 'claimed', 'ready', 'installed', 'failed', 'expired'
  )),
  constraint ebay_publication_oauth_error_code_check check (
    error_code is null or error_code ~ '^[A-Z0-9_]{3,180}$'
  ),
  constraint ebay_publication_oauth_ciphertext_lifecycle_check check (
    (status in ('pending', 'claimed', 'failed', 'expired')
      and encrypted_credential_bundle is null)
    or (status = 'ready'
      and encrypted_credential_bundle is not null
      and credential_bundle_version =
        'EBAY_PUBLICATION_OAUTH_CREDENTIAL_BUNDLE_V1'
      and credential_fingerprint is not null
      and identity_match is true
      and fingerprint_match is true
      and inventory_scope_confirmed is true
      and account_scope_confirmed is true
      and ready_at is not null)
    or (status = 'installed'
      and encrypted_credential_bundle is null
      and credential_bundle_version =
        'EBAY_PUBLICATION_OAUTH_CREDENTIAL_BUNDLE_V1'
      and credential_fingerprint is not null
      and identity_match is true
      and fingerprint_match is true
      and inventory_scope_confirmed is true
      and account_scope_confirmed is true
      and installed_at is not null
      and ciphertext_cleared_at is not null)
  )
);

create unique index if not exists ebay_publication_oauth_one_active_uidx
  on public.ebay_publication_oauth_handoffs ((true))
  where status in ('pending', 'claimed', 'ready');

create index if not exists ebay_publication_oauth_created_idx
  on public.ebay_publication_oauth_handoffs (created_at desc);

alter table public.ebay_publication_oauth_handoffs enable row level security;
alter table public.ebay_publication_oauth_handoffs force row level security;

revoke all on table public.ebay_publication_oauth_handoffs from public;
revoke all on table public.ebay_publication_oauth_handoffs
  from anon, authenticated;
grant select, insert, update on table public.ebay_publication_oauth_handoffs
  to service_role;

comment on table public.ebay_publication_oauth_handoffs is
  'Ephemeral OAuth handoff for the isolated eBay publication credential profile. Stores ciphertext only, performs zero eBay writes, and remains service-role-only.';

notify pgrst, 'reload schema';
