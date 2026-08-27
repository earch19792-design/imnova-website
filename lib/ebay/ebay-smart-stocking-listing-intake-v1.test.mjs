import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value === "server-only") return {
    url: "data:text/javascript,export default {}", shortCircuit: true,
  }
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  buildCakeTurntableListingIntakeV1,
  CAKE_TURNTABLE_LISTING_INTAKE_KEY,
  isSmartStockingListingIntakeV1,
} = await import("./ebay-smart-stocking-listing-intake-v1.ts")
const { evaluateEbayListingWorkspaceEligibility } = await import(
  "./ebay-first-luna-opportunity-queue.ts")
const { buildSmartStockingLearningProfileV1 } = await import(
  "./ebay-smart-stocking-learning-profile-v1.ts")

function profile() {
  return buildSmartStockingLearningProfileV1({
    scoreBreakdown: {
      marketDemandScore: 3, economicsPotentialScore: 18,
      merchandisingScore: 16, lunaAdvantageScore: 13,
      operationalSimplicityScore: 3, portfolioDiversificationScore: 5,
      evidenceQualityScore: 2,
    },
    riskPenalty: 3,
    whyPrioritized: ["Exact low-cost Luna utility with merchandising potential."],
    knownUncertainties: ["No valid canonical exact Sold comparable."],
    entrySnapshotOrigin: "BACKFILLED_FROM_EXISTING_PRELAUNCH_EVIDENCE",
    decisionSnapshot: {
      launchPotentialScore: 57,
      launchTier: "CONTROLLED_MERCHANDISING_BET",
      evidenceProfile: ["EXACT_LUNA_PRODUCT_VARIANT_SKU_GTIN_TRUTH"],
      finalEconomics: {
        status: "PASS", salePriceUsd: 25.99, ebayFeesUsd: 4.38,
        lunaProductCostUsd: 3.8, lunaShippingUsd: 9.99,
        landedCostUsd: 13.79, contributionProfitUsd: 5.48,
        contributionMarginPercent: 21.1, roiPercent: 144.33,
        thresholdResult: "PASS",
      },
      rescueUsed: true,
      rescueType: "AUTHORITATIVE_SHIPPING_PRICE_RESCUE",
      whyPublishedOrParked: "Durable shipping and final economics pass.",
      parkReason: null,
      reopenCondition: null,
    },
  })
}

function decisionPackage(overrides = {}) {
  return {
    packageId: "67a72068-c052-4472-a022-9da7bb2b81bc",
    status: "GENERATED",
    package: {
      productIdentity: { identity: { gtin: "740119084743" } },
    },
    smartStockingLearningProfile: profile(),
    ...overrides,
  }
}

function lunaProduct(variant = {}) {
  return {
    productId: "9220835475680",
    handle: "cake-turntable",
    title: "11in Revolving Plastic Cake Turntable Non-Slip Base",
    vendor: null,
    productType: null,
    canonicalUrl: "https://lunaportex.com/products/cake-turntable",
    imageUrls: Array.from({ length: 6 }, (_, index) =>
      `https://cdn.shopify.com/s/files/cake-${index + 1}.webp`),
    variants: [{
      id: "48809646653664", title: "Default Title", sku: "ITEM3525",
      sourceUnitBarcode: "740119084743", sourceUnitPrice: 3.8,
      sourceCompareAtPrice: null, available: true, weight: 401,
      weightUnit: "g", ...variant,
    }],
  }
}

function build(overrides = {}) {
  return buildCakeTurntableListingIntakeV1({
    decisionPackage: decisionPackage(overrides.decisionPackage),
    lunaProduct: lunaProduct(overrides.variant),
    marketRadarProductId: "11111111-1111-4111-8111-111111111111",
    observedAt: "2026-08-27T18:00:00.000Z",
  })
}

test("exact durable Cake decision materializes the existing queue intake without publication", () => {
  const row = build()
  assert.equal(row.candidate_key, CAKE_TURNTABLE_LISTING_INTAKE_KEY)
  assert.equal(row.decision, "LISTING_READY")
  assert.equal(row.median_total_buyer_price, 25.99)
  assert.equal(row.supplier_inventory_quantity, null)
  assert.equal(row.assessment.candidate.imageUrls.length, 6)
  assert.equal(row.assessment.safety.listingAuthorized, false)
  assert.equal(row.assessment.safety.marketplaceWrites, 0)
  assert.equal(isSmartStockingListingIntakeV1(row.assessment), true)
  assert.equal(evaluateEbayListingWorkspaceEligibility(row).allowed, true)
})

test("the intake fails closed on stock, identity, or final economics drift", () => {
  assert.throws(() => build({ variant: { available: false } }),
    /CAKE_TURNTABLE_LISTING_INTAKE_AUTHORITY_MISMATCH/)
  assert.throws(() => build({ variant: { sourceUnitBarcode: "000000000000" } }),
    /CAKE_TURNTABLE_LISTING_INTAKE_AUTHORITY_MISMATCH/)
  const bad = profile()
  bad.decisionSnapshot.finalEconomics.salePriceUsd = 24.99
  assert.throws(() => build({ decisionPackage: {
    smartStockingLearningProfile: bad,
  } }), /CAKE_TURNTABLE_LISTING_INTAKE_AUTHORITY_MISMATCH/)
})

test("only explicit workspace-resolvable package facts remain; dimensions are not fabricated", () => {
  const row = build()
  assert.deepEqual(row.hard_gates, [
    "NEED_AUTHORIZED_PRODUCT_IMAGES",
    "NEED_EBAY_TAXONOMY_CATEGORY",
    "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
  ])
  assert.equal(row.assessment.candidate.dimensions, null)
  assert.equal(row.assessment.listingIntelligencePackage.itemSpecifics
    .supplierConfirmed.Material, "Plastic")
  assert.equal(row.assessment.listingIntelligencePackage.categoryRecommendation
    .categoryId, "183335")
})

test("canonical Opportunities exposes ITEM3525 and the existing package action", () => {
  const page = readFileSync(
    "app/admin/ebay/opportunity-queue/research/page.tsx", "utf8")
  const card = readFileSync(
    "app/admin/ebay/opportunity-queue/research/smart-stocking-listing-intake-card.tsx",
    "utf8")
  assert.match(page, /SmartStockingListingIntakeCard/)
  assert.match(card, /ITEM3525 · Cake Turntable/)
  assert.match(card, /"Completar paquete"/)
  assert.match(card, /publicationAuthorized: false/)
  assert.doesNotMatch(card, /publishFinalListing|Publicar una sola vez/)
})
