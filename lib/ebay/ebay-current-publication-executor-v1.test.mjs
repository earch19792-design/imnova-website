import test from 'node:test'
import assert from 'node:assert/strict'
import {publishCurrentRevisionV1 as execute} from './ebay-current-publication-executor-v1.ts'
import {keywordWireDigestV1 as digest} from '../seller-os/keyword-intelligence-handoff-v1.ts'
function fixture(){
 const preview={inventoryItemPayload:{product:{title:'own'}},offerPayload:{sku:'sku',categoryId:'261987',availableQuantity:1,pricingSummary:{price:{value:'17.77',currency:'USD'}},listingPolicies:{paymentPolicyId:'p',returnPolicyId:'r',fulfillmentPolicyId:'f'}}},revision={packageHash:'ph',packageGeneration:'pg',previewHash:digest(preview),preview,certifiedPackage:{referenceItemId:'137290616476'}}
 const p={id:'pub',listing_package_id:'pkg',marketplace_account_key:'account',actor_user_id:'actor',sku:'sku',offer_id:'offer',phase:'preview_ready',publish_attempt_count:0,publication_idempotency_key:null,preview_hash:digest(preview).slice(7),preview,sanitized_result:{publicationPreparationV1:{current:revision}}}
 const events=[],db={from(){const query={};query.update=v=>{Object.assign(p,v);return query};for(const k of ['select','eq','single','abortSignal','retry'])query[k]=()=>query;query.then=(yes,no)=>Promise.resolve({data:structuredClone(p),error:null}).then(yes,no);return query},rpc(name,args){
  const query={};for(const k of ['single','abortSignal','retry'])query[k]=()=>query;query.then=(yes,no)=>Promise.resolve().then(()=>{
   events.push(name)
   if(name==='claim_ebay_authorized_listing_publication'){
    if(p.publication_idempotency_key)return {data:{...p},error:null};p.phase='publish_in_flight';p.publication_idempotency_key=args.p_idempotency_key;p.publish_attempt_count=1;p.claim_token=args.p_claim_token;p.sanitized_result.currentPublicationExecutionV1={binding:{opportunityId:'op',candidateKey:'candidate',supplierSku:'supplier',variantId:'variant'}};return {data:{...p},error:null}
   }
   if(name==='fail_ebay_authorized_listing_publication'){p.phase=args.p_outcome_unknown?'outcome_unknown':'terminal_failure';return {data:true,error:null}}
   if(name==='release_current_publication_before_dispatch_v1'){p.phase='preview_ready';p.publication_idempotency_key=null;p.publish_attempt_count=0;p.claim_token=null;return {data:true,error:null}}
   if(name==='record_ebay_authorized_listing_published'){p.phase='published_pending_verification';p.listing_id=args.p_listing_id;return {data:structuredClone(p),error:null}}
   if(name==='handoff_ebay_authorized_publication_luna_linkage_v1')return {data:{status:'CERTIFIED'},error:null}
   if(name==='complete_ebay_authorized_listing_monitor_registration'){p.phase='monitor_registered';return {data:structuredClone(p),error:null}}
   return {data:null,error:{message:'test_stop'}}
  }).then(yes,no);return query}}
 const input={supabase:db,actor:'actor',accountKey:'account',publicationId:'pub',packageId:'pkg',offerId:'offer',sku:'sku',packageHash:'ph',packageGeneration:'pg',previewHash:revision.previewHash,idempotencyKey:'publish:pub',confirmation:'PUBLICAR LISTING EN EBAY'}
 let writes=0
 const deps={refreshFees:async()=>{},certify:async()=>({pass:true}),readCurrent:async()=>({publicationGate:{READY_TO_PUBLISH:true,EXECUTOR_CLAIMABLE:true}}),
 collection:async()=>({safe:true,status:'UNPUBLISHED',listingId:null,offerCount:1,offerId:'offer',sku:'sku'}),publish:async()=>{writes++;events.push('publish');return {ok:false,outcomeKnown:true,publishRequestSent:true,status:400,blocker:'EBAY_PUBLISH_WRITE_REJECTED',body:{errors:[{errorId:25002,message:'Required aspect'}]}}},
 offer:async()=>{events.push('official_readback');return {safe:false,listingId:null}},inventory:async()=>({safe:true}),register:async()=>{throw Error('must not register rejected publish')}}
 return {input,deps,p,events,writes:()=>writes}
}
test('CURRENT request mismatching immutable preview cannot claim or publish',async()=>{const f=fixture();f.input.previewHash='wrong';await assert.rejects(execute(f.input,f.deps),/BINDING_MISMATCH/);assert.equal(f.writes(),0);assert.equal(f.p.publication_idempotency_key,null)})
test('Internal gate blocker preserves unconsumed idempotency',async()=>{const f=fixture();f.deps.readCurrent=async()=>({publicationGate:{READY_TO_PUBLISH:false,EXECUTOR_CLAIMABLE:false,blockingEvidence:['CURRENT_BINDING']}});const r=await execute(f.input,f.deps);assert.equal(r.publicationWrites,0);assert.equal(f.p.publication_idempotency_key,null)})
test('Concurrent same intent has exactly one owner of claim and one publish',async()=>{const f=fixture();const results=await Promise.all([execute(f.input,f.deps),execute(f.input,f.deps)]);assert.equal(f.writes(),1);assert.equal(results.reduce((n,r)=>n+r.publicationWrites,0),1);assert.equal(f.p.publish_attempt_count,1)})
test('Explicit eBay rejection is recorded, structured and never blindly retried',async()=>{const f=fixture();const r=await execute(f.input,f.deps);assert.equal(r.result.body.errors[0].errorId,25002);assert.equal(f.p.phase,'terminal_failure');assert.equal(f.writes(),1);await execute(f.input,f.deps);assert.equal(f.writes(),1)})
test('Ambiguous publish records UNKNOWN before official readback and never retries',async()=>{const f=fixture();f.deps.publish=async()=>{f.events.push('publish');return {ok:false,outcomeKnown:false,publishRequestSent:true,status:0,blocker:'EBAY_PUBLISH_OUTCOME_UNKNOWN'}};const r=await execute(f.input,f.deps);assert.equal(r.phase,'outcome_unknown');assert.deepEqual(f.events,['claim_ebay_authorized_listing_publication','publish','fail_ebay_authorized_listing_publication','official_readback']);await execute(f.input,f.deps);assert.equal(f.events.filter(x=>x==='publish').length,1)})
test('Another Offer or existing published collection cannot consume the key',async()=>{const f=fixture();f.deps.collection=async()=>({safe:false,status:'PUBLISHED'});const r=await execute(f.input,f.deps);assert.equal(r.publicationWrites,0);assert.equal(f.p.publication_idempotency_key,null)})

test('Successful one-shot publish requires full active readback before durable confirmation',async()=>{
 const f=fixture(),id='366000000001'
 f.deps.publish=async args=>{assert.equal(args.deferAmbiguousReadback,true);f.events.push('publish');return {ok:true,outcomeKnown:true,publishRequestSent:true,status:200,listingId:id,reconciled:false}}
 f.deps.collection=async()=>({safe:true,status:f.p.listing_id?'PUBLISHED':'UNPUBLISHED',listingId:f.p.listing_id??null,offerCount:1,offerId:'offer',sku:'sku'})
 f.deps.offer=async()=>({safe:true,offerId:'offer',listingId:id})
 f.deps.register=async(_db,args)=>{assert.equal(f.p.sanitized_result.currentPublicationExecutionV1.supplierLinkageHandoffAttempted,true);assert.equal(args.supplierSku,'supplier');assert.equal(args.supplierVariantId,'variant');return ({registration:{id:'registration'},verification:{status:'verified',connectorListingStatus:'active',connectorListingId:'active',connectorEbaySku:'sku',
  connectorListingSnapshot:{title:'own',price:17.77,currency:'USD',availableQuantity:1},learnedSafeDefaults:{categoryId:'261987',paymentPolicyId:'p',returnPolicyId:'r',fulfillmentPolicyId:'f'}}})}
 const r=await execute(f.input,f.deps);assert.equal(r.pass,true);assert.equal(r.PUBLICATION_WRITE_COUNT??r.publicationWrites,1);assert.equal(r.OFFICIAL_READBACK_PASS,true);assert.equal(r.DUPLICATE_OFFER_CREATED,false)
 assert.equal(f.p.phase,'monitor_registered');assert.equal(f.p.sanitized_result.currentPublicationExecutionV1.readback.pass,true)
 assert.equal(f.p.sanitized_result.currentPublicationExecutionV1.supplierLinkage,'CERTIFIED');assert.equal(f.p.sanitized_result.currentPublicationExecutionV1.stockGuardMonitored,true)
 assert.equal(f.events.filter(x=>x==='publish').length,1)
 const replay=await execute(f.input,f.deps);assert.equal(f.events.filter(x=>x==='publish').length,1)
 assert.equal(replay.publicationWrites,0);assert.equal(replay.ADDITIONAL_PUBLICATION_WRITE_COUNT,0)
 assert.equal(replay.DUPLICATE_OFFER_CREATED,false);assert.equal(replay.IDEMPOTENT_REPLAY_CONFIRMED,true)
})
test('Multiple official Offers cannot certify DUPLICATE_OFFER_CREATED false',async()=>{
 const f=fixture(),id='366000000002'
 f.deps.publish=async()=>({ok:true,outcomeKnown:true,publishRequestSent:true,status:200,listingId:id,reconciled:false})
 f.deps.offer=async()=>({safe:true,offerId:'offer',listingId:id})
 f.deps.collection=async()=>f.p.listing_id
  ?({safe:false,status:null,listingId:null,offerCount:2,offerId:null,sku:null})
  :({safe:true,status:'UNPUBLISHED',listingId:null,offerCount:1,offerId:'offer',sku:'sku'})
 const r=await execute(f.input,f.deps)
 assert.equal(r.pass,false);assert.equal(r.blocker,'CURRENT_PUBLISHED_PAYLOAD_READBACK_MISMATCH')
 assert.equal(r.DUPLICATE_OFFER_CREATED,undefined);assert.equal(r.publicationWrites,1)
})
test('Ambiguous official Offer collection fails closed',async()=>{
 const f=fixture(),id='366000000003'
 f.deps.publish=async()=>({ok:true,outcomeKnown:true,publishRequestSent:true,status:200,listingId:id,reconciled:false})
 f.deps.offer=async()=>({safe:true,offerId:'offer',listingId:id})
 f.deps.collection=async()=>f.p.listing_id
  ?({safe:false,status:null,listingId:null,offerCount:null,offerId:null,sku:null,blocker:'CURRENT_OFFER_COLLECTION_AMBIGUOUS'})
  :({safe:true,status:'UNPUBLISHED',listingId:null,offerCount:1,offerId:'offer',sku:'sku'})
 const r=await execute(f.input,f.deps)
 assert.equal(r.pass,false);assert.equal(r.DUPLICATE_OFFER_CREATED,undefined)
 assert.equal(r.publicationWrites,1)
})
test('ACK with mismatched official payload never confirms published',async()=>{
 const f=fixture();f.deps.publish=async()=>({ok:true,publishRequestSent:true,listingId:'366000000001',status:200,outcomeKnown:true,reconciled:false})
 f.deps.inventory=async()=>({safe:false});const r=await execute(f.input,f.deps);assert.equal(r.pass,false);assert.equal(r.blocker,'CURRENT_PUBLISHED_PAYLOAD_READBACK_MISMATCH');assert.equal(f.p.phase,'published_pending_verification')
})

test('Pre-dispatch exception preserves idempotency with zero marketplace writes',async()=>{const f=fixture();f.deps.publish=async()=>{throw Error('transport')};const r=await execute(f.input,f.deps);assert.equal(r.publicationWrites,0);assert.equal(f.p.publication_idempotency_key,null);assert.equal(f.p.phase,'preview_ready')})
test('Thrown connection loss after dispatch is UNKNOWN, never released as zero-write',async()=>{
 const f=fixture(),original=globalThis.fetch
 globalThis.fetch=async()=>{throw Error('connection lost')}
 try {
  f.deps.publish=async(args,transport)=>transport('https://api.ebay.com/sell/inventory/v1/offer/offer/publish',{method:'POST'})
  const r=await execute(f.input,f.deps);assert.equal(r.publicationWrites,1);assert.equal(f.p.phase,'outcome_unknown');assert.equal(f.p.publication_idempotency_key,'publish:pub');assert.ok(f.events.includes('official_readback'))
 }finally{globalThis.fetch=original}
})
