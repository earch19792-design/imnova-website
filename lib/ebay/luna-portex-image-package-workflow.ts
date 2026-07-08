export const LUNA_PORTEX_IMAGE_PACKAGE_WORKFLOW_VERSION =
  "LUNA_PORTEX_IMAGE_PACKAGE_WORKFLOW_PERCEIVED_VALUE_V1"

const sourceDataClass =
  "LOOP_147_IMAGE_PACKAGE_WORKFLOW"
const maxImagePackages =
  10
const prohibitedActions =
  [
    "GENERATE_IMAGE_WITH_OPENAI",
    "UPLOAD_IMAGE",
    "CREATE_EBAY_DRAFT",
    "PUBLISH_LISTING",
    "SEND_REAL_WHATSAPP",
    "UPDATE_STAGING_DECISION",
    "TOUCH_PRODUCTION",
  ] as const

type ListingPackageEntry = {
  candidateKey?: string | null
  productTitle?: string | null
  listingTitle?: string | null
  imageRequirements?: string[] | null
  complianceWarnings?: string[] | null
  blockedReasons?: string[] | null
  warnings?: string[] | null
  readyForImageWorkflow?: boolean | null
  readyForListingApproval?: boolean | null
  canCreateEbayDraft?: boolean | null
  canPublishRealListing?: boolean | null
  requiresHumanApproval?: boolean | null
  requiresImagePackage?: boolean | null
  requiresComplianceReview?: boolean | null
  trustSignals?: {
    imageQualityRequired?: boolean | null
    complianceReviewRequired?: boolean | null
  } | null
}

type ImageWorkflowOptions = {
  maxPackages?: number | null
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function normalizeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback
}

function normalizeArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function hasAnyText(input: ReturnType<typeof buildImagePackageInput>, values: string[]) {
  const searchable =
    `${input.candidateKey} ${input.productTitle} ${input.listingTitle} ${input.blockedReasons.join(" ")} ${input.warnings.join(" ")} ${input.complianceWarnings.join(" ")}`.toLowerCase()

  return values.some(value => searchable.includes(value.toLowerCase()))
}

function missingMainImage(input: ReturnType<typeof buildImagePackageInput>) {
  return (
    input.requiresImagePackage ||
    input.imageRequirements.some(requirement => requirement.toLowerCase().includes("primary")) ||
    input.blockedReasons.some(reason => reason.toLowerCase().includes("image"))
  )
}

function isSpecialProduct(input: ReturnType<typeof buildImagePackageInput>) {
  return {
    aerosol:
      hasAnyText(input, ["aerosol", "spray", "paint", "finish"]),
    electrical:
      hasAnyText(input, ["electrical", "battery", "charger", "cord"]),
    cleaning:
      hasAnyText(input, ["cleaning", "chemical", "cleaner"]),
  }
}

export function buildImagePackageInput(
  listingPackage: ListingPackageEntry,
  options: ImageWorkflowOptions = {},
) {
  void options
  const imageRequirements =
    normalizeArray(listingPackage.imageRequirements)
  const complianceWarnings =
    normalizeArray(listingPackage.complianceWarnings)

  return {
    imageWorkflowVersion:
      LUNA_PORTEX_IMAGE_PACKAGE_WORKFLOW_VERSION,
    sourceDataClass,
    candidateKey:
      normalizeText(listingPackage.candidateKey) ?? "unknown-candidate",
    productTitle:
      normalizeText(listingPackage.productTitle) ?? "Untitled Luna Portex candidate",
    listingTitle:
      normalizeText(listingPackage.listingTitle) ?? "Untitled eBay listing package",
    imageRequirements,
    complianceWarnings,
    blockedReasons:
      normalizeArray(listingPackage.blockedReasons),
    warnings:
      normalizeArray(listingPackage.warnings),
    readyForImageWorkflow:
      listingPackage.readyForImageWorkflow === true,
    readyForListingApproval:
      listingPackage.readyForListingApproval === true,
    requiresImagePackage:
      listingPackage.requiresImagePackage !== false || imageRequirements.length > 0,
    requiresComplianceReview:
      listingPackage.requiresComplianceReview === true ||
      listingPackage.trustSignals?.complianceReviewRequired === true ||
      complianceWarnings.length > 0,
    imageQualityRequired:
      listingPackage.trustSignals?.imageQualityRequired !== false,
  }
}

export function buildMainImageRequirements(
  input: ReturnType<typeof buildImagePackageInput>,
  options: ImageWorkflowOptions = {},
) {
  void options

  return {
    mustUseRealProductImage:
      true,
    background:
      "white or clean neutral",
    productCentered:
      true,
    noTextOverlay:
      true,
    noWatermarks:
      true,
    noExternalLogosAdded:
      true,
    noPeople:
      true,
    noGeneratedFakeProduct:
      true,
    minimumRecommendedResolution:
      "1600px on longest side",
    showSingleProductClearly:
      true,
    mustNotAlterProductAppearance:
      true,
    notes:
      missingMainImage(input)
        ? ["main image must be captured before draft readiness"]
        : ["verify existing main image against marketplace trust rules"],
  }
}

export function buildSecondaryImagePlan(
  input: ReturnType<typeof buildImagePackageInput>,
  options: ImageWorkflowOptions = {},
) {
  void options
  const specialProduct =
    isSpecialProduct(input)
  const plan =
    [
      {
        imageType:
          "product-in-use",
        purpose:
          "Show real use context without misleading claims.",
        required:
          true,
      },
      {
        imageType:
          "material or detail zoom",
        purpose:
          "Show texture, label, connector, or important product detail.",
        required:
          true,
      },
      {
        imageType:
          "package contents",
        purpose:
          "Show what the buyer receives.",
        required:
          true,
      },
      {
        imageType:
          "dimensions / size context",
        purpose:
          "Help buyer understand scale and compatibility.",
        required:
          true,
      },
      {
        imageType:
          "benefit visual",
        purpose:
          "Explain value visually without unconfirmed claims.",
        required:
          false,
      },
      {
        imageType:
          "lifestyle or use scenario",
        purpose:
          "Support perceived value with honest context.",
        required:
          false,
      },
    ]
  const reviewNotes =
    [
      specialProduct.aerosol ? "aerosol/spray paint: include compliance or shipping review note; no hazmat claim without confirmation" : null,
      specialProduct.electrical ? "electrical: safety or certification detail image required only if confirmed; no certification claim unless confirmed" : null,
      specialProduct.cleaning ? "cleaning/chemical: include usage context and safe-use note when applicable" : null,
    ].filter((entry): entry is string => entry !== null)

  return {
    secondaryImages:
      plan,
    maxSecondaryImages:
      6,
    reviewNotes,
  }
}

export function buildPerceivedValueImageCheck(
  input: ReturnType<typeof buildImagePackageInput>,
  imagePackage: {
    mainImageRequirements: ReturnType<typeof buildMainImageRequirements>
    secondaryImagePlan: ReturnType<typeof buildSecondaryImagePlan>
  },
  options: ImageWorkflowOptions = {},
) {
  void options
  const missingMain =
    missingMainImage(input)
  const missingImageTypes =
    unique([
      missingMain ? "main product image" : null,
      "product-in-use",
      "material or detail zoom",
      "package contents",
      "dimensions / size context",
      input.requiresComplianceReview ? "compliance detail image review" : null,
    ].filter((entry): entry is string => entry !== null))
  const mainImageReadinessScore =
    missingMain ? 20 : 75
  const secondaryImageCompletenessScore =
    clampScore(100 - imagePackage.secondaryImagePlan.secondaryImages.filter(image => image.required).length * 10)
  const trustImageScore =
    clampScore(
      75 -
      (input.requiresComplianceReview ? 20 : 0) -
      (missingMain ? 25 : 0),
    )
  const conversionImageScore =
    clampScore(
      70 -
      missingImageTypes.length * 8,
    )
  const imageRiskPenalty =
    clampScore(
      (missingMain ? 35 : 0) +
      (input.requiresComplianceReview ? 20 : 0) +
      Math.max(0, missingImageTypes.length - 3) * 6,
    )
  const perceivedValueImageScore =
    clampScore(
      mainImageReadinessScore * 0.35 +
      secondaryImageCompletenessScore * 0.2 +
      trustImageScore * 0.25 +
      conversionImageScore * 0.2 -
      imageRiskPenalty * 0.25,
    )

  return {
    perceivedValueImageScore,
    mainImageReadinessScore,
    secondaryImageCompletenessScore,
    trustImageScore,
    conversionImageScore,
    imageRiskPenalty,
    missingImageTypes,
    imageWarnings:
      unique([
        missingMain ? "main product image missing or not verified" : null,
        input.requiresComplianceReview ? "compliance image review required before draft" : null,
        missingImageTypes.length > 3 ? "secondary image package is incomplete" : null,
      ].filter((entry): entry is string => entry !== null)),
  }
}

export function buildImageReadinessGates(
  input: ReturnType<typeof buildImagePackageInput>,
  imagePackage: {
    perceivedValueImageCheck: ReturnType<typeof buildPerceivedValueImageCheck>
  },
  options: ImageWorkflowOptions = {},
) {
  void options
  const blockedByMissingMainImage =
    imagePackage.perceivedValueImageCheck.missingImageTypes.includes("main product image")
  const blockedByMissingSecondaryImages =
    imagePackage.perceivedValueImageCheck.missingImageTypes.some(type => type !== "main product image")
  const blockedByComplianceImageReview =
    input.requiresComplianceReview
  const blockedByLowPerceivedValue =
    imagePackage.perceivedValueImageCheck.perceivedValueImageScore < 55
  const blockedReasons =
    unique([
      ...input.blockedReasons,
      blockedByMissingMainImage ? "missing main product image" : null,
      blockedByMissingSecondaryImages ? "secondary image package incomplete" : null,
      blockedByComplianceImageReview ? "compliance image review required" : null,
      blockedByLowPerceivedValue ? "perceived value image score low" : null,
    ].filter((entry): entry is string => entry !== null))

  return {
    readyForImageProduction:
      true,
    readyForListingPackageApproval:
      input.readyForListingApproval &&
      !blockedByComplianceImageReview &&
      !blockedByLowPerceivedValue,
    readyForEbayDraft:
      false,
    readyForRealListing:
      false,
    canCreateEbayDraft:
      false,
    canPublishRealListing:
      false,
    blockedByMissingMainImage,
    blockedByMissingSecondaryImages,
    blockedByComplianceImageReview,
    blockedByLowPerceivedValue,
    blockedReasons,
    warnings:
      unique([
        ...input.warnings,
        ...imagePackage.perceivedValueImageCheck.imageWarnings,
      ]),
    nextRecommendedAction:
      blockedByComplianceImageReview
        ? "REQUEST_COMPLIANCE_IMAGE_REVIEW"
        : blockedByMissingMainImage
          ? "REQUEST_MAIN_IMAGE"
          : blockedByMissingSecondaryImages
            ? "REQUEST_SECONDARY_IMAGES"
            : blockedByLowPerceivedValue
              ? "REQUEST_LIFESTYLE_IMAGE"
              : "APPROVE_IMAGE_WORKFLOW",
  }
}

export function buildImageProductionPrompts(
  input: ReturnType<typeof buildImagePackageInput>,
  imagePackage: {
    mainImageRequirements: ReturnType<typeof buildMainImageRequirements>
    secondaryImagePlan: ReturnType<typeof buildSecondaryImagePlan>
  },
  options: ImageWorkflowOptions = {},
) {
  void options

  return {
    mainImagePromptGuidance:
      `Capture a real main product photo for ${input.productTitle} on a clean white or neutral background. Keep the product centered and unaltered.`,
    secondaryImagePromptGuidance:
      imagePackage.secondaryImagePlan.secondaryImages.map(image => `${image.imageType}: ${image.purpose}`),
    imageEditingInstructions:
      [
        "Use only real product photos.",
        "Clean exposure, crop, and background without changing the product.",
        "Preserve label, color, dimensions, and packaging truthfully.",
      ],
    prohibitedImageEdits:
      [
        "no cambiar el producto real",
        "no inventar features",
        "no anadir logos no existentes",
        "no crear claims visuales falsos",
        "no simular certificaciones",
        "no poner textos enganosos",
        "no crear medical/safety claims falsos",
        "no generar producto falso desde cero para imagen principal",
      ],
  }
}

export function buildWhatsAppImageAlertPreview(
  imagePackage: ReturnType<typeof buildImagePackage>,
  options: ImageWorkflowOptions = {},
) {
  void options
  return {
    messageType:
      "IMAGE_PACKAGE_REVIEW",
    title:
      `Image workflow: ${imagePackage.productTitle}`,
    body:
      `${imagePackage.listingTitle} needs image workflow review. Next: ${imagePackage.nextRecommendedAction}.`,
    candidateKey:
      imagePackage.candidateKey,
    listingTitle:
      imagePackage.listingTitle,
    missingImages:
      [...imagePackage.perceivedValueImageCheck.missingImageTypes],
    perceivedValueImageScore:
      imagePackage.perceivedValueImageCheck.perceivedValueImageScore,
    mainBlockers:
      [...imagePackage.blockedReasons],
    buttons:
      buildImageMobileDecisionActions(imagePackage),
    previewOnly:
      true,
    realSendUsed:
      false,
  }
}

function buildImageMobileDecisionActions(
  imagePackage: ReturnType<typeof buildImagePackage>,
) {
  const actions =
    [
      "VIEW_IMAGE_REQUIREMENTS",
      imagePackage.imageReadinessGates.readyForImageProduction ? "APPROVE_IMAGE_WORKFLOW" : null,
      imagePackage.imageReadinessGates.blockedByMissingMainImage ? "REQUEST_MAIN_IMAGE" : null,
      imagePackage.imageReadinessGates.blockedByMissingSecondaryImages ? "REQUEST_SECONDARY_IMAGES" : null,
      imagePackage.perceivedValueImageCheck.missingImageTypes.includes("dimensions / size context") ? "REQUEST_DIMENSION_IMAGE" : null,
      imagePackage.imageReadinessGates.blockedByLowPerceivedValue ? "REQUEST_LIFESTYLE_IMAGE" : null,
      imagePackage.imageReadinessGates.blockedByComplianceImageReview ? "REQUEST_COMPLIANCE_IMAGE_REVIEW" : null,
      imagePackage.imageReadinessGates.blockedByLowPerceivedValue ? "MOVE_TO_WATCHLIST" : null,
    ].filter((entry): entry is string => entry !== null)

  return unique(actions)
}

export function buildImagePackage(
  listingPackage: ListingPackageEntry,
  options: ImageWorkflowOptions = {},
) {
  const input =
    buildImagePackageInput(listingPackage, options)
  const mainImageRequirements =
    buildMainImageRequirements(input, options)
  const secondaryImagePlan =
    buildSecondaryImagePlan(input, options)
  const perceivedValueImageCheck =
    buildPerceivedValueImageCheck(
      input,
      {
        mainImageRequirements,
        secondaryImagePlan,
      },
      options,
    )
  const imageReadinessGates =
    buildImageReadinessGates(
      input,
      {
        perceivedValueImageCheck,
      },
      options,
    )
  const imageProductionPrompts =
    buildImageProductionPrompts(
      input,
      {
        mainImageRequirements,
        secondaryImagePlan,
      },
      options,
    )

  return {
    imageWorkflowVersion:
      LUNA_PORTEX_IMAGE_PACKAGE_WORKFLOW_VERSION,
    sourceDataClass,
    candidateKey:
      input.candidateKey,
    productTitle:
      input.productTitle,
    listingTitle:
      input.listingTitle,
    mainImageRequirements,
    secondaryImagePlan,
    imageCountTarget:
      1 + secondaryImagePlan.secondaryImages.length,
    imageQualityChecklist:
      [
        "real product image confirmed",
        "main image clean background",
        "no text overlays or watermarks",
        "secondary images explain use, detail, contents, size, value, and context",
        "compliance-sensitive images reviewed before draft",
      ],
    perceivedValueImageCheck,
    imageReadinessGates,
    imageProductionPrompts,
    blockedReasons:
      imageReadinessGates.blockedReasons,
    warnings:
      imageReadinessGates.warnings,
    canCreateEbayDraft:
      false,
    canPublishRealListing:
      false,
    requiresHumanApproval:
      true,
    readyForEbaySandboxOAuth:
      false,
    readyForEbayDraft:
      false,
    readyForRealListing:
      false,
    imageGenerationExecuted:
      false,
    imageUploadExecuted:
      false,
    nextRecommendedAction:
      imageReadinessGates.nextRecommendedAction,
  }
}

export function buildImagePackageQueue(
  listingPackages: ListingPackageEntry[] = [],
  options: ImageWorkflowOptions = {},
) {
  const limit =
    Math.min(
      Math.max(normalizeNumber(options.maxPackages, maxImagePackages), 0),
      maxImagePackages,
    )
  const packages =
    listingPackages
      .slice(0, limit)
      .map(listingPackage => buildImagePackage(listingPackage, options))
  const whatsappImageAlertPreviews =
    packages.map(imagePackage => buildWhatsAppImageAlertPreview(imagePackage, options))
  const mobileDecisionActions =
    unique(whatsappImageAlertPreviews.flatMap(preview => preview.buttons))
  const prohibitedActionsDetected =
    mobileDecisionActions.filter(action => prohibitedActions.includes(action as (typeof prohibitedActions)[number]))

  return {
    imageWorkflowVersion:
      LUNA_PORTEX_IMAGE_PACKAGE_WORKFLOW_VERSION,
    sourceDataClass,
    inputListingPackages:
      listingPackages.slice(0, limit).length,
    imagePackagesBuilt:
      packages.length,
    packages,
    whatsappImageAlertPreviews,
    mobileDecisionActions,
    prohibitedActionsDetected,
    imageGenerationExecuted:
      false,
    imageUploadExecuted:
      false,
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    openAiUsed:
      false,
    whatsappRealSendUsed:
      false,
    nextLoop:
      "148",
  }
}

export function summarizeImagePackageQueue(
  queue: ReturnType<typeof buildImagePackageQueue>,
) {
  const scoreTotal =
    queue.packages.reduce(
      (total, imagePackage) => total + imagePackage.perceivedValueImageCheck.perceivedValueImageScore,
      0,
    )
  const averagePerceivedValueImageScore =
    queue.packages.length > 0
      ? Number((scoreTotal / queue.packages.length).toFixed(2))
      : 0

  return {
    inputListingPackages:
      queue.inputListingPackages,
    imagePackagesBuilt:
      queue.imagePackagesBuilt,
    readyForImageProduction:
      queue.packages.filter(imagePackage => imagePackage.imageReadinessGates.readyForImageProduction).length,
    readyForListingPackageApproval:
      queue.packages.filter(imagePackage => imagePackage.imageReadinessGates.readyForListingPackageApproval).length,
    blockedByMissingMainImage:
      queue.packages.filter(imagePackage => imagePackage.imageReadinessGates.blockedByMissingMainImage).length,
    blockedByMissingSecondaryImages:
      queue.packages.filter(imagePackage => imagePackage.imageReadinessGates.blockedByMissingSecondaryImages).length,
    blockedByComplianceImageReview:
      queue.packages.filter(imagePackage => imagePackage.imageReadinessGates.blockedByComplianceImageReview).length,
    averagePerceivedValueImageScore,
    whatsappImageAlertPreviews:
      queue.whatsappImageAlertPreviews.length,
    mobileDecisionActions:
      queue.mobileDecisionActions.length,
    prohibitedActionsDetected:
      [...queue.prohibitedActionsDetected],
    imageGenerationExecuted:
      false,
    imageUploadExecuted:
      false,
    canCreateEbayDraft:
      queue.packages.some(imagePackage => imagePackage.canCreateEbayDraft),
    canPublishRealListing:
      queue.packages.some(imagePackage => imagePackage.canPublishRealListing),
    stagingWriteExecuted:
      false,
    ebayApiUsed:
      false,
    openAiUsed:
      false,
    whatsappRealSendUsed:
      false,
    nextLoop:
      queue.nextLoop,
  }
}

export function getImagePackageWorkflowChecklist() {
  return [
    "confirm Listing Package Builder inputs are local and sanitized",
    "confirm main and secondary image requirements are generated",
    "confirm perceived value image scoring and readiness gates are local only",
    "confirm WhatsApp image alerts are preview and intents only",
    "confirm no image generation, uploads, OpenAI, eBay API, OAuth, Supabase, draft, publication, or Production touch",
    "confirm next loop is 148 — eBay Sandbox OAuth",
  ]
}
