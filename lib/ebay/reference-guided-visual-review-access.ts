export const REFERENCE_GUIDED_VISUAL_REVIEW_CONTRACT =
  "REFERENCE_GUIDED_PRODUCT_GENERATION_V1"

export function v3VisualReviewAccessible(input: {
  strategyVersion: unknown
  revisionContract: unknown
  attemptId: unknown
}) {
  return input.strategyVersion === "VISUAL_STRATEGY_V3"
    && input.revisionContract === REFERENCE_GUIDED_VISUAL_REVIEW_CONTRACT
    && typeof input.attemptId === "string"
    && /^[0-9a-f-]{36}$/i.test(input.attemptId)
}

export function v3PublicationAllowed(input: {
  visualReviewComplete: boolean
  staleCostOrStock: boolean
  commercialAuthorizationComplete: boolean
}) {
  return input.visualReviewComplete
    && !input.staleCostOrStock
    && input.commercialAuthorizationComplete
}

export function v3FinalListingReviewCanonicalReady(input: {
  visualPhase: unknown
  finalVisualSetLocked: unknown
  generationControlsHidden: unknown
  readyForUnpublishedOfferAuthorization: unknown
  signedImageCount: unknown
  primaryMainFirst: unknown
}) {
  return input.visualPhase === "COMPLETED"
    && input.finalVisualSetLocked === true
    && input.generationControlsHidden === true
    && input.readyForUnpublishedOfferAuthorization === true
    && input.signedImageCount === 7
    && input.primaryMainFirst === true
}
