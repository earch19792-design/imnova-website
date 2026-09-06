-- Reuse the existing Mayel task queue, Product Research plans and operational
-- learning ledger. This table stores only the separate, reusable owner
-- authority required for validated PRICE-only optimization.

create table public.ebay_mayel_price_optimization_delegation_authorities_v1 (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace_id text not null,
  scope text not null,
  contract_version text not null,
  allowed_actions jsonb not null,
  forbidden_actions jsonb not null,
  validation_policy jsonb not null,
  source_authority text not null,
  account_identity_authority text not null,
  authority_digest text not null unique,
  status text not null,
  owner_confirmed_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_mayel_price_delegation_scope_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
    and scope = 'VALIDATED_PRICE_OPTIMIZATION'
    and contract_version = 'MAYEL_VALIDATED_PRICE_OPTIMIZATION_DELEGATION_V1'
    and source_authority = 'OWNER_ONE_TIME_VALIDATED_PRICE_DELEGATION'
    and account_identity_authority = 'EBAY_OFFICIAL_IDENTITY_BOUND'
  ),
  constraint ebay_mayel_price_delegation_actions_check check (
    allowed_actions = '["PRICE_ONLY"]'::jsonb
    and forbidden_actions =
      '["QUANTITY","CATEGORY","CONDITION","BUSINESS_POLICIES","PRODUCT_IDENTITY","SKU","BUYER_MESSAGES","RETURNS","SPEND","PROMOTIONS","SEND_OFFERS"]'::jsonb
    and validation_policy = jsonb_build_object(
      'marketEvidenceFresh', true,
      'defensibleMarketPriceProven', true,
      'economicsProven', true,
      'stockSafe', true,
      'noActiveExperimentConflict', true,
      'pricePolicyPass', true,
      'targetProfitMaySetMarketPrice', false,
      'officialPrewriteReadbackRequired', true,
      'officialPostwriteReadbackRequired', true
    )
  ),
  constraint ebay_mayel_price_delegation_digest_check check (
    authority_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_mayel_price_delegation_status_check check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
    or (status = 'REVOKED' and revoked_at is not null and revoked_by is not null)
  )
);

create unique index ebay_mayel_price_delegation_active_account_uidx
  on public.ebay_mayel_price_optimization_delegation_authorities_v1(
    marketplace_account_key, marketplace_id
  ) where status = 'ACTIVE';

create index ebay_mayel_price_delegation_owner_created_idx
  on public.ebay_mayel_price_optimization_delegation_authorities_v1(
    owner_user_id, created_at desc
  );

create or replace function public.enforce_ebay_mayel_price_delegation_v1()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.marketplace_id is distinct from old.marketplace_id
    or new.scope is distinct from old.scope
    or new.contract_version is distinct from old.contract_version
    or new.allowed_actions is distinct from old.allowed_actions
    or new.forbidden_actions is distinct from old.forbidden_actions
    or new.validation_policy is distinct from old.validation_policy
    or new.source_authority is distinct from old.source_authority
    or new.account_identity_authority is distinct from old.account_identity_authority
    or new.authority_digest is distinct from old.authority_digest
    or new.owner_confirmed_at is distinct from old.owner_confirmed_at
    or new.created_at is distinct from old.created_at then
    raise exception 'MAYEL_PRICE_DELEGATION_SCOPE_IMMUTABLE';
  end if;
  if old.status <> 'ACTIVE' or new.status <> 'REVOKED'
    or new.revoked_at is null or new.revoked_by is null then
    raise exception 'MAYEL_PRICE_DELEGATION_REVOCATION_INVALID';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger enforce_ebay_mayel_price_delegation_v1
before update on public.ebay_mayel_price_optimization_delegation_authorities_v1
for each row execute function public.enforce_ebay_mayel_price_delegation_v1();

create or replace function public.reject_ebay_mayel_price_delegation_delete_v1()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'MAYEL_PRICE_DELEGATION_LEDGER_APPEND_ONLY';
end;
$$;

create trigger reject_ebay_mayel_price_delegation_delete_v1
before delete on public.ebay_mayel_price_optimization_delegation_authorities_v1
for each row execute function public.reject_ebay_mayel_price_delegation_delete_v1();

alter table public.ebay_mayel_price_optimization_delegation_authorities_v1
  enable row level security;
alter table public.ebay_mayel_price_optimization_delegation_authorities_v1
  force row level security;
revoke all on table public.ebay_mayel_price_optimization_delegation_authorities_v1
  from public, anon, authenticated;
grant select, insert, update on table
  public.ebay_mayel_price_optimization_delegation_authorities_v1 to service_role;

revoke all on function public.enforce_ebay_mayel_price_delegation_v1()
  from public, anon, authenticated;
revoke all on function public.reject_ebay_mayel_price_delegation_delete_v1()
  from public, anon, authenticated;

comment on table public.ebay_mayel_price_optimization_delegation_authorities_v1 is
  'Reusable owner authority for Seller OS validated PRICE-only optimization. Mayel recommends; Seller OS calculates, gates and reads back. No quantity, promotion, offer, policy or product authority.';

notify pgrst, 'reload schema';
