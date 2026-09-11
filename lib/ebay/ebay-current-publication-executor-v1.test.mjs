import test from 'node:test'
import assert from 'node:assert/strict'
import {publishCurrentRevisionV1 as execute} from './ebay-current-publication-executor-v1.ts'
import {keywordWireDigestV1 as digest} from '../seller-os/keyword-intelligence-handoff-v1.ts'
function fixture(){
 const preview={inventoryItemPayload:{product:{title:'own'}},offerPayload:{sku:'sku'}},revision={packageHash:'ph',packageGeneration:'pg',previewHash:digest(preview),preview,certifiedPackage:{referenceItemId:'137290616476'}}
 const p={id:'pub',listing_package_id:'pkg',marketplace_account_key:'account',actor_user_id:'actor',sku:'sku',offer_id:'offer',phase:'preview_ready',publish_attempt_count:0,publication_idempotency_key:null,preview_hash:digest(preview).slice(7),preview,sanitized_result:{publicationPreparationV1:{current:revision}}}
 const events=[],db={from(){const query={};for(const k of ['select','eq','single','abortSignal','retry'])query[k]=()=>query;query.then=(yes,no)=>Promise.resolve({data:structuredClone(p),error:null}).then(yes,no);return query},rpc(name,args){
  const query={};for(const k of ['single','abortSignal','retry'])query[k]=()=>query;query.then=(yes,no)=>Promise.resolve().then(()=>{
   events.push(name)
   if(name==='claim_ebay_authorized_listing_publication'){
    if(p.publication_idempotency_key)return {data:{...p},error:null};p.phase='publish_in_flight';p.publication_idempotency_key=args.p_idempotency_key;p.publish_attempt_count=1;p.claim_token=args.p_claim_token;return {data:{...p},error:null}
   }
   if(name==='fail_ebay_authorized_listing_publication'){p.phase=args.p_outcome_unknown?'outcome_unknown':'terminal_failure';return {data:true,error:null}}
   return {data:null,error:{message:'test_stop'}}
  }).then(yes,no);return query}}
 const input={supabase:db,actor:'actor',accountKey:'account',publicationId:'pub',packageId:'pkg',offerId:'offer',sku:'sku',packageHash:'ph',packageGeneration:'pg',previewHash:revision.previewHash,idempotencyKey:'publish:pub',confirmation:'PUBLICAR LISTING EN EBAY'}
 let writes=0
 const deps={refreshFees:async()=>{},certify:async()=>({pass:true}),readCurrent:async()=>({publicationGate:{READY_TO_PUBLISH:true,EXECUTOR_CLAIMABLE:true}}),
 collection:async()=>({safe:true,status:'UNPUBLISHED',listingId:null}),publish:async()=>{writes++;events.push('publish');return {ok:false,outcomeKnown:true,publishRequestSent:true,status:400,blocker:'EBAY_PUBLISH_WRITE_REJECTED',body:{errors:[{errorId:25002,message:'Required aspect'}]}}},
 offer:async()=>{events.push('official_readback');return {safe:false,listingId:null}},inventory:async()=>({safe:true}),register:async()=>{throw Error('must not register rejected publish')}}
 return {input,deps,p,events,writes:()=>writes}
}
test('CURRENT request mismatching immutable preview cannot claim or publish',async()=>{const f=fixture();f.input.previewHash='wrong';await assert.rejects(execute(f.input,f.deps),/BINDING_MISMATCH/);assert.equal(f.writes(),0);assert.equal(f.p.publication_idempotency_key,null)})
test('Internal gate blocker preserves unconsumed idempotency',async()=>{const f=fixture();f.deps.readCurrent=async()=>({publicationGate:{READY_TO_PUBLISH:false,EXECUTOR_CLAIMABLE:false,blockingEvidence:['CURRENT_BINDING']}});const r=await execute(f.input,f.deps);assert.equal(r.publicationWrites,0);assert.equal(f.p.publication_idempotency_key,null)})
test('Concurrent same intent has exactly one owner of claim and one publish',async()=>{const f=fixture();const results=await Promise.all([execute(f.input,f.deps),execute(f.input,f.deps)]);assert.equal(f.writes(),1);assert.equal(results.reduce((n,r)=>n+r.publicationWrites,0),1);assert.equal(f.p.publish_attempt_count,1)})
test('Explicit eBay rejection is recorded, structured and never blindly retried',async()=>{const f=fixture();const r=await execute(f.input,f.deps);assert.equal(r.result.body.errors[0].errorId,25002);assert.equal(f.p.phase,'terminal_failure');assert.equal(f.writes(),1);await execute(f.input,f.deps);assert.equal(f.writes(),1)})
test('Ambiguous publish records UNKNOWN before official readback and never retries',async()=>{const f=fixture();f.deps.publish=async()=>{f.events.push('publish');return {ok:false,outcomeKnown:false,publishRequestSent:true,status:0,blocker:'EBAY_PUBLISH_OUTCOME_UNKNOWN'}};const r=await execute(f.input,f.deps);assert.equal(r.phase,'outcome_unknown');assert.deepEqual(f.events,['claim_ebay_authorized_listing_publication','publish','fail_ebay_authorized_listing_publication','official_readback']);await execute(f.input,f.deps);assert.equal(f.events.filter(x=>x==='publish').length,1)})
test('Another Offer or existing published collection cannot consume the key',async()=>{const f=fixture();f.deps.collection=async()=>({safe:false,status:'PUBLISHED'});const r=await execute(f.input,f.deps);assert.equal(r.publicationWrites,0);assert.equal(f.p.publication_idempotency_key,null)})
