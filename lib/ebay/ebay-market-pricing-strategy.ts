export const EBAY_MARKET_PRICING_STRATEGY_VERSION =
  "EBAY_MARKET_PRICING_STRATEGY_V2_2026_07_19"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveNumber(value: unknown) {
  const parsed = finiteNumber(value)
  return parsed !== null && parsed > 0 ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = finiteNumber(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function moneyUp(value: number) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? money(sorted[middle])
    : money((sorted[middle - 1] + sorted[middle]) / 2)
}

function packCountFromTitle(value: unknown) {
  const title = text(value).toLocaleLowerCase("en-US")
  const multiplied = title.match(/\b(\d{1,3})\s*(?:sets?|packs?)\b.{0,30}?\b(\d{1,3})\s*(?:pcs?|pieces?)\b/i)
  if (multiplied) return positiveInteger(multiplied[1])! * positiveInteger(multiplied[2])!
  const explicit = title.match(/\b(?:pack|set|lot|case)\s+(?:of\s+)?(\d{1,3})\b/i) ??
    title.match(/\b(\d{1,3})\s*(?:pcs?|pieces?|pack|pk)\b/i)
  return positiveInteger(explicit?.[1])
}

function structuredPackCount(entry: JsonRecord) {
  const direct = positiveInteger(entry.lotSize)
  if (direct) return { value: direct, source: "STRUCTURED" as const }
  for (const aspect of rows(entry.localizedAspects)) {
    const name = text(aspect.name).toLocaleLowerCase("en-US")
    if (!["number in pack", "pack quantity", "pack size"].includes(name)) continue
    const value = positiveInteger(text(aspect.value).match(/\d{1,3}/)?.[0])
    if (value) return { value, source: "STRUCTURED" as const }
  }
  const derived = packCountFromTitle(entry.title)
  return derived ? { value: derived, source: "TITLE_DERIVED" as const } : null
}

type SafeComparable = {
  packCount: number
  offerMultiplier: number
  landedPrice: number
  seller: string
  historicalSold: boolean
  soldQuantity: number
  packResolution: "STRUCTURED" | "TITLE_DERIVED" | "SINGLE_PRESENTATION_INFERRED"
}

function normalizedBrand(value: unknown) {
  return text(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim()
}

function comparableBrand(entry: JsonRecord) {
  const direct = normalizedBrand(entry.brand)
  if (direct) return direct
  const aspect = rows(entry.localizedAspects).find((candidate) =>
    normalizedBrand(candidate.name) === "brand")
  return normalizedBrand(aspect?.value)
}

function safeComparable(entry: JsonRecord, nativePackCount: number,
  confirmedBrand: string): SafeComparable | null {
  const currency = text(entry.currency).toUpperCase() || "USD"
  const price = positiveNumber(entry.price)
  const shipping = finiteNumber(entry.shippingCost) ?? 0
  const competitorBrand = comparableBrand(entry)
  if (confirmedBrand && competitorBrand !== confirmedBrand) return null
  let resolvedPack: { value: number; source: SafeComparable["packResolution"] } | null =
    structuredPackCount(entry)
  if (!resolvedPack) {
    for (const aspect of rows(entry.localizedAspects)) {
      if (normalizedBrand(aspect.name) !== "unit quantity") continue
      const value = positiveInteger(text(aspect.value).match(/\d{1,3}/)?.[0])
      if (value === nativePackCount) {
        resolvedPack = { value, source: "STRUCTURED" as const }
        break
      }
    }
  }
  const conflicts = Array.isArray(entry.identityConflicts)
    ? entry.identityConflicts.map(text).filter(Boolean)
    : []
  if (!resolvedPack && nativePackCount === 1 && entry.eligibleComparable === true &&
    text(entry.identityMatchQuality).toUpperCase() === "EXACT" &&
    !conflicts.includes("OFFER_PACK_CONFLICT")) {
    resolvedPack = { value: 1, source: "SINGLE_PRESENTATION_INFERRED" as const }
  }
  if (currency !== "USD" || price === null || shipping < 0 || !resolvedPack) return null
  if (resolvedPack.value % nativePackCount !== 0) return null

  const onlyPackConflict = conflicts.every((conflict) => conflict === "OFFER_PACK_CONFLICT")
  const safeSamePack = entry.eligibleComparable === true && resolvedPack.value === nativePackCount
  const safeRelatedPack = entry.baseIdentifierExact === true && onlyPackConflict
  if (!safeSamePack && !safeRelatedPack) return null

  const historicalSold = text(entry.evidenceSource) ===
    "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY" && entry.verifiedSoldRecent === true
  return {
    packCount: resolvedPack.value,
    offerMultiplier: resolvedPack.value / nativePackCount,
    landedPrice: money(price + shipping),
    seller: text(entry.sellerUsername).toLocaleLowerCase("en-US"),
    historicalSold,
    soldQuantity: historicalSold ? Math.max(0, Math.trunc(finiteNumber(entry.verifiedSoldQuantity) ?? 0)) : 0,
    packResolution: resolvedPack.source,
  }
}

function distribution(entries: SafeComparable[]) {
  if (!entries.length) return null
  const prices = entries.map((entry) => entry.landedPrice)
  const sellers = new Set(entries.map((entry) => entry.seller).filter(Boolean))
  const sellerCount = sellers.size
  const sampleSize = entries.length
  const titleDerivedCount = entries.filter((entry) => entry.packResolution === "TITLE_DERIVED").length
  const soldQuantity = entries.reduce((sum, entry) => sum + entry.soldQuantity, 0)
  const confidence = sampleSize >= 3 && sellerCount >= 2 && titleDerivedCount === 0
    ? "HIGH" as const
    : sampleSize >= 2 && sellerCount >= 2
      ? "MEDIUM" as const
      : "LOW" as const
  return {
    sampleSize,
    sellerCount,
    soldQuantity,
    minimumLandedPrice: money(Math.min(...prices)),
    medianLandedPrice: median(prices),
    maximumLandedPrice: money(Math.max(...prices)),
    confidence,
    structuredPackCount: sampleSize - titleDerivedCount,
    titleDerivedPackCount: titleDerivedCount,
  }
}

export function aggregateEbayMarketPricingByPack(input: {
  comparableEvidence: unknown
  nativePackCount: number | null
  confirmedBrand?: unknown
  observedAt?: string
}) {
  const nativePackCount = positiveInteger(input.nativePackCount)
  if (!nativePackCount) {
    return {
      version: EBAY_MARKET_PRICING_STRATEGY_VERSION,
      status: "NATIVE_PACK_REQUIRED" as const,
      nativePackCount: null,
      currentPresentation: null,
      cohorts: [],
      strategicPresentation: null,
      presentationPortfolio: { candidates: [], verifiedSalesThreshold: {
        minimumObservations: 2, minimumSellers: 2, minimumSoldQuantity: 3 } },
      observedAt: input.observedAt ?? new Date().toISOString(),
      individualSellerDataStored: false,
    }
  }

  const confirmedBrand = normalizedBrand(input.confirmedBrand)
  const comparables = rows(input.comparableEvidence)
    .map((entry) => safeComparable(entry, nativePackCount, confirmedBrand))
    .filter((entry): entry is SafeComparable => entry !== null)
  const packCounts = [...new Set(comparables.map((entry) => entry.packCount))]
    .sort((left, right) => left - right)
  const cohorts = packCounts.map((packCount) => {
    const cohort = comparables.filter((entry) => entry.packCount === packCount)
    const sold = distribution(cohort.filter((entry) => entry.historicalSold))
    const active = distribution(cohort.filter((entry) => !entry.historicalSold))
    const reference = sold && sold.sampleSize >= 2 && sold.sellerCount >= 2
      ? sold
      : active
    return {
      packCount,
      offerMultiplier: packCount / nativePackCount,
      sold,
      active,
      preferredEvidenceTier: sold && sold.sampleSize >= 2 && sold.sellerCount >= 2
        ? "PRODUCT_RESEARCH_SOLD" as const
        : active
          ? "SELL_SIMILAR_ACTIVE" as const
          : "INSUFFICIENT" as const,
      referenceConfidence: reference?.confidence ?? "LOW",
    }
  })
  const reliableCohorts = cohorts.filter((cohort) => {
    const reference = cohort.preferredEvidenceTier === "PRODUCT_RESEARCH_SOLD"
      ? cohort.sold
      : cohort.active
    return Boolean(reference && reference.sampleSize >= 2 && reference.sellerCount >= 2)
  })
  const ranked = [...reliableCohorts].sort((left, right) => {
    const leftSold = left.sold?.soldQuantity ?? 0
    const rightSold = right.sold?.soldQuantity ?? 0
    const leftScore = (left.preferredEvidenceTier === "PRODUCT_RESEARCH_SOLD" ? 10_000 : 0) +
      leftSold * 10 + (left.sold?.sampleSize ?? left.active?.sampleSize ?? 0) * 3 +
      (left.sold?.sellerCount ?? left.active?.sellerCount ?? 0) * 5
    const rightScore = (right.preferredEvidenceTier === "PRODUCT_RESEARCH_SOLD" ? 10_000 : 0) +
      rightSold * 10 + (right.sold?.sampleSize ?? right.active?.sampleSize ?? 0) * 3 +
      (right.sold?.sellerCount ?? right.active?.sellerCount ?? 0) * 5
    return rightScore - leftScore || left.packCount - right.packCount
  })
  const leader = ranked[0] ?? null
  const portfolioCandidates = cohorts
    .filter((cohort) => cohort.sold && cohort.sold.sampleSize >= 2 &&
      cohort.sold.sellerCount >= 2 && cohort.sold.soldQuantity >= 3)
    .map((cohort) => ({
      packCount: cohort.packCount,
      offerMultiplier: cohort.offerMultiplier,
      evidenceTier: "PRODUCT_RESEARCH_SOLD" as const,
      confidence: cohort.sold!.confidence,
      soldObservationCount: cohort.sold!.sampleSize,
      soldSellerCount: cohort.sold!.sellerCount,
      confirmedSoldQuantity: cohort.sold!.soldQuantity,
      medianLandedPrice: cohort.sold!.medianLandedPrice,
      minimumLandedPrice: cohort.sold!.minimumLandedPrice,
      maximumLandedPrice: cohort.sold!.maximumLandedPrice,
      automaticallyQualified: true,
    }))
  return {
    version: EBAY_MARKET_PRICING_STRATEGY_VERSION,
    status: cohorts.length ? "AVAILABLE" as const : "INSUFFICIENT_EQUIVALENT_MARKET_DATA" as const,
    nativePackCount,
    currentPresentation: cohorts.find((cohort) => cohort.packCount === nativePackCount) ?? null,
    cohorts,
    strategicPresentation: leader
      ? {
          recommendedPackCountForEvaluation: leader.packCount,
          offerMultiplier: leader.offerMultiplier,
          evidenceTier: leader.preferredEvidenceTier,
          confidence: leader.referenceConfidence,
          requiresFulfillmentConfirmation: leader.packCount !== nativePackCount,
          automaticallyRanked: true,
        }
      : null,
    presentationPortfolio: {
      candidates: portfolioCandidates,
      verifiedSalesThreshold: {
        minimumObservations: 2,
        minimumSellers: 2,
        minimumSoldQuantity: 3,
      },
      activeListingsAloneCanQualify: false,
    },
    observedAt: input.observedAt ?? new Date().toISOString(),
    individualSellerDataStored: false,
  }
}

function referenceFromDistribution(value: unknown, source: string) {
  const entry = record(value)
  const sampleSize = positiveInteger(entry.sampleSize) ?? 0
  const sellerCount = positiveInteger(entry.sellerCount) ?? 0
  const medianLandedPrice = positiveNumber(entry.medianLandedPrice)
  const minimumLandedPrice = positiveNumber(entry.minimumLandedPrice)
  const maximumLandedPrice = positiveNumber(entry.maximumLandedPrice)
  if (sampleSize < 2 || sellerCount < 2 || medianLandedPrice === null ||
    minimumLandedPrice === null || maximumLandedPrice === null) return null
  return {
    source,
    sampleSize,
    sellerCount,
    medianPrice: medianLandedPrice,
    minimumPrice: minimumLandedPrice,
    maximumPrice: maximumLandedPrice,
    confidence: text(entry.confidence) || "MEDIUM",
    priceBasis: "LANDED_PRICE" as const,
  }
}

function productResearchReference(value: unknown, now: Date) {
  const reference = record(value)
  if (text(reference.evidenceTier) !== "CONFIRMED_SOLD_EXACT") return null
  const freshUntil = Date.parse(text(reference.freshUntil ?? reference.expiresAt))
  if (Number.isFinite(freshUntil) && freshUntil <= now.getTime()) return null
  const range = record(reference.soldPriceRange)
  const sampleSize = positiveInteger(reference.exactListingSampleSize) ?? 0
  const sellerCount = positiveInteger(reference.exactSellerCount ?? reference.sellerCount) ?? 0
  const averageShipping = finiteNumber(reference.averageShippingCost) ?? 0
  const medianPrice = positiveNumber(reference.weightedAverageSoldPrice)
  const minimumPrice = positiveNumber(range.minimum)
  const maximumPrice = positiveNumber(range.maximum)
  if (sampleSize < 2 || sellerCount < 2 || medianPrice === null ||
    minimumPrice === null || maximumPrice === null) return null
  return {
    source: "EBAY_PRODUCT_RESEARCH_EXACT_SOLD",
    sampleSize,
    sellerCount,
    medianPrice: money(medianPrice + averageShipping),
    minimumPrice: money(minimumPrice + averageShipping),
    maximumPrice: money(maximumPrice + averageShipping),
    confidence: text(reference.confidence) || "MEDIUM",
    priceBasis: averageShipping > 0
      ? "SOLD_PRICE_PLUS_REPORTED_AVERAGE_SHIPPING" as const
      : "SOLD_ITEM_PRICE" as const,
  }
}

export function buildEbayMarketPricingRecommendation(input: {
  minimumOperatorPrice: number | null
  controlledRiskMinimumPrice?: number | null
  marketPricing: unknown
  exactSoldMarketReference?: unknown
  confirmedRelatedPackStrategy?: unknown
  variationAspectNames?: unknown
  controlledExploratoryTest?: boolean
  now?: Date
}) {
  const floor = positiveNumber(input.minimumOperatorPrice)
  const marketPricing = record(input.marketPricing)
  const currentPresentation = record(marketPricing.currentPresentation)
  const soldReference = referenceFromDistribution(
    currentPresentation.sold,
    "EBAY_PRODUCT_RESEARCH_EQUIVALENT_PACK_SOLD",
  )
  const activeReference = referenceFromDistribution(
    currentPresentation.active,
    "EBAY_SELL_SIMILAR_EQUIVALENT_PACK_ACTIVE",
  )
  const marketReference = productResearchReference(
    input.exactSoldMarketReference,
    input.now ?? new Date(),
  ) ?? soldReference ?? activeReference
  const provisionalFloorPrice = floor === null ? null : moneyUp(floor)
  const controlledRiskMinimumPrice = positiveNumber(input.controlledRiskMinimumPrice)
  const controlledRiskPrice = controlledRiskMinimumPrice === null
    ? null : moneyUp(controlledRiskMinimumPrice)
  const controlledExploratoryFloorUsed = Boolean(
    input.controlledExploratoryTest && floor !== null && !marketReference,
  )
  const ownCostFloorAboveMarket = Boolean(
    floor !== null && marketReference && floor > marketReference.maximumPrice,
  )
  const controlledRiskActiveMarketFallbackUsed = Boolean(
    ownCostFloorAboveMarket && controlledRiskPrice !== null && marketReference &&
    controlledRiskPrice <= marketReference.maximumPrice,
  )
  const recommendedSalePrice = floor === null
    ? null
    : marketReference
      ? controlledRiskActiveMarketFallbackUsed
        ? moneyUp(Math.max(controlledRiskPrice!, marketReference.medianPrice))
        : ownCostFloorAboveMarket
        ? null
        : moneyUp(Math.max(floor, marketReference.medianPrice))
      : controlledExploratoryFloorUsed
        ? provisionalFloorPrice
        : null
  const competitiveness = floor === null
    ? "ECONOMICS_NOT_READY" as const
    : !marketReference
      ? controlledExploratoryFloorUsed
        ? "UNBENCHMARKED_CONTROLLED_TEST" as const
        : "MARKET_REFERENCE_INSUFFICIENT" as const
      : controlledRiskActiveMarketFallbackUsed
        ? "CONTROLLED_RISK_COMPETITIVE" as const
        : floor <= marketReference.medianPrice
        ? "COMPETITIVE" as const
        : floor <= marketReference.maximumPrice
          ? "MARGINAL" as const
          : "NOT_COMPETITIVE" as const
  const strategicPresentation = record(marketPricing.strategicPresentation)
  const confirmedRelatedPackStrategy = record(input.confirmedRelatedPackStrategy)
  const recommendedPackCount = positiveInteger(marketPricing.nativePackCount)
  const relatedPackCount = positiveInteger(
    confirmedRelatedPackStrategy.suggestedPackCountForEvaluation ??
    strategicPresentation.recommendedPackCountForEvaluation,
  )
  const portfolio = record(marketPricing.presentationPortfolio)
  const evidenceBackedPresentations = rows(portfolio.candidates).map((entry) => ({
    packCount: positiveInteger(entry.packCount),
    offerMultiplier: positiveNumber(entry.offerMultiplier),
    evidenceTier: text(entry.evidenceTier),
    confidence: text(entry.confidence),
    soldObservationCount: positiveInteger(entry.soldObservationCount) ?? 0,
    soldSellerCount: positiveInteger(entry.soldSellerCount) ?? 0,
    confirmedSoldQuantity: positiveInteger(entry.confirmedSoldQuantity) ?? 0,
    medianLandedPrice: positiveNumber(entry.medianLandedPrice),
    minimumLandedPrice: positiveNumber(entry.minimumLandedPrice),
    maximumLandedPrice: positiveNumber(entry.maximumLandedPrice),
    economicsStatus: positiveInteger(entry.packCount) === recommendedPackCount
      ? "CURRENT_PRESENTATION_PRICE_READY" as const
      : "EXACT_FULFILLMENT_COST_REQUIRED" as const,
  })).filter((entry) => entry.packCount !== null)
  const normalizedVariationAspects = Array.isArray(input.variationAspectNames)
    ? input.variationAspectNames.map((value) => text(value).toLocaleLowerCase("en-US"))
    : []
  const packVariationSupported = normalizedVariationAspects.some((name) =>
    ["number in pack", "pack quantity", "pack size", "unit quantity"].includes(name))
  const publicationRoute = evidenceBackedPresentations.length <= 1
    ? "SINGLE_PRESENTATION" as const
    : packVariationSupported
      ? "ONE_LISTING_WITH_PACK_VARIATIONS" as const
      : "DISTINCT_BUNDLE_LISTINGS_POLICY_REVIEW_REQUIRED" as const
  return {
    version: EBAY_MARKET_PRICING_STRATEGY_VERSION,
    status: floor === null
      ? "ECONOMICS_NOT_READY" as const
      : !marketReference
        ? controlledExploratoryFloorUsed
          ? "CONTROLLED_TEST_PRICE_READY_FOR_HUMAN_APPROVAL" as const
          : "MARKET_REFERENCE_REQUIRED" as const
        : controlledRiskActiveMarketFallbackUsed
          ? "CONTROLLED_RISK_ACTIVE_MARKET_PRICE_READY_FOR_HUMAN_APPROVAL" as const
          : ownCostFloorAboveMarket
          ? "OWN_COST_FLOOR_ABOVE_MARKET" as const
          : "RECOMMENDATION_READY_FOR_HUMAN_APPROVAL" as const,
    currency: "USD",
    ownCostFloor: provisionalFloorPrice,
    provisionalFloorPrice,
    recommendedSalePrice,
    competitiveness,
    marketReferenceUsed: Boolean(marketReference),
    controlledExploratoryFloorUsed,
    controlledRiskActiveMarketFallbackUsed,
    controlledRiskMinimumPrice: controlledRiskPrice,
    promotionAllowed: controlledRiskActiveMarketFallbackUsed ? false : null,
    promotedListingsReserveRate: controlledRiskActiveMarketFallbackUsed ? 0 : null,
    minimumNetMarginPercent: controlledRiskActiveMarketFallbackUsed ? 10 : null,
    marketReference: marketReference ?? null,
    recommendedPackCount,
    relatedPackStrategy: relatedPackCount && relatedPackCount !== recommendedPackCount
      ? {
          recommendedPackCountForEvaluation: relatedPackCount,
          offerMultiplier: positiveNumber(strategicPresentation.offerMultiplier) ??
            (recommendedPackCount ? relatedPackCount / recommendedPackCount : null),
          evidenceTier: text(confirmedRelatedPackStrategy.evidenceTier) ||
            text(strategicPresentation.evidenceTier),
          confidence: text(strategicPresentation.confidence) ||
            text(rows(confirmedRelatedPackStrategy.candidates).find((candidate) =>
              positiveInteger(candidate.packCount) === relatedPackCount)?.confidence) || "LOW",
          confirmedSoldQuantity: positiveInteger(
            confirmedRelatedPackStrategy.confirmedSoldQuantity,
          ) ?? 0,
          publicationRecommendation:
            "PREPARE_PACK_LISTING_AFTER_EXACT_ECONOMICS" as const,
          requiresFulfillmentConfirmation: true,
          requiresExactPackEconomics: true,
          requiresStockConfirmation: true,
          humanApprovalRequired: true,
          automaticallyRanked: true,
        }
      : null,
    publicationPortfolio: {
      evidenceBackedPresentations,
      publicationRoute,
      packVariationSupported,
      categoryVariationAspects: normalizedVariationAspects,
      automaticPortfolioDecisionUsed: true,
      currentPresentationCanProceedIndependently: true,
      alternativePresentationsRequireExactFulfillmentCost: true,
      duplicateListingPolicyCheckRequired: publicationRoute ===
        "DISTINCT_BUNDLE_LISTINGS_POLICY_REVIEW_REQUIRED",
    },
    decisionLogic: marketReference
      ? controlledRiskActiveMarketFallbackUsed
        ? "TEN_PERCENT_FLOOR_WITHOUT_PROMOTION_INSIDE_EQUIVALENT_MARKET_RANGE"
        : ownCostFloorAboveMarket
        ? "OWN_COST_FLOOR_ABOVE_EQUIVALENT_PACK_MARKET_MAXIMUM"
        : "OWN_COST_FLOOR_THEN_EQUIVALENT_PACK_MARKET_MEDIAN"
      : controlledExploratoryFloorUsed
        ? "OWN_COST_FLOOR_CONTROLLED_TEST_QUANTITY_ONE"
        : "OWN_COST_FLOOR_ONLY_MARKET_SAMPLE_INSUFFICIENT",
    automaticRecommendationUsed: (Boolean(marketReference) &&
      (!ownCostFloorAboveMarket || controlledRiskActiveMarketFallbackUsed)) ||
      controlledExploratoryFloorUsed,
    humanPriceApprovalRequired: true,
    manualPriceEntryRequired: false,
    fulfillmentConfirmationRequired: true,
    imageRightsConfirmationRequired: true,
    individualCompetitorPriceCopied: false,
  }
}
