import type { SupabaseClient } from "@supabase/supabase-js"

import {
  CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1,
} from "./ebay-smart-stocking-frontier-handoff-v1"
import {
  fetchPublicLunaProductForActiveListingMonitor,
} from "./ebay-targeted-active-listing-luna-monitor"
import type { DirectedLunaProduct } from "./ebay-luna-directed-product-import"
import {
  readWinnerEvidenceDecisionPackage,
} from "./ebay-winner-evidence-v2-service"

export const SMART_STOCKING_LISTING_INTAKE_VERSION =
  "SELLER_OS_SMART_STOCKING_LISTING_INTAKE_V1" as const

export const CAKE_TURNTABLE_LISTING_INTAKE_KEY =
  "smart-stocking:EBAY_US:9220835475680:48809646653664" as const

const LISTING_TITLE =
  "11 in Revolving Plastic Cake Turntable Non-Slip Base Decorating Stand"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function isSmartStockingListingIntakeV1(value: unknown) {
  const marker = record(record(value).smartStockingListingIntakeV1)
  return marker.contractVersion === SMART_STOCKING_LISTING_INTAKE_VERSION &&
    marker.decisionPackageId ===
      CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1.packageId &&
    marker.finalDecision === "LISTING_READY" &&
    marker.finalPriceUsd === 25.99 &&
    marker.finalEconomicsStatus === "PASS" &&
    marker.entryPotentialScore === 57 &&
    marker.exactIdentityVerified === true &&
    marker.currentSupplierAvailabilityVerified === true
}

export function buildCakeTurntableListingIntakeV1(input: Readonly<{
  decisionPackage: Awaited<ReturnType<typeof readWinnerEvidenceDecisionPackage>>
  lunaProduct: DirectedLunaProduct
  marketRadarProductId: string
  observedAt: string
}>) {
  const target = CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1
  const profile = input.decisionPackage.smartStockingLearningProfile
  const identity = input.decisionPackage.package.productIdentity.identity
  const variant = input.lunaProduct.variants.find((entry) =>
    entry.id === target.lunaVariantId && entry.sku === target.lunaSku)
  if (
    input.decisionPackage.packageId !== target.packageId ||
    input.decisionPackage.status !== "GENERATED" ||
    !profile ||
    profile.entrySnapshot.entryPotentialScore !== 57 ||
    profile.decisionSnapshot.launchTier !== "CONTROLLED_MERCHANDISING_BET" ||
    profile.decisionSnapshot.parkReason !== null ||
    profile.decisionSnapshot.finalEconomics.status !== "PASS" ||
    profile.decisionSnapshot.finalEconomics.thresholdResult !== "PASS" ||
    profile.decisionSnapshot.finalEconomics.salePriceUsd !== 25.99 ||
    profile.decisionSnapshot.finalEconomics.lunaProductCostUsd !== 3.8 ||
    profile.decisionSnapshot.finalEconomics.lunaShippingUsd !== 9.99 ||
    identity.gtin !== target.gtin ||
    input.lunaProduct.productId !== target.lunaProductId ||
    !variant || variant.sourceUnitBarcode !== target.gtin ||
    variant.sourceUnitPrice !== target.unitCostUsd ||
    variant.available !== true ||
    input.lunaProduct.imageUrls.length < 1 ||
    !Number.isFinite(Date.parse(input.observedAt)) ||
    !/^[0-9a-f-]{36}$/i.test(input.marketRadarProductId)
  ) throw new Error("CAKE_TURNTABLE_LISTING_INTAKE_AUTHORITY_MISMATCH")

  const decision = profile.decisionSnapshot
  const economics = decision.finalEconomics
  const assessment = {
    contractVersion: SMART_STOCKING_LISTING_INTAKE_VERSION,
    smartStockingListingIntakeV1: {
      contractVersion: SMART_STOCKING_LISTING_INTAKE_VERSION,
      decisionPackageId: target.packageId,
      finalDecision: "LISTING_READY",
      finalPriceUsd: 25.99,
      finalEconomicsStatus: "PASS",
      entryPotentialScore: 57,
      exactIdentityVerified: true,
      currentSupplierAvailabilityVerified: true,
      safeCapacity: null,
    },
    candidate: {
      candidateKey: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
      marketRadarProductId: input.marketRadarProductId,
      supplierProductId: target.lunaProductId,
      supplierVariantId: target.lunaVariantId,
      sku: target.lunaSku,
      title: input.lunaProduct.title,
      variantTitle: variant.title,
      gtin: target.gtin,
      supplierCost: target.unitCostUsd,
      available: true,
      inventoryQuantity: null,
      stockCapturedAt: new Date(input.observedAt).toISOString(),
      weight: variant.weight,
      weightUnit: variant.weightUnit,
      dimensions: null,
      imageUrls: [...new Set(input.lunaProduct.imageUrls)],
      description:
        "Single 11-inch revolving plastic cake turntable with a non-slip base for cake decorating. Supplier brand is not specified.",
    },
    identity: { exactIdentityConfirmed: true, comparables: [] },
    economics: {
      ready: true,
      estimatedNetProfit: economics.contributionProfitUsd,
      estimatedNetMarginPercent: economics.contributionMarginPercent,
      estimatedRoiPercent: economics.roiPercent,
      authoritativeSupplierShippingUsd: economics.lunaShippingUsd,
    },
    market: {
      candidateListingsFound: 5,
      activeExactComparables: 0,
      soldExactCount: 0,
      executedQuery: "11 inch revolving plastic cake turntable non-slip base",
      evidenceSemantics: "ACTIVE_ASK_CONTEXT_NOT_SOLD_AUTHORITY",
    },
    scores: {
      opportunityScore: decision.launchPotentialScore,
      potentialScore: decision.launchPotentialScore,
      confidenceScore: 90,
      urgencyScore: 90,
      demandScore: 35,
      economicsScore: 82,
      identityScore: 100,
      competitionScore: 30,
      supplyScore: 80,
      listingReadinessScore: 85,
      sellerPriorityScore: decision.launchPotentialScore,
    },
    listingIntelligencePackage: {
      recommendedTitle: LISTING_TITLE,
      titleStrategy: {
        titleFormula: LISTING_TITLE,
        primarySearchPhrase: "11 inch revolving cake turntable",
        secondarySearchTerms: ["cake decorating", "plastic", "non-slip base"],
        confirmedAttributes: ["11 inch", "revolving", "plastic", "non-slip base"],
        strategyConfidence: "PRODUCT_TRUTH_SUPPORTED",
      },
      categoryRecommendation: {
        // Current official eBay US leaf for Icing Turntables. The historical
        // research-task category remains evidence provenance, not publication
        // taxonomy authority.
        categoryId: "183335",
        categoryName: "Icing & Decorating Turntables",
      },
      itemSpecifics: {
        supplierConfirmed: {
          Type: "Cake Turntable",
          Material: "Plastic",
          Size: "11 in",
        },
      },
      shippingRecommendation: {
        supplierShippingEconomicsUsd: 9.99,
        buyerFacingShippingPolicy: "USE_CANONICAL_ACCOUNT_POLICY",
      },
    },
    hardGates: [
      "NEED_AUTHORIZED_PRODUCT_IMAGES",
      "NEED_EBAY_TAXONOMY_CATEGORY",
      "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
    ],
    evidenceGuards: [],
    canProceedToListingPackage: false,
    safety: {
      exactSoldClaimed: false,
      activeAskTreatedAsSold: false,
      safeCapacityClaimed: false,
      listingAuthorized: false,
      marketplaceWrites: 0,
    },
  }

  return {
    candidate_key: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
    market_radar_product_id: input.marketRadarProductId,
    supplier_product_id: target.lunaProductId,
    supplier_variant_id: target.lunaVariantId,
    supplier_sku: target.lunaSku,
    product_title: input.lunaProduct.title,
    variant_title: variant.title,
    gtin: target.gtin,
    queue_status: "ready",
    decision: "LISTING_READY",
    opportunity_score: decision.launchPotentialScore,
    demand_score: 35,
    economics_score: 82,
    identity_score: 100,
    competition_score: 30,
    supply_score: 80,
    listing_readiness_score: 85,
    active_comparables: 0,
    sellers_with_movement: 0,
    estimated_weekly_velocity: null,
    median_total_buyer_price: 25.99,
    estimated_net_profit: economics.contributionProfitUsd,
    supplier_price: target.unitCostUsd,
    supplier_available: true,
    supplier_inventory_quantity: null,
    supplier_snapshot_at: new Date(input.observedAt).toISOString(),
    best_selling_match_score: null,
    best_selling_matches: [],
    keyword_structure: assessment.listingIntelligencePackage.titleStrategy,
    hard_gates: assessment.hardGates,
    evidence_guards: [],
    assessment,
    last_scanned_at: new Date(input.observedAt).toISOString(),
    next_scan_at: new Date(Date.parse(input.observedAt) + 86_400_000).toISOString(),
    updated_at: new Date(input.observedAt).toISOString(),
  }
}

export async function materializeCakeTurntableListingIntakeV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  observedAt?: string
  readPublicProduct?: typeof fetchPublicLunaProductForActiveListingMonitor
}>) {
  const target = CAKE_TURNTABLE_FRONTIER_HANDOFF_TARGET_V1
  const [decisionPackage, catalog] = await Promise.all([
    readWinnerEvidenceDecisionPackage(input.supabase, target.packageId,
      input.accountKey),
    input.supabase.from("market_radar_latest_variants")
      .select("product_id,product_url")
      .eq("source_key", "lunaportex")
      .eq("supplier_product_id", target.lunaProductId)
      .eq("supplier_variant_id", target.lunaVariantId)
      .eq("sku", target.lunaSku).maybeSingle(),
  ])
  if (catalog.error || !catalog.data || !text(catalog.data.product_url)) {
    throw new Error("CAKE_TURNTABLE_LISTING_INTAKE_PRODUCT_TRUTH_UNAVAILABLE")
  }
  const readPublicProduct = input.readPublicProduct ??
    fetchPublicLunaProductForActiveListingMonitor
  const product = await readPublicProduct(String(catalog.data.product_url))
  const row = buildCakeTurntableListingIntakeV1({
    decisionPackage,
    lunaProduct: product,
    marketRadarProductId: String(catalog.data.product_id),
    observedAt: input.observedAt ?? new Date().toISOString(),
  })
  const write = await input.supabase.from("ebay_luna_opportunity_queue")
    .upsert(row, { onConflict: "candidate_key" }).select("id,candidate_key,decision")
    .single()
  if (write.error || !write.data) {
    throw new Error("CAKE_TURNTABLE_LISTING_INTAKE_WRITE_FAILED")
  }
  const readback = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("id,candidate_key,decision,assessment")
    .eq("id", write.data.id).maybeSingle()
  if (readback.error || !readback.data ||
      readback.data.candidate_key !== CAKE_TURNTABLE_LISTING_INTAKE_KEY ||
      readback.data.decision !== "LISTING_READY" ||
      !isSmartStockingListingIntakeV1(readback.data.assessment)) {
    throw new Error("CAKE_TURNTABLE_LISTING_INTAKE_READBACK_FAILED")
  }
  return Object.freeze({
    opportunityId: String(readback.data.id),
    candidateKey: CAKE_TURNTABLE_LISTING_INTAKE_KEY,
    listingWorkspaceUrl: `/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(String(readback.data.id))}&candidate=${encodeURIComponent(CAKE_TURNTABLE_LISTING_INTAKE_KEY)}`,
    durableReadback: true as const,
    marketplaceWrites: 0 as const,
  })
}
