import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
} from "./ebay-seller-account-scope"
import { parseSafeEbayInventoryErrorMetadata } from
  "./ebay-commercial-monitor-live-readonly-domain"

export const SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1 =
  "SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1_2026_08_23" as const
export const REVERSIBLE_OOS_TARGET_ITEM_ID = "366569086086" as const
export const REVERSIBLE_OOS_TARGET_SKU = "IMN-LST-000001" as const

const EBAY_ORIGIN = "https://api.ebay.com"
const TOKEN_ENDPOINT = `${EBAY_ORIGIN}/identity/v1/oauth2/token`
const TRADING_ENDPOINT = `${EBAY_ORIGIN}/ws/api.dll`
const INVENTORY_ITEM_ENDPOINT = `${EBAY_ORIGIN}/sell/inventory/v1/inventory_item`
const INVENTORY_OFFER_ENDPOINT = `${EBAY_ORIGIN}/sell/inventory/v1/offer`
const INVENTORY_LOCATION_ENDPOINT = `${EBAY_ORIGIN}/sell/inventory/v1/location`
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const INVENTORY_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly"
const MAX_XML_BYTES = 64 * 1024
const MAX_JSON_BYTES = 128 * 1024
const REQUEST_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch

type AuthorizedPublication = Readonly<{
  listingId: string
  sku: string
  offerId: string
}> | null

export type ReversibleOosListingManagementModel =
  | "TRADING_FIXED_PRICE"
  | "INVENTORY_API_MANAGED"
  | "OTHER"
  | "UNPROVEN"

type ExactInventoryEvidence = boolean | "UNPROVEN"

type ExactInventorySafeErrorClass =
  | "NONE"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "AUTHORIZATION"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "RESPONSE_INVALID"
  | "OTHER"

type Live25709FieldNameClass =
  | "PATH_SKU"
  | "QUERY_PARAMETER"
  | "AUTHORIZATION_HEADER"
  | "ACCEPT_HEADER"
  | "CONTENT_TYPE_HEADER"
  | "CONTENT_LANGUAGE_HEADER"
  | "MARKETPLACE_HEADER"
  | "HTTP_METHOD"
  | "API_PATH"
  | "OTHER"
  | "UNPROVEN"

type Live25709InvalidValueClass =
  | "MISSING"
  | "EMPTY"
  | "FORMAT"
  | "ENCODING"
  | "UNSUPPORTED"
  | "OUT_OF_RANGE"
  | "OTHER"
  | "UNPROVEN"

type Live25709MessageTemplateClass =
  | "INVALID_VALUE_FOR_SUBSTITUTED_FIELD"
  | "INVALID_VALUE_FOR_LITERAL_PLACEHOLDER"
  | "OTHER"
  | "NO_MESSAGE"

type InventoryBoundaryClass =
  | "INVENTORY_ITEM_SURFACE_SPECIFIC"
  | "COMMON_INVENTORY_API_BOUNDARY"
  | "AUTHORIZATION_OR_ACCOUNT_ACCESS"
  | "OTHER_PROVEN_CLASS"
  | "UNPROVEN"

type Live25709Metadata = Readonly<{
  domain: string
  category: string
  parameterNames: string[]
  fieldNameClass: Live25709FieldNameClass
  invalidValueClass: Live25709InvalidValueClass
  messageTemplateClass: Live25709MessageTemplateClass
}>

const UNPROVEN_25709_METADATA: Live25709Metadata = Object.freeze({
  domain: "UNPROVEN",
  category: "UNPROVEN",
  parameterNames: [],
  fieldNameClass: "UNPROVEN",
  invalidValueClass: "UNPROVEN",
  messageTemplateClass: "NO_MESSAGE",
})

export type ReversibleOosModelPreflightV1 = Readonly<{
  contractVersion: typeof SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1
  target: { itemId: typeof REVERSIBLE_OOS_TARGET_ITEM_ID
    sku: typeof REVERSIBLE_OOS_TARGET_SKU }
  outOfStockControlReadAttempted: boolean
  outOfStockControl: boolean | "UNPROVEN"
  listingManagementModel: ReversibleOosListingManagementModel
  listingManagementModelProven: boolean
  managementEvidenceSource: string
  tradingItemReadAttempted: boolean
  tradingReadSuccess: boolean
  inventoryOfferLookupAttempted: boolean
  inventoryOfferExactMatch: boolean
  inventoryPublicationItemIdMatch: boolean
  inventoryLocationReadAttempted: boolean
  inventoryLocationHttpStatus: number | null
  inventoryLocationReadAccepted: boolean
  inventoryLocationErrorId: string | null
  inventoryLocationErrorDomain: string
  inventoryLocationErrorCategory: string
  inventoryBoundaryClass: InventoryBoundaryClass
  inventoryCommonRootCauseProven: boolean
  inventoryCommonRootCause: string
  exactSkuReadAttempted: boolean
  exactSkuReadHttpStatus: number | null
  exactSkuExists: ExactInventoryEvidence
  exactSkuErrorId: string | null
  exactSkuSafeErrorClass: ExactInventorySafeErrorClass
  exactSkuErrorDomain: string
  exactSkuErrorCategory: string
  exactSkuErrorParameterNames: string[]
  exactSkuFieldNameClass: Live25709FieldNameClass
  exactSkuInvalidValueClass: Live25709InvalidValueClass
  exactSkuMessageTemplateClass: Live25709MessageTemplateClass
  exactOfferLookupAttempted: boolean
  exactOfferFound: ExactInventoryEvidence
  exactPublicationItemIdMatch: ExactInventoryEvidence
  requestContractFixRequired: boolean
  reversibleQuantityZeroSemanticsProven: boolean
  reversibleRestoreSemanticsProven: boolean
  restoreRequiresFreshHealthyStock: true
  restoreRequiresPositiveSafeCapacity: true
  inStockWithoutSafeCapacityAutoRestoreAllowed: false
  preservesItemId: boolean
  targetReversibleProtectPossible: boolean
  listing: {
    itemIdMatch: boolean
    skuMatch: boolean
    sellerAccountMatch: boolean
    listingType: string | null
    listingDuration: string | null
    listingStatus: string | null
    inventoryTrackingMethod: string | null
    quantity: number | null
  }
  safety: {
    readOnly: true
    rawPayloadReturned: false
    credentialsReturned: false
    ebayWrites: 0
    databaseWrites: 0
    lunaWrites: 0
  }
  limitationCode: string | null
}>

function text(value: unknown, maximum = 200) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().slice(0, maximum)
    : ""
}

function nonNegativeInteger(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function tradingXmlTagValue(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)` +
      `<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "i",
  ))
  if (!match) return null
  const value = match[1].replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
  return value || null
}

function acceptedAck(xml: string) {
  return ["success", "warning"].includes(
    text(tradingXmlTagValue(xml, "Ack"), 20).toLowerCase(),
  )
}

async function boundedText(response: Response, maximum: number) {
  const declared = response.headers.get("content-length")
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw new Error("REVERSIBLE_OOS_RESPONSE_TOO_LARGE")
  }
  const value = await response.text()
  if (Buffer.byteLength(value, "utf8") > maximum) {
    throw new Error("REVERSIBLE_OOS_RESPONSE_TOO_LARGE")
  }
  return value
}

function generalCredentials(environment: NodeJS.ProcessEnv) {
  return {
    clientId: text(environment.EBAY_CLIENT_ID, 500),
    clientSecret: text(environment.EBAY_CLIENT_SECRET, 500),
    refreshToken: text(environment.EBAY_SELLER_REFRESH_TOKEN, 8_000),
  }
}

async function canonicalCommercialTradingAccessToken(fetchImpl: FetchLike) {
  const { getEbayCommercialOrdersAccessToken } = await import(
    "./ebay-commercial-oauth"
  )
  return getEbayCommercialOrdersAccessToken(fetchImpl)
}

async function mintToken(input: {
  credentials: ReturnType<typeof generalCredentials>
  scopes: string[]
  fetchImpl: FetchLike
}) {
  if (!input.credentials.clientId || !input.credentials.clientSecret ||
      !input.credentials.refreshToken) {
    throw new Error("REVERSIBLE_OOS_EBAY_CREDENTIALS_UNAVAILABLE")
  }
  const response = await input.fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${input.credentials.clientId}:${input.credentials.clientSecret}`,
        "utf8",
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.credentials.refreshToken,
      scope: input.scopes.join(" "),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = await boundedText(response, MAX_JSON_BYTES)
  let payload: Record<string, unknown> = {}
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new Error("REVERSIBLE_OOS_OAUTH_RESPONSE_INVALID")
  }
  const accessToken = text(payload.access_token, 8_000)
  if (!response.ok || !accessToken) {
    throw new Error(`REVERSIBLE_OOS_OAUTH_${response.status}`)
  }
  return accessToken
}

async function tradingRead(input: {
  callName: "GetUserPreferences" | "GetItem"
  body: string
  token: string
  fetchImpl: FetchLike
}) {
  const response = await input.fetchImpl(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": input.callName,
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": input.token,
    },
    body: input.body,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const xml = await boundedText(response, MAX_XML_BYTES)
  if (!response.ok || !acceptedAck(xml)) {
    throw new Error(`REVERSIBLE_OOS_${input.callName.toUpperCase()}_${response.status}`)
  }
  return xml
}

function getUserPreferencesXml() {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetUserPreferencesRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<ShowOutOfStockControlPreference>true</ShowOutOfStockControlPreference>" +
    "</GetUserPreferencesRequest>"
}

function getItemXml() {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${REVERSIBLE_OOS_TARGET_ITEM_ID}</ItemID>` +
    [
      "Item.ItemID",
      "Item.SKU",
      "Item.Seller.UserID",
      "Item.ListingType",
      "Item.ListingDuration",
      "Item.SellingStatus.ListingStatus",
      "Item.Quantity",
      "Item.InventoryTrackingMethod",
    ].map((selector) => `<OutputSelector>${selector}</OutputSelector>`).join("") +
    "</GetItemRequest>"
}

type ExactSkuReadResult = {
  attempted: boolean
  httpStatus: number | null
  exists: ExactInventoryEvidence
  authoritativeAbsence: boolean
  errorId: string | null
  safeErrorClass: ExactInventorySafeErrorClass
  errorMetadata: Live25709Metadata
  requestContractFixRequired: boolean
}

type ExactInventoryLookup = {
  attempted: boolean
  complete: boolean
  exactMatch: boolean
  exactOfferId: string | null
  itemIdMatch: boolean
  ambiguous: boolean
  httpStatus: number | null
  errorId: string | null
  safeErrorClass: ExactInventorySafeErrorClass
  requestContractFixRequired: boolean
  location: InventoryLocationReadResult
  exactSku: ExactSkuReadResult
}

type InventoryLocationReadResult = Readonly<{
  attempted: boolean
  httpStatus: number | null
  accepted: boolean
  errorId: string | null
  errorDomain: string
  errorCategory: string
}>

const UNPROVEN_LOCATION_READ: InventoryLocationReadResult = Object.freeze({
  attempted: false,
  httpStatus: null,
  accepted: false,
  errorId: null,
  errorDomain: "UNPROVEN",
  errorCategory: "UNPROVEN",
})

function errorId(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.errors)) return null
  for (const candidate of payload.errors) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue
    }
    const value = (candidate as Record<string, unknown>).errorId
    const normalized = typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === "string" && /^\d{1,12}$/.test(value.trim())
        ? value.trim()
        : null
    if (normalized) return normalized
  }
  return null
}

function inventoryErrorRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function fieldNameClass(value: unknown): Live25709FieldNameClass {
  if (typeof value !== "string") return "UNPROVEN"
  const normalized = value.normalize("NFKC").trim().toLowerCase()
  if (["sku", "inventory_item.sku", "inventoryitem.sku"].includes(normalized)) {
    return "PATH_SKU"
  }
  if (["limit", "offset", "query", "query-parameter"].includes(normalized)) {
    return "QUERY_PARAMETER"
  }
  if (normalized === "authorization") return "AUTHORIZATION_HEADER"
  if (normalized === "accept") return "ACCEPT_HEADER"
  if (normalized === "content-type") return "CONTENT_TYPE_HEADER"
  if (normalized === "content-language") return "CONTENT_LANGUAGE_HEADER"
  if (["x-ebay-c-marketplace-id", "marketplaceid", "marketplace-id"]
    .includes(normalized)) return "MARKETPLACE_HEADER"
  if (["method", "http-method"].includes(normalized)) return "HTTP_METHOD"
  if (["path", "api-path", "resource", "resource-uri"].includes(normalized)) {
    return "API_PATH"
  }
  return /^[a-z][a-z0-9_.-]{0,79}$/.test(normalized) ? "OTHER" : "UNPROVEN"
}

function sanitized25709Metadata(payload: Record<string, unknown>): Live25709Metadata {
  const safe = parseSafeEbayInventoryErrorMetadata(payload)
  if (safe.status !== "CLASSIFIED" || !safe.errorIds.includes("25709")) {
    return UNPROVEN_25709_METADATA
  }
  const allowlistedParameterNames = new Set([
    "sku", "field", "fieldname", "parameter", "parametername", "limit",
    "offset", "authorization", "accept", "content-type", "content-language",
    "x-ebay-c-marketplace-id", "method", "path",
  ])
  const parameterNames = safe.parameterNames.map((name) =>
    name.normalize("NFKC").trim().toLowerCase())
    .filter((name) => allowlistedParameterNames.has(name))
  const rawErrors = Array.isArray(payload.errors) ? payload.errors : []
  const error = rawErrors.map(inventoryErrorRecord).find((candidate) =>
    candidate?.errorId === 25709) ?? null
  const message = typeof error?.message === "string" && error.message.length <= 8_192
    ? error.message : null
  let classifiedField: Live25709FieldNameClass = "UNPROVEN"
  const substituted = message?.match(
    /^Invalid value for ([A-Za-z][A-Za-z0-9_.-]{0,79})\.$/,
  )
  if (substituted?.[1]) classifiedField = fieldNameClass(substituted[1])
  const parameters = Array.isArray(error?.parameters) ? error.parameters : []
  for (const rawParameter of parameters) {
    const parameter = inventoryErrorRecord(rawParameter)
    const name = typeof parameter?.name === "string"
      ? parameter.name.normalize("NFKC").trim().toLowerCase() : ""
    if (["field", "fieldname", "parameter", "parametername"].includes(name)) {
      const candidate = fieldNameClass(parameter?.value)
      if (candidate !== "UNPROVEN") classifiedField = candidate
    }
  }
  const messageTemplateClass: Live25709MessageTemplateClass = !message
    ? "NO_MESSAGE"
    : /^Invalid value for \{fieldName\}\.$/.test(message)
      ? "INVALID_VALUE_FOR_LITERAL_PLACEHOLDER"
      : substituted
        ? "INVALID_VALUE_FOR_SUBSTITUTED_FIELD"
        : "OTHER"
  return Object.freeze({
    domain: safe.domains.length === 1 ? safe.domains[0] ?? "UNPROVEN" : "UNPROVEN",
    category: safe.categories.length === 1
      ? safe.categories[0] ?? "UNPROVEN" : "UNPROVEN",
    parameterNames: [...new Set(parameterNames)].sort(),
    fieldNameClass: classifiedField,
    invalidValueClass: "UNPROVEN",
    messageTemplateClass,
  })
}

function safeErrorClass(status: number): ExactInventorySafeErrorClass {
  if (status >= 200 && status < 300) return "NONE"
  if (status === 400) return "INVALID_REQUEST"
  if (status === 401 || status === 403) return "AUTHORIZATION"
  if (status === 404) return "NOT_FOUND"
  if (status === 429) return "RATE_LIMITED"
  if (status >= 500) return "UPSTREAM_UNAVAILABLE"
  return "OTHER"
}

async function inventoryJson(response: Response) {
  const raw = await boundedText(response, MAX_JSON_BYTES)
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

async function exactInventoryItemRead(input: {
  token: string
  fetchImpl: FetchLike
}): Promise<ExactSkuReadResult> {
  const url = new URL(
    `${INVENTORY_ITEM_ENDPOINT}/${encodeURIComponent(REVERSIBLE_OOS_TARGET_SKU)}`,
  )
  const response = await input.fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.token}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await inventoryJson(response)
  const observedErrorId = payload ? errorId(payload) : null
  const errorMetadata = payload && observedErrorId === "25709"
    ? sanitized25709Metadata(payload) : UNPROVEN_25709_METADATA
  const classification = response.status === 404
    ? "NOT_FOUND" as const
    : payload === null ? "RESPONSE_INVALID" as const
      : safeErrorClass(response.status)
  const exactIdentity = response.ok && payload !== null &&
    text(payload.sku, 100) === REVERSIBLE_OOS_TARGET_SKU
  return {
    attempted: true,
    httpStatus: response.status,
    exists: exactIdentity ? true
      : response.status === 404 ? false : "UNPROVEN",
    authoritativeAbsence: response.status === 404,
    errorId: observedErrorId,
    safeErrorClass: classification,
    errorMetadata,
    requestContractFixRequired:
      response.status === 400 && observedErrorId === "25709",
  }
}

async function inventoryLocationRead(input: {
  token: string
  fetchImpl: FetchLike
}): Promise<InventoryLocationReadResult> {
  const response = await input.fetchImpl(INVENTORY_LOCATION_ENDPOINT, {
    method: "GET",
    headers: { Authorization: `Bearer ${input.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await inventoryJson(response)
  const metadata = payload
    ? parseSafeEbayInventoryErrorMetadata(payload)
    : parseSafeEbayInventoryErrorMetadata(null)
  return Object.freeze({
    attempted: true,
    httpStatus: response.status,
    accepted: response.ok,
    errorId: payload ? errorId(payload) : null,
    errorDomain: metadata.domains.length === 1
      ? metadata.domains[0] ?? "UNPROVEN" : "UNPROVEN",
    errorCategory: metadata.categories.length === 1
      ? metadata.categories[0] ?? "UNPROVEN" : "UNPROVEN",
  })
}

async function exactInventoryOfferLookup(input: {
  environment: NodeJS.ProcessEnv
  fetchImpl: FetchLike
}): Promise<ExactInventoryLookup> {
  const token = await mintToken({ credentials: generalCredentials(input.environment),
    scopes: [BASE_SCOPE, INVENTORY_READONLY_SCOPE], fetchImpl: input.fetchImpl })
  const location = await inventoryLocationRead({ token, fetchImpl: input.fetchImpl })
  const item = await exactInventoryItemRead({ token, fetchImpl: input.fetchImpl })
  if (item.exists !== true) {
    return {
      attempted: false,
      complete: item.authoritativeAbsence,
      exactMatch: false,
      exactOfferId: null,
      itemIdMatch: false,
      ambiguous: false,
      httpStatus: item.httpStatus,
      errorId: item.errorId,
      safeErrorClass: item.safeErrorClass,
      requestContractFixRequired: item.requestContractFixRequired,
      location,
      exactSku: item,
    }
  }
  const url = new URL(INVENTORY_OFFER_ENDPOINT)
  url.searchParams.set("sku", REVERSIBLE_OOS_TARGET_SKU)
  url.searchParams.set("limit", "100")
  const response = await input.fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await inventoryJson(response)
  const observedErrorId = payload ? errorId(payload) : null
  if (!response.ok || !payload || !Array.isArray(payload.offers)) {
    return {
      attempted: true,
      complete: false,
      exactMatch: false,
      exactOfferId: null,
      itemIdMatch: false,
      ambiguous: false,
      httpStatus: response.status,
      errorId: observedErrorId,
      safeErrorClass: payload ? safeErrorClass(response.status) : "RESPONSE_INVALID",
      requestContractFixRequired:
        response.status === 400 && observedErrorId === "25709",
      location,
      exactSku: item,
    }
  }
  const offers = payload.offers.filter((offer): offer is Record<string, unknown> =>
    Boolean(offer) && typeof offer === "object" && !Array.isArray(offer))
  const total = typeof payload.total === "number" &&
      Number.isSafeInteger(payload.total) && payload.total >= 0
    ? payload.total : null
  const complete = total !== null && total === offers.length &&
    !payload.next && offers.length <= 100
  const exact = offers.filter((offer) => {
    const listing = offer.listing && typeof offer.listing === "object" &&
        !Array.isArray(offer.listing)
      ? offer.listing as Record<string, unknown> : {}
    return text(offer.sku, 100) === REVERSIBLE_OOS_TARGET_SKU &&
      text(offer.marketplaceId, 40) === "EBAY_US" &&
      text(offer.status, 40).toUpperCase() === "PUBLISHED" &&
      text(listing.listingId, 20) === REVERSIBLE_OOS_TARGET_ITEM_ID
  })
  const exactOfferId = exact.length === 1
    ? text(exact[0]?.offerId, 100) || null : null
  return {
    attempted: true,
    complete,
    exactMatch: exact.length === 1 && Boolean(exactOfferId),
    exactOfferId,
    itemIdMatch: exact.length === 1,
    ambiguous: exact.length > 1,
    httpStatus: response.status,
    errorId: observedErrorId,
    safeErrorClass: "NONE",
    requestContractFixRequired: false,
    location,
    exactSku: item,
  }
}

function unavailable(limitationCode: string,
  partial: Partial<ReversibleOosModelPreflightV1> = {},
): ReversibleOosModelPreflightV1 {
  return Object.freeze({
    contractVersion: SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1,
    target: { itemId: REVERSIBLE_OOS_TARGET_ITEM_ID,
      sku: REVERSIBLE_OOS_TARGET_SKU },
    outOfStockControlReadAttempted: false,
    outOfStockControl: "UNPROVEN",
    listingManagementModel: "UNPROVEN",
    listingManagementModelProven: false,
    managementEvidenceSource: "UNPROVEN",
    tradingItemReadAttempted: false,
    tradingReadSuccess: false,
    inventoryOfferLookupAttempted: false,
    inventoryOfferExactMatch: false,
    inventoryPublicationItemIdMatch: false,
    inventoryLocationReadAttempted: false,
    inventoryLocationHttpStatus: null,
    inventoryLocationReadAccepted: false,
    inventoryLocationErrorId: null,
    inventoryLocationErrorDomain: "UNPROVEN",
    inventoryLocationErrorCategory: "UNPROVEN",
    inventoryBoundaryClass: "UNPROVEN",
    inventoryCommonRootCauseProven: false,
    inventoryCommonRootCause: "UNPROVEN",
    exactSkuReadAttempted: false,
    exactSkuReadHttpStatus: null,
    exactSkuExists: "UNPROVEN",
    exactSkuErrorId: null,
    exactSkuSafeErrorClass: "OTHER",
    exactSkuErrorDomain: "UNPROVEN",
    exactSkuErrorCategory: "UNPROVEN",
    exactSkuErrorParameterNames: [],
    exactSkuFieldNameClass: "UNPROVEN",
    exactSkuInvalidValueClass: "UNPROVEN",
    exactSkuMessageTemplateClass: "NO_MESSAGE",
    exactOfferLookupAttempted: false,
    exactOfferFound: "UNPROVEN",
    exactPublicationItemIdMatch: "UNPROVEN",
    requestContractFixRequired: false,
    reversibleQuantityZeroSemanticsProven: false,
    reversibleRestoreSemanticsProven: false,
    restoreRequiresFreshHealthyStock: true,
    restoreRequiresPositiveSafeCapacity: true,
    inStockWithoutSafeCapacityAutoRestoreAllowed: false,
    preservesItemId: false,
    targetReversibleProtectPossible: false,
    listing: { itemIdMatch: false, skuMatch: false,
      sellerAccountMatch: false, listingType: null, listingDuration: null,
      listingStatus: null, inventoryTrackingMethod: null, quantity: null },
    safety: { readOnly: true as const, rawPayloadReturned: false as const,
      credentialsReturned: false as const, ebayWrites: 0 as const,
      databaseWrites: 0 as const, lunaWrites: 0 as const },
    limitationCode,
    ...partial,
  })
}

export async function runVercelReversibleOosPreflightV1(input: Readonly<{
  authorizedPublication: AuthorizedPublication
  environment?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  tradingAccessTokenProvider?: (fetchImpl: FetchLike) => Promise<string>
}>): Promise<ReversibleOosModelPreflightV1> {
  const environment = input.environment ?? process.env
  const fetchImpl = input.fetchImpl ?? fetch
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  if (!identity.bound || !identity.consistent) {
    return unavailable("REVERSIBLE_OOS_ACCOUNT_BINDING_UNPROVEN")
  }
  let preferenceAttempted = false
  let tradingItemReadAttempted = false
  let outOfStockControl: boolean | "UNPROVEN" = "UNPROVEN"
  try {
    const tradingToken = await (
      input.tradingAccessTokenProvider ?? canonicalCommercialTradingAccessToken
    )(fetchImpl)
    preferenceAttempted = true
    const preferenceXml = await tradingRead({
      callName: "GetUserPreferences",
      body: getUserPreferencesXml(),
      token: tradingToken,
      fetchImpl,
    })
    const preference = text(tradingXmlTagValue(
      preferenceXml, "OutOfStockControlPreference",
    ), 10).toLowerCase()
    outOfStockControl = preference === "true" ? true
      : preference === "false" ? false : "UNPROVEN" as const
    tradingItemReadAttempted = true
    const itemXml = await tradingRead({ callName: "GetItem",
      body: getItemXml(), token: tradingToken, fetchImpl })
    const observedItemId = text(tradingXmlTagValue(itemXml, "ItemID"), 20)
    const observedSku = text(tradingXmlTagValue(itemXml, "SKU"), 100)
    const observedSeller = text(tradingXmlTagValue(itemXml, "UserID"), 200)
    const listingType = text(tradingXmlTagValue(itemXml, "ListingType"), 50) || null
    const listingDuration = text(
      tradingXmlTagValue(itemXml, "ListingDuration"), 50,
    ) || null
    const listingStatus = text(
      tradingXmlTagValue(itemXml, "ListingStatus"), 50,
    ) || null
    const inventoryTrackingMethod = text(
      tradingXmlTagValue(itemXml, "InventoryTrackingMethod"), 50,
    ) || "ItemID"
    const quantity = nonNegativeInteger(tradingXmlTagValue(itemXml, "Quantity"))
    const itemIdMatch = observedItemId === REVERSIBLE_OOS_TARGET_ITEM_ID
    const skuMatch = observedSku === REVERSIBLE_OOS_TARGET_SKU
    const sellerAccountMatch = Boolean(observedSeller) &&
      (!identity.expectedUserId || observedSeller.toLocaleLowerCase("en-US") ===
        identity.expectedUserId.toLocaleLowerCase("en-US")) &&
      ebayProductionAccountFingerprint(observedSeller) ===
        identity.expectedAccountFingerprint
    const tradingReadSuccess = itemIdMatch && skuMatch && sellerAccountMatch &&
      listingStatus?.toLowerCase() === "active" && quantity !== null

    let inventory: ExactInventoryLookup = { attempted: false, complete: false,
      exactMatch: false, exactOfferId: null, itemIdMatch: false,
      ambiguous: false, httpStatus: null, errorId: null,
      safeErrorClass: "OTHER", requestContractFixRequired: false,
      location: UNPROVEN_LOCATION_READ,
      exactSku: { attempted: false, httpStatus: null, exists: "UNPROVEN",
        authoritativeAbsence: false, errorId: null, safeErrorClass: "OTHER",
        errorMetadata: UNPROVEN_25709_METADATA,
        requestContractFixRequired: false } }
    let inventoryLookupFailure: string | null = null
    const inventoryOwnershipNeedsResolution = tradingReadSuccess &&
      listingType === "FixedPriceItem" && listingDuration === "GTC"
    if (inventoryOwnershipNeedsResolution) {
      try {
        inventory = await exactInventoryOfferLookup({ environment, fetchImpl })
      } catch (error) {
        inventoryLookupFailure = error instanceof Error &&
            /^[A-Z0-9_]+$/.test(error.message)
          ? error.message : "REVERSIBLE_OOS_INVENTORY_LOOKUP_FAILED"
      }
    }
    const publicationMatch = Boolean(inventory.attempted &&
      input.authorizedPublication &&
      input.authorizedPublication.listingId === REVERSIBLE_OOS_TARGET_ITEM_ID &&
      input.authorizedPublication.sku === REVERSIBLE_OOS_TARGET_SKU &&
      inventory.exactOfferId &&
      input.authorizedPublication.offerId === inventory.exactOfferId)
    const inventoryBoundaryClass: InventoryBoundaryClass =
      inventory.location.accepted &&
          inventory.exactSku.httpStatus === 400 &&
          inventory.exactSku.errorId === "25709"
        ? "INVENTORY_ITEM_SURFACE_SPECIFIC"
        : inventory.location.httpStatus === 400 &&
            inventory.location.errorId === "25709" &&
            inventory.exactSku.httpStatus === 400 &&
            inventory.exactSku.errorId === "25709"
          ? "COMMON_INVENTORY_API_BOUNDARY"
          : [401, 403].includes(inventory.location.httpStatus ?? 0) ||
              [401, 403].includes(inventory.exactSku.httpStatus ?? 0)
            ? "AUTHORIZATION_OR_ACCOUNT_ACCESS"
            : inventory.location.attempted && inventory.exactSku.attempted
              ? "OTHER_PROVEN_CLASS" : "UNPROVEN"
    const exactOfferFound: ExactInventoryEvidence =
      inventory.exactSku.exists === false ? false
        : inventory.attempted && inventory.complete
          ? inventory.exactMatch : "UNPROVEN"
    const exactPublicationItemIdMatch: ExactInventoryEvidence =
      inventory.exactSku.exists === false ? false
        : inventory.attempted && inventory.complete
          ? inventory.itemIdMatch : "UNPROVEN"
    let listingManagementModel: ReversibleOosListingManagementModel = "UNPROVEN"
    let managementEvidenceSource = "UNPROVEN"
    if (tradingReadSuccess && inventory.complete && inventory.exactMatch &&
        publicationMatch && !inventory.ambiguous) {
      listingManagementModel = "INVENTORY_API_MANAGED"
      managementEvidenceSource =
        "EBAY_TRADING_GET_ITEM_PLUS_EXACT_INVENTORY_OFFER_PLUS_AUTHORIZED_PUBLICATION"
    } else if (tradingReadSuccess && inventory.complete &&
        !inventory.exactMatch && !inventory.ambiguous &&
        listingType === "FixedPriceItem" && listingDuration === "GTC") {
      listingManagementModel = "TRADING_FIXED_PRICE"
      managementEvidenceSource = inventory.exactSku.exists === false
        ? "EBAY_TRADING_GET_ITEM_PLUS_EXACT_INVENTORY_ITEM_NOT_FOUND"
        : "EBAY_TRADING_GET_ITEM_PLUS_COMPLETE_EXACT_INVENTORY_OFFER_ABSENCE"
    } else if (inventory.exactMatch && !publicationMatch) {
      managementEvidenceSource =
        "INVENTORY_OFFER_PRESENT_WITHOUT_AUTHORIZED_PUBLICATION_RELATIONSHIP"
    } else if (inventoryLookupFailure) {
      managementEvidenceSource = inventoryLookupFailure
    } else if (inventory.exactSku.attempted) {
      managementEvidenceSource = inventory.exactSku.errorId
        ? `EXACT_SKU_READ_${inventory.exactSku.httpStatus}_${inventory.exactSku.errorId}`
        : `EXACT_SKU_READ_${inventory.exactSku.httpStatus ?? "UNPROVEN"}_${inventory.exactSku.safeErrorClass}`
    } else if (tradingReadSuccess && listingType !== "FixedPriceItem") {
      listingManagementModel = "OTHER"
      managementEvidenceSource = "EBAY_TRADING_GET_ITEM_LISTING_TYPE"
    }
    const modelProven = listingManagementModel !== "UNPROVEN"
    const reversibleModel = listingManagementModel === "TRADING_FIXED_PRICE" ||
      listingManagementModel === "INVENTORY_API_MANAGED"
    const reversibleSemantics = outOfStockControl === true && reversibleModel &&
      tradingReadSuccess
    const limitationCode = outOfStockControl !== true
      ? outOfStockControl === false
        ? "OUT_OF_STOCK_CONTROL_DISABLED"
        : "OUT_OF_STOCK_CONTROL_UNPROVEN"
      : !modelProven
        ? "LISTING_MANAGEMENT_MODEL_UNPROVEN"
        : !reversibleModel
          ? "LISTING_MANAGEMENT_MODEL_NOT_REVERSIBLE"
        : null
    return Object.freeze({
      contractVersion: SELLER_OS_REVERSIBLE_OOS_PREFLIGHT_V1,
      target: { itemId: REVERSIBLE_OOS_TARGET_ITEM_ID,
        sku: REVERSIBLE_OOS_TARGET_SKU },
      outOfStockControlReadAttempted: preferenceAttempted,
      outOfStockControl,
      listingManagementModel,
      listingManagementModelProven: modelProven,
      managementEvidenceSource,
      tradingItemReadAttempted,
      tradingReadSuccess,
      inventoryOfferLookupAttempted: inventory.attempted,
      inventoryOfferExactMatch: inventory.exactMatch,
      inventoryPublicationItemIdMatch: publicationMatch,
      inventoryLocationReadAttempted: inventory.location.attempted,
      inventoryLocationHttpStatus: inventory.location.httpStatus,
      inventoryLocationReadAccepted: inventory.location.accepted,
      inventoryLocationErrorId: inventory.location.errorId,
      inventoryLocationErrorDomain: inventory.location.errorDomain,
      inventoryLocationErrorCategory: inventory.location.errorCategory,
      inventoryBoundaryClass,
      inventoryCommonRootCauseProven: false,
      inventoryCommonRootCause: "UNPROVEN",
      exactSkuReadAttempted: inventory.exactSku.attempted,
      exactSkuReadHttpStatus: inventory.exactSku.httpStatus,
      exactSkuExists: inventory.exactSku.exists,
      exactSkuErrorId: inventory.exactSku.errorId,
      exactSkuSafeErrorClass: inventory.exactSku.safeErrorClass,
      exactSkuErrorDomain: inventory.exactSku.errorMetadata.domain,
      exactSkuErrorCategory: inventory.exactSku.errorMetadata.category,
      exactSkuErrorParameterNames:
        inventory.exactSku.errorMetadata.parameterNames,
      exactSkuFieldNameClass:
        inventory.exactSku.errorMetadata.fieldNameClass,
      exactSkuInvalidValueClass:
        inventory.exactSku.errorMetadata.invalidValueClass,
      exactSkuMessageTemplateClass:
        inventory.exactSku.errorMetadata.messageTemplateClass,
      exactOfferLookupAttempted: inventory.attempted,
      exactOfferFound,
      exactPublicationItemIdMatch,
      requestContractFixRequired: inventory.requestContractFixRequired,
      reversibleQuantityZeroSemanticsProven: reversibleSemantics,
      reversibleRestoreSemanticsProven: reversibleSemantics,
      restoreRequiresFreshHealthyStock: true,
      restoreRequiresPositiveSafeCapacity: true,
      inStockWithoutSafeCapacityAutoRestoreAllowed: false,
      preservesItemId: reversibleSemantics,
      targetReversibleProtectPossible: reversibleSemantics,
      listing: { itemIdMatch, skuMatch, sellerAccountMatch, listingType,
        listingDuration, listingStatus, inventoryTrackingMethod, quantity },
      safety: { readOnly: true as const, rawPayloadReturned: false as const,
        credentialsReturned: false as const, ebayWrites: 0 as const,
        databaseWrites: 0 as const, lunaWrites: 0 as const },
      limitationCode,
    })
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : "REVERSIBLE_OOS_PREFLIGHT_FAILED"
    return unavailable(code, {
      outOfStockControlReadAttempted: preferenceAttempted,
      outOfStockControl,
      tradingItemReadAttempted,
    })
  }
}
