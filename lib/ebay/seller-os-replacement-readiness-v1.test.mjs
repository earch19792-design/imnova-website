import assert from 'node:assert/strict'
import test from 'node:test'

import {goldenDigest} from './commercial-golden-path-domain-v1.ts'
import {buildSellerOsReplacementReadinessV1,
  SELLER_OS_REPLACEMENT_MINIMUM_NET_PROFIT_USD} from
  './seller-os-replacement-readiness-v1.ts'

const now=new Date('2026-10-05T20:00:00Z')
const future='2026-10-06T20:00:00Z'

function target(itemId='366600000001',opportunityId='current-opportunity'){
  return {itemId,sku:`OLD-${itemId}`,currentOpportunityId:opportunityId,
    priority:'HIGH',reasonCode:'TWO_ZERO_IMPRESSION_WINDOWS',
    headline:'Evaluar reemplazo',rationale:'Dos ventanas sin exposición.'}
}

function candidate(overrides={}){
  const memoryWithoutDigest={contractVersion:'SELLER_OS_COMMERCIAL_OPPORTUNITY_MEMORY_V1',
    canonicalResultVersion:'CANONICAL_OPPORTUNITY_RESULT_V2_2026_08_12',
    candidate:{productId:'9220861100256',
      variantId:'53002125082848',supplierSku:'NEW-SKU',title:'Nuevo producto'},
    demand:{status:'PROVEN',soldQuantity:8},
    productFit:{status:'CORE_PROVEN'},
    shipping:{status:'PROVEN',freshUntil:future},
    economics:{status:'PROVEN',expectedNetProfit:7.25,targetNetProfit:4,
      feeAuthority:{status:'PROVEN',freshUntil:future}},
    duplicateGate:{status:'UNPROVEN'},
    compliance:{status:'PROVEN',freshUntil:future},
    decisionProvenance:{minimumNetProfitUsd:4}}
  const digest=goldenDigest(memoryWithoutDigest)
  const memory={...memoryWithoutDigest,memoryDigest:digest}
  return {id:'replacement-opportunity',candidate_key:'candidate:new',
    supplier_product_id:'9220861100256',supplier_variant_id:'53002125082848',
    supplier_sku:'NEW-SKU',product_title:'Nuevo producto',
    market_family_id:'family-rings',commercial_lifecycle_stage:'ECONOMICS',
    commercial_decision:'HOLD',commercial_next_best_evidence:'WAIT_UPSTREAM',
    commercial_evidence_freshness:'UNPROVEN',commercial_blockers:[],
    commercial_evaluation_receipt_id:'10000000-0000-4000-8000-000000000001',
    commercial_memory_digest:digest,commercial_memory:memory,
    commercial_observed_at:now.toISOString(),
    commercial_updated_at:now.toISOString(),...overrides}
}

function reseal(row){
  const {memoryDigest:_,...withoutDigest}=row.commercial_memory
  const nextDigest=goldenDigest(withoutDigest)
  row.commercial_memory={...withoutDigest,memoryDigest:nextDigest}
  row.commercial_memory_digest=nextDigest
  return row
}

function build({targets=[target()],candidates=[candidate()],live=[],
  currentLiveState='CURRENT_UNAVAILABLE',families=[{opportunityId:'current-opportunity',familyId:'family-rings'}],
  sourceStatus='AVAILABLE'}={}){
  return buildSellerOsReplacementReadinessV1({targets,candidates,
    liveOpportunityIds:live,currentLiveState,opportunityFamilies:families,
    sourceStatus,now})
}

test('pairs one same-family internally ready candidate while eBay is unavailable',()=>{
  const result=build()
  assert.equal(result.minimumNetProfitUsd,
    SELLER_OS_REPLACEMENT_MINIMUM_NET_PROFIT_USD)
  assert.equal(result.preparedCount,1)
  assert.equal(result.preparedUnprovenCount,1)
  assert.equal(result.readyForOwnerReviewCount,0)
  assert.equal(result.pairs[0].readiness,'PREPARED_UNPROVEN')
  assert.deepEqual(result.pairs[0].unprovenReasons,
    ['CURRENT_LIVE_EBAY_UNAVAILABLE','LIVE_DUPLICATE_GATE_UNPROVEN',
      'FINAL_GO_DECISION_UNPROVEN'])
  assert.equal(result.pairs[0].marketplaceWrites,0)
  assert.equal(result.safety.noFalseZeroWhenUpstreamUnavailable,true)
})

test('only fresh PASS plus GO and current LIVE can be ready for owner review',()=>{
  const row=candidate({commercial_decision:'GO',
    commercial_lifecycle_stage:'GO'})
  row.commercial_memory={...row.commercial_memory,
    duplicateGate:{status:'PASS',freshUntil:future}}
  const result=build({candidates:[reseal(row)],currentLiveState:'CURRENT_FRESH'})
  assert.equal(result.readyForOwnerReviewCount,1)
  assert.equal(result.pairs[0].readiness,'READY_FOR_OWNER_REVIEW')
  assert.equal(result.pairs[0].automaticListingEndAllowed,false)
  assert.equal(result.pairs[0].automaticPublicationAllowed,false)
})

test('profit below four dollars and stale evidence fail closed',()=>{
  const low=candidate({id:'low-profit'})
  low.commercial_memory={...low.commercial_memory,
    economics:{...low.commercial_memory.economics,expectedNetProfit:3.99}}
  const stale=candidate({id:'stale-shipping',supplier_sku:'STALE-SKU'})
  stale.commercial_memory={...stale.commercial_memory,
    candidate:{...stale.commercial_memory.candidate,supplierSku:'STALE-SKU'},
    shipping:{status:'PROVEN',freshUntil:'2026-10-04T20:00:00Z'}}
  const result=build({candidates:[reseal(low),reseal(stale)]})
  assert.equal(result.preparedCount,0)
  assert.equal(result.unpaired[0].reasonCode,'NO_SAME_FAMILY_CANDIDATE_READY')
})

test('a candidate already linked to a live listing is never reused',()=>{
  const result=build({live:['replacement-opportunity']})
  assert.equal(result.preparedCount,0)
  assert.equal(result.unpaired.length,1)
})

test('bounded database JSON projection is sufficient without reading full memory',()=>{
  const row=candidate()
  const memory=row.commercial_memory
  delete row.commercial_memory
  Object.assign(row,{memory_contract_version:memory.contractVersion,
    memory_canonical_result_version:memory.canonicalResultVersion,
    memory_digest_projection:memory.memoryDigest,
    memory_candidate:memory.candidate,memory_demand:memory.demand,
    memory_product_fit:memory.productFit,memory_shipping:memory.shipping,
    memory_economics:memory.economics,
    memory_duplicate_gate:memory.duplicateGate,
    memory_compliance:memory.compliance,
    memory_decision_provenance:memory.decisionProvenance})
  const result=build({candidates:[row]})
  assert.equal(result.preparedCount,1)
  assert.equal(result.pairs[0].replacement.supplierSku,'NEW-SKU')
})

test('pairing is deterministic, family-bound and one-to-one',()=>{
  const best=candidate({id:'best'})
  best.commercial_memory={...best.commercial_memory,
    economics:{...best.commercial_memory.economics,expectedNetProfit:9}}
  const second=candidate({id:'second',supplier_sku:'SECOND'})
  second.commercial_memory={...second.commercial_memory,
    candidate:{...second.commercial_memory.candidate,supplierSku:'SECOND'},
    economics:{...second.commercial_memory.economics,expectedNetProfit:6}}
  const other=candidate({id:'other-family',supplier_sku:'OTHER',
    market_family_id:'family-other'})
  other.commercial_memory={...other.commercial_memory,
    candidate:{...other.commercial_memory.candidate,supplierSku:'OTHER'}}
  const targets=[target('366600000002','current-two'),target()]
  const families=[{opportunityId:'current-opportunity',familyId:'family-rings'},
    {opportunityId:'current-two',familyId:'family-rings'}]
  const sealed=[reseal(second),reseal(other),reseal(best)]
  const first=build({targets,candidates:sealed,families})
  const replay=build({targets,candidates:[sealed[2],sealed[0],sealed[1]],families})
  assert.deepEqual(first.pairs.map(row=>row.pairId),
    replay.pairs.map(row=>row.pairId))
  assert.equal(new Set(first.pairs.map(row=>row.replacement.opportunityId)).size,2)
  assert.equal(first.pairs.some(row=>row.replacement.opportunityId==='other-family'),false)
})

test('source failure is unavailable rather than a false empty queue',()=>{
  const result=build({sourceStatus:'UNAVAILABLE'})
  assert.equal(result.status,'UNAVAILABLE')
  assert.equal(result.preparedCount,0)
  assert.equal(result.unpaired[0].status,'UNAVAILABLE')
  assert.equal(result.unpaired[0].reasonCode,
    'REPLACEMENT_AUTHORITY_READ_UNAVAILABLE')
})
