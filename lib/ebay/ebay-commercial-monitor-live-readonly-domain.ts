export const EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION =
  "EBAY_COMMERCIAL_MONITOR_LIVE_READONLY_V1" as const

export const EBAY_MONITOR_TRADING_READ_OPERATIONS = [
  "GetUser",
  "GetMyeBaySelling",
] as const

export type EbayMonitorTradingReadOperation =
  typeof EBAY_MONITOR_TRADING_READ_OPERATIONS[number]

export type EbayMonitorReadonlyOperation =
  | "OAUTH_REFRESH_TRADING"
  | "TRADING_GET_USER"
  | "TRADING_GET_MY_EBAY_SELLING"
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
  identityAmbiguous: boolean
  source: "EBAY_TRADING_GET_MY_EBAY_SELLING"
  observedAt: string
}

export type ParsedGetMyeBaySellingPage = {
  accepted: boolean
  totalEntries: number | null
  totalPages: number | null
  hasMoreItems: boolean | null
  listings: EbayLiveListing[]
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
  const itemId = ebayTradingXmlValue(item, "ItemID")
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
      marketplaceSite: safeLabel(
        ebayTradingXmlValue(item, "Site"),
        20,
      )?.toUpperCase() ?? null,
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
  const ack = ebayTradingXmlValue(xml, "Ack")?.toUpperCase() ?? null
  const userContainer = ebayTradingXmlContainers(xml, "User")[0] ?? ""
  const userId = safeText(ebayTradingXmlValue(userContainer, "UserID"), 200)
  const site = safeLabel(ebayTradingXmlValue(userContainer, "Site"), 20)
    ?.toUpperCase() ?? null
  return {
    accepted: ack === "SUCCESS" && Boolean(userId),
    userId,
    site,
  }
}

export function parseEbayTradingGetMyeBaySellingPage(
  xml: string,
  observedAt: string,
): ParsedGetMyeBaySellingPage {
  const ack = ebayTradingXmlValue(xml, "Ack")?.toUpperCase() ?? null
  const activeList = ebayTradingXmlContainers(xml, "ActiveList")[0] ?? ""
  const pagination = ebayTradingXmlContainers(
    activeList,
    "PaginationResult",
  )[0] ?? ""
  const totalEntries = nonNegativeInteger(
    ebayTradingXmlValue(pagination, "TotalNumberOfEntries"),
  )
  const totalPages = nonNegativeInteger(
    ebayTradingXmlValue(pagination, "TotalNumberOfPages"),
  )
  const hasMoreText = ebayTradingXmlValue(activeList, "HasMoreItems")
    ?.toLowerCase()
  const hasMoreItems = hasMoreText === "true"
    ? true
    : hasMoreText === "false"
      ? false
      : null
  const itemArray = ebayTradingXmlContainers(activeList, "ItemArray")[0] ?? ""
  const listings = ebayTradingXmlContainers(itemArray, "Item")
    .flatMap((item) => itemListings(item, observedAt))
  return {
    accepted: ack === "SUCCESS",
    totalEntries,
    totalPages,
    hasMoreItems,
    listings,
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
