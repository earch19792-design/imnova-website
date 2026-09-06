import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const source = readFileSync(
  "lib/ebay/ebay-mayel-commercial-intelligence-v1.ts", "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022,
} }).outputText
const { buildMayelCommercialIntelligenceV1 } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)

function metric(value, availability = "AVAILABLE") {
  return { value, availability, source: { system: "SELLER_OS",
    operation: "TEST" }, capturedAt: "2026-09-05T12:00:00.000Z",
  freshness: { status: "FRESH" }, limitationCode: null }
}

function listing() {
  return { key: "listing:366600000001", identity: {
    itemId: "366600000001" }, stock: { supplierVariantId: "variant-1" },
  metrics: {
    listing_price: metric(24.99), supplier_cost: metric(5),
    shipping: metric(6.99), fees: metric(3.8),
    promoted_fees: metric(null, "UNAVAILABLE"), net_profit: metric(9.2),
    margin: metric(36.8), roi: metric(76.7), impressions: metric(1000),
    ebay_views: metric(20), ctr_calculated: metric(2),
    ctr_reported: metric(null, "UNAVAILABLE"), watchers: metric(3),
    orders: metric(0), units_sold: metric(0), conversion: metric(0),
  } }
}

const evidence = [{ id: "11111111-1111-4111-8111-111111111111",
  source_listing_id: "123456789012", matched_supplier_variant_id: "variant-1",
  match_classification: "EXACT_LUNA_MATCH", match_reasons: ["EXACT"],
  normalized_identity: { productName: "Comparable exacto", condition: "New" },
  average_sold_price: 19, average_shipping: 2.5,
  confirmed_sold_quantity: 4, last_sold_date: "2026-09-01T12:00:00.000Z",
  created_at: "2026-09-02T12:00:00.000Z", evidence_reviewed: true,
  quality_status: "VALID" }]

test("projects proven economics, sold evidence and no commercial writes", () => {
  const result = buildMayelCommercialIntelligenceV1({ listing: listing(),
    commercialDashboard: { competitorWatch: { priceRecommendations: [{
      listingId: "366600000001", priceRecommendation: {
        action: "LOWER_TO_CONFIRMED_SOLD_BAND", proposedItemPrice: 21.5,
      } }] } }, marketEvidence: evidence,
    marketEvidenceReadStatus: "AVAILABLE", qualityRecommendations: [],
    decisionReasonCodes: ["TRAFFIC_WITHOUT_CONVERSION"],
    now: new Date("2026-09-05T12:00:00.000Z") })
  assert.equal(result.economics.livePrice.value, 24.99)
  assert.equal(result.economics.otherCostsOrReserves.value, null)
  assert.equal(result.market.acceptedComparableCount, 1)
  assert.equal(result.market.acceptedComparables[0].ebayItemId,
    "123456789012")
  assert.equal(result.market.soldPriceMedian, 21.5)
  assert.equal(result.pricePosition.status, "POR_ENCIMA_DEL_MERCADO")
  assert.equal(result.authority.mayelDirectPriceWrite, false)
  assert.equal(result.authority.mayelPromotionWrite, false)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.unknownRenderedAsZero, false)
})

test("stale or missing evidence cannot produce a market position", () => {
  const stale = evidence.map((row) => ({ ...row,
    last_sold_date: "2025-01-01T00:00:00.000Z" }))
  const result = buildMayelCommercialIntelligenceV1({ listing: listing(),
    commercialDashboard: {}, marketEvidence: stale,
    marketEvidenceReadStatus: "AVAILABLE", qualityRecommendations: [],
    now: new Date("2026-09-05T12:00:00.000Z") })
  assert.equal(result.market.freshness, "STALE")
  assert.equal(result.pricePosition.status, "EVIDENCIA_VENCIDA")
  assert.equal(result.pricePosition.marketPriceAuthority, "UNPROVEN")
  assert.equal(result.interpretation.classification, "REVALIDAR_PRIMERO")
})

test("does not cross-contaminate unlinked listings or render unknown sold quantity as zero", () => {
  const unlinked = listing()
  unlinked.stock.supplierVariantId = null
  const withoutLink = buildMayelCommercialIntelligenceV1({
    listing: unlinked, commercialDashboard: {}, marketEvidence: evidence,
    marketEvidenceReadStatus: "AVAILABLE", qualityRecommendations: [],
    now: new Date("2026-09-05T12:00:00.000Z") })
  assert.equal(withoutLink.market.acceptedComparableCount, null)
  assert.equal(withoutLink.market.soldPriceMedian, null)
  assert.equal(withoutLink.market.limitationCode,
    "SUPPLIER_VARIANT_LINK_REQUIRED")

  const unknownQuantity = evidence.map((row) => ({ ...row,
    confirmed_sold_quantity: null }))
  const withUnknownQuantity = buildMayelCommercialIntelligenceV1({
    listing: listing(), commercialDashboard: {},
    marketEvidence: unknownQuantity,
    marketEvidenceReadStatus: "AVAILABLE", qualityRecommendations: [],
    now: new Date("2026-09-05T12:00:00.000Z") })
  assert.equal(withUnknownQuantity.market.soldQuantityEvidence, null)
})

test("audits official recommendation classes without pretending support", () => {
  const result = buildMayelCommercialIntelligenceV1({ listing: listing(),
    commercialDashboard: {}, marketEvidence: [],
    marketEvidenceReadStatus: "UNAVAILABLE",
    marketEvidenceLimitationCode: "READ_FAILED",
    qualityRecommendations: [{ source: "EBAY_LISTING_QUALITY_REPORT",
      sourceVersion: "v1", listingKey: "listing:366600000001",
      associationStatus: "ITEM_ID_CERTIFIED", recommendationCategory: "Images",
      recommendationType: "IMAGE_QUALITY", recommendationText: "Add images",
      reportedBenchmark: null, topCategoryBenchmark: null,
      observedAt: "2026-09-04T12:00:00.000Z",
      importedAt: "2026-09-04T12:01:00.000Z" }] })
  assert.equal(result.ebayRecommendations.status, "PARTIAL")
  assert.equal(result.ebayRecommendations.capabilityAudit.find((row) =>
    row.type === "RECOMMENDED_PRICE_OR_PRICE_ADJUSTMENT").status,
  "UNAVAILABLE")
  assert.equal(result.workspaceIndependentFromCommercialFeed, true)
  assert.equal(result.revalidation.durableWorkerContinuationAvailable, false)
})
