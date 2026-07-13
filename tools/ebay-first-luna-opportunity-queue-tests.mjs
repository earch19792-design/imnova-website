import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildBestSellingSignalKey,
  buildOpportunityChangeEvents,
  buildOpportunityQueueRow,
  mapLatestVariantToLunaCandidate,
} from "../lib/ebay/ebay-first-luna-opportunity-queue.ts"

function assessment(overrides = {}) {
  return {
    candidate: {
      candidateKey: "luna-portex:p1:v1",
      marketRadarProductId: "00000000-0000-0000-0000-000000000001",
      supplierProductId: "p1",
      supplierVariantId: "v1",
      sku: "SKU-1",
      title: "Silicone Cable Organizer",
      variantTitle: "Black 20 Pack",
      gtin: "123456789012",
      supplierCost: 4,
      available: true,
      inventoryQuantity: 20,
      stockCapturedAt: "2026-07-12T20:00:00.000Z",
    },
    decision: "OPPORTUNITY_REVIEW_REQUIRED",
    canProceedToListingPackage: false,
    scores: {
      opportunityScore: 68,
      demandScore: 72,
      economicsScore: 80,
      identityScore: 90,
      competitionScore: 55,
      supplyScore: 70,
      listingReadinessScore: 60,
    },
    market: {
      activeExactComparables: 4,
      sellersWithPositiveMovement: 2,
      totalEstimatedWeeklyVelocity: 12,
      medianTotalBuyerPrice: 18.99,
    },
    economics: { estimatedNetProfit: 5.2 },
    listingIntelligencePackage: {
      titleStrategy: { primarySearchPhrase: "cable organizer" },
    },
    hardGates: [],
    evidenceGuards: [],
    ...overrides,
  }
}

test("maps every latest Luna variant into a stable scan candidate", () => {
  const candidate = mapLatestVariantToLunaCandidate({
    product_id: "00000000-0000-0000-0000-000000000001",
    supplier_product_id: "p1",
    supplier_variant_id: "v1",
    sku: "SKU-1",
    barcode: "123456789012",
    title: "Cable Organizer",
    variant_title: "Black",
    vendor: "Acme",
    product_type: "Organizer",
    tags: ["cable"],
    product_url: "https://lunaportex.com/products/cable",
    featured_image_url: "https://cdn.example.com/cable.jpg",
    image_urls: [],
    metadata: { mpn: "MPN-1", dimensions: { length: 2, width: 1, height: 1, unit: "in" } },
    snapshot_id: "snapshot-1",
    price: "4.00",
    available: true,
    inventory_quantity: 20,
    weight: "0.2",
    weight_unit: "lb",
    captured_at: "2026-07-12T20:00:00.000Z",
  })
  assert.equal(candidate.candidateKey, "luna-portex:p1:v1")
  assert.equal(candidate.gtin, "123456789012")
  assert.equal(candidate.supplierCost, 4)
  assert.deepEqual(candidate.dimensions, { length: 2, width: 1, height: 1, unit: "in" })
})

test("builds an explainable ranked queue row with eBay-first matches", () => {
  const row = buildOpportunityQueueRow(assessment(), [{ discoveryMatchScore: 84 }], new Date("2026-07-12T21:00:00Z"))
  assert.equal(row.queue_status, "review")
  assert.equal(row.opportunity_score, 68)
  assert.equal(row.best_selling_match_score, 84)
  assert.equal(row.estimated_weekly_velocity, 12)
  assert.equal(row.keyword_structure.primarySearchPhrase, "cable organizer")
})

test("promotes ready candidates and holds unavailable Luna variants", () => {
  const ready = buildOpportunityQueueRow(assessment({ canProceedToListingPackage: true }), [])
  assert.equal(ready.queue_status, "ready")
  const unavailableAssessment = assessment()
  unavailableAssessment.candidate.available = false
  const hold = buildOpportunityQueueRow(unavailableAssessment, [])
  assert.equal(hold.queue_status, "hold")
})

test("detects supplier price, stock, availability and score changes", () => {
  const next = buildOpportunityQueueRow(assessment(), [])
  const events = buildOpportunityChangeEvents({
    id: "q1",
    opportunity_score: 55,
    supplier_price: 3,
    supplier_available: false,
    supplier_inventory_quantity: 0,
    queue_status: "watchlist",
  }, next, "snapshot-2")
  assert.deepEqual(events.map((event) => event.type).sort(), [
    "price_up", "rescored", "restocked", "status_changed", "stock_changed",
  ])
})

test("scheduled and Admin routes remain authenticated and read-only toward eBay", () => {
  const adminRoute = readFileSync(new URL("../app/api/admin/ebay/luna-opportunity-queue/route.ts", import.meta.url), "utf8")
  const cronRoute = readFileSync(new URL("../app/api/cron/ebay-luna-opportunity-scan/route.ts", import.meta.url), "utf8")
  const gateway = readFileSync(new URL("../lib/ebay/ebay-luna-demand-opportunity-gateway.ts", import.meta.url), "utf8")
  assert.match(adminRoute, /validateAdminApiRequest/)
  assert.match(cronRoute, /CRON_SECRET/)
  assert.match(gateway, /OFFICIAL_READ_ONLY_GET/)
  assert.doesNotMatch(gateway, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/)
})

test("latest Luna variants use a maintained current-snapshot pointer", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260713012000_optimize_ebay_luna_latest_variants.sql", import.meta.url),
    "utf8",
  )
  assert.match(migration, /create table if not exists public\.market_radar_current_variant_snapshots/)
  assert.match(migration, /after insert on public\.market_radar_snapshots/)
  assert.match(migration, /from public\.market_radar_current_variant_snapshots latest/)
  const optimizedView = migration.slice(migration.indexOf("create or replace view public.market_radar_latest_variants"))
  assert.doesNotMatch(optimizedView, /select distinct on/)
})

test("best-selling signal keys are deterministic and contain no secrets", () => {
  const key = buildBestSellingSignalKey({
    categoryId: "11700",
    epid: "12345",
    title: "Cable Organizer",
    imageUrl: null,
    averageRating: 4.8,
    ratingCount: 20,
    reviewCount: 10,
    evidenceClass: "EBAY_MARKETING_BEST_SELLING_PRODUCT",
  })
  assert.equal(key, "11700:12345")
})
