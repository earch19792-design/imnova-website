import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildSellerOsMarketplaceCommercialPortfolioV1 } from
  "../seller-os/marketplace-commercial-portfolio-v1.ts"

function ebayProduct(overrides = {}) {
  return { productKey: "123", title: "Exact Product", categoryId: "1",
    categoryName: "Health", mappingStatus: "MAPPED",
    listingStatus: "ACTIVE", supplierLinkStatus: "LINKED",
    identityKeys: ["GTIN:012345678905"], unitsSold: 8,
    grossSalesUsd: 120, actualNetProfitUsd: null, ...overrides }
}

function ebayInsights(products = [ebayProduct()]) {
  return { sales: { status: "AVAILABLE", freshness: "FRESH",
    sourceUpdatedAt: "2026-10-06T10:00:00.000Z" },
  categories: { status: "AVAILABLE", unmappedCount: 0, windows: [] },
  products: { windows: [{ days: 365, products }],
    mappingRepairQueue: products.filter((item) =>
      item.mappingStatus === "UNMAPPED") } }
}

function amazonCard(overrides = {}) {
  const base = { id: "amazon-1", title: "Exact Product",
    observation: { product: { title: "Exact Product", category: "Beauty",
      asin: "B012345678", upc: "012345678905" },
    supplier: { name: "Sunshine", sku: "SUP-1" },
    amazonListing: { state: "ACTIVE", sellerSku: "CON-1" },
    performance: { authoritative: true, observedUnitsSold: 6,
      grossSalesUsd: 90, actualNetProfitUsd: 27,
      actualNetProfitPerUnitUsd: 4.5, velocityUnitsPerDay: 0.2,
      observationWindowDays: 30, freshness: "CURRENT",
      falseZeroGuard: "PASS" } },
    purchaseGate: { decision: "BUY", recommendedPurchaseQuantity: 3,
      economics: { maximumSupplierUnitCostUsd: 9.5 },
      nextBestEvidence: { action: "REVIEW_REORDER" } } }
  return { ...base, ...overrides }
}

test("portfolio ranks official products and keeps the 4 dollar floor", () => {
  const result = buildSellerOsMarketplaceCommercialPortfolioV1({
    ebayInsights: ebayInsights(), amazonPerformance: { cards: [amazonCard()],
      summary: {} }, amazonAuthorityAvailable: true,
  })
  assert.equal(result.minimumNetProfitUsd, 4)
  assert.equal(result.ebay.productWindows[0].products[0].unitsSold, 8)
  assert.equal(result.amazon.products[0].actualNetProfitUsd, 27)
  assert.equal(result.actionQueue[0].action, "REVIEW_REORDER")
  assert.equal(result.actionQueue[0].recommendedPurchaseQuantity, 3)
  assert.equal(result.actionQueue[0].automaticExecutionAllowed, false)
})

test("unavailable Amazon evidence never becomes a false zero", () => {
  const result = buildSellerOsMarketplaceCommercialPortfolioV1({
    ebayInsights: ebayInsights(), amazonPerformance: null,
    amazonAuthorityAvailable: false,
    amazonUnavailableReason: "SP_API_UNAVAILABLE",
  })
  assert.equal(result.amazon.status, "UNAVAILABLE")
  assert.equal(result.amazon.products.length, 0)
  assert.equal(result.amazon.summary.productsProposed, undefined)
  assert.equal(result.safety.falseZeroGuard, true)
})

test("non-authoritative Amazon zero remains unknown in rankings", () => {
  const card = amazonCard()
  card.observation.performance = { authoritative: false,
    observedUnitsSold: 0, grossSalesUsd: 0, actualNetProfitUsd: 0,
    falseZeroGuard: "ZERO_NOT_ACCEPTED_WITHOUT_AUTHORITY" }
  card.purchaseGate = { decision: "WAIT", economics: {},
    nextBestEvidence: { action: "WAIT_UPSTREAM" } }
  const result = buildSellerOsMarketplaceCommercialPortfolioV1({
    ebayInsights: ebayInsights(), amazonPerformance: { cards: [card] },
    amazonAuthorityAvailable: true,
  })
  assert.equal(result.amazon.status, "PARTIAL")
  assert.equal(result.amazon.products[0].unitsSold, null)
  assert.equal(result.amazon.products[0].grossSalesUsd, null)
  assert.equal(result.amazon.categories[0].unitsSold, null)
  assert.equal(result.actionQueue[0].evidenceState, "UNAVAILABLE")
})

test("cross-market opportunity requires exact UPC and keeps one action per product", () => {
  const notListed = amazonCard()
  notListed.observation.amazonListing.state = "NOT_LISTED"
  notListed.purchaseGate.decision = "WAIT"
  notListed.purchaseGate.nextBestEvidence = { action: "VERIFY_AMAZON_ELIGIBILITY" }
  const exact = buildSellerOsMarketplaceCommercialPortfolioV1({
    ebayInsights: ebayInsights(), amazonPerformance: { cards: [notListed] },
    amazonAuthorityAvailable: true,
  })
  assert.equal(exact.crossMarketplace.verifiedOpportunityCount, 1)
  assert.equal(exact.actionQueue.filter((item) =>
    item.key === "AMAZON:B012345678").length, 1)
  assert.equal(exact.actionQueue.find((item) =>
    item.key === "AMAZON:B012345678").action,
  "REVIEW_CROSS_LIST_AMAZON")

  notListed.observation.product.upc = "999999999999"
  const titleOnly = buildSellerOsMarketplaceCommercialPortfolioV1({
    ebayInsights: ebayInsights(), amazonPerformance: { cards: [notListed] },
    amazonAuthorityAvailable: true,
  })
  assert.equal(titleOnly.crossMarketplace.verifiedOpportunityCount, 0)
  assert.equal(titleOnly.crossMarketplace.titleSimilarityUsed, false)
})

test("negative actual profit remains visible instead of becoming missing", () => {
  const losing = amazonCard()
  losing.observation.performance.actualNetProfitUsd = -5
  losing.observation.performance.actualNetProfitPerUnitUsd = -1
  losing.purchaseGate.decision = "REJECT"
  losing.purchaseGate.nextBestEvidence = { action: "REVIEW_REJECTION" }
  const result = buildSellerOsMarketplaceCommercialPortfolioV1({
    ebayInsights: ebayInsights(), amazonPerformance: { cards: [losing] },
    amazonAuthorityAvailable: true,
  })
  assert.equal(result.amazon.products[0].actualNetProfitUsd, -5)
  assert.equal(result.amazon.categories[0].actualNetProfitUsd, -5)
})

test("dashboard implementation exposes all three read-only priorities", () => {
  const dashboard = readFileSync(
    "app/admin/seller-os-home-dashboard-v1.tsx", "utf8")
  const owner = readFileSync(
    "lib/seller-os/owner-operational-insights-v1.ts", "utf8")
  for (const marker of ["data-product-ranking", "data-category-ranking",
    "data-commercial-action-queue-v1", "Cruce entre marketplaces"])
    assert.match(dashboard, new RegExp(marker))
  assert.match(owner, /product_title/)
  assert.match(owner, /mappingRepairQueue/)
  assert.match(owner, /new Set\(scopedLines\.flatMap/)
  assert.doesNotMatch(dashboard, /method:\s*"POST"/)
})

