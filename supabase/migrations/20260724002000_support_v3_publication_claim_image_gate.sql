-- The one-shot publication claim still routes every package through the
-- legacy same-day image table. V3 assets are instead authorized by an
-- append-only final review, human verdict, exact approval payload, and
-- permanent publication transport. Validate that full chain at claim time
-- while retaining the existing gate unchanged for non-V3 publications.

create or replace function
  public.assert_ebay_authorized_publication_image_set_high_quality(
    p_publication_id uuid,
    p_actor uuid,
    p_account_key text
  )
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_publication public.ebay_authorized_listing_publications%rowtype;
  v_execution public.ebay_draft_only_execution_ledger%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_transport public.ebay_v3_publication_image_transports%rowtype;
  v_review public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_authorization_preview
    public.ebay_v3_unpublished_offer_authorization_previews%rowtype;
  v_final
    public.ebay_reference_guided_position_6_extraordinary_human_verdict_events%rowtype;
  v_binding jsonb;
  v_assets jsonb;
  v_images jsonb;
  v_image_authorization jsonb;
  v_same_day_authorization jsonb;
  v_review_assets jsonb;
  v_transport_urls jsonb;
  v_roles text[] := array[
    'PRIMARY_MAIN',
    'SECONDARY_MATERIAL_DETAIL',
    'SECONDARY_PACKAGE_CONTENTS',
    'SECONDARY_SCALE_CAPACITY',
    'SECONDARY_USE_CONTEXT',
    'SECONDARY_ASPIRATIONAL_LIFESTYLE',
    'SECONDARY_HUMAN_CONTEXT'
  ];
  v_count integer;
  v_distinct_positions integer;
  v_distinct_roles integer;
  v_distinct_hashes integer;
  v_valid boolean;
begin
  if p_publication_id is null
    or p_actor is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    raise exception 'EBAY_PUBLICATION_IMAGE_AUTHORITY_INPUT_INVALID';
  end if;

  select publication.*
  into v_publication
  from public.ebay_authorized_listing_publications publication
  where publication.id = p_publication_id
    and publication.actor_user_id = p_actor
    and publication.marketplace_account_key = p_account_key
  for update;
  if not found then
    raise exception 'EBAY_PUBLICATION_IMAGE_AUTHORITY_NOT_FOUND';
  end if;

  select execution.*
  into v_execution
  from public.ebay_draft_only_execution_ledger execution
  where execution.id = v_publication.draft_execution_id
  for key share;
  select approval.*
  into v_approval
  from public.ebay_draft_only_approvals approval
  where approval.id = v_publication.draft_approval_id
  for key share;
  select package.*
  into v_package
  from public.ebay_listing_packages package
  where package.id = v_publication.listing_package_id
  for key share;

  if v_execution.id is null
    or v_approval.id is null
    or v_package.id is null
    or v_execution.approval_id <> v_approval.id
    or v_execution.listing_package_id <> v_package.id
    or v_approval.listing_package_id <> v_package.id
    or v_publication.opportunity_id <> v_execution.opportunity_id
    or v_publication.opportunity_id <> v_approval.opportunity_id
    or v_execution.actor_user_id <> p_actor
    or v_approval.actor_user_id <> p_actor
    or v_package.created_by <> p_actor
    or v_package.account_key <> p_account_key
    or v_execution.phase <> 'completed'
    or v_execution.target <> 'PRODUCTION'
    or v_approval.status <> 'consumed'
    or v_approval.consumed_at is null
    or v_approval.payload_hash <> v_execution.request_hash
    or v_package.status <> 'approved'
    or v_publication.target <> v_execution.target
    or v_publication.account_fingerprint <> v_execution.account_fingerprint
    or v_publication.offer_id <> v_execution.offer_id
    or v_publication.sku <> v_execution.sku then
    raise exception 'EBAY_PUBLICATION_IMAGE_AUTHORITY_CONTEXT_INVALID';
  end if;

  v_binding := v_approval.approved_payload
    #> '{compliance,v3FinalSetAuthorization}';
  if v_binding is null then
    perform public.assert_ebay_publish_image_set_high_quality(
      v_publication.listing_package_id,
      p_actor,
      p_account_key
    );
    return;
  end if;
  if jsonb_typeof(v_binding) is distinct from 'object' then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_BINDING_INVALID';
  end if;

  v_assets := v_binding->'selectedAssets';
  v_images := v_approval.approved_payload
    #> '{inventoryItemPayload,product,imageUrls}';
  v_image_authorization := v_approval.approved_payload
    #> '{compliance,imageAuthorization}';
  v_same_day_authorization := v_approval.approved_payload
    #> '{compliance,sameDayPilotAuthorization}';

  if v_binding->>'version'
      is distinct from 'EBAY_V3_FINAL_SET_UNPUBLISHED_AUTHORIZATION_V1'
    or coalesce(v_binding->>'authorizationPreviewId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_binding->>'revisionId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_binding->>'attemptId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_binding->>'finalPreviewId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_binding->>'imageTransportId', '')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(v_binding->>'finalPreviewHash', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(v_binding->>'exactPreviewHash', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(v_binding->>'imageTransportHash', '')
      !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(v_assets) is distinct from 'array'
    or jsonb_array_length(v_assets) <> 7
    or jsonb_typeof(v_images) is distinct from 'array'
    or jsonb_array_length(v_images) <> 7
    or jsonb_typeof(v_image_authorization) is distinct from 'object'
    or v_image_authorization->>'approved' is distinct from 'true'
    or v_image_authorization->>'protectedManifestVerified'
      is distinct from 'true'
    or v_image_authorization->>'protectedManifestAssetCount'
      is distinct from '7'
    or v_image_authorization->>'approvedBy' is distinct from p_actor::text
    or nullif(v_image_authorization->>'approvedAt', '') is null
    or v_image_authorization->>'rightsBasis'
      is distinct from 'supplier_authorized'
    or v_image_authorization->>'source' is distinct from 'luna'
    or v_image_authorization->'approvedImageUrls' is distinct from v_images
    or jsonb_typeof(v_same_day_authorization) is distinct from 'object'
    or v_same_day_authorization->>'validated' is distinct from 'true'
    or v_same_day_authorization->>'listingPackageId'
      is distinct from v_package.id::text
    or v_same_day_authorization->>'finalHumanAuthorizationRequired'
      is distinct from 'true'
    or v_same_day_authorization->>'unattendedPublicationAllowed'
      is distinct from 'false' then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_BINDING_INVALID';
  end if;

  select transport.*
  into v_transport
  from public.ebay_v3_publication_image_transports transport
  where transport.id = (v_binding->>'imageTransportId')::uuid
  for share;
  if not found
    or v_transport.listing_package_id <> v_package.id
    or v_transport.final_preview_id
      <> (v_binding->>'finalPreviewId')::uuid
    or v_transport.revision_id <> (v_binding->>'revisionId')::uuid
    or v_transport.attempt_id <> (v_binding->>'attemptId')::uuid
    or v_transport.preview_hash <> v_binding->>'finalPreviewHash'
    or v_transport.transport_hash <> v_binding->>'imageTransportHash'
    or v_transport.source_bucket <> 'ebay-listing-image-staging'
    or v_transport.publication_bucket <> 'ebay-listing-images'
    or v_transport.image_count <> 7
    or v_transport.scope <> 'EBAY_US_UNPUBLISHED_OFFER_ONLY'
    or v_transport.status <> 'READY'
    or v_transport.created_by <> p_actor
    or v_transport.assets is distinct from v_assets then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_TRANSPORT_INVALID';
  end if;

  select
    count(*),
    count(distinct (asset->>'position')::integer),
    count(distinct asset->>'assetRole'),
    count(distinct asset->>'sha256'),
    coalesce(bool_and(
      case
        when jsonb_typeof(asset) = 'object'
          and coalesce(asset->>'position', '') ~ '^[0-6]$'
        then (asset->>'position')::integer = ordinality - 1
          and asset->>'assetRole'
            = v_roles[((asset->>'position')::integer) + 1]
          and coalesce(asset->>'sha256', '') ~ '^[0-9a-f]{64}$'
          and asset->>'mime' = 'image/png'
          and asset->>'width' = '1600'
          and asset->>'height' = '1600'
          and coalesce(asset->>'bytes', '') ~ '^[1-9][0-9]*$'
          and nullif(asset->>'sourceStoragePath', '') is not null
          and asset->>'publicationStoragePath'
            like '%/' || (asset->>'sha256') || '.png'
          and asset->>'url' ~ '^https://[^[:space:][:cntrl:]]+$'
          and asset->>'url' !~ '[?&](token|expires|signature)='
          and right(
            asset->>'url',
            length(asset->>'publicationStoragePath')
          ) = asset->>'publicationStoragePath'
        else false
      end
    ), false),
    jsonb_agg(asset->'url' order by ordinality)
  into
    v_count,
    v_distinct_positions,
    v_distinct_roles,
    v_distinct_hashes,
    v_valid,
    v_transport_urls
  from jsonb_array_elements(v_transport.assets)
    with ordinality selected(asset, ordinality);
  if v_count <> 7
    or v_distinct_positions <> 7
    or v_distinct_roles <> 7
    or v_distinct_hashes <> 7
    or not v_valid
    or v_images is distinct from v_transport_urls
    or v_package.package_data->'imageUrls' is distinct from v_transport_urls
    or v_publication.preview->'imageUrls' is distinct from v_transport_urls
    or v_publication.preview->>'imageCount' is distinct from '7'
    or v_publication.preview->>'version'
      is distinct from 'EBAY_AUTHORIZED_LISTING_PUBLICATION_V1'
    or v_publication.preview->>'draftExecutionId'
      is distinct from v_execution.id::text
    or v_publication.preview->>'draftApprovalId'
      is distinct from v_approval.id::text
    or v_publication.preview->>'listingPackageId'
      is distinct from v_package.id::text
    or v_publication.preview->>'approvedPayloadHash'
      is distinct from v_approval.payload_hash
    or v_publication.preview->'inventoryItemPayload'
      is distinct from v_approval.approved_payload->'inventoryItemPayload'
    or v_publication.preview->'offerPayload'
      is distinct from v_approval.approved_payload->'offerPayload' then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_TRANSPORT_INVALID';
  end if;

  select review.*
  into v_review
  from public.ebay_reference_guided_final_listing_review_previews review
  where review.id = (v_binding->>'finalPreviewId')::uuid
  for share;
  if not found
    or v_review.id <> v_transport.final_preview_id
    or v_review.revision_id <> v_transport.revision_id
    or v_review.attempt_id <> v_transport.attempt_id
    or v_review.listing_package_id <> v_package.id
    or v_review.preview_hash <> v_transport.preview_hash
    or v_review.created_by <> p_actor
    or v_review.visual_phase <> 'COMPLETED'
    or not v_review.final_visual_set_locked
    or not v_review.generation_controls_hidden
    or not v_review.ready_for_unpublished_offer_authorization
    or v_review.authorization_enabled
    or v_review.inventory_item_created
    or v_review.offer_created
    or v_review.offer_status <> 'NOT_CREATED'
    or v_review.ebay_writes <> 0
    or v_review.production_changed
    or v_review.provider_calls_snapshot <> 8
    or cardinality(v_review.blockers) <> 0
    or v_review.preview_hash <> encode(
      extensions.digest(
        convert_to(v_review.preview_snapshot::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_REVIEW_INVALID';
  end if;

  select count(*), coalesce(bool_and(value = 'true'::jsonb), false)
  into v_count, v_valid
  from jsonb_each(v_review.gates);
  if v_count = 0 or not v_valid then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_REVIEW_INVALID';
  end if;

  v_review_assets := v_review.preview_snapshot->'selectedImages';
  if jsonb_typeof(v_review_assets) is distinct from 'array' then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_REVIEW_INVALID';
  end if;
  select
    count(*),
    count(distinct (asset->>'position')::integer),
    count(distinct asset->>'assetRole'),
    count(distinct asset->>'sha256'),
    coalesce(bool_and(
      case
        when jsonb_typeof(asset) = 'object'
          and coalesce(asset->>'position', '') ~ '^[0-6]$'
        then (asset->>'position')::integer = ordinality - 1
          and asset->>'assetRole'
            = v_roles[((asset->>'position')::integer) + 1]
          and asset->>'status' = 'PASSED'
          and coalesce(asset->>'sha256', '') ~ '^[0-9a-f]{64}$'
          and nullif(asset->>'storagePath', '') is not null
          and exists (
            select 1
            from jsonb_array_elements(v_transport.assets) transport_asset
            where transport_asset->>'position' = asset->>'position'
              and transport_asset->>'assetRole' = asset->>'assetRole'
              and transport_asset->>'sha256' = asset->>'sha256'
              and transport_asset->>'sourceStoragePath'
                = asset->>'storagePath'
          )
        else false
      end
    ), false)
  into
    v_count,
    v_distinct_positions,
    v_distinct_roles,
    v_distinct_hashes,
    v_valid
  from jsonb_array_elements(v_review_assets)
    with ordinality selected(asset, ordinality);
  if v_count <> 7
    or v_distinct_positions <> 7
    or v_distinct_roles <> 7
    or v_distinct_hashes <> 7
    or not v_valid then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_REVIEW_INVALID';
  end if;

  select verdict.*
  into v_final
  from public.ebay_reference_guided_position_6_extraordinary_human_verdict_events verdict
  where verdict.id = v_review.final_set_event_id
  for share;
  if not found
    or v_final.attempt_id <> v_review.attempt_id
    or v_final.revision_id <> v_review.revision_id
    or v_final.position <> 6
    or v_final.asset_role <> 'SECONDARY_HUMAN_CONTEXT'
    or v_final.extraordinary_ordinal <> 8
    or v_final.human_verdict <> 'APPROVED'
    or not v_final.final_set_atomic_gate
    or v_final.publication_authorized
    or v_final.provider_calls_snapshot <> 8
    or v_final.reviewer_id <> p_actor
    or v_final.selected_assets is distinct from v_review_assets
    or v_final.final_set_hash <> v_review.final_set_hash
    or v_final.final_set_hash <> encode(
      extensions.digest(
        convert_to(v_final.selected_assets::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ) then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_HUMAN_VERDICT_INVALID';
  end if;

  select count(*)
  into v_count
  from jsonb_array_elements(v_transport.assets) asset
  join storage.objects object
    on object.bucket_id = v_transport.source_bucket
   and object.name = asset->>'sourceStoragePath'
   and object.metadata->>'mimetype' = 'image/png';
  if v_count <> 7
    or not exists (
      select 1 from storage.buckets bucket
      where bucket.id = v_transport.source_bucket
        and not bucket.public
    ) then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_STORAGE_INVALID';
  end if;

  select count(*)
  into v_count
  from jsonb_array_elements(v_transport.assets) asset
  join storage.objects object
    on object.bucket_id = v_transport.publication_bucket
   and object.name = asset->>'publicationStoragePath'
   and object.metadata->>'mimetype' = 'image/png'
   and object.metadata->>'size' = asset->>'bytes';
  if v_count <> 7
    or not exists (
      select 1 from storage.buckets bucket
      where bucket.id = v_transport.publication_bucket
        and bucket.public
    ) then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_STORAGE_INVALID';
  end if;

  select preview.*
  into v_authorization_preview
  from public.ebay_v3_unpublished_offer_authorization_previews preview
  where preview.id = (v_binding->>'authorizationPreviewId')::uuid
  for share;
  if not found
    or v_authorization_preview.revision_id <> v_review.revision_id
    or v_authorization_preview.attempt_id <> v_review.attempt_id
    or v_authorization_preview.listing_package_id <> v_package.id
    or v_authorization_preview.final_preview_id <> v_review.id
    or v_authorization_preview.preview_hash <> v_review.preview_hash
    or v_authorization_preview.exact_preview_hash
      <> v_binding->>'exactPreviewHash'
    or v_authorization_preview.image_transport_id <> v_transport.id
    or v_authorization_preview.image_transport_hash
      <> v_transport.transport_hash
    or v_authorization_preview.target <> 'PRODUCTION'
    or v_authorization_preview.account_fingerprint
      <> v_publication.account_fingerprint
    or v_authorization_preview.sku <> v_publication.sku
    or v_authorization_preview.status <> 'READY_FOR_HUMAN_AUTHORIZATION'
    or v_authorization_preview.exact_payload
      is distinct from v_approval.approved_payload
    or v_authorization_preview.payload_hash <> v_approval.payload_hash
    or v_authorization_preview.provider_calls_snapshot <> 8
    or v_authorization_preview.inventory_item_created
    or v_authorization_preview.offer_created
    or v_authorization_preview.publish_offer_called
    or v_authorization_preview.ebay_writes <> 0
    or v_authorization_preview.production_changed
    or jsonb_typeof(v_authorization_preview.blockers)
      is distinct from 'array'
    or jsonb_array_length(v_authorization_preview.blockers) <> 0
    or v_authorization_preview.created_by <> p_actor then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_AUTHORIZATION_INVALID';
  end if;

  select count(*), coalesce(bool_and(value = 'true'::jsonb), false)
  into v_count, v_valid
  from jsonb_each(v_authorization_preview.gates);
  if v_count = 0 or not v_valid then
    raise exception 'EBAY_V3_PUBLICATION_IMAGE_AUTHORIZATION_INVALID';
  end if;
end;
$$;

revoke all on function
  public.assert_ebay_authorized_publication_image_set_high_quality(
    uuid, uuid, text
  )
from public, anon, authenticated;
grant execute on function
  public.assert_ebay_authorized_publication_image_set_high_quality(
    uuid, uuid, text
  )
to service_role;

do $migration$
declare
  v_signature regprocedure :=
    'public.claim_ebay_authorized_listing_publication(uuid,uuid,text,text,text,uuid)'::regprocedure;
  v_definition text;
  v_old text := $old$
  perform public.assert_ebay_publish_image_set_high_quality(
    v_publication.listing_package_id,
    p_actor_user_id,
    v_publication.marketplace_account_key
  );$old$;
  v_new text := $new$
  perform public.assert_ebay_authorized_publication_image_set_high_quality(
    v_publication.id,
    p_actor_user_id,
    v_publication.marketplace_account_key
  );$new$;
begin
  select pg_get_functiondef(v_signature)
  into strict v_definition;

  if position(
    'assert_ebay_authorized_publication_image_set_high_quality'
    in v_definition
  ) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception 'EBAY_V3_PUBLICATION_CLAIM_GATE_REWRITE_NOT_APPLIED';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$migration$;

do $assertion$
declare
  v_claim_definition text;
  v_gate_definition text;
begin
  select pg_get_functiondef(
    'public.claim_ebay_authorized_listing_publication(uuid,uuid,text,text,text,uuid)'::regprocedure
  )
  into strict v_claim_definition;
  select pg_get_functiondef(
    'public.assert_ebay_authorized_publication_image_set_high_quality(uuid,uuid,text)'::regprocedure
  )
  into strict v_gate_definition;

  if position(
    'assert_ebay_authorized_publication_image_set_high_quality'
    in v_claim_definition
  ) = 0
    or position(
      'assert_ebay_publish_image_set_high_quality'
      in v_gate_definition
    ) = 0
    or position(
      'EBAY_V3_PUBLICATION_IMAGE_HUMAN_VERDICT_INVALID'
      in v_gate_definition
    ) = 0
    or position(
      'EBAY_V3_PUBLICATION_IMAGE_STORAGE_INVALID'
      in v_gate_definition
    ) = 0 then
    raise exception 'EBAY_V3_PUBLICATION_CLAIM_GATE_ASSERTION_FAILED';
  end if;
end;
$assertion$;

comment on function
  public.assert_ebay_authorized_publication_image_set_high_quality(
    uuid, uuid, text
  )
is
  'Validates the complete append-only V3 seven-image authority at one-shot claim time and preserves the legacy image gate for non-V3 publications.';

comment on function public.claim_ebay_authorized_listing_publication(
  uuid, uuid, text, text, text, uuid
) is
  'Claims an exact one-shot publication only after its route-specific legacy or V3 image authority passes without calling eBay.';

notify pgrst, 'reload schema';
