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
  assert.equal(report.demandValidationPassed, true)
  assert.match(report.evidenceDisclaimer, /estimada/i)
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
  assert.match(gateway, /url\.searchParams\.set\("category_id", text\(input\.categoryId\)\)/)
  assert.doesNotMatch(gateway, /url\.searchParams\.set\("category_ids", text\(input\.categoryId\)\)/)
  assert.match(gateway, /aspects,\s*requiredAspects: aspects\.filter\(\(aspect\) => aspect\.required\)/)
  const validator = readFileSync(
    new URL("../lib/ebay/ebay-seller-keyword-demand-validation.ts", import.meta.url),
    "utf8"
  )
  assert.match(validator, /MARKETPLACE_INSIGHTS_NOT_AUTHORIZED/)
})
