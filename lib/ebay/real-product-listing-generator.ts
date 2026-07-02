import {
  getProducts,
} from "../products-service"
import {
  calculateListingReadinessGates,
  generateListingPreviewFromProductFacts,
  getBlockedListingFields,
  getMissingProductFacts,
  mapProductToListingFacts,
} from "./product-facts-mapper"

type SelectorOptions = {
  slug?: string | null
  productId?: string | null
}

type SafeProductReference = {
  productReferenceId: string
  slug: string | null
  name: string
  status: string | null
  supplier: string | null
  source: "products_service_read_only" | "safe_fallback"
  readStatus: "LIVE_READ_ONLY_SUCCESS" | "SAFE_FALLBACK_USED"
  factsConfirmedCount: number
  factsMissingCount: number
  readyForPreview: boolean
  readyForDraft: false
  readyForPublication: false
  rawProduct: unknown
}

const fallbackProduct = {
  product_id:
    "PRODUCT-SOURCE-DRYRUN-001",
  name:
    "Storage Organizer",
  supplier:
    "Portex",
}

function normalizeProductReference(
  product: unknown,
  source: SafeProductReference["source"],
  readStatus: SafeProductReference["readStatus"]
): SafeProductReference {
  const mappedFacts =
    mapProductToListingFacts(product)

  const supplierFact =
    mappedFacts.confirmedFacts.find((fact) => fact.factId === "supplier")

  const statusFact =
    mappedFacts.confirmedFacts.find((fact) => fact.factId === "status")

  return {
    productReferenceId:
      mappedFacts.productReferenceId ??
      mappedFacts.slug ??
      mappedFacts.productName ??
      "PRODUCT-SOURCE-DRYRUN-001",
    slug:
      mappedFacts.slug,
    name:
      mappedFacts.productName ?? "Storage Organizer",
    status:
      statusFact?.value ?? null,
    supplier:
      supplierFact?.value ?? null,
    source,
    readStatus,
    factsConfirmedCount:
      mappedFacts.confirmedFactIds.length,
    factsMissingCount:
      mappedFacts.missingFacts.length,
    readyForPreview:
      Boolean(mappedFacts.productName),
    readyForDraft:
      false,
    readyForPublication:
      false,
    rawProduct:
      product,
  }
}

function getFallbackReference(): SafeProductReference {
  return normalizeProductReference(
    fallbackProduct,
    "safe_fallback",
    "SAFE_FALLBACK_USED"
  )
}

export function getRealProductListingGeneratorIntegrationSummary() {
  return {
    integrationVersion:
      "EBAY_REAL_PRODUCT_LISTING_GENERATOR_INTEGRATION_V1",
    integrationStatus:
      "REAL_PRODUCT_LISTING_GENERATOR_INTEGRATION_READY",
    productReadDecision:
      "READ_PRODUCTS_ONLY_SAFE_FALLBACK_IF_UNAVAILABLE",
    factsMappingStatus:
      "PRODUCT_FACTS_MAPPING_READY_WITH_MISSING_FIELD_BLOCKERS",
    generatorStatus:
      "LISTING_PREVIEW_FROM_SELECTED_PRODUCT_READY",
    gatesStatus:
      "READINESS_GATES_ACTIVE_DRAFT_BLOCKED",
    productsRemainSourceOfTruth:
      true,
    listingUsesFactsByReference:
      true,
    productFactsDuplicatedAsTruth:
      false,
    readyForDraft:
      false,
    readyForPublication:
      false,
  }
}

export async function getReadOnlyProductsForListingGenerator() {
  try {
    const products =
      await getProducts()

    if (Array.isArray(products) && products.length > 0) {
      return {
        source:
          "products_service_read_only" as const,
        readStatus:
          "LIVE_READ_ONLY_SUCCESS" as const,
        products:
          products.map((product) =>
            normalizeProductReference(
              product,
              "products_service_read_only",
              "LIVE_READ_ONLY_SUCCESS"
            )
          ),
      }
    }
  } catch {
  }

  return {
    source:
      "safe_fallback" as const,
    readStatus:
      "SAFE_FALLBACK_USED" as const,
    products: [
      getFallbackReference(),
    ],
  }
}

export async function getSelectedProductForListingGenerator(
  options: SelectorOptions = {}
) {
  const productList =
    await getReadOnlyProductsForListingGenerator()

  const normalizedSlug =
    options.slug?.trim() || null

  const normalizedProductId =
    options.productId?.trim() || null

  const selectedProduct =
    productList.products.find((product) =>
      normalizedSlug
        ? product.slug === normalizedSlug
        : false
    ) ??
    productList.products.find((product) =>
      normalizedProductId
        ? product.productReferenceId === normalizedProductId
        : false
    ) ??
    productList.products[0] ??
    getFallbackReference()

  return {
    ...selectedProduct,
    selectedBy:
      normalizedSlug
        ? "slug"
        : normalizedProductId
          ? "product_id"
          : "default_first_product",
  }
}

export async function getGeneratedListingPreviewForSelectedProduct(
  options: SelectorOptions = {}
) {
  const selectedProduct =
    await getSelectedProductForListingGenerator(options)

  const mappedFacts =
    mapProductToListingFacts(selectedProduct.rawProduct)

  return {
    selectedProduct,
    mappedFacts,
    generatedListingPreview:
      generateListingPreviewFromProductFacts(mappedFacts),
    missingProductFacts:
      getMissingProductFacts(mappedFacts),
    blockedListingFields:
      getBlockedListingFields(mappedFacts),
    readinessGates:
      calculateListingReadinessGates(mappedFacts),
    draftPayloadBuilt:
      false,
    realDraftCreated:
      false,
    publishedToEbay:
      false,
  }
}

export function getBlockedRealProductListingGeneratorResponse() {
  return {
    readOnly:
      true,
    internalGeneratorOnly:
      true,
    productsRemainSourceOfTruth:
      true,
    listingUsesFactsByReference:
      true,
    productFactsDuplicatedAsTruth:
      false,
    productMutationAllowed:
      false,
    generatorCanGeneratePreview:
      true,
    generatorCanGenerateFinalContent:
      false,
    canBuildDraftPayload:
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
