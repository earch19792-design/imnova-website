import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { evaluateGoldenCandidateV1, prepareGoldenDraftV1, goldenDigest, classifyGoldenComparable, goldenCategoryDiscoveryMatchesV1 } from './commercial-golden-path-domain-v1.ts'
import { LUNA_FIELD_TRUTH_RECEIPT_FIELDS_V1 } from '../seller-os/luna-trace-product-truth-gate-v1.ts'

// Synthetic fixtures verify gates, and never enter production ledgers or certify a real opportunity.
const now = new Date('2026-10-03T03:00:00Z'), fingerprint = goldenDigest('fixture-source')
const key = { productId: '9000000000001', variantId: '9000000000002', supplierSku: 'FIXTURE-ONLY', supplierQuantity: 1 }
const observed = now.toISOString(), expiry = new Date(+now + 3600000).toISOString()
function fixture() {
  const values = { LUNA_PRODUCT_ID: key.productId, LUNA_VARIANT_ID: key.variantId, SUPPLIER_SKU: key.supplierSku, TITLE: 'Fixture Care Comb', BRAND: 'Fixture Brand', MODEL: 'Fixture Model', QUANTITY_OR_SET_COUNT: 1, SUPPLIER_COST: 4, SUPPLIER_AVAILABILITY: 'AVAILABLE', IMAGES: ['https://cdn.shopify.com/fixture-only.jpg'] }
  const fields = LUNA_FIELD_TRUTH_RECEIPT_FIELDS_V1.map(FIELD => ({ FIELD, VALUE: values[FIELD] ?? null, SEMANTIC_CLASS: FIELD in values ? 'FACT' : 'MISSING', EVIDENCE_STATUS: FIELD in values ? 'PROVEN' : 'MISSING', EVIDENCE_ID: goldenDigest(FIELD), CONTRADICTION: false, OBSERVED_AT: observed, FRESH_UNTIL: expiry, SOURCE_EVIDENCE: FIELD in values ? [{ EVIDENCE_ID: goldenDigest(FIELD), SOURCE_RECEIPT_ID: `luna_catalog:fixture-snapshot:${key.productId}:${key.variantId}` }] : [] }))
  const source = { snapshot_id: 'fixture-snapshot', product_id: key.productId, variant_id: key.variantId, sku: key.supplierSku, source_fingerprint: fingerprint, canonical_url: 'https://lunaportex.com/products/fixture-only', preflight_status: 'PREFLIGHT_PASS', title: values.TITLE, price: 4, availability: true, observed_at: observed,
    field_truth_v1: { contractVersion: 'LUNA_FIELD_PRODUCT_TRUTH_V1', sourceAuthorityContract: 'SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1', sourceSnapshotId: 'fixture-snapshot', sourceProductId: key.productId, sourceVariantId: key.variantId, sourceSupplierSku: key.supplierSku, sourceCatalogFingerprint: fingerprint, evidenceDigest: goldenDigest(fields), fields } }
  const identity = { productName: values.TITLE, manufacturerBrand: values.BRAND, model: values.MODEL, packCount: 1 }
  const sold = { evidenceId: 'fixture-sold', source: 'SYNTHETIC_TEST_ONLY', sourceLocator: 'fixture://sale', sourceDigest: goldenDigest('sale'), listingState: 'SOLD', identity, reviewed: true, reviewReason: null, soldQuantity: 4, realizedSoldPrice: 20, buyerShipping: 0, currency: 'USD', lastSoldDate: observed, capturedAt: observed, realizedPriceStatus: 'PROVEN' }
  return { candidate: { ...key }, accountKey: 'FIXTURE-ACCOUNT', now, targetNetProfit: 4, source, market: [sold], marketComplete: true,
    duplicate: { status: 'PASS', receiptId: 'fixture-live' },
    shipping: { status: 'PROVEN', receiptId: 'fixture-shipping', productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: 1, sourceFingerprint: fingerprint, currency: 'USD', noPurchase: true, noPayment: true, observedAt: observed, freshUntil: expiry, amountUsd: 3 },
    fee: { status: 'PROVEN', receiptId: 'fixture-fee', supplierSku: key.supplierSku, accountKey: 'FIXTURE-ACCOUNT', productId: key.productId, variantId: key.variantId, supplierQuantity: 1, price: 20, buyerShipping: 0, currency: 'USD', amountUsd: 3.06, observedAt: observed, freshUntil: expiry },
    compliance: { status: 'PROVEN', receiptId: 'fixture-compliance', supplierSku: key.supplierSku, supplierQuantity: 1, productId: key.productId, variantId: key.variantId, sourceFingerprint: fingerprint, observedAt: observed, freshUntil: expiry, blockers: [], category: { id: 'fixture-category', name: 'Fixture Category' } },
    policy: { status: 'PROVEN', accountKey: 'FIXTURE-ACCOUNT', returnsReserveRate: .04, promotedState: 'NOT_APPLICABLE', otherState: 'NOT_APPLICABLE' } }
}
test('deterministic evaluator and GO-only draft have zero network or marketplace writes', () => {
  const input = fixture(), a = evaluateGoldenCandidateV1(input), b = evaluateGoldenCandidateV1(structuredClone(input))
  assert.deepEqual(a, b)
  assert.equal(a.decision, 'GO')
  assert.equal(a.economics.expectedNetProfit, 9.14)
  assert.equal(a.supplier.stock, null)
  assert.equal(a.supplier.stockStatus, 'UNPROVEN')
  assert.equal(a.economics.promotedFee, 0)
  const pkg = prepareGoldenDraftV1(a)
  assert.equal(pkg.state, 'DRAFT_ONLY'); assert.equal(pkg.published, false); assert.equal(pkg.itemId, null)
  assert.equal(pkg.sku, key.supplierSku); assert.equal(pkg.publication.marketplaceWrites, 0)
  assert.equal(pkg.specifics.some(f => f.FIELD === 'GTIN'), false)
})
test('ACTIVE prices, FAMILY demand and branded comps cannot authorize economics', () => {
  for (const mutate of [i => i.market[0].listingState = 'ACTIVE', i => i.market[0].identity.packCount = 6, i => i.market[0].identity.manufacturerBrand = 'Another Brand']) {
    const input = fixture(); mutate(input)
    const r = evaluateGoldenCandidateV1(input)
    assert.equal(r.decision, 'UNPROVEN'); assert.equal(r.economics.expectedNetProfit, null)
    assert.equal(r.market.realizedBuyerLandedPrice, null)
    assert.throws(() => prepareGoldenDraftV1(r), /GO_REQUIRED/)
  }
})
test('unknown, stale, different-quantity and wrong-identity shipping never falls back to estimates', () => {
  for (const change of [{ status: 'UNKNOWN' }, { amountUsd: null }, { amountUsd: -1 }, { supplierQuantity: 2 }, { freshUntil: observed }, { sourceFingerprint: goldenDigest('wrong') }]) {
    const input = fixture(); Object.assign(input.shipping, change)
    const r = evaluateGoldenCandidateV1(input)
    assert.equal(r.economics.status, 'UNPROVEN'); assert.equal(r.economics.expectedNetProfit, null)
    assert.ok(r.reasonCodes.includes('REAL_OFFER_SHIPPING_UNPROVEN')); assert.notEqual(r.decision, 'GO')
  }
})
test('unknown Duplicate Gate blocks GO, and a LIVE duplicate rejects without writes', () => {
  const input = fixture(); input.duplicate.status = 'UNPROVEN'
  assert.equal(evaluateGoldenCandidateV1(input).decision, 'UNPROVEN')
  input.duplicate.status = 'DUPLICATE'
  assert.equal(evaluateGoldenCandidateV1(input).decision, 'REJECT')
})
test('unknown offer count, conflicting identity and mismatched fee/compliance cannot manufacture proof', () => {
  const count = fixture()
  const field = count.source.field_truth_v1.fields.find(f=>f.FIELD==='QUANTITY_OR_SET_COUNT')
  field.VALUE=null; field.EVIDENCE_STATUS='MISSING'
  const unknown=evaluateGoldenCandidateV1(count)
  assert.equal(unknown.offer.type,'UNPROVEN'); assert.equal(unknown.offer.includedCount,null)
  for(const mutate of [i=>i.fee.supplierSku='WRONG',i=>i.compliance.supplierQuantity=2,i=>i.compliance.supplierSku='WRONG']) {
    const input=fixture();mutate(input);assert.notEqual(evaluateGoldenCandidateV1(input).decision,'GO')
  }
  const wrong=fixture();wrong.source.product_id='OTHER_PRODUCT'
  assert.equal(evaluateGoldenCandidateV1(wrong).economics.status,'UNPROVEN')
})
test('insufficient supported SOLD price rejects without inflating recommended price', () => {
  const input = fixture(); input.market[0].realizedSoldPrice = 10; input.fee.price = 10; input.fee.amountUsd = 1.8
  const r = evaluateGoldenCandidateV1(input)
  assert.equal(r.decision, 'REJECT'); assert.equal(r.economics.recommendedPrice, 10)
  assert.ok(r.reasonCodes.includes('SOLD_MARKET_DOES_NOT_SUPPORT_TARGET_NET'))
})
test('displayed SOLD with unrealized price, unknown buyer shipping and stale sales remain UNPROVEN', () => {
  for (const change of [{ realizedPriceStatus: 'UNPROVEN' }, { buyerShipping: null }, { lastSoldDate: '2026-01-01T00:00:00Z' }]) {
    const input = fixture(); Object.assign(input.market[0], change)
    const r = evaluateGoldenCandidateV1(input); assert.equal(r.decision, 'UNPROVEN'); assert.equal(r.market.soldQuantity, null)
  }
})
test('packs require same-count SOLD and a real quote for the full supplier quantity', () => {
  const input = fixture(); input.candidate.supplierQuantity = 2
  assert.ok(evaluateGoldenCandidateV1(input).reasonCodes.includes('PACK_COMMERCIAL_EVIDENCE_UNPROVEN'))
  input.market[0].identity.packCount = 2
  assert.ok(evaluateGoldenCandidateV1(input).reasonCodes.includes('REAL_OFFER_SHIPPING_UNPROVEN'))
  Object.assign(input.shipping, { supplierQuantity: 2, amountUsd: 4 })
  input.fee.supplierQuantity = 2
  input.compliance.supplierQuantity = 2
  const r = evaluateGoldenCandidateV1(input); assert.equal(r.decision, 'GO'); assert.equal(r.supplier.offerCostUsd, 8)
})
test('manual EXACT cannot override a branded mismatch or manufacture supplier GTIN', () => {
  const input = fixture(); input.market[0].requestedClassification = 'EXACT'; input.market[0].identity.manufacturerBrand = 'Another Brand'
  assert.equal(classifyGoldenComparable({ productName: 'Fixture Care Comb', packCount: 1 }, input.market[0]).classification, 'REJECTED_COMPARABLE')
  assert.equal(evaluateGoldenCandidateV1(input).productTruth.verifiedSpecifics.some(f => f.FIELD === 'GTIN'), false)
})
test('fee, returns, promotion and compliance UNKNOWN block GO without a silent zero', () => {
  for (const mutate of [i => i.fee.status = 'UNKNOWN', i => i.policy.returnsReserveRate = null, i => i.policy.promotedState = 'UNKNOWN', i => i.compliance.status = 'UNKNOWN', i => i.marketComplete = false]) {
    const i = fixture(); mutate(i); assert.equal(evaluateGoldenCandidateV1(i).decision, 'UNPROVEN')
  }
  const i = fixture(); i.compliance.blockers.push('MEDICAL_CLAIM_UNVERIFIED')
  assert.equal(evaluateGoldenCandidateV1(i).decision, 'HOLD')
})
test('Golden Path persistence has closed ACLs and cannot call publisher, END or marketplace writers', () => {
  const root = new URL('../../', import.meta.url)
  const sql = readFileSync(new URL('supabase/migrations/20261003033856_commercial_golden_path_v1.sql', root), 'utf8')
  const runtime = readFileSync(new URL('lib/ebay/commercial-golden-path-runtime-v1.ts', root), 'utf8')
  assert.match(sql, /security invoker/); assert.match(sql, /force row level security/)
  assert.match(sql, /from public,anon,authenticated/); assert.match(sql, /GOLDEN_ENROLL_OFFICIAL_BINDING_REQUIRED/)
  assert.match(sql, /marketplace_actions_enabled is false/)
  assert.doesNotMatch(runtime + sql, /AddFixedPriceItem|ReviseInventoryStatus|EndFixedPriceItem|publishOffer|runPublisher|sendWhatsApp|fetch\([^\n]*api\.ebay/)
})

 test('Personal Care discovery uses verified titles; mislabeled RAM/HVAC never becomes category demand',()=>{
  const care=fixture().source;care.product_type='Other'
  assert.equal(goldenCategoryDiscoveryMatchesV1('Personal Care',care,now),true)
  for(const title of ['DDR4 RAM Laptop Module','BestAir HVAC Filter','Office Chair']){
   const tech=fixture().source;tech.product_type='Personal Care'
   tech.field_truth_v1.fields.find(f=>f.FIELD==='TITLE').VALUE=title
   assert.equal(goldenCategoryDiscoveryMatchesV1('Personal Care',tech,now),false)
  }
 })

 test('draft title uses verified truth and a multi-unit offer never inherits the supplier single GTIN',()=>{
  const input=fixture();input.source.title='Unverified cosmetic claim'
  const gtin=input.source.field_truth_v1.fields.find(f=>f.FIELD==='GTIN')
  Object.assign(gtin,{VALUE:'123456789012',SEMANTIC_CLASS:'FACT',EVIDENCE_STATUS:'PROVEN',SOURCE_EVIDENCE:[{EVIDENCE_ID:goldenDigest('GTIN'),SOURCE_RECEIPT_ID:`luna_catalog:fixture-snapshot:${key.productId}:${key.variantId}`}]})
  const single=prepareGoldenDraftV1(evaluateGoldenCandidateV1(input))
  assert.equal(single.title,'Fixture Care Comb');assert.equal(single.specifics.find(f=>f.FIELD==='GTIN').VALUE,'123456789012')
  input.candidate.supplierQuantity=2;input.market[0].identity.packCount=2
  input.shipping.supplierQuantity=2;input.shipping.amountUsd=4
  input.fee.supplierQuantity=2;input.compliance.supplierQuantity=2
  const pack=prepareGoldenDraftV1(evaluateGoldenCandidateV1(input))
  assert.equal(pack.specifics.some(f=>f.FIELD==='GTIN'),false)
  assert.equal(pack.offerContents.supplierUnitFacts.find(f=>f.FIELD==='GTIN').VALUE,'123456789012')
  assert.doesNotMatch(pack.title,/Unverified/)
 })
 test('profit requirement cannot be bypassed with NaN, Infinity or a sub-four-dollar target',()=>{
  for(const targetNetProfit of [NaN,Infinity,-1,0,3.99,10001])assert.throws(()=>evaluateGoldenCandidateV1({...fixture(),targetNetProfit}),/TARGET_NET_PROFIT/)
 })

 test('ACTIVE competition has its own price and never produces a realized buyer-landed price',()=>{
  const input=fixture();Object.assign(input.market[0],{listingState:'ACTIVE',realizedSoldPrice:null,activeListingPrice:99,realizedPriceStatus:'UNPROVEN',soldQuantity:null,lastSoldDate:null})
  const result=evaluateGoldenCandidateV1(input)
  assert.equal(result.market.activeCompetition[0].activeListingPrice,99)
  assert.equal(result.market.activeCompetition[0].buyerLandedPrice,null)
  assert.equal(result.market.activeCompetitionAuthority.status,'UNPROVEN')
  assert.equal(result.economics.recommendedPrice,null);assert.equal(result.economics.expectedNetProfit,null)
 })
