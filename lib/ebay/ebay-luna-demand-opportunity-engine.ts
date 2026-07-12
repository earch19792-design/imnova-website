// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { normalizeLunaOpportunityCandidate } from "./ebay-luna-catalog-normalization.ts"
import type {
  EbayBestSellingProductSignal,
} from "./ebay-seller-keyword-demand-gateway.ts"
import type {
  EbayLunaCandidateMarketInput,
  EbayListingObservation,
  EbayListingRotationSignal,
  LunaOpportunityCandidateInput,
  NormalizedLunaOpportunityCandidate,
  OpportunityEngineOptions,
} from "./ebay-luna-opportunity-types.ts"
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { buildEbayInventoryMappingPreviewReadiness } from "./ebay-inventory-mapping-preview-readiness.ts"

export const EBAY_LUNA_DEMAND_OPPORTUNITY_ENGINE_VERSION =
  "EBAY-LUNA-DEMAND-TO-INVENTORY-OPPORTUNITY-ENGINE-V1"

const DEFAULTS = {
  stockFreshnessHours: 24,
  estimatedEbayFeeRate: 0.15,
  fixedOrderFee: 0.30,
  estimatedOutboundShipping: 6.99,
  returnsReserveRate: 0.04,
  promotedListingsReserveRate: 0.05,
  minimumNetProfit: 5,
  minimumNetMarginPercent: 20,
  minimumRoiPercent: 30,
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : round((sorted[middle - 1] + sorted[middle]) / 2)
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower))
}

function normalizedIdentifier(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, "")
}

function titleTokens(value: unknown) {
  return [...new Set(text(value).toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1))]
}

function overlapScore(left: unknown, right: unknown) {
  const leftTokens = titleTokens(left)
  const rightTokens = new Set(titleTokens(right))
  if (!leftTokens.length) return 0
  return Math.round((leftTokens.filter((token) => rightTokens.has(token)).length / leftTokens.length) * 100)
}

function aspectValue(
  aspects: Array<{ name?: string | null; value?: string | null }> | undefined,
  names: string[]
) {
  const normalizedNames = names.map((name) => normalizedIdentifier(name))
  const match = aspects?.find((aspect) => normalizedNames.includes(normalizedIdentifier(aspect.name)))
  return text(match?.value) || null
}

function buildComparableIdentity(
  candidate: NormalizedLunaOpportunityCandidate,
  comparable: Record<string, unknown>
) {
  const listingGtin = normalizedIdentifier(comparable.gtin)
  const candidateGtin = normalizedIdentifier(candidate.gtin)
  const listingBrand = normalizedIdentifier(comparable.brand) ||
    normalizedIdentifier(aspectValue(comparable.localizedAspects as Array<{ name?: string; value?: string }>, ["brand"]))
  const listingMpn = normalizedIdentifier(comparable.mpn) ||
    normalizedIdentifier(aspectValue(comparable.localizedAspects as Array<{ name?: string; value?: string }>, ["mpn", "model"]))
  const candidateBrand = normalizedIdentifier(candidate.brand)
  const candidateMpn = normalizedIdentifier(candidate.mpn)
  const conflicts: string[] = Array.isArray(comparable.identityConflicts)
    ? comparable.identityConflicts.filter((entry): entry is string => typeof entry === "string")
    : []

  if (candidateGtin && listingGtin && candidateGtin !== listingGtin) conflicts.push("GTIN_CONFLICT")
  if (candidateBrand && listingBrand && candidateBrand !== listingBrand) conflicts.push("BRAND_CONFLICT")
  if (candidateMpn && listingMpn && candidateMpn !== listingMpn) conflicts.push("MPN_CONFLICT")

  const exactGtin = Boolean(candidateGtin && listingGtin && candidateGtin === listingGtin)
  const exactBrandMpn = Boolean(
    candidateBrand && listingBrand && candidateBrand === listingBrand &&
    candidateMpn && listingMpn && candidateMpn === listingMpn
  )
  const inheritedScore = numberOrNull(comparable.identityMatchScore) ?? 0
  const identityMatchScore = conflicts.length
    ? 0
    : exactGtin
      ? 100
      : exactBrandMpn
        ? 96
        : inheritedScore
  const identityMatchType = conflicts.length
    ? "CONFLICT"
    : exactGtin
      ? "EXACT_GTIN"
      : exactBrandMpn
        ? "EXACT_BRAND_MPN"
        : identityMatchScore >= 78
          ? "STRONG_ATTRIBUTE_MATCH"
          : "TITLE_SIMILARITY_REVIEW"
  return {
    identityMatchScore,
    identityMatchType,
    identityConflicts: [...new Set(conflicts)],
    exactIdentityConfirmedByIdentifier: exactGtin || exactBrandMpn,
  }
}

export function buildCurrentEbayListingObservations(
  input: EbayLunaCandidateMarketInput,
  observedAtValue: string | Date = new Date()
): EbayListingObservation[] {
  const observedAt = observedAtValue instanceof Date
    ? observedAtValue.toISOString()
    : new Date(observedAtValue).toISOString()
  const candidate = normalizeLunaOpportunityCandidate(input.candidate, observedAt)
  return input.demandReport.topSellingListings.map((listing) => {
    const identity = buildComparableIdentity(candidate, listing)
    return {
      candidateKey: candidate.candidateKey,
      itemId: listing.comparableId,
      sellerId: listing.sellerUsername,
      observedAt,
      estimatedSoldQuantity: listing.estimatedSoldQuantity > 0
        ? listing.estimatedSoldQuantity
        : null,
      price: listing.price > 0 ? listing.price : null,
      shippingCost: listing.shippingCost > 0 ? listing.shippingCost : 0,
      identityMatchScore: identity.identityMatchScore,
      identityMatchType: identity.identityMatchType,
      evidenceSource: listing.evidenceSource,
    }
  })
}

export function calculateEbayListingRotationSignals(
  current: EbayListingObservation[],
  history: EbayListingObservation[] = []
): EbayListingRotationSignal[] {
  return current.map((observation) => {
    const currentTime = new Date(observation.observedAt).getTime()
    const historyForItem = history
      .filter((entry) =>
        entry.itemId === observation.itemId &&
        entry.estimatedSoldQuantity !== null &&
        new Date(entry.observedAt).getTime() < currentTime
      )
    const prior = [...historyForItem]
      .sort((left, right) => new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime())[0]
    const deltaForTargetWindow = (targetDays: number, toleranceDays: number) => {
      if (observation.estimatedSoldQuantity === null) return null
      const target = historyForItem
        .map((entry) => ({
          entry,
          days: (currentTime - new Date(entry.observedAt).getTime()) / 86_400_000,
        }))
        .filter(({ days }) => Math.abs(days - targetDays) <= toleranceDays)
        .sort((left, right) => Math.abs(left.days - targetDays) - Math.abs(right.days - targetDays))[0]
      if (!target || target.entry.estimatedSoldQuantity === null) return null
      const delta = observation.estimatedSoldQuantity - target.entry.estimatedSoldQuantity
      return delta >= 0 ? delta : null
    }
    const estimatedSoldDelta7d = deltaForTargetWindow(7, 3)
    const estimatedSoldDelta30d = deltaForTargetWindow(30, 7)
    if (observation.estimatedSoldQuantity === null) {
      return {
        itemId: observation.itemId,
        sellerId: observation.sellerId,
        observationDays: 0,
        estimatedSoldDelta: null,
        estimatedSoldDelta7d: null,
        estimatedSoldDelta30d: null,
        estimatedWeeklyVelocity: null,
        evidenceClass: "ACTIVE_LISTING_ONLY" as const,
        safeToCallVerifiedSales: false as const,
      }
    }
    if (!prior || prior.estimatedSoldQuantity === null) {
      return {
        itemId: observation.itemId,
        sellerId: observation.sellerId,
        observationDays: 0,
        estimatedSoldDelta: null,
        estimatedSoldDelta7d,
        estimatedSoldDelta30d,
        estimatedWeeklyVelocity: null,
        evidenceClass: "SINGLE_ESTIMATED_SALES_SNAPSHOT" as const,
        safeToCallVerifiedSales: false as const,
      }
    }
    const observationDays = round((currentTime - new Date(prior.observedAt).getTime()) / 86_400_000)
    const delta = observation.estimatedSoldQuantity - prior.estimatedSoldQuantity
    if (delta < 0 || observationDays <= 0) {
      return {
        itemId: observation.itemId,
        sellerId: observation.sellerId,
        observationDays,
        estimatedSoldDelta: null,
        estimatedSoldDelta7d: null,
        estimatedSoldDelta30d: null,
        estimatedWeeklyVelocity: null,
        evidenceClass: "COUNTER_RESET_OR_RELIST_REVIEW" as const,
        safeToCallVerifiedSales: false as const,
      }
    }
    return {
      itemId: observation.itemId,
      sellerId: observation.sellerId,
      observationDays,
      estimatedSoldDelta: delta,
      estimatedSoldDelta7d,
      estimatedSoldDelta30d,
      estimatedWeeklyVelocity: round((delta / observationDays) * 7),
      evidenceClass: "OBSERVED_ESTIMATED_SALES_DELTA" as const,
      safeToCallVerifiedSales: false as const,
    }
  })
}

function buildMarketMetrics(
  input: EbayLunaCandidateMarketInput,
  current: EbayListingObservation[],
  rotations: EbayListingRotationSignal[]
) {
  const exactCurrent = current.filter((entry) => entry.identityMatchScore >= 78)
  const positiveRotations = rotations.filter((entry) =>
    entry.evidenceClass === "OBSERVED_ESTIMATED_SALES_DELTA" &&
    (entry.estimatedSoldDelta ?? 0) > 0
  )
  const totalEstimatedWeeklyVelocity = round(positiveRotations.reduce(
    (sum, entry) => sum + (entry.estimatedWeeklyVelocity ?? 0),
    0
  ))
  const estimatedSoldDelta7d = positiveRotations.reduce(
    (sum, entry) => sum + (entry.estimatedSoldDelta7d ?? 0),
    0
  ) || null
  const estimatedSoldDelta30d = positiveRotations.reduce(
    (sum, entry) => sum + (entry.estimatedSoldDelta30d ?? 0),
    0
  ) || null
  const sellersWithPositiveMovement = new Set(positiveRotations.map((entry) => entry.sellerId)).size
  const largestSellerVelocity = Math.max(0, ...positiveRotations.map((entry) => entry.estimatedWeeklyVelocity ?? 0))
  const sellerConcentrationPercent = totalEstimatedWeeklyVelocity > 0
    ? round((largestSellerVelocity / totalEstimatedWeeklyVelocity) * 100)
    : null
  const totalBuyerPrices = input.demandReport.topSellingListings
    .filter((listing) => exactCurrent.some((entry) => entry.itemId === listing.comparableId))
    .map((listing) => listing.price + (listing.shippingCost ?? 0))
    .filter((price) => price > 0)
  const priceP25 = percentile(totalBuyerPrices, 0.25)
  const priceP75 = percentile(totalBuyerPrices, 0.75)
  const activeExactComparables = exactCurrent.length
  const demandToCompetitionRatio = activeExactComparables > 0
    ? round(totalEstimatedWeeklyVelocity / activeExactComparables)
    : null
  const rotationEvidenceStatus = positiveRotations.length >= 2 && sellersWithPositiveMovement >= 2
    ? "MULTI_SELLER_OBSERVED_ESTIMATED_ROTATION"
    : positiveRotations.length
      ? "CONCENTRATED_OR_SINGLE_SELLER_OBSERVED_ROTATION"
      : "ROTATION_BASELINE_REQUIRED"
  return {
    activeExactComparables,
    totalEstimatedWeeklyVelocity,
    estimatedSoldDelta7d,
    estimatedSoldDelta30d,
    trendAcceleration: estimatedSoldDelta7d !== null && estimatedSoldDelta30d !== null && estimatedSoldDelta30d > 0
      ? round((estimatedSoldDelta7d / 7) / (estimatedSoldDelta30d / 30))
      : null,
    sellersWithPositiveMovement,
    sellerConcentrationPercent,
    demandToCompetitionRatio,
    medianTotalBuyerPrice: median(totalBuyerPrices),
    priceInterquartileRange: priceP25 !== null && priceP75 !== null
      ? { low: priceP25, high: priceP75 }
      : null,
    rotationEvidenceStatus,
    observationWindowDays: Math.max(0, ...rotations.map((entry) => entry.observationDays)),
    marketplaceInsightsStatus: input.demandReport.marketplaceInsightsStatus,
    demandValidationBasis: input.demandReport.demandValidationBasis,
    estimatedSignalsAreVerifiedSales: false,
  }
}

function buildUnitEconomics(
  candidate: NormalizedLunaOpportunityCandidate,
  marketPrice: number | null,
  options: OpportunityEngineOptions
) {
  const config = { ...DEFAULTS, ...options }
  const supplierCost = candidate.supplierCost
  if (marketPrice === null || supplierCost === null) {
    return {
      ready: false,
      marketPrice,
      supplierCost,
      estimatedEbayFees: null,
      estimatedOutboundShipping: config.estimatedOutboundShipping,
      returnsReserve: null,
      promotedListingsReserve: null,
      estimatedNetProfit: null,
      estimatedNetMarginPercent: null,
      estimatedRoiPercent: null,
      minimumProfitablePrice: null,
      passesProfitGate: false,
    }
  }
  const estimatedEbayFees = marketPrice * config.estimatedEbayFeeRate + config.fixedOrderFee
  const returnsReserve = marketPrice * config.returnsReserveRate
  const promotedListingsReserve = marketPrice * config.promotedListingsReserveRate
  const estimatedNetProfit = marketPrice - supplierCost - config.estimatedOutboundShipping -
    estimatedEbayFees - returnsReserve - promotedListingsReserve
  const estimatedNetMarginPercent = marketPrice > 0 ? (estimatedNetProfit / marketPrice) * 100 : 0
  const estimatedRoiPercent = supplierCost > 0 ? (estimatedNetProfit / supplierCost) * 100 : 0
  const variableRate = config.estimatedEbayFeeRate + config.returnsReserveRate +
    config.promotedListingsReserveRate
  const minimumProfitablePrice = (
    supplierCost + config.estimatedOutboundShipping + config.fixedOrderFee + config.minimumNetProfit
  ) / Math.max(0.01, 1 - variableRate)
  const passesProfitGate = estimatedNetProfit >= config.minimumNetProfit &&
    estimatedNetMarginPercent >= config.minimumNetMarginPercent &&
    estimatedRoiPercent >= config.minimumRoiPercent
  return {
    ready: true,
    marketPrice: round(marketPrice),
    supplierCost: round(supplierCost),
    estimatedEbayFees: round(estimatedEbayFees),
    estimatedOutboundShipping: round(config.estimatedOutboundShipping),
    returnsReserve: round(returnsReserve),
    promotedListingsReserve: round(promotedListingsReserve),
    estimatedNetProfit: round(estimatedNetProfit),
    estimatedNetMarginPercent: round(estimatedNetMarginPercent),
    estimatedRoiPercent: round(estimatedRoiPercent),
    minimumProfitablePrice: round(minimumProfitablePrice),
    passesProfitGate,
  }
}

function buildOpportunityScores(
  candidate: NormalizedLunaOpportunityCandidate,
  market: ReturnType<typeof buildMarketMetrics>,
  economics: ReturnType<typeof buildUnitEconomics>,
  maxIdentityScore: number,
  demandReport: EbayLunaCandidateMarketInput["demandReport"]
) {
  const velocityScore = market.totalEstimatedWeeklyVelocity > 0
    ? clamp(market.totalEstimatedWeeklyVelocity * 8)
    : demandReport.demandValidationPassed
      ? 30
      : 5
  const breadthScore = clamp(market.sellersWithPositiveMovement * 30)
  const concentrationPenalty = market.sellerConcentrationPercent !== null &&
    market.sellerConcentrationPercent > 70
    ? Math.min(35, market.sellerConcentrationPercent - 60)
    : 0
  const demandScore = clamp(velocityScore * 0.65 + breadthScore * 0.35 - concentrationPenalty)
  const economicsScore = economics.ready
    ? clamp(
        Math.max(0, economics.estimatedNetProfit ?? 0) * 6 +
        Math.max(0, economics.estimatedNetMarginPercent ?? 0) * 1.4
      )
    : 0
  const competitionScore = market.activeExactComparables === 0
    ? 10
    : market.activeExactComparables <= 5
      ? 80
      : market.activeExactComparables <= 20
        ? 65
        : market.activeExactComparables <= 50
          ? 45
          : 20
  const identityScore = clamp(maxIdentityScore)
  const supplyScore = candidate.available === false
    ? 0
    : candidate.inventoryQuantity !== null && candidate.inventoryQuantity > 0 &&
        candidate.stockAgeHours !== null && candidate.stockAgeHours <= DEFAULTS.stockFreshnessHours
      ? 100
      : candidate.available === true
        ? 50
        : 20
  const listingReadinessScore = clamp(
    candidate.identityDataCompleteness * 0.35 +
    (candidate.weight !== null ? 15 : 0) +
    (candidate.dimensions ? 15 : 0) +
    (candidate.imageAuthorized ? 20 : 0) +
    (demandReport.recommendedListingKeywordStructure.primarySearchPhrase ? 15 : 0)
  )
  const opportunityScore = clamp(
    demandScore * 0.25 + economicsScore * 0.25 + competitionScore * 0.15 +
    identityScore * 0.15 + supplyScore * 0.10 + listingReadinessScore * 0.10
  )
  return {
    opportunityScore,
    demandScore,
    economicsScore,
    competitionScore,
    identityScore,
    supplyScore,
    listingReadinessScore,
    scoreWeights: {
      demand: 0.25,
      economics: 0.25,
      competition: 0.15,
      identity: 0.15,
      supply: 0.10,
      listingReadiness: 0.10,
    },
  }
}

function buildListingIntelligencePackage(
  candidate: NormalizedLunaOpportunityCandidate,
  input: EbayLunaCandidateMarketInput,
  market: ReturnType<typeof buildMarketMetrics>,
  economics: ReturnType<typeof buildUnitEconomics>
) {
  const bestReference = input.demandReport.topSellingListings[0] ?? null
  const observedAspects = bestReference?.localizedAspects ?? []
  return {
    packageStatus: "PARTIAL_INTELLIGENCE_PACKAGE_HUMAN_REVIEW_REQUIRED",
    identity: {
      gtin: candidate.gtin,
      brand: candidate.brand,
      mpn: candidate.mpn,
      color: candidate.color,
      size: candidate.size,
      packQuantity: candidate.packQuantity,
      variantTitle: candidate.variantTitle,
    },
    titleStrategy: input.demandReport.recommendedListingKeywordStructure,
    buyerIntent: input.demandReport.highestPotentialBuyerIntent,
    categoryRecommendation: {
      categoryId: input.taxonomyIntelligence?.categoryId ?? bestReference?.categoryId ?? candidate.categoryId,
      categoryName: input.taxonomyIntelligence?.categoryName ?? bestReference?.categoryName ?? candidate.categoryHint,
      taxonomyStatus: input.taxonomyIntelligence?.status ?? "NEED_EBAY_TAXONOMY_ASPECT_REQUIREMENTS",
      requiredAspects: input.taxonomyIntelligence?.requiredAspects ?? [],
      recommendedAspects: input.taxonomyIntelligence?.recommendedAspects ?? [],
    },
    itemSpecifics: {
      supplierConfirmed: {
        Brand: candidate.brand,
        MPN: candidate.mpn,
        GTIN: candidate.gtin,
        Color: candidate.color,
        Size: candidate.size,
      },
      observedFromComparableForReviewOnly: observedAspects,
      inventedValuesAllowed: false,
    },
    pricing: {
      ...economics,
      observedPriceRange: market.priceInterquartileRange,
    },
    offerPatterns: {
      referenceListingId: bestReference?.comparableId ?? null,
      referenceSellerCount: input.demandReport.sellersAnalyzed,
      shippingCostObserved: bestReference?.shippingCost ?? null,
      returnsAcceptedObserved: bestReference?.returnsAccepted ?? null,
      exactCompetitorTitleCopied: false,
      competitorImagesCopied: false,
    },
    imagePlan: {
      authorizedLunaImagesAvailable: candidate.imageAuthorized && candidate.imageUrls.length > 0,
      sourceImageCount: candidate.imageUrls.length,
      mainImage: "Authorized exact product on a clean background",
      secondaryImages: [
        "front and packaging",
        "size or quantity",
        "important product details",
        "honest use case",
      ],
      ebayImagesReferenceOnly: true,
    },
    compliance: {
      pendingRestrictionGuards: candidate.restrictionGuards,
      claimsMustBeSupplierVerified: true,
      humanReviewRequired: true,
    },
    inventoryMappingPreview: {
      recommended: true,
      ...buildEbayInventoryMappingPreviewReadiness(
        candidate,
        input.taxonomyIntelligence
      ),
      purpose: "Use eBay AI preview as a second opinion, never as automatic truth.",
    },
  }
}

export function buildEbayLunaOpportunityAssessment(
  input: EbayLunaCandidateMarketInput,
  options: OpportunityEngineOptions = {}
) {
  const now = options.now ?? new Date()
  const candidate = normalizeLunaOpportunityCandidate(input.candidate, now)
  const current = buildCurrentEbayListingObservations(input, now)
  const rotations = calculateEbayListingRotationSignals(
    current,
    input.observationHistory ?? []
  )
  const enrichedListings = input.demandReport.topSellingListings.map((listing) => ({
    ...listing,
    ...buildComparableIdentity(candidate, listing),
  }))
  const eligibleIdentityListings = enrichedListings.filter((listing) =>
    listing.identityConflicts.length === 0 && listing.identityMatchScore >= 78
  )
  const maxIdentityScore = Math.max(0, ...eligibleIdentityListings.map((listing) => listing.identityMatchScore))
  const exactIdentityConfirmed = eligibleIdentityListings.some(
    (listing) => listing.exactIdentityConfirmedByIdentifier
  )
  const market = buildMarketMetrics(input, current, rotations)
  const economics = buildUnitEconomics(candidate, market.medianTotalBuyerPrice, options)
  const scores = buildOpportunityScores(
    candidate,
    market,
    economics,
    maxIdentityScore,
    input.demandReport
  )
  const config = { ...DEFAULTS, ...options }
  const hardGates = [
    candidate.available === false ? "LUNA_OUT_OF_STOCK" : "",
    candidate.available !== false && (candidate.inventoryQuantity === null || candidate.inventoryQuantity <= 0)
      ? "NEED_CONFIRMED_LUNA_STOCK_QUANTITY" : "",
    candidate.stockAgeHours === null || candidate.stockAgeHours > config.stockFreshnessHours
      ? "NEED_FRESH_LUNA_STOCK" : "",
    !exactIdentityConfirmed ? "NEED_EXACT_GTIN_OR_BRAND_MPN_MATCH" : "",
    candidate.supplierCost === null ? "NEED_CONFIRMED_SUPPLIER_COST" : "",
    candidate.weight === null || !candidate.dimensions ? "NEED_PACKAGE_WEIGHT_AND_DIMENSIONS" : "",
    !candidate.imageAuthorized ? "NEED_AUTHORIZED_PRODUCT_IMAGES" : "",
    ...candidate.restrictionGuards,
    economics.ready && !economics.passesProfitGate ? "UNIT_ECONOMICS_BELOW_MINIMUM" : "",
  ].filter(Boolean)
  const evidenceGuards = [
    market.rotationEvidenceStatus === "ROTATION_BASELINE_REQUIRED"
      ? "NEED_7D_OR_30D_ROTATION_BASELINE" : "",
    market.sellersWithPositiveMovement < 2 && market.totalEstimatedWeeklyVelocity > 0
      ? "SINGLE_SELLER_ROTATION_CONCENTRATION" : "",
    market.sellerConcentrationPercent !== null && market.sellerConcentrationPercent > 70
      ? "HIGH_SELLER_CONCENTRATION" : "",
    !input.demandReport.demandValidationPassed ? "NEED_MULTI_SELLER_DEMAND_EVIDENCE" : "",
  ].filter(Boolean)
  const listingPackage = buildListingIntelligencePackage(candidate, input, market, economics)
  const canProceedToListingPackage = hardGates.length === 0 &&
    evidenceGuards.length === 0 && scores.opportunityScore >= 70
  const decision = candidate.available === false || hardGates.includes("UNIT_ECONOMICS_BELOW_MINIMUM")
    ? "REJECT_OR_HOLD"
    : !exactIdentityConfirmed
      ? "MATCH_REVIEW_REQUIRED"
      : evidenceGuards.includes("NEED_7D_OR_30D_ROTATION_BASELINE")
        ? "WATCHLIST_BASELINE_REQUIRED"
        : canProceedToListingPackage
          ? "LISTING_PACKAGE_READY_FOR_HUMAN_REVIEW"
          : "OPPORTUNITY_REVIEW_REQUIRED"
  return {
    engineVersion: EBAY_LUNA_DEMAND_OPPORTUNITY_ENGINE_VERSION,
    candidate,
    decision,
    identity: {
      exactIdentityConfirmed,
      maxIdentityScore,
      eligibleComparableCount: eligibleIdentityListings.length,
      comparables: enrichedListings,
      matchingPriority: ["GTIN", "BRAND_MPN", "EPID", "ATTRIBUTES", "TITLE_HUMAN_REVIEW"],
    },
    market,
    currentObservations: current,
    rotations,
    economics,
    scores,
    hardGates,
    evidenceGuards,
    listingIntelligencePackage: listingPackage,
    expectedMonthlyOpportunity: {
      estimatedMarketUnits30d: market.totalEstimatedWeeklyVelocity > 0
        ? round((market.totalEstimatedWeeklyVelocity / 7) * 30)
        : null,
      attainableShareMustBeHumanApproved: true,
      projectedNetProfitNotClaimedWithoutAttainableShare: true,
    },
    canProceedToListingPackage,
    canProceedToControlledDraftPreflight: false,
    canPublish: false,
    ebayWriteUsed: false,
    estimatedSignalsAreVerifiedSales: false,
    humanApprovalRequired: true,
  }
}

export type EbayLunaOpportunityAssessment = ReturnType<
  typeof buildEbayLunaOpportunityAssessment
>

export function rankEbayLunaOpportunities(
  assessments: ReturnType<typeof buildEbayLunaOpportunityAssessment>[]
) {
  return [...assessments]
    .sort((left, right) =>
      Number(right.canProceedToListingPackage) - Number(left.canProceedToListingPackage) ||
      right.scores.opportunityScore - left.scores.opportunityScore ||
      right.scores.economicsScore - left.scores.economicsScore ||
      left.candidate.candidateKey.localeCompare(right.candidate.candidateKey)
    )
    .map((assessment, index) => ({ ...assessment, rank: index + 1 }))
}

export function matchEbayBestSellingProductsToLuna(
  signals: EbayBestSellingProductSignal[],
  candidates: LunaOpportunityCandidateInput[]
) {
  const normalized = candidates.map((candidate) => normalizeLunaOpportunityCandidate(candidate))
  return signals.flatMap((signal) => normalized.map((candidate) => {
    const score = overlapScore(candidate.title, signal.title)
    return {
      epid: signal.epid,
      ebayProductTitle: signal.title,
      categoryId: signal.categoryId,
      candidateKey: candidate.candidateKey,
      lunaProductTitle: candidate.title,
      discoveryMatchScore: score,
      route: score >= 80
        ? "NEED_EXACT_IDENTIFIER_CONFIRMATION"
        : score >= 55
          ? "POSSIBLE_LUNA_MATCH_HUMAN_REVIEW"
          : "NO_MATCH",
      bestSellingEvidenceIsProductLevel: true,
      salesQuantityClaimed: false,
      humanConfirmationRequired: true,
    }
  })).filter((match) => match.discoveryMatchScore >= 55)
    .sort((left, right) => right.discoveryMatchScore - left.discoveryMatchScore)
}
