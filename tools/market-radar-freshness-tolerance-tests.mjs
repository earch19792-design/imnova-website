import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { getRadarFreshnessState } from "../lib/market-radar-actionable-ranking.mjs"
import { buildMobileReviewRealRadarConnector, getRealRadarCandidateRoute, mapMarketRadarProductToMobileCandidate } from "../lib/ebay/ebay-mobile-review-real-radar-connector.ts"
import { getCandidatePendingRadarGuards } from "../lib/ebay/ebay-mobile-review-radar-guard-enforcement.ts"

const at = (lastSeenAt, sourceLastSuccessAt, pollIntervalMinutes = 15) =>
  getRadarFreshnessState({ last_seen_at: lastSeenAt }, { sourceLastSuccessAt, pollIntervalMinutes, now: sourceLastSuccessAt })

test("same scan timestamps and sub-interval write skew remain observed", () => {
  for (const deltaMs of [0, 1, 999, 10_000, 14 * 60 * 1000 + 59_999]) {
    const success = Date.parse("2026-07-12T01:38:20.000Z")
    const state = at(new Date(success - deltaMs).toISOString(), new Date(success).toISOString())
    assert.equal(state.observation_status, "observed")
    assert.equal(state.consecutive_missing_scans_estimate, 0)
    assert.equal(state.stock_reconfirmation_required, false)
  }
})

test("one and two complete polling intervals produce missing and stale states", () => {
  const success = "2026-07-12T02:00:00.000Z"
  const one = at("2026-07-12T01:45:00.000Z", success)
  assert.equal(one.observation_status, "not_observed_latest_scan")
  assert.equal(one.consecutive_missing_scans_estimate, 1)
  const two = at("2026-07-12T01:30:00.000Z", success)
  assert.equal(two.observation_status, "stale_missing_from_source")
  assert.equal(two.consecutive_missing_scans_estimate, 2)
})

test("missing source success uses safe observed fallback", () => {
  const state = at("2026-07-12T01:38:20.000Z", null)
  assert.equal(state.observation_status, "observed")
  assert.equal(state.consecutive_missing_scans_estimate, 0)
})

test("recent Radar product is not STOCK_HOLD but independent guards remain", () => {
  const freshness = at("2026-07-12T01:38:19.883Z", "2026-07-12T01:38:20.000Z")
  const product = {
    product_id: "fresh-product",
    supplier_product_id: "supplier-product",
    title: "Fresh product",
    handle: "fresh-product",
    last_seen_at: "2026-07-12T01:38:19.883Z",
    inventory_status: "unknown",
    inventory_scope: "unknown",
    inventory_confidence: "low",
    inventory_quantity: null,
    opportunity_score: 92,
    professional_missing_fields: ["supplier_sku", "supplier_variant_identity"],
    ...freshness,
  }
  assert.equal(getRealRadarCandidateRoute(product), "NEED_STOCK_CONFIRMATION")
  const candidate = mapMarketRadarProductToMobileCandidate(product, 1)
  const guards = getCandidatePendingRadarGuards(candidate)
  assert.ok(guards.includes("missingSnapshot"))
  assert.ok(guards.includes("missingVariant"))
  assert.ok(guards.includes("missingSku"))
  assert.ok(guards.includes("stockUnknown"))
  assert.equal(candidate.availabilityStatus, "AVAILABLE")

  const top5 = buildMobileReviewRealRadarConnector({
    products: Array.from({ length: 5 }, (_, index) => ({
      ...product,
      product_id: `fresh-product-${index + 1}`,
      supplier_product_id: `supplier-product-${index + 1}`,
      opportunity_score: 92 - index,
    })),
  })
  assert.equal(top5.realRadarTop5Loaded, true)
  assert.equal(top5.top5Candidates.length, 5)
  assert.equal(top5.stockHoldCandidates.length, 0)
  assert.ok(top5.top5Candidates.every((entry) => entry.routeRecommendation === "NEED_STOCK_CONFIRMATION"))
})

test("freshness implementation remains pure and contains no writes", () => {
  const source = readFileSync("lib/market-radar-actionable-ranking.mjs", "utf8")
  for (const forbidden of [/fetch\s*\(/, /\.insert\s*\(/, /\.update\s*\(/, /\.upsert\s*\(/, /publishOffer\s*\(/, /process\.env/]) assert.doesNotMatch(source, forbidden)
})
