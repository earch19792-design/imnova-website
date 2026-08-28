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
  buildWindowFilmListingIntakeV1,
  buildWindowFilmListingWorkspaceEvidenceV1,
  CAKE_TURNTABLE_LISTING_INTAKE_KEY,
  isSmartStockingListingIntakeV1,
  revalidateSmartStockingProductTruthV1,
  resolveSmartStockingListingIntakeAuthorityV1,
  WINDOW_FILM_LISTING_INTAKE_KEY,
  WINDOW_FILM_LISTING_INTAKE_TARGET_V1,
} = await import("./ebay-smart-stocking-listing-intake-v1.ts")
const { evaluateEbayListingWorkspaceEligibility } = await import(
  "./ebay-first-luna-opportunity-queue.ts")
const { buildSmartStockingLearningProfileV1 } = await import(
  "./ebay-smart-stocking-learning-profile-v1.ts")
const {
  buildSmartStockingAuthorizedPublicationV1,
  rebuildSmartStockingPackageSourceV1,
} = await import("./ebay-smart-stocking-authorized-publication-v1.ts")

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

function publicationContext(overrides = {}) {
  const actorUserId = "75c9d5d5-03d2-478e-8999-714ba84ee994"
  const accountKey = `imnova-ebay-us-primary:${"c".repeat(64)}`
  const evidence = workspaceEvidence()
  const opportunity = {
    ...currentProductTruthOpportunity(),
    id: "7dd33673-92d1-4be9-a2e2-4fc5675ad644",
  }
  const listingPackage = {
    id: "42b4e4b5-1a12-4021-9182-89b782a5c6ac",
    opportunity_id: opportunity.id,
    candidate_key: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
    created_by: actorUserId,
    account_key: accountKey,
    package_data: {
      pricing: {
        targetPrice: 25.99,
        supplierCost: 3.8,
        estimatedOutboundShipping: 9.99,
        estimatedEbayFees: 4.38,
        estimatedNetProfit: 5.48,
        estimatedNetMarginPercent: 21.1,
        estimatedRoiPercent: 144.33,
        passesProfitGate: true,
        evidenceBinding: { ...evidence },
      },
      categoryId: evidence.category.categoryId,
    },
    ...overrides.listingPackage,
  }
  return {
    accountKey,
    actorUserId,
    listingPackage,
    opportunity: { ...opportunity, ...overrides.opportunity },
    evidence,
    canonicalLunaUrl:
      "https://lunaportex.com/products/11-revolving-plastic-cake-turntable-stand-with-non-slip-base",
  }
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

test("durable Smart Stocking evidence creates one exact human-gated publication and StockGuard contract", () => {
  const result = buildSmartStockingAuthorizedPublicationV1(
    publicationContext(),
  )
  assert.equal(result.authorization.validated, true)
  assert.equal(result.authorization.finalHumanAuthorizationRequired, true)
  assert.equal(result.authorization.unattendedPublicationAllowed, false)
  assert.equal(result.authorization.entryPotentialScore, 57)
  assert.match(result.authorization.entrySnapshotHash, /^sha256:[0-9a-f]{64}$/)
  assert.match(result.authorization.authorizationDigest,
    /^sha256:[0-9a-f]{64}$/)
  assert.equal(result.economicsConfig.estimatedOutboundShipping, 9.99)
  assert.equal(result.publishWithStockguardContract.publishAllowed, true)
  assert.equal(result.publishWithStockguardContract.attachmentIntent
    .components[0].safeCapacity, null)
})

test("Smart Stocking publication fails closed on price, decision, Product Truth, or exact package drift", () => {
  const price = publicationContext()
  price.listingPackage.package_data.pricing.targetPrice = 24.99
  assert.throws(() => buildSmartStockingAuthorizedPublicationV1(price),
    /SMART_STOCKING_PUBLICATION_EVIDENCE_MISMATCH/)

  const decision = publicationContext()
  decision.listingPackage.package_data.pricing.evidenceBinding
    .decisionSnapshotHash = `sha256:${"e".repeat(64)}`
  assert.throws(() => buildSmartStockingAuthorizedPublicationV1(decision),
    /SMART_STOCKING_PUBLICATION_EVIDENCE_MISMATCH/)

  const brand = publicationContext()
  brand.opportunity.assessment.productTruth.brand.ebayBrandSemantics =
    "BRANDED"
  assert.throws(() => buildSmartStockingAuthorizedPublicationV1(brand),
    /SMART_STOCKING_PUBLICATION_EVIDENCE_MISMATCH/)

  const actor = publicationContext({ listingPackage: {
    created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  } })
  assert.throws(() => buildSmartStockingAuthorizedPublicationV1(actor),
    /SMART_STOCKING_PUBLICATION_EVIDENCE_MISMATCH/)
})

test("authorized publication migration reuses the one-shot ledger and canonical durable image gate", () => {
  const migration = readFileSync(
    "supabase/migrations/20260827235910_align_smart_stocking_authorized_publication_v1.sql",
    "utf8",
  )
  assert.match(migration,
    /is_ebay_smart_stocking_authorized_publication_v1/)
  assert.match(migration,
    /assert_ebay_smart_stocking_canonical_images_v1/)
  assert.match(migration, /jsonb_array_length\(v_images\) < 1/)
  assert.match(migration, /finalHumanAuthorizationRequired/)
  assert.match(migration, /unattendedPublicationAllowed/)
  assert.match(migration, /PUBLISH_WITH_STOCKGUARD_CONTRACT_V1|StockGuard/i)
  assert.doesNotMatch(migration, /\b(?:drop table|truncate table)\b/i)
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

test("fresh Luna revalidation preserves proven Unbranded authority and keeps null quantity non-OOS", () => {
  const refreshed = revalidateSmartStockingProductTruthV1({
    refreshedRow: build(),
    durableProductTruth: currentProductTruth(),
  })
  assert.equal(refreshed.supplier_inventory_quantity, null)
  assert.equal(refreshed.assessment.candidate.inventoryQuantity, null)
  assert.equal(refreshed.assessment.productTruth.stock.supplierStatedQuantity,
    null)
  assert.equal(refreshed.assessment.productTruth.stock.state,
    "IN_STOCK_SUPPLIER_STATED")
  assert.equal(refreshed.assessment.productTruth.stock.freshness, "FRESH")
  assert.equal(refreshed.assessment.productTruth.brand
    .noManufacturerBrandClaim, "PROVEN")
  assert.equal(refreshed.assessment.productTruth.brand
    .ebayBrandSemantics, "UNBRANDED_SUPPORTED")
  assert.equal(refreshed.assessment.productTruth.brand.taxonomyBrandValue,
    "Unbranded")
  assert.match(refreshed.assessment.productTruth.evidenceDigest,
    /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(refreshed.assessment.productTruth.evidenceDigest,
    CURRENT_PRODUCT_TRUTH_DIGEST)

  const evidence = workspaceEvidence({
    opportunity: { supplier_inventory_quantity: null },
    candidate: { inventoryQuantity: null },
    productTruth: { stock: { supplierStatedQuantity: null } },
  })
  assert.equal(evidence.stock.quantity, null)
  assert.equal(evidence.stock.state, "IN_STOCK_SUPPLIER_STATED")
})

test("fresh Product Truth revalidation fails closed on lineage or brand mismatch", () => {
  assert.throws(() => revalidateSmartStockingProductTruthV1({
    refreshedRow: build(),
    durableProductTruth: currentProductTruth({
      top: { lunaVariantId: "48809646653665" },
    }),
  }), /SMART_STOCKING_PRODUCT_TRUTH_REVALIDATION_MISMATCH/)
  assert.throws(() => revalidateSmartStockingProductTruthV1({
    refreshedRow: build(),
    durableProductTruth: currentProductTruth({
      brand: { supplierImageBrandConflictFound: true },
    }),
  }), /SMART_STOCKING_PRODUCT_TRUTH_REVALIDATION_MISMATCH/)
})

test("Luna materialization reuses only exact durable package Product Truth lineage", () => {
  const authority = readFileSync(
    "lib/ebay/ebay-smart-stocking-listing-intake-v1.ts",
    "utf8",
  )
  const readStart = authority.indexOf(
    "async function readExactDurableProductTruthForRefreshV1",
  )
  const readEnd = authority.indexOf(
    "export async function materializeCakeTurntableListingIntakeV1",
    readStart,
  )
  const exactRead = authority.slice(readStart, readEnd)
  assert.match(exactRead, /\.eq\("account_key", input\.accountKey\)/)
  assert.match(exactRead,
    /\.eq\("opportunity_id", existing\.data\.id\)/)
  assert.match(exactRead, /\.eq\("candidate_key", input\.candidateKey\)/)
  assert.match(exactRead,
    /evidenceSnapshot\)\.assessment[\s\S]*\.productTruth/)
  assert.doesNotMatch(exactRead, /title|ebay_sku|supplier title/i)
  assert.match(authority,
    /revalidateSmartStockingProductTruthV1\([\s\S]*durableProductTruth/)
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

function windowProfile() {
  return buildSmartStockingLearningProfileV1({
    scoreBreakdown: {
      marketDemandScore: 10, economicsPotentialScore: 15,
      merchandisingScore: 12, lunaAdvantageScore: 10,
      operationalSimplicityScore: 3, portfolioDiversificationScore: 3,
      evidenceQualityScore: 4,
    },
    riskPenalty: 2,
    whyPrioritized: ["Low-cost exact Luna identity and supported niche demand."],
    knownUncertainties: ["No canonical exact Sold comparable."],
    entrySnapshotOrigin: "BACKFILLED_FROM_EXISTING_PRELAUNCH_EVIDENCE",
    decisionSnapshot: {
      launchPotentialScore: 55,
      launchTier: "PARK",
      evidenceProfile: ["ENTRY_ONLY_BEFORE_DURABLE_FRONTIER"],
      finalEconomics: {
        status: "NOT_RUN", salePriceUsd: null, ebayFeesUsd: null,
        lunaProductCostUsd: null, lunaShippingUsd: null, landedCostUsd: null,
        contributionProfitUsd: null, contributionMarginPercent: null,
        roiPercent: null, thresholdResult: "UNAVAILABLE",
      },
      rescueUsed: false, rescueType: null,
      whyPublishedOrParked: "Awaiting first commercial gate at entry time.",
      parkReason: "PENDING_FIRST_COMMERCIAL_GATE",
      reopenCondition: "Durable Product Fit, shipping and economics.",
    },
  })
}

function windowDecisionPackage() {
  return {
    packageId: WINDOW_FILM_LISTING_INTAKE_TARGET_V1.decisionPackageId,
    status: "GENERATED",
    package: {
      supplierSku: "ITEM3404",
      supplierVariantId: "48809648488672",
      productIdentity: { identity: { gtin: "740145348659" } },
    },
    smartStockingLearningProfile: windowProfile(),
  }
}

function windowFrontiers(overrides = {}) {
  return { frontiers: [{
    frontierId: `profitability-frontier-v1:sha256:${"a".repeat(64)}`,
    snapshotDigest: `sha256:${"b".repeat(64)}`,
    economicPolicyReference: "SERVER_CANONICAL_EBAY_UNIT_ECONOMICS_V1",
    economicPolicyDigest: `sha256:${"e".repeat(64)}`,
    provisionalFastLaneEconomics: true,
    phase6CanonicalAuthority: false,
    frontier: {
      contractVersion: "SELLER_OS_PROFITABILITY_FRONTIER_V1",
      frontierDigest: `sha256:${"c".repeat(64)}`,
      lunaProductId: "9220837146848",
      lunaVariantId: "48809648488672",
      lunaSku: "ITEM3404",
      productFit: "STRONG",
      familyDemandStatus: "FAMILY_DEMAND_SUPPORTED",
      lunaUnitCost: 5,
      marketPriceMedian: 24.99,
      shippingStatus: "SHIPPING_DURABLY_PERSISTED",
      shippingValue: 6.99,
      ebayFeeEstimateAtMedian: 4.22,
      contributionProfitAtMarketMedian: 6.53,
      contributionMarginAtMarketMedian: 26.12,
      economicClassification: "ECONOMICALLY_PROMISING",
      nextBestEvidence: "NONE",
      shippingCaptureEvidence: {
        lunaProductId: "9220837146848",
        lunaVariantId: "48809648488672",
        supplierSku: "ITEM3404",
        subtotalUsd: 5,
        shippingUsd: 6.99,
        canonicalDestinationAuthority:
          "OPERATOR_BOUND_CANONICAL_US_DESTINATION_V1",
        canonicalDestinationCountryClass: "US",
        canonicalDestinationFingerprint: `sha256:${"d".repeat(64)}`,
        canonicalDestinationMatch: true,
        selectedShippingStateProof: "SINGLE_CANONICAL_RATE",
        noPurchase: true,
      },
      ...overrides,
    },
  }] }
}

function windowProduct(overrides = {}) {
  return {
    productId: "9220837146848",
    handle: "window-privacy-film",
    title: "Window Privacy Film 23.6 inch X 9.84 feet",
    vendor: null,
    productType: null,
    canonicalUrl: "https://lunaportex.com/products/window-privacy-film",
    imageUrls: Array.from({ length: 4 }, (_, index) =>
      `https://cdn.shopify.com/s/files/window-${index + 1}.webp`),
    variants: [{
      id: "48809648488672", title: "Default Title", sku: "ITEM3404",
      sourceUnitBarcode: "740145348659", sourceUnitPrice: 5,
      sourceCompareAtPrice: null, available: true, weight: 113,
      weightUnit: "g",
    }],
    ...overrides,
  }
}

function windowBuild() {
  return buildWindowFilmListingIntakeV1({
    decisionPackage: windowDecisionPackage(),
    lunaProduct: windowProduct(),
    marketRadarProductId: "33333333-3333-4333-8333-333333333333",
    profitabilityFrontiers: windowFrontiers(),
    observedAt: "2026-08-28T03:00:00.000Z",
  })
}

function windowPublicationContext(overrides = {}) {
  const actorUserId = "75c9d5d5-03d2-478e-8999-714ba84ee994"
  const accountKey = `imnova-ebay-us-primary:${"c".repeat(64)}`
  const opportunity = {
    ...windowBuild(),
    id: "0281c5dc-669c-4de0-a94d-a8c7e7621c2a",
    ...overrides.opportunity,
  }
  const evidence = buildWindowFilmListingWorkspaceEvidenceV1({
    decisionPackage: windowDecisionPackage(),
    opportunity,
    profitabilityFrontiers: windowFrontiers(),
  })
  const listingPackage = {
    id: "3a394c94-108b-4ca0-b373-5e589dc4a652",
    opportunity_id: opportunity.id,
    candidate_key: WINDOW_FILM_LISTING_INTAKE_KEY,
    created_by: actorUserId,
    account_key: accountKey,
    package_data: {
      categoryId: "175757",
      pricing: {
        targetPrice: 24.99,
        supplierCost: 5,
        estimatedOutboundShipping: 6.99,
        estimatedEbayFees: 4.22,
        estimatedNetProfit: 6.53,
        estimatedNetMarginPercent: 26.12,
        estimatedRoiPercent: 130.55,
        passesProfitGate: true,
        evidenceBinding: { ...evidence },
      },
    },
    ...overrides.listingPackage,
  }
  return {
    accountKey,
    actorUserId,
    listingPackage,
    opportunity,
    evidence,
    canonicalLunaUrl:
      "https://lunaportex.com/products/window-privacy-film",
  }
}

test("ITEM3404 materializes its own exact candidate and Window Film package seed", () => {
  const row = windowBuild()
  assert.equal(row.candidate_key, WINDOW_FILM_LISTING_INTAKE_KEY)
  assert.equal(row.supplier_sku, "ITEM3404")
  assert.equal(row.gtin, "740145348659")
  assert.equal(row.decision, "LISTING_READY")
  assert.equal(row.assessment.listingIntelligencePackage
    .categoryRecommendation.categoryId, "175757")
  assert.equal(row.assessment.market.familyDemandStatus,
    "FAMILY_DEMAND_SUPPORTED")
  assert.equal(row.assessment.safety.exactSoldClaimed, false)
  assert.equal(isSmartStockingListingIntakeV1(row.assessment), true)
  assert.equal(evaluateEbayListingWorkspaceEligibility(row).allowed, true)
})

test("current durable Frontier passes without the retired scenario projection", () => {
  const authority = resolveSmartStockingListingIntakeAuthorityV1({
    decisionPackage: windowDecisionPackage(),
    profitabilityFrontiers: windowFrontiers(),
    target: WINDOW_FILM_LISTING_INTAKE_TARGET_V1,
  })
  assert.equal(authority.frontier.economicClassification,
    "ECONOMICALLY_PROMISING")
  assert.equal(authority.frontier.nextBestEvidence, "NONE")
  assert.equal(authority.frontier.scenarios, undefined)
})

test("null retired scenario projection defers to exact canonical economics", () => {
  const authority = resolveSmartStockingListingIntakeAuthorityV1({
    decisionPackage: windowDecisionPackage(),
    profitabilityFrontiers: windowFrontiers({
      scenarios: { median: { passesTargetPolicy: null } },
    }),
    target: WINDOW_FILM_LISTING_INTAKE_TARGET_V1,
  })
  assert.equal(authority.frontier.economicClassification,
    "ECONOMICALLY_PROMISING")
})

test("explicit legacy policy failure remains fail closed", () => {
  assert.throws(() => resolveSmartStockingListingIntakeAuthorityV1({
    decisionPackage: windowDecisionPackage(),
    profitabilityFrontiers: windowFrontiers({
      scenarios: { median: { passesTargetPolicy: false } },
    }),
    target: WINDOW_FILM_LISTING_INTAKE_TARGET_V1,
  }), /WINDOW_FILM_LISTING_INTAKE_AUTHORITY_MISMATCH/)
})

test("second same-family candidate uses shared authority without SKU-specific code", () => {
  const target = {
    ...WINDOW_FILM_LISTING_INTAKE_TARGET_V1,
    decisionPackageId: "66666666-6666-4666-8666-666666666666",
    candidateKey: "smart-stocking:EBAY_US:9000000000001:9000000000002",
    lunaProductId: "9000000000001",
    lunaVariantId: "9000000000002",
    lunaSku: "WINDOW-FILM-SECOND",
    gtin: "740145348666",
  }
  const decisionPackage = {
    ...windowDecisionPackage(),
    packageId: target.decisionPackageId,
    package: {
      ...windowDecisionPackage().package,
      supplierSku: target.lunaSku,
      supplierVariantId: target.lunaVariantId,
      productIdentity: { identity: { gtin: target.gtin } },
    },
  }
  const source = windowFrontiers().frontiers[0]
  const profitabilityFrontiers = { frontiers: [{
    ...source,
    frontier: {
      ...source.frontier,
      lunaProductId: target.lunaProductId,
      lunaVariantId: target.lunaVariantId,
      lunaSku: target.lunaSku,
      shippingCaptureEvidence: {
        ...source.frontier.shippingCaptureEvidence,
        lunaProductId: target.lunaProductId,
        lunaVariantId: target.lunaVariantId,
        supplierSku: target.lunaSku,
      },
    },
  }] }
  const authority = resolveSmartStockingListingIntakeAuthorityV1({
    decisionPackage, profitabilityFrontiers, target,
  })
  assert.equal(authority.target.candidateKey, target.candidateKey)
  assert.equal(authority.frontier.lunaSku, target.lunaSku)
  assert.equal(authority.shipping.supplierSku, target.lunaSku)
})

test("ITEM3404 workspace evidence binds only its own durable Frontier", () => {
  const row = windowBuild()
  const evidence = buildWindowFilmListingWorkspaceEvidenceV1({
    decisionPackage: windowDecisionPackage(),
    opportunity: row,
    profitabilityFrontiers: windowFrontiers(),
  })
  assert.equal(evidence.authorityClass,
    "SELLER_OS_ITEM3404_FINAL_WORKSPACE_EVIDENCE_V1")
  assert.equal(evidence.category.categoryId, "175757")
  assert.equal(evidence.salePriceUsd, 24.99)
  assert.equal(evidence.supplierShippingUsd, 6.99)
  assert.equal(evidence.stock.quantity, null)
  assert.equal(evidence.productTruth.taxonomyBrandValue, null)
  assert.throws(() => buildWindowFilmListingWorkspaceEvidenceV1({
    decisionPackage: windowDecisionPackage(),
    opportunity: { ...row, candidate_key: CAKE_TURNTABLE_LISTING_INTAKE_KEY },
    profitabilityFrontiers: windowFrontiers(),
  }), /WINDOW_FILM_WORKSPACE_EVIDENCE_MISMATCH/)
})

test("ITEM3404 reuses the shared controlled publication and StockGuard authority", () => {
  const result = buildSmartStockingAuthorizedPublicationV1(
    windowPublicationContext(),
  )
  assert.equal(result.authorization.candidateKey,
    WINDOW_FILM_LISTING_INTAKE_KEY)
  assert.equal(result.authorization.workspaceEvidenceAuthorityClass,
    "SELLER_OS_ITEM3404_FINAL_WORKSPACE_EVIDENCE_V1")
  assert.equal(result.authorization.lunaProductId, "9220837146848")
  assert.equal(result.authorization.lunaVariantId, "48809648488672")
  assert.equal(result.authorization.supplierSku, "ITEM3404")
  assert.equal(result.authorization.gtin, "740145348659")
  assert.equal(result.authorization.supplierInventoryQuantity, null)
  assert.equal(result.authorization.safeCapacity, null)
  assert.equal(result.economicsConfig.estimatedOutboundShipping, 6.99)
  assert.equal(result.publishWithStockguardContract.publishAllowed, true)
})

test("ITEM3404 rebuilds package freshness only from its durable authorities", () => {
  const context = windowPublicationContext()
  const rebuilt = rebuildSmartStockingPackageSourceV1({
    listingPackage: context.listingPackage,
    evidence: context.evidence,
  })
  assert.strictEqual(rebuilt.packageData.pricing.evidenceBinding,
    context.evidence)
  assert.equal(rebuilt.sourceObservedAt, context.evidence.stock.observedAt)
  assert.equal(rebuilt.packageData.sourceRefresh.strategy,
    "SMART_STOCKING_DURABLE_AUTHORITY_REVALIDATION_BEFORE_APPROVAL_V1")
  assert.equal(rebuilt.marketplaceWrites, 0)
  assert.throws(() => rebuildSmartStockingPackageSourceV1({
    listingPackage: {
      ...context.listingPackage,
      package_data: {
        ...context.listingPackage.package_data,
        pricing: {
          ...context.listingPackage.package_data.pricing,
          supplierCost: 4.99,
        },
      },
    },
    evidence: context.evidence,
  }), /SMART_STOCKING_PACKAGE_SOURCE_REVALIDATION_FAILED/)
})

test("shared Smart Stocking publication rejects foreign candidate and stale package bindings", () => {
  assert.throws(() => buildSmartStockingAuthorizedPublicationV1(
    windowPublicationContext({ listingPackage: {
      candidate_key: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
    } }),
  ), /SMART_STOCKING_PUBLICATION_EVIDENCE_MISMATCH/)

  const stale = windowPublicationContext()
  stale.listingPackage.package_data.pricing.evidenceBinding.frontierDigest =
    `sha256:${"9".repeat(64)}`
  assert.throws(() => buildSmartStockingAuthorizedPublicationV1(stale),
    /SMART_STOCKING_PUBLICATION_EVIDENCE_MISMATCH/)
})

test("controlled publication composition is candidate-generic and keeps the existing ledger", () => {
  const route = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts", "utf8")
  const authority = readFileSync(
    "lib/ebay/ebay-smart-stocking-authorized-publication-v1.ts", "utf8")
  const migration = readFileSync(
    "supabase/migrations/20260828090000_generalize_smart_stocking_authorized_publication_v1.sql",
    "utf8",
  )
  assert.match(route, /isSmartStockingListingIntakeV1/)
  assert.doesNotMatch(route, /isCakeTurntableListingIntakeV1/)
  assert.match(authority, /resolveSmartStockingListingWorkspaceEvidenceV1/)
  assert.doesNotMatch(authority,
    /9220835475680|48809646653664|ITEM3525|740119084743/)
  assert.match(migration, /seller_os_profitability_frontier_snapshots/)
  assert.match(migration, /workspaceEvidenceAuthorityClass/)
  assert.match(migration, /finalHumanAuthorizationRequired/)
  assert.match(migration, /unattendedPublicationAllowed/)
  assert.doesNotMatch(migration, /ITEM3404|ITEM3525/)
  assert.doesNotMatch(migration, /\b(?:create table|drop table|truncate table)\b/i)
})

test("ITEM3404 fails closed on foreign category economics or product identity", () => {
  assert.throws(() => buildWindowFilmListingIntakeV1({
    decisionPackage: windowDecisionPackage(),
    lunaProduct: windowProduct({ productId: "9220835475680" }),
    marketRadarProductId: "33333333-3333-4333-8333-333333333333",
    profitabilityFrontiers: windowFrontiers(),
    observedAt: "2026-08-28T03:00:00.000Z",
  }), /WINDOW_FILM_LISTING_INTAKE_PRODUCT_TRUTH_MISMATCH/)
  assert.throws(() => buildWindowFilmListingIntakeV1({
    decisionPackage: windowDecisionPackage(),
    lunaProduct: windowProduct(),
    marketRadarProductId: "33333333-3333-4333-8333-333333333333",
    profitabilityFrontiers: windowFrontiers({ lunaSku: "ITEM3525" }),
    observedAt: "2026-08-28T03:00:00.000Z",
  }), /WINDOW_FILM_LISTING_INTAKE_AUTHORITY_MISMATCH/)
})

test("canonical Opportunities exposes exact ITEM3404 and ITEM3525 actions", () => {
  const page = readFileSync(
    "app/admin/ebay/opportunity-queue/research/page.tsx", "utf8")
  const card = readFileSync(
    "app/admin/ebay/opportunity-queue/research/smart-stocking-listing-intake-card.tsx",
    "utf8")
  assert.match(page, /SmartStockingListingIntakeCard/)
  assert.match(card, /ITEM3404/)
  assert.match(card, /9220837146848:48809648488672/)
  assert.match(card, /ITEM3525/)
  assert.match(card, /Cake Turntable/)
  assert.match(card, /"Completar paquete"/)
  assert.match(card, /publicationAuthorized: false/)
  assert.doesNotMatch(card, /publishFinalListing|Publicar una sola vez/)
})

test("listing workspace replaces provisional economics and labels supplier shipping safely", () => {
  const route = readFileSync(
    "app/api/admin/ebay/command-center/route.ts", "utf8")
  const workspace = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx", "utf8")
  assert.match(route, /resolveSmartStockingListingWorkspaceEvidenceV1/)
  assert.match(route,
    /SELLER_OS_SMART_STOCKING_FINAL_ECONOMICS_DURABLE_READBACK_V1/)
  assert.match(route, /estimatedOutboundShipping: evidence\.supplierShippingUsd/)
  assert.match(route, /estimatedRoiPercent: evidence\.roiPercent/)
  assert.match(route, /SMART_STOCKING_FINAL_PRICE_25_99_REQUIRED/)
  assert.match(workspace, /Disponible · cantidad no probada/)
  assert.match(workspace, /Envío Luna · economía/)
  assert.match(workspace,
    /money\(form\.pricing\.estimatedOutboundShipping\)/)
  assert.doesNotMatch(workspace,
    /El envío Luna de \$9\.99 es un costo proveedor certificado/)
  assert.match(workspace, /No configura ni implica automáticamente el envío/)
})
