-- Owner-gated Phase B handoff for Mayel-approved canonical visual assets.
-- This is a durable authorization/execution receipt layered on the existing
-- Phase A task, asset and manifest authorities. It creates no image pipeline.

alter table public.ebay_mayel_visual_tasks_v1
  add column if not exists visual_manifest_id uuid null;

update public.ebay_mayel_visual_tasks_v1
set visual_manifest_id = gen_random_uuid()
where visual_manifest is not null and visual_manifest_id is null;

alter table public.ebay_mayel_visual_tasks_v1
  add constraint ebay_mayel_visual_manifest_id_binding_check check (
    (visual_manifest is null and visual_manifest_digest is null
      and visual_manifest_id is null)
    or (visual_manifest is not null and visual_manifest_digest is not null
      and visual_manifest_id is not null)
  );

create or replace function public.assign_ebay_mayel_visual_manifest_id_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.visual_manifest is null then
    new.visual_manifest_id := null;
  elsif new.visual_manifest_id is null
    or (tg_op = 'UPDATE' and new.visual_manifest_digest is distinct from
      old.visual_manifest_digest) then
    new.visual_manifest_id := gen_random_uuid();
  end if;
  return new;
end;
$$;

drop trigger if exists assign_ebay_mayel_visual_manifest_id_v1
  on public.ebay_mayel_visual_tasks_v1;
create trigger assign_ebay_mayel_visual_manifest_id_v1
before insert or update of visual_manifest, visual_manifest_digest
on public.ebay_mayel_visual_tasks_v1
for each row execute function public.assign_ebay_mayel_visual_manifest_id_v1();

create or replace function public.is_mayel_phase_b_image_url_set_v1(
  p_urls jsonb,
  p_main_url text
)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_urls) = 'array'
    and jsonb_array_length(p_urls) between 1 and 24
    and p_main_url = p_urls ->> 0
    and (select count(distinct value)
      from jsonb_array_elements_text(p_urls)) = jsonb_array_length(p_urls)
    and not exists (
      select 1 from jsonb_array_elements_text(p_urls) image(value)
      where image.value !~ '^https://[^[:space:][:cntrl:]]{1,1000}$'
    );
$$;

create or replace function public.is_mayel_phase_b_asset_set_v1(
  p_asset_ids jsonb,
  p_hashes jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_asset_ids) = 'array'
    and jsonb_array_length(p_asset_ids) between 1 and 6
    and jsonb_typeof(p_hashes) = 'array'
    and jsonb_array_length(p_asset_ids) = jsonb_array_length(p_hashes)
    and (select count(distinct value)
      from jsonb_array_elements_text(p_asset_ids)) = jsonb_array_length(p_asset_ids)
    and not exists (
      select 1 from jsonb_array_elements_text(p_asset_ids) asset(value)
      where asset.value !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    and not exists (
      select 1 from jsonb_array_elements_text(p_hashes) hash(value)
      where hash.value !~ '^[0-9a-f]{64}$'
    );
$$;

create table public.ebay_mayel_visual_phase_b_executions_v1 (
  id uuid primary key,
  owner_approval_id uuid not null unique,
  visual_task_id uuid not null references
    public.ebay_mayel_visual_tasks_v1(id) on delete restrict,
  visual_manifest_id uuid not null,
  active_listing_id uuid not null references
    public.ebay_active_listings(id) on delete restrict,
  listing_package_id uuid not null references
    public.ebay_listing_packages(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  marketplace_account_key text not null,
  marketplace_id text not null,
  ebay_item_id text not null,
  ebay_sku text not null,
  visual_manifest_digest text not null,
  owner_authorization_digest text not null,
  authorized_current_image_set_digest text not null,
  proposed_final_ordered_image_urls jsonb not null,
  main_image_url text not null,
  canonical_asset_ids jsonb not null,
  canonical_asset_sha256s jsonb not null,
  management_model text not null,
  management_evidence_digest text not null,
  executor text not null,
  phase text not null,
  final_state text null,
  marketplace_write_count integer not null default 0,
  claim_token uuid null,
  lease_expires_at timestamptz null,
  preflight_snapshot jsonb null,
  ebay_response_class text null,
  postwrite_snapshot jsonb null,
  last_error_code text null,
  owner_approved_at timestamptz not null,
  write_attempt_at timestamptz null,
  write_accepted_at timestamptz null,
  postwrite_readback_at timestamptz null,
  applied_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_mayel_visual_phase_b_scope_check check (
    marketplace_account_key <> 'default'
    and marketplace_account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and marketplace_id = 'EBAY_US'
    and ebay_item_id ~ '^[0-9]{9,20}$'
    and char_length(ebay_sku) between 1 and 50
    and ebay_sku !~ '[[:space:][:cntrl:]]'
  ),
  constraint ebay_mayel_visual_phase_b_digest_check check (
    visual_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
    and owner_authorization_digest = visual_manifest_digest
    and authorized_current_image_set_digest ~ '^sha256:[0-9a-f]{64}$'
    and management_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_mayel_visual_phase_b_images_check check (
    public.is_mayel_phase_b_image_url_set_v1(
      proposed_final_ordered_image_urls, main_image_url)
    and public.is_mayel_phase_b_asset_set_v1(
      canonical_asset_ids, canonical_asset_sha256s)
  ),
  constraint ebay_mayel_visual_phase_b_management_check check (
    management_model = 'INVENTORY_API_MANAGED'
    and executor =
      'EBAY_INVENTORY_CREATE_OR_REPLACE_INVENTORY_ITEM_IMAGE_ONLY_V1'
  ),
  constraint ebay_mayel_visual_phase_b_phase_check check (phase in (
    'OWNER_APPROVED', 'PREFLIGHT', 'EXECUTING', 'WRITE_ACCEPTED',
    'OFFICIAL_READBACK_PENDING', 'APPLIED_AND_OFFICIALLY_VERIFIED',
    'AUTHORIZATION_INVALIDATED', 'PREFLIGHT_FAILED', 'WRITE_FAILED',
    'READBACK_FAILED', 'READBACK_MISMATCH'
  )),
  constraint ebay_mayel_visual_phase_b_write_check check (
    marketplace_write_count between 0 and 1
    and (marketplace_write_count = 0 or write_attempt_at is not null)
  ),
  constraint ebay_mayel_visual_phase_b_claim_check check (
    (claim_token is null) = (lease_expires_at is null)
  ),
  constraint ebay_mayel_visual_phase_b_verified_check check (
    phase <> 'APPLIED_AND_OFFICIALLY_VERIFIED' or (
      final_state = 'APPLIED_AND_OFFICIALLY_VERIFIED'
      and marketplace_write_count = 1
      and ebay_response_class = 'EBAY_WRITE_ACCEPTED'
      and postwrite_snapshot is not null
      and postwrite_snapshot ->> 'inventoryImagesMatch' = 'true'
      and postwrite_snapshot ->> 'officialOrderedImageSetMatch' = 'true'
      and postwrite_snapshot ->> 'nonAuthorizedFieldsUnchanged' = 'true'
      and applied_verified_at is not null
    )
  )
);

create unique index ebay_mayel_visual_phase_b_manifest_uidx
  on public.ebay_mayel_visual_phase_b_executions_v1(
    visual_task_id, visual_manifest_digest
  );
create index ebay_mayel_visual_phase_b_task_created_idx
  on public.ebay_mayel_visual_phase_b_executions_v1(
    visual_task_id, created_at desc
  );
create index ebay_mayel_visual_phase_b_active_listing_idx
  on public.ebay_mayel_visual_phase_b_executions_v1(active_listing_id);
create index ebay_mayel_visual_phase_b_listing_package_idx
  on public.ebay_mayel_visual_phase_b_executions_v1(listing_package_id);
create index ebay_mayel_visual_phase_b_owner_idx
  on public.ebay_mayel_visual_phase_b_executions_v1(owner_user_id);

create or replace function public.enforce_ebay_mayel_visual_phase_b_scope_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.owner_approval_id is distinct from old.owner_approval_id
    or new.visual_task_id is distinct from old.visual_task_id
    or new.visual_manifest_id is distinct from old.visual_manifest_id
    or new.active_listing_id is distinct from old.active_listing_id
    or new.listing_package_id is distinct from old.listing_package_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.marketplace_id is distinct from old.marketplace_id
    or new.ebay_item_id is distinct from old.ebay_item_id
    or new.ebay_sku is distinct from old.ebay_sku
    or new.visual_manifest_digest is distinct from old.visual_manifest_digest
    or new.owner_authorization_digest is distinct from old.owner_authorization_digest
    or new.authorized_current_image_set_digest is distinct from
      old.authorized_current_image_set_digest
    or new.proposed_final_ordered_image_urls is distinct from
      old.proposed_final_ordered_image_urls
    or new.main_image_url is distinct from old.main_image_url
    or new.canonical_asset_ids is distinct from old.canonical_asset_ids
    or new.canonical_asset_sha256s is distinct from old.canonical_asset_sha256s
    or new.management_model is distinct from old.management_model
    or new.management_evidence_digest is distinct from old.management_evidence_digest
    or new.executor is distinct from old.executor
    or new.owner_approved_at is distinct from old.owner_approved_at
    or new.created_at is distinct from old.created_at then
    raise exception 'MAYEL_VISUAL_PHASE_B_AUTHORIZATION_SCOPE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger enforce_ebay_mayel_visual_phase_b_scope_v1
before update on public.ebay_mayel_visual_phase_b_executions_v1
for each row execute function
  public.enforce_ebay_mayel_visual_phase_b_scope_v1();

create or replace function public.reject_ebay_mayel_visual_phase_b_delete_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'MAYEL_VISUAL_PHASE_B_LEDGER_APPEND_ONLY';
end;
$$;

create trigger reject_ebay_mayel_visual_phase_b_delete_v1
before delete on public.ebay_mayel_visual_phase_b_executions_v1
for each row execute function
  public.reject_ebay_mayel_visual_phase_b_delete_v1();

alter table public.ebay_mayel_visual_phase_b_executions_v1
  enable row level security;
alter table public.ebay_mayel_visual_phase_b_executions_v1
  force row level security;
revoke all on table public.ebay_mayel_visual_phase_b_executions_v1
  from public, anon, authenticated;
grant select, insert, update on table
  public.ebay_mayel_visual_phase_b_executions_v1 to service_role;

revoke all on function public.assign_ebay_mayel_visual_manifest_id_v1()
  from public, anon, authenticated;
revoke all on function public.is_mayel_phase_b_image_url_set_v1(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.is_mayel_phase_b_asset_set_v1(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.enforce_ebay_mayel_visual_phase_b_scope_v1()
  from public, anon, authenticated;
revoke all on function public.reject_ebay_mayel_visual_phase_b_delete_v1()
  from public, anon, authenticated;

comment on table public.ebay_mayel_visual_phase_b_executions_v1 is
  'Append-only owner authorization and one-write execution ledger for an exact Mayel visual manifest. Marketplace mutation remains server-only and fail-closed.';
comment on column public.ebay_mayel_visual_phase_b_executions_v1.owner_authorization_digest is
  'Must exactly equal the immutable material MAYEL_VISUAL_MANIFEST_V1 digest.';
comment on column public.ebay_mayel_visual_phase_b_executions_v1.marketplace_write_count is
  'Hard bounded to zero or one; reads, refresh and navigation never increment it.';

notify pgrst, 'reload schema';
