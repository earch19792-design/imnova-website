-- Preserve exact CURRENT Luna authority when Shopify product handles contain
-- Unicode. Host, HTTPS, one product path segment, and no query/fragment remain
-- mandatory and fail closed.
create or replace function public.read_current_publication_execution_contract_v1(
 p_publication_id uuid,p_actor_user_id uuid,p_account_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p public.ebay_authorized_listing_publications%rowtype;
 e public.ebay_draft_only_execution_ledger%rowtype;
 a public.ebay_draft_only_approvals%rowtype;
 k public.ebay_listing_packages%rowtype;
 o public.ebay_luna_opportunity_queue%rowtype;
 r jsonb; x jsonb; b jsonb; urls jsonb; binding jsonb; errors text[]:='{}';
begin
 if not public.is_seller_os_service_role_request_v1() then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
 select * into p from public.ebay_authorized_listing_publications where id=p_publication_id;
 if p.id is null or p.actor_user_id is distinct from p_actor_user_id or p.marketplace_account_key is distinct from p_account_key then
  return jsonb_build_object('valid',false,'blockers',jsonb_build_array('CURRENT_PUBLICATION_IDENTITY_MISMATCH'));
 end if;
 r:=p.sanitized_result#>'{publicationPreparationV1,current}';
 x:=p.sanitized_result#>'{publicationPreparationV1,activation}';b:=r#>'{snapshot,binding}';
 select * into e from public.ebay_draft_only_execution_ledger where id=p.draft_execution_id;
 select * into a from public.ebay_draft_only_approvals where id=p.draft_approval_id;
 select * into k from public.ebay_listing_packages where id=p.listing_package_id;
 select * into o from public.ebay_luna_opportunity_queue where id=p.opportunity_id;
 if r is null or e.id is null or a.id is null or k.id is null or o.id is null then errors:=array_append(errors,'CURRENT_EXECUTION_AUTHORITY_MISSING'); end if;
 if coalesce(r->>'version','')<>'SELLER_OS_PACKAGE_PREVIEW_REVISION_V1'
 or r->>'publicationId' is distinct from p.id::text or r->>'packageId' is distinct from k.id::text
 or r->>'accountKey' is distinct from p.marketplace_account_key
 or b->>'PRODUCT_ID' is distinct from o.supplier_product_id or b->>'VARIANT_ID' is distinct from o.supplier_variant_id
 or b->>'SKU' is distinct from o.supplier_sku or b->>'OPPORTUNITY_ID' is distinct from o.id::text
 or b->>'CANDIDATE_KEY' is distinct from o.candidate_key or k.candidate_key is distinct from o.candidate_key
 or k.account_key is distinct from p.marketplace_account_key or k.created_by is distinct from p.actor_user_id
 or k.status is distinct from 'approved' or r#>>'{snapshot,generation}' is distinct from r->>'packageGeneration'
 or r->>'previewHash' is distinct from 'sha256:'||p.preview_hash
 or r->'preview' is distinct from p.preview
 or p.preview#>>'{offerPayload,sku}' is distinct from p.sku
 or p.preview->>'accountFingerprint' is distinct from p.account_fingerprint
 then errors:=array_append(errors,'CURRENT_EXECUTION_MATERIAL_BINDING_MISMATCH'); end if;
 if x->>'version' is distinct from 'CURRENT_PREPARATION_ACTIVATION_V1'
 or x->>'publicationId' is distinct from p.id::text or x->>'draftExecutionId' is distinct from e.id::text
 or x->>'draftApprovalId' is distinct from a.id::text or x->>'previewHash' is distinct from p.preview_hash
 or x->>'packageHash' is distinct from r->>'packageHash' or x->>'packageGeneration' is distinct from r->>'packageGeneration'
 or x->'historicalExecutionReused' is distinct from 'false'::jsonb
 or e.id::text=r->>'priorDraftExecutionId' or e.approval_id is distinct from a.id
 or e.phase is distinct from 'completed' or e.offer_id is distinct from p.offer_id or e.sku is distinct from p.sku
 or e.opportunity_id is distinct from p.opportunity_id or a.opportunity_id is distinct from p.opportunity_id
 or p.target is distinct from e.target
 or e.actor_user_id is distinct from p.actor_user_id or e.listing_package_id is distinct from k.id
 or e.account_fingerprint is distinct from p.account_fingerprint or e.target is distinct from 'PRODUCTION'
 or a.actor_user_id is distinct from p.actor_user_id or a.listing_package_id is distinct from k.id
 or a.status is distinct from 'consumed' or a.consumed_at is null or a.payload_hash is distinct from e.request_hash
 or a.approval_phrase_version is distinct from 'CURRENT_PREPARATION_RECONCILIATION_V1'
 or a.approved_payload->'inventoryItemPayload' is distinct from p.preview->'inventoryItemPayload'
 or a.approved_payload->'offerPayload' is distinct from p.preview->'offerPayload'
 or a.approved_payload#>'{economics,historicalStateInherited}' is distinct from 'false'::jsonb
 then errors:=array_append(errors,'CURRENT_EXECUTION_HISTORICAL_OR_PAYLOAD_MISMATCH'); end if;
 if public.assess_publication_revision_images_v1(p.id,p.actor_user_id,p.marketplace_account_key)->>'pass' is distinct from 'true' then
  errors:=array_append(errors,'CURRENT_EXECUTION_IMAGE_AUTHORITY_UNPROVEN'); end if;
 select jsonb_agg(product_url) into urls from (select product_url from public.market_radar_latest_variants
 where source_key='lunaportex' and supplier_product_id=o.supplier_product_id and supplier_variant_id=o.supplier_variant_id
 and sku=o.supplier_sku limit 2) exact_catalog;
 if jsonb_array_length(coalesce(urls,'[]'))<>1
 or coalesce(urls->>0,'')!~'^https://(www\.)?lunaportex\.com/products/[^/?#[:space:][:cntrl:]]+$'
 then errors:=array_append(errors,'CURRENT_EXECUTION_CANONICAL_LINKAGE_UNPROVEN'); end if;
 if exists(select 1 from public.ebay_active_listings l where l.account_key=p.marketplace_account_key
   and l.listing_status='active' and (l.ebay_sku=p.sku or (l.market_radar_product_id=o.market_radar_product_id and l.supplier_variant_id=o.supplier_variant_id))
   and l.ebay_item_id is distinct from p.listing_id) or exists(select 1 from public.ebay_authorized_listing_publications other
   where other.marketplace_account_key=p.marketplace_account_key and other.id<>p.id
   and (other.sku=p.sku or other.opportunity_id=p.opportunity_id) and other.phase in ('publish_in_flight','outcome_unknown','published_pending_verification','monitor_registered'))
 then errors:=array_append(errors,'CURRENT_PUBLICATION_DUPLICATE_IDENTITY_CONFLICT'); end if;
 binding:=jsonb_build_object('publicationId',p.id,'packageId',k.id,'accountKey',p.marketplace_account_key,
 'sku',p.sku,'offerId',p.offer_id,'draftExecutionId',e.id,'draftApprovalId',a.id,
 'packageHash',r->>'packageHash','packageGeneration',r->>'packageGeneration','previewHash',r->>'previewHash',
 'previewGeneration',r->>'packageGeneration','productId',o.supplier_product_id,'variantId',o.supplier_variant_id,
 'supplierSku',o.supplier_sku,'opportunityId',o.id,'candidateKey',o.candidate_key,
 'productTruthDigest',o.assessment#>>'{productTruth,evidenceDigest}','canonicalLunaUrl',urls->>0,'gtin',o.gtin);
 return jsonb_build_object('version','CURRENT_PUBLICATION_EXECUTION_CONTRACT_V1','valid',cardinality(errors)=0,
 'binding',binding,'blockers',to_jsonb(errors),'phase',p.phase,'publishAttemptCount',p.publish_attempt_count,
 'unclaimed',p.phase='preview_ready' and p.publish_attempt_count=0 and p.publication_idempotency_key is null and p.claim_token is null and p.listing_id is null);
end;$$;
revoke all on function public.read_current_publication_execution_contract_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.read_current_publication_execution_contract_v1(uuid,uuid,text) to service_role;

comment on function public.read_current_publication_execution_contract_v1(uuid,uuid,text) is
'Fail-closed CURRENT publication execution authority; canonical Luna product handles may contain Unicode but require exact HTTPS host, one path segment, and no query or fragment.';
