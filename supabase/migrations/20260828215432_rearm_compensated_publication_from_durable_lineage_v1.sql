-- Rearming a compensated publication restores only the existing durable
-- Golden Path ledger. Current listing readiness is intentionally evaluated
-- after rearm and again before any marketplace write. The recovery itself is
-- authorized by the immutable approval/execution/preview lineage plus fresh
-- official eBay readbacks performed by the authenticated API route.

create or replace function
  public.rearm_ebay_authorized_listing_after_compensated_monitor_failure_once(
    p_publication_id uuid,
    p_actor_user_id uuid,
    p_confirm_publish text,
    p_expected_error_code text
  )
returns setof public.ebay_authorized_listing_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_execution public.ebay_draft_only_execution_ledger%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_old_active public.ebay_active_listings%rowtype;
  v_old_link public.ebay_manual_listing_links%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor_user_id is null
    or p_confirm_publish <> 'PUBLICAR LISTING EN EBAY'
    or p_expected_error_code <>
      'EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED' then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_RECOVERY_INVALID';
  end if;

  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_publication.draft_approval_id;
  select * into v_execution
  from public.ebay_draft_only_execution_ledger
  where id = v_publication.draft_execution_id;
  select * into v_package
  from public.ebay_listing_packages
  where id = v_publication.listing_package_id;
  select * into v_opportunity
  from public.ebay_luna_opportunity_queue
  where id = v_publication.opportunity_id;

  if v_publication.id is null
    or v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.phase <> 'terminal_failure'
    or v_publication.last_error_code is distinct from p_expected_error_code
    or v_publication.listing_id !~ '^[0-9]{9,20}$'
    or v_publication.publish_attempt_count <> 1
    or v_publication.publish_recovery_count <> 0
    or v_publication.sanitized_result->>'attachmentFailed' <> 'true'
    or v_publication.sanitized_result->>'compensatingEndVerified' <> 'true'
    or v_publication.sanitized_result->>'officialReadbackNotCurrentLive'
      <> 'true'
    or v_approval.id is null
    or v_approval.actor_user_id is distinct from p_actor_user_id
    or v_approval.status <> 'consumed'
    or v_approval.consumed_at is null
    or v_approval.revoked_at is not null
    or v_approval.target <> 'PRODUCTION'
    or v_approval.account_fingerprint is distinct from
      v_publication.account_fingerprint
    or v_approval.listing_package_id is distinct from v_package.id
    or v_approval.opportunity_id is distinct from v_opportunity.id
    or v_approval.candidate_key is distinct from v_package.candidate_key
    or v_execution.id is null
    or v_execution.actor_user_id is distinct from p_actor_user_id
    or v_execution.approval_id is distinct from v_approval.id
    or v_execution.listing_package_id is distinct from v_package.id
    or v_execution.opportunity_id is distinct from v_opportunity.id
    or v_execution.phase <> 'completed'
    or v_execution.target <> 'PRODUCTION'
    or v_execution.account_fingerprint is distinct from
      v_publication.account_fingerprint
    or v_execution.request_hash is distinct from v_approval.payload_hash
    or v_execution.offer_id is distinct from v_publication.offer_id
    or v_execution.sku is distinct from v_publication.sku
    or v_package.id is null
    or v_package.created_by is distinct from p_actor_user_id
    or v_package.account_key is distinct from
      v_publication.marketplace_account_key
    or v_package.opportunity_id is distinct from v_opportunity.id
    or v_package.candidate_key is distinct from v_opportunity.candidate_key
    or v_package.status not in ('draft', 'ready_for_review', 'approved')
    or v_opportunity.id is null
    or v_publication.preview->>'draftExecutionId' is distinct from
      v_execution.id::text
    or v_publication.preview->>'draftApprovalId' is distinct from
      v_approval.id::text
    or v_publication.preview->>'listingPackageId' is distinct from
      v_package.id::text
    or v_publication.preview->>'opportunityId' is distinct from
      v_opportunity.id::text
    or v_publication.preview->>'candidateKey' is distinct from
      v_package.candidate_key
    or v_publication.preview->>'approvedPayloadHash' is distinct from
      v_approval.payload_hash
    or v_publication.preview->>'offerId' is distinct from
      v_publication.offer_id
    or v_publication.preview->>'sku' is distinct from v_publication.sku
    or v_publication.preview->'inventoryItemPayload' is distinct from
      v_approval.approved_payload->'inventoryItemPayload'
    or v_publication.preview->'offerPayload' is distinct from
      v_approval.approved_payload->'offerPayload'
  then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_RECOVERY_NOT_ELIGIBLE';
  end if;

  select * into v_old_active
  from public.ebay_active_listings
  where account_key = v_publication.marketplace_account_key
    and ebay_item_id = v_publication.listing_id
    and ebay_sku = v_publication.sku
    and listing_status = 'ended'
  for update;
  if not found then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_ENDED_REGISTRY_REQUIRED';
  end if;

  select * into v_old_link
  from public.ebay_manual_listing_links
  where account_key = v_publication.marketplace_account_key
    and opportunity_id = v_publication.opportunity_id
    and candidate_key = v_publication.preview->>'candidateKey'
    and ebay_item_id = v_publication.listing_id
    and connector_listing_id = v_old_active.id
    and verification_status = 'verified'
    and connector_ebay_sku = v_publication.sku
  for update;
  if not found then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_VERIFIED_LINK_REQUIRED';
  end if;

  if exists (
    select 1 from public.ebay_active_listings active
    where active.account_key = v_publication.marketplace_account_key
      and active.ebay_sku = v_publication.sku
      and active.listing_status = 'active'
  ) then
    raise exception 'EBAY_COMPENSATED_PUBLICATION_ACTIVE_DUPLICATE';
  end if;

  update public.ebay_authorized_listing_publications
  set phase = 'preview_ready',
      publication_idempotency_key = null,
      publish_attempt_count = 0,
      publish_recovery_count = 1,
      claim_token = null,
      lease_expires_at = null,
      publish_http_status = null,
      listing_id = null,
      active_listing_id = null,
      manual_registration_id = null,
      publish_started_at = null,
      published_at = null,
      verified_active_at = null,
      monitor_registered_at = null,
      preview_prepared_at = v_now,
      last_error_code = null,
      sanitized_result = v_publication.sanitized_result || jsonb_build_object(
        'compensatedListingId', v_publication.listing_id,
        'compensatedFailureCode', p_expected_error_code,
        'compensatedRecoveryAuthorizedAt', v_now,
        'compensatedRecoveryCount', 1
      ),
      updated_at = v_now
  where id = p_publication_id
  returning * into v_publication;
  return next v_publication;
end;
$$;

revoke all on function
  public.rearm_ebay_authorized_listing_after_compensated_monitor_failure_once(
    uuid, uuid, text, text
  )
from public, anon, authenticated;
grant execute on function
  public.rearm_ebay_authorized_listing_after_compensated_monitor_failure_once(
    uuid, uuid, text, text
  )
to service_role;
