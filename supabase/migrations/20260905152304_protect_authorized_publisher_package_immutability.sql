create index if not exists
  seller_os_publisher_batch_children_package_guard_idx
  on public.seller_os_publisher_batch_children_v1(package_id, status);

create or replace function public.seller_os_assert_authorized_package_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_package_id uuid;
begin
  v_package_id := case when tg_op = 'DELETE' then old.id else new.id end;
  if exists (
    select 1
    from public.seller_os_publisher_batch_children_v1 child
    join public.seller_os_publisher_batch_authorizations_v1 batch
      on batch.id = child.batch_authorization_id
    where child.package_id = v_package_id
      and child.status in (
        'AUTHORIZED', 'CLAIMED', 'RUNNING', 'FAILED_RETRY_SAFE')
      and batch.status in ('AUTHORIZED', 'RUNNING', 'PARTIAL')
  ) and (
    tg_op = 'DELETE'
    or new.package_data is distinct from old.package_data
    or new.candidate_key is distinct from old.candidate_key
    or new.opportunity_id is distinct from old.opportunity_id
    or new.account_key is distinct from old.account_key
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'SELLER_OS_AUTHORIZED_PACKAGE_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists seller_os_authorized_package_immutable_v1
  on public.ebay_listing_packages;
create trigger seller_os_authorized_package_immutable_v1
before update or delete on public.ebay_listing_packages
for each row execute function
  public.seller_os_assert_authorized_package_immutable_v1();

create or replace function public.seller_os_assert_authorized_images_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_package_id uuid;
begin
  v_package_id := case when tg_op = 'DELETE'
    then old.listing_package_id else new.listing_package_id end;
  if exists (
    select 1
    from public.seller_os_publisher_batch_children_v1 child
    join public.seller_os_publisher_batch_authorizations_v1 batch
      on batch.id = child.batch_authorization_id
    where child.package_id = v_package_id
      and child.status in (
        'AUTHORIZED', 'CLAIMED', 'RUNNING', 'FAILED_RETRY_SAFE')
      and batch.status in ('AUTHORIZED', 'RUNNING', 'PARTIAL')
  ) then
    raise exception 'SELLER_OS_AUTHORIZED_PACKAGE_IMAGES_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists seller_os_authorized_images_immutable_v1
  on public.ebay_listing_image_assets;
create trigger seller_os_authorized_images_immutable_v1
before insert or update or delete on public.ebay_listing_image_assets
for each row execute function
  public.seller_os_assert_authorized_images_immutable_v1();

create or replace function public.seller_os_assert_batch_authority_binding_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.batch_authorization_id is distinct from old.batch_authorization_id
    or new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.actor_user_id is distinct from old.actor_user_id
    or new.candidate_id is distinct from old.candidate_id
    or new.package_id is distinct from old.package_id
    or new.package_digest is distinct from old.package_digest
    or new.authorization_binding is distinct from old.authorization_binding
  then
    raise exception 'SELLER_OS_PUBLISHER_BATCH_BINDING_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists seller_os_batch_authority_binding_immutable_v1
  on public.seller_os_publisher_batch_children_v1;
create trigger seller_os_batch_authority_binding_immutable_v1
before update on public.seller_os_publisher_batch_children_v1
for each row execute function
  public.seller_os_assert_batch_authority_binding_immutable_v1();

create or replace function public.seller_os_assert_batch_authority_immutable_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.actor_user_id is distinct from old.actor_user_id
    or new.marketplace_id is distinct from old.marketplace_id
    or new.exact_member_count is distinct from old.exact_member_count
    or new.authorization_digest is distinct from old.authorization_digest
    or new.idempotency_key is distinct from old.idempotency_key
    or new.authorized_members is distinct from old.authorized_members
    or new.authorized_at is distinct from old.authorized_at
  then
    raise exception 'SELLER_OS_PUBLISHER_BATCH_AUTHORITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists seller_os_batch_authority_immutable_v1
  on public.seller_os_publisher_batch_authorizations_v1;
create trigger seller_os_batch_authority_immutable_v1
before update on public.seller_os_publisher_batch_authorizations_v1
for each row execute function
  public.seller_os_assert_batch_authority_immutable_v1();

create or replace function public.authorize_seller_os_publisher_batch_v1(
  p_marketplace_account_key text,
  p_actor_user_id uuid,
  p_marketplace_id text,
  p_exact_member_count integer,
  p_authorization_digest text,
  p_idempotency_key text,
  p_authorized_members jsonb
) returns setof public.seller_os_publisher_batch_authorizations_v1
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.seller_os_publisher_batch_authorizations_v1%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_member jsonb;
  v_child_count integer;
begin
  insert into public.seller_os_publisher_batch_authorizations_v1 (
    marketplace_account_key, actor_user_id, marketplace_id,
    exact_member_count, authorization_digest, idempotency_key,
    authorized_members
  ) values (
    p_marketplace_account_key, p_actor_user_id, p_marketplace_id,
    p_exact_member_count, p_authorization_digest, p_idempotency_key,
    p_authorized_members
  ) on conflict (marketplace_account_key, actor_user_id, idempotency_key)
    do nothing;

  select * into v_batch
  from public.seller_os_publisher_batch_authorizations_v1
  where marketplace_account_key = p_marketplace_account_key
    and actor_user_id = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if not found
      or v_batch.authorization_digest <> p_authorization_digest
      or v_batch.exact_member_count <> p_exact_member_count
      or v_batch.authorized_members <> p_authorized_members then
    raise exception 'SELLER_OS_PUBLISHER_BATCH_IDEMPOTENCY_CONFLICT';
  end if;

  for v_member in select value
    from jsonb_array_elements(p_authorized_members)
  loop
    select * into v_package
    from public.ebay_listing_packages package_row
    where package_row.id = (v_member->>'packageId')::uuid
    for update;
    if not found
      or v_package.account_key is distinct from p_marketplace_account_key
      or v_package.created_by is distinct from p_actor_user_id
      or v_package.candidate_key is distinct from v_member->>'candidateId'
      or v_package.status <> 'ready_for_review'
      or v_member->>'packageDigest' !~ '^sha256:[0-9a-f]{64}$'
      or v_member #>> '{authorizationBinding,candidateId}'
        is distinct from v_member->>'candidateId'
      or v_member #>> '{authorizationBinding,packageId}'
        is distinct from v_member->>'packageId'
      or v_member #>> '{authorizationBinding,packageDigest}'
        is distinct from v_member->>'packageDigest'
      or v_member #>> '{authorizationBinding,imagesDigest}'
        !~ '^sha256:[0-9a-f]{64}$'
      or v_package.package_data #>>
        '{quickPickMarketTestPackageV1,packageDigest}'
        is distinct from v_member->>'packageDigest'
      or v_package.package_data #>>
        '{quickPickMarketTestPackageV1,authorizationBinding,imagesDigest}'
        is distinct from v_member #>>
          '{authorizationBinding,imagesDigest}'
      or exists (
        select 1
        from public.seller_os_publisher_batch_children_v1 active_child
        join public.seller_os_publisher_batch_authorizations_v1 active_batch
          on active_batch.id = active_child.batch_authorization_id
        where active_child.package_id = v_package.id
          and active_child.batch_authorization_id <> v_batch.id
          and active_child.status in (
            'AUTHORIZED', 'CLAIMED', 'RUNNING', 'FAILED_RETRY_SAFE')
          and active_batch.status in ('AUTHORIZED', 'RUNNING', 'PARTIAL')
      ) then
      raise exception 'SELLER_OS_PUBLISHER_BATCH_PACKAGE_NOT_FROZEN';
    end if;
  end loop;

  insert into public.seller_os_publisher_batch_children_v1 (
    batch_authorization_id, marketplace_account_key, actor_user_id,
    candidate_id, package_id, package_digest, authorization_binding
  ) select v_batch.id, p_marketplace_account_key, p_actor_user_id,
      member->>'candidateId', (member->>'packageId')::uuid,
      member->>'packageDigest', member->'authorizationBinding'
    from jsonb_array_elements(p_authorized_members) member
  on conflict (batch_authorization_id, candidate_id) do nothing;

  select count(*) into v_child_count
  from public.seller_os_publisher_batch_children_v1
  where batch_authorization_id = v_batch.id;
  if v_child_count <> p_exact_member_count then
    raise exception 'SELLER_OS_PUBLISHER_BATCH_CHILD_COUNT_DIVERGENCE';
  end if;
  return next v_batch;
end;
$$;

revoke all on function
  public.seller_os_assert_authorized_package_immutable_v1() from public;
revoke all on function
  public.seller_os_assert_authorized_package_immutable_v1()
  from anon, authenticated;
revoke all on function
  public.seller_os_assert_authorized_images_immutable_v1() from public;
revoke all on function
  public.seller_os_assert_authorized_images_immutable_v1()
  from anon, authenticated;
revoke all on function
  public.seller_os_assert_batch_authority_binding_immutable_v1() from public;
revoke all on function
  public.seller_os_assert_batch_authority_binding_immutable_v1()
  from anon, authenticated;
revoke all on function
  public.seller_os_assert_batch_authority_immutable_v1() from public;
revoke all on function
  public.seller_os_assert_batch_authority_immutable_v1()
  from anon, authenticated;
revoke all on function public.authorize_seller_os_publisher_batch_v1(
  text, uuid, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.authorize_seller_os_publisher_batch_v1(
  text, uuid, text, integer, text, text, jsonb) to service_role;

comment on function public.seller_os_assert_authorized_package_immutable_v1()
is 'Fail-closed database guard: an active exact Publisher authorization freezes package identity and package_data until completion or explicit child invalidation.';
comment on function public.seller_os_assert_authorized_images_immutable_v1()
is 'Fail-closed database guard: image assets cannot change while an exact Publisher batch authorization is active.';
