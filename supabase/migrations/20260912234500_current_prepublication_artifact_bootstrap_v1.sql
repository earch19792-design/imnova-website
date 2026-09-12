-- Bootstrap the first CURRENT unpublished intent without consulting a legacy
-- publication candidate. The caller has already created and read back exactly
-- one Inventory Item and one UNPUBLISHED Offer. This function only persists the
-- exact intent and its CURRENT revision; it can never claim or publish it.
create unique index if not exists ebay_authorized_publication_current_package_uidx
  on public.ebay_authorized_listing_publications(
    listing_package_id, marketplace_account_key
  ) where phase <> 'terminal_failure';

create or replace function public.prepare_current_prepublication_intent_v1(
  p_publication_id uuid,
  p_draft_execution_id uuid,
  p_actor_user_id uuid,
  p_marketplace_account_key text,
  p_preview_hash text,
  p_preview jsonb,
  p_target text,
  p_account_fingerprint text,
  p_revision jsonb
)
returns setof public.ebay_authorized_listing_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  x public.ebay_draft_only_execution_ledger%rowtype;
  a public.ebay_draft_only_approvals%rowtype;
  k public.ebay_listing_packages%rowtype;
  o public.ebay_luna_opportunity_queue%rowtype;
  f public.ebay_account_policy_profiles%rowtype;
  p public.ebay_authorized_listing_publications%rowtype;
  authority jsonb;
  factory jsonb;
  exposure jsonb;
  canonical jsonb;
  binding jsonb;
  offer jsonb;
  policies jsonb;
  prep jsonb;
begin
  if p_publication_id is null or p_actor_user_id is null
    or p_target <> 'PRODUCTION'
    or p_account_fingerprint !~ '^[0-9a-f]{64}$'
    or p_marketplace_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or right(p_marketplace_account_key, 64) <> p_account_fingerprint
    or p_preview_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_preview) is distinct from 'object'
    or jsonb_typeof(p_revision) is distinct from 'object'
    or p_preview->>'version' <> 'EBAY_AUTHORIZED_LISTING_PUBLICATION_V1'
    or p_preview->>'permittedOperation' <> 'publishOffer'
    or p_preview#>>'{pricingGuard,promotionsIncluded}' <> 'false'
    or p_preview#>>'{pricingGuard,volumePricingIncluded}' <> 'false' then
    raise exception 'CURRENT_PREPUBLICATION_INTENT_INPUT_INVALID';
  end if;

  select * into x from public.ebay_draft_only_execution_ledger
    where id=p_draft_execution_id for update;
  if not found or x.actor_user_id is distinct from p_actor_user_id
    or x.phase <> 'completed' or x.target <> p_target
    or x.account_fingerprint <> p_account_fingerprint
    or x.offer_id is null then
    raise exception 'CURRENT_PREPUBLICATION_EXECUTION_NOT_COMPLETED';
  end if;

  select * into a from public.ebay_draft_only_approvals
    where id=x.approval_id for key share;
  if not found or a.actor_user_id is distinct from p_actor_user_id
    or a.status <> 'consumed' or a.consumed_at is null or a.revoked_at is not null
    or a.payload_hash is distinct from x.request_hash
    or a.target <> p_target or a.account_fingerprint <> p_account_fingerprint
    or a.listing_package_id is distinct from x.listing_package_id
    or a.opportunity_id is distinct from x.opportunity_id then
    raise exception 'CURRENT_PREPUBLICATION_APPROVAL_INVALID';
  end if;

  select * into k from public.ebay_listing_packages
    where id=x.listing_package_id for key share;
  select * into o from public.ebay_luna_opportunity_queue
    where id=x.opportunity_id for key share;
  if k.id is null or o.id is null or k.created_by is distinct from p_actor_user_id
    or k.account_key is distinct from p_marketplace_account_key
    or k.status <> 'approved' or k.opportunity_id is distinct from o.id
    or k.candidate_key is distinct from o.candidate_key
    or a.candidate_key is distinct from o.candidate_key
    or o.supplier_available is distinct from true
    or o.queue_status in ('hold','rejected','listed','archived') then
    raise exception 'CURRENT_PREPUBLICATION_PACKAGE_OR_PRODUCT_INVALID';
  end if;

  authority:=a.approved_payload#>'{compliance,currentPrepublicationArtifactAuthorityV1}';
  factory:=k.package_data->'currentPublicationFactoryV1';
  exposure:=k.package_data->'packageExposurePolicyV1';
  canonical:=o.assessment->'canonicalMarketplaceReadinessV1';
  binding:=exposure->'binding';
  if authority->>'version' <> 'SELLER_OS_CURRENT_PREPUBLICATION_ARTIFACT_AUTHORITY_V1'
    or authority->>'accountKey' is distinct from k.account_key
    or authority->>'packageId' is distinct from k.id::text
    or authority->>'opportunityId' is distinct from o.id::text
    or authority->>'candidateKey' is distinct from k.candidate_key
    or authority->>'actorUserId' is distinct from p_actor_user_id::text
    or authority->>'productId' is distinct from o.supplier_product_id
    or authority->>'variantId' is distinct from o.supplier_variant_id
    or authority->>'supplierSku' is distinct from o.supplier_sku
    or authority->>'productTruthDigest' is distinct from o.assessment#>>'{productTruth,evidenceDigest}'
    or authority->>'packageGeneration' is distinct from factory->>'generation'
    or authority->'permittedOperations' is distinct from
      '["createOrReplaceInventoryItem","createOffer"]'::jsonb
    or authority->>'publicationCommitAllowed' <> 'false'
    or authority->>'publicMarketplaceExposureAllowed' <> 'false'
    or authority->>'adsAllowed' <> 'false'
    or authority->>'blindRetryAllowed' <> 'false'
    or authority->>'ownerRoutineApprovalRequired' <> 'false'
    or authority->>'codexRuntimeDependency' <> 'false'
    or coalesce(authority->>'bindingDigest','') !~ '^sha256:[a-f0-9]{64}$'
    or factory->>'version' <> 'SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1'
    or factory->>'authorityPolicy' <> 'CURRENT_ONLY'
    or factory->>'reuseLegacyPreparation' <> 'false'
    or factory->>'packageId' is distinct from k.id::text
    or factory->>'accountKey' is distinct from k.account_key
    or factory->>'productId' is distinct from o.supplier_product_id
    or factory->>'variantId' is distinct from o.supplier_variant_id
    or factory->>'supplierSku' is distinct from o.supplier_sku
    or canonical->>'productTruthDigest' is distinct from authority->>'productTruthDigest'
    or canonical->>'ready' <> 'true'
    or canonical->>'listingPolicyReady' <> 'true'
    or canonical->>'requiredItemSpecificsReady' <> 'true'
    or exposure->>'version' <> 'SELLER_OS_PACKAGE_LISTING_EXPOSURE_V1'
    or exposure->>'sourcePolicy' <> 'SELLER_OS_CURRENT_FACTORY_ROUTINE_EXPOSURE_AUTHORITY_V1'
    or exposure->>'status' <> 'ACTIVE' or exposure->>'quantity' <> '1'
    or exposure->>'supplierQuantityInferred' <> 'false'
    or exposure->>'publicationAuthorized' <> 'false'
    or binding->>'accountKey' is distinct from k.account_key
    or binding->>'packageId' is distinct from k.id::text
    or binding->>'productId' is distinct from o.supplier_product_id
    or binding->>'variantId' is distinct from o.supplier_variant_id
    or binding->>'sku' is distinct from o.supplier_sku
    or binding->>'productTruthDigest' is distinct from authority->>'productTruthDigest' then
    raise exception 'CURRENT_PREPUBLICATION_AUTHORITY_CHANGED';
  end if;

  offer:=a.approved_payload->'offerPayload';
  policies:=offer->'listingPolicies';
  select * into f from public.ebay_account_policy_profiles
    where account_key=p_marketplace_account_key and marketplace_id='EBAY_US'
      and expires_at>clock_timestamp() for key share;
  if not found
    or f.fulfillment_policy_id is distinct from policies->>'fulfillmentPolicyId'
    or f.payment_policy_id is distinct from policies->>'paymentPolicyId'
    or f.return_policy_id is distinct from policies->>'returnPolicyId'
    or f.merchant_location_key is distinct from offer->>'merchantLocationKey'
    or offer->>'sku' is distinct from x.sku
    or offer->>'marketplaceId' <> 'EBAY_US'
    or x.offer_id is distinct from p_preview->>'offerId'
    or x.sku is distinct from p_preview->>'sku'
    or a.payload_hash is distinct from p_preview->>'approvedPayloadHash'
    or a.approved_payload->'inventoryItemPayload' is distinct from
      p_preview->'inventoryItemPayload'
    or offer is distinct from p_preview->'offerPayload' then
    raise exception 'CURRENT_PREPUBLICATION_PREVIEW_MISMATCH';
  end if;

  if p_revision->>'version' <> 'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1'
    or p_revision->>'publicationId' is distinct from p_publication_id::text
    or p_revision->>'packageId' is distinct from k.id::text
    or p_revision->>'accountKey' is distinct from k.account_key
    or p_revision->>'productId' is distinct from o.supplier_product_id
    or p_revision->>'variantId' is distinct from o.supplier_variant_id
    or p_revision->>'sku' is distinct from o.supplier_sku
    or p_revision->>'priorPreviewHash' is distinct from p_preview_hash
    or p_revision->>'priorDraftExecutionId' is distinct from x.id::text
    or p_revision->>'preparationStatus' <> 'INTERNAL_PREVIEW_ONLY'
    or p_revision->>'ebayPrevalidated' <> 'false'
    or p_revision->>'publicationAuthorized' <> 'false'
    or p_revision#>>'{snapshot,binding,ACCOUNT_KEY}' is distinct from k.account_key
    or p_revision#>>'{snapshot,binding,PRODUCT_ID}' is distinct from o.supplier_product_id
    or p_revision#>>'{snapshot,binding,VARIANT_ID}' is distinct from o.supplier_variant_id
    or p_revision#>>'{snapshot,binding,SKU}' is distinct from o.supplier_sku
    or p_revision#>>'{snapshot,binding,OPPORTUNITY_ID}' is distinct from o.id::text
    or p_revision#>>'{snapshot,binding,CANDIDATE_KEY}' is distinct from k.candidate_key
    or p_revision->>'packageGeneration' is distinct from
      p_revision#>>'{certifiedPackage,listingPackage,generation}'
    or p_revision#>'{snapshot,content}' is distinct from
      p_revision#>'{certifiedPackage,listingPackage,content}'
    or p_revision#>>'{preview,sku}' is distinct from x.sku
    or p_revision#>'{preview,inventoryItemPayload}' is distinct from
      a.approved_payload->'inventoryItemPayload'
    or p_revision#>>'{preview,offerPayload,sku}' is distinct from offer->>'sku'
    or p_revision#>>'{preview,offerPayload,categoryId}' is distinct from offer->>'categoryId'
    or p_revision#>'{preview,offerPayload,pricingSummary}' is distinct from offer->'pricingSummary'
    or p_revision#>'{preview,offerPayload,listingPolicies}' is distinct from policies
    or p_revision#>>'{preview,offerPayload,merchantLocationKey}' is distinct from offer->>'merchantLocationKey'
    or coalesce(p_revision->>'packageHash','') !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(p_revision->>'previewHash','') !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'CURRENT_PREPUBLICATION_REVISION_INVALID';
  end if;

  select * into p from public.ebay_authorized_listing_publications
    where listing_package_id=k.id and marketplace_account_key=k.account_key
      and phase<>'terminal_failure' for update;
  if found then
    if p.id is distinct from p_publication_id
      or p.draft_execution_id is distinct from x.id
      or p.preview_hash is distinct from p_preview_hash
      or p.sanitized_result#>>'{publicationPreparationV1,current,revisionKey}'
        is distinct from p_revision->>'revisionKey' then
      raise exception 'CURRENT_PREPUBLICATION_INTENT_CONFLICT';
    end if;
    return next p;
    return;
  end if;

  prep:=jsonb_build_object('current',p_revision,'exposurePolicy',exposure);
  insert into public.ebay_authorized_listing_publications(
    id,draft_execution_id,draft_approval_id,listing_package_id,opportunity_id,
    actor_user_id,marketplace_account_key,target,account_fingerprint,offer_id,
    sku,preview_hash,preview,phase,publication_idempotency_key,
    publish_attempt_count,claim_token,listing_id,sanitized_result
  ) values (
    p_publication_id,x.id,a.id,k.id,o.id,p_actor_user_id,
    p_marketplace_account_key,p_target,p_account_fingerprint,x.offer_id,x.sku,
    p_preview_hash,p_preview,'preview_ready',null,0,null,null,
    jsonb_build_object(
      'currentPrepublicationArtifactBootstrapV1',jsonb_build_object(
        'version','CURRENT_PREPUBLICATION_ARTIFACT_BOOTSTRAP_V1',
        'bindingDigest',authority->>'bindingDigest',
        'publicationCommitAllowed',false,
        'publicMarketplaceExposureAllowed',false,
        'createdAt',clock_timestamp()),
      'publicationPreparationV1',prep)
  ) returning * into p;
  return next p;
end $$;

revoke all on function public.prepare_current_prepublication_intent_v1(
  uuid,uuid,uuid,text,text,jsonb,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.prepare_current_prepublication_intent_v1(
  uuid,uuid,uuid,text,text,jsonb,text,text,jsonb
) to service_role;

comment on function public.prepare_current_prepublication_intent_v1(
  uuid,uuid,uuid,text,text,jsonb,text,text,jsonb
) is 'Idempotently persists one exact CURRENT unpublished intent plus its CURRENT revision after official Inventory/Offer readback. Never claims or publishes.';
