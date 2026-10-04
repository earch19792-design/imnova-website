import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  classifyRapidStockingEvaluationV1,
  SELLER_OS_RAPID_STOCKING_POLICY_V1,
} from './commercial-rapid-stocking-policy-v1.ts'

const candidate = { productId: '1', variantId: '2', supplierSku: 'PET-1',
  supplierQuantity: 1 }

test('rapid stocking permanently requires unit first and at least four dollars', () => {
  assert.equal(SELLER_OS_RAPID_STOCKING_POLICY_V1.minimumExpectedNetProfitUsd, 4)
  assert.equal(SELLER_OS_RAPID_STOCKING_POLICY_V1.targetQualifiedDrafts, 10)
  assert.equal(SELLER_OS_RAPID_STOCKING_POLICY_V1.rules.unitFirst, true)
  assert.equal(SELLER_OS_RAPID_STOCKING_POLICY_V1.rules.packSizesAreNeverInvented, true)
})

test('only GO evaluations at the profit floor classify as qualified drafts', () => {
  assert.equal(classifyRapidStockingEvaluationV1({ decision: 'GO', candidate,
    economics: { expectedNetProfit: 4 }, reasonCodes: [] }),
  'PROVEN_UNIT_DRAFT')
  assert.equal(classifyRapidStockingEvaluationV1({ decision: 'GO',
    candidate: { ...candidate, supplierQuantity: 2 },
    economics: { expectedNetProfit: 5 }, reasonCodes: [] }),
  'PROVEN_PACK_DRAFT')
  assert.equal(classifyRapidStockingEvaluationV1({ decision: 'REJECT', candidate,
    economics: { expectedNetProfit: 3.99 },
    reasonCodes: ['SOLD_MARKET_DOES_NOT_SUPPORT_TARGET_NET'] }),
  'REJECT_MARGIN')
})

test('a no-history product is a controlled test candidate and is never called proven', () => {
  assert.equal(classifyRapidStockingEvaluationV1({ decision: 'UNPROVEN', candidate,
    economics: { expectedNetProfit: null },
    reasonCodes: ['EXACT_CLOSE_REALIZED_SOLD_UNPROVEN'] }),
  'CONTROLLED_TEST_CANDIDATE')
})

test('shipping is never fixed or recalculated outside Luna Shipping Capture', () => {
  const runtime = readFileSync(new URL(
    './commercial-golden-path-runtime-v1.ts', import.meta.url), 'utf8')
  assert.match(runtime, /readCommercialTraceShippingReceiptV1/)
  assert.match(runtime, /readLunaShippingQty1OpportunityReceiptV1/)
  assert.match(runtime, /ensureLunaShippingQty1OpportunityJobV1/)
  assert.match(runtime, /LUNA_SHIPPING_CAPTURE_EXTENSION/)
  assert.match(runtime, /LUNA_SHIPPING_CAPTURE_REQUIRED/)
  assert.doesNotMatch(runtime, /amountUsdPerOrder|9\.99|ownerFlatShipping/)
  assert.doesNotMatch(runtime, /attemptLunaAuthenticatedHttpShippingQuoteV1/)
})

test('a durable shipping job wakes Luna Shipping Capture without waiting for idle backoff', () => {
  const analysis = readFileSync(new URL(
    '../../app/admin/ebay/opportunity-queue/research/autonomous-category-analysis-v1.tsx',
    import.meta.url), 'utf8')
  const worker = readFileSync(new URL(
    '../../app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx',
    import.meta.url), 'utf8')
  assert.match(analysis, /publishSellerOsLunaShippingDurableWorkSignalV1/)
  assert.match(worker, /readSellerOsLunaShippingDurableWorkSignalV1/)
  assert.match(worker, /confirmDurableWorkSignal\(\)/)
  assert.match(worker, /attemptProductionAcquisition\(\)/)
})

test('stocking and Luna shipping renew a rejected owner session once', () => {
  const authenticatedFetch = readFileSync(new URL(
    '../seller-os/seller-os-authenticated-fetch-v1.ts', import.meta.url), 'utf8')
  const analysis = readFileSync(new URL(
    '../../app/admin/ebay/opportunity-queue/research/autonomous-category-analysis-v1.tsx',
    import.meta.url), 'utf8')
  const worker = readFileSync(new URL(
    '../../app/admin/ebay/luna-shipping-capture/luna-shipping-capture-control-plane.tsx',
    import.meta.url), 'utf8')
  assert.match(authenticatedFetch, /initialResponse\.status !== 401/)
  assert.match(authenticatedFetch, /supabase\.auth\.refreshSession\(\)/)
  assert.match(authenticatedFetch, /\/api\/admin\/session/)
  assert.match(analysis, /sellerOsAuthenticatedFetchV1/)
  assert.match(worker, /sellerOsAuthenticatedFetchV1/)
})
