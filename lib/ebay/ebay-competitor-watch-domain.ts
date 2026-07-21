import { createHash } from "node:crypto"

import type { SafeEbayActiveCompetitorObservation } from "./ebay-seller-keyword-demand-gateway"
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { controlledRiskEconomicsConfig } from "./ebay-controlled-risk-manual-override.ts"
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { calculateEbayMinimumOperatorPrice, calculateEbayUnitEconomics } from "./ebay-unit-economics.ts"

export const EBAY_COMPETITOR_WATCH_VERSION =
  "EBAY_LISTING_COMPETITOR_WATCH_V2" as const

const RESEARCH_RECOMMENDATION_COOLDOWN_DAYS = 7
const CONFIRMED_SOLD_PRICE_MAX_AGE_DAYS = 90
const MATERIAL_PRICE_ADVANTAGE_RATIO = 0.9
const MATERIAL_PRICE_RECOMMENDATION_RATIO = 0.05
const COMMON_PATTERN_RATIO = 0.67
const MULTI_IMAGE_MINIMUM = 4

export type CompetitorWatchPreviousOffer = {
  itemReferenceHash: string
  sellerReferenceHash: string
  active: boolean
  firstSeenAsBaseline: boolean
  consecutiveScanCount: number
  potentialNotifiedAt: string | null
  evidenceClass: "ACTIVE_ONLY" | "ESTIMATED_ACTIVITY" | "CONFIRMED_SOLD_HISTORY"
}

export type CompetitorWatchOwnListing = {
  itemPrice: number | null
  landedPrice: number | null
  shippingCost: number | null
  packQuantity: number
  supplierUnitCost: number | null
  supplierCostFresh: boolean
  supplierAvailable: boolean | null
  returnsAccepted: boolean | null
  imageCount: number | null
  title: string
  promotionAllowed?: boolean | null
}

export type CompetitorWatchObservation = Omit<
  SafeEbayActiveCompetitorObservation,
  "evidenceClass"
> & {
  evidenceClass: "ACTIVE_ONLY" | "ESTIMATED_ACTIVITY" | "CONFIRMED_SOLD_HISTORY"
  confirmedSoldQuantity?: number
  confirmedSoldLastDate?: string | null
  confirmedSoldItemPrice?: number | null
  confirmedSoldShippingCost?: number | null
  confirmedSoldLandedPrice?: number | null
  confirmedSoldOfferPackCount?: number | null
}

export type CompetitorWatchAnalysisInput = {
  observations: CompetitorWatchObservation[]
  previousOffers: CompetitorWatchPreviousOffer[]
  baselineExists: boolean
  ownListing: CompetitorWatchOwnListing
  crossSellerCandidateConfirmedTerms: string[]
  previousSuggestionCodes?: string[]
  lastResearchRefreshRecommendedAt: string | null
  observedAt: string
}

function finite(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null
}

function median(values: number[]) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (!ordered.length) return null
  const middle = Math.floor(ordered.length / 2)
  const value = ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2
  return Number(value.toFixed(2))
}

function money(value: number) {
  return Math.round(value * 100) / 100
}

function recentConfirmedSoldDate(value: string | null | undefined, observedAt: string) {
  const soldAt = Date.parse(value ?? "")
  const observed = Date.parse(observedAt)
  return Number.isFinite(soldAt) && Number.isFinite(observed) && soldAt <= observed &&
    observed - soldAt <= CONFIRMED_SOLD_PRICE_MAX_AGE_DAYS * 86_400_000
}

export function buildConfirmedSoldPriceRecommendation(input: Pick<
  CompetitorWatchAnalysisInput,
  "observations" | "ownListing" | "observedAt"
>) {
  const ownItemPrice = finite(input.ownListing.itemPrice)
  const ownShippingCost = finite(input.ownListing.shippingCost) ?? 0
  const ownPackQuantity = Number(input.ownListing.packQuantity)
  const supplierUnitCost = finite(input.ownListing.supplierUnitCost)
  if (ownItemPrice === null || ownItemPrice <= 0 || ownShippingCost < 0 ||
    !Number.isInteger(ownPackQuantity) || ownPackQuantity <= 0 ||
    supplierUnitCost === null || supplierUnitCost < 0 ||
    !input.ownListing.supplierCostFresh || input.ownListing.supplierAvailable !== true) {
    return null
  }

  const comparableBySeller = new Map<string, CompetitorWatchObservation>()
  for (const observation of input.observations) {
    const soldQuantity = Math.max(0, Math.trunc(finite(
      observation.confirmedSoldQuantity,
    ) ?? 0))
    const soldLandedPrice = finite(observation.confirmedSoldLandedPrice)
    const observedPackQuantity = finite(observation.confirmedSoldOfferPackCount)
    if (observation.evidenceClass !== "CONFIRMED_SOLD_HISTORY" ||
      soldQuantity < 1 || soldLandedPrice === null || soldLandedPrice <= 0 ||
      observedPackQuantity !== ownPackQuantity ||
      !recentConfirmedSoldDate(observation.confirmedSoldLastDate, input.observedAt)) {
      continue
    }
    const previous = comparableBySeller.get(observation.sellerReferenceHash)
    const previousSoldQuantity = Math.max(0, Math.trunc(finite(
      previous?.confirmedSoldQuantity,
    ) ?? 0))
    const previousSoldAt = Date.parse(previous?.confirmedSoldLastDate ?? "")
    const currentSoldAt = Date.parse(observation.confirmedSoldLastDate ?? "")
    if (!previous || soldQuantity > previousSoldQuantity ||
      (soldQuantity === previousSoldQuantity && currentSoldAt > previousSoldAt)) {
      comparableBySeller.set(observation.sellerReferenceHash, observation)
    }
  }
  const confirmedSellerOffers = [...comparableBySeller.values()]
  const confirmedSoldBenchmarkLandedPrice = median(confirmedSellerOffers
    .map((observation) => finite(observation.confirmedSoldLandedPrice))
    .filter((value): value is number => value !== null && value > 0))
  if (confirmedSoldBenchmarkLandedPrice === null) return null

  const totalSupplierCost = money(supplierUnitCost * ownPackQuantity)
  const floor = calculateEbayMinimumOperatorPrice({ supplierCost: totalSupplierCost })
  if (!floor.ready || floor.minimumOperatorPrice === null) return null
  const minimumSafeLandedPrice = floor.minimumOperatorPrice
  const currentLandedPrice = money(ownItemPrice + ownShippingCost)
  const benchmarkGapRatio = confirmedSoldBenchmarkLandedPrice > 0
    ? (currentLandedPrice - confirmedSoldBenchmarkLandedPrice) /
      confirmedSoldBenchmarkLandedPrice
    : 0
  let action: "RAISE_TO_CONFIRMED_SOLD_BAND" | "LOWER_TO_CONFIRMED_SOLD_BAND" |
    "KEEP_PRICE_IN_CONFIRMED_SOLD_BAND" | "DO_NOT_MATCH_BELOW_ECONOMIC_FLOOR"
  let proposedLandedPrice = currentLandedPrice
  if (confirmedSoldBenchmarkLandedPrice < minimumSafeLandedPrice) {
    action = "DO_NOT_MATCH_BELOW_ECONOMIC_FLOOR"
    proposedLandedPrice = Math.max(currentLandedPrice, minimumSafeLandedPrice)
  } else if (currentLandedPrice < minimumSafeLandedPrice ||
    benchmarkGapRatio <= -MATERIAL_PRICE_RECOMMENDATION_RATIO) {
    action = "RAISE_TO_CONFIRMED_SOLD_BAND"
    proposedLandedPrice = Math.max(
      minimumSafeLandedPrice,
      confirmedSoldBenchmarkLandedPrice,
    )
  } else if (benchmarkGapRatio >= MATERIAL_PRICE_RECOMMENDATION_RATIO) {
    action = "LOWER_TO_CONFIRMED_SOLD_BAND"
    proposedLandedPrice = Math.max(
      minimumSafeLandedPrice,
      confirmedSoldBenchmarkLandedPrice,
    )
  } else {
    action = "KEEP_PRICE_IN_CONFIRMED_SOLD_BAND"
  }
  proposedLandedPrice = money(proposedLandedPrice)
  const proposedItemPrice = money(Math.max(0.01,
    proposedLandedPrice - ownShippingCost))
  const expected = calculateEbayUnitEconomics({
    salePrice: proposedLandedPrice,
    supplierCost: totalSupplierCost,
  })
  const current = calculateEbayUnitEconomics({
    salePrice: currentLandedPrice,
    supplierCost: totalSupplierCost,
  })
  const confirmedSoldQuantity = confirmedSellerOffers.reduce((total, observation) =>
    total + Math.max(0, Math.trunc(finite(observation.confirmedSoldQuantity) ?? 0)), 0)
  const confirmedSoldSellerCount = confirmedSellerOffers.length
  const confidence = confirmedSoldSellerCount >= 3 && confirmedSoldQuantity >= 10
    ? "HIGH" : confirmedSoldSellerCount >= 2 || confirmedSoldQuantity >= 5
      ? "MEDIUM" : "LOW"
  const reservedPromotionPercent = money(
    Number(expected.config.promotedListingsReserveRate ?? 0) * 100,
  )
  const promotionRecommendation = {
    status: input.ownListing.promotionAllowed === false
      ? "BLOCKED_CONTROLLED_RISK_TEN_PERCENT_MARGIN" as const
      : expected.passesProfitGate && reservedPromotionPercent > 0
      ? "ELIGIBLE_FOR_HUMAN_REVIEW" as const
      : "DO_NOT_PROMOTE_ECONOMICS_INSUFFICIENT" as const,
    recommendedRatePercent: input.ownListing.promotionAllowed === false
      ? 0 : expected.passesProfitGate
      ? reservedPromotionPercent : 0,
    maximumReservedRatePercent: reservedPromotionPercent,
    estimatedMarginAfterRecommendedPromotionPercent:
      expected.estimatedNetMarginPercent,
    automaticPromotionAllowed: false,
    humanApprovalRequired: true,
    reason: input.ownListing.promotionAllowed === false
      ? "No hay margen para aplicar promoción: listing bajo excepción de margen 10%."
      : expected.passesProfitGate
        ? "La reserva publicitaria configurada cabe en la economía estimada."
        : "La economía estimada no soporta la reserva publicitaria.",
  }
  return {
    action,
    confidence,
    currentItemPrice: money(ownItemPrice),
    currentLandedPrice,
    proposedItemPrice,
    proposedLandedPrice,
    confirmedSoldBenchmarkLandedPrice,
    confirmedSoldSellerCount,
    confirmedSoldOfferCount: confirmedSellerOffers.length,
    confirmedSoldQuantity,
    newestConfirmedSoldAt: confirmedSellerOffers
      .map((observation) => observation.confirmedSoldLastDate ?? "")
      .filter(Boolean)
      .sort()
      .at(-1) ?? null,
    ownPackQuantity,
    supplierUnitCost: money(supplierUnitCost),
    totalSupplierCost,
    minimumSafeLandedPrice,
    currentEstimatedNetProfit: current.estimatedNetProfit,
    currentEstimatedMarginPercent: current.estimatedNetMarginPercent,
    proposedEstimatedNetProfit: expected.estimatedNetProfit,
    proposedEstimatedMarginPercent: expected.estimatedNetMarginPercent,
    proposedEstimatedRoiPercent: expected.estimatedRoiPercent,
    proposedPassesProfitGate: expected.passesProfitGate,
    promotionRecommendation,
    comparisonBasis: "PRODUCT_RESEARCH_CONFIRMED_SOLD_LANDED_PRICE" as const,
    soldEvidenceMaxAgeDays: CONFIRMED_SOLD_PRICE_MAX_AGE_DAYS,
    activeOfferPriceTreatedAsSoldPrice: false,
    automaticPriceChangeAllowed: false,
    humanApprovalRequired: true,
  }
}

export function buildActiveMarketPriceRecommendation(input: Pick<
  CompetitorWatchAnalysisInput,
  "ownListing"
> & {
  medianLandedPrice: number | null
  activeSellerCount: number
}) {
  const ownItemPrice = finite(input.ownListing.itemPrice)
  const ownShippingCost = finite(input.ownListing.shippingCost) ?? 0
  const ownPackQuantity = Number(input.ownListing.packQuantity)
  const supplierUnitCost = finite(input.ownListing.supplierUnitCost)
  const activeMedian = finite(input.medianLandedPrice)
  if (ownItemPrice === null || ownItemPrice <= 0 || ownShippingCost < 0 ||
    activeMedian === null || activeMedian <= 0 || input.activeSellerCount < 2 ||
    !Number.isInteger(ownPackQuantity) || ownPackQuantity <= 0 ||
    supplierUnitCost === null || supplierUnitCost < 0 ||
    !input.ownListing.supplierCostFresh || input.ownListing.supplierAvailable !== true) {
    return null
  }
  const totalSupplierCost = money(supplierUnitCost * ownPackQuantity)
  const floorWithPromotionReserve = calculateEbayMinimumOperatorPrice({
    supplierCost: totalSupplierCost,
  })
  const floorWithoutPromotion = calculateEbayMinimumOperatorPrice({
    supplierCost: totalSupplierCost,
  }, { promotedListingsReserveRate: 0 })
  const controlledRiskConfig = controlledRiskEconomicsConfig()
  const controlledRiskFloor = calculateEbayMinimumOperatorPrice({
    supplierCost: totalSupplierCost,
  }, controlledRiskConfig)
  if (!floorWithPromotionReserve.ready || !floorWithoutPromotion.ready ||
    !controlledRiskFloor.ready ||
    floorWithPromotionReserve.minimumOperatorPrice === null ||
    floorWithoutPromotion.minimumOperatorPrice === null ||
    controlledRiskFloor.minimumOperatorPrice === null) return null

  const standardPromotionReserveIncluded = input.ownListing.promotionAllowed !== false
  const standardMinimumSafeLandedPrice = standardPromotionReserveIncluded
    ? floorWithPromotionReserve.minimumOperatorPrice
    : floorWithoutPromotion.minimumOperatorPrice
  const currentLandedPrice = money(ownItemPrice + ownShippingCost)
  const activeMarketControlledEconomics = calculateEbayUnitEconomics({
    salePrice: activeMedian,
    supplierCost: totalSupplierCost,
  }, controlledRiskConfig)
  const controlledRiskTenPercent = input.activeSellerCount >= 3 &&
    activeMedian >= controlledRiskFloor.minimumOperatorPrice &&
    activeMarketControlledEconomics.ready &&
    activeMarketControlledEconomics.passesProfitGate
  const minimumSafeLandedPrice = controlledRiskTenPercent
    ? controlledRiskFloor.minimumOperatorPrice
    : standardMinimumSafeLandedPrice
  const promotionReserveIncluded = controlledRiskTenPercent
    ? false : standardPromotionReserveIncluded
  let action: "LOWER_TO_ACTIVE_MARKET_SAFE_PRICE" |
    "LOWER_TO_ACTIVE_MARKET_CONTROLLED_RISK_PRICE" |
    "HOLD_AT_SAFE_FLOOR_MARKET_BELOW_FLOOR" | "RAISE_TO_SAFE_FLOOR"
  let proposedLandedPrice: number
  if (currentLandedPrice < minimumSafeLandedPrice) {
    action = "RAISE_TO_SAFE_FLOOR"
    proposedLandedPrice = minimumSafeLandedPrice
  } else {
    const safeCompetitivePrice = money(Math.max(
      minimumSafeLandedPrice,
      activeMedian,
    ))
    if (safeCompetitivePrice < currentLandedPrice - 0.01) {
      action = controlledRiskTenPercent
        ? "LOWER_TO_ACTIVE_MARKET_CONTROLLED_RISK_PRICE"
        : "LOWER_TO_ACTIVE_MARKET_SAFE_PRICE"
      proposedLandedPrice = safeCompetitivePrice
    } else {
      action = "HOLD_AT_SAFE_FLOOR_MARKET_BELOW_FLOOR"
      proposedLandedPrice = currentLandedPrice
    }
  }
  proposedLandedPrice = money(proposedLandedPrice)
  const proposedItemPrice = money(Math.max(
    0.01,
    proposedLandedPrice - ownShippingCost,
  ))
  const economicsOverrides = controlledRiskTenPercent
    ? controlledRiskConfig
    : promotionReserveIncluded ? {} : { promotedListingsReserveRate: 0 }
  const current = calculateEbayUnitEconomics({
    salePrice: currentLandedPrice,
    supplierCost: totalSupplierCost,
  }, economicsOverrides)
  const proposed = calculateEbayUnitEconomics({
    salePrice: proposedLandedPrice,
    supplierCost: totalSupplierCost,
  }, economicsOverrides)
  const activeMarketEconomics = calculateEbayUnitEconomics({
    salePrice: activeMedian,
    supplierCost: totalSupplierCost,
  }, economicsOverrides)
  const activeMarketFailedGateCodes = !activeMarketEconomics.ready ? [
    "ECONOMICS_NOT_READY",
  ] : [
    (activeMarketEconomics.estimatedNetProfit ?? Number.NEGATIVE_INFINITY) <
      activeMarketEconomics.config.minimumNetProfit
      ? "MINIMUM_NET_PROFIT" : null,
    (activeMarketEconomics.estimatedNetMarginPercent ?? Number.NEGATIVE_INFINITY) <
      activeMarketEconomics.config.minimumNetMarginPercent
      ? "MINIMUM_NET_MARGIN" : null,
    (activeMarketEconomics.estimatedRoiPercent ?? Number.NEGATIVE_INFINITY) <
      activeMarketEconomics.config.minimumRoiPercent
      ? "MINIMUM_ROI" : null,
  ].filter((code): code is string => code !== null)
  return {
    action,
    confidence: input.activeSellerCount >= 3 ? "MEDIUM" as const : "LOW" as const,
    currentItemPrice: money(ownItemPrice),
    currentLandedPrice,
    proposedItemPrice,
    proposedLandedPrice,
    activeMarketMedianLandedPrice: money(activeMedian),
    activeSellerCount: input.activeSellerCount,
    ownPackQuantity,
    supplierUnitCost: money(supplierUnitCost),
    totalSupplierCost,
    minimumSafeLandedPrice,
    standardMinimumSafeLandedPrice,
    floorWithPromotionReserve: floorWithPromotionReserve.minimumOperatorPrice,
    floorWithoutPromotion: floorWithoutPromotion.minimumOperatorPrice,
    controlledRiskMinimumLandedPrice:
      controlledRiskFloor.minimumOperatorPrice,
    controlledRiskTenPercent,
    promotionReserveIncluded,
    canReachActiveMarketSafely: activeMedian >= minimumSafeLandedPrice,
    currentEstimatedNetProfit: current.estimatedNetProfit,
    currentEstimatedMarginPercent: current.estimatedNetMarginPercent,
    proposedEstimatedNetProfit: proposed.estimatedNetProfit,
    proposedEstimatedMarginPercent: proposed.estimatedNetMarginPercent,
    proposedEstimatedRoiPercent: proposed.estimatedRoiPercent,
    proposedPassesProfitGate: proposed.passesProfitGate,
    activeMarketEconomics: {
      estimatedNetProfit: activeMarketEconomics.estimatedNetProfit,
      estimatedNetMarginPercent:
        activeMarketEconomics.estimatedNetMarginPercent,
      estimatedRoiPercent: activeMarketEconomics.estimatedRoiPercent,
      estimatedOutboundShipping:
        activeMarketEconomics.estimatedOutboundShipping,
      estimatedEbayFees: activeMarketEconomics.estimatedEbayFees,
      returnsReserve: activeMarketEconomics.returnsReserve,
      promotedListingsReserve:
        activeMarketEconomics.promotedListingsReserve,
      minimumNetProfit: activeMarketEconomics.config.minimumNetProfit,
      minimumNetMarginPercent:
        activeMarketEconomics.config.minimumNetMarginPercent,
      minimumRoiPercent: activeMarketEconomics.config.minimumRoiPercent,
      passesProfitGate: activeMarketEconomics.passesProfitGate,
      failedGateCodes: activeMarketFailedGateCodes,
      shippingSource: "CONSERVATIVE_OUTBOUND_RESERVE" as const,
    },
    comparisonBasis: "EBAY_ACTIVE_MULTI_SELLER_MEDIAN_NOT_CONFIRMED_SOLD" as const,
    activeMarketNotConfirmedSale: true,
    automaticPriceChangeAllowed: false,
    humanApprovalRequired: true,
  }
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function cooldownElapsed(lastRecommendedAt: string | null, observedAt: string) {
  if (!lastRecommendedAt) return true
  const previous = Date.parse(lastRecommendedAt)
  const current = Date.parse(observedAt)
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return true
  return current - previous >= RESEARCH_RECOMMENDATION_COOLDOWN_DAYS * 86_400_000
}

export function buildCompetitorWatchAnalysis(input: CompetitorWatchAnalysisInput) {
  const previousByItem = new Map(input.previousOffers.map((entry) => [
    entry.itemReferenceHash,
    entry,
  ]))
  const historicalSellers = new Set(input.previousOffers.map((entry) =>
    entry.sellerReferenceHash))
  const currentSellers = new Set(input.observations.map((entry) =>
    entry.sellerReferenceHash))
  const newSellerHashes = input.baselineExists
    ? [...currentSellers].filter((seller) => !historicalSellers.has(seller))
    : []
  const newSellerSet = new Set(newSellerHashes)
  const newOfferHashes = input.baselineExists
    ? input.observations
      .filter((entry) => !previousByItem.has(entry.itemReferenceHash))
      .map((entry) => entry.itemReferenceHash)
    : []

  const observationStates = input.observations.map((observation) => {
    const previous = previousByItem.get(observation.itemReferenceHash)
    const consecutiveScanCount = previous?.active
      ? Math.max(1, previous.consecutiveScanCount) + 1
      : 1
    return {
      observation,
      previous,
      consecutiveScanCount,
      firstSeenAsBaseline: previous?.firstSeenAsBaseline ?? !input.baselineExists,
    }
  })

  const immediatePotentialSellers = new Set(observationStates
    .filter(({ observation }) => newSellerSet.has(observation.sellerReferenceHash))
    .filter(({ observation }) =>
      observation.evidenceClass !== "ACTIVE_ONLY" ||
      (input.ownListing.landedPrice !== null && observation.landedPrice <=
        input.ownListing.landedPrice * MATERIAL_PRICE_ADVANTAGE_RATIO))
    .map(({ observation }) => observation.sellerReferenceHash))
  const persistentPotentialSellers = new Set(observationStates
    .filter(({ previous, firstSeenAsBaseline, consecutiveScanCount }) =>
      Boolean(previous) && !firstSeenAsBaseline && !previous?.potentialNotifiedAt &&
      consecutiveScanCount >= 2)
    .map(({ observation }) => observation.sellerReferenceHash))
  const potentialSellerHashes = [...new Set([
    ...immediatePotentialSellers,
    ...persistentPotentialSellers,
  ])].sort()
  const potentialSellerSet = new Set(potentialSellerHashes)
  const potentialOffers = observationStates.filter(({ observation }) =>
    potentialSellerSet.has(observation.sellerReferenceHash))
  const potentialWithoutConfirmedSold = potentialOffers.filter(({ observation }) =>
    observation.evidenceClass !== "CONFIRMED_SOLD_HISTORY")
  const newlyConfirmedOfferHashes = observationStates
    .filter(({ observation, previous }) =>
      observation.evidenceClass === "CONFIRMED_SOLD_HISTORY" &&
      previous?.evidenceClass !== "CONFIRMED_SOLD_HISTORY")
    .map(({ observation }) => observation.itemReferenceHash)

  const landedPrices = input.observations.map((entry) => finite(entry.landedPrice))
    .filter((value): value is number => value !== null)
  const shippingKnown = input.observations.filter((entry) => finite(entry.shippingCost) !== null)
  const returnsKnown = input.observations.filter((entry) => entry.returnsAccepted !== null)
  const imagesKnown = input.observations.filter((entry) => entry.imageCount !== null)
  const freeShippingRatio = ratio(
    shippingKnown.filter((entry) => entry.shippingCost === 0).length,
    shippingKnown.length,
  )
  const returnsAcceptedRatio = ratio(
    returnsKnown.filter((entry) => entry.returnsAccepted === true).length,
    returnsKnown.length,
  )
  const multiImageRatio = ratio(
    imagesKnown.filter((entry) => (entry.imageCount ?? 0) >= MULTI_IMAGE_MINIMUM).length,
    imagesKnown.length,
  )
  const medianLandedPrice = median(landedPrices)
  const suggestionCodes: string[] = []
  if (currentSellers.size >= 2 && freeShippingRatio !== null &&
    freeShippingRatio >= COMMON_PATTERN_RATIO &&
    (input.ownListing.shippingCost ?? 0) > 0) {
    suggestionCodes.push("REVIEW_FREE_SHIPPING_COMMON_PATTERN")
  }
  if (currentSellers.size >= 2 && returnsAcceptedRatio !== null &&
    returnsAcceptedRatio >= COMMON_PATTERN_RATIO &&
    input.ownListing.returnsAccepted === false) {
    suggestionCodes.push("REVIEW_RETURNS_ACCEPTED_COMMON_PATTERN")
  }
  if (currentSellers.size >= 2 && multiImageRatio !== null &&
    multiImageRatio >= COMMON_PATTERN_RATIO &&
    (input.ownListing.imageCount ?? 0) < MULTI_IMAGE_MINIMUM) {
    suggestionCodes.push("REVIEW_MULTI_IMAGE_COMMON_PATTERN")
  }
  if (currentSellers.size >= 2 && medianLandedPrice !== null &&
    input.ownListing.landedPrice !== null &&
    medianLandedPrice <= input.ownListing.landedPrice * MATERIAL_PRICE_ADVANTAGE_RATIO) {
    suggestionCodes.push("REVIEW_MARKET_PRICE_POSITION")
  }
  const ownTitle = normalizedText(input.ownListing.title)
  const suggestedTerms = input.crossSellerCandidateConfirmedTerms
    .map(normalizedText)
    .filter((term) => term.length >= 3 && !ownTitle.includes(term))
    .slice(0, 5)
  if (suggestedTerms.length) suggestionCodes.push("REVIEW_CROSS_SELLER_TERMS")
  const priceRecommendation = buildConfirmedSoldPriceRecommendation(input)
  const activeMarketPriceRecommendation = priceRecommendation ||
      !suggestionCodes.includes("REVIEW_MARKET_PRICE_POSITION") ? null
    : buildActiveMarketPriceRecommendation({
        ownListing: input.ownListing,
        medianLandedPrice,
        activeSellerCount: currentSellers.size,
      })
  if (priceRecommendation) {
    suggestionCodes.push("REVIEW_CONFIRMED_SOLD_PRICE_RECOMMENDATION")
  }
  const previousSuggestions = new Set(input.previousSuggestionCodes ?? [])
  const newSuggestionCodes = suggestionCodes.filter((code) =>
    !previousSuggestions.has(code))

  const researchRefreshRecommended = input.baselineExists &&
    potentialWithoutConfirmedSold.length > 0 &&
    cooldownElapsed(input.lastResearchRefreshRecommendedAt, input.observedAt)
  const evidenceClass = input.observations.some((entry) =>
    entry.evidenceClass === "CONFIRMED_SOLD_HISTORY")
    ? "CONFIRMED_SOLD_HISTORY"
    : input.observations.some((entry) => entry.evidenceClass === "ESTIMATED_ACTIVITY")
      ? "ESTIMATED_ACTIVITY"
      : input.observations.length
        ? "ACTIVE_ONLY"
        : "NO_COMPARABLE_EVIDENCE"
  // A baseline suppresses false "new seller" alerts, but it must not swallow
  // an actionable market pattern. Suggestions discovered on the first scan are
  // already aggregated across sellers and should enter the operator outbox once.
  const alertRequired = (
    input.baselineExists && (
      potentialSellerHashes.length > 0 || newlyConfirmedOfferHashes.length > 0
    )
  ) || newSuggestionCodes.length > 0 || priceRecommendation !== null
  const eventFingerprint = alertRequired
    ? createHash("sha256").update([
        ...potentialSellerHashes,
        ...newlyConfirmedOfferHashes,
        ...newSuggestionCodes,
        priceRecommendation
          ? [
              priceRecommendation.action,
              priceRecommendation.proposedItemPrice.toFixed(2),
              priceRecommendation.confirmedSoldBenchmarkLandedPrice.toFixed(2),
              priceRecommendation.confirmedSoldQuantity,
            ].join(":")
          : "NO_PRICE_RECOMMENDATION",
        activeMarketPriceRecommendation
          ? [
              activeMarketPriceRecommendation.action,
              activeMarketPriceRecommendation.proposedItemPrice.toFixed(2),
              activeMarketPriceRecommendation.minimumSafeLandedPrice.toFixed(2),
              activeMarketPriceRecommendation.activeMarketMedianLandedPrice.toFixed(2),
            ].join(":")
          : "NO_ACTIVE_MARKET_PRICE_RECOMMENDATION",
        researchRefreshRecommended ? "RESEARCH_REFRESH" : "OBSERVE",
      ].join("|")).digest("hex")
    : null

  return {
    baselineEstablished: !input.baselineExists,
    activeOfferCount: input.observations.length,
    activeSellerCount: currentSellers.size,
    estimatedActivitySellerCount: new Set(input.observations
      .filter((entry) => entry.evidenceClass === "ESTIMATED_ACTIVITY")
      .map((entry) => entry.sellerReferenceHash)).size,
    confirmedSoldSellerCount: new Set(input.observations
      .filter((entry) => entry.evidenceClass === "CONFIRMED_SOLD_HISTORY")
      .map((entry) => entry.sellerReferenceHash)).size,
    newSellerHashes,
    newOfferHashes,
    potentialSellerHashes,
    potentialOfferHashes: potentialOffers.map(({ observation }) =>
      observation.itemReferenceHash),
    newlyConfirmedOfferHashes,
    medianLandedPrice,
    freeShippingRatio,
    returnsAcceptedRatio,
    multiImageRatio,
    evidenceClass,
    suggestionCodes: [...new Set(suggestionCodes)],
    newSuggestionCodes,
    suggestedTerms,
    priceRecommendation,
    activeMarketPriceRecommendation,
    researchRefreshRecommended,
    researchRefreshReasonCodes: researchRefreshRecommended
      ? [
          "NEW_POTENTIAL_COMPETITOR",
          "NO_MATCHING_CONFIRMED_SOLD_EVIDENCE",
          "PRODUCT_RESEARCH_REFRESH_COOLDOWN_ELAPSED",
        ]
      : [],
    alertRequired,
    eventFingerprint,
    observationStates,
    safeguards: {
      activeOfferTreatedAsSale: false,
      estimatedActivityTreatedAsConfirmedSale: false,
      automaticProductResearchImport: false,
      automaticEbayMutation: false,
      competitorContentCopied: false,
      humanReviewRequired: true,
    },
  }
}

export type CompetitorWatchAnalysis = ReturnType<typeof buildCompetitorWatchAnalysis>
