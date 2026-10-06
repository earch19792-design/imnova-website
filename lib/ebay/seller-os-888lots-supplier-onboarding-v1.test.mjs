import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  build888LotsCommercialMemoryV1,
  canonical888LotsSkuV1,
  normalize888LotsCatalogRowV1,
  normalize888LotsConditionV1,
  preview888LotsAuthorizedExportV1,
  preview888LotsDualMarketplaceSourcingV1,
  SELLER_OS_888LOTS_TEMPLATE_HEADERS_V1,
} from "../marketplace/seller-os-888lots-supplier-onboarding-v1.ts"
import {
  build888LotsPublicRadarSnapshotV1,
  parse888LotsPublicCatalogHtmlV1,
  SELLER_OS_888LOTS_PUBLIC_RADAR_V1,
} from "../marketplace/seller-os-888lots-public-radar-v1.ts"

const capturedAt = "2026-10-06T18:00:00.000Z"
const now = new Date("2026-10-06T18:30:00.000Z")

const base = {
  supplier_sku: "SKU-123",
  supplier_product_id: "P-123",
  supplier_variant_id: "V-123",
  title: "Fixture Product",
  brand: "Fixture Brand",
  model: "MODEL-1",
  upc: "036000291452",
  condition: "Brand New",
  available_quantity: "37",
  minimum_order_quantity: "1",
  unit_cost_usd: "$2.37",
  delivered_unit_cost_usd: "3.10",
  restock_status: "repeatable stock",
  source_updated_at: "2026-10-06T17:59:00Z",
}

const dualMarketEvidence = [
  {
    marketplace: "EBAY_US",
    marketplaceProductId: "178430968129",
    exactProductMatch: true,
    identityState: "PROVEN",
    demandState: "PROVEN",
    observedUnitsSold: 30,
    observationWindowDays: 30,
    salePriceState: "PROVEN",
    buyerLandedSalePriceUsd: 19.59,
    feeState: "PROVEN",
    marketplaceFeeUsd: 3,
    fulfillmentState: "PROVEN",
    fulfillmentCostUsd: 5,
    promotionState: "PROVEN",
    promotionCostUsd: 0.5,
    returnsReserveState: "SUPPORTED",
    returnsReserveUsd: 1,
    otherVariableCostState: "PROVEN",
    otherVariableCostUsd: 0,
    eligibilityState: "PROVEN",
    eligibleToSell: true,
    capturedAt,
    authorityContract: "CANONICAL_OPPORTUNITY_RESULT_V2",
  },
  {
    marketplace: "AMAZON_US",
    marketplaceProductId: "B000000031",
    exactProductMatch: true,
    identityState: "PROVEN",
    demandState: "SUPPORTED",
    observedUnitsSold: 45,
    observationWindowDays: 30,
    salePriceState: "PROVEN",
    buyerLandedSalePriceUsd: 18.99,
    feeState: "PROVEN",
    marketplaceFeeUsd: 3.2,
    fulfillmentState: "PROVEN",
    fulfillmentCostUsd: 5.1,
    promotionState: "SUPPORTED",
    promotionCostUsd: 0.8,
    returnsReserveState: "SUPPORTED",
    returnsReserveUsd: 1,
    otherVariableCostState: "PROVEN",
    otherVariableCostUsd: 0,
    eligibilityState: "SUPPORTED",
    eligibleToSell: true,
    capturedAt,
    authorityContract: "AMAZON_PRODUCT_OPPORTUNITY_EXPLORER",
  },
]

test("maps only explicit 888 Lots condition labels and fails closed", () => {
  assert.equal(normalize888LotsConditionV1("Brand New"), "BRAND_NEW")
  assert.equal(normalize888LotsConditionV1("Distribution Stock"), "DISTRIBUTION_STOCK")
  assert.equal(normalize888LotsConditionV1("Refurbished"), "REFURBISHED")
  assert.equal(normalize888LotsConditionV1("Inspected Customer Returns"), "INSPECTED_CUSTOMER_RETURN")
  assert.equal(normalize888LotsConditionV1("Box Damaged"), "BOX_DAMAGED")
  assert.equal(normalize888LotsConditionV1("Like New-ish"), "UNPROVEN")
})

test("builds a deterministic namespaced SKU within eBay custom-label bounds", () => {
  assert.equal(canonical888LotsSkuV1(" sku 123 "), "888L-SKU-123")
  const long = canonical888LotsSkuV1("x".repeat(200))
  assert.equal(long?.length, 49)
  assert.equal(long, canonical888LotsSkuV1("x".repeat(200)))
})

test("keeps 37 units unproven unless repeatable stock is explicit", () => {
  const candidate = normalize888LotsCatalogRowV1({ ...base, restock_status: "" },
    { capturedAt, now })
  assert.equal(candidate.inventory.availableQuantity, 37)
  assert.equal(candidate.inventory.mode, "UNPROVEN")
  assert.equal(candidate.inventory.replacementEligible, false)
  assert.equal(candidate.nextBestEvidence.action, "WAIT_UPSTREAM")
  assert.equal(candidate.goldenPath.minimumNetProfitUsd, 4)
  assert.equal(candidate.goldenPath.failClosed, true)
})

test("public catalog inventory can enter a spot-buy review without claiming repeatable stock", () => {
  const candidate = normalize888LotsCatalogRowV1({ ...base,
    restock_status: "public catalog available" }, { capturedAt, now })
  assert.equal(candidate.inventory.mode, "PUBLIC_CATALOG_AVAILABLE")
  assert.equal(candidate.inventory.replacementEligible, false)
  assert.equal(candidate.nextBestEvidence.action, "GET_EXACT_SOLD")
})

test("supports repeatable stock for intake but never authorizes publication", () => {
  const candidate = normalize888LotsCatalogRowV1(base, { capturedAt, now })
  assert.equal(candidate.inventory.mode, "REPEATABLE_STOCK")
  assert.equal(candidate.condition.status, "SUPPORTED")
  assert.equal(candidate.nextBestEvidence.action, "GET_EXACT_SOLD")
  assert.equal(candidate.goldenPath.decision, "UNPROVEN")
  assert.deepEqual(candidate.safety, { scrapeRequests: 0, databaseWrites: 0,
    supplierPurchases: 0, marketplaceWrites: 0, publications: 0,
    repricing: 0, canPublish: false })
})

test("classifies shallow and lot inventory without turning either into a replacement", () => {
  const one = normalize888LotsCatalogRowV1({ ...base, available_quantity: 1,
    restock_status: "" }, { capturedAt, now })
  const lot = normalize888LotsCatalogRowV1({ ...base, lot_id: "LOT-55" },
    { capturedAt, now })
  assert.equal(one.inventory.mode, "ONE_OFF_LIQUIDATION")
  assert(one.blockers.includes("ONE_OFF_NOT_REPLACEMENT_ELIGIBLE"))
  assert.equal(lot.inventory.mode, "LOT_ALLOCATION")
  assert(lot.blockers.includes("LOT_ALLOCATION_REQUIRED"))
})

test("preserves missing quantity as null and marks stale evidence without false zero", () => {
  const candidate = normalize888LotsCatalogRowV1({ ...base,
    available_quantity: "", minimum_order_quantity: "" }, {
      capturedAt,
      now: new Date("2026-10-07T01:00:00.000Z"),
    })
  assert.equal(candidate.inventory.availableQuantity, null)
  assert.equal(candidate.inventory.minimumOrderQuantity, null)
  assert.equal(candidate.inventory.freshness, "STALE")
  assert(candidate.blockers.includes("SUPPLIER_INVENTORY_STALE"))
  assert.equal(candidate.nextBestEvidence.action, "WAIT_UPSTREAM")
})

test("does not promote an invalid supplied GTIN", () => {
  const candidate = normalize888LotsCatalogRowV1({ ...base, upc: "123456789013" },
    { capturedAt, now })
  assert.equal(candidate.candidate.upc, null)
  assert(candidate.blockers.includes("SUPPLIER_GTIN_INVALID"))
  assert.equal(candidate.nextBestEvidence.action, "VERIFY_PRODUCT_FIT")
})

test("requires both unit and delivered cost before requesting sold evidence", () => {
  const candidate = normalize888LotsCatalogRowV1({ ...base,
    unit_cost_usd: "", delivered_unit_cost_usd: "3.10" }, { capturedAt, now })
  assert.equal(candidate.costs.status, "UNPROVEN")
  assert(candidate.blockers.includes("SUPPLIER_UNIT_COST_UNPROVEN"))
  assert(candidate.blockers.includes("DELIVERED_UNIT_COST_UNPROVEN"))
  assert.equal(candidate.nextBestEvidence.action, "CAPTURE_DELIVERED_COST")
})

test("preview is idempotent and blocks duplicate supplier SKUs", () => {
  const input = { rows: [base, { ...base, title: "Duplicate" }], capturedAt, now,
    sourceFileDigest: "sha256:" + "a".repeat(64) }
  const first = preview888LotsAuthorizedExportV1(input)
  const replay = preview888LotsAuthorizedExportV1(input)
  assert.equal(first.evidenceDigest, replay.evidenceDigest)
  assert.equal(first.summary.duplicateSupplierSkus, 2)
  assert(first.candidates.every((row) =>
    row.blockers.includes("DUPLICATE_SUPPLIER_SKU_IN_IMPORT")))
  assert.equal(first.safety.databaseWrites, 0)
})

test("template and migration keep the source authorized-export only", async () => {
  const template = await readFile(new URL("../../public/templates/888lots-catalog-import-v1.csv",
    import.meta.url), "utf8")
  assert.deepEqual(template.trim().split(","), [...SELLER_OS_888LOTS_TEMPLATE_HEADERS_V1])
  const migration = await readFile(new URL("../../supabase/migrations/20261006182908_seller_os_888lots_supplier_onboarding_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration, /'888lots'/)
  assert.match(migration, /false,\s*1440/)
  assert.doesNotMatch(migration, /cron\.schedule|http_post|net\.http|create table/i)
})

test("dual-market preview derives the conservative maximum supplier price", () => {
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base,
    capturedAt,
    now,
    marketplaceEvidence: dualMarketEvidence,
  })
  assert.equal(result.marketplaces.ebay.decision, "GO")
  assert.equal(result.marketplaces.amazon.decision, "GO")
  assert.equal(result.marketplaces.ebay.expectedNetProfitUsd, 6.99)
  assert.equal(result.marketplaces.amazon.expectedNetProfitUsd, 5.79)
  assert.equal(result.sourcing.conservativeMaxSupplierUnitCostUsd, 4.16)
  assert.equal(result.sourcing.recommendedPurchaseQuantity, 3)
  assert.equal(result.sourcing.purchasePolicy.coverageDays, 14)
  assert.equal(result.sourcing.purchasePolicy.marketCaptureRate, 0.1)
  assert.equal(result.sourcing.decision, "READY_FOR_OWNER_BUY_REVIEW")
  assert.equal(result.nextBestEvidence.action, "READY_FOR_OWNER_BUY_REVIEW")
  assert.equal(result.authorization.canPurchase, false)
  assert.equal(result.safety.amazonWrites, 0)
  assert.equal(result.safety.ebayWrites, 0)
})

test("missing Amazon demand stays null and requests exactly that evidence", () => {
  const evidence = structuredClone(dualMarketEvidence)
  evidence[1].demandState = "UNAVAILABLE"
  evidence[1].observedUnitsSold = null
  evidence[1].observationWindowDays = null
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base, capturedAt, now, marketplaceEvidence: evidence,
  })
  assert.equal(result.marketplaces.amazon.evidence.demand.observedUnitsSold, null)
  assert.equal(result.marketplaces.amazon.evidence.demand.supported, false)
  assert.equal(result.sourcing.decision, "HOLD")
  assert.equal(result.nextBestEvidence.action, "GET_AMAZON_DEMAND")
})

test("authoritative Amazon zero is a real reject, not missing evidence", () => {
  const evidence = structuredClone(dualMarketEvidence)
  evidence[1].demandState = "PROVEN"
  evidence[1].observedUnitsSold = 0
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base, capturedAt, now, marketplaceEvidence: evidence,
  })
  assert.equal(result.marketplaces.amazon.evidence.demand.authoritativeZero, true)
  assert.equal(result.marketplaces.amazon.decision, "REJECT")
  assert.equal(result.sourcing.decision, "REJECT")
})

test("a merely supported Amazon zero stays unproven rather than rejecting", () => {
  const evidence = structuredClone(dualMarketEvidence)
  evidence[1].demandState = "SUPPORTED"
  evidence[1].observedUnitsSold = 0
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base, capturedAt, now, marketplaceEvidence: evidence,
  })
  assert.equal(result.marketplaces.amazon.evidence.demand.authoritativeZero, false)
  assert.equal(result.marketplaces.amazon.decision, "UNPROVEN")
  assert.equal(result.sourcing.decision, "HOLD")
})

test("Amazon Opportunity Explorer clicks support demand without inventing unit velocity", () => {
  const evidence = structuredClone(dualMarketEvidence)
  evidence[1].observedUnitsSold = null
  evidence[1].observationWindowDays = null
  evidence[1].searchClicks30Days = 10538
  evidence[1].searchClickGrowth30Percent = 45.39
  evidence[1].searchClicks90Days = 27998
  evidence[1].authorityContract = "AMAZON_PRODUCT_OPPORTUNITY_EXPLORER_OWNER_READONLY"
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base, capturedAt, now, marketplaceEvidence: evidence,
  })
  assert.equal(result.marketplaces.amazon.evidence.demand.supported, true)
  assert.equal(result.marketplaces.amazon.evidence.demand.evidenceKind,
    "AMAZON_SEARCH_CLICKS")
  assert.equal(result.marketplaces.amazon.evidence.demand.observedUnitsSold, null)
  assert.equal(result.marketplaces.amazon.evidence.demand.velocityUnitsPerDay, null)
  assert.equal(result.marketplaces.amazon.evidence.demand.authoritativeZero, false)
  assert.equal(result.sourcing.quantityBasis, "POLICY_LIMITED_TEST_NOT_VELOCITY")
  assert.equal(result.sourcing.recommendedPurchaseQuantity, 3)
})

test("high Amazon offer depth holds the buy for competition review", () => {
  const evidence = structuredClone(dualMarketEvidence)
  evidence[1].averageOfferDepth90Days = 520
  evidence[1].totalOfferDepth90Days = 548
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base, capturedAt, now, marketplaceEvidence: evidence,
  })
  assert.equal(result.marketplaces.amazon.evidence.competition.pressure, "HIGH")
  assert.equal(result.sourcing.decision, "HOLD")
  assert.equal(result.nextBestEvidence.action, "REVIEW_AMAZON_COMPETITION")
})

test("commercial memory remains supplier-scoped and preserves fail-closed provenance", () => {
  const evaluation = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base, capturedAt, now, marketplaceEvidence: dualMarketEvidence,
  })
  const memory = build888LotsCommercialMemoryV1({ evaluation,
    evaluationReceiptId: "123e4567-e89b-12d3-a456-426614174000",
    evaluationReceiptDigest: `sha256:${"a".repeat(64)}`,
    observedAt: now.toISOString() })
  assert.equal(memory.candidate.sourceKey, "888lots")
  assert.equal(memory.candidate.supplierQuantity, 37)
  assert.equal(memory.decision, "GO")
  assert.equal(memory.decisionProvenance.minimumNetProfitUsd, 4)
  assert.equal(memory.decisionProvenance.failClosed, true)
  assert.equal(memory.safety.amazonMutationAllowed, false)
  assert.match(memory.memoryDigest, /^sha256:[0-9a-f]{64}$/)
})

test("supplier delivered cost remains ahead of marketplace research", () => {
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: { ...base, delivered_unit_cost_usd: "" },
    capturedAt, now, marketplaceEvidence: dualMarketEvidence,
  })
  assert.equal(result.sourcing.currentDeliveredUnitCostUsd, null)
  assert.equal(result.nextBestEvidence.action, "CAPTURE_DELIVERED_COST")
  assert.equal(result.sourcing.decision, "HOLD")
})

test("one unprofitable channel blocks a dual-market buy recommendation", () => {
  const evidence = structuredClone(dualMarketEvidence)
  evidence[1].buyerLandedSalePriceUsd = 12
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base, capturedAt, now, marketplaceEvidence: evidence,
  })
  assert.equal(result.marketplaces.ebay.decision, "GO")
  assert.equal(result.marketplaces.amazon.decision, "REJECT")
  assert.equal(result.sourcing.decision, "REJECT")
  assert.equal(result.authorization.canPurchase, false)
})

test("stale dual-market evidence never becomes fresh or a false zero", () => {
  const result = preview888LotsDualMarketplaceSourcingV1({
    supplierRow: base,
    capturedAt,
    now: new Date("2026-10-08T18:30:00.000Z"),
    marketplaceEvidence: dualMarketEvidence,
  })
  assert.equal(result.marketplaces.ebay.evidence.freshness, "STALE")
  assert.equal(result.marketplaces.amazon.evidence.freshness, "STALE")
  assert.equal(result.marketplaces.ebay.decision, "UNPROVEN")
  assert.equal(result.sourcing.decision, "HOLD")
})

test("the marketplace route exposes owner capture with canonical persistence only", async () => {
  const route = await readFile(new URL("../../app/api/admin/marketplace/supplier-catalog/888lots/route.ts",
    import.meta.url), "utf8")
  assert.match(route, /PREVIEW_DUAL_MARKETPLACE_SOURCING/)
  assert.match(route, /CAPTURE_MANUAL_DUAL_MARKETPLACE_SOURCING/)
  assert.match(route, /capture888LotsManualDualMarketV1/)
  assert.match(route, /EBAY_US.*AMAZON_US/)
  assert.doesNotMatch(route, /publishOffer|createOffer|createListingsItem|createOrReplaceInventoryItem/)
})

test("manual capture migration extends the existing memory writer without parallel tables", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20261006191123_seller_os_888lots_manual_dual_market_capture_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration, /v_source_key := coalesce/)
  assert.match(migration, /REVIEW_AMAZON_COMPETITION/)
  assert.match(migration, /to service_role/)
  assert.doesNotMatch(migration, /create\s+table/i)
})

const publicCatalogHtml = `
<html><script>var vue = new Vue({data: {
items: {"current_page":1,"data":[{
  "id":431620,
  "href":"https://888lots.com/item/fixture-product-888-b012345678-us",
  "slug":"fixture-product-888-b012345678-us",
  "sku":"888 B012345678 US",
  "sl_sku":"888 B012345678",
  "asin":"B012345678",
  "upc":"036000291452",
  "qty":37,
  "moq":2,
  "condition":"BRAND_NEW_US",
  "cond":{"name":"Fulfilled by Amazon"},
  "description":"Fixture Personal Care Product",
  "categories":{"tree":[{"name":"Personal Care, Health & Beauty"}],
    "category":{"name":"Personal Care"}},
  "brand":{"name":"Fixture Brand"},
  "price":8,
  "az_price":29.99,
  "flatShip":1,
  "promo":{"active":true,"name":"First Order Promo","discount":60,
    "old_price":20,"terms":"Promotion valid for the first order only!"},
  "images":{"large":"https://images.example.test/product.jpg"},
  "azData":{"all_offers_count":12,"sales_rank":345,"brand":"Fixture Brand",
    "upc":["036000291452"]}
}]}
}})</script></html>`

test("public Radar parses exact supplier facts without promoting them to market proof", () => {
  const [candidate] = parse888LotsPublicCatalogHtmlV1({ html: publicCatalogHtml,
    sourceView: "trending", capturedAt })
  assert.equal(candidate.contractVersion, SELLER_OS_888LOTS_PUBLIC_RADAR_V1)
  assert.equal(candidate.supplierProductId, "431620")
  assert.equal(candidate.asin, "B012345678")
  assert.equal(candidate.availableQuantity, 37)
  assert.equal(candidate.minimumOrderQuantity, 2)
  assert.equal(candidate.currentUnitCostUsd, 8)
  assert.equal(candidate.regularUnitCostUsd, 20)
  assert.equal(candidate.publicShippingEstimateUsd, 1)
  assert.equal(candidate.supplierAmazonPriceEstimateUsd, 29.99)
  assert.equal(candidate.promotion.firstOrderOnly, true)
  assert(candidate.riskFlags.includes("AMAZON_APPROVAL_OR_COMPLIANCE_REVIEW"))
  assert(candidate.riskFlags.includes("FIRST_ORDER_PROMO_NON_RECURRING"))
  assert.equal(candidate.researchLane, "REVIEW_RISK")
  assert.equal(candidate.nextBestEvidence, "VERIFY_AMAZON_ELIGIBILITY")
  assert(candidate.blockers.includes("MARKETPLACE_DEMAND_NOT_YET_VERIFIED"))
})

test("public Radar observation digest is replay-safe across capture timestamps", () => {
  const first = parse888LotsPublicCatalogHtmlV1({ html: publicCatalogHtml,
    sourceView: "trending", capturedAt })[0]
  const replay = parse888LotsPublicCatalogHtmlV1({ html: publicCatalogHtml,
    sourceView: "trending", capturedAt: "2026-10-06T19:00:00.000Z" })[0]
  assert.equal(first.observationDigest, replay.observationDigest)
  const snapshot = build888LotsPublicRadarSnapshotV1(first)
  assert.equal(snapshot.inventory_quantity, 37)
  assert.equal(snapshot.raw.evidencePolicy.demandUnitsInvented, false)
  assert.equal(snapshot.raw.safety.supplierPurchases, 0)
  assert.equal(snapshot.raw.safety.marketplaceWrites, 0)
})

test("public Radar fails closed on missing or oversized catalog payloads", () => {
  assert.throws(() => parse888LotsPublicCatalogHtmlV1({ html: "<html></html>",
    sourceView: "trending", capturedAt }),
  /SELLER_OS_888LOTS_PUBLIC_ITEMS_NOT_FOUND/)
  assert.throws(() => parse888LotsPublicCatalogHtmlV1({ html: "x".repeat(5_000_001),
    sourceView: "trending", capturedAt }),
  /SELLER_OS_888LOTS_PUBLIC_RESPONSE_SIZE_INVALID/)
})

test("888lots module exposes an owner-initiated supplier Radar without cron or buying", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/marketplace/supplier-catalog/888lots/route.ts",
    import.meta.url), "utf8")
  const page = await readFile(new URL(
    "../../app/admin/marketplace/888lots/page.tsx", import.meta.url), "utf8")
  const radar = await readFile(new URL(
    "../marketplace/seller-os-888lots-public-radar-v1.ts", import.meta.url), "utf8")
  assert.match(route, /SYNC_PUBLIC_CATALOG_VIEW/)
  assert.match(route, /get888LotsRadarDashboardV1/)
  assert.match(page, /Bandeja del proveedor/)
  assert.match(page, /Listos para compra/)
  assert.match(page, /Actualizar Trending/)
  assert.match(radar, /automatedPolling:\s*false/)
  assert.doesNotMatch(radar, /cron\.schedule|supplierPurchases:\s*[1-9]/)
})
