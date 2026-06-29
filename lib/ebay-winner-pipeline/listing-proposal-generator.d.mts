export const EBAY_LISTING_DRAFT_SCHEMA_VERSION:
  "EBAY_LISTING_DRAFT_SCHEMA_V1"

export type ListingProposalCandidate = {
  caseId?: string | null
  productCandidateId?: string | null
  sourceType?: string | null
  selectionDecision?: string | null
  selectionState?: string | null
  title?: string | null
  productName?: string | null
  subtitle?: string | null
  category?: string | null
  categoryGuess?: string | null
  categoryId?: string | null
  categoryConfidence?: string | null
  productType?: string | null
  condition?: string | null
  supplierCost?: number | string | null
  supplierShippingCost?: number | string | null
  estimatedEbayPrice?: number | string | null
  estimatedEbayFees?: number | string | null
  buyerShippingCharge?: number | string | null
  soldCompsMedianPrice?: number | string | null
  currency?: string | null
  stockAvailable?: number | string | null
  stockStatus?: string | null
  brand?: string | null
  model?: string | null
  mpn?: string | null
  material?: string | null
  color?: string | null
  size?: string | null
  features?: string[] | null
  packageIncludes?: string | null
  recommendedUse?: string | null
  weight?: number | string | {
    value?: number | string | null
    unit?: string | null
  } | null
  weightUnit?: string | null
  dimensions?: {
    length?: number | string | null
    width?: number | string | null
    height?: number | string | null
    unit?: string | null
  } | null
  shippingMethod?: string | null
  handlingTime?: string | null
  returnsAccepted?: boolean | null
  returnWindowDays?: number | string | null
  buyerPaysReturnShipping?: boolean | null
  brandRisk?: string | boolean | null
  veroRisk?: string | boolean | null
  medicalClaimsRisk?: string | boolean | null
  restrictedProductRisk?: string | boolean | null
  returnRisk?: string | boolean | null
  fragilityRisk?: string | boolean | null
  shippingSpeedRisk?: string | boolean | null
  imageAuthorizationStatus?: string | null
}

export type ListingProposalGeneratorOptions = {
  productCandidateId?: string | null
  sourceCaseId?: string | null
  sourceType?: string | null
  selectionDecision?: string | null
  selectionState?: string | null
  selectedAt?: string | null
  notes?: string | null
  title?: string | null
  categoryName?: string | null
  categoryId?: string | null
  categoryConfidence?: string | null
  approvalNotes?: string | null
  productSelectionConfig?: Record<string, unknown>
}

export type ListingProposalSafetyBlock = {
  advisoryOnly: true
  localOnly: true
  externalCallsMade: false
  ebayApiUsed: false
  realDraftCreated: false
  publishedToEbay: false
  listingMutated: false
  requiresHumanReview: true
}

export type ListingProposalDocument = {
  schemaVersion: "EBAY_LISTING_DRAFT_SCHEMA_V1"
  source: Record<string, unknown>
  listingProposal: Record<string, unknown> & {
    advisoryOnly: true
    humanReviewRequired: true
  }
  review: Record<string, unknown> & {
    listingState: string
    requiredHumanActions: string[]
    missingData: string[]
    riskFlags: string[]
  }
  safety: ListingProposalSafetyBlock
}

export function buildListingProposalFromCandidate(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): ListingProposalDocument

export function buildSourceBlock(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildTitleProposal(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildCategoryProposal(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildPriceProposal(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildItemSpecificsProposal(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildDescriptionProposal(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildImagePlan(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>[]

export function buildShippingPlan(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildReturnPlan(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildComplianceBlock(
  candidate?: ListingProposalCandidate,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildReviewBlock(
  candidate?: ListingProposalCandidate,
  listingProposal?: Record<string, unknown>,
  options?: ListingProposalGeneratorOptions
): Record<string, unknown>

export function buildSafetyBlock(): ListingProposalSafetyBlock
