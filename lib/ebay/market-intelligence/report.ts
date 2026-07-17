import type {
  CompetitorListingInput,
  EbayMarketIntelligenceInput,
  EbayMarketIntelligenceReport,
  EvidenceLevel,
  MainImageAnalysis,
  MarketMetrics,
  NormalizedCompetitor,
  PriceScenario,
  SecondaryImageCategory,
} from "./types.ts"
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { EVIDENCE_LEVELS, SECONDARY_IMAGE_CATEGORIES } from "./types.ts"
import {
  average,
  ceilMoney,
  calculateMarketMetrics,
  calculatePriceScenarios,
  normalizeCompetitors,
  roundMetric,
  roundMoney,
// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
} from "./calculations.ts"

const STOP_WORDS = new Set([
  "a", "an", "and", "for", "from", "in", "of", "on", "or", "the", "to", "with",
])
const RISKY_TERMS = [
  "cure", "cures", "guaranteed", "kills all", "medical grade", "prevents disease",
  "fda approved", "antiviral", "antibacterial", "disinfects", "sterilizes",
]
const SCENT_TERMS = [
  "lemon", "lavender", "fresh", "citrus", "unscented", "scented", "original",
]
const PACK_TERMS = ["pack", "packs", "count", "ct", "lot", "bundle", "set"]

function tokens(title: string) {
  return title.toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token))
}

function titleAnalysis(listings: CompetitorListingInput[]) {
  const frequencies = new Map<string, number>()
  const positions = new Map<string, number[]>()
  const quantityTerms = new Set<string>()
  const scentTerms = new Set<string>()
  const packTerms = new Set<string>()
  const riskyTerms = new Set<string>()
  for (const listing of listings) {
    const listingTokens = tokens(listing.title)
    const unique = new Set(listingTokens)
    for (const token of unique) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
    listingTokens.forEach((token, index) => positions.set(token, [
      ...(positions.get(token) ?? []),
      index,
    ]))
    for (const token of listingTokens) {
      if (/^\d+(?:pk|ct|x)?$/.test(token)) quantityTerms.add(token)
      if (SCENT_TERMS.includes(token)) scentTerms.add(token)
      if (PACK_TERMS.includes(token)) packTerms.add(token)
    }
    const lower = listing.title.toLocaleLowerCase("en-US")
    for (const risky of RISKY_TERMS) if (lower.includes(risky)) riskyTerms.add(risky)
  }
  const ranked = [...frequencies.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0]))
  const commonKeywordOrder = ranked.slice(0, 12)
    .map(([keyword]) => ({
      keyword,
      averagePosition: average(positions.get(keyword) ?? [999]),
    }))
    .sort((left, right) => left.averagePosition - right.averagePosition)
    .map((entry) => entry.keyword)
  return {
    keywords: ranked.slice(0, 30).map(([keyword]) => keyword),
    keywordFrequency: Object.fromEntries(ranked),
    averageTitleLength: roundMetric(average(listings.map((listing) => listing.title.length))),
    commonKeywordOrder,
    quantityTerms: [...quantityTerms],
    scentTerms: [...scentTerms],
    packTerms: [...packTerms],
    prohibitedOrRiskyTerms: [...riskyTerms],
  }
}

function averageImageField(
  analyses: MainImageAnalysis[],
  key: keyof MainImageAnalysis,
) {
  const values = analyses.map((analysis) => analysis[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  return values.length ? roundMetric(average(values)) : null
}

function imageAnalysis(listings: CompetitorListingInput[]) {
  const analyses = listings.map((listing) => listing.mainImageAnalysis)
    .filter((analysis): analysis is MainImageAnalysis => Boolean(analysis))
  const frequency = Object.fromEntries(
    SECONDARY_IMAGE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<SecondaryImageCategory, number>
  const backgroundFrequency: Record<string, number> = {}
  let badgeUsageCount = 0
  let shippingBadgeCount = 0
  for (const analysis of analyses) {
    const background = analysis.background?.trim() || "unavailable"
    backgroundFrequency[background] = (backgroundFrequency[background] ?? 0) + 1
    if (analysis.badgeUsage === true) badgeUsageCount += 1
    if (analysis.shippingBadge === true) shippingBadgeCount += 1
  }
  for (const listing of listings) {
    for (const category of new Set(listing.secondaryImageClassifications ?? [])) {
      frequency[category] += 1
    }
  }
  const numericFields: Array<keyof MainImageAnalysis> = [
    "productCoveragePercent", "quantityClarity", "textAmount", "brandVisibility",
    "imageSharpness", "visualClutter", "mobileReadability", "trustScore", "estimatedCtrScore",
  ]
  return {
    competitorsWithManualAnalysis: analyses.length,
    mainImageAverages: Object.fromEntries(
      numericFields.map((field) => [field, averageImageField(analyses, field)]),
    ),
    backgroundFrequency,
    badgeUsageCount,
    shippingBadgeCount,
    perListing: listings.map((listing, index) => ({
      competitorIndex: index + 1,
      analysis: listing.mainImageAnalysis ?? null,
      secondaryCategories: listing.secondaryImageClassifications ?? [],
      evidence: listing.fieldEvidence.mainImageAnalysis ??
        (listing.mainImageAnalysis ? listing.evidenceLevel : "unavailable"),
    })),
    secondaryImageFrequency: frequency,
    secondaryImageFrequencyLabels: SECONDARY_IMAGE_CATEGORIES.map((category) =>
      `${frequency[category]}/${listings.length} show ${category}`),
    limitation: analyses.length
      ? "Image classifications were supplied as manual observations; no computer vision or generative AI was used."
      : "Image URLs alone are not treated as visual evidence. Manual image classifications are unavailable.",
  }
}

function shippingAndReturns(listings: CompetitorListingInput[]) {
  const count = listings.length
  const values = (predicate: (listing: CompetitorListingInput) => boolean) =>
    listings.filter(predicate).length
  const knownHandling = listings
    .map((listing) => listing.handlingTimeDays)
    .filter((value): value is number => value !== null && value !== undefined)
  return {
    competitorCount: count,
    freeShippingCount: values((listing) => listing.shippingCost === 0),
    returnsAcceptedCount: values((listing) => listing.returnsAccepted === true),
    sellerPaidReturnsCount: values((listing) => listing.returnShippingPaidBy === "seller"),
    fastHandlingCount: values((listing) => listing.handlingTimeDays !== null && listing.handlingTimeDays <= 1),
    averageHandlingTimeDays: knownHandling.length ? roundMetric(average(knownHandling)) : 0,
    bestOfferVisibleCount: values((listing) => listing.bestOfferVisible === true),
    volumePricingVisibleCount: values((listing) => listing.volumePricingVisible === true),
    promotedVisibleCount: values((listing) => listing.promotedVisible === true),
  }
}

function confidenceScore(
  input: EbayMarketIntelligenceInput,
  used: NormalizedCompetitor[],
  generatedAt: Date,
) {
  const countScore = Math.min(40, used.length * 4)
  const criticalFields = ["price", "shippingCost", "totalUnitCount", "soldCountVisible"]
  const evidenceValues = used.flatMap((competitor) => criticalFields.map((field) =>
    competitor.evidence[field] ?? competitor.listing.evidenceLevel))
  const evidencePoints: Record<EvidenceLevel, number> = {
    verified: 1,
    visible: 0.8,
    inferred: 0.35,
    unavailable: 0,
  }
  const evidenceScore = evidenceValues.length
    ? average(evidenceValues.map((level) => evidencePoints[level])) * 45
    : 0
  const sourceFreshnessDays = Math.max(0, (
    generatedAt.getTime() - Date.parse(`${input.sourceDate}T00:00:00Z`)
  ) / 86_400_000)
  const freshnessScore = sourceFreshnessDays <= 7 ? 15 : sourceFreshnessDays <= 30 ? 8 : 3
  return Math.max(0, Math.min(100, Math.round(countScore + evidenceScore + freshnessScore)))
}

function evidenceSummary(used: NormalizedCompetitor[], confidence: number) {
  const byLevel: Record<EvidenceLevel, number> = {
    verified: 0,
    visible: 0,
    inferred: 0,
    unavailable: 0,
  }
  for (const competitor of used) {
    for (const level of Object.values(competitor.evidence)) byLevel[level] += 1
  }
  const soldVisible = used.filter((item) => item.listing.soldCountVisible !== null &&
    ["verified", "visible"].includes(item.evidence.soldCountVisible)).length
  return {
    byLevel,
    limitations: [
      `${soldVisible}/${used.length} included competitors have a visible, non-inferred sold count.`,
      "Demand signals are comparative indicators and are not presented as confirmed sales.",
      "Descriptions and competitor images are not copied into recommendations.",
      "Manual observations can become stale after sourceDate and must be refreshed before repricing.",
    ],
    recommendationEvidence: [
      "Observed landed-price median and price-per-unit distribution.",
      "Evidence-weighted price using visible sold counts, seller reputation, delivery and listing quality.",
      "Seller-provided product, packaging, shipping, return and marketplace costs.",
      `Calculated report confidence: ${confidence}/100.`,
    ],
  }
}

function scenarioByName(scenarios: PriceScenario[], name: PriceScenario["name"]) {
  const match = scenarios.find((scenario) => scenario.name === name)
  if (!match) throw new Error("MARKET_INTELLIGENCE_SCENARIO_MISSING")
  return match
}

function volumePricing(
  input: EbayMarketIntelligenceInput,
  recommended: PriceScenario,
) {
  const targetMarginRate = input.targetMarginPercent
  return [
    { quantity: 2, discountPercent: 2 },
    { quantity: 3, discountPercent: 4 },
  ].map(({ quantity, discountPercent }) => {
    const discounted = roundMoney(recommended.salePrice * (1 - discountPercent / 100))
    const totalCost = input.sellerProductCost + input.packagingCost + input.shippingCost + input.expectedReturnCost
    const variableRate = (input.ebayFeePercent + input.promotedListingPercent) / 100
    const targetMarginPrice = totalCost / Math.max(0.0001, 1 - variableRate - targetMarginRate / 100)
    const safePrice = ceilMoney(Math.max(discounted, targetMarginPrice))
    const profit = safePrice - totalCost - safePrice * variableRate
    return {
      quantity,
      discountPercent: safePrice === discounted ? discountPercent : 0,
      unitListingPrice: safePrice,
      marginPercent: roundMetric((profit / safePrice) * 100),
    }
  })
}

function buildRiskFlags(
  input: EbayMarketIntelligenceInput,
  market: MarketMetrics,
  used: NormalizedCompetitor[],
  excludedCount: number,
) {
  const flags: string[] = []
  if (used.length < 10) flags.push("FEWER_THAN_10_USABLE_COMPARABLES")
  if (excludedCount) flags.push("SOME_COMPARABLES_EXCLUDED_FROM_PRICE_METRICS")
  if (!used.some((item) => item.listing.soldCountVisible !== null &&
    ["verified", "visible"].includes(item.evidence.soldCountVisible))) {
    flags.push("NO_VISIBLE_SOLD_COUNT_DEMAND_SIGNALS_ONLY")
  }
  if (input.totalUnits !== input.unitsPerListing * input.unitsPerPackage) {
    flags.push("INPUT_UNIT_STRUCTURE_REQUIRES_REVIEW")
  }
  if (market.maximumLandedPrice > market.minimumLandedPrice * 2) {
    flags.push("WIDE_MARKET_PRICE_DISPERSION")
  }
  if (input.targetMarginPercent < 10) flags.push("LOW_TARGET_MARGIN")
  return flags
}

export function buildMarketIntelligenceReport(
  input: EbayMarketIntelligenceInput,
  generatedAt = new Date(),
): EbayMarketIntelligenceReport {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("MARKET_INTELLIGENCE_GENERATED_AT_INVALID")
  }
  const { used, excluded } = normalizeCompetitors(input)
  const market = calculateMarketMetrics(used, excluded.length)
  const scenarios = calculatePriceScenarios(input, market)
  const launch = scenarioByName(scenarios, "launchPrice")
  const target = scenarioByName(scenarios, "targetPrice")
  const floor = scenarioByName(scenarios, "floorPrice")
  const confidence = confidenceScore(input, used, generatedAt)
  const images = imageAnalysis(input.competitorListings)
  const titles = titleAnalysis(input.competitorListings)
  const riskFlags = buildRiskFlags(input, market, used, excluded.length)
  const table = used.map(({ listing: _listing, ...competitor }) => competitor)
  return {
    reportVersion: "EBAY_MARKET_INTELLIGENCE_LOOP_V1",
    generatedAt: generatedAt.toISOString(),
    sourceDate: input.sourceDate,
    currency: input.currency,
    product: {
      name: input.productName,
      brand: input.productBrand,
      category: input.productCategory,
      unitsPerListing: input.unitsPerListing,
      unitsPerPackage: input.unitsPerPackage,
      totalUnits: input.totalUnits,
    },
    executiveSummary: [
      `${used.length} comparable listings were normalized; ${excluded.length} were excluded from primary price calculations.`,
      `Observed landed-price median: ${input.currency} ${market.medianLandedPrice}.`,
      `Recommended launch price: ${input.currency} ${launch.salePrice}; target price: ${input.currency} ${target.salePrice}.`,
      "No competitor is labeled a top seller unless a visible sold count supports that statement.",
    ],
    marketRange: market,
    pricePerUnitAnalysis: {
      marketMedian: market.medianPricePerUnit,
      recommended: target.salePrice,
      recommendedPerUnit: roundMetric(target.salePrice / input.totalUnits),
    },
    competitorTable: table,
    excludedListings: excluded,
    demandSignals: used.map((competitor) => ({
      url: competitor.url,
      score: competitor.demandSignalScore,
      signals: competitor.demandSignals,
      soldCountVisible: competitor.listing.soldCountVisible,
      soldCountEvidence: competitor.evidence.soldCountVisible,
    })),
    imagePatternAnalysis: images,
    titleKeywordAnalysis: titles,
    shippingAndReturnAnalysis: shippingAndReturns(input.competitorListings),
    riskFlags,
    recommendedLaunchStrategy: [
      `Launch at ${input.currency} ${launch.salePrice}; this is 3% below median only when the target margin remains protected.`,
      "Use moderate promotion at the configured percentage and review after the first verified sales.",
      "Compete with clear quantity, mobile-readable images, transparent delivery and returns—not unverified claims.",
    ],
    recommendedMatureStrategy: [
      `Move toward ${input.currency} ${target.salePrice} after conversion evidence supports the listing.`,
      "Re-run the loop with refreshed observations rather than copying competitor content.",
      "Test volume pricing only when every discounted tier preserves the requested margin.",
    ],
    recommendedPrice: target,
    minimumSafePrice: floor,
    priceScenarios: scenarios,
    volumePricingProposal: volumePricing(input, target),
    confidenceScore: confidence,
    evidenceSummary: evidenceSummary(used, confidence),
  }
}

function money(value: number, currency: string) {
  return `${currency} ${value.toFixed(2)}`
}

function markdownTable(report: EbayMarketIntelligenceReport) {
  const rows = report.competitorTable.map((item) =>
    `| ${item.index} | [Link](${item.url}) | ${money(item.landedPrice, report.currency)} | ${item.totalUnitCount} | ${money(item.pricePerUnit, report.currency)} | ${item.quantityEvidence} | ${item.demandSignalScore} |`)
  return [
    "| # | Listing | Landed | Units | Per unit | Quantity evidence | Demand signal |",
    "|---:|---|---:|---:|---:|---|---:|",
    ...rows,
  ].join("\n")
}

export function renderMarketIntelligenceMarkdown(report: EbayMarketIntelligenceReport) {
  const bullet = (items: string[]) => items.map((item) => `- ${item}`).join("\n") || "- None"
  return `# eBay Market Intelligence Report

Generated: ${report.generatedAt}<br>
Source date: ${report.sourceDate}<br>
Product: ${report.product.brand} ${report.product.name}<br>
Currency: ${report.currency}

## 1. Executive Summary

${bullet(report.executiveSummary)}

## 2. Market Range

- Minimum landed: ${money(report.marketRange.minimumLandedPrice, report.currency)}
- Maximum landed: ${money(report.marketRange.maximumLandedPrice, report.currency)}
- Average landed: ${money(report.marketRange.averageLandedPrice, report.currency)}
- Median landed: ${money(report.marketRange.medianLandedPrice, report.currency)}
- Weighted market price: ${money(report.marketRange.weightedMarketPrice, report.currency)}

## 3. Price Per Unit Analysis

- Market median per unit: ${money(report.pricePerUnitAnalysis.marketMedian, report.currency)}
- Recommended per unit: ${money(report.pricePerUnitAnalysis.recommendedPerUnit, report.currency)}

## 4. Competitor Table

${markdownTable(report)}

## 5. Excluded Listings

${report.excludedListings.length ? report.excludedListings.map((item) =>
    `- [Competitor ${item.index}](${item.url}): ${item.reasons.join(", ")}`).join("\n") : "- None"}

## 6. Demand Signals

${report.demandSignals.map((item, index) =>
    `- Competitor ${index + 1}: ${item.signals.join("; ")} (sold evidence: ${item.soldCountEvidence})`).join("\n")}

## 7. Image Pattern Analysis

${bullet(report.imagePatternAnalysis.secondaryImageFrequencyLabels)}

Limitation: ${report.imagePatternAnalysis.limitation}

## 8. Title Keyword Analysis

- Frequent keywords: ${report.titleKeywordAnalysis.keywords.join(", ") || "Unavailable"}
- Common order: ${report.titleKeywordAnalysis.commonKeywordOrder.join(" → ") || "Unavailable"}
- Risky terms observed: ${report.titleKeywordAnalysis.prohibitedOrRiskyTerms.join(", ") || "None observed"}

## 9. Shipping and Return Analysis

${Object.entries(report.shippingAndReturnAnalysis).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## 10. Risk Flags

${bullet(report.riskFlags)}

## 11. Recommended Launch Strategy

${bullet(report.recommendedLaunchStrategy)}

## 12. Recommended Mature Strategy

${bullet(report.recommendedMatureStrategy)}

## 13. Recommended Price

${money(report.recommendedPrice.salePrice, report.currency)} — margin ${report.recommendedPrice.estimatedMarginPercent}%

## 14. Minimum Safe Price

${money(report.minimumSafePrice.salePrice, report.currency)} — break-even after configured percentage fees.

## 15. Volume Pricing Proposal

${report.volumePricingProposal.map((tier) =>
    `- ${tier.quantity} listings: ${money(tier.unitListingPrice, report.currency)} each; discount ${tier.discountPercent}%; margin ${tier.marginPercent}%`).join("\n")}

## 16. Confidence Score

${report.confidenceScore}/100

## 17. Evidence Summary

${EVIDENCE_LEVELS.map((level) => `- ${level}: ${report.evidenceSummary.byLevel[level]}`).join("\n")}

Limitations:

${bullet(report.evidenceSummary.limitations)}
`
}

export function serializeMarketIntelligenceReport(report: EbayMarketIntelligenceReport) {
  return {
    json: `${JSON.stringify(report, null, 2)}\n`,
    markdown: renderMarketIntelligenceMarkdown(report),
  }
}
