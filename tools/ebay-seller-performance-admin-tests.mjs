import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildEbaySellerTrafficReportUrl,
  normalizeEbaySellerTrafficReport,
} from "../lib/ebay/ebay-seller-traffic-report.ts"

const metrics = [
  "TOTAL_IMPRESSION_TOTAL",
  "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
  "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
  "LISTING_VIEWS_TOTAL",
  "CLICK_THROUGH_RATE",
  "TRANSACTION",
  "SALES_CONVERSION_RATE",
]

function metricValues(values, inapplicableIndex = -1) {
  return values.map((value, index) => ({
    value,
    applicable: index !== inapplicableIndex,
  }))
}

const reportFixture = {
  header: {
    dimensionKeys: [{ key: "DAY", localizedName: "Day", dataType: "DATE" }],
    metrics: metrics.map((key) => ({ key, localizedName: key, dataType: "NUMBER" })),
  },
  records: [
    {
      dimensionValues: [{ value: "2026-07-10", applicable: true }],
      metricValues: metricValues([1000, 800, 80, 100, 10, 5, 5]),
    },
    {
      dimensionValues: [{ value: "2026-07-11", applicable: true }],
      metricValues: metricValues([500, 400, 20, 40, 5, 2, 5]),
    },
  ],
  startDate: "2026-07-10T00:00:00.000Z",
  endDate: "2026-07-11T23:59:59.000Z",
  lastUpdatedDate: "2026-07-12T02:00:00.000Z",
  warnings: [{ message: "Latest day is still being consolidated." }],
}

test("normalizes positional eBay metrics and calculates official funnel rates", () => {
  const dashboard = normalizeEbaySellerTrafficReport(reportFixture)
  assert.equal(dashboard.dimension, "DAY")
  assert.equal(dashboard.rows.length, 2)
  assert.equal(dashboard.rows[0].metrics.TOTAL_IMPRESSION_TOTAL, 1000)
  assert.equal(dashboard.summary.totalImpressions, 1500)
  assert.equal(dashboard.summary.totalViews, 140)
  assert.equal(dashboard.summary.transactions, 7)
  assert.equal(dashboard.summary.clickThroughRate, 8.33)
  assert.equal(dashboard.summary.salesConversionRate, 5)
  assert.deepEqual(dashboard.warnings, ["Latest day is still being consolidated."])
})

test("ignores eBay values explicitly marked inapplicable", () => {
  const fixture = structuredClone(reportFixture)
  fixture.records[0].metricValues = metricValues(
    [1000, 800, 80, 100, 10, 999, 5],
    5,
  )
  const dashboard = normalizeEbaySellerTrafficReport(fixture)
  assert.equal(dashboard.rows[0].metrics.TRANSACTION, 999)
  assert.equal(dashboard.rows[0].applicability.TRANSACTION, false)
  assert.equal(dashboard.summary.transactions, 2)
})

test("builds an official read-only URL with compact dates and listing filters", () => {
  const { url, listingIds } = buildEbaySellerTrafficReportUrl({
    dateFrom: "2026-06-12",
    dateTo: "2026-07-12",
    listingIds: ["123456789012", "987654321098", "123456789012", "invalid"],
  })
  assert.equal(url.origin, "https://api.ebay.com")
  assert.equal(url.pathname, "/sell/analytics/v1/traffic_report")
  assert.equal(url.searchParams.get("dimension"), "LISTING")
  assert.equal(
    url.searchParams.get("filter"),
    "marketplace_ids:{EBAY_US},date_range:[20260612..20260712],listing_ids:{123456789012|987654321098}",
  )
  assert.ok(url.searchParams.get("metric")?.includes("LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE"))
  assert.deepEqual(listingIds, ["123456789012", "987654321098"])
})

test("builds closed UTC windows with an explicit ISO 8601 offset", () => {
  const { url, timeZone } = buildEbaySellerTrafficReportUrl({
    dateFrom: "2026-07-08",
    dateTo: "2026-07-14",
    listingIds: ["366543596425"],
    timeZone: "UTC",
  })
  assert.equal(timeZone, "UTC")
  assert.equal(
    url.searchParams.get("filter"),
    "marketplace_ids:{EBAY_US},date_range:[2026-07-08T00:00:00.000Z..2026-07-14T23:59:59.999Z],listing_ids:{366543596425}",
  )
})

test("rejects impossible dates and ranges over 90 days", () => {
  assert.throws(
    () => buildEbaySellerTrafficReportUrl({ dateFrom: "2026-02-30", dateTo: "2026-03-01" }),
    /EBAY_ANALYTICS_DATE_RANGE_INVALID/,
  )
  assert.throws(
    () => buildEbaySellerTrafficReportUrl({ dateFrom: "2026-01-01", dateTo: "2026-07-01" }),
    /EBAY_ANALYTICS_DATE_RANGE_INVALID/,
  )
})

test("treats the official 90-day range as inclusive", () => {
  assert.doesNotThrow(() => buildEbaySellerTrafficReportUrl({
    dateFrom: "2026-01-01",
    dateTo: "2026-03-31",
  }))
  assert.throws(
    () => buildEbaySellerTrafficReportUrl({
      dateFrom: "2026-01-01",
      dateTo: "2026-04-01",
    }),
    /EBAY_ANALYTICS_DATE_RANGE_INVALID/,
  )
})

test("admin panel keeps OAuth server-only and calls the protected route with Admin auth", () => {
  const page = readFileSync(
    new URL("../app/admin/ebay/seller-performance/page.tsx", import.meta.url),
    "utf8",
  )
  const gateway = readFileSync(
    new URL("../lib/ebay/ebay-seller-analytics-readonly-gateway.ts", import.meta.url),
    "utf8",
  )
  const route = readFileSync(
    new URL("../app/api/admin/ebay/seller-performance/route.ts", import.meta.url),
    "utf8",
  )
  assert.match(page, /supabase\.auth\.getSession\(\)/)
  assert.match(page, /Authorization: `Bearer \$\{data\.session\.access_token\}`/)
  assert.match(page, /response\.status === 401.*AUTH_REQUIRED/)
  assert.match(page, /response\.status === 403.*ADMIN_FORBIDDEN/)
  assert.match(page, /\/api\/admin\/ebay\/seller-performance/)
  assert.match(page, /read-only/)
  assert.doesNotMatch(page, /process\.env/)
  assert.match(gateway, /tokenReturned: false/)
  assert.match(gateway, /tokenStoredByApplication: false/)
  assert.match(gateway, /X-EBAY-API-CALL-NAME": "GetUser"/)
  assert.match(gateway, /ebayProductionAccountFingerprint/)
  assert.match(gateway, /EBAY_ANALYTICS_ACCOUNT_IDENTITY_MISMATCH/)
  assert.match(gateway, /await assertAnalyticsSellerAccount\(token\)/)
  assert.match(gateway, /officialAccountIdentityBound/)
  assert.doesNotMatch(gateway, /console\.(log|error)/)
  assert.match(route, /loadStoredEbayCategoryLearningState/)
  assert.match(route, /reportRequestAffectsLearning: false/)
  assert.doesNotMatch(route, /persistOwnEbayPerformanceSnapshots/)
})

test("empty selection never falls through to an account-wide DAY report", () => {
  const page = readFileSync(
    new URL("../app/admin/ebay/seller-performance/page.tsx", import.meta.url),
    "utf8",
  )
  const route = readFileSync(
    new URL("../app/api/admin/ebay/seller-performance/route.ts", import.meta.url),
    "utf8",
  )
  assert.match(route, /EBAY_VERIFIED_LISTING_LINKS_READ_FAILED/)
  assert.match(route, /EBAY_VERIFIED_LISTING_REQUIRED/)
  assert.match(route, /status: 409/)
  assert.match(page, /Vacío = sólo listings propios verificados/)
  assert.match(page, /Registrar primer listing/)
})
