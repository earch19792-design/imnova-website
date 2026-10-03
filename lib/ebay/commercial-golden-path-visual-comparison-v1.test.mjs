import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGoldenVisualComparisonEvidenceV1,
  goldenVisualComparisonForMarketEvidenceV1,
  isGoldenVisualComparisonEvidenceV1,
} from './commercial-golden-path-visual-comparison-v1.ts'
import { goldenDigest } from './commercial-golden-path-domain-v1.ts'

const now = new Date('2026-10-03T18:40:00Z')
const candidate = { productId:'9220801986784', variantId:'48809603137760',
  supplierSku:'ITEM6127', supplierQuantity:1 }
const accountKey = 'fixture-account'
const ownerUserId = '10000000-0000-4000-8000-000000000002'
const sourceFingerprint = goldenDigest('fixture-visual-source')
const canonicalUrl = 'https://lunaportex.com/products/safari-de-matting-comb'
const marketEvidence = { evidenceId:goldenDigest('fixture-market-row'),
  listingState:'SOLD', sourceLocator:'https://www.ebay.com/sh/research?fixture=1',
  sourceDigest:goldenDigest('fixture-market-screenshot') }

const fact = (factClass,value,confidence='HIGH') => ({ factClass,value,confidence,
  evidenceStatement:`Fixture observation records ${factClass} as ${value}.` })

function supplier(overrides={}) {
  return { sourceRole:'SUPPLIER_IMAGE',mediaReference:'sha256:supplier-image',
    sourceLocator:canonicalUrl,sourceDigest:goldenDigest('supplier-image'),
    capturedAt:'2026-10-03T16:41:37.0224509Z',method:'OWNER_REVIEWED',
    methodVersion:'OWNER_VISUAL_REVIEW_V1',imageWidthPixels:738,imageHeightPixels:739,
    subjectRegionWidthPixels:680,subjectRegionHeightPixels:680,cropStatus:'FULL_FRAME',
    facts:[fact('VISIBLE_BRAND_MARKING','SAFARI'),fact('PRODUCT_SHAPE','CURVED COMB HEAD'),
      fact('COLOR_PATTERN','GREEN AND BLACK'),fact('HANDLE_DESIGN','BLACK RUBBERIZED HANDLE')],
    ...overrides }
}

function marketplace(overrides={}) {
  return { sourceRole:'MARKETPLACE_SOLD_IMAGE',mediaReference:'sha256:market-image#region=1',
    sourceLocator:marketEvidence.sourceLocator,sourceDigest:marketEvidence.sourceDigest,
    capturedAt:'2026-10-03T16:45:00Z',method:'OWNER_REVIEWED',
    methodVersion:'OWNER_VISUAL_REVIEW_V1',imageWidthPixels:1200,imageHeightPixels:800,
    subjectRegionWidthPixels:500,subjectRegionHeightPixels:500,cropStatus:'FULL_FRAME',
    facts:[fact('VISIBLE_BRAND_MARKING','SAFARI'),fact('PRODUCT_SHAPE','CURVED COMB HEAD'),
      fact('COLOR_PATTERN','GREEN AND BLACK'),fact('HANDLE_DESIGN','BLACK RUBBERIZED HANDLE')],
    ...overrides }
}

const relation = (factClass,relationValue,confidence='HIGH') => ({ factClass,
  relation:relationValue,confidence,
  evidenceStatement:`Fixture comparison records ${factClass} as ${relationValue}.` })

function build(marketplaceObservation=marketplace(), relations=[
  relation('PRODUCT_SHAPE','MATCH'), relation('COLOR_PATTERN','MATCH'),
  relation('HANDLE_DESIGN','MATCH'),
]) {
  return buildGoldenVisualComparisonEvidenceV1({ candidate,accountKey,ownerUserId,
    sourceFingerprint,canonicalUrl,supplierObservation:supplier(),
    comparisons:[{marketEvidence,marketplaceObservation,relations}],
    operatorAttested:true,now })[0]
}

test('two structural facts with sufficient full-frame pixels support CLOSE only',()=>{
  const evidence=build()
  assert.equal(evidence.outcome,'SUPPORTS_CLOSE')
  assert.equal(evidence.visualSimilaritySupport,true)
  assert.equal(evidence.exactAuthority,false)
  assert.equal(evidence.manufacturerBrandInferred,false)
  assert.ok(!JSON.stringify(evidence).includes('EXACT_PRODUCT_MATCH'))
  assert.equal(isGoldenVisualComparisonEvidenceV1({evidence,candidate,accountKey,
    ownerUserId,sourceFingerprint,canonicalUrl,marketEvidence,now}),true)
})

test('similar logos or markings alone are a false-positive guard and remain INCONCLUSIVE',()=>{
  const observation=marketplace({facts:[fact('VISIBLE_LOGO','SAFARI')]})
  const evidence=build(observation,[relation('VISIBLE_LOGO','MATCH')])
  assert.equal(evidence.outcome,'INCONCLUSIVE')
  assert.ok(evidence.reasonCodes.includes('VISUAL_CORROBORATION_INSUFFICIENT'))
})

test('a matching logo cannot hide a high-confidence structural contradiction',()=>{
  const observation=marketplace({facts:[fact('VISIBLE_LOGO','SAFARI'),
    fact('PRODUCT_SHAPE','STRAIGHT PIN BRUSH')]})
  const evidence=build(observation,[relation('VISIBLE_LOGO','MATCH'),
    relation('PRODUCT_SHAPE','CONFLICT')])
  assert.equal(evidence.outcome,'CONTRADICTS')
  assert.ok(evidence.reasonCodes.includes('VISUAL_STRUCTURAL_CONTRADICTION'))
})

test('cropped comparisons and low-resolution thumbnails cannot support CLOSE',()=>{
  const cropped=build(marketplace({cropStatus:'CROPPED'}))
  assert.equal(cropped.outcome,'INCONCLUSIVE')
  const thumbnail=build(marketplace({subjectRegionWidthPixels:97,
    subjectRegionHeightPixels:97}))
  assert.equal(thumbnail.outcome,'INCONCLUSIVE')
  assert.ok(thumbnail.reasonCodes.includes('VISUAL_QUALITY_INSUFFICIENT'))
})

test('an explicit 2-pack signal remains a contradiction even in a small thumbnail',()=>{
  const observation=marketplace({subjectRegionWidthPixels:97,
    subjectRegionHeightPixels:97,facts:[fact('VISIBLE_TEXT','2 PACK'),
      fact('VISIBLE_PACKAGING','TWO COMBS IN RETAIL PACKAGE'),
      fact('EXPLICIT_OFFER_QUANTITY','2')]})
  const evidence=build(observation,[relation('EXPLICIT_OFFER_QUANTITY','CONFLICT')])
  assert.equal(evidence.outcome,'CONTRADICTS')
  assert.ok(evidence.reasonCodes.includes('MARKETPLACE_MULTIPACK_TARGET_OFFER_COUNT_UNPROVEN'))
  assert.equal(evidence.offerDifferenceHidden,false)
})

test('read projection is candidate/source/market-bound and never creates EXACT',()=>{
  const evidence=build()
  const projection=goldenVisualComparisonForMarketEvidenceV1({evidence:[evidence],
    candidate,accountKey,ownerUserId,sourceFingerprint,canonicalUrl,marketEvidence,now})
  assert.equal(projection.outcome,'SUPPORTS_CLOSE')
  assert.equal(projection.exactAuthority,false)
  assert.equal(goldenVisualComparisonForMarketEvidenceV1({evidence:[evidence],
    candidate,accountKey,ownerUserId:'different-owner',sourceFingerprint,
    canonicalUrl,marketEvidence,now}),null)
  assert.equal(isGoldenVisualComparisonEvidenceV1({evidence:{...evidence,
    outcome:'CONTRADICTS'},candidate,accountKey,ownerUserId,sourceFingerprint,
    canonicalUrl,marketEvidence,now}),false)
})
