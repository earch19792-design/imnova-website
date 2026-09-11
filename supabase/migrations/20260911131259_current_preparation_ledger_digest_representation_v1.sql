-- Preserve the digest bytes: package uses sha256:<hex>, publication ledger uses <hex>.
-- Atomic reconciliation of CURRENT non-LIVE preparation. Historical approval,
-- execution, Preview and economic evidence are immutable. No publish authority.
create or replace function public.activate_current_publication_preparation_v1(
 p_publication_id uuid,p_actor uuid,p_account_key text,p_evidence jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare pub public.ebay_authorized_listing_publications%rowtype;
 pkg public.ebay_listing_packages%rowtype; op public.ebay_luna_opportunity_queue%rowtype;
 prep jsonb; r jsonb; receipt jsonb; b jsonb; rb jsonb; inv jsonb; activation jsonb;
 payload jsonb; payload_hash text; aid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); t timestamptz:=clock_timestamp();
begin
 if not public.is_seller_os_service_role_request_v1() then raise exception 'SERVICE_RUNTIME_REQUIRED';end if;
 select * into pub from public.ebay_authorized_listing_publications where id=p_publication_id for update;
 if pub.id is null or pub.actor_user_id is distinct from p_actor or pub.marketplace_account_key is distinct from p_account_key or
   pub.phase is distinct from 'preview_ready' or pub.publish_attempt_count<>0 or pub.publication_idempotency_key is not null or
   pub.claim_token is not null or pub.listing_id is not null then raise exception 'CURRENT_ACTIVATION_PUBLICATION_SCOPE_INVALID';end if;
 select * into pkg from public.ebay_listing_packages where id=pub.listing_package_id and created_by=p_actor and account_key=p_account_key;
 select * into op from public.ebay_luna_opportunity_queue where id=pkg.opportunity_id and candidate_key=pkg.candidate_key;
 if pkg.id is null or op.id is null then raise exception 'CURRENT_ACTIVATION_PRODUCT_REQUIRED';end if;
 prep:=pub.sanitized_result->'publicationPreparationV1';r:=prep->'current';
 receipt:=pub.sanitized_result->'currentUnpublishedPreparationV1';b:=p_evidence->'binding';
 rb:=p_evidence->'offerReadback';inv:=p_evidence->'inventoryReadback';
 if p_evidence->>'version' is distinct from 'CURRENT_PREPARATION_ACTIVATION_V1' or
   p_evidence->>'publicationAuthorized' is distinct from 'false' or p_evidence->>'economicsInherited' is distinct from 'false' or
   coalesce(p_evidence->>'key','') !~ '^sha256:[a-f0-9]{64}$' or
   coalesce(r->>'previewHash','') !~ '^sha256:[a-f0-9]{64}$' or
   (p_evidence->>'observedAt')::timestamptz > t or (p_evidence->>'observedAt')::timestamptz < t-interval '2 minutes' or
   p_evidence->>'observedAt' is null or
   b->>'publicationId' is distinct from pub.id::text or b->>'packageId' is distinct from pkg.id::text or
   b->>'accountKey' is distinct from p_account_key or b->>'sku' is distinct from pub.sku or b->>'offerId' is distinct from pub.offer_id or
   b->>'packageGeneration' is distinct from r->>'packageGeneration' or b->>'packageHash' is distinct from r->>'packageHash' or
   b->>'previewHash' is distinct from r->>'previewHash' or b->>'previewGeneration' is distinct from r->>'revisionKey' or
   (b-'previewGeneration') is distinct from receipt->'binding' or
   receipt->>'version' is distinct from 'CURRENT_UNPUBLISHED_PREPARATION_V1' or receipt->>'state' is distinct from 'READBACK_CONFIRMED' or
   receipt->>'publicationAuthorized' is distinct from 'false' or receipt#>>'{result,pass}' is distinct from 'true' or
   r->>'productId' is distinct from op.supplier_product_id or r->>'variantId' is distinct from op.supplier_variant_id or
   r->>'sku' is distinct from op.supplier_sku or r->>'publicationId' is distinct from pub.id::text or
   rb->>'safe' is distinct from 'true' or rb->>'httpStatus' is distinct from '200' or rb->>'status' is distinct from 'UNPUBLISHED' or
   rb->>'listingPresent' is distinct from 'false' or rb->>'payloadMatches' is distinct from 'true' or
   rb->>'offerId' is distinct from pub.offer_id or rb->>'sku' is distinct from pub.sku or
   inv->>'safe' is distinct from 'true' or inv->>'httpStatus' is distinct from '200' or
   not public.publication_revision_content_matches_v1(r,r->'preview') or
   public.assess_publication_revision_images_v1(pub.id,p_actor,p_account_key)->>'pass' is distinct from 'true' then
   raise exception 'CURRENT_ACTIVATION_EXACT_READBACK_REQUIRED';end if;
 activation:=prep->'activation';
 if activation is not null then
   if activation->>'receiptBindingKey' is distinct from p_evidence->>'key' or
     activation->>'draftExecutionId' is distinct from pub.draft_execution_id::text or
     activation->>'previewHash' is distinct from pub.preview_hash or
     not exists(select 1 from public.ebay_draft_only_execution_ledger e where e.id=pub.draft_execution_id and
       e.phase='completed' and e.sanitized_result#>>'{currentPreparationActivationV1,key}'=p_evidence->>'key') then
     raise exception 'CURRENT_ACTIVATION_IDEMPOTENCY_CONFLICT';end if;
   return jsonb_build_object('activated',true,'idempotentReplay',true,'executionId',pub.draft_execution_id,'publicationId',pub.id,'publicationAuthorized',false);
 end if;
 if pub.preview_hash is distinct from r->>'priorPreviewHash' or pub.draft_execution_id::text is distinct from r->>'priorDraftExecutionId' or
   exists(select 1 from public.ebay_draft_only_execution_ledger e where e.account_fingerprint=pub.account_fingerprint and e.sku=pub.sku and e.phase not in ('completed','terminal_failure')) then
   raise exception 'CURRENT_ACTIVATION_CONCURRENT_EXECUTION';end if;
 -- No old approved_payload/economic state is copied. This row records only the
 -- explicit CURRENT preparation authority and its official readback.
 payload:=jsonb_build_object('version','CURRENT_NONLIVE_PREPARATION_RECONCILIATION_V1','sku',pub.sku,
   'inventoryItemPayload',r#>'{preview,inventoryItemPayload}','offerPayload',r#>'{preview,offerPayload}',
   'compliance',jsonb_build_object('publicationPreparationRevisionV1',b||jsonb_build_object('operation','PREPARE_UNPUBLISHED_ONLY','publicationAuthorized',false)),
   'safety',jsonb_build_object('unpublishedOnly',true,'publishOfferPresent',false,'permittedOperations','[]'::jsonb),
   'economics',jsonb_build_object('status','REQUIRES_CURRENT_EVALUATION','historicalStateInherited',false));
 payload_hash:=encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');
 insert into public.ebay_draft_only_approvals(id,listing_package_id,opportunity_id,candidate_key,actor_user_id,target,account_fingerprint,
   status,payload_hash,approved_payload,approval_phrase_version,approval_idempotency_key,approved_at,expires_at,consumed_at)
 values(aid,pkg.id,op.id,pkg.candidate_key,p_actor,'PRODUCTION',pub.account_fingerprint,'consumed',payload_hash,payload,
   'CURRENT_PREPARATION_RECONCILIATION_V1','current-preparation-approval:'||(p_evidence->>'key'),t,t+interval '15 minutes',t);
 insert into public.ebay_draft_only_execution_ledger(id,approval_id,actor_user_id,listing_package_id,opportunity_id,idempotency_key,
   request_hash,target,account_fingerprint,sku,phase,attempt_count,inventory_http_status,inventory_confirmed_at,offer_http_status,offer_id,
   completed_at,sanitized_result,permitted_operations)
 values(eid,aid,p_actor,pkg.id,op.id,'current-preparation-execution:'||(p_evidence->>'key'),payload_hash,'PRODUCTION',pub.account_fingerprint,
   pub.sku,'completed',1,200,t,200,pub.offer_id,t,jsonb_build_object('status','UNPUBLISHED','verified',true,
     'currentPreparationActivationV1',p_evidence,'marketplaceWrites',0,'historicalExecutionReused',false),array[]::text[]);
 activation:=jsonb_build_object('version','CURRENT_PREPARATION_ACTIVATION_V1','publicationId',pub.id,'draftExecutionId',eid,
   'draftApprovalId',aid,'previewHash',substring(r->>'previewHash' from 8),'packagePreviewHash',r->>'previewHash','packageHash',r->>'packageHash','packageGeneration',r->>'packageGeneration',
   'previewGeneration',r->>'revisionKey','activatedAt',t,'receiptBindingKey',p_evidence->>'key','publicationAuthorized',false,
   'historicalExecutionReused',false,'scope','PREPARE_UNPUBLISHED_ONLY');
 update public.ebay_authorized_listing_publications set draft_execution_id=eid,draft_approval_id=aid,
   preview=r->'preview',preview_hash=substring(r->>'previewHash' from 8),preview_prepared_at=t,updated_at=t,
   sanitized_result=jsonb_set(sanitized_result,'{publicationPreparationV1,activation}',activation)
 where id=pub.id;
 return jsonb_build_object('activated',true,'idempotentReplay',false,'executionId',eid,'approvalId',aid,'publicationId',pub.id,'publicationAuthorized',false);
end $$;
revoke all on function public.activate_current_publication_preparation_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.activate_current_publication_preparation_v1(uuid,uuid,text,jsonb) to service_role;
