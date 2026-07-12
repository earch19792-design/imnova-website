import type {
  NormalizedLunaOpportunityCandidate,
} from "./ebay-luna-opportunity-types.ts"
import type {
  EbayTaxonomyListingIntelligence,
} from "./ebay-seller-keyword-demand-gateway.ts"

export function buildEbayInventoryMappingPreviewReadiness(
  candidate: NormalizedLunaOpportunityCandidate,
  taxonomy?: EbayTaxonomyListingIntelligence | null
) {
  const productIdentifiers = [
    candidate.gtin ? { type: "GTIN", value: candidate.gtin } : null,
    candidate.mpn ? { type: "MPN", value: candidate.mpn } : null,
  ].filter((entry): entry is { type: string; value: string } => Boolean(entry))
  const customAspects = {
    Brand: candidate.brand,
    MPN: candidate.mpn,
    Color: candidate.color,
    Size: candidate.size,
    "Pack Quantity": candidate.packQuantity?.toString() ?? null,
  }
  const missingBeforePreview = [
    !candidate.title && "title",
    !candidate.imageUrls.length && "authorizedImageUrl",
    !candidate.gtin && !candidate.mpn && "productIdentifier",
    taxonomy?.status !== "AVAILABLE" && "officialCategoryMetadata",
  ].filter((entry): entry is string => Boolean(entry))
  return {
    status: missingBeforePreview.length
      ? "INVENTORY_MAPPING_PREVIEW_INPUT_INCOMPLETE"
      : "READY_TO_REQUEST_INVENTORY_MAPPING_PREVIEW",
    marketplaceId: "EBAY_US",
    previewInputPlan: {
      title: candidate.title,
      imageUrls: candidate.imageAuthorized ? candidate.imageUrls : [],
      productIdentifiers,
      sellerCategoryId: taxonomy?.categoryId ?? candidate.categoryId,
      customAspects,
    },
    missingBeforePreview,
    mappingReferenceId: null,
    graphqlRequestExecuted: false,
    listingDraftCreated: false,
    listingPublished: false,
    recommendationsAreSellerTruth: false,
    humanReviewRequired: true,
  }
}
