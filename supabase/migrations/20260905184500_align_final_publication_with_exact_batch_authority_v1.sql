create or replace function public.prepare_ebay_authorized_listing_publication(
  p_draft_execution_id uuid,
  p_actor_user_id uuid,
  p_marketplace_account_key text,
  p_preview_hash text,
  p_preview jsonb,
  p_target text,
  p_account_fingerprint text
)
returns setof public.ebay_authorized_listing_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_execution public.ebay_draft_only_execution_ledger%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_profile public.ebay_account_policy_profiles%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_batch_child public.seller_os_publisher_batch_children_v1%rowtype;
  v_batch public.seller_os_publisher_batch_authorizations_v1%rowtype;
  v_images jsonb;
  v_offer jsonb;
  v_policies jsonb;
  v_quick_pick jsonb;
  v_batch_authorized boolean := false;
  v_batch_child_id uuid;
begin
  if p_actor_user_id is null
    or p_target <> 'PRODUCTION'
    or p_account_fingerprint !~ '^[0-9a-f]{64}$'
    or p_marketplace_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or right(p_marketplace_account_key, 64) <> p_account_fingerprint
    or p_preview_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_preview) <> 'object'
    or p_preview->>'version' <> 'EBAY_AUTHORIZED_LISTING_PUBLICATION_V1'
    or p_preview->>'permittedOperation' <> 'publishOffer'
    or p_preview#>>'{pricingGuard,promotionsIncluded}' <> 'false'
    or p_preview#>>'{pricingGuard,volumePricingIncluded}' <> 'false' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_PREVIEW_INVALID';
  end if;

  select * into v_execution
  from public.ebay_draft_only_execution_ledger
  where id = p_draft_execution_id
  for update;
  if not found
    or v_execution.actor_user_id is distinct from p_actor_user_id
    or v_execution.phase <> 'completed'
    or v_execution.target <> p_target
    or v_execution.account_fingerprint <> p_account_fingerprint
    or v_execution.offer_id is null then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_DRAFT_NOT_COMPLETED';
  end if;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_execution.approval_id
  for key share;
  if not found
    or v_approval.actor_user_id is distinct from p_actor_user_id
    or v_approval.status <> 'consumed'
    or v_approval.consumed_at is null
    or v_approval.payload_hash is distinct from v_execution.request_hash
    or v_approval.target <> p_target
    or v_approval.account_fingerprint <> p_account_fingerprint then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_APPROVAL_INVALID';
  end if;

  v_quick_pick := v_approval.approved_payload #>
    '{compliance,quickPickPublicationAuthorization}';
  if v_approval.approval_idempotency_key ~
      '^batch-approval:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and v_quick_pick->>'commercialAuthorizationAuthority' =
      'SELLER_OS_PUBLISHER_BATCH_AUTHORIZATION_V1' then
    v_batch_child_id := substring(v_approval.approval_idempotency_key
      from 16)::uuid;
    select * into v_batch_child
    from public.seller_os_publisher_batch_children_v1
    where id = v_batch_child_id
    for key share;
    if not found then
      raise exception 'EBAY_AUTHORIZED_PUBLICATION_BATCH_AUTHORITY_INVALID';
    end if;
    select * into v_batch
    from public.seller_os_publisher_batch_authorizations_v1
    where id = v_batch_child.batch_authorization_id
    for key share;
    v_batch_authorized := found
      and v_batch.status in ('AUTHORIZED', 'RUNNING', 'PARTIAL', 'BLOCKED')
      and v_batch.marketplace_account_key = p_marketplace_account_key
      and v_batch.actor_user_id = p_actor_user_id
      and v_batch.marketplace_id = 'EBAY_US'
      and v_batch_child.marketplace_account_key = p_marketplace_account_key
      and v_batch_child.actor_user_id = p_actor_user_id
      and v_batch_child.package_id = v_approval.listing_package_id
      and v_batch_child.candidate_id = v_approval.candidate_key
      and v_batch_child.package_digest = v_quick_pick->>'packageDigest'
      and v_batch_child.authorization_binding->>'imagesDigest' =
        v_quick_pick->>'authorizedImagesDigest'
      and v_quick_pick->>'batchAuthorizationId' = v_batch.id::text
      and v_quick_pick->>'batchAuthorizationDigest' =
        v_batch.authorization_digest
      and v_quick_pick->>'actorUserId' = p_actor_user_id::text
      and v_quick_pick->>'accountKey' = p_marketplace_account_key
      and v_quick_pick->>'listingPackageId' =
        v_approval.listing_package_id::text
      and v_quick_pick->>'opportunityId' = v_approval.opportunity_id::text
      and v_quick_pick->>'candidateKey' = v_approval.candidate_key
      and v_quick_pick->>'validated' = 'true'
      and v_quick_pick->>'stockFreshness' = 'FRESH'
      and v_quick_pick->>'finalEconomicsStatus' = 'PASS'
      and v_quick_pick->>'requiredSpecificsStatus' = 'PASS'
      and v_quick_pick->>'marketplaceReadinessStatus' = 'PASS'
      and v_quick_pick->>'marketTestReadiness' = 'PASS'
      and v_quick_pick->>'publishableAsMarketTest' = 'true'
      and v_quick_pick->>'unattendedPublicationAllowed' = 'false';
    if not v_batch_authorized then
      raise exception 'EBAY_AUTHORIZED_PUBLICATION_BATCH_AUTHORITY_INVALID';
    end if;
  end if;

  select * into v_package
  from public.ebay_listing_packages
  where id = v_execution.listing_package_id
  for key share;
  if not found
    or v_package.created_by is distinct from p_actor_user_id
    or v_package.account_key is distinct from p_marketplace_account_key
    or (v_package.status <> 'approved' and not (
      v_batch_authorized and v_package.status = 'ready_for_review'))
    or v_package.opportunity_id is distinct from v_execution.opportunity_id
    or (v_batch_authorized and (
      v_package.package_data #>>
        '{quickPickMarketTestPackageV1,packageDigest}' is distinct from
          v_batch_child.package_digest
      or v_package.package_data #>>
        '{quickPickMarketTestPackageV1,authorizationBinding,imagesDigest}'
          is distinct from v_batch_child.authorization_binding->>'imagesDigest'
    )) then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_PACKAGE_INVALID';
  end if;

  select * into v_opportunity
  from public.ebay_luna_opportunity_queue
  where id = v_execution.opportunity_id
  for key share;
  if not found
    or v_opportunity.candidate_key is distinct from v_approval.candidate_key
    or (not v_batch_authorized and (
      v_opportunity.supplier_available is distinct from true
      or coalesce(v_opportunity.supplier_inventory_quantity, 0) < 1
      or v_opportunity.queue_status in ('hold', 'rejected', 'listed', 'archived')
    )) then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_OPPORTUNITY_INVALID';
  end if;

  if not v_batch_authorized then
    select candidate.* into v_candidate
    from public.ebay_same_day_pilot_candidates candidate
    join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
    where candidate.opportunity_id = v_opportunity.id
      and candidate.candidate_key = v_opportunity.candidate_key
      and run.marketplace_account_key = p_marketplace_account_key
      and candidate.state = 'READY_FOR_MANUAL_PUBLICATION'
      and candidate.machine_state in (
        'READY_FOR_MANUAL_PUBLICATION', 'WAITING_ITEM_ID')
    order by candidate.updated_at desc
    limit 1
    for update of candidate;
    if not found then
      raise exception 'EBAY_AUTHORIZED_PUBLICATION_APPROVED_CANDIDATE_REQUIRED';
    end if;
  end if;

  v_images := v_approval.approved_payload #>
    '{inventoryItemPayload,product,imageUrls}';
  if jsonb_typeof(v_images) <> 'array'
    or jsonb_array_length(v_images) < 1
    or (select count(distinct image.value)
      from jsonb_array_elements_text(v_images) image(value)) <>
        jsonb_array_length(v_images)
    or exists (
      select 1 from jsonb_array_elements_text(v_images) image(value)
      where image.value !~ '^https://'
    )
    or v_approval.approved_payload #>>
      '{compliance,imageAuthorization,approved}' <> 'true'
    or v_approval.approved_payload #>>
      '{compliance,imageAuthorization,protectedManifestVerified}' <> 'true'
    or (v_approval.approved_payload #>
      '{compliance,imageAuthorization,approvedImageUrls}') is distinct from
        v_images
    or coalesce((v_approval.approved_payload #>>
      '{compliance,imageAuthorization,protectedManifestAssetCount}')::integer,
      0) <> jsonb_array_length(v_images)
    or (not v_batch_authorized and jsonb_array_length(v_images) <> 6) then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_APPROVED_IMAGES_REQUIRED';
  end if;

  v_offer := v_approval.approved_payload -> 'offerPayload';
  v_policies := v_offer -> 'listingPolicies';
  if v_offer->>'sku' is distinct from v_execution.sku
    or v_offer->>'marketplaceId' <> 'EBAY_US'
    or v_execution.offer_id is distinct from p_preview->>'offerId'
    or v_execution.sku is distinct from p_preview->>'sku'
    or v_approval.payload_hash is distinct from
      p_preview->>'approvedPayloadHash'
    or v_approval.approved_payload->'inventoryItemPayload'
      is distinct from p_preview->'inventoryItemPayload'
    or v_offer is distinct from p_preview->'offerPayload'
    or (select count(*) from jsonb_object_keys(
      coalesce(v_policies, '{}'::jsonb))) <> 3
    or (select count(*) from jsonb_object_keys(
      coalesce(v_offer->'pricingSummary', '{}'::jsonb))) <> 1
    or v_offer ? 'volumePricingDiscount'
    or v_offer ? 'bestOfferTerms'
    or p_preview ? 'comparable'
    or p_preview ? 'comparables' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_PREVIEW_MISMATCH';
  end if;

  select * into v_profile
  from public.ebay_account_policy_profiles
  where account_key = p_marketplace_account_key
    and marketplace_id = 'EBAY_US'
    and expires_at > clock_timestamp()
  for key share;
  if not found
    or v_profile.fulfillment_policy_id is distinct from
      v_policies->>'fulfillmentPolicyId'
    or v_profile.payment_policy_id is distinct from
      v_policies->>'paymentPolicyId'
    or v_profile.return_policy_id is distinct from
      v_policies->>'returnPolicyId'
    or v_profile.merchant_location_key is distinct from
      v_offer->>'merchantLocationKey' then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_VERIFIED_POLICIES_REQUIRED';
  end if;

  select * into v_publication
  from public.ebay_authorized_listing_publications
  where draft_execution_id = p_draft_execution_id
  for update;
  if found then
    if v_publication.actor_user_id is distinct from p_actor_user_id
      or v_publication.preview_hash is distinct from p_preview_hash
      or v_publication.offer_id is distinct from v_execution.offer_id
      or v_publication.sku is distinct from v_execution.sku
      or v_publication.marketplace_account_key is distinct from
        p_marketplace_account_key then
      raise exception 'EBAY_AUTHORIZED_PUBLICATION_IDEMPOTENCY_MISMATCH';
    end if;
    if v_publication.phase = 'preview_ready' then
      update public.ebay_authorized_listing_publications
      set preview = p_preview,
          preview_prepared_at = clock_timestamp(),
          last_error_code = null,
          updated_at = clock_timestamp()
      where id = v_publication.id
      returning * into v_publication;
    end if;
    return next v_publication;
    return;
  end if;

  insert into public.ebay_authorized_listing_publications (
    draft_execution_id, draft_approval_id, listing_package_id,
    opportunity_id, actor_user_id, marketplace_account_key, target,
    account_fingerprint, offer_id, sku, preview_hash, preview
  ) values (
    v_execution.id, v_approval.id, v_package.id, v_opportunity.id,
    p_actor_user_id, p_marketplace_account_key, p_target,
    p_account_fingerprint, v_execution.offer_id, v_execution.sku,
    p_preview_hash, p_preview
  ) returning * into v_publication;
  return next v_publication;
end;
$$;

create or replace function public.complete_ebay_authorized_listing_monitor_registration(
  p_publication_id uuid,
  p_actor_user_id uuid,
  p_listing_id text,
  p_active_listing_id uuid,
  p_manual_registration_id uuid
)
returns setof public.ebay_authorized_listing_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_active public.ebay_active_listings%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_batch_child public.seller_os_publisher_batch_children_v1%rowtype;
  v_batch public.seller_os_publisher_batch_authorizations_v1%rowtype;
  v_now timestamptz := clock_timestamp();
  v_verified integer;
  v_ready integer;
  v_batch_authorized boolean := false;
  v_batch_child_id uuid;
  v_quick_pick jsonb;
begin
  select * into v_publication
  from public.ebay_authorized_listing_publications
  where id = p_publication_id
  for update;
  if not found
    or v_publication.actor_user_id is distinct from p_actor_user_id
    or v_publication.phase not in (
      'published_pending_verification', 'monitor_registered')
    or v_publication.listing_id is distinct from p_listing_id then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_MONITOR_NOT_COMPLETABLE';
  end if;
  if v_publication.phase = 'monitor_registered' then
    return next v_publication;
    return;
  end if;
  select * into v_active
  from public.ebay_active_listings
  where id = p_active_listing_id
    and account_key = v_publication.marketplace_account_key
    and ebay_item_id = p_listing_id
    and listing_status = 'active'
    and ebay_sku = v_publication.sku
  for key share;
  select * into v_link
  from public.ebay_manual_listing_links
  where id = p_manual_registration_id
    and account_key = v_publication.marketplace_account_key
    and ebay_item_id = p_listing_id
    and opportunity_id = v_publication.opportunity_id
    and candidate_key = v_publication.preview->>'candidateKey'
    and verification_status = 'verified'
    and connector_listing_id = p_active_listing_id
  for key share;
  if v_active.id is null or v_link.id is null then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_ACTIVE_EVIDENCE_REQUIRED';
  end if;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_publication.draft_approval_id
  for key share;
  if found and v_approval.approval_idempotency_key ~
      '^batch-approval:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_quick_pick := v_approval.approved_payload #>
      '{compliance,quickPickPublicationAuthorization}';
    v_batch_child_id := substring(v_approval.approval_idempotency_key
      from 16)::uuid;
    select * into v_batch_child
    from public.seller_os_publisher_batch_children_v1
    where id = v_batch_child_id
    for key share;
    if found then
      select * into v_batch
      from public.seller_os_publisher_batch_authorizations_v1
      where id = v_batch_child.batch_authorization_id
      for key share;
      v_batch_authorized := found
        and v_quick_pick->>'commercialAuthorizationAuthority' =
          'SELLER_OS_PUBLISHER_BATCH_AUTHORIZATION_V1'
        and v_batch.status in (
          'AUTHORIZED', 'RUNNING', 'PARTIAL', 'BLOCKED')
        and v_batch.marketplace_account_key =
          v_publication.marketplace_account_key
        and v_batch.actor_user_id = p_actor_user_id
        and v_batch_child.package_id = v_publication.listing_package_id
        and v_batch_child.candidate_id =
          v_publication.preview->>'candidateKey'
        and v_batch_child.package_digest =
          v_quick_pick->>'packageDigest'
        and v_batch_child.authorization_binding->>'imagesDigest' =
          v_quick_pick->>'authorizedImagesDigest'
        and v_quick_pick->>'batchAuthorizationId' = v_batch.id::text
        and v_quick_pick->>'batchAuthorizationDigest' =
          v_batch.authorization_digest;
    end if;
  end if;

  update public.ebay_authorized_listing_publications
  set phase = 'monitor_registered',
      active_listing_id = p_active_listing_id,
      manual_registration_id = p_manual_registration_id,
      verified_active_at = v_link.verified_at,
      monitor_registered_at = v_now,
      last_error_code = null,
      sanitized_result = sanitized_result || jsonb_build_object(
        'activeListingId', p_active_listing_id,
        'manualRegistrationId', p_manual_registration_id,
        'activeVerified', true,
        'monitorRegistered', true
      ),
      updated_at = v_now
  where id = p_publication_id
  returning * into v_publication;

  if v_batch_authorized then
    return next v_publication;
    return;
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
  where candidate.opportunity_id = v_publication.opportunity_id
    and candidate.candidate_key = v_publication.preview->>'candidateKey'
    and run.marketplace_account_key = v_publication.marketplace_account_key
  order by candidate.updated_at desc
  limit 1
  for update of candidate;
  if not found then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_PILOT_CANDIDATE_REQUIRED';
  end if;

  insert into public.ebay_same_day_pilot_transitions (
    run_id, candidate_id, previous_state, next_state, reason_code,
    triggered_by, started_at, completed_at, attempt, checkpoint,
    evidence_hash, idempotency_key, next_automatic_action, next_human_action
  ) values (
    v_candidate.run_id, v_candidate.id, v_candidate.machine_state,
    'VERIFIED_ACTIVE', 'AUTOMATED_PUBLISH_ACTIVE_AND_MONITOR_REGISTERED',
    'SYSTEM', coalesce(v_publication.publish_started_at, v_now), v_now, 1,
    jsonb_build_object(
      'publicationId', v_publication.id,
      'offerId', v_publication.offer_id,
      'listingId', p_listing_id,
      'activeListingId', p_active_listing_id,
      'monitorRegisteredAt', v_now
    ),
    encode(digest(convert_to(concat(
      v_publication.id::text, ':', p_listing_id, ':',
      p_active_listing_id::text
    ), 'UTF8'), 'sha256'), 'hex'),
    concat('auto-publish-monitor:', v_publication.id::text),
    'Monitorear desempeño comercial y disponibilidad Luna.',
    'Ninguna acción inmediata.'
  ) on conflict (idempotency_key) do nothing;

  update public.ebay_same_day_pilot_candidates
  set state = 'VERIFIED_ACTIVE',
      machine_state = 'VERIFIED_ACTIVE',
      blockers = '{}',
      evidence_summary = coalesce(evidence_summary, '{}'::jsonb) ||
        jsonb_build_object(
          'automatedPublicationId', v_publication.id,
          'ebayItemId', p_listing_id,
          'activeListingId', p_active_listing_id,
          'activeVerifiedAt', v_link.verified_at,
          'commercialMonitorRegisteredAt', v_now
        ),
      next_automated_action =
        'Monitorear desempeño comercial y disponibilidad Luna.',
      next_human_action = 'Ninguna acción inmediata.',
      updated_at = v_now
  where id = v_candidate.id;

  update public.ebay_same_day_pilot_human_tasks
  set status = 'COMPLETED',
      completed_at = coalesce(completed_at, v_now),
      updated_at = v_now
  where candidate_id = v_candidate.id
    and status = 'OPEN'
    and gate_type in ('MANUAL_PUBLICATION_REQUIRED', 'ITEM_ID_REQUIRED');

  select least(2, count(*) filter (where state = 'VERIFIED_ACTIVE')),
         least(2, count(*) filter (
           where state = 'READY_FOR_MANUAL_PUBLICATION'))
  into v_verified, v_ready
  from public.ebay_same_day_pilot_candidates
  where run_id = v_candidate.run_id;

  update public.ebay_same_day_pilot_runs
  set verified_new_listings = v_verified,
      ready_for_manual_publication_count = v_ready,
      status = case when v_verified >= target_new_listings
        then 'COMPLETED' else 'PARTIALLY_READY' end,
      stage = case when v_verified >= target_new_listings
        then 'PILOT_COMPLETED' else 'PUBLICATION_MONITORING' end,
      monitor_snapshot = coalesce(monitor_snapshot, '{}'::jsonb) ||
        jsonb_build_object(
          'lastRegisteredListingId', p_listing_id,
          'lastRegisteredAt', v_now,
          'activeListingId', p_active_listing_id
        ),
      next_automated_action =
        'Continuar monitoreo comercial de listings ACTIVE.',
      next_human_action = case when v_verified >= target_new_listings
        then 'Ninguna acción inmediata.'
        else 'Revisar el siguiente preview final listo.' end,
      updated_at = v_now
  where id = v_candidate.run_id;

  return next v_publication;
end;
$$;

revoke all on function public.prepare_ebay_authorized_listing_publication(
  uuid,uuid,text,text,jsonb,text,text
) from public, anon, authenticated;
grant execute on function public.prepare_ebay_authorized_listing_publication(
  uuid,uuid,text,text,jsonb,text,text
) to service_role;

revoke all on function
  public.complete_ebay_authorized_listing_monitor_registration(
    uuid,uuid,text,uuid,uuid
  ) from public, anon, authenticated;
grant execute on function
  public.complete_ebay_authorized_listing_monitor_registration(
    uuid,uuid,text,uuid,uuid
  ) to service_role;

comment on function public.prepare_ebay_authorized_listing_publication(
  uuid,uuid,text,text,jsonb,text,text
) is
  'Prepares an exact unpublished Offer preview. Current exact Seller OS batch authority uses its immutable package/image binding; legacy same-day publications retain the pilot contract.';

notify pgrst, 'reload schema';
