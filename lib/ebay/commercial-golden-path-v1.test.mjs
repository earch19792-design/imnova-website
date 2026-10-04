import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { SELLER_OS_AUTONOMOUS_IDENTITY_AUTHORITY_V1, evaluateGoldenCandidateV1, prepareGoldenDraftV1, goldenDigest, classifyGoldenComparable, goldenCategoryDiscoveryMatchesV1 } from './commercial-golden-path-domain-v1.ts'
import { LUNA_FIELD_TRUTH_RECEIPT_FIELDS_V1 } from '../seller-os/luna-trace-product-truth-gate-v1.ts'
import { sanitizedSourceIdentifier } from './ebay-luna-product-identity-enrichment.ts'
import { buildGoldenOwnerFeePolicyV1 } from './commercial-golden-path-owner-fee-policy-v1.ts'
import { buildGoldenOwnerProductTruthEvidenceV1 } from './commercial-golden-path-owner-product-truth-v1.ts'
import { buildGoldenVisualComparisonEvidenceV1 } from './commercial-golden-path-visual-comparison-v1.ts'

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
    shipping: { status: 'PROVEN', receiptId: 'fixture-shipping', destinationProfileDigest: goldenDigest('fixture-destination'), productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: 1, sourceFingerprint: fingerprint, currency: 'USD', noPurchase: true, noPayment: true, observedAt: observed, freshUntil: expiry, amountUsd: 3 },
    fulfillment: { status: 'PROVEN', receiptId: 'fixture-fulfillment', accountKey: 'FIXTURE-ACCOUNT', productId: key.productId, variantId: key.variantId, supplierSku: key.supplierSku, supplierQuantity: 1, sourceFingerprint: fingerprint, supplierShippingReceiptId: 'fixture-shipping', destinationProfileDigest: goldenDigest('fixture-destination'), currency: 'USD', buyerShipping: 0, buyerCoverageStatus: 'PROVEN', buyerCoverageDigest: goldenDigest('fixture-buyer-coverage'), sourceDigest: goldenDigest('fixture-direct-coverage'), observedAt: observed, freshUntil: expiry, amountUsd: 0, source: 'OWNER_CERTIFIED_DIRECT_SUPPLIER_FULFILLMENT_V1', coverage: 'SUPPLIER_QUOTE_COVERS_ALL_OFFERED_BUYER_DESTINATIONS' },
    fee: { status: 'PROVEN', receiptId: 'fixture-fee', supplierSku: key.supplierSku, accountKey: 'FIXTURE-ACCOUNT', productId: key.productId, variantId: key.variantId, supplierQuantity: 1, price: 20, buyerShipping: 0, currency: 'USD', amountUsd: 3.06, observedAt: observed, freshUntil: expiry },
    compliance: { status: 'PROVEN', receiptId: 'fixture-compliance', supplierSku: key.supplierSku, supplierQuantity: 1, productId: key.productId, variantId: key.variantId, sourceFingerprint: fingerprint, observedAt: observed, freshUntil: expiry, blockers: [], category: { id: 'fixture-category', name: 'Fixture Category' } },
    policy: { status: 'PROVEN', accountKey: 'FIXTURE-ACCOUNT', returnsReserveRate: .04, promotedState: 'NOT_APPLICABLE', otherState: 'NOT_APPLICABLE' } }
}
function autonomousIdentityAuthority(input = {}) {
  const candidate = input.candidate ?? key
  const identity = {
    normalizedProductName: 'Fixture Care Comb', brand: 'Fixture Brand',
    model: 'Fixture Model', packCount: 1, condition: 'NEW',
    ...input.identity,
  }
  const lunaIdentifier = sanitizedSourceIdentifier('LUNA_STRUCTURED',
    `${candidate.productId}:${candidate.variantId}`)
  const evidence = [
    { attribute_name: 'normalizedProductName', normalized_value: identity.normalizedProductName, source_type: 'LUNA_STRUCTURED', source_identifier: lunaIdentifier, observed_at: observed, confidence: 1, verified_by_rule: true, conflict_status: 'CLEAR', evidence_hash: goldenDigest('autonomous-name') },
    ...[['brand', identity.brand], ['model', identity.model],
      ['packCount', identity.packCount], ['condition', identity.condition]]
      .filter(([, value]) => value != null)
      .map(([attribute_name, normalized_value]) => ({ attribute_name,
        normalized_value, source_type: 'EBAY_CATALOG',
        source_identifier: `fixture-catalog:${attribute_name}`,
        observed_at: observed, confidence: .96, verified_by_rule: true,
        conflict_status: 'CLEAR',
        evidence_hash: goldenDigest({ attribute_name, normalized_value }) })),
  ]
  const body = {
    contractVersion: SELLER_OS_AUTONOMOUS_IDENTITY_AUTHORITY_V1,
    accountKey: 'FIXTURE-ACCOUNT', marketplace: 'EBAY_US', candidate,
    sourceFingerprint: input.sourceFingerprint ?? fingerprint,
    enrichmentId: 'fixture-autonomous-enrichment', enrichmentVersion: 1,
    identity, conflictAttributes: [], sourceCoverage: ['LUNA_STRUCTURED', 'EBAY_CATALOG'],
    evidence, observedAt: observed, freshUntil: expiry,
    supplierTruthModified: false, operatorRequired: false,
    marketplaceWrites: 0,
  }
  return { ...body, status: 'PROVEN', receiptId: body.enrichmentId,
    evidenceDigest: goldenDigest(body) }
}
test('deterministic evaluator and GO-only draft have zero network or marketplace writes', () => {
  const input = fixture(), a = evaluateGoldenCandidateV1(input), b = evaluateGoldenCandidateV1(structuredClone(input))
  assert.deepEqual(a, b)
  assert.equal(a.decision, 'GO')
  assert.equal(a.economics.expectedNetProfit, 9.14)
  assert.equal(a.economics.realizedNetProfit, null)
  assert.equal(a.economics.realizedNetProfitStatus, 'UNPROVEN')
  assert.equal(a.economics.realizedProfitUsedForDecision, false)
  assert.equal(a.supplier.stock, null)
  assert.equal(a.supplier.stockStatus, 'UNPROVEN')
  assert.equal(a.economics.promotedFee, 0)
  const pkg = prepareGoldenDraftV1(a)
  assert.equal(pkg.state, 'DRAFT_ONLY'); assert.equal(pkg.published, false); assert.equal(pkg.itemId, null)
  assert.equal(pkg.sku, key.supplierSku); assert.equal(pkg.publication.marketplaceWrites, 0)
  assert.equal(pkg.specifics.some(f => f.FIELD === 'GTIN'), false)
})
test('explicit OWNER provisional fees support expected economics while realized profit remains UNPROVEN',()=>{
 const input=fixture()
 input.fee=buildGoldenOwnerFeePolicyV1({policy:{variableRateFraction:.15,fixedAmountUsd:.3,freshUntil:expiry,sourceLocator:'fixture://owner-fee-policy',sourceDigest:goldenDigest('fixture-owner-policy'),approvalNote:'Synthetic OWNER approval for test only',operatorAttested:true},candidate:input.candidate,accountKey:input.accountKey,ownerUserId:'fixture-owner',invocationSource:'AUTHENTICATED_CONTROL_MCP',sourceFingerprint:fingerprint,price:20,now})
 let result=evaluateGoldenCandidateV1(input)
 assert.equal(result.decision,'GO');assert.equal(result.economics.status,'PROVISIONAL_OWNER_POLICY')
 assert.equal(result.economics.expectedNetProfit,8.9);assert.equal(result.economics.realizedNetProfit,null)
 assert.ok(result.reasonCodes.includes('OWNER_PROVISIONAL_FEE_POLICY_USED_EXPECTED_ONLY'))
 delete input.fulfillment
 result=evaluateGoldenCandidateV1(input)
 assert.equal(result.decision,'UNPROVEN');assert.equal(result.economics.expectedNetProfit,null)
 assert.ok(result.reasonCodes.includes('BUYER_FULFILLMENT_SHIPPING_UNPROVEN'))
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
test('merchant-location freight cannot stand in for delivery to all offered buyer destinations', () => {
  for (const change of [undefined, {status:'UNKNOWN'}, {amountUsd:null}, {amountUsd:-1}, {supplierQuantity:2}, {supplierShippingReceiptId:'another-quote'}, {destinationProfileDigest:goldenDigest('other-destination')}, {buyerCoverageStatus:'UNKNOWN'}, {buyerCoverageDigest:null}, {sourceDigest:null}, {source:'ESTIMATED_FORWARDING'}, {coverage:'BOCA_RATON_ONLY'}, {freshUntil:observed}]) {
    const input=fixture()
    input.fulfillment = change === undefined ? undefined : {...input.fulfillment,...change}
    const result=evaluateGoldenCandidateV1(input)
    assert.notEqual(result.decision,'GO');assert.equal(result.economics.expectedNetProfit,null)
    assert.equal(result.shipping.amountUsd,3)
    assert.equal(result.economics.buyerFulfillmentShipping,null)
    assert.ok(result.reasonCodes.includes('BUYER_FULFILLMENT_SHIPPING_UNPROVEN'))
  }
  const forwarded=fixture()
  Object.assign(forwarded.fulfillment,{source:'REAL_BUYER_FULFILLMENT_SERVICE_QUOTE_V1',coverage:'ALL_OFFERED_BUYER_DESTINATIONS',amountUsd:6})
  const result=evaluateGoldenCandidateV1(forwarded)
  assert.equal(result.decision,'REJECT');assert.equal(result.economics.expectedNetProfit,3.14)
  assert.equal(result.economics.recommendedPrice,20)
  assert.equal(result.economics.roiPercent,24.15)
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
  for (const change of [{ realizedPriceStatus: 'UNPROVEN' }, { buyerShipping: null }, { lastSoldDate: '2026-01-01T00:00:00Z' }, { capturedAt: '2026-10-02T03:00:00Z' }]) {
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
  input.fulfillment.supplierQuantity = 2
  const r = evaluateGoldenCandidateV1(input); assert.equal(r.decision, 'GO'); assert.equal(r.supplier.offerCostUsd, 8)
})
test('OWNER-attested base count supports exact unit and pack math without rewriting Supplier Truth', () => {
  const input = fixture()
  const count = input.source.field_truth_v1.fields.find(field => field.FIELD === 'QUANTITY_OR_SET_COUNT')
  Object.assign(count, { VALUE: null, SEMANTIC_CLASS: 'MISSING', EVIDENCE_STATUS: 'MISSING', SOURCE_EVIDENCE: [] })
  input.ownerUserId = 'fixture-owner'
  input.ownerProductTruthEvidence = buildGoldenOwnerProductTruthEvidenceV1({
    candidate: input.candidate,
    accountKey: input.accountKey,
    ownerUserId: input.ownerUserId,
    sourceFingerprint: fingerprint,
    expectedCanonicalUrl: input.source.canonical_url,
    source: {
      canonicalUrl: input.source.canonical_url,
      sourceLocator: input.source.canonical_url,
      sourceDigest: goldenDigest('fixture-owner-video'),
      capturedAt: observed,
      sourceMediaType: 'VIDEO',
    },
    observations: [{
      factClass: 'SUPPLIER_BASE_INCLUDED_UNIT_COUNT',
      value: '1',
      evidenceStatement: 'OWNER confirms the Luna base offer contains exactly one physical unit.',
    }],
    operatorAttested: true,
    now,
  })
  const single = evaluateGoldenCandidateV1(input)
  assert.equal(single.offer.type, 'single')
  assert.equal(single.offer.includedCount, 1)
  assert.equal(single.productTruth.baseIncludedUnitCountStatus, 'PROVEN_OWNER_ATTESTED')
  assert.equal(single.productTruth.verifiedSpecifics.some(field => field.FIELD === 'QUANTITY_OR_SET_COUNT'), false)
  assert.equal(single.reasonCodes.includes('OFFER_COUNT_UNPROVEN'), false)

  input.candidate.supplierQuantity = 2
  input.market[0].identity.packCount = 2
  Object.assign(input.shipping, { supplierQuantity: 2, amountUsd: 4 })
  input.fee.supplierQuantity = 2
  input.compliance.supplierQuantity = 2
  input.fulfillment.supplierQuantity = 2
  const pack = evaluateGoldenCandidateV1(input)
  assert.equal(pack.offer.type, 'pack')
  assert.equal(pack.offer.includedCount, 2)
  assert.equal(pack.supplier.offerCostUsd, 8)
  assert.equal(pack.decision, 'GO')
})
test('manual EXACT cannot override a branded mismatch or manufacture supplier GTIN', () => {
  const input = fixture(); input.market[0].requestedClassification = 'EXACT'; input.market[0].identity.manufacturerBrand = 'Another Brand'
  assert.equal(classifyGoldenComparable({ productName: 'Fixture Care Comb', packCount: 1 }, input.market[0]).classification, 'REJECTED_COMPARABLE')
  assert.equal(evaluateGoldenCandidateV1(input).productTruth.verifiedSpecifics.some(f => f.FIELD === 'GTIN'), false)
})
test('Seller OS autonomously fills missing Luna identity without Codex or Supplier Truth mutation', () => {
  const input = fixture()
  for (const fieldName of ['BRAND', 'MODEL', 'QUANTITY_OR_SET_COUNT']) {
    const field = input.source.field_truth_v1.fields.find(entry => entry.FIELD === fieldName)
    Object.assign(field, { VALUE: null, SEMANTIC_CLASS: 'MISSING',
      EVIDENCE_STATUS: 'MISSING', SOURCE_EVIDENCE: [] })
  }
  input.autonomousIdentity = autonomousIdentityAuthority()
  const result = evaluateGoldenCandidateV1(input)
  assert.equal(result.decision, 'GO')
  assert.equal(result.offer.includedCount, 1)
  assert.equal(result.productTruth.status, 'CORE_PLUS_AUTONOMOUS_ENRICHMENT')
  assert.equal(result.productTruth.baseIncludedUnitCountStatus,
    'PROVEN_AUTONOMOUS_ENRICHMENT')
  assert.equal(result.productTruth.manufacturerBrand, 'Fixture Brand')
  assert.equal(result.productTruth.manufacturerBrandStatus,
    'PROVEN_AUTONOMOUS_ENRICHMENT')
  assert.equal(result.productTruth.unknownFieldsPromoted, true)
  assert.equal(result.productTruth.autonomousIdentity.operatorRequired, false)
  assert.equal(result.productTruth.autonomousIdentity.supplierTruthModified, false)
  assert.equal(result.productTruth.verifiedSpecifics.some(field =>
    ['BRAND', 'MODEL', 'QUANTITY_OR_SET_COUNT'].includes(field.FIELD)), false)
  const draft = prepareGoldenDraftV1(result)
  assert.equal(draft.specifics.find(field => field.FIELD === 'BRAND').VALUE,
    'Fixture Brand')
  assert.equal(draft.specifics.find(field => field.FIELD === 'MODEL').VALUE,
    'Fixture Model')
  assert.equal(draft.specifics.find(field => field.FIELD === 'BRAND').SUPPLIER_TRUTH,
    false)
  assert.match(draft.description, /Corroborated identity MODEL: Fixture Model/)
})
test('autonomous identity never overwrites Luna and conflicts stop the candidate for correction', () => {
  const input = fixture()
  input.autonomousIdentity = autonomousIdentityAuthority({
    identity: { brand: 'Different Brand' },
  })
  const result = evaluateGoldenCandidateV1(input)
  assert.equal(result.decision, 'HOLD')
  assert.ok(result.reasonCodes.includes('AUTONOMOUS_IDENTITY_BRAND_CONFLICT'))
  assert.equal(result.productTruth.manufacturerBrand, 'Fixture Brand')
  assert.equal(result.productTruth.unknownFieldsPromoted, false)
})
test('stale or incorrectly bound autonomous identity cannot fill Luna gaps', () => {
  const input = fixture()
  for (const fieldName of ['BRAND', 'MODEL', 'QUANTITY_OR_SET_COUNT']) {
    const field = input.source.field_truth_v1.fields.find(entry => entry.FIELD === fieldName)
    Object.assign(field, { VALUE: null, SEMANTIC_CLASS: 'MISSING',
      EVIDENCE_STATUS: 'MISSING', SOURCE_EVIDENCE: [] })
  }
  input.autonomousIdentity = autonomousIdentityAuthority({
    sourceFingerprint: goldenDigest('wrong-source'),
  })
  const result = evaluateGoldenCandidateV1(input)
  assert.equal(result.decision, 'UNPROVEN')
  assert.equal(result.offer.includedCount, null)
  assert.ok(result.reasonCodes.includes('AUTONOMOUS_IDENTITY_ENRICHMENT_REQUIRED'))
  assert.equal(result.productTruth.autonomousIdentity.status, 'UNPROVEN')
  assert.equal(result.productTruth.unknownFieldsPromoted, false)
})
test('OWNER visible marking supports CLOSE only without brand transfer, false EXACT or unknown-field promotion', () => {
  const input = fixture()
  for (const fieldName of ['BRAND','GTIN','MPN','MODEL','QUANTITY_OR_SET_COUNT']) {
    const field = input.source.field_truth_v1.fields.find(entry => entry.FIELD === fieldName)
    Object.assign(field,{VALUE:null,SEMANTIC_CLASS:'MISSING',EVIDENCE_STATUS:'MISSING',SOURCE_EVIDENCE:[]})
  }
  input.market = [
    {...input.market[0],evidenceId:'fixture-two-pack',identity:{productName:'2 Pack Safari Dog De-Matting Comb Serrated Stainless Steel Grooming Tool',manufacturerBrand:'Safari',packCount:2},requestedClassification:'EXACT',reviewReason:'Human-reviewed sold row for the same product family.'},
    {...input.market[0],evidenceId:'fixture-one-size',identity:{productName:'Coastal Pet Safari Dog De-Matting Comb - Serrated One Size, NO Color',manufacturerBrand:'Coastal Pet',packCount:null},requestedClassification:'EXACT',reviewReason:'Human-reviewed sold row with visual marking corroboration.'},
  ]
  input.ownerProductTruthEvidence = buildGoldenOwnerProductTruthEvidenceV1({
    candidate: input.candidate, accountKey: input.accountKey, ownerUserId:'fixture-owner',
    sourceFingerprint:fingerprint, expectedCanonicalUrl:input.source.canonical_url,
    source:{canonicalUrl:input.source.canonical_url,sourceLocator:input.source.canonical_url,sourceDigest:goldenDigest('fixture-owner-image'),capturedAt:observed,sourceMediaType:'IMAGE'},
    observations:[{factClass:'VISIBLE_BRAND_MARKING',value:'SAFARI',evidenceStatement:'The supplier image visibly shows the SAFARI marking on the product.'}],
    operatorAttested:true, now,
  })
  input.ownerUserId='fixture-owner'
  input.source.field_truth_v1.fields.find(entry => entry.FIELD === 'TITLE').VALUE='Safari De-Matting Comb'
  const visible=(factClass,value,confidence='HIGH')=>({factClass,value,confidence,evidenceStatement:`Fixture visual observation records ${factClass} as ${value}.`})
  const supplierObservation={sourceRole:'SUPPLIER_IMAGE',mediaReference:'sha256:fixture-supplier',sourceLocator:input.source.canonical_url,sourceDigest:goldenDigest('fixture-owner-image'),capturedAt:observed,method:'OWNER_REVIEWED',methodVersion:'OWNER_VISUAL_REVIEW_V1',imageWidthPixels:738,imageHeightPixels:739,subjectRegionWidthPixels:680,subjectRegionHeightPixels:680,cropStatus:'FULL_FRAME',facts:[visible('VISIBLE_BRAND_MARKING','SAFARI'),visible('PRODUCT_SHAPE','CURVED COMB HEAD'),visible('COLOR_PATTERN','GREEN AND BLACK'),visible('HANDLE_DESIGN','BLACK RUBBERIZED HANDLE')]}
  const marketObservation=(region,facts)=>({sourceRole:'MARKETPLACE_SOLD_IMAGE',mediaReference:`sha256:fixture-market#region=${region}`,sourceLocator:input.market[region-1].sourceLocator,sourceDigest:input.market[region-1].sourceDigest,capturedAt:observed,method:'OWNER_REVIEWED',methodVersion:'OWNER_VISUAL_REVIEW_V1',imageWidthPixels:1200,imageHeightPixels:800,subjectRegionWidthPixels:97,subjectRegionHeightPixels:97,cropStatus:'FULL_FRAME',facts})
  const relation=(factClass,relationValue,confidence='HIGH')=>({factClass,relation:relationValue,confidence,evidenceStatement:`Fixture visual comparison records ${factClass} as ${relationValue}.`})
  input.visualComparisonEvidence=buildGoldenVisualComparisonEvidenceV1({candidate:input.candidate,accountKey:input.accountKey,ownerUserId:input.ownerUserId,sourceFingerprint:fingerprint,canonicalUrl:input.source.canonical_url,supplierObservation,comparisons:[
    {marketEvidence:{evidenceId:input.market[0].evidenceId,listingState:'SOLD',sourceLocator:input.market[0].sourceLocator,sourceDigest:input.market[0].sourceDigest},marketplaceObservation:marketObservation(1,[visible('VISIBLE_TEXT','2 PACK'),visible('VISIBLE_PACKAGING','TWO COMBS'),visible('EXPLICIT_OFFER_QUANTITY','2')]),relations:[relation('EXPLICIT_OFFER_QUANTITY','CONFLICT')]},
    {marketEvidence:{evidenceId:input.market[1].evidenceId,listingState:'SOLD',sourceLocator:input.market[1].sourceLocator,sourceDigest:input.market[1].sourceDigest},marketplaceObservation:marketObservation(2,[visible('PRODUCT_SHAPE','CURVED COMB HEAD'),visible('COLOR_PATTERN','GREEN AND BLACK'),visible('HANDLE_DESIGN','BLACK RUBBERIZED HANDLE','LOW')]),relations:[relation('PRODUCT_SHAPE','MATCH','MEDIUM'),relation('COLOR_PATTERN','MATCH','MEDIUM'),relation('HANDLE_DESIGN','MATCH','LOW')]},
  ],operatorAttested:true,now})
  const result=evaluateGoldenCandidateV1(input)
  assert.equal(result.market.exactSold.length,0)
  assert.equal(result.market.closeSold.length,1)
  assert.equal(result.market.closeSold[0].priceEligible,false)
  assert.ok(result.market.closeSold[0].reasonCodes.includes('OBSERVED_MARKING_CANNOT_PROVE_EXACT'))
  assert.ok(result.market.closeSold[0].reasonCodes.includes('COMPARABLE_BRAND_NOT_TRANSFERRED'))
  assert.equal(result.market.familyEvidence.length,1)
  assert.ok(result.market.familyEvidence[0].reasonCodes.includes('COMPARABLE_MULTIPACK_TARGET_OFFER_COUNT_UNPROVEN'))
  assert.equal(result.market.familyEvidence[0].visualComparison.outcome,'CONTRADICTS')
  assert.equal(result.market.closeSold[0].visualComparison.outcome,'INCONCLUSIVE')
  assert.equal(result.market.closeSold[0].visualComparison.exactAuthority,false)
  assert.equal(result.market.realizedBuyerLandedPrice,null)
  assert.equal(result.decision,'UNPROVEN')
  assert.deepEqual(result.productTruth.ownerObservedMarkings,['SAFARI'])
  assert.equal(result.productTruth.manufacturerBrand,null)
  assert.equal(result.productTruth.manufacturerBrandStatus,'UNPROVEN')
  assert.equal(result.productTruth.ownerEvidencePromotedToManufacturerBrand,false)
  assert.equal(result.productTruth.unknownFieldsPromoted,false)
  for (const fieldName of ['BRAND','GTIN','MPN','MODEL','QUANTITY_OR_SET_COUNT']) {
    assert.equal(result.productTruth.verifiedSpecifics.some(entry=>entry.FIELD===fieldName),false)
    assert.ok(result.productTruth.missingFields.includes(fieldName))
  }
  input.ownerUserId='different-owner'
  assert.equal(evaluateGoldenCandidateV1(input).market.closeSold.length,0)
})
test('unbound marking evidence cannot bypass brand transfer protection', () => {
  const input=fixture()
  const evidence={...input.market[0],identity:{...input.market[0].identity,manufacturerBrand:'Other Brand'},requestedClassification:'CLOSE'}
  assert.equal(classifyGoldenComparable({productName:'Fixture Care Comb',packCount:1},evidence,{observedMarkings:['SAFARI']}).classification,'REJECTED_COMPARABLE')
})
test('visual support can project only CLOSE and never satisfy an EXACT request',()=>{
  const evidence={...fixture().market[0],identity:{productName:'Observed Grooming Comb',manufacturerBrand:null,packCount:1},requestedClassification:'EXACT',reviewReason:'Fixture visual review has two structural matches.'}
  const visualComparison={outcome:'SUPPORTS_CLOSE',reasonCodes:['VISUAL_SIMILARITY_SUPPORT_CLOSE_ONLY'],evidenceIds:[goldenDigest('fixture-visual')],visualSimilaritySupport:true,exactAuthority:false}
  const result=classifyGoldenComparable({productName:'Supplier De-Matting Tool',manufacturerBrand:null,packCount:1},evidence,{visualComparison})
  assert.equal(result.classification,'CLOSE')
  assert.ok(result.reasonCodes.includes('VISUAL_EVIDENCE_CANNOT_PROVE_EXACT'))
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
  input.fulfillment.supplierQuantity=2
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
