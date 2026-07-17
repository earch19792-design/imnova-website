-- Bind every eBay listing package and image asset to the canonical seller
-- account scope. Existing packages remain explicitly unclaimed; they cannot
-- receive images until a server-side workflow assigns a verified scope.

alter table public.ebay_listing_packages
  add column if not exists account_key text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_listing_packages_account_scope_check'
      and conrelid = 'public.ebay_listing_packages'::regclass
  ) then
    alter table public.ebay_listing_packages
      add constraint ebay_listing_packages_account_scope_check check (
        account_key is null
        or (
          account_key <> 'default'
          and account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
        )
      );
  end if;
end;
$$;

create unique index if not exists
  ebay_listing_packages_id_account_unique
  on public.ebay_listing_packages(id, account_key);

alter table public.ebay_listing_image_assets
  add column if not exists account_key text null;

-- Fail closed if a future environment applies this migration after images
-- were created without an account-scoped package. No data is guessed or
-- repaired automatically.
do $$
declare
  v_unresolvable_assets bigint;
begin
  select count(*)
  into v_unresolvable_assets
  from public.ebay_listing_image_assets asset
  left join public.ebay_listing_packages package_row
    on package_row.id = asset.listing_package_id
  where package_row.id is null
    or package_row.account_key is null
    or package_row.account_key = 'default'
    or package_row.account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or (
      asset.account_key is not null
      and asset.account_key is distinct from package_row.account_key
    );

  if v_unresolvable_assets > 0 then
    raise exception
      'EBAY_IMAGE_ACCOUNT_SCOPE_BACKFILL_REQUIRED: % asset(s) have no resolvable package account',
      v_unresolvable_assets;
  end if;

  update public.ebay_listing_image_assets asset
  set account_key = package_row.account_key
  from public.ebay_listing_packages package_row
  where package_row.id = asset.listing_package_id
    and asset.account_key is null;
end;
$$;

alter table public.ebay_listing_image_assets
  alter column account_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_listing_image_assets_account_scope_check'
      and conrelid = 'public.ebay_listing_image_assets'::regclass
  ) then
    alter table public.ebay_listing_image_assets
      add constraint ebay_listing_image_assets_account_scope_check check (
        account_key <> 'default'
        and account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_listing_image_assets_package_account_fkey'
      and conrelid = 'public.ebay_listing_image_assets'::regclass
  ) then
    alter table public.ebay_listing_image_assets
      add constraint ebay_listing_image_assets_package_account_fkey
      foreign key (listing_package_id, account_key)
      references public.ebay_listing_packages(id, account_key)
      on delete cascade;
  end if;
end;
$$;

create index if not exists ebay_listing_packages_account_updated_idx
  on public.ebay_listing_packages(account_key, updated_at desc)
  where account_key is not null;
create index if not exists ebay_listing_image_assets_account_package_idx
  on public.ebay_listing_image_assets(
    account_key, listing_package_id, status, position, created_at
  );
create unique index if not exists ebay_listing_image_assets_account_hash_unique
  on public.ebay_listing_image_assets(
    account_key, listing_package_id, output_sha256
  )
  where status in ('pending_review', 'approved');

create or replace function public.enforce_ebay_listing_image_account_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package_account_key text;
  v_requested_account_key text;
begin
  select package_row.account_key
  into v_package_account_key
  from public.ebay_listing_packages package_row
  where package_row.id = new.listing_package_id
  for key share;

  if v_package_account_key is null
    or v_package_account_key = 'default'
    or v_package_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    raise exception 'EBAY_IMAGE_PACKAGE_ACCOUNT_SCOPE_REQUIRED';
  end if;

  v_requested_account_key := nullif(
    current_setting('app.ebay_seller_account_key', true),
    ''
  );
  new.account_key := coalesce(new.account_key, v_requested_account_key);

  if new.account_key is null
    or new.account_key = 'default'
    or new.account_key is distinct from v_package_account_key
    or (
      tg_op = 'UPDATE'
      and (
        new.account_key is distinct from old.account_key
        or new.listing_package_id is distinct from old.listing_package_id
      )
    ) then
    raise exception 'EBAY_IMAGE_ACCOUNT_SCOPE_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists ebay_listing_image_account_scope_guard
  on public.ebay_listing_image_assets;
create trigger ebay_listing_image_account_scope_guard
before insert or update of account_key, listing_package_id
on public.ebay_listing_image_assets
for each row execute function public.enforce_ebay_listing_image_account_scope();

create or replace function public.assert_ebay_listing_package_account_scope(
  p_package_id uuid,
  p_account_key text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_package_id is null
    or p_actor is null
    or p_account_key is null
    or p_account_key = 'default'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    raise exception 'EBAY_IMAGE_ACCOUNT_SCOPE_REQUIRED';
  end if;

  perform 1
  from public.ebay_listing_packages package_row
  where package_row.id = p_package_id
    and package_row.created_by = p_actor
    and package_row.account_key = p_account_key
    and package_row.status <> 'archived'
  for key share;
  if not found then
    raise exception 'EBAY_IMAGE_PACKAGE_ACCOUNT_SCOPE_MISMATCH';
  end if;
end;
$$;

-- Account-scoped wrappers are the only service_role entry points. The prior
-- signatures remain private implementation details so already-applied SQL can
-- be reused without weakening the new account invariant.
create or replace function public.ebay_create_pending_listing_image(
  p_package_id uuid,
  p_account_key text,
  p_actor uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_asset jsonb
)
returns setof public.ebay_listing_image_assets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_ebay_listing_package_account_scope(
    p_package_id, p_account_key, p_actor
  );
  perform set_config('app.ebay_seller_account_key', p_account_key, true);
  return query select * from public.ebay_create_pending_listing_image(
    p_package_id, p_actor, p_opportunity_id, p_candidate_key, p_asset
  );
end;
$$;

create or replace function public.ebay_attach_approved_listing_images(
  p_package_id uuid,
  p_account_key text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_ebay_listing_package_account_scope(
    p_package_id, p_account_key, p_actor
  );
  return public.ebay_attach_approved_listing_images(p_package_id, p_actor);
end;
$$;

create or replace function public.ebay_save_listing_package_guarded(
  p_package_id uuid,
  p_account_key text,
  p_actor uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_operation text,
  p_package_patch jsonb,
  p_status text,
  p_readiness numeric,
  p_source_observed_at timestamptz,
  p_expected_updated_at timestamptz
)
returns setof public.ebay_listing_packages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_ebay_listing_package_account_scope(
    p_package_id, p_account_key, p_actor
  );
  return query select * from public.ebay_save_listing_package_guarded(
    p_package_id, p_actor, p_opportunity_id, p_candidate_key, p_operation,
    p_package_patch, p_status, p_readiness, p_source_observed_at,
    p_expected_updated_at
  );
end;
$$;

create or replace function public.ebay_review_listing_image_and_attach(
  p_package_id uuid,
  p_account_key text,
  p_asset_id uuid,
  p_actor uuid,
  p_decision text,
  p_public_url text,
  p_published_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_ebay_listing_package_account_scope(
    p_package_id, p_account_key, p_actor
  );
  perform 1
  from public.ebay_listing_image_assets asset
  where asset.id = p_asset_id
    and asset.listing_package_id = p_package_id
    and asset.account_key = p_account_key
    and asset.created_by = p_actor;
  if not found then raise exception 'EBAY_IMAGE_ASSET_ACCOUNT_SCOPE_MISMATCH'; end if;

  return public.ebay_review_listing_image_and_attach(
    p_package_id, p_asset_id, p_actor, p_decision, p_public_url,
    p_published_storage_path
  );
end;
$$;

create or replace function public.ebay_reorder_listing_images_and_attach(
  p_package_id uuid,
  p_account_key text,
  p_actor uuid,
  p_ordered_asset_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_ebay_listing_package_account_scope(
    p_package_id, p_account_key, p_actor
  );
  if exists (
    select 1
    from unnest(p_ordered_asset_ids) requested(asset_id)
    left join public.ebay_listing_image_assets asset
      on asset.id = requested.asset_id
      and asset.listing_package_id = p_package_id
      and asset.account_key = p_account_key
      and asset.created_by = p_actor
    where asset.id is null
  ) then
    raise exception 'EBAY_IMAGE_ORDER_ACCOUNT_SCOPE_MISMATCH';
  end if;

  return public.ebay_reorder_listing_images_and_attach(
    p_package_id, p_actor, p_ordered_asset_ids
  );
end;
$$;

alter table public.ebay_listing_image_assets enable row level security;
revoke all on table public.ebay_listing_image_assets from anon, authenticated;
grant select, insert, update, delete
  on table public.ebay_listing_image_assets to service_role;

revoke all on function public.enforce_ebay_listing_image_account_scope()
  from public, anon, authenticated;
revoke all on function public.assert_ebay_listing_package_account_scope(
  uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.ebay_create_pending_listing_image(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.ebay_attach_approved_listing_images(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.ebay_save_listing_package_guarded(
  uuid, uuid, uuid, text, text, jsonb, text, numeric, timestamptz,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.ebay_review_listing_image_and_attach(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.ebay_reorder_listing_images_and_attach(
  uuid, uuid, uuid[]
) from public, anon, authenticated, service_role;

revoke all on function public.ebay_create_pending_listing_image(
  uuid, text, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ebay_create_pending_listing_image(
  uuid, text, uuid, uuid, text, jsonb
) to service_role;
revoke all on function public.ebay_attach_approved_listing_images(
  uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.ebay_attach_approved_listing_images(
  uuid, text, uuid
) to service_role;
revoke all on function public.ebay_save_listing_package_guarded(
  uuid, text, uuid, uuid, text, text, jsonb, text, numeric, timestamptz,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.ebay_save_listing_package_guarded(
  uuid, text, uuid, uuid, text, text, jsonb, text, numeric, timestamptz,
  timestamptz
) to service_role;
revoke all on function public.ebay_review_listing_image_and_attach(
  uuid, text, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.ebay_review_listing_image_and_attach(
  uuid, text, uuid, uuid, text, text, text
) to service_role;
revoke all on function public.ebay_reorder_listing_images_and_attach(
  uuid, text, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.ebay_reorder_listing_images_and_attach(
  uuid, text, uuid, uuid[]
) to service_role;

comment on column public.ebay_listing_packages.account_key is
  'Canonical seller account scope. NULL means a legacy package is unclaimed and cannot receive images.';
comment on column public.ebay_listing_image_assets.account_key is
  'Immutable canonical seller account copied from and constrained to the listing package.';

notify pgrst, 'reload schema';
