// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { detectEbayProductRestrictionGuards } from "./ebay-product-restriction-guards.ts"

export type EbayMarketValidationCandidate = {
  productName?: string | null
  productTitle?: string | null
  title?: string | null
  handle?: string | null
  suggestedCategory?: string | null
  categoryText?: string | null
  categoryName?: string | null
  productType?: string | null
  description?: string | null
  imageAlt?: string | null
  imageReference?: string | null
}

export type EbayMarketValidationSelectedCandidateInput = {
  selectedCandidate?: EbayMarketValidationCandidate | null
  humanConfirmationsComplete: boolean
  pendingGuards?: string[]
}

export function buildEbayMarketValidationSelectedCandidate(
  input: EbayMarketValidationSelectedCandidateInput
) {
  const candidate = input.selectedCandidate ?? null
  const restriction = detectEbayProductRestrictionGuards({
    title: candidate?.title ?? candidate?.productTitle,
    productName: candidate?.productName,
    category: candidate?.suggestedCategory,
    categoryText: candidate?.categoryText,
    categoryName: candidate?.categoryName,
    handle: candidate?.handle,
    productType: candidate?.productType,
    description: candidate?.description,
    imageAlt: candidate?.imageAlt,
    imageReference: candidate?.imageReference,
  })
  const pendingGuards = [
    ...new Set([
      ...(input.pendingGuards ?? []),
      ...restriction.pendingRestrictionGuards,
    ]),
  ]
  const hasRestrictionReview =
    restriction.productRestrictionRiskDetected &&
    restriction.pendingRestrictionGuards.length > 0
  const nextRecommendedRoute = !candidate
    ? "NEED_HUMAN_TOP_PRODUCT_SELECTION"
    : !input.humanConfirmationsComplete
      ? "NEED_MOBILE_CONFIRMATIONS"
      : hasRestrictionReview
        ? "NEED_EBAY_MARKET_VALIDATION_WITH_RESTRICTION_REVIEW"
        : "NEED_EBAY_MARKET_VALIDATION"

  return {
    marketValidationSelectedCandidateBuilt: true,
    productName:
      candidate?.productName ??
      candidate?.productTitle ??
      candidate?.title ??
      null,
    humanConfirmationsComplete: input.humanConfirmationsComplete,
    productRestrictionRiskDetected:
      restriction.productRestrictionRiskDetected,
    restrictionRiskType: restriction.restrictionRiskType,
    shippingRestrictionReviewRequired:
      restriction.shippingRestrictionReviewRequired,
    hazmatReviewRequired: restriction.hazmatReviewRequired,
    restrictionGuards: restriction.pendingRestrictionGuards,
    pendingGuards,
    nextRequiredGuard: restriction.nextRequiredGuard,
    nextRecommendedRoute,
    canProceedToListingPackage:
      input.humanConfirmationsComplete && pendingGuards.length === 0,
    canProceedToB2RunPreflight: false,
    canPublish: false,
    restriction,
  }
}
