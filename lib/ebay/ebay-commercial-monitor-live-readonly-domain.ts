export const EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION =
  "EBAY_COMMERCIAL_MONITOR_LIVE_READONLY_V1" as const

export const EBAY_MONITOR_TRADING_READ_OPERATIONS = [
  "GetUser",
  "GetMyeBaySelling",
  "GetSellerList",
  "GetItem",
] as const

export type EbayMonitorTradingReadOperation =
  typeof EBAY_MONITOR_TRADING_READ_OPERATIONS[number]

export type EbayMonitorReadonlyOperation =
  | "OAUTH_REFRESH_TRADING"
  | "TRADING_GET_USER"
  | "TRADING_GET_MY_EBAY_SELLING"
  | "TRADING_GET_SELLER_LIST"
  | "TRADING_GET_ITEM_MARKETPLACE"
  | "OAUTH_REFRESH_INVENTORY"
  | "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE"
  | "INVENTORY_GET_ITEMS"
  | "INVENTORY_GET_ITEMS_MATRIX_A"
  | "INVENTORY_GET_ITEMS_MATRIX_B"
  | "INVENTORY_GET_ITEMS_MATRIX_C"
  | "INVENTORY_GET_ITEMS_MATRIX_D"
  | "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL"
  | "INVENTORY_GET_OFFERS"
  | "OAUTH_REFRESH_ANALYTICS"
  | "ANALYTICS_GET_TRAFFIC_REPORT"
  | "OAUTH_REFRESH_FULFILLMENT"
  | "FULFILLMENT_GET_ORDERS"

export type EbayMonitorReadonlyCallEvidence = {
  operation: EbayMonitorReadonlyOperation
  method: "GET" | "POST"
  endpoint: string
  status: "SUCCEEDED" | "FAILED"
  httpStatus: number | null
  observedAt: string
  marketplaceMutation: false
  persisted: false
}

export type EbayInventoryItemsPageShape =
  | "INVENTORY_ITEMS_ARRAY"
  | "CERTIFIED_EMPTY_OMITTED_ARRAY"
  | "INVALID"

export type ParsedEbayInventoryItemsPage = {
  accepted: boolean
  inventoryItems: unknown[]
  total: number | null
  next: string | null
  responseShape: EbayInventoryItemsPageShape
  metadata: {
    topLevelKeys: string[]
    topLevelKeysSafe: boolean
    hasArray: boolean
    arrayCount: number | null
    totalPresent: boolean
    nextPresent: boolean
  }
}

export type SafeEbayInventoryErrorMetadata = {
  status: "CLASSIFIED" | "UNPROVEN"
  errorObjectCount: number | null
  errorIds: string[]
  domains: string[]
  categories: string[]
  parameterNames: string[]
  ERROR_25709_FIELD_NAME: string
  ERROR_25709_MESSAGE_FORM: "SUBSTITUTED_FIELD" | "LITERAL_PLACEHOLDER" |
    "OTHER" | "NO_MESSAGE"
  FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "YES" | "NO"
  ERROR_25709_SAFE_FIELD_CLASS:
    | "LIMIT"
    | "OFFSET"
    | "CONTENT_LANGUAGE"
    | "MARKETPLACE_HEADER"
    | "AUTHORIZATION"
    | "DOCUMENTED_OTHER"
    | "LITERAL_FIELDNAME_PLACEHOLDER"
    | "UNRECOGNIZED"
  MESSAGE_PREFIX_CLASS:
    | "EXACT_INVALID_VALUE_FOR"
    | "INVALID_VALUE_VARIANT"
    | "OTHER"
  MESSAGE_SUFFIX_CLASS: "PERIOD" | "NO_PERIOD" | "OTHER"
  MESSAGE_LENGTH_BUCKET:
    | "0_31"
    | "32_63"
    | "64_127"
    | "128_PLUS"
  MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "YES" | "NO"
  MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "YES" | "NO"
}

type EbayInventoryError25709MessageForm =
  SafeEbayInventoryErrorMetadata["ERROR_25709_MESSAGE_FORM"]

type EbayInventoryError25709SafeClass =
  SafeEbayInventoryErrorMetadata["ERROR_25709_SAFE_FIELD_CLASS"]
type EbayInventoryError25709PrefixClass =
  SafeEbayInventoryErrorMetadata["MESSAGE_PREFIX_CLASS"]
type EbayInventoryError25709SuffixClass =
  SafeEbayInventoryErrorMetadata["MESSAGE_SUFFIX_CLASS"]
type EbayInventoryError25709LengthBucket =
  SafeEbayInventoryErrorMetadata["MESSAGE_LENGTH_BUCKET"]
type EbayInventoryError25709TokenPresence =
  SafeEbayInventoryErrorMetadata["MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX"]
type EbayInventoryError25709KnownTokenPresence =
  SafeEbayInventoryErrorMetadata["MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN"]

export type SafeEbayInventoryError25709Metadata = {
  ERROR_25709_FIELD_NAME: string
  ERROR_25709_MESSAGE_FORM: EbayInventoryError25709MessageForm
  FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "YES" | "NO"
  ERROR_25709_SAFE_FIELD_CLASS: EbayInventoryError25709SafeClass
  MESSAGE_PREFIX_CLASS: EbayInventoryError25709PrefixClass
  MESSAGE_SUFFIX_CLASS: EbayInventoryError25709SuffixClass
  MESSAGE_LENGTH_BUCKET: EbayInventoryError25709LengthBucket
  MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: EbayInventoryError25709TokenPresence
  MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: EbayInventoryError25709KnownTokenPresence
}

export type EbayLiveListing = {
  itemId: string
  sku: string | null
  customLabel: string | null
  variationKey: string | null
  title: string | null
  primaryImageUrl: string | null
  primaryImageSource?:
    | "EBAY_TRADING_GET_MY_EBAY_SELLING"
    | "EBAY_TRADING_GET_ITEM"
    | null
  listingState: "ACTIVE"
  listingFormat: string | null
  startTime: string | null
  availableQuantity: number | null
  price: number | null
  currency: string | null
  marketplaceSite: string | null
  marketplaceCertification: {
    status: EbayItemMarketplaceCertificationStatus
    source:
      | "EBAY_TRADING_GET_MY_EBAY_SELLING"
      | "EBAY_TRADING_GET_ITEM"
      | null
    observedAt: string | null
  }
  identityAmbiguous: boolean
  source: "EBAY_TRADING_GET_MY_EBAY_SELLING"
  observedAt: string
}

export type EbayItemMarketplaceCertificationStatus =
  | "US_CERTIFIED"
  | "NON_US_CERTIFIED"
  | "UNRESOLVED"
  | "ERROR"
  | "BUDGET_EXHAUSTED"
  | "ITEM_ID_MISMATCH"

export type ParsedGetMyeBaySellingPage = {
  accepted: boolean
  totalEntries: number | null
  totalPages: number | null
  hasMoreItems: boolean | null
  listings: EbayLiveListing[]
  sourceIdentityConflict: boolean
  paginationMetadataConflict: boolean
}

export type SafeLiveEbayOrder = {
  ebayOrderId: string
  creationDate: string
  lastModifiedDate: string
  orderPaymentStatus: string
  orderFulfillmentStatus: string
  totalAmount: number | null
  currency: string | null
  marketplaceId: "EBAY_US"
  lineItems: Array<{
    ebayOrderId: string
    lineItemId: string
    listingId: string
    sku: string | null
    quantity: number
    lineItemAmount: number | null
    currency: string | null
    shipByDate: string | null
  }>
}

const EBAY_PRODUCTION_ORIGIN = "https://api.ebay.com"
const EBAY_INVENTORY_ITEMS_PATH = "/sell/inventory/v1/inventory_item"
const EBAY_INVENTORY_ITEMS_RESPONSE_KEYS = new Set([
  "href",
  "inventoryItems",
  "limit",
  "next",
  "prev",
  "size",
  "total",
])
const READONLY_REST_PATHS = new Map<EbayMonitorReadonlyOperation, {
  method: "GET" | "POST"
  path: string
}>([
  ["OAUTH_REFRESH_TRADING", {
    method: "POST",
    path: "/identity/v1/oauth2/token",
  }],
  ["TRADING_GET_USER", { method: "POST", path: "/ws/api.dll" }],
  ["TRADING_GET_MY_EBAY_SELLING", {
    method: "POST",
    path: "/ws/api.dll",
  }],
  ["TRADING_GET_SELLER_LIST", {
    method: "POST",
    path: "/ws/api.dll",
  }],
  ["TRADING_GET_ITEM_MARKETPLACE", {
    method: "POST",
    path: "/ws/api.dll",
  }],
  ["OAUTH_REFRESH_INVENTORY", {
    method: "POST",
    path: "/identity/v1/oauth2/token",
  }],
  ["OAUTH_REFRESH_INVENTORY_FOUR_SCOPE", {
    method: "POST",
    path: "/identity/v1/oauth2/token",
  }],
  ["INVENTORY_GET_ITEMS", {
    method: "GET",
    path: "/sell/inventory/v1/inventory_item",
  }],
  ["INVENTORY_GET_ITEMS_MATRIX_A", {
    method: "GET",
    path: "/sell/inventory/v1/inventory_item",
  }],
  ["INVENTORY_GET_ITEMS_MATRIX_B", {
    method: "GET",
    path: "/sell/inventory/v1/inventory_item",
  }],
  ["INVENTORY_GET_ITEMS_MATRIX_C", {
    method: "GET",
    path: "/sell/inventory/v1/inventory_item",
  }],
  ["INVENTORY_GET_ITEMS_MATRIX_D", {
    method: "GET",
    path: "/sell/inventory/v1/inventory_item",
  }],
  ["INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL", {
    method: "GET",
    path: "/sell/inventory/v1/inventory_item",
  }],
  ["INVENTORY_GET_OFFERS", {
    method: "GET",
    path: "/sell/inventory/v1/offer",
  }],
  ["OAUTH_REFRESH_ANALYTICS", {
    method: "POST",
    path: "/identity/v1/oauth2/token",
  }],
  ["ANALYTICS_GET_TRAFFIC_REPORT", {
    method: "GET",
    path: "/sell/analytics/v1/traffic_report",
  }],
  ["OAUTH_REFRESH_FULFILLMENT", {
    method: "POST",
    path: "/identity/v1/oauth2/token",
  }],
  ["FULFILLMENT_GET_ORDERS", {
    method: "GET",
    path: "/sell/fulfillment/v1/order",
  }],
])

// SiteCodeType output values documented by the Trading API. CustomCode is a
// reserved sentinel and therefore cannot establish a marketplace identity.
const EBAY_TRADING_MARKETPLACE_SITES = new Set([
  "AUSTRALIA",
  "AUSTRIA",
  "BELGIUM_DUTCH",
  "BELGIUM_FRENCH",
  "CANADA",
  "CANADAFRENCH",
  "CYPRUS",
  "CZECHIA",
  "EBAYMOTORS",
  "FRANCE",
  "GERMANY",
  "HONGKONG",
  "INDIA",
  "IRELAND",
  "ITALY",
  "MALAYSIA",
  "NETHERLANDS",
  "PHILIPPINES",
  "POLAND",
  "RUSSIA",
  "SINGAPORE",
  "SPAIN",
  "SWITZERLAND",
  "UK",
  "US",
])

export function assertEbayMonitorReadonlyRequest(input: {
  operation: EbayMonitorReadonlyOperation
  method: string
  url: string | URL
  requestHeaderNames?: string[]
  marketplaceIdHeader?: string | null
  tradingCallName?: string | null
  tradingHeaderCallName?: string | null
  tradingBody?: string | null
}) {
  const rule = READONLY_REST_PATHS.get(input.operation)
  const url = new URL(input.url)
  if (!rule || input.method !== rule.method ||
      url.origin !== EBAY_PRODUCTION_ORIGIN || url.pathname !== rule.path ||
      Boolean(url.username) || Boolean(url.password) || Boolean(url.hash)) {
    throw new Error("EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST")
  }
  const requestHeaderNames = [...(input.requestHeaderNames ?? [])].sort()
  if (input.operation === "INVENTORY_GET_ITEMS") {
    if ([...url.searchParams.keys()].sort().join(",") !== "limit,offset" ||
        url.searchParams.getAll("limit").length !== 1 ||
        url.searchParams.get("limit") !== "50" ||
        url.searchParams.getAll("offset").length !== 1 ||
        !/^\d+$/.test(url.searchParams.get("offset") ?? "") ||
        input.marketplaceIdHeader !== "EBAY_US" ||
        requestHeaderNames.join(",") !==
          "authorization,x-ebay-c-marketplace-id") {
      throw new Error("EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST")
    }
  }
  if (input.operation === "INVENTORY_GET_ITEMS_MATRIX_A") {
    if ([...url.searchParams.keys()].sort().join(",") !== "limit,offset" ||
        url.searchParams.getAll("limit").length !== 1 ||
        url.searchParams.get("limit") !== "50" ||
        url.searchParams.getAll("offset").length !== 1 ||
        url.searchParams.get("offset") !== "0" ||
        input.marketplaceIdHeader !== "EBAY_US" ||
        requestHeaderNames.join(",") !==
          "authorization,x-ebay-c-marketplace-id") {
      throw new Error("EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST")
    }
  }
  if (input.operation === "INVENTORY_GET_ITEMS_MATRIX_B") {
    if ([...url.searchParams.keys()].sort().join(",") !== "limit,offset" ||
        url.searchParams.getAll("limit").length !== 1 ||
        url.searchParams.get("limit") !== "50" ||
        url.searchParams.getAll("offset").length !== 1 ||
        url.searchParams.get("offset") !== "0" ||
        input.marketplaceIdHeader !== null ||
        requestHeaderNames.join(",") !== "authorization") {
      throw new Error("EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST")
    }
  }
  if (input.operation === "INVENTORY_GET_ITEMS_MATRIX_C") {
    if ([...url.searchParams.keys()].join(",") !== "limit" ||
        url.searchParams.getAll("limit").length !== 1 ||
        url.searchParams.get("limit") !== "50" ||
        input.marketplaceIdHeader !== null ||
        requestHeaderNames.join(",") !== "authorization") {
      throw new Error("EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST")
    }
  }
  if (input.operation === "INVENTORY_GET_ITEMS_MATRIX_D" ||
      input.operation === "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL") {
    if ([...url.searchParams.keys()].length !== 0 ||
        input.marketplaceIdHeader !== null ||
        requestHeaderNames.join(",") !== "authorization") {
      throw new Error("EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST")
    }
  }
  if (input.operation === "INVENTORY_GET_OFFERS") {
    const sku = url.searchParams.get("sku") ?? ""
    if ([...url.searchParams.keys()].sort().join(",") !== "limit,sku" ||
        url.searchParams.getAll("limit").length !== 1 ||
        url.searchParams.get("limit") !== "100" ||
        url.searchParams.getAll("sku").length !== 1 ||
        !sku || sku.length > 120 ||
        input.marketplaceIdHeader !== "EBAY_US" ||
        requestHeaderNames.join(",") !==
          "authorization,x-ebay-c-marketplace-id") {
      throw new Error("EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST")
    }
  }
  const expectedTradingCall = input.operation === "TRADING_GET_USER"
    ? "GetUser"
    : input.operation === "TRADING_GET_MY_EBAY_SELLING"
      ? "GetMyeBaySelling"
      : input.operation === "TRADING_GET_SELLER_LIST"
        ? "GetSellerList"
      : input.operation === "TRADING_GET_ITEM_MARKETPLACE"
        ? "GetItem"
      : null
  if (expectedTradingCall !== null &&
      (input.tradingCallName !== expectedTradingCall ||
        input.tradingHeaderCallName !== expectedTradingCall ||
        !EBAY_MONITOR_TRADING_READ_OPERATIONS.includes(
          input.tradingCallName as EbayMonitorTradingReadOperation,
        ))) {
    throw new Error("EBAY_MONITOR_BLOCKED_TRADING_OPERATION")
  }
  if (expectedTradingCall !== null) {
    const body = input.tradingBody ?? ""
    const root = body.match(
      /^\s*(?:<\?xml[^>]*>\s*)?<(?:[A-Za-z0-9_-]+:)?([A-Za-z0-9_-]+)\b/i,
    )?.[1] ?? null
    if (root !== `${expectedTradingCall}Request`) {
      throw new Error("EBAY_MONITOR_BLOCKED_TRADING_OPERATION")
    }
    if (expectedTradingCall === "GetItem") {
      const requests = ebayTradingXmlContainers(body, "GetItemRequest")
      const request = requests.length === 1 ? requests[0] : ""
      const itemIds = ebayTradingXmlDirectChildContainers(request, "ItemID")
      const itemId = itemIds.length === 1
        ? ebayTradingXmlDirectChildValue(request, "ItemID")
        : null
      const selectors = ebayTradingXmlDirectChildContainers(
        request,
        "OutputSelector",
      )
        .map((entry) => decodeXml(entry.replace(/<[^>]*>/g, " "))
          .replace(/\s+/g, " ").trim())
        .sort()
      if (requests.length !== 1 || !itemId || !/^\d{9,20}$/.test(itemId) ||
          selectors.length !== 4 ||
          selectors[0] !== "Item.GalleryURL" ||
          selectors[1] !== "Item.ItemID" ||
          selectors[2] !== "Item.PictureDetails.PictureURL" ||
          selectors[3] !== "Item.Site") {
        throw new Error("EBAY_MONITOR_BLOCKED_TRADING_OPERATION")
      }
      const elementNames = [...body.matchAll(
        /<\/?(?:[A-Za-z0-9_-]+:)?([A-Za-z][A-Za-z0-9_-]*)\b[^>]*>/g,
      )].map((match) => match[1])
      if (elementNames.some((name) =>
        name !== "GetItemRequest" &&
        name !== "ItemID" &&
        name !== "OutputSelector")) {
        throw new Error("EBAY_MONITOR_BLOCKED_TRADING_OPERATION")
      }
    }
  }
  if (expectedTradingCall === null && input.tradingCallName) {
    throw new Error("EBAY_MONITOR_BLOCKED_TRADING_OPERATION")
  }
  return true
}

function exactNonNegativeJsonInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function safeInventoryTopLevelKeys(payload: Record<string, unknown>) {
  const keys = Object.keys(payload).sort()
  const safe = keys.length <= 16 && keys.every((key) =>
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
  return { keys: safe ? keys : [], safe }
}

const EBAY_INVENTORY_ERROR_KEYS = new Set([
  "category",
  "domain",
  "errorId",
  "inputRefIds",
  "longMessage",
  "message",
  "outputRefIds",
  "parameters",
  "subdomain",
])

const ERROR_25709_SUBSTITUTED_FIELD_MESSAGE = /^Invalid value for ([A-Za-z][A-Za-z0-9_.-]{0,63})\.$/
const ERROR_25709_LITERAL_PLACEHOLDER_MESSAGE = /^Invalid value for \{fieldName\}\.$/
const ERROR_25709_DOCUMENTED_QUERY_PARAMETERS = new Set(["limit", "offset"])
const ERROR_25709_DOCUMENTED_REQUIRED_HEADERS = new Set(["authorization"])
const ERROR_25709_DOCUMENTED_OPTIONAL_HEADERS = new Set<string>([])
const ERROR_25709_KNOWN_DOCUMENTED_FIELDS = new Set([
  ...ERROR_25709_DOCUMENTED_QUERY_PARAMETERS,
  ...ERROR_25709_DOCUMENTED_REQUIRED_HEADERS,
  ...ERROR_25709_DOCUMENTED_OPTIONAL_HEADERS,
])
const ERROR_25709_KNOWN_MESSAGE_FIELD_TOKENS = new Set([
  ...ERROR_25709_DOCUMENTED_QUERY_PARAMETERS,
  ...ERROR_25709_DOCUMENTED_REQUIRED_HEADERS,
  "authorization",
  "content-language",
  "x-ebay-c-marketplace-id",
  "marketplaceid",
  "marketplace-id",
])

const EBAY_25709_CONTENT_LANGUAGE_TOKEN = "content-language"
const EBAY_25709_MARKETPLACE_HEADER_TOKENS = new Set([
  "x-ebay-c-marketplace-id",
  "marketplaceid",
  "marketplace-id",
])
const EBAY_25709_AUTHORIZATION_HEADER_TOKENS = new Set(["authorization"])
const EBAY_25709_LIMIT_OFFSET_TOKENS = new Set(["limit", "offset"])

const UNPROVEN_25709_METADATA: SafeEbayInventoryErrorMetadata = {
  status: "UNPROVEN",
  errorObjectCount: null,
  errorIds: [],
  domains: [],
  categories: [],
  parameterNames: [],
  ERROR_25709_FIELD_NAME: "UNPROVEN",
  ERROR_25709_MESSAGE_FORM: "OTHER",
  FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
  ERROR_25709_SAFE_FIELD_CLASS: "UNRECOGNIZED",
  MESSAGE_PREFIX_CLASS: "OTHER",
  MESSAGE_SUFFIX_CLASS: "OTHER",
  MESSAGE_LENGTH_BUCKET: "0_31",
  MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "NO",
  MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "NO",
}

function classify25709FieldToken(fieldName: string): EbayInventoryError25709SafeClass {
  const normalizedFieldName = fieldName.toLowerCase()
  if (EBAY_25709_LIMIT_OFFSET_TOKENS.has(normalizedFieldName)) {
    return normalizedFieldName === "limit" ? "LIMIT" : "OFFSET"
  }
  if (normalizedFieldName === EBAY_25709_CONTENT_LANGUAGE_TOKEN) {
    return "CONTENT_LANGUAGE"
  }
  if (EBAY_25709_AUTHORIZATION_HEADER_TOKENS.has(normalizedFieldName)) {
    return "AUTHORIZATION"
  }
  if (EBAY_25709_MARKETPLACE_HEADER_TOKENS.has(normalizedFieldName)) {
    return "MARKETPLACE_HEADER"
  }
  if (ERROR_25709_KNOWN_DOCUMENTED_FIELDS.has(normalizedFieldName)) {
    return "DOCUMENTED_OTHER"
  }
  return "UNRECOGNIZED"
}

function safeMessagePrefix(message: string): EbayInventoryError25709PrefixClass {
  return message.startsWith("Invalid value for ")
    ? "EXACT_INVALID_VALUE_FOR"
    : message.includes("Invalid value for ")
      ? "INVALID_VALUE_VARIANT"
      : "OTHER"
}

function safeMessageSuffix(message: string): EbayInventoryError25709SuffixClass {
  return message.endsWith(".") ? "PERIOD" : "NO_PERIOD"
}

function safeMessageLengthBucket(message: string): EbayInventoryError25709LengthBucket {
  const messageLength = message.length
  if (messageLength <= 31) return "0_31"
  if (messageLength <= 63) return "32_63"
  if (messageLength <= 127) return "64_127"
  return "128_PLUS"
}

function safeContainsKnownDocumentedFieldToken(message: string): "YES" | "NO" {
  const normalizedMessage = message.toLowerCase()
  for (const token of ERROR_25709_KNOWN_MESSAGE_FIELD_TOKENS) {
    if (normalizedMessage.includes(token.toLowerCase())) return "YES"
  }
  return "NO"
}

function parse25709MessageMetadata(message: string): SafeEbayInventoryError25709Metadata {
  const prefixClass = safeMessagePrefix(message)
  const suffixClass = safeMessageSuffix(message)
  const lengthBucket = safeMessageLengthBucket(message)
  const containsPrefix = prefixClass === "OTHER" ? "NO" : "YES"
  const containsKnownDocumentedFieldToken = safeContainsKnownDocumentedFieldToken(
    message,
  )
  if (ERROR_25709_LITERAL_PLACEHOLDER_MESSAGE.test(message)) {
    return {
      ERROR_25709_FIELD_NAME: "UNPROVEN",
      ERROR_25709_MESSAGE_FORM: "LITERAL_PLACEHOLDER",
      FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
      ERROR_25709_SAFE_FIELD_CLASS: "LITERAL_FIELDNAME_PLACEHOLDER",
      MESSAGE_PREFIX_CLASS: prefixClass,
      MESSAGE_SUFFIX_CLASS: suffixClass,
      MESSAGE_LENGTH_BUCKET: lengthBucket,
      MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: containsPrefix,
      MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN:
        containsKnownDocumentedFieldToken,
    }
  }
  const substituted = ERROR_25709_SUBSTITUTED_FIELD_MESSAGE.exec(message)
  if (substituted) {
    const fieldName = substituted[1] ?? "UNPROVEN"
    const safeFieldClass = classify25709FieldToken(fieldName)
    return {
      ERROR_25709_FIELD_NAME: safeFieldClass === "UNRECOGNIZED"
        ? "UNPROVEN"
        : fieldName,
      ERROR_25709_MESSAGE_FORM: "SUBSTITUTED_FIELD",
      FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "YES",
      ERROR_25709_SAFE_FIELD_CLASS:
        safeFieldClass,
      MESSAGE_PREFIX_CLASS: prefixClass,
      MESSAGE_SUFFIX_CLASS: suffixClass,
      MESSAGE_LENGTH_BUCKET: lengthBucket,
      MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: containsPrefix,
      MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN:
        containsKnownDocumentedFieldToken,
    }
  }
  return {
    ERROR_25709_FIELD_NAME: "UNPROVEN",
    ERROR_25709_MESSAGE_FORM: "OTHER",
    FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
    ERROR_25709_SAFE_FIELD_CLASS: "UNRECOGNIZED",
    MESSAGE_PREFIX_CLASS: prefixClass,
    MESSAGE_SUFFIX_CLASS: suffixClass,
    MESSAGE_LENGTH_BUCKET: lengthBucket,
    MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: containsPrefix,
    MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN:
      containsKnownDocumentedFieldToken,
  }
}

function inventoryErrorRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function safeErrorToken(value: unknown) {
  return typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
    ? value
    : null
}

function safeErrorParameterName(value: unknown) {
  return typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_.\[\]-]{0,79}$/.test(value)
    ? value
    : null
}

function validIgnoredStringArray(value: unknown) {
  return typeof value === "undefined" ||
    (Array.isArray(value) && value.length <= 20 && value.every((entry) =>
      typeof entry === "string" && entry.length <= 256))
}

function unprovenInventoryErrorMetadata(): SafeEbayInventoryErrorMetadata {
  return { ...UNPROVEN_25709_METADATA }
}

function parseEbayInventory25709MetadataFromErrors(
  rawErrors: unknown[],
): SafeEbayInventoryError25709Metadata {
  for (const rawError of rawErrors) {
    const error = inventoryErrorRecord(rawError)
    if (!error || !Object.hasOwn(error, "errorId") ||
        typeof error.errorId !== "number" || !Number.isSafeInteger(error.errorId) ||
        error.errorId !== 25709) {
      continue
    }
    if (!Object.hasOwn(error, "message") || typeof error.message !== "string") {
      return {
        ERROR_25709_FIELD_NAME: "UNPROVEN",
        ERROR_25709_MESSAGE_FORM: "NO_MESSAGE",
        FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
        ERROR_25709_SAFE_FIELD_CLASS: "UNRECOGNIZED",
        MESSAGE_PREFIX_CLASS: "OTHER",
        MESSAGE_SUFFIX_CLASS: "OTHER",
        MESSAGE_LENGTH_BUCKET: "0_31",
        MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "NO",
        MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "NO",
      }
    }
    return parse25709MessageMetadata(error.message)
  }
  return {
    ERROR_25709_FIELD_NAME: "UNPROVEN",
    ERROR_25709_MESSAGE_FORM: "OTHER",
    FIELD_NAME_EXTRACTED_FROM_CERTIFIED_TEMPLATE: "NO",
    ERROR_25709_SAFE_FIELD_CLASS: "UNRECOGNIZED",
    MESSAGE_PREFIX_CLASS: "OTHER",
    MESSAGE_SUFFIX_CLASS: "OTHER",
    MESSAGE_LENGTH_BUCKET: "0_31",
    MESSAGE_CONTAINS_OFFICIAL_INVALID_VALUE_PREFIX: "NO",
    MESSAGE_CONTAINS_KNOWN_DOCUMENTED_FIELD_TOKEN: "NO",
  }
}

function parseSafeInventoryErrors(value: unknown): unknown[] | null {
  const root = inventoryErrorRecord(value)
  if (!root) return null
  const rootKeys = Object.keys(root)
  const errors = rootKeys.length === 1 && rootKeys[0] === "errors" &&
    Array.isArray(root.errors)
    ? root.errors
    : rootKeys.length > 0 && rootKeys.every((key) =>
      EBAY_INVENTORY_ERROR_KEYS.has(key))
        ? [root]
        : null
  if (!Array.isArray(errors) || errors.length < 1 || errors.length > 10) {
    return null
  }
  return errors
}

/**
 * Extracts only provider-owned structural error metadata. Human-readable
 * messages, reference IDs, and parameter values are validated for shape and
 * then discarded; none can enter the returned object.
 */
export function parseSafeEbayInventoryErrorMetadata(
  value: unknown,
): SafeEbayInventoryErrorMetadata {
  if (!inventoryErrorRecord(value)) return { ...UNPROVEN_25709_METADATA }
  const rawErrors = parseSafeInventoryErrors(value)
  if (!rawErrors) {
    return unprovenInventoryErrorMetadata()
  }

  const errorIds: string[] = []
  const domains: string[] = []
  const categories: string[] = []
  const parameterNames: string[] = []
  for (const rawError of rawErrors) {
    const error = inventoryErrorRecord(rawError)
    if (!error || Object.keys(error).length < 1 ||
        Object.keys(error).some((key) =>
          !EBAY_INVENTORY_ERROR_KEYS.has(key))) {
      return unprovenInventoryErrorMetadata()
    }
    const errorId = error.errorId
    const domain = safeErrorToken(error.domain)
    const category = safeErrorToken(error.category)
    if (typeof errorId !== "number" || !Number.isSafeInteger(errorId) ||
        errorId < 1 || errorId > 2_147_483_647 || !domain || !category ||
        (typeof error.message !== "undefined" &&
          (typeof error.message !== "string" || error.message.length > 8_192)) ||
        (typeof error.longMessage !== "undefined" &&
          (typeof error.longMessage !== "string" ||
            error.longMessage.length > 8_192)) ||
        (typeof error.subdomain !== "undefined" &&
          !safeErrorToken(error.subdomain)) ||
        !validIgnoredStringArray(error.inputRefIds) ||
        !validIgnoredStringArray(error.outputRefIds)) {
      return unprovenInventoryErrorMetadata()
    }
    const parameters = typeof error.parameters === "undefined"
      ? []
      : Array.isArray(error.parameters) ? error.parameters : null
    if (!parameters || parameters.length > 20) {
      return unprovenInventoryErrorMetadata()
    }
    for (const rawParameter of parameters) {
      const parameter = inventoryErrorRecord(rawParameter)
      const keys = parameter ? Object.keys(parameter).sort() : []
      const name = parameter ? safeErrorParameterName(parameter.name) : null
      if (!parameter || keys.length < 1 ||
          keys.some((key) => key !== "name" && key !== "value") || !name ||
          (typeof parameter.value !== "undefined" &&
            (typeof parameter.value !== "string" ||
              parameter.value.length > 8_192))) {
        return unprovenInventoryErrorMetadata()
      }
      parameterNames.push(name)
    }
    errorIds.push(String(errorId))
    domains.push(domain)
    categories.push(category)
  }
  return {
    status: "CLASSIFIED",
    errorObjectCount: rawErrors.length,
    errorIds: [...new Set(errorIds)].sort(),
    domains: [...new Set(domains)].sort(),
    categories: [...new Set(categories)].sort(),
    parameterNames: [...new Set(parameterNames)].sort(),
    ...parseEbayInventory25709MetadataFromErrors(rawErrors),
  }
}

function exactInventoryPageLink(
  value: string,
  expectedLimit: number,
  expectedOffset: number,
) {
  if (!value || value.length > 2_000) return false
  try {
    const url = new URL(value, EBAY_PRODUCTION_ORIGIN)
    return url.origin === EBAY_PRODUCTION_ORIGIN &&
      url.pathname === EBAY_INVENTORY_ITEMS_PATH &&
      !url.username && !url.password && !url.hash &&
      [...url.searchParams.keys()].sort().join(",") === "limit,offset" &&
      url.searchParams.getAll("limit").length === 1 &&
      url.searchParams.get("limit") === String(expectedLimit) &&
      url.searchParams.getAll("offset").length === 1 &&
      url.searchParams.get("offset") === String(expectedOffset)
  } catch {
    return false
  }
}

function exactOptionalInventoryHref(
  value: unknown,
  expectedLimit: number,
  expectedOffset: number,
) {
  return typeof value === "undefined" ||
    (typeof value === "string" && exactInventoryPageLink(
      value,
      expectedLimit,
      expectedOffset,
    ))
}

/**
 * Parses the exact getInventoryItems page contract used by Commercial Monitor.
 *
 * eBay's OpenAPI InventoryItems schema does not require inventoryItems. An
 * omitted collection is therefore accepted only when the same payload proves
 * an authoritative zero catalog. The narrow exception is intentionally not a
 * generic nullish-to-empty conversion.
 */
export function parseEbayInventoryItemsPage(
  value: unknown,
  input: { expectedLimit: number; expectedOffset: number } = {
    expectedLimit: 50,
    expectedOffset: 0,
  },
): ParsedEbayInventoryItemsPage {
  const invalid = (
    payload: Record<string, unknown> | null,
  ): ParsedEbayInventoryItemsPage => {
    const topLevel = payload
      ? safeInventoryTopLevelKeys(payload)
      : { keys: [] as string[], safe: false }
    const actualArray = payload && Array.isArray(payload.inventoryItems)
      ? payload.inventoryItems
      : null
    return {
      accepted: false,
      inventoryItems: [],
      total: payload ? exactNonNegativeJsonInteger(payload.total) : null,
      next: null,
      responseShape: "INVALID",
      metadata: {
        topLevelKeys: topLevel.keys,
        topLevelKeysSafe: topLevel.safe,
        hasArray: actualArray !== null,
        arrayCount: actualArray?.length ?? null,
        totalPresent: payload ? Object.hasOwn(payload, "total") : false,
        nextPresent: payload ? Object.hasOwn(payload, "next") : false,
      },
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(null)
  }
  const payload = value as Record<string, unknown>
  const topLevel = safeInventoryTopLevelKeys(payload)
  if (!topLevel.safe) return invalid(payload)

  const hasArrayProperty = Object.hasOwn(payload, "inventoryItems")
  const array = hasArrayProperty && Array.isArray(payload.inventoryItems)
    ? payload.inventoryItems
    : null
  if (hasArrayProperty && array === null) return invalid(payload)

  const totalPresent = Object.hasOwn(payload, "total")
  const total = exactNonNegativeJsonInteger(payload.total)
  const nextPresent = Object.hasOwn(payload, "next")
  const next = typeof payload.next === "string" && payload.next.length > 0
    ? payload.next.slice(0, 2_000)
    : null
  const prevPresent = Object.hasOwn(payload, "prev")
  const keysCertified = topLevel.keys.every((key) =>
    EBAY_INVENTORY_ITEMS_RESPONSE_KEYS.has(key))
  const size = Object.hasOwn(payload, "size")
    ? exactNonNegativeJsonInteger(payload.size)
    : null
  const observedArraySize = array === null ? 0 : array.length
  const sizeCertified = !Object.hasOwn(payload, "size") ||
    size === observedArraySize
  const limitCertified = !Object.hasOwn(payload, "limit") ||
    exactNonNegativeJsonInteger(payload.limit) === input.expectedLimit
  const hrefCertified = exactOptionalInventoryHref(
    payload.href,
    input.expectedLimit,
    input.expectedOffset,
  )

  const emptyCandidate = array === null || array.length === 0
  if (emptyCandidate) {
    const paginationCertified = !nextPresent && !prevPresent && hrefCertified
    const emptyCatalogCertified = total === 0
    const legacyArrayWithoutTotal = array !== null && !totalPresent
    if (!keysCertified ||
        (!emptyCatalogCertified && !legacyArrayWithoutTotal) || !sizeCertified ||
        !limitCertified || !paginationCertified) {
      return invalid(payload)
    }
    return {
      accepted: true,
      inventoryItems: [],
      total: emptyCatalogCertified ? 0 : null,
      next: null,
      responseShape: array === null
        ? "CERTIFIED_EMPTY_OMITTED_ARRAY"
        : "INVENTORY_ITEMS_ARRAY",
      metadata: {
        topLevelKeys: topLevel.keys,
        topLevelKeysSafe: true,
        hasArray: array !== null,
        arrayCount: array?.length ?? null,
        totalPresent,
        nextPresent,
      },
    }
  }

  // eBay defines offset as a zero-based page number, not a row offset.
  const observedEnd = input.expectedOffset * input.expectedLimit + array.length
  const totalCertified = !totalPresent ||
    (total !== null && total >= observedEnd)
  const continuationExpected = total !== null
    ? total > observedEnd
    : array.length === input.expectedLimit
  const nextCertified = nextPresent
    ? typeof payload.next === "string" &&
      array.length === input.expectedLimit && continuationExpected &&
      exactInventoryPageLink(
        payload.next,
        input.expectedLimit,
        input.expectedOffset + 1,
      )
    : !continuationExpected
  const expectedPreviousOffset = Math.max(0, input.expectedOffset - 1)
  const prevCertified = !prevPresent || (
    input.expectedOffset > 0 &&
    typeof payload.prev === "string" &&
    exactInventoryPageLink(
      payload.prev,
      input.expectedLimit,
      expectedPreviousOffset,
    )
  )
  if (!keysCertified || !sizeCertified || !limitCertified || !hrefCertified ||
      !totalCertified || !nextCertified || !prevCertified) {
    return invalid(payload)
  }

  return {
    accepted: true,
    inventoryItems: array,
    total,
    next,
    responseShape: "INVENTORY_ITEMS_ARRAY",
    metadata: {
      topLevelKeys: topLevel.keys,
      topLevelKeysSafe: true,
      hasArray: true,
      arrayCount: array.length,
      totalPresent,
      nextPresent,
    },
  }
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function escapedTag(tag: string) {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function ebayTradingXmlContainers(xml: string, tag: string) {
  const escaped = escapedTag(tag)
  return [...xml.matchAll(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "gi",
  ))].map((match) => match[1])
}

export function ebayTradingXmlValue(xml: string, tag: string) {
  const value = ebayTradingXmlContainers(xml, tag)[0]
  if (value === undefined) return null
  const normalized = decodeXml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
  return normalized || null
}

function ebayTradingXmlDirectChildContainers(xml: string, tag: string) {
  const results: string[] = []
  const tokens = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?(?:[A-Za-z0-9_-]+:)?[A-Za-z_][A-Za-z0-9_.-]*(?:\s[^<>]*?)?\/?>/g
  let depth = 0
  let targetStart: number | null = null
  for (const match of xml.matchAll(tokens)) {
    const token = match[0]
    const tokenIndex = match.index
    if (tokenIndex === undefined) continue
    if (token.startsWith("<?") || token.startsWith("<!--") ||
        token.startsWith("<![CDATA[")) continue
    const name = token.match(
      /^<\/?(?:[A-Za-z0-9_-]+:)?([A-Za-z_][A-Za-z0-9_.-]*)/,
    )?.[1]
    if (!name) continue
    const closing = token.startsWith("</")
    const selfClosing = token.endsWith("/>")
    if (closing) {
      depth = Math.max(0, depth - 1)
      if (depth === 0 && name === tag && targetStart !== null) {
        results.push(xml.slice(targetStart, tokenIndex))
        targetStart = null
      }
      continue
    }
    if (depth === 0 && name === tag) {
      if (selfClosing) results.push("")
      else targetStart = tokenIndex + token.length
    }
    if (!selfClosing) depth += 1
  }
  return results
}

function ebayTradingXmlDirectChildValue(xml: string, tag: string) {
  const value = ebayTradingXmlDirectChildContainers(xml, tag)[0]
  if (value === undefined) return null
  const normalized = decodeXml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
  return normalized || null
}

function ebayTradingXmlAttribute(xml: string, tag: string, attribute: string) {
  const escaped = escapedTag(tag)
  const escapedAttribute = escapedTag(attribute)
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}\\b[^>]*\\b${escapedAttribute}=["']([^"']+)["'][^>]*>`,
    "i",
  ))
  return match ? decodeXml(match[1]).trim() || null : null
}

function safeText(value: string | null, maximum: number) {
  if (!value) return null
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function safeIdentifier(value: string | null, maximum = 120) {
  const normalized = safeText(value, maximum)
  return normalized && /^[A-Za-z0-9._:/+|= -]+$/.test(normalized)
    ? normalized
    : null
}

function safeLabel(value: string | null, maximum = 120) {
  return safeText(value, maximum)
}

function ebayTradingMarketplaceSite(value: string | null) {
  const normalized = safeLabel(value, 30)?.toUpperCase() ?? null
  return normalized && EBAY_TRADING_MARKETPLACE_SITES.has(normalized)
    ? normalized
    : null
}

function safeIso(value: string | null) {
  const normalized = safeText(value, 50)
  return normalized && Number.isFinite(Date.parse(normalized))
    ? new Date(normalized).toISOString()
    : null
}

function nonNegativeInteger(value: string | null) {
  if (value === null || !value.trim()) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function nonNegativeNumber(value: string | null) {
  if (value === null || !value.trim()) return null
  const parsed = Number(value.replaceAll(",", ""))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function remainingQuantity(container: string) {
  const listed = nonNegativeInteger(ebayTradingXmlValue(container, "Quantity"))
  const selling = ebayTradingXmlContainers(container, "SellingStatus")[0] ?? ""
  const soldContainers = ebayTradingXmlDirectChildContainers(
    selling,
    "QuantitySold",
  )
  const sold = soldContainers.length === 0
    ? 0
    : soldContainers.length === 1
      ? nonNegativeInteger(
        ebayTradingXmlDirectChildValue(selling, "QuantitySold"),
      )
      : null
  return listed !== null && sold !== null && sold <= listed
    ? listed - sold
    : null
}

function variationIdentity(container: string) {
  const pairs = ebayTradingXmlContainers(container, "NameValueList")
    .flatMap((entry) => {
      const name = safeLabel(ebayTradingXmlValue(entry, "Name"), 60)
      const values = ebayTradingXmlContainers(entry, "Value")
        .map((value) => safeLabel(safeText(
          decodeXml(value.replace(/<[^>]*>/g, " ")),
          80,
        ), 80))
        .filter((value): value is string => Boolean(value))
      return name && values.length ? [[name, ...values].join("=")] : []
    })
    .sort()
  return pairs.length ? pairs.join("|").slice(0, 240) : null
}

function itemListings(item: string, observedAt: string): EbayLiveListing[] {
  const itemIds = ebayTradingXmlDirectChildContainers(item, "ItemID")
  const itemId = itemIds.length === 1
    ? ebayTradingXmlDirectChildValue(item, "ItemID")
    : null
  if (!itemId || !/^\d{9,20}$/.test(itemId)) return []
  const selling = ebayTradingXmlContainers(item, "SellingStatus")[0] ?? ""
  const details = ebayTradingXmlContainers(item, "ListingDetails")[0] ?? ""
  const variations = ebayTradingXmlContainers(
    ebayTradingXmlContainers(item, "Variations")[0] ?? "",
    "Variation",
  )
  const title = safeText(ebayTradingXmlValue(item, "Title"), 300)
  const pictureDetails = ebayTradingXmlContainers(item, "PictureDetails")[0] ?? ""
  const primaryImageCandidate = safeText(
    ebayTradingXmlDirectChildValue(item, "GalleryURL") ??
      ebayTradingXmlDirectChildValue(pictureDetails, "GalleryURL") ??
      ebayTradingXmlValue(pictureDetails, "PictureURL"),
    2_000,
  )
  const primaryImageUrl = primaryImageCandidate?.startsWith("https://")
    ? primaryImageCandidate
    : null
  const listingFormat = safeLabel(
    ebayTradingXmlValue(item, "ListingType"),
    60,
  )
  const startTime = safeIso(ebayTradingXmlValue(details, "StartTime"))
  const itemCurrency = safeIdentifier(
    ebayTradingXmlAttribute(selling, "CurrentPrice", "currencyID") ??
      ebayTradingXmlValue(item, "Currency"),
    3,
  )?.toUpperCase() ?? null
  const itemPrice = nonNegativeNumber(
    ebayTradingXmlValue(selling, "CurrentPrice"),
  )
  const toListing = (variation: string | null): EbayLiveListing => {
    const variationSelling = variation
      ? ebayTradingXmlContainers(variation, "SellingStatus")[0] ?? ""
      : ""
    const variationPrice = variation
      ? nonNegativeNumber(
          ebayTradingXmlValue(variation, "StartPrice") ??
            ebayTradingXmlValue(variationSelling, "CurrentPrice"),
        )
      : null
    const sku = safeLabel(
      ebayTradingXmlValue(variation ?? item, "SKU"),
    )
    const sites = ebayTradingXmlDirectChildContainers(item, "Site")
    const marketplaceSite = sites.length === 1
      ? ebayTradingMarketplaceSite(
          ebayTradingXmlDirectChildValue(item, "Site"),
        )
      : null
    return {
      itemId,
      sku,
      customLabel: sku,
      variationKey: variation ? variationIdentity(variation) : null,
      title,
      primaryImageUrl,
      primaryImageSource: primaryImageUrl
        ? "EBAY_TRADING_GET_MY_EBAY_SELLING"
        : null,
      listingState: "ACTIVE",
      listingFormat,
      startTime,
      availableQuantity: remainingQuantity(variation ?? item),
      price: variation ? variationPrice : itemPrice,
      currency: variation
        ? safeIdentifier(
            ebayTradingXmlAttribute(variation, "StartPrice", "currencyID") ??
              ebayTradingXmlAttribute(
                variationSelling,
                "CurrentPrice",
                "currencyID",
              ) ?? itemCurrency,
            3,
          )?.toUpperCase() ?? null
        : itemCurrency,
      marketplaceSite,
      marketplaceCertification: {
        status: "UNRESOLVED",
        source: null,
        observedAt: null,
      },
      identityAmbiguous: false,
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
      observedAt,
    }
  }
  const listings = variations.length
    ? variations.map(toListing)
    : [toListing(null)]
  const identityCounts = new Map<string, number>()
  for (const listing of listings) {
    const key = JSON.stringify([listing.variationKey, listing.sku])
    const previous = identityCounts.get(key)
    identityCounts.set(key, previous === undefined ? 1 : previous + 1)
  }
  const variationIdentityUnproven = variations.length > 0 &&
    listings.some((listing) => listing.variationKey === null)
  return listings.map((listing) => ({
    ...listing,
    identityAmbiguous: variationIdentityUnproven ||
      (identityCounts.get(JSON.stringify([
        listing.variationKey,
        listing.sku,
      ])) || 1) > 1,
  }))
}

export function parseEbayTradingGetUser(xml: string) {
  const responses = ebayTradingXmlContainers(xml, "GetUserResponse")
  const response = responses.length === 1 ? responses[0] : ""
  const acknowledgements = ebayTradingXmlDirectChildContainers(response, "Ack")
  const ack = acknowledgements.length === 1
    ? ebayTradingXmlDirectChildValue(response, "Ack")?.toUpperCase() ?? null
    : null
  const users = ebayTradingXmlDirectChildContainers(response, "User")
  const userContainer = users.length === 1 ? users[0] : ""
  const userIds = ebayTradingXmlDirectChildContainers(userContainer, "UserID")
  const userId = userIds.length === 1
    ? safeText(ebayTradingXmlDirectChildValue(userContainer, "UserID"), 200)
    : null
  const sites = ebayTradingXmlDirectChildContainers(userContainer, "Site")
  const site = sites.length === 1
    ? ebayTradingMarketplaceSite(
        ebayTradingXmlDirectChildValue(userContainer, "Site"),
      )
    : null
  const siteValid = sites.length === 0 ||
    (sites.length === 1 && site !== null)
  return {
    accepted: responses.length === 1 && ack === "SUCCESS" &&
      users.length === 1 && Boolean(userId) && siteValid,
    userId,
    site,
  }
}

export function parseEbayTradingGetItemMarketplace(
  xml: string,
  expectedItemId: string,
) {
  const responses = ebayTradingXmlContainers(xml, "GetItemResponse")
  const response = responses.length === 1 ? responses[0] : ""
  const acknowledgements = ebayTradingXmlDirectChildContainers(response, "Ack")
  const ack = acknowledgements.length === 1
    ? ebayTradingXmlDirectChildValue(response, "Ack")?.toUpperCase() ?? null
    : null
  if (responses.length !== 1 || ack !== "SUCCESS") {
    return {
      status: "ERROR" as const,
      itemId: null,
      marketplaceSite: null,
    }
  }
  const items = ebayTradingXmlDirectChildContainers(response, "Item")
  if (items.length !== 1) {
    return {
      status: "ERROR" as const,
      itemId: null,
      marketplaceSite: null,
    }
  }
  const item = items[0]
  const itemIds = ebayTradingXmlDirectChildContainers(item, "ItemID")
  const itemId = itemIds.length === 1
    ? ebayTradingXmlDirectChildValue(item, "ItemID")
    : null
  if (itemId !== expectedItemId) {
    return {
      status: "ITEM_ID_MISMATCH" as const,
      itemId,
      marketplaceSite: null,
    }
  }
  const sites = ebayTradingXmlDirectChildContainers(item, "Site")
  const marketplaceSite = sites.length === 1
    ? ebayTradingMarketplaceSite(
        ebayTradingXmlDirectChildValue(item, "Site"),
      )
    : null
  return {
    status: marketplaceSite === "US"
      ? "US_CERTIFIED" as const
      : marketplaceSite
        ? "NON_US_CERTIFIED" as const
        : "UNRESOLVED" as const,
    itemId,
    marketplaceSite,
  }
}

export function parseEbayTradingGetItemPrimaryImage(
  xml: string,
  expectedItemId: string,
): {
  status: "AVAILABLE" | "MISSING" | "ITEM_ID_MISMATCH" | "ERROR"
  primaryImageUrl: string | null
} {
  const marketplace = parseEbayTradingGetItemMarketplace(xml, expectedItemId)
  if (marketplace.status === "ITEM_ID_MISMATCH") {
    return { status: "ITEM_ID_MISMATCH", primaryImageUrl: null }
  }
  if (marketplace.status !== "US_CERTIFIED" &&
      marketplace.status !== "NON_US_CERTIFIED") {
    return { status: "ERROR", primaryImageUrl: null }
  }
  const items = ebayTradingXmlContainers(xml, "Item")
  if (items.length !== 1 ||
      ebayTradingXmlDirectChildValue(items[0], "ItemID") !== expectedItemId) {
    return { status: "ITEM_ID_MISMATCH", primaryImageUrl: null }
  }
  const pictureDetails = ebayTradingXmlDirectChildContainers(
    items[0],
    "PictureDetails",
  )[0] ?? ""
  const candidate = ebayTradingXmlDirectChildValue(items[0], "GalleryURL") ??
    ebayTradingXmlDirectChildValue(pictureDetails, "GalleryURL") ??
    ebayTradingXmlValue(pictureDetails, "PictureURL")
  const primaryImageUrl = candidate?.startsWith("https://")
    ? candidate.slice(0, 2_000)
    : null
  return primaryImageUrl
    ? { status: "AVAILABLE", primaryImageUrl }
    : { status: "MISSING", primaryImageUrl: null }
}

export function parseEbayTradingGetMyeBaySellingPage(
  xml: string,
  observedAt: string,
): ParsedGetMyeBaySellingPage {
  const responses = ebayTradingXmlContainers(xml, "GetMyeBaySellingResponse")
  const response = responses.length === 1 ? responses[0] : ""
  const acknowledgements = ebayTradingXmlDirectChildContainers(response, "Ack")
  const ack = acknowledgements.length === 1
    ? ebayTradingXmlDirectChildValue(response, "Ack")?.toUpperCase() ?? null
    : null
  const activeLists = ebayTradingXmlDirectChildContainers(
    response,
    "ActiveList",
  )
  const activeList = activeLists.length === 1 ? activeLists[0] : ""
  const paginations = ebayTradingXmlDirectChildContainers(
    activeList,
    "PaginationResult",
  )
  const pagination = paginations.length === 1 ? paginations[0] : ""
  const totalEntryFields = ebayTradingXmlDirectChildContainers(
    pagination,
    "TotalNumberOfEntries",
  )
  const totalPageFields = ebayTradingXmlDirectChildContainers(
    pagination,
    "TotalNumberOfPages",
  )
  const totalEntries = totalEntryFields.length === 1
    ? nonNegativeInteger(ebayTradingXmlDirectChildValue(
        pagination,
        "TotalNumberOfEntries",
      ))
    : null
  const totalPages = totalPageFields.length === 1
    ? nonNegativeInteger(ebayTradingXmlDirectChildValue(
        pagination,
        "TotalNumberOfPages",
      ))
    : null
  const hasMoreFields = ebayTradingXmlDirectChildContainers(
    activeList,
    "HasMoreItems",
  )
  const hasMoreText = hasMoreFields.length === 1
    ? ebayTradingXmlDirectChildValue(activeList, "HasMoreItems")?.toLowerCase()
    : null
  const hasMoreItems = hasMoreText === "true"
    ? true
    : hasMoreText === "false"
      ? false
      : null
  const itemArrays = ebayTradingXmlDirectChildContainers(activeList, "ItemArray")
  const itemArray = itemArrays.length === 1 ? itemArrays[0] : ""
  const items = ebayTradingXmlDirectChildContainers(itemArray, "Item")
  const sourceIdentityConflict = itemArrays.length > 1 || items.some((item) => {
    const itemIds = ebayTradingXmlDirectChildContainers(item, "ItemID")
    const sites = ebayTradingXmlDirectChildContainers(item, "Site")
    return itemIds.length !== 1 ||
      !/^\d{9,20}$/.test(
        ebayTradingXmlDirectChildValue(item, "ItemID") ?? "",
      ) ||
      sites.length > 1 ||
      (sites.length === 1 && ebayTradingMarketplaceSite(
        ebayTradingXmlDirectChildValue(item, "Site"),
      ) === null)
  })
  const paginationMetadataConflict = responses.length !== 1 ||
    acknowledgements.length !== 1 || activeLists.length !== 1 ||
    paginations.length > 1 || totalEntryFields.length > 1 ||
    totalPageFields.length > 1 || hasMoreFields.length > 1 ||
    (hasMoreFields.length === 1 && hasMoreItems === null)
  const listings = items
    .flatMap((item) => itemListings(item, observedAt))
  return {
    accepted: responses.length === 1 && ack === "SUCCESS" &&
      activeLists.length === 1,
    totalEntries,
    totalPages,
    hasMoreItems,
    listings,
    sourceIdentityConflict,
    paginationMetadataConflict,
  }
}

export function parseEbayTradingGetSellerListPage(
  xml: string,
  observedAt: string,
): ParsedGetMyeBaySellingPage {
  const responses = ebayTradingXmlContainers(xml, "GetSellerListResponse")
  const response = responses.length === 1 ? responses[0] : ""
  const acknowledgements = ebayTradingXmlDirectChildContainers(response, "Ack")
  const ack = acknowledgements.length === 1
    ? ebayTradingXmlDirectChildValue(response, "Ack")?.toUpperCase() ?? null
    : null
  const paginations = ebayTradingXmlDirectChildContainers(
    response,
    "PaginationResult",
  )
  const pagination = paginations.length === 1 ? paginations[0] : ""
  const totalEntryFields = ebayTradingXmlDirectChildContainers(
    pagination,
    "TotalNumberOfEntries",
  )
  const totalPageFields = ebayTradingXmlDirectChildContainers(
    pagination,
    "TotalNumberOfPages",
  )
  const totalEntries = totalEntryFields.length === 1
    ? nonNegativeInteger(ebayTradingXmlDirectChildValue(
        pagination,
        "TotalNumberOfEntries",
      ))
    : null
  const totalPages = totalPageFields.length === 1
    ? nonNegativeInteger(ebayTradingXmlDirectChildValue(
        pagination,
        "TotalNumberOfPages",
      ))
    : null
  const hasMoreFields = ebayTradingXmlDirectChildContainers(
    response,
    "HasMoreItems",
  )
  const hasMoreText = hasMoreFields.length === 1
    ? ebayTradingXmlDirectChildValue(response, "HasMoreItems")?.toLowerCase()
    : null
  const hasMoreItems = hasMoreText === "true"
    ? true
    : hasMoreText === "false"
      ? false
      : null
  const itemArrays = ebayTradingXmlDirectChildContainers(response, "ItemArray")
  const itemArray = itemArrays.length === 1 ? itemArrays[0] : ""
  const items = ebayTradingXmlDirectChildContainers(itemArray, "Item")
  const sourceIdentityConflict = itemArrays.length > 1 || items.some((item) => {
    const itemIds = ebayTradingXmlDirectChildContainers(item, "ItemID")
    const sites = ebayTradingXmlDirectChildContainers(item, "Site")
    return itemIds.length !== 1 ||
      !/^\d{9,20}$/.test(
        ebayTradingXmlDirectChildValue(item, "ItemID") ?? "",
      ) ||
      sites.length > 1 ||
      (sites.length === 1 && ebayTradingMarketplaceSite(
        ebayTradingXmlDirectChildValue(item, "Site"),
      ) === null)
  })
  const paginationMetadataConflict = responses.length !== 1 ||
    acknowledgements.length !== 1 || paginations.length > 1 ||
    totalEntryFields.length > 1 || totalPageFields.length > 1 ||
    hasMoreFields.length > 1 ||
    (hasMoreFields.length === 1 && hasMoreItems === null)
  return {
    accepted: responses.length === 1 && ack === "SUCCESS",
    totalEntries,
    totalPages,
    hasMoreItems,
    listings: items.flatMap((item) => itemListings(item, observedAt)),
    sourceIdentityConflict,
    paginationMetadataConflict,
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function jsonText(value: unknown, maximum = 200) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : ""
}

function jsonNumber(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  if (typeof value === "string" && !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function jsonAmount(value: unknown) {
  const source = jsonRecord(value)
  return jsonNumber(Object.hasOwn(source, "value") ? source.value : value)
}

function jsonIso(value: unknown) {
  const candidate = jsonText(value, 50)
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : null
}

function activeRefund(value: unknown) {
  const refund = jsonRecord(value)
  const status = jsonText(
    refund.refundStatus ?? refund.refundState ?? refund.status,
    40,
  ).toUpperCase()
  return !status || !["FAILED", "CANCELLED", "REJECTED"].includes(status)
}

function orderCannotBeFulfilled(order: Record<string, unknown>) {
  const cancel = jsonRecord(order.cancelStatus)
  const cancellationStatus = jsonText(
    cancel.cancelState ?? cancel.cancelStatus,
    40,
  ).toUpperCase()
  return Boolean(cancellationStatus) && ![
    "NONE_REQUESTED",
    "CANCEL_REJECTED",
    "CANCEL_CLOSED_NO_REFUND",
  ].includes(cancellationStatus) ||
    jsonArray(jsonRecord(order.paymentSummary).refunds).some(activeRefund) ||
    jsonArray(order.lineItems).some((line) =>
      jsonArray(jsonRecord(line).refunds).some(activeRefund))
}

export function sanitizeLiveEbayOrders(
  payload: unknown,
): SafeLiveEbayOrder[] {
  return jsonArray(jsonRecord(payload).orders).flatMap((value) => {
    const order = jsonRecord(value)
    const ebayOrderId = jsonText(order.orderId, 100)
    const creationDate = jsonIso(order.creationDate)
    const lastModifiedDate = jsonIso(order.lastModifiedDate)
    const orderPaymentStatus = jsonText(
      order.orderPaymentStatus,
      40,
    ).toUpperCase()
    const orderFulfillmentStatus = jsonText(
      order.orderFulfillmentStatus,
      40,
    ).toUpperCase()
    if (!ebayOrderId || !creationDate || !lastModifiedDate ||
        orderPaymentStatus !== "PAID" ||
        !["NOT_STARTED", "IN_PROGRESS", "FULFILLED"].includes(
          orderFulfillmentStatus,
        ) ||
        orderCannotBeFulfilled(order)) return []
    const total = jsonRecord(jsonRecord(order.pricingSummary).total)
    const rawLineItems = jsonArray(order.lineItems)
    const lineItems = rawLineItems.flatMap((value) => {
      const line = jsonRecord(value)
      const lineItemId = jsonText(line.lineItemId, 100)
      const listingId = jsonText(line.legacyItemId, 20)
      const listingMarketplaceId = jsonText(
        line.listingMarketplaceId,
        40,
      ).toUpperCase()
      const quantity = jsonNumber(line.quantity)
      if (!lineItemId || !/^\d{9,20}$/.test(listingId) ||
          listingMarketplaceId !== "EBAY_US" || quantity === null ||
          !Number.isSafeInteger(quantity) || quantity < 1) {
        return []
      }
      const cost = jsonRecord(line.lineItemCost)
      const instructions = jsonRecord(line.lineItemFulfillmentInstructions)
      const currency = jsonText(cost.currency, 3).toUpperCase()
      return [{
        ebayOrderId,
        lineItemId,
        listingId,
        sku: jsonText(line.sku, 120) || null,
        quantity,
        lineItemAmount: jsonAmount(cost),
        currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
        shipByDate: jsonIso(instructions.shipByDate),
      }]
    })
    // Do not turn a partially valid multi-line Order into a proven partial
    // identity with the original whole-order total.
    if (!rawLineItems.length || lineItems.length !== rawLineItems.length) return []
    const currency = jsonText(total.currency, 3).toUpperCase()
    return [{
      ebayOrderId,
      creationDate,
      lastModifiedDate,
      orderPaymentStatus,
      orderFulfillmentStatus,
      totalAmount: jsonAmount(total),
      currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
      marketplaceId: "EBAY_US" as const,
      lineItems,
    }]
  })
}

export function normalizeLiveDiscoveryCoverage(input: {
  pagesRead: number
  totalPages: number | null
  totalEntries: number | null
  reachedPageLimit: boolean
  pageFailed: boolean
  paginationMetadataConflict?: boolean
  sourceIdentityConflict?: boolean
  reportedItemCountMismatch?: boolean
}) {
  const gapCodes: string[] = []
  if (input.pageFailed) gapCodes.push("SELLER_WIDE_DISCOVERY_PAGE_FAILED")
  if (input.paginationMetadataConflict) {
    gapCodes.push("SELLER_WIDE_PAGINATION_METADATA_CONFLICT")
  }
  if (input.sourceIdentityConflict) {
    gapCodes.push("SELLER_WIDE_SOURCE_IDENTITY_CONFLICT")
  }
  if (input.reportedItemCountMismatch) {
    gapCodes.push("SELLER_WIDE_ITEM_COUNT_RECONCILIATION_FAILED")
  }
  if (input.reachedPageLimit ||
      (input.totalEntries !== null && input.totalEntries >= 25_000)) {
    gapCodes.push("GET_MY_EBAY_SELLING_25000_LIMIT")
  }
  if (input.totalPages === null || input.pagesRead !== input.totalPages) {
    gapCodes.push("SELLER_WIDE_PAGINATION_UNPROVEN")
  }
  if (input.totalEntries === null) {
    gapCodes.push("SELLER_WIDE_TOTAL_ENTRIES_UNPROVEN")
  }
  return {
    status: gapCodes.length === 0 ? "COMPLETE" as const : "PARTIAL" as const,
    gapCodes: [...new Set(gapCodes)],
  }
}
