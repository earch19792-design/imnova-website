import assert from "node:assert/strict"
import test from "node:test"

import {
  buildEbayLunaOpportunityAssessment,
} from "../lib/ebay/ebay-luna-demand-opportunity-engine.ts"
import {
  buildEbaySellerKeywordDemandValidation,
} from "../lib/ebay/ebay-seller-keyword-demand-validation.ts"
import {
  buildProfessionalSellerQueueView,
  mapLatestVariantToLunaCandidate,
} from "../lib/ebay/ebay-first-luna-opportunity-queue.ts"

const now = "2026-07-12T12:00:00.000Z"

const candidate = {
  candidateKey: "luna-portex:p1:v1",
  marketRadarProductId: "00000000-0000-0000-0000-000000000001",
  supplierProductId: "p1",
  supplierVariantId: "v1",
  sku: "SKU-1",
  title: "Acme Precision Cable Holder Black 20 Pack",
  variantTitle: "Black / 20 Pack",
  brand: "Acme",
  mpn: "ACH-20-BLK",
  gtin: "123456789012",
  color: "Black",
  size: "20 Pack",
  packQuantity: 20,
  productType: "Cable Management",
  supplierCost: 3,
  available: true,
  inventoryQuantity: 25,
  stockCapturedAt: "2026-07-12T06:00:00.000Z",
  weight: 0.5,
  weightUnit: "lb",
  dimensions: null,
  imageUrls: ["https://cdn.example.com/acme.jpg"],
  imageAuthorized: true,
}

const exact = (overrides = {}) => ({
  itemId: "item-1",
  title: "Acme Precision Cable Holder Black 20 Pack",
  price: 20,
  shippingCost: 0,
  sellerUsername: "seller-one",
  gtin: candidate.gtin,
  brand: candidate.brand,
  mpn: candidate.mpn,
  source: "EBAY_BROWSE_ESTIMATED_SALES",
  estimatedSoldQuantity: 10,
  ...overrides,
})

function report(comparables, overrides = {}) {
  return buildEbaySellerKeywordDemandValidation({
    candidate: {
      productName: candidate.title,
      variantTitle: candidate.variantTitle,
      gtin: candidate.gtin,
      brand: candidate.brand,
      mpn: candidate.mpn,
    },
    comparables,
    asOf: now,
    insightsAvailability: "AVAILABLE",
    ...overrides,
  })
}

function taxonomy(requiredAspects = []) {
  return {
    status: "AVAILABLE",
    categoryTreeId: "0",
    categoryId: "123",
    categoryName: "Cable Management",
    requiredAspects,
    recommendedAspects: [],
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  }
}

test("multi-seller evidence requires distinct normalized sellers", () => {
  const demand = report([
    exact({
      source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      estimatedSoldQuantity: null,
      totalSoldQuantity: 8,
      lastSoldDate: "2026-07-10T12:00:00.000Z",
    }),
    exact({
      itemId: "item-2",
      sellerUsername: "SELLER-ONE",
      source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      estimatedSoldQuantity: null,
      totalSoldQuantity: 7,
      lastSoldDate: "2026-07-09T12:00:00.000Z",
    }),
  ])
  assert.equal(demand.verifiedSoldSellerCount, 1)
  assert.equal(demand.demandValidationPassed, false)
  assert.equal(demand.demandValidationBasis, "INSUFFICIENT_EVIDENCE")
})

test("stale official sold history is visible but cannot validate current demand", () => {
  const demand = report([
    exact({
      source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      estimatedSoldQuantity: null,
      totalSoldQuantity: 20,
      lastSoldDate: "2025-01-01T00:00:00.000Z",
    }),
    exact({
      itemId: "item-2",
      sellerUsername: "seller-two",
      source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      estimatedSoldQuantity: null,
      totalSoldQuantity: 20,
      lastSoldDate: "2025-01-02T00:00:00.000Z",
    }),
  ])
  assert.equal(demand.staleVerifiedSoldListingCount, 2)
  assert.equal(demand.totalVerifiedSoldQuantity, 0)
  assert.equal(demand.demandValidationPassed, false)
})

test("candidate, similar, identifier-exact active and identifier-exact sold evidence stay separate", () => {
  const demand = report([
    exact(),
    exact({
      itemId: "sold-1",
      sellerUsername: "seller-two",
      source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      estimatedSoldQuantity: null,
      totalSoldQuantity: 6,
      lastSoldDate: "2026-07-10T00:00:00.000Z",
    }),
    {
      ...exact({ itemId: "similar-1", sellerUsername: "seller-three" }),
      gtin: null,
      brand: null,
      mpn: null,
    },
    exact({ itemId: "conflict", gtin: "999999999999" }),
  ])
  assert.deepEqual(demand.evidenceBuckets, {
    candidateFoundCount: 4,
    returnedCandidateCount: 4,
    enrichedSampleCount: 4,
    strongSimilarCount: 1,
    identifierExactActiveCount: 1,
    identifierExactRecentSoldCount: 1,
    identifierExactRecentSoldQuantity: 6,
    identifierExactRecentSoldSellerCount: 1,
    identifierExactStaleSoldCount: 0,
    conflictingCount: 1,
  })
})

test("exact GTIN dominates a soft vendor/brand conflict", () => {
  const demand = report([
    exact({ brand: "Acme Incorporated" }),
  ])
  const assessment = buildEbayLunaOpportunityAssessment({
    candidate,
    demandReport: demand,
    observationHistory: [],
    taxonomyIntelligence: taxonomy(),
  }, { now })
  assert.equal(assessment.identity.exactIdentityConfirmed, true)
  assert.deepEqual(assessment.identity.comparables[0].identityConflicts, [])
  assert.ok(assessment.identity.comparables[0].softIdentityConflicts.includes("BRAND_CONFLICT"))
})

test("estimated velocity counts identifier-exact listings only", () => {
  const demand = report([
    exact(),
    {
      ...exact({ itemId: "similar-1", sellerUsername: "seller-two", estimatedSoldQuantity: 30 }),
      gtin: null,
      brand: null,
      mpn: null,
    },
  ])
  const assessment = buildEbayLunaOpportunityAssessment({
    candidate,
    demandReport: demand,
    observationHistory: [
      {
        candidateKey: candidate.candidateKey,
        itemId: "item-1",
        sellerId: "seller-one",
        observedAt: "2026-07-05T12:00:00.000Z",
        estimatedSoldQuantity: 5,
        price: 20,
        shippingCost: 0,
        identityMatchScore: 100,
        identityMatchType: "EXACT_GTIN",
        evidenceSource: "EBAY_BROWSE_ESTIMATED_SALES",
      },
      {
        candidateKey: candidate.candidateKey,
        itemId: "similar-1",
        sellerId: "seller-two",
        observedAt: "2026-07-05T12:00:00.000Z",
        estimatedSoldQuantity: 1,
        price: 20,
        shippingCost: 0,
        identityMatchScore: 80,
        identityMatchType: "STRONG_ATTRIBUTE_MATCH",
        evidenceSource: "EBAY_BROWSE_ESTIMATED_SALES",
      },
    ],
    taxonomyIntelligence: taxonomy(),
  }, { now })
  assert.equal(assessment.market.totalEstimatedWeeklyVelocity, 5)
  assert.equal(assessment.market.sellersWithPositiveMovement, 1)
  assert.equal(assessment.market.rotationEvidenceStatus, "CONCENTRATED_OR_SINGLE_SELLER_OBSERVED_ROTATION")
})

test("recent official exact sold history from two sellers replaces Browse baseline", () => {
  const demand = report([
    exact({
      source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      estimatedSoldQuantity: null,
      totalSoldQuantity: 12,
      lastSoldDate: "2026-07-10T00:00:00.000Z",
    }),
    exact({
      itemId: "sold-2",
      sellerUsername: "seller-two",
      price: 22,
      source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
      estimatedSoldQuantity: null,
      totalSoldQuantity: 9,
      lastSoldDate: "2026-07-09T00:00:00.000Z",
    }),
  ])
  const assessment = buildEbayLunaOpportunityAssessment({
    candidate,
    demandReport: demand,
    observationHistory: [],
    taxonomyIntelligence: taxonomy([{ name: "Brand", mode: "FREE_TEXT", cardinality: "SINGLE", expectedRequiredByDate: null, suggestedValues: [] }]),
  }, { now, estimatedOutboundShipping: 3 })
  assert.equal(assessment.market.rotationEvidenceStatus, "MULTI_SELLER_VERIFIED_RECENT_SOLD_HISTORY")
  assert.equal(assessment.market.demandEvidenceRoute, "OFFICIAL_RECENT_EXACT_SOLD_HISTORY")
  assert.equal(assessment.evidenceGuards.includes("NEED_7D_OR_30D_ROTATION_BASELINE"), false)
  assert.equal(assessment.evidenceGuards.includes("NEED_MULTI_SELLER_DEMAND_EVIDENCE"), false)
  assert.equal(assessment.canProceedToListingPackage, true)
})

test("economics use the P25 exact total-buyer price", () => {
  const prices = [10, 20, 30, 40]
  const comparables = prices.map((price, index) => exact({
    itemId: `item-${index}`,
    sellerUsername: `seller-${index}`,
    price,
  }))
  const demand = report(comparables)
  const assessment = buildEbayLunaOpportunityAssessment({
    candidate,
    demandReport: demand,
    observationHistory: [],
    taxonomyIntelligence: taxonomy(),
  }, { now })
  assert.equal(assessment.economics.marketPrice, 17.5)
  assert.equal(assessment.economics.pricingBasis, "EXACT_COMPARABLE_TOTAL_BUYER_PRICE_P25")
  assert.equal(assessment.economics.conservativeEstimate, true)
})

test("dimensions are conditional while weight, taxonomy and required aspects remain guarded", () => {
  const demand = report([exact()])
  const optional = buildEbayLunaOpportunityAssessment({
    candidate,
    demandReport: demand,
    taxonomyIntelligence: taxonomy(),
  }, { now })
  assert.equal(optional.fulfillmentEvidence.dimensionsRequired, false)
  assert.equal(optional.hardGates.includes("NEED_PACKAGE_DIMENSIONS"), false)

  const required = buildEbayLunaOpportunityAssessment({
    candidate: { ...candidate, metadata: { requiresPackageDimensions: true } },
    demandReport: demand,
    taxonomyIntelligence: taxonomy([{ name: "Material", mode: "FREE_TEXT", cardinality: "SINGLE", expectedRequiredByDate: null, suggestedValues: [] }]),
  }, { now })
  assert.ok(required.hardGates.includes("NEED_PACKAGE_DIMENSIONS"))
  assert.ok(required.hardGates.includes("NEED_REQUIRED_EBAY_ITEM_ASPECTS"))
  assert.deepEqual(required.taxonomyVerification.missingRequiredAspects, ["Material"])
})

test("Luna queue mapper connects the complete product restriction detector", () => {
  const mapped = mapLatestVariantToLunaCandidate({
    product_id: "product-1",
    supplier_product_id: "supplier-1",
    supplier_variant_id: "variant-1",
    sku: "SPRAY-1",
    barcode: null,
    title: "Industrial Aerosol Spray Paint",
    variant_title: null,
    vendor: "Acme",
    product_type: "Paint",
    tags: [],
    product_url: null,
    featured_image_url: "https://supplier.example.com/spray.jpg",
    image_urls: [],
    metadata: {},
    snapshot_id: "snapshot-1",
    price: 5,
    available: true,
    inventory_quantity: 10,
    weight: 1,
    weight_unit: "lb",
    captured_at: now,
  })
  assert.ok(mapped.restrictionGuards.includes("NEED_SHIPPING_RESTRICTION_REVIEW"))
  assert.ok(mapped.restrictionGuards.includes("NEED_HAZMAT_OR_AEROSOL_REVIEW"))
  assert.deepEqual(mapped.imageUrls, ["https://supplier.example.com/spray.jpg"])
  assert.equal(mapped.imageAuthorized, false)
  assert.equal(mapped.brand, null, "supplier vendor must not silently become manufacturer brand")
})

test("mobile queue consumes the canonical V2 priority without re-weighting evidence", () => {
  const view = buildProfessionalSellerQueueView({
    id: "queue-1",
    candidate_key: candidate.candidateKey,
    market_radar_product_id: candidate.marketRadarProductId,
    opportunity_score: 11,
    supplier_available: true,
    supplier_inventory_quantity: 25,
    supplier_price: 3,
    active_comparables: 2,
    assessment: {
      identity: { exactIdentityConfirmed: true, comparables: [] },
      economics: { ready: true },
      scores: {
        potentialScore: 88,
        confidenceScore: 80,
        urgencyScore: 70,
        sellerPriorityScore: 73,
      },
      canProceedToListingPackage: true,
      listingIntelligencePackage: {},
    },
  })
  assert.equal(view.seller_priority_score, 73)
  assert.deepEqual(view.score_axes, { potential: 88, confidence: 80, urgency: 70 })
  assert.equal(view.listing_intake_url, "/admin/ebay/listing-workspace?opportunity=queue-1&candidate=luna-portex%3Ap1%3Av1")

  const blocked = buildProfessionalSellerQueueView({
    id: "queue-blocked",
    candidate_key: candidate.candidateKey,
    opportunity_score: 20,
    supplier_available: true,
    assessment: {
      identity: { exactIdentityConfirmed: false, comparables: [] },
      economics: { ready: false },
      scores: { sellerPriorityScore: 20 },
      canProceedToListingPackage: false,
      listingIntelligencePackage: {},
    },
  })
  assert.equal(blocked.can_prepare_listing_package, false)
  assert.equal(blocked.can_open_listing_workspace, false)
  assert.equal(blocked.listing_intake_url, null)
})
