import assert from 'node:assert/strict'
import test from 'node:test'
import {
  planGoldenPackFallbackV1,
  SELLER_OS_UNIT_FIRST_PACK_POLICY_V1,
} from './commercial-golden-path-pack-policy-v1.ts'

const family = (packCount, soldQuantity, evidenceId = `sold-pack-${packCount}`) => ({
  evidenceId,
  listingState: 'SOLD',
  reviewed: true,
  identity: { packCount },
  soldQuantity,
  fresh: true,
  reasonCodes: ['OFFER_COUNT_MISMATCH'],
})

const unit = (changes = {}) => ({
  candidate: { supplierQuantity: 1 },
  decision: 'REJECT',
  reasonCodes: ['CONTRIBUTION_MARGIN_BELOW_15_PERCENT'],
  offer: { includedCount: 1 },
  economics: { expectedNetProfit: 2,
    economicPolicyEvaluation: { passesPolicy: false } },
  market: { familyEvidence: [family(5, 2), family(2, 10), family(3, 4)] },
  ...changes,
})

test('Seller OS uses the shared ROI/margin policy and evaluates the unit before packs', () => {
  assert.equal(SELLER_OS_UNIT_FIRST_PACK_POLICY_V1.minimumNetProfitUsd, 0)
  assert.equal(SELLER_OS_UNIT_FIRST_PACK_POLICY_V1.economicPolicy.minimumMonetaryProfitUsd, null)
  assert.equal(SELLER_OS_UNIT_FIRST_PACK_POLICY_V1.economicPolicy.minimumEstimatedRoiPercent, 30)
  assert.equal(SELLER_OS_UNIT_FIRST_PACK_POLICY_V1.economicPolicy.minimumContributionMarginPercent, 15)
  assert.deepEqual(SELLER_OS_UNIT_FIRST_PACK_POLICY_V1.sequence,
    ['SINGLE_UNIT', 'MARKET_EVIDENCED_PACK_FALLBACK'])
  const result = planGoldenPackFallbackV1(unit({ decision: 'GO',
    economics: { expectedNetProfit: 1,
      economicPolicyEvaluation: { passesPolicy: true } } }))
  assert.equal(result.status, 'NOT_NEEDED')
  assert.equal(result.scenarios.length, 0)
})

test('pack sizes come from reviewed SOLD evidence and are ordered by demand', () => {
  const result = planGoldenPackFallbackV1(unit())
  assert.equal(result.status, 'PLANNED')
  assert.deepEqual(result.scenarios.map(scenario => scenario.supplierQuantity), [2, 3, 5])
  assert.deepEqual(result.scenarios.map(scenario => scenario.demandScore), [10, 4, 2])
  assert.equal(result.scenarios.some(scenario => scenario.supplierQuantity === 6), false)
  assert.equal(result.scenarios.some(scenario => scenario.supplierQuantity === 12), false)
})

test('pack fallback fails closed without base count, same-product pack sales, or safe product state', () => {
  assert.equal(planGoldenPackFallbackV1(unit({ offer: { includedCount: null } })).status, 'BLOCKED')
  assert.equal(planGoldenPackFallbackV1(unit({ market: { familyEvidence: [] } })).status, 'NO_MARKET_EVIDENCE')
  assert.equal(planGoldenPackFallbackV1(unit({ market: { familyEvidence: [{ ...family(2, 5), reviewed: false }] } })).status, 'NO_MARKET_EVIDENCE')
  for (const reasonCode of [
    'DUPLICATE_IMNOVA_LIVE',
    'LUNA_IDENTITY_PRODUCT_TRUTH_UNPROVEN',
    'PRODUCT_TRUTH_CONTRADICTION',
    'SUPPLIER_BASE_INCLUDED_UNIT_COUNT_CONFLICT',
    'SUPPLIER_OUT_OF_STOCK',
  ]) {
    assert.equal(planGoldenPackFallbackV1(unit({ reasonCodes: [reasonCode] })).status, 'BLOCKED')
  }
})

test('one supplier offer containing two units maps an observed six-count sale to quantity three', () => {
  const result = planGoldenPackFallbackV1(unit({
    offer: { includedCount: 2 },
    market: { familyEvidence: [family(6, 7)] },
  }))
  assert.equal(result.status, 'PLANNED')
  assert.deepEqual(result.scenarios.map(scenario => ({
    supplierQuantity: scenario.supplierQuantity,
    includedCount: scenario.includedCount,
  })), [{ supplierQuantity: 3, includedCount: 6 }])
})
