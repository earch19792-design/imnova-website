import {readEbayPackageFeeContextReadonlyV1} from './ebay-package-fee-context-readonly-v1'
import {persistProducedEbayFeeV1} from '../seller-os/ebay-fee-runtime-v1'
import 'server-only'
import {randomUUID} from 'node:crypto'
import type {SupabaseClient} from '@supabase/supabase-js'
import {keywordRecord as record,keywordWireDigestV1 as digest} from '../seller-os/keyword-intelligence-handoff-v1'
import {certifyCurrentPrepublicationV1} from './ebay-current-prepublication-server-v1'
import {readSellOneLikeThisV1} from '../seller-os/sell-one-like-this-runtime-v1'
import {publishEbayOfferOnce,verifyEbayPublishedOffer,verifyEbayDraftInventoryItem,verifySingleCurrentOfferV1,EBAY_FINAL_PUBLISH_CONFIRMATION} from './ebay-draft-only-gateway'
import {registerManualEbayListing} from './ebay-manual-listing-service'

type Input={supabase:SupabaseClient;actor:string;accountKey:string;publicationId:string;packageId:string;offerId:string;
 sku:string;packageHash:string;packageGeneration:string;previewHash:string;idempotencyKey:string;confirmation:string}
const columns='id,actor_user_id,listing_package_id,opportunity_id,marketplace_account_key,account_fingerprint,sku,offer_id,phase,publish_attempt_count,publication_idempotency_key,claim_token,listing_id,preview,preview_hash,draft_execution_id,draft_approval_id,sanitized_result,updated_at'

/** Uses the existing claim/publish/readback machine. CURRENT preparation is
 * evidence, never the OWNER grant; this request supplies the separate grant. */
async function refreshExpiredCurrentFeeEvidenceV1(input:Input,revision:Record<string,unknown>) {
 const head=await input.supabase.from('seller_os_ebay_fee_bindings_v1').select('authority_id')
  .eq('binding_key',`${input.accountKey}:package:${input.packageId}`).abortSignal(AbortSignal.timeout(8000)).retry(false).single()
 if(head.error)throw Error('CURRENT_FEE_HEAD_UNAVAILABLE')
 const authority=await input.supabase.from('seller_os_ebay_fee_authorities_v1').select('authority')
  .eq('marketplace_account_key',input.accountKey).eq('authority_id',head.data.authority_id).abortSignal(AbortSignal.timeout(8000)).retry(false).single()
 if(authority.error)throw Error('CURRENT_FEE_AUTHORITY_UNAVAILABLE')
 if(Date.parse(String(record(authority.data.authority).freshUntil))>Date.now())return
 const context=await readEbayPackageFeeContextReadonlyV1(input.packageId)
 await persistProducedEbayFeeV1({supabase:input.supabase,accountKey:input.accountKey,packageId:input.packageId,itemId:null,
  sku:String(revision.sku),context,now:new Date()})
}
const defaultDependencies={refreshFees:refreshExpiredCurrentFeeEvidenceV1,certify:certifyCurrentPrepublicationV1,readCurrent:readSellOneLikeThisV1,
 publish:publishEbayOfferOnce,inventory:verifyEbayDraftInventoryItem,offer:verifyEbayPublishedOffer,
 collection:verifySingleCurrentOfferV1,register:registerManualEbayListing}
export async function publishCurrentRevisionV1(input:Input,deps=defaultDependencies) {
 const db=input.supabase
 if(input.confirmation!==EBAY_FINAL_PUBLISH_CONFIRMATION || input.idempotencyKey!==`publish:${input.publicationId}`)throw Error('CURRENT_PUBLISH_EXPLICIT_AUTHORIZATION_REQUIRED')
 const read=async()=>{
  const r=await db.from('ebay_authorized_listing_publications').select(columns).eq('id',input.publicationId)
   .eq('actor_user_id',input.actor).eq('marketplace_account_key',input.accountKey).abortSignal(AbortSignal.timeout(8000)).retry(false).single()
  if(r.error)throw Error('CURRENT_PUBLICATION_READ_FAILED');return r.data
 }
 let p=await read()
 const revision=record(record(record(p.sanitized_result).publicationPreparationV1).current)
 if(p.listing_package_id!==input.packageId || p.sku!==input.sku || p.offer_id!==input.offerId || revision.packageHash!==input.packageHash ||
  revision.packageGeneration!==input.packageGeneration || revision.previewHash!==input.previewHash || digest(p.preview)!==input.previewHash)
  throw Error('CURRENT_PUBLISH_REQUEST_BINDING_MISMATCH')
 // Replays are readback-only. No automatic rearm, second claim or POST.
 if(p.publication_idempotency_key || p.publish_attempt_count!==0 || p.phase!=='preview_ready') {
  return {pass:false,publicationWrites:0,blocker:'CURRENT_PUBLICATION_RECONCILIATION_REQUIRED',phase:p.phase}
 }
 // A real official prewrite read refreshes evidence, never the Preview clock,
 // package, non-LIVE approval, Offer or historical execution.
 await deps.refreshFees(input,revision)
 const certification=await deps.certify({supabase:db,actor:input.actor,accountKey:input.accountKey,packageId:input.packageId})
 if(!certification.pass) return {pass:false,publicationWrites:0,blocker:'CURRENT_PREPUBLICATION_FAILED',details:certification.preflight.blockers}
 const current=await deps.readCurrent({supabase:db,accountKey:input.accountKey,packageId:input.packageId,
  referenceItemId:String(record(revision.certifiedPackage).referenceItemId)})
 if(!current.publicationGate.READY_TO_PUBLISH || !current.publicationGate.EXECUTOR_CLAIMABLE)
  return {pass:false,publicationWrites:0,blocker:'CURRENT_EXECUTOR_NOT_CLAIMABLE',details:current.publicationGate.blockingEvidence}
 const collection=await deps.collection(input.offerId,input.sku)
 if(!collection.safe || collection.status!=='UNPUBLISHED' || collection.listingId)
  return {pass:false,publicationWrites:0,blocker:'CURRENT_OFFER_ALREADY_PUBLISHED_OR_AMBIGUOUS',collection}
 p=await read()
 const claimToken=randomUUID()
 const claim=await db.rpc('claim_ebay_authorized_listing_publication',{p_publication_id:p.id,p_actor_user_id:input.actor,
  p_idempotency_key:input.idempotencyKey,p_preview_hash:p.preview_hash,p_confirm_publish:input.confirmation,p_claim_token:claimToken})
  .abortSignal(AbortSignal.timeout(8000)).retry(false).single()
 // An ambiguous claim is not permission to publish. Leave it for readback.
 if(claim.error || !claim.data || record(claim.data).phase!=='publish_in_flight' || record(claim.data).claim_token!==claimToken)
  return {pass:false,publicationWrites:0,blocker:claim.error?.message??'CURRENT_CLAIM_NOT_OWNED'}
 const inventory=record(record(revision.preview).inventoryItemPayload),offer=record(record(revision.preview).offerPayload)
 let dispatched=0
 const singlePublishFetch:typeof fetch=async(resource,init)=>{
  const url=new URL(resource instanceof Request?resource.url:String(resource)),method=init?.method??'GET'
  if(!['GET','HEAD'].includes(method) && url.pathname!=='/identity/v1/oauth2/token') {
   if(method!=='POST' || url.pathname!==`/sell/inventory/v1/offer/${input.offerId}/publish` || dispatched!==0)
    throw Error('ONE_EXACT_PUBLICATION_WRITE_ONLY')
   dispatched++
  }
  return fetch(resource,init)
 }
 let result:Awaited<ReturnType<typeof publishEbayOfferOnce>>
 try {
  result=await deps.publish({offerId:input.offerId,expectedSku:input.sku,expectedInventoryItemPayload:inventory,
   expectedOfferPayload:offer,previewHash:p.preview_hash,publicationControlId:p.id,confirmPublish:input.confirmation,deferAmbiguousReadback:true},singlePublishFetch)
 } catch {
  if(dispatched===0) {
   const released=await db.rpc('release_current_publication_before_dispatch_v1',{p_publication_id:p.id,p_actor:input.actor,p_claim_token:claimToken})
    .abortSignal(AbortSignal.timeout(8000)).retry(false)
   const actual=await read()
   return {pass:false,publicationWrites:0,blocker:'CURRENT_PREWRITE_TRANSPORT_OR_GUARD_FAILURE',
    idempotencyPreserved:!actual.publication_idempotency_key,durableReleaseConfirmed:!released.error,phase:actual.phase}
  }
  result={ok:false,status:0,listingId:null,outcomeKnown:false,reconciled:false,publishRequestSent:true,blocker:'EBAY_PUBLISH_OUTCOME_UNKNOWN'}
 }
 if(!result.ok && !result.publishRequestSent && dispatched===0) {
  const released=await db.rpc('release_current_publication_before_dispatch_v1',{p_publication_id:p.id,p_actor:input.actor,p_claim_token:claimToken})
    .abortSignal(AbortSignal.timeout(8000)).retry(false)
  const actual=await read()
  return {pass:false,publicationWrites:0,result,blocker:result.blocker,idempotencyPreserved:!actual.publication_idempotency_key,
    durableReleaseConfirmed:!released.error,phase:actual.phase}
 }
 const writes=result.publishRequestSent?1:0
 if(!result.ok || !result.listingId) {
  const failed=await db.rpc('fail_ebay_authorized_listing_publication',{p_publication_id:p.id,p_actor_user_id:input.actor,p_claim_token:claimToken,
   p_http_status:result.status,p_error_code:result.blocker??'EBAY_PUBLISH_FAILED',p_outcome_unknown:!result.outcomeKnown,
   p_error_details:record(result.body)}).abortSignal(AbortSignal.timeout(8000)).retry(false)
  // UNKNOWN is recorded before this read. Never retry publishOffer here.
  const recovery=!result.outcomeKnown?await deps.offer(input.offerId,input.sku,offer):null
  if(!recovery?.safe || !recovery.listingId)return {pass:false,publicationWrites:writes,result,officialReadback:recovery,
    durableFailureRecorded:!failed.error,phase:(await read()).phase}
  return complete(recovery.listingId,result.status,true,writes)
 }
 return complete(result.listingId,result.status,result.reconciled,writes)

 async function complete(listingId:string,httpStatus:number,reconciled:boolean,writes:number):Promise<Record<string,unknown>> {
  const recorded=await db.rpc('record_ebay_authorized_listing_published',{p_publication_id:p.id,p_actor_user_id:input.actor,
   p_listing_id:listingId,p_http_status:httpStatus,p_reconciled:reconciled}).abortSignal(AbortSignal.timeout(8000)).retry(false).single()
  if(recorded.error)return {pass:false,publicationWrites:writes,listingId,blocker:'PUBLISH_RESULT_PERSISTENCE_READBACK_REQUIRED'}
  // No compensating marketplace write is hidden in registration failure.
  try {
   const inventory=record(record(revision.preview).inventoryItemPayload),offer=record(record(revision.preview).offerPayload)
   const inventoryReadback=await deps.inventory(input.sku,inventory)
   const offerReadback=await deps.offer(input.offerId,input.sku,offer)
   const collection=await deps.collection(input.offerId,input.sku)
   if(!inventoryReadback.safe || !offerReadback.safe || offerReadback.listingId!==listingId || !collection.safe || collection.listingId!==listingId)
    return {pass:false,publicationWrites:writes,listingId,blocker:'CURRENT_PUBLISHED_PAYLOAD_READBACK_MISMATCH',inventoryReadback,offerReadback,collection}
   const binding=record(record(record(recorded.data).sanitized_result).currentPublicationExecutionV1).binding
   const b=record(binding)
   const registration=await deps.register(db,{ebayItemId:listingId,ebayUrl:`https://www.ebay.com/itm/${listingId}`,
    opportunityId:String(b.opportunityId),candidateKey:String(b.candidateKey),supplierSku:String(b.supplierSku),supplierVariantId:String(b.variantId),safeDefaults:{}},input.actor,{automatedDeterministic:true})
   const v=registration.verification,snapshot=record(v.connectorListingSnapshot),policies=record(v.learnedSafeDefaults)
   const expectedPolicies=record(offer.listingPolicies),price=record(record(offer.pricingSummary).price)
   const matches={SKU_MATCH:v.connectorEbaySku===input.sku,OFFER_ID_MATCH:offerReadback.offerId===input.offerId,
    TITLE_MATCH:snapshot.title===record(inventory.product).title,PRICE_MATCH:Number(snapshot.price)===Number(price.value)&&snapshot.currency===price.currency,
    QUANTITY_MATCH:Number(snapshot.availableQuantity)===Number(offer.availableQuantity),CATEGORY_MATCH:policies.categoryId===offer.categoryId,
    POLICIES_MATCH:['paymentPolicyId','returnPolicyId','fulfillmentPolicyId'].every(k=>policies[k]===expectedPolicies[k])}
   if(v.status!=='verified' || v.connectorListingStatus!=='active' || Object.values(matches).some(x=>!x))
    return {pass:false,publicationWrites:writes,listingId,blocker:'CURRENT_ACTIVE_LISTING_READBACK_MISMATCH',matches,verification:v}
   const linked=await db.rpc('handoff_ebay_authorized_publication_luna_linkage_v1',{p_publication_id:p.id,p_expected_listing_id:listingId,
    p_active_listing_id:v.connectorListingId,p_manual_registration_id:record(registration.registration).id}).abortSignal(AbortSignal.timeout(8000)).retry(false)
   if(linked.error || record(linked.data).status!=='CERTIFIED')throw Error(linked.error?.message??'CURRENT_LUNA_LINKAGE_READBACK_REQUIRED')
   const beforeReceipt=await read(),sanitized=record(beforeReceipt.sanitized_result),execution=record(sanitized.currentPublicationExecutionV1)
   const officialReceipt={binding:execution.binding,listingId,observedAt:new Date().toISOString(),pass:true,matches,
    inventoryReadback,offerReadback,collection,verification:v}
   const receipt=await db.from('ebay_authorized_listing_publications').update({sanitized_result:{...sanitized,
    currentPublicationExecutionV1:{...execution,readback:officialReceipt}},updated_at:new Date().toISOString()})
    .eq('id',p.id).eq('updated_at',beforeReceipt.updated_at).eq('phase','published_pending_verification')
    .eq('listing_id',listingId).eq('draft_execution_id',p.draft_execution_id).select('id').abortSignal(AbortSignal.timeout(8000)).retry(false)
   const receiptRead=await read()
   if(digest(record(record(receiptRead.sanitized_result).currentPublicationExecutionV1).readback)!==digest(officialReceipt))
    throw Error(receipt.error?'CURRENT_OFFICIAL_RECEIPT_PERSISTENCE_UNCONFIRMED':'CURRENT_OFFICIAL_RECEIPT_CONCURRENT_CHANGE')
   const completed=await db.rpc('complete_ebay_authorized_listing_monitor_registration',{p_publication_id:p.id,p_actor_user_id:input.actor,
    p_listing_id:listingId,p_active_listing_id:v.connectorListingId,p_manual_registration_id:record(registration.registration).id}).abortSignal(AbortSignal.timeout(8000)).retry(false).single()
   const final=await read()
   if(completed.error || final.phase!=='monitor_registered' || final.listing_id!==listingId)throw Error('CURRENT_PUBLICATION_COMPLETION_READBACK_REQUIRED')
   return {pass:true,publicationWrites:writes,listingId,LISTING_STATUS:'ACTIVE',...matches,OFFICIAL_READBACK_PASS:true,
    PUBLISHED_CONFIRMED:true,DUPLICATE_LISTING_CREATED:false,FINAL_PUBLICATION_STATE:'PUBLISHED_CONFIRMED',durablePhase:final.phase,
    inventoryReadback,offerReadback,collection,verification:v,supplierLinkage:linked.data}
  } catch(error) {
   return {pass:false,publicationWrites:writes,listingId,blocker:error instanceof Error?error.message:'CURRENT_POST_PUBLISH_READBACK_REQUIRED',phase:(await read()).phase}
  }
 }
}
