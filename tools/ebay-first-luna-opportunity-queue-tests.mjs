import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildBestSellingSignalKey,
  buildOpportunityChangeEvents,
  buildOpportunityQueueRow,
  buildProfessionalSellerQueueView,
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

test("mobile command center centralizes scan, queue and candidate review", () => {
  const mobilePage = readFileSync(new URL("../app/admin/ebay/mobile-review/page.tsx", import.meta.url), "utf8")
  const commandCenter = readFileSync(new URL("../app/admin/ebay/mobile-review/opportunity-command-center.tsx", import.meta.url), "utf8")
  assert.match(mobilePage, /Seller Command Center/)
  assert.match(mobilePage, /id: "opportunities"/)
  assert.match(mobilePage, /OpportunityCommandCenter/)
  assert.match(commandCenter, /Iniciar scan prioritario/)
  assert.match(commandCenter, /Acelerar 20 productos/)
  assert.match(commandCenter, /Actualizar Luna/)
  assert.match(commandCenter, /Top para trabajar ahora/)
  assert.match(commandCenter, /comparables exactos/)
  assert.match(commandCenter, /onReviewCandidate/)
  assert.match(commandCenter, /Monitoreo y riesgos/)
  assert.match(mobilePage, /scans y cola guardados en Supabase/)
  assert.match(mobilePage, /report\.allCandidates\.find/)
})

test("priority-first automation scans the strongest Radar signals before catalog coverage", () => {
  const service = readFileSync(new URL("../lib/ebay/ebay-first-luna-scan-service.ts", import.meta.url), "utf8")
  const adminRoute = readFileSync(new URL("../app/api/admin/ebay/luna-opportunity-queue/route.ts", import.meta.url), "utf8")
  const cronRoute = readFileSync(new URL("../app/api/cron/ebay-luna-opportunity-scan/route.ts", import.meta.url), "utf8")
  const radarCronRoute = readFileSync(new URL("../app/api/cron/market-radar-luna-sync/route.ts", import.meta.url), "utf8")
  const vercelConfig = readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
  assert.match(service, /EBAY_LUNA_SCAN_STRATEGY = "priority_first"/)
  const migration = readFileSync(new URL("../supabase/migrations/20260713022000_add_luna_seller_scan_priority.sql", import.meta.url), "utf8")
  const automationMigration = readFileSync(new URL("../supabase/migrations/20260713040000_create_ebay_seller_command_center_v2.sql", import.meta.url), "utf8")
  assert.match(automationMigration, /latest\.seller_scan_priority_score desc nulls last/)
  assert.match(automationMigration, /for update skip locked/i)
  assert.match(migration, /seller_scan_priority_score/)
  assert.match(migration, /score\.opportunity_score, 0\) \* 0\.55/)
  assert.match(migration, /snapshot\.inventory_quantity > 0/)
  assert.match(migration, /snapshot\.barcode/)
  assert.match(migration, /PRE_SCAN_RESTRICTION_REVIEW/)
  assert.match(migration, /then 25 else 0 end/)
  assert.match(adminRoute, /action === "restart_priority"/)
  assert.match(adminRoute, /status: "paused"/)
  assert.match(cronRoute, /CRON_MAX_CANDIDATES = 5/)
  assert.match(cronRoute, /CRON_TIME_BUDGET_MS = 45_000/)
  assert.match(radarCronRoute, /runLunaPortexMarketRadarSync/)
  assert.match(radarCronRoute, /CRON_SECRET/)
  assert.match(vercelConfig, /market-radar-luna-sync/)
  assert.match(vercelConfig, /0 \*\/6 \* \* \*/)
  assert.match(vercelConfig, /\*\/15 \* \* \* \*/)
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

test("separates eBay candidates from exact comparables and builds a seller fast lane", () => {
  const row = buildProfessionalSellerQueueView({
    id: "queue-1",
    market_radar_product_id: "00000000-0000-0000-0000-000000000001",
    opportunity_score: 42,
    demand_score: 50,
    listing_readiness_score: 45,
    active_comparables: 0,
    supplier_available: true,
    supplier_inventory_quantity: 20,
    supplier_price: 4,
    hard_gates: ["NEED_EXACT_GTIN_OR_BRAND_MPN_MATCH"],
    evidence_guards: ["NEED_7D_OR_30D_ROTATION_BASELINE"],
    assessment: {
      identity: {
        exactIdentityConfirmed: false,
        comparables: [
          { title: "Reference A", price: 18, identityMatchScore: 70 },
          { title: "Reference B", price: 19, identityMatchScore: 66 },
          { title: "Reference C", price: 17, identityMatchScore: 62 },
        ],
      },
      economics: { ready: false },
      scores: { supplyScore: 100 },
      canProceedToListingPackage: false,
      listingIntelligencePackage: {
        titleStrategy: {
          primarySearchPhrase: "cable organizer",
          secondarySearchTerms: ["desk cable holder"],
          titleFormula: "Marca + frase principal + variante",
        },
        categoryRecommendation: { categoryId: "123", categoryName: "Cable Management" },
      },
    },
  })
  assert.equal(row.ebay_candidate_count, 3)
  assert.equal(row.exact_comparable_count, 0)
  assert.equal(row.seller_lane, "HIGH_POTENTIAL_NEEDS_IDENTITY")
  assert.equal(row.can_prepare_listing_package, false)
  assert.equal(row.winning_structure.primarySearchPhrase, "cable organizer")
  assert.equal(row.top_ebay_candidates.length, 3)
  assert.equal(row.assessment, undefined)
  assert.ok(row.seller_priority_score > 0)
})

test("opportunity queue explains professional seller evidence in the UI", () => {
  const page = readFileSync(new URL("../app/admin/ebay/opportunity-queue/page.tsx", import.meta.url), "utf8")
  assert.match(page, /Top potencial para preparar listing/)
  assert.match(page, /Candidatos encontrados en eBay/)
  assert.match(page, /Comparables exactos/)
  assert.match(page, /El paquete se desbloquea al confirmar identidad, margen, stock y datos obligatorios/)
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
