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
        'AUTHORIZED', 'CLAIMED', 'RUNNING', 'FAILED_RETRY_SAFE',
        'FAILED_BLOCKED', 'AMBIGUOUS_FAIL_CLOSED')
      and batch.status in (
        'AUTHORIZED', 'RUNNING', 'PARTIAL', 'BLOCKED')
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
        'AUTHORIZED', 'CLAIMED', 'RUNNING', 'FAILED_RETRY_SAFE',
        'FAILED_BLOCKED', 'AMBIGUOUS_FAIL_CLOSED')
      and batch.status in (
        'AUTHORIZED', 'RUNNING', 'PARTIAL', 'BLOCKED')
  ) then
    raise exception 'SELLER_OS_AUTHORIZED_PACKAGE_IMAGES_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.rearm_seller_os_publisher_batch_prewrite_child_v1(
  p_marketplace_account_key text,
  p_batch_authorization_id uuid,
  p_child_id uuid,
  p_expected_receipt_digest text,
  p_mechanism_version text
) returns setof public.seller_os_publisher_batch_children_v1
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_child public.seller_os_publisher_batch_children_v1%rowtype;
begin
  if p_mechanism_version <> 'SELLER_OS_PUBLISHER_PREFLIGHT_RECOVERY_V1'
    or p_expected_receipt_digest !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception 'SELLER_OS_PUBLISHER_PREFLIGHT_RECOVERY_INPUT_INVALID';
  end if;

  select child.* into v_child
  from public.seller_os_publisher_batch_children_v1 child
  join public.seller_os_publisher_batch_authorizations_v1 batch
    on batch.id = child.batch_authorization_id
  join public.ebay_listing_packages package_row
    on package_row.id = child.package_id
  where child.id = p_child_id
    and child.batch_authorization_id = p_batch_authorization_id
    and child.marketplace_account_key = p_marketplace_account_key
    and child.status = 'FAILED_BLOCKED'
    and child.stage = 'PREFLIGHT'
    and child.error_class in (
      'QUICK_PICK_PUBLISH_MARKET_TEST_NOT_READY',
      'EBAY_DRAFT_ONLY_BLOCKED',
      'SELLER_OS_PUBLISHER_BATCH_MATERIAL_BINDING_INVALID')
    and child.receipt_digest = p_expected_receipt_digest
    and child.marketplace_write_count = 0
    and child.approval_id is null
    and child.execution_id is null
    and child.offer_id is null
    and child.item_id is null
    and child.attempt_count < 3
    and batch.status in ('PARTIAL', 'BLOCKED')
    and package_row.status = 'ready_for_review'
    and package_row.account_key = child.marketplace_account_key
    and package_row.created_by = child.actor_user_id
    and package_row.candidate_key = child.candidate_id
    and package_row.updated_at <= batch.authorized_at
    and package_row.package_data #>>
      '{quickPickMarketTestPackageV1,packageDigest}' = child.package_digest
    and package_row.package_data #>>
      '{quickPickMarketTestPackageV1,authorizationBinding,imagesDigest}' =
        child.authorization_binding->>'imagesDigest'
    and package_row.package_data->>'conditionId' =
        child.authorization_binding->>'condition'
    and child.authorization_binding->>'candidateId' = child.candidate_id
    and child.authorization_binding->>'packageId' = child.package_id::text
    and child.authorization_binding->>'packageDigest' = child.package_digest
  for update of child, batch, package_row;

  if not found then return; end if;

  update public.seller_os_publisher_batch_children_v1
  set status = 'FAILED_RETRY_SAFE',
    stage = 'PREFLIGHT_RECOVERY_REARMED',
    retry_safety = 'SAFE_TO_RETRY_AFTER_MECHANISM_REPAIR',
    retry_after_at = pg_catalog.clock_timestamp(),
    lease_owner = null,
    lease_expires_at = null,
    mismatch_fields = coalesce(mismatch_fields, '[]'::jsonb)
      || jsonb_build_array(
        'SELLER_OS_PUBLISHER_PREFLIGHT_RECOVERY_V1'),
    updated_at = pg_catalog.clock_timestamp()
  where id = v_child.id;

  update public.seller_os_publisher_batch_authorizations_v1
  set status = 'PARTIAL', updated_at = pg_catalog.clock_timestamp()
  where id = p_batch_authorization_id and status = 'BLOCKED';

  return query select *
  from public.seller_os_publisher_batch_children_v1
  where id = v_child.id;
end;
$$;

revoke all on function
  public.rearm_seller_os_publisher_batch_prewrite_child_v1(
    text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  public.rearm_seller_os_publisher_batch_prewrite_child_v1(
    text, uuid, uuid, text, text)
  to service_role;

comment on function
  public.rearm_seller_os_publisher_batch_prewrite_child_v1(
    text, uuid, uuid, text, text) is
  'Atomically rearms only exact unchanged no-write preflight failures after the shared runtime proves the repaired current contract; never mutates package or commercial authority.';

notify pgrst, 'reload schema';
