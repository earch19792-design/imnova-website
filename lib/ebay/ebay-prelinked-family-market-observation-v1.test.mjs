import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const market = await import("./ebay-prelinked-family-market-observation-v1.ts")
const {
  DISCOVERY_UNIVERSE_BOUND_TO_SHADOW20,
  buildSellerOsFamilyMarketObservationV1,
  buildSellerOsFamilyT0PreviewV1,
  buildSellerOsMarketFamilyDefinitionVersionIdV1,
  buildSellerOsMarketFamilyIdV1,
  buildSellerOsOpportunityCaseIdV1,
  buildSellerOsOpportunityMonitorEnrollmentV1,
  buildSellerOsTargetProductProfileV1,
  deriveSellerOsFamilyMarketMomentumV1,
  deriveSellerOsOpportunityReviewConditionsV1,
  SELLER_OS_PRELINKED_POST_PUBLISH_HANDOFF_POLICY_V1,
} = market

const D = (c) => `sha256:${c.repeat(64)}`
const DAY = 24 * 60 * 60
const identity = Object.freeze({
  productFunction: "brew pour-over coffee with controlled water flow",
  buyerUseCase: "prepare V60 pour-over coffee",
  category: "Gooseneck kettles",
  structuredDefinition: Object.freeze({
    spout: "gooseneck", method: "V60 pour-over",
  }),
})

function definition(overrides = {}) {
  return { identity, familyName: "V60 gooseneck kettles",
    familyQuerySet: ["V60 gooseneck kettle"],
    keyProductAttributes: ["gooseneck spout"],
    keyBuyerIntentTerms: ["V60 kettle"],
    adapterContract: "MarketEvidenceAdapter",
    adapterVersion: "I02R_V1", ...overrides }
}

function observation(overrides = {}) {
  const start = overrides.observationWindowStart ?? "2026-07-01T00:00:00.000Z"
  const end = overrides.observationWindowEnd ?? "2026-07-31T00:00:00.000Z"
  const sold = overrides.soldQuantity ?? 10
  return buildSellerOsFamilyMarketObservationV1({
    familyDefinition: overrides.familyDefinition ?? definition(),
    observationWindowStart: start, observationWindowEnd: end,
    familyDemandStatus: overrides.familyDemandStatus ?? "FAMILY_DEMAND_SUPPORTED",
    demandEvidenceClass: overrides.demandEvidenceClass ?? "OFFICIAL_SOLD_EVIDENCE",
    sourceStatus: overrides.sourceStatus ?? "AVAILABLE",
    aggregationSemantics: overrides.aggregationSemantics ?? "CUMULATIVE_SNAPSHOT",
    demandEvidenceReferences: overrides.demandEvidenceReferences ?? ["sold:batch-v60"],
    demandEvidenceDigest: overrides.demandEvidenceDigest ?? D("1"),
    soldComparableCount: overrides.soldComparableCount ?? 3,
    soldQuantityEvidence: overrides.soldQuantityEvidence === null ? null : {
      quantity: sold, authorityClass: "OFFICIAL_EXTERNAL_FACT",
      evidenceReferences: ["sold:batch-v60"],
    },
    activeComparableCount: overrides.activeComparableCount ?? 10,
    sellerDiversity: overrides.sellerDiversity ?? 4,
    priceBand: overrides.priceBand ?? { currency: "USD", minimum: 20, maximum: 45 },
    priceMedian: overrides.priceMedian ?? 27.99,
    priceDistributionEvidence: ["sold:batch-v60"],
    competitionState: overrides.competitionState ?? "MODERATE",
    buyerIntentTerms: overrides.buyerIntentTerms ?? ["V60 kettle"],
    keywordState: overrides.keywordState ?? "AVAILABLE",
    attributeProfile: overrides.attributeProfile ?? { spout: "gooseneck" },
    opportunityTypes: ["DEMAND_FIRST_TEST_LAUNCH"],
    evidenceObservedAt: overrides.evidenceObservedAt ?? end,
    sourceUpdatedAt: null, maximumAgeSeconds: 90 * DAY,
    sourceAdapter: overrides.sourceAdapter ?? "MarketEvidenceAdapter",
    sourceContractVersion: overrides.sourceContractVersion ??
      "EBAY_PRODUCT_RESEARCH_CAPTURE_V3",
    limitations: overrides.limitations ?? ["EXACT_PRODUCT_DEMAND_UNPROVEN"],
  })
}

test("same commercial family converges across query refinements and adapters", () => {
  const first = buildSellerOsMarketFamilyIdV1(identity)
  const second = buildSellerOsMarketFamilyIdV1({
    category: "gooseneck kettles", buyerUseCase: "PREPARE V60 POUR-OVER COFFEE",
    productFunction: "Brew pour-over coffee with controlled water flow",
    structuredDefinition: { method: "v60 pour-over", spout: "GOOSENECK" },
  })
  assert.equal(first, second)
  const v1 = buildSellerOsMarketFamilyDefinitionVersionIdV1(definition())
  const v2 = buildSellerOsMarketFamilyDefinitionVersionIdV1(definition({
    familyQuerySet: ["V60 kettle", "pour over gooseneck"],
    adapterVersion: "PHASE_7_V1",
  }))
  assert.notEqual(v1, v2)
  assert.equal(buildSellerOsMarketFamilyIdV1(definition().identity), first)
})

test("runtime family ordering matches PostgreSQL C collation", () => {
  const forward = buildSellerOsMarketFamilyIdV1({
    ...identity, structuredDefinition: {
      "a_b": "underscore", "a-b": "dash", "a:b": "colon",
    },
  })
  const reverse = buildSellerOsMarketFamilyIdV1({
    ...identity, structuredDefinition: {
      "a:b": "colon", "a-b": "dash", "a_b": "underscore",
    },
  })
  assert.equal(forward, reverse)
})

test("same T0 window replay has one logical observation identity", () => {
  assert.equal(observation().observationId, observation().observationId)
})

test("T1 has a new observation but the same family and opportunity case", () => {
  const t0 = observation()
  const t1 = observation({ observationWindowStart: "2026-08-01T00:00:00.000Z",
    observationWindowEnd: "2026-08-31T00:00:00.000Z",
    demandEvidenceDigest: D("2") })
  assert.notEqual(t0.observationId, t1.observationId)
  assert.equal(t0.familyId, t1.familyId)
  assert.equal(t0.opportunityCaseId, t1.opportunityCaseId)
})

test("opportunity case identity does not depend on observation or score", () => {
  const familyId = buildSellerOsMarketFamilyIdV1(identity)
  assert.equal(buildSellerOsOpportunityCaseIdV1({ familyId }),
    buildSellerOsOpportunityCaseIdV1({ familyId }))
})

test("one observation is always insufficient history", () => {
  const value = deriveSellerOsFamilyMarketMomentumV1({
    currentObservation: observation(), momentumPolicyVersion: "I02R_MOMENTUM_V1",
  })
  assert.equal(value.momentumStatus, "INSUFFICIENT_HISTORY")
  assert.equal(value.previousObservationId, null)
})

test("two comparable windows can strengthen, weaken, stabilize, or saturate", () => {
  const previous = observation({ soldQuantity: 10, activeComparableCount: 10 })
  const currentBase = { observationWindowStart: "2026-08-01T00:00:00.000Z",
    observationWindowEnd: "2026-08-31T00:00:00.000Z" }
  const derive = (extra) => deriveSellerOsFamilyMarketMomentumV1({
    previousObservation: previous,
    currentObservation: observation({ ...currentBase, ...extra }),
    momentumPolicyVersion: "I02R_MOMENTUM_V1",
  }).momentumStatus
  assert.equal(derive({ soldQuantity: 14 }), "STRENGTHENING")
  assert.equal(derive({ soldQuantity: 7 }), "WEAKENING")
  assert.equal(derive({ soldQuantity: 10, activeComparableCount: 11 }), "STABLE")
  assert.equal(derive({ soldQuantity: 10, activeComparableCount: 15 }), "SATURATING")
  assert.equal(derive({ soldQuantity: 10, soldComparableCount: 5,
    activeComparableCount: null }), "SATURATING")
  assert.equal(derive({ soldQuantity: 5, soldComparableCount: 5,
    activeComparableCount: 15 }), "WEAKENING")
})

test("adapter or family-definition upgrades preserve IDs but reset momentum comparability", () => {
  const previous = observation()
  const current = observation({
    observationWindowStart: "2026-08-01T00:00:00.000Z",
    observationWindowEnd: "2026-08-31T00:00:00.000Z",
    demandEvidenceDigest: D("2"), soldQuantity: 20,
    sourceContractVersion: "PHASE_7_CANONICAL_RADAR_V1",
  })
  const result = deriveSellerOsFamilyMarketMomentumV1({
    previousObservation: previous, currentObservation: current,
    momentumPolicyVersion: "I02R_MOMENTUM_V1",
  })
  assert.equal(previous.familyId, current.familyId)
  assert.equal(previous.opportunityCaseId, current.opportunityCaseId)
  assert.equal(result.momentumStatus, "INSUFFICIENT_HISTORY")
  assert.equal(result.comparableObservationCount, 1)
})

test("multi-query capture timing uses a bounded duration tolerance", () => {
  const previous = observation({ soldQuantity: 10 })
  const comparable = observation({
    observationWindowStart: "2026-08-01T00:00:00.000Z",
    observationWindowEnd: "2026-08-31T02:00:00.000Z",
    soldQuantity: 14,
  })
  const tooDifferent = observation({
    observationWindowStart: "2026-08-01T00:00:00.000Z",
    observationWindowEnd: "2026-09-05T00:00:00.000Z",
    soldQuantity: 14,
  })
  assert.equal(deriveSellerOsFamilyMarketMomentumV1({
    previousObservation: previous, currentObservation: comparable,
    momentumPolicyVersion: "I02R_MOMENTUM_V1",
  }).momentumStatus, "STRENGTHENING")
  assert.equal(deriveSellerOsFamilyMarketMomentumV1({
    previousObservation: previous, currentObservation: tooDifferent,
    momentumPolicyVersion: "I02R_MOMENTUM_V1",
  }).momentumStatus, "INSUFFICIENT_HISTORY")
})

test("new demand needs two comparable windows and explicit zero-to-positive facts", () => {
  const previous = observation({ soldQuantity: 0, soldComparableCount: 0,
    familyDemandStatus: "FAMILY_DEMAND_UNPROVEN" })
  const current = observation({ observationWindowStart: "2026-08-01T00:00:00.000Z",
    observationWindowEnd: "2026-08-31T00:00:00.000Z", soldQuantity: 4 })
  assert.equal(deriveSellerOsFamilyMarketMomentumV1({ previousObservation: previous,
    currentObservation: current, momentumPolicyVersion: "I02R_MOMENTUM_V1",
  }).momentumStatus, "NEW")
})

test("overlapping windows fail closed instead of manufacturing direction", () => {
  assert.throws(() => deriveSellerOsFamilyMarketMomentumV1({
    previousObservation: observation(),
    currentObservation: observation({
      observationWindowStart: "2026-07-15T00:00:00.000Z",
      observationWindowEnd: "2026-08-15T00:00:00.000Z" }),
    momentumPolicyVersion: "I02R_MOMENTUM_V1",
  }), /MOMENTUM_OBSERVATIONS_NOT_COMPARABLE/)
})

test("active listings cannot be labeled proven demand", () => {
  assert.throws(() => observation({ demandEvidenceClass:
    "DIRECT_MARKET_OBSERVATION" }),
  /ACTIVE_OR_NON_SALES_EVIDENCE_CANNOT_PROVE_DEMAND/)
})

test("monitor identity is stable and review triggers remain explicit", () => {
  for (const condition of ["TIME_WINDOW_ELAPSED", "NEW_SOLD_EVIDENCE",
    "PRICE_SHIFT", "COMPETITOR_SHIFT", "KEYWORD_SHIFT", "ATTRIBUTE_SHIFT",
    "PRODUCT_LAUNCHED", "OUTCOME_WINDOW_COMPLETE"]) {
    const first = buildSellerOsOpportunityMonitorEnrollmentV1({
      familyIdentity: identity, monitorPolicyVersion: "I02R_MONITOR_V1",
      enrolledAt: "2026-08-22T20:00:00.000Z", status: "ENROLLED",
      nextReviewCondition: condition, nextEligibleReviewAt: null,
      lastObservationId: observation().observationId,
      lastEvaluatedAt: "2026-08-22T20:00:00.000Z",
    })
    const replay = buildSellerOsOpportunityMonitorEnrollmentV1({ ...first,
      familyIdentity: identity })
    assert.equal(first.enrollmentId, replay.enrollmentId)
    assert.equal(first.continuousPollingEnabled, false)
  }
})

test("market shifts create bounded review conditions without claiming causality", () => {
  const previous = observation()
  const current = observation({
    observationWindowStart: "2026-08-01T00:00:00.000Z",
    observationWindowEnd: "2026-08-31T00:00:00.000Z",
    demandEvidenceDigest: D("2"), priceMedian: 35,
    competitionState: "HIGH", buyerIntentTerms: ["precision V60 kettle"],
    attributeProfile: { spout: "gooseneck", capacity: "1.2l" },
  })
  assert.deepEqual(deriveSellerOsOpportunityReviewConditionsV1({
    previousObservation: previous, currentObservation: current,
  }), ["NEW_SOLD_EVIDENCE", "PRICE_SHIFT", "COMPETITOR_SHIFT",
    "KEYWORD_SHIFT", "ATTRIBUTE_SHIFT"])
})

test("target profile and downstream handoff preserve observation and P2 gates", () => {
  const current = observation()
  const profile = buildSellerOsTargetProductProfileV1(current)
  assert.equal(profile.familyId, current.familyId)
  assert.equal(profile.currentMarketObservationId, current.observationId)
  assert.equal(SELLER_OS_PRELINKED_POST_PUBLISH_HANDOFF_POLICY_V1
    .p2StockEnrollmentRequiresCertifiedP2Gate, true)
  assert.equal(SELLER_OS_PRELINKED_POST_PUBLISH_HANDOFF_POLICY_V1
    .prePublicationEbayItemIdAllowed, false)
})

test("T0 preview is shadow-only and never promotes momentum", () => {
  const preview = buildSellerOsFamilyT0PreviewV1({ observation: observation(),
    familyName: "V60 gooseneck kettles",
    nextReviewCondition: "NEW_SOLD_EVIDENCE",
    momentumPolicyVersion: "I02R_MOMENTUM_V1" })
  assert.equal(preview.momentumStatus, "INSUFFICIENT_HISTORY")
  assert.equal(preview.realWrite, false)
})

test("family discovery universe is not bound to the canary shadow20", () => {
  assert.equal(DISCOVERY_UNIVERSE_BOUND_TO_SHADOW20, false)
})
