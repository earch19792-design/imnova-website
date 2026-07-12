export type MobileReviewEffectiveDecisionInput = {
  dataSource: string
  selectedCandidateName: string | null
  pendingGuards: string[]
  primaryBlockingReason: string | null
  localConfirmationsComplete: boolean
  holdForReview: boolean
  refreshRequested: boolean
}

export function buildMobileReviewEffectiveDecision(input: MobileReviewEffectiveDecisionInput) {
  let nextRecommendedRoute = "NEED_HUMAN_TOP_PRODUCT_SELECTION"
  if (input.dataSource !== "MARKET_RADAR_READONLY") nextRecommendedRoute = "NEED_REAL_RADAR_TOP5"
  else if (input.holdForReview) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (input.refreshRequested) nextRecommendedRoute = "NEED_LUNA_SCAN_REFRESH"
  else if (!input.selectedCandidateName) nextRecommendedRoute = "NEED_HUMAN_TOP_PRODUCT_SELECTION"
  else if (input.pendingGuards.length > 0) nextRecommendedRoute = input.primaryBlockingReason ?? "NEED_RADAR_GUARD_REVIEW"
  else if (!input.localConfirmationsComplete) nextRecommendedRoute = "NEED_MOBILE_CONFIRMATIONS"
  else nextRecommendedRoute = "READY_FOR_B2_RUN_PREFLIGHT"

  return {
    effectiveDecisionBuilt: true,
    status: nextRecommendedRoute === "READY_FOR_B2_RUN_PREFLIGHT" ? "READY" : "BLOCKED",
    selectedCandidateName: input.selectedCandidateName,
    pendingGuards: input.pendingGuards,
    nextRecommendedRoute,
    canProceedToB2RunPreflight: false,
    canPublish: false,
    authoritative: true,
  }
}
