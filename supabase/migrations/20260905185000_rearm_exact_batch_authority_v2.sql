create or replace function
  public.rearm_seller_os_publisher_batch_exact_authority_child_v2(
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
  v_batch public.seller_os_publisher_batch_authorizations_v1%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_quick_pick jsonb;
begin
  if p_mechanism_version <>
      'SELLER_OS_PUBLISHER_EXACT_AUTHORITY_RECOVERY_V2'
    or p_expected_receipt_digest !~ '^sha256:[0-9a-f]{64}$' then
    raise exception 'SELLER_OS_PUBLISHER_EXACT_AUTHORITY_RECOVERY_INPUT_INVALID';
  end if;

  select * into v_child
  from public.seller_os_publisher_batch_children_v1
  where id = p_child_id
    and batch_authorization_id = p_batch_authorization_id
    and marketplace_account_key = p_marketplace_account_key
    and status in ('FAILED_BLOCKED', 'AMBIGUOUS_FAIL_CLOSED')
    and stage = 'PREFLIGHT'
    and error_class in (
      'EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED',
      'EBAY_DRAFT_ONLY_ACTIVE_APPROVAL_EXISTS',
      'QUICK_PICK_PUBLISH_BATCH_AUTHORITY_AMBIGUOUS',
      'EBAY_DRAFT_ONLY_BLOCKED'
    )
    and receipt_digest = p_expected_receipt_digest
    and marketplace_write_count = 0
    and execution_id is null
    and offer_id is null
    and item_id is null
    and attempt_count < 6
  for update;
  if not found then return; end if;

  select * into v_batch
  from public.seller_os_publisher_batch_authorizations_v1
  where id = p_batch_authorization_id
    and marketplace_account_key = p_marketplace_account_key
    and actor_user_id = v_child.actor_user_id
    and marketplace_id = 'EBAY_US'
    and status in ('AUTHORIZED', 'RUNNING', 'PARTIAL', 'BLOCKED')
  for update;
  if not found then return; end if;

  select * into v_package
  from public.ebay_listing_packages
  where id = v_child.package_id
    and account_key = v_child.marketplace_account_key
    and created_by = v_child.actor_user_id
    and candidate_key = v_child.candidate_id
    and status in ('ready_for_review', 'approved')
    and package_data #>>
      '{quickPickMarketTestPackageV1,packageDigest}' =
        v_child.package_digest
    and package_data #>>
      '{quickPickMarketTestPackageV1,authorizationBinding,imagesDigest}' =
        v_child.authorization_binding->>'imagesDigest'
  for key share;
  if not found then return; end if;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where approval_idempotency_key =
      'batch-approval:' || v_child.id::text
    and actor_user_id = v_child.actor_user_id
    and listing_package_id = v_child.package_id
    and candidate_key = v_child.candidate_id
  for key share;
  if not found then return; end if;
  v_quick_pick := v_approval.approved_payload #>
    '{compliance,quickPickPublicationAuthorization}';
  if v_quick_pick->>'commercialAuthorizationAuthority' is distinct from
      'SELLER_OS_PUBLISHER_BATCH_AUTHORIZATION_V1'
    or v_quick_pick->>'batchAuthorizationId' is distinct from v_batch.id::text
    or v_quick_pick->>'batchAuthorizationDigest' is distinct from
      v_batch.authorization_digest
    or v_quick_pick->>'actorUserId' is distinct from
      v_child.actor_user_id::text
    or v_quick_pick->>'accountKey' is distinct from
      v_child.marketplace_account_key
    or v_quick_pick->>'listingPackageId' is distinct from
      v_child.package_id::text
    or v_quick_pick->>'opportunityId' is distinct from
      v_approval.opportunity_id::text
    or v_quick_pick->>'candidateKey' is distinct from v_child.candidate_id
    or v_quick_pick->>'packageDigest' is distinct from v_child.package_digest
    or v_quick_pick->>'authorizedImagesDigest' is distinct from
      v_child.authorization_binding->>'imagesDigest' then
    raise exception 'SELLER_OS_PUBLISHER_BATCH_APPROVAL_LINEAGE_INVALID';
  end if;

  update public.seller_os_publisher_batch_children_v1
  set status = 'FAILED_RETRY_SAFE',
      stage = 'EXACT_AUTHORITY_RECOVERY_REARMED',
      retry_safety = 'EXACT_BATCH_APPROVAL_LINEAGE_RESUME_SAFE',
      retry_after_at = pg_catalog.clock_timestamp(),
      approval_id = coalesce(approval_id, v_approval.id),
      lease_owner = null,
      lease_expires_at = null,
      mismatch_fields = coalesce(mismatch_fields, '[]'::jsonb)
        || jsonb_build_array(
          'SELLER_OS_PUBLISHER_EXACT_AUTHORITY_RECOVERY_V2'),
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
  public.rearm_seller_os_publisher_batch_exact_authority_child_v2(
    text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function
  public.rearm_seller_os_publisher_batch_exact_authority_child_v2(
    text, uuid, uuid, text, text)
  to service_role;

comment on function
  public.rearm_seller_os_publisher_batch_exact_authority_child_v2(
    text, uuid, uuid, text, text) is
  'Bounded rearm for an unchanged exact batch child after shared authority-selection repairs. It reuses exact durable approval lineage and never mutates a package or marketplace resource.';

notify pgrst, 'reload schema';
