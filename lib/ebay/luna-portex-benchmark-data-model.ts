export const LUNA_PORTEX_BENCHMARK_DATA_MODEL_VERSION =
  "LUNA_PORTEX_BENCHMARK_DATA_MODEL_DIRECT_SOURCING_PRICING_V1"

const sourceDataClass =
  "LOOP_143_BENCHMARK_DATA_MODEL"
const maxBenchmarkCandidates =
  10

type SoldListingSample = {
  soldPrice?: number | null
  shippingPrice?: number | null
  totalBuyerPrice?: number | null
}

type ActiveCompetitionSample = {
  activePrice?: number | null
  shippingPrice?: number | null
  watchers?: number | null
}

type SoldPriceSignal = {
  candidateKey?: string | null
  query?: string | null
  soldListingsSample?: SoldListingSample[] | null
  activeCompetitionSample?: ActiveCompetitionSample[] | null
  marketSummary?: {
    averageSoldPrice?: number | null
    medianSoldPrice?: number | null
    soldCountSample?: number | null
    activeListingsSample?: number | null
    estimatedSellThroughRate?: number | null
    priceRangeLow?: number | null
    priceRangeHigh?: number | null
  } | null
}

type BenchmarkCandidate = {
  candidate_key?: string | null
  candidateKey?: string | null
  supplier_variant_id?: string | null
  supplierVariantId?: string | null
  title?: string | null
  normalized_payload?: Record<string, unknown> | null
  normalizedPayload?: Record<string, unknown> | null
  source_payload?: Record<string, unknown> | null
  sourcePayload?: Record<string, unknown> | null
  needs_data?: string[] | null
  needsData?: string[] | null
  blocked_reason?: string | null
  blockedReason?: string | null
}

type BenchmarkOptions = {
  minimumHealthyMarginPercent?: number | null
  estimatedFulfillmentCost?: number | null
  estimatedFeeRate?: number | null
  minimumSoldCountForMediumConfidence?: number | null
  minimumSoldCountForHighConfidence?: number | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0
  }

  const sorted =
    [...values].sort((a, b) => a - b)
  const middle =
    Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function average(values: number[]) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length
}

function getCandidateKey(candidate: BenchmarkCandidate) {
  return normalizeText(candidate.candidate_key) ??
    normalizeText(candidate.candidateKey) ??
    "unknown-candidate"
}

function getNormalizedPayload(candidate: BenchmarkCandidate) {
  return candidate.normalized_payload ??
    candidate.normalizedPayload ??
    {}
}

function getNeedsData(candidate: BenchmarkCandidate) {
  return Array.isArray(candidate.needs_data)
    ? candidate.needs_data
    : Array.isArray(candidate.needsData)
      ? candidate.needsData
      : []
}

function getLunaCost(candidate: BenchmarkCandidate) {
  const normalizedPayload =
    getNormalizedPayload(candidate)

  return normalizeNumber(normalizedPayload.cost, 0)
}

function getImageCount(candidate: BenchmarkCandidate) {
  const normalizedPayload =
    getNormalizedPayload(candidate)

  return normalizeNumber(normalizedPayload.imageCount, 0)
}

function getStockStatus(candidate: BenchmarkCandidate) {
  const normalizedPayload =
    getNormalizedPayload(candidate)

  return normalizeText(normalizedPayload.stockStatus) ?? "unknown"
}

function calculateEstimatedNetProfit(
  soldBenchmarkPrice: number,
  lunaCost: number,
  options: BenchmarkOptions = {},
) {
  const fulfillmentCost =
    normalizeNumber(options.estimatedFulfillmentCost, 6)
  const feeRate =
    normalizeNumber(options.estimatedFeeRate, 0.15)
  const estimatedFees =
    soldBenchmarkPrice * feeRate

  return soldBenchmarkPrice - lunaCost - fulfillmentCost - estimatedFees
}

export function buildBenchmarkCandidateInput(
  candidate: BenchmarkCandidate,
  soldPriceSignal: SoldPriceSignal | null = null,
  options: BenchmarkOptions = {},
) {
  void options

  return {
    benchmarkVersion:
      LUNA_PORTEX_BENCHMARK_DATA_MODEL_VERSION,
    sourceDataClass,
    candidateKey:
      getCandidateKey(candidate),
    title:
      normalizeText(candidate.title) ?? "Untitled Luna Portex candidate",
    supplierVariantId:
      normalizeText(candidate.supplier_variant_id) ??
      normalizeText(candidate.supplierVariantId),
    lunaCost:
      getLunaCost(candidate),
    stockStatus:
      getStockStatus(candidate),
    imageCount:
      getImageCount(candidate),
    needsData:
      getNeedsData(candidate),
    blockedReason:
      normalizeText(candidate.blocked_reason) ??
      normalizeText(candidate.blockedReason),
    soldPriceSignalFound:
      soldPriceSignal !== null,
  }
}

export function calculateSoldPriceIntelligence(
  signal: SoldPriceSignal = {},
  options: BenchmarkOptions = {},
) {
  const soldPrices =
    Array.isArray(signal.soldListingsSample)
      ? signal.soldListingsSample
        .map(entry => normalizeNumber(entry.totalBuyerPrice, normalizeNumber(entry.soldPrice, 0) + normalizeNumber(entry.shippingPrice, 0)))
        .filter(value => value > 0)
      : []
  const activeListingsSample =
    Array.isArray(signal.activeCompetitionSample)
      ? signal.activeCompetitionSample.length
      : normalizeNumber(signal.marketSummary?.activeListingsSample, 0)
  const soldCountSample =
    soldPrices.length > 0
      ? soldPrices.length
      : normalizeNumber(signal.marketSummary?.soldCountSample, 0)
  const averageSoldPrice =
    soldPrices.length > 0
      ? average(soldPrices)
      : normalizeNumber(signal.marketSummary?.averageSoldPrice, 0)
  const medianSoldPrice =
    soldPrices.length > 0
      ? median(soldPrices)
      : normalizeNumber(signal.marketSummary?.medianSoldPrice, 0)
  const priceRangeLow =
    soldPrices.length > 0
      ? Math.min(...soldPrices)
      : normalizeNumber(signal.marketSummary?.priceRangeLow, 0)
  const priceRangeHigh =
    soldPrices.length > 0
      ? Math.max(...soldPrices)
      : normalizeNumber(signal.marketSummary?.priceRangeHigh, 0)
  const estimatedSellThroughRate =
    normalizeNumber(
      signal.marketSummary?.estimatedSellThroughRate,
      activeListingsSample > 0
        ? soldCountSample / (soldCountSample + activeListingsSample)
        : soldCountSample > 0 ? 1 : 0,
    )
  const mediumConfidenceMinimum =
    normalizeNumber(options.minimumSoldCountForMediumConfidence, 3)
  const highConfidenceMinimum =
    normalizeNumber(options.minimumSoldCountForHighConfidence, 6)
  const priceDataConfidence =
    soldCountSample >= highConfidenceMinimum
      ? "HIGH"
      : soldCountSample >= mediumConfidenceMinimum
        ? "MEDIUM"
        : "LOW"

  return {
    candidateKey:
      normalizeText(signal.candidateKey) ?? "unknown-candidate",
    averageSoldPrice:
      Number(averageSoldPrice.toFixed(2)),
    medianSoldPrice:
      Number(medianSoldPrice.toFixed(2)),
    soldCountSample,
    activeListingsSample,
    estimatedSellThroughRate:
      Number(estimatedSellThroughRate.toFixed(2)),
    soldPriceRange:
      {
        low:
          Number(priceRangeLow.toFixed(2)),
        high:
          Number(priceRangeHigh.toFixed(2)),
      },
    recommendedBenchmarkPriceRange:
      {
        low:
          Number((medianSoldPrice * 0.92).toFixed(2)),
        high:
          Number((medianSoldPrice * 1.08).toFixed(2)),
      },
    priceDataConfidence,
    soldDataAvailable:
      soldCountSample > 0,
  }
}

export function calculatePricingPsychologyInputs(
  candidate: BenchmarkCandidate,
  soldPriceIntelligence: ReturnType<typeof calculateSoldPriceIntelligence>,
  options: BenchmarkOptions = {},
) {
  const lunaCost =
    getLunaCost(candidate)
  const benchmarkPrice =
    soldPriceIntelligence.medianSoldPrice || soldPriceIntelligence.averageSoldPrice
  const estimatedNetProfit =
    calculateEstimatedNetProfit(benchmarkPrice, lunaCost, options)
  const marginPercent =
    benchmarkPrice > 0
      ? estimatedNetProfit / benchmarkPrice
      : 0
  const imageCount =
    getImageCount(candidate)
  const needsData =
    getNeedsData(candidate)
  const minimumHealthyMarginPercent =
    normalizeNumber(options.minimumHealthyMarginPercent, 0.22)
  const soldCount =
    soldPriceIntelligence.soldCountSample
  const priceWarRiskScore =
    clampScore(
      soldPriceIntelligence.activeListingsSample * 12 -
      soldCount * 5 +
      (soldPriceIntelligence.estimatedSellThroughRate < 0.45 ? 20 : 0),
    )
  const marginProtectionScore =
    clampScore(marginPercent * 250)
  const perceivedValueScore =
    clampScore(45 + imageCount * 15 - needsData.length * 10 + (soldCount >= 3 ? 10 : 0))
  const priceConfidenceScore =
    clampScore(
      (soldPriceIntelligence.priceDataConfidence === "HIGH" ? 80 : soldPriceIntelligence.priceDataConfidence === "MEDIUM" ? 60 : 35) +
      (marginPercent >= minimumHealthyMarginPercent ? 15 : -20) -
      Math.max(0, priceWarRiskScore - 65) / 2,
    )

  const priceChangeGuidance =
    marginPercent < 0
      ? "reject_if_margin_destroyed"
      : imageCount === 0 || needsData.includes("missing image")
        ? "improve_image_or_title_first"
        : marginPercent >= minimumHealthyMarginPercent
          ? "hold_price_if_margin_healthy"
          : priceWarRiskScore >= 70
            ? "do_not_lower_price_yet"
            : "adjust_gradually_and_measure_7_10_days"
  const recommendedPricePosition =
    soldCount === 0
      ? "wait_for_more_data"
      : marginPercent < 0
        ? "below_market"
        : perceivedValueScore >= 75
          ? "premium_if_listing_quality_strong"
          : "market_aligned"

  return {
    recommendedPricePosition,
    priceConfidenceScore,
    priceWarRiskScore,
    perceivedValueScore,
    marginProtectionScore,
    doNotRaceToBottom:
      true,
    lowestPriceNotRequired:
      true,
    priceChangeGuidance,
    estimatedNetProfit:
      Number(estimatedNetProfit.toFixed(2)),
    estimatedMarginPercent:
      Number((marginPercent * 100).toFixed(2)),
  }
}

export function calculateDirectSourcingSignals(
  candidate: BenchmarkCandidate,
  soldPriceIntelligence: ReturnType<typeof calculateSoldPriceIntelligence>,
  options: BenchmarkOptions = {},
) {
  const lunaCost =
    getLunaCost(candidate)
  const estimatedDirectBuyCost =
    Number((lunaCost * 0.72).toFixed(2))
  const benchmarkPrice =
    soldPriceIntelligence.medianSoldPrice || soldPriceIntelligence.averageSoldPrice
  const lunaProfit =
    calculateEstimatedNetProfit(benchmarkPrice, lunaCost, options)
  const directBuyProfit =
    calculateEstimatedNetProfit(benchmarkPrice, estimatedDirectBuyCost, options)
  const directBuyProfitUpside =
    Number((directBuyProfit - lunaProfit).toFixed(2))
  const stockStatus =
    getStockStatus(candidate)
  const soldCount =
    soldPriceIntelligence.soldCountSample
  const directBuyOpportunityScore =
    clampScore(
      directBuyProfitUpside * 7 +
      soldCount * 10 +
      (soldPriceIntelligence.estimatedSellThroughRate * 30) -
      (stockStatus === "out_of_stock" ? 35 : 0),
    )
  const capitalRiskLevel =
    directBuyOpportunityScore >= 70
      ? "LOW"
      : directBuyOpportunityScore >= 40
        ? "MEDIUM"
        : "HIGH"
  const suggestedSourcingAction =
    stockStatus === "out_of_stock"
      ? "REJECT"
      : directBuyOpportunityScore >= 78
        ? "BUY_DIRECT_SMALL_BATCH"
        : directBuyOpportunityScore >= 55
          ? "REQUEST_DIRECT_SUPPLIER_QUOTE"
          : soldCount > 0
            ? "SELL_VIA_LUNA_PORTEX"
            : "WATCHLIST"

  return {
    lunaCost:
      Number(lunaCost.toFixed(2)),
    estimatedDirectBuyCost,
    directBuyProfitUpside,
    directBuyOpportunityScore,
    suggestedSourcingAction,
    capitalRiskLevel,
    minimumDataNeededForDirectBuy:
      [
        soldCount < 3 ? "more sold comps" : null,
        getImageCount(candidate) === 0 ? "product image" : null,
        stockStatus === "unknown" ? "stock confirmation" : null,
      ].filter((entry): entry is string => entry !== null),
    outsideLunaOpportunityCandidate:
      directBuyOpportunityScore >= 55,
  }
}

export function calculateBenchmarkReadiness(
  candidate: BenchmarkCandidate,
  benchmarkResult: {
    soldPriceIntelligence: ReturnType<typeof calculateSoldPriceIntelligence>
    pricingPsychologyInputs: ReturnType<typeof calculatePricingPsychologyInputs>
    directSourcingSignals: ReturnType<typeof calculateDirectSourcingSignals>
  },
  options: BenchmarkOptions = {},
) {
  void options
  const reasons: string[] = []
  const blockers: string[] = []
  const warnings: string[] = []
  const needsData =
    getNeedsData(candidate)
  const stockStatus =
    getStockStatus(candidate)

  if (!benchmarkResult.soldPriceIntelligence.soldDataAvailable) {
    blockers.push("sold data missing")
  } else if (benchmarkResult.soldPriceIntelligence.priceDataConfidence === "LOW") {
    warnings.push("sold data sample is low confidence")
  } else {
    reasons.push("sold price data available")
  }

  if (needsData.includes("missing image") || getImageCount(candidate) === 0) {
    blockers.push("image data missing")
  }

  if (stockStatus === "unknown" || stockStatus === "out_of_stock") {
    blockers.push("stock confirmation needed")
  }

  if (benchmarkResult.pricingPsychologyInputs.priceChangeGuidance === "reject_if_margin_destroyed") {
    blockers.push("margin destroyed")
  }

  if (benchmarkResult.pricingPsychologyInputs.priceWarRiskScore >= 70) {
    warnings.push("price war risk elevated")
  }

  const nextRecommendedAction =
    blockers.includes("margin destroyed")
      ? "REJECT_FOR_NOW"
      : blockers.includes("image data missing")
        ? "NEEDS_IMAGE_DATA"
        : blockers.includes("stock confirmation needed")
          ? "NEEDS_STOCK_CONFIRMATION"
          : blockers.includes("sold data missing")
            ? "NEEDS_MORE_SOLD_DATA"
            : warnings.some(warning => warning.includes("compliance"))
              ? "NEEDS_COMPLIANCE_REVIEW"
              : "READY_FOR_WINNER_SCORE"

  return {
    benchmarkReady:
      nextRecommendedAction === "READY_FOR_WINNER_SCORE",
    reasons,
    blockers,
    warnings,
    nextRecommendedAction,
  }
}

export function buildBenchmarkDataModel(
  candidates: BenchmarkCandidate[] = [],
  soldPriceSignals: SoldPriceSignal[] = [],
  options: BenchmarkOptions = {},
) {
  const limitedCandidates =
    Array.isArray(candidates)
      ? candidates.slice(0, maxBenchmarkCandidates)
      : []
  const models =
    limitedCandidates.map(candidate => {
      const candidateKey =
        getCandidateKey(candidate)
      const signal =
        soldPriceSignals.find(entry => normalizeText(entry.candidateKey) === candidateKey) ?? {}
      const candidateInput =
        buildBenchmarkCandidateInput(candidate, signal, options)
      const soldPriceIntelligence =
        calculateSoldPriceIntelligence(signal, options)
      const pricingPsychologyInputs =
        calculatePricingPsychologyInputs(candidate, soldPriceIntelligence, options)
      const directSourcingSignals =
        calculateDirectSourcingSignals(candidate, soldPriceIntelligence, options)
      const benchmarkReadiness =
        calculateBenchmarkReadiness(
          candidate,
          {
            soldPriceIntelligence,
            pricingPsychologyInputs,
            directSourcingSignals,
          },
          options,
        )

      return {
        benchmarkVersion:
          LUNA_PORTEX_BENCHMARK_DATA_MODEL_VERSION,
        sourceDataClass,
        candidateKey,
        candidateInput,
        soldPriceIntelligence,
        pricingPsychologyInputs,
        directSourcingSignals,
        benchmarkReadiness,
      }
    })

  return {
    benchmarkVersion:
      LUNA_PORTEX_BENCHMARK_DATA_MODEL_VERSION,
    sourceDataClass,
    inputCandidates:
      limitedCandidates.length,
    soldPriceSignals:
      soldPriceSignals.length,
    benchmarkModelsBuilt:
      models.length,
    models,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    nextLoop:
      "144",
  }
}

export function summarizeBenchmarkDataModel(
  model: ReturnType<typeof buildBenchmarkDataModel>
) {
  const benchmarkReadyCandidates =
    model.models.filter(entry => entry.benchmarkReadiness.benchmarkReady).length
  const needsMoreDataCandidates =
    model.models.filter(entry => entry.benchmarkReadiness.nextRecommendedAction !== "READY_FOR_WINNER_SCORE").length
  const directSourcingOpportunities =
    model.models.filter(entry => entry.directSourcingSignals.outsideLunaOpportunityCandidate).length
  const priceWarRiskWarnings =
    model.models.filter(entry => entry.pricingPsychologyInputs.priceWarRiskScore >= 70).length
  const pricingPsychologyWarnings =
    model.models.filter(entry =>
      entry.pricingPsychologyInputs.priceChangeGuidance !== "hold_price_if_margin_healthy" &&
      entry.pricingPsychologyInputs.priceChangeGuidance !== "adjust_gradually_and_measure_7_10_days",
    ).length
  const candidatesNeedingComplianceReview =
    model.models.filter(entry => entry.benchmarkReadiness.nextRecommendedAction === "NEEDS_COMPLIANCE_REVIEW").length

  return {
    inputCandidates:
      model.inputCandidates,
    soldPriceSignals:
      model.soldPriceSignals,
    benchmarkModelsBuilt:
      model.benchmarkModelsBuilt,
    benchmarkReadyCandidates,
    needsMoreDataCandidates,
    directSourcingOpportunities,
    priceWarRiskWarnings,
    pricingPsychologyWarnings,
    candidatesNeedingComplianceReview,
    nextLoop:
      model.nextLoop,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
  }
}

export function getBenchmarkDataModelChecklist() {
  return [
    "confirm sold price intelligence uses sanitized fixture data",
    "confirm no eBay API, OAuth, Terapeak, scraping, or external calls",
    "confirm pricing psychology does not race to the bottom",
    "confirm direct sourcing signals are calculated locally",
    "confirm no Production or Staging writes",
    "confirm next loop is 144 — Winner Score V2",
  ]
}
