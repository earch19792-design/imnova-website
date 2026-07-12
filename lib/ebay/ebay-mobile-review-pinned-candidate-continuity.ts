import type { RealRadarCandidate } from "@/lib/ebay/ebay-mobile-review-real-radar-connector"

export type PinnedCandidate = {
  pinnedCandidateId: string
  marketRadarProductId: string | null
  supplierProductId: string | null
  productName: string
  handle: string | null
  productUrl: string | null
  status: string
  sameProductConfirmed: boolean
  stockConfirmed: boolean
  stockQuantityConfirmed: number | null
  stockWarning: string | null
  lunaPriceConfirmed: boolean
  lunaPrice: number | null
  imageConfirmed: boolean
  source: "HUMAN_MOBILE_CONFIRMED"
  lastHumanConfirmationAt: string | null
  lastKnownRoute: string
  radarPresenceStatus: string
  nextRecommendedRoute: string
}

export type PinnedCandidateAction =
  | { type: "RECHECK_PINNED_CANDIDATE"; pinnedCandidateId: string }
  | { type: "MARK_PINNED_UNAVAILABLE"; pinnedCandidateId: string }
  | { type: "CONTINUE_EBAY_MARKET_VALIDATION"; pinnedCandidateId: string }
  | { type: "HOLD_PINNED_FOR_REVIEW"; pinnedCandidateId: string }
  | { type: "UNPIN_CANDIDATE"; pinnedCandidateId: string }

const normalized = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase()

export function pinnedCandidateMatchesRadar(
  pinned: PinnedCandidate,
  candidate: RealRadarCandidate
) {
  return Boolean(
    (pinned.marketRadarProductId && pinned.marketRadarProductId === candidate.marketRadarProductId) ||
    (pinned.supplierProductId && pinned.supplierProductId === candidate.supplierProductId) ||
    (pinned.handle && normalized(pinned.handle) === normalized(candidate.handle)) ||
    normalized(pinned.productName) === normalized(candidate.productName)
  )
}

export function canContinuePinnedEbayMarketValidation(candidate: PinnedCandidate) {
  return Boolean(
    candidate.sameProductConfirmed &&
    candidate.stockConfirmed &&
    (candidate.stockQuantityConfirmed ?? 0) > 0 &&
    candidate.lunaPriceConfirmed &&
    (candidate.lunaPrice ?? 0) > 0 &&
    candidate.imageConfirmed &&
    candidate.status !== "REMOVED_FROM_LUNA_SCAN"
  )
}

export function applyPinnedCandidateAction(
  pinnedCandidates: PinnedCandidate[],
  action: PinnedCandidateAction,
  currentTop5: RealRadarCandidate[] = []
) {
  if (action.type === "UNPIN_CANDIDATE") {
    return pinnedCandidates.filter(
      (candidate) => candidate.pinnedCandidateId !== action.pinnedCandidateId
    )
  }
  return pinnedCandidates.map((candidate) => {
    if (candidate.pinnedCandidateId !== action.pinnedCandidateId) return candidate
    if (action.type === "MARK_PINNED_UNAVAILABLE") {
      return { ...candidate, status: "REMOVED_FROM_LUNA_SCAN", nextRecommendedRoute: "STOCK_HOLD" }
    }
    if (action.type === "HOLD_PINNED_FOR_REVIEW") {
      return { ...candidate, status: "HOLD_FOR_REVIEW", nextRecommendedRoute: "EBAY-RESUME-HOLD" }
    }
    if (action.type === "CONTINUE_EBAY_MARKET_VALIDATION") {
      return canContinuePinnedEbayMarketValidation(candidate)
        ? { ...candidate, status: "PINNED_CANDIDATE_UNDER_REVIEW", nextRecommendedRoute: "NEED_EBAY_MARKET_VALIDATION" }
        : candidate
    }
    const inRadar = currentTop5.some((entry) => pinnedCandidateMatchesRadar(candidate, entry))
    const hasKnownReference = Boolean(candidate.handle || candidate.productUrl)
    return {
      ...candidate,
      status: "PINNED_CANDIDATE_UNDER_REVIEW",
      radarPresenceStatus: inRadar ? "PINNED_AND_IN_CURRENT_TOP5" : "NEEDS_RADAR_RECHECK",
      nextRecommendedRoute: inRadar || hasKnownReference
        ? "NEED_EBAY_MARKET_VALIDATION"
        : "NEED_RADAR_RECHECK",
    }
  })
}

export function buildPinnedCandidateContinuityReport(
  currentTop5: RealRadarCandidate[],
  pinnedCandidates: PinnedCandidate[]
) {
  const decorated = pinnedCandidates.map((candidate) => {
    const inTop5 = currentTop5.some((entry) => pinnedCandidateMatchesRadar(candidate, entry))
    return {
      ...candidate,
      dedupedWithTop5: inTop5,
      radarPresenceStatus: inTop5
        ? "PINNED_AND_IN_CURRENT_TOP5"
        : candidate.radarPresenceStatus,
    }
  })
  const first = decorated[0] ?? null
  return {
    pinnedCandidateContinuityBuilt: true,
    currentTop5Count: currentTop5.length,
    pinnedCandidatesCount: decorated.length,
    pinnedCandidateName: first?.productName ?? null,
    pinnedStatus: first?.status ?? null,
    radarPresenceStatus: first?.radarPresenceStatus ?? null,
    dedupedWithTop5: first?.dedupedWithTop5 ?? false,
    humanConfirmationsPreserved: Boolean(first?.source === "HUMAN_MOBILE_CONFIRMED"),
    pinnedCandidateNextRoute: first?.nextRecommendedRoute ?? null,
    canContinueEbayMarketValidation: first
      ? canContinuePinnedEbayMarketValidation(first)
      : false,
    pinnedCandidates: decorated,
    pinnedCandidatesOutsideTop5: decorated.filter((candidate) => !candidate.dedupedWithTop5),
    canProceedToB2RunPreflight: false,
    canPublish: false,
    decisionPersistence: "BROWSER_STATE_OR_LOCAL_STORAGE",
    officialApprovalRecord: false,
    supabaseWriteUsed: false,
    ebayApiUsed: false,
    ebayWriteUsed: false,
    nextRecommendedRoute: first?.nextRecommendedRoute ?? "NEED_PINNED_CANDIDATE_SELECTION",
  }
}
