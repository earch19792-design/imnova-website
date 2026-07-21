import { createHash } from "node:crypto"

import type { SafeEbayActiveCompetitorObservation } from "./ebay-seller-keyword-demand-gateway"

export const EBAY_COMPETITOR_WATCH_VERSION =
  "EBAY_LISTING_COMPETITOR_WATCH_V1" as const

const RESEARCH_RECOMMENDATION_COOLDOWN_DAYS = 7
const MATERIAL_PRICE_ADVANTAGE_RATIO = 0.9
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
  landedPrice: number | null
  shippingCost: number | null
  returnsAccepted: boolean | null
  imageCount: number | null
  title: string
}

export type CompetitorWatchObservation = Omit<
  SafeEbayActiveCompetitorObservation,
  "evidenceClass"
> & {
  evidenceClass: "ACTIVE_ONLY" | "ESTIMATED_ACTIVITY" | "CONFIRMED_SOLD_HISTORY"
  confirmedSoldQuantity?: number
  confirmedSoldLastDate?: string | null
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
  const alertRequired = input.baselineExists && (
    potentialSellerHashes.length > 0 ||
    newlyConfirmedOfferHashes.length > 0 ||
    newSuggestionCodes.length > 0
  )
  const eventFingerprint = alertRequired
    ? createHash("sha256").update([
        ...potentialSellerHashes,
        ...newlyConfirmedOfferHashes,
        ...newSuggestionCodes,
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
