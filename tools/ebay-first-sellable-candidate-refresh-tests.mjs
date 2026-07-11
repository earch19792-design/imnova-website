import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildFirstSellableCandidateRefresh,
} from "../lib/ebay/ebay-first-sellable-candidate-refresh.ts"

const fixture = JSON.parse(
  readFileSync(
    "tools/fixtures/ebay-first-sellable-candidate-refresh-v1.json",
    "utf8"
  )
)
const moduleSource = readFileSync(
  "lib/ebay/ebay-first-sellable-candidate-refresh.ts",
  "utf8"
)

test("removed mobile-review candidates become STOCK_HOLD exclusions", () => {
  const report = buildFirstSellableCandidateRefresh(fixture)
  assert.equal(report.removedCandidatesCount, 2)
  for (const name of [
    "Reusable Hook and Loop Cable Ties 50 Pack",
    "Cord Keeper Appliance Cable Organizer",
  ]) {
    const removed = report.removedCandidates.find(
      (candidate) => candidate.productName === name
    )
    assert.ok(removed)
    assert.equal(removed.availabilityStatus, "REMOVED_FROM_LUNA_SCAN")
    assert.ok(removed.riskFlags.includes("STOCK_HOLD"))
    assert.equal(removed.canProceedToB2Run, false)
    assert.ok(report.excludedFromRanking.includes(name))
  }
})

test("refreshed ranking builds a sellable Top 5 without removed candidates", () => {
  const report = buildFirstSellableCandidateRefresh(fixture)
  assert.equal(report.refreshedTop5Built, true)
  assert.equal(report.refreshedTop5.length, 5)
  assert.equal(report.mobileReviewPageInput.top5Candidates.length, 5)
  for (const candidate of report.refreshedTop5) {
    assert.equal(candidate.availabilityStatus, "AVAILABLE")
    assert.ok(!report.excludedFromRanking.includes(candidate.productName))
  }
  assert.equal(
    report.newRecommendedCandidate,
    "Clear Drawer Organizer Trays 6 Piece Set"
  )
  assert.equal(report.newRecommendedScore, 88.6)
  assert.equal(
    report.nextRecommendedRoute,
    "NEED_MOBILE_REVIEW_OF_REFRESHED_TOP5"
  )
})

test("an insufficient refreshed set requests a new Luna Scan source", () => {
  const report = buildFirstSellableCandidateRefresh({
    ...fixture,
    refreshedLunaScanCandidates: fixture.refreshedLunaScanCandidates.slice(0, 4),
  })
  assert.equal(report.refreshedTop5Built, false)
  assert.equal(report.nextRecommendedRoute, "NEED_NEW_LUNA_SCAN_SOURCE")
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
})

test("refresh remains modeled, local-only and free of external writes", () => {
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
    assert.doesNotMatch(moduleSource, forbidden)
  }
  const report = buildFirstSellableCandidateRefresh(fixture)
  assert.equal(report.ebayApiUsed, false)
  assert.equal(report.ebayWriteUsed, false)
  assert.equal(report.supabaseWriteUsed, false)
  assert.equal(report.tokenStored, false)
  assert.equal(report.imageGenerationUsed, false)
  assert.equal(report.scraperUsed, false)
  assert.equal(report.amazonUsed, false)
  assert.equal(report.canPublish, false)
})
