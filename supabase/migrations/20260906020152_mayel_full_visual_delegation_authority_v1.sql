-- Reusable owner authority for Mayel's visual domain. This extends the
-- existing task/asset/manifest/execution records; it is not a second visual
-- runtime and it grants no publication or non-visual authority.

create table public.ebay_mayel_visual_delegation_authorities_v1 (
  id uuid primary key,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace_id text not null,
  scope text not null,
  contract_version text not null,
  allowed_actions jsonb not null,
  forbidden_actions jsonb not null,
  main_image_authority boolean not null,
  owner_per_image_approval boolean not null,
  owner_per_listing_visual_approval boolean not null,
  source_authority text not null,
  account_identity_authority text not null,
  execution_boundary_version text not null,
  authority_digest text not null unique,
  status text not null,
  owner_confirmed_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_mayel_visual_delegation_scope_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
    and scope = 'FULL_VISUAL_CONTROL'
    and contract_version = 'MAYEL_FULL_VISUAL_DELEGATION_V1'
    and source_authority = 'OWNER_ONE_TIME_FULL_VISUAL_DELEGATION'
    and account_identity_authority = 'EBAY_OFFICIAL_IDENTITY_BOUND'
    and execution_boundary_version = 'MAYEL_VISUAL_EXECUTION_BOUNDARY_V1'
  ),
  constraint ebay_mayel_visual_delegation_actions_check check (
    allowed_actions = '["MAIN_IMAGE","SECONDARY_IMAGES","IMAGE_REPLACEMENT","IMAGE_REMOVAL","IMAGE_REORDER","CROP","BACKGROUND","LIGHTING","COLOR_CORRECTION","QUALITY_ENHANCEMENT","DETAIL_IMAGES","SCALE_IMAGES","LIFESTYLE_IMAGES","PACKAGE_CONTENT_IMAGES","VISUAL_SEQUENCE_OPTIMIZATION","LIVE_LISTING_VISUAL_OPTIMIZATION"]'::jsonb
    and forbidden_actions = '["PRICE","QUANTITY","CATEGORY","CONDITION","BUSINESS_POLICIES","PRODUCT_IDENTITY","UNPROVEN_PRODUCT_FACTS","SUPPLIER","OFFER_IDENTITY","SKU","PUBLISH_NEW_LISTING","END_LISTING","BUYER_MESSAGES","REFUNDS","RETURNS","ORDERS","CREDENTIALS","INFRASTRUCTURE","PAID_PROMOTION","SPEND"]'::jsonb
    and main_image_authority = true
    and owner_per_image_approval = false
    and owner_per_listing_visual_approval = false
  ),
  constraint ebay_mayel_visual_delegation_digest_check check (
    authority_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_mayel_visual_delegation_status_check check (
    (status = 'ACTIVE' and revoked_at is null and revoked_by is null)
    or (status = 'REVOKED' and revoked_at is not null and revoked_by is not null)
  )
);

create unique index ebay_mayel_visual_delegation_active_account_uidx
  on public.ebay_mayel_visual_delegation_authorities_v1(
    marketplace_account_key, marketplace_id
  ) where status = 'ACTIVE';
create index ebay_mayel_visual_delegation_owner_created_idx
  on public.ebay_mayel_visual_delegation_authorities_v1(
    owner_user_id, created_at desc
  );

create or replace function public.enforce_ebay_mayel_visual_delegation_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.marketplace_id is distinct from old.marketplace_id
    or new.scope is distinct from old.scope
    or new.contract_version is distinct from old.contract_version
    or new.allowed_actions is distinct from old.allowed_actions
    or new.forbidden_actions is distinct from old.forbidden_actions
    or new.main_image_authority is distinct from old.main_image_authority
    or new.owner_per_image_approval is distinct from old.owner_per_image_approval
    or new.owner_per_listing_visual_approval is distinct from
      old.owner_per_listing_visual_approval
    or new.source_authority is distinct from old.source_authority
    or new.account_identity_authority is distinct from
      old.account_identity_authority
    or new.execution_boundary_version is distinct from
      old.execution_boundary_version
    or new.authority_digest is distinct from old.authority_digest
    or new.owner_confirmed_at is distinct from old.owner_confirmed_at
    or new.created_at is distinct from old.created_at then
    raise exception 'MAYEL_VISUAL_DELEGATION_SCOPE_IMMUTABLE';
  end if;
  if old.status <> 'ACTIVE' or new.status <> 'REVOKED'
    or new.revoked_at is null or new.revoked_by is null then
    raise exception 'MAYEL_VISUAL_DELEGATION_REVOCATION_INVALID';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger enforce_ebay_mayel_visual_delegation_v1
before update on public.ebay_mayel_visual_delegation_authorities_v1
for each row execute function
  public.enforce_ebay_mayel_visual_delegation_v1();

create or replace function public.reject_ebay_mayel_visual_delegation_delete_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'MAYEL_VISUAL_DELEGATION_LEDGER_APPEND_ONLY';
end;
$$;

create trigger reject_ebay_mayel_visual_delegation_delete_v1
before delete on public.ebay_mayel_visual_delegation_authorities_v1
for each row execute function
  public.reject_ebay_mayel_visual_delegation_delete_v1();

alter table public.ebay_mayel_visual_delegation_authorities_v1
  enable row level security;
alter table public.ebay_mayel_visual_delegation_authorities_v1
  force row level security;
revoke all on table public.ebay_mayel_visual_delegation_authorities_v1
  from public, anon, authenticated;
grant select, insert, update on table
  public.ebay_mayel_visual_delegation_authorities_v1 to service_role;

revoke all on function public.enforce_ebay_mayel_visual_delegation_v1()
  from public, anon, authenticated;
revoke all on function public.reject_ebay_mayel_visual_delegation_delete_v1()
  from public, anon, authenticated;

comment on table public.ebay_mayel_visual_delegation_authorities_v1 is
  'Durable reusable owner delegation for Mayel visual changes only. Service-role only; task-specific validation and official readback remain mandatory before any marketplace write.';
comment on column public.ebay_mayel_visual_delegation_authorities_v1.authority_digest is
  'Stable digest of the exact owner, account, marketplace, scope, actions, exclusions and boundary contract authorized.';

notify pgrst, 'reload schema';
