import { createHash } from "node:crypto"

export const LISTING_AI_APPROVAL_QUEUE_VERSION =
  "EBAY_LISTING_AI_TOP20_OPPORTUNITY_POOL_V1_2026_07_16"

export type ApprovalQueueCohort =
  | "READY_FOR_OPERATOR_APPROVAL"
  | "NEEDS_DATA"
  | "REJECTED"

export type LunaAvailabilityConfirmation =
  | "EXACT_QUANTITY_VISIBLE"
  | "AVAILABLE_QUANTITY_NOT_SHOWN"
  | "OUT_OF_STOCK"

export type ApprovalQueueCatalogCandidate = {
  marketRadarProductId: string | null
  supplierProductId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
  productUrl: string | null
  imageUrl: string | null
  imageAuthorized: boolean
  supplierCost: number | null
  available: boolean | null
  inventoryQuantity: number | null
  capturedAt: string | null
  manufacturerBrand: string | null
  gtin: string | null
  gtinValid: boolean
  mpn: string | null
  model: string | null
  productName: string | null
  packCount: number | null
  unitCount: number | null
  size: string | null
  color: string | null
  scent: string | null
  variant: string | null
  condition: string | null
  weight: number | null
  weightUnit: string | null
  dimensions: { length: number; width: number; height: number; unit: "in" | "cm" } | null
  exactContents: string[]
  categoryId: string | null
  categoryName: string | null
  requiredAspects: Array<{ name: string; value: string }>
  approvedKeywords: string[]
  outboundShippingCost: number | null
  packagingCost: number | null
  fixedFulfillmentCost: number | null
  supplierShippingReserveUsd: number | null
  complianceBlocked: boolean
  complianceFindings: string[]
}

export type ApprovalQueueDecisionEvidence = {
  verdict: "GO" | "GO_WITH_CHANGES" | "NO_GO"
  identityStrong: boolean
  identityFingerprint: string | null
  baseProductFingerprint: string | null
  offerPackFingerprint: string | null
  exactLunaMapping: boolean
  costRecent: boolean
  stockRecent: boolean
  minimumSafePrice: number | null
  targetPrice: number | null
  estimatedProfit: number | null
  roiPercent: number | null
  netMarginPercent: number | null
  stockAvailable: number | null
  recommendedPackCount: number | null
  safePackStrategy: boolean
  shippingComplete: boolean
  complianceBlocked: boolean
  activeExactCount: number
  soldExactCount: number
  estimatedDemandCount: number
  evidenceConfidence: string
  categoryKey: string | null
  scores: {
    overallOpportunity: number
    demandConfidence: number
    marginSafety: number
    packStrategy: number
    keywordOpportunity: number
    visualOpportunity: number
    listingReadiness: number
    competitionPressure: number
    freshness: number
    operationalSimplicity: number
  }
}

export type ApprovalQueueRankedCandidate = ApprovalQueueDecisionEvidence & {
  id: string
  marketRadarProductId: string
  supplierVariantId: string
  supplierSku: string
  productName: string
  rankingScore: number
  cohort: ApprovalQueueCohort
  reasonCodes: string[]
  poolRank?: number | null
  rank: number | null
}

const TECHNICAL_FIELDS = [
  ["SUPPLIER_PRODUCT_ID_REQUIRED", "supplierProductId"],
  ["SUPPLIER_VARIANT_ID_REQUIRED", "supplierVariantId"],
  ["SUPPLIER_SKU_REQUIRED", "supplierSku"],
  ["LUNA_URL_REQUIRED", "productUrl"],
  ["AUTHORIZED_IMAGE_REQUIRED", "imageUrl"],
  ["SUPPLIER_COST_REQUIRED", "supplierCost"],
  ["SUPPLIER_CAPTURE_DATE_REQUIRED", "capturedAt"],
  ["MANUFACTURER_BRAND_REQUIRED", "manufacturerBrand"],
  ["PRODUCT_NAME_REQUIRED", "productName"],
  ["PACK_COUNT_REQUIRED", "packCount"],
  ["SIZE_REQUIRED", "size"],
  ["VARIANT_REQUIRED", "variant"],
  ["CONDITION_REQUIRED", "condition"],
  ["PACKAGE_WEIGHT_REQUIRED", "weight"],
  ["PACKAGE_DIMENSIONS_REQUIRED", "dimensions"],
  ["EXACT_CONTENTS_REQUIRED", "exactContents"],
  ["EBAY_CATEGORY_REQUIRED", "categoryId"],
  ["EBAY_CATEGORY_NAME_REQUIRED", "categoryName"],
  ["REQUIRED_ASPECTS_REQUIRED", "requiredAspects"],
  ["APPROVED_KEYWORDS_REQUIRED", "approvedKeywords"],
  ["OUTBOUND_SHIPPING_ESTIMATE_REQUIRED", "outboundShippingCost"],
  ["PACKAGING_COST_REQUIRED", "packagingCost"],
  ["FIXED_FULFILLMENT_COST_REQUIRED", "fixedFulfillmentCost"],
  ["SUPPLIER_SHIPPING_RESERVE_REQUIRED", "supplierShippingReserveUsd"],
] as const

function nonEmpty(value: unknown) {
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "number") return Number.isFinite(value) && value >= 0
  if (typeof value === "string") return value.trim().length > 0
  return Boolean(value)
}

function urlAllowed(value: string | null) {
  if (!value) return false
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === "lunaportex.com" || hostname.endsWith(".lunaportex.com")
  } catch {
    return false
  }
}

function recent(value: string | null, now: Date, maximumAgeHours = 24) {
  const timestamp = Date.parse(value ?? "")
  return Number.isFinite(timestamp) && timestamp <= now.getTime() + 5 * 60_000 &&
    now.getTime() - timestamp <= maximumAgeHours * 60 * 60_000
}

function round(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)) * 1_000) / 1_000
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

export function evaluateApprovalQueueCatalogCandidate(
  candidate: ApprovalQueueCatalogCandidate,
  now = new Date(),
) {
  const missing: string[] = TECHNICAL_FIELDS.filter(([, key]) => !nonEmpty(candidate[key]))
    .map(([code]) => code)
  if (!candidate.imageAuthorized) missing.push("AUTHORIZED_IMAGE_PROVENANCE_REQUIRED")
  if (!candidate.gtinValid && !(candidate.manufacturerBrand && (candidate.mpn || candidate.model))) {
    missing.push("STRONG_PRODUCT_IDENTIFIER_REQUIRED")
  }
  if (!urlAllowed(candidate.productUrl)) missing.push("LUNA_URL_NOT_ALLOWLISTED")
  if (!recent(candidate.capturedAt, now)) missing.push("LUNA_COST_AND_STOCK_STALE")
  if (candidate.available !== true || (candidate.inventoryQuantity ?? 0) <= 0) {
    return {
      cohort: "REJECTED" as const,
      reasonCodes: ["LUNA_OUT_OF_STOCK"],
      technicalDataRequestedFromOperator: false,
      canRunOfficialMarketRead: false,
    }
  }
  if (candidate.complianceBlocked) {
    return {
      cohort: "REJECTED" as const,
      reasonCodes: ["COMPLIANCE_BLOCKED", ...candidate.complianceFindings],
      technicalDataRequestedFromOperator: false,
      canRunOfficialMarketRead: false,
    }
  }
  return {
    cohort: missing.length ? "NEEDS_DATA" as const : "READY_FOR_OPERATOR_APPROVAL" as const,
    reasonCodes: [...new Set(missing)],
    technicalDataRequestedFromOperator: false,
    canRunOfficialMarketRead: missing.length === 0,
  }
}

export function evaluateApprovalQueueDecision(evidence: ApprovalQueueDecisionEvidence) {
  const needsData = [
    !evidence.identityStrong ? "PRODUCT_IDENTITY_NOT_STRONG" : null,
    !evidence.identityFingerprint ? "IDENTITY_FINGERPRINT_REQUIRED" : null,
    !evidence.baseProductFingerprint ? "BASE_PRODUCT_FINGERPRINT_REQUIRED" : null,
    !evidence.offerPackFingerprint ? "OFFER_PACK_FINGERPRINT_REQUIRED" : null,
    !evidence.exactLunaMapping ? "EXACT_LUNA_MAPPING_REQUIRED" : null,
    !evidence.costRecent ? "SUPPLIER_COST_STALE" : null,
    !evidence.stockRecent ? "SUPPLIER_STOCK_STALE" : null,
    evidence.minimumSafePrice === null ? "MINIMUM_SAFE_PRICE_REQUIRED" : null,
    evidence.targetPrice === null ? "TARGET_PRICE_REQUIRED" : null,
    !evidence.safePackStrategy ? "SAFE_PACK_STRATEGY_REQUIRED" : null,
    !evidence.shippingComplete ? "SHIPPING_LOGISTICS_INCOMPLETE" : null,
  ].filter((entry): entry is string => Boolean(entry))
  const rejected = [
    evidence.verdict === "NO_GO" ? "LOOP1_NO_GO" : null,
    evidence.complianceBlocked ? "COMPLIANCE_BLOCKED" : null,
    evidence.estimatedProfit !== null && evidence.estimatedProfit < 5 ? "PROFIT_BELOW_5_USD" : null,
    evidence.roiPercent !== null && evidence.roiPercent < 30 ? "ROI_BELOW_30_PERCENT" : null,
    evidence.netMarginPercent !== null && evidence.netMarginPercent < 20 ? "NET_MARGIN_BELOW_20_PERCENT" : null,
    evidence.stockAvailable !== null && evidence.recommendedPackCount !== null &&
      evidence.stockAvailable < evidence.recommendedPackCount ? "PACK_STOCK_INSUFFICIENT" : null,
  ].filter((entry): entry is string => Boolean(entry))
  if (rejected.length) return { cohort: "REJECTED" as const, reasonCodes: rejected }
  if (needsData.length) return { cohort: "NEEDS_DATA" as const, reasonCodes: needsData }
  const economicsMissing = [evidence.estimatedProfit, evidence.roiPercent, evidence.netMarginPercent]
    .some((value) => value === null)
  if (economicsMissing) return {
    cohort: "NEEDS_DATA" as const,
    reasonCodes: ["CANONICAL_ECONOMICS_REQUIRED"],
  }
  return { cohort: "READY_FOR_OPERATOR_APPROVAL" as const, reasonCodes: [] }
}

export function approvalQueueRankingScore(scores: ApprovalQueueDecisionEvidence["scores"]) {
  return round(
    scores.overallOpportunity * 0.22 +
    scores.demandConfidence * 0.14 +
    scores.marginSafety * 0.16 +
    scores.packStrategy * 0.12 +
    scores.keywordOpportunity * 0.09 +
    scores.visualOpportunity * 0.08 +
    scores.listingReadiness * 0.09 +
    (100 - scores.competitionPressure) * 0.04 +
    scores.freshness * 0.03 +
    scores.operationalSimplicity * 0.03,
  )
}

export function rankApprovalQueue(
  candidates: ApprovalQueueRankedCandidate[],
  limit = 20,
) {
  const sorted = candidates.filter((entry) => entry.cohort === "READY_FOR_OPERATOR_APPROVAL")
    .map((entry) => ({ ...entry, rankingScore: approvalQueueRankingScore(entry.scores), rank: null }))
    .sort((left, right) => right.rankingScore - left.rankingScore ||
      left.supplierSku.localeCompare(right.supplierSku))
  const fingerprints = new Set<string>()
  const products = new Set<string>()
  const categories = new Map<string, number>()
  const selected: ApprovalQueueRankedCandidate[] = []
  for (const candidate of sorted) {
    if (selected.length >= limit) break
    if (!candidate.baseProductFingerprint || fingerprints.has(candidate.baseProductFingerprint)) continue
    if (products.has(candidate.marketRadarProductId)) continue
    const category = candidate.categoryKey ?? "UNCLASSIFIED"
    if ((categories.get(category) ?? 0) >= 3) continue
    fingerprints.add(candidate.baseProductFingerprint)
    products.add(candidate.marketRadarProductId)
    categories.set(category, (categories.get(category) ?? 0) + 1)
    selected.push({ ...candidate, rank: selected.length + 1 })
  }
  return selected
}

export function rankTop20OpportunityPool(
  candidates: ApprovalQueueRankedCandidate[],
  limit = 20,
) {
  const sorted = candidates.filter((entry) => entry.cohort === "READY_FOR_OPERATOR_APPROVAL")
    .map((entry) => ({ ...entry, rank: null, poolRank: null,
      rankingScore: approvalQueueRankingScore(entry.scores) }))
    .sort((left, right) => right.rankingScore - left.rankingScore ||
      left.supplierSku.localeCompare(right.supplierSku))
  const fingerprints = new Set<string>()
  const products = new Set<string>()
  const categories = new Map<string, number>()
  const selected: ApprovalQueueRankedCandidate[] = []
  for (const candidate of sorted) {
    if (selected.length >= limit) break
    const identityKey = candidate.baseProductFingerprint ?? candidate.marketRadarProductId
    if (fingerprints.has(identityKey) || products.has(candidate.marketRadarProductId)) continue
    const category = candidate.categoryKey ?? "UNCLASSIFIED"
    if ((categories.get(category) ?? 0) >= 3) continue
    fingerprints.add(identityKey)
    products.add(candidate.marketRadarProductId)
    categories.set(category, (categories.get(category) ?? 0) + 1)
    selected.push({ ...candidate, poolRank: selected.length + 1 })
  }
  return selected
}

export function buildLunaOperatorConfirmation(input: {
  priceObserved: number
  availability: LunaAvailabilityConfirmation
  exactQuantity?: number | null
  recommendedPackCount: number
  supplierShippingReserveUsd: number
}) {
  if (!Number.isFinite(input.priceObserved) || input.priceObserved < 0) {
    throw new Error("LUNA_PRICE_OBSERVED_INVALID")
  }
  if (!Number.isInteger(input.recommendedPackCount) || input.recommendedPackCount <= 0) {
    throw new Error("RECOMMENDED_PACK_COUNT_INVALID")
  }
  if (!Number.isFinite(input.supplierShippingReserveUsd) || input.supplierShippingReserveUsd < 0) {
    throw new Error("SUPPLIER_SHIPPING_RESERVE_INVALID")
  }
  if (input.availability === "EXACT_QUANTITY_VISIBLE" &&
    (!Number.isInteger(input.exactQuantity) || (input.exactQuantity ?? -1) < 0)) {
    throw new Error("LUNA_EXACT_QUANTITY_REQUIRED")
  }
  const supplierUnitQuantity = input.availability === "EXACT_QUANTITY_VISIBLE"
    ? input.exactQuantity as number : null
  const availableOfferPackCapacity = input.availability === "OUT_OF_STOCK"
    ? 0 : input.availability === "AVAILABLE_QUANTITY_NOT_SHOWN"
      ? 1 : Math.floor((supplierUnitQuantity ?? 0) / input.recommendedPackCount)
  const stockConfidence = input.availability === "OUT_OF_STOCK"
    ? "OUT_OF_STOCK" as const : input.availability === "AVAILABLE_QUANTITY_NOT_SHOWN"
      ? "UNKNOWN_QUANTITY" as const : "EXACT_QUANTITY" as const
  return {
    supplierPriceObserved: Math.round(input.priceObserved * 100) / 100,
    availabilityConfirmation: input.availability,
    supplierUnitQuantity,
    stockConfidence,
    recommendedPackCount: input.recommendedPackCount,
    availableOfferPackCapacity,
    ebayListingQuantity: availableOfferPackCapacity > 0 ? 1 : 0,
    supplierShippingCostStatus: "ESTIMATED" as const,
    supplierShippingReserveUsd: Math.round(input.supplierShippingReserveUsd * 100) / 100,
    requiresAvailabilityRecheckAfterSale: input.availability === "AVAILABLE_QUANTITY_NOT_SHOWN",
    canRemainReady: availableOfferPackCapacity > 0,
    observationReason: availableOfferPackCapacity > 0 ? null : "LUNA_OUT_OF_STOCK_OBSERVATION",
    confirmationHash: hash({
      priceObserved: Math.round(input.priceObserved * 100) / 100,
      availability: input.availability,
      supplierUnitQuantity,
      recommendedPackCount: input.recommendedPackCount,
      availableOfferPackCapacity,
      ebayListingQuantity: availableOfferPackCapacity > 0 ? 1 : 0,
      supplierShippingReserveUsd: Math.round(input.supplierShippingReserveUsd * 100) / 100,
    }),
  }
}

export function approvalQueueEconomicsHash(value: unknown) {
  return hash(value)
}
