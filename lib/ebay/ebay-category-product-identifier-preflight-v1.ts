export const EBAY_CATEGORY_PRODUCT_IDENTIFIER_PREFLIGHT_V1 =
  "EBAY_CATEGORY_PRODUCT_IDENTIFIER_PREFLIGHT_V1" as const

type IdentifierJsonRecord = Record<string, unknown>

export type EbayProductIdentifierKindV1 = "UPC" | "EAN" | "ISBN"

export type EbayProductIdentifierSupportV1 =
  | "REQUIRED"
  | "SUPPORTED"
  | "NOT_SUPPORTED"
  | "UNPROVEN"

type IdentifierPolicyV1 = {
  identifier: EbayProductIdentifierKindV1
  support: EbayProductIdentifierSupportV1
  present: boolean
  valueCount: number
}

function identifierRecord(value: unknown): IdentifierJsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as IdentifierJsonRecord
    : {}
}

function identifierText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function identifierSupport(value: unknown): EbayProductIdentifierSupportV1 {
  const normalized = identifierText(value).toUpperCase()
  if (normalized === "REQUIRED") return "REQUIRED"
  if (["ENABLED", "SUPPORTED", "OPTIONAL"].includes(normalized)) {
    return "SUPPORTED"
  }
  if (["DISABLED", "NOT_SUPPORTED"].includes(normalized)) {
    return "NOT_SUPPORTED"
  }
  return "UNPROVEN"
}

function identifierValues(product: IdentifierJsonRecord, field: string) {
  const value = product[field]
  if (Array.isArray(value)) {
    return value.map(identifierText).filter(Boolean)
  }
  const scalar = identifierText(value)
  return scalar ? [scalar] : []
}

export function evaluateEbayCategoryProductIdentifierPreflightV1(input: {
  marketplaceId: unknown
  categoryId: unknown
  policyResponse: unknown
  inventoryItemPayload: unknown
}) {
  const marketplaceId = identifierText(input.marketplaceId).toUpperCase()
  const categoryId = identifierText(input.categoryId)
  const response = identifierRecord(input.policyResponse)
  const policies = Array.isArray(response.categoryPolicies)
    ? response.categoryPolicies.map(identifierRecord)
    : []
  const exactPolicies = policies.filter((policy) =>
    identifierText(policy.categoryId) === categoryId)
  const exactPolicy = exactPolicies.length === 1 ? exactPolicies[0] : null
  const validIdentity = marketplaceId === "EBAY_US"
    && /^\d{1,12}$/.test(categoryId)
  if (!validIdentity || !exactPolicy) {
    return {
      version: EBAY_CATEGORY_PRODUCT_IDENTIFIER_PREFLIGHT_V1,
      safe: false,
      marketplaceId,
      categoryId,
      exactPolicyFound: false,
      policies: [] as IdentifierPolicyV1[],
      missingRequiredIdentifiers: [] as EbayProductIdentifierKindV1[],
      blocker: validIdentity
        ? "EBAY_CATEGORY_PRODUCT_IDENTIFIER_POLICY_UNAVAILABLE"
        : "EBAY_CATEGORY_PRODUCT_IDENTIFIER_PREFLIGHT_IDENTITY_INVALID",
      source: "EBAY_METADATA_GET_CATEGORY_POLICIES_READONLY",
    }
  }

  const product = identifierRecord(
    identifierRecord(input.inventoryItemPayload).product,
  )
  const specs = [
    ["UPC", "upc", "upcSupport"],
    ["EAN", "ean", "eanSupport"],
    ["ISBN", "isbn", "isbnSupport"],
  ] as const
  const identifierPolicies: IdentifierPolicyV1[] = specs.map(
    ([identifier, field, supportField]) => {
      const values = identifierValues(product, field)
      return {
        identifier,
        support: identifierSupport(exactPolicy[supportField]),
        present: values.length > 0,
        valueCount: values.length,
      }
    },
  )
  const policyIncomplete = identifierPolicies.some((entry) =>
    entry.support === "UNPROVEN")
  const missingRequiredIdentifiers = identifierPolicies
    .filter((entry) => entry.support === "REQUIRED" && !entry.present)
    .map((entry) => entry.identifier)
  const blocker = policyIncomplete
    ? "EBAY_CATEGORY_PRODUCT_IDENTIFIER_POLICY_UNAVAILABLE"
    : missingRequiredIdentifiers.length > 0
      ? `EBAY_CATEGORY_REQUIRED_${missingRequiredIdentifiers.join("_")}_MISSING`
      : null

  return {
    version: EBAY_CATEGORY_PRODUCT_IDENTIFIER_PREFLIGHT_V1,
    safe: blocker === null,
    marketplaceId,
    categoryId,
    exactPolicyFound: true,
    policies: identifierPolicies,
    missingRequiredIdentifiers,
    blocker,
    source: "EBAY_METADATA_GET_CATEGORY_POLICIES_READONLY",
  }
}
