import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyRapidStockingEvaluationV1,
  SELLER_OS_RAPID_STOCKING_POLICY_V1,
} from './commercial-rapid-stocking-policy-v1.ts'
import {
  resolveOwnerLunaFlatShippingV1,
  SELLER_OS_LUNA_FLAT_SHIPPING_POLICY_V1,
} from './commercial-golden-path-owner-shipping-policy-v1.ts'

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

test('owner flat shipping is 9.99 per order and covers direct US fulfillment once', () => {
  const result = resolveOwnerLunaFlatShippingV1({
    accountKey: SELLER_OS_LUNA_FLAT_SHIPPING_POLICY_V1.marketplaceAccountKey,
    candidate: { ...candidate, supplierQuantity: 3 },
    source: { product_id: '1', variant_id: '2', sku: 'PET-1',
      source_fingerprint: `sha256:${'a'.repeat(64)}` },
    now: new Date('2026-10-03T12:00:00.000Z'),
  })
  assert.equal(result?.shipping.amountUsd, 9.99)
  assert.equal(result?.shipping.quantityBasis, 'PER_ORDER_NOT_PER_UNIT')
  assert.equal(result?.fulfillment.amountUsd, 0)
  assert.equal(result?.fulfillment.supplierShippingReceiptId,
    result?.shipping.receiptId)
})
