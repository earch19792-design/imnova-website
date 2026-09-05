alter table public.seller_os_publisher_batch_children_v1
  add column if not exists mismatch_classification jsonb not null
  default '[]'::jsonb;

create or replace function public.approve_ebay_draft_only_package(
  p_listing_package_id uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_actor_user_id uuid,
  p_payload_hash text,
  p_approved_payload jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_target text,
  p_account_fingerprint text
)
returns setof public.ebay_draft_only_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_existing public.ebay_draft_only_approvals%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_target text := upper(trim(coalesce(p_target, '')));
  v_account_fingerprint text := lower(trim(coalesce(p_account_fingerprint, '')));
  v_operations jsonb := coalesce(
    p_approved_payload #> '{safety,permittedOperations}', '[]'::jsonb);
  v_batch_child_id uuid;
  v_batch_authorized boolean := false;
begin
  if v_target not in ('SANDBOX', 'PRODUCTION')
    or v_account_fingerprint !~ '^[0-9a-f]{64}$'
    or p_payload_hash is null
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or upper(coalesce(p_approved_payload #>> '{safety,target}', '')) <> v_target
    or lower(coalesce(p_approved_payload #>> '{safety,accountFingerprint}', '')) <> v_account_fingerprint
    or p_approved_payload #>> '{safety,unpublishedOnly}' is distinct from 'true'
    or p_approved_payload #>> '{safety,publishOfferPresent}' is distinct from 'false'
    or jsonb_typeof(v_operations) <> 'array'
    or v_operations <> '["createOrReplaceInventoryItem", "createOffer"]'::jsonb
    or p_approved_payload #>> '{listingPackage,id}' is distinct from p_listing_package_id::text
    or p_approved_payload #>> '{listingPackage,candidateKey}' is distinct from p_candidate_key
    or p_approved_payload #>> '{sourceEvidence,opportunityId}' is distinct from p_opportunity_id::text
    or p_approved_payload #>> '{sourceEvidence,candidateKey}' is distinct from p_candidate_key
    or p_approved_payload #>> '{sku}' is distinct from p_approved_payload #>> '{offerPayload,sku}'
    or coalesce(p_approved_payload #>> '{sku}', '') !~ '^IMNOVA[A-Z0-9]{16,32}$'
    or p_approved_payload #>> '{offerPayload,marketplaceId}' is distinct from 'EBAY_US'
    or p_approved_payload #>> '{offerPayload,format}' is distinct from 'FIXED_PRICE'
    or coalesce(p_approved_payload #>> '{compliance,ebayPreflightSnapshot}', '') !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    or (
      v_target = 'PRODUCTION'
      and (
        p_approved_payload #>> '{inventoryItemPayload,availability,shipToLocationAvailability,quantity}' is distinct from '1'
        or p_approved_payload #>> '{offerPayload,availableQuantity}' is distinct from '1'
      )
    ) then
    raise exception 'DRAFT_ONLY_PAYLOAD_SAFETY_INVALID';
  end if;

  select * into v_package
  from public.ebay_listing_packages
  where id = p_listing_package_id
  for update;
  if not found
    or v_package.created_by is distinct from p_actor_user_id
    or v_package.opportunity_id is distinct from p_opportunity_id
    or v_package.candidate_key is distinct from p_candidate_key
    or v_package.status not in ('draft', 'ready_for_review', 'approved') then
    raise exception 'DRAFT_ONLY_PACKAGE_NOT_APPROVABLE';
  end if;

  if p_idempotency_key ~
      '^batch-approval:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    v_batch_child_id := substring(
      p_idempotency_key from length('batch-approval:') + 1)::uuid;
    select exists (
      select 1
      from public.seller_os_publisher_batch_children_v1 child
      join public.seller_os_publisher_batch_authorizations_v1 batch
        on batch.id = child.batch_authorization_id
      where child.id = v_batch_child_id
        and child.package_id = p_listing_package_id
        and child.candidate_id = p_candidate_key
        and child.actor_user_id = p_actor_user_id
        and child.marketplace_account_key = v_package.account_key
        and child.package_digest = v_package.package_data #>>
          '{quickPickMarketTestPackageV1,packageDigest}'
        and child.authorization_binding->>'imagesDigest' =
          v_package.package_data #>>
            '{quickPickMarketTestPackageV1,authorizationBinding,imagesDigest}'
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,commercialAuthorizationAuthority}' =
            'SELLER_OS_PUBLISHER_BATCH_AUTHORIZATION_V1'
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,batchAuthorizationId}' =
            batch.id::text
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,batchAuthorizationDigest}' =
            batch.authorization_digest
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,packageDigest}' =
            child.package_digest
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,authorizedImagesDigest}' =
            child.authorization_binding->>'imagesDigest'
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,listingPackageId}' =
            child.package_id::text
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,opportunityId}' =
            p_opportunity_id::text
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,candidateKey}' =
            child.candidate_id
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,actorUserId}' =
            p_actor_user_id::text
        and p_approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,accountKey}' =
            child.marketplace_account_key
        and child.status in (
          'AUTHORIZED', 'CLAIMED', 'RUNNING', 'FAILED_RETRY_SAFE',
          'FAILED_BLOCKED', 'AMBIGUOUS_FAIL_CLOSED')
        and batch.actor_user_id = p_actor_user_id
        and batch.marketplace_account_key = v_package.account_key
        and batch.marketplace_id = 'EBAY_US'
        and batch.status in ('AUTHORIZED', 'RUNNING', 'PARTIAL', 'BLOCKED')
    ) into v_batch_authorized;
    if not v_batch_authorized then
      raise exception 'DRAFT_ONLY_BATCH_AUTHORITY_INVALID';
    end if;
  end if;

  select * into v_existing
  from public.ebay_draft_only_approvals
  where approval_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.listing_package_id is distinct from p_listing_package_id
      or v_existing.payload_hash is distinct from p_payload_hash
      or v_existing.target is distinct from v_target
      or v_existing.account_fingerprint is distinct from v_account_fingerprint then
      raise exception 'DRAFT_ONLY_APPROVAL_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_existing;
    return;
  end if;

  update public.ebay_draft_only_approvals
  set status = 'expired', updated_at = now()
  where listing_package_id = p_listing_package_id
    and status = 'approved'
    and expires_at <= now();

  if exists (
    select 1 from public.ebay_draft_only_approvals
    where listing_package_id = p_listing_package_id
      and status = 'approved'
  ) then
    raise exception 'DRAFT_ONLY_ACTIVE_APPROVAL_EXISTS';
  end if;

  insert into public.ebay_draft_only_approvals (
    listing_package_id, opportunity_id, candidate_key, actor_user_id,
    target, account_fingerprint, payload_hash, approved_payload,
    approval_idempotency_key, approved_at, expires_at,
    approval_phrase_version
  ) values (
    p_listing_package_id, p_opportunity_id, p_candidate_key, p_actor_user_id,
    v_target, v_account_fingerprint, p_payload_hash, p_approved_payload,
    p_idempotency_key, now(), least(p_expires_at, now() + interval '15 minutes'),
    case when v_target = 'PRODUCTION'
      then 'draft_only_production_es_v1' else 'draft_only_es_v1' end
  ) returning * into v_approval;

  if not v_batch_authorized then
    update public.ebay_listing_packages
    set status = 'approved', updated_at = now()
    where id = p_listing_package_id;
  end if;

  return next v_approval;
end;
$$;

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
    where child.package_id = v_package_id
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
    where child.package_id = v_package_id
  ) then
    raise exception 'SELLER_OS_AUTHORIZED_PACKAGE_IMAGES_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.approve_ebay_draft_only_package(
  uuid, uuid, text, uuid, text, jsonb, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_ebay_draft_only_package(
  uuid, uuid, text, uuid, text, jsonb, text, timestamptz, text, text)
  to service_role;

comment on function public.approve_ebay_draft_only_package(
  uuid, uuid, text, uuid, text, jsonb, text, timestamptz, text, text) is
  'Creates an exact draft authorization. Batch-authorized packages remain immutable and ready_for_review; legacy single-item flows retain the historical approved status transition.';

notify pgrst, 'reload schema';
