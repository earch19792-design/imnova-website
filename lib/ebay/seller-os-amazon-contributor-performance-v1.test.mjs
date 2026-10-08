import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { buildAmazonContributorObservationV1 } from
  "../marketplace/seller-os-amazon-contributor-performance-v1.ts"

const now = new Date("2026-10-06T20:00:00.000Z")
const observedAt = now.toISOString()

function observation(overrides = {}) {
  const base = {
    observedAt,
    supplier: { name: "Fixture Distributor",
      baseUrl: "https://supplier.example.com", sku: "SKU-001",
      productId: "P-001", inventoryQuantity: 24,
      productUrl: "https://supplier.example.com/products/P-001" },
    product: { title: "Fixture Product", brand: "Fixture",
      category: "Beauty", asin: "B000000031", upc: "036000291452",
      condition: "New" },
    demand: { claim: "HIGH", evidenceState: "CONFIRMED",
      source: "Keepa and Seller Central", observedAt },
    eligibility: { state: "CONFIRMED", observedAt },
    economics: { unitCostUsd: 5, inboundShippingPerUnitUsd: 1,
      prepCostPerUnitUsd: 0.5, expectedSalePriceUsd: 24,
      referralFeePerUnitUsd: 3.6, fbaFeePerUnitUsd: 4,
      otherVariableCostPerUnitUsd: 0.5 },
    amazonListing: { state: "ACTIVE", sellerSku: "AMZ-SKU-001",
      listingPriceUsd: 24, listedAt: "2026-09-20T20:00:00.000Z" },
    performance: { authority: "SELLER_CENTRAL_REPORT",
      observationWindowDays: 14, unitsPurchased: 20, unitsSold: 8,
      grossSalesUsd: 192, amazonFeesUsd: 28.8,
      fulfillmentFeesUsd: 32, refundsUsd: 0, otherActualCostsUsd: 4,
      firstSaleAt: "2026-09-22T20:00:00.000Z", observedAt },
  }
  return buildAmazonContributorObservationV1({ ...base, ...overrides }, { now })
}

test("a contributor demand claim is evidence but never Amazon demand proof", () => {
  const result = observation({ demand: { claim: "HIGH",
    evidenceState: "CONTRIBUTOR_ASSERTED", source: "Connie", observedAt },
    performance: { authority: "CONTRIBUTOR_ATTESTED",
      observationWindowDays: 14, unitsPurchased: 20, unitsSold: 8,
      grossSalesUsd: 192, amazonFeesUsd: 28.8, fulfillmentFeesUsd: 32,
      refundsUsd: 0, otherActualCostsUsd: 4, observedAt } })
  assert.equal(result.demand.confirmed, false)
  assert.equal(result.demand.contributorClaimNotMarketplaceProof, true)
  assert.equal(result.nextBestEvidence.action, "GET_AMAZON_DEMAND")
  assert.equal(result.outcome.skillOutcome, "PENDING_RESULT")
})

test("fresh Seller Central sales independently prove demand", () => {
  const result = observation({ demand: { claim: "HIGH",
    evidenceState: "CONTRIBUTOR_ASSERTED", source: "Connie", observedAt } })
  assert.equal(result.demand.confirmed, true)
  assert.equal(result.demand.confirmationBasis, "SELLER_CENTRAL_RESULT")
  assert.equal(result.outcome.skillOutcome, "WINNER")
})

test("missing ASIN remains the first missing evidence", () => {
  const result = observation({ product: { title: "Fixture Product",
    brand: "Fixture", category: "Beauty", asin: "", upc: "036000291452" } })
  assert.equal(result.nextBestEvidence.action, "VERIFY_AMAZON_ASIN")
  assert(result.blockers.includes("AMAZON_ASIN_UNPROVEN"))
})

test("confirmed movement plus ROI and contribution margin becomes a reorder review", () => {
  const result = observation()
  assert.equal(result.performance.observedUnitsSold, 8)
  assert.equal(result.performance.actualNetProfitUsd, 75.2)
  assert.equal(result.performance.actualNetProfitPerUnitUsd, 9.4)
  assert.equal(result.performance.velocityUnitsPerDay, 0.5714)
  assert.equal(result.performance.sellThroughRate, 0.4)
  assert.equal(result.outcome.skillOutcome, "WINNER")
  assert.equal(result.outcome.reorderDecision, "REVIEW_REORDER")
  assert.equal(result.nextBestEvidence.action, "REVIEW_REORDER")
  assert.equal(result.outcome.automaticReorderAllowed, false)
})

test("actual ROI and contribution margin below policy block reorder", () => {
  const result = observation({ performance: {
    authority: "SELLER_CENTRAL_REPORT", observationWindowDays: 14,
    unitsPurchased: 20, unitsSold: 8, grossSalesUsd: 112,
    amazonFeesUsd: 28.8, fulfillmentFeesUsd: 32, refundsUsd: 0,
    otherActualCostsUsd: 4, observedAt,
  } })
  assert.equal(result.performance.actualNetProfitPerUnitUsd, -0.6)
  assert.equal(result.outcome.skillOutcome, "NOT_WINNER")
  assert.equal(result.outcome.reorderDecision, "DO_NOT_REORDER")
  assert(result.blockers.includes("ROI_BELOW_30_PERCENT"))
  assert(result.blockers.includes("CONTRIBUTION_MARGIN_BELOW_15_PERCENT"))
})

test("a zero reported only by the contributor remains unknown", () => {
  const result = observation({ performance: {
    authority: "CONTRIBUTOR_ATTESTED", observationWindowDays: 14,
    unitsPurchased: 20, unitsSold: 0, grossSalesUsd: 0,
    amazonFeesUsd: 0, fulfillmentFeesUsd: 0, refundsUsd: 0,
    otherActualCostsUsd: 0, observedAt,
  } })
  assert.equal(result.performance.reportedUnitsSold, 0)
  assert.equal(result.performance.observedUnitsSold, null)
  assert.equal(result.performance.falseZeroGuard,
    "ZERO_NOT_ACCEPTED_WITHOUT_AUTHORITY")
  assert.notEqual(result.outcome.skillOutcome, "NOT_WINNER")
  assert.equal(result.nextBestEvidence.action, "MEASURE_RESULT")
})

test("stale demand is not used to declare a winner or authorize reorder review", () => {
  const result = observation({ demand: { claim: "HIGH",
    evidenceState: "CONFIRMED", source: "Keepa",
    observedAt: "2026-01-01T00:00:00.000Z" },
    performance: { authority: "CONTRIBUTOR_ATTESTED",
      observationWindowDays: 14, unitsPurchased: 20, unitsSold: 8,
      grossSalesUsd: 192, amazonFeesUsd: 28.8, fulfillmentFeesUsd: 32,
      refundsUsd: 0, otherActualCostsUsd: 4, observedAt } })
  assert.equal(result.demand.freshness, "STALE")
  assert.equal(result.demand.confirmed, false)
  assert.equal(result.nextBestEvidence.action, "GET_AMAZON_DEMAND")
  assert.equal(result.outcome.reorderDecision, "UNPROVEN")
})

test("missing Amazon fees resolves to one economics action", () => {
  const result = observation({ economics: { unitCostUsd: 5,
    inboundShippingPerUnitUsd: 1, prepCostPerUnitUsd: 0.5,
    expectedSalePriceUsd: 24, referralFeePerUnitUsd: null,
    fbaFeePerUnitUsd: 4, otherVariableCostPerUnitUsd: 0.5 } })
  assert.equal(result.economics.complete, false)
  assert.equal(result.nextBestEvidence.action, "COMPLETE_AMAZON_ECONOMICS")
})

test("implementation reuses Market Radar and exposes owner-only read tracking", async () => {
  const [migration, route, page, assistant, server, relay] = await Promise.all([
    readFile(new URL("../../supabase/migrations/20261006230437_seller_os_amazon_contributor_performance_monitor_v1.sql",
      import.meta.url), "utf8"),
    readFile(new URL("../../app/api/admin/marketplace/amazon/collaborators/connie/route.ts",
      import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/marketplace/amazon/connie/page.tsx",
      import.meta.url), "utf8"),
    readFile(new URL("./ebay-seller-os-assistant-gateway-v1.ts",
      import.meta.url), "utf8"),
    readFile(new URL("./ebay-seller-os-mcp-server-v1.ts",
      import.meta.url), "utf8"),
    readFile(new URL("./ebay-seller-os-cloud-read-relay-v1.ts",
      import.meta.url), "utf8"),
  ])
  for (const table of ["market_radar_sources", "market_radar_products",
    "market_radar_snapshots", "market_radar_events"]) {
    assert.match(migration, new RegExp(table))
  }
  assert.match(migration,
    /put_seller_os_amazon_contributor_observation_v1/)
  assert.match(migration, /grant execute[\s\S]*to service_role/)
  assert.match(migration, /readbackVerified/)
  assert.doesNotMatch(route,
    /createListing|createOffer|submitFeed|createOrder|purchaseOrder/)
  assert.match(page, /De producto propuesto a decisión de compra/)
  assert.match(page, /Nunca compra,[\s\S]*publica ni cambia precios automáticamente/)
  for (const source of [assistant, server, relay]) {
    assert.match(source, /seller_os_get_amazon_contributor_performance/)
  }
})
