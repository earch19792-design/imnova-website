-- Admit the existing canonical Quick Pick authority to the existing one-shot
-- publication ledger. This is not a new publication path: it requires the
-- immutable consumed approval, confirmed owner-reviewed package, exact Luna
-- Product Truth/stock/economics/readiness contract and canonical image assets.

create or replace function public.is_ebay_quick_pick_authorized_publication_v1(
  p_approval_id uuid,
  p_package_id uuid,
  p_opportunity_id uuid,
  p_actor uuid,
  p_account_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_authorization jsonb;
  v_owner_review jsonb;
begin
  if p_approval_id is null or p_package_id is null
    or p_opportunity_id is null or p_actor is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    return false;
  end if;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = p_approval_id and actor_user_id = p_actor;
  select * into v_package
  from public.ebay_listing_packages
  where id = p_package_id and created_by = p_actor
    and account_key = p_account_key;
  select * into v_opportunity
  from public.ebay_luna_opportunity_queue
  where id = p_opportunity_id;

  if v_approval.id is null or v_package.id is null
    or v_opportunity.id is null
    or v_approval.listing_package_id <> v_package.id
    or v_approval.opportunity_id <> v_opportunity.id
    or v_package.opportunity_id <> v_opportunity.id
    or v_approval.candidate_key <> v_package.candidate_key
    or v_package.candidate_key <> v_opportunity.candidate_key
    or v_approval.status <> 'consumed'
    or v_approval.consumed_at is null
    or v_package.status <> 'approved'
    or v_opportunity.queue_status in ('hold', 'rejected', 'listed', 'archived')
    or v_opportunity.supplier_available is distinct from true then
    return false;
  end if;

  v_authorization := v_approval.approved_payload
    #> '{compliance,quickPickPublicationAuthorization}';
  v_owner_review := v_package.package_data->'quickPickOwnerReviewV1';

  if jsonb_typeof(v_authorization) is distinct from 'object'
    or v_authorization->>'version' is distinct from
      'SELLER_OS_QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1'
    or v_authorization->>'validated' is distinct from 'true'
    or v_authorization->>'accountKey' is distinct from p_account_key
    or v_authorization->>'actorUserId' is distinct from p_actor::text
    or v_authorization->>'listingPackageId'
      is distinct from v_package.id::text
    or v_authorization->>'opportunityId'
      is distinct from v_opportunity.id::text
    or v_authorization->>'candidateKey'
      is distinct from v_package.candidate_key
    or coalesce(v_authorization->>'packageDigest', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(v_authorization->>'productTruthDigest', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(v_authorization->>'authorizationDigest', '')
      !~ '^sha256:[0-9a-f]{64}$'
    or v_authorization->>'lunaProductId'
      is distinct from v_opportunity.supplier_product_id
    or v_authorization->>'lunaVariantId'
      is distinct from v_opportunity.supplier_variant_id
    or v_authorization->>'supplierSku'
      is distinct from v_opportunity.supplier_sku
    or coalesce(v_authorization->>'gtin', '')
      is distinct from coalesce(v_opportunity.gtin, '')
    or v_authorization->>'productTruthDigest' is distinct from
      v_opportunity.assessment#>>'{productTruth,evidenceDigest}'
    or v_authorization->>'stockState'
      is distinct from 'IN_STOCK_SUPPLIER_STATED'
    or v_authorization->>'stockFreshness' is distinct from 'FRESH'
    or nullif(v_authorization->>'stockObservedAt', '') is null
    or (v_authorization->>'stockObservedAt')::timestamptz
      is distinct from v_opportunity.supplier_snapshot_at
    or v_authorization->'safeCapacity' is distinct from 'null'::jsonb
    or (
      v_opportunity.supplier_inventory_quantity is null
      and v_authorization->'supplierInventoryQuantity'
        is distinct from 'null'::jsonb
    )
    or (
      v_opportunity.supplier_inventory_quantity is not null
      and (
        coalesce(v_authorization->>'supplierInventoryQuantity', '')
          !~ '^[1-9][0-9]*$'
        or (v_authorization->>'supplierInventoryQuantity')::integer
          is distinct from v_opportunity.supplier_inventory_quantity
      )
    )
    or v_authorization->>'finalEconomicsStatus' is distinct from 'PASS'
    or v_authorization->>'requiredSpecificsStatus' is distinct from 'PASS'
    or v_authorization->>'marketplaceReadinessStatus' is distinct from 'PASS'
    or v_authorization->>'marketTestReadiness' is distinct from 'PASS'
    or v_authorization->>'publishableAsMarketTest' is distinct from 'true'
    or v_authorization->>'demandProven' is distinct from 'false'
    or v_authorization->>'sourceRevalidationAuthority' is distinct from
      'QUICK_PICK_DURABLE_GOLDEN_PATH_REVALIDATION_V1'
    or v_authorization->>'finalHumanAuthorizationRequired'
      is distinct from 'true'
    or v_authorization->>'unattendedPublicationAllowed'
      is distinct from 'false'
    or (v_package.package_data#>>'{pricing,targetPrice}')::numeric
      is distinct from (v_authorization->>'targetPriceUsd')::numeric
    or v_opportunity.supplier_price::numeric
      is distinct from (v_authorization->>'supplierCostUsd')::numeric
    or jsonb_typeof(v_owner_review) is distinct from 'object'
    or v_owner_review->>'contractVersion'
      is distinct from 'QUICK_PICK_REMOTE_OWNER_REVIEW_V1'
    or v_owner_review->>'status' is distinct from 'CONFIRMED'
    or v_owner_review->>'reviewedBy' is distinct from p_actor::text
    or nullif(v_owner_review->>'reviewedAt', '') is null
    or v_owner_review->>'reviewedPackageDigest'
      is distinct from v_authorization->>'packageDigest'
    or v_owner_review->>'readyForOwnerPublishAuthorization'
      is distinct from 'true'
    or v_owner_review->>'marketplaceWriteAuthorized'
      is distinct from 'false'
    or v_owner_review->>'marketplaceWrites' is distinct from '0' then
    return false;
  end if;

  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.assert_ebay_quick_pick_canonical_images_v1(
  p_approval_id uuid,
  p_package_id uuid,
  p_opportunity_id uuid,
  p_actor uuid,
  p_account_key text,
  p_preview jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_images jsonb;
  v_manifest jsonb;
  v_authorization jsonb;
  v_readiness jsonb;
  v_count integer;
begin
  if not public.is_ebay_quick_pick_authorized_publication_v1(
    p_approval_id, p_package_id, p_opportunity_id, p_actor, p_account_key
  ) then
    raise exception 'EBAY_QUICK_PICK_PUBLICATION_AUTHORITY_INVALID';
  end if;

  select * into strict v_approval
  from public.ebay_draft_only_approvals where id = p_approval_id;
  select * into strict v_package
  from public.ebay_listing_packages where id = p_package_id;

  v_images := v_approval.approved_payload
    #> '{inventoryItemPayload,product,imageUrls}';
  v_manifest := v_package.package_data->'imageAssetManifest';
  v_authorization := v_approval.approved_payload
    #> '{compliance,imageAuthorization}';
  v_readiness := v_package.package_data->'supplierImageReadiness';

  if jsonb_typeof(v_images) is distinct from 'array'
    or jsonb_array_length(v_images) < 1
    or jsonb_array_length(v_images) > 24
    or (select count(distinct image.value)
        from jsonb_array_elements_text(v_images) image(value))
      <> jsonb_array_length(v_images)
    or exists (
      select 1 from jsonb_array_elements_text(v_images) image(value)
      where image.value !~ '^https://'
    )
    or v_images is distinct from v_package.package_data->'imageUrls'
    or jsonb_typeof(v_manifest) is distinct from 'array'
    or jsonb_array_length(v_manifest) <> jsonb_array_length(v_images)
    or jsonb_typeof(v_authorization) is distinct from 'object'
    or v_authorization->>'approved' is distinct from 'true'
    or v_authorization->>'approvedBy' is distinct from p_actor::text
    or nullif(v_authorization->>'approvedAt', '') is null
    or v_authorization->>'protectedManifestVerified' is distinct from 'true'
    or (v_authorization->>'protectedManifestAssetCount')::integer
      <> jsonb_array_length(v_images)
    or v_authorization->'approvedImageUrls' is distinct from v_images
    or v_authorization->>'rightsBasis' is distinct from 'supplier_authorized'
    or v_authorization->>'source' is distinct from 'luna'
    or v_readiness->>'version' is distinct from
      'LUNA_SUPPLIER_IMAGE_AUTO_READY_V1'
    or v_readiness->>'authorityVersion' is distinct from
      'OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1'
    or v_readiness->>'imageRights' is distinct from 'PASS_INHERITED'
    or v_readiness->>'imageOptimization' is distinct from 'AUTO_PASS'
    or v_readiness->>'imageReady' is distinct from 'true'
    or v_readiness->>'humanImageActionRequired' is distinct from 'false'
    or (v_readiness->>'validCompliantImageCount')::integer
      <> jsonb_array_length(v_images)
    or (p_preview is not null and (
      jsonb_typeof(p_preview) is distinct from 'object'
      or (p_preview->>'imageCount')::integer <> jsonb_array_length(v_images)
      or p_preview->'imageUrls' is distinct from v_images
    )) then
    raise exception 'EBAY_QUICK_PICK_CANONICAL_IMAGES_INVALID';
  end if;

  select count(*) into v_count
  from jsonb_array_elements(v_manifest) with ordinality manifest(entry, ordinal)
  join public.ebay_listing_image_assets asset
    on asset.id = (manifest.entry->>'assetId')::uuid
   and asset.listing_package_id = v_package.id
   and asset.account_key = p_account_key
   and asset.created_by = p_actor
  where asset.status = 'approved'
    and asset.approved_by = p_actor
    and asset.approved_at is not null
    and asset.public_url = manifest.entry->>'url'
    and asset.public_url = v_images->>((manifest.ordinal - 1)::integer)
    and asset.output_sha256 = manifest.entry->>'sha256'
    and asset.source_url ~
      '^https://([^/]+[.])?(cdn[.]shopify[.]com|lunaportex[.]com)/'
    and asset.rights_evidence_confirmed = true
    and asset.rights_basis = 'supplier_authorized'
    and asset.authorization_reference =
      'OPERATOR_ATTESTED_LUNA_SUPPLIER_IMAGE_AUTHORIZATION_V1'
    and asset.transformation_version = 'EBAY_MAIN_IMAGE_SAFE_WHITE_V2'
    and asset.source_sha256 ~ '^[0-9a-f]{64}$'
    and asset.output_sha256 ~ '^[0-9a-f]{64}$'
    and asset.source_sha256 <> asset.output_sha256
    and asset.output_width = 1600 and asset.output_height = 1600
    and asset.transformation->>'supplierRightsAuthorityVersion' =
      'OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1'
    and asset.transformation->>'generativeAiUsed' = 'false'
    and asset.qa_result->>'automaticStatus' = 'PASSED'
    and asset.qa_result->>'approvalMode' = 'AUTOMATIC_DETERMINISTIC'
    and asset.qa_result->>'imageReadiness' = 'IMAGE_READY_AUTO_PASS'
    and asset.qa_result->>'humanApprovalRequired' = 'false'
    and asset.qa_result->>'outputQualityPassed' = 'true'
    and asset.qa_result->>'materialProductEquivalencePassed' = 'true'
    and asset.qa_result->>'sourceHashPreserved' = 'true'
    and asset.qa_result->>'onlyAllowedDeterministicTransforms' = 'true'
    and asset.qa_result#>>'{rightsAuthority,version}' =
      'OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1'
    and asset.qa_result#>>'{rightsAuthority,authorityProvenance}' =
      'OPERATOR_ATTESTED'
    and asset.qa_result#>>'{rightsAuthority,documentedLicense}' = 'false'
    and asset.qa_result#>>'{rightsAuthority,operatorAttested}' = 'true';

  if v_count <> jsonb_array_length(v_images) then
    raise exception 'EBAY_QUICK_PICK_CANONICAL_IMAGE_ASSET_MISMATCH';
  end if;
end;
$$;

revoke all on function public.is_ebay_quick_pick_authorized_publication_v1(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.assert_ebay_quick_pick_canonical_images_v1(
  uuid, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.is_ebay_quick_pick_authorized_publication_v1(
  uuid, uuid, uuid, uuid, text
) to service_role;
grant execute on function public.assert_ebay_quick_pick_canonical_images_v1(
  uuid, uuid, uuid, uuid, text, jsonb
) to service_role;

do $migration$
declare
  v_signature regprocedure :=
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure;
  v_definition text;
  v_declaration_anchor text :=
    '  v_smart_stocking boolean := false;';
  v_declaration_replacement text := v_declaration_anchor || E'\n' ||
    '  v_quick_pick boolean := false;';
  v_stock_anchor text := $old$
      and not public.is_ebay_smart_stocking_authorized_publication_v1(
        v_approval.id, v_package.id, v_opportunity.id,
        p_actor_user_id, p_marketplace_account_key
      )
$old$;
  v_stock_replacement text := $new$
      and not public.is_ebay_smart_stocking_authorized_publication_v1(
        v_approval.id, v_package.id, v_opportunity.id,
        p_actor_user_id, p_marketplace_account_key
      )
      and not public.is_ebay_quick_pick_authorized_publication_v1(
        v_approval.id, v_package.id, v_opportunity.id,
        p_actor_user_id, p_marketplace_account_key
      )
$new$;
  v_authority_anchor text := $old$
  v_smart_stocking :=
    public.is_ebay_smart_stocking_authorized_publication_v1(
      v_approval.id, v_package.id, v_opportunity.id,
      p_actor_user_id, p_marketplace_account_key
    );
$old$;
  v_authority_replacement text := v_authority_anchor || $new$
  v_quick_pick :=
    public.is_ebay_quick_pick_authorized_publication_v1(
      v_approval.id, v_package.id, v_opportunity.id,
      p_actor_user_id, p_marketplace_account_key
    );
$new$;
  v_missing_anchor text := $old$
  if not found and not v_smart_stocking then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_APPROVED_CANDIDATE_REQUIRED';
  end if;$old$;
  v_missing_replacement text := $new$
  if not found and not v_smart_stocking and not v_quick_pick then
    raise exception 'EBAY_AUTHORIZED_PUBLICATION_APPROVED_CANDIDATE_REQUIRED';
  end if;$new$;
  v_images_anchor text := $old$
  if v_smart_stocking then
    perform public.assert_ebay_smart_stocking_canonical_images_v1(
      v_approval.id, v_package.id, v_opportunity.id,
      p_actor_user_id, p_marketplace_account_key, p_preview
    );
  end if;$old$;
  v_images_replacement text := $new$
  if v_smart_stocking then
    perform public.assert_ebay_smart_stocking_canonical_images_v1(
      v_approval.id, v_package.id, v_opportunity.id,
      p_actor_user_id, p_marketplace_account_key, p_preview
    );
  elsif v_quick_pick then
    perform public.assert_ebay_quick_pick_canonical_images_v1(
      v_approval.id, v_package.id, v_opportunity.id,
      p_actor_user_id, p_marketplace_account_key, p_preview
    );
  end if;$new$;
  v_legacy_gate text := 'if not v_smart_stocking and (';
  v_canonical_gate text :=
    'if not v_smart_stocking and not v_quick_pick and (';
  v_v3_anchor text := $old$
  if jsonb_typeof(
    v_approval.approved_payload
      #> '{compliance,v3FinalSetAuthorization}'
  ) is not distinct from 'object' then$old$;
  v_v3_replacement text := $new$
  if not v_smart_stocking and not v_quick_pick and jsonb_typeof(
    v_approval.approved_payload
      #> '{compliance,v3FinalSetAuthorization}'
  ) is not distinct from 'object' then$new$;
  v_seven_anchor text :=
    '  elsif jsonb_array_length(v_images) = 7 then';
  v_seven_replacement text :=
    '  elsif not v_smart_stocking and not v_quick_pick' || E'\n' ||
    '    and jsonb_array_length(v_images) = 7 then';
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition, 'v_quick_pick boolean := false') > 0 then
    return;
  end if;
  if strpos(v_definition, v_declaration_anchor) = 0
    or strpos(v_definition, v_stock_anchor) = 0
    or strpos(v_definition, v_authority_anchor) = 0
    or strpos(v_definition, v_missing_anchor) = 0
    or strpos(v_definition, v_images_anchor) = 0
    or strpos(v_definition, v_legacy_gate) = 0
    or strpos(v_definition, v_v3_anchor) = 0
    or strpos(v_definition, v_seven_anchor) = 0 then
    raise exception 'EBAY_QUICK_PICK_PREPARE_PATCH_TARGET_MISSING';
  end if;

  v_definition := replace(v_definition, v_declaration_anchor,
    v_declaration_replacement);
  v_definition := replace(v_definition, v_stock_anchor,
    v_stock_replacement);
  v_definition := replace(v_definition, v_authority_anchor,
    v_authority_replacement);
  v_definition := replace(v_definition, v_missing_anchor,
    v_missing_replacement);
  v_definition := replace(v_definition, v_images_anchor,
    v_images_replacement);
  v_definition := replace(v_definition, v_legacy_gate,
    v_canonical_gate);
  v_definition := replace(v_definition, v_v3_anchor,
    v_v3_replacement);
  v_definition := replace(v_definition, v_seven_anchor,
    v_seven_replacement);
  execute v_definition;
end;
$migration$;

do $migration$
declare
  v_signature regprocedure :=
    'public.assert_ebay_authorized_publication_image_set_high_quality(uuid,uuid,text)'::regprocedure;
  v_definition text;
  v_old text := $old$
    if public.is_ebay_smart_stocking_authorized_publication_v1(
      v_approval.id, v_package.id, v_publication.opportunity_id,
      p_actor, p_account_key
    ) then
      perform public.assert_ebay_smart_stocking_canonical_images_v1(
        v_approval.id, v_package.id, v_publication.opportunity_id,
        p_actor, p_account_key, v_publication.preview
      );
    else
      perform public.assert_ebay_publish_image_set_high_quality(
        v_publication.listing_package_id,
        p_actor,
        p_account_key
      );
    end if;$old$;
  v_new text := $new$
    if public.is_ebay_smart_stocking_authorized_publication_v1(
      v_approval.id, v_package.id, v_publication.opportunity_id,
      p_actor, p_account_key
    ) then
      perform public.assert_ebay_smart_stocking_canonical_images_v1(
        v_approval.id, v_package.id, v_publication.opportunity_id,
        p_actor, p_account_key, v_publication.preview
      );
    elsif public.is_ebay_quick_pick_authorized_publication_v1(
      v_approval.id, v_package.id, v_publication.opportunity_id,
      p_actor, p_account_key
    ) then
      perform public.assert_ebay_quick_pick_canonical_images_v1(
        v_approval.id, v_package.id, v_publication.opportunity_id,
        p_actor, p_account_key, v_publication.preview
      );
    else
      perform public.assert_ebay_publish_image_set_high_quality(
        v_publication.listing_package_id,
        p_actor,
        p_account_key
      );
    end if;$new$;
begin
  select pg_get_functiondef(v_signature) into strict v_definition;
  if strpos(v_definition,
      'assert_ebay_quick_pick_canonical_images_v1') > 0 then
    return;
  end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'EBAY_QUICK_PICK_CLAIM_PATCH_TARGET_MISSING';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $assertion$
declare
  v_prepare text;
  v_claim_gate text;
begin
  select pg_get_functiondef(
    'public.prepare_ebay_authorized_listing_publication(uuid,uuid,text,text,jsonb,text,text)'::regprocedure
  ) into strict v_prepare;
  select pg_get_functiondef(
    'public.assert_ebay_authorized_publication_image_set_high_quality(uuid,uuid,text)'::regprocedure
  ) into strict v_claim_gate;
  if strpos(v_prepare, 'v_quick_pick boolean := false') = 0
    or strpos(v_prepare,
      'is_ebay_quick_pick_authorized_publication_v1') = 0
    or strpos(v_prepare,
      'assert_ebay_quick_pick_canonical_images_v1') = 0
    or strpos(v_claim_gate,
      'assert_ebay_quick_pick_canonical_images_v1') = 0 then
    raise exception 'EBAY_QUICK_PICK_PUBLICATION_ALIGNMENT_FAILED';
  end if;
end;
$assertion$;

comment on function public.is_ebay_quick_pick_authorized_publication_v1(
  uuid, uuid, uuid, uuid, text
) is 'Fail-closed validation of the existing immutable Quick Pick package, exact Product Truth, fresh stock authority, economics/readiness, confirmed owner review and one-shot human publication boundary.';
comment on function public.assert_ebay_quick_pick_canonical_images_v1(
  uuid, uuid, uuid, uuid, text, jsonb
) is 'Revalidates the exact durable operator-attested Luna supplier image set bound to a canonical Quick Pick package.';
comment on function public.prepare_ebay_authorized_listing_publication(
  uuid, uuid, text, text, jsonb, text, text
) is 'Prepares the existing one-shot publication from its consumed exact approval. Same-Day, Smart Stocking and canonical Quick Pick retain their independent fail-closed authorities; no path may bypass exact stock, images, policies or human authorization.';

notify pgrst, 'reload schema';
