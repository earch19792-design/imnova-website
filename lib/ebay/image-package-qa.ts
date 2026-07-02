type ImageQaInput = {
  catalogSourceConfirmed?: boolean
  rightsAuthorized?: boolean
  mainImageOptimized?: boolean
  photorealismApproved?: boolean
  productFidelityApproved?: boolean
  dimensionsConfirmed?: boolean
}

function asImageQaInput(input: unknown): ImageQaInput {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    return input as ImageQaInput
  }

  return {}
}

export function getImageQaGates() {
  return {
    catalogSourceAvailable:
      false,
    catalogSourceAuthorized:
      false,
    mainImageOptimized:
      false,
    mainImagePhotorealistic:
      false,
    mainImageNotAiLooking:
      false,
    productFidelityApproved:
      false,
    secondaryImagePlanReady:
      true,
    secondaryImagesGenerated:
      false,
    dimensionsConfirmedForMeasurementImage:
      false,
    imagePackageReadyForDraftPayload:
      false,
    imagePackageReadyForEbayUpload:
      false,
    canGenerateImagePrompts:
      true,
    canGenerateActualImages:
      false,
    canUploadImages:
      false,
    canBuildDraftPayloadWithImages:
      false,
    canCreateEbayDraft:
      false,
    canPublishToEbay:
      false,
  }
}

export function evaluateImagePackageQa(input?: unknown) {
  const qaInput =
    asImageQaInput(input)

  const blockingGates = [
    !qaInput.catalogSourceConfirmed
      ? "catalog_image_source_not_confirmed"
      : null,
    !qaInput.rightsAuthorized
      ? "image_rights_or_authorization_not_confirmed"
      : null,
    !qaInput.mainImageOptimized
      ? "main_image_not_optimized"
      : null,
    !qaInput.photorealismApproved
      ? "photorealism_qa_not_approved"
      : null,
    !qaInput.productFidelityApproved
      ? "product_fidelity_qa_not_approved"
      : null,
    !qaInput.dimensionsConfirmed
      ? "dimensions_not_confirmed"
      : null,
    "image_upload_not_allowed",
  ].filter((gate): gate is string => Boolean(gate))

  return {
    qaStatus:
      "IMAGE_QA_GATES_ACTIVE_IMAGES_NOT_GENERATED",
    catalogSourceConfirmed:
      qaInput.catalogSourceConfirmed === true,
    rightsAuthorized:
      qaInput.rightsAuthorized === true,
    mainImageOptimized:
      qaInput.mainImageOptimized === true,
    photorealismApproved:
      qaInput.photorealismApproved === true,
    productFidelityApproved:
      qaInput.productFidelityApproved === true,
    dimensionsConfirmed:
      qaInput.dimensionsConfirmed === true,
    measurementImageBlocked:
      qaInput.dimensionsConfirmed !== true,
    imagePackageReadyForDraftPayload:
      false,
    canGenerateActualImages:
      false,
    canUploadImages:
      false,
    canCreateEbayDraft:
      false,
    canPublishToEbay:
      false,
    blockingGates,
  }
}

export function getImagePackageReadinessSummary() {
  return {
    imagePackageStatus:
      "LUNA_PORTEX_CATALOG_IMAGE_PACKAGE_QA_READY",
    visualSourceDecision:
      "USE_LUNA_PORTEX_CATALOG_IMAGE_AS_VISUAL_SOURCE_OF_TRUTH",
    mainImagePolicyStatus:
      "SOURCE_BASED_MAIN_IMAGE_OPTIMIZATION_ALLOWED",
    secondaryImagePolicyStatus:
      "AI_ASSISTED_SECONDARY_IMAGES_ALLOWED_FROM_CATALOG_SOURCE_ONLY",
    imageQaStatus:
      "IMAGE_QA_GATES_ACTIVE_IMAGES_NOT_GENERATED",
    draftImpact:
      "DO_NOT_CREATE_EBAY_DRAFT",
    publicationImpact:
      "DO_NOT_PUBLISH",
    imageGenerationUsed:
      false,
    imageUploadUsed:
      false,
  }
}

export function getBlockedImagePackageQaResponse() {
  return {
    advisoryOnly:
      true,
    imagePolicyOnly:
      true,
    catalogImageSourceRequired:
      true,
    lunaPortexCatalogImageIsVisualSourceOfTruth:
      true,
    mainImageGeneratedFromScratch:
      false,
    mainImageMustNotLookAiGenerated:
      true,
    exactProductFidelityRequired:
      true,
    imageGenerationUsed:
      false,
    imageUploadUsed:
      false,
    canBuildDraftPayloadWithImages:
      false,
    readyForDraft:
      false,
    readyForPublication:
      false,
  }
}
