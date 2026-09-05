export type EbayPublisherReadbackResourceV1 = "OFFER" | "INVENTORY_ITEM"

export type EbayPublisherMismatchClassificationV1 =
  | "MATERIAL_MISMATCH"
  | "EBAY_CANONICALIZATION_EQUIVALENT"
  | "OPTIONAL_EMPTY_OMITTED"
  | "ORDERING_ONLY"
  | "DEFAULT_VALUE_INSERTED_BY_EBAY"
  | "NULL_VS_ABSENT"
  | "NUMERIC_NORMALIZATION"
  | "STRING_NORMALIZATION"

export type EbayPublisherReadbackDifferenceV1 = Readonly<{
  path: string
  classification: EbayPublisherMismatchClassificationV1
  material: boolean
}>

export type EbayPublisherReadbackComparisonV1 = Readonly<{
  contractVersion: "EBAY_PUBLISHER_SEMANTIC_READBACK_V1"
  equivalent: boolean
  materialMismatchFields: readonly string[]
  differences: readonly EbayPublisherReadbackDifferenceV1[]
  normalizationRulesApplied: readonly EbayPublisherMismatchClassificationV1[]
  materialFieldsFailClosed: true
}>

const MAX_DIFFERENCES = 40
const ABSENT = Symbol("EBAY_READBACK_ABSENT")

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isEmptyAuthorizedValue(value: unknown) {
  return value === null
    || value === ""
    || (Array.isArray(value) && value.length === 0)
    || (isRecord(value) && Object.keys(value).length === 0)
}

function semanticCanonicalJsonV1(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(semanticCanonicalJsonV1).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${semanticCanonicalJsonV1(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function numericPath(path: string) {
  return /(?:^|\.)(?:availableQuantity|quantity|value|weight|width|length|height)$/.test(path)
}

function unorderedArrayPath(path: string) {
  return /^\$\.product\.(?:aspects\.[^.]+|upc|ean|isbn)$/.test(path)
}

function materialContainerPath(path: string) {
  return path === "$.listingPolicies"
    || path === "$.pricingSummary"
    || path === "$.tax"
    || path === "$.product.aspects"
    || path === "$.packageWeightAndSize"
}

function serverManagedExtraPath(
  resource: EbayPublisherReadbackResourceV1,
  path: string,
  value: unknown,
) {
  if (resource === "OFFER") {
    if ([
      "$.offerId",
      "$.status",
      "$.listing",
      "$.listingId",
      "$.listingStartDate",
    ].includes(path)) return true
    if (path === "$.listingDuration") return value === "GTC"
    if (path === "$.includeCatalogProductDetails") return value === false
    return false
  }
  return ["$.sku", "$.locale"].includes(path)
}

function materialExtraPath(
  resource: EbayPublisherReadbackResourceV1,
  path: string,
) {
  if (resource === "OFFER") {
    return [
      "$.sku",
      "$.marketplaceId",
      "$.format",
      "$.availableQuantity",
      "$.categoryId",
      "$.merchantLocationKey",
      "$.listingPolicies",
      "$.pricingSummary",
      "$.tax",
      "$.listingDescription",
    ].some((prefix) => path === prefix || path.startsWith(`${prefix}.`))
  }
  return [
    "$.availability",
    "$.condition",
    "$.conditionDescription",
    "$.packageWeightAndSize",
    "$.product",
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}.`))
}

function decimalEquivalent(actual: unknown, expected: unknown) {
  if (typeof actual !== "string" && typeof actual !== "number") return false
  if (typeof expected !== "string" && typeof expected !== "number") return false
  const left = Number(actual)
  const right = Number(expected)
  return Number.isFinite(left) && Number.isFinite(right) && left === right
}

export function compareEbayPublisherReadbackV1(
  actual: unknown,
  expected: unknown,
  resource: EbayPublisherReadbackResourceV1,
): EbayPublisherReadbackComparisonV1 {
  const differences: EbayPublisherReadbackDifferenceV1[] = []

  function add(
    path: string,
    classification: EbayPublisherMismatchClassificationV1,
    material: boolean,
  ) {
    if (differences.length >= MAX_DIFFERENCES) return
    differences.push({ path, classification, material })
  }

  function visit(actualValue: unknown | typeof ABSENT, expectedValue: unknown, path: string) {
    if (actualValue === ABSENT) {
      if (isEmptyAuthorizedValue(expectedValue)) {
        add(
          path,
          expectedValue === null ? "NULL_VS_ABSENT" : "OPTIONAL_EMPTY_OMITTED",
          false,
        )
      } else {
        add(path, "MATERIAL_MISMATCH", true)
      }
      return
    }

    if (expectedValue === null && actualValue === undefined) {
      add(path, "NULL_VS_ABSENT", false)
      return
    }

    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue)) {
        add(path, "MATERIAL_MISMATCH", true)
        return
      }
      if (unorderedArrayPath(path)) {
        const left = actualValue.map(semanticCanonicalJsonV1).sort()
        const right = expectedValue.map(semanticCanonicalJsonV1).sort()
        if (semanticCanonicalJsonV1(left) === semanticCanonicalJsonV1(right)) {
          if (semanticCanonicalJsonV1(actualValue) !== semanticCanonicalJsonV1(expectedValue)) {
            add(path, "ORDERING_ONLY", false)
          }
          return
        }
      }
      if (actualValue.length !== expectedValue.length) {
        add(`${path}.length`, "MATERIAL_MISMATCH", true)
      }
      expectedValue.forEach((entry, index) => {
        visit(index < actualValue.length ? actualValue[index] : ABSENT, entry, `${path}[${index}]`)
      })
      return
    }

    if (isRecord(expectedValue)) {
      if (!isRecord(actualValue)) {
        add(path, "MATERIAL_MISMATCH", true)
        return
      }
      for (const [key, entry] of Object.entries(expectedValue)) {
        visit(hasOwn(actualValue, key) ? actualValue[key] : ABSENT, entry, `${path}.${key}`)
      }
      for (const key of Object.keys(actualValue)) {
        if (hasOwn(expectedValue, key)) continue
        const extraPath = `${path}.${key}`
        if (serverManagedExtraPath(resource, extraPath, actualValue[key])) {
          add(extraPath, "DEFAULT_VALUE_INSERTED_BY_EBAY", false)
        } else if (materialContainerPath(path)
          || materialExtraPath(resource, extraPath)) {
          add(extraPath, "MATERIAL_MISMATCH", true)
        }
      }
      return
    }

    if (actualValue === expectedValue) return
    if (numericPath(path) && decimalEquivalent(actualValue, expectedValue)) {
      add(path, "NUMERIC_NORMALIZATION", false)
      return
    }
    if (
      typeof actualValue === "string"
      && typeof expectedValue === "string"
      && actualValue.trim() === expectedValue.trim()
    ) {
      add(path, "STRING_NORMALIZATION", false)
      return
    }
    add(path, "MATERIAL_MISMATCH", true)
  }

  visit(actual, expected, "$")
  const materialMismatchFields = [...new Set(
    differences.filter((difference) => difference.material).map((difference) => difference.path),
  )]
  const normalizationRulesApplied = [...new Set(
    differences
      .filter((difference) => !difference.material)
      .map((difference) => difference.classification),
  )]
  return Object.freeze({
    contractVersion: "EBAY_PUBLISHER_SEMANTIC_READBACK_V1",
    equivalent: materialMismatchFields.length === 0,
    materialMismatchFields: Object.freeze(materialMismatchFields),
    differences: Object.freeze(differences),
    normalizationRulesApplied: Object.freeze(normalizationRulesApplied),
    materialFieldsFailClosed: true as const,
  })
}

export function compareEbayOfferReadbackV1(actual: unknown, expected: unknown) {
  return compareEbayPublisherReadbackV1(actual, expected, "OFFER")
}

export function compareEbayInventoryItemReadbackV1(actual: unknown, expected: unknown) {
  return compareEbayPublisherReadbackV1(actual, expected, "INVENTORY_ITEM")
}
