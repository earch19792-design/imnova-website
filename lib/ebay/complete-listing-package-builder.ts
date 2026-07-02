import {
  getMainImageOptimizationPolicy,
  getSecondaryImagePackagePlan,
} from "./catalog-image-policy"
import {
  buildDraftPayloadDryRun,
} from "./draft-payload-dry-run-builder"
import {
  evaluateImagePackageQa,
} from "./image-package-qa"
import {
  getGeneratedListingPreviewForSelectedProduct,
} from "./real-product-listing-generator"

type PackageOptions = {
  slug?: string | null
  productId?: string | null
}

type ProductRecord = Record<string, unknown>

function asRecord(input: unknown): ProductRecord {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    return input as ProductRecord
  }

  return {}
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed =
    value.trim()

  return trimmed.length > 0
    ? trimmed
    : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => Boolean(item))
}

export function normalizeCatalogImageReferences(product: unknown) {
  const record =
    asRecord(product)

  const imageCandidates = [
    normalizeString(record.image_url),
    normalizeString(record.image),
    normalizeString(record.lifestyle_image),
    normalizeString(record.featured_image_url),
    ...readStringArray(record.lifestyle_images),
    ...readStringArray(record.image_urls),
  ].filter((item): item is string => Boolean(item))

  const uniqueReferences =
    Array.from(new Set(imageCandidates))

  return {
    catalogImageReferenceStatus:
      uniqueReferences.length > 0
        ? "CATALOG_IMAGE_REFERENCE_FOUND"
        : "CATALOG_IMAGE_REFERENCE_MISSING",
    primaryCatalogImageReference:
      uniqueReferences[0] ?? null,
    allCatalogImageReferences:
      uniqueReferences,
    displayAllowed:
      uniqueReferences.length > 0,
    displaySource:
      uniqueReferences.length > 0
        ? "selected_product_read_only_data"
        : "none",
    externalHardcodedImageUsed:
      false,
  }
}

export function buildSecondaryImagePrompts(input?: unknown) {
  const record =
    asRecord(input)

  const dimensionsConfirmed =
    record.dimensionsConfirmed === true

  const sourceRequirement =
    "Use Luna Portex catalog image as product reference"

  return [
    {
      imageNumber:
        1,
      name:
        "Material / Texture Zoom",
      purpose:
        "Show material texture, finish and quality.",
      promptTemplate:
        "Create a close material and texture zoom composition using the Luna Portex catalog image as product reference. Preserve the exact product shape, color, texture, logo, scale and proportions.",
      sourceRequirement,
      fidelityRule:
        "Do not invent material, finish, accessories, variants, logos, features or claims.",
      status:
        "PROMPT_READY_IMAGE_NOT_GENERATED",
    },
    {
      imageNumber:
        2,
      name:
        "Package Contents",
      purpose:
        "Show what is included in the shipment without inventing contents.",
      promptTemplate:
        "Create a package contents composition using the Luna Portex catalog image as product reference. Show only confirmed included items and leave unconfirmed contents out.",
      sourceRequirement,
      fidelityRule:
        "Do not add pieces, accessories, packaging, variants or quantities that Products has not confirmed.",
      status:
        "PROMPT_READY_IMAGE_NOT_GENERATED",
    },
    {
      imageNumber:
        3,
      name:
        "Dimensions / Measurements",
      purpose:
        "Show confirmed dimensions only.",
      promptTemplate:
        "Create a measurements image using the Luna Portex catalog image as product reference and add measurement text only after dimensions are confirmed in Products.",
      sourceRequirement,
      fidelityRule:
        "Do not estimate dimensions or scale. Text is allowed only for confirmed measurements.",
      status:
        "PROMPT_READY_IMAGE_NOT_GENERATED",
      blockedUntilDimensionsConfirmed:
        !dimensionsConfirmed,
    },
    {
      imageNumber:
        4,
      name:
        "Main Benefit In Action",
      purpose:
        "Show the problem solved visually without unsupported claims.",
      promptTemplate:
        "Create a realistic in-action product scene using the Luna Portex catalog image as product reference. Show only benefits supported by confirmed product facts.",
      sourceRequirement,
      fidelityRule:
        "Do not create unsupported performance claims or alter product shape, color, material or proportions.",
      status:
        "PROMPT_READY_IMAGE_NOT_GENERATED",
    },
    {
      imageNumber:
        5,
      name:
        "Aspirational Lifestyle",
      purpose:
        "Show the product in a realistic aspirational usage context.",
      promptTemplate:
        "Create a clean aspirational lifestyle context using the Luna Portex catalog image as product reference. Keep product fidelity exact and use realistic ecommerce styling.",
      sourceRequirement,
      fidelityRule:
        "Do not make the product look artificial, rendered, altered or generated from scratch.",
      status:
        "PROMPT_READY_IMAGE_NOT_GENERATED",
    },
    {
      imageNumber:
        6,
      name:
        "Real Use With Human Hands",
      purpose:
        "Show scale and ease of use in a realistic context.",
      promptTemplate:
        "Create a real-use composition with human hands using the Luna Portex catalog image as product reference. Preserve product scale, proportions, color and material exactly.",
      sourceRequirement,
      fidelityRule:
        "Do not invent usage claims, accessories, variants or unconfirmed dimensions.",
      status:
        "PROMPT_READY_IMAGE_NOT_GENERATED",
    },
  ]
}

function calculatePackageReadinessScore(
  previewGenerated: boolean,
  catalogImageFound: boolean
) {
  return (
    (previewGenerated ? 25 : 0) +
    10 +
    10 +
    (catalogImageFound ? 10 : 0)
  )
}

export function getCompleteListingPackageSummary() {
  return {
    packageVersion:
      "EBAY_COMPLETE_LISTING_PACKAGE_BUILDER_V1",
    packageStatus:
      "COMPLETE_LISTING_PACKAGE_BUILDER_READY",
    productSourceStatus:
      "READ_ONLY_PRODUCTS_SOURCE_WITH_SAFE_FALLBACK",
    listingContentStatus:
      "GENERATED_LISTING_PREVIEW_READY",
    catalogImageStatus:
      "LUNA_PORTEX_CATALOG_IMAGE_REFERENCE_READY_OR_BLOCKED",
    secondaryImagePromptStatus:
      "SECONDARY_IMAGE_PROMPTS_READY_IMAGES_NOT_GENERATED",
    draftPayloadStatus:
      "DRAFT_PAYLOAD_DRY_RUN_READY_NOT_SUBMITTED",
    readinessStatus:
      "READINESS_GATES_ACTIVE_DRAFT_AND_PUBLICATION_BLOCKED",
    dryRunOnly:
      true,
    readyForDraft:
      false,
    readyForPublication:
      false,
  }
}

export async function getCompleteListingPackage(
  options: PackageOptions = {}
) {
  const listingPackage =
    await getGeneratedListingPreviewForSelectedProduct(options)

  const rawProduct =
    listingPackage.selectedProduct.rawProduct

  const catalogImageReferences =
    normalizeCatalogImageReferences(rawProduct)

  const secondaryImagePrompts =
    buildSecondaryImagePrompts({
      dimensionsConfirmed:
        listingPackage.mappedFacts.confirmedFactIds.includes("dimensions"),
    })

  const generatedListingPreview =
    listingPackage.generatedListingPreview

  const draftPayloadDryRun =
    buildDraftPayloadDryRun({
      titlePreview:
        generatedListingPreview.titlePreview,
      descriptionPreview:
        generatedListingPreview.descriptionPreview.text,
      itemSpecificsPreview:
        generatedListingPreview.itemSpecificsPreview.specifics,
    })

  const imageQa =
    evaluateImagePackageQa({
      catalogSourceConfirmed:
        catalogImageReferences.catalogImageReferenceStatus ===
        "CATALOG_IMAGE_REFERENCE_FOUND",
      dimensionsConfirmed:
        listingPackage.mappedFacts.confirmedFactIds.includes("dimensions"),
    })

  const readinessScore =
    calculatePackageReadinessScore(
      generatedListingPreview.previewGenerated,
      catalogImageReferences.catalogImageReferenceStatus ===
        "CATALOG_IMAGE_REFERENCE_FOUND"
    )

  return {
    packageVersion:
      "EBAY_COMPLETE_LISTING_PACKAGE_BUILDER_V1",
    packageStatus:
      "COMPLETE_LISTING_PACKAGE_BUILDER_READY",
    selectedProduct:
      listingPackage.selectedProduct,
    generatedListingContent:
      generatedListingPreview,
    missingFacts:
      listingPackage.missingProductFacts,
    blockedFields:
      listingPackage.blockedListingFields,
    catalogImagePackage: {
      visualSource:
        "Luna Portex Catalog",
      catalogImageReferenceStatus:
        catalogImageReferences.catalogImageReferenceStatus,
      catalogImageReferences,
      mainImageOptimizationPlan:
        getMainImageOptimizationPolicy(),
      secondaryImagePackagePlan:
        getSecondaryImagePackagePlan(),
      imageQa,
      imageGenerationUsed:
        false,
      imageUploadUsed:
        false,
    },
    secondaryImagePrompts,
    draftPayloadDryRun,
    readinessGates: {
      canReadProduct:
        true,
      canGenerateListingPreview:
        generatedListingPreview.previewGenerated,
      canPrepareImagePrompts:
        true,
      canBuildLocalDryRunPayload:
        true,
      canSubmitPayloadToEbay:
        false,
      canCreateEbayDraft:
        false,
      canPublishToEbay:
        false,
      readinessScore,
      blockers: [
        ...listingPackage.missingProductFacts,
        ...imageQa.blockingGates,
        "ebay_connection_not_authorized",
      ],
    },
    safetyFlags: {
      internalOnly:
        true,
      dryRunOnly:
        true,
      productsRemainSourceOfTruth:
        true,
      lunaPortexCatalogImageIsVisualSourceOfTruth:
        true,
      productFactsDuplicatedAsTruth:
        false,
      imageGenerationUsed:
        false,
      imageUploadUsed:
        false,
      draftPayloadSubmitted:
        false,
      ebayApiUsed:
        false,
      oauthUsed:
        false,
      tokensUsed:
        false,
      realDraftCreated:
        false,
      publishedToEbay:
        false,
      supabaseWriteUsed:
        false,
      migrationCreated:
        false,
    },
  }
}

export function getBlockedCompleteListingPackageResponse() {
  return {
    packageStatus:
      "COMPLETE_LISTING_PACKAGE_BUILDER_READY",
    internalOnly:
      true,
    dryRunOnly:
      true,
    productsRemainSourceOfTruth:
      true,
    lunaPortexCatalogImageIsVisualSourceOfTruth:
      true,
    productFactsDuplicatedAsTruth:
      false,
    canBuildLocalDryRunPayload:
      true,
    canSubmitPayloadToEbay:
      false,
    readyForDraft:
      false,
    readyForPublication:
      false,
    realDraftCreated:
      false,
    publishedToEbay:
      false,
  }
}
