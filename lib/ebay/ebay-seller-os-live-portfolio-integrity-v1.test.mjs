import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCrossModuleLivePortfolioIntegrityV1,
  buildFalseZeroInvariantFindingV1,
  resolveInvariantLifecycleV1,
} from "./ebay-seller-os-live-portfolio-integrity-v1.ts"

const OBSERVED_AT = "2026-08-13T12:00:00.000Z"

function listing(itemId, overrides = {}) {
  const base = {
    key: `listing:${itemId}`,
    identity: {
      itemId,
      title: `Listing ${itemId}`,
      sku: `SKU-${itemId}`,
      marketplaceCertification: { status: "US_CERTIFIED" },
    },
    discovery: { livePresence: { status: "LIVE_ACTIVE" } },
    metrics: {},
    experiment: { status: "UNAVAILABLE", lifecycleState: null },
    dataQualityIssues: [],
    blockers: [],
    evidenceReferences: [],
    alertCandidateKeys: [],
  }
  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...overrides.identity },
    discovery: { ...base.discovery, ...overrides.discovery },
  }
}

const certification = {
  status: "CERTIFIED",
  marketplaceId: "EBAY_US",
  discovery: { status: "AVAILABLE", coverage: "COMPLETE" },
}

function build(listings, overrides = {}) {
  return buildCrossModuleLivePortfolioIntegrityV1({
    listings,
    liveCertification: certification,
    registry: {
      status: "COMPLETE",
      currentLiveCount: 27,
      matchedCount: 27,
      humanReviewCount: 0,
      coveragePercent: 100,
      limitationCodes: [],
    },
    observedAt: OBSERVED_AT,
    ...overrides,
  })
}

test("27 aligned live stock rows preserve canonical count parity", () => {
  const listings = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  const { canonicalListings, integrity } = build(listings)

  assert.equal(canonicalListings.length, 27)
  assert.equal(integrity.canonicalCohort.listingCount, 27)
  assert.equal(integrity.stockCohort.currentLiveItemCount, 27)
  assert.equal(integrity.stockCohort.currentLiveEvidenceRowCount, 27)
  assert.equal(integrity.stockCohort.nonLiveEvidenceRowCount, 0)
  assert.equal(integrity.findings.some((finding) =>
    finding.invariantCode === "COUNT_PARITY_FAILURE"), false)
})

test("34 stock evidence rows reconcile to 27 live Item IDs without denominator contamination", () => {
  const live = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  const duplicate = listing(live[0].identity.itemId, {
    key: `stock-duplicate:${live[0].identity.itemId}`,
    identity: { title: "Different evidence title representation" },
  })
  const nonLive = Array.from({ length: 6 }, (_, index) =>
    listing(String(365_400_000_000 + index), {
      key: `historical:${index}`,
      discovery: { livePresence: { status: "ENDED" } },
    }))
  const { integrity } = build([...live, duplicate, ...nonLive])

  assert.equal(integrity.stockCohort.evidenceRowCount, 34)
  assert.equal(integrity.canonicalCohort.listingCount, 27)
  assert.equal(integrity.stockCohort.currentLiveItemCount, 27)
  assert.equal(integrity.stockCohort.currentLiveEvidenceRowCount, 28)
  assert.equal(integrity.stockCohort.nonLiveEvidenceRowCount, 6)
  assert.equal(integrity.stockCohort.duplicateItemIds.length, 1)
  assert.equal(integrity.stockCohort.duplicateItemIds[0].itemId,
    live[0].identity.itemId)
  const duplicateFinding = integrity.findings.find((finding) =>
    finding.invariantCode === "DUPLICATE_ITEM_ID")
  assert.equal(duplicateFinding?.lifecycle, "ACTIVE_VIOLATION")
  assert.equal(duplicateFinding?.guardCode,
    "STOCK_EVIDENCE_DEDUPLICATION_GUARD")
  assert.equal(duplicateFinding?.entityRefs.includes(live[0].identity.itemId),
    true)
  assert.equal(integrity.stockCohort.duplicateItemIds[0].rowCount, 2)
  const nonLiveFinding = integrity.findings.find((finding) =>
    finding.invariantCode === "NON_LIVE_EVIDENCE_PRESENT_EXCLUDED")
  assert.equal(nonLiveFinding?.lifecycle, "MITIGATED_BY_POLICY")
  assert.equal(nonLiveFinding?.strategicClassification, "MITIGATED_CONDITION")
  assert.equal(nonLiveFinding?.blockingImpact,
    "NONE_CURRENT_LIVE_DENOMINATOR_PROTECTED")
  assert.equal(integrity.findings.some((finding) =>
    finding.invariantCode === "NON_LIVE_ENTITY_IN_LIVE_DENOMINATOR"), false)
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "CURRENT_LIVE_COHORT_RECONCILIATION")?.status, "MITIGATED")
})

test("non-live entity actually included in a live denominator remains an active violation", () => {
  const live = Array.from({ length: 2 }, (_, index) =>
    listing(String(366_510_000_000 + index)))
  const historical = listing("365400000099", {
    key: "historical:365400000099",
    discovery: { livePresence: { status: "ENDED" } },
  })
  const { integrity } = build([...live, historical], {
    registry: { status: "COMPLETE", currentLiveCount: 2, matchedCount: 2,
      humanReviewCount: 0, coveragePercent: 100, limitationCodes: [] },
    currentLiveDenominatorItemIds: [
      ...live.map((row) => row.identity.itemId),
      historical.identity.itemId,
    ],
  })
  const finding = integrity.findings.find((candidate) =>
    candidate.invariantCode === "NON_LIVE_ENTITY_IN_LIVE_DENOMINATOR")
  assert.equal(finding?.lifecycle, "ACTIVE_VIOLATION")
  assert.equal(finding?.blockingImpact,
    "LIVE_PORTFOLIO_DENOMINATOR_CONTAMINATION")
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "CURRENT_LIVE_COHORT_RECONCILIATION")?.status, "TRIGGERED")
})

test("two current-live Item IDs sharing a Custom Label produce a human-gated collision", () => {
  const listings = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  listings[0].identity.sku = "IMN-LST-000026"
  listings[1].identity.sku = "IMN-LST-000026"
  const { integrity } = build(listings)

  assert.equal(integrity.liveSkuUniqueness.status, "FAIL")
  assert.equal(integrity.liveSkuUniqueness.collisionCount, 1)
  assert.deepEqual(integrity.liveSkuUniqueness.collisions[0].itemIds,
    [listings[0].identity.itemId, listings[1].identity.itemId])
  const finding = integrity.findings.find((candidate) =>
    candidate.invariantCode === "DUPLICATE_LIVE_SKU")
  assert.equal(finding?.humanApprovalRequired, true)
  assert.equal(finding?.deterministic, true)
  assert.equal(finding?.lifecycle, "ACTIVE_VIOLATION")
  assert.equal(finding?.guardAlwaysOn, true)
  assert.equal(finding?.guardCode, "LIVE_SKU_UNIQUENESS_CHECK")
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "LIVE_SKU_UNIQUENESS_CHECK")?.status, "TRIGGERED")
  assert.equal(integrity.deterministicGuards.find((guard) => guard.guardCode ===
    "LIVE_SKU_UNIQUENESS_CHECK")?.independentOfAutomationThreshold, true)
  assert.equal(finding?.recommendedAction,
    "HUMAN_REVIEW_LIVE_SKU_COLLISION_NO_MARKETPLACE_WRITE")
})

test("unproven capability zero is rejected while null is the coherent representation", () => {
  const falseZero = buildFalseZeroInvariantFindingV1({
    status: "UNPROVEN",
    count: 0,
    module: "OPPORTUNITIES",
    capability: "REPLACEMENT_CANDIDATES",
    scopeId: "current-live:test",
    observedAt: OBSERVED_AT,
  })
  assert.equal(falseZero?.invariantCode,
    "FALSE_ZERO_FROM_UNPROVEN_CAPABILITY")
  assert.equal(falseZero?.lifecycle, "ACTIVE_VIOLATION")
  assert.equal(falseZero?.guardCode, "FALSE_ZERO_REPRESENTATION_GUARD")
  assert.equal(falseZero?.guardAlwaysOn, true)
  assert.equal(buildFalseZeroInvariantFindingV1({
    status: "UNPROVEN",
    count: null,
    module: "OPPORTUNITIES",
    capability: "REPLACEMENT_CANDIDATES",
    scopeId: "current-live:test",
    observedAt: OBSERVED_AT,
  }), null)
  assert.equal(buildFalseZeroInvariantFindingV1({
    status: "AVAILABLE",
    count: 0,
    module: "EXPERIMENTS",
    capability: "ACTIVE_EXPERIMENTS",
    scopeId: "current-live:test",
    observedAt: OBSERVED_AT,
  }), null)
})

test("Account Traffic sales remain a distinct research scope with no fabricated attribution", () => {
  const listings = Array.from({ length: 27 }, (_, index) =>
    listing(String(366_500_000_000 + index)))
  const { integrity } = build(listings, {
    currentLiveQuantitySold: 0,
    accountTraffic: {
      status: "AVAILABLE",
      quantitySold: 2,
      source: "EBAY_ANALYTICS_TRAFFIC_REPORT_ACCOUNT_SCOPE",
    },
  })
  const finding = integrity.findings.find((candidate) =>
    candidate.invariantCode ===
      "HISTORICAL_OR_NONLIVE_SALES_ATTRIBUTION_REQUIRED")
  assert.equal(finding?.scopeType, "ACCOUNT_TRAFFIC_SCOPE")
  assert.equal(finding?.observedNumerator, 2)
  assert.equal(finding?.humanApprovalRequired, false)
  assert.equal(finding?.recommendedAction,
    "RESEARCH_HISTORICAL_OR_NONLIVE_SALES_ITEM_IDS")
})

test("invariant lifecycle distinguishes reconciliation and a human-accepted evidence duplicate", () => {
  assert.equal(resolveInvariantLifecycleV1({ activeViolation: false,
    authoritativeReconciliationEvidence: true }), "RECONCILED")
  assert.equal(resolveInvariantLifecycleV1({ activeViolation: true,
    humanAcceptedException: true }), "ACCEPTED_EXCEPTION")
  assert.equal(resolveInvariantLifecycleV1({ activeViolation: true }),
    "ACTIVE_VIOLATION")
})
