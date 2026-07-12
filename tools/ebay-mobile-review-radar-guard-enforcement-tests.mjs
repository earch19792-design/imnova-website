import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildMobileReviewRadarGuardEnforcement, getCandidatePendingRadarGuards, getPrimaryRadarGuardRoute } from "../lib/ebay/ebay-mobile-review-radar-guard-enforcement.ts"
import { getRealRadarCandidateRoute } from "../lib/ebay/ebay-mobile-review-real-radar-connector.ts"

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-mobile-review-radar-guard-enforcement-v1.json", "utf8"))
const pageSource = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
const guardSource = readFileSync("lib/ebay/ebay-mobile-review-radar-guard-enforcement.ts", "utf8")

test("stock routes have priority over downstream commercial guards", () => {
  assert.equal(getRealRadarCandidateRoute({ inventory_status: "in_stock", inventory_quantity: null, inventory_scope: "unknown", estimated_sale_price: null }), "NEED_STOCK_CONFIRMATION")
  assert.equal(getRealRadarCandidateRoute({ inventory_status: "in_stock", inventory_quantity: null, inventory_scope: "availability_only", estimated_sale_price: null }), "NEED_STOCK_CONFIRMATION")
  assert.equal(getRealRadarCandidateRoute({ inventory_status: "out_of_stock" }), "STOCK_HOLD")
  assert.equal(getPrimaryRadarGuardRoute(["stockStale", "missingEbayPrice"]), "NEED_STOCK_RECONFIRMATION")
  assert.equal(getPrimaryRadarGuardRoute(["stockUnknown", "missingCategoryId"]), "NEED_STOCK_CONFIRMATION")
  assert.equal(getPrimaryRadarGuardRoute(["missingEbayPrice", "missingMargin"]), "NEED_EBAY_MARKET_PRICE")
  assert.equal(getPrimaryRadarGuardRoute(["missingMargin", "missingCategoryId"]), "NEED_MARGIN_REVIEW")
})

test("approval cannot bypass pending Radar guards", () => {
  const selectedCandidate = fixture.top5Candidates[0]
  const pending = getCandidatePendingRadarGuards(selectedCandidate)
  const report = buildMobileReviewRadarGuardEnforcement({ ...fixture, selectedCandidate, approveAttempt: true, localConfirmationsComplete: true })
  assert.ok(pending.includes("stockUnknown"))
  assert.equal(report.primaryBlockingReason, "NEED_STOCK_CONFIRMATION")
  assert.equal(report.approveAttemptBlocked, true)
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
  assert.match(pageSource, /B2-RUN continúa desactivado hasta completar todas las validaciones/)
  assert.match(pageSource, /pendingGuards/)
})

test("identical Top 5 scores are provisional and not definitive ranking", () => {
  const report = buildMobileReviewRadarGuardEnforcement(fixture)
  assert.equal(report.showScoreTieWarning, true)
  assert.equal(report.scoreStatus, "PROVISIONAL_OR_UNDIFFERENTIATED")
  assert.equal(report.needsScoreDisambiguation, true)
})

test("non-real sources always block B2-RUN", () => {
  for (const dataSource of ["DEMO_FIXTURE_ONLY", "NO_REAL_RADAR_DATA_AVAILABLE"]) {
    const report = buildMobileReviewRadarGuardEnforcement({ ...fixture, dataSource, selectedCandidate: fixture.top5Candidates[3], approveAttempt: true, localConfirmationsComplete: true })
    assert.equal(report.approveAttemptBlocked, true)
    assert.equal(report.canProceedToB2RunPreflight, false)
    assert.equal(report.canPublish, false)
  }
})

test("guard enforcement contains no external write capability", () => {
  const combined = `${guardSource}\n${pageSource}`
  for (const forbidden of [/\.insert\s*\(/, /\.update\s*\(/, /\.upsert\s*\(/, /publishOffer\s*\(/, /createOffer\s*\(/, /process\.env/, /OPENAI_API_KEY/]) assert.doesNotMatch(combined, forbidden)
})
