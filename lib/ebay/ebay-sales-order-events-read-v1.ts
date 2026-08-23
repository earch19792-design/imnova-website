// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { ORDER_EVENT_IDEMPOTENCY_VERSION, ORDER_EVENT_INGESTION_VERSION, orderEventIdempotencyKeyV1 } from "./ebay-sales-order-event-foundation-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { SELLER_OS_OFFICIAL_ORDERS_READ_VERSION, SELLER_OS_OFFICIAL_ORDERS_SOURCE, type OfficialOrdersSourceStatusV1, type SellerOsOfficialOrdersReadV1 } from "./ebay-official-orders-read-v1.ts"

export const SELLER_OS_SALES_ORDER_EVENTS_READ_VERSION =
  "SELLER_OS_SALES_ORDER_EVENTS_READ_V1" as const

export const SELLER_OS_SALES_ORDER_EVENTS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_sales_order_events",
  title: "Get canonical Sales Order Events",
  description: "Project the fixed canonical seller account's bounded official eBay Fulfillment Orders into one deterministic, replay-safe, PII-free event per official line item. This read accepts no account, date, URL, token, cursor, SQL, or write instruction.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

export const SELLER_OS_CANONICAL_EBAY_ACCOUNT_BINDING_V1 =
  "SELLER_OS_CANONICAL_EBAY_SELLER" as const
const EVENT_TYPE = "AUTHORITATIVE_ORDER_LINE_OBSERVED" as const
const MAXIMUM_EVENTS = 1_000

export function sellerOsSalesOrderEventIdentityV1(input: {
  marketplaceId: string
  orderId: string
  lineItemId: string
}) {
  return orderEventIdempotencyKeyV1(
    `${SELLER_OS_CANONICAL_EBAY_ACCOUNT_BINDING_V1}:${input.marketplaceId}`,
    input.orderId,
    input.lineItemId,
  )
}

function unavailableStatus(status: OfficialOrdersSourceStatusV1) {
  return status === "UNAVAILABLE" || status === "AUTHORIZATION_BLOCKED" ||
    status === "UPSTREAM_ERROR"
}

function uniqueCodes(values: readonly string[]) {
  return [...new Set(values.filter((value) =>
    /^[A-Z0-9_]{3,160}$/.test(value)))].sort().slice(0, 30)
}

export function buildSellerOsSalesOrderEventsReadV1(
  officialOrders: SellerOsOfficialOrdersReadV1,
) {
  if (unavailableStatus(officialOrders.sourceStatus)) {
    return Object.freeze({
      contractVersion: SELLER_OS_SALES_ORDER_EVENTS_READ_VERSION,
      eventVersion: ORDER_EVENT_INGESTION_VERSION,
      idempotencyPolicyVersion: ORDER_EVENT_IDEMPOTENCY_VERSION,
      eventType: EVENT_TYPE,
      source: SELLER_OS_OFFICIAL_ORDERS_SOURCE,
      sourceStatus: officialOrders.sourceStatus,
      observedAt: officialOrders.observedAt,
      projectionType: "DETERMINISTIC_EVENT_PROJECTION" as const,
      persistenceStatus: "NOT_PERSISTED_BY_THIS_READ" as const,
      bounded: true as const,
      boundedWindow: officialOrders.boundedWindow,
      pagination: Object.freeze({ ...officialOrders.pagination,
        maximumEvents: MAXIMUM_EVENTS, eventsTruncated: null }),
      eventCount: null,
      observedEventCount: null,
      events: Object.freeze([]),
      deduplication: Object.freeze({
        inputLineObservations: null,
        uniqueLogicalEvents: null,
        duplicateObservationsBlocked: 0,
        identityStableAcrossReplay: true as const,
        identityStableAcrossRestart: true as const,
        status: "SOURCE_UNAVAILABLE" as const,
      }),
      authority: Object.freeze({
        officialOrdersOnly: true as const,
        analyticsUsedAsOrderEvidence: false as const,
        semanticBoundary:
          "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS" as const,
      }),
      evidenceCompleteness: "UNAVAILABLE" as const,
      limitations: Object.freeze(uniqueCodes([
        ...officialOrders.limitations,
        "OFFICIAL_ORDER_EVENT_SOURCE_UNAVAILABLE",
        "NO_EVIDENCE_DOES_NOT_PROVE_ZERO",
      ])),
      safety: SAFETY,
    })
  }

  const observations = officialOrders.orders.flatMap((order) =>
    order.lineItems.map((line) => {
      const eventId = sellerOsSalesOrderEventIdentityV1({ marketplaceId: order.marketplaceId,
        orderId: order.orderId, lineItemId: line.lineItemId })
      return Object.freeze({
        eventVersion: ORDER_EVENT_INGESTION_VERSION,
        eventType: EVENT_TYPE,
        eventId,
        source: SELLER_OS_OFFICIAL_ORDERS_SOURCE,
        sourceStatus: officialOrders.sourceStatus === "PARTIAL" ||
            line.sourceStatus === "PARTIAL"
          ? "PARTIAL" as const : "AVAILABLE" as const,
        orderId: order.orderId,
        lineItemId: line.lineItemId,
        itemId: line.itemId,
        sku: line.sku,
        quantity: line.quantity,
        orderCreatedAt: order.createdAt,
        orderLastModifiedAt: order.lastModifiedAt,
        orderStatus: order.orderStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        marketplaceId: order.marketplaceId,
        observedAt: officialOrders.observedAt,
        provenance: Object.freeze({
          authority: "OFFICIAL_EBAY_ORDER" as const,
          sourceContractVersion: SELLER_OS_OFFICIAL_ORDERS_READ_VERSION,
          sourceOperation: "GET_ORDERS" as const,
          accountBinding: "CANONICAL_SELLER_OS_ACCOUNT" as const,
          evidenceReference:
            `EBAY_ORDER_LINE:${order.orderId}:${line.lineItemId}`,
          analyticsUsedAsOrderEvidence: false as const,
        }),
        replay: Object.freeze({
          idempotencyKey: eventId,
          identityGrain:
            "CANONICAL_ACCOUNT_MARKETPLACE_ORDER_LINE_EVENT_VERSION" as const,
          replaySafe: true as const,
          restartStable: true as const,
          processingTimestampUsedInIdentity: false as const,
          orderLastModifiedAtUsedInIdentity: false as const,
        }),
        buyerPiiIncluded: false as const,
      })
    }))
  const grouped = new Map<string, (typeof observations)[number][]>()
  for (const event of observations) {
    const group = grouped.get(event.eventId) ?? []
    group.push(event)
    grouped.set(event.eventId, group)
  }
  const events = [...grouped.values()].map((group) => [...group].sort(
    (left, right) => right.orderLastModifiedAt.localeCompare(
      left.orderLastModifiedAt,
    ) || JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )[0]).sort((left, right) =>
    right.orderCreatedAt.localeCompare(left.orderCreatedAt) ||
    left.orderId.localeCompare(right.orderId) ||
    left.lineItemId.localeCompare(right.lineItemId)).slice(0, MAXIMUM_EVENTS)
  const sourceTruncated = officialOrders.pagination.ordersTruncated === true ||
    officialOrders.orders.some((order) => order.lineItemsTruncated)
  const eventsTruncated = sourceTruncated || grouped.size > events.length
  const exactProjectionCount = officialOrders.sourceStatus === "AVAILABLE" &&
    !eventsTruncated
  const complete = exactProjectionCount &&
    officialOrders.evidenceCompleteness === "COMPLETE"
  const limitations = uniqueCodes([
    ...officialOrders.limitations,
    ...(eventsTruncated ? ["SALES_ORDER_EVENTS_RESPONSE_TRUNCATED"] : []),
    ...(officialOrders.sourceStatus === "PARTIAL"
      ? ["OFFICIAL_ORDER_EVENT_SOURCE_PARTIAL"] : []),
  ])
  return Object.freeze({
    contractVersion: SELLER_OS_SALES_ORDER_EVENTS_READ_VERSION,
    eventVersion: ORDER_EVENT_INGESTION_VERSION,
    idempotencyPolicyVersion: ORDER_EVENT_IDEMPOTENCY_VERSION,
    eventType: EVENT_TYPE,
    source: SELLER_OS_OFFICIAL_ORDERS_SOURCE,
    sourceStatus: officialOrders.sourceStatus,
    observedAt: officialOrders.observedAt,
    projectionType: "DETERMINISTIC_EVENT_PROJECTION" as const,
    persistenceStatus: "NOT_PERSISTED_BY_THIS_READ" as const,
    bounded: true as const,
    boundedWindow: officialOrders.boundedWindow,
    pagination: Object.freeze({ ...officialOrders.pagination,
      maximumEvents: MAXIMUM_EVENTS, eventsTruncated }),
    eventCount: exactProjectionCount ? events.length : null,
    observedEventCount: events.length,
    events: Object.freeze(events),
    deduplication: Object.freeze({
      inputLineObservations: observations.length,
      uniqueLogicalEvents: events.length,
      duplicateObservationsBlocked: observations.length - grouped.size,
      identityStableAcrossReplay: true as const,
      identityStableAcrossRestart: true as const,
      status: eventsTruncated ? "PARTIAL" as const : "DETERMINISTIC" as const,
    }),
    authority: Object.freeze({
      officialOrdersOnly: true as const,
      analyticsUsedAsOrderEvidence: false as const,
      semanticBoundary:
        "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS" as const,
    }),
    evidenceCompleteness: complete ? "COMPLETE" as const : "PARTIAL" as const,
    limitations: Object.freeze(limitations),
    safety: SAFETY,
  })
}

const SAFETY = Object.freeze({
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

export function createUnavailableSellerOsSalesOrderEventsReadV1(
  officialOrders: SellerOsOfficialOrdersReadV1,
) {
  return buildSellerOsSalesOrderEventsReadV1(officialOrders)
}

export type SellerOsSalesOrderEventsReadV1 = ReturnType<
  typeof buildSellerOsSalesOrderEventsReadV1
>
