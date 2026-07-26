import assert from "node:assert/strict"
import test from "node:test"

import {
  EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
  EBAY_CONFIRMED_SOLD_EVIDENCE_MAX_AGE_DAYS,
  evaluateEbayActiveListingCommercialPolicy,
} from "./ebay-active-listing-commercial-policy.ts"

const evaluatedAt = "2026-07-26T12:00:00.000Z"

function approvedConfirmedSold(overrides = {}) {
  return {
    evidenceClass: "CONFIRMED_SOLD_HISTORY",
    evidenceObservedAt: "2026-07-25T12:00:00.000Z",
    evaluatedAt,
    confirmedSoldQuantity: 3,
    confirmedSoldSource: "EBAY_PRODUCT_RESEARCH_CONFIRMED_SOLD",
    identityExact: true,
    samePresentation: true,
    sameCondition: true,
    samePack: true,
    landedPriceComplete: true,
    supplierEvidenceFresh: true,
    supplierAvailable: true,
    proposalCurrent: true,
    economicsApproved: true,
    proposedPriceAtOrAboveFloor: true,
    officialCurrentPriceUnchanged: true,
    humanConfirmation: true,
    idempotencyReady: true,
    readbackReady: true,
    ...overrides,
  }
}

test("ACTIVE_ONLY, actividad estimada y ventas ausentes mantienen precio y promoción cero", () => {
  for (const input of [
    { evidenceClass: "ACTIVE_ONLY", confirmedSoldQuantity: 0 },
    { evidenceClass: "ACTIVE_ONLY", confirmedSoldQuantity: undefined },
    { evidenceClass: "ESTIMATED_ACTIVITY", confirmedSoldQuantity: 100 },
    { evidenceClass: undefined, confirmedSoldQuantity: undefined },
  ]) {
    const result = evaluateEbayActiveListingCommercialPolicy(input)
    assert.equal(result.decision, "HOLD_PRICE_NO_PROMOTION")
    assert.equal(result.capability, "blocked")
    assert.equal(result.canPreparePriceDecrease, false)
    assert.equal(result.canPreparePromotion, false)
    assert.deepEqual(result.blockerCodes, [
      "CONFIRMED_SOLD_EVIDENCE_REQUIRED",
    ])
    assert.equal(result.policyVersion,
      EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION)
  }
})

test("venta confirmada reciente y comparable habilita precio pero no promoción implícita", () => {
  const result = evaluateEbayActiveListingCommercialPolicy(
    approvedConfirmedSold(),
  )
  assert.equal(result.decision, "EVALUATE_CONFIRMED_SOLD_PRICE")
  assert.equal(result.capability, "enabled")
  assert.equal(result.canPreparePriceDecrease, true)
  assert.equal(result.canPreparePromotion, false)
  assert.deepEqual(result.blockerCodes, [])
  assert.equal(result.evidenceExpiresAt, "2026-10-23T12:00:00.000Z")
  assert.equal(EBAY_CONFIRMED_SOLD_EVIDENCE_MAX_AGE_DAYS, 90)
})

test("venta vencida, pack distinto o landed price incompleto bloquean", () => {
  const stale = evaluateEbayActiveListingCommercialPolicy(
    approvedConfirmedSold({
      evidenceObservedAt: "2026-04-26T11:59:59.000Z",
    }),
  )
  assert.equal(stale.canPreparePriceDecrease, false)
  assert.ok(stale.blockerCodes.includes("CONFIRMED_SOLD_EVIDENCE_STALE"))

  const mismatched = evaluateEbayActiveListingCommercialPolicy(
    approvedConfirmedSold({
      samePack: false,
      landedPriceComplete: false,
    }),
  )
  assert.ok(mismatched.blockerCodes.includes("SAME_PACK_REQUIRED"))
  assert.ok(mismatched.blockerCodes.includes("LANDED_PRICE_REQUIRED"))
})

test("evidencia Luna protectora usa rutas independientes", () => {
  const increase = evaluateEbayActiveListingCommercialPolicy({
    evidenceClass: "LUNA_COST_CHANGED",
    evidenceObservedAt: evaluatedAt,
    protectiveEvidenceVerified: true,
    exactLunaIdentity: true,
    supplierEvidenceFresh: true,
    supplierAvailable: true,
    economicsApproved: true,
    proposedPriceAtOrAboveFloor: true,
    officialCurrentPriceUnchanged: true,
    humanConfirmation: true,
    idempotencyReady: true,
    readbackReady: true,
  })
  assert.equal(increase.canPrepareProtectivePriceIncrease, true)
  assert.equal(increase.canPreparePriceDecrease, false)
  assert.equal(increase.canPreparePromotion, false)

  const stockOut = evaluateEbayActiveListingCommercialPolicy({
    evidenceClass: "LUNA_OUT_OF_STOCK",
    evidenceObservedAt: evaluatedAt,
    protectiveEvidenceVerified: true,
    exactLunaIdentity: true,
    supplierEvidenceFresh: true,
    exactLunaStock: 0,
    humanConfirmation: true,
    idempotencyReady: true,
    readbackReady: true,
  })
  assert.equal(stockOut.decision, "END_LISTING_OUT_OF_STOCK")
  assert.equal(stockOut.canEndForOutOfStock, true)
  assert.equal(stockOut.canPreparePriceDecrease, false)
})
