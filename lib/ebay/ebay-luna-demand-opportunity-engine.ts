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
  "EBAY-SELLER-COMMAND-CENTER-OPPORTUNITY-ENGINE-V2"

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

function demandListings(input: EbayLunaCandidateMarketInput) {
  return input.demandReport.comparableEvidence.length
    ? input.demandReport.comparableEvidence
    : input.demandReport.topSellingListings
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
  let conflicts: string[] = Array.isArray(comparable.identityConflicts)
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
  // An exact GTIN is the strongest identifier and wins over a soft supplier
  // vendor/brand spelling disagreement. Variant, GTIN and MPN conflicts remain
  // hard because they can indicate a genuinely different item.
  const softIdentityConflicts = exactGtin
    ? conflicts.filter((conflict) =>
        conflict === "BRAND_CONFLICT" ||
        conflict === "BRAND_CONFLICT_OVERRIDDEN_BY_EXACT_GTIN"
      )
    : []
  if (exactGtin) {
    conflicts = conflicts.filter((conflict) =>
      conflict !== "BRAND_CONFLICT" &&
      conflict !== "BRAND_CONFLICT_OVERRIDDEN_BY_EXACT_GTIN"
    )
  }
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
    softIdentityConflicts: [...new Set(softIdentityConflicts)],
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
  return demandListings(input).map((listing) => {
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
  const exactCurrent = current.filter((entry) =>
    ["EXACT_GTIN", "EXACT_BRAND_MPN"].includes(entry.identityMatchType)
  )
  const exactObservationIds = new Set(exactCurrent.map((entry) => entry.itemId))
  const positiveRotations = rotations.filter((entry) =>
    exactObservationIds.has(entry.itemId) &&
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
  const velocityBySeller = new Map<string, number>()
  for (const rotation of positiveRotations) {
    const sellerKey = normalizedIdentifier(rotation.sellerId) || "unknownseller"
    velocityBySeller.set(
      sellerKey,
      (velocityBySeller.get(sellerKey) ?? 0) + (rotation.estimatedWeeklyVelocity ?? 0),
    )
  }
  const sellersWithPositiveMovement = velocityBySeller.size
  const largestSellerVelocity = Math.max(0, ...velocityBySeller.values())
  const sellerConcentrationPercent = totalEstimatedWeeklyVelocity > 0
    ? round((largestSellerVelocity / totalEstimatedWeeklyVelocity) * 100)
    : null
  const totalBuyerPrices = demandListings(input)
    .filter((listing) => exactCurrent.some((entry) => entry.itemId === listing.comparableId))
    .map((listing) => listing.price + (listing.shippingCost ?? 0))
    .filter((price) => price > 0)
  const priceP25 = percentile(totalBuyerPrices, 0.25)
  const priceP75 = percentile(totalBuyerPrices, 0.75)
  const activeExactComparables = exactCurrent.filter((entry) =>
    entry.evidenceSource !== "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"
  ).length
  const recentSoldEvidence = input.demandReport.evidenceBuckets
  const verifiedRecentSoldHistory =
    recentSoldEvidence.identifierExactRecentSoldSellerCount >= 2 &&
    recentSoldEvidence.identifierExactRecentSoldQuantity >= 3
  const demandToCompetitionRatio = activeExactComparables > 0
    ? round(totalEstimatedWeeklyVelocity / activeExactComparables)
    : null
  const rotationEvidenceStatus = positiveRotations.length >= 2 && sellersWithPositiveMovement >= 2
    ? "MULTI_SELLER_OBSERVED_ESTIMATED_ROTATION"
    : verifiedRecentSoldHistory
      ? "MULTI_SELLER_VERIFIED_RECENT_SOLD_HISTORY"
    : positiveRotations.length
      ? "CONCENTRATED_OR_SINGLE_SELLER_OBSERVED_ROTATION"
      : "ROTATION_BASELINE_REQUIRED"
  return {
    candidateListingsFound: recentSoldEvidence.candidateFoundCount,
    strongSimilarComparables: recentSoldEvidence.strongSimilarCount,
    identifierExactActiveComparables: recentSoldEvidence.identifierExactActiveCount,
    identifierExactRecentSoldComparables: recentSoldEvidence.identifierExactRecentSoldCount,
    identifierExactRecentSoldSellers: recentSoldEvidence.identifierExactRecentSoldSellerCount,
    identifierExactRecentSoldQuantity: recentSoldEvidence.identifierExactRecentSoldQuantity,
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
    conservativeTotalBuyerPrice: priceP25,
    priceInterquartileRange: priceP25 !== null && priceP75 !== null
      ? { low: priceP25, high: priceP75 }
      : null,
    rotationEvidenceStatus,
    verifiedRecentSoldHistoryCanReplaceBrowseBaseline: verifiedRecentSoldHistory,
    demandEvidenceRoute: rotationEvidenceStatus === "MULTI_SELLER_OBSERVED_ESTIMATED_ROTATION"
      ? "EXACT_BROWSE_SNAPSHOT_DELTAS"
      : verifiedRecentSoldHistory
        ? "OFFICIAL_RECENT_EXACT_SOLD_HISTORY"
        : "INSUFFICIENT_EXACT_MULTI_SELLER_EVIDENCE",
    observationWindowDays: Math.max(0, ...rotations.map((entry) => entry.observationDays)),
    marketplaceInsightsStatus: input.demandReport.marketplaceInsightsStatus,
    demandValidationBasis: input.demandReport.demandValidationBasis,
    estimatedSignalsAreVerifiedSales: false,
  }
}

function buildUnitEconomics(
  candidate: NormalizedLunaOpportunityCandidate,
  marketPrice: number | null,
  options: OpportunityEngineOptions,
  pricingBasis = "EXACT_COMPARABLE_TOTAL_BUYER_PRICE_P25"
) {
  const config = { ...DEFAULTS, ...options }
  const supplierCost = candidate.supplierCost
  if (marketPrice === null || supplierCost === null) {
    return {
      ready: false,
      marketPrice,
      pricingBasis,
      conservativeEstimate: true,
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
    pricingBasis,
    conservativeEstimate: true,
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
  demandReport: EbayLunaCandidateMarketInput["demandReport"],
  taxonomyConfidence: number,
  dimensionsRequired: boolean,
) {
  const velocityScore = market.totalEstimatedWeeklyVelocity > 0
    ? clamp(market.totalEstimatedWeeklyVelocity * 8)
    : market.verifiedRecentSoldHistoryCanReplaceBrowseBaseline
      ? clamp(
          45 + market.identifierExactRecentSoldSellers * 15 +
          Math.log10(market.identifierExactRecentSoldQuantity + 1) * 10
        )
      : demandReport.demandValidationPassed
        ? 25
      : 5
  const demandSellerBreadth = Math.max(
    market.sellersWithPositiveMovement,
    market.identifierExactRecentSoldSellers,
  )
  const breadthScore = clamp(demandSellerBreadth * 30)
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
    ? market.verifiedRecentSoldHistoryCanReplaceBrowseBaseline ? 45 : 10
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
    (candidate.weight !== null ? 25 : 0) +
    (!dimensionsRequired || candidate.dimensions ? 15 : 0) +
    (candidate.imageAuthorized ? 30 : 0) +
    (demandReport.recommendedListingKeywordStructure.primarySearchPhrase ? 15 : 0) +
    (candidate.sku ? 15 : 0)
  )
  const trendScore = market.trendAcceleration === null
    ? market.verifiedRecentSoldHistoryCanReplaceBrowseBaseline ? 60 : 45
    : market.trendAcceleration >= 1.5
      ? 100
      : market.trendAcceleration >= 1
        ? 75
        : market.trendAcceleration >= 0.7
          ? 50
          : 25
  const potentialScore = clamp(
    demandScore * 0.30 + economicsScore * 0.25 + competitionScore * 0.15 +
    supplyScore * 0.10 + listingReadinessScore * 0.10 + trendScore * 0.10
  )
  const demandEvidenceConfidence = market.demandEvidenceRoute === "EXACT_BROWSE_SNAPSHOT_DELTAS"
    ? 100
    : market.demandEvidenceRoute === "OFFICIAL_RECENT_EXACT_SOLD_HISTORY"
      ? 95
      : market.totalEstimatedWeeklyVelocity > 0
        ? 40
        : 10
  const stockConfidence = candidate.stockAgeHours !== null &&
    candidate.stockAgeHours <= DEFAULTS.stockFreshnessHours &&
    candidate.inventoryQuantity !== null && candidate.inventoryQuantity > 0
    ? 100
    : candidate.available === true
      ? 45
      : 0
  const confidenceScore = clamp(
    identityScore * 0.35 + demandEvidenceConfidence * 0.30 +
    taxonomyConfidence * 0.15 + stockConfidence * 0.10 +
    (economics.ready ? 100 : 0) * 0.10
  )
  const stockUrgency = candidate.inventoryQuantity === null
    ? 20
    : candidate.inventoryQuantity <= 5
      ? 90
      : candidate.inventoryQuantity <= 20
        ? 65
        : 45
  const evidenceUrgency = market.demandEvidenceRoute === "INSUFFICIENT_EXACT_MULTI_SELLER_EVIDENCE"
    ? 20
    : 80
  const urgencyScore = clamp(trendScore * 0.50 + stockUrgency * 0.25 + evidenceUrgency * 0.25)
  // Priority combines independent axes once. Confidence is a probability-like
  // multiplier, while urgency can only adjust the result by 15%; raw demand,
  // identity or readiness are never re-added downstream.
  const sellerPriorityScore = clamp(
    potentialScore * (confidenceScore / 100) * (0.85 + (urgencyScore / 100) * 0.15)
  )
  return {
    opportunityScore: sellerPriorityScore,
    potentialScore,
    confidenceScore,
    urgencyScore,
    sellerPriorityScore,
    demandScore,
    economicsScore,
    competitionScore,
    identityScore,
    supplyScore,
    listingReadinessScore,
    trendScore,
    demandEvidenceConfidence,
    taxonomyConfidence,
    scoreWeights: {
      demand: 0.30,
      economics: 0.25,
      competition: 0.15,
      supply: 0.10,
      listingReadiness: 0.10,
      trend: 0.10,
      identityAffectsPotential: false,
      priorityFormula: "potential × confidence × bounded urgency multiplier",
    },
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiresPackageDimensions(input: EbayLunaCandidateMarketInput) {
  const metadata = object(input.candidate.metadata)
  const explicit = metadata.requiresPackageDimensions ??
    metadata.packageDimensionsRequired ??
    metadata.calculatedShipping
  if (explicit === true) return true
  return input.taxonomyIntelligence?.requiredAspects.some((aspect) =>
    /(?:package|shipping).*(?:dimension|length|width|height)/i.test(aspect.name)
  ) === true
}

function candidateAspectFacts(
  candidate: NormalizedLunaOpportunityCandidate,
  input: EbayLunaCandidateMarketInput,
) {
  const metadata = object(input.candidate.metadata)
  const facts = new Map<string, unknown>()
  const add = (name: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== "") {
      facts.set(normalizedIdentifier(name), value)
    }
  }
  add("Brand", candidate.brand)
  add("MPN", candidate.mpn)
  add("Model", candidate.mpn)
  add("GTIN", candidate.gtin)
  add("UPC", candidate.gtin)
  add("EAN", candidate.gtin)
  add("Color", candidate.color)
  add("Size", candidate.size)
  add("Type", candidate.productType)
  add("Number in Pack", candidate.packQuantity)
  add("Unit Quantity", candidate.packQuantity)
  add("Package Dimensions", candidate.dimensions)
  for (const [name, value] of Object.entries(metadata)) add(name, value)
  return facts
}

function buildTaxonomyVerification(
  candidate: NormalizedLunaOpportunityCandidate,
  input: EbayLunaCandidateMarketInput,
) {
  const taxonomy = input.taxonomyIntelligence
  if (!taxonomy) {
    return {
      status: "NOT_REQUESTED_LEGACY_COMPATIBILITY" as const,
      categoryConfirmed: false,
      missingRequiredAspects: [] as string[],
      confidence: 50,
      hardGuards: [] as string[],
    }
  }
  if (taxonomy.status !== "AVAILABLE" || !taxonomy.categoryId) {
    return {
      status: "CATEGORY_NOT_CONFIRMED" as const,
      categoryConfirmed: false,
      missingRequiredAspects: taxonomy.requiredAspects.map((aspect) => aspect.name),
      confidence: 0,
      hardGuards: ["NEED_EBAY_TAXONOMY_CATEGORY"],
    }
  }
  const facts = candidateAspectFacts(candidate, input)
  const missingRequiredAspects = taxonomy.requiredAspects
    .filter((aspect) => !facts.has(normalizedIdentifier(aspect.name)))
    .map((aspect) => aspect.name)
  return {
    status: missingRequiredAspects.length
      ? "REQUIRED_ASPECTS_MISSING" as const
      : "CATEGORY_AND_REQUIRED_ASPECTS_CONFIRMED" as const,
    categoryConfirmed: true,
    missingRequiredAspects,
    confidence: missingRequiredAspects.length ? 60 : 100,
    hardGuards: missingRequiredAspects.length
      ? ["NEED_REQUIRED_EBAY_ITEM_ASPECTS"]
      : [],
  }
}

function buildListingIntelligencePackage(
  candidate: NormalizedLunaOpportunityCandidate,
  input: EbayLunaCandidateMarketInput,
  market: ReturnType<typeof buildMarketMetrics>,
  economics: ReturnType<typeof buildUnitEconomics>,
  taxonomyVerification: ReturnType<typeof buildTaxonomyVerification>,
  dimensionsRequired: boolean,
) {
  const bestReference = demandListings(input).find((listing) =>
    listing.identifierExact && listing.eligibleComparable
  ) ?? input.demandReport.topSellingListings[0] ?? null
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
      verification: taxonomyVerification,
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
      conservativePriceSource: "P25 of identifier-exact total buyer prices",
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
      taxonomyGuards: taxonomyVerification.hardGuards,
      claimsMustBeSupplierVerified: true,
      humanReviewRequired: true,
    },
    fulfillmentEvidence: {
      weightConfirmed: candidate.weight !== null,
      dimensionsRequired,
      dimensionsConfirmed: candidate.dimensions !== null,
      dimensionsPolicy: dimensionsRequired
        ? "REQUIRED_BY_EXPLICIT_SHIPPING_OR_TAXONOMY_EVIDENCE"
        : "NOT_A_UNIVERSAL_LISTING_GATE",
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
  const enrichedListings = demandListings(input)
    .map((listing) => ({
      ...listing,
      ...buildComparableIdentity(candidate, listing),
    }))
    .sort((left, right) =>
      Number(right.exactIdentityConfirmedByIdentifier) - Number(left.exactIdentityConfirmedByIdentifier) ||
      left.identityConflicts.length - right.identityConflicts.length ||
      (numberOrNull((right as Record<string, unknown>).professionalReferenceScore) ?? 0) -
        (numberOrNull((left as Record<string, unknown>).professionalReferenceScore) ?? 0) ||
      right.identityMatchScore - left.identityMatchScore
    )
  const eligibleIdentityListings = enrichedListings.filter((listing) =>
    listing.identityConflicts.length === 0 && listing.identityMatchScore >= 78
  )
  const maxIdentityScore = Math.max(0, ...eligibleIdentityListings.map((listing) => listing.identityMatchScore))
  const exactIdentityConfirmed = eligibleIdentityListings.some(
    (listing) => listing.exactIdentityConfirmedByIdentifier
  )
  const market = buildMarketMetrics(input, current, rotations)
  const conservativePrice = market.conservativeTotalBuyerPrice ?? market.medianTotalBuyerPrice
  const economics = buildUnitEconomics(
    candidate,
    conservativePrice,
    options,
    market.conservativeTotalBuyerPrice !== null
      ? "EXACT_COMPARABLE_TOTAL_BUYER_PRICE_P25"
      : "EXACT_COMPARABLE_TOTAL_BUYER_PRICE_MEDIAN_FALLBACK",
  )
  const dimensionsRequired = requiresPackageDimensions(input)
  const taxonomyVerification = buildTaxonomyVerification(candidate, input)
  const scores = buildOpportunityScores(
    candidate,
    market,
    economics,
    maxIdentityScore,
    input.demandReport,
    taxonomyVerification.confidence,
    dimensionsRequired,
  )
  const config = { ...DEFAULTS, ...options }
  const packageEvidenceGates = [
    candidate.weight === null && !candidate.dimensions
      ? "NEED_PACKAGE_WEIGHT_AND_DIMENSIONS"
      : candidate.weight === null
        ? "NEED_PACKAGE_WEIGHT"
        : dimensionsRequired && !candidate.dimensions
          ? "NEED_PACKAGE_DIMENSIONS"
          : "",
  ]
  const hardGates = [
    candidate.available === false ? "LUNA_OUT_OF_STOCK" : "",
    candidate.available !== false && (candidate.inventoryQuantity === null || candidate.inventoryQuantity <= 0)
      ? "NEED_CONFIRMED_LUNA_STOCK_QUANTITY" : "",
    candidate.stockAgeHours === null || candidate.stockAgeHours > config.stockFreshnessHours
      ? "NEED_FRESH_LUNA_STOCK" : "",
    !exactIdentityConfirmed ? "NEED_EXACT_GTIN_OR_BRAND_MPN_MATCH" : "",
    candidate.supplierCost === null ? "NEED_CONFIRMED_SUPPLIER_COST" : "",
    ...packageEvidenceGates,
    !candidate.imageAuthorized ? "NEED_AUTHORIZED_PRODUCT_IMAGES" : "",
    ...taxonomyVerification.hardGuards,
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
    market.demandEvidenceRoute === "INSUFFICIENT_EXACT_MULTI_SELLER_EVIDENCE"
      ? "NEED_MULTI_SELLER_DEMAND_EVIDENCE" : "",
  ].filter(Boolean)
  const listingPackage = buildListingIntelligencePackage(
    candidate,
    input,
    market,
    economics,
    taxonomyVerification,
    dimensionsRequired,
  )
  const canProceedToListingPackage = hardGates.length === 0 &&
    evidenceGuards.length === 0 && scores.potentialScore >= 70 &&
    scores.confidenceScore >= 70
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
    taxonomyVerification,
    fulfillmentEvidence: {
      weightConfirmed: candidate.weight !== null,
      dimensionsRequired,
      dimensionsConfirmed: candidate.dimensions !== null,
    },
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
