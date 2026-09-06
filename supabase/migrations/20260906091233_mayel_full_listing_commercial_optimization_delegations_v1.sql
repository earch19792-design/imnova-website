-- Reuse the existing Mayel workspace, visual/price authorities and operational
-- learning ledger. These tables persist only the two missing reusable owner
-- authorities: evidence-bound listing content optimization and capped ad spend.

create table public.ebay_mayel_commercial_optimization_delegation_authorities_v1 (
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
  constraint ebay_mayel_commercial_delegation_scope_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
    and scope = 'FULL_LISTING_CONTENT_AND_MARKET_OPTIMIZATION'
    and contract_version = 'MAYEL_FULL_LISTING_COMMERCIAL_OPTIMIZATION_DELEGATION_V1'
    and source_authority = 'OWNER_ONE_TIME_LISTING_COMMERCIAL_DELEGATION'
    and account_identity_authority = 'EBAY_OFFICIAL_IDENTITY_BOUND'
  ),
  constraint ebay_mayel_commercial_delegation_actions_check check (
    allowed_actions = '["TITLE","DESCRIPTION","ITEM_SPECIFICS","SUPPORTED_LISTING_ATTRIBUTES","KEYWORD_INTELLIGENCE","MARKET_REVALIDATION","CATEGORY_RECOMMENDATION"]'::jsonb
    and forbidden_actions = '["UNPROVEN_PRODUCT_FACTS","CATEGORY_AUTO_WRITE_WITHOUT_CERTIFICATION","PRICE_DIRECT_WRITE","QUANTITY","CONDITION","BUSINESS_POLICIES","SKU","PRODUCT_IDENTITY","PROMOTION","SPEND","BUYER_MESSAGES","REFUNDS","RETURNS_ACTION","ORDER_ACTION","END_LISTING","CREDENTIAL_ACCESS"]'::jsonb
    and validation_policy = jsonb_build_object(
      'productTruthRequiredForFactualWrites', true,
      'keywordsOnlyInEbaySupportedFields', true,
      'categoryWriteRequiresSeparateCertification', true,
      'freshOfficialPrewriteReadbackRequired', true,
      'correctManagementModelExecutorRequired', true,
      'singleBoundedWriteRequired', true,
      'officialPostwriteReadbackRequired', true,
      'unknownResultAutoRetry', false
    )
  ),
  constraint ebay_mayel_commercial_delegation_digest_check check (
    authority_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_mayel_commercial_delegation_status_check check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
    or (status = 'REVOKED' and revoked_at is not null and revoked_by is not null)
  )
);

create unique index ebay_mayel_commercial_delegation_active_account_uidx
  on public.ebay_mayel_commercial_optimization_delegation_authorities_v1(
    marketplace_account_key, marketplace_id
  ) where status = 'ACTIVE';

create index ebay_mayel_commercial_delegation_owner_created_idx
  on public.ebay_mayel_commercial_optimization_delegation_authorities_v1(
    owner_user_id, created_at desc
  );

create index ebay_mayel_commercial_delegation_revoked_by_idx
  on public.ebay_mayel_commercial_optimization_delegation_authorities_v1(
    revoked_by, revoked_at desc
  ) where revoked_by is not null;

create table public.ebay_mayel_promotion_spend_delegation_authorities_v1 (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace_id text not null,
  scope text not null,
  contract_version text not null,
  max_ad_spend_per_listing numeric(12,2) not null,
  max_ad_spend_per_day numeric(12,2) not null,
  max_portfolio_ad_spend_per_day numeric(12,2) not null,
  max_ad_rate_percent numeric(7,4) not null,
  min_expected_profit_after_ads numeric(12,2) not null,
  min_margin_after_ads_percent numeric(7,4) not null,
  min_roi_after_ads_percent numeric(9,4) not null,
  validation_policy jsonb not null,
  allowed_actions jsonb not null,
  forbidden_actions jsonb not null,
  source_authority text not null,
  account_identity_authority text not null,
  authority_digest text not null unique,
  status text not null,
  owner_confirmed_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_mayel_promotion_delegation_scope_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
    and scope = 'CAPPED_VALIDATED_PROMOTION_SPEND'
    and contract_version = 'MAYEL_PROMOTION_SPEND_DELEGATION_V1'
    and source_authority = 'OWNER_ONE_TIME_CAPPED_PROMOTION_DELEGATION'
    and account_identity_authority = 'EBAY_OFFICIAL_IDENTITY_BOUND'
  ),
  constraint ebay_mayel_promotion_delegation_limits_check check (
    max_ad_spend_per_listing > 0
    and max_ad_spend_per_day > 0
    and max_portfolio_ad_spend_per_day > 0
    and max_ad_rate_percent > 0 and max_ad_rate_percent <= 100
    and min_expected_profit_after_ads >= 0
    and min_margin_after_ads_percent >= 0
      and min_margin_after_ads_percent <= 100
    and min_roi_after_ads_percent >= 0
  ),
  constraint ebay_mayel_promotion_delegation_actions_check check (
    allowed_actions = '["PROMOTED_LISTINGS_CPS_ACTIVATE_OR_ADJUST_WITHIN_CEILINGS"]'::jsonb
    and forbidden_actions = '["PRICE","QUANTITY","CATEGORY","CONDITION","BUSINESS_POLICIES","PRODUCT_IDENTITY","SKU","BUYER_MESSAGES","REFUNDS","RETURNS_ACTION","ORDER_ACTION","END_LISTING","SEND_OFFERS","UNBOUNDED_SPEND"]'::jsonb
    and validation_policy = jsonb_build_object(
      'promotionCapabilityProven', true,
      'ebayAccountEligible', true,
      'economicsProven', true,
      'profitFloorRequired', true,
      'marginFloorRequired', true,
      'roiFloorRequired', true,
      'spendWithinOwnerCeilings', true,
      'noExperimentConflict', true,
      'freshOfficialPrewriteReadbackRequired', true,
      'singleBoundedWriteRequired', true,
      'officialPostwriteReadbackRequired', true,
      'unknownResultAutoRetry', false
    )
  ),
  constraint ebay_mayel_promotion_delegation_digest_check check (
    authority_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_mayel_promotion_delegation_status_check check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
    or (status = 'REVOKED' and revoked_at is not null and revoked_by is not null)
  )
);

create unique index ebay_mayel_promotion_delegation_active_account_uidx
  on public.ebay_mayel_promotion_spend_delegation_authorities_v1(
    marketplace_account_key, marketplace_id
  ) where status = 'ACTIVE';

create index ebay_mayel_promotion_delegation_owner_created_idx
  on public.ebay_mayel_promotion_spend_delegation_authorities_v1(
    owner_user_id, created_at desc
  );

create index ebay_mayel_promotion_delegation_revoked_by_idx
  on public.ebay_mayel_promotion_spend_delegation_authorities_v1(
    revoked_by, revoked_at desc
  ) where revoked_by is not null;

create or replace function public.enforce_ebay_mayel_commercial_authority_immutability_v1()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if to_jsonb(new) - array['status','revoked_at','revoked_by','updated_at']
      is distinct from
     to_jsonb(old) - array['status','revoked_at','revoked_by','updated_at'] then
    raise exception 'MAYEL_COMMERCIAL_AUTHORITY_SCOPE_IMMUTABLE';
  end if;
  if old.status <> 'ACTIVE' or new.status <> 'REVOKED'
    or new.revoked_at is null or new.revoked_by is null then
    raise exception 'MAYEL_COMMERCIAL_AUTHORITY_REVOCATION_INVALID';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.reject_ebay_mayel_commercial_authority_delete_v1()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'MAYEL_COMMERCIAL_AUTHORITY_APPEND_ONLY';
end;
$$;

create trigger enforce_ebay_mayel_commercial_delegation_v1
before update on public.ebay_mayel_commercial_optimization_delegation_authorities_v1
for each row execute function public.enforce_ebay_mayel_commercial_authority_immutability_v1();

create trigger reject_ebay_mayel_commercial_delegation_delete_v1
before delete on public.ebay_mayel_commercial_optimization_delegation_authorities_v1
for each row execute function public.reject_ebay_mayel_commercial_authority_delete_v1();

create trigger enforce_ebay_mayel_promotion_delegation_v1
before update on public.ebay_mayel_promotion_spend_delegation_authorities_v1
for each row execute function public.enforce_ebay_mayel_commercial_authority_immutability_v1();

create trigger reject_ebay_mayel_promotion_delegation_delete_v1
before delete on public.ebay_mayel_promotion_spend_delegation_authorities_v1
for each row execute function public.reject_ebay_mayel_commercial_authority_delete_v1();

alter table public.ebay_mayel_commercial_optimization_delegation_authorities_v1
  enable row level security;
alter table public.ebay_mayel_commercial_optimization_delegation_authorities_v1
  force row level security;
alter table public.ebay_mayel_promotion_spend_delegation_authorities_v1
  enable row level security;
alter table public.ebay_mayel_promotion_spend_delegation_authorities_v1
  force row level security;

revoke all on table
  public.ebay_mayel_commercial_optimization_delegation_authorities_v1,
  public.ebay_mayel_promotion_spend_delegation_authorities_v1
  from public, anon, authenticated;
grant select, insert, update on table
  public.ebay_mayel_commercial_optimization_delegation_authorities_v1,
  public.ebay_mayel_promotion_spend_delegation_authorities_v1
  to service_role;

revoke all on function
  public.enforce_ebay_mayel_commercial_authority_immutability_v1(),
  public.reject_ebay_mayel_commercial_authority_delete_v1()
  from public, anon, authenticated;

comment on table public.ebay_mayel_commercial_optimization_delegation_authorities_v1 is
  'Reusable owner delegation for evidence-bound content, supported-field keyword intelligence, and market revalidation. Category is recommendation-only unless separately certified.';
comment on table public.ebay_mayel_promotion_spend_delegation_authorities_v1 is
  'Reusable owner delegation for validated Promoted Listings CPS actions inside explicit spend ceilings and post-ad economic floors.';

notify pgrst, 'reload schema';
