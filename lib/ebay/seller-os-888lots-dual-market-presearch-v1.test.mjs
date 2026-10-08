import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  assert888LotsAmazonStarLimitV1,
  build888LotsDualMarketPreSearchResultV1,
  select888LotsPreSearchCandidatesV1,
  SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1,
} from "../marketplace/seller-os-888lots-dual-market-presearch-v1.ts"

const observedAt = "2026-10-06T18:00:00.000Z"

function candidate(overrides = {}) {
  return {
    contractVersion: "SELLER_OS_888LOTS_PUBLIC_RADAR_V1",
    sourceView: "trending",
    capturedAt: observedAt,
    supplierProductId: "P-1",
    supplierVariantId: "V-1",
    supplierSku: "SKU-1",
    handle: "fixture",
    title: "Fixture Product",
    brand: "Fixture",
    department: "Health",
    category: "Personal Care",
    productUrl: "https://888lots.com/item/fixture",
    imageUrl: null,
    asin: "B000000031",
    upc: "036000291452",
    conditionCode: "BRAND_NEW",
    conditionLabel: "Brand New",
    availableQuantity: 37,
    minimumOrderQuantity: 1,
    currentUnitCostUsd: 2.37,
    regularUnitCostUsd: 8.4,
    publicShippingEstimateUsd: null,
    supplierAmazonPriceEstimateUsd: 19.99,
    supplierAmazonOfferCount: 5,
    supplierAmazonSalesRank: 12000,
    promotion: { active: true, name: "First order", discountPercent: 50,
      firstOrderOnly: true },
    estimatedGrossSpreadUsd: 17.62,
    estimatedGrossSpreadPercent: 88.14,
    researchScore: 64,
    researchLane: "RESEARCH_NOW",
    nextBestEvidence: "GET_AMAZON_DEMAND",
    blockers: ["DELIVERED_COST_CART_CONFIRMATION_REQUIRED"],
    riskFlags: ["FIRST_ORDER_PROMOTION_NON_REPEATABLE"],
    observationDigest: "sha256:" + "a".repeat(64),
    productId: "11111111-1111-4111-8111-111111111111",
    snapshotId: "22222222-2222-4222-8222-222222222222",
    lastObservedAt: observedAt,
    commercialDecision: null,
    commercialLifecycleStage: null,
    commercialNextBestEvidence: null,
    commercialUpdatedAt: null,
    commercialMaxSupplierUnitCostUsd: 4.16,
    preSearch: null,
    operatingLane: "NEW_DISCOVERY",
    ...overrides,
  }
}

function ebayReport(overrides = {}) {
  return {
    validationVersion: "EBAY_SELLER_KEYWORD_DEMAND_VALIDATION_V1",
    evidenceLevel: "VERIFIED_SOLD_HISTORY",
    eligibleComparableListings: 3,
    sellersAnalyzed: 2,
    totalVerifiedSoldQuantity: 11,
    totalEstimatedSoldQuantity: 0,
    demandValidationPassed: true,
    demandValidationBasis: "VERIFIED_HISTORICAL_MULTI_SELLER",
    comparableEvidence: [
      { eligibleComparable: true, pricingAuthorityEligible: true,
        price: 18, shippingCost: 2 },
      { eligibleComparable: true, pricingAuthorityEligible: true,
        price: 20, shippingCost: 0 },
      { eligibleComparable: true, pricingAuthorityEligible: true,
        price: 24, shippingCost: 1 },
    ],
    ...overrides,
  }
}

test("selects at most five available unresolved candidates and prioritizes missing PreSearch", () => {
  const cards = Array.from({ length: 9 }, (_, index) => candidate({
    supplierProductId: `P-${index}`,
    supplierVariantId: `V-${index}`,
    productId: `product-${index}`,
    snapshotId: `snapshot-${index}`,
    researchScore: 90 - index,
    operatingLane: index === 0 ? "BUY_READY" : "NEW_DISCOVERY",
    preSearch: index === 1 ? {
      contractVersion: SELLER_OS_888LOTS_DUAL_MARKET_PRESEARCH_V1,
      completedAt: observedAt,
    } : null,
  }))
  const selected = select888LotsPreSearchCandidatesV1(cards, 20)
  assert.equal(selected.length, 5)
  assert(selected.every((row) => row.operatingLane !== "BUY_READY"))
  assert.notEqual(selected[0].supplierProductId, "P-1")
})

test("maps verified exact sold evidence without converting Amazon supplier estimates into proof", () => {
  const result = build888LotsDualMarketPreSearchResultV1({
    candidate: candidate(), ebayReport: ebayReport(), observedAt,
  })
  assert.equal(result.ebay.soldEvidenceState, "PROVEN")
  assert.equal(result.ebay.observedSoldQuantity, 11)
  assert.equal(result.ebay.minimumComparableLandedPriceUsd, 20)
  assert.equal(result.ebay.medianComparableLandedPriceUsd, 20)
  assert.equal(result.ebay.maximumComparableLandedPriceUsd, 25)
  assert.equal(result.amazon.demandState, "UNPROVEN")
  assert.equal(result.amazon.offerPriceState, "UNPROVEN")
  assert.equal(result.supplier.supplierAmazonEstimateIsMarketProof, false)
  assert.equal(result.publicationReadiness,
    "NOT_AUTHORIZED_EVIDENCE_REQUIRED")
  assert.equal(result.evidencePolicy.economicPolicy.minimumMonetaryProfitUsd, null)
  assert.equal(result.evidencePolicy.economicPolicy.minimumEstimatedRoiPercent, 30)
  assert.equal(result.evidencePolicy.economicPolicy.minimumContributionMarginPercent, 15)
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("active eBay listings never become a false sold zero", () => {
  const result = build888LotsDualMarketPreSearchResultV1({
    candidate: candidate(), observedAt,
    ebayReport: ebayReport({ evidenceLevel: "ACTIVE_LISTINGS_ONLY",
      totalVerifiedSoldQuantity: 0, demandValidationPassed: false,
      demandValidationBasis: "ACTIVE_LISTING_FREQUENCY_ONLY" }),
  })
  assert.equal(result.ebay.status, "AVAILABLE")
  assert.equal(result.ebay.soldEvidenceState, "UNPROVEN")
  assert.equal(result.ebay.observedSoldQuantity, null)
  assert.equal(result.ebay.limitationCode, "GET_EBAY_EXACT_SOLD")
})

test("eBay upstream failure remains unavailable and preserves independent supplier evidence", () => {
  const result = build888LotsDualMarketPreSearchResultV1({
    candidate: candidate(), observedAt,
    ebayErrorCode: "EBAY_BROWSE_RATE_LIMITED",
  })
  assert.equal(result.ebay.status, "UNAVAILABLE")
  assert.equal(result.ebay.observedSoldQuantity, null)
  assert.equal(result.supplier.availableQuantity, 37)
  assert(result.blockers.includes("EBAY_BROWSE_RATE_LIMITED"))
})

test("chat star request accepts only the owner-facing sizes 10 and 20", () => {
  assert.equal(assert888LotsAmazonStarLimitV1(undefined), 10)
  assert.equal(assert888LotsAmazonStarLimitV1(10), 10)
  assert.equal(assert888LotsAmazonStarLimitV1(20), 20)
  assert.throws(() => assert888LotsAmazonStarLimitV1(15),
    /SELLER_OS_888LOTS_STAR_LIMIT_INVALID/)
})

test("route, dashboard and MCP expose PreSearch read-only without purchase or publication", async () => {
  const [route, page, assistant, server, relay] = await Promise.all([
    readFile(new URL("../../app/api/admin/marketplace/supplier-catalog/888lots/route.ts",
      import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/marketplace/888lots/page.tsx",
      import.meta.url), "utf8"),
    readFile(new URL("./ebay-seller-os-assistant-gateway-v1.ts",
      import.meta.url), "utf8"),
    readFile(new URL("./ebay-seller-os-mcp-server-v1.ts",
      import.meta.url), "utf8"),
    readFile(new URL("./ebay-seller-os-cloud-read-relay-v1.ts",
      import.meta.url), "utf8"),
  ])
  for (const source of [assistant, server, relay]) {
    assert.match(source, /seller_os_get_888lots_amazon_star_candidates/)
  }
  assert.match(route, /RUN_DUAL_MARKET_PRESEARCH/)
  assert.match(route, /run888LotsDualMarketPreSearchV1/)
  assert.match(page, /Productos estrella para Amazon/)
  assert.match(page, /no autoriza\s*comprar ni publicar/)
  assert.doesNotMatch(route, /createOrder|publishListing|reviseInventoryStatus/)
})
