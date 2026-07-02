const secondaryImagePlan = [
  {
    imageNumber:
      1,
    name:
      "Material / Texture Zoom",
    status:
      "PLANNED_NOT_GENERATED",
  },
  {
    imageNumber:
      2,
    name:
      "Package Contents",
    status:
      "PLANNED_NOT_GENERATED",
  },
  {
    imageNumber:
      3,
    name:
      "Dimensions / Measurements",
    status:
      "PLANNED_NOT_GENERATED",
    textAllowed:
      true,
    blockedUntilDimensionsConfirmed:
      true,
  },
  {
    imageNumber:
      4,
    name:
      "Main Benefit In Action",
    status:
      "PLANNED_NOT_GENERATED",
  },
  {
    imageNumber:
      5,
    name:
      "Aspirational Lifestyle",
    status:
      "PLANNED_NOT_GENERATED",
  },
  {
    imageNumber:
      6,
    name:
      "Real Use With Human Hands",
    status:
      "PLANNED_NOT_GENERATED",
  },
]

export function getLunaPortexCatalogImagePolicy() {
  return {
    sourceName:
      "Luna Portex Catalog",
    sourceType:
      "supplier_catalog_image_reference",
    lunaPortexCatalogImageIsVisualSourceOfTruth:
      true,
    catalogImageSourceRequired:
      true,
    catalogImageUrlStoredInFixture:
      false,
    catalogImageRetrievalAllowedInThisLoop:
      false,
    externalImageFetchAllowedInThisLoop:
      false,
    imageGenerationUsed:
      false,
    imageUploadUsed:
      false,
  }
}

export function getMainImageOptimizationPolicy() {
  return {
    mainImageSource:
      "LUNA_PORTEX_CATALOG_IMAGE",
    mainImageSourceBasedOptimizationAllowed:
      true,
    optimizationType:
      "SOURCE_BASED_ENHANCEMENT_ONLY",
    mainImageGeneratedFromScratch:
      false,
    mainImageMustNotLookAiGenerated:
      true,
    exactProductFidelityRequired:
      true,
    mustLookPhotorealistic:
      true,
    requirements: [
      "pure_or_clean_white_background",
      "centered_product",
      "high_detail",
      "improved_lighting",
      "faithful_color",
      "real_proportions",
      "no_promotional_text",
      "no_extra_graphics",
      "no_third_party_logos_added",
      "no_watermarks",
      "realistic_ecommerce_photo_style",
    ],
    imageGenerationUsed:
      false,
    imageUploadUsed:
      false,
  }
}

export function getSecondaryImagePackagePlan() {
  return {
    packageType:
      "SIX_SECONDARY_CONVERSION_IMAGES",
    source:
      "LUNA_PORTEX_CATALOG_IMAGE",
    secondaryImagesAiAssistedAllowedFromCatalogSourceOnly:
      true,
    exactProductFidelityRequired:
      true,
    mustNotInventAccessories:
      true,
    mustNotInventVariants:
      true,
    images:
      secondaryImagePlan,
    imageGenerationUsed:
      false,
    imageUploadUsed:
      false,
  }
}

export function getBlockedCatalogImagePolicyResponse() {
  return {
    advisoryOnly:
      true,
    imagePolicyOnly:
      true,
    lunaPortexCatalogImageIsVisualSourceOfTruth:
      true,
    mainImageSourceBasedOptimizationAllowed:
      true,
    mainImageGeneratedFromScratch:
      false,
    mainImageMustNotLookAiGenerated:
      true,
    secondaryImagesAiAssistedAllowedFromCatalogSourceOnly:
      true,
    exactProductFidelityRequired:
      true,
    imageGenerationUsed:
      false,
    imageUploadUsed:
      false,
    readyForDraftPayload:
      false,
    readyForDraft:
      false,
    readyForPublication:
      false,
  }
}
