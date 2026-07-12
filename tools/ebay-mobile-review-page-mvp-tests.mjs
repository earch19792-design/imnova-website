import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  applyMobileReviewAction,
  buildEbayMobileReviewPageInput,
  buildEbayMobileReviewPageReport,
  buildInitialMobileReviewState,
  buildMobileReviewDecision,
} from "../lib/ebay/ebay-mobile-review-page-mvp.ts"

const fixture = JSON.parse(
  fs.readFileSync("tools/fixtures/ebay-mobile-review-page-mvp-v1.json", "utf8")
)
const pageSource = fs.readFileSync(
  "app/admin/ebay/mobile-review/page.tsx",
  "utf8"
)
const moduleSource = fs.readFileSync(
  "lib/ebay/ebay-mobile-review-page-mvp.ts",
  "utf8"
)

test("mobile review page loads exactly the Top 5 and recommends rank 1", () => {
  const input = buildEbayMobileReviewPageInput(fixture)
  const report = buildEbayMobileReviewPageReport(fixture)
  assert.equal(input.top5Candidates.length, 5)
  assert.equal(input.top5Visible, true)
  assert.equal(report.top5Visible, true)
  assert.equal(report.recommendedCandidateRank, 1)
  assert.match(pageSource, /Top 5 móvil/)
  assert.match(pageSource, /Fuente actual: fixture modelado · no es data viva/)
  assert.match(pageSource, /score modelado/)
  assert.match(pageSource, /Fixture · no precio runtime/)
  assert.match(pageSource, /Fixture · no Category ID/)
  assert.match(pageSource, /aria-live="polite"/)
  assert.match(pageSource, /scrollIntoView/)
})

test("rank 1 can be marked unavailable and blocks B2-RUN", () => {
  let state = buildInitialMobileReviewState(fixture)
  state = applyMobileReviewAction(state, { type: "SELECT_CANDIDATE", rank: 1 })
  state = applyMobileReviewAction(state, { type: "MARK_UNAVAILABLE", rank: 1 })
  const decision = buildMobileReviewDecision(state)
  assert.equal(state.mobileReviewState, "REMOVED_FROM_LUNA_SCAN")
  assert.equal(decision.availabilityStatus, "REMOVED_FROM_LUNA_SCAN")
  assert.equal(decision.canProceedToB2Run, false)
  assert.equal(decision.nextRecommendedRoute, "NEED_LUNA_SCAN_REFRESH")
})

test("REQUEST_LUNA_SCAN_REFRESH generates the safe refresh route", () => {
  const state = applyMobileReviewAction(
    buildInitialMobileReviewState(fixture),
    { type: "REQUEST_LUNA_SCAN_REFRESH" }
  )
  const decision = buildMobileReviewDecision(state)
  assert.equal(state.mobileReviewState, "NEED_LUNA_SCAN_REFRESH")
  assert.equal(decision.nextRecommendedRoute, "NEED_LUNA_SCAN_REFRESH")
  assert.equal(decision.canPublish, false)
})

test("selection without stock is blocked", () => {
  let state = buildInitialMobileReviewState(fixture)
  state = applyMobileReviewAction(state, { type: "SELECT_CANDIDATE", rank: 2 })
  state = applyMobileReviewAction(state, { type: "CONFIRM_SAME_PRODUCT" })
  state = applyMobileReviewAction(state, { type: "CONFIRM_IMAGE_OK" })
  state = applyMobileReviewAction(state, { type: "APPROVE_B2_RUN_PREFLIGHT" })
  const decision = buildMobileReviewDecision(state)
  assert.equal(decision.stockConfirmed, false)
  assert.equal(decision.canProceedToB2RunPreflight, false)
  assert.equal(decision.canPublish, false)
})

test("selection with same product, stock and image enables only preflight", () => {
  let state = buildInitialMobileReviewState(fixture)
  state = applyMobileReviewAction(state, { type: "SELECT_CANDIDATE", rank: 2 })
  state = applyMobileReviewAction(state, { type: "CONFIRM_SAME_PRODUCT" })
  state = applyMobileReviewAction(state, { type: "CONFIRM_STOCK_QTY", quantity: 21 })
  state = applyMobileReviewAction(state, { type: "CONFIRM_IMAGE_OK" })
  state = applyMobileReviewAction(state, { type: "APPROVE_B2_RUN_PREFLIGHT" })
  const decision = buildMobileReviewDecision(state)
  assert.equal(decision.stockConfirmed, true)
  assert.equal(decision.availabilityStatus, "AVAILABLE")
  assert.equal(decision.imageConfirmed, true)
  assert.equal(decision.canProceedToB2RunPreflight, true)
  assert.equal(decision.nextRecommendedRoute, "EBAY-RESUME-B2-RUN-PREFLIGHT")
  assert.equal(decision.canPublish, false)
})

test("editing identity, stock or Luna evidence invalidates stale confirmations", () => {
  let state = buildInitialMobileReviewState(fixture)
  state = applyMobileReviewAction(state, { type: "SELECT_CANDIDATE", rank: 2 })
  state = applyMobileReviewAction(state, { type: "CONFIRM_SAME_PRODUCT" })
  state = applyMobileReviewAction(state, { type: "CONFIRM_STOCK_QTY", quantity: 6 })
  state = applyMobileReviewAction(state, { type: "CONFIRM_IMAGE_OK" })
  state = applyMobileReviewAction(state, { type: "RESET_SAME_PRODUCT_CONFIRMATION" })
  assert.equal(state.sameProductConfirmed, false)
  state = applyMobileReviewAction(state, { type: "RESET_STOCK_CONFIRMATION" })
  assert.equal(state.stockQuantityConfirmed, null)
  state = applyMobileReviewAction(state, { type: "RESET_LUNA_CATALOG_CONFIRMATION" })
  assert.equal(state.imageConfirmed, false)
  assert.equal(state.preflightApproved, false)
})

test("an unavailable candidate does not prevent reviewing another Top 5 candidate", () => {
  let state = buildInitialMobileReviewState(fixture)
  state = applyMobileReviewAction(state, { type: "MARK_UNAVAILABLE", rank: 1 })
  state = applyMobileReviewAction(state, { type: "SELECT_CANDIDATE", rank: 2 })
  state = applyMobileReviewAction(state, { type: "CONFIRM_SAME_PRODUCT" })
  state = applyMobileReviewAction(state, { type: "CONFIRM_STOCK_QTY", quantity: 8 })
  state = applyMobileReviewAction(state, { type: "CONFIRM_IMAGE_OK" })
  state = applyMobileReviewAction(state, { type: "APPROVE_B2_RUN_PREFLIGHT" })
  const decision = buildMobileReviewDecision(state)
  assert.equal(decision.selectedCandidateRank, 2)
  assert.equal(decision.availabilityStatus, "AVAILABLE")
  assert.equal(decision.canProceedToB2RunPreflight, true)
})

test("MVP remains local-only and contains no external or write capability", () => {
  const combined = `${moduleSource}\n${pageSource}`
  for (const forbidden of [
    /fetch\s*\(/,
    /createClient\s*\(/,
    /\.from\s*\(/,
    /\.insert\s*\(/,
    /\.update\s*\(/,
    /\.upsert\s*\(/,
    /process\.env/,
    /publishOffer\s*\(/,
    /createOffer\s*\(/,
    /createOrReplaceInventoryItem\s*\(/,
  ]) {
    assert.doesNotMatch(combined, forbidden)
  }
  const report = buildEbayMobileReviewPageReport(fixture)
  assert.equal(report.ebayApiUsed, false)
  assert.equal(report.ebayWriteUsed, false)
  assert.equal(report.supabaseWriteUsed, false)
  assert.equal(report.tokenStored, false)
  assert.equal(report.whatsappRealSendUsed, false)
  assert.equal(report.imageGenerationUsed, false)
  assert.equal(report.scraperUsed, false)
  assert.equal(report.canPublish, false)
})
