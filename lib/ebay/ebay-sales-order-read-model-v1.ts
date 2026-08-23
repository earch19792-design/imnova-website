import type {
  CommercialMonitorBackendV1,
} from "./commercial-monitor-readonly-contract"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { SELLER_OS_SALES_ORDER_EVENTS_READ_VERSION, type SellerOsSalesOrderEventsReadV1 } from "./ebay-sales-order-events-read-v1.ts"

export const SELLER_OS_RECENT_SALES_FEED_VERSION =
  "SELLER_OS_RECENT_SALES_FEED_V1" as const

export const SELLER_OS_RECENT_SALES_FEED_TOOL_V1 = Object.freeze({
  name: "seller_os_get_recent_sales_feed",
  title: "Get canonical recent sales feed",
  description: "Project the fixed canonical seller account's bounded official Sales Order Events into one deterministic, PII-free recent-sale entry per eBay order line. This read accepts no account, date, URL, token, cursor, SQL, or write instruction.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

const RECENT_SALES_FEED_MAXIMUM_ENTRIES = 50

function recentFeedStatus(status: SellerOsSalesOrderEventsReadV1["sourceStatus"]) {
  if (status === "AVAILABLE") return "AVAILABLE" as const
  if (status === "PARTIAL") return "PARTIAL" as const
  return "UNAVAILABLE" as const
}

function recentFeedLimitationCodes(values: readonly string[]) {
  return [...new Set(values.filter((value) =>
    /^[A-Z0-9_]{3,160}$/.test(value)))].sort().slice(0, 30)
}

/**
 * Public I03 projection. The older projectRecentSalesFeedV1 below remains the
 * persisted commercial-monitor aggregate (one entry per order). This view is
 * deliberately line-grained so its identity and event linkage remain exactly
 * those certified by the I02 Sales Order Event foundation.
 */
export function buildSellerOsRecentSalesFeedV1(
  salesOrderEvents: SellerOsSalesOrderEventsReadV1,
) {
  const status = recentFeedStatus(salesOrderEvents.sourceStatus)
  if (status === "UNAVAILABLE") {
    return Object.freeze({
      contractVersion: SELLER_OS_RECENT_SALES_FEED_VERSION,
      source: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
      sourceContractVersion: SELLER_OS_SALES_ORDER_EVENTS_READ_VERSION,
      sourceStatus: salesOrderEvents.sourceStatus,
      status,
      observedAt: salesOrderEvents.observedAt,
      bounded: true as const,
      boundedWindow: salesOrderEvents.boundedWindow,
      pagination: Object.freeze({
        maximumEntries: RECENT_SALES_FEED_MAXIMUM_ENTRIES,
        entriesTruncated: null,
        sourceEventsTruncated: salesOrderEvents.pagination.eventsTruncated,
      }),
      feedCount: null,
      observedFeedCount: null,
      entries: Object.freeze([]),
      ordering: ORDERING,
      deduplication: Object.freeze({
        inputEventObservations: null,
        uniqueLogicalEntries: null,
        duplicateObservationsBlocked: 0,
        identityStableAcrossReplay: true as const,
        identityStableAcrossRestart: true as const,
        status: "SOURCE_UNAVAILABLE" as const,
      }),
      persistence: PERSISTENCE,
      authority: AUTHORITY,
      evidenceCompleteness: "UNAVAILABLE" as const,
      limitations: Object.freeze(recentFeedLimitationCodes([
        ...salesOrderEvents.limitations,
        "SALES_ORDER_EVENTS_SOURCE_UNAVAILABLE",
        "NO_EVIDENCE_DOES_NOT_PROVE_ZERO",
      ])),
      safety: READ_SAFETY,
    })
  }

  const authoritative = salesOrderEvents.events.filter((event) =>
    event.source === "EBAY_SELL_FULFILLMENT_GET_ORDERS" &&
    event.provenance.authority === "OFFICIAL_EBAY_ORDER" &&
    event.provenance.analyticsUsedAsOrderEvidence === false)
  const grouped = new Map<string, (typeof authoritative)[number][]>()
  for (const event of authoritative) {
    const group = grouped.get(event.eventId) ?? []
    group.push(event)
    grouped.set(event.eventId, group)
  }
  const projected = [...grouped.values()].map((group) => [...group].sort(
    (left, right) => right.orderLastModifiedAt.localeCompare(
      left.orderLastModifiedAt,
    ) || JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )[0]).sort((left, right) =>
    right.orderCreatedAt.localeCompare(left.orderCreatedAt) ||
    left.eventId.localeCompare(right.eventId))
  const entries = projected.slice(0, RECENT_SALES_FEED_MAXIMUM_ENTRIES).map(
    (event) => Object.freeze({
      readModelId: event.eventId,
      eventId: event.eventId,
      eventVersion: event.eventVersion,
      eventType: event.eventType,
      orderId: event.orderId,
      lineItemId: event.lineItemId,
      itemId: event.itemId,
      sku: event.sku,
      quantity: event.quantity,
      orderCreatedAt: event.orderCreatedAt,
      orderLastModifiedAt: event.orderLastModifiedAt,
      orderStatus: event.orderStatus,
      fulfillmentStatus: event.fulfillmentStatus,
      marketplaceId: event.marketplaceId,
      source: event.source,
      sourceStatus: event.sourceStatus,
      observedAt: event.observedAt,
      provenance: event.provenance,
      eventLinkage: Object.freeze({
        eventId: event.eventId,
        exact: true as const,
        identityGrain:
          "CANONICAL_ACCOUNT_MARKETPLACE_ORDER_LINE_EVENT_VERSION" as const,
      }),
      readModelPersistenceStatus: "DETERMINISTIC_FEED_PROJECTION" as const,
      buyerPiiIncluded: false as const,
    }))
  const nonAuthoritativeExcluded = salesOrderEvents.events.length -
    authoritative.length
  const entriesTruncated = salesOrderEvents.pagination.eventsTruncated === true ||
    projected.length > entries.length
  const exact = status === "AVAILABLE" && !entriesTruncated &&
    nonAuthoritativeExcluded === 0
  const complete = exact && salesOrderEvents.evidenceCompleteness === "COMPLETE"
  return Object.freeze({
    contractVersion: SELLER_OS_RECENT_SALES_FEED_VERSION,
    source: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
    sourceContractVersion: SELLER_OS_SALES_ORDER_EVENTS_READ_VERSION,
    sourceStatus: salesOrderEvents.sourceStatus,
    status,
    observedAt: salesOrderEvents.observedAt,
    bounded: true as const,
    boundedWindow: salesOrderEvents.boundedWindow,
    pagination: Object.freeze({
      maximumEntries: RECENT_SALES_FEED_MAXIMUM_ENTRIES,
      entriesTruncated,
      sourceEventsTruncated: salesOrderEvents.pagination.eventsTruncated,
    }),
    feedCount: exact ? entries.length : null,
    observedFeedCount: entries.length,
    entries: Object.freeze(entries),
    ordering: ORDERING,
    deduplication: Object.freeze({
      inputEventObservations: salesOrderEvents.events.length,
      uniqueLogicalEntries: grouped.size,
      duplicateObservationsBlocked: authoritative.length - grouped.size,
      identityStableAcrossReplay: true as const,
      identityStableAcrossRestart: true as const,
      status: entriesTruncated || nonAuthoritativeExcluded > 0
        ? "PARTIAL" as const : "DETERMINISTIC" as const,
    }),
    persistence: PERSISTENCE,
    authority: AUTHORITY,
    evidenceCompleteness: complete ? "COMPLETE" as const : "PARTIAL" as const,
    limitations: Object.freeze(recentFeedLimitationCodes([
      ...salesOrderEvents.limitations,
      ...(entriesTruncated ? ["RECENT_SALES_FEED_RESPONSE_TRUNCATED"] : []),
      ...(nonAuthoritativeExcluded > 0
        ? ["NON_AUTHORITATIVE_SALES_EVENT_EXCLUDED"] : []),
    ])),
    safety: READ_SAFETY,
  })
}

const ORDERING = Object.freeze({
  primary: "ORDER_CREATED_AT_DESC" as const,
  tieBreaker: "EVENT_ID_ASC" as const,
  observedAtUsedForOrdering: false as const,
  deterministic: true as const,
})

const PERSISTENCE = Object.freeze({
  status: "DETERMINISTIC_FEED_PROJECTION" as const,
  existingDurableReadModel:
    "MARKETPLACE_ORDER_SNAPSHOTS_AND_ORDER_LINE_ITEMS" as const,
  durableNaturalKey:
    "CANONICAL_ACCOUNT_MARKETPLACE_ORDER_ID_LINE_ITEM_ID" as const,
  durableReadModelMaintainedByThisRead: false as const,
  eventIdDurablyPersistedByThisRead: false as const,
  databaseWrites: 0 as const,
})

const AUTHORITY = Object.freeze({
  officialOrdersOnly: true as const,
  salesOrderEventsOnly: true as const,
  analyticsUsedAsSaleRowEvidence: false as const,
  semanticBoundary:
    "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS" as const,
})

const READ_SAFETY = Object.freeze({
  readOnly: true as const,
  buyerPiiIncluded: false as const,
  rawUpstreamPayloadIncluded: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  arbitraryUrlAllowed: false as const,
  callerControlledAccountAllowed: false as const,
  callerControlledTokenAllowed: false as const,
  databaseWrites: 0 as const,
  marketplaceWrites: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  lunaLinkMutations: 0 as const,
  whatsappSends: 0 as const,
  buyerMessageSends: 0 as const,
})

export type SellerOsRecentSalesFeedV1 = ReturnType<
  typeof buildSellerOsRecentSalesFeedV1
>

type SourceStatus = "AVAILABLE" | "PARTIAL" | "ERROR"

type OrderRow = {
  marketplace_order_id: string
  order_created_at: string
  payment_status: string
  fulfillment_status: string
  total_amount: number | string | null
  currency: string | null
  source: string
  observed_at: string
}

type OrderLineRow = {
  marketplace_order_id: string
  marketplace_line_item_id: string
  listing_id: string
  product_title?: string | null
  quantity: number | string
  line_item_amount: number | string | null
  currency: string | null
}

type SaleEventRow = {
  id: string
  event_type: string
  evidence: unknown
  detected_at: string
  marketplace_order_id: string | null
}

type DeliveryRow = {
  commercial_event_id: string | null
  channel: string
  status: string
}

export type RecentSalesProjectionInputV1 = {
  orders: { status: SourceStatus; rows: readonly OrderRow[]; limitationCode: string | null }
  orderLines: { status: SourceStatus; rows: readonly OrderLineRow[]; limitationCode: string | null }
  saleEvents: { status: SourceStatus; rows: readonly SaleEventRow[]; limitationCode: string | null }
  saleDeliveries: { status: SourceStatus; rows: readonly DeliveryRow[]; limitationCode: string | null }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeText(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const safe = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/Bearer\s+[^\s"'<]+/gi, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  return safe || null
}

function safeIdentifier(value: unknown, maximum = 120) {
  const safe = safeText(value, maximum)
  return safe && /^[A-Za-z0-9._:!\-]+$/.test(safe) ? safe : null
}

function safeItemId(value: unknown) {
  const safe = safeText(value, 20)
  return safe && /^\d{9,20}$/.test(safe) ? safe : null
}

function safeIso(value: unknown) {
  const safe = safeText(value, 50)
  return safe && Number.isFinite(Date.parse(safe))
    ? new Date(safe).toISOString()
    : null
}

function nonnegative(value: unknown) {
  const parsed = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = nonnegative(value)
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : 0
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort()
}

function eventEvidence(event: SaleEventRow | undefined) {
  const evidence = record(event?.evidence)
  const nestedSale = record(evidence.saleEvent)
  return { evidence, nestedSale }
}

function attributionStatus(event: SaleEventRow | undefined, sourceStatus: SourceStatus) {
  if (sourceStatus === "ERROR") return "UNAVAILABLE" as const
  if (!event) return "UNPROVEN" as const
  const { evidence, nestedSale } = eventEvidence(event)
  const candidate = safeText(
    nestedSale.attributionStatus ?? evidence.attributionStatus,
    30,
  )?.toUpperCase()
  if (candidate === "PROVEN" || candidate === "PARTIAL" ||
      candidate === "AMBIGUOUS" || candidate === "UNPROVEN" ||
      candidate === "UNAVAILABLE") return candidate
  return evidence.itemIdVerified === true ? "PROVEN" as const : "UNPROVEN" as const
}

function buyerMessageStatus(events: readonly SaleEventRow[], sourceStatus: SourceStatus) {
  if (sourceStatus === "ERROR") return "UNAVAILABLE" as const
  const audit = events.find((event) =>
    event.event_type === "POST_PURCHASE_THANK_YOU_MESSAGE_AUDIT")
  if (!audit) return "UNPROVEN" as const
  const evidence = record(audit.evidence)
  const status = safeText(evidence.deliveryStatus ?? evidence.status, 40)
    ?.toUpperCase()
  if (status === "SENT" || status === "SKIPPED" || status === "FAILED" ||
      status === "BLOCKED" || status === "UNAVAILABLE") return status
  return "UNPROVEN" as const
}

function whatsappStatus(
  saleEvent: SaleEventRow | undefined,
  events: readonly SaleEventRow[],
  deliveries: readonly DeliveryRow[],
  sourceStatus: SourceStatus,
) {
  if (sourceStatus === "ERROR") return "UNAVAILABLE" as const
  const delivery = saleEvent ? deliveries.find((row) =>
    row.commercial_event_id === saleEvent.id && row.channel === "whatsapp")
    : undefined
  if (delivery) {
    const status = safeText(delivery.status, 40)?.toLowerCase()
    if (status === "delivered") return "ACCEPTED_BY_META" as const
    if (status === "pending" || status === "leased") return "QUEUED" as const
    if (status === "failed" || status === "dead_letter") return "FAILED" as const
    if (status === "cancelled") return "DEFERRED" as const
  }
  const audit = events.find((event) =>
    event.event_type === "WHATSAPP_SALE_NOTIFICATION_AUDIT")
  if (audit) {
    const evidence = record(audit.evidence)
    const status = safeText(evidence.deliveryStatus ?? evidence.status, 60)
      ?.toUpperCase()
    if (status === "FAILED") return "FAILED" as const
    if (status === "SKIPPED" || status === "HISTORICAL_RECOVERY_SKIPPED" ||
        status === "DEFERRED" || status === "ALREADY_SENT") {
      return "DEFERRED" as const
    }
    if (status === "UNAVAILABLE") return "UNAVAILABLE" as const
    if (status === "QUEUED" || evidence.queued === true) return "QUEUED" as const
    const reasonCodes = Array.isArray(evidence.reasonCodes)
      ? evidence.reasonCodes.map((value) => safeText(value, 80)?.toUpperCase())
      : []
    if (reasonCodes.some((reason) => reason?.includes("UNAVAILABLE"))) {
      return "UNAVAILABLE" as const
    }
    if (reasonCodes.some((reason) => reason?.includes("SKIPPED") ||
        reason?.includes("BLOCKED") || reason?.includes("DUPLICATE"))) {
      return "DEFERRED" as const
    }
  }
  return "UNPROVEN" as const
}

function supplierStockStatus(events: readonly SaleEventRow[], sourceStatus: SourceStatus) {
  if (sourceStatus === "ERROR") return "UNAVAILABLE" as const
  const audit = events.find((event) =>
    event.event_type === "SALE_TRIGGERED_STOCK_RECHECK")
  if (!audit) return "UNPROVEN" as const
  const evidence = record(audit.evidence)
  const nested = record(evidence.stockRecheck)
  const state = safeText(nested.state ?? evidence.state, 60)?.toUpperCase()
  if (state === "STOCK_REFRESH_REQUEST_READY") return "REFRESH_REQUEST_READY" as const
  if (state === "SUPPLIER_RECHECK_PENDING_LINK") {
    return "SUPPLIER_RECHECK_PENDING_LINK" as const
  }
  if (state === "STOCK_RECHECK_BLOCKED_ATTRIBUTION") return "BLOCKED" as const
  if (state === "UNAVAILABLE") return "UNAVAILABLE" as const
  return "UNPROVEN" as const
}

/**
 * @deprecated Legacy commercial-monitor order-grained aggregate. Do not add
 * new consumers. The certified line-grained owner is
 * buildSellerOsRecentSalesFeedV1; migrate the dashboard only through a
 * separately reviewed compatibility delta so persisted history is preserved.
 */
export function projectRecentSalesFeedV1(
  input: RecentSalesProjectionInputV1,
): CommercialMonitorBackendV1["recentSales"] {
  const limitationCodes = unique([
    input.orders.limitationCode,
    input.orderLines.limitationCode,
    input.saleEvents.limitationCode,
    input.saleDeliveries.limitationCode,
  ])
  if (input.orders.status === "ERROR") {
    return {
      contractVersion: "RECENT_SALES_FEED_V1",
      status: "UNAVAILABLE",
      resultCount: null,
      entries: [],
      maximumEntries: 10,
      truncated: false,
      limitationCodes: limitationCodes.length
        ? limitationCodes
        : ["PERSISTED_ORDER_SOURCE_UNAVAILABLE"],
      source: "PERSISTED_OFFICIAL_EBAY_ORDER_EVENTS",
      buyerPiiIncluded: false,
    }
  }

  const linesByOrder = new Map<string, OrderLineRow[]>()
  for (const line of input.orderLines.rows) {
    const orderId = safeIdentifier(line.marketplace_order_id)
    if (!orderId) continue
    const group = linesByOrder.get(orderId) ?? []
    group.push(line)
    linesByOrder.set(orderId, group)
  }
  const eventsByOrder = new Map<string, SaleEventRow[]>()
  for (const event of input.saleEvents.rows) {
    const orderId = safeIdentifier(event.marketplace_order_id)
    if (!orderId) continue
    const group = eventsByOrder.get(orderId) ?? []
    group.push(event)
    eventsByOrder.set(orderId, group)
  }

  type RecentSaleEntry = CommercialMonitorBackendV1["recentSales"]["entries"][number]
  const nonAuthoritativeOrderCount = input.orders.rows.filter((order) =>
    safeText(order.source, 80) !== "EBAY_SELL_FULFILLMENT_GET_ORDERS").length
  const projected = input.orders.rows.flatMap<RecentSaleEntry>((order) => {
    if (safeText(order.source, 80) !== "EBAY_SELL_FULFILLMENT_GET_ORDERS") {
      return []
    }
    const orderId = safeIdentifier(order.marketplace_order_id)
    const soldAt = safeIso(order.order_created_at)
    if (!orderId || !soldAt) return []
    const lines = [...(linesByOrder.get(orderId) ?? [])].sort((left, right) =>
      String(left.marketplace_line_item_id).localeCompare(
        String(right.marketplace_line_item_id),
      ))
    const events = [...(eventsByOrder.get(orderId) ?? [])].sort((left, right) =>
      String(right.detected_at).localeCompare(String(left.detected_at)))
    const saleEvent = events.find((event) => event.event_type === "SALE_DETECTED")
    const titles = unique(lines.map((line) => safeText(line.product_title, 300)))
    const lineQuantities = lines.map((line) => positiveInteger(line.quantity))
    const quantity = input.orderLines.status === "ERROR" || !lines.length ||
        lineQuantities.some((value) => value === 0)
      ? null
      : lineQuantities.reduce((sum, value) => sum + value, 0)
    return [{
      orderId,
      orderLineItemIds: unique(lines.map((line) =>
        safeIdentifier(line.marketplace_line_item_id))),
      itemIds: unique(lines.map((line) => safeItemId(line.listing_id))),
      listingTitle: titles.length === 1
        ? titles[0]
        : titles.length > 1
          ? `${titles.length} productos`
          : null,
      quantity,
      orderTotal: nonnegative(order.total_amount),
      currency: safeText(order.currency, 3)?.toUpperCase() ?? null,
      soldAt,
      paymentState: safeText(order.payment_status, 40)?.toUpperCase() ?? "UNPROVEN",
      fulfillmentState: safeText(order.fulfillment_status, 40)?.toUpperCase() ??
        "UNPROVEN",
      attributionStatus: attributionStatus(saleEvent, input.saleEvents.status),
      buyerMessageStatus: buyerMessageStatus(events, input.saleEvents.status),
      whatsappNotificationStatus: whatsappStatus(
        saleEvent,
        events,
        input.saleDeliveries.rows,
        input.saleDeliveries.status,
      ),
      supplierStockStatus: supplierStockStatus(events, input.saleEvents.status),
      evidenceReference: `EBAY_ORDER:${orderId}`,
      buyerPiiIncluded: false as const,
    }]
  }).sort((left, right) =>
    right.soldAt.localeCompare(left.soldAt) || left.orderId.localeCompare(right.orderId))

  const entries = projected.slice(0, 10)
  const sourcePartial = input.orders.status === "PARTIAL" ||
    input.orderLines.status !== "AVAILABLE" ||
    input.saleEvents.status !== "AVAILABLE" ||
    input.saleDeliveries.status !== "AVAILABLE" || nonAuthoritativeOrderCount > 0
  return {
    contractVersion: "RECENT_SALES_FEED_V1",
    status: sourcePartial ? "PARTIAL" : "AVAILABLE",
    resultCount: input.orders.status === "AVAILABLE" &&
        nonAuthoritativeOrderCount === 0
      ? projected.length
      : null,
    entries,
    maximumEntries: 10,
    truncated: projected.length > entries.length,
    limitationCodes: unique([
      ...limitationCodes,
      nonAuthoritativeOrderCount > 0
        ? "NON_AUTHORITATIVE_ORDER_SOURCE_EXCLUDED"
        : null,
    ]),
    source: "PERSISTED_OFFICIAL_EBAY_ORDER_EVENTS",
    buyerPiiIncluded: false,
  }
}
