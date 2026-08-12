import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  SELLER_HUB_TRAFFIC_MAPPING_V1,
  buildCanonicalCommercialTimeSeriesV1,
  summarizeAccountTrafficV1,
} = await import("./ebay-commercial-monitor-traffic-scope-v1.ts")
const {
  EXPERIMENT_REGISTRY_CONTRACT_VERSION,
  assessExperimentGuardianV1,
  buildExperimentLearningEntryV1,
  evaluateExperimentOutcomeV1,
} = await import("./ebay-commercial-monitor-experiment-v1.ts")

const T0 = "2026-08-01T00:00:00.000Z"
const NOW = "2026-08-04T00:00:00.000Z"

function metricRow(values) {
  return {
    metrics: values,
    applicability: Object.fromEntries(Object.keys(values).map((key) => [key, true])),
  }
}

function experiment(overrides = {}) {
  return {
    contractVersion: EXPERIMENT_REGISTRY_CONTRACT_VERSION,
    experimentId: "exp_01",
    accountKey: "account",
    marketplace: "EBAY_US",
    ebayItemId: "123456789012",
    sku: "MUTABLE-SKU",
    hypothesis: "A controlled image change may improve CTR.",
    diagnosisClass: "CTR",
    experimentType: "PRIMARY_IMAGE",
    variableChanged: "PRIMARY_IMAGE",
    changedAt: T0,
    baselineEvidenceRef: "baseline-safe-ref",
    baselineMetric: "IMPRESSIONS",
    baselineValue: 100,
    lifecycleState: "RUNNING",
    frozenVariables: ["TITLE", "PRICE", "ITEM_SPECIFICS"],
    minimumObservationDurationHours: 48,
    minimumEvidenceMetric: "IMPRESSIONS",
    minimumEvidenceValue: 500,
    currentEvidenceValue: 300,
    nextReviewAt: null,
    createdAt: T0,
    updatedAt: NOW,
    ...overrides,
  }
}

test("Seller Hub mapping is explicit and Quantity Sold remains distinct from Orders", () => {
  assert.equal(SELLER_HUB_TRAFFIC_MAPPING_V1.impressions.apiMetric,
    "TOTAL_IMPRESSION_TOTAL")
  assert.equal(SELLER_HUB_TRAFFIC_MAPPING_V1.listingViews.apiMetric,
    "LISTING_VIEWS_TOTAL")
  assert.equal(SELLER_HUB_TRAFFIC_MAPPING_V1.quantitySold.apiMetric,
    "TRANSACTION")
  assert.equal(SELLER_HUB_TRAFFIC_MAPPING_V1.quantitySold.equivalence,
    "QUANTITY_SOLD_NOT_ORDER_COUNT")
  assert.match(SELLER_HUB_TRAFFIC_MAPPING_V1.ctr.apiMetric,
    /SEARCH_RESULTS_PAGE/)
})

test("account traffic uses account/day grain and weighted CTR", () => {
  const report = summarizeAccountTrafficV1({
    rows: [metricRow({
      TOTAL_IMPRESSION_TOTAL: 1_000,
      LISTING_VIEWS_TOTAL: 80,
      TRANSACTION: 2,
      LISTING_IMPRESSION_SEARCH_RESULTS_PAGE: 800,
      LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE: 40,
    }), metricRow({
      TOTAL_IMPRESSION_TOTAL: 500,
      LISTING_VIEWS_TOTAL: 30,
      TRANSACTION: 1,
      LISTING_IMPRESSION_SEARCH_RESULTS_PAGE: 200,
      LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE: 20,
    })],
    windowStart: "2026-07-01T00:00:00.000Z",
    windowEnd: "2026-07-30T23:59:59.999Z",
    requestedWindowStart: "2026-07-01",
    requestedWindowEnd: "2026-07-30",
    observedAt: NOW,
    sourceUpdatedAt: NOW,
    warnings: [],
  })
  assert.equal(report.scope, "ACCOUNT_TRAFFIC")
  assert.equal(report.grain, "ACCOUNT_DAY_AGGREGATE")
  assert.equal(report.impressions, 1_500)
  assert.equal(report.listingViews, 110)
  assert.equal(report.quantitySold, 3)
  assert.equal(report.ctr, 6)
})

test("experiment guardian requires both minimum time and minimum evidence", () => {
  const evidenceBlocked = assessExperimentGuardianV1({
    experiment: experiment(),
    observedAt: NOW,
    currentEvidenceValue: 300,
  })
  assert.equal(evidenceBlocked.timeGateSatisfied, true)
  assert.equal(evidenceBlocked.evidenceGateSatisfied, false)
  assert.equal(evidenceBlocked.readyToEvaluate, false)
  assert.equal(evidenceBlocked.protectionState, "DO_NOT_TOUCH")

  const timeBlocked = assessExperimentGuardianV1({
    experiment: experiment({ minimumObservationDurationHours: 120 }),
    observedAt: NOW,
    currentEvidenceValue: 600,
  })
  assert.equal(timeBlocked.timeGateSatisfied, false)
  assert.equal(timeBlocked.evidenceGateSatisfied, true)
  assert.equal(timeBlocked.readyToEvaluate, false)

  const ready = assessExperimentGuardianV1({
    experiment: experiment(),
    observedAt: NOW,
    currentEvidenceValue: 600,
  })
  assert.equal(ready.readyToEvaluate, true)
  assert.equal(ready.operationalAction, "REVIEW_EXPERIMENT_RESULT")
})

test("soft eBay signals queue while hard overrides pause for human review", () => {
  const soft = assessExperimentGuardianV1({
    experiment: experiment(),
    observedAt: NOW,
    externalSignals: [{
      code: "IMAGE_SUGGESTION",
      observedAt: NOW,
      source: "EBAY_LISTING_QUALITY_REPORT",
    }],
  })
  assert.equal(soft.operationalAction, "QUEUE_FOR_NEXT_REVIEW")
  assert.equal(soft.protectionState, "DO_NOT_TOUCH")

  const hard = assessExperimentGuardianV1({
    experiment: experiment(),
    observedAt: NOW,
    externalSignals: [{
      code: "OUT_OF_STOCK",
      observedAt: NOW,
      source: "AUTHORITATIVE_STOCK_EVIDENCE",
    }],
  })
  assert.equal(hard.operationalAction, "HARD_OVERRIDE_REQUIRED")
  assert.equal(hard.protectionState, "PAUSE_FOR_HUMAN_REVIEW")
})

test("outcome and learning remain evidence-bound and listing-only", () => {
  const guardian = assessExperimentGuardianV1({
    experiment: experiment(),
    observedAt: NOW,
    currentEvidenceValue: 600,
  })
  const incompatible = evaluateExperimentOutcomeV1({
    guardian,
    metric: "LISTING_VIEWS",
    baselineMetric: "IMPRESSIONS",
    baselineValue: 100,
    currentValue: 120,
    minimumMeaningfulDelta: 10,
    expectedDirection: "INCREASE",
  })
  assert.equal(incompatible.outcome, "INSUFFICIENT_EVIDENCE")
  const positive = evaluateExperimentOutcomeV1({
    guardian,
    metric: "IMPRESSIONS",
    baselineMetric: "IMPRESSIONS",
    baselineValue: 100,
    currentValue: 125,
    minimumMeaningfulDelta: 10,
    expectedDirection: "INCREASE",
  })
  assert.equal(positive.outcome, "POSITIVE")
  assert.equal(positive.evidenceState, "COMPARABLE_CORRELATIONAL")
  const learning = buildExperimentLearningEntryV1({
    experiment: experiment(),
    outcome: positive,
    lesson: "Observed association for this listing only.",
    createdAt: NOW,
  })
  assert.equal(learning.applicabilityScope, "LISTING_ONLY")
})

test("canonical time series excludes incompatible and synthetic evidence", () => {
  const source = {
    analytics: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    syntheticFallbackUsed: false,
    calculatedCtrNumerator: 5,
    calculatedCtrDenominator: 100,
  }
  const valid = {
    id: "one",
    listingId: "123456789012",
    impressions: 100,
    views: 10,
    transactions: 1,
    ctr: 5,
    observedAt: NOW,
    windowStart: "2026-07-01T00:00:00.000Z",
    windowEnd: "2026-07-30T23:59:59.999Z",
    source,
    completenessStatus: "complete",
  }
  const series = buildCanonicalCommercialTimeSeriesV1({
    snapshots: [valid, {
      ...valid,
      id: "synthetic",
      source: { ...source, syntheticFallbackUsed: true },
    }, {
      ...valid,
      id: "historical-only",
      listingId: "999999999999",
    }],
    currentLiveItemIds: ["123456789012"],
  })
  assert.equal(series.points.length, 1)
  assert.equal(series.points[0].quantitySold, 1)
  assert.equal(series.points[0].ctr, 5)
  assert.equal(series.status, "PARTIAL")
})

test("prepared experiment persistence has no marketplace or Registry write path", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260811120000_create_ebay_experiment_registry_v1.sql",
    import.meta.url,
  ), "utf8")
  assert.match(migration, /ebay_listing_experiments_v1/)
  assert.match(migration, /enable row level security/i)
  assert.doesNotMatch(migration, /ebay_active_listings|apply_ebay_registry_repair_v1/i)
  assert.doesNotMatch(migration, /insert\s+into|update\s+public|delete\s+from/i)
})
