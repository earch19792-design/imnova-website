import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  buildEbayDemandCandidateFromLuna,
  normalizeLunaOpportunityCandidate,
} from "../lib/ebay/ebay-luna-catalog-normalization.ts"
import {
  buildCurrentEbayListingObservations,
  buildEbayLunaOpportunityAssessment,
  calculateEbayListingRotationSignals,
  matchEbayBestSellingProductsToLuna,
} from "../lib/ebay/ebay-luna-demand-opportunity-engine.ts"
import {
  buildEbaySellerKeywordDemandValidation,
} from "../lib/ebay/ebay-seller-keyword-demand-validation.ts"
import {
  buildEbayInventoryMappingPreviewReadiness,
} from "../lib/ebay/ebay-inventory-mapping-preview-readiness.ts"

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/ebay-luna-demand-opportunity-engine-v1.json", import.meta.url),
  "utf8"
))

function buildInput(overrides = {}) {
  const candidate = { ...fixture.candidate, ...(overrides.candidate ?? {}) }
  const demandReport = buildEbaySellerKeywordDemandValidation({
    candidate: buildEbayDemandCandidateFromLuna(
      normalizeLunaOpportunityCandidate(candidate, fixture.now)
    ),
    comparables: overrides.comparables ?? fixture.comparables,
    insightsAvailability: "NOT_ENTITLED",
  })
  return {
    candidate,
    demandReport,
    observationHistory: overrides.observationHistory ?? fixture.observationHistory,
  }
}

test("normalizes Luna identifiers and keeps exact product fields separate", () => {
  const normalized = normalizeLunaOpportunityCandidate(fixture.candidate, fixture.now)
  assert.equal(normalized.gtin, "123456789012")
  assert.equal(normalized.brand, "ConSandtrate")
  assert.equal(normalized.mpn, "CS-CF-3G")
  assert.equal(normalized.packQuantity, 1)
  assert.equal(normalized.stockAgeHours, 6)
  assert.equal(normalized.identityDataCompleteness, 100)
})

test("two snapshots calculate observed estimated rotation without calling it verified history", () => {
  const input = buildInput()
  const current = buildCurrentEbayListingObservations(input, fixture.now)
  const rotations = calculateEbayListingRotationSignals(current, fixture.observationHistory)
  assert.equal(rotations.length, 2)
  assert.deepEqual(rotations.map((entry) => entry.estimatedSoldDelta), [14, 7])
  assert.deepEqual(rotations.map((entry) => entry.estimatedSoldDelta7d), [14, 7])
  assert.deepEqual(rotations.map((entry) => entry.estimatedSoldDelta30d), [null, null])
  assert.deepEqual(rotations.map((entry) => entry.estimatedWeeklyVelocity), [14, 7])
  assert.ok(rotations.every((entry) => entry.evidenceClass === "OBSERVED_ESTIMATED_SALES_DELTA"))
  assert.ok(rotations.every((entry) => entry.safeToCallVerifiedSales === false))
})

test("single snapshot never claims recent rotation", () => {
  const input = buildInput({ observationHistory: [] })
  const assessment = buildEbayLunaOpportunityAssessment(input, {
    now: fixture.now,
    estimatedOutboundShipping: 4,
  })
  assert.equal(assessment.market.rotationEvidenceStatus, "ROTATION_BASELINE_REQUIRED")
  assert.ok(assessment.evidenceGuards.includes("NEED_7D_OR_30D_ROTATION_BASELINE"))
  assert.equal(assessment.estimatedSignalsAreVerifiedSales, false)
})

test("counter decrease is treated as reset or relist review", () => {
  const input = buildInput()
  const current = buildCurrentEbayListingObservations(input, fixture.now)
  const history = fixture.observationHistory.map((entry) => ({
    ...entry,
    estimatedSoldQuantity: 999,
  }))
  const rotations = calculateEbayListingRotationSignals(current, history)
  assert.ok(rotations.every((entry) => entry.evidenceClass === "COUNTER_RESET_OR_RELIST_REVIEW"))
  assert.ok(rotations.every((entry) => entry.estimatedSoldDelta === null))
})

test("exact GTIN and estimated distributed movement remain research-only without confirmed sales", () => {
  const assessment = buildEbayLunaOpportunityAssessment(buildInput(), {
    now: fixture.now,
    estimatedOutboundShipping: 4,
  })
  assert.equal(assessment.identity.exactIdentityConfirmed, true)
  assert.equal(assessment.identity.maxIdentityScore, 100)
  assert.equal(assessment.market.rotationEvidenceStatus, "MULTI_SELLER_OBSERVED_ESTIMATED_ROTATION")
  assert.equal(assessment.market.sellersWithPositiveMovement, 2)
  assert.equal(assessment.market.totalEstimatedWeeklyVelocity, 21)
  assert.equal(assessment.economics.passesProfitGate, true)
  assert.equal(
    assessment.market.demandEvidenceRoute,
    "EXACT_BROWSE_SNAPSHOT_DELTAS_RESEARCH_ONLY",
  )
  assert.ok(assessment.evidenceGuards.includes("NEED_CONFIRMED_SOLD_EXACT"))
  assert.equal(assessment.canProceedToListingPackage, false)
  assert.equal(assessment.canProceedToControlledDraftPreflight, false)
  assert.equal(assessment.canPublish, false)
})

test("missing identifiers, dimensions and authorized images remain hard gates", () => {
  const assessment = buildEbayLunaOpportunityAssessment(buildInput({
    candidate: {
      gtin: null,
      mpn: null,
      weight: null,
      dimensions: null,
      imageAuthorized: false,
    },
  }), { now: fixture.now })
  assert.ok(assessment.hardGates.includes("NEED_EXACT_GTIN_OR_BRAND_MPN_MATCH"))
  assert.ok(assessment.hardGates.includes("NEED_PACKAGE_WEIGHT_AND_DIMENSIONS"))
  assert.ok(assessment.hardGates.includes("NEED_AUTHORIZED_PRODUCT_IMAGES"))
  assert.equal(assessment.canProceedToListingPackage, false)
})

test("authorized-image and package-weight gates require usable evidence, not booleans or defaults", () => {
  const assessment = buildEbayLunaOpportunityAssessment(buildInput({
    candidate: {
      imageAuthorized: true,
      imageUrls: [],
      weight: 3.2,
      weightUnit: null,
    },
  }), { now: fixture.now })
  assert.ok(assessment.hardGates.includes("NEED_AUTHORIZED_PRODUCT_IMAGES"))
  assert.ok(assessment.hardGates.includes("NEED_PACKAGE_WEIGHT"))
  assert.equal(assessment.fulfillmentEvidence.weightConfirmed, false)
  assert.equal(assessment.listingIntelligencePackage.imagePlan.authorizedLunaImagesAvailable, false)
})

test("low stock reduces supply and urgency instead of boosting seller priority", () => {
  const low = buildEbayLunaOpportunityAssessment(buildInput({
    candidate: { inventoryQuantity: 1 },
  }), { now: fixture.now, estimatedOutboundShipping: 4 })
  const healthy = buildEbayLunaOpportunityAssessment(buildInput({
    candidate: { inventoryQuantity: 30 },
  }), { now: fixture.now, estimatedOutboundShipping: 4 })
  assert.ok(low.scores.supplyScore < healthy.scores.supplyScore)
  assert.ok(low.scores.urgencyScore < healthy.scores.urgencyScore)
  assert.ok(low.scores.sellerPriorityScore < healthy.scores.sellerPriorityScore)
})

test("eligible own-account category learning adjusts ranking only and is capped at five points", () => {
  const base = buildEbayLunaOpportunityAssessment(buildInput(), {
    now: fixture.now,
    estimatedOutboundShipping: 4,
  })
  const learned = buildEbayLunaOpportunityAssessment(buildInput(), {
    now: fixture.now,
    estimatedOutboundShipping: 4,
    categoryLearningAdjustment: {
      accountKey: `official-seller-account:${"a".repeat(64)}`,
      marketplaceId: "EBAY_US",
      categoryId: "50335",
      modelVersion: "EBAY-CATEGORY-PERFORMANCE-CALIBRATION-V2",
      predictionEngineVersion:
        "EBAY-SELLER-COMMAND-CENTER-OPPORTUNITY-ENGINE-V3",
      status: "ELIGIBLE_APPLIED",
      eligible: true,
      adjustmentPoints: 99,
      sampleListingCount: 20,
      totalImpressions: 2_000,
      minimumObservationDays: 28,
      source: "EBAY_SELL_ANALYTICS_READONLY",
      computedAt: "2026-07-12T00:00:00.000Z",
    },
  })
  assert.equal(
    learned.scores.opportunityScore,
    Math.min(100, base.scores.opportunityScore + 5),
  )
  assert.equal(learned.scores.categoryLearning.boundedAdjustmentPoints, 5)
  assert.equal(learned.scores.categoryLearning.safetyGatesChanged, false)
  assert.equal(learned.scores.potentialScore, base.scores.potentialScore)
  assert.equal(learned.scores.confidenceScore, base.scores.confidenceScore)
  assert.deepEqual(learned.hardGates, base.hardGates)
  assert.deepEqual(learned.evidenceGuards, base.evidenceGuards)
  assert.equal(
    learned.canProceedToListingPackage,
    base.canProceedToListingPackage,
  )
})

test("a single listing, competitor source or stale prediction-engine cohort cannot influence ranking", () => {
  const baseOptions = { now: fixture.now, estimatedOutboundShipping: 4 }
  const base = buildEbayLunaOpportunityAssessment(buildInput(), baseOptions)
  for (const invalid of [
    {
      sampleListingCount: 1,
      source: "EBAY_SELL_ANALYTICS_READONLY",
      predictionEngineVersion:
        "EBAY-SELLER-COMMAND-CENTER-OPPORTUNITY-ENGINE-V3",
    },
    {
      sampleListingCount: 20,
      source: "COMPETITOR_OBSERVATION",
      predictionEngineVersion:
        "EBAY-SELLER-COMMAND-CENTER-OPPORTUNITY-ENGINE-V3",
    },
    {
      sampleListingCount: 20,
      source: "EBAY_SELL_ANALYTICS_READONLY",
      predictionEngineVersion:
        "EBAY-SELLER-COMMAND-CENTER-OPPORTUNITY-ENGINE-V2",
    },
  ]) {
    const assessment = buildEbayLunaOpportunityAssessment(buildInput(), {
      ...baseOptions,
      categoryLearningAdjustment: {
        accountKey: `official-seller-account:${"a".repeat(64)}`,
        marketplaceId: "EBAY_US",
        categoryId: "50335",
        modelVersion: "EBAY-CATEGORY-PERFORMANCE-CALIBRATION-V2",
        predictionEngineVersion: invalid.predictionEngineVersion,
        status: "ELIGIBLE_APPLIED",
        eligible: true,
        adjustmentPoints: 5,
        sampleListingCount: invalid.sampleListingCount,
        totalImpressions: 2_000,
        minimumObservationDays: 28,
        source: invalid.source,
        computedAt: "2026-07-12T00:00:00.000Z",
      },
    })
    assert.equal(assessment.scores.opportunityScore, base.scores.opportunityScore)
    assert.equal(assessment.scores.categoryLearning.status, "NOT_APPLIED")
  }
})

test("custom stock freshness is applied consistently to gates and scoring", () => {
  const staleAtFourHours = buildEbayLunaOpportunityAssessment(buildInput(), {
    now: fixture.now,
    stockFreshnessHours: 4,
    estimatedOutboundShipping: 4,
  })
  const freshAtTwelveHours = buildEbayLunaOpportunityAssessment(buildInput(), {
    now: fixture.now,
    stockFreshnessHours: 12,
    estimatedOutboundShipping: 4,
  })
  assert.ok(staleAtFourHours.hardGates.includes("NEED_FRESH_LUNA_STOCK"))
  assert.equal(freshAtTwelveHours.hardGates.includes("NEED_FRESH_LUNA_STOCK"), false)
  assert.equal(staleAtFourHours.scores.stockFreshnessHours, 4)
  assert.equal(freshAtTwelveHours.scores.stockFreshnessHours, 12)
  assert.ok(staleAtFourHours.scores.supplyScore < freshAtTwelveHours.scores.supplyScore)
})

test("single seller movement is explicitly concentrated and does not prove market demand", () => {
  const input = buildInput({
    comparables: [fixture.comparables[0]],
    observationHistory: [fixture.observationHistory[0]],
  })
  const assessment = buildEbayLunaOpportunityAssessment(input, {
    now: fixture.now,
    estimatedOutboundShipping: 4,
  })
  assert.equal(assessment.market.sellersWithPositiveMovement, 1)
  assert.ok(assessment.evidenceGuards.includes("SINGLE_SELLER_ROTATION_CONCENTRATION"))
  assert.ok(assessment.evidenceGuards.includes("NEED_MULTI_SELLER_DEMAND_EVIDENCE"))
  assert.equal(assessment.canProceedToListingPackage, false)
})

test("eBay-first best-selling discovery only creates a candidate for exact identifier review", () => {
  const matches = matchEbayBestSellingProductsToLuna([
    {
      categoryId: "50335",
      epid: "123456",
      title: "ConSandtrate Concrete Crack Filler Gray 3 lb Bottle",
      imageUrl: null,
      averageRating: 4.8,
      ratingCount: 20,
      reviewCount: 10,
      evidenceClass: "EBAY_MARKETING_BEST_SELLING_PRODUCT",
    },
  ], [fixture.candidate])
  assert.equal(matches.length, 1)
  assert.equal(matches[0].route, "NEED_EXACT_IDENTIFIER_CONFIRMATION")
  assert.equal(matches[0].salesQuantityClaimed, false)
  assert.equal(matches[0].humanConfirmationRequired, true)
})

test("Inventory Mapping stays a preview plan and requires official taxonomy plus human review", () => {
  const candidate = normalizeLunaOpportunityCandidate(fixture.candidate, fixture.now)
  const readiness = buildEbayInventoryMappingPreviewReadiness(candidate, {
    status: "AVAILABLE",
    categoryTreeId: "0",
    categoryId: "50335",
    categoryName: "Concrete Repair",
    requiredAspects: [{
      name: "Brand",
      mode: "FREE_TEXT",
      cardinality: "SINGLE",
      expectedRequiredByDate: null,
      suggestedValues: [],
    }],
    recommendedAspects: [],
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  })
  assert.equal(readiness.status, "READY_TO_REQUEST_INVENTORY_MAPPING_PREVIEW")
  assert.equal(readiness.graphqlRequestExecuted, false)
  assert.equal(readiness.listingDraftCreated, false)
  assert.equal(readiness.listingPublished, false)
  assert.equal(readiness.humanReviewRequired, true)
})

test("Luna scanner persists barcode and weight facts for exact matching without applying migrations", () => {
  const scanner = readFileSync(
    new URL("../lib/market-radar-lunaportex.ts", import.meta.url),
    "utf8"
  )
  const migration = readFileSync(
    new URL("../supabase/migrations/202607120003_add_luna_variant_identity_facts.sql", import.meta.url),
    "utf8"
  )
  assert.match(scanner, /barcode\?: string \| null/)
  assert.match(scanner, /getString\(variant\.barcode\)/)
  assert.match(scanner, /getNumber\(variant\.grams\)/)
  assert.match(migration, /add column if not exists barcode text/i)
  assert.match(migration, /market_radar_snapshots_barcode_idx/i)
})

test("Taxonomy and seller Analytics adapters are official read-only with safe missing OAuth state", () => {
  const demandGateway = readFileSync(
    new URL("../lib/ebay/ebay-seller-keyword-demand-gateway.ts", import.meta.url),
    "utf8"
  )
  const analyticsGateway = readFileSync(
    new URL("../lib/ebay/ebay-seller-analytics-readonly-gateway.ts", import.meta.url),
    "utf8"
  )
  const analyticsRoute = readFileSync(
    new URL("../app/api/admin/ebay/seller-performance/route.ts", import.meta.url),
    "utf8"
  )
  assert.match(demandGateway, /get_default_category_tree_id/)
  assert.match(demandGateway, /get_item_aspects_for_category/)
  assert.match(demandGateway, /method: "GET"/)
  assert.match(analyticsGateway, /sell\.analytics\.readonly/)
  assert.match(analyticsGateway, /method: "GET"/)
  assert.match(analyticsGateway, /tokenReturned: false/)
  assert.match(analyticsGateway, /tokenStoredByApplication: false/)
  assert.match(analyticsRoute, /EBAY_SELLER_OAUTH_NOT_CONFIGURED/)
  assert.doesNotMatch(analyticsGateway, /console\.(log|error)/)
})

test("route, storage and migration keep eBay write disabled and persistence opt-in", () => {
  const route = readFileSync(
    new URL("../app/api/admin/ebay/luna-opportunities/route.ts", import.meta.url),
    "utf8"
  )
  const gateway = readFileSync(
    new URL("../lib/ebay/ebay-luna-demand-opportunity-gateway.ts", import.meta.url),
    "utf8"
  )
  const store = readFileSync(
    new URL("../lib/ebay/ebay-luna-opportunity-observation-store.ts", import.meta.url),
    "utf8"
  )
  const migration = readFileSync(
    new URL("../supabase/migrations/202607120002_create_ebay_luna_opportunity_observations.sql", import.meta.url),
    "utf8"
  )
  assert.match(route, /persistObservations === true/)
  assert.match(store, /EBAY_MARKET_OBSERVATION_WRITES_ENABLED/)
  assert.match(store, /defaultWriteEnabled: false/)
  assert.match(store, /storesRawEbayPayload: false/)
  assert.match(gateway, /ebayWriteUsed: false/)
  assert.match(gateway, /draftsCreated: false/)
  assert.match(gateway, /listingsPublished: false/)
  assert.match(migration, /enable row level security/i)
  assert.doesNotMatch(migration, /raw_payload/i)
})
