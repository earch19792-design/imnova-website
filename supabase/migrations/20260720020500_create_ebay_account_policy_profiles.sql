create table if not exists public.ebay_account_policy_profiles (
  id uuid primary key default gen_random_uuid(),
  account_key text not null check (account_key ~ '^[A-Za-z0-9._:-]{3,120}$'),
  marketplace_id text not null default 'EBAY_US' check (marketplace_id = 'EBAY_US'),
  fulfillment_policy_id text not null check (fulfillment_policy_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  payment_policy_id text not null check (payment_policy_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  return_policy_id text not null check (return_policy_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  merchant_location_key text null check (
    merchant_location_key is null or merchant_location_key ~ '^[A-Za-z0-9_-]{1,100}$'
  ),
  verification_source text not null default 'EBAY_ACCOUNT_API_GET'
    check (verification_source = 'EBAY_ACCOUNT_API_GET'),
  profile_version text not null default 'EBAY_ACCOUNT_POLICY_PROFILE_V1_2026_07_20',
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  selected_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_key, marketplace_id),
  check (expires_at > verified_at)
);

comment on table public.ebay_account_policy_profiles is
  'Reusable seller-account policy IDs selected from official eBay Account API GET results; no competitor policy IDs.';

alter table public.ebay_account_policy_profiles enable row level security;
alter table public.ebay_account_policy_profiles force row level security;

revoke all on table public.ebay_account_policy_profiles from public;
revoke all on table public.ebay_account_policy_profiles from anon, authenticated;
revoke all on table public.ebay_account_policy_profiles from service_role;
grant select, insert, update on table public.ebay_account_policy_profiles to service_role;
