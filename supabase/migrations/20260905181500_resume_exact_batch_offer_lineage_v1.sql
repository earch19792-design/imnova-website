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
  v_batch public.seller_os_publisher_batch_authorizations_v1%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
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
      'EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED',
      'SELLER_OS_PUBLISHER_BATCH_MATERIAL_BINDING_INVALID')
    and child.receipt_digest = p_expected_receipt_digest
    and child.marketplace_write_count = 0
    and child.execution_id is null
    and child.offer_id is null
    and child.item_id is null
    and child.attempt_count < 4
    and batch.status in ('PARTIAL', 'BLOCKED')
    and package_row.status in ('ready_for_review', 'approved')
    and package_row.account_key = child.marketplace_account_key
    and package_row.created_by = child.actor_user_id
    and package_row.candidate_key = child.candidate_id
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

  select * into strict v_batch
  from public.seller_os_publisher_batch_authorizations_v1
  where id = p_batch_authorization_id;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where approval_idempotency_key = 'batch-approval:' || v_child.id::text;

  if found then
    if v_approval.actor_user_id is distinct from v_child.actor_user_id
      or v_approval.listing_package_id is distinct from v_child.package_id
      or v_approval.opportunity_id::text is distinct from
        v_approval.approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,opportunityId}'
      or v_approval.candidate_key is distinct from v_child.candidate_id
      or v_approval.approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,commercialAuthorizationAuthority}'
          is distinct from 'SELLER_OS_PUBLISHER_BATCH_AUTHORIZATION_V1'
      or v_approval.approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,batchAuthorizationId}'
          is distinct from v_batch.id::text
      or v_approval.approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,batchAuthorizationDigest}'
          is distinct from v_batch.authorization_digest
      or v_approval.approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,packageDigest}'
          is distinct from v_child.package_digest
      or v_approval.approved_payload #>>
          '{compliance,quickPickPublicationAuthorization,authorizedImagesDigest}'
          is distinct from v_child.authorization_binding->>'imagesDigest'
    then
      raise exception 'SELLER_OS_PUBLISHER_BATCH_APPROVAL_LINEAGE_INVALID';
    end if;
  elsif v_child.error_class = 'EBAY_DRAFT_ONLY_REAPPROVAL_REQUIRED' then
    return;
  end if;

  update public.seller_os_publisher_batch_children_v1
  set status = 'FAILED_RETRY_SAFE',
    stage = 'PREFLIGHT_RECOVERY_REARMED',
    retry_safety = case when v_approval.id is not null
      then 'EXACT_BATCH_APPROVAL_LINEAGE_RESUME_SAFE'
      else 'SAFE_TO_RETRY_AFTER_MECHANISM_REPAIR' end,
    retry_after_at = pg_catalog.clock_timestamp(),
    approval_id = coalesce(approval_id, v_approval.id),
    lease_owner = null,
    lease_expires_at = null,
    mismatch_fields = coalesce(mismatch_fields, '[]'::jsonb)
      || jsonb_build_array('SELLER_OS_PUBLISHER_PREFLIGHT_RECOVERY_V1'),
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
  'Atomically rearms exact unchanged batch children after a shared prewrite or cross-approval comparator repair. Existing approval lineage is reused; no package, Offer, Item, or commercial authority is mutated.';

notify pgrst, 'reload schema';
