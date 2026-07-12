export const EBAY_MOBILE_REVIEW_PAGE_MVP_VERSION =
  "EBAY_MOBILE_REVIEW_PAGE_MVP_B2A_V1"

export type MobileReviewAction =
  | { type: "MARK_UNAVAILABLE"; rank: number }
  | { type: "SELECT_CANDIDATE"; rank: number }
  | { type: "CONFIRM_SAME_PRODUCT" }
  | { type: "RESET_SAME_PRODUCT_CONFIRMATION" }
  | { type: "CONFIRM_STOCK_QTY"; quantity: number }
  | { type: "RESET_STOCK_CONFIRMATION" }
  | { type: "CONFIRM_IMAGE_OK" }
  | { type: "RESET_LUNA_CATALOG_CONFIRMATION" }
  | { type: "REQUEST_LUNA_SCAN_REFRESH" }
  | { type: "HOLD_FOR_REVIEW" }
  | { type: "APPROVE_B2_RUN_PREFLIGHT" }

export type MobileReviewCandidate = {
  candidateRank: number
  candidateId: string
  productName: string
  opportunityScore: number
  suggestedPrice: { value: number; currency: string }
  suggestedCategory: string
  riskFlags: string[]
  missingFields: string[]
  listingBlueprintSummary: string
  availabilityStatus: "AVAILABLE" | "UNKNOWN" | "REMOVED_FROM_LUNA_SCAN"
}

export type MobileReviewFixture = {
  version: string
  status: string
  top5Candidates: MobileReviewCandidate[]
  previousCandidate: MobileReviewCandidate & {
    previousStatus: "REMOVED_FROM_LUNA_SCAN"
  }
}

export type MobileReviewState = {
  mobileReviewState: string
  candidates: MobileReviewCandidate[]
  selectedCandidateRank: number | null
  sameProductConfirmed: boolean
  stockQuantityConfirmed: number | null
  imageConfirmed: boolean
  preflightApproved: boolean
  refreshRequested: boolean
  holdForReview: boolean
}

export function buildEbayMobileReviewPageInput(fixture: MobileReviewFixture) {
  return {
    version: fixture.version || EBAY_MOBILE_REVIEW_PAGE_MVP_VERSION,
    top5Candidates: fixture.top5Candidates.slice(0, 5),
    previousCandidate: fixture.previousCandidate,
    top5Visible: fixture.top5Candidates.length === 5,
    localOnly: true,
    canPublish: false,
  }
}

export function buildInitialMobileReviewState(
  fixture: MobileReviewFixture
): MobileReviewState {
  return {
    mobileReviewState: "MOBILE_REVIEW_PENDING",
    candidates: fixture.top5Candidates.slice(0, 5),
    selectedCandidateRank: null,
    sameProductConfirmed: false,
    stockQuantityConfirmed: null,
    imageConfirmed: false,
    preflightApproved: false,
    refreshRequested: false,
    holdForReview: false,
  }
}

export function applyMobileReviewAction(
  state: MobileReviewState,
  action: MobileReviewAction
): MobileReviewState {
  if (action.type === "MARK_UNAVAILABLE") {
    return {
      ...state,
      mobileReviewState: "REMOVED_FROM_LUNA_SCAN",
      candidates: state.candidates.map((candidate) =>
        candidate.candidateRank === action.rank
          ? { ...candidate, availabilityStatus: "REMOVED_FROM_LUNA_SCAN" }
          : candidate
      ),
      selectedCandidateRank:
        state.selectedCandidateRank === action.rank
          ? null
          : state.selectedCandidateRank,
      sameProductConfirmed: false,
      stockQuantityConfirmed: null,
      imageConfirmed: false,
      preflightApproved: false,
      refreshRequested: true,
    }
  }

  if (action.type === "SELECT_CANDIDATE") {
    const candidate = state.candidates.find(
      (entry) => entry.candidateRank === action.rank
    )
    if (!candidate || candidate.availabilityStatus === "REMOVED_FROM_LUNA_SCAN") {
      return state
    }
    return {
      ...state,
      mobileReviewState: "CANDIDATE_SELECTED",
      selectedCandidateRank: action.rank,
      sameProductConfirmed: false,
      stockQuantityConfirmed: null,
      imageConfirmed: false,
      preflightApproved: false,
      refreshRequested: false,
    }
  }

  if (action.type === "CONFIRM_SAME_PRODUCT" && state.selectedCandidateRank) {
    return { ...state, sameProductConfirmed: true }
  }

  if (action.type === "RESET_SAME_PRODUCT_CONFIRMATION") {
    return {
      ...state,
      sameProductConfirmed: false,
      preflightApproved: false,
    }
  }

  if (action.type === "CONFIRM_STOCK_QTY" && state.selectedCandidateRank) {
    if (!Number.isInteger(action.quantity) || action.quantity < 1) return state
    return {
      ...state,
      mobileReviewState: "STOCK_CONFIRMED",
      candidates: state.candidates.map((candidate) =>
        candidate.candidateRank === state.selectedCandidateRank
          ? { ...candidate, availabilityStatus: "AVAILABLE" }
          : candidate
      ),
      stockQuantityConfirmed: action.quantity,
    }
  }

  if (action.type === "RESET_STOCK_CONFIRMATION") {
    return {
      ...state,
      stockQuantityConfirmed: null,
      preflightApproved: false,
    }
  }

  if (action.type === "CONFIRM_IMAGE_OK" && state.selectedCandidateRank) {
    return {
      ...state,
      mobileReviewState: "IMAGE_CONFIRMED",
      imageConfirmed: true,
    }
  }

  if (action.type === "RESET_LUNA_CATALOG_CONFIRMATION") {
    return {
      ...state,
      imageConfirmed: false,
      preflightApproved: false,
    }
  }

  if (action.type === "REQUEST_LUNA_SCAN_REFRESH") {
    return {
      ...state,
      mobileReviewState: "NEED_LUNA_SCAN_REFRESH",
      refreshRequested: true,
      preflightApproved: false,
    }
  }

  if (action.type === "HOLD_FOR_REVIEW") {
    return {
      ...state,
      mobileReviewState: "HOLD_FOR_REVIEW",
      holdForReview: true,
      preflightApproved: false,
    }
  }

  if (action.type === "APPROVE_B2_RUN_PREFLIGHT") {
    const selected = state.candidates.find(
      (entry) => entry.candidateRank === state.selectedCandidateRank
    )
    const ready = Boolean(
      selected &&
        selected.availabilityStatus !== "REMOVED_FROM_LUNA_SCAN" &&
        state.sameProductConfirmed &&
        (state.stockQuantityConfirmed ?? 0) > 0 &&
        state.imageConfirmed
    )
    return {
      ...state,
      mobileReviewState: ready
        ? "READY_FOR_B2_RUN_PREFLIGHT"
        : state.mobileReviewState,
      preflightApproved: ready,
    }
  }

  return state
}

export function buildMobileReviewDecision(state: MobileReviewState) {
  const selected = state.candidates.find(
    (entry) => entry.candidateRank === state.selectedCandidateRank
  ) ?? null
  const removed = state.candidates.some(
    (entry) => entry.availabilityStatus === "REMOVED_FROM_LUNA_SCAN"
  )
  const canProceedToB2RunPreflight = Boolean(
    selected &&
      selected.availabilityStatus !== "REMOVED_FROM_LUNA_SCAN" &&
      state.sameProductConfirmed &&
      (state.stockQuantityConfirmed ?? 0) > 0 &&
      state.imageConfirmed &&
      state.preflightApproved
  )

  let nextRecommendedRoute = "NEED_HUMAN_TOP_PRODUCT_SELECTION"
  if (state.holdForReview) nextRecommendedRoute = "EBAY-RESUME-HOLD"
  else if (state.refreshRequested)
    nextRecommendedRoute = "NEED_LUNA_SCAN_REFRESH"
  else if (canProceedToB2RunPreflight)
    nextRecommendedRoute = "EBAY-RESUME-B2-RUN-PREFLIGHT"
  else if (selected) nextRecommendedRoute = "NEED_MOBILE_CONFIRMATIONS"

  return {
    selectedCandidateRank: selected?.candidateRank ?? null,
    selectedCandidateName: selected?.productName ?? null,
    availabilityStatus: selected?.availabilityStatus ??
      (removed ? "REMOVED_FROM_LUNA_SCAN" : "UNKNOWN"),
    stockConfirmed: (state.stockQuantityConfirmed ?? 0) > 0,
    stockQuantityConfirmed: state.stockQuantityConfirmed,
    imageConfirmed: state.imageConfirmed,
    sameProductConfirmed: state.sameProductConfirmed,
    mobileReviewState: state.mobileReviewState,
    canProceedToB2Run: canProceedToB2RunPreflight,
    canProceedToB2RunPreflight,
    canPublish: false,
    nextRecommendedRoute,
  }
}

export function buildMobileReviewCopyPasteSummary(state: MobileReviewState) {
  return JSON.stringify(buildMobileReviewDecision(state), null, 2)
}

export function buildEbayMobileReviewPageReport(fixture: MobileReviewFixture) {
  const input = buildEbayMobileReviewPageInput(fixture)
  const state = buildInitialMobileReviewState(fixture)
  return {
    mobileReviewPageMvpBuilt: true,
    top5Visible: input.top5Visible,
    recommendedCandidateRank: input.top5Candidates[0]?.candidateRank ?? null,
    previousCandidateVisible: Boolean(input.previousCandidate),
    ...buildMobileReviewDecision(state),
    ebayApiUsed: false,
    ebayWriteUsed: false,
    supabaseWriteUsed: false,
    tokenStored: false,
    whatsappRealSendUsed: false,
    imageGenerationUsed: false,
    scraperUsed: false,
  }
}
