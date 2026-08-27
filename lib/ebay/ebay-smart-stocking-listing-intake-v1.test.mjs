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
  buildCakeTurntableListingWorkspaceEvidenceV1,
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

const CURRENT_PRODUCT_TRUTH_DIGEST =
  "sha256:266621d0219ae76492371a7152341826c7327910e378f41c978a0f624286f05e"
const CURRENT_PRODUCT_TRUTH_OBSERVED_AT = "2026-08-27T20:08:12.707Z"

function currentProductTruth(overrides = {}) {
  return {
    authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
    evidenceDigest: CURRENT_PRODUCT_TRUTH_DIGEST,
    candidateKey: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
    lunaProductId: "9220835475680",
    lunaVariantId: "48809646653664",
    supplierSku: "ITEM3525",
    gtin: "740119084743",
    supplierPriceUsd: 3.8,
    rawHtmlStored: false,
    marketplaceWrites: 0,
    stock: {
      state: "IN_STOCK_SUPPLIER_STATED",
      freshness: "FRESH",
      observedAt: CURRENT_PRODUCT_TRUTH_OBSERVED_AT,
      safeCapacity: null,
      safeCapacityStatus: "UNPROVEN_NOT_INFERRED",
      exactIdentityVerified: true,
      supplierStatedQuantity: 92,
      ...overrides.stock,
    },
    brand: {
      noManufacturerBrandClaim: "PROVEN",
      ebayBrandSemantics: "UNBRANDED_SUPPORTED",
      taxonomyBrandValue: "Unbranded",
      brandMetadataPresent: false,
      manufacturerMetadataPresent: false,
      visibleManufacturerBrandingPresent: false,
      supplierImageBrandConflictFound: false,
      ...overrides.brand,
    },
    ...overrides.top,
  }
}

function currentProductTruthOpportunity(overrides = {}) {
  const row = build()
  return {
    ...row,
    supplier_inventory_quantity: 92,
    supplier_snapshot_at: CURRENT_PRODUCT_TRUTH_OBSERVED_AT,
    assessment: {
      ...row.assessment,
      candidate: {
        ...row.assessment.candidate,
        inventoryQuantity: 92,
        stockCapturedAt: CURRENT_PRODUCT_TRUTH_OBSERVED_AT,
        ...overrides.candidate,
      },
      productTruth: currentProductTruth(overrides.productTruth),
    },
    ...overrides.opportunity,
  }
}

function workspaceEvidence(overrides = {}) {
  const row = currentProductTruthOpportunity(overrides)
  const shippingEvidence = {
    lunaProductId: "9220835475680",
    lunaVariantId: "48809646653664",
    supplierSku: "ITEM3525",
    shippingUsd: 9.99,
    canonicalDestinationAuthority:
      "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
    canonicalDestinationCountryClass: "US",
    canonicalDestinationFingerprint: `sha256:${"c".repeat(64)}`,
    canonicalDestinationMatch: true,
    selectedShippingStateProof: "SINGLE_CANONICAL_RATE",
    noPurchase: true,
    ...overrides.shippingEvidence,
  }
  return buildCakeTurntableListingWorkspaceEvidenceV1({
    decisionPackage: decisionPackage(overrides.decisionPackage),
    opportunity: { ...row, ...overrides.opportunity },
    profitabilityFrontiers: { frontiers: [{
      frontierId: `profitability-frontier-v1:sha256:${"a".repeat(64)}`,
      snapshotDigest: `sha256:${"b".repeat(64)}`,
      frontier: {
        lunaProductId: "9220835475680",
        lunaVariantId: "48809646653664",
        lunaSku: "ITEM3525",
        frontierDigest: `sha256:${"d".repeat(64)}`,
        shippingStatus: "SHIPPING_DURABLY_PERSISTED",
        shippingValue: 9.99,
        shippingCaptureEvidence: shippingEvidence,
        ...overrides.frontier,
      },
    }] },
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

test("workspace binds final decision, durable shipping and exact stock without inventing capacity", () => {
  const evidence = workspaceEvidence()
  assert.equal(evidence.salePriceUsd, 25.99)
  assert.equal(evidence.supplierShippingUsd, 9.99)
  assert.equal(evidence.estimatedEbayFeesUsd, 4.38)
  assert.equal(evidence.contributionProfitUsd, 5.48)
  assert.equal(evidence.contributionMarginPercent, 21.1)
  assert.equal(evidence.roiPercent, 144.33)
  assert.equal(evidence.shipping.canonicalDestinationMatch, true)
  assert.equal(evidence.shipping.buyerFacingShipping, false)
  assert.equal(evidence.stock.state, "IN_STOCK_SUPPLIER_STATED")
  assert.equal(evidence.stock.quantity, 92)
  assert.equal(evidence.stock.safeCapacity, null)
  assert.equal(evidence.productTruth.evidenceDigest,
    CURRENT_PRODUCT_TRUTH_DIGEST)
  assert.equal(evidence.productTruth.taxonomyBrandValue, "Unbranded")
  assert.equal(evidence.category.categoryId, "183335")
})

test("workspace fails closed on provisional shipping, destination mismatch or stock drift", () => {
  assert.throws(() => workspaceEvidence({ frontier: {
    shippingStatus: "SHIPPING_PROVISIONAL_RESERVE",
  } }), /CAKE_TURNTABLE_WORKSPACE_EVIDENCE_MISMATCH/)
  assert.throws(() => workspaceEvidence({ shippingEvidence: {
    canonicalDestinationMatch: false,
  } }), /CAKE_TURNTABLE_WORKSPACE_EVIDENCE_MISMATCH/)
  assert.throws(() => workspaceEvidence({ opportunity: {
    supplier_available: false,
  } }), /CAKE_TURNTABLE_WORKSPACE_EVIDENCE_MISMATCH/)
})

test("legitimate Product Truth enrichment rebinds current workspace evidence without rewriting launch history", () => {
  const evidence = workspaceEvidence()
  const immutableProfile = profile()
  assert.equal(evidence.stock.quantity, 92)
  assert.equal(evidence.stock.observedAt, CURRENT_PRODUCT_TRUTH_OBSERVED_AT)
  assert.equal(evidence.productTruth.evidenceDigest,
    CURRENT_PRODUCT_TRUTH_DIGEST)
  assert.equal(evidence.entryPotentialScore, 57)
  assert.equal(evidence.decisionSnapshotHash,
    immutableProfile.decisionSnapshotHash)
  assert.equal(evidence.salePriceUsd, 25.99)
  assert.equal(evidence.supplierShippingUsd, 9.99)
})

test("conflicting Product Truth identity, quantity, or brand remains fail closed", () => {
  assert.throws(() => workspaceEvidence({ productTruth: { top: {
    lunaVariantId: "48809646653665",
  } } }), /CAKE_TURNTABLE_WORKSPACE_EVIDENCE_MISMATCH/)
  assert.throws(() => workspaceEvidence({ opportunity: {
    supplier_inventory_quantity: 91,
  } }), /CAKE_TURNTABLE_WORKSPACE_EVIDENCE_MISMATCH/)
  assert.throws(() => workspaceEvidence({ productTruth: { brand: {
    ebayBrandSemantics: "BRANDED",
  } } }), /CAKE_TURNTABLE_WORKSPACE_EVIDENCE_MISMATCH/)
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

test("listing workspace replaces provisional economics and labels supplier shipping safely", () => {
  const route = readFileSync(
    "app/api/admin/ebay/command-center/route.ts", "utf8")
  const workspace = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx", "utf8")
  assert.match(route, /resolveCakeTurntableListingWorkspaceEvidenceV1/)
  assert.match(route,
    /SELLER_OS_SMART_STOCKING_FINAL_ECONOMICS_DURABLE_READBACK_V1/)
  assert.match(route, /estimatedOutboundShipping: evidence\.supplierShippingUsd/)
  assert.match(route, /estimatedRoiPercent: evidence\.roiPercent/)
  assert.match(route, /SMART_STOCKING_FINAL_PRICE_25_99_REQUIRED/)
  assert.match(workspace, /Disponible · cantidad no probada/)
  assert.match(workspace, /Envío Luna · economía/)
  assert.match(workspace, /No configura ni implica automáticamente el envío/)
})
