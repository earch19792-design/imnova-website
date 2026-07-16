import { createHash } from "node:crypto"

export const EBAY_WINNER_EVIDENCE_V2_VERSION =
  "EBAY_WINNER_EVIDENCE_PRODUCT_DECISION_V2_2026_07_16"
export const PRODUCT_IDENTITY_FINGERPRINT_VERSION =
  "EBAY_PRODUCT_IDENTITY_FINGERPRINT_V2"
export const WINNER_ECONOMICS_CONFIG_VERSION =
  "EBAY_WINNER_ECONOMICS_US_V2"

export const WINNER_ECONOMICS_CONFIG = Object.freeze({
  minimumProfitUsd: 5,
  idealProfitUsd: 7,
  minimumRoiPercent: 30,
  minimumNetMarginPercent: 20,
  estimatedEbayFeeRate: 0.15,
  fixedOrderFee: 0.30,
  returnsReserveRate: 0.04,
  promotedListingsReserveRate: 0.05,
})

export type WinnerComparableClassification =
  | "EXACT_MATCH"
  | "NEAR_MATCH"
  | "DIFFERENT_PACK"
  | "DIFFERENT_VARIANT"
  | "INSUFFICIENT_EVIDENCE"
  | "INVALID_COMPARABLE"

export type WinnerEvidenceCohort =
  | "ACTIVE_EXACT_MATCHES"
  | "SOLD_OR_COMPLETED_EXACT_MATCHES"
  | "ESTIMATED_DEMAND_SIGNALS"

export type WinnerComparableSource =
  | "EBAY_BROWSE_ACTIVE_LISTING"
  | "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
  | "EBAY_BROWSE_ESTIMATED_SALES"
  | "EBAY_OFFICIAL_CSV_IMPORT"
  | "EBAY_OFFICIAL_JSON_IMPORT"
  | "HUMAN_REVIEWED_IMPORT"

export type ProductIdentityInput = {
  manufacturerBrand?: string | null
  distributor?: string | null
  vendor?: string | null
  gtin?: string | null
  mpn?: string | null
  model?: string | null
  productName?: string | null
  packCount?: number | null
  unitCount?: number | null
  size?: string | null
  color?: string | null
  scent?: string | null
  variant?: string | null
  condition?: string | null
}

export type WinnerComparableInput = {
  source: WinnerComparableSource
  sourceListingId?: string | null
  observedAt?: string | null
  identity: ProductIdentityInput
  itemPrice?: number | null
  shippingCost?: number | null
  currency?: string | null
  confirmedSoldQuantity?: number | null
  estimatedSoldQuantity?: number | null
  keywords?: string[] | null
  shippingPattern?: string | null
  returnsPattern?: string | null
  imageCount?: number | null
  evidenceReviewed?: boolean | null
}

export type WinnerEvidenceInput = {
  marketplaceAccountKey: string
  candidateId?: string | null
  supplierSku: string
  supplierVariantId?: string | null
  identity: ProductIdentityInput
  comparables?: WinnerComparableInput[] | null
  supplierPackageCost?: number | null
  packagingCost?: number | null
  outboundShippingCost?: number | null
  fixedFulfillmentCost?: number | null
  authorizedKeywords?: string[] | null
  requiredKeywordCount?: number | null
  complianceBlocked?: boolean | null
  complianceFindings?: string[] | null
  stockAvailable?: number | null
  stockObservedAt?: string | null
  costObservedAt?: string | null
  now?: string | Date | null
}

type CanonicalIdentity = {
  manufacturerBrand: string | null
  distributor: string | null
  vendor: string | null
  gtin: string | null
  gtinValid: boolean
  mpn: string | null
  model: string | null
  normalizedProductName: string | null
  packCount: number | null
  unitCount: number | null
  size: string | null
  color: string | null
  scent: string | null
  variant: string | null
  condition: string | null
}

function normalizedText(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return normalized || null
}

function identityText(value: unknown) {
  return normalizedText(value)?.toLocaleLowerCase("en-US") ?? null
}

function normalizedPositiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function finiteNonNegative(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

export function validateGtinChecksum(value: unknown) {
  const gtin = typeof value === "string" ? value.replace(/[\s-]/g, "") : ""
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false
  const digits = [...gtin].map(Number)
  const check = digits.pop() ?? -1
  let sum = 0
  for (let index = digits.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += digits[index] * (position % 2 === 0 ? 3 : 1)
  }
  return (10 - (sum % 10)) % 10 === check
}

export function normalizeProductIdentity(input: ProductIdentityInput): CanonicalIdentity {
  const rawGtin = normalizedText(input.gtin)?.replace(/[\s-]/g, "") ?? null
  const gtinValid = validateGtinChecksum(rawGtin)
  return {
    manufacturerBrand: identityText(input.manufacturerBrand),
    distributor: identityText(input.distributor),
    vendor: identityText(input.vendor),
    gtin: gtinValid ? rawGtin : null,
    gtinValid,
    mpn: identityText(input.mpn),
    model: identityText(input.model),
    normalizedProductName: identityText(input.productName),
    packCount: normalizedPositiveInteger(input.packCount),
    unitCount: normalizedPositiveInteger(input.unitCount),
    size: identityText(input.size),
    color: identityText(input.color),
    scent: identityText(input.scent),
    variant: identityText(input.variant),
    condition: identityText(input.condition),
  }
}

export function buildProductIdentityFingerprint(input: ProductIdentityInput) {
  const identity = normalizeProductIdentity(input)
  const fingerprintPayload = {
    version: PRODUCT_IDENTITY_FINGERPRINT_VERSION,
    manufacturerBrand: identity.manufacturerBrand,
    gtin: identity.gtin,
    mpn: identity.mpn,
    model: identity.model,
    normalizedProductName: identity.normalizedProductName,
    packCount: identity.packCount,
    unitCount: identity.unitCount,
    size: identity.size,
    color: identity.color,
    scent: identity.scent,
    variant: identity.variant,
    condition: identity.condition,
  }
  return {
    version: PRODUCT_IDENTITY_FINGERPRINT_VERSION,
    fingerprint: sha256(fingerprintPayload),
    identity,
    excludesCommercialFields: true,
  }
}

function sameNullable(left: unknown, right: unknown) {
  return left === right || (left === null && right === null)
}

function explicitConflict(left: unknown, right: unknown) {
  return left !== null && right !== null && left !== right
}

function identityStrength(identity: CanonicalIdentity) {
  const exactIdentifier = identity.gtinValid || Boolean(
    identity.manufacturerBrand && (identity.mpn || identity.model),
  )
  const productFacts = [
    identity.normalizedProductName,
    identity.packCount,
    identity.unitCount,
    identity.size,
    identity.variant,
    identity.condition,
  ].filter((value) => value !== null).length
  return {
    strong: exactIdentifier && Boolean(identity.packCount && identity.condition) && productFacts >= 4,
    exactIdentifier,
    productFacts,
  }
}

export function classifyWinnerComparable(
  targetInput: ProductIdentityInput,
  comparableInput: ProductIdentityInput,
): { classification: WinnerComparableClassification; reasons: string[] } {
  const target = normalizeProductIdentity(targetInput)
  const comparable = normalizeProductIdentity(comparableInput)
  if (!target.normalizedProductName || !comparable.normalizedProductName) {
    return { classification: "INVALID_COMPARABLE", reasons: ["PRODUCT_NAME_REQUIRED"] }
  }
  if (target.condition && comparable.condition && target.condition !== comparable.condition) {
    return { classification: "INVALID_COMPARABLE", reasons: ["CONDITION_MISMATCH"] }
  }
  if (
    explicitConflict(target.packCount, comparable.packCount) ||
    explicitConflict(target.unitCount, comparable.unitCount)
  ) return { classification: "DIFFERENT_PACK", reasons: ["PACK_OR_UNIT_COUNT_MISMATCH"] }
  const variantFields = ["size", "color", "scent", "variant"] as const
  const variantConflicts = variantFields.filter((field) => explicitConflict(target[field], comparable[field]))
  if (variantConflicts.length) {
    return {
      classification: "DIFFERENT_VARIANT",
      reasons: variantConflicts.map((field) => `${field.toUpperCase()}_MISMATCH`),
    }
  }
  if (target.gtin && comparable.gtin && target.gtin !== comparable.gtin) {
    return { classification: "INVALID_COMPARABLE", reasons: ["GTIN_CONFLICT"] }
  }
  const gtinExact = Boolean(target.gtin && comparable.gtin && target.gtin === comparable.gtin)
  const brandExact = Boolean(
    target.manufacturerBrand && comparable.manufacturerBrand &&
    target.manufacturerBrand === comparable.manufacturerBrand,
  )
  const modelExact = Boolean(
    (target.mpn && comparable.mpn && target.mpn === comparable.mpn) ||
    (target.model && comparable.model && target.model === comparable.model),
  )
  const nameExact = target.normalizedProductName === comparable.normalizedProductName
  const packComplete = target.packCount !== null && comparable.packCount !== null &&
    sameNullable(target.packCount, comparable.packCount)
  const exact = (gtinExact || (brandExact && modelExact)) && packComplete &&
    !variantFields.some((field) => explicitConflict(target[field], comparable[field]))
  if (exact) {
    return {
      classification: "EXACT_MATCH",
      reasons: [gtinExact ? "GTIN_EXACT" : "BRAND_MODEL_EXACT", nameExact ? "NAME_EXACT" : "NAME_COMPATIBLE"],
    }
  }
  if ((brandExact && nameExact) || (modelExact && nameExact)) {
    return { classification: "NEAR_MATCH", reasons: ["IDENTIFIER_OR_PACK_EVIDENCE_INCOMPLETE"] }
  }
  return { classification: "INSUFFICIENT_EVIDENCE", reasons: ["IDENTITY_EVIDENCE_INSUFFICIENT"] }
}

function comparableCohort(source: WinnerComparableSource): WinnerEvidenceCohort | null {
  if (source === "EBAY_BROWSE_ACTIVE_LISTING") return "ACTIVE_EXACT_MATCHES"
  if ([
    "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
    "EBAY_OFFICIAL_CSV_IMPORT",
    "EBAY_OFFICIAL_JSON_IMPORT",
    "HUMAN_REVIEWED_IMPORT",
  ].includes(source)) return "SOLD_OR_COMPLETED_EXACT_MATCHES"
  if (source === "EBAY_BROWSE_ESTIMATED_SALES") return "ESTIMATED_DEMAND_SIGNALS"
  return null
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function weightedMedian(rows: Array<{ value: number; weight: number }>) {
  const usable = rows.filter((row) => Number.isFinite(row.value) && row.value >= 0 && row.weight > 0)
    .sort((left, right) => left.value - right.value)
  if (!usable.length) return null
  const total = usable.reduce((sum, row) => sum + row.weight, 0)
  let accumulated = 0
  for (const row of usable) {
    accumulated += row.weight
    if (accumulated >= total / 2) return row.value
  }
  return usable.at(-1)?.value ?? null
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const position = Math.max(0, Math.min(1, ratio)) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function economicsAtPrice(price: number | null, totalBaseCost: number | null) {
  if (price === null || price <= 0 || totalBaseCost === null) return null
  const variableRate = WINNER_ECONOMICS_CONFIG.estimatedEbayFeeRate +
    WINNER_ECONOMICS_CONFIG.returnsReserveRate +
    WINNER_ECONOMICS_CONFIG.promotedListingsReserveRate
  const variableFees = price * variableRate
  const profit = price - totalBaseCost - WINNER_ECONOMICS_CONFIG.fixedOrderFee - variableFees
  const margin = (profit / price) * 100
  const roi = totalBaseCost > 0 ? (profit / totalBaseCost) * 100 : null
  return {
    price: roundMoney(price),
    estimatedProfit: roundMoney(profit),
    estimatedNetMarginPercent: roundScore(margin),
    estimatedRoiPercent: roi === null ? null : roundScore(roi),
    passes: profit >= WINNER_ECONOMICS_CONFIG.minimumProfitUsd &&
      margin >= WINNER_ECONOMICS_CONFIG.minimumNetMarginPercent &&
      roi !== null && roi >= WINNER_ECONOMICS_CONFIG.minimumRoiPercent,
  }
}

function safePriceForProfit(totalBaseCost: number, profit: number) {
  const variableRate = WINNER_ECONOMICS_CONFIG.estimatedEbayFeeRate +
    WINNER_ECONOMICS_CONFIG.returnsReserveRate +
    WINNER_ECONOMICS_CONFIG.promotedListingsReserveRate
  const profitFloor = (totalBaseCost + WINNER_ECONOMICS_CONFIG.fixedOrderFee + profit) /
    (1 - variableRate)
  const marginFloor = (totalBaseCost + WINNER_ECONOMICS_CONFIG.fixedOrderFee) /
    (1 - variableRate - WINNER_ECONOMICS_CONFIG.minimumNetMarginPercent / 100)
  const roiFloor = (
    totalBaseCost + WINNER_ECONOMICS_CONFIG.fixedOrderFee +
    totalBaseCost * WINNER_ECONOMICS_CONFIG.minimumRoiPercent / 100
  ) / (1 - variableRate)
  return roundMoney(Math.ceil(Math.max(profitFloor, marginFloor, roiFloor) * 100) / 100)
}

function normalizedKeywords(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map(identityText)
    .filter((entry): entry is string => Boolean(entry)))]
}

export function buildWinnerEvidenceDecisionPackage(input: WinnerEvidenceInput) {
  const now = input.now ? new Date(input.now) : new Date()
  if (!Number.isFinite(now.getTime())) throw new Error("WINNER_EVIDENCE_NOW_INVALID")
  const marketplaceAccountKey = normalizedText(input.marketplaceAccountKey)
  const supplierSku = normalizedText(input.supplierSku)
  if (!marketplaceAccountKey || !supplierSku) throw new Error("WINNER_EVIDENCE_SCOPE_REQUIRED")
  const fingerprint = buildProductIdentityFingerprint(input.identity)
  const strength = identityStrength(fingerprint.identity)
  const normalizedComparables = (input.comparables ?? []).map((comparable, index) => {
    const classification = classifyWinnerComparable(input.identity, comparable.identity)
    const itemPrice = finiteNonNegative(comparable.itemPrice)
    const shippingCost = finiteNonNegative(comparable.shippingCost)
    const landedPrice = itemPrice === null || shippingCost === null
      ? null
      : roundMoney(itemPrice + shippingCost)
    const comparableIdentity = normalizeProductIdentity(comparable.identity)
    const totalUnits = comparableIdentity.packCount && comparableIdentity.unitCount
      ? comparableIdentity.packCount * comparableIdentity.unitCount
      : null
    const packageCount = comparableIdentity.packCount
    const cohort = classification.classification === "EXACT_MATCH"
      ? comparableCohort(comparable.source)
      : null
    const reviewedImport = [
      "EBAY_OFFICIAL_CSV_IMPORT",
      "EBAY_OFFICIAL_JSON_IMPORT",
      "HUMAN_REVIEWED_IMPORT",
    ].includes(comparable.source)
    const sourceAccepted = !reviewedImport || comparable.evidenceReviewed === true
    const confirmedSoldQuantity = finiteNonNegative(comparable.confirmedSoldQuantity)
    return {
      comparableKey: sha256({
        source: comparable.source,
        sourceListingId: normalizedText(comparable.sourceListingId) ?? `row-${index + 1}`,
        identity: comparableIdentity,
        observedAt: normalizedText(comparable.observedAt),
      }),
      source: comparable.source,
      sourceListingId: normalizedText(comparable.sourceListingId),
      observedAt: normalizedText(comparable.observedAt),
      classification: sourceAccepted ? classification.classification : "INVALID_COMPARABLE" as const,
      classificationReasons: sourceAccepted
        ? classification.reasons
        : ["IMPORTED_EVIDENCE_REQUIRES_HUMAN_REVIEW"],
      cohort: sourceAccepted ? cohort : null,
      identity: comparableIdentity,
      pricing: {
        currency: normalizedText(comparable.currency) ?? "USD",
        itemPrice: itemPrice === null ? null : roundMoney(itemPrice),
        shippingCost: shippingCost === null ? null : roundMoney(shippingCost),
        landedPrice,
        packagePrice: landedPrice === null || packageCount === null
          ? null
          : roundMoney(landedPrice / packageCount),
        unitPrice: landedPrice === null || totalUnits === null
          ? null
          : roundMoney(landedPrice / totalUnits),
      },
      confirmedSoldQuantity: comparable.source === "EBAY_BROWSE_ESTIMATED_SALES"
        ? null
        : confirmedSoldQuantity,
      estimatedSoldQuantity: comparable.source === "EBAY_BROWSE_ESTIMATED_SALES"
        ? finiteNonNegative(comparable.estimatedSoldQuantity)
        : null,
      keywords: normalizedKeywords(comparable.keywords),
      patterns: {
        shipping: normalizedText(comparable.shippingPattern),
        returns: normalizedText(comparable.returnsPattern),
        imageCount: finiteNonNegative(comparable.imageCount),
      },
      competitorTitleStored: false,
      competitorDescriptionStored: false,
      competitorImagesStored: false,
      sellerIdentityStored: false,
    }
  })
  const activeExact = normalizedComparables.filter((row) => row.cohort === "ACTIVE_EXACT_MATCHES")
  const soldExact = normalizedComparables.filter((row) => row.cohort === "SOLD_OR_COMPLETED_EXACT_MATCHES")
  const estimatedSignals = normalizedComparables.filter((row) => row.cohort === "ESTIMATED_DEMAND_SIGNALS")
  const activePrices = activeExact.map((row) => row.pricing.landedPrice)
    .filter((value): value is number => value !== null)
  const soldPrices = soldExact.map((row) => ({
    value: row.pricing.landedPrice,
    weight: row.confirmedSoldQuantity ?? 1,
  })).filter((row): row is { value: number; weight: number } => row.value !== null)
  const weightedSoldMedian = weightedMedian(soldPrices)
  const activeMarketMedian = median(activePrices)
  const supplierPackageCost = finiteNonNegative(input.supplierPackageCost)
  const ancillaryCosts = [input.packagingCost, input.outboundShippingCost, input.fixedFulfillmentCost]
    .map(finiteNonNegative)
  const totalBaseCost = supplierPackageCost === null || ancillaryCosts.some((cost) => cost === null)
    ? null
    : roundMoney(supplierPackageCost + ancillaryCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0))
  const minimumSafePrice = totalBaseCost === null
    ? null
    : safePriceForProfit(totalBaseCost, WINNER_ECONOMICS_CONFIG.minimumProfitUsd)
  const idealSafePrice = totalBaseCost === null
    ? null
    : safePriceForProfit(totalBaseCost, WINNER_ECONOMICS_CONFIG.idealProfitUsd)
  const evidenceAnchor = weightedSoldMedian ?? activeMarketMedian
  const aggressiveLaunchPrice = minimumSafePrice === null || evidenceAnchor === null
    ? null
    : roundMoney(Math.max(minimumSafePrice, evidenceAnchor * 0.97))
  const competitivePrice = minimumSafePrice === null || activeMarketMedian === null
    ? null
    : roundMoney(Math.max(minimumSafePrice, activeMarketMedian))
  const targetPrice = idealSafePrice === null || evidenceAnchor === null
    ? null
    : roundMoney(Math.max(idealSafePrice, evidenceAnchor))
  const premiumAnchor = percentile(
    [...activePrices, ...soldPrices.map((row) => row.value)],
    0.75,
  )
  const premiumPrice = idealSafePrice === null || premiumAnchor === null
    ? null
    : roundMoney(Math.max(idealSafePrice, premiumAnchor))
  const targetEconomics = economicsAtPrice(targetPrice, totalBaseCost)
  const keywordSet = new Set(normalizedComparables.flatMap((row) => row.keywords))
  const authorizedKeywords = normalizedKeywords(input.authorizedKeywords)
  const requiredKeywordCount = Math.max(1, normalizedPositiveInteger(input.requiredKeywordCount) ?? 5)
  const keywordCoverage = authorizedKeywords.length
    ? authorizedKeywords.filter((keyword) => keywordSet.has(keyword)).length / requiredKeywordCount
    : 0
  const confirmedSoldUnits = soldExact.reduce(
    (sum, row) => sum + (row.confirmedSoldQuantity ?? 0),
    0,
  )
  const demandConfidence = roundScore(
    Math.min(65, soldExact.length * 22) +
    Math.min(20, Math.log10(confirmedSoldUnits + 1) * 20) +
    Math.min(15, activeExact.length * 3),
  )
  const competitionPressure = roundScore(
    Math.min(70, activeExact.length * 8) +
    (activePrices.length >= 2 && activeMarketMedian
      ? Math.min(30, ((Math.max(...activePrices) - Math.min(...activePrices)) / activeMarketMedian) * 50)
      : 0),
  )
  const marginSafety = targetEconomics?.passes
    ? roundScore(60 + Math.min(40, (targetEconomics.estimatedProfit - WINNER_ECONOMICS_CONFIG.minimumProfitUsd) * 8))
    : 0
  const keywordOpportunity = roundScore(keywordCoverage * 100)
  const listingReadiness = roundScore(
    (strength.strong ? 35 : strength.exactIdentifier ? 20 : 0) +
    (targetEconomics?.passes ? 30 : 0) +
    (activeExact.length || soldExact.length ? 20 : 0) +
    (input.complianceBlocked === true ? 0 : 10) +
    (finiteNonNegative(input.stockAvailable) !== null ? 5 : 0),
  )
  const overallOpportunity = roundScore(
    demandConfidence * 0.25 +
    (100 - competitionPressure) * 0.10 +
    marginSafety * 0.25 +
    keywordOpportunity * 0.15 +
    listingReadiness * 0.25,
  )
  const evidenceSufficientForGo = soldExact.length >= 1
  const evidenceSufficientForConditionalGo = evidenceSufficientForGo || activeExact.length >= 2
  const blockers = [
    !strength.strong ? "PRODUCT_IDENTITY_NOT_STRONG" : null,
    input.complianceBlocked === true ? "COMPLIANCE_BLOCKED" : null,
    !targetEconomics?.passes ? "ECONOMICS_NOT_VIABLE" : null,
    !evidenceSufficientForConditionalGo ? "EXACT_EVIDENCE_INSUFFICIENT" : null,
  ].filter((value): value is string => Boolean(value))
  const verdict = blockers.length
    ? "NO_GO" as const
    : evidenceSufficientForGo && listingReadiness >= 75
      ? "GO" as const
      : "GO_WITH_CHANGES" as const
  const recommendedAction = verdict === "GO"
    ? "APPROVE_DECISION_PACKAGE_FOR_LISTING_FACTORY"
    : verdict === "GO_WITH_CHANGES"
      ? "REVIEW_REQUIRED_CHANGES_BEFORE_LISTING_FACTORY"
      : "RESOLVE_BLOCKERS_OR_SELECT_ANOTHER_PRODUCT"
  const packagePayload = {
    packageVersion: EBAY_WINNER_EVIDENCE_V2_VERSION,
    generatedAt: now.toISOString(),
    marketplace: "EBAY_US" as const,
    marketplaceAccountKey,
    candidateId: normalizedText(input.candidateId),
    supplierSku,
    supplierVariantId: normalizedText(input.supplierVariantId),
    productIdentity: fingerprint,
    comparables: {
      classified: normalizedComparables,
      cohorts: {
        ACTIVE_EXACT_MATCHES: activeExact,
        SOLD_OR_COMPLETED_EXACT_MATCHES: soldExact,
        ESTIMATED_DEMAND_SIGNALS: estimatedSignals,
      },
      counts: {
        activeExact: activeExact.length,
        soldOrCompletedExact: soldExact.length,
        estimatedDemandSignals: estimatedSignals.length,
        excludedOrNonExact: normalizedComparables.length - activeExact.length - soldExact.length - estimatedSignals.length,
      },
      sources: {
        active: "EBAY_BROWSE_API",
        soldOrCompleted: soldExact.some((row) => row.source === "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY")
          ? "EBAY_MARKETPLACE_INSIGHTS"
          : soldExact.length
            ? "REVIEWED_IMPORT"
            : "UNAVAILABLE",
        scrapingUsed: false,
        browserAutomationUsed: false,
      },
    },
    economics: {
      configVersion: WINNER_ECONOMICS_CONFIG_VERSION,
      config: WINNER_ECONOMICS_CONFIG,
      currency: "USD",
      supplierPackageCost,
      totalBaseCost,
      minimumSafePrice,
      idealSafePrice,
      aggressiveLaunchPrice,
      competitivePrice,
      targetPrice,
      premiumPrice,
      weightedSoldMedian: weightedSoldMedian === null ? null : roundMoney(weightedSoldMedian),
      activeMarketMedian: activeMarketMedian === null ? null : roundMoney(activeMarketMedian),
      targetEconomics,
      unavailableValuesRenderAs: "N/D",
    },
    scores: {
      demandConfidence,
      competitionPressure,
      marginSafety,
      keywordOpportunity,
      listingReadiness,
      overallOpportunity,
    },
    compliance: {
      blocked: input.complianceBlocked === true,
      findings: (input.complianceFindings ?? []).map(normalizedText).filter(Boolean),
    },
    inventoryEvidence: {
      stockAvailable: finiteNonNegative(input.stockAvailable),
      stockObservedAt: normalizedText(input.stockObservedAt),
      costObservedAt: normalizedText(input.costObservedAt),
    },
    decision: {
      verdict,
      blockers,
      evidenceSufficientForGo,
      evidenceSufficientForConditionalGo,
      recommendedAction,
      humanApprovalRequired: true,
    },
    safety: {
      advisoryOnly: true,
      officialReadOnlySourcesOnly: true,
      manualEvidenceNeverPresentedAsOfficialApi: true,
      soldAndEstimatedSignalsSeparated: true,
      competitorContentCopied: false,
      competitorImagesCopied: false,
      piiStored: false,
      ebayWrites: 0,
      canPublish: false,
    },
  }
  const inputHash = sha256({ ...input, now: undefined })
  return {
    ...packagePayload,
    inputHash,
    packageHash: sha256({ ...packagePayload, generatedAt: undefined }),
  }
}

export type WinnerEvidenceDecisionPackage = ReturnType<
  typeof buildWinnerEvidenceDecisionPackage
>
