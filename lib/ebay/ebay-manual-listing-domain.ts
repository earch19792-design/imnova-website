export type JsonRecord = Record<string, unknown>

export const EBAY_MANUAL_LISTING_CONNECTOR =
  "EBAY_SELL_INVENTORY_READONLY" as const

export const EBAY_MANUAL_LISTING_TRADING_CONNECTOR =
  "EBAY_TRADING_GET_ITEM_READONLY" as const

export const reusableListingDefaultFields = [
  "categoryId",
  "conditionId",
  "fulfillmentPolicyId",
  "paymentPolicyId",
  "returnPolicyId",
] as const

export type ReusableListingDefaultField =
  typeof reusableListingDefaultFields[number]

export type SafeListingDefaults = Partial<
  Record<ReusableListingDefaultField, string>
>

export type ManualListingRegistrationInput = {
  ebayItemId: string
  ebayUrl: string
  opportunityId: string | null
  candidateKey: string | null
  supplierSku: string | null
  supplierVariantId: string | null
  safeDefaults: SafeListingDefaults
}

export type ReadonlyListingEvidence = {
  id?: unknown
  source?: unknown
  account_key?: unknown
  ebay_item_id?: unknown
  listing_status?: unknown
  ebay_sku?: unknown
  last_ebay_sync_at?: unknown
  raw_payload?: unknown
}

export type ManualListingVerification = {
  status: "verified" | "pending_manual_verification"
  method:
    | "EBAY_TRADING_GET_ITEM_READONLY"
    | "EBAY_SELL_INVENTORY_READONLY"
    | "NOT_EXECUTED"
  reason: string
  connectorListingId: string | null
  connectorListingStatus: string | null
  connectorEbaySku: string | null
}

export function evaluateManualListingProductSkuIdentity(
  expectedEbaySku: unknown,
  observedEbaySku: unknown,
) {
  const expected = stringValue(expectedEbaySku)
  const observed = stringValue(observedEbaySku)
  if (!/^IMNOVA-[A-Z0-9]{16,32}$/.test(expected)) {
    return {
      verified: false as const,
      reason: "EBAY_CANONICAL_LISTING_PACKAGE_REQUIRED" as const,
    }
  }
  if (!observed) {
    return {
      verified: false as const,
      reason: "EBAY_ITEM_CUSTOM_LABEL_REQUIRED" as const,
    }
  }
  if (observed !== expected) {
    return {
      verified: false as const,
      reason: "EBAY_ITEM_CUSTOM_LABEL_MISMATCH" as const,
    }
  }
  return {
    verified: true as const,
    reason: "PRODUCT_SKU_IDENTITY_CONFIRMED" as const,
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function boundedText(
  value: unknown,
  maximumLength: number,
  errorCode: string,
) {
  const normalized = stringValue(value)
  if (!normalized) return null
  if (
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(errorCode)
  }
  return normalized
}

function uuidOrNull(value: unknown) {
  const normalized = stringValue(value)
  if (!normalized) return null
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(normalized)
  ) {
    throw new Error("MANUAL_LISTING_OPPORTUNITY_ID_INVALID")
  }
  return normalized
}

export function normalizeEbayItemId(value: unknown) {
  const normalized = stringValue(value)
  if (!/^\d{9,20}$/.test(normalized)) {
    throw new Error("MANUAL_LISTING_ITEM_ID_INVALID")
  }
  return normalized
}

export function normalizeManualListingUrl(
  ebayItemId: string,
  value: unknown,
) {
  const submitted = stringValue(value)
  const canonical = `https://www.ebay.com/itm/${ebayItemId}`
  if (!submitted) return canonical

  let parsed: URL
  try {
    parsed = new URL(submitted)
  } catch {
    throw new Error("MANUAL_LISTING_URL_INVALID")
  }

  const officialHost =
    parsed.hostname === "ebay.com" ||
    parsed.hostname.endsWith(".ebay.com")
  if (
    parsed.protocol !== "https:" ||
    !officialHost ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new Error("MANUAL_LISTING_URL_INVALID")
  }

  const identifiers = [
    ...parsed.pathname.split(/[^0-9]+/),
    parsed.searchParams.get("item") ?? "",
    parsed.searchParams.get("itemId") ?? "",
  ].filter((entry) => /^\d{9,20}$/.test(entry))

  if (!identifiers.includes(ebayItemId)) {
    throw new Error("MANUAL_LISTING_URL_ITEM_MISMATCH")
  }

  return canonical
}

function safeIdentifier(
  value: unknown,
  errorCode: string,
  maximumLength = 80,
) {
  const normalized = stringValue(value)
  if (!normalized) return null
  if (
    normalized.length > maximumLength ||
    !/^[A-Za-z0-9._:-]+$/.test(normalized)
  ) {
    throw new Error(errorCode)
  }
  return normalized
}

export function parseSafeListingDefaults(value: unknown): SafeListingDefaults {
  const input = record(value)
  const allowed = new Set<string>(reusableListingDefaultFields)
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error("MANUAL_LISTING_UNSAFE_DEFAULT_FIELD")
  }

  const output: SafeListingDefaults = {}
  const identifiers: Array<[
    ReusableListingDefaultField,
    string,
    number?,
  ]> = [
    ["fulfillmentPolicyId", "MANUAL_LISTING_FULFILLMENT_POLICY_INVALID"],
    ["paymentPolicyId", "MANUAL_LISTING_PAYMENT_POLICY_INVALID"],
    ["returnPolicyId", "MANUAL_LISTING_RETURN_POLICY_INVALID"],
  ]
  for (const [key, errorCode, maximumLength] of identifiers) {
    const normalized = safeIdentifier(input[key], errorCode, maximumLength)
    if (normalized) output[key] = normalized
  }

  const conditionId = stringValue(input.conditionId)
  if (conditionId) {
    if (!/^\d{1,12}$/.test(conditionId)) {
      throw new Error("MANUAL_LISTING_CONDITION_ID_INVALID")
    }
    output.conditionId = conditionId
  }

  const categoryId = stringValue(input.categoryId)
  if (categoryId) {
    if (!/^\d{1,20}$/.test(categoryId)) {
      throw new Error("MANUAL_LISTING_CATEGORY_ID_INVALID")
    }
    output.categoryId = categoryId
  }

  return output
}

export function parseManualListingRegistrationInput(
  value: unknown,
): ManualListingRegistrationInput {
  const input = record(value)
  const ebayItemId = normalizeEbayItemId(
    input.ebayItemId ?? input.itemId,
  )
  const opportunityId = uuidOrNull(input.opportunityId)
  const candidateKey = boundedText(
    input.candidateKey,
    300,
    "MANUAL_LISTING_CANDIDATE_KEY_INVALID",
  )
  if (!opportunityId && !candidateKey) {
    throw new Error("MANUAL_LISTING_CANDIDATE_REQUIRED")
  }

  return {
    ebayItemId,
    ebayUrl: normalizeManualListingUrl(
      ebayItemId,
      input.ebayUrl ?? input.listingUrl,
    ),
    opportunityId,
    candidateKey,
    supplierSku: boundedText(
      input.supplierSku,
      100,
      "MANUAL_LISTING_SUPPLIER_SKU_INVALID",
    ),
    supplierVariantId: boundedText(
      input.supplierVariantId,
      160,
      "MANUAL_LISTING_SUPPLIER_VARIANT_INVALID",
    ),
    safeDefaults: parseSafeListingDefaults(input.safeDefaults),
  }
}

function evidenceText(value: unknown, maximumLength = 160) {
  const normalized = stringValue(value)
  return normalized && normalized.length <= maximumLength
    ? normalized
    : null
}

export function evaluateReadonlyListingOwnership(
  listings: ReadonlyListingEvidence[],
  input: {
    ebayItemId: string
    accountKey: string
    connectorConfigured: boolean
    connectorAttempted: boolean
    connectorError?: boolean
  },
): ManualListingVerification {
  if (!input.connectorConfigured) {
    return {
      status: "pending_manual_verification",
      method: "NOT_EXECUTED",
      reason: "EBAY_READONLY_CONNECTOR_NOT_CONFIGURED",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
    }
  }

  if (input.connectorError || !input.connectorAttempted) {
    return {
      status: "pending_manual_verification",
      method: EBAY_MANUAL_LISTING_CONNECTOR,
      reason: "EBAY_READONLY_VERIFICATION_UNAVAILABLE",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
    }
  }

  const ownedListing = listings.find((listing) => {
    const status = evidenceText(listing.listing_status)?.toLowerCase()
    return (
      evidenceText(listing.source) === EBAY_MANUAL_LISTING_CONNECTOR &&
      evidenceText(listing.account_key) === input.accountKey &&
      evidenceText(listing.ebay_item_id) === input.ebayItemId &&
      (status === "active" || status === "paused") &&
      Boolean(evidenceText(listing.id))
    )
  })

  if (!ownedListing) {
    return {
      status: "pending_manual_verification",
      method: EBAY_MANUAL_LISTING_CONNECTOR,
      reason: "EBAY_ITEM_NOT_CONFIRMED_IN_OFFICIAL_ACCOUNT",
      connectorListingId: null,
      connectorListingStatus: null,
      connectorEbaySku: null,
    }
  }

  return {
    status: "verified",
    method: EBAY_MANUAL_LISTING_CONNECTOR,
    reason: "OWNERSHIP_CONFIRMED_READONLY",
    connectorListingId: evidenceText(ownedListing.id),
    connectorListingStatus:
      evidenceText(ownedListing.listing_status)?.toLowerCase() ?? null,
    connectorEbaySku: evidenceText(ownedListing.ebay_sku, 100),
  }
}

export function safeDefaultsTemplateKey(
  safeDefaults: SafeListingDefaults,
) {
  return [
    "EBAY_US",
    safeDefaults.categoryId || "all-categories",
    safeDefaults.conditionId || "all-conditions",
  ].join(":")
}

export function safeDefaultsTemplatePriorityKeys(
  categoryId: unknown,
  conditionId?: unknown,
) {
  const normalized = parseSafeListingDefaults({
    categoryId,
    conditionId,
  })
  if (!normalized.categoryId) {
    throw new Error("MANUAL_LISTING_CATEGORY_ID_REQUIRED")
  }
  return [...new Set([
    ...(normalized.conditionId
      ? [`EBAY_US:${normalized.categoryId}:${normalized.conditionId}`]
      : []),
    `EBAY_US:${normalized.categoryId}:all-conditions`,
    ...(normalized.conditionId
      ? [`EBAY_US:all-categories:${normalized.conditionId}`]
      : []),
    "EBAY_US:all-categories:all-conditions",
  ])]
}

export function hasReusableListingDefaults(
  safeDefaults: SafeListingDefaults,
) {
  return Object.keys(safeDefaults).length > 0
}
