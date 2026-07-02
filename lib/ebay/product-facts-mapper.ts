type ProductRecord = Record<string, unknown>

type ListingFact = {
  factId: string
  sourceField: string
  value: string
  confirmed: true
}

type MappedListingFacts = {
  mappingMode: "SELECTED_PRODUCT_FACTS_BY_REFERENCE"
  productFactsDuplicatedAsTruth: false
  productReferenceId: string | null
  slug: string | null
  productName: string | null
  productType: string | null
  confirmedFacts: ListingFact[]
  confirmedFactIds: string[]
  missingFacts: string[]
}

const factFieldAliases: Record<string, string[]> = {
  product_id: [
    "product_id",
    "id",
  ],
  slug: [
    "slug",
  ],
  product_name: [
    "product_name",
    "name",
    "title",
  ],
  product_type: [
    "product_type",
    "type",
    "category",
  ],
  description: [
    "description",
    "short_description",
  ],
  status: [
    "status",
    "state",
  ],
  supplier: [
    "supplier",
    "supplier_name",
    "source",
  ],
  supplier_sku: [
    "supplier_sku",
    "sku",
  ],
  condition: [
    "condition",
  ],
  package_quantity: [
    "package_quantity",
    "quantity",
  ],
  dimensions: [
    "dimensions",
  ],
  weight: [
    "weight",
  ],
  material: [
    "material",
  ],
  color: [
    "color",
  ],
  brand: [
    "brand",
  ],
  model: [
    "model",
  ],
  mpn: [
    "mpn",
  ],
  stock_status: [
    "stock_status",
  ],
  cost: [
    "cost",
  ],
  image_status: [
    "image_status",
  ],
  commercial_readiness_status: [
    "commercial_readiness_status",
  ],
  compliance_status: [
    "compliance_status",
  ],
}

const requiredPreviewFacts = [
  "product_name",
]

const finalListingFacts = [
  "condition",
  "package_quantity",
  "brand",
  "model",
  "mpn",
  "dimensions",
  "weight",
  "material",
  "color",
  "stock_status",
  "cost",
  "image_status",
  "commercial_readiness_status",
  "compliance_status",
]

const blockedFieldIds = [
  "condition",
  "package_quantity",
  "brand",
  "model",
  "mpn",
  "dimensions",
  "weight",
  "material",
  "color",
  "compatibility",
  "warranty",
  "certifications",
  "performance_claims",
  "image_package",
  "price",
  "shipping_policy",
  "return_policy",
  "draft_payload",
  "ebay_draft_creation",
  "ebay_publication",
]

function asRecord(value: unknown): ProductRecord {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as ProductRecord
  }

  return {}
}

function normalizeValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed =
      value.trim()

    return trimmed.length > 0
      ? trimmed
      : null
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return String(value)
  }

  if (typeof value === "boolean") {
    return String(value)
  }

  return null
}

function readFact(
  record: ProductRecord,
  factId: string
): ListingFact | null {
  const aliases =
    factFieldAliases[factId] ?? []

  for (const sourceField of aliases) {
    const value =
      normalizeValue(record[sourceField])

    if (value) {
      return {
        factId,
        sourceField,
        value,
        confirmed:
          true,
      }
    }
  }

  return null
}

function toMappedFacts(value: unknown): MappedListingFacts {
  const record =
    asRecord(value)

  if (
    Array.isArray(
      (record as { confirmedFacts?: unknown }).confirmedFacts
    )
  ) {
    return value as MappedListingFacts
  }

  return mapProductToListingFacts(record)
}

function getFactValue(
  mappedFacts: MappedListingFacts,
  factId: string
): string | null {
  return (
    mappedFacts.confirmedFacts.find((fact) => fact.factId === factId)
      ?.value ?? null
  )
}

export function mapProductToListingFacts(product: unknown): MappedListingFacts {
  const record =
    asRecord(product)

  const confirmedFacts =
    Object.keys(factFieldAliases)
      .map((factId) => readFact(record, factId))
      .filter((fact): fact is ListingFact => Boolean(fact))

  const confirmedFactIds =
    confirmedFacts.map((fact) => fact.factId)

  const missingFacts =
    [
      ...requiredPreviewFacts,
      ...finalListingFacts,
    ].filter((factId) => !confirmedFactIds.includes(factId))

  return {
    mappingMode:
      "SELECTED_PRODUCT_FACTS_BY_REFERENCE",
    productFactsDuplicatedAsTruth:
      false,
    productReferenceId:
      confirmedFacts.find((fact) => fact.factId === "product_id")?.value ??
      null,
    slug:
      confirmedFacts.find((fact) => fact.factId === "slug")?.value ?? null,
    productName:
      confirmedFacts.find((fact) => fact.factId === "product_name")
        ?.value ?? null,
    productType:
      confirmedFacts.find((fact) => fact.factId === "product_type")
        ?.value ?? null,
    confirmedFacts,
    confirmedFactIds,
    missingFacts,
  }
}

export function generateListingPreviewFromProductFacts(mappedFacts: unknown) {
  const facts =
    toMappedFacts(mappedFacts)

  const titleParts =
    [
      getFactValue(facts, "product_name"),
      getFactValue(facts, "condition"),
      getFactValue(facts, "package_quantity"),
    ].filter((value): value is string => Boolean(value))

  const titlePreview =
    titleParts.join(", ")

  const keywordSeeds =
    [
      getFactValue(facts, "product_name"),
      getFactValue(facts, "product_type"),
    ].filter((value): value is string => Boolean(value))

  return {
    previewGenerated:
      Boolean(facts.productName),
    previewMode:
      "GENERATED_FROM_SELECTED_PRODUCT_CONFIRMED_FACTS",
    publishable:
      false,
    finalContentGenerated:
      false,
    titlePreview,
    titleGeneration: {
      status:
        "GENERATED_PREVIEW_FROM_CONFIRMED_FACTS_ONLY",
      value:
        titlePreview,
      maxRecommendedCharacters:
        80,
      blockedTermsNotUsed: [
        "waterproof",
        "heavy duty",
        "certified",
        "warranty",
        "exact dimensions",
        "brand names",
      ],
    },
    keywordPlan: {
      status:
        "BASIC_PRODUCT_FACT_KEYWORDS_ONLY",
      coreKeywords:
        keywordSeeds,
      benchmarkKeywordsUsed:
        false,
      competitorContentCopied:
        false,
    },
    descriptionPreview: {
      status:
        "LIMITED_PREVIEW_NOT_FINAL",
      text:
        facts.productName
          ? `Preview generated from confirmed product fact: ${facts.productName}.`
          : "",
      rule:
        "Only confirmed product facts can appear in preview copy.",
    },
    itemSpecificsPreview: {
      status:
        "PARTIAL_PREVIEW_NOT_FINAL",
      specifics:
        facts.confirmedFacts.map((fact) => ({
          name:
            fact.factId,
          value:
            fact.value,
          source:
            "products_reference",
          final:
            false,
        })),
      rule:
        "Only confirmed item specifics can appear.",
    },
    blockedPreviewSections: [
      "price",
      "shipping",
      "returns",
      "draft_payload",
      "ebay_draft_creation",
      "publication",
    ],
  }
}

export function calculateListingReadinessGates(mappedFacts: unknown) {
  const facts =
    toMappedFacts(mappedFacts)

  const hasAny = (factIds: string[]) =>
    factIds.some((factId) => facts.confirmedFactIds.includes(factId))

  const readinessScore =
    (hasAny([
      "product_id",
      "slug",
      "product_name",
      "condition",
      "package_quantity",
    ])
      ? 20
      : 0) +
    (hasAny([
      "cost",
      "commercial_readiness_status",
    ])
      ? 20
      : 0) +
    (hasAny([
      "dimensions",
      "weight",
      "stock_status",
    ])
      ? 20
      : 0) +
    (hasAny([
      "image_status",
    ])
      ? 15
      : 0) +
    (hasAny([
      "compliance_status",
    ])
      ? 15
      : 0)

  return {
    canReadSelectedProduct:
      true,
    canMapProductFacts:
      true,
    canGenerateListingPreview:
      Boolean(facts.productName),
    canGenerateFinalListingContent:
      false,
    canBuildDraftPayload:
      false,
    canCreateEbayDraft:
      false,
    canPublishToEbay:
      false,
    readinessScore,
    minimumRequiredForDraftPayload:
      80,
    minimumRequiredForPublication:
      95,
    currentReadinessLabel:
      "Preview only. Draft and publication blocked.",
  }
}

export function getMissingProductFacts(mappedFacts: unknown) {
  return toMappedFacts(mappedFacts).missingFacts
}

export function getBlockedListingFields(mappedFacts: unknown) {
  const facts =
    toMappedFacts(mappedFacts)

  return blockedFieldIds
    .filter((fieldId) => !facts.confirmedFactIds.includes(fieldId))
    .map((fieldId) => ({
      field:
        fieldId,
      status:
        "BLOCKED_UNTIL_CONFIRMED",
      usedInPreview:
        false,
      reason:
        "Products must confirm this fact before Listing can use it.",
    }))
}
