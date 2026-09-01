import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("Dashboard owner-ready count uses the bounded authority and never Radar", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const authority = read(
    "lib/ebay/seller-os-dashboard-opportunity-authority-v1.ts")
  assert.match(dashboard,
    /const opportunitiesReady = snapshot\.readyForOwnerReviewCount/)
  assert.match(dashboard, /data-ready-for-owner-review-count/)
  assert.match(dashboard, /snapshot\.radarSignalCount/)
  assert.match(authority, /countedAsReadyForOwnerReview: false/)
  assert.doesNotMatch(dashboard,
    /ownerRuntime\.quickPick\.readyForReview\s*\+\s*snapshot\./)
  assert.doesNotMatch(dashboard, /href="\/admin\/ebay\/opportunity-queue\/research"/)
})

test("Review CTA stays inline and reuses the existing owner review package", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  assert.match(dashboard, /aria-controls="dashboard-owner-review-queue"/)
  assert.match(dashboard, /data-owner-review-inline-queue/)
  assert.match(dashboard, /data-owner-review-inline-card/)
  assert.equal((dashboard.match(/<QuickPickOwnerReviewInline card=/g) ?? [])
    .length, 1)
  for (const label of ["Dollar Check", "EDITAR", "CONFIRMAR"])
    assert.match(dashboard, new RegExp(label))
})

test("Radar, legacy review and exact LIVE exclusions are separate projections", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  const service = read("lib/ebay/ebay-first-luna-scan-service.ts")
  const authority = read(
    "lib/ebay/seller-os-dashboard-opportunity-authority-v1.ts")
  assert.match(dashboard, /data-dashboard-radar-signals/)
  assert.match(dashboard, /Señales comerciales; no entran en Owner Review/)
  assert.match(dashboard, /data-dashboard-review-queue-audit/)
  assert.match(dashboard, /data-dashboard-already-live-exclusions/)
  assert.match(dashboard, /Abrir listing LIVE/)
  assert.match(service, /readAlreadyLiveExactLunaIdentitiesV1/)
  assert.match(service, /collectSellerOsLongitudinalOpportunityReadV1/)
  assert.match(service, /commercialOpportunityAuthority/)
  assert.match(authority, /MARKET_TEST_READY/)
  assert.match(authority, /LISTING_READY/)
  assert.match(authority, /publicationCtaVisible: false/)
  assert.match(authority, /completePackageCtaVisible: false/)
})

test("technical winner-evidence code is removed from owner commercial blockers", () => {
  const dashboard = read("app/admin/seller-os-operational-dashboard.tsx")
  assert.match(dashboard, /ownerVisibleQuickPickBlockers\(card\)/)
  assert.match(dashboard,
    /value !== "WINNER_EVIDENCE_PREVIEW_STAGING_REQUIRED"/)
  assert.match(dashboard, /Ver evidencia técnica/)
})
