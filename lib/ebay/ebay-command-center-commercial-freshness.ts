export type CommandCenterCommercialFreshnessInput = {
  errorCode: string
  finalListingReviewAllowed: boolean
  sourceRecheckAvailable: boolean
}

export type CommandCenterCommercialFreshnessResolution = {
  finalListingReviewReady: boolean
  sourceRecheckRequired: boolean
}

const LEGACY_PACKAGE_RECHECK_CODES = new Set([
  "SAME_DAY_PUBLICATION_PACKAGE_NOT_READY",
  "SAME_DAY_PUBLICATION_LUNA_RECHECK_REQUIRED",
])

export function resolveCommandCenterCommercialFreshness(
  input: CommandCenterCommercialFreshnessInput,
): CommandCenterCommercialFreshnessResolution {
  if (input.finalListingReviewAllowed) {
    return {
      finalListingReviewReady: true,
      sourceRecheckRequired: false,
    }
  }

  return {
    finalListingReviewReady: false,
    sourceRecheckRequired:
      LEGACY_PACKAGE_RECHECK_CODES.has(input.errorCode)
      && input.sourceRecheckAvailable,
  }
}
