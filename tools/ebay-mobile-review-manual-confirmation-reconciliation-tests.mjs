import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { reconcileMobileConfirmationsWithRadarGuards } from "../lib/ebay/ebay-mobile-review-manual-confirmation-reconciliation.ts"
import { buildMobileReviewRadarGuardEnforcement, getCandidatePendingRadarGuards } from "../lib/ebay/ebay-mobile-review-radar-guard-enforcement.ts"

const fixture = JSON.parse(readFileSync("tools/fixtures/ebay-mobile-review-manual-confirmation-reconciliation-v1.json", "utf8"))
const guardFixture = JSON.parse(readFileSync("tools/fixtures/ebay-mobile-review-radar-guard-enforcement-v1.json", "utf8"))
const moduleSource = readFileSync("lib/ebay/ebay-mobile-review-manual-confirmation-reconciliation.ts", "utf8")
const pageSource = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")

const candidate = {
  ...guardFixture.top5Candidates[0],
  marketRadarSnapshotId: "snapshot-real",
  supplierVariantId: "variant-real",
  supplierSku: "SKU-REAL",
}

test("manual stock, image, Luna price and product confirmations resolve matching guards", () => {
  const pending = getCandidatePendingRadarGuards(candidate)
  const report = reconcileMobileConfirmationsWithRadarGuards(candidate, pending, fixture.confirmations)
  assert.ok(!report.pendingGuards.includes("stockUnknown"))
  assert.ok(!report.pendingGuards.includes("stockAvailabilityOnly"))
  assert.ok(!report.pendingGuards.includes("missingImageValidation"))
  assert.ok(!report.pendingGuards.includes("missingLunaPrice"))
  assert.equal(report.stockSource, fixture.expected.stockSource)
  assert.equal(report.stockWarning, "STOCK_LIMITED_WARNING")
  assert.equal(report.imageReviewSource, fixture.expected.imageReviewSource)
  assert.equal(report.lunaPrice, 2)
  assert.equal(report.lunaPriceSource, fixture.expected.lunaPriceSource)
  assert.equal(report.productMatchSource, fixture.expected.productMatchSource)
})

test("reconciled route moves to eBay validation while B2-RUN remains blocked", () => {
  const report = buildMobileReviewRadarGuardEnforcement({
    dataSource: "MARKET_RADAR_READONLY",
    realRadarTop5Loaded: true,
    top5Candidates: [candidate, ...guardFixture.top5Candidates.slice(1)],
    selectedCandidate: candidate,
    approveAttempt: true,
    localConfirmationsComplete: true,
    manualConfirmations: fixture.confirmations,
  })
  assert.equal(report.nextRecommendedRoute, "NEED_EBAY_MARKET_VALIDATION")
  for (const guard of ["missingEbayPrice", "missingMargin", "missingCategoryId", "missingDemandValidation"]) assert.ok(report.pendingGuards.includes(guard))
  assert.equal(report.approveAttemptBlocked, true)
  assert.equal(report.canProceedToB2RunPreflight, false)
  assert.equal(report.canPublish, false)
})

test("mobile UI exposes manual Luna confirmation and reconciliation sources", () => {
  assert.match(pageSource, /Abrir producto en Luna Portex/)
  assert.match(pageSource, /Confirmar que precio e imagen coinciden/)
  assert.match(pageSource, /confirmLunaCatalogMatch/)
  assert.match(pageSource, /manualConfirmationReconciliation/)
  assert.match(moduleSource, /HUMAN_MOBILE_CONFIRMED/)
})

test("reconciliation has no external write capability", () => {
  const combined = `${moduleSource}\n${pageSource}`
  for (const forbidden of [/\.insert\s*\(/, /\.update\s*\(/, /\.upsert\s*\(/, /publishOffer\s*\(/, /createOffer\s*\(/, /process\.env/, /OPENAI_API_KEY/]) assert.doesNotMatch(combined, forbidden)
})
