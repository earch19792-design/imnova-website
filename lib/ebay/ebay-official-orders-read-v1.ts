/**
 * Bounded, PII-free projection of the official eBay Fulfillment Orders read.
 *
 * The network/OAuth boundary remains in ebay-commercial-monitor-live-readonly:
 * this module never receives credentials, URLs, raw eBay payloads, or caller
 * supplied filters.  It only projects that already allowlisted GET result for
 * the Seller OS commercial read surface.
 */

export const SELLER_OS_OFFICIAL_ORDERS_READ_VERSION =
  "SELLER_OS_OFFICIAL_ORDERS_READ_V1" as const

export const SELLER_OS_OFFICIAL_ORDERS_SOURCE =
  "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const

export const SELLER_OS_OFFICIAL_ORDERS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_official_orders",
  title: "Get official eBay Orders evidence",
  description: "Read the fixed canonical seller account's bounded recent eBay Sell Fulfillment Orders evidence. This tool accepts no dates, accounts, URLs, tokens, queries, cursors, or write instructions; excludes buyer PII and never treats Analytics quantitySold as Orders.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

export const SELLER_OS_OFFICIAL_ORDERS_MAXIMUM = 50
export const SELLER_OS_OFFICIAL_ORDER_LINE_ITEMS_MAXIMUM = 20

export type OfficialOrdersSourceStatusV1 =
  | "AVAILABLE"
  | "PARTIAL"
  | "UNAVAILABLE"
  | "AUTHORIZATION_BLOCKED"
  | "UPSTREAM_ERROR"

type SafeFulfillmentOrder = {
  ebayOrderId: string
  creationDate: string
  lastModifiedDate: string
  orderPaymentStatus: string
  orderFulfillmentStatus: string
  marketplaceId: "EBAY_US"
  lineItems: Array<{
    lineItemId: string
    listingId: string | null
    sku: string | null
    quantity: number
  }>
}

type OfficialOrdersReadInputV1 = {
  status: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE"
  observedAt: string | null
  windowStart: string | null
  windowEnd: string | null
  orders: readonly SafeFulfillmentOrder[]
  pagesRead: number
  rawOrdersDiscardedAfterSanitization: number
  gapCodes: readonly string[]
}

type AnalyticsReconciliationInputV1 = {
  status: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE"
  windowStart: string | null
  windowEnd: string | null
  accountTraffic: { quantitySold: number | null } | null
}

function safeIso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null
}

function safeIdentifier(value: unknown, maximum = 120) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim()
    : ""
  return normalized && normalized.length <= maximum &&
      /^[A-Za-z0-9._:!\-]+$/.test(normalized)
    ? normalized
    : null
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null
}

function uniqueCodes(values: readonly string[]) {
  return [...new Set(values.filter((value) =>
    /^[A-Z0-9_]{3,160}$/.test(value)))].sort().slice(0, 20)
}

function sourceStatus(input: OfficialOrdersReadInputV1): OfficialOrdersSourceStatusV1 {
  if (input.status === "CERTIFIED") return "AVAILABLE"
  if (input.status === "PARTIAL") return "PARTIAL"
  const codes = input.gapCodes.join(" ")
  if (/(?:OAUTH|SCOPE|TOKEN|HTTP_401|HTTP_403|_401\b|_403\b|CLIENT_PAIR)/.test(codes)) {
    return "AUTHORIZATION_BLOCKED"
  }
  if (/(?:HTTP_4|HTTP_5|_4\d\d\b|_5\d\d\b|TIMEOUT|NETWORK|RATE|FORMAT_CHANGED|SOURCE_FORMAT)/
    .test(codes)) return "UPSTREAM_ERROR"
  return "UNAVAILABLE"
}

function reconciliation(input: {
  officialStatus: OfficialOrdersSourceStatusV1
  officialQuantity: number | null
  orderWindowStart: string | null
  orderWindowEnd: string | null
  analytics: AnalyticsReconciliationInputV1 | null | undefined
}) {
  const analyticsQuantitySold = input.analytics?.accountTraffic?.quantitySold ?? null
  if (!input.analytics || input.analytics.status === "UNAVAILABLE" ||
      analyticsQuantitySold === null || input.officialQuantity === null ||
      !["AVAILABLE", "PARTIAL"].includes(input.officialStatus)) {
    return { analyticsQuantitySold, reconciliation: "UNAVAILABLE" as const }
  }
  const orderStart = safeIso(input.orderWindowStart)
  const orderEnd = safeIso(input.orderWindowEnd)
  const analyticsStart = safeIso(input.analytics.windowStart)
  const analyticsEnd = safeIso(input.analytics.windowEnd)
  if (!orderStart || !orderEnd || !analyticsStart || !analyticsEnd) {
    return { analyticsQuantitySold, reconciliation: "UNAVAILABLE" as const }
  }
  if (orderStart === analyticsStart && orderEnd === analyticsEnd) {
    return { analyticsQuantitySold,
      reconciliation: analyticsQuantitySold === input.officialQuantity
        ? "MATCHED" as const : "UNEXPLAINED_MISMATCH" as const }
  }
  const endLagMs = Date.parse(orderEnd) - Date.parse(analyticsEnd)
  if (orderStart === analyticsStart && endLagMs > 0 && endLagMs <= 48 * 60 * 60 * 1_000) {
    return { analyticsQuantitySold, reconciliation: "EXPECTED_REPORTING_LAG" as const }
  }
  return { analyticsQuantitySold, reconciliation: "EXPECTED_SCOPE_DIFFERENCE" as const }
}

/**
 * Project the fixed, already-sanitized eBay Fulfillment GET Orders result.
 * No caller can choose a date, page, item, account, endpoint, or credential.
 */
export function buildSellerOsOfficialOrdersReadV1(input: {
  orders: OfficialOrdersReadInputV1
  analytics?: AnalyticsReconciliationInputV1 | null
}) {
  const status = sourceStatus(input.orders)
  const sanitizedOrders = input.orders.orders.flatMap((order) => {
    const orderId = safeIdentifier(order.ebayOrderId)
    const createdAt = safeIso(order.creationDate)
    const lastModifiedAt = safeIso(order.lastModifiedDate)
    if (!orderId || !createdAt || !lastModifiedAt) return []
    const lines = order.lineItems.flatMap((line) => {
      const lineItemId = safeIdentifier(line.lineItemId)
      const itemId = safeIdentifier(line.listingId, 20)
      const quantity = positiveInteger(line.quantity)
      if (!lineItemId || quantity === null) return []
      return [{ lineItemId, itemId, sku: safeIdentifier(line.sku), quantity,
        sourceStatus: status === "AVAILABLE" && itemId
          ? "AVAILABLE" as const : "PARTIAL" as const }]
    })
    if (!lines.length || lines.length !== order.lineItems.length) return []
    const visibleLines = lines.slice(0, SELLER_OS_OFFICIAL_ORDER_LINE_ITEMS_MAXIMUM)
    return [{ orderId, createdAt, lastModifiedAt,
      orderStatus: safeIdentifier(order.orderPaymentStatus, 40),
      fulfillmentStatus: safeIdentifier(order.orderFulfillmentStatus, 40),
      lineItems: visibleLines,
      lineItemsTruncated: lines.length > visibleLines.length,
      observedLineItemQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      marketplaceId: order.marketplaceId,
      source: SELLER_OS_OFFICIAL_ORDERS_SOURCE }]
  })
  const visibleOrders = sanitizedOrders.slice(0, SELLER_OS_OFFICIAL_ORDERS_MAXIMUM)
  const lineItemIdentityPartial = sanitizedOrders.some((order) =>
    order.lineItems.some((line) => line.itemId === null))
  const effectiveStatus = status === "AVAILABLE" && lineItemIdentityPartial
    ? "PARTIAL" as const : status
  const lineItemQuantity = visibleOrders.reduce((sum, order) => sum +
    order.observedLineItemQuantity, 0)
  const exactCountsAvailable = status === "AVAILABLE" &&
    sanitizedOrders.length === input.orders.orders.length &&
    visibleOrders.length === sanitizedOrders.length &&
    input.orders.rawOrdersDiscardedAfterSanitization === 0
  const officialOrderCount = exactCountsAvailable
    ? visibleOrders.length
    : null
  const officialLineItemQuantity = exactCountsAvailable
    ? lineItemQuantity
    : null
  const limitations = uniqueCodes([
    ...input.orders.gapCodes,
    ...(input.orders.rawOrdersDiscardedAfterSanitization > 0
      ? ["OFFICIAL_ORDERS_DISCARDED_AFTER_SANITIZATION"] : []),
    ...(sanitizedOrders.length !== input.orders.orders.length
      ? ["OFFICIAL_ORDERS_INTERNAL_NORMALIZATION_PARTIAL"] : []),
    ...(visibleOrders.length !== sanitizedOrders.length
      ? ["OFFICIAL_ORDERS_RESPONSE_LIMIT_REACHED"] : []),
    ...(lineItemIdentityPartial
      ? ["OFFICIAL_ORDER_LINE_ITEM_IDENTITY_PARTIAL"] : []),
  ])
  const analyticsSummary = reconciliation({ officialStatus: effectiveStatus,
    officialQuantity: officialLineItemQuantity, orderWindowStart: input.orders.windowStart,
    orderWindowEnd: input.orders.windowEnd, analytics: input.analytics })
  return Object.freeze({
    contractVersion: SELLER_OS_OFFICIAL_ORDERS_READ_VERSION,
    source: SELLER_OS_OFFICIAL_ORDERS_SOURCE,
    sourceStatus: effectiveStatus,
    bounded: true as const,
    observedAt: safeIso(input.orders.observedAt),
    sourceUpdatedAt: visibleOrders.map((order) => order.lastModifiedAt)
      .sort().at(-1) ?? null,
    boundedWindow: { start: safeIso(input.orders.windowStart),
      end: safeIso(input.orders.windowEnd), strategy: "FIXED_RECENT_30_DAYS" as const,
      lookbackDays: 30 as const, callerControlled: false as const },
    pagination: { pagesRead: Number.isSafeInteger(input.orders.pagesRead)
      ? Math.max(0, input.orders.pagesRead) : null,
      maximumPages: 10, maximumOrders: SELLER_OS_OFFICIAL_ORDERS_MAXIMUM,
      maximumLineItemsPerOrder: SELLER_OS_OFFICIAL_ORDER_LINE_ITEMS_MAXIMUM,
      ordersTruncated: ["AVAILABLE", "PARTIAL"].includes(effectiveStatus)
        ? visibleOrders.length !== sanitizedOrders.length ||
          input.orders.gapCodes.includes("FULFILLMENT_ORDER_PAGE_LIMIT_REACHED")
        : null },
    officialOrderCount,
    officialLineItemQuantity,
    orders: visibleOrders.map(({ observedLineItemQuantity: _quantity, ...order }) => order),
    reconciliation: { officialOrdersStatus: effectiveStatus, officialOrderCount,
      officialLineItemQuantity, analyticsQuantitySold: analyticsSummary.analyticsQuantitySold,
      analyticsSource: input.analytics && input.analytics.status !== "UNAVAILABLE"
        ? "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" as const : null,
      analyticsWindow: { start: safeIso(input.analytics?.windowStart),
        end: safeIso(input.analytics?.windowEnd) },
      semanticBoundary: "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS" as const,
      reconciliation: analyticsSummary.reconciliation },
    evidenceCompleteness: effectiveStatus === "AVAILABLE" && limitations.length === 0
      ? "COMPLETE" as const : effectiveStatus === "UNAVAILABLE" ||
        effectiveStatus === "AUTHORIZATION_BLOCKED" || effectiveStatus === "UPSTREAM_ERROR"
        ? "UNAVAILABLE" as const : "PARTIAL" as const,
    limitations,
    safety: { readOnly: true as const, buyerPiiIncluded: false as const,
      rawUpstreamPayloadIncluded: false as const,
      credentialsIncluded: false as const, environmentValuesIncluded: false as const,
      arbitraryUrlAllowed: false as const, callerControlledAccountAllowed: false as const,
      databaseWrites: 0 as const,
      marketplaceWrites: 0 as const, inventoryWrites: 0 as const,
      productCaseMutations: 0 as const, lunaLinkMutations: 0 as const,
      whatsappSends: 0 as const },
  })
}

export function reconcileSellerOsOfficialOrdersAnalyticsV1(
  official: ReturnType<typeof buildSellerOsOfficialOrdersReadV1>,
  analytics: AnalyticsReconciliationInputV1 | null,
) {
  const summary = reconciliation({
    officialStatus: official.sourceStatus,
    officialQuantity: official.officialLineItemQuantity,
    orderWindowStart: official.boundedWindow.start,
    orderWindowEnd: official.boundedWindow.end,
    analytics,
  })
  return Object.freeze({
    ...official,
    reconciliation: Object.freeze({
      officialOrdersStatus: official.sourceStatus,
      officialOrderCount: official.officialOrderCount,
      officialLineItemQuantity: official.officialLineItemQuantity,
      analyticsQuantitySold: summary.analyticsQuantitySold,
      analyticsSource: analytics && analytics.status !== "UNAVAILABLE"
        ? "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" as const : null,
      analyticsWindow: Object.freeze({ start: safeIso(analytics?.windowStart),
        end: safeIso(analytics?.windowEnd) }),
      semanticBoundary: "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS" as const,
      reconciliation: summary.reconciliation,
    }),
  })
}

export function createUnavailableSellerOsOfficialOrdersReadV1(
  limitationCode = "OFFICIAL_ORDERS_READ_NOT_AVAILABLE",
) {
  return buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      orders: [],
      pagesRead: 0,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [limitationCode],
    },
    analytics: null,
  })
}

export type SellerOsOfficialOrdersReadV1 = ReturnType<
  typeof buildSellerOsOfficialOrdersReadV1
>
