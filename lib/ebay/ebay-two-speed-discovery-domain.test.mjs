import assert from "node:assert/strict"
import test from "node:test"

import {
  buildEbayFamilyFingerprint,
  calculateCommercialPriorityScoreV2,
  classifyTwoSpeedCandidate,
  evaluateLocalDiscoveryGates,
  sameCompatibleFamily,
  simulateTwoSpeedQuota,
} from "./ebay-two-speed-discovery-domain.ts"

test("broad-only and zero exact comparables can never be recommended", () => {
  const candidate = {
    exactIdentityConfirmed: true, identityConfidence: 100, exactComparableCount: 0,
    compatibleSellerCount: 0, soldExactCount: 0, economicsAvailable: true,
    stockAvailable: true, evidenceFresh: true, evidenceConfidence: 100,
    broadResultCount: 10_000,
  }
  assert.equal(classifyTwoSpeedCandidate(candidate), "NEW_LUNA_SIGNAL")
  assert.equal(calculateCommercialPriorityScoreV2({
    eligible: true, broadOnly: true, confirmedExactSold: 100, economicsAndMargin: 100,
    competitionAndSellThrough: 100, lunaAvailability: 100, temporalTrend: 100,
    operationalReadiness: 100, identityConfidence: 100, evidenceConfidence: 100,
    freshnessConfidence: 100,
  }), 0)
})

test("recommendation requires exact active evidence plus sold or multi-seller signal", () => {
  assert.equal(classifyTwoSpeedCandidate({
    exactIdentityConfirmed: true, exactComparableCount: 1, compatibleSellerCount: 3,
    soldExactCount: 0, economicsAvailable: true, stockAvailable: true,
    evidenceFresh: true, evidenceConfidence: 80,
  }), "RECOMMENDED_FOR_REVIEW")
  assert.equal(classifyTwoSpeedCandidate({
    exactIdentityConfirmed: true, exactComparableCount: 1, compatibleSellerCount: 1,
    soldExactCount: 0, economicsAvailable: true, stockAvailable: true,
    evidenceFresh: true, evidenceConfidence: 80,
  }), "PRELIMINARY_POTENTIAL")
})

test("local gates spend zero eBay calls and expose explicit reasons", () => {
  const result = evaluateLocalDiscoveryGates({
    available: false, supplierCost: null, supplierSku: null, identityConfidence: 10,
    regulatedWithoutPath: true, optimisticMarginPercent: -1,
    lunaObservedAt: "2026-07-01T00:00:00.000Z",
    now: new Date("2026-07-17T00:00:00.000Z"),
  })
  assert.equal(result.eligible, false)
  assert.ok(result.blockers.includes("LUNA_OUT_OF_STOCK"))
  assert.ok(result.blockers.includes("IMPOSSIBLE_MARGIN"))
})

test("family grouping is stable and never merges incompatible variants", () => {
  const base = { brand: "Acme", normalizedName: "Daily wash", categoryId: "1", unitSize: "50 ml", scent: "rose" }
  assert.equal(buildEbayFamilyFingerprint(base), buildEbayFamilyFingerprint({ ...base }))
  assert.equal(sameCompatibleFamily(base, { ...base, scent: "mint" }), false)
  assert.equal(sameCompatibleFamily(base, { ...base, packCount: 3 }), true)
  assert.equal(sameCompatibleFamily({ ...base, packCount: 1 }, { ...base, packCount: 3 }), false)
})

test("quota simulation protects monitor budget and reduces detail calls from six to two", () => {
  const result = simulateTwoSpeedQuota({
    variants: 1_513, families: 900, deepCandidates: 20, cacheHitRate: .5,
    detailCalls: 2, dailyBrowseLimit: 5_000, protectedMonitorBudget: 500,
  })
  assert.equal(result.oldCalls, 10_591)
  assert.equal(result.lightCalls, 450)
  assert.equal(result.deepSearchCalls, 20)
  assert.equal(result.deepDetailCalls, 40)
  assert.equal(result.protectedMonitorBudget, 500)
  assert.equal(result.withinDiscoveryBudget, true)
})

test("10,000 variants remain bounded by family cache and approved Top 50", () => {
  const result = simulateTwoSpeedQuota({
    variants: 10_000, families: 2_500, deepCandidates: 50, cacheHitRate: .8,
    dailyBrowseLimit: 5_000, protectedMonitorBudget: 750,
  })
  assert.equal(result.oldCalls, 70_000)
  assert.equal(result.deepDetailCalls, 100)
  assert.equal(result.totalCalls, 650)
  assert.equal(result.withinDiscoveryBudget, true)
})
