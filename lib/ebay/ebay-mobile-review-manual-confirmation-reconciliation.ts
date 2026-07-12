import type { RealRadarCandidate } from "@/lib/ebay/ebay-mobile-review-real-radar-connector"

export type MobileManualConfirmations = {
  sameProductConfirmed: boolean
  stockConfirmed: boolean
  stockQuantityConfirmed: number | null
  imageConfirmed: boolean
  lunaPriceConfirmed: boolean
  lunaPrice: number | null
}

export function reconcileMobileConfirmationsWithRadarGuards(
  candidate: RealRadarCandidate,
  pendingGuards: string[],
  confirmations: MobileManualConfirmations
) {
  const stockResolved = Boolean(
    confirmations.stockConfirmed &&
    Number.isInteger(confirmations.stockQuantityConfirmed) &&
    (confirmations.stockQuantityConfirmed ?? 0) > 0
  )
  const imageResolved = confirmations.imageConfirmed
  const lunaPriceResolved = Boolean(
    confirmations.lunaPriceConfirmed &&
    (confirmations.lunaPrice ?? 0) > 0
  )
  const resolvedGuards = new Set<string>()
  if (stockResolved) {
    resolvedGuards.add("stockUnknown")
    resolvedGuards.add("stockAvailabilityOnly")
  }
  if (imageResolved) resolvedGuards.add("missingImageValidation")
  if (lunaPriceResolved) resolvedGuards.add("missingLunaPrice")
  const reconciledPendingGuards = pendingGuards.filter(
    (guard) => !resolvedGuards.has(guard)
  )
  const ebayValidationPending = reconciledPendingGuards.some((guard) =>
    ["missingEbayPrice", "missingMargin", "missingCategoryId", "missingDemandValidation"].includes(guard)
  )
  const upstreamGuardPending = reconciledPendingGuards.some((guard) =>
    ["riskHold", "outOfStock", "staleMissingFromSource", "stockUnknown", "stockAvailabilityOnly", "stockStale", "missingSnapshot", "missingVariant", "missingSku", "missingLunaPrice"].includes(guard)
  )

  return {
    manualConfirmationReconciliationBuilt: true,
    candidateId: candidate.candidateId,
    pendingGuards: reconciledPendingGuards,
    resolvedGuards: [...resolvedGuards],
    stockConfirmed: stockResolved,
    stockQuantityConfirmed: stockResolved ? confirmations.stockQuantityConfirmed : null,
    stockSource: stockResolved ? "HUMAN_MOBILE_CONFIRMED" : candidate.stockSource,
    stockWarning: stockResolved && (confirmations.stockQuantityConfirmed ?? 0) <= 2
      ? "STOCK_LIMITED_WARNING"
      : null,
    imageConfirmed: imageResolved,
    imageReviewSource: imageResolved ? "HUMAN_MOBILE_CONFIRMED" : null,
    lunaPriceConfirmed: lunaPriceResolved,
    lunaPrice: lunaPriceResolved ? confirmations.lunaPrice : candidate.lunaPrice,
    lunaPriceSource: lunaPriceResolved ? "HUMAN_MOBILE_CONFIRMED" : null,
    sameProductConfirmed: confirmations.sameProductConfirmed,
    productMatchSource: confirmations.sameProductConfirmed
      ? "HUMAN_MOBILE_CONFIRMED"
      : null,
    canProceedToB2RunPreflight: false,
    canPublish: false,
    nextRecommendedRoute: ebayValidationPending && !upstreamGuardPending
      ? "NEED_EBAY_MARKET_VALIDATION"
      : null,
  }
}
