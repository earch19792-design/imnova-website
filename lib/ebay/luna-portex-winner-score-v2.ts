export const LUNA_PORTEX_WINNER_SCORE_V2_VERSION =
  "LUNA_PORTEX_WINNER_SCORE_V2_BUY_DIRECT_OPPORTUNITY_V1"

const sourceDataClass =
  "LOOP_144_WINNER_SCORE_V2"
const maxWinnerScoreCandidates =
  10

type BenchmarkModelEntry = {
  candidateKey?: string | null
  candidateInput?: {
    title?: string | null
    lunaCost?: number | null
    stockStatus?: string | null
    imageCount?: number | null
    needsData?: string[] | null
  } | null
  soldPriceIntelligence?: {
    averageSoldPrice?: number | null
    medianSoldPrice?: number | null
    soldCountSample?: number | null
    activeListingsSample?: number | null
    estimatedSellThroughRate?: number | null
    priceDataConfidence?: string | null
    soldDataAvailable?: boolean | null
  } | null
  pricingPsychologyInputs?: {
    priceConfidenceScore?: number | null
    priceWarRiskScore?: number | null
    perceivedValueScore?: number | null
    marginProtectionScore?: number | null
    doNotRaceToBottom?: boolean | null
    lowestPriceNotRequired?: boolean | null
    priceChangeGuidance?: string | null
    estimatedNetProfit?: number | null
    estimatedMarginPercent?: number | null
  } | null
  directSourcingSignals?: {
    lunaCost?: number | null
    estimatedDirectBuyCost?: number | null
    directBuyProfitUpside?: number | null
    directBuyOpportunityScore?: number | null
    suggestedSourcingAction?: string | null
    capitalRiskLevel?: string | null
    minimumDataNeededForDirectBuy?: string[] | null
    outsideLunaOpportunityCandidate?: boolean | null
  } | null
  benchmarkReadiness?: {
    benchmarkReady?: boolean | null
    blockers?: string[] | null
    warnings?: string[] | null
    nextRecommendedAction?: string | null
  } | null
}

type WinnerScoreOptions = {
  complianceKeywords?: string[] | null
  estimatedInitialDirectUnits?: number | null
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

function normalizeArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function hasComplianceRisk(input: ReturnType<typeof buildWinnerScoreInput>, options: WinnerScoreOptions = {}) {
  const keywords =
    options.complianceKeywords ?? ["aerosol", "hazmat", "electrical", "battery", "spray"]
  const searchable =
    `${input.title} ${input.candidateKey}`.toLowerCase()

  return keywords.some(keyword => searchable.includes(keyword.toLowerCase()))
}

export function buildWinnerScoreInput(
  benchmarkModel: BenchmarkModelEntry,
  options: WinnerScoreOptions = {},
) {
  void options
  const candidateInput =
    benchmarkModel.candidateInput ?? {}
  const soldPriceIntelligence =
    benchmarkModel.soldPriceIntelligence ?? {}
  const pricingPsychologyInputs =
    benchmarkModel.pricingPsychologyInputs ?? {}
  const directSourcingSignals =
    benchmarkModel.directSourcingSignals ?? {}
  const benchmarkReadiness =
    benchmarkModel.benchmarkReadiness ?? {}

  return {
    winnerScoreVersion:
      LUNA_PORTEX_WINNER_SCORE_V2_VERSION,
    sourceDataClass,
    candidateKey:
      normalizeText(benchmarkModel.candidateKey) ?? "unknown-candidate",
    title:
      normalizeText(candidateInput.title) ?? "Untitled Luna Portex candidate",
    lunaCost:
      normalizeNumber(candidateInput.lunaCost, normalizeNumber(directSourcingSignals.lunaCost, 0)),
    stockStatus:
      normalizeText(candidateInput.stockStatus) ?? "unknown",
    imageCount:
      normalizeNumber(candidateInput.imageCount, 0),
    needsData:
      normalizeArray(candidateInput.needsData),
    soldPriceIntelligence:
      {
        averageSoldPrice:
          normalizeNumber(soldPriceIntelligence.averageSoldPrice, 0),
        medianSoldPrice:
          normalizeNumber(soldPriceIntelligence.medianSoldPrice, 0),
        soldCountSample:
          normalizeNumber(soldPriceIntelligence.soldCountSample, 0),
        activeListingsSample:
          normalizeNumber(soldPriceIntelligence.activeListingsSample, 0),
        estimatedSellThroughRate:
          normalizeNumber(soldPriceIntelligence.estimatedSellThroughRate, 0),
        priceDataConfidence:
          normalizeText(soldPriceIntelligence.priceDataConfidence) ?? "LOW",
        soldDataAvailable:
          soldPriceIntelligence.soldDataAvailable === true,
      },
    pricingPsychologyInputs:
      {
        priceConfidenceScore:
          normalizeNumber(pricingPsychologyInputs.priceConfidenceScore, 0),
        priceWarRiskScore:
          normalizeNumber(pricingPsychologyInputs.priceWarRiskScore, 0),
        perceivedValueScore:
          normalizeNumber(pricingPsychologyInputs.perceivedValueScore, 0),
        marginProtectionScore:
          normalizeNumber(pricingPsychologyInputs.marginProtectionScore, 0),
        doNotRaceToBottom:
          pricingPsychologyInputs.doNotRaceToBottom !== false,
        lowestPriceNotRequired:
          pricingPsychologyInputs.lowestPriceNotRequired !== false,
        priceChangeGuidance:
          normalizeText(pricingPsychologyInputs.priceChangeGuidance) ?? "do_not_lower_price_yet",
        estimatedNetProfit:
          normalizeNumber(pricingPsychologyInputs.estimatedNetProfit, 0),
        estimatedMarginPercent:
          normalizeNumber(pricingPsychologyInputs.estimatedMarginPercent, 0),
      },
    directSourcingSignals:
      {
        lunaCost:
          normalizeNumber(directSourcingSignals.lunaCost, 0),
        estimatedDirectBuyCost:
          normalizeNumber(directSourcingSignals.estimatedDirectBuyCost, 0),
        directBuyProfitUpside:
          normalizeNumber(directSourcingSignals.directBuyProfitUpside, 0),
        directBuyOpportunityScore:
          normalizeNumber(directSourcingSignals.directBuyOpportunityScore, 0),
        suggestedSourcingAction:
          normalizeText(directSourcingSignals.suggestedSourcingAction) ?? "WATCHLIST",
        capitalRiskLevel:
          normalizeText(directSourcingSignals.capitalRiskLevel) ?? "HIGH",
        minimumDataNeededForDirectBuy:
          normalizeArray(directSourcingSignals.minimumDataNeededForDirectBuy),
        outsideLunaOpportunityCandidate:
          directSourcingSignals.outsideLunaOpportunityCandidate === true,
      },
    benchmarkReadiness:
      {
        benchmarkReady:
          benchmarkReadiness.benchmarkReady === true,
        blockers:
          normalizeArray(benchmarkReadiness.blockers),
        warnings:
          normalizeArray(benchmarkReadiness.warnings),
        nextRecommendedAction:
          normalizeText(benchmarkReadiness.nextRecommendedAction) ?? "NEEDS_MORE_SOLD_DATA",
      },
  }
}

export function calculateWinnerScoreV2(
  input: ReturnType<typeof buildWinnerScoreInput>,
  options: WinnerScoreOptions = {},
) {
  const demandScore =
    clampScore(
      input.soldPriceIntelligence.soldCountSample * 16 +
      input.soldPriceIntelligence.estimatedSellThroughRate * 45 -
      input.soldPriceIntelligence.activeListingsSample * 4,
    )
  const profitabilityScore =
    clampScore(
      input.pricingPsychologyInputs.estimatedMarginPercent * 2 +
      input.pricingPsychologyInputs.estimatedNetProfit * 2,
    )
  const priceConfidenceScore =
    clampScore(input.pricingPsychologyInputs.priceConfidenceScore)
  const marginProtectionScore =
    clampScore(input.pricingPsychologyInputs.marginProtectionScore)
  const perceivedValueScore =
    clampScore(input.pricingPsychologyInputs.perceivedValueScore)
  const dataQualityScore =
    clampScore(
      (input.soldPriceIntelligence.priceDataConfidence === "HIGH" ? 85 : input.soldPriceIntelligence.priceDataConfidence === "MEDIUM" ? 70 : 35) -
      input.needsData.length * 12,
    )
  const stockReadinessScore =
    input.stockStatus === "in_stock"
      ? 100
      : input.stockStatus === "low_stock"
        ? 65
        : input.stockStatus === "unknown"
          ? 25
          : 0
  const competitionRiskAdjustedScore =
    clampScore(100 - input.pricingPsychologyInputs.priceWarRiskScore)
  const complianceReadinessScore =
    hasComplianceRisk(input, options) ? 35 : 100
  const imageReadinessScore =
    input.imageCount > 0 && !input.needsData.includes("missing image")
      ? 100
      : 20
  const finalRiskPenalty =
    clampScore(
      (input.soldPriceIntelligence.priceDataConfidence === "LOW" ? 18 : 0) +
      (imageReadinessScore < 50 ? 20 : 0) +
      (stockReadinessScore < 70 ? 18 : 0) +
      (complianceReadinessScore < 70 ? 15 : 0) +
      (marginProtectionScore < 45 ? 25 : 0) +
      Math.max(0, input.pricingPsychologyInputs.priceWarRiskScore - 65),
    )
  const rawWinnerScore =
    demandScore * 0.15 +
    profitabilityScore * 0.16 +
    priceConfidenceScore * 0.12 +
    marginProtectionScore * 0.14 +
    perceivedValueScore * 0.11 +
    dataQualityScore * 0.1 +
    stockReadinessScore * 0.08 +
    competitionRiskAdjustedScore * 0.06 +
    complianceReadinessScore * 0.04 +
    imageReadinessScore * 0.04 -
    finalRiskPenalty * 0.35

  return {
    winnerScore:
      clampScore(rawWinnerScore),
    demandScore,
    profitabilityScore,
    priceConfidenceScore,
    marginProtectionScore,
    perceivedValueScore,
    dataQualityScore,
    stockReadinessScore,
    competitionRiskAdjustedScore,
    complianceReadinessScore,
    imageReadinessScore,
    finalRiskPenalty,
    doNotRaceToBottom:
      input.pricingPsychologyInputs.doNotRaceToBottom,
    lowestPriceNotRequired:
      input.pricingPsychologyInputs.lowestPriceNotRequired,
  }
}

export function calculateBuyDirectOpportunityScore(
  input: ReturnType<typeof buildWinnerScoreInput>,
  options: WinnerScoreOptions = {},
) {
  const estimatedInitialDirectUnits =
    normalizeNumber(options.estimatedInitialDirectUnits, 12)
  const baseScore =
    clampScore(input.directSourcingSignals.directBuyOpportunityScore)
  const missingData =
    [
      ...input.directSourcingSignals.minimumDataNeededForDirectBuy,
      input.imageCount === 0 ? "product image" : null,
      input.soldPriceIntelligence.priceDataConfidence === "LOW" ? "stronger sold data" : null,
    ].filter((entry): entry is string => entry !== null)
  const directSourcingDecision =
    input.pricingPsychologyInputs.priceChangeGuidance === "reject_if_margin_destroyed"
      ? "REJECT"
      : baseScore >= 80 && missingData.length === 0
        ? "BUY_DIRECT_SMALL_BATCH"
        : baseScore >= 55
          ? "REQUEST_DIRECT_SUPPLIER_QUOTE"
          : baseScore >= 35
            ? "WATCHLIST"
            : "SELL_VIA_LUNA_PORTEX"

  return {
    buyDirectOpportunityScore:
      baseScore,
    profitUpsidePerUnit:
      Number(input.directSourcingSignals.directBuyProfitUpside.toFixed(2)),
    estimatedDirectBuyCost:
      Number(input.directSourcingSignals.estimatedDirectBuyCost.toFixed(2)),
    lunaPortexCost:
      Number(input.lunaCost.toFixed(2)),
    estimatedCapitalNeeded:
      Number((input.directSourcingSignals.estimatedDirectBuyCost * estimatedInitialDirectUnits).toFixed(2)),
    capitalRiskLevel:
      input.directSourcingSignals.capitalRiskLevel as "LOW" | "MEDIUM" | "HIGH",
    directSourcingDecision,
    directSourcingReasons:
      [
        input.directSourcingSignals.outsideLunaOpportunityCandidate ? "outside Luna opportunity candidate" : "Luna Portex resale path remains primary",
        input.directSourcingSignals.directBuyProfitUpside > 0 ? "direct buy improves unit economics" : "direct buy upside not proven",
        input.soldPriceIntelligence.priceDataConfidence === "LOW" ? "sold data confidence is low" : "sold data supports review",
      ],
    minimumDataNeededBeforeBuyingDirect:
      missingData,
  }
}

export function calculateWinnerReadinessGates(
  input: ReturnType<typeof buildWinnerScoreInput>,
  score: ReturnType<typeof calculateWinnerScoreV2> & {
    buyDirectOpportunity?: ReturnType<typeof calculateBuyDirectOpportunityScore>
  },
  options: WinnerScoreOptions = {},
) {
  const blockedReasons: string[] = []
  const warnings: string[] = []
  const complianceRisk =
    hasComplianceRisk(input, options)

  if (!input.benchmarkReadiness.benchmarkReady) {
    warnings.push("benchmark requires human review before listing flow")
  }

  if (input.imageCount === 0 || input.needsData.includes("missing image")) {
    blockedReasons.push("missing image")
  }

  if (input.stockStatus === "unknown" || input.stockStatus === "out_of_stock") {
    blockedReasons.push("stock not confirmed")
  }

  if (complianceRisk) {
    blockedReasons.push("compliance review required")
  }

  if (input.soldPriceIntelligence.priceDataConfidence === "LOW") {
    blockedReasons.push("sold price confidence low")
  }

  if (score.marginProtectionScore < 45) {
    blockedReasons.push("margin protection low")
  }

  if (score.finalRiskPenalty >= 50) {
    warnings.push("risk penalty elevated")
  }

  const nextRecommendedAction =
    blockedReasons.includes("compliance review required")
      ? "NEEDS_COMPLIANCE_REVIEW"
      : blockedReasons.includes("missing image")
        ? "NEEDS_IMAGE_PACKAGE"
        : blockedReasons.includes("stock not confirmed")
          ? "NEEDS_STOCK_CONFIRMATION"
          : blockedReasons.includes("sold price confidence low")
            ? "NEEDS_MORE_BENCHMARK_DATA"
            : score.buyDirectOpportunity?.directSourcingDecision === "REQUEST_DIRECT_SUPPLIER_QUOTE"
              ? "REQUEST_DIRECT_SUPPLIER_QUOTE"
              : score.winnerScore >= 70
                ? "SEND_TO_ADVISOR_OS"
                : score.winnerScore >= 45
                  ? "WATCHLIST_MORE_DATA"
                  : "REJECT_FOR_NOW"

  return {
    benchmarkReady:
      input.benchmarkReadiness.benchmarkReady,
    readyForAdvisorReview:
      nextRecommendedAction === "SEND_TO_ADVISOR_OS" ||
      nextRecommendedAction === "REQUEST_DIRECT_SUPPLIER_QUOTE" ||
      (score.winnerScore >= 50 && blockedReasons.length <= 2),
    readyForListingBuilder:
      false,
    readyForImageWorkflow:
      blockedReasons.includes("missing image"),
    readyForEbaySandboxDraft:
      false,
    readyForRealListing:
      false,
    blockedReasons,
    warnings,
    nextRecommendedAction,
  }
}

export function calculateSellerDecision(
  score: ReturnType<typeof calculateWinnerScoreV2> & {
    buyDirectOpportunity: ReturnType<typeof calculateBuyDirectOpportunityScore>
  },
  readiness: ReturnType<typeof calculateWinnerReadinessGates>,
  options: WinnerScoreOptions = {},
) {
  void options

  if (
    readiness.blockedReasons.includes("margin protection low") &&
    score.priceConfidenceScore < 45
  ) {
    return "REJECT"
  }

  if (readiness.nextRecommendedAction === "REJECT_FOR_NOW") {
    return "REJECT"
  }

  if (
    score.buyDirectOpportunity.directSourcingDecision === "REQUEST_DIRECT_SUPPLIER_QUOTE" ||
    readiness.nextRecommendedAction === "WATCHLIST_MORE_DATA"
  ) {
    return "WATCHLIST"
  }

  if (
    readiness.blockedReasons.length > 0 ||
    !readiness.readyForAdvisorReview ||
    score.dataQualityScore < 60
  ) {
    return "REVIEW"
  }

  if (score.winnerScore >= 72 && readiness.readyForAdvisorReview) {
    return "SELL"
  }

  return "REVIEW"
}

export function buildWinnerScoreV2Model(
  benchmarkModels: BenchmarkModelEntry[] = [],
  options: WinnerScoreOptions = {},
) {
  const limitedBenchmarkModels =
    Array.isArray(benchmarkModels)
      ? benchmarkModels.slice(0, maxWinnerScoreCandidates)
      : []
  const models =
    limitedBenchmarkModels.map(benchmarkModel => {
      const input =
        buildWinnerScoreInput(benchmarkModel, options)
      const winnerScore =
        calculateWinnerScoreV2(input, options)
      const buyDirectOpportunity =
        calculateBuyDirectOpportunityScore(input, options)
      const readiness =
        calculateWinnerReadinessGates(
          input,
          {
            ...winnerScore,
            buyDirectOpportunity,
          },
          options,
        )
      const sellerDecision =
        calculateSellerDecision(
          {
            ...winnerScore,
            buyDirectOpportunity,
          },
          readiness,
          options,
        )

      return {
        winnerScoreVersion:
          LUNA_PORTEX_WINNER_SCORE_V2_VERSION,
        sourceDataClass,
        candidateKey:
          input.candidateKey,
        input,
        score:
          winnerScore,
        buyDirectOpportunity,
        readiness,
        sellerDecision,
      }
    })

  return {
    winnerScoreVersion:
      LUNA_PORTEX_WINNER_SCORE_V2_VERSION,
    sourceDataClass,
    inputBenchmarkModels:
      limitedBenchmarkModels.length,
    winnerScoreModelsBuilt:
      models.length,
    models,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    whatsappRealSendUsed:
      false,
    nextLoop:
      "145",
  }
}

export function summarizeWinnerScoreV2Model(
  model: ReturnType<typeof buildWinnerScoreV2Model>
) {
  return {
    inputBenchmarkModels:
      model.inputBenchmarkModels,
    winnerScoreModelsBuilt:
      model.winnerScoreModelsBuilt,
    sellCandidates:
      model.models.filter(entry => entry.sellerDecision === "SELL").length,
    reviewCandidates:
      model.models.filter(entry => entry.sellerDecision === "REVIEW").length,
    watchlistCandidates:
      model.models.filter(entry => entry.sellerDecision === "WATCHLIST").length,
    rejectCandidates:
      model.models.filter(entry => entry.sellerDecision === "REJECT").length,
    readyForAdvisorReview:
      model.models.filter(entry => entry.readiness.readyForAdvisorReview).length,
    readyForListingBuilder:
      model.models.filter(entry => entry.readiness.readyForListingBuilder).length,
    buyDirectOpportunities:
      model.models.filter(entry => entry.buyDirectOpportunity.buyDirectOpportunityScore >= 55).length,
    requestDirectSupplierQuoteCandidates:
      model.models.filter(entry => entry.buyDirectOpportunity.directSourcingDecision === "REQUEST_DIRECT_SUPPLIER_QUOTE").length,
    priceWarProtectedCandidates:
      model.models.filter(entry => entry.score.doNotRaceToBottom && entry.score.lowestPriceNotRequired).length,
    candidatesBlockedByImages:
      model.models.filter(entry => entry.readiness.blockedReasons.includes("missing image")).length,
    candidatesBlockedByStock:
      model.models.filter(entry => entry.readiness.blockedReasons.includes("stock not confirmed")).length,
    candidatesBlockedByCompliance:
      model.models.filter(entry => entry.readiness.blockedReasons.includes("compliance review required")).length,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    whatsappRealSendUsed:
      false,
    nextLoop:
      model.nextLoop,
  }
}

export function getWinnerScoreV2Checklist() {
  return [
    "confirm benchmark model input is required",
    "confirm no Production or Staging writes",
    "confirm no eBay API, OAuth, WhatsApp, OpenAI, drafts, or publication",
    "confirm Winner Score V2 and Buy-Direct Opportunity Score are 0-100",
    "confirm no product is ready for real listing in LOOP 144",
    "confirm next loop is 145 — Advisor OS Candidate Review",
  ]
}
