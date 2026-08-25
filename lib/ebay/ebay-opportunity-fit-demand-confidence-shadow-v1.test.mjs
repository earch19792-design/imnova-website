import assert from "node:assert/strict"
import test from "node:test"

const subject = await import("./ebay-opportunity-fit-demand-confidence-shadow-v1.ts")

const ids = {
  microcurrent: `sha256:${"1".repeat(64)}`,
  tesla1430: `sha256:${"2".repeat(64)}`,
  tesla1450: `sha256:${"3".repeat(64)}`,
}

function fitStrong() {
  return {
    sameCustomerProblem: true,
    sameFunctionalUseCase: true,
    sameProductClass: true,
    compatibleSubtype: true,
    requiredFeatureCoveragePercent: 95,
    categoryCompatibility: true,
    titleOnlyInference: false,
    evidenceReferences: [`sha256:${"a".repeat(64)}`],
  }
}

function identityStrong() {
  return {
    exactLunaProductId: true,
    exactLunaVariantId: true,
    exactSupplierSku: true,
    variantCompatibility: true,
    colorSizePackCompatibility: true,
    titleOnlyInference: false,
    unresolvedAmbiguity: false,
    durableAuthoritativeEvidence: true,
  }
}

function candidate(overrides = {}) {
  return {
    candidateId: ids.tesla1430,
    productName: "Tesla NEMA 14-30 Gen II Mobile Connector Smart Adapter",
    familyName: "Tesla Gen II NEMA adapters",
    opportunityFitEvidence: fitStrong(),
    supplierIdentityEvidence: identityStrong(),
    familyDemandStatus: "PROVEN",
    exactProductDemandStatus: "UNPROVEN",
    exactSubtypeDemandStatus: "UNPROVEN",
    currentHardBlockers: ["EXACT_SUBTYPE_DEMAND_UNPROVEN"],
    upstreamRejected: false,
    upstreamRejectReason: null,
    freshStock: "PASS",
    authoritativeShipping: "PASS",
    economics: "PASS",
    compliance: "PASS",
    commercialPriority: {
      expectedContributionProfitUsd: 9.02,
      contributionMarginPercent: null,
      evidenceQuality: null,
      competitionEvidence: null,
      stockFreshness: 100,
      operationalComplexity: null,
      complianceRisk: null,
    },
    ...overrides,
  }
}

test("D3 changes only the shadow decision when every hard gate passes", () => {
  const result = subject.evaluateOpportunityFitShadowCandidateV1(candidate())
  assert.equal(result.demandConfidence,
    "D3_FAMILY_DEMAND_PROVEN_OPPORTUNITY_FIT_STRONG")
  assert.equal(result.oldPolicyDecision, "OLD_BLOCKED_EXACT_DEMAND")
  assert.equal(result.newShadowDecision, "NEW_BOUNDED_MARKET_TEST")
  assert.equal(result.newlyUnlockedByD3, true)
  assert.equal(result.productionPolicyChanged, false)
  assert.equal(result.commercialPriority.contributionMarginPercent, null)
})

test("D1 and D2 are standard only with all hard gates, without fabricating demand", () => {
  const d1 = subject.evaluateOpportunityFitShadowCandidateV1(candidate({
    exactProductDemandStatus: "PROVEN",
    currentHardBlockers: [],
  }))
  const d2 = subject.evaluateOpportunityFitShadowCandidateV1(candidate({
    exactSubtypeDemandStatus: "PROVEN",
    currentHardBlockers: [],
  }))
  assert.equal(d1.demandConfidence, "D1_EXACT_PRODUCT_DEMAND_PROVEN")
  assert.equal(d1.newShadowDecision, "NEW_STANDARD")
  assert.equal(d2.demandConfidence, "D2_EXACT_SUBTYPE_DEMAND_PROVEN")
  assert.equal(d2.newShadowDecision, "NEW_STANDARD")
  assert.equal(subject.evaluateOpportunityFitShadowCandidateV1(candidate({
    exactProductDemandStatus: "PROVEN",
    currentHardBlockers: [],
    authoritativeShipping: "UNPROVEN",
  })).newShadowDecision, "NEW_BLOCKED")
})

test("D3 never overrides identity, stock, shipping, economics, or compliance", () => {
  const cases = [
    [{ supplierIdentityEvidence: { ...identityStrong(), durableAuthoritativeEvidence: false } },
      "BLOCKED_IDENTITY"],
    [{ freshStock: "UNPROVEN" }, "BLOCKED_STOCK"],
    [{ authoritativeShipping: "UNPROVEN" }, "BLOCKED_AUTHORITATIVE_SHIPPING"],
    [{ economics: "UNPROVEN" }, "BLOCKED_ECONOMICS"],
    [{ compliance: "UNPROVEN" }, "BLOCKED_COMPLIANCE"],
  ]
  for (const [overrides, reason] of cases) {
    const result = subject.evaluateOpportunityFitShadowCandidateV1(candidate(overrides))
    assert.equal(result.newShadowDecision, "NEW_BLOCKED")
    assert.equal(result.newShadowReason, reason)
    assert.equal(result.newlyUnlockedByD3, false)
  }
})

test("Microcurrent economics rejection cannot be resurrected", () => {
  const result = subject.evaluateOpportunityFitShadowCandidateV1(candidate({
    candidateId: ids.microcurrent,
    productName: "5-in-1 Microcurrent Facial Device",
    familyName: "Microcurrent facial devices",
    currentHardBlockers: ["EXACT_PRODUCT_DEMAND_UNPROVEN"],
    exactSubtypeDemandStatus: "NOT_APPLICABLE",
    economics: "PROVEN_UNPROFITABLE",
  }))
  assert.equal(result.oldPolicyReason, "REJECTED_ECONOMICS")
  assert.equal(result.newShadowReason, "REJECTED_ECONOMICS")
  assert.equal(result.newShadowDecision, "NEW_REJECTED")
})

test("title-only fit and ambiguous supplier identity fail closed", () => {
  const result = subject.evaluateOpportunityFitShadowCandidateV1(candidate({
    opportunityFitEvidence: { ...fitStrong(), titleOnlyInference: true },
    supplierIdentityEvidence: { ...identityStrong(), unresolvedAmbiguity: true },
  }))
  assert.equal(result.opportunityFit, "UNPROVEN")
  assert.equal(result.supplierIdentity, "UNPROVEN")
  assert.equal(result.newShadowReason, "BLOCKED_IDENTITY")
})

test("current 17-candidate replay preserves 14 upstream rejects and all safety gates", () => {
  const ambiguous = Array.from({ length: 14 }, (_, index) => candidate({
    candidateId: `sha256:${(index + 10).toString(16).padStart(64, "0")}`,
    productName: `Ambiguous research identity ${index + 1}`,
    supplierIdentityEvidence: { ...identityStrong(), unresolvedAmbiguity: true,
      durableAuthoritativeEvidence: false },
    upstreamRejected: true,
    upstreamRejectReason: "FAMILY_SEED_ONLY_AMBIGUOUS",
  }))
  const replay = subject.replayOpportunityFitShadowCohortV1([
    candidate({
      candidateId: ids.microcurrent,
      productName: "5-in-1 Microcurrent Facial Device",
      familyName: "Microcurrent facial devices",
      currentHardBlockers: ["EXACT_PRODUCT_DEMAND_UNPROVEN"],
      exactSubtypeDemandStatus: "NOT_APPLICABLE",
      economics: "PROVEN_UNPROFITABLE",
    }),
    candidate({ authoritativeShipping: "UNPROVEN", compliance: "UNPROVEN" }),
    candidate({
      candidateId: ids.tesla1450,
      productName: "Tesla NEMA 14-50 Gen II Mobile Connector Smart Adapter",
      supplierIdentityEvidence: { ...identityStrong(), durableAuthoritativeEvidence: false },
      authoritativeShipping: "UNPROVEN",
      economics: "UNPROVEN",
      compliance: "UNPROVEN",
    }),
    ...ambiguous,
  ])
  assert.equal(replay.totalCandidatesReplayed, 17)
  assert.equal(replay.oldBlockedExactDemand, 2)
  assert.equal(replay.oldRejected, 15)
  assert.equal(replay.newBlocked, 2)
  assert.equal(replay.newRejected, 15)
  assert.equal(replay.newBoundedMarketTest, 0)
  assert.equal(replay.newlyUnlockedByD3Count, 0)
  assert.equal(replay.shadowPolicySafety, true)
  assert.deepEqual(replay.topShadowViableCandidates, [])
  assert.equal(replay.marketplaceWrites, 0)
})
