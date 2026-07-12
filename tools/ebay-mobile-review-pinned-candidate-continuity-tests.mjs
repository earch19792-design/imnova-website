import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { applyPinnedCandidateAction, buildPinnedCandidateContinuityReport, detectPinnedCandidateSupplierDrift } from "../lib/ebay/ebay-mobile-review-pinned-candidate-continuity.ts"

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-mobile-review-pinned-candidate-continuity-v1.json", "utf8"))
const moduleSource = readFileSync("lib/ebay/ebay-mobile-review-pinned-candidate-continuity.ts", "utf8")
const pageSource = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
const pinned = fixture.pinnedCandidates[0]

test("iDesign remains pinned outside the current Top 5 with human confirmations", () => {
  const report = buildPinnedCandidateContinuityReport([], fixture.pinnedCandidates)
  assert.equal(report.pinnedCandidatesCount, 1)
  assert.equal(report.pinnedCandidateName, pinned.productName)
  assert.equal(report.pinnedStatus, "PINNED_CANDIDATE_UNDER_REVIEW")
  assert.equal(report.radarPresenceStatus, "NOT_IN_CURRENT_TOP5")
  assert.equal(report.humanConfirmationsPreserved, true)
  assert.equal(pinned.stockWarning, "STOCK_LIMITED_WARNING")
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
})

test("pinned actions preserve B2-RUN block and expected routes", () => {
  const continued = applyPinnedCandidateAction(fixture.pinnedCandidates, { type: "CONTINUE_EBAY_MARKET_VALIDATION", pinnedCandidateId: pinned.pinnedCandidateId })
  assert.equal(continued[0].nextRecommendedRoute, "NEED_EBAY_MARKET_VALIDATION")
  assert.equal(buildPinnedCandidateContinuityReport([], continued).canProceedToB2RunPreflight, false)
  const unavailable = applyPinnedCandidateAction(continued, { type: "MARK_PINNED_UNAVAILABLE", pinnedCandidateId: pinned.pinnedCandidateId })
  assert.equal(unavailable[0].nextRecommendedRoute, "STOCK_HOLD")
  const held = applyPinnedCandidateAction(fixture.pinnedCandidates, { type: "HOLD_PINNED_FOR_REVIEW", pinnedCandidateId: pinned.pinnedCandidateId })
  assert.equal(held[0].nextRecommendedRoute, "EBAY-RESUME-HOLD")
  const unpinned = applyPinnedCandidateAction(fixture.pinnedCandidates, { type: "UNPIN_CANDIDATE", pinnedCandidateId: pinned.pinnedCandidateId })
  assert.equal(unpinned.length, 0)
})

test("candidate returning to Top 5 is deduped and retains context", () => {
  const report = buildPinnedCandidateContinuityReport([{
    marketRadarProductId: pinned.marketRadarProductId,
    supplierProductId: pinned.supplierProductId,
    handle: pinned.handle,
    productName: pinned.productName,
  }], fixture.pinnedCandidates)
  assert.equal(report.dedupedWithTop5, true)
  assert.equal(report.radarPresenceStatus, "PINNED_AND_IN_CURRENT_TOP5")
  assert.equal(report.pinnedCandidatesOutsideTop5.length, 0)
  assert.equal(report.humanConfirmationsPreserved, true)
})

const observation = (overrides = {}) => ({
  ...pinned.latestRadarObservation,
  ...overrides,
})

test("supplier stock drift routes quantity changes and stock zero safely", () => {
  const reduced = detectPinnedCandidateSupplierDrift(pinned, observation({ latestStockQuantity: 1 }))
  assert.equal(reduced.stockChanged, true)
  assert.equal(reduced.status, "STOCK_CHANGED_WARNING")
  assert.equal(reduced.nextRecommendedRoute, "NEED_STOCK_RECONFIRMATION")
  const zero = detectPinnedCandidateSupplierDrift(pinned, observation({ latestStockQuantity: 0 }))
  assert.equal(zero.status, "OUT_OF_STOCK")
  assert.equal(zero.nextRecommendedRoute, "STOCK_HOLD")
  const unknown = detectPinnedCandidateSupplierDrift(pinned, observation({ latestStockQuantity: null }))
  assert.equal(unknown.status, "STOCK_RECONFIRMATION_REQUIRED")
  assert.equal(unknown.nextRecommendedRoute, "NEED_STOCK_RECONFIRMATION")
})

test("supplier price, availability and image drift produce independent routes", () => {
  const price = detectPinnedCandidateSupplierDrift(pinned, observation({ latestLunaPrice: 4.5 }))
  assert.equal(price.priceChanged, true)
  assert.equal(price.status, "SUPPLIER_PRICE_CHANGED")
  assert.equal(price.nextRecommendedRoute, "NEED_MARGIN_REVIEW")
  assert.equal(price.marginReviewPreserved, false)
  const unavailable = detectPinnedCandidateSupplierDrift(pinned, observation({ latestAvailabilityStatus: "OUT_OF_STOCK" }))
  assert.equal(unavailable.status, "SUPPLIER_UNAVAILABLE")
  assert.equal(unavailable.nextRecommendedRoute, "STOCK_HOLD")
  const image = detectPinnedCandidateSupplierDrift(pinned, observation({ latestImageReference: "https://example.invalid/changed-reference" }))
  assert.equal(image.imageReferenceChanged, true)
  assert.equal(image.status, "IMAGE_REFERENCE_CHANGED")
  assert.equal(image.nextRecommendedRoute, "NEED_IMAGE_REVIEW")
})

test("missing scan intervals distinguish recheck from stale hold", () => {
  const one = detectPinnedCandidateSupplierDrift(pinned, observation({ isPresentInLatestScan: false, missingIntervals: 1 }))
  assert.equal(one.status, "NOT_OBSERVED_LATEST_SCAN")
  assert.equal(one.nextRecommendedRoute, "NEED_RADAR_RECHECK")
  const two = detectPinnedCandidateSupplierDrift(pinned, observation({ isPresentInLatestScan: false, missingIntervals: 2 }))
  assert.equal(two.status, "STALE_MISSING_FROM_SOURCE")
  assert.equal(two.nextRecommendedRoute, "STOCK_HOLD")
})

test("unchanged supplier observation preserves confirmations and eBay continuation", () => {
  const drift = detectPinnedCandidateSupplierDrift(pinned, pinned.latestRadarObservation)
  assert.equal(drift.supplierDriftDetected, false)
  const report = buildPinnedCandidateContinuityReport([], fixture.pinnedCandidates)
  assert.equal(report.canContinueEbayMarketValidation, true)
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
})

test("mobile UI shows pinned continuity controls and persistence boundary", () => {
  for (const expected of [/En revisión \/ Pinned Candidates/, /RECHECK_PINNED_CANDIDATE/, /CONTINUE_EBAY_MARKET_VALIDATION/, /MARK_PINNED_UNAVAILABLE/, /HOLD_PINNED_FOR_REVIEW/, /UNPIN_CANDIDATE/, /BROWSER_STATE_OR_LOCAL_STORAGE/]) assert.match(pageSource, expected)
})

test("pinned continuity contains no external write capability", () => {
  const combined = `${moduleSource}\n${pageSource}`
  for (const forbidden of [/\.insert\s*\(/, /\.update\s*\(/, /\.upsert\s*\(/, /publishOffer\s*\(/, /createOffer\s*\(/, /process\.env/, /OPENAI_API_KEY/]) assert.doesNotMatch(combined, forbidden)
})
