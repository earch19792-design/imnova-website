import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildMobileReviewEffectiveDecision } from "../lib/ebay/ebay-mobile-review-effective-decision.ts"
import { parsePinnedCandidates, serializePinnedCandidates } from "../lib/ebay/ebay-mobile-review-local-state.ts"
import { buildMobileReviewRealRadarConnector } from "../lib/ebay/ebay-mobile-review-real-radar-connector.ts"
import { buildPinnedCandidateContinuityReport } from "../lib/ebay/ebay-mobile-review-pinned-candidate-continuity.ts"

const pinnedFixture = JSON.parse(readFileSync("tools/fixtures/ebay-mobile-review-pinned-candidate-continuity-v1.json", "utf8"))
const radarFixture = JSON.parse(readFileSync("tools/fixtures/ebay-mobile-review-real-radar-connector-v1.json", "utf8"))
const pageSource = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")

test("operational local state starts empty and fixture is demo-only", () => {
  assert.match(pageSource, /useState<PinnedCandidate\[\]>\(\[\]\)/)
  assert.doesNotMatch(pageSource, /initialPinnedCandidates/)
  assert.match(pageSource, /demoRequested/)
  assert.match(pageSource, /DEMO_FIXTURE_ONLY/)
})

test("versioned local storage accepts valid state and rejects invalid or expired state", () => {
  const now = new Date("2026-07-11T12:00:00.000Z")
  const serialized = serializePinnedCandidates(pinnedFixture.pinnedCandidates, now)
  assert.equal(parsePinnedCandidates(serialized, now.getTime()).status, "RESTORED")
  assert.equal(parsePinnedCandidates("not-json", now.getTime()).status, "INVALID")
  const expired = parsePinnedCandidates(serialized, now.getTime() + 31 * 24 * 60 * 60 * 1000)
  assert.equal(expired.status, "EXPIRED")
  assert.deepEqual(expired.candidates, [])
})

test("effective decision is authoritative and prioritizes guards", () => {
  const decision = buildMobileReviewEffectiveDecision({
    dataSource: "MARKET_RADAR_READONLY",
    selectedCandidateName: "Candidate",
    pendingGuards: ["missingEbayPrice"],
    primaryBlockingReason: "NEED_EBAY_MARKET_PRICE",
    localConfirmationsComplete: true,
    holdForReview: false,
    refreshRequested: false,
  })
  assert.equal(decision.authoritative, true)
  assert.equal(decision.nextRecommendedRoute, "NEED_EBAY_MARKET_PRICE")
  assert.equal(decision.canProceedToB2RunPreflight, false)
  assert.equal(decision.canPublish, false)
})

test("pinned candidate is reconciled against all Radar candidates outside Top 5", () => {
  const report = buildMobileReviewRealRadarConnector(radarFixture)
  const outsideTop5 = report.allCandidates.find((candidate) => !report.top5Candidates.some((top) => top.marketRadarProductId === candidate.marketRadarProductId))
  assert.ok(outsideTop5)
  const pinned = structuredClone(pinnedFixture.pinnedCandidates[0])
  pinned.marketRadarProductId = outsideTop5.marketRadarProductId
  pinned.supplierProductId = outsideTop5.supplierProductId
  pinned.handle = outsideTop5.handle
  pinned.productName = outsideTop5.productName
  pinned.latestRadarObservation = null
  const continuity = buildPinnedCandidateContinuityReport(report.top5Candidates, [pinned], report.allCandidates)
  assert.equal(continuity.pinnedCandidates[0].presentInRadar, true)
  assert.equal(continuity.pinnedCandidates[0].presentInCurrentTop5, false)
  assert.equal(continuity.pinnedCandidates[0].radarPresenceStatus, "PRESENT_IN_RADAR_OUTSIDE_TOP5")
})

test("multiple pinned candidates expose independent continuation decisions", () => {
  const ready = structuredClone(pinnedFixture.pinnedCandidates[0])
  const blocked = structuredClone(ready)
  blocked.pinnedCandidateId = "blocked-pinned"
  blocked.productName = "Blocked pinned"
  blocked.stockConfirmed = false
  blocked.stockQuantityConfirmed = null
  blocked.lastKnownHumanConfirmation.stockQuantityConfirmed = null
  blocked.latestRadarObservation.latestStockQuantity = null
  const report = buildPinnedCandidateContinuityReport([], [ready, blocked])
  assert.equal(report.pinnedCandidates[0].canContinueEbayMarketValidation, true)
  assert.equal(report.pinnedCandidates[1].canContinueEbayMarketValidation, false)
})

test("mobile UI provides progressive disclosure, tabs, safe blank inputs and accessibility states", () => {
  for (const expected of [/Continuar donde quedé/, /En revisión/, /Bloqueados/, /Decisión/, /Ver detalles técnicos/, /Mostrar 20 más/, /focus-visible/, /prefers-reduced-motion/, /role="status"/, /Reintentar lectura/, /AUTH_REQUIRED/, /RADAR_REQUEST_FAILED/]) assert.match(pageSource, expected)
  assert.doesNotMatch(pageSource, /Radar alternativo/)
  assert.match(pageSource, /useState\(""\)/)
  assert.doesNotMatch(pageSource, /useState\("20"\)/)
  assert.doesNotMatch(pageSource, /useState\("2\.00"\)/)
})

test("V2 remains read-only with no publication or database writes", () => {
  const combined = [
    pageSource,
    readFileSync("lib/ebay/ebay-mobile-review-effective-decision.ts", "utf8"),
    readFileSync("lib/ebay/ebay-mobile-review-local-state.ts", "utf8"),
  ].join("\n")
  for (const forbidden of [/\.insert\s*\(/, /\.update\s*\(/, /\.upsert\s*\(/, /\.delete\s*\(/, /publishOffer\s*\(/, /createOffer\s*\(/, /process\.env/, /OPENAI_API_KEY/, /api\.ebay\.com/]) assert.doesNotMatch(combined, forbidden)
  assert.match(pageSource, /\/api\/admin\/ebay\/seller-keyword-demand/)
  assert.match(combined, /canPublish:\s*false/)
})
