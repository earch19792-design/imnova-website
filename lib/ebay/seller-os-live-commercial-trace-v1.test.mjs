import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { buildEbaySellerKeywordDemandValidation,
  mergeDurableSoldEvidenceV1 } from
  "./ebay-seller-keyword-demand-validation.ts"
import { buildCommercialDecisionV1, buildCommercialMarketProjectionV1,
  buildConservativeSafeClaimSubsetV1, buildFunctionalFamilySearchQueryV1,
  classifyCommercialComplianceV1,
  detectCommercialClaimConflictsV1 } from
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

test("only a material claim conflict forces the claim hold", () => {
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
    materialClaimConflictCount: 1,
    complianceStatus: "REVIEW_REQUIRED",
    market: buildCommercialMarketProjectionV1(report) })
  assert.equal(decision.finalDecision, "HOLD_CLAIM_CONFLICTS")
})

test("safe claim subset excludes conflicts and supports differentiated keyword family", () => {
  const truth = buildConservativeSafeClaimSubsetV1({
    title: "HD 1080P Webcam w/ Built-in Speakers & Mic Black AWCS06F",
    descriptionText: "Full 2K HD directional microphone LIVE 2K Ring Light Webcam",
    sourceUrl: "https://lunaportex.com/products/hd-1080p-webcam-usb-c-usb-a-awcs06f",
  })
  assert.equal(truth.identitySufficient, true)
  assert.equal(truth.materialConflictCount, 0)
  assert.ok(truth.doNotUseClaims.some((entry) => entry.value === "2K"))
  assert.ok(truth.doNotUseClaims.some((entry) => entry.value === "Ring light"))
  assert.ok(truth.safeClaims.every((entry) =>
    !["2K", "Ring light", "Directional microphone"].includes(entry.value)))
  assert.ok(truth.safeClaims.some((entry) => entry.value === "USB-C" &&
    entry.source === "LUNA_CANONICAL_PRODUCT_URL"))
  assert.ok(truth.safeClaims.some((entry) => entry.value === "USB-A" &&
    entry.source === "LUNA_CANONICAL_PRODUCT_URL"))

  const report = buildEbaySellerKeywordDemandValidation({
    candidate: { productName: truth.safeMarketIdentity, packQuantity: 1 },
    comparables: [
      { itemId: "exact-1", title: "1080P Webcam with Built-in Speakers and Mic AWCS06F",
        price: 39.99, sellerUsername: "seller-a", estimatedSoldQuantity: 2,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
      { itemId: "exact-2", title: "AWCS06F 1080P Webcam Built In Speakers Microphone",
        price: 44.99, sellerUsername: "seller-b", estimatedSoldQuantity: 2,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
      { itemId: "functional", title: "1080P Webcam Built In Speakers and Mic USB",
        price: 34.99, sellerUsername: "seller-c", estimatedSoldQuantity: 1,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
      { itemId: "wrong-pack", title: "AWCS06F 1080P Webcam 2 Pack",
        price: 69.99, sellerUsername: "seller-d", lotSize: 2,
        source: "EBAY_BROWSE_ACTIVE_LISTING" },
    ], insightsAvailability: "NOT_CONFIGURED",
  })
  assert.equal(report.comparableEvidence[0].commercialComparableClass,
    "EXACT_MODEL_COMPARABLE")
  assert.equal(report.comparableEvidence[1].commercialComparableClass,
    "EXACT_MODEL_COMPARABLE")
  assert.equal(report.comparableEvidence[2].commercialComparableClass,
    "FUNCTIONAL_COMPARABLE")
  assert.equal(report.comparableEvidence[3].commercialComparableClass,
    "NON_COMPARABLE")
  const market = buildCommercialMarketProjectionV1(report, truth.safeClaims)
  assert.equal(market.primaryKeywordFamily,
    "1080P Webcam with Built-In Speakers and Microphone")

  const decision = buildCommercialDecisionV1({ supplierCost: 17.17,
    shipping: 6.99, claimConflictCount: 3, materialClaimConflictCount: 0,
    complianceStatus: "REVIEW_REQUIRED", market })
  assert.notEqual(decision.finalDecision, "HOLD_CLAIM_CONFLICTS")
})

test("durable confirmed sold evidence outranks but does not erase Browse estimate", () => {
  const [merged] = mergeDurableSoldEvidenceV1([{
    itemId: "v1|123456789012|0", title: "HD Webcam ZXQ123",
    sellerUsername: "seller-a", estimatedSoldQuantity: 7,
    source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE",
  }], [{ item_id: "123456789012", confirmed_sold_quantity: 2,
    sold_at: "2026-09-01T12:00:00.000Z",
    captured_at: "2026-09-10T12:00:00.000Z",
    source_type: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE",
    source_class: "MAIN_SEARCH_SOLD", realized_price_status: "UNPROVEN" }])
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: { productName: "HD Webcam ZXQ123", model: "ZXQ123" },
    comparables: [merged], asOf: "2026-09-13T12:00:00.000Z",
  })
  const evidence = report.comparableEvidence[0]
  assert.equal(evidence.soldHistorySource, "CONFIRMED_DURABLE_SOLD")
  assert.equal(evidence.confirmedSoldQuantity, 2)
  assert.equal(evidence.estimatedSoldQuantity, 7)
  assert.equal(evidence.salesQuantity, 2)
  assert.equal(evidence.lastSoldDate, "2026-09-01T12:00:00.000Z")
  assert.equal(evidence.realizedPriceStatus, "UNPROVEN")
  assert.equal(report.totalVerifiedSoldQuantity, 2)
  assert.equal(report.totalEstimatedSoldQuantity, 0)
})

test("GTIN conflicts remain excluded even when durable sold evidence exists", () => {
  const [merged] = mergeDurableSoldEvidenceV1([{
    itemId: "v1|123456789013|0", title: "HD Webcam ZXQ123",
    gtin: "036000291452", sellerUsername: "seller-a",
    estimatedSoldQuantity: 1, source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE",
  }], [{ item_id: "123456789013", confirmed_sold_quantity: 3,
    sold_at: "2026-09-01T12:00:00.000Z",
    captured_at: "2026-09-10T12:00:00.000Z",
    source_type: "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE" }])
  const report = buildEbaySellerKeywordDemandValidation({ candidate: {
    productName: "HD Webcam ZXQ123", model: "ZXQ123", gtin: "012345678905",
  }, comparables: [merged], asOf: "2026-09-13T12:00:00.000Z" })
  const evidence = report.comparableEvidence[0]
  assert.equal(evidence.eligibleComparable, false)
  assert.ok(evidence.identityConflicts.includes("GTIN_CONFLICT"))
  assert.equal(report.totalVerifiedSoldQuantity, 0)
})

test("structured Model mismatch blocks exact-model attribution", () => {
  const report = buildEbaySellerKeywordDemandValidation({ candidate: {
    productName: "HD Webcam ZXQ123", model: "ZXQ123",
  }, comparables: [{ itemId: "1", title: "HD Webcam ZXQ123",
    localizedAspects: [{ name: "Model", value: "OTHER900" }],
    source: "EBAY_BROWSE_ACTIVE_LISTING" }] })
  const evidence = report.comparableEvidence[0]
  assert.equal(evidence.commercialComparableClass, "NON_COMPARABLE")
  assert.ok(evidence.identityConflicts.includes("STRUCTURED_MODEL_CONFLICT"))
})

test("functional-family query is derived from safe claims without exact identifiers", () => {
  const truth = buildConservativeSafeClaimSubsetV1({
    title: "1080P Webcam with Built-In Speakers and Microphone ZXQ123",
  })
  const query = buildFunctionalFamilySearchQueryV1(truth.safeClaims)
  assert.equal(query, "1080P Webcam with Built-In Speakers and Microphone")
  assert.doesNotMatch(query ?? "", /ZXQ123/i)
})

test("trace storage and UI preserve the hard safety boundary", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/20260913193000_seller_os_live_commercial_trace_v1.sql", import.meta.url), "utf8")
  const page = await readFile(new URL("../../app/admin/ebay/commercial-trace/page.tsx", import.meta.url), "utf8")
  const service = await readFile(new URL("./seller-os-live-commercial-trace-v1.ts", import.meta.url), "utf8")
  const gateway = await readFile(new URL("./ebay-seller-keyword-demand-gateway.ts", import.meta.url), "utf8")
  const validation = await readFile(new URL("./ebay-seller-keyword-demand-validation.ts", import.meta.url), "utf8")
  assert.match(migration, /enable row level security/)
  assert.match(migration, /purchaseCompleted' = 'false'/)
  assert.doesNotMatch(migration, /grant .*authenticated/i)
  assert.match(page, /Actualización automática sin refresh/)
  assert.match(page, /Comparables excluidos/)
  assert.match(page, /Claims seguros/)
  assert.match(page, /item\.comparableClass/)
  assert.match(service, /manualComparables: 0/)
  assert.match(service, /get_seller_os_latest_profitability_frontiers_v1/)
  assert.doesNotMatch(service,
    /from\("seller_os_profitability_frontier_snapshots"\)/)
  assert.match(service, /publicationWrites: 0, ebayWrites: 0/)
  assert.match(service, /purchaseBoundaryEnforced: true/)
  assert.match(gateway, /DEFAULT_DETAIL_SAMPLE_LIMIT = 20/)
  assert.match(gateway, /MINIMUM_SAMPLE_BEFORE_DEMAND_UNPROVEN = 12/)
  assert.match(gateway, /EXACT_MODEL_THEN_FUNCTIONAL_THEN_NON_COMPARABLE/)
  assert.match(gateway, /functionalSearchQuery/)
  assert.match(gateway, /marketplace_sold_evidence_observations/)
  assert.match(gateway, /marketplace_account_key/)
  assert.match(gateway, /marketplaceAccountKey/)
  assert.match(validation, /CONFIRMED_DURABLE_SOLD/)
  assert.match(service, /STRUCTURED_MODEL_CONFLICTS/)
  assert.match(gateway, /SUFFICIENT_POSITIVE_DEMAND_EVIDENCE/)
})
