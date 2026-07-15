import type {
  CompetitorListingInput,
  EbayMarketIntelligenceInput,
  EvidenceLevel,
  ExcludedCompetitor,
  ExclusionReason,
  ListingEconomics,
  MarketMetrics,
  NormalizedCompetitor,
  PriceScenario,
} from "./types.ts"

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function ceilMoney(value: number) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100
}

export function roundMetric(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

export function average(values: number[]) {
  if (!values.length) throw new Error("MARKET_INTELLIGENCE_VALUES_REQUIRED")
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function median(values: number[]) {
  if (!values.length) throw new Error("MARKET_INTELLIGENCE_VALUES_REQUIRED")
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function percentile(values: number[], percentileValue: number) {
  if (!values.length) throw new Error("MARKET_INTELLIGENCE_VALUES_REQUIRED")
  const sorted = [...values].sort((left, right) => left - right)
  const position = Math.max(0, Math.min(1, percentileValue)) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const usable = values.filter((item) => Number.isFinite(item.value) && item.weight > 0)
  if (!usable.length) throw new Error("MARKET_INTELLIGENCE_WEIGHTED_VALUES_REQUIRED")
  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0)
  return usable.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
}

function evidenceFor(listing: CompetitorListingInput, field: string): EvidenceLevel {
  const explicit = listing.fieldEvidence[field]
  if (explicit) return explicit
  const value = (listing as unknown as Record<string, unknown>)[field]
  if (value === null || value === undefined || value === "" ||
    (Array.isArray(value) && value.length === 0)) return "unavailable"
  return listing.evidenceLevel
}

const EVIDENCE_FIELDS = [
  "url", "title", "price", "shippingCost", "quantityIncluded", "totalUnitCount",
  "soldCountVisible", "watchersVisible", "sellerFeedbackPercent", "sellerFeedbackCount",
  "sellerLevel", "returnsAccepted", "returnPeriodDays", "returnShippingPaidBy",
  "handlingTimeDays", "estimatedDelivery", "promotedVisible", "mainImageUrl",
  "secondaryImageUrls", "itemSpecifics", "description", "notes", "condition",
  "internationalShipping", "additionalProductsIncluded", "searchPosition", "reviewCount",
  "badges", "listingQualityScore", "bestOfferVisible", "volumePricingVisible",
  "mainImageAnalysis", "secondaryImageClassifications",
] as const

function qualityScore(listing: CompetitorListingInput) {
  if (listing.listingQualityScore !== null && listing.listingQualityScore !== undefined) {
    return listing.listingQualityScore
  }
  let score = 0
  if (listing.mainImageUrl) score += 25
  score += Math.min(25, listing.secondaryImageUrls.length * 5)
  if (Object.keys(listing.itemSpecifics).length >= 4) score += 20
  if ((listing.description?.length ?? 0) >= 300) score += 15
  if (listing.returnsAccepted) score += 10
  if (listing.handlingTimeDays !== null && listing.handlingTimeDays <= 1) score += 5
  return Math.min(100, score)
}

function buildDemandSignals(listing: CompetitorListingInput) {
  const signals: string[] = []
  let score = 0
  if (listing.soldCountVisible !== null && evidenceFor(listing, "soldCountVisible") !== "inferred") {
    signals.push(`Visible sold count: ${listing.soldCountVisible}`)
    score += Math.min(35, Math.log10(listing.soldCountVisible + 1) * 15)
  }
  if (listing.watchersVisible !== null) {
    signals.push(`Visible watchers: ${listing.watchersVisible}`)
    score += Math.min(10, Math.log10(listing.watchersVisible + 1) * 5)
  }
  if (listing.sellerFeedbackPercent !== null) {
    signals.push(`Seller feedback: ${listing.sellerFeedbackPercent}%`)
    score += listing.sellerFeedbackPercent >= 98 ? 10 : 5
  }
  if (listing.sellerFeedbackCount !== null) {
    signals.push(`Seller feedback count: ${listing.sellerFeedbackCount}`)
    score += Math.min(10, Math.log10(listing.sellerFeedbackCount + 1) * 2)
  }
  if (listing.reviewCount !== null && listing.reviewCount !== undefined) {
    signals.push(`Visible review count: ${listing.reviewCount}`)
    score += Math.min(10, Math.log10(listing.reviewCount + 1) * 3)
  }
  if ((listing.badges?.length ?? 0) > 0) {
    signals.push(`Visible badges: ${listing.badges?.join(", ")}`)
    score += 5
  }
  if (listing.searchPosition !== null && listing.searchPosition !== undefined) {
    signals.push(`Observed search position: ${listing.searchPosition}`)
    score += listing.searchPosition <= 10 ? 8 : listing.searchPosition <= 25 ? 4 : 1
  }
  if (listing.sellerLevel) {
    signals.push(`Visible seller level: ${listing.sellerLevel}`)
    score += /top|above standard/i.test(listing.sellerLevel) ? 5 : 2
  }
  const quality = qualityScore(listing)
  signals.push(`Listing quality signal: ${roundMetric(quality)}/100`)
  score += quality * 0.15
  if (listing.handlingTimeDays !== null && listing.handlingTimeDays <= 1) {
    signals.push("Fast handling signal")
    score += 5
  }
  if (listing.estimatedDelivery) signals.push(`Visible delivery estimate: ${listing.estimatedDelivery}`)
  if (listing.returnsAccepted === true) {
    signals.push("Returns accepted")
    score += listing.returnShippingPaidBy === "seller" ? 5 : 3
  }
  if (listing.shippingCost === 0) {
    signals.push("Free-shipping price presentation")
    score += 5
  }
  return { signals, score: Math.min(100, roundMetric(score)), quality }
}

function exclusionReasons(listing: CompetitorListingInput): ExclusionReason[] {
  const reasons: ExclusionReason[] = []
  if (!Number.isFinite(listing.price) || listing.price <= 0) reasons.push("CRITICAL_PRICE_MISSING")
  if (
    !(listing.totalUnitCount !== null && listing.totalUnitCount > 0) &&
    !(listing.quantityIncluded !== null && listing.quantityIncluded > 0)
  ) reasons.push("QUANTITY_NOT_NORMALIZABLE")
  if (["used", "refurbished"].includes(listing.condition ?? "")) reasons.push("USED_OR_REFURBISHED")
  if (listing.internationalShipping === true) reasons.push("INTERNATIONAL_SHIPPING_NOT_COMPARABLE")
  if (listing.additionalProductsIncluded === true) reasons.push("ADDITIONAL_PRODUCTS_INCLUDED")
  if (!listing.title || !listing.url) reasons.push("CRITICAL_DATA_INCOMPLETE")
  return [...new Set(reasons)]
}

function competitorWeight(
  listing: CompetitorListingInput,
  landedPrice: number,
  marketMedian: number,
  quality: number,
) {
  let weight = 1
  const soldEvidence = evidenceFor(listing, "soldCountVisible")
  if (listing.soldCountVisible !== null && ["verified", "visible"].includes(soldEvidence)) {
    weight += Math.min(5, Math.log10(listing.soldCountVisible + 1) * 2)
  }
  if ((listing.sellerFeedbackPercent ?? 0) >= 98) weight += 1
  if ((listing.sellerFeedbackCount ?? 0) >= 1_000) weight += 1
  if (listing.handlingTimeDays !== null && listing.handlingTimeDays <= 1) weight += 1
  weight += quality >= 75 ? 1 : quality >= 50 ? 0.5 : 0
  const extreme = marketMedian > 0 && (landedPrice < marketMedian * 0.5 || landedPrice > marketMedian * 1.75)
  if (extreme && listing.soldCountVisible === null) weight *= 0.25
  return roundMetric(Math.max(0.1, weight))
}

export function normalizeCompetitors(input: EbayMarketIntelligenceInput) {
  const excluded: ExcludedCompetitor[] = []
  const provisional: Array<Omit<NormalizedCompetitor, "weight">> = []
  input.competitorListings.forEach((listing, index) => {
    const reasons = exclusionReasons(listing)
    if (reasons.length) {
      excluded.push({
        index: index + 1,
        url: listing.url,
        title: listing.title,
        reasons,
        retainedForQualitativePatterns: true,
      })
      return
    }
    const quantityIncluded = listing.quantityIncluded && listing.quantityIncluded > 0
      ? listing.quantityIncluded
      : 1
    const totalUnitCount = listing.totalUnitCount && listing.totalUnitCount > 0
      ? listing.totalUnitCount
      : quantityIncluded * input.unitsPerPackage
    const quantityEvidence = listing.totalUnitCount && listing.totalUnitCount > 0
      ? evidenceFor(listing, "totalUnitCount")
      : "inferred"
    const landedPrice = listing.price + listing.shippingCost
    const demand = buildDemandSignals(listing)
    provisional.push({
      index: index + 1,
      url: listing.url,
      title: listing.title,
      itemPrice: roundMoney(listing.price),
      shippingCost: roundMoney(listing.shippingCost),
      landedPrice: roundMoney(landedPrice),
      quantityIncluded,
      totalUnitCount,
      pricePerPackage: roundMoney(landedPrice / quantityIncluded),
      pricePerUnit: roundMetric(landedPrice / totalUnitCount),
      quantityEvidence,
      listing,
      evidence: {
        ...Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, evidenceFor(listing, field)])),
        totalUnitCount: quantityEvidence,
      },
      demandSignalScore: demand.score,
      demandSignals: demand.signals,
    })
  })
  if (!provisional.length) throw new Error("MARKET_INTELLIGENCE_NO_COMPARABLE_COMPETITORS")
  const marketMedian = median(provisional.map((item) => item.landedPrice))
  const used = provisional.map((item) => ({
    ...item,
    weight: competitorWeight(
      item.listing,
      item.landedPrice,
      marketMedian,
      qualityScore(item.listing),
    ),
    demandSignalScore: Math.min(100, roundMetric(
      item.demandSignalScore + (item.landedPrice <= marketMedian ? 5 : 2),
    )),
    demandSignals: [
      ...item.demandSignals,
      item.landedPrice <= marketMedian
        ? "Landed price at or below observed median"
        : "Landed price above observed median",
    ],
  }))
  return { used, excluded }
}

export function calculateMarketMetrics(
  competitors: NormalizedCompetitor[],
  excludedCount = 0,
): MarketMetrics {
  const landed = competitors.map((item) => item.landedPrice)
  const perUnit = competitors.map((item) => item.pricePerUnit)
  return {
    minimumLandedPrice: roundMoney(Math.min(...landed)),
    maximumLandedPrice: roundMoney(Math.max(...landed)),
    averageLandedPrice: roundMoney(average(landed)),
    medianLandedPrice: roundMoney(median(landed)),
    minimumPricePerUnit: roundMetric(Math.min(...perUnit)),
    averagePricePerUnit: roundMetric(average(perUnit)),
    medianPricePerUnit: roundMetric(median(perUnit)),
    premiumQuartilePrice: roundMoney(percentile(landed, 0.75)),
    weightedMarketPrice: roundMoney(weightedAverage(
      competitors.map((item) => ({ value: item.landedPrice, weight: item.weight })),
    )),
    competitorCountUsed: competitors.length,
    competitorCountExcluded: excludedCount,
  }
}

export function calculateListingEconomics(
  input: Pick<EbayMarketIntelligenceInput,
    | "sellerProductCost"
    | "packagingCost"
    | "shippingCost"
    | "expectedReturnCost"
    | "ebayFeePercent"
    | "promotedListingPercent">,
  salePrice: number,
): ListingEconomics {
  const totalProductCost = input.sellerProductCost + input.packagingCost +
    input.shippingCost + input.expectedReturnCost
  const marketplaceRate = (input.ebayFeePercent + input.promotedListingPercent) / 100
  const estimatedMarketplaceCost = salePrice * marketplaceRate
  const estimatedProfit = salePrice - totalProductCost - estimatedMarketplaceCost
  return {
    salePrice: roundMoney(salePrice),
    totalProductCost: roundMoney(totalProductCost),
    estimatedMarketplaceCost: roundMoney(estimatedMarketplaceCost),
    estimatedProfit: roundMoney(estimatedProfit),
    estimatedMarginPercent: salePrice > 0
      ? roundMetric((estimatedProfit / salePrice) * 100)
      : 0,
  }
}

export function calculateMinimumSafePrice(input: EbayMarketIntelligenceInput) {
  const totalCost = input.sellerProductCost + input.packagingCost +
    input.shippingCost + input.expectedReturnCost
  const feeRate = (input.ebayFeePercent + input.promotedListingPercent) / 100
  return ceilMoney(totalCost / Math.max(0.0001, 1 - feeRate))
}

export function calculateTargetMarginPrice(input: EbayMarketIntelligenceInput) {
  const totalCost = input.sellerProductCost + input.packagingCost +
    input.shippingCost + input.expectedReturnCost
  const combinedRate = (
    input.ebayFeePercent + input.promotedListingPercent + input.targetMarginPercent
  ) / 100
  return ceilMoney(totalCost / Math.max(0.0001, 1 - combinedRate))
}

function scenario(
  name: PriceScenario["name"],
  input: EbayMarketIntelligenceInput,
  salePrice: number,
  rationale: string[],
): PriceScenario {
  return { name, ...calculateListingEconomics(input, ceilMoney(salePrice)), rationale }
}

export function calculatePriceScenarios(
  input: EbayMarketIntelligenceInput,
  market: MarketMetrics,
) {
  const floor = calculateMinimumSafePrice(input)
  const targetMarginFloor = calculateTargetMarginPrice(input)
  const launch = Math.max(targetMarginFloor, market.medianLandedPrice * 0.97)
  const competitive = Math.max(targetMarginFloor, market.medianLandedPrice)
  const target = Math.max(targetMarginFloor, market.weightedMarketPrice)
  const premium = Math.max(targetMarginFloor, market.premiumQuartilePrice)
  return [
    scenario("floorPrice", input, floor, [
      "Break-even price adjusted for eBay and promoted-listing percentage costs.",
      "It is not a recommended operating price because it provides approximately zero margin.",
    ]),
    scenario("launchPrice", input, launch, [
      "Targets 3% below the observed market median for initial acquisition.",
      "Raised when necessary to preserve the requested minimum margin.",
    ]),
    scenario("competitivePrice", input, competitive, [
      "Anchored to the observed market median.",
      "Never below the price required for the requested minimum margin.",
    ]),
    scenario("targetPrice", input, target, [
      "Anchored to the evidence-weighted market price.",
      "Never below the price required for the requested minimum margin.",
    ]),
    scenario("premiumPrice", input, premium, [
      "Anchored to the observed premium quartile.",
      "Requires stronger images, delivery, returns and listing quality to justify the premium.",
    ]),
  ]
}
