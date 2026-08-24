import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  EBAY_CATEGORY_LEARNING_POLICY,
  buildEbayCategoryLearningCollectionWindow,
  collectOwnEbayPerformanceForLearning,
  evaluateEbayAnalyticsReportCoverage,
  evaluateEbayCategoryLearning,
  getEbayCategoryLearningAccountKey,
  getEbayCategoryLearningActivationConfiguration,
  loadEbayCategoryLearningAdjustments,
  persistOwnEbayPerformanceSnapshots,
} from "../lib/ebay/ebay-category-performance-learning.ts"

const accountAlias = "official-seller-account"
const accountFingerprint = "a".repeat(64)
process.env.EBAY_SELLER_ACCOUNT_KEY = accountAlias
process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT =
  accountFingerprint
process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = ""
const accountKey = `${accountAlias}:${accountFingerprint}`
const categoryId = "50335"
const predictionEngineVersion =
  "EBAY-SELLER-COMMAND-CENTER-OPPORTUNITY-ENGINE-V3"
const previewActivationEnvironment = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-command-center",
  NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
  EBAY_CATEGORY_PERFORMANCE_LEARNING_PREVIEW_ENABLED: "true",
}

function buildSnapshots(count, options = {}) {
  const totalImpressions = options.totalImpressions ?? count * 50
  const perListing = Math.floor(totalImpressions / Math.max(1, count))
  const remainder = totalImpressions - perListing * count
  return Array.from({ length: count }, (_, index) => {
    const impressions = perListing + (index < remainder ? 1 : 0)
    return {
      manualListingLinkId: `link-${index}`,
      accountKey,
      ebayItemId: String(120000000000 + index),
      categoryId,
      predictedOpportunityScore: options.predictedOpportunityScore ?? 70,
      predictedEngineVersion: predictionEngineVersion,
      predictionSource:
        options.predictionSource ?? "LINK_TIME_OPPORTUNITY_QUEUE",
      windowDays: options.windowDays ?? 14,
      listingAgeDays: options.listingAgeDays ?? 14,
      totalImpressions: impressions,
      searchImpressions: impressions,
      totalViews: options.totalViewsPerListing ?? 10,
      searchViews: options.searchViewsPerListing ?? 3,
      transactions: options.transactionsPerListing ?? 1,
      observedAt: options.observedAt ?? "2026-07-13T12:00:00.000Z",
      source: options.source ?? "EBAY_SELL_ANALYTICS_READONLY",
      ownershipVerified: options.ownershipVerified ?? true,
    }
  })
}

function evaluate(snapshots) {
  return evaluateEbayCategoryLearning({
    accountKey,
    categoryId,
    predictionEngineVersion,
    snapshots,
    computedAt: "2026-07-13T12:00:00.000Z",
  })
}

test("learning account scope fails closed without a valid official identity", () => {
  const originalAlias = process.env.EBAY_SELLER_ACCOUNT_KEY
  const originalFingerprint =
    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
  const originalUserId =
    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID
  try {
    delete process.env.EBAY_SELLER_ACCOUNT_KEY
    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
    delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID
    assert.throws(
      () => getEbayCategoryLearningAccountKey(),
      /EBAY_CATEGORY_LEARNING_ACCOUNT_SCOPE_REQUIRED/,
    )

    process.env.EBAY_SELLER_ACCOUNT_KEY = "invalid account key"
    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT =
      accountFingerprint
    assert.throws(
      () => getEbayCategoryLearningAccountKey(),
      /EBAY_CATEGORY_LEARNING_ACCOUNT_SCOPE_INVALID/,
    )
  } finally {
    process.env.EBAY_SELLER_ACCOUNT_KEY = originalAlias
    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT =
      originalFingerprint
    process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = originalUserId
  }
})

test("performance learning activation is explicit, Preview-only and staging-bound", () => {
  assert.equal(getEbayCategoryLearningActivationConfiguration({}).active, false)
  assert.equal(getEbayCategoryLearningActivationConfiguration({
    ...previewActivationEnvironment,
    VERCEL_ENV: "production",
  }).active, false)
  assert.equal(getEbayCategoryLearningActivationConfiguration({
    ...previewActivationEnvironment,
    VERCEL_GIT_COMMIT_REF: "main",
  }).active, false)
  const active = getEbayCategoryLearningActivationConfiguration(
    previewActivationEnvironment,
  )
  assert.equal(active.status, "ACTIVE_PREVIEW_ONLY")
  assert.equal(active.active, true)
  assert.equal(active.safety.verifiedOwnListingsOnly, true)
  assert.equal(active.safety.ebayWrites, 0)
  assert.equal(active.safety.openAiCalls, 0)
  assert.equal(active.safety.automaticPriceChanges, 0)
  assert.equal(active.safety.automaticDeployments, 0)
})

test("one listing and nine listings only collect evidence with zero adjustment", () => {
  for (const count of [1, 9]) {
    const result = evaluate(buildSnapshots(count, {
      totalImpressions: 5_000,
      windowDays: 30,
      listingAgeDays: 30,
    }))
    assert.equal(result.status, "COLLECTING")
    assert.equal(result.eligible, false)
    assert.equal(result.adjustmentPoints, 0)
    assert.equal(result.sampleListingCount, count)
    assert.equal(
      result.remainingRequirements.linkedListings,
      EBAY_CATEGORY_LEARNING_POLICY.minimumLinkedListings - count,
    )
  }
})

test("ten listings still do not learn before fourteen days", () => {
  const result = evaluate(buildSnapshots(10, {
    totalImpressions: 1_000,
    windowDays: 13,
    listingAgeDays: 30,
  }))
  assert.equal(result.status, "COLLECTING")
  assert.equal(result.minimumObservationDays, 13)
  assert.equal(result.remainingRequirements.observationDays, 1)
  assert.equal(result.adjustmentPoints, 0)
})

test("ten mature listings still do not learn from 499 impressions", () => {
  const result = evaluate(buildSnapshots(10, { totalImpressions: 499 }))
  assert.equal(result.status, "COLLECTING")
  assert.equal(result.totalImpressions, 499)
  assert.equal(result.remainingRequirements.totalImpressions, 1)
  assert.equal(result.adjustmentPoints, 0)
})

test("inapplicable funnel metrics are not zero-filled into a negative lesson", () => {
  const snapshots = buildSnapshots(10, { totalImpressions: 1_000 })
    .map((snapshot) => ({
      ...snapshot,
      searchImpressions: null,
      searchViews: null,
      totalViews: null,
      transactions: null,
    }))
  const result = evaluate(snapshots)
  assert.equal(result.status, "COLLECTING")
  assert.equal(result.adjustmentPoints, 0)
  assert.equal(result.observedPerformanceScore, null)
  assert.equal(result.applicablePerformanceSignalAvailable, false)
})

test("neutral CTR and conversion produce exactly zero adjustment", () => {
  const result = evaluate(buildSnapshots(20, {
    totalImpressions: 2_000,
    windowDays: 28,
    listingAgeDays: 28,
    searchViewsPerListing: 3,
    totalViewsPerListing: 25,
    transactionsPerListing: 1,
  }))
  assert.equal(result.clickThroughRatePercent, 3)
  assert.equal(result.salesConversionRatePercent, 4)
  assert.equal(result.observedPerformanceScore, 50)
  assert.equal(result.reliabilityFactor, 1)
  assert.equal(result.adjustmentPoints, 0)
})

test("missing metrics reweight the available signal instead of becoming zero", () => {
  const snapshots = buildSnapshots(20, {
    totalImpressions: 2_000,
    windowDays: 28,
    listingAgeDays: 28,
    searchViewsPerListing: 6,
  }).map((snapshot) => ({
    ...snapshot,
    totalViews: null,
    transactions: null,
  }))
  const result = evaluate(snapshots)
  assert.equal(result.clickThroughRatePercent, 6)
  assert.equal(result.salesConversionRatePercent, null)
  assert.equal(result.observedPerformanceScore, 100)
  assert.equal(result.adjustmentPoints, 5)
})

test("eligible own-listing cohort calculates an auditable bounded adjustment", () => {
  const result = evaluate(buildSnapshots(10, { totalImpressions: 500 }))
  assert.equal(result.status, "ELIGIBLE_APPLIED")
  assert.equal(result.eligible, true)
  assert.ok(Math.abs(result.adjustmentPoints) <= 5)
  assert.equal(result.source, "EBAY_SELL_ANALYTICS_READONLY")
  assert.deepEqual(result.remainingRequirements, {
    linkedListings: 0,
    observationDays: 0,
    totalImpressions: 0,
  })
  assert.ok(result.reliabilityFactor > 0)
})

test("large cohorts are capped to plus or minus five points", () => {
  const negative = evaluate(buildSnapshots(20, {
    totalImpressions: 2_000,
    windowDays: 28,
    listingAgeDays: 28,
    predictedOpportunityScore: 100,
    searchViewsPerListing: 0,
    totalViewsPerListing: 0,
    transactionsPerListing: 0,
  }))
  const positive = evaluate(buildSnapshots(20, {
    totalImpressions: 2_000,
    windowDays: 28,
    listingAgeDays: 28,
    predictedOpportunityScore: 0,
    searchViewsPerListing: 6,
    totalViewsPerListing: 10,
    transactionsPerListing: 1,
  }))
  assert.equal(negative.reliabilityFactor, 1)
  assert.equal(negative.adjustmentPoints, -5)
  assert.equal(positive.adjustmentPoints, 5)
})

test("repeated snapshots do not inflate samples and competitor observations are ignored", () => {
  const latest = buildSnapshots(10, { totalImpressions: 500 })
  const oldDuplicates = buildSnapshots(10, {
    totalImpressions: 10_000,
    observedAt: "2026-07-01T12:00:00.000Z",
  })
  const deduplicated = evaluate([...oldDuplicates, ...latest])
  assert.equal(deduplicated.sampleListingCount, 10)
  assert.equal(deduplicated.totalImpressions, 500)

  const nineTrusted = buildSnapshots(9, {
    totalImpressions: 900,
    windowDays: 30,
    listingAgeDays: 30,
  })
  const competitor = {
    ...buildSnapshots(1, {
      totalImpressions: 5_000,
      windowDays: 30,
      listingAgeDays: 30,
      source: "COMPETITOR_OBSERVATION",
    })[0],
    manualListingLinkId: "competitor-link",
    ebayItemId: "999999999999",
  }
  const trustedOnly = evaluate([...nineTrusted, competitor])
  assert.equal(trustedOnly.sampleListingCount, 9)
  assert.equal(trustedOnly.status, "COLLECTING")
  assert.equal(trustedOnly.adjustmentPoints, 0)
})

test("backfilled predictions remain historical evidence and never calibrate ranking", () => {
  const nineCausal = buildSnapshots(9, {
    totalImpressions: 900,
    windowDays: 30,
    listingAgeDays: 30,
  })
  const backfilled = {
    ...buildSnapshots(1, {
      totalImpressions: 5_000,
      windowDays: 30,
      listingAgeDays: 30,
      predictionSource: "BACKFILLED_CURRENT_QUEUE",
    })[0],
    manualListingLinkId: "backfilled-link",
    ebayItemId: "888888888888",
  }
  const result = evaluate([...nineCausal, backfilled])
  assert.equal(result.sampleListingCount, 9)
  assert.equal(result.status, "COLLECTING")
  assert.equal(result.adjustmentPoints, 0)
})

test("learning requires lastUpdatedDate to cover the requested window", () => {
  const missingOfficialWindow = evaluateEbayAnalyticsReportCoverage({
    requestedDateFrom: "2026-06-13",
    requestedDateTo: "2026-07-12",
    reportDateFrom: null,
    reportDateTo: null,
    lastUpdatedDate: "2026-07-12",
  })
  assert.equal(missingOfficialWindow.complete, false)
  assert.equal(
    missingOfficialWindow.reason,
    "OFFICIAL_REPORT_WINDOW_MISSING_OR_INVALID",
  )

  const incomplete = evaluateEbayAnalyticsReportCoverage({
    requestedDateFrom: "2026-06-13",
    requestedDateTo: "2026-07-12",
    reportDateFrom: "2026-06-13",
    reportDateTo: "2026-07-12",
    lastUpdatedDate: "2026-07-11T23:59:59Z",
  })
  assert.equal(incomplete.complete, false)
  assert.equal(
    incomplete.reason,
    "OFFICIAL_REPORT_NOT_FINALIZED_OR_INCOMPLETE",
  )
  assert.equal(incomplete.lastUpdatedDate, "2026-07-11")

  const complete = evaluateEbayAnalyticsReportCoverage({
    requestedDateFrom: "2026-06-13",
    requestedDateTo: "2026-07-12",
    reportDateFrom: "2026-06-13",
    reportDateTo: "2026-07-12",
    lastUpdatedDate: "2026-07-12",
  })
  assert.equal(complete.complete, true)
})

test("automatic learning uses exactly fourteen completed UTC days", () => {
  assert.deepEqual(
    buildEbayCategoryLearningCollectionWindow("2026-07-13T12:00:00.000Z"),
    {
      dateFrom: "2026-06-29",
      dateTo: "2026-07-12",
      verifiedOnOrBefore: "2026-06-29T00:00:00.000Z",
      windowDays: 14,
    },
  )
})

test("automatic collector filters links at the causal window boundary", async () => {
  const filters = []
  const supabase = {
    from(table) {
      assert.equal(table, "ebay_manual_listing_links")
      const builder = {
        select() { return builder },
        eq(column, value) {
          filters.push(["eq", column, value])
          return builder
        },
        lte(column, value) {
          filters.push(["lte", column, value])
          return builder
        },
        gte(column, value) {
          filters.push(["gte", column, value])
          return builder
        },
        order() { return builder },
        limit() { return builder },
        then(resolve, reject) {
          return Promise.resolve({ data: [], error: null, count: 0 })
            .then(resolve, reject)
        },
      }
      return builder
    },
  }
  const result = await collectOwnEbayPerformanceForLearning(supabase, {
    now: "2026-07-13T12:00:00.000Z",
    environment: previewActivationEnvironment,
  })
  assert.equal(result.status, "NO_CAUSALLY_ELIGIBLE_VERIFIED_LISTINGS")
  assert.deepEqual(
    filters.find((entry) => entry[0] === "lte"),
    ["lte", "verified_at", "2026-06-29T00:00:00.000Z"],
  )
  assert.deepEqual(
    filters.find((entry) => entry[0] === "gte"),
    ["gte", "last_verification_at", "2026-07-12T00:00:00.000Z"],
  )
  assert.deepEqual(result.reportWindow, {
    dateFrom: "2026-06-29",
    dateTo: "2026-07-12",
    verifiedOnOrBefore: "2026-06-29T00:00:00.000Z",
    windowDays: 14,
  })
})

test("ranking adjustments require fresh, non-future computed evidence", async () => {
  const filters = []
  const now = "2026-07-13T12:00:00.000Z"
  const base = {
    account_key: accountKey,
    marketplace_id: "EBAY_US",
    model_version: "EBAY-CATEGORY-PERFORMANCE-CALIBRATION-V2",
    prediction_engine_version: predictionEngineVersion,
    status: "ELIGIBLE_APPLIED",
    eligible: true,
    adjustment_points: 2,
    sample_listing_count: 10,
    total_impressions: 500,
    minimum_observation_days: 14,
    source: "EBAY_SELL_ANALYTICS_READONLY",
  }
  const supabase = {
    from(table) {
      assert.equal(table, "ebay_category_learning_adjustments")
      const builder = {
        select() { return builder },
        eq() { return builder },
        gte(column, value) {
          filters.push(["gte", column, value])
          return builder
        },
        lte(column, value) {
          filters.push(["lte", column, value])
          return builder
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: [
              { ...base, category_id: "1", computed_at: "2026-07-12T12:00:00.000Z" },
              { ...base, category_id: "2", computed_at: "2026-07-11T23:59:59.999Z" },
              { ...base, category_id: "3", computed_at: "2026-07-13T12:05:00.001Z" },
            ],
            error: null,
          }).then(resolve, reject)
        },
      }
      return builder
    },
  }
  const adjustments = await loadEbayCategoryLearningAdjustments(
    supabase,
    predictionEngineVersion,
    { now, environment: previewActivationEnvironment },
  )
  assert.deepEqual(Object.keys(adjustments), ["1"])
  assert.deepEqual(filters, [
    ["gte", "computed_at", "2026-07-12T00:00:00.000Z"],
    ["lte", "computed_at", "2026-07-13T12:05:00.000Z"],
  ])
})

test("official listing rows persist only through a verified own link and preserve inapplicable metrics as null", async () => {
  const calls = []
  let storedSnapshots = []
  const link = {
    id: "11111111-1111-4111-8111-111111111111",
    account_key: accountKey,
    marketplace_id: "EBAY_US",
    ebay_item_id: "120000000000",
    opportunity_id: "22222222-2222-4222-8222-222222222222",
    candidate_key: "luna:test:1",
    verification_status: "verified",
    verification_method: "EBAY_TRADING_GET_ITEM_READONLY",
    verified_at: "2026-06-01T00:00:00.000Z",
    last_verification_at: "2026-07-01T11:55:00.000Z",
    safe_defaults: { categoryId },
    predicted_opportunity_score: 70,
    predicted_engine_version: predictionEngineVersion,
    predicted_category_id: categoryId,
    prediction_source: "LINK_TIME_OPPORTUNITY_QUEUE",
  }
  const supabase = {
    from(table) {
      let operation = "read"
      const builder = {
        select() {
          operation = "select"
          return builder
        },
        eq() { return builder },
        gte() { return builder },
        in() { return builder },
        order() { return builder },
        limit() { return builder },
        upsert(payload, options) {
          operation = "upsert"
          calls.push({ table, payload, options })
          if (table === "ebay_listing_performance_snapshots") {
            storedSnapshots = payload
          }
          return builder
        },
        then(resolve, reject) {
          const result = operation === "upsert"
            ? { error: null }
            : table === "ebay_manual_listing_links"
              ? { data: [link], error: null }
              : table === "ebay_listing_performance_snapshots"
                ? { data: storedSnapshots, error: null }
                : { data: [], error: null }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return builder
    },
  }
  const metricKeys = [
    "TOTAL_IMPRESSION_TOTAL",
    "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
    "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
    "LISTING_VIEWS_TOTAL",
    "CLICK_THROUGH_RATE",
    "TRANSACTION",
    "SALES_CONVERSION_RATE",
  ]
  const report = {
    header: {
      dimensionKeys: [{ key: "LISTING" }],
      metrics: metricKeys.map((key) => ({ key })),
    },
    records: [{
      dimensionValues: [{ value: "120000000000" }],
      metricValues: [
        { value: 500, applicable: true },
        { value: 400, applicable: true },
        { value: 999, applicable: false },
        { value: 50, applicable: true },
        { value: 10, applicable: true },
        { value: 1, applicable: true },
        { value: 2, applicable: true },
      ],
    }],
    startDate: "2026-06-01T00:00:00.000Z",
    endDate: "2026-06-30T23:59:59.000Z",
    lastUpdatedDate: "2026-07-01T02:00:00.000Z",
  }
  const result = await persistOwnEbayPerformanceSnapshots(
    supabase,
    report,
    {
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      listingIds: ["120000000000"],
      observedAt: "2026-07-01T12:00:00.000Z",
      environment: previewActivationEnvironment,
    },
  )
  const snapshotWrite = calls.find((call) =>
    call.table === "ebay_listing_performance_snapshots"
  )
  const adjustmentWrite = calls.find((call) =>
    call.table === "ebay_category_learning_adjustments"
  )
  assert.equal(result.status, "COLLECTING")
  assert.equal(result.snapshotCount, 1)
  assert.equal(snapshotWrite.payload[0].ebay_item_id, link.ebay_item_id)
  assert.equal(snapshotWrite.payload[0].search_views, null)
  assert.equal(snapshotWrite.payload[0].source, "EBAY_SELL_ANALYTICS_READONLY")
  assert.match(snapshotWrite.payload[0].snapshot_fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(Object.hasOwn(snapshotWrite.payload[0], "raw_payload"), false)
  assert.equal(adjustmentWrite.payload.status, "COLLECTING")
  assert.equal(adjustmentWrite.payload.sample_listing_count, 1)
  assert.equal(adjustmentWrite.payload.adjustment_points, 0)

  calls.length = 0
  link.verified_at = "2026-06-01T00:00:01.000Z"
  const causallyRejected = await persistOwnEbayPerformanceSnapshots(
    supabase,
    report,
    {
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      listingIds: ["120000000000"],
      observedAt: "2026-07-01T12:00:00.000Z",
      environment: previewActivationEnvironment,
    },
  )
  assert.equal(causallyRejected.status, "CAUSAL_WINDOW_REQUIRED")
  assert.equal(causallyRejected.snapshotCount, 0)
  assert.equal(causallyRejected.preVerificationWindowLinkCount, 1)
  assert.equal(calls.some((call) =>
    call.table === "ebay_listing_performance_snapshots"
  ), false)
})

test("migration, performance route and scan enforce the conservative learning path", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260713072000_create_ebay_post_listing_learning.sql",
      import.meta.url,
    ),
    "utf8",
  )
  const performanceRoute = readFileSync(
    new URL("../app/api/admin/ebay/seller-performance/route.ts", import.meta.url),
    "utf8",
  )
  const scanService = readFileSync(
    new URL("../lib/ebay/ebay-first-luna-scan-service.ts", import.meta.url),
    "utf8",
  )
  const engine = readFileSync(
    new URL("../lib/ebay/ebay-luna-demand-opportunity-engine.ts", import.meta.url),
    "utf8",
  )
  const cron = readFileSync(
    new URL("../app/api/cron/ebay-seller-performance-learning/route.ts", import.meta.url),
    "utf8",
  )
  const scanCron = readFileSync(
    new URL("../app/api/cron/ebay-luna-opportunity-scan/route.ts", import.meta.url),
    "utf8",
  )
  const vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
  const learningService = readFileSync(
    new URL("../lib/ebay/ebay-category-performance-learning.ts", import.meta.url),
    "utf8",
  )

  assert.match(migration, /prediction_snapshot_immutable/i)
  assert.match(migration, /LINK_TIME_OPPORTUNITY_QUEUE/i)
  assert.match(migration, /verification_status = 'verified'/i)
  assert.match(migration, /last_verification_at >= new\.observed_at - interval '36 hours'/i)
  assert.match(migration, /EBAY_SELL_ANALYTICS_READONLY/g)
  assert.match(migration, /sample_listing_count >= 10/i)
  assert.match(migration, /total_impressions >= 500/i)
  assert.match(migration, /minimum_observation_days >= 14/i)
  assert.match(migration, /adjustment_points between -5 and 5/i)
  assert.match(
    migration,
    /EBAY_PERFORMANCE_SNAPSHOT_WINDOW_PRECEDES_LINK_VERIFICATION/,
  )
  assert.match(migration, /enable row level security/i)
  assert.doesNotMatch(migration, /raw_payload\s+jsonb/i)
  assert.doesNotMatch(migration, /(?:access|refresh)_token\s+text/i)
  assert.match(performanceRoute, /loadStoredEbayCategoryLearningState/)
  assert.match(performanceRoute, /persistencePerformed: false/)
  assert.match(performanceRoute, /trainingTriggered: false/)
  assert.doesNotMatch(performanceRoute, /persistOwnEbayPerformanceSnapshots/)
  assert.match(learningService, /\.lte\("verified_at", reportWindow\.verifiedOnOrBefore\)/)
  assert.match(learningService, /\.gte\("last_verification_at", verificationFreshnessCutoff\)/)
  assert.doesNotMatch(learningService, /\|\| "default"/)
  assert.match(scanService, /loadEbayCategoryLearningAdjustments/)
  assert.match(engine, /safetyGatesChanged: false/)
  assert.match(engine, /competitorPerformanceUsed: false/)
  assert.match(cron, /CRON_SECRET/)
  assert.match(cron, /getEbayCategoryLearningActivationConfiguration/)
  assert.match(cron, /PREVIEW_LEARNING_DISABLED/)
  assert.match(cron, /collectOwnEbayPerformanceForLearning/)
  assert.match(cron, /ebayWriteUsed: false/)
  assert.match(
    learningService,
    /EBAY_CATEGORY_PERFORMANCE_LEARNING_PREVIEW_ENABLED/,
  )
  assert.match(learningService, /VERCEL_ENV === "preview"/)
  assert.match(learningService, /VERCEL_GIT_COMMIT_REF/)
  assert.match(learningService, /EBAY_CATEGORY_LEARNING_STAGING_REF/)
  assert.match(scanCron, /collectOwnEbayPerformanceForLearning/)
  assert.match(scanCron, /reverifyManualEbayListingsReadonly/)
  assert.match(scanCron, /postListingLearning/)
  assert.match(scanCron, /CRON_RESPONSE_RESERVE_MS = 15_000/)
  assert.match(scanCron, /const workDeadlineAt = startedAt \+ CRON_TIME_BUDGET_MS/)
  assert.match(scanCron, /remainingWorkMs\(\) < CRON_CANDIDATE_MINIMUM_REMAINING_MS/)
  assert.doesNotMatch(scanCron, /index > 0/)
  assert.doesNotMatch(vercel, /ebay-seller-performance-learning/)
  assert.equal(JSON.parse(vercel).crons.length, 3)
})
