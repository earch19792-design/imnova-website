export const EBAY_LISTING_PROPOSAL_REVIEW_REPORT_VERSION:
  "EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1"

export const REVIEW_REPORT_DECISIONS: {
  PROCEED_TO_HUMAN_REVIEW: "PROCEED_TO_HUMAN_REVIEW"
  COMPLETE_MISSING_DATA: "COMPLETE_MISSING_DATA"
  REVIEW_ECONOMICS: "REVIEW_ECONOMICS"
  REVIEW_COMPLIANCE: "REVIEW_COMPLIANCE"
  BLOCK_DO_NOT_ADVANCE: "BLOCK_DO_NOT_ADVANCE"
  DISCARD_CANDIDATE: "DISCARD_CANDIDATE"
}

export type ListingProposalReviewReportDecision =
  | "PROCEED_TO_HUMAN_REVIEW"
  | "COMPLETE_MISSING_DATA"
  | "REVIEW_ECONOMICS"
  | "REVIEW_COMPLIANCE"
  | "BLOCK_DO_NOT_ADVANCE"
  | "DISCARD_CANDIDATE"

export type ListingProposalReviewReportInput = {
  caseId?: string
  name?: string
  candidate?: Record<string, unknown>
  listingProposalOutput?: Record<string, unknown>
  qaResult?: Record<string, unknown>
}

export type ListingProposalReviewReportOptions = {
  generatedAt?: string | null
  reviewerNotes?: string[]
}

export type ListingProposalReviewReport = {
  reportVersion: "EBAY_LISTING_PROPOSAL_REVIEW_REPORT_V1"
  header: Record<string, unknown>
  executiveSummary: Record<string, unknown>
  candidateSource: Record<string, unknown>
  listingProposalSummary: Record<string, unknown>
  qaResultSummary: Record<string, unknown>
  economicsReview: Record<string, unknown>
  missingData: string[]
  riskFlags: string[]
  blockedReasons: string[]
  complianceReview: Record<string, unknown>
  copywritingReview: Record<string, unknown>
  imageReview: Record<string, unknown>
  shippingReturnsReview: Record<string, unknown>
  safetyFlags: {
    advisoryOnly: boolean
    localOnly: boolean
    externalCallsMade: boolean
    ebayApiUsed: boolean
    realDraftCreated: boolean
    publishedToEbay: boolean
    listingMutated: boolean
    requiresHumanReview: boolean
  }
  requiredHumanActions: string[]
  recommendedDecision: ListingProposalReviewReportDecision
  reviewerNotes: string[]
}

export function buildListingProposalReviewReport(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): ListingProposalReviewReport

export function buildReportHeader(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildExecutiveSummary(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildCandidateSourceSection(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildListingProposalSummary(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildQaResultSummary(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildEconomicsReview(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildMissingDataSection(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): string[]

export function buildRiskFlagsSection(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): string[]

export function buildBlockedReasonsSection(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): string[]

export function buildComplianceReview(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildCopywritingReview(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildImageReview(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildShippingReturnsReview(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): Record<string, unknown>

export function buildSafetyFlagsSection(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): ListingProposalReviewReport["safetyFlags"]

export function buildRequiredHumanActions(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): string[]

export function determineRecommendedDecision(
  input?: ListingProposalReviewReportInput,
  options?: ListingProposalReviewReportOptions
): ListingProposalReviewReportDecision
