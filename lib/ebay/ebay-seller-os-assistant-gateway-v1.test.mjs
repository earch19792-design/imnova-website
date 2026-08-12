import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildAutomationHealthMetricsV1, buildCommercialEvidenceScoreV1,
  buildPortfolioIntelligenceV1, buildProactiveExceptionQueueV1,
  calculateTimeToFirstSaleV1, evaluateOpportunityRadarV1,
  evaluateReplaceKillIntelligenceV1, planAutomationWorkV1, rankReferenceCandidatesV1,
  assessLearningTransferV1 } from "./ebay-seller-os-portfolio-intelligence-v1.ts"

const route = readFileSync(new URL("../../app/api/admin/ebay/assistant/mcp/route.ts",
  import.meta.url), "utf8")
const assistantSource = readFileSync(new URL("./ebay-seller-os-assistant-gateway-v1.ts",
  import.meta.url), "utf8")

function observation(value, availability = "AVAILABLE") {
  return { value, availability, completeness: value === null ? "UNPROVEN" : "COMPLETE",
    source: { system: "TEST", operation: "READ", evidenceReference: "ref" },
    capturedAt: "2026-08-12T00:00:00Z", marketplace: { marketplaceId: "EBAY_US" },
    identity: { itemId: "123456789012" }, grain: "LISTING", reportingWindow: null,
    freshness: { status: "FRESH", ageSeconds: 0, maximumAgeSeconds: 60 }, unit: null,
    limitationCode: null, explicitAuthoritativeZero: value === 0 }
}

function listing(itemId, overrides = {}) {
  return { key: `listing:${itemId}`, identity: { itemId, title: `Listing ${itemId}`, sku: "SKU",
    primaryImageUrl: null, lastObservedAt: "2026-08-12T00:00:00Z" },
  discovery: { livePresence: { status: "LIVE_ACTIVE" } },
  metrics: { impressions: observation(100), views: observation(5), ctr: observation(5),
    transactions: observation(0), orders: observation(null, "UNAVAILABLE") },
  stock: { state: "STOCK_UNKNOWN", sourceContractStatus: "UNPROVEN", supplierProductId: null,
    supplierVariantId: null, supplierSku: null, quantity: observation(null, "UNKNOWN"),
    freshness: { status: "UNKNOWN", ageSeconds: null, maximumAgeSeconds: 60 }, limitationCode: "UNPROVEN" },
  composition: { bundleCapacity: observation(null, "UNKNOWN") }, blockers: [],
  dataQualityIssues: [], ...overrides }
}

function decision(itemId, overrides = {}) {
  return { listingKey: `listing:${itemId}`, classification: "CTR", priority: "HIGH",
    evidenceStatus: "AVAILABLE", reasonCodes: ["LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS"],
    recommendedAction: "IMPROVE_CTR", actionBlockedByInsufficientEvidence: false,
    experimentRunning: false, variableFrozen: false, protectionState: "NONE",
    experimentOperationalState: "INACTIVE", frozenVariables: [],
    nextReviewEvidenceRemaining: null, externalSignalCount: null,
    nextReviewCondition: null, nextReviewAt: null, actionExecutionAllowed: false, ...overrides }
}

function monitor(listings = [listing("123456789012")], decisions = [decision("123456789012")]) {
  return { contractVersion: "MONITOR", generatedAt: "2026-08-12T00:00:00Z", listings,
    alertCandidates: [], productCaseOperatingState: { status: "PAUSED" },
    learning: { status: "UNPROVEN", categoryAdjustments: [], limitationCode: "NO_HISTORY" },
    backend: { decisions, guidanceVsSellerOs: [], listingQualityReport: { status: "UNAVAILABLE_NO_CURRENT_REPORT",
      recommendations: [], limitationCode: "NO_CURRENT_REPORT" }, orders: { status: "AUTH_PENDING",
      fulfillmentStatuses: ["AUTH_PENDING"] }, trafficScopes: { accountTraffic: { status: "UNPROVEN" },
      currentLivePortfolio: { activeListings: listings.length } }, kpis: { activeListings: { value: listings.length } },
    capabilities: { registry: { status: "PARTIAL_CERTIFIED", humanReviewCount: 3,
      matchedCount: 24, coveragePercent: 88.89, limitationCodes: ["HUMAN_REVIEW"] },
      inventory: { inventoryItemsResource: "EBAY_REJECTED_25709_UNRESOLVED" } },
    operationalHealth: { runningExperiments: { status: "AVAILABLE" } } } }
}

test("ten Assistant tools are private read-only non-destructive closed-world contracts", () => {
  assert.equal(new Set(assistantSource.match(/seller_os_get_[a-z_]+/g)).size, 10)
  assert.match(assistantSource, /readOnlyHint: true/)
  assert.match(assistantSource, /destructiveHint: false/)
  assert.match(assistantSource, /openWorldHint: false/)
  assert.match(assistantSource, /sideEffects: false/)
  assert.match(route, /validateAdminApiRequest\(req\)/)
  assert.doesNotMatch(route, /execute\(|sendWhatsApp|apply_ebay_registry_repair|process\.env\.[A-Z_]+\s*=/)
})

test("exception queue is deterministic, deduped and protects active experiments", () => {
  const protectedDecision = decision("123456789012", { experimentRunning: true,
    protectionState: "DO_NOT_TOUCH", experimentOperationalState: "RUNNING" })
  const input = monitor([listing("123456789012")], [protectedDecision])
  const first = buildProactiveExceptionQueueV1({ monitor: input })
  assert.deepEqual(first, buildProactiveExceptionQueueV1({ monitor: input }))
  assert.equal(first.filter((row) => row.entityKey === "123456789012").length, 1)
  assert.equal(first.find((row) => row.entityKey === "123456789012").classification, "DO_NOT_TOUCH")
  assert.equal(first.find((row) => row.entityKey === "123456789012").recommendedAction,
    "WAIT_ACTIVE_EXPERIMENT")
})

test("hard operational override surfaces while ordinary replacement waits for experiment", () => {
  const current = listing("123456789012", { stock: { ...listing("123456789012").stock,
    state: "OUT_OF_STOCK_SIGNAL" } })
  const protectedDecision = decision("123456789012", { experimentRunning: true,
    protectionState: "DO_NOT_TOUCH", reasonCodes: ["HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW"] })
  assert.equal(buildProactiveExceptionQueueV1({ monitor: monitor([current], [protectedDecision]) })
    .find((row) => row.entityKey === "123456789012").classification, "CRITICAL_OPERATIONAL")
  assert.equal(evaluateReplaceKillIntelligenceV1({ listing: current,
    decision: protectedDecision, alternativeOpportunity: { opportunityId: "o", familyLabel: "Family",
      decision: "ADVANCE", score: 90, confidence: "HIGH", activeCompetitionCount: 2,
      keywordEvidenceScore: 80, comparableConfidence: 90, soldHistoryStatus: "UNAVAILABLE",
      observedAt: "2026-08-12T00:00:00Z" } }).status, "WAIT")
})

test("radar never fabricates sold momentum and scheduler is bounded priority-aware", () => {
  const radar = evaluateOpportunityRadarV1({ current: { opportunityId: "o", observedAt: "b",
    activeCompetitionCount: 5, medianActivePrice: 20, keywordEvidenceScore: 80,
    comparableClusterCount: 4, supplierMatchStatus: "UNPROVEN", soldEvidenceStatus: "UNAVAILABLE" },
  previous: { opportunityId: "o", observedAt: "a", activeCompetitionCount: 8,
    medianActivePrice: 20, keywordEvidenceScore: 60, comparableClusterCount: 2,
    supplierMatchStatus: "UNPROVEN", soldEvidenceStatus: "UNAVAILABLE" } })
  assert.equal(radar.state, "STRENGTHENING")
  assert.equal(radar.soldMomentumClaimed, false)
  const plan = planAutomationWorkV1({ entities: Array.from({ length: 1_200 }, (_, index) =>
    ({ entityKey: String(index), critical: index === 0, experimentActive: false,
      evidenceStale: index === 1, newOpportunity: false, healthy: index > 1 })),
  policy: { maximumBatchSize: 100, maximumConcurrency: 5, paginationBudget: 10,
    classWeights: { CRITICAL_WATCH: 100, ACTIVE_EXPERIMENT: 80, STALE_EVIDENCE: 90,
      NEW_OPPORTUNITY_RESEARCH: 70, NORMAL_ACTIVE_LISTING: 50, HEALTHY_LOW_PRIORITY: 10 } } })
  assert.equal(plan.work.length, 100)
  assert.equal(plan.work[0].workClass, "CRITICAL_WATCH")
  assert.equal(plan.uncontrolledFanout, false)
})

test("evidence score is transparent and never claims literal probability", () => {
  const score = buildCommercialEvidenceScoreV1({ components: [
    { name: "MARKET", value: 80, weight: 2, confidence: "HIGH", reason: "OBSERVED" },
    { name: "SOLD", value: null, weight: 3, confidence: "UNPROVEN", reason: "UNAVAILABLE" },
  ] })
  assert.equal(score.score, 80)
  assert.equal(score.literalSaleProbability, false)
  assert.equal(score.components.length, 2)
})

test("time-to-first-sale, learning transfer and reference strategy fail closed", () => {
  assert.equal(calculateTimeToFirstSaleV1({ listingStartedAt: "2026-01-01T00:00:00Z",
    firstAuthoritativeSaleAt: null, source: null }).status, "UNPROVEN")
  assert.equal(assessLearningTransferV1({ comparableCompletedExperiments: 1,
    familyIdentityProven: true, categoryIdentityProven: true }).scope, "LISTING_ONLY")
  const reference = rankReferenceCandidatesV1({ candidates: [{ itemId: "1", comparability: 95,
    categoryCorrect: true, packCompatible: true, formFactorCompatible: true,
    variantCompatible: true, brandModelContamination: false, dataQualityClean: true,
    marketEvidence: 90 }] })[0]
  assert.equal(reference.useAsReferenceRecommendation, "USE_AS_REFERENCE")
  assert.deepEqual(reference.copiedFields, [])
})

test("Assistant context is bounded and contains no secrets or buyer PII", () => {
  assert.match(assistantSource, /SELLER_OS_ASSISTANT_MAX_ITEMS = 100/)
  assert.match(assistantSource, /buyerPiiIncluded: false/)
  assert.match(assistantSource, /marketplaceWrites: 0/)
  assert.match(assistantSource, /stockUnknownIsRisk: false/)
  assert.doesNotMatch(assistantSource, /access_token|refresh_token|client_secret|buyerEmail|shippingAddress/i)
  assert.equal(buildPortfolioIntelligenceV1({ monitor: monitor() }).automaticPortfolioMutationAllowed, false)
  assert.equal(buildAutomationHealthMetricsV1({}).falseAlertRate.status, "NOT_ENOUGH_HISTORY")
})

test("existing Assistant read tools expose V2 commercial intelligence fields without writes", () => {
  for (const field of ["commercialRecommendation", "keywordRecommendation", "keywordOpportunity",
    "priceOpportunity", "referenceCandidate", "useAsReferenceReadiness", "nextBestEvidence",
    "exceptionPriority", "canonicalFamily"]) assert.match(assistantSource, new RegExp(field))
  assert.match(assistantSource, /seller_os_get_opportunity_case[\s\S]*commercialRecommendation/)
  assert.match(assistantSource, /seller_os_get_opportunity_radar[\s\S]*commercialRecommendation/)
  assert.match(assistantSource, /marketplaceWrites: 0/)
  assert.doesNotMatch(assistantSource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/)

  assert.match(assistantSource, /\.find\(\(row\) => row\.entityKey === itemId\)/)
})
