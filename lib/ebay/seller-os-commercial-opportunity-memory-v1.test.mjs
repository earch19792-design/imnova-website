import assert from 'node:assert/strict'
import test from 'node:test'

import {goldenDigest} from './commercial-golden-path-domain-v1.ts'
import {GOLDEN_RECEIPT_SAFE_JSON_BOUNDARY_BYTES_V1,
  GoldenReceiptPersistenceErrorV1,writeGoldenReceiptV1} from
  './commercial-golden-path-runtime-v1.ts'
import {buildSellerOsCommercialOpportunityMemoryV1,
  persistSellerOsCommercialOpportunityMemoryV1,
  projectGoldenEvaluationReceiptV1,
  resolveSellerOsNextBestEvidenceV1} from
  './seller-os-commercial-opportunity-memory-v1.ts'

const now=new Date('2026-10-05T20:00:00Z')
const future='2026-10-06T20:00:00Z'
const receiptId='10000000-0000-4000-8000-000000000001'
const evaluation=()=>({
  candidate:{productId:'9220861100256',variantId:'53002125082848',supplierSku:'FL-EAGLE-RING',supplierQuantity:1},
  sourceIdentity:{title:'Fixture Eagle Ring'},evidenceDigest:goldenDigest('full-evaluation'),decision:'GO',reasonCodes:[],
  productTruth:{status:'CORE_PROVEN',receiptId:goldenDigest('truth')},
  market:{status:'AVAILABLE',soldQuantity:4,realizedBuyerLandedPrice:20,exactSold:[],closeSold:[],familyEvidence:[],rejectedComparables:[],activeCompetition:[]},
  shipping:{status:'PROVEN',receiptId:'shipping-1',observedAt:now.toISOString(),freshUntil:future},
  fulfillment:{status:'PROVEN',receiptId:'fulfillment-1',observedAt:now.toISOString(),freshUntil:future},
  economics:{status:'PROVEN',targetNetProfit:4,expectedNetProfit:7.25,feeAuthority:{status:'PROVEN',receiptId:'fee-1',observedAt:now.toISOString(),freshUntil:future}},
  duplicateGate:{status:'PASS',receiptId:'duplicate-1',observedAt:now.toISOString(),freshUntil:future},
  compliance:{status:'PROVEN',receiptId:'compliance-1',observedAt:now.toISOString(),freshUntil:future,blockers:[],category:{id:'123',name:'Rings',receipt:{contractVersion:'CATEGORY',taxonomy:'x'.repeat(1_100_000)}},taxonomy:{status:'AVAILABLE',source:'EBAY_TAXONOMY_OFFICIAL_READONLY',categoryId:'123',categoryName:'Rings',taxonomyMarketplaceId:'EBAY_US',categoryResolution:'KNOWN_CATEGORY',categoryTreeId:'0',categoryTreeVersion:'1',observedAt:now.toISOString(),freshUntil:future,aspects:Array.from({length:100},(_,index)=>({name:`Aspect ${index}`,required:index<5,payload:'x'.repeat(15_000)}))},identifierPreflight:{status:'AVAILABLE',safe:true,payload:'x'.repeat(100_000)}},
  durableReceipt:{receiptId,evidenceDigest:goldenDigest('durable'),createdAt:now.toISOString(),readback:'PASS'},
})

function receiptContext(supabase){return {supabase,accountKey:'SYNTHETIC-ACCOUNT',principal:{ownerUserId:'10000000-0000-4000-8000-000000000002',commandClientId:'synthetic-client'},invocationSource:'SERVICE_CERTIFICATION_DIAGNOSTIC',now}}

test('oversized official taxonomy becomes a bounded decision-complete EVALUATION receipt',()=>{
  const original=evaluation()
  assert.ok(Buffer.byteLength(JSON.stringify(original))>2_000_000)
  const projected=projectGoldenEvaluationReceiptV1(original)
  assert.ok(Buffer.byteLength(JSON.stringify(projected))<GOLDEN_RECEIPT_SAFE_JSON_BOUNDARY_BYTES_V1)
  assert.equal(projected.decision,'GO')
  assert.equal(projected.economics.expectedNetProfit,7.25)
  assert.equal(projected.compliance.taxonomy.fullAuthorityDigest,
    goldenDigest(original.compliance.taxonomy))
  assert.equal(projected.compliance.category.receipt.fullAuthorityDigest,
    goldenDigest(original.compliance.category.receipt))
  assert.equal(projected.receiptProjection.sourceEvaluationEvidenceDigest,
    original.evidenceDigest)
})

test('receipt boundary fails closed before any database call and projected replay readback passes',async()=>{
  let calls=0,stored=null
  const query={upsert:async row=>{calls++;stored={...row,created_at:now.toISOString()};return {error:null}},select(){return query},eq(){return query},limit(){return query},maybeSingle:async()=>({data:stored,error:null})}
  const ctx=receiptContext({from(){return query}})
  await assert.rejects(writeGoldenReceiptV1(ctx,'EVALUATION',{payload:'x'.repeat(1_900_000)}),error=>{
    assert.ok(error instanceof GoldenReceiptPersistenceErrorV1)
    assert.equal(error.diagnostic.operation,'BOUNDARY')
    assert.equal(error.diagnostic.boundaryReason,'GOLDEN_PATH_RECEIPT_PAYLOAD_BOUND_EXCEEDED')
    return true
  })
  assert.equal(calls,0)
  const result=await writeGoldenReceiptV1(ctx,'EVALUATION',
    projectGoldenEvaluationReceiptV1(evaluation()))
  assert.equal(result.durableReceipt.readback,'PASS')
  assert.equal(calls,1)
})

test('resolver returns exactly one earliest missing authority and preserves unavailable as unknown',()=>{
  const ready=evaluation()
  assert.equal(resolveSellerOsNextBestEvidenceV1(ready,now).action,
    'PREPARE_LISTING_PACKAGE')
  const unavailable=evaluation()
  Object.assign(unavailable.market,{status:'UNAVAILABLE',soldQuantity:null,realizedBuyerLandedPrice:null})
  const wait=resolveSellerOsNextBestEvidenceV1(unavailable,now)
  assert.equal(wait.action,'WAIT_UPSTREAM')
  const unavailableMemory=buildSellerOsCommercialOpportunityMemoryV1(unavailable,now)
  assert.equal(unavailableMemory.demand.status,'UNAVAILABLE')
  assert.equal(unavailableMemory.demand.soldQuantity,null)
  assert.equal(unavailableMemory.demand.realizedBuyerLandedPrice,null)
  assert.equal(unavailableMemory.nextBestEvidence.priority,1)
  const product=evaluation();product.productTruth.status='UNPROVEN'
  assert.equal(resolveSellerOsNextBestEvidenceV1(product,now).action,
    'VERIFY_PRODUCT_FIT')
  const stale=evaluation();stale.shipping.freshUntil=now.toISOString()
  assert.equal(resolveSellerOsNextBestEvidenceV1(stale,now).action,
    'CAPTURE_QTY1_SHIPPING')
  const fee=evaluation();fee.economics.feeAuthority.status='UNPROVEN'
  assert.equal(resolveSellerOsNextBestEvidenceV1(fee,now).action,'COMPLETE_FEE')
  const duplicate=evaluation();duplicate.duplicateGate.status='UNPROVEN'
  assert.equal(resolveSellerOsNextBestEvidenceV1(duplicate,now).action,
    'RESOLVE_DUPLICATE')
})

test('commercial memory records lifecycle, provenance, blockers and the $4 floor without marketplace authority',()=>{
  const memory=buildSellerOsCommercialOpportunityMemoryV1(evaluation(),now)
  assert.equal(memory.lifecycleStage,'GO')
  assert.deepEqual(memory.completedStages,['DISCOVERED','DEMAND_PROVEN','PRODUCT_FIT','SHIPPING','ECONOMICS','DUPLICATE_GATE','GO'])
  assert.equal(memory.economics.targetNetProfit,4)
  assert.equal(memory.decisionProvenance.evaluationReceiptId,receiptId)
  assert.equal(memory.safety.marketplaceWrites,0)
  assert.equal(memory.safety.ebayMutationAllowed,false)
  assert.match(memory.memoryDigest,/^sha256:[0-9a-f]{64}$/)
  for(const [stage,next] of [['LISTING_READY','OWNER_PUBLISH_MANUALLY'],['PUBLISHED','MEASURE_RESULT'],['RESULT','NONE']]){
    const advanced=buildSellerOsCommercialOpportunityMemoryV1({...evaluation(),commercialMemory:{lifecycleStage:stage,lifecycleArtifactReceiptId:receiptId,lifecycleArtifactKind:'FIXTURE',experimentRegistry:{status:'AVAILABLE',experimentId:'experiment-1',lifecycleStatus:'RUNNING',updatedAt:now.toISOString()}}},now)
    assert.equal(advanced.lifecycleStage,stage)
    assert.equal(advanced.nextBestEvidence.action,next)
    assert.equal(advanced.decisionProvenance.lifecycleArtifactReceiptId,receiptId)
    assert.equal(advanced.experimentRegistry.authority,
      'EBAY_LISTING_EXPERIMENTS_V1')
  }
})

test('canonical queue persistence uses the guarded RPC and verifies exact readback',async()=>{
  let rpcCalls=0,storedMemory=null
  const query={select(){return query},eq(){return query},limit(){return query},maybeSingle:async()=>({data:{id:'10000000-0000-4000-8000-000000000003',commercial_memory_digest:storedMemory.memoryDigest,commercial_evaluation_receipt_id:receiptId,commercial_memory:storedMemory,commercial_updated_at:now.toISOString()},error:null})}
  const supabase={rpc:async(name,args)=>{rpcCalls++;assert.equal(name,'put_seller_os_commercial_opportunity_memory_v1');storedMemory=args.p_memory;assert.equal(args.p_idempotency_key,`commercial-memory:${storedMemory.memoryDigest}`);return {data:{replay:rpcCalls>1},error:null}},from(){return query}}
  const ctx={...receiptContext(supabase),principal:{ownerUserId:'10000000-0000-4000-8000-000000000002'}}
  const first=await persistSellerOsCommercialOpportunityMemoryV1(ctx,evaluation())
  const replay=await persistSellerOsCommercialOpportunityMemoryV1(ctx,evaluation())
  assert.equal(first.persistence.readback,'PASS')
  assert.equal(first.persistence.replay,false)
  assert.equal(replay.persistence.replay,true)
  assert.equal(rpcCalls,2)
})
