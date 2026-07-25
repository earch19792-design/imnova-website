-- Persistent, read-only commercial review of the immutable seven-image V3 set.
-- This creates no eBay object, does not authorize publication, and does not
-- mutate listing-package user fields or visual evidence.

create table if not exists public.ebay_reference_guided_final_listing_review_previews (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.ebay_same_day_pilot_image_revisions(id),
  attempt_id uuid not null references public.ebay_reference_guided_generation_attempts(id),
  listing_package_id uuid not null references public.ebay_listing_packages(id),
  final_set_event_id uuid not null
    references public.ebay_reference_guided_position_6_extraordinary_human_verdict_events(id),
  final_set_hash text not null check (final_set_hash ~ '^[0-9a-f]{64}$'),
  listing_package_updated_at timestamptz not null,
  user_fields_hash text not null check (user_fields_hash ~ '^[0-9a-f]{64}$'),
  preview_snapshot jsonb not null check (jsonb_typeof(preview_snapshot) = 'object'),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  gates jsonb not null check (jsonb_typeof(gates) = 'object'),
  blockers text[] not null default '{}'::text[],
  visual_phase text not null check (visual_phase = 'COMPLETED'),
  final_visual_set_locked boolean not null check (final_visual_set_locked),
  generation_controls_hidden boolean not null check (generation_controls_hidden),
  ready_for_unpublished_offer_authorization boolean not null,
  authorization_enabled boolean not null check (not authorization_enabled),
  inventory_item_created boolean not null check (not inventory_item_created),
  offer_created boolean not null check (not offer_created),
  offer_status text not null check (offer_status = 'NOT_CREATED'),
  ebay_writes integer not null check (ebay_writes = 0),
  production_changed boolean not null check (not production_changed),
  provider_calls_snapshot integer not null check (provider_calls_snapshot = 8),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (attempt_id, preview_hash)
);

drop trigger if exists ebay_reference_guided_final_listing_review_append_only
  on public.ebay_reference_guided_final_listing_review_previews;
create trigger ebay_reference_guided_final_listing_review_append_only
before update or delete
  on public.ebay_reference_guided_final_listing_review_previews
for each row execute function public.prevent_reference_guided_human_evidence_mutation();

alter table public.ebay_reference_guided_final_listing_review_previews
  enable row level security;
alter table public.ebay_reference_guided_final_listing_review_previews
  force row level security;
revoke all on table public.ebay_reference_guided_final_listing_review_previews
  from public, anon, authenticated, service_role;
grant select, insert
  on table public.ebay_reference_guided_final_listing_review_previews
  to service_role;

create or replace function public.prepare_ebay_reference_guided_final_listing_review(
  p_revision_id uuid,
  p_attempt_id uuid
) returns table(
  preview_id uuid,
  preview_hash text,
  final_visual_set_locked boolean,
  ready_for_unpublished_offer_authorization boolean,
  blockers text[],
  inventory_item_created boolean,
  offer_created boolean,
  offer_status text,
  ebay_writes integer,
  production_changed boolean
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_profile public.ebay_account_policy_profiles%rowtype;
  v_final public.ebay_reference_guided_position_6_extraordinary_human_verdict_events%rowtype;
  v_binding public.luna_catalog_source_pack_dossier_bindings%rowtype;
  v_source_pack public.luna_catalog_authorized_source_packs%rowtype;
  v_successor public.ebay_reference_guided_batch_plan_successors_v2%rowtype;
  v_correction public.ebay_reference_guided_extraordinary_replacement_plans%rowtype;
  v_package_data jsonb;
  v_draft jsonb;
  v_saved_policies jsonb;
  v_pricing jsonb;
  v_aspects jsonb;
  v_economics jsonb;
  v_luna jsonb;
  v_facts jsonb;
  v_selected jsonb;
  v_image_urls jsonb;
  v_title text;
  v_description text;
  v_gtin text;
  v_gates jsonb;
  v_blockers text[] := '{}'::text[];
  v_user_fields jsonb;
  v_user_fields_hash text;
  v_snapshot jsonb;
  v_preview_text text;
  v_preview_hash text;
  v_ready boolean;
  v_title_valid boolean;
  v_category_valid boolean;
  v_identity_valid boolean;
  v_specifics_valid boolean;
  v_cost_fresh boolean;
  v_stock_fresh boolean;
  v_rights_confirmed boolean;
  v_price_valid boolean;
  v_quantity_valid boolean;
  v_policies_valid boolean;
  v_location_valid boolean;
  v_images_valid boolean;
  v_claims_valid boolean;
  v_manifests_valid boolean;
  v_required_fields_present boolean;
  v_preview public.ebay_reference_guided_final_listing_review_previews%rowtype;
begin
  if p_revision_id <> '3a4a233e-d4bc-4a65-825f-c4882bceb9d1'::uuid
    or p_attempt_id <> 'f166b395-8d3a-4921-b273-1a62a6032707'::uuid then
    raise exception 'FINAL_LISTING_REVIEW_SCOPE_INVALID';
  end if;

  select revision.* into v_revision
  from public.ebay_same_day_pilot_image_revisions revision
  where revision.id = p_revision_id for share;
  select attempt.* into v_attempt
  from public.ebay_reference_guided_generation_attempts attempt
  where attempt.id = p_attempt_id and attempt.revision_id = p_revision_id for share;
  if v_revision.id is null or v_attempt.id is null
    or v_revision.strategy_version <> 'VISUAL_STRATEGY_V3'
    or v_revision.revision_contract <> 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
    or v_attempt.provider_calls <> 8 or v_attempt.max_provider_calls <> 8
    or v_attempt.ebay_writes <> 0 or v_attempt.production_changed
    or v_attempt.retry_consumed then
    raise exception 'FINAL_LISTING_REVIEW_ATTEMPT_INVALID';
  end if;

  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = v_revision.listing_package_id for share;
  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = v_revision.candidate_id
    and candidate.opportunity_id = v_package.opportunity_id
    and candidate.candidate_key = v_package.candidate_key for share;
  select run.* into v_run from public.ebay_same_day_pilot_runs run
  where run.id = v_candidate.run_id for share;
  if v_package.id is null or v_candidate.id is null or v_run.id is null
    or v_package.created_by <> v_revision.created_by
    or v_run.created_by <> v_revision.created_by then
    raise exception 'FINAL_LISTING_REVIEW_PRODUCT_SCOPE_INVALID';
  end if;

  select verdict.* into v_final
  from public.ebay_reference_guided_position_6_extraordinary_human_verdict_events verdict
  where verdict.attempt_id = p_attempt_id and verdict.revision_id = p_revision_id
    and verdict.position = 6 and verdict.extraordinary_ordinal = 8
    and verdict.human_verdict = 'APPROVED'
    and verdict.final_set_atomic_gate and not verdict.publication_authorized
  for share;
  if v_final.id is null or jsonb_array_length(v_final.selected_assets) <> 7
    or v_final.provider_calls_snapshot <> 8 then
    raise exception 'FINAL_LISTING_REVIEW_ATOMIC_SET_INVALID';
  end if;
  v_selected := v_final.selected_assets;

  v_images_valid :=
    (select count(*) = 7 and count(distinct (asset->>'position')::integer) = 7
       and min((asset->>'position')::integer) = 0
       and max((asset->>'position')::integer) = 6
       and count(distinct asset->>'assetRole') = 7
       and bool_and(asset->>'status' = 'PASSED')
       and bool_and(asset->>'sha256' ~ '^[0-9a-f]{64}$')
       and bool_and(coalesce(asset->>'storagePath','') <> '')
     from jsonb_array_elements(v_selected) asset)
    and (v_selected->0->>'assetRole') = 'PRIMARY_MAIN'
    and (v_selected->0->>'position') = '0'
    and (select count(*) from jsonb_array_elements(v_selected) asset
      join storage.objects object
        on object.bucket_id = 'ebay-listing-image-staging'
       and object.name = asset->>'storagePath'
       and object.metadata->>'mimetype' = 'image/png') = 7
    and exists(select 1 from storage.buckets bucket
      where bucket.id = 'ebay-listing-image-staging' and not bucket.public);

  v_image_urls := (
    select jsonb_agg(to_jsonb(format(
      'private://ebay-listing-image-staging/%s#sha256=%s',
      asset->>'storagePath', asset->>'sha256'
    )) order by (asset->>'position')::integer)
    from jsonb_array_elements(v_selected) asset
  );

  select binding.* into v_binding
  from public.luna_catalog_source_pack_dossier_bindings binding
  where binding.listing_package_id = v_package.id
    and binding.dossier_hash = v_revision.product_dossier_hash
    and binding.policy_version = 'REFERENCE_GUIDED_PRODUCT_GENERATION_V1'
  limit 1;
  select source_pack.* into v_source_pack
  from public.luna_catalog_authorized_source_packs source_pack
  where source_pack.id = v_binding.source_pack_id
    and source_pack.listing_package_id = v_package.id for share;
  select plan.* into v_successor
  from public.ebay_reference_guided_batch_plan_successors_v2 plan
  where plan.id = 'c54a0bbc-b16c-47b3-8f4e-93d2152e3b34'::uuid
    and plan.attempt_id = p_attempt_id for share;
  select plan.* into v_correction
  from public.ebay_reference_guided_extraordinary_replacement_plans plan
  where plan.id = '7ac6e2f4-d1f7-44f8-a026-064ca474904b'::uuid
    and plan.attempt_id = p_attempt_id for share;

  v_manifests_valid := v_binding.id is not null and v_source_pack.id is not null
    and v_binding.dossier_hash = v_revision.product_dossier_hash
    and v_binding.source_pack_manifest_hash = v_source_pack.source_pack_hash
    and v_source_pack.source_pack_hash = v_source_pack.manifest_hash
    and v_attempt.composition_manifest_hash =
      encode(extensions.digest(convert_to(v_attempt.composition_manifest_text,'UTF8'),'sha256'),'hex')
    and v_attempt.composition_manifest_text::jsonb->>'marketVisualBriefHash'
      = v_revision.market_visual_brief_hash
    and v_successor.plan_hash =
      'a33ad614481d65cedeed41bec5b4dc7c7746005bd214d0dbeef0b8de5e2d37f7'
    and v_successor.plan_hash =
      encode(extensions.digest(convert_to(v_successor.plan_text,'UTF8'),'sha256'),'hex')
    and v_correction.plan_hash =
      '9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3'
    and v_correction.plan_hash =
      encode(extensions.digest(convert_to(v_correction.plan_text,'UTF8'),'sha256'),'hex')
    and not exists (
      select 1 from jsonb_array_elements(v_source_pack.source_assets) source_asset,
        jsonb_array_elements_text(coalesce(source_asset->'excludedSourceSha256s','[]'::jsonb))
          excluded(hash)
      where exists (
        select 1 from jsonb_array_elements(v_selected) selected_asset
        where selected_asset->>'sha256' = excluded.hash
      )
    );

  v_package_data := v_package.package_data;
  v_draft := coalesce(v_package_data->'draftConfiguration','{}'::jsonb);
  v_saved_policies := coalesce(v_draft->'businessPolicies','{}'::jsonb);
  v_pricing := coalesce(v_package_data->'pricing','{}'::jsonb);
  v_aspects := coalesce(v_package_data->'aspects','{}'::jsonb);
  v_economics := coalesce(v_candidate.economics_summary,'{}'::jsonb);
  v_luna := coalesce(v_economics->'lunaConfirmation','{}'::jsonb);
  v_facts := coalesce(v_candidate.product_facts_summary,'{}'::jsonb);
  v_title := trim(coalesce(v_package_data->>'title',''));
  v_description := trim(coalesce(v_package_data->>'description',''));
  select fact->>'value' into v_gtin
  from jsonb_array_elements(coalesce(v_facts->'resolvedFacts','[]'::jsonb)) fact
  where fact->>'key' = 'gtin' and fact->>'status' in ('VERIFIED','CORROBORATED')
  limit 1;

  select profile.* into v_profile
  from public.ebay_account_policy_profiles profile
  where profile.account_key = v_run.marketplace_account_key
    and profile.marketplace_id = 'EBAY_US' for share;

  v_cost_fresh := v_economics->>'available' = 'true'
    and (v_economics->>'confirmedLunaPrice')::numeric > 0
    and (v_luna->>'confirmedAt')::timestamptz >= clock_timestamp() - interval '24 hours'
    and (v_luna->>'confirmedAt')::timestamptz <= clock_timestamp() + interval '5 minutes'
    and (v_luna->>'confirmedUnitCost')::numeric =
      (v_pricing->>'supplierCost')::numeric;
  v_stock_fresh := v_cost_fresh
    and v_luna->>'status' = 'AVAILABLE_EXACT_QUANTITY'
    and v_luna->>'quantityVisible' = 'true'
    and (v_luna->>'confirmedQuantity')::integer > 0;
  v_rights_confirmed := v_economics->>'imageRightsConfirmed' = 'true'
    and v_draft#>>'{imageAuthorization,approved}' = 'true'
    and coalesce(v_draft#>>'{imageAuthorization,rightsBasis}','') <> ''
    and v_draft#>>'{imageAuthorization,protectedManifestVerified}' = 'true';
  v_title_valid := length(v_title) between 1 and 80;
  v_category_valid := v_package_data->>'categoryId' = '20636'
    and v_facts#>>'{taxonomy,categoryId}' = '20636'
    and v_facts#>>'{taxonomy,status}' = 'AVAILABLE';
  v_identity_valid :=
    v_aspects->>'Brand' = 'Calypso Basics'
    and v_aspects->>'MPN' = '08300'
    and v_gtin = '036588083005'
    and v_package_data->>'conditionId' = '1000'
    and v_aspects->>'Color' = 'White'
    and lower(v_aspects->>'Material') =
      'powder coated enamel on steel'
    and v_aspects->>'Size' = '1.5'
    and v_aspects->>'Type' = 'Colander';
  v_specifics_valid := v_identity_valid
    and (select count(*) from jsonb_object_keys(v_aspects)) >= 6;
  v_price_valid := v_pricing->>'currency' = 'USD'
    and (v_pricing->>'targetPrice')::numeric > 0
    and (v_pricing->>'estimatedNetProfit')::numeric > 0
    and (v_pricing->>'estimatedNetMarginPercent')::numeric >= 20
    and v_pricing->>'passesProfitGate' = 'true';
  v_quantity_valid := (v_draft->>'quantity')::integer >= 1
    and (v_draft->>'quantity')::integer <= (v_luna->>'confirmedQuantity')::integer;
  v_policies_valid := v_profile.id is not null
    and v_profile.verified_at <= clock_timestamp()
    and v_profile.expires_at > clock_timestamp()
    and v_profile.fulfillment_policy_id = v_saved_policies->>'fulfillmentPolicyId'
    and v_profile.payment_policy_id = v_saved_policies->>'paymentPolicyId'
    and v_profile.return_policy_id = v_saved_policies->>'returnPolicyId';
  v_location_valid := v_policies_valid
    and coalesce(v_profile.merchant_location_key,'') <> ''
    and v_profile.merchant_location_key = v_draft->>'merchantLocationKey';
  v_claims_valid := v_description <> ''
    and lower(v_description) !~ '(dishwasher|easy clean|ergonomic|durab|fast drain|heat resistant|bpa|non.?stick)';
  v_required_fields_present := v_title <> '' and v_description <> ''
    and coalesce(v_package_data->>'categoryId','') <> ''
    and coalesce(v_draft->>'sku','') <> ''
    and v_gtin is not null and v_images_valid;

  if not v_cost_fresh then v_blockers := array_append(v_blockers,'LUNA_COST_RECONFIRMATION_REQUIRED'); end if;
  if not v_stock_fresh then v_blockers := array_append(v_blockers,'LUNA_STOCK_RECONFIRMATION_REQUIRED'); end if;
  if not v_rights_confirmed then v_blockers := array_append(v_blockers,'IMAGE_RIGHTS_CONFIRMATION_REQUIRED'); end if;
  if not v_title_valid then v_blockers := array_append(v_blockers,'EBAY_TITLE_LIMIT_INVALID'); end if;
  if not v_category_valid then v_blockers := array_append(v_blockers,'EBAY_CATEGORY_20636_INVALID'); end if;
  if not v_identity_valid then v_blockers := array_append(v_blockers,'CANONICAL_PRODUCT_IDENTITY_CONTRADICTION'); end if;
  if not v_specifics_valid then v_blockers := array_append(v_blockers,'ITEM_SPECIFICS_INCOMPLETE_OR_CONTRADICTORY'); end if;
  if not v_price_valid then v_blockers := array_append(v_blockers,'PRICE_OR_MARGIN_INVALID'); end if;
  if not v_quantity_valid then v_blockers := array_append(v_blockers,'LISTING_QUANTITY_INVALID'); end if;
  if not v_policies_valid then v_blockers := array_append(v_blockers,'EBAY_BUSINESS_POLICIES_NOT_VERIFIED'); end if;
  if not v_location_valid then v_blockers := array_append(v_blockers,'EBAY_MERCHANT_LOCATION_NOT_VERIFIED'); end if;
  if not v_images_valid then v_blockers := array_append(v_blockers,'V3_SEVEN_IMAGE_SET_INVALID'); end if;
  if not v_claims_valid then v_blockers := array_append(v_blockers,'UNSUPPORTED_LISTING_CLAIM_DETECTED'); end if;
  if not v_manifests_valid then v_blockers := array_append(v_blockers,'V3_MANIFEST_CHAIN_NOT_CURRENT'); end if;
  if not v_required_fields_present then v_blockers := array_append(v_blockers,'MANDATORY_LISTING_FIELD_MISSING'); end if;

  v_gates := jsonb_build_object(
    'lunaCostFresh',v_cost_fresh,
    'lunaStockFresh',v_stock_fresh,
    'imageRightsConfirmed',v_rights_confirmed,
    'titleValid',v_title_valid,
    'categoryValid',v_category_valid,
    'canonicalIdentityValid',v_identity_valid,
    'itemSpecificsValid',v_specifics_valid,
    'priceAndMarginValid',v_price_valid,
    'quantityValid',v_quantity_valid,
    'policiesValid',v_policies_valid,
    'merchantLocationValid',v_location_valid,
    'sevenImageOrderValid',v_images_valid,
    'zeroUnsupportedClaims',v_claims_valid,
    'manifestsCurrent',v_manifests_valid,
    'zeroMandatoryFieldsMissing',v_required_fields_present
  );
  v_ready := cardinality(v_blockers) = 0;

  v_user_fields := jsonb_build_object(
    'title',v_package_data->'title',
    'categoryId',v_package_data->'categoryId',
    'categoryName',v_package_data->'categoryName',
    'conditionId',v_package_data->'conditionId',
    'description',v_package_data->'description',
    'aspects',v_package_data->'aspects',
    'pricing',v_package_data->'pricing',
    'shipping',v_package_data->'shipping',
    'draftConfiguration',v_package_data->'draftConfiguration'
  );
  v_user_fields_hash := encode(extensions.digest(
    convert_to(v_user_fields::text,'UTF8'),'sha256'),'hex');

  v_snapshot := jsonb_build_object(
    'version','CALYPSO_FINAL_LISTING_REVIEW_V1',
    'revisionId',p_revision_id,
    'attemptId',p_attempt_id,
    'listingPackageId',v_package.id,
    'visualPhase','COMPLETED',
    'finalVisualSetLocked',true,
    'generationControlsHidden',true,
    'listing',jsonb_build_object(
      'title',v_title,
      'titleLength',length(v_title),
      'categoryId',v_package_data->>'categoryId',
      'condition','New',
      'conditionId',v_package_data->>'conditionId',
      'description',v_description,
      'itemSpecifics',v_aspects,
      'productIdentifiers',jsonb_build_object('gtin',v_gtin,'mpn',v_aspects->>'MPN'),
      'quantity',(v_draft->>'quantity')::integer,
      'pricing',v_pricing,
      'businessPolicies',jsonb_build_object(
        'fulfillmentPolicyId',v_profile.fulfillment_policy_id,
        'paymentPolicyId',v_profile.payment_policy_id,
        'returnPolicyId',v_profile.return_policy_id,
        'verifiedAt',v_profile.verified_at,
        'expiresAt',v_profile.expires_at
      ),
      'merchantLocationKey',v_profile.merchant_location_key,
      'shippingWeight','UNKNOWN',
      'packageDimensions','UNKNOWN',
      'imageUrls',v_image_urls
    ),
    'canonicalIdentity',jsonb_build_object(
      'brand','Calypso Basics','mpn','08300','gtin','036588083005',
      'condition','New','color','White',
      'material','powder-coated enamel on steel','capacity','1.5 quart',
      'type','Colander'
    ),
    'selectedImages',v_selected,
    'finalSetHash',v_final.final_set_hash,
    'sourceHashes',jsonb_build_object(
      'dossierHash',v_revision.product_dossier_hash,
      'marketVisualBriefHash',v_revision.market_visual_brief_hash,
      'sourcePackManifestHash',v_binding.source_pack_manifest_hash,
      'compositionManifestHash',v_attempt.composition_manifest_hash,
      'successorPlanHash',v_successor.plan_hash,
      'correctionBatchPlanHash',v_correction.plan_hash
    ),
    'marketVisualBriefPolicy',
      'PRESENTATION_AND_COPY_GUIDANCE_ONLY_NOT_PRODUCT_FACTS',
    'userFields',v_user_fields,
    'userFieldsHash',v_user_fields_hash,
    'gates',v_gates,
    'blockers',to_jsonb(v_blockers),
    'readyForUnpublishedOfferAuthorization',v_ready,
    'authorizationEnabled',false,
    'safety',jsonb_build_object(
      'inventoryItemCreated',false,'offerCreated',false,
      'offerStatus','NOT_CREATED','ebayWrites',0,'productionChanged',false,
      'providerCalls',8,'imagesModified',false,'publicationEnabled',false
    )
  );
  v_preview_text := v_snapshot::text;
  v_preview_hash := encode(extensions.digest(
    convert_to(v_preview_text,'UTF8'),'sha256'),'hex');

  insert into public.ebay_reference_guided_final_listing_review_previews(
    revision_id,attempt_id,listing_package_id,final_set_event_id,final_set_hash,
    listing_package_updated_at,user_fields_hash,preview_snapshot,preview_hash,
    gates,blockers,visual_phase,final_visual_set_locked,generation_controls_hidden,
    ready_for_unpublished_offer_authorization,authorization_enabled,
    inventory_item_created,offer_created,offer_status,ebay_writes,
    production_changed,provider_calls_snapshot,created_by
  ) values(
    p_revision_id,p_attempt_id,v_package.id,v_final.id,v_final.final_set_hash,
    v_package.updated_at,v_user_fields_hash,v_snapshot,v_preview_hash,
    v_gates,v_blockers,'COMPLETED',true,true,v_ready,false,false,false,
    'NOT_CREATED',0,false,8,v_revision.created_by
  ) on conflict do nothing;

  select preview.* into v_preview
  from public.ebay_reference_guided_final_listing_review_previews preview
  where preview.attempt_id = p_attempt_id and preview.preview_hash = v_preview_hash;
  if v_preview.id is null or v_preview.preview_snapshot <> v_snapshot
    or v_preview.provider_calls_snapshot <> 8 or v_preview.ebay_writes <> 0
    or v_preview.production_changed or v_preview.inventory_item_created
    or v_preview.offer_created or v_preview.authorization_enabled then
    raise exception 'FINAL_LISTING_REVIEW_PERSISTENCE_FAILED';
  end if;

  return query select v_preview.id,v_preview.preview_hash,
    v_preview.final_visual_set_locked,
    v_preview.ready_for_unpublished_offer_authorization,v_preview.blockers,
    v_preview.inventory_item_created,v_preview.offer_created,
    v_preview.offer_status,v_preview.ebay_writes,v_preview.production_changed;
end;
$$;

revoke all on function public.prepare_ebay_reference_guided_final_listing_review(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.prepare_ebay_reference_guided_final_listing_review(uuid,uuid)
  to service_role;

notify pgrst,'reload schema';
