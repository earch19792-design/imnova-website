import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildMobileReviewRealRadarConnector,
  getRealRadarCandidateRoute,
} from "../lib/ebay/ebay-mobile-review-real-radar-connector.ts"

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-mobile-review-real-radar-connector-v1.json", "utf8"))
const moduleSource = readFileSync("lib/ebay/ebay-mobile-review-real-radar-connector.ts", "utf8")
const pageSource = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")

test("loads a modeled real Market Radar Top 5 without fixture fallback", () => {
  const report = buildMobileReviewRealRadarConnector(fixture)
  assert.equal(report.mobileReviewRealRadarConnectorBuilt, true)
  assert.equal(report.realRadarTop5Loaded, true)
  assert.equal(report.realRadarCandidatesCount, 7)
  assert.equal(report.eligibleCandidatesCount, 5)
  assert.equal(report.candidatesNeededForTop5, 0)
  assert.equal(report.fixtureUsed, false)
  assert.equal(report.dataSource, "MARKET_RADAR_READONLY")
  assert.equal(report.top5Candidates.length, 5)
  assert.equal(report.nextRecommendedRoute, "NEED_MOBILE_REVIEW_OF_REAL_TOP5")
  const first = report.top5Candidates[0]
  assert.equal(first.marketRadarProductId, "radar-product-101")
  assert.equal(first.marketRadarSnapshotId, "radar-snapshot-501")
  assert.equal(first.supplierSku, "LP-DRAWER-6")
  assert.equal(first.supplierVariantId, "luna-variant-101")
  assert.ok(first.lastSeenAt)
  assert.ok(first.lastSnapshotAt)
  assert.equal(first.stockSource, "variant_level")
  assert.equal(first.stockConfirmationAgeHours, 2)
})

test("empty Radar data does not silently use a fixture", () => {
  const report = buildMobileReviewRealRadarConnector({ products: [] })
  assert.equal(report.fixtureUsed, false)
  assert.equal(report.dataSource, "NO_REAL_RADAR_DATA_AVAILABLE")
  assert.equal(report.top5Candidates.length, 0)
  assert.equal(report.eligibleCandidatesCount, 0)
  assert.equal(report.candidatesNeededForTop5, 5)
  assert.equal(report.canProceedToB2RunPreflight, false)
})

test("real Radar stock holds stay visible and explain a missing Top 5", () => {
  const blockedProducts = fixture.products.filter((product) =>
    ["radar-product-106", "radar-product-107"].includes(product.product_id)
  )
  const report = buildMobileReviewRealRadarConnector({ products: blockedProducts })
  assert.equal(report.dataSource, "MARKET_RADAR_READONLY")
  assert.equal(report.realRadarCandidatesCount, 2)
  assert.equal(report.eligibleCandidatesCount, 0)
  assert.equal(report.stockHoldCandidates.length, 2)
  assert.equal(report.candidatesNeededForTop5, 5)
  assert.equal(report.nextRecommendedRoute, "NEED_REVIEW_OF_RADAR_STOCK_HOLDS")
  assert.ok(report.stockHoldCandidates.every((candidate) => candidate.routeRecommendation === "STOCK_HOLD"))
})

test("fixture is only exposed through explicit DEMO_FIXTURE_ONLY mode", () => {
  const report = buildMobileReviewRealRadarConnector({ ...fixture, mode: "DEMO_FIXTURE_ONLY" })
  assert.equal(report.fixtureUsed, true)
  assert.equal(report.dataSource, "DEMO_FIXTURE_ONLY")
  assert.equal(report.nextRecommendedRoute, "DEMO_ONLY_NO_APPROVAL")
  assert.equal(report.canProceedToB2RunPreflight, false)
})

test("stock and commercial guards produce blocking routes", () => {
  assert.equal(getRealRadarCandidateRoute({ inventory_status: "out_of_stock" }), "STOCK_HOLD")
  assert.equal(getRealRadarCandidateRoute({ observation_status: "stale_missing_from_source" }), "STOCK_HOLD")
  assert.equal(getRealRadarCandidateRoute({ inventory_scope: "availability_only" }), "NEED_STOCK_CONFIRMATION")
  assert.equal(getRealRadarCandidateRoute({ stock_confirmation_age_hours: 25 }), "NEED_STOCK_RECONFIRMATION")
  assert.equal(getRealRadarCandidateRoute({ inventory_status: "in_stock", observation_status: "observed", inventory_scope: "variant_level", stock_confirmation_age_hours: 1, estimated_sale_price: null }), "NEED_EBAY_MARKET_PRICE")
  assert.equal(getRealRadarCandidateRoute({ inventory_status: "in_stock", observation_status: "observed", inventory_scope: "variant_level", stock_confirmation_age_hours: 1, estimated_sale_price: 20, ebay_price_source: "READONLY", margin_precheck_passed: false }), "NEED_MARGIN_REVIEW")
})

test("mobile UI exposes source, Radar fields and browser-only persistence", () => {
  for (const expected of [
    /REAL RADAR/, /FIXTURE\/DEMO/, /MARKET_RADAR_READONLY/, /marketRadarProductId/,
    /marketRadarSnapshotId/, /supplierSku/, /supplierVariantId/, /lastSeenAt/,
    /lastSnapshotAt/, /candidate\.stockSource/, /candidate\.stockConfirmationAgeHours/, /BROWSER_STATE_ONLY/,
    /officialApprovalRecord: false/, /canPublish: false/, /sin eBay write/,
    /productos observados/, /candidatos seleccionables/, /B2-RUN continúa desactivado/,
  ]) assert.match(pageSource, expected)
})

test("connector has no external write or publication capability", () => {
  const combined = `${moduleSource}\n${pageSource}`
  for (const forbidden of [
    /method:\s*["']POST["']/, /\.insert\s*\(/, /\.update\s*\(/,
    /\.upsert\s*\(/, /publishOffer\s*\(/, /createOffer\s*\(/,
    /createOrReplaceInventoryItem\s*\(/, /process\.env/, /OPENAI_API_KEY/,
  ]) assert.doesNotMatch(combined, forbidden)
  const report = buildMobileReviewRealRadarConnector(fixture)
  assert.equal(report.canPublish, false)
  assert.equal(report.supabaseWriteUsed, false)
  assert.equal(report.ebayApiUsed, false)
  assert.equal(report.ebayWriteUsed, false)
})
