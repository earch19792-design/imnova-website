export const EBAY_LISTING_QA_RESULT_SCHEMA_VERSION:
  "EBAY_LISTING_QA_RESULT_V1"

export const QA_STATES: {
  INCOMPLETE: "QA_INCOMPLETE"
  REVIEW_REQUIRED: "QA_REVIEW_REQUIRED"
  BLOCKED: "QA_BLOCKED"
  PASSED_FOR_HUMAN_REVIEW: "QA_PASSED_FOR_HUMAN_REVIEW"
}

export type ListingProposalQaState =
  | "QA_INCOMPLETE"
  | "QA_REVIEW_REQUIRED"
  | "QA_BLOCKED"
  | "QA_PASSED_FOR_HUMAN_REVIEW"

export type ListingProposalQaCheckResult = {
  name: string
  passed: boolean
  warnings: string[]
  missingData: string[]
  riskFlags: string[]
  blockedReasons: string[]
  requiredHumanActions: string[]
}

export type ListingProposalQaResult = {
  schemaVersion: "EBAY_LISTING_QA_RESULT_V1"
  qaState: ListingProposalQaState
  advisoryOnly: true
  humanReviewRequired: true
  passedChecks: string[]
  failedChecks: string[]
  warnings: string[]
  missingData: string[]
  riskFlags: string[]
  blockedReasons: string[]
  requiredHumanActions: string[]
  safety: {
    advisoryOnly: true
    localOnly: true
    externalCallsMade: false
    ebayApiUsed: false
    realDraftCreated: false
    publishedToEbay: false
    listingMutated: false
    requiresHumanReview: true
  }
}

export type ListingProposalQaOptions = {
  qaState?: ListingProposalQaState
}

export function evaluateListingProposalQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaResult

export function evaluateSourceQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateEconomicsQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateTitleQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateDescriptionQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateItemSpecificsQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateImageQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateShippingQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateReturnQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateComplianceQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function evaluateSafetyQa(
  proposal?: Record<string, unknown>,
  options?: ListingProposalQaOptions
): ListingProposalQaCheckResult

export function determineQaState(
  checkResults?: ListingProposalQaCheckResult[],
  options?: ListingProposalQaOptions
): ListingProposalQaState

export function buildQaResult(
  proposal?: Record<string, unknown>,
  checkResults?: ListingProposalQaCheckResult[],
  options?: ListingProposalQaOptions
): ListingProposalQaResult
