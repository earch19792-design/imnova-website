import assert from "node:assert/strict"
import test from "node:test"
import { createJiti } from "jiti"

const jiti = createJiti(import.meta.url)

const {
  EBAY_LISTING_RECOVERY_ACTION_LADDER,
  EBAY_LISTING_RECOVERY_DIAGNOSES,
  EBAY_LISTING_RECOVERY_ENGINE_VERSION,
  EBAY_LISTING_RECOVERY_STATES,
  buildCompetitiveGapReport,
  buildRecoveryLearningEvent,
  diagnoseListingRecovery,
  evaluateRecoveryExperiment,
  isAllowedRecoveryTransition,
  reconcileRecoveryActionOutcome,
  recoveryExperimentCooldownElapsed,
  runFiveListingRecoveryDryRun,
} = await jiti.import("./ebay-listing-recovery-growth-domain.ts")
const {
  fiveListingRecoveryFixtures,
  recoveryFixture,
} = await jiti.import("./ebay-listing-recovery-growth-fixtures.ts")

function withOrganic(organicOverrides = {}, inputOverrides = {}) {
  const seed = recoveryFixture(inputOverrides)
  assert.ok(seed.metrics.organic)
  return recoveryFixture({
    ...inputOverrides,
    metrics: {
      organic: { ...seed.metrics.organic, ...organicOverrides },
      paid: seed.metrics.paid,
    },
  })
}

function comparable(overrides = {}) {
  return {
    id: "comparable-1",
    classification: "SOLD_CONFIRMED",
    comparabilityScore: 92,
    landedPrice: 31.5,
    categoryId: "180112",
    condition: "NEW",
    pack: "1",
    variant: "standard",
    shippingPattern: "FREE_STANDARD",
    returnPattern: "30_DAYS",
    titlePatternTokens: ["turbo", "nozzle"],
    visualPatternTags: ["white-background", "scale"],
    confirmedUnitsSold: 3,
    observedAt: "2026-07-26T17:00:00.000Z",
    ...overrides,
  }
}

function safePriceScenario() {
  return {
    proposedPrice: 29.1,
    projectedContribution: 7.31,
    projectedMarginPercent: 25.12,
    projectedRoiPercent: 40,
  }
}

function assertNoExternalEffects(decision) {
  assert.equal(decision.safety.organicPaidSeparated, true)
  assert.equal(decision.safety.activeOnlyUsedAsSale, false)
  assert.equal(decision.safety.cpcAutomaticAllowed, false)
  assert.equal(decision.safety.ebayWrites, 0)
  assert.equal(decision.safety.stateMutations, 0)
  assert.equal(decision.safety.externalEffects, 0)
}

function secondaryImageExperiment() {
  const decision = diagnoseListingRecovery(recoveryFixture())
  assert.equal(decision.action, "SECONDARY_IMAGES_AND_CONVERSION")
  assert.ok(decision.experiment)
  return decision.experiment
}

test("declares the versioned state, diagnosis, and action contracts", () => {
  assert.equal(
    EBAY_LISTING_RECOVERY_ENGINE_VERSION,
    "EBAY_LISTING_RECOVERY_AND_GROWTH_ENGINE_V1",
  )
  assert.equal(EBAY_LISTING_RECOVERY_STATES.length, 17)
  assert.equal(EBAY_LISTING_RECOVERY_DIAGNOSES.length, 9)
  assert.equal(EBAY_LISTING_RECOVERY_ACTION_LADDER.length, 11)
  assert.equal(EBAY_LISTING_RECOVERY_ACTION_LADDER[0], "TECHNICAL_VERIFICATION")
  assert.equal(
    EBAY_LISTING_RECOVERY_ACTION_LADDER.at(-1),
    "PAUSE_RETIRE_OR_REPLACE",
  )
})

test("allows only declared forward or recovery transitions", () => {
  assert.equal(
    isAllowedRecoveryTransition(
      "POST_PUBLISH_VERIFICATION",
      "OBSERVATION_WINDOW",
    ),
    true,
  )
  assert.equal(
    isAllowedRecoveryTransition(
      "POST_PUBLISH_VERIFICATION",
      "PERFORMANCE_RECOVERED",
    ),
    false,
  )
  assert.equal(
    isAllowedRecoveryTransition(
      "QUARANTINED_OPTIMIZATION_ERROR",
      "PERFORMANCE_DIAGNOSIS",
    ),
    true,
  )
})

test("4V veracity: ACTIVE_ONLY is never treated as a confirmed sale", () => {
  const decision = diagnoseListingRecovery(fiveListingRecoveryFixtures()[2])
  assert.equal(decision.diagnosis, "CLICKS_NO_CONVERSION")
  assert.equal(decision.action, "SECONDARY_IMAGES_AND_CONVERSION")
  assert.equal(decision.funnel.confirmedUnitsSold, 0)
  assert.match(decision.whyNotNextLevel, /ACTIVE_ONLY/)
  assertNoExternalEffects(decision)
})

test("4V freshness: stale official metrics wait for renewed evidence", () => {
  const decision = diagnoseListingRecovery(withOrganic({
    capturedAt: "2026-07-20T17:55:00.000Z",
    lastUpdatedDate: "2026-07-20T17:00:00.000Z",
  }))
  assert.equal(decision.state, "WAITING_FOR_SUFFICIENT_SAMPLE")
  assert.equal(decision.diagnosis, "INSUFFICIENT_EVIDENCE")
  assert.equal(decision.action, "EVIDENCE_REVALIDATION")
  assert.equal(decision.safety.metricsFresh, false)
  assertNoExternalEffects(decision)
})

test("4V viability: an unsafe price scenario cannot become a price test", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    history: { completedActionLevels: [1, 5, 6, 8] },
    economics: {
      priceTestScenario: {
        proposedPrice: 20,
        projectedContribution: 1,
        projectedMarginPercent: 5,
        projectedRoiPercent: 10,
      },
    },
  }))
  assert.equal(decision.state, "PAUSE_OR_RETIRE_RECOMMENDED")
  assert.equal(decision.action, "PAUSE_RETIRE_OR_REPLACE")
  assert.equal(decision.experiment, null)
  assert.equal(decision.safety.priceFloorProtected, false)
  assertNoExternalEffects(decision)
})

test("4V verification: a technical mismatch is handled before optimization", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    listing: { inventoryItemVerified: false },
  }))
  assert.equal(decision.state, "ACTION_PROPOSED")
  assert.equal(decision.diagnosis, "LISTING_TECHNICAL_PROBLEM")
  assert.equal(decision.actionLevel, 1)
  assert.equal(decision.action, "TECHNICAL_VERIFICATION")
  assert.equal(decision.experiment, null)
  assertNoExternalEffects(decision)
})

test("missing organic metrics block diagnosis without inventing a baseline", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    metrics: { organic: null, paid: null },
  }))
  assert.equal(decision.state, "WAITING_FOR_SUFFICIENT_SAMPLE")
  assert.equal(decision.action, "EVIDENCE_REVALIDATION")
  assert.equal(decision.funnel.impressions, null)
  assertNoExternalEffects(decision)
})

test("incomplete organic metrics cannot advance to an experiment", () => {
  const decision = diagnoseListingRecovery(withOrganic({
    completeness: "INCOMPLETE",
  }))
  assert.equal(decision.state, "WAITING_FOR_SUFFICIENT_SAMPLE")
  assert.equal(decision.experiment, null)
  assertNoExternalEffects(decision)
})

test("low-confidence evidence cannot dominate official listing state", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    evidence: { confidence: 0.4 },
  }))
  assert.equal(decision.state, "WAITING_FOR_SUFFICIENT_SAMPLE")
  assert.equal(decision.diagnosis, "INSUFFICIENT_EVIDENCE")
  assertNoExternalEffects(decision)
})

test("pending organic reconciliation blocks action", () => {
  const decision = diagnoseListingRecovery(withOrganic({
    reconciliation: "PENDING",
  }))
  assert.equal(decision.state, "WAITING_FOR_SUFFICIENT_SAMPLE")
  assert.equal(decision.safety.metricsReconciled, false)
  assertNoExternalEffects(decision)
})

test("pending paid reconciliation blocks action independently", () => {
  const promoted = fiveListingRecoveryFixtures()[3]
  assert.ok(promoted.metrics.paid)
  const decision = diagnoseListingRecovery({
    ...promoted,
    metrics: {
      ...promoted.metrics,
      paid: { ...promoted.metrics.paid, reconciliation: "PENDING" },
    },
  })
  assert.equal(decision.state, "WAITING_FOR_SUFFICIENT_SAMPLE")
  assert.equal(decision.safety.metricsReconciled, false)
  assertNoExternalEffects(decision)
})

test("a listing inside the observation window remains waiting", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    listing: { publishedAt: "2026-07-25T18:00:00.000Z" },
  }))
  assert.equal(decision.state, "WAITING_FOR_SUFFICIENT_SAMPLE")
  assert.equal(decision.experiment, null)
  assertNoExternalEffects(decision)
})

test("an active experiment enforces cooldown and one-variable isolation", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    history: { activeExperiment: true },
  }))
  assert.equal(decision.state, "COOLDOWN")
  assert.equal(decision.action, null)
  assert.equal(decision.experiment, null)
  assertNoExternalEffects(decision)
})

test("cooldown calculation handles absent, open, and elapsed histories", () => {
  assert.equal(recoveryExperimentCooldownElapsed({
    previousExperimentAt: null,
    observedAt: "2026-07-26T18:00:00.000Z",
  }), true)
  assert.equal(recoveryExperimentCooldownElapsed({
    previousExperimentAt: "2026-07-25T18:00:00.000Z",
    observedAt: "2026-07-26T18:00:00.000Z",
  }), false)
  assert.equal(recoveryExperimentCooldownElapsed({
    previousExperimentAt: "2026-07-19T18:00:00.000Z",
    observedAt: "2026-07-26T18:00:00.000Z",
  }), true)
})

test("the experiment budget ends in pause or replacement, not an infinite loop", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    history: { experimentCount: 6 },
  }))
  assert.equal(decision.state, "PAUSE_OR_RETIRE_RECOMMENDED")
  assert.equal(decision.action, "PAUSE_RETIRE_OR_REPLACE")
  assert.equal(decision.experiment, null)
  assertNoExternalEffects(decision)
})

test("profitable confirmed sales mark recovery without another mutation", () => {
  const decision = diagnoseListingRecovery(fiveListingRecoveryFixtures()[4])
  assert.equal(decision.state, "PERFORMANCE_RECOVERED")
  assert.equal(decision.funnel.confirmedUnitsSold, 2)
  assert.equal(decision.funnel.profitableConfirmedUnits, 2)
  assert.equal(decision.experiment, null)
  assertNoExternalEffects(decision)
})

test("CPC spend without attributed sales proposes a pause but never automates it", () => {
  const decision = diagnoseListingRecovery(fiveListingRecoveryFixtures()[3])
  assert.equal(decision.diagnosis, "PROMOTED_NO_RESULT")
  assert.equal(decision.action, "CPS_PROMOTION")
  assert.ok(decision.experiment)
  assert.equal(decision.experiment.automaticExecutionAllowed, false)
  assert.equal(decision.experiment.ebayWriteAllowed, false)
  assertNoExternalEffects(decision)
})

test("zero impressions starts with discovery instead of price or promotion", () => {
  const decision = diagnoseListingRecovery(fiveListingRecoveryFixtures()[0])
  assert.equal(decision.diagnosis, "NO_IMPRESSIONS")
  assert.equal(decision.action, "DISCOVERY_AND_KEYWORDS")
  assert.equal(decision.actionLevel, 4)
  assertNoExternalEffects(decision)
})

test("missing required aspects precedes keyword optimization", () => {
  const input = fiveListingRecoveryFixtures()[0]
  const decision = diagnoseListingRecovery({
    ...input,
    listing: { ...input.listing, requiredAspectsComplete: false },
  })
  assert.equal(decision.action, "CATEGORY_AND_ASPECTS")
  assert.equal(decision.actionLevel, 3)
  assertNoExternalEffects(decision)
})

test("safe CPS promotion is considered only after lower-risk levels complete", () => {
  const input = fiveListingRecoveryFixtures()[0]
  const decision = diagnoseListingRecovery({
    ...input,
    history: {
      ...input.history,
      completedActionLevels: [1, 3, 4, 5],
    },
  })
  assert.equal(decision.action, "CPS_PROMOTION")
  assert.equal(decision.actionLevel, 8)
  assert.ok(decision.experiment)
  assert.equal(decision.experiment.requiresHumanApproval, true)
  assertNoExternalEffects(decision)
})

test("sufficient impressions with weak CTR proposes only the main image", () => {
  const decision = diagnoseListingRecovery(fiveListingRecoveryFixtures()[1])
  assert.equal(decision.diagnosis, "IMPRESSIONS_NO_CLICKS")
  assert.equal(decision.action, "MAIN_IMAGE_OR_TITLE")
  assert.deepEqual(decision.experiment?.mutationFields, ["main_image"])
  assertNoExternalEffects(decision)
})

test("clicks without confirmed sales address conversion before price", () => {
  const decision = diagnoseListingRecovery(recoveryFixture())
  assert.equal(decision.diagnosis, "CLICKS_NO_CONVERSION")
  assert.equal(decision.action, "SECONDARY_IMAGES_AND_CONVERSION")
  assert.deepEqual(
    decision.experiment?.mutationFields,
    ["secondary_image_package"],
  )
  assertNoExternalEffects(decision)
})

test("an interested-buyer offer remains simulated when negotiation is unavailable", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    interestedBuyerEligibility: {
      status: "ELIGIBLE",
      source: "EBAY_NEGOTIATION_FIND_ELIGIBLE_ITEMS",
      capturedAt: "2026-07-26T17:55:00.000Z",
      negotiationImplemented: false,
    },
    economics: { priceTestScenario: safePriceScenario() },
  }))
  assert.equal(decision.action, "INTERESTED_BUYER_OFFER")
  assert.equal(
    decision.experiment?.executionMechanism,
    "NEGOTIATION_NOT_IMPLEMENTED",
  )
  assert.equal(decision.experiment?.ebayWriteAllowed, false)
  assertNoExternalEffects(decision)
})

test("E4 plus completed lower-risk levels permits a protected price proposal", () => {
  const decision = diagnoseListingRecovery(recoveryFixture({
    history: { completedActionLevels: [1, 5, 6, 8] },
    economics: { priceTestScenario: safePriceScenario() },
  }))
  assert.equal(decision.state, "PRICE_TEST_ELIGIBLE")
  assert.equal(decision.action, "LIMITED_PRICE_TEST")
  assert.equal(decision.experiment?.mutationFields.length, 1)
  assert.equal(decision.experiment?.requiresHumanApproval, true)
  assert.equal(decision.safety.priceFloorProtected, true)
  assertNoExternalEffects(decision)
})

test("every generated experiment is single-variable, reversible, and human-gated", () => {
  const experiment = secondaryImageExperiment()
  assert.equal(experiment.mutationFields.length, 1)
  assert.equal(experiment.rollback.supported, true)
  assert.equal(experiment.rollback.automatic, false)
  assert.equal(experiment.automaticExecutionAllowed, false)
  assert.equal(experiment.ebayWriteAllowed, false)
  assert.equal(experiment.requiresHumanApproval, true)
})

test("identical evidence and policy produce the same experiment idempotency key", () => {
  const first = diagnoseListingRecovery(recoveryFixture())
  const second = diagnoseListingRecovery(recoveryFixture())
  assert.ok(first.experiment)
  assert.ok(second.experiment)
  assert.equal(
    first.experiment.experimentIdempotencyKey,
    second.experiment.experimentIdempotencyKey,
  )
})

test("competitive gap uses exact sold comparables and isolates ACTIVE_ONLY", () => {
  const input = recoveryFixture({
    comparables: [
      comparable(),
      comparable({
        id: "active-only",
        classification: "ACTIVE_ONLY",
        confirmedUnitsSold: 0,
      }),
      comparable({
        id: "wrong-pack",
        pack: "2",
        titlePatternTokens: ["multipack"],
      }),
      comparable({
        id: "weak-match",
        comparabilityScore: 69,
        titlePatternTokens: ["unrelated"],
      }),
    ],
  })
  const report = buildCompetitiveGapReport(input)
  assert.equal(report.exactComparableCount, 2)
  assert.equal(report.confirmedWinnerCount, 1)
  assert.equal(report.activeOnlyCount, 1)
  assert.equal(report.competitorContentCopied, false)
  assert.ok(report.unverifiedHypotheses.some((value) =>
    value.includes("ACTIVE_ONLY")))
})

test("a confirmed or matching external outcome is never retried", () => {
  assert.deepEqual(reconcileRecoveryActionOutcome({
    phase: "CONFIRMED",
    expectedPayloadHash: "expected",
    observedPayloadHash: null,
    safeFailureProven: false,
  }), {
    state: "CONFIRMED",
    retryAllowed: false,
    reconciled: true,
  })
  assert.deepEqual(reconcileRecoveryActionOutcome({
    phase: "UNKNOWN_OUTCOME",
    expectedPayloadHash: "expected",
    observedPayloadHash: "expected",
    safeFailureProven: false,
  }), {
    state: "RECONCILED",
    retryAllowed: false,
    reconciled: true,
  })
})

test("an ambiguous external outcome cannot trigger a blind retry", () => {
  assert.deepEqual(reconcileRecoveryActionOutcome({
    phase: "SENT",
    expectedPayloadHash: "expected",
    observedPayloadHash: null,
    safeFailureProven: false,
  }), {
    state: "UNKNOWN_OUTCOME",
    retryAllowed: false,
    reconciled: false,
  })
})

test("only a proven safe failure permits a controlled retry", () => {
  assert.deepEqual(reconcileRecoveryActionOutcome({
    phase: "FAILED",
    expectedPayloadHash: "expected",
    observedPayloadHash: null,
    safeFailureProven: true,
  }), {
    state: "FAILED",
    retryAllowed: true,
    reconciled: false,
  })
})

test("an experiment with insufficient sample remains inconclusive", () => {
  const experiment = secondaryImageExperiment()
  const result = evaluateRecoveryExperiment({
    experiment,
    before: { kpi: 1, sample: 30 },
    after: { kpi: 2, sample: experiment.minimumSample - 1 },
    minimumContributionProtected: true,
    marginProtected: true,
    roiProtected: true,
  })
  assert.deepEqual(result, {
    state: "WAITING_FOR_SUFFICIENT_SAMPLE",
    result: "INCONCLUSIVE",
    rollback: false,
  })
})

test("a material KPI loss requires rollback", () => {
  const experiment = secondaryImageExperiment()
  const result = evaluateRecoveryExperiment({
    experiment,
    before: { kpi: 10, sample: 30 },
    after: { kpi: 8, sample: experiment.minimumSample },
    minimumContributionProtected: true,
    marginProtected: true,
    roiProtected: true,
  })
  assert.equal(result.state, "ROLLBACK_REQUIRED")
  assert.equal(result.result, "LOST")
  assert.equal(result.rollback, true)
})

test("a guardrail violation requires rollback even when the KPI rises", () => {
  const experiment = secondaryImageExperiment()
  const result = evaluateRecoveryExperiment({
    experiment,
    before: { kpi: 10, sample: 30 },
    after: { kpi: 12, sample: experiment.minimumSample },
    minimumContributionProtected: false,
    marginProtected: true,
    roiProtected: true,
  })
  assert.equal(result.state, "ROLLBACK_REQUIRED")
  assert.equal(result.result, "LOST")
  assert.equal(result.rollback, true)
})

test("a measured improvement wins and a marginal change remains neutral", () => {
  const experiment = secondaryImageExperiment()
  const won = evaluateRecoveryExperiment({
    experiment,
    before: { kpi: 10, sample: 30 },
    after: { kpi: 10.6, sample: experiment.minimumSample },
    minimumContributionProtected: true,
    marginProtected: true,
    roiProtected: true,
  })
  const neutral = evaluateRecoveryExperiment({
    experiment,
    before: { kpi: 10, sample: 30 },
    after: { kpi: 10.3, sample: experiment.minimumSample },
    minimumContributionProtected: true,
    marginProtected: true,
    roiProtected: true,
  })
  assert.equal(won.state, "PERFORMANCE_RECOVERED")
  assert.equal(won.result, "WON")
  assert.equal(neutral.state, "NEXT_OPTIMIZATION_LEVEL")
  assert.equal(neutral.result, "NEUTRAL")
})

test("only a profitable confirmed win becomes reusable commercial learning", () => {
  const reusable = buildRecoveryLearningEvent({
    listingId: "100000000001",
    experimentId: "experiment-1",
    result: "WON",
    confirmedUnitsSold: 1,
    netContribution: 7,
    evidenceRefs: ["order:confirmed:1"],
  })
  const auditOnly = buildRecoveryLearningEvent({
    listingId: "100000000001",
    experimentId: "experiment-2",
    result: "WON",
    confirmedUnitsSold: 0,
    netContribution: 7,
    evidenceRefs: ["traffic:impressions:1"],
  })
  assert.equal(reusable.commerciallyReusable, true)
  assert.ok(reusable.feeds.includes("TOP_5_RANKING"))
  assert.equal(auditOnly.commerciallyReusable, false)
  assert.deepEqual(auditOnly.feeds, ["AUDIT_ONLY"])
  assert.equal(auditOnly.impressionsAloneCountAsSuccess, false)
})

test("the canonical five fixtures cover discovery, CTR, conversion, paid, and recovery", async () => {
  const report = await runFiveListingRecoveryDryRun(
    fiveListingRecoveryFixtures(),
  )
  assert.equal(report.listingCount, 5)
  assert.equal(report.diagnosed, 5)
  assert.equal(report.quarantined, 0)
  assert.deepEqual(report.items.map((item) => item.decision?.action), [
    "DISCOVERY_AND_KEYWORDS",
    "MAIN_IMAGE_OR_TITLE",
    "SECONDARY_IMAGES_AND_CONVERSION",
    "CPS_PROMOTION",
    null,
  ])
  assert.equal(report.items[4].decision?.state, "PERFORMANCE_RECOVERED")
  assert.ok(Object.values(report.safety).every((value) => value === 0))
})

test("one unknown product error is quarantined while the other four continue", async () => {
  const report = await runFiveListingRecoveryDryRun(
    fiveListingRecoveryFixtures(),
    (input) => {
      if (input.listingId === "100000000003") {
        throw new Error("fixture-only fault injection")
      }
      return diagnoseListingRecovery(input)
    },
  )
  assert.equal(report.listingCount, 5)
  assert.equal(report.diagnosed, 4)
  assert.equal(report.quarantined, 1)
  assert.equal(report.items[2].status, "QUARANTINED_OPTIMIZATION_ERROR")
  assert.equal(
    report.items[2].errorCode,
    "RECOVERY_DIAGNOSIS_UNKNOWN_ERROR",
  )
  assert.equal(report.items.filter((item) => item.status === "DIAGNOSED").length, 4)
  assert.ok(Object.values(report.safety).every((value) => value === 0))
})

test("the local dry-run rejects any batch size other than five", async () => {
  await assert.rejects(
    runFiveListingRecoveryDryRun(fiveListingRecoveryFixtures().slice(0, 4)),
    /RECOVERY_DRY_RUN_REQUIRES_FIVE_LISTINGS/,
  )
})
