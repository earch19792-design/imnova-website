import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  assertEbaySellerKeywordReadonlyRequest,
  buildEbaySellerKeywordDemandValidation,
  buildEbaySellerKeywordSearchQuery,
  getEbaySellerKeywordDemandGatewaySafety,
} from "../lib/ebay/ebay-seller-keyword-demand-validation.ts"

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/ebay-seller-keyword-demand-validation-v1.json", import.meta.url),
    "utf8"
  )
)

const enforcedDemandPolicy = {
  enabled: true,
  shadowMode: false,
  now: "2026-07-12T12:00:00.000Z",
}

test("builds a product-specific search query instead of a fixed keyword vocabulary", () => {
  const query = buildEbaySellerKeywordSearchQuery(fixture.candidate)
  assert.match(query, /mega/i)
  assert.match(query, /frizz/i)
  assert.match(query, /hair/i)
  assert.match(query, /spray/i)
  assert.match(query, /10/)
})

test("ranks equivalent sold listings and rejects a conflicting size", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: fixture.candidate,
    comparables: fixture.comparables,
    insightsAvailability: "AVAILABLE",
    asOf: enforcedDemandPolicy.now,
    demandEvidencePolicyRuntime: enforcedDemandPolicy,
  })
  assert.equal(report.evidenceLevel, "VERIFIED_SOLD_HISTORY")
  assert.equal(report.topSellingListings[0].comparableId, "v1|100000000001|0")
  assert.equal(report.topSellingListings.some((item) => item.comparableId === "v1|100000000003|0"), false)
  const wrongSize = fixture.comparables.find((item) => item.itemId === "v1|100000000003|0")
  assert.ok(wrongSize)
  assert.equal(report.eligibleComparableListings, 3)
})

test("weights keywords by real seller sales evidence", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: fixture.candidate,
    comparables: fixture.comparables,
    insightsAvailability: "AVAILABLE",
    asOf: enforcedDemandPolicy.now,
    demandEvidencePolicyRuntime: enforcedDemandPolicy,
  })
  const hairSpray = report.keywordsBringingSales.find((keyword) => keyword.term === "hair spray")
  assert.ok(hairSpray)
  assert.equal(hairSpray.verifiedSoldQuantity, 59)
  assert.equal(hairSpray.sellerCount, 3)
  assert.equal(hairSpray.crossSellerSignal, true)
  assert.equal(report.demandValidationPassed, true)
  assert.equal(report.totalVerifiedSoldQuantity, 59)
})

test("does not call active-listing frequency a proven sales keyword", () => {
  const activeOnly = fixture.comparables.map((item) => ({
    ...item,
    source: "EBAY_BROWSE_ACTIVE_LISTING",
    totalSoldQuantity: null,
    estimatedSoldQuantity: null,
  }))
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: fixture.candidate,
    comparables: activeOnly,
    insightsAvailability: "NOT_ENTITLED",
  })
  assert.equal(report.evidenceLevel, "ACTIVE_LISTINGS_ONLY")
  assert.equal(report.marketplaceInsightsStatus, "MARKETPLACE_INSIGHTS_NOT_AUTHORIZED")
  assert.equal(report.keywordsBringingSales.length, 0)
  assert.equal(report.demandValidationPassed, false)
  assert.ok(report.pendingGuards.includes("NEED_EBAY_SALES_EVIDENCE"))
})

test("accepts eBay estimated sold quantity but labels it separately", () => {
  const estimated = fixture.comparables
    .filter((item) => item.itemId !== "v1|100000000003|0")
    .map((item, index) => ({
      ...item,
      source: "EBAY_BROWSE_ESTIMATED_SALES",
      totalSoldQuantity: null,
      estimatedSoldQuantity: index === 0 ? 8 : 4,
    }))
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: fixture.candidate,
    comparables: estimated,
    insightsAvailability: "NOT_ENTITLED",
  })
  assert.equal(report.evidenceLevel, "ACTIVE_LISTING_ESTIMATED_SALES")
  assert.equal(report.totalVerifiedSoldQuantity, 0)
  assert.equal(report.totalEstimatedSoldQuantity, 16)
  assert.equal(report.demandValidationPassed, false)
  assert.equal(
    report.demandEvidencePolicy.evidenceClass,
    "OBSERVED_ESTIMATED_ROTATION",
  )
  assert.match(report.evidenceDisclaimer, /estimada/i)
})

test("uses ePID as an exact catalog identity and lotSize as a hard offer-pack guard", () => {
  const candidate = {
    ...fixture.candidate,
    gtin: null,
    brand: null,
    mpn: null,
    epid: "123456789",
    packQuantity: 3,
  }
  const exact = {
    ...fixture.comparables[0],
    gtin: null,
    brand: null,
    mpn: null,
    epid: "123456789",
    lotSize: 3,
  }
  const wrongPack = { ...exact, itemId: "wrong-pack", lotSize: 6 }
  const report = buildEbaySellerKeywordDemandValidation({
    candidate,
    comparables: [exact, wrongPack],
    insightsAvailability: "AVAILABLE",
  })
  assert.equal(report.comparableEvidence[0].identityEvidenceClass, "IDENTIFIER_EXACT_EPID")
  assert.equal(report.comparableEvidence[0].identifierExact, true)
  assert.equal(report.comparableEvidence.find((row) => row.comparableId === "wrong-pack")
    ?.identityEvidenceClass, "OFFER_PACK_CONFLICT")
  assert.equal(report.eligibleComparableListings, 1)

  const unresolved = buildEbaySellerKeywordDemandValidation({
    candidate,
    comparables: [{ ...exact, itemId: "unknown-pack", lotSize: null }],
    insightsAvailability: "AVAILABLE",
  })
  assert.equal(unresolved.comparableEvidence[0].baseIdentifierExact, true)
  assert.equal(unresolved.comparableEvidence[0].identifierExact, false)
  assert.equal(unresolved.comparableEvidence[0].identityEvidenceClass,
    "BASE_PRODUCT_EXACT_OFFER_UNRESOLVED")
  assert.equal(unresolved.eligibleComparableListings, 0)

  const conflict = buildEbaySellerKeywordDemandValidation({
    candidate: { ...candidate, brand: "Acme" },
    comparables: [{ ...exact, itemId: "wrong-brand", brand: "Other" }],
    insightsAvailability: "AVAILABLE",
  })
  assert.equal(conflict.comparableEvidence[0].identifierExact, false)
  assert.equal(conflict.comparableEvidence[0].identityEvidenceClass, "IDENTITY_CONFLICT")
})

test("exact GTIN identifies only the base product until the offer pack is resolved", () => {
  const candidate = {
    ...fixture.candidate,
    gtin: "036000291452",
    packQuantity: 3,
  }
  const comparable = {
    ...fixture.comparables[0],
    gtin: "036000291452",
    lotSize: null,
  }
  const unresolved = buildEbaySellerKeywordDemandValidation({
    candidate,
    comparables: [comparable],
    insightsAvailability: "AVAILABLE",
  })
  assert.equal(unresolved.comparableEvidence[0].baseIdentifierExact, true)
  assert.equal(unresolved.comparableEvidence[0].identifierExact, false)
  assert.equal(unresolved.comparableEvidence[0].offerPackResolved, false)
  assert.equal(unresolved.comparableEvidence[0].identityEvidenceClass,
    "BASE_PRODUCT_EXACT_OFFER_UNRESOLVED")
  assert.equal(unresolved.eligibleComparableListings, 0)

  const wrongPack = buildEbaySellerKeywordDemandValidation({
    candidate,
    comparables: [{ ...comparable, lotSize: 6 }],
    insightsAvailability: "AVAILABLE",
  })
  assert.equal(wrongPack.comparableEvidence[0].identityEvidenceClass,
    "OFFER_PACK_CONFLICT")
  assert.equal(wrongPack.eligibleComparableListings, 0)
})

test("exact brand and MPN still requires the listing offer pack", () => {
  const candidate = {
    ...fixture.candidate,
    gtin: null,
    brand: "Acme",
    mpn: "AX-100",
    packQuantity: 12,
  }
  const comparable = {
    ...fixture.comparables[0],
    gtin: null,
    brand: "Acme",
    mpn: "AX-100",
    lotSize: null,
  }
  const unresolved = buildEbaySellerKeywordDemandValidation({
    candidate,
    comparables: [comparable],
    insightsAvailability: "AVAILABLE",
  })
  assert.equal(unresolved.comparableEvidence[0].identifierMatchType, "BRAND_MPN")
  assert.equal(unresolved.comparableEvidence[0].baseIdentifierExact, true)
  assert.equal(unresolved.comparableEvidence[0].identifierExact, false)
  assert.equal(unresolved.comparableEvidence[0].identityEvidenceClass,
    "BASE_PRODUCT_EXACT_OFFER_UNRESOLVED")
  assert.equal(unresolved.eligibleComparableListings, 0)

  const resolved = buildEbaySellerKeywordDemandValidation({
    candidate,
    comparables: [{ ...comparable, lotSize: 12 }],
    insightsAvailability: "AVAILABLE",
  })
  assert.equal(resolved.comparableEvidence[0].identifierExact, true)
  assert.equal(resolved.comparableEvidence[0].offerPackResolved, true)
  assert.equal(resolved.comparableEvidence[0].identityEvidenceClass,
    "IDENTIFIER_EXACT_BRAND_MPN")
})

test("identical invalid GTIN values never become an exact identifier", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: { ...fixture.candidate, gtin: "036000291453" },
    comparables: [{ ...fixture.comparables[0], gtin: "036000291453" }],
    insightsAvailability: "AVAILABLE",
  })
  assert.equal(report.comparableEvidence[0].identifierExact, false)
  assert.notEqual(report.comparableEvidence[0].identifierMatchType, "GTIN")
})

test("allows only official eBay read-only market endpoints", () => {
  assert.doesNotThrow(() => assertEbaySellerKeywordReadonlyRequest(
    "https://api.ebay.com/buy/browse/v1/item_summary/search?q=hair%20spray",
    "GET"
  ))
  assert.doesNotThrow(() => assertEbaySellerKeywordReadonlyRequest(
    "https://api.ebay.com/buy/browse/v1/item/v1%7C100000000001%7C0",
    "GET"
  ))
  assert.doesNotThrow(() => assertEbaySellerKeywordReadonlyRequest(
    "https://api.ebay.com/buy/marketplace-insights/v1_beta/item_sales/search?q=hair%20spray&category_ids=11860",
    "GET"
  ))
  assert.doesNotThrow(() => assertEbaySellerKeywordReadonlyRequest(
    "https://api.ebay.com/commerce/catalog/v1_beta/product_summary/search?gtin=012345678905&category_id=11860",
    "GET"
  ))
  assert.throws(() => assertEbaySellerKeywordReadonlyRequest(
    "https://api.ebay.com/commerce/catalog/v1_beta/product_summary/search",
    "POST"
  ), /BLOCKED_NON_READONLY_EBAY_REQUEST/)
  assert.throws(() => assertEbaySellerKeywordReadonlyRequest(
    "https://example.com/commerce/catalog/v1_beta/product_summary/search",
    "GET"
  ), /BLOCKED_NON_READONLY_EBAY_REQUEST/)
  assert.throws(() => assertEbaySellerKeywordReadonlyRequest(
    "https://api.ebay.com/sell/inventory/v1/offer",
    "POST"
  ), /BLOCKED_NON_READONLY_EBAY_REQUEST/)
})

test("keeps all writes, copying and publication disabled", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate: fixture.candidate,
    comparables: fixture.comparables,
    insightsAvailability: "AVAILABLE",
  })
  const safety = getEbaySellerKeywordDemandGatewaySafety()
  assert.equal(report.exactCompetitorTitleCopied, false)
  assert.equal(report.ebayImagesCopied, false)
  assert.equal(report.ebayWriteUsed, false)
  assert.equal(report.supabaseWriteUsed, false)
  assert.equal(report.canPublish, false)
  assert.equal(safety.ebayWriteUsed, false)
  assert.equal(safety.supabaseWriteUsed, false)
  assert.equal(safety.tokenReturnedToBrowser, false)
})

test("wires the read-only analysis into the phone menu without manual title or URL entry", () => {
  const page = readFileSync(
    new URL("../app/admin/ebay/mobile-review/page.tsx", import.meta.url),
    "utf8"
  )
  const route = readFileSync(
    new URL("../app/api/admin/ebay/seller-keyword-demand/route.ts", import.meta.url),
    "utf8"
  )
  assert.match(page, /Verificar mercado en eBay/)
  assert.match(page, /keywordEvidenceHeading/)
  assert.match(page, /Usar como referencia/)
  assert.doesNotMatch(page, /URL del listing elegido/)
  assert.doesNotMatch(page, /Copia el título visible del listing/)
  assert.match(page, /guard !== "missingDemandValidation"/)
  assert.match(page, /EBAY_READONLY_ENV_MISSING/)
  assert.match(page, /marketplaceInsightsStatus/)
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /runEbaySellerKeywordDemandValidation/)
  assert.match(route, /marketplace_product_research_capture_observations/)
  assert.match(route, /EXACT_LUNA_MATCH/)
  assert.match(route, /productResearchEvidence/)
  assert.match(route, /productResearchEvidence\.status === "AVAILABLE"/)
  assert.match(route, /getEbayReadonlyRateLimitMetadata/)
  assert.match(route, /status: 429/)
  assert.match(route, /"Retry-After"/)
  assert.match(route, /retryAfterSeconds/)
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/)
  assert.match(page, /Captura ventas en Product Research/)
  assert.match(page, /https:\/\/www\.ebay\.com\/sh\/research#seller-os-query=/)
  assert.match(page, /sellerKeywordRetryAt/)
  assert.match(page, /ebayRateLimitActive/)
  assert.match(page, /Verificación eBay en espera/)
  assert.match(page, /sellerKeywordDemandError && !ebayRateLimitActive/)
  assert.match(page, /actionDisabled=\{false\}/)
  assert.match(page, /formatQuotaResumeAt/)
  assert.match(page, /formatQuotaCountdown/)
  assert.match(page, /Capturar ventas en Product Research/)
  assert.match(page, /Revisar otra oportunidad/)
  assert.match(page, /Evidencia anterior conservada/)
  assert.match(route, /assertEbayLaneAvailable/)
  assert.match(route, /recordPersistentEbayRateLimit/)
  assert.match(route, /checkpointPreserved: true/)
  assert.match(route, /localFlowAvailable: true/)
  const gateway = readFileSync(
    new URL("../lib/ebay/ebay-seller-keyword-demand-gateway.ts", import.meta.url),
    "utf8"
  )
  assert.match(gateway, /EBAY_READONLY_ENV_MISSING/)
  assert.match(gateway, /else if \(epid\) url\.searchParams\.set\("epid", epid\)/)
  assert.match(gateway, /url\.searchParams\.set\("category_id", text\(input\.categoryId\)\)/)
  assert.doesNotMatch(gateway, /url\.searchParams\.set\("category_ids", text\(input\.categoryId\)\)/)
  assert.match(gateway, /aspects,\s*requiredAspects: aspects\.filter\(\(aspect\) => aspect\.required\)/)
  const validator = readFileSync(
    new URL("../lib/ebay/ebay-seller-keyword-demand-validation.ts", import.meta.url),
    "utf8"
  )
  assert.match(validator, /MARKETPLACE_INSIGHTS_NOT_AUTHORIZED/)
})
