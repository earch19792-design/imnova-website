import type { SupabaseClient } from "@supabase/supabase-js"

import { readEbayPromotionRecommendationReadonlyV1, type
  EbayPromotionRecommendationReadonlyV1 } from
  "./ebay-marketing-promotion-readonly-v1"
import { projectSellerOsCanonicalLunaStockReadModelV1 } from
  "./ebay-luna-canonical-stock-read-model-adapter-v1"
import { DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY } from
  "../marketplace/post-publication-optimization-domain"

export const SELLER_OS_PROMOTION_RECOMMENDATION_SAFE_EXECUTION_VERSION =
  "SELLER_OS_PROMOTION_RECOMMENDATION_SAFE_EXECUTION_V1_2026_08_30" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function money(value: number) {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2))
}

function percent(value: number) {
  return Number(value.toFixed(4))
}

function sha256Tagged(value: unknown) {
  return /^sha256:[0-9a-f]{64}$/.test(text(value, 80))
}

export type PromotionSafetyGuardV1 = Readonly<{
  code: "PRODUCT_TRUTH_EXACT" | "LIVE_IDENTITY_EXACT" |
    "STOCK_GUARD_SAFE" | "ECONOMICS_PROVEN" |
    "NO_CONFLICTING_EXPERIMENT" | "PROMOTION_SIGNAL_PROVEN"
  passed: boolean
  reasonCode: string | null
}>

export function buildEbayPromotionRecommendationDecisionV1(input: Readonly<{
  ebayItemId: string
  recommendation: EbayPromotionRecommendationReadonlyV1
  economics: unknown
  productTruthExact: boolean
  liveIdentityExact: boolean
  stockGuardSafe: boolean
  noConflictingExperiment: boolean
}>) {
  const economics = record(input.economics)
  const baseFees = record(economics.baseFees)
  const modifiers = record(economics.officialModifiers)
  const currentProfitUsd = number(economics.profitUsd)
  const currentMarginPercent = number(economics.marginPercent)
  const livePriceUsd = number(economics.revenueUsd)
  const supplierTotalUsd = number(economics.supplierTotalUsd)
  const baseRatePercent = number(baseFees.officialFinalValueFeeRatePercent)
  const fixedFeeUsd = number(baseFees.perOrderFixedFeeUsd)
  const modifierBoundPercent = number(
    modifiers.conservativeMutuallyExclusiveBoundPercent,
  )
  const economicsProven =
    economics.contractVersion ===
      "SELLER_OS_LIVE_PRE_SALE_ECONOMICS_V1_2026_08_30" &&
    economics.status === "AVAILABLE" &&
    economics.feeEvidenceClass === "PROVEN_RATE_PRE_SALE_FEE_MODEL" &&
    economics.ebayItemId === input.ebayItemId &&
    economics.economicsNonNegative === true &&
    economics.nextBlocker === null &&
    currentProfitUsd !== null && currentMarginPercent !== null &&
    livePriceUsd !== null && livePriceUsd > 0
  const promotionSignalProven = input.recommendation.status === "AVAILABLE"
  const guards: PromotionSafetyGuardV1[] = [
    { code: "PRODUCT_TRUTH_EXACT", passed: input.productTruthExact,
      reasonCode: input.productTruthExact ? null : "PRODUCT_TRUTH_EXACT_REQUIRED" },
    { code: "LIVE_IDENTITY_EXACT", passed: input.liveIdentityExact,
      reasonCode: input.liveIdentityExact ? null : "LIVE_IDENTITY_EXACT_REQUIRED" },
    { code: "STOCK_GUARD_SAFE", passed: input.stockGuardSafe,
      reasonCode: input.stockGuardSafe ? null : "STOCK_GUARD_SAFE_REQUIRED" },
    { code: "ECONOMICS_PROVEN", passed: economicsProven,
      reasonCode: economicsProven ? null : "CANONICAL_ECONOMICS_REQUIRED" },
    { code: "NO_CONFLICTING_EXPERIMENT",
      passed: input.noConflictingExperiment,
      reasonCode: input.noConflictingExperiment ? null :
        "CONFLICTING_EXPERIMENT_PRESENT" },
    { code: "PROMOTION_SIGNAL_PROVEN", passed: promotionSignalProven,
      reasonCode: promotionSignalProven ? null :
        input.recommendation.limitationCode ?? "PROMOTION_SIGNAL_UNPROVEN" },
  ]
  const allGuardsPass = guards.every((guard) => guard.passed)
  const marginFloorPercent =
    DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY.marginRiskBelowPercent
  const marginFloorPolicy = {
    status: "AVAILABLE" as const,
    valuePercent: marginFloorPercent,
    authority: DEFAULT_POST_PUBLICATION_OPTIMIZATION_POLICY.version,
    policyField: "marginRiskBelowPercent" as const,
  }
  const safeIncrementalSpendUsd = economicsProven &&
      currentProfitUsd !== null && livePriceUsd !== null
    ? Math.max(0, money(currentProfitUsd -
      livePriceUsd * marginFloorPercent / 100)) : null
  const maxSafeAdRatePercent = safeIncrementalSpendUsd !== null &&
      livePriceUsd !== null
    ? percent(safeIncrementalSpendUsd / livePriceUsd * 100) : null
  let maxSafePriceDiscountPercent: number | null = null
  if (economicsProven && livePriceUsd !== null && supplierTotalUsd !== null &&
      baseRatePercent !== null && fixedFeeUsd !== null &&
      modifierBoundPercent !== null) {
    const retainedShare = 1 - (baseRatePercent + modifierBoundPercent +
      marginFloorPercent) / 100
    if (retainedShare > 0) {
      const minimumSafePrice = (supplierTotalUsd + fixedFeeUsd) / retainedShare
      maxSafePriceDiscountPercent = percent(Math.max(0,
        (livePriceUsd - minimumSafePrice) / livePriceUsd * 100))
    }
  }
  const recommendedAdRate = input.recommendation.recommendationType ===
      "AD_RATE" ? input.recommendation.recommendedAdRatePercent : null
  const recommendedAdFeeUsd = recommendedAdRate !== null &&
      livePriceUsd !== null ? money(livePriceUsd * recommendedAdRate / 100) : null
  const profitAtRecommendedLevelUsd = recommendedAdFeeUsd !== null &&
      currentProfitUsd !== null
    ? money(currentProfitUsd - recommendedAdFeeUsd) : null
  const marginAtRecommendedLevelPercent = profitAtRecommendedLevelUsd !== null &&
      livePriceUsd !== null
    ? percent(profitAtRecommendedLevelUsd / livePriceUsd * 100) : null

  let decision: "APPLY" | "CAP_TO_SAFE_LEVEL" | "DO_NOT_PROMOTE" |
    "NO_RECOMMENDATION" | "BLOCKED" = "BLOCKED"
  let decisionReason = guards.find((guard) => !guard.passed)?.reasonCode ?? null
  if (allGuardsPass && input.recommendation.recommendationAvailable === false) {
    decision = "NO_RECOMMENDATION"
    decisionReason = "EBAY_RETURNED_NO_APPLICABLE_AD_RECOMMENDATION"
  } else if (allGuardsPass && recommendedAdRate !== null &&
      maxSafeAdRatePercent !== null) {
    if (maxSafeAdRatePercent <= 0) {
      decision = "DO_NOT_PROMOTE"
      decisionReason = "CURRENT_MARGIN_BELOW_EXISTING_FLOOR"
    } else if (recommendedAdRate <= maxSafeAdRatePercent) {
      decision = "APPLY"
      decisionReason = "EBAY_RATE_WITHIN_EXISTING_MARGIN_FLOOR"
    } else {
      decision = "CAP_TO_SAFE_LEVEL"
      decisionReason = "EBAY_RATE_EXCEEDS_EXISTING_MARGIN_FLOOR"
    }
  }
  const executableDecision = decision === "APPLY" ||
    decision === "CAP_TO_SAFE_LEVEL"
  return {
    contractVersion: SELLER_OS_PROMOTION_RECOMMENDATION_SAFE_EXECUTION_VERSION,
    ebayItemId: input.ebayItemId,
    marketplaceId: "EBAY_US" as const,
    recommendation: {
      status: input.recommendation.status,
      available: input.recommendation.recommendationAvailable,
      type: input.recommendation.recommendationType,
      recommendedAdRatePercent: recommendedAdRate,
      recommendedPriceDiscountPercent:
        input.recommendation.recommendedDiscountPercent,
      adRateBasis: input.recommendation.adRateBasis,
      source: input.recommendation.authority,
      priceDiscountSource:
        input.recommendation.priceDiscountRecommendation,
      limitationCode: input.recommendation.limitationCode,
    },
    economicsGuard: {
      status: economicsProven ? "AVAILABLE" as const : "UNPROVEN" as const,
      evidenceClass: economics.feeEvidenceClass ?? "UNPROVEN",
      currentProfitUsd,
      currentMarginPercent,
      marginFloorPolicy,
      safeExecutionBlocker: economicsProven && currentMarginPercent !== null &&
          currentMarginPercent < marginFloorPercent
        ? "CURRENT_MARGIN_BELOW_EXISTING_FLOOR" :
        economicsProven ? null : "CANONICAL_ECONOMICS_REQUIRED",
      maxSafeIncrementalSpendUsd: safeIncrementalSpendUsd,
      maxSafeAdRatePercent,
      maxSafePriceDiscountPercent,
      profitAtEbayRecommendedLevelUsd: profitAtRecommendedLevelUsd,
      marginAtEbayRecommendedLevelPercent:
        marginAtRecommendedLevelPercent,
      feesAtRecommendedLevelAreRealized: false,
    },
    guards,
    allGuardsPass,
    promotionDecision: decision,
    decisionReason,
    executionContract: {
      status: "PREPARED_READ_ONLY_CANARY" as const,
      path: ["RECOMMENDATION", "ECONOMICS_GUARD", "PROMOTION_WRITE",
        "EBAY_READBACK", "AUDIT"] as const,
      existingWriteAuthority: "SELLER_OS_COMMERCIAL_IMPROVEMENT_ACTION_V2",
      changeType: "PROMOTED_LISTINGS_GENERAL" as const,
      changeTypeWhitelisted: true as const,
      ownerApprovalRequired: false as const,
      explicitSellerOsOperatorActionRequired: true as const,
      autoExecutionAllowed: executableDecision && allGuardsPass,
      marketplaceWriteEnabledInThisCanary: false as const,
      readbackRequired: true as const,
      auditRequired: true as const,
    },
    ui: {
      ebayRecommends: input.recommendation.recommendationAvailable === true &&
          recommendedAdRate !== null
        ? `Promocionar con una tasa de referencia ${recommendedAdRate}%.`
        : input.recommendation.recommendationAvailable === false
          ? "eBay no devolvió una recomendación de anuncio aplicable."
          : "La recomendación oficial de eBay no está comprobada.",
      sellerOsConsidersSafe: maxSafeAdRatePercent === null
        ? "El máximo seguro todavía no está comprobado."
        : maxSafeAdRatePercent <= 0
          ? "Seller OS no considera seguro agregar gasto promocional con el margen vigente."
          : `Hasta ${maxSafeAdRatePercent}% de tasa promocional.`,
      profitAfter: profitAtRecommendedLevelUsd,
      marginAfter: marginAtRecommendedLevelPercent,
      maximumAllowedAdRatePercent: maxSafeAdRatePercent,
      explanation: decisionReason,
    },
    safety: {
      analyticsRequests: 0 as const,
      lunaRequests: 0 as const,
      promotionWrites: 0 as const,
      priceChanges: 0 as const,
      marketplaceWrites: 0 as const,
    },
  }
}

export async function loadEbayPromotionRecommendationSafeExecutionV1(input: {
  supabase: SupabaseClient
  accountKey: string
  ebayItemId: string
  fetchImpl?: typeof fetch
  now?: Date
}) {
  if (!/^\d{9,20}$/.test(input.ebayItemId) || !input.accountKey.trim()) {
    throw new Error("PROMOTION_RECOMMENDATION_EXACT_IDENTITY_REQUIRED")
  }
  const activeExperimentStatuses = ["READY", "RUNNING",
    "WAITING_FOR_EVIDENCE", "READY_TO_EVALUATE",
    "PAUSED_FOR_EXTERNAL_SIGNAL"]
  const [listingRead, experimentsRead, decisionRead, jobsRead,
    observationsRead, recommendation] = await Promise.all([
    input.supabase.from("ebay_active_listings")
      .select("ebay_item_id,ebay_sku,listing_status,updated_at")
      .eq("account_key", input.accountKey)
      .eq("ebay_item_id", input.ebayItemId)
      .order("updated_at", { ascending: false }).limit(2),
    input.supabase.from("ebay_listing_experiments_v1")
      .select("experiment_id,ebay_item_id,lifecycle_status,baseline_evidence_ref,created_at")
      .eq("account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .eq("ebay_item_id", input.ebayItemId)
      .order("created_at", { ascending: false }).limit(25),
    input.supabase.from("seller_os_luna_linkage_decisions")
      .select("decision_id,decision_version,decision,decision_at,ebay_item_id,ebay_sku,linkage_id,components,evidence_digest,evidence_references")
      .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
      .eq("ebay_item_id", input.ebayItemId)
      .order("decision_version", { ascending: false }).limit(10),
    input.supabase.from("seller_os_luna_stock_check_jobs")
      .select("stock_check_job_id,linkage_id,ebay_item_id,observation_window_start,observation_window_end,workflow_state,attempt_count,success_receipt_digest")
      .eq("account_key", input.accountKey).eq("ebay_item_id", input.ebayItemId)
      .eq("workflow_state", "SUCCEEDED")
      .order("observation_window_end", { ascending: false }).limit(10),
    input.supabase.from("seller_os_luna_stock_observations")
      .select("observation_id,stock_check_job_id,linkage_id,ebay_item_id,component_identity_id,luna_product_id,luna_variant_id,luna_sku,supplier_quantity_required,observation_state,source_status,observed_availability,observed_supplier_quantity,evidence_class,evidence_digest,acquisition_method,attempt_number,observed_at,maximum_age_seconds,limitations")
      .eq("account_key", input.accountKey).eq("ebay_item_id", input.ebayItemId)
      .order("observed_at", { ascending: false }).limit(50),
    readEbayPromotionRecommendationReadonlyV1(
      input.ebayItemId,
      input.fetchImpl ?? fetch,
    ),
  ])
  if (listingRead.error || experimentsRead.error || decisionRead.error ||
      jobsRead.error || observationsRead.error) {
    throw new Error("PROMOTION_RECOMMENDATION_DURABLE_EVIDENCE_READ_FAILED")
  }
  const listings = listingRead.data ?? []
  const experiments = experimentsRead.data ?? []
  const listing = listings.length === 1 ? listings[0] : null
  const exactExperiments = experiments.filter((row) => {
    const baseline = record(row.baseline_evidence_ref)
    const visual = record(baseline.sellerOsVisualVariant)
    return row.ebay_item_id === input.ebayItemId &&
      visual.ebayItemId === input.ebayItemId
  })
  const exactExperiment = exactExperiments[0] ?? null
  const baseline = record(exactExperiment?.baseline_evidence_ref)
  const visual = record(baseline.sellerOsVisualVariant)
  const variants = Array.isArray(visual.variants)
    ? visual.variants.map(record) : []
  const decisions = decisionRead.data ?? []
  const latestDecision = decisions[0] ?? null
  const components = Array.isArray(latestDecision?.components)
    ? latestDecision.components.map(record) : []
  const exactComponent = components.length === 1 ? components[0] : null
  const liveIdentityExact = Boolean(listing && listings.length === 1 &&
    listing.ebay_item_id === input.ebayItemId &&
    listing.listing_status === "active")
  const productTruthExact = Boolean(exactExperiment && exactComponent &&
    sha256Tagged(visual.productTruthFingerprint) &&
    visual.lunaProductId === exactComponent.lunaProductId &&
    visual.lunaVariantId === exactComponent.lunaVariantId &&
    visual.lunaSku === exactComponent.lunaSku &&
    exactComponent.exactProductIdentity === true &&
    exactComponent.exactVariantIdentity === true &&
    exactComponent.exactSupplierSku === true &&
    exactComponent.identityConflict === false &&
    variants.length > 0 && variants.every((row) =>
      row.productTruthPreserved === true && row.variantRejected !== true))
  const stock = projectSellerOsCanonicalLunaStockReadModelV1({
    itemId: input.ebayItemId,
    marketplace: { marketplaceId: "EBAY_US", accountAlias: null },
    identity: { itemId: input.ebayItemId, variationKey: null,
      sku: listing?.ebay_sku ?? null },
    now: input.now ?? new Date(),
    decisions: { status: "AVAILABLE", rows: decisions },
    jobs: { status: "AVAILABLE", rows: jobsRead.data ?? [] },
    observations: { status: "AVAILABLE", rows: observationsRead.data ?? [] },
  })
  const stockGuardSafe = stock.stock?.state === "IN_STOCK_SIGNAL" &&
    stock.stock.freshness.status === "FRESH" &&
    stock.stock.sourceContractStatus === "HEALTHY" &&
    stock.supplierLinkageStatus === "CERTIFIED"
  const conflicting = experiments.filter((row) =>
    row.experiment_id !== exactExperiment?.experiment_id &&
    activeExperimentStatuses.includes(row.lifecycle_status))
  const result = buildEbayPromotionRecommendationDecisionV1({
    ebayItemId: input.ebayItemId,
    recommendation,
    economics: baseline.sellerOsPreSaleEconomicsEvidence,
    productTruthExact,
    liveIdentityExact,
    stockGuardSafe,
    noConflictingExperiment: conflicting.length === 0,
  })
  return {
    ...result,
    exactIdentity: {
      ebayItemId: input.ebayItemId,
      sourceSku: productTruthExact ? text(visual.lunaSku, 160) : null,
      exactExperimentId: exactExperiment?.experiment_id ?? null,
      exactExperimentLifecycle: exactExperiment?.lifecycle_status ?? null,
      exactExperimentPreserved: exactExperiment ? true : null,
      experimentLifecycleChanged: false as const,
    },
    stockGuard: {
      state: stock.stock?.state ?? "STOCK_UNKNOWN",
      freshness: stock.stock?.freshness.status ?? "UNKNOWN",
      supplierLinkage: stock.supplierLinkageStatus,
      safe: stockGuardSafe,
      limitationCode: stock.limitationCode,
    },
    databaseWrites: 0 as const,
  }
}
