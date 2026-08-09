export const EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION =
  "EBAY_COMMERCIAL_MONITOR_LIVE_READONLY_V1" as const

export const EBAY_MONITOR_TRADING_READ_OPERATIONS = [
  "GetUser",
  "GetMyeBaySelling",
  "GetItem",
] as const

export type EbayMonitorTradingReadOperation =
  typeof EBAY_MONITOR_TRADING_READ_OPERATIONS[number]

export type EbayMonitorReadonlyOperation =
  | "OAUTH_REFRESH_TRADING"
  | "TRADING_GET_USER"
  | "TRADING_GET_MY_EBAY_SELLING"
  | "TRADING_GET_ITEM_MARKETPLACE"
  | "OAUTH_REFRESH_INVENTORY"
  | "INVENTORY_GET_ITEMS"
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

export type EbayLiveListing = {
  itemId: string
  sku: string | null
  customLabel: string | null
  variationKey: string | null
  title: string | null
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
  ["TRADING_GET_ITEM_MARKETPLACE", {
    method: "POST",
    path: "/ws/api.dll",
  }],
  ["OAUTH_REFRESH_INVENTORY", {
    method: "POST",
    path: "/identity/v1/oauth2/token",
  }],
  ["INVENTORY_GET_ITEMS", {
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
  tradingCallName?: string | null
  tradingHeaderCallName?: string | null
  tradingBody?: string | null
}) {
  const rule = READONLY_REST_PATHS.get(input.operation)
  const url = new URL(input.url)
  if (!rule || input.method !== rule.method ||
      url.origin !== EBAY_PRODUCTION_ORIGIN || url.pathname !== rule.path) {
    throw new Error("EBAY_MONITOR_BLOCKED_NON_READONLY_REQUEST")
  }
  const expectedTradingCall = input.operation === "TRADING_GET_USER"
    ? "GetUser"
    : input.operation === "TRADING_GET_MY_EBAY_SELLING"
      ? "GetMyeBaySelling"
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
          selectors.length !== 2 ||
          selectors[0] !== "Item.ItemID" ||
          selectors[1] !== "Item.Site") {
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
  const sold = nonNegativeInteger(
    ebayTradingXmlValue(selling, "QuantitySold"),
  )
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
        !["NOT_STARTED", "IN_PROGRESS"].includes(orderFulfillmentStatus) ||
        orderCannotBeFulfilled(order)) return []
    const total = jsonRecord(jsonRecord(order.pricingSummary).total)
    const lineItems = jsonArray(order.lineItems).flatMap((value) => {
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
    if (!lineItems.length) return []
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
  ambiguousVariationIdentity?: boolean
  marketplaceScopeConflict?: boolean
  inventoryCompared: boolean
  registryCompared: boolean
  unexplainedDifferenceCount: number
}) {
  const gapCodes: string[] = []
  if (input.pageFailed) gapCodes.push("SELLER_WIDE_DISCOVERY_PAGE_FAILED")
  if (input.paginationMetadataConflict) {
    gapCodes.push("SELLER_WIDE_PAGINATION_METADATA_CONFLICT")
  }
  if (input.ambiguousVariationIdentity) {
    gapCodes.push("SELLER_WIDE_VARIATION_IDENTITY_AMBIGUOUS")
  }
  if (input.marketplaceScopeConflict) {
    gapCodes.push("SELLER_WIDE_LISTING_MARKETPLACE_UNPROVEN_OR_NON_US")
  }
  if (input.reachedPageLimit ||
      (input.totalEntries !== null && input.totalEntries >= 25_000)) {
    gapCodes.push("GET_MY_EBAY_SELLING_25000_LIMIT")
  }
  if (input.totalPages === null || input.pagesRead !== input.totalPages) {
    gapCodes.push("SELLER_WIDE_PAGINATION_UNPROVEN")
  }
  if (!input.inventoryCompared) gapCodes.push("INVENTORY_RECONCILIATION_UNAVAILABLE")
  if (!input.registryCompared) gapCodes.push("REGISTRY_RECONCILIATION_UNAVAILABLE")
  if (input.unexplainedDifferenceCount > 0) {
    gapCodes.push("UNEXPLAINED_LISTING_RECONCILIATION_GAP")
  }
  return {
    status: gapCodes.length === 0 ? "COMPLETE" as const : "PARTIAL" as const,
    gapCodes: [...new Set(gapCodes)],
  }
}
