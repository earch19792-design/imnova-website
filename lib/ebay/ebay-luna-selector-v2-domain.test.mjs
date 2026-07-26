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
    consumableResearchBoost: 0,
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
      historicalMarketCheckCompleted: true,
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
  assert.equal(batch.displayed.length, 2)
  assert.equal(batch.bootstrapCanaries.length, 0)
  assert.equal(batch.exploratory.length, 0)
  assert.equal(batch.researchOnly.length, 1)
  assert.equal(batch.unfilledSlots, 3)
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

const bootstrapPolicy = {
  ...DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY,
  policyVersion:
    "EBAY_LUNA_SELECTOR_V2_BOOTSTRAP_CANARY_V1_SHADOW_TEST",
  bootstrapCanaryEnabled: true,
  maximumBootstrapCanaries: 5,
}

function canaryCandidate(index, overrides = {}) {
  return candidate(index, {
    demand: {
      evidenceClass: "ACTIVE_ONLY",
      soldExactUnits: 0,
      soldExactSellerCount: 0,
      soldExactComparableCount: 0,
      ...overrides.demand,
    },
    economics: {
      landedSoldPriceComplete: false,
      ...overrides.economics,
    },
    ...overrides,
  })
}

test("zero validated products can fill five shadow slots with safe canaries", () => {
  const evaluations = Array.from({ length: 5 }, (_, index) =>
    evaluateEbayLunaSelectorCandidateV2(
      canaryCandidate(100 + index),
      { now, policy: bootstrapPolicy },
    ),
  )
  const batch = selectEbayLunaBatchV2(evaluations, bootstrapPolicy)
  assert.equal(batch.ready.length, 0)
  assert.equal(batch.bootstrapCanaries.length, 5)
  assert.equal(batch.displayed.length, 5)
  assert.equal(batch.unfilledSlots, 0)
  assert.equal(batch.explanation, "BOOTSTRAP_CANARY_SHADOW_BATCH_FILLED")
  for (const selected of batch.bootstrapCanaries) {
    assert.equal(selected.selectionMode, "BOOTSTRAP_CANARY")
    assert.equal(selected.forcedListingQuantity, 1)
    assert.equal(selected.promotionRatePercent, 0)
    assert.equal(selected.canDecreasePrice, false)
    assert.equal(selected.canReceivePromotion, false)
    assert.equal(selected.externalWritesAllowed, false)
    assert.equal(selected.commercialMonitorRequired, true)
    assert.equal(selected.oneVariableAtATime, true)
  }
})

test("validated products are selected before bootstrap canaries", () => {
  const evaluations = [
    candidate(200),
    candidate(201),
    candidate(202),
    canaryCandidate(203),
    canaryCandidate(204),
    canaryCandidate(205),
  ].map((row) =>
    evaluateEbayLunaSelectorCandidateV2(row, {
      now,
      policy: bootstrapPolicy,
    }),
  )
  const batch = selectEbayLunaBatchV2(evaluations, bootstrapPolicy)
  assert.equal(batch.ready.length, 3)
  assert.equal(batch.bootstrapCanaries.length, 2)
  assert.deepEqual(
    batch.displayed.slice(0, 3).map((row) => row.selectionMode),
    ["DEMAND_VALIDATED", "DEMAND_VALIDATED", "DEMAND_VALIDATED"],
  )
})

test("five validated products consume all slots without canaries", () => {
  const evaluations = Array.from({ length: 5 }, (_, index) =>
    evaluateEbayLunaSelectorCandidateV2(candidate(300 + index), {
      now,
      policy: bootstrapPolicy,
    }),
  )
  const batch = selectEbayLunaBatchV2(evaluations, bootstrapPolicy)
  assert.equal(batch.ready.length, 5)
  assert.equal(batch.bootstrapCanaries.length, 0)
})

test("every non-demand hard gate blocks a bootstrap canary", () => {
  const blocked = [
    canaryCandidate(401, { supplier: { numericStock: 0 } }),
    canaryCandidate(402, { supplier: { costUsd: null } }),
    canaryCandidate(403, {
      risk: {
        blockerCodes: ["NEED_EXACT_GTIN_OR_BRAND_MPN_MATCH"],
      },
    }),
    canaryCandidate(404, {
      supplier: { exactVariant: false },
    }),
    canaryCandidate(405, { economics: { netProfitUsd: 4.99 } }),
    canaryCandidate(406, { operational: { categoryValid: false } }),
    canaryCandidate(407, { operational: { complianceResolved: false } }),
    canaryCandidate(408, { operational: { weightResolved: false } }),
    canaryCandidate(409, { operational: { dimensionsResolved: false } }),
    canaryCandidate(410, { operational: { imagesAuthorized: false } }),
    canaryCandidate(411, { operational: { listingFactsComplete: false } }),
    canaryCandidate(412, { risk: { score: null } }),
    canaryCandidate(413, {
      demand: { historicalMarketCheckCompleted: false },
    }),
  ].map((row) =>
    evaluateEbayLunaSelectorCandidateV2(row, {
      now,
      policy: bootstrapPolicy,
    }),
  )
  assert.ok(blocked.every((row) => !row.eligibleForBootstrapCanary))
})

test("missing sold comparability does not replace the product identity gate", () => {
  const withoutSoldComparability = evaluateEbayLunaSelectorCandidateV2(
    canaryCandidate(450, {
      demand: {
        exactIdentity: false,
        samePack: false,
        sameSize: false,
        sameVariant: false,
        sameCondition: false,
      },
    }),
    { now, policy: bootstrapPolicy },
  )
  const identityBlocked = evaluateEbayLunaSelectorCandidateV2(
    canaryCandidate(451, {
      risk: {
        blockerCodes: ["NEED_EXACT_GTIN_OR_BRAND_MPN_MATCH"],
      },
    }),
    { now, policy: bootstrapPolicy },
  )
  assert.equal(withoutSoldComparability.eligibleForBootstrapCanary, true)
  assert.equal(identityBlocked.eligibleForBootstrapCanary, false)
})

test("research-only candidates never consume a daily canary slot", () => {
  const incomplete = evaluateEbayLunaSelectorCandidateV2(
    canaryCandidate(500, {
      operational: { imagesAuthorized: false },
    }),
    { now, policy: bootstrapPolicy },
  )
  const batch = selectEbayLunaBatchV2([incomplete], bootstrapPolicy)
  assert.equal(incomplete.eligibleForResearch, true)
  assert.equal(incomplete.eligibleForBootstrapCanary, false)
  assert.equal(batch.displayed.length, 0)
  assert.equal(batch.researchOnly.length, 1)
})

test("consumable boost only orders already eligible research and is capped", () => {
  const boosted = evaluateEbayLunaSelectorCandidateV2(
    canaryCandidate(601, { consumableResearchBoost: 99 }),
    { now, policy: bootstrapPolicy },
  )
  const plain = evaluateEbayLunaSelectorCandidateV2(
    canaryCandidate(600),
    { now, policy: bootstrapPolicy },
  )
  assert.equal(boosted.consumableResearchBoost, 5)
  assert.equal(boosted.ebayDemandScore, 0)
  assert.equal(
    boosted.researchPriorityScore,
    Math.min(100, boosted.researchEligibilityScore + 5),
  )
  const batch = selectEbayLunaBatchV2([plain, boosted], {
    ...bootstrapPolicy,
    targetBatchSize: 1,
  })
  assert.equal(batch.bootstrapCanaries[0].candidateKey, boosted.candidateKey)
  const ineligible = evaluateEbayLunaSelectorCandidateV2(
    canaryCandidate(602, {
      consumableResearchBoost: 5,
      operational: { imagesAuthorized: false },
    }),
    { now, policy: bootstrapPolicy },
  )
  assert.equal(ineligible.eligibleForBootstrapCanary, false)
})
