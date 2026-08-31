import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try {
        return nextResolve(`${value}.ts`, context)
      } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  resolveAnalyticsLastKnownGoodV1,
} = await import("./ebay-analytics-last-known-good-v1.ts")
const { persistAnalyticsLastKnownGoodV1 } = await import(
  "./ebay-analytics-last-known-good-persistence-v1.ts"
)

const CAPTURED_AT = "2026-08-29T12:00:00.000Z"
const WINDOW_START = "2026-07-30T00:00:00.000Z"
const WINDOW_END = "2026-08-28T23:59:59.999Z"

function accountTraffic(overrides = {}) {
  return {
    status: "AVAILABLE",
    scope: "ACCOUNT_TRAFFIC",
    scopeId: "account-traffic:UTC:2026-07-30:2026-08-28",
    scopeType: "ACCOUNT_TRAFFIC_SCOPE",
    scopeCount: 30,
    grain: "ACCOUNT_DAY_AGGREGATE",
    entityType: "ACCOUNT_TRAFFIC_DAY_BUCKET",
    source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    timeZone: "UTC",
    observedAt: CAPTURED_AT,
    sourceUpdatedAt: CAPTURED_AT,
    completeness: "COMPLETE",
    impressions: 9367,
    listingViews: 53,
    quantitySold: 2,
    ctr: 0.68812,
    accountTrafficSnapshotId: "account-traffic-snapshot:test-lkg",
    auditSpanId: "account-traffic-audit:test-lkg",
    metadataValidationStatus: "VALID",
    metadataValidationReasonCode: null,
    upstreamSnapshotAcquisitionCount: 1,
    cumulativeAcquisitionCount: 1,
    cacheHitCount: 0,
    retryCount: 0,
    retryPolicy: "NO_RETRY",
    snapshotReuseStatus: "ACQUIRED",
    snapshotReuseReasonCode: "CACHE_MISS_ACQUIRED",
    gapCodes: [],
    ...overrides,
  }
}

function observation(itemId, impressions, views, transactions) {
  return {
    itemId,
    impressions,
    totalListingViews: views,
    externalViews: 0,
    transactions,
    reportedCtr: 1,
    calculatedCtr: 1,
    calculatedCtrNumerator: views,
    calculatedCtrDenominator: impressions,
    reportedConversion: 1,
    applicable: {
      impressions: true,
      totalListingViews: true,
      externalViews: true,
      transactions: true,
      reportedCtr: true,
      calculatedCtr: true,
      reportedConversion: true,
    },
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    observedAt: CAPTURED_AT,
    sourceUpdatedAt: CAPTURED_AT,
    lastUpdatedDate: "2026-08-29",
    completeness: "COMPLETE",
    freshnessStatus: "FRESH",
    source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
  }
}

function live200() {
  const observations = [
    observation("111111111111", 10, 1, 0),
    observation("222222222222", 20, 2, 1),
  ]
  return {
    discovery: {
      currentLiveListings: observations.map((row) => ({
        itemId: row.itemId,
        marketplaceCertification: { status: "US_CERTIFIED" },
      })),
    },
    analytics: {
      status: "CERTIFIED",
      observedAt: CAPTURED_AT,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      analyticsRequestedItemCount: 2,
      analyticsRepresentedItemCount: 2,
      analyticsMissingItemCount: 0,
      analyticsCoverageStatus: "COMPLETE",
      accountTraffic: accountTraffic(),
      observations,
      gapCodes: [],
    },
  }
}

function live429() {
  return {
    ...live200(),
    analytics: {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      analyticsRequestedItemCount: 2,
      analyticsRepresentedItemCount: null,
      analyticsMissingItemCount: null,
      analyticsCoverageStatus: "UNPROVEN",
      accountTraffic: accountTraffic({
        status: "UNAVAILABLE",
        windowStart: null,
        windowEnd: null,
        observedAt: null,
        sourceUpdatedAt: null,
        completeness: "UNPROVEN",
        impressions: null,
        listingViews: null,
        quantitySold: null,
        ctr: null,
        accountTrafficSnapshotId: null,
        snapshotReuseStatus: "UNAVAILABLE",
        snapshotReuseReasonCode: "SOURCE_UNAVAILABLE",
        gapCodes: ["EBAY_MONITOR_ACCOUNT_TRAFFIC_429"],
      }),
      observations: [],
      gapCodes: ["EBAY_MONITOR_ACCOUNT_TRAFFIC_429"],
    },
  }
}

function persistenceSupabase(rows) {
  return {
    from(table) {
      assert.equal(table, "listing_commercial_snapshots")
      return {
        upsert(values, options) {
          assert.deepEqual(options, { onConflict: "id" })
          rows.splice(0, rows.length, ...structuredClone(values))
          return {
            async select(selection) {
              assert.equal(selection, "id")
              return { data: values.map((row) => ({ id: row.id })), error: null }
            },
          }
        },
      }
    },
  }
}

test("LAST_SUCCESSFUL_200 then 429 preserves exact account and listing scopes as stale", async () => {
  const durableRows = []
  const persisted = await persistAnalyticsLastKnownGoodV1({
    supabase: persistenceSupabase(durableRows),
    accountKey: "seller:test",
    live: live200(),
  })
  assert.equal(persisted.status, "PERSISTED")
  assert.equal(persisted.rowsWritten, 2)
  assert.equal(persisted.durableReadback, true)

  const resolved = resolveAnalyticsLastKnownGoodV1({
    analytics: live429().analytics,
    storedRows: durableRows,
    currentLiveItemIds: ["111111111111", "222222222222"],
    now: new Date("2026-08-30T12:00:00.000Z"),
  })
  assert.equal(resolved.analyticsStatus, "LAST_KNOWN_GOOD")
  assert.equal(resolved.currentSourceStatus, "UNAVAILABLE_429")
  assert.equal(resolved.snapshotDataStatus, "AVAILABLE_STALE")
  assert.equal(resolved.analytics.accountTraffic.impressions, 9367)
  assert.equal(resolved.analytics.accountTraffic.listingViews, 53)
  assert.equal(resolved.analytics.accountTraffic.ctr, 0.68812)
  assert.equal(resolved.analytics.accountTraffic.quantitySold, 2)
  assert.equal(resolved.analytics.accountTraffic.analyticsStatus,
    "LAST_KNOWN_GOOD")
  assert.equal(resolved.analytics.observations.reduce((sum, row) =>
    sum + row.impressions, 0), 30)
  assert.notEqual(resolved.analytics.accountTraffic.impressions, 30)
  assert.equal(resolved.analytics.gapCodes.includes(
    "EBAY_MONITOR_ACCOUNT_TRAFFIC_429"), true)
  assert.equal(resolved.itemBaselineAvailable("111111111111"), true)
})

test("incomplete or window-incompatible cohort stays unavailable without false zero", async () => {
  const durableRows = []
  await persistAnalyticsLastKnownGoodV1({
    supabase: persistenceSupabase(durableRows),
    accountKey: "seller:test",
    live: live200(),
  })
  const resolved = resolveAnalyticsLastKnownGoodV1({
    analytics: live429().analytics,
    storedRows: durableRows.slice(0, 1),
    currentLiveItemIds: ["111111111111", "222222222222"],
  })
  assert.equal(resolved.analyticsStatus, "UNAVAILABLE")
  assert.equal(resolved.analytics.accountTraffic.impressions, null)
  assert.equal(resolved.analytics.accountTraffic.listingViews, null)
  assert.equal(resolved.currentLiveSnapshotAvailable, false)
  assert.equal(resolved.itemBaselineAvailable("111111111111"), false)
})

test("next successful 200 remains current and supersedes durable fallback without acquisition", () => {
  let extraAnalyticsRequests = 0
  const current = live200().analytics
  const resolved = resolveAnalyticsLastKnownGoodV1({
    analytics: current,
    storedRows: [],
    currentLiveItemIds: ["111111111111", "222222222222"],
  })
  assert.equal(resolved.analyticsStatus, "CURRENT")
  assert.equal(resolved.snapshotDataStatus, "AVAILABLE_CURRENT")
  assert.equal(resolved.analytics, current)
  assert.equal(extraAnalyticsRequests, 0)
})
