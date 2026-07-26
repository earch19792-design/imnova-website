import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY,
  evaluateEbayLunaSelectorCandidateV2,
  isCommercialDiscoveryLane,
  selectEbayLunaBatchV2,
} from "./ebay-luna-selector-v2-domain.ts"

const now = new Date("2026-07-26T16:00:00.000Z")

function candidate(index, overrides = {}) {
  const base = {
    candidateKey: `candidate-${index}`,
    productId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    supplierProductId: `luna-${index}`,
    supplierVariantId: `variant-${index}`,
    supplierSku: `SKU-${index}`,
    familyKey: `family-${index}`,
    categoryId: `category-${index}`,
    lane: "coverage",
    currentOpportunityScore: 80,
    lastDeepAnalyzedAt: "2026-07-01T00:00:00.000Z",
    supplier: {
      productCurrent: true,
      exactVariant: true,
      numericStock: 20,
      costUsd: 10,
      observedAt: "2026-07-26T12:00:00.000Z",
      rotationClass: "HIGH_CONFIDENCE",
      readinessScore: 90,
      rotationScore: 85,
      confidenceScore: 90,
    },
    demand: {
      evidenceClass: "CONFIRMED_SOLD_EXACT",
      reviewed: true,
      exactIdentity: true,
      samePack: true,
      sameSize: true,
      sameVariant: true,
      sameCondition: true,
      soldExactUnits: 12,
      soldExactSellerCount: 3,
      soldExactComparableCount: 4,
      observedAt: "2026-07-20T12:00:00.000Z",
      score: 90,
      confidenceScore: 92,
    },
    economics: {
      landedSoldPriceComplete: true,
      netProfitUsd: 8,
      marginRate: 0.25,
      roiRate: 0.5,
      safeFloorUsd: 25,
      targetPriceUsd: 32,
      score: 88,
    },
    operational: {
      categoryValid: true,
      complianceResolved: true,
      weightResolved: true,
      dimensionsResolved: true,
      imagesAuthorized: true,
      listingFactsComplete: true,
      score: 90,
    },
    risk: { score: 10, blockerCodes: [] },
    confidenceScore: 90,
  }
  return {
    ...base,
    ...overrides,
    supplier: { ...base.supplier, ...(overrides.supplier ?? {}) },
    demand: { ...base.demand, ...(overrides.demand ?? {}) },
    economics: { ...base.economics, ...(overrides.economics ?? {}) },
    operational: { ...base.operational, ...(overrides.operational ?? {}) },
    risk: { ...base.risk, ...(overrides.risk ?? {}) },
  }
}

test("ACTIVE_ONLY with one hundred sellers cannot validate demand", () => {
  const evaluation = evaluateEbayLunaSelectorCandidateV2(candidate(1, {
    demand: {
      evidenceClass: "ACTIVE_ONLY",
      soldExactUnits: 100,
      soldExactSellerCount: 100,
      soldExactComparableCount: 100,
      score: 100,
    },
  }), { now })
  assert.equal(evaluation.readyToList, false)
  assert.equal(evaluation.ebayDemandScore, 0)
  assert.match(evaluation.hardGateCodes.join(","), /CONFIRMED_SOLD_EXACT_REQUIRED/)
  assert.equal(evaluation.canReceivePromotion, false)
})

test("estimated rotation remains research-only", () => {
  const evaluation = evaluateEbayLunaSelectorCandidateV2(candidate(2, {
    demand: {
      evidenceClass: "OBSERVED_ESTIMATED_ROTATION",
      soldExactUnits: 50,
      score: 95,
    },
  }), { now })
  assert.equal(evaluation.readyToList, false)
  assert.equal(evaluation.ebayDemandScore, 0)
  assert.equal(evaluation.eligibleForExploration, true)
})

test("confirmed exact sold evidence passes only with every hard gate", () => {
  const accepted = evaluateEbayLunaSelectorCandidateV2(candidate(3), { now })
  const wrongPack = evaluateEbayLunaSelectorCandidateV2(candidate(4, {
    demand: { samePack: false },
  }), { now })
  assert.equal(accepted.readyToList, true)
  assert.equal(wrongPack.readyToList, false)
  assert.match(wrongPack.hardGateCodes.join(","), /EXACT_PACK_REQUIRED/)
})

test("missing and stale values fail closed instead of receiving neutral points", () => {
  const evaluation = evaluateEbayLunaSelectorCandidateV2(candidate(5, {
    supplier: { numericStock: null, costUsd: null, observedAt: null },
    demand: { observedAt: null, soldExactUnits: null },
    confidenceScore: null,
  }), { now })
  assert.equal(evaluation.readyToList, false)
  assert.equal(evaluation.confidenceScore, 0)
  assert.match(evaluation.hardGateCodes.join(","), /LUNA_FRESH_NUMERIC_STOCK_REQUIRED/)
  assert.match(evaluation.hardGateCodes.join(","), /LUNA_FRESH_COST_REQUIRED/)
})

test("a sold benchmark below the safe floor remains blocked", () => {
  const evaluation = evaluateEbayLunaSelectorCandidateV2(candidate(6, {
    economics: { targetPriceUsd: 24, safeFloorUsd: 25 },
  }), { now })
  assert.equal(evaluation.readyToList, false)
  assert.match(evaluation.hardGateCodes.join(","), /SAFE_PRICE_FLOOR_NOT_MET/)
})

test("maintenance lanes do not consume the commercial batch", () => {
  assert.equal(isCommercialDiscoveryLane("protection"), false)
  assert.equal(isCommercialDiscoveryLane("event"), false)
  assert.equal(isCommercialDiscoveryLane("hot"), true)
  assert.equal(isCommercialDiscoveryLane("baseline"), true)
  assert.equal(isCommercialDiscoveryLane("coverage"), true)
})

test("the selector returns fewer than five instead of filling with weak products", () => {
  const evaluations = [
    candidate(10),
    candidate(11),
    candidate(12, { demand: { evidenceClass: "ACTIVE_ONLY" } }),
  ].map((row) => evaluateEbayLunaSelectorCandidateV2(row, { now }))
  const batch = selectEbayLunaBatchV2(evaluations)
  assert.equal(batch.ready.length, 2)
  assert.equal(batch.displayed.length, 3)
  assert.equal(batch.exploratory.length, 1)
  assert.equal(batch.unfilledSlots, 2)
  assert.equal(batch.explanation, "QUALIFIED_DEFICIT_CONTINUE_DISCOVERY")
})

test("batch diversity limits one family concentration to two", () => {
  const evaluations = Array.from({ length: 6 }, (_, index) =>
    evaluateEbayLunaSelectorCandidateV2(candidate(20 + index, {
      familyKey: index < 4 ? "same-family" : `family-${index}`,
      categoryId: `category-${index}`,
    }), { now }),
  )
  const batch = selectEbayLunaBatchV2(evaluations)
  assert.equal(batch.ready.filter((row) => row.familyKey === "same-family").length, 2)
  assert.equal(batch.ready.length, 4)
})

test("ranking is deterministic for the same evidence and policy version", () => {
  const evaluations = [
    candidate(33),
    candidate(31),
    candidate(32),
  ].map((row) => evaluateEbayLunaSelectorCandidateV2(row, { now }))
  const first = selectEbayLunaBatchV2(evaluations)
  const second = selectEbayLunaBatchV2([...evaluations].reverse())
  assert.deepEqual(
    first.displayed.map((row) => row.candidateKey),
    second.displayed.map((row) => row.candidateKey),
  )
  assert.equal(first.policyVersion, DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY.policyVersion)
})
