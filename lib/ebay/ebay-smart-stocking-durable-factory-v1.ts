import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

export const SELLER_OS_DETERMINISTIC_FACTORY =
  "SELLER_OS_DETERMINISTIC_FACTORY" as const
export const SELLER_OS_DURABLE_FACTORY_VERSION =
  "SELLER_OS_GENERAL_DURABLE_FACTORY_AUTHORITY_V1" as const
export const SMART_STOCKING_LISTING_INTAKE_VERSION =
  "SELLER_OS_SMART_STOCKING_LISTING_INTAKE_V1" as const

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function strings(value: unknown, limit = 50) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim()).filter(Boolean).slice(0, limit)
    : []
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function canonical(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`
}

function unique(values: readonly string[]) {
  return [...new Set(values)]
}

function exactProductTruth(opportunity: JsonRecord) {
  const assessment = record(opportunity.assessment)
  const truth = record(assessment.productTruth)
  const stock = record(truth.stock)
  const exact = truth.authorityClass === "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1"
    && /^sha256:[0-9a-f]{64}$/.test(String(truth.evidenceDigest ?? ""))
    && truth.candidateKey === opportunity.candidate_key
    && truth.lunaProductId === opportunity.supplier_product_id
    && truth.lunaVariantId === opportunity.supplier_variant_id
    && truth.supplierSku === opportunity.supplier_sku
    && truth.gtin === opportunity.gtin
    && stock.exactIdentityVerified === true
  return { exact, truth, stock }
}

function familyDemand(frontier: JsonRecord) {
  return text(record(frontier.frontier_payload).familyDemandStatus)
}

export function getSellerOsRadarPriceDistributionEconomicsV1(value: unknown) {
  const frontier = record(value)
  const continuation = record(
    frontier.radarAutomaticPriceDistributionContinuationV1)
  const economics = record(continuation.targetEconomics)
  const targetPrice = number(continuation.targetPrice)
  const profit = number(economics.profit)
  const margin = number(economics.marginPercent)
  const roi = number(economics.roiPercent)
  const estimatedEbayFees = number(economics.estimatedEbayFees)
  const valid = continuation.contractVersion ===
      "RADAR_AUTOMATIC_PRICE_DISTRIBUTION_CONTINUATION_V1"
    && continuation.demandEvidenceGrain === "FAMILY"
    && continuation.exactProductDemandClaimed === false
    && /^sha256:[0-9a-f]{64}$/.test(String(continuation.evidenceDigest ?? ""))
    && continuation.targetPriceWithinSupportedDistribution === true
    && continuation.marginFloorPass === true
    && continuation.economicsReady === true
    && continuation.finalDisposition === "ECONOMICS_READY"
    && targetPrice !== null && targetPrice > 0
    && profit !== null && profit > 0 && margin !== null && margin >= 20
    && roi !== null && roi >= 30 && estimatedEbayFees !== null
  return valid ? Object.freeze({ economicsReady: true as const,
    targetPrice, profit, margin, roi, estimatedEbayFees }) : null
}

function normalizeProfitabilityFrontier(value: unknown) {
  const outer = record(value)
  const inner = record(outer.frontier)
  const target = getSellerOsRadarPriceDistributionEconomicsV1(inner)
  return {
    frontier_id: outer.frontierId,
    frontier_digest: inner.frontierDigest,
    snapshot_digest: outer.snapshotDigest,
    luna_product_id: inner.lunaProductId,
    luna_variant_id: inner.lunaVariantId,
    luna_sku: inner.lunaSku,
    frontier_payload: inner,
    economic_classification: inner.economicClassification,
    shipping_status: inner.shippingStatus,
    next_best_evidence: inner.nextBestEvidence,
    contribution_profit_median: inner.contributionProfitAtMarketMedian,
    contribution_margin_median: inner.contributionMarginAtMarketMedian,
    luna_cost: inner.lunaUnitCost,
    shipping_value: inner.shippingValue,
    market_price_median: inner.marketPriceMedian,
    ebay_fee_estimate_at_median: inner.ebayFeeEstimateAtMedian,
    radar_price_distribution_target: target,
    hard_blockers: inner.currentHardBlockers ?? inner.hardBlockers,
  }
}

function exactSupplierIdentity(opportunity: JsonRecord, frontier: JsonRecord) {
  return Boolean(
    text(opportunity.candidate_key)
    && text(opportunity.supplier_product_id)
    && text(opportunity.supplier_variant_id)
    && text(opportunity.supplier_sku)
    && opportunity.supplier_product_id === frontier.luna_product_id
    && opportunity.supplier_variant_id === frontier.luna_variant_id
    && opportunity.supplier_sku === frontier.luna_sku,
  )
}

function decisionPackageAuthority(
  opportunity: JsonRecord,
  decisionPackage: unknown,
) {
  const row = record(decisionPackage)
  const payload = record(row.package_payload)
  const identity = record(record(payload.productIdentity).identity)
  const profile = record(row.smart_stocking_learning_profile)
  const entry = record(profile.entrySnapshot)
  const decision = record(profile.decisionSnapshot)
  const economics = record(decision.finalEconomics)
  const exact = /^[0-9a-f-]{36}$/i.test(String(row.id ?? ""))
    && row.status === "GENERATED"
    && payload.supplierSku === opportunity.supplier_sku
    && payload.supplierVariantId === opportunity.supplier_variant_id
    && identity.gtin === opportunity.gtin
    && profile.profileVersion === "SELLER_OS_SMART_STOCKING_LEARNING_PROFILE_V1"
    && /^sha256:[0-9a-f]{64}$/.test(String(profile.entrySnapshotHash ?? ""))
    && /^sha256:[0-9a-f]{64}$/.test(String(profile.decisionSnapshotHash ?? ""))
    && economics.status === "PASS"
    && economics.thresholdResult === "PASS"
  return { exact, row, profile, entry, decision, economics }
}

function listingSeed(opportunity: JsonRecord, frontier: JsonRecord) {
  const assessment = record(opportunity.assessment)
  const intelligence = record(assessment.listingIntelligencePackage)
  const candidate = record(assessment.candidate)
  const category = record(intelligence.categoryRecommendation)
  const titleStrategy = record(intelligence.titleStrategy)
  const itemSpecifics = record(intelligence.itemSpecifics)
  return {
    title: String(intelligence.recommendedTitle ?? titleStrategy.titleFormula
      ?? opportunity.product_title ?? "").slice(0, 80),
    categoryId: text(category.categoryId),
    categoryName: text(category.categoryName),
    aspects: record(itemSpecifics.supplierConfirmed),
    description: String(candidate.description ?? ""),
    imageUrls: strings(candidate.imageUrls, 24),
    pricing: {
      supplierCost: number(opportunity.supplier_price),
      targetPrice: number(record(frontier.radar_price_distribution_target)
        .targetPrice) ?? number(opportunity.median_total_buyer_price),
    },
    evidenceSnapshot: {
      assessment,
      hardGates: strings(opportunity.hard_gates),
      evidenceGuards: strings(opportunity.evidence_guards),
    },
  }
}

export function isSellerOsDeterministicFactoryPackageV1(value: unknown) {
  const authority = record(record(value).factoryPreparationAuthority)
  return authority.contractVersion === SELLER_OS_DURABLE_FACTORY_VERSION
    && authority.authority === SELLER_OS_DETERMINISTIC_FACTORY
    && authority.humanApproved === false
    && authority.reviewerUserId === null
    && /^sha256:[0-9a-f]{64}$/.test(String(authority.evidenceDigest ?? ""))
}

export function isGenericSmartStockingListingIntakeV1(value: unknown) {
  const marker = record(record(value).smartStockingListingIntakeV1)
  return isSmartStockingListingIntakeReadinessV1(value)
    && marker.factoryAuthority === SELLER_OS_DETERMINISTIC_FACTORY
    && typeof marker.candidateKey === "string"
    && typeof marker.supplierSku === "string"
    && /^\d{1,30}$/.test(String(marker.lunaProductId ?? ""))
    && /^\d{1,30}$/.test(String(marker.lunaVariantId ?? ""))
    && marker.productTruthReady === true
    && marker.demandReady === true
    && marker.duplicateGuardPassed === true
}

export function isSmartStockingListingIntakeReadinessV1(value: unknown) {
  const marker = record(record(value).smartStockingListingIntakeV1)
  return marker.contractVersion === SMART_STOCKING_LISTING_INTAKE_VERSION
    && marker.finalDecision === "LISTING_READY"
    && marker.finalEconomicsStatus === "PASS"
    && marker.exactIdentityVerified === true
    && marker.currentSupplierAvailabilityVerified === true
}

export function buildSellerOsDeterministicFactoryPlanV1(input: Readonly<{
  opportunity: JsonRecord
  frontier: JsonRecord
  activeDuplicateCount: number | null
  decisionPackage?: JsonRecord | null
}>) {
  const { opportunity, frontier } = input
  const assessment = record(opportunity.assessment)
  const readiness = record(assessment.canonicalReadiness)
  const productTruth = exactProductTruth(opportunity)
  const supplierIdentityReady = exactSupplierIdentity(opportunity, frontier)
  const demandStatus = familyDemand(frontier)
  const demandReady = demandStatus === "FAMILY_DEMAND_PROVEN"
    || demandStatus === "FAMILY_DEMAND_SUPPORTED"
  const hardBlockers = strings(frontier.hard_blockers)
  const targetEconomics = record(frontier.radar_price_distribution_target)
  const distributionReady = targetEconomics.economicsReady === true
    && (number(targetEconomics.profit) ?? 0) > 0
    && (number(targetEconomics.margin) ?? 0) >= 20
    && (number(targetEconomics.roi) ?? 0) >= 30
  const legacyEconomicsReady = frontier.economic_classification
      === "ECONOMICALLY_PROMISING"
    && frontier.shipping_status === "SHIPPING_DURABLY_PERSISTED"
    && frontier.next_best_evidence === "NONE"
    && (number(frontier.contribution_profit_median) ?? 0) > 0
    && (number(frontier.contribution_margin_median) ?? 0) > 0
    && hardBlockers.length === 0
  const economicsReady = (legacyEconomicsReady || distributionReady)
    && frontier.shipping_status === "SHIPPING_DURABLY_PERSISTED"
    && frontier.next_best_evidence === "NONE" && hardBlockers.length === 0
  const duplicateGuardPassed = input.activeDuplicateCount === 0
  const stockReady = opportunity.supplier_available === true
    && opportunity.supplier_price !== null
    && (number(opportunity.supplier_price) ?? 0) > 0
    // Unknown supplier quantity is explicitly not OOS.
    && (opportunity.supplier_inventory_quantity === null
      || (number(opportunity.supplier_inventory_quantity) ?? 0) > 0)
  const seed = listingSeed(opportunity, frontier)
  const categoryReady = Boolean(seed.categoryId)
  const packageInputsReady = Boolean(seed.title && seed.imageUrls.length > 0
    && categoryReady)
  const listingPackageReady = supplierIdentityReady && productTruth.exact
    && demandReady && economicsReady && stockReady && duplicateGuardPassed
    && packageInputsReady
  const canonicalMarketplaceReady = Array.isArray(readiness.blockers)
    && readiness.blockers.length === 0
  const decisionPackage = decisionPackageAuthority(
    opportunity, input.decisionPackage,
  )
  const decisionPackageReady = decisionPackage.exact
  const blockers = unique([
    ...(!supplierIdentityReady ? ["SUPPLIER_IDENTITY_NOT_EXACT"] : []),
    ...(!productTruth.exact ? ["PRODUCT_TRUTH_NOT_READY"] : []),
    ...(!demandReady ? ["FAMILY_DEMAND_NOT_READY"] : []),
    ...(!economicsReady ? [
      hardBlockers[0] ?? `ECONOMICS_${String(frontier.economic_classification
        ?? "UNPROVEN")}`,
    ] : []),
    ...(!stockReady ? ["CANONICAL_STOCK_NOT_READY"] : []),
    ...(input.activeDuplicateCount === null
      ? ["ACTIVE_DUPLICATE_GUARD_UNAVAILABLE"]
      : !duplicateGuardPassed ? ["ACTIVE_DUPLICATE"] : []),
    ...(!categoryReady ? ["MARKETPLACE_CATEGORY_NOT_READY"] : []),
    ...(!packageInputsReady ? ["LISTING_PACKAGE_INPUTS_NOT_READY"] : []),
    ...(!canonicalMarketplaceReady
      ? ["CANONICAL_MARKETPLACE_READINESS_REQUIRED"] : []),
    ...(!decisionPackageReady ? ["DECISION_PACKAGE_NOT_BOUND"] : []),
  ])
  const listingReady = blockers.length === 0
  const stageStatuses = {
    SMART_STOCKING: "READY",
    PRODUCT_TRUTH_READY: productTruth.exact ? "READY" : "BLOCKED",
    DEMAND_READY: demandReady ? "READY" : "BLOCKED",
    ECONOMICS_READY: economicsReady ? "READY" : "BLOCKED",
    LISTING_PACKAGE_READY: listingPackageReady ? "READY" : "BLOCKED",
    LISTING_READY: listingReady ? "READY" : "BLOCKED",
  } as const
  const evidenceCore = {
    contractVersion: SELLER_OS_DURABLE_FACTORY_VERSION,
    authority: SELLER_OS_DETERMINISTIC_FACTORY,
    candidateKey: opportunity.candidate_key,
    opportunityId: opportunity.id,
    supplierProductId: opportunity.supplier_product_id,
    supplierVariantId: opportunity.supplier_variant_id,
    supplierSku: opportunity.supplier_sku,
    gtin: opportunity.gtin,
    frontierId: frontier.frontier_id,
    frontierDigest: frontier.frontier_digest,
    frontierSnapshotDigest: frontier.snapshot_digest,
    decisionPackageId: decisionPackageReady ? decisionPackage.row.id : null,
    stageStatuses,
    blockers,
  }
  const evidenceDigest = digest(evidenceCore)
  const factoryPreparationAuthority = {
    ...evidenceCore,
    evidenceDigest,
    serverOwned: true,
    humanApproved: false,
    reviewerUserId: null,
    publicationAuthorized: false,
  }
  const smartStockingListingIntakeV1 = listingReady ? {
    contractVersion: SMART_STOCKING_LISTING_INTAKE_VERSION,
    factoryAuthority: SELLER_OS_DETERMINISTIC_FACTORY,
    decisionPackageId: decisionPackage.row.id,
    candidateKey: opportunity.candidate_key,
    supplierSku: opportunity.supplier_sku,
    lunaProductId: opportunity.supplier_product_id,
    lunaVariantId: opportunity.supplier_variant_id,
    finalDecision: "LISTING_READY",
    finalPriceUsd: number(targetEconomics.targetPrice) ??
      number(opportunity.median_total_buyer_price),
    finalEconomicsStatus: "PASS",
    productTruthReady: true,
    demandReady: true,
    duplicateGuardPassed: true,
    exactIdentityVerified: true,
    currentSupplierAvailabilityVerified: true,
    safeCapacity: null,
    frontierId: frontier.frontier_id,
    frontierDigest: frontier.frontier_digest,
    frontierSnapshotDigest: frontier.snapshot_digest,
    productTruthDigest: productTruth.truth.evidenceDigest,
    entrySnapshotHash: decisionPackage.profile.entrySnapshotHash,
    decisionSnapshotHash: decisionPackage.profile.decisionSnapshotHash,
    entryPotentialScore: number(decisionPackage.entry.entryPotentialScore),
    launchTier: decisionPackage.decision.launchTier,
    supplierCostUsd: number(frontier.luna_cost),
    supplierShippingUsd: number(frontier.shipping_value),
    salePriceUsd: number(targetEconomics.targetPrice) ??
      number(frontier.market_price_median),
    estimatedEbayFeesUsd: number(targetEconomics.estimatedEbayFees) ??
      number(frontier.ebay_fee_estimate_at_median),
    contributionProfitUsd: number(targetEconomics.profit) ??
      number(frontier.contribution_profit_median),
    contributionMarginPercent: number(targetEconomics.margin) ??
      number(frontier.contribution_margin_median),
    roiPercent: number(targetEconomics.roi) ??
      number(decisionPackage.economics.roiPercent),
  } : null
  return Object.freeze({
    contractVersion: SELLER_OS_DURABLE_FACTORY_VERSION,
    authority: SELLER_OS_DETERMINISTIC_FACTORY,
    targetSpecificAllowlistUsed: false as const,
    humanSessionRequired: false as const,
    marketplaceWrites: 0 as const,
    publishCalls: 0 as const,
    listingReady,
    firstBlocker: blockers[0] ?? null,
    blockers: Object.freeze(blockers),
    stageStatuses: Object.freeze(stageStatuses),
    factoryPreparationAuthority: Object.freeze(factoryPreparationAuthority),
    smartStockingListingIntakeV1: smartStockingListingIntakeV1
      ? Object.freeze(smartStockingListingIntakeV1) : null,
    packageSeed: Object.freeze({
      ...seed,
      factoryPreparationAuthority,
    }),
    readiness: listingReady ? 100 : Math.round(
      Object.values(stageStatuses).filter((status) => status === "READY").length
      / Object.keys(stageStatuses).length * 100,
    ),
  })
}

export async function materializeSellerOsDeterministicFactoryCandidateV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    opportunityId: string
    candidateKey: string
    decisionPackageId?: string | null
  }>,
) {
  const opportunityRead = await input.supabase.from("ebay_luna_opportunity_queue")
    .select("*").eq("id", input.opportunityId)
    .eq("candidate_key", input.candidateKey).maybeSingle()
  if (opportunityRead.error || !opportunityRead.data) {
    throw new Error("DETERMINISTIC_FACTORY_CANDIDATE_NOT_FOUND")
  }
  const opportunity = opportunityRead.data as JsonRecord
  const productId = text(opportunity.supplier_product_id)
  const variantId = text(opportunity.supplier_variant_id)
  const supplierSku = text(opportunity.supplier_sku)
  if (!productId || !variantId || !supplierSku) {
    throw new Error("DETERMINISTIC_FACTORY_SUPPLIER_IDENTITY_REQUIRED")
  }
  const [frontierRead, duplicateRead, packageRead, decisionPackageRead] =
    await Promise.all([
    input.supabase.rpc("get_seller_os_latest_profitability_frontiers_v1", {
      p_account_key: input.accountKey,
      p_marketplace_id: "EBAY_US",
      p_family_ids: null,
      p_limit: 100,
    }),
    input.supabase.from("ebay_active_listings")
      .select("id,supplier_variant_id,supplier_sku,ebay_sku")
      .eq("account_key", input.accountKey).eq("listing_status", "active")
      .limit(1000),
    input.supabase.from("ebay_listing_packages").select("*")
      .eq("account_key", input.accountKey)
      .eq("opportunity_id", input.opportunityId).maybeSingle(),
    input.decisionPackageId
      ? input.supabase.from("marketplace_listing_decision_packages")
        .select("id,status,package_payload,smart_stocking_learning_profile")
        .eq("id", input.decisionPackageId)
        .eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const frontierOuter = Array.isArray(record(frontierRead.data).frontiers)
    ? (record(frontierRead.data).frontiers as unknown[]).find((value) => {
      const frontier = record(record(value).frontier)
      return frontier.lunaProductId === productId
        && frontier.lunaVariantId === variantId
        && frontier.lunaSku === supplierSku
    })
    : null
  if (frontierRead.error || !frontierOuter) {
    throw new Error("DETERMINISTIC_FACTORY_PROFITABILITY_FRONTIER_REQUIRED")
  }
  if (duplicateRead.error) {
    throw new Error("DETERMINISTIC_FACTORY_DUPLICATE_GUARD_FAILED")
  }
  if (packageRead.error) throw new Error("DETERMINISTIC_FACTORY_PACKAGE_READ_FAILED")
  if (decisionPackageRead.error) {
    throw new Error("DETERMINISTIC_FACTORY_DECISION_PACKAGE_READ_FAILED")
  }
  const activeDuplicateCount = (duplicateRead.data ?? []).filter((value) => {
    const listing = record(value)
    return listing.supplier_variant_id === variantId
      || listing.supplier_sku === supplierSku
      || listing.ebay_sku === supplierSku
  }).length
  const plan = buildSellerOsDeterministicFactoryPlanV1({
    opportunity,
    frontier: normalizeProfitabilityFrontier(frontierOuter),
    activeDuplicateCount,
    decisionPackage: decisionPackageRead.data as JsonRecord | null,
  })
  const currentAssessment = record(opportunity.assessment)
  const assessment = {
    ...currentAssessment,
    sellerOsDeterministicFactory: plan.factoryPreparationAuthority,
    ...(plan.smartStockingListingIntakeV1
      ? { smartStockingListingIntakeV1: plan.smartStockingListingIntakeV1 }
      : {}),
  }
  const queueWrite = await input.supabase.from("ebay_luna_opportunity_queue")
    .update({
      assessment,
      ...(plan.listingReady
        ? { decision: "LISTING_READY", queue_status: "ready" } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", input.opportunityId).eq("candidate_key", input.candidateKey)
    .select("id,candidate_key,decision,assessment").single()
  if (queueWrite.error || !queueWrite.data) {
    throw new Error("DETERMINISTIC_FACTORY_SMART_STOCKING_WRITE_FAILED")
  }

  const existingPackage = packageRead.data as JsonRecord | null
  let listingPackage: JsonRecord
  let packageCreated = false
  if (existingPackage) {
    listingPackage = existingPackage
    if (existingPackage.created_by === null
      && isSellerOsDeterministicFactoryPackageV1(existingPackage.package_data)) {
      const packageWrite = await input.supabase.from("ebay_listing_packages")
        .update({
          package_data: plan.packageSeed,
          status: plan.listingReady ? "ready_for_review" : "draft",
          readiness: plan.readiness,
          source_observed_at: opportunity.supplier_snapshot_at ?? null,
          updated_at: new Date().toISOString(),
        }).eq("id", existingPackage.id).eq("opportunity_id", input.opportunityId)
        .is("created_by", null).select("*").single()
      if (packageWrite.error || !packageWrite.data) {
        throw new Error("DETERMINISTIC_FACTORY_PACKAGE_REUSE_FAILED")
      }
      listingPackage = packageWrite.data as JsonRecord
    }
  } else {
    const packageWrite = await input.supabase.from("ebay_listing_packages")
      .insert({
        account_key: input.accountKey,
        opportunity_id: input.opportunityId,
        candidate_key: input.candidateKey,
        status: plan.listingReady ? "ready_for_review" : "draft",
        package_data: plan.packageSeed,
        readiness: plan.readiness,
        source_observed_at: opportunity.supplier_snapshot_at ?? null,
        created_by: null,
      }).select("*").single()
    if (packageWrite.error || !packageWrite.data) {
      throw new Error("DETERMINISTIC_FACTORY_PACKAGE_CREATE_FAILED")
    }
    listingPackage = packageWrite.data as JsonRecord
    packageCreated = true
  }
  const serverOwned = listingPackage.created_by === null
    && isSellerOsDeterministicFactoryPackageV1(listingPackage.package_data)
  return Object.freeze({
    ...plan,
    opportunityId: input.opportunityId,
    candidateKey: input.candidateKey,
    smartStockingDurable: true as const,
    listingPackageId: String(listingPackage.id),
    serverOwnedFactoryAuthority: serverOwned,
    packageCreated,
    duplicateCreated: false as const,
    newEbayOffers: 0 as const,
    withdrawCalls: 0 as const,
  })
}
