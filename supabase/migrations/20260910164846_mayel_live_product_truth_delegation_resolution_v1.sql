begin;
-- A LIVE verified linkage can use own product facts from a draft package; this grants no publication authority.
create function public.seller_os_visual_current_product_truth_v1(t public.ebay_mayel_visual_tasks_v1)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with bounded as (
 select jsonb_build_object('authority','EXACT_LIVE_LINKED_PRODUCT_TRUTH_V1','taskId',t.id,'itemId',t.ebay_item_id,
 'accountKey',t.marketplace_account_key,'sku',a.ebay_sku,'productId',truth->>'lunaProductId','variantId',m.supplier_variant_id,
 'packageId',p.id,'productTruthDigest',truth->>'evidenceDigest','visualSourceDigest',t.source_image_set_digest) as proof
 from public.ebay_manual_listing_links m
 join public.ebay_active_listings a on a.id=m.connector_listing_id and a.account_key=m.account_key and a.ebay_item_id=m.ebay_item_id
 join public.ebay_listing_packages p on p.account_key=m.account_key and p.opportunity_id=m.opportunity_id and p.candidate_key=m.candidate_key
 cross join lateral (select p.package_data #> '{evidenceSnapshot,assessment,productTruth}' as truth) pt
 cross join lateral (select truth #> '{sourceEvidence,requiredItemSpecificsTruthV1,lunaExactProductEvidenceSetV1}' as exact) pe
 where m.account_key=t.marketplace_account_key and m.ebay_item_id=t.ebay_item_id and m.connector_listing_id=t.active_listing_id
 and m.verification_status='verified' and m.verification_method='EBAY_TRADING_GET_ITEM_READONLY' and m.connector_listing_status='active'
 and a.listing_status='active' and a.ebay_sku=t.evidence_pack->>'sku' and a.supplier_variant_id=m.supplier_variant_id
 and p.status in ('draft','approved') and truth->>'authorityClass'='SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1'
 and truth->>'candidateKey'=m.candidate_key and truth->>'lunaVariantId'=m.supplier_variant_id
 and truth->>'evidenceDigest' ~ '^sha256:[a-f0-9]{64}$'
 and exact->>'productIdentityExact'='true' and exact->>'exactSupplierLineageCertified'='true'
 and exact->>'lunaProductId'=truth->>'lunaProductId' and exact->>'lunaVariantId'=m.supplier_variant_id
 and exact->>'factInvented'='false' and exact->'sourceConflicts'='[]'::jsonb
 limit 2
 ), aggregate_proof as (select jsonb_agg(proof) as proofs from bounded)
 select case when jsonb_array_length(proofs)=1 then proofs->0 else null end from aggregate_proof;
$$;
create function public.seller_os_read_visual_current_product_truth_v1(p_account_key text,p_task_id uuid)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select public.seller_os_visual_current_product_truth_v1(t) from public.ebay_mayel_visual_tasks_v1 t
 where t.marketplace_account_key=p_account_key and t.id=p_task_id;
$$;
revoke all on function public.seller_os_visual_current_product_truth_v1(public.ebay_mayel_visual_tasks_v1),
 public.seller_os_read_visual_current_product_truth_v1(text,uuid) from public,anon,authenticated;
grant execute on function public.seller_os_visual_current_product_truth_v1(public.ebay_mayel_visual_tasks_v1),
 public.seller_os_read_visual_current_product_truth_v1(text,uuid) to service_role;
create or replace function public.seller_os_visual_delegated_ready_v1(t public.ebay_mayel_visual_tasks_v1,p_grant_id text)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce(t.status='OWNER_PREVIEW_READY'
 and (t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null)
 and t.selection_signal #>> '{currentOfficialGallery,authority}'='CURRENT_OFFICIAL_ORDERED_IMAGE_SET'
 and t.selection_signal #> '{currentOfficialGallery,images}'=t.current_image_set
 and t.visual_manifest->>'visualTaskId'=t.id::text and t.visual_manifest->>'ebayItemId'=t.ebay_item_id
 and t.visual_manifest->>'productTruthDigest'=t.product_truth_digest
 and t.visual_manifest->>'sourceImageSetDigest'=t.source_image_set_digest
 and t.visual_manifest->>'intentContract'='MAYEL_VISUAL_INTENT_V1'
 and jsonb_array_length(coalesce(t.visual_manifest->'visualIntents','[]')) between 1 and 6
 and jsonb_array_length(coalesce(t.source_image_references,'[]'))>0
 and not exists(select 1 from jsonb_array_elements(t.source_image_references) r
  where not coalesce((r->>'authority'='OFFICIAL_EBAY_CURRENT_LISTING_IMAGE' and r->>'referenceId'='EBAY_ITEM_'||t.ebay_item_id)
   or (r->>'authority' in ('AUTHORIZED_LUNA_SOURCE_PACK','APPROVED_CANONICAL_LISTING_ASSET','SAVED_AUTHORIZED_GENERATOR_SOURCE')
     and t.evidence_pack->'sourceImageSet'=t.source_image_references
     and t.evidence_pack->>'lunaProductId' ~ '^[0-9]+$' and t.evidence_pack->>'lunaVariantId' ~ '^[0-9]+$'),false)
  or coalesce(r->>'sha256','') !~ '^[a-f0-9]{64}$')
 and exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d
  where d.id::text=p_grant_id and d.account_key=t.marketplace_account_key and d.status='ACTIVE' and d.revoked_at is null
  and d.scope='FULL' and d.contract_version='MAYEL_AUTONOMOUS_LISTING_OPTIMIZATION_DELEGATION_V1'
  and exists(select 1 from public.ebay_mayel_visual_delegation_authorities_v1 v where v.marketplace_account_key=d.account_key
   and v.owner_user_id=d.owner_user_id and v.status='ACTIVE' and v.revoked_at is null)
  and not exists(select 1 from jsonb_array_elements(t.visual_manifest->'visualIntents') i
   where not(d.allowed_actions ? case i->>'visualIntent' when 'REPLACE_MAIN' then 'MAIN_IMAGE_REPLACEMENT'
   when 'REPLACE_SLOT' then 'SECONDARY_IMAGE_REPLACEMENT' when 'ADD_SECONDARY' then 'IMAGE_ADDITION' else 'UNSUPPORTED' end)))
 and exists(select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e where e->>'assetId' is not null)
 and not exists(select 1 from jsonb_array_elements(t.visual_manifest->'proposedOrderedImages') e
  where e->>'assetId' is not null and not exists(select 1 from public.ebay_listing_image_assets a
   where a.id::text=e->>'assetId' and a.account_key=t.marketplace_account_key and a.mayel_visual_task_id=t.id
   and a.status='approved' and a.mayel_approval_status='APPROVED' and a.output_sha256=e->>'outputSha256'
   and a.public_url=e->>'publicUrl' and a.source_image_set_digest=t.source_image_set_digest and a.product_truth_digest=t.product_truth_digest
   and a.qa_result->>'automaticStatus'='PASSED' and a.qa_result #>> '{humanReview,decision}'='APPROVE'
   and a.qa_result #>> '{humanReview,checks,productIdentityPreserved}'='true'
   and a.qa_result #>> '{humanReview,checks,noUnsupportedClaims}'='true'
   and a.qa_result #>> '{humanReview,checks,noInventedAccessories}'='true'
   and a.qa_result #>> '{humanReview,checks,noUnauthorizedText}'='true')),false);
$$;
create or replace function public.seller_os_pending_mayel_visual_manifests_v1(p_account_key text)
returns table(id uuid,ebay_item_id text,visual_manifest_id uuid,visual_manifest_digest text,updated_at timestamptz)
language sql stable security invoker set search_path=public,pg_temp as $$
 select t.id,t.ebay_item_id,t.visual_manifest_id,t.visual_manifest_digest,t.updated_at
 from public.ebay_mayel_visual_tasks_v1 t where t.marketplace_account_key=p_account_key
 and t.status='OWNER_PREVIEW_READY' and t.visual_manifest_id is not null and t.visual_manifest_digest is not null
 and (not exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d where d.account_key=p_account_key and d.status='ACTIVE')
 or exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d where d.account_key=p_account_key and d.status='ACTIVE'
 and (t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null)))
 and not exists(select 1 from public.ebay_mayel_visual_phase_b_executions_v1 e where e.marketplace_account_key=t.marketplace_account_key
 and e.visual_task_id=t.id and e.visual_manifest_digest=t.visual_manifest_digest and e.phase='APPLIED_AND_OFFICIALLY_VERIFIED')
 and not exists(select 1 from public.seller_os_ipad_outbox_v1 o where o.account_key=t.marketplace_account_key
 and o.kind in ('IMAGE_DRAFT','IMAGE_SYNC','IMAGE_UPLOAD') and o.state<>'SUPERSEDED'
 and o.intent #>> '{requestedChanges,taskId}'=t.id::text
 and (o.kind='IMAGE_SYNC' and o.intent #>> '{requestedChanges,manifestDigest}'=t.visual_manifest_digest
 or o.dispatch_count>0 or not exists(select 1 from public.seller_os_mayel_optimization_grants_v1 d
 where d.account_key=p_account_key and d.status='ACTIVE' and d.revoked_at is null
 and (t.selection_signal->>'productTruthSupported'='true' or public.seller_os_visual_current_product_truth_v1(t) is not null))))
 order by t.updated_at,t.id limit 3;
$$;
notify pgrst,'reload schema';
commit;
