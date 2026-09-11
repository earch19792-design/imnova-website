import test from 'node:test'
import assert from 'node:assert/strict'
import {currentPublicationExecutionContractV1 as evaluate,applyCurrentExecutionParityV1 as parity} from './current-publication-execution-contract-v1.ts'
import {keywordWireDigestV1 as digest} from './keyword-intelligence-handoff-v1.ts'
import fs from 'node:fs'
const now=new Date('2026-09-11T15:00:00Z')
function fixture(){
 const binding={ACCOUNT_KEY:'account',PRODUCT_ID:'9220846944480',VARIANT_ID:'53002139173088',SKU:'supplier',OPPORTUNITY_ID:'op',CANDIDATE_KEY:'candidate'}
 const snapshot={binding,generation:'generation',content:{title:'Own product'}},preview={sku:'IMNOVA24535B3703354984A36CDBB73A7560DA'}
 const revision={publicationId:'pub',packageId:'pkg',accountKey:'account',packageHash:digest(snapshot),packageGeneration:'generation',previewHash:digest(preview),snapshot,preview,createdAt:'2026-01-01T00:00:00Z'}
 const b={publicationId:'pub',packageId:'pkg',accountKey:'account',packageHash:revision.packageHash,packageGeneration:'generation',previewHash:revision.previewHash,previewGeneration:'generation',productId:binding.PRODUCT_ID,variantId:binding.VARIANT_ID,supplierSku:'supplier',sku:preview.sku,opportunityId:'op',candidateKey:'candidate',canonicalLunaUrl:'https://lunaportex.com/products/own-product'}
 return {authority:{version:'CURRENT_PUBLICATION_EXECUTION_CONTRACT_V1',valid:true,unclaimed:true,binding:b,blockers:[]},revision,
  inventory:{inventoryReady:true,availability:'IN_STOCK',freshness:'FRESH',observedAt:'2026-09-11T14:50:00Z',freshUntil:'2026-09-11T16:00:00Z'},economicsReady:true,materialReady:true,prepublicationValid:true,now}
}
test('Old Preview with unchanged CURRENT content and fresh evidence is executable without legacy approval',()=>{
 const input=fixture(),result=evaluate(input);assert.equal(result.EXECUTOR_CLAIMABLE,true);assert.equal(result.CURRENT_EXECUTION_CONTRACT_VALID,true)
 assert.equal(result.stockguard.attachmentIntent.components[0].safeCapacity,null)
 assert.equal(parity({READY_TO_PUBLISH:true,blockingEvidence:[]},result).READY_TO_PUBLISH,true)
})
for(const key of ['publicationId','packageId','accountKey','packageHash','packageGeneration','previewHash','previewGeneration','productId','variantId','supplierSku','sku','opportunityId','candidateKey'])test(`Different CURRENT ${key} cannot claim`,()=>{
 const i=fixture();i.authority.binding[key]='historical';const r=evaluate(i);assert.equal(r.EXECUTOR_CLAIMABLE,false);assert.equal(parity({READY_TO_PUBLISH:true,blockingEvidence:[]},r).READY_TO_PUBLISH,false)
})
test('Changed package or Preview content cannot reuse old hashes',()=>{
 for(const field of ['snapshot','preview']){const i=fixture();i.revision[field].newMaterialValue='changed';assert.equal(evaluate(i).EXECUTOR_CLAIMABLE,false)}
})
test('Historical execution/approval rejection from shared durable reader blocks readiness',()=>{
 const i=fixture();i.authority.valid=false;i.authority.blockers=['CURRENT_EXECUTION_HISTORICAL_OR_PAYLOAD_MISMATCH'];assert.equal(parity({READY_TO_PUBLISH:true,blockingEvidence:[]},evaluate(i)).READY_TO_PUBLISH,false)
})
test('OOS, stale and unknown inventory fail closed without numeric supplier stock',()=>{
 for(const patch of [{availability:'OUT_OF_STOCK'},{freshness:'STALE'},{inventoryReady:false},{freshUntil:'2026-09-11T14:00:00Z'}]){const i=fixture();Object.assign(i.inventory,patch);assert.equal(evaluate(i).EXECUTOR_CLAIMABLE,false)}
})
test('Claimed/concurrent intent can never remain READY',()=>{const i=fixture();i.authority.unclaimed=false;assert.equal(parity({READY_TO_PUBLISH:true,blockingEvidence:[]},evaluate(i)).READY_TO_PUBLISH,false)})
test('Operational evidence remains required; Preview age is not evidence age',()=>{const i=fixture();i.prepublicationValid=false;assert.equal(evaluate(i).EXECUTOR_CLAIMABLE,false)})
test('Known material blocker and unproven economics are shared by gate and executor',()=>{for(const key of ['economicsReady','materialReady']){const i=fixture();i[key]=false;const r=evaluate(i);assert.equal(r.EXECUTOR_CLAIMABLE,false);assert.equal(parity({READY_TO_PUBLISH:true,blockingEvidence:[]},r).READY_TO_PUBLISH,false)}})
test('Atomic SQL claim preserves lock, idempotency, single attempt and CURRENT binding',()=>{
 const sql=fs.readFileSync(new URL('../../supabase/migrations/20260911141155_current_publication_executor_parity_v1.sql',import.meta.url),'utf8')
 const claim=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.claim_'),sql.indexOf('CREATE OR REPLACE FUNCTION public.handoff_'))
 for(const value of ['for update','publication_idempotency_key is not null','publish_attempt_count <> 0','publish_attempt_count = 1','CURRENT_EXECUTOR_NOT_CLAIMABLE','executionReadiness,validUntil','read_current_publication_execution_contract_v1'])assert.ok(claim.includes(value),value)
 assert.ok(claim.indexOf('return next v_publication')<claim.indexOf("set phase = 'publish_in_flight'"))
 assert.match(claim,/elsif v_publication.preview_prepared_at/)
})
test('CURRENT executor never creates Offer or rewrites Preview; one publish call and unknown readback only',()=>{
 const code=fs.readFileSync(new URL('../ebay/ebay-current-publication-executor-v1.ts',import.meta.url),'utf8')
 assert.equal((code.match(/await deps.publish\(/g)||[]).length,1)
 assert.ok(code.indexOf('claim_ebay_authorized_listing_publication')<code.indexOf('await deps.publish'))
 assert.ok(code.indexOf('fail_ebay_authorized_listing_publication')<code.indexOf('const recovery='))
 for(const forbidden of ['createOffer(', 'updateOffer(', 'compensateFinalPublicationAttachmentFailure(', 'prepare_ebay_authorized_listing_publication','preview_prepared_at:'])assert.equal(code.includes(forbidden),false)
})
