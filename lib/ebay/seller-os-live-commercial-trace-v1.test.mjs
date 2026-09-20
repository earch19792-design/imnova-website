import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value === "server-only") return {
    url: "data:text/javascript,export default {}", shortCircuit: true,
  }
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { buildEbaySellerKeywordDemandValidation,
  mergeDurableSoldEvidenceV1 } = await import(
  "./ebay-seller-keyword-demand-validation.ts")
const { buildCommercialDecisionV1, buildCommercialMarketProjectionV1,
  buildCommercialKeywordSynthesisV1, buildConservativeSafeClaimSubsetV1,
  buildFunctionalFamilySearchQueryV1,
  classifyCommercialComplianceV1,
  detectCommercialClaimConflictsV1, readCanonicalTraceProductTruthV1,
  runSellerOsLiveCommercialTraceV1 } = await import(
  "./seller-os-live-commercial-trace-v1.ts")

const traceDigest = (character) => `sha256:${character.repeat(64)}`
const traceFields = ["LUNA_PRODUCT_ID", "LUNA_VARIANT_ID", "SUPPLIER_SKU",
  "TITLE", "BRAND", "MODEL", "MATERIAL", "COLOR", "DIMENSIONS", "SIZE_SET",
  "WEIGHT", "PACKAGE_CONTENTS", "QUANTITY_OR_SET_COUNT", "FORM_FACTOR",
  "FEATURES", "INTENDED_USES", "GTIN", "MPN", "SUPPLIER_COST",
  "REGULAR_PRICE", "SALE_PRICE", "SUPPLIER_AVAILABILITY", "SUPPLIER_STOCK",
  "IMAGES", "VARIANT_OPTIONS"]

function traceTruthFixture({ omit = null } = {}) {
  const snapshotId = "5de76d1b-46ad-4516-bb96-57339c412719"
  const productId = "9220790976736"
  const variantId = "48809590227168"
  const sku = "ITEM6952"
  const canonicalUrl = "https://lunaportex.com/products/water-filter-kit"
  const fingerprint = traceDigest("a")
  const values = { LUNA_PRODUCT_ID: productId, LUNA_VARIANT_ID: variantId,
    SUPPLIER_SKU: sku,
    TITLE: "CFS Replacement Water Filters 7pk For Watts Premier WPRL-58",
    SUPPLIER_COST: 8, SUPPLIER_AVAILABILITY: "AVAILABLE" }
  const productReceipt = `luna_catalog:${snapshotId}:${productId}`
  const variantReceipt = `${productReceipt}:${variantId}`
  const fields = traceFields.map((name) => name in values && name !== omit ? {
    FIELD: name, VALUE: values[name], SEMANTIC_CLASS: "FACT",
    EVIDENCE_STATUS: "PROVEN", CONTRADICTION: false,
    EVIDENCE_ID: traceDigest("b"),
    FRESH_UNTIL: ["SUPPLIER_COST", "SUPPLIER_AVAILABILITY"].includes(name)
      ? "2026-09-21T19:25:37.539Z" : null,
    SOURCE_EVIDENCE: [{ EVIDENCE_ID: traceDigest("c"),
      SOURCE_RECEIPT_ID: ["LUNA_PRODUCT_ID", "TITLE"].includes(name)
        ? productReceipt : variantReceipt }],
  } : { FIELD: name, VALUE: null, SEMANTIC_CLASS: "MISSING",
    EVIDENCE_STATUS: "MISSING", CONTRADICTION: false,
    EVIDENCE_ID: null, SOURCE_EVIDENCE: [] })
  return { snapshot: { snapshot_id: snapshotId,
    snapshot_completed_at: "2026-09-20T19:25:37.539Z" },
    variant: { snapshot_id: snapshotId, product_id: productId,
      variant_id: variantId, sku, canonical_url: canonicalUrl,
      title: values.TITLE, price: 8, availability: true,
      source_fingerprint: fingerprint, preflight_status: "PREFLIGHT_PASS",
      field_truth_v1: { contractVersion: "LUNA_FIELD_PRODUCT_TRUTH_V1",
        sourceAuthorityContract: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
        sourceSnapshotId: snapshotId, sourceProductId: productId,
        sourceVariantId: variantId, sourceSupplierSku: sku,
        sourceCatalogFingerprint: fingerprint, evidenceDigest: traceDigest("d"),
        status: "PARTIAL", fields } } }
}

function traceTruthSupabase(fixture, variants = [fixture.variant]) {
  let writes = 0
  return { supabase: { from(table) {
    let single = false
    const rows = table === "luna_catalog_snapshots_v1"
      ? [fixture.snapshot] : table === "luna_catalog_snapshot_variants_v1"
        ? variants : []
    return { select() { return this }, eq() { return this },
      order() { return this }, limit() { return this },
      maybeSingle() { single = true; return this },
      insert() { writes += 1; return this }, update() { writes += 1; return this },
      then(resolve) { return Promise.resolve({ data: single
        ? (rows[0] ?? null) : rows, error: null }).then(resolve) } }
  } }, writes: () => writes }
}

test("Commercial Trace consumes the exact durable PARTIAL Product Truth receipt", async () => {
  const fixture = traceTruthFixture()
  const { supabase, writes } = traceTruthSupabase(fixture)
  const result = await readCanonicalTraceProductTruthV1({ supabase,
    canonicalUrl: fixture.variant.canonical_url,
    now: new Date("2026-09-20T20:00:00Z") })
  assert.equal(result.gate.productTruthStatusPreserved, "PARTIAL")
  assert.equal(result.gate.traceProductTruthSufficient, true)
  assert.equal(result.gate.traceCompatible, true)
  assert.equal(result.gate.receiptEvidenceDigest, traceDigest("d"))
  assert.equal(writes(), 0)
})

test("Commercial Trace rejects ambiguous canonical variant binding", async () => {
  const fixture = traceTruthFixture()
  const { supabase, writes } = traceTruthSupabase(fixture,
    [fixture.variant, { ...fixture.variant, variant_id: "48809590227169" }])
  await assert.rejects(() => readCanonicalTraceProductTruthV1({ supabase,
    canonicalUrl: fixture.variant.canonical_url }),
  /LIVE_COMMERCIAL_TRACE_PRODUCT_TRUTH_VARIANT_AMBIGUOUS/)
  assert.equal(writes(), 0)
})

test("Commercial Trace creates no trace when a required durable field is missing", async () => {
  const fixture = traceTruthFixture({ omit: "SUPPLIER_COST" })
  const { supabase, writes } = traceTruthSupabase(fixture)
  let fetches = 0
  await assert.rejects(() => runSellerOsLiveCommercialTraceV1({ supabase,
    accountKey: "test", productUrl: fixture.variant.canonical_url,
    fetchImpl: async () => { fetches += 1; throw new Error("UNREACHABLE") } }),
  /LIVE_COMMERCIAL_TRACE_PRODUCT_TRUTH_INSUFFICIENT/)
  assert.equal(fetches, 0)
  assert.equal(writes(), 0)
})

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

test("verified marketplace SOLD provenance outranks active-price estimates", () => {
  const report = buildEbaySellerKeywordDemandValidation({ candidate: {
    productName: "Rechargeable Facial Device" }, comparables: [
    { itemId: "sold-a", title: "Rechargeable Facial Device", price: 29,
      sellerUsername: "seller-a", totalSoldQuantity: 4,
      soldHistorySource: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      lastSoldDate: "2026-09-11T00:00:00.000Z",
      source: "EBAY_BROWSE_ACTIVE_LISTING" },
    { itemId: "sold-b", title: "Rechargeable Facial Device", price: 31,
      sellerUsername: "seller-b", totalSoldQuantity: 2,
      soldHistorySource: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      lastSoldDate: "2026-09-10T00:00:00.000Z",
      source: "EBAY_BROWSE_ACTIVE_LISTING" },
    { itemId: "estimated", title: "Rechargeable Facial Device", price: 99,
      sellerUsername: "seller-c", estimatedSoldQuantity: 20,
      source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
  ], asOf: "2026-09-13T00:00:00.000Z" })
  assert.equal(report.comparableEvidence[0].soldHistorySource,
    "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY")
  assert.equal(report.comparableEvidence[0].verifiedSoldQuantity, 4)
  const market = buildCommercialMarketProjectionV1(report)
  assert.equal(market.priceRange?.minimum, 29)
  assert.equal(market.priceRange?.maximum, 31)
  assert.equal(market.acceptedComparables.find((entry) =>
    entry.comparableId === "estimated")?.usedForPricing, false)
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

test("microcurrent facial-device identity produces safe bounded market queries", () => {
  const truth = buildConservativeSafeClaimSubsetV1({
    title: "5-in-1 Microcurrent Facial Device for Skin Tightening & Lifting",
  })
  assert.equal(truth.identitySufficient, true)
  assert.ok(truth.safeClaims.some((entry) =>
    entry.kind === "PRODUCT_IDENTITY" && entry.value === "Facial Device"))
  assert.ok(truth.safeClaims.some((entry) =>
    entry.kind === "FUNCTIONAL_DIFFERENTIATOR" &&
      entry.value === "Microcurrent"))
  assert.equal(truth.safeClaims.some((entry) =>
    entry.kind === "MODEL" && entry.value === "5-IN-1"), false)
  assert.equal(truth.safeMarketIdentity, "Facial Device Microcurrent")
  assert.equal(buildFunctionalFamilySearchQueryV1(truth.safeClaims),
    "Facial Device with Microcurrent")
})

test("branded functional listings inform category demand but not generic pricing", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: { productName: "Facial Device Microcurrent" },
    comparables: [
      { itemId: "generic", title: "Microcurrent Facial Device 5 in 1",
        price: 29.99, brand: "Unbranded", sellerUsername: "generic-seller",
        estimatedSoldQuantity: 2,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
      { itemId: "branded", title: "Microcurrent Facial Device Mini",
        price: 149.99, brand: "Example Premium",
        sellerUsername: "premium-seller", estimatedSoldQuantity: 8,
        source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
    ], insightsAvailability: "NOT_CONFIGURED",
  })
  const generic = report.comparableEvidence.find((entry) =>
    entry.comparableId === "generic")
  const branded = report.comparableEvidence.find((entry) =>
    entry.comparableId === "branded")
  assert.equal(report.demandValidationPassed, true)
  assert.equal(generic?.pricingAuthorityEligible, true)
  assert.equal(branded?.pricingAuthorityEligible, false)
  assert.equal(branded?.pricingAuthorityClass,
    "BRANDED_CATEGORY_SIGNAL_ONLY")
  const market = buildCommercialMarketProjectionV1(report)
  assert.equal(market.priceRange?.minimum, 29.99)
  assert.equal(market.priceRange?.maximum, 29.99)
  assert.equal(market.acceptedComparables.find((entry) =>
    entry.comparableId === "branded")?.usedForPricing, false)
})

test("generic brand aliases normalize without manufacturing brand authority", () => {
  for (const brand of ["Unbranded", "Generic", "Unbranded/Generic",
    "Generic / Unbranded", "Does Not Apply"]) {
    const report = buildEbaySellerKeywordDemandValidation({ candidate: {
      productName: "Rechargeable Skin Care Device", brand: "Unbranded/Generic",
    }, comparables: [{ itemId: brand, title: "Rechargeable Skin Care Device",
      brand, sellerUsername: "seller", estimatedSoldQuantity: 1,
      source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" }] })
    assert.equal(report.comparableEvidence[0].pricingAuthorityEligible, true)
    assert.notEqual(report.comparableEvidence[0].pricingAuthorityClass,
      "BRANDED_CATEGORY_SIGNAL_ONLY")
  }
})

test("same product form factor is separate from exact and functional", () => {
  const report = buildEbaySellerKeywordDemandValidation({ candidate: {
    productName: "Facial Care Device", identityReferenceTitle:
      "5-in-1 Rechargeable Facial Care Device Roller Tool",
  }, comparables: [
    { itemId: "near", title:
      "5 in 1 Rechargeable Facial Care Device Roller Tool", brand: "Generic",
      source: "EBAY_BROWSE_ACTIVE_LISTING" },
    { itemId: "functional", title: "Rechargeable Facial Care Device",
      brand: "Generic", source: "EBAY_BROWSE_ACTIVE_LISTING" },
  ] })
  assert.equal(report.comparableEvidence[0].commercialComparableClass,
    "NEAR_EXACT_PRODUCT")
  assert.equal(report.comparableEvidence[0].sameProductFormFactor, true)
  assert.equal(report.comparableEvidence[1].commercialComparableClass,
    "FUNCTIONAL_COMPARABLE")
})

test("estimated-only pricing evidence produces an explainable hold", () => {
  const report = buildEbaySellerKeywordDemandValidation({ candidate: {
    productName: "Rechargeable Facial Device" }, comparables: [
    { itemId: "a", title: "Rechargeable Facial Device", price: 29,
      sellerUsername: "a", estimatedSoldQuantity: 3,
      source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
    { itemId: "b", title: "Rechargeable Facial Device", price: 31,
      sellerUsername: "b", estimatedSoldQuantity: 3,
      source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
  ] })
  const market = buildCommercialMarketProjectionV1(report)
  assert.equal(market.pricingEvidenceQuality.status, "PROVISIONAL")
  assert.equal(market.pricingEvidenceQuality.strongDecisionAllowed, false)
  const decision = buildCommercialDecisionV1({ supplierCost: 10, shipping: 4,
    claimConflictCount: 0, complianceStatus: "PASS", market })
  assert.equal(decision.finalDecision, "HOLD_PRICING_EVIDENCE_QUALITY")
  assert.ok(decision.economicFloorExplanation)
  assert.ok(["PROFIT_FLOOR", "MARGIN_FLOOR", "ROI_FLOOR"].includes(
    decision.economicFloorExplanation.bindingGate))
})

test("near-exact SOLD enrichment must close before pricing authority can pass", () => {
  const candidate = { productName: "Facial Care Device",
    identityReferenceTitle: "5-in-1 Microcurrent Facial Care Device Roller Tool" }
  const comparables = ["seller-a", "seller-b"].map((seller, index) => ({
    itemId: `near-${index}`, title:
      "5 in 1 Microcurrent Facial Care Device Roller Tool",
    price: 29 + index, sellerUsername: seller, confirmedSoldQuantity: 2,
    soldHistorySource: "CONFIRMED_DURABLE_SOLD",
    lastSoldDate: "2026-09-10T00:00:00.000Z",
    source: "EBAY_BROWSE_ACTIVE_LISTING",
  }))
  const audit = { budgetLimit: 6, candidateCount: 2,
    selectedCandidateCount: 2, attemptedCandidateCount: 0,
    durableSatisfiedCount: 2, completedCandidateCount: 2,
    pendingCandidateCount: 0, candidates: [] }
  const blocked = buildEbaySellerKeywordDemandValidation({ candidate,
    comparables, asOf: "2026-09-13T00:00:00.000Z",
    nearExactSoldEnrichment: { ...audit, status: "BLOCKED_NOT_AVAILABLE" } })
  assert.equal(buildCommercialMarketProjectionV1(blocked)
    .pricingEvidenceQuality.classification,
  "NEAR_EXACT_SOLD_ENRICHMENT_INCOMPLETE")
  const completed = buildEbaySellerKeywordDemandValidation({ candidate,
    comparables, asOf: "2026-09-13T00:00:00.000Z",
    nearExactSoldEnrichment: { ...audit, status: "COMPLETED" } })
  assert.equal(buildCommercialMarketProjectionV1(completed)
    .pricingEvidenceQuality.strongDecisionAllowed, true)
})

test("keyword synthesis exposes commercial phrases and hides raw fragments", () => {
  const truth = buildConservativeSafeClaimSubsetV1({
    title: "Microcurrent Facial Device with Skin Tightening 5-in-1",
  })
  const report = buildEbaySellerKeywordDemandValidation({ candidate: {
    productName: truth.safeMarketIdentity,
    identityReferenceTitle:
      "Microcurrent Facial Device with Skin Tightening 5-in-1",
  }, comparables: [
    { itemId: "a", title: "5 in 1 Microcurrent Facial Device Face Massager",
      sellerUsername: "seller-a", estimatedSoldQuantity: 2,
      source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
    { itemId: "b", title: "Microcurrent Facial Device 5 in 1 Face Massager",
      sellerUsername: "seller-b", estimatedSoldQuantity: 2,
      source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE" },
  ] })
  const synthesis = buildCommercialKeywordSynthesisV1(report,
    truth.safeClaims, truth.doNotUseClaims)
  assert.equal(synthesis.primaryKeywordFamily,
    "Microcurrent Facial Device")
  assert.ok(synthesis.finalEbayTitle)
  assert.ok(synthesis.finalEbayTitle.length <= 80)
  assert.ok(synthesis.secondaryCommercialKeywords.every((phrase) =>
    !["skin", "device skin", "tightening"].includes(phrase.toLowerCase())))
  assert.ok(synthesis.validatedLongTailKeywords.every((phrase) =>
    phrase.trim().split(/\s+/).length >= 4))
  assert.equal(synthesis.rawKeywordEvidence.presentationScope,
    "TECHNICAL_EVIDENCE_ONLY")
})

test("observed source descriptors remain visible when not product-truth verified", () => {
  const truth = buildConservativeSafeClaimSubsetV1({
    title: "7-in-1 Rechargeable Facial Device for Anti Aging Glow",
  })
  assert.ok(truth.observedUnverifiedClaims.some((entry) =>
    entry.value === "7-in-1"))
  assert.ok(truth.doNotUseClaims.some((entry) => entry.value === "7-in-1"))
})

test("trace storage and UI preserve the hard safety boundary", async () => {
  const migration = await readFile(new URL("../../supabase/migrations/20260913193000_seller_os_live_commercial_trace_v1.sql", import.meta.url), "utf8")
  const page = await readFile(new URL("../../app/admin/ebay/commercial-trace/page.tsx", import.meta.url), "utf8")
  const workspace = await readFile(new URL("../../app/admin/ebay/commercial-trace/commercial-trace-workspace.tsx", import.meta.url), "utf8")
  const visibleUi = `${page}\n${workspace}`
  const service = await readFile(new URL("./seller-os-live-commercial-trace-v1.ts", import.meta.url), "utf8")
  const gateway = await readFile(new URL("./ebay-seller-keyword-demand-gateway.ts", import.meta.url), "utf8")
  const validation = await readFile(new URL("./ebay-seller-keyword-demand-validation.ts", import.meta.url), "utf8")
  assert.match(migration, /enable row level security/)
  assert.match(migration, /purchaseCompleted' = 'false'/)
  assert.doesNotMatch(migration, /grant .*authenticated/i)
  assert.match(visibleUi, /Actualización automática/)
  assert.match(visibleUi, /Descartados/)
  assert.match(visibleUi, /Claims seguros/)
  assert.match(visibleUi, /humanComparableReasonV1/)
  assert.match(visibleUi, /Expediente comercial/)
  assert.match(visibleUi, /Ver detalles técnicos/)
  assert.match(service, /manualComparables: 0/)
  assert.match(service, /get_seller_os_latest_profitability_frontiers_v1/)
  assert.doesNotMatch(service,
    /from\("seller_os_profitability_frontier_snapshots"\)/)
  assert.match(service, /publicationWrites: 0, ebayWrites: 0/)
  assert.match(service, /purchaseBoundaryEnforced: true/)
  assert.match(gateway, /DEFAULT_DETAIL_SAMPLE_LIMIT = 20/)
  assert.match(gateway, /MINIMUM_SAMPLE_BEFORE_DEMAND_UNPROVEN = 12/)
  assert.match(gateway,
    /EXACT_MODEL_THEN_NEAR_EXACT_THEN_FUNCTIONAL_THEN_NON_COMPARABLE/)
  assert.match(gateway, /HIGH_SIMILARITY_DETAIL_SAMPLE_LIMIT = 8/)
  assert.match(gateway, /NEAR_EXACT_SOLD_ENRICHMENT_LIMIT = 6/)
  assert.match(gateway, /nearExactSoldEnrichment/)
  assert.match(gateway, /functionalSearchQuery/)
  assert.match(gateway, /marketplace_sold_evidence_observations/)
  assert.match(gateway, /marketplace_account_key/)
  assert.match(gateway, /marketplaceAccountKey/)
  assert.match(validation, /CONFIRMED_DURABLE_SOLD/)
  assert.match(service, /STRUCTURED_MODEL_CONFLICTS/)
  assert.match(gateway, /SUFFICIENT_POSITIVE_DEMAND_EVIDENCE/)
  assert.match(visibleUi, /Publicar listing/)
  assert.match(visibleUi, /disabled aria-describedby="publication-disabled-reason"/)
  assert.match(visibleUi, /Título final eBay \(≤80\)/)
})
