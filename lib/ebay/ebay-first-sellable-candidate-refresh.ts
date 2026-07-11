export const EBAY_FIRST_SELLABLE_CANDIDATE_REFRESH_VERSION =
  "EBAY_FIRST_SELLABLE_CANDIDATE_REFRESH_V1"

type MobileDecision = {
  productName: string
  availabilityStatus: "REMOVED_FROM_LUNA_SCAN"
  riskFlags: string[]
  canProceedToB2Run: false
}

type RefreshedCandidate = {
  candidateId: string
  productName: string
  opportunityScore: number
  suggestedPrice: { value: number; currency: string }
  suggestedCategory: string
  listingBlueprintSummary: string
  availabilityStatus: "AVAILABLE" | "UNKNOWN" | "REMOVED_FROM_LUNA_SCAN"
  riskFlags: string[]
  missingFields: string[]
}

export type FirstSellableCandidateRefreshFixture = {
  version: string
  mobileReviewDecisions: MobileDecision[]
  refreshedLunaScanCandidates: RefreshedCandidate[]
}

export function buildFirstSellableCandidateRefresh(
  fixture: FirstSellableCandidateRefreshFixture
) {
  const removedCandidates = fixture.mobileReviewDecisions.map((decision) => ({
    productName: decision.productName,
    availabilityStatus: "REMOVED_FROM_LUNA_SCAN" as const,
    riskFlags: [...new Set([...decision.riskFlags, "STOCK_HOLD"])],
    canProceedToB2Run: false as const,
  }))
  const removedNames = new Set(
    removedCandidates.map((candidate) => candidate.productName)
  )
  const excludedFromRanking = fixture.refreshedLunaScanCandidates
    .filter(
      (candidate) =>
        removedNames.has(candidate.productName) ||
        candidate.availabilityStatus === "REMOVED_FROM_LUNA_SCAN" ||
        candidate.riskFlags.includes("STOCK_HOLD")
    )
    .map((candidate) => candidate.productName)
  const eligibleCandidates = fixture.refreshedLunaScanCandidates
    .filter(
      (candidate) =>
        !removedNames.has(candidate.productName) &&
        candidate.availabilityStatus === "AVAILABLE" &&
        !candidate.riskFlags.includes("STOCK_HOLD")
    )
    .sort(
      (left, right) =>
        right.opportunityScore - left.opportunityScore ||
        left.candidateId.localeCompare(right.candidateId)
    )
  const refreshedTop5 = eligibleCandidates.slice(0, 5).map((candidate, index) => ({
    candidateRank: index + 1,
    ...candidate,
  }))
  const newRecommendedCandidate = refreshedTop5[0] ?? null
  const enoughCandidates = refreshedTop5.length === 5

  return {
    version: fixture.version || EBAY_FIRST_SELLABLE_CANDIDATE_REFRESH_VERSION,
    sellableCandidateRefreshReportBuilt: true,
    removedCandidatesCount: removedCandidates.length,
    removedCandidates,
    excludedFromRanking,
    refreshedCandidatesLoaded: fixture.refreshedLunaScanCandidates.length,
    refreshedTop5Built: enoughCandidates,
    refreshedTop5,
    mobileReviewPageInput: { top5Candidates: refreshedTop5 },
    newRecommendedCandidate: newRecommendedCandidate?.productName ?? null,
    newRecommendedScore: newRecommendedCandidate?.opportunityScore ?? null,
    canProceedToB2RunPreflight: false,
    canPublish: false,
    nextRecommendedRoute: enoughCandidates
      ? "NEED_MOBILE_REVIEW_OF_REFRESHED_TOP5"
      : "NEED_NEW_LUNA_SCAN_SOURCE",
    ebayApiUsed: false,
    ebayWriteUsed: false,
    supabaseWriteUsed: false,
    tokenStored: false,
    imageGenerationUsed: false,
    scraperUsed: false,
    amazonUsed: false,
  }
}

export function summarizeFirstSellableCandidateRefresh(
  report: ReturnType<typeof buildFirstSellableCandidateRefresh>
) {
  return {
    sellableCandidateRefreshReportBuilt:
      report.sellableCandidateRefreshReportBuilt,
    removedCandidatesCount: report.removedCandidatesCount,
    removedCandidates: report.removedCandidates,
    excludedFromRanking: report.excludedFromRanking,
    refreshedCandidatesLoaded: report.refreshedCandidatesLoaded,
    refreshedTop5Built: report.refreshedTop5Built,
    newRecommendedCandidate: report.newRecommendedCandidate,
    newRecommendedScore: report.newRecommendedScore,
    canProceedToB2RunPreflight: report.canProceedToB2RunPreflight,
    canPublish: report.canPublish,
    nextRecommendedRoute: report.nextRecommendedRoute,
  }
}
