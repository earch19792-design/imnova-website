import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { buildEbaySellerKeywordDemandValidation } from
  "./ebay-seller-keyword-demand-validation.ts"
import { buildCommercialDecisionV1, buildCommercialMarketProjectionV1,
  classifyCommercialComplianceV1, detectCommercialClaimConflictsV1 } from
  "./seller-os-live-commercial-trace-v1.ts"

test("AWCS-style conflicting supplier claims remain visible and block advance", () => {
  const conflicts = detectCommercialClaimConflictsV1({
    title: "HD 1080P Webcam with Omni-directional Mic AWCS06F",
    descriptionText: "Full 2K HD. Directional noise cancelling microphone. LIVE 2K Ring Light Webcam.",
  })
  assert.deepEqual(conflicts.map((entry) => entry.code), [
    "CONFLICTING_VIDEO_RESOLUTION_CLAIMS",
    "CONFLICTING_MICROPHONE_DIRECTIONALITY_CLAIMS",
    "DESCRIPTION_MENTIONS_UNCONFIRMED_RING_LIGHT_MODEL",
  ])
  const compliance = classifyCommercialComplianceV1({
    title: "HD 1080P Webcam", descriptionText: "Full 2K HD",
    claimConflictCount: conflicts.length,
  })
  assert.equal(compliance.status, "REVIEW_REQUIRED")
})

test("every observed comparable is explicitly accepted or excluded", () => {
  const candidate = {
    productName: "HD 1080P Webcam USB C USB A Built in Speakers Mic Black AWCS06F",
  }
  const report = buildEbaySellerKeywordDemandValidation({ candidate,
    insightsAvailability: "NOT_CONFIGURED",
    comparables: [
      { itemId: "1", title: candidate.productName, price: 49.99,
        shippingCost: 0, sellerUsername: "seller-a", estimatedSoldQuantity: 4,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
      { itemId: "2", title: `${candidate.productName} New`, price: 52.99,
        shippingCost: 0, sellerUsername: "seller-b", estimatedSoldQuantity: 3,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
      { itemId: "3", title: "4K Red Security Camera Outdoor", price: 19.99,
        shippingCost: 5, sellerUsername: "seller-c", estimatedSoldQuantity: 8,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
    ], candidateFoundCount: 20, returnedCandidateCount: 3,
    enrichedSampleCount: 3 })
  const market = buildCommercialMarketProjectionV1(report)
  assert.equal(market.everyObservedComparableAccountedFor, true)
  assert.equal(market.acceptedComparables.length +
    market.excludedComparables.length, 3)
  assert.ok(market.excludedComparables.every((entry) => entry.rejectionReason))
  assert.equal(market.demandValidationPassed, true)
  assert.ok(market.sourceLimitations.includes(
    "EBAY_RESULT_SET_BOUNDED_BY_GATEWAY_SAMPLE"))
})

test("decision never advances through a claim conflict", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: { productName: "HD 1080P Webcam AWCS06F" },
    comparables: [
      { itemId: "1", title: "HD 1080P Webcam AWCS06F", price: 49.99,
        sellerUsername: "seller-a", estimatedSoldQuantity: 4,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
      { itemId: "2", title: "HD 1080P Webcam AWCS06F", price: 52.99,
        sellerUsername: "seller-b", estimatedSoldQuantity: 4,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
    ], insightsAvailability: "NOT_CONFIGURED" })
  const decision = buildCommercialDecisionV1({ supplierCost: 17.17,
    shipping: 6.99, claimConflictCount: 1,
    complianceStatus: "REVIEW_REQUIRED",
    market: buildCommercialMarketProjectionV1(report) })
  assert.equal(decision.finalDecision, "HOLD_CLAIM_CONFLICTS")
})

test("trace storage and UI preserve the hard safety boundary", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/20260913193000_seller_os_live_commercial_trace_v1.sql", import.meta.url), "utf8")
  const page = await readFile(new URL("../../app/admin/ebay/commercial-trace/page.tsx", import.meta.url), "utf8")
  const service = await readFile(new URL("./seller-os-live-commercial-trace-v1.ts", import.meta.url), "utf8")
  assert.match(migration, /enable row level security/)
  assert.match(migration, /purchaseCompleted' = 'false'/)
  assert.doesNotMatch(migration, /grant .*authenticated/i)
  assert.match(page, /Actualización automática sin refresh/)
  assert.match(page, /Comparables excluidos/)
  assert.match(service, /manualComparables: 0/)
  assert.match(service, /get_seller_os_latest_profitability_frontiers_v1/)
  assert.doesNotMatch(service,
    /from\("seller_os_profitability_frontier_snapshots"\)/)
  assert.match(service, /publicationWrites: 0, ebayWrites: 0/)
  assert.match(service, /purchaseBoundaryEnforced: true/)
})
