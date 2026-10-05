import assert from "node:assert/strict"
import test from "node:test"

const {
  assessTeoOfficialReadbackV1,
  buildTeoListingPriceDecisionV1,
  evaluateTeoExperimentOutcomeV1,
  recommendTeoListingActionV1,
} = await import("./teo-owner-listing-experiment-v1.ts")

function priceDecision(overrides = {}) {
  return buildTeoListingPriceDecisionV1({
    currentItemPrice: 40,
    currentBuyerShipping: 0,
    supplierCost: 5,
    supplierShipping: 3,
    otherExplicitCosts: 1,
    currentExpectedNetProfit: 20,
    economicsProven: true,
    competitiveLandedPrice: 25,
    competitiveEvidence: "CONFIRMED_SOLD",
    ...overrides,
  })
}

const baselineListing = {
  title: "Original title",
  price: 29.99,
  currency: "USD",
  categoryId: "123",
  conditionId: "1000",
  shippingPrice: 0,
  shippingCurrency: "USD",
  listingStatus: "Active",
  sku: "SKU-1",
  observedAt: "2026-10-01T00:00:00.000Z",
}

function performance(overrides = {}) {
  return {
    reportDateFrom: "2026-09-01",
    reportDateTo: "2026-09-14",
    totalImpressions: 500,
    searchImpressions: 400,
    totalViews: 50,
    searchViews: 20,
    transactions: 1,
    observedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  }
}

test("owner confirmation alone cannot satisfy official readback", () => {
  const assessment = assessTeoOfficialReadbackV1({
    targetVariable: "TITLE",
    baseline: baselineListing,
    observed: {
      ...baselineListing,
      observedAt: "2026-10-02T00:00:00.000Z",
    },
  })
  assert.equal(assessment.readbackStatus, "PENDING_READBACK")
  assert.equal(assessment.attributionStatus, "UNASSESSED")
  assert.equal(assessment.targetChangeObserved, false)
})

test("one official target change is clean and verifiable", () => {
  const assessment = assessTeoOfficialReadbackV1({
    targetVariable: "TITLE",
    baseline: baselineListing,
    observed: {
      ...baselineListing,
      title: "A clearer search title",
      observedAt: "2026-10-02T00:00:00.000Z",
    },
  })
  assert.equal(assessment.readbackStatus, "VERIFIED_ON_EBAY")
  assert.equal(assessment.attributionStatus, "CLEAN_SINGLE_VARIABLE")
  assert.deepEqual(assessment.changedVariables, ["TITLE"])
})

test("multiple changes are verified but contaminated", () => {
  const assessment = assessTeoOfficialReadbackV1({
    targetVariable: "TITLE",
    baseline: baselineListing,
    observed: {
      ...baselineListing,
      title: "Changed title",
      price: 24.99,
      observedAt: "2026-10-02T00:00:00.000Z",
    },
  })
  assert.equal(assessment.readbackStatus, "VERIFIED_ON_EBAY")
  assert.equal(
    assessment.attributionStatus,
    "CONTAMINATED_MULTIPLE_VARIABLES",
  )
  assert.deepEqual(assessment.changedVariables, ["TITLE", "PRICE"])
})

test("a different price does not verify the exact TEO price target", () => {
  const assessment = assessTeoOfficialReadbackV1({
    targetVariable: "PRICE",
    expectedPrice: 24.99,
    baseline: baselineListing,
    observed: {
      ...baselineListing,
      price: 25.99,
      observedAt: "2026-10-02T00:00:00.000Z",
    },
  })
  assert.equal(assessment.readbackStatus, "PENDING_READBACK")
  assert.equal(assessment.targetChangeObserved, true)
  assert.equal(assessment.reasonCode, "EXPECTED_PRICE_NOT_OBSERVED_YET")
})

test("TEO diagnoses visibility before conversion", () => {
  const recommendation = recommendTeoListingActionV1({
    listingStatus: "active",
    performance: performance({ totalImpressions: 30, totalViews: 0,
      searchImpressions: 30, searchViews: 0, transactions: 0 }),
  })
  assert.equal(recommendation.action, "IMPROVE")
  assert.equal(recommendation.variable, "TITLE")
  assert.equal(recommendation.diagnosisClass, "VISIBILITY")
})

test("TEO recommends price only when traffic exists without sales", () => {
  const recommendation = recommendTeoListingActionV1({
    listingStatus: "active",
    performance: performance({ totalViews: 50, searchImpressions: 400,
      searchViews: 20, transactions: 0 }),
  })
  assert.equal(recommendation.action, "IMPROVE")
  assert.equal(recommendation.variable, "PRICE")
  assert.equal(recommendation.diagnosisClass, "CONVERSION")
})

test("replacement requires repeated evidence", () => {
  const recommendation = recommendTeoListingActionV1({
    listingStatus: "active",
    performance: performance({ totalImpressions: 0 }),
    consecutiveZeroImpressionWindows: 2,
  })
  assert.equal(recommendation.action, "REPLACE_CANDIDATE")
  assert.equal(recommendation.reasonCode, "TWO_ZERO_IMPRESSION_WINDOWS")
})

test("a contaminated experiment can never be learned as positive", () => {
  const outcome = evaluateTeoExperimentOutcomeV1({
    variable: "TITLE",
    baseline: performance({ totalImpressions: 100 }),
    current: performance({ totalImpressions: 900 }),
    attributionStatus: "CONTAMINATED_MULTIPLE_VARIABLES",
  })
  assert.equal(outcome.result, "INCONCLUSIVE")
  assert.equal(outcome.delta, null)
})

test("a complete clean post-change window can produce a positive result", () => {
  const outcome = evaluateTeoExperimentOutcomeV1({
    variable: "PRICE",
    baseline: performance({ transactions: 0 }),
    current: performance({ transactions: 2 }),
    attributionStatus: "CLEAN_SINGLE_VARIABLE",
  })
  assert.equal(outcome.result, "POSITIVE")
  assert.equal(outcome.metric, "QUANTITY_SOLD")
  assert.equal(outcome.delta, 2)
})

test("TEO lowers toward competition only above the safe floor", () => {
  const decision = priceDecision()
  assert.equal(decision.status, "READY")
  assert.equal(decision.action, "LOWER_PRICE")
  assert.equal(decision.recommendedFinalItemPrice, 25)
  assert.equal(decision.suggestedDiscountUsd, 15)
  assert.equal(decision.safeToDiscount, true)
  assert.ok(decision.expectedNetProfitAtRecommended >= 4)
})

test("competition below profitability never pulls price below the safe floor", () => {
  const decision = priceDecision({ competitiveLandedPrice: 8 })
  assert.equal(decision.action, "LOWER_PRICE")
  assert.equal(
    decision.recommendedFinalItemPrice,
    decision.minimumSafeItemPrice,
  )
  assert.ok(decision.recommendedFinalItemPrice > 8)
  assert.ok(decision.expectedNetProfitAtRecommended >= 4)
})

test("missing economics never becomes a zero-cost discount authorization", () => {
  const decision = priceDecision({
    supplierCost: null,
    supplierShipping: null,
    otherExplicitCosts: null,
    currentExpectedNetProfit: -2,
    economicsProven: false,
    persistedStandardFloorLandedPrice: null,
  })
  assert.equal(decision.status, "PARTIAL")
  assert.equal(decision.action, "WAIT_FOR_EVIDENCE")
  assert.equal(decision.minimumSafeItemPrice, null)
  assert.equal(decision.suggestedDiscountUsd, null)
  assert.equal(decision.currentExpectedNetProfit, -2)
  assert.equal(decision.safeToDiscount, false)
})

test("active market prices remain explicitly distinct from confirmed sales", () => {
  const decision = priceDecision({ competitiveEvidence: "ACTIVE_MARKET" })
  assert.equal(decision.competitiveEvidence, "ACTIVE_MARKET")
  assert.ok(decision.reasonCodes.includes(
    "ACTIVE_OFFERS_ARE_NOT_CONFIRMED_SALES",
  ))
})
