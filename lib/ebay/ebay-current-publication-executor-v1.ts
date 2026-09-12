import {createHash,randomUUID} from 'node:crypto'
import type {SupabaseClient} from '@supabase/supabase-js'

type JsonRecord=Record<string,unknown>
const record=(value:unknown):JsonRecord=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:{}
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'
 ?Object.fromEntries(Object.entries(value as JsonRecord).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,ordered(v)])):value
const digest=(value:unknown)=>`sha256:${createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex')}`
const CURRENT_FINAL_PUBLISH_CONFIRMATION='PUBLICAR LISTING EN EBAY'
function exactSingleOfferReadback(collection:JsonRecord,input:CurrentPublicationExecutorInputV1,listingId:string){
 return collection.safe===true && Number(collection.offerCount)===1
  && collection.offerId===input.offerId && collection.sku===input.sku
  && collection.status==='PUBLISHED' && collection.listingId===listingId
}
export type CurrentPublicationExecutorInputV1={supabase:SupabaseClient;actor:string;accountKey:string;publicationId:string;packageId:string;offerId:string;
 sku:string;packageHash:string;packageGeneration:string;previewHash:string;idempotencyKey:string;confirmation:string}
const columns='id,actor_user_id,listing_package_id,opportunity_id,marketplace_account_key,account_fingerprint,sku,offer_id,phase,publish_attempt_count,publication_idempotency_key,claim_token,listing_id,preview,preview_hash,draft_execution_id,draft_approval_id,sanitized_result,updated_at'

export type CurrentPublicationExecutorDependenciesV1={
 refreshFees:(input:CurrentPublicationExecutorInputV1,revision:JsonRecord)=>Promise<unknown>
 certify:(input:any)=>Promise<any>;readCurrent:(input:any)=>Promise<any>
 publish:(input:any,fetchImpl?:typeof fetch)=>Promise<any>
 inventory:(sku:string,payload:JsonRecord)=>Promise<any>
 offer:(offerId:string,sku:string,payload:JsonRecord)=>Promise<any>
 collection:(offerId:string,sku:string)=>Promise<any>
 register:(db:SupabaseClient,input:any,actor:string,options:any)=>Promise<any>
}
export async function publishCurrentRevisionV1(input:CurrentPublicationExecutorInputV1,deps:CurrentPublicationExecutorDependenciesV1) {
 const db=input.supabase
 if(input.confirmation!==CURRENT_FINAL_PUBLISH_CONFIRMATION || input.idempotencyKey!==`publish:${input.publicationId}`)throw Error('CURRENT_PUBLISH_EXPLICIT_AUTHORIZATION_REQUIRED')
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
 // A completed replay is resolved exclusively by the official Inventory API
 // and the immutable durable receipt. It never rearms, claims or POSTs.
 if(p.phase==='monitor_registered') {
  const expectedInventory=record(record(revision.preview).inventoryItemPayload)
  const expectedOffer=record(record(revision.preview).offerPayload)
  const [inventoryReadback,offerReadback,collection]=await Promise.all([
   deps.inventory(input.sku,expectedInventory),
   deps.offer(input.offerId,input.sku,expectedOffer),
   deps.collection(input.offerId,input.sku),
  ])
  const execution=record(record(p.sanitized_result).currentPublicationExecutionV1)
  const durableReceipt=record(execution.readback),matches=record(durableReceipt.matches)
  const listingId=String(p.listing_id??'')
  const exactSingleOffer=exactSingleOfferReadback(record(collection),input,listingId)
  const exact=Boolean(listingId && p.publication_idempotency_key===input.idempotencyKey
   && p.publish_attempt_count===1 && durableReceipt.pass===true
   && durableReceipt.listingId===listingId && inventoryReadback.safe
   && offerReadback.safe && offerReadback.listingId===listingId
   && exactSingleOffer
   && ['SKU_MATCH','OFFER_ID_MATCH','TITLE_MATCH','PRICE_MATCH',
    'QUANTITY_MATCH','CATEGORY_MATCH','POLICIES_MATCH'].every(k=>matches[k]===true))
  return exact?{pass:true,publicationWrites:0,ADDITIONAL_PUBLICATION_WRITE_COUNT:0,
   listingId,LISTING_STATUS:'ACTIVE',...matches,OFFICIAL_READBACK_PASS:true,
   PUBLISHED_CONFIRMED:true,DUPLICATE_LISTING_CREATED:false,
   DUPLICATE_OFFER_CREATED:false,
   SECOND_LISTING_CREATED:false,IDEMPOTENT_REPLAY_CONFIRMED:true,
   FINAL_PUBLICATION_STATE:'PUBLISHED_CONFIRMED',durablePhase:p.phase,
   inventoryReadback,offerReadback,collection,durableReceipt}
  :{pass:false,publicationWrites:0,blocker:'CURRENT_COMPLETED_REPLAY_READBACK_MISMATCH',
   phase:p.phase,inventoryReadback,offerReadback,collection,durableReceipt}
 }
 // A process interruption after dispatch is reconciled GET-only. A positive
 // official Offer readback continues durable registration; an absent or
 // ambiguous readback never becomes permission for another publish.
 if(['publish_in_flight','outcome_unknown','published_pending_verification'].includes(String(p.phase))) {
  const expectedOffer=record(record(revision.preview).offerPayload)
  const official=await deps.offer(input.offerId,input.sku,expectedOffer)
  if(official?.safe && official.listingId) {
   return complete(String(official.listingId),200,true,0)
  }
  return {pass:false,publicationWrites:0,
   blocker:'UNKNOWN_COMMIT_STATE_OFFICIAL_READBACK_NOT_PUBLISHED_UNPROVEN',
   phase:p.phase,officialReadback:official,blindRetryAllowed:false}
 }
 // Every other consumed key is fail-closed. UNKNOWN is read back by the first
 // attempt below and no path here can issue a blind retry.
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
 let result:any
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
   const exactSingleOffer=exactSingleOfferReadback(record(collection),input,listingId)
   if(!inventoryReadback.safe || !offerReadback.safe || offerReadback.listingId!==listingId || !exactSingleOffer)
    return {pass:false,publicationWrites:writes,listingId,blocker:'CURRENT_PUBLISHED_PAYLOAD_READBACK_MISMATCH',inventoryReadback,offerReadback,collection}
   const binding=record(record(record(recorded.data).sanitized_result).currentPublicationExecutionV1).binding
   const b=record(binding)
   const handoffBase=await read(),handoffMetadata=record(handoffBase.sanitized_result)
   const handoffExecution=record(handoffMetadata.currentPublicationExecutionV1)
   const handoffAttempt=await db.from('ebay_authorized_listing_publications').update({sanitized_result:{...handoffMetadata,
    currentPublicationExecutionV1:{...handoffExecution,supplierLinkageHandoffAttempted:true}},updated_at:new Date().toISOString()})
    .eq('id',p.id).eq('updated_at',handoffBase.updated_at).eq('listing_id',listingId)
    .eq('phase','published_pending_verification').select('id').abortSignal(AbortSignal.timeout(8000)).retry(false)
   if(handoffAttempt.error || record(record((await read()).sanitized_result).currentPublicationExecutionV1).supplierLinkageHandoffAttempted!==true)
    throw Error('CURRENT_SUPPLIER_HANDOFF_ATTEMPT_READBACK_REQUIRED')
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
    currentPublicationExecutionV1:{...execution,readback:officialReceipt,supplierLinkage:'CERTIFIED',stockGuardMonitored:true}},updated_at:new Date().toISOString()})
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
    PUBLISHED_CONFIRMED:true,DUPLICATE_LISTING_CREATED:false,DUPLICATE_OFFER_CREATED:false,
    FINAL_PUBLICATION_STATE:'PUBLISHED_CONFIRMED',durablePhase:final.phase,
    inventoryReadback,offerReadback,collection,verification:v,supplierLinkage:linked.data}
  } catch(error) {
   return {pass:false,publicationWrites:writes,listingId,blocker:error instanceof Error?error.message:'CURRENT_POST_PUBLISH_READBACK_REQUIRED',phase:(await read()).phase}
  }
 }
}
