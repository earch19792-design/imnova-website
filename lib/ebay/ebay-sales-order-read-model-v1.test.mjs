import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const { buildSellerOsRecentSalesFeedV1, projectRecentSalesFeedV1 } = await import(
  "./ebay-sales-order-read-model-v1.ts"
)
const { buildSellerOsOfficialOrdersReadV1,
  createUnavailableSellerOsOfficialOrdersReadV1 } = await import(
  "./ebay-official-orders-read-v1.ts"
)
const { buildSellerOsSalesOrderEventsReadV1 } = await import(
  "./ebay-sales-order-events-read-v1.ts"
)
const { buildOrderSourceHealthV1 } = await import(
  "./ebay-sales-order-event-foundation-v1.ts"
)

const order = {
  marketplace_order_id: "649000000000!260000000001",
  order_created_at: "2026-08-13T14:04:00.000Z",
  payment_status: "PAID",
  fulfillment_status: "NOT_STARTED",
  total_amount: 29.99,
  currency: "USD",
  source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
  observed_at: "2026-08-13T14:05:00.000Z",
}

const line = {
  marketplace_order_id: order.marketplace_order_id,
  marketplace_line_item_id: "LINE-1",
  listing_id: "366575102453",
  product_title:
    "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling",
  quantity: 1,
  line_item_amount: 29.99,
  currency: "USD",
}

const saleEvent = {
  id: "event-sale-1",
  event_type: "SALE_DETECTED",
  evidence: { attributionStatus: "PROVEN", buyerEmail: undefined },
  detected_at: "2026-08-13T14:05:00.000Z",
  marketplace_order_id: order.marketplace_order_id,
  marketplace_line_item_id: null,
}

function source(rows, status = "AVAILABLE", limitationCode = null) {
  return { status, rows, limitationCode }
}

function certifiedEvents(orders) {
  return buildSellerOsSalesOrderEventsReadV1(buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-20T18:00:00.000Z",
      windowStart: "2026-07-21T18:00:00.000Z",
      windowEnd: "2026-08-20T18:00:00.000Z",
      orders,
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  }))
}

function officialOrder(overrides = {}) {
  return {
    ebayOrderId: "15-12345-12345",
    creationDate: "2026-08-19T12:00:00.000Z",
    lastModifiedDate: "2026-08-19T13:00:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    marketplaceId: "EBAY_US",
    lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
      sku: "CUSTOM-LABEL", quantity: 1 }],
    ...overrides,
  }
}

test("I03 projects one deterministic line-grained feed entry per official event", () => {
  const events = certifiedEvents([officialOrder({ lineItems: [
    { lineItemId: "LINE-1", listingId: "366575102453", sku: "ONE", quantity: 3 },
    { lineItemId: "LINE-2", listingId: null, sku: null, quantity: 1 },
  ] })])
  const result = buildSellerOsRecentSalesFeedV1(events)

  assert.equal(result.contractVersion, "SELLER_OS_RECENT_SALES_FEED_V1")
  assert.equal(result.status, "PARTIAL")
  assert.equal(result.feedCount, null)
  assert.equal(result.observedFeedCount, 2)
  assert.equal(result.entries.length, 2)
  assert.equal(result.entries.find((entry) => entry.lineItemId === "LINE-1").quantity, 3)
  assert.equal(result.entries.find((entry) => entry.lineItemId === "LINE-2").sku, null)
  assert.equal(result.entries.find((entry) => entry.lineItemId === "LINE-2").itemId,
    null)
  assert.equal(new Set(result.entries.map((entry) => entry.eventId)).size, 2)
  assert.ok(result.entries.every((entry) =>
    entry.readModelId === entry.eventId && entry.eventLinkage.exact))
  assert.equal(result.persistence.status, "DETERMINISTIC_FEED_PROJECTION")
  assert.equal(result.persistence.databaseWrites, 0)
})

test("I03 blocks 100 replay observations and keeps status updates on one identity", () => {
  const initial = certifiedEvents([officialOrder()])
  const updated = certifiedEvents([officialOrder({
    lastModifiedDate: "2026-08-20T15:00:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "FULFILLED",
  })])
  assert.equal(initial.events[0].eventId, updated.events[0].eventId)
  const input = { ...updated,
    events: [...Array.from({ length: 100 }, () => initial.events[0]),
      updated.events[0]],
    observedEventCount: 101,
  }
  const result = buildSellerOsRecentSalesFeedV1(input)

  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].eventId, initial.events[0].eventId)
  assert.equal(result.entries[0].fulfillmentStatus, "FULFILLED")
  assert.equal(result.deduplication.duplicateObservationsBlocked, 100)
  assert.equal(result.deduplication.identityStableAcrossReplay, true)
  assert.equal(result.deduplication.identityStableAcrossRestart, true)
})

test("I03 ordering is creation DESC then eventId ASC and repeat-stable", () => {
  const sameTime = "2026-08-19T12:00:00.000Z"
  const events = certifiedEvents([
    officialOrder({ ebayOrderId: "ORDER-B", creationDate: sameTime,
      lineItems: [{ lineItemId: "LINE-B", listingId: "366575102454",
        sku: "B", quantity: 1 }] }),
    officialOrder({ ebayOrderId: "ORDER-A", creationDate: sameTime,
      lineItems: [{ lineItemId: "LINE-A", listingId: "366575102453",
        sku: "A", quantity: 1 }] }),
    officialOrder({ ebayOrderId: "ORDER-NEW",
      creationDate: "2026-08-20T12:00:00.000Z",
      lineItems: [{ lineItemId: "LINE-NEW", listingId: "366575102455",
        sku: "NEW", quantity: 1 }] }),
  ])
  const first = buildSellerOsRecentSalesFeedV1(events)
  const second = buildSellerOsRecentSalesFeedV1(events)
  const ids = first.entries.map((entry) => entry.eventId)

  assert.equal(first.entries[0].orderId, "ORDER-NEW")
  assert.deepEqual(ids.slice(1), [...ids.slice(1)].sort())
  assert.deepEqual(second.entries.map((entry) => entry.eventId), ids)
  assert.equal(first.ordering.observedAtUsedForOrdering, false)
  assert.equal(first.ordering.deterministic, true)
})

test("I03 preserves unavailable as unknown and never creates rows from Analytics", () => {
  const unavailableEvents = buildSellerOsSalesOrderEventsReadV1(
    createUnavailableSellerOsOfficialOrdersReadV1(
      "LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE",
    ),
  )
  const result = buildSellerOsRecentSalesFeedV1(unavailableEvents)

  assert.equal(result.status, "UNAVAILABLE")
  assert.equal(result.feedCount, null)
  assert.equal(result.observedFeedCount, null)
  assert.deepEqual(result.entries, [])
  assert.ok(result.limitations.includes("NO_EVIDENCE_DOES_NOT_PROVE_ZERO"))
  assert.equal(result.authority.analyticsUsedAsSaleRowEvidence, false)
  assert.equal(result.authority.semanticBoundary,
    "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS")
})

test("I03 feed is bounded, rejects non-authoritative events and strips PII/raw secrets", () => {
  const events = certifiedEvents(Array.from({ length: 52 }, (_, index) =>
    officialOrder({
      ebayOrderId: `ORDER-${String(index).padStart(3, "0")}`,
      creationDate: new Date(Date.parse("2026-08-01T00:00:00.000Z") +
        index * 1_000).toISOString(),
      lineItems: [{ lineItemId: `LINE-${index}`, listingId: "366575102453",
        sku: null, quantity: 1 }],
    })))
  const poisoned = { ...events.events[0], source: "ANALYTICS_QUANTITY_SOLD",
    buyer: { name: "Private Buyer", email: "buyer@example.test" },
    rawUpstreamPayload: { accessToken: "secret-value" } }
  const result = buildSellerOsRecentSalesFeedV1({ ...events,
    events: [...events.events, poisoned] })
  const serialized = JSON.stringify(result)

  assert.equal(result.entries.length, 50)
  assert.equal(result.feedCount, null)
  assert.equal(result.pagination.maximumEntries, 50)
  assert.equal(result.pagination.entriesTruncated, true)
  assert.ok(result.limitations.includes("NON_AUTHORITATIVE_SALES_EVENT_EXCLUDED"))
  assert.doesNotMatch(serialized,
    /Private Buyer|buyer@example\.test|secret-value|"buyer"|"accessToken"/)
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.rawUpstreamPayloadIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.environmentValuesIncluded, false)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.inventoryWrites, 0)
  assert.equal(result.safety.whatsappSends, 0)
  assert.equal(result.safety.buyerMessageSends, 0)
})

test("projects a bounded PII-free authoritative recent sale", () => {
  const result = projectRecentSalesFeedV1({
    orders: source([order]),
    orderLines: source([line]),
    saleEvents: source([
      saleEvent,
      {
        ...saleEvent,
        id: "event-message-1",
        event_type: "POST_PURCHASE_THANK_YOU_MESSAGE_AUDIT",
        evidence: { status: "BLOCKED" },
      },
      {
        ...saleEvent,
        id: "event-stock-1",
        event_type: "SALE_TRIGGERED_STOCK_RECHECK",
        evidence: { state: "SUPPLIER_RECHECK_PENDING_LINK" },
      },
    ]),
    saleDeliveries: source([{
      commercial_event_id: saleEvent.id,
      channel: "whatsapp",
      status: "delivered",
      delivered_at: "2026-08-13T14:06:00.000Z",
      last_error_code: null,
    }]),
  })

  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.resultCount, 1)
  assert.equal(result.maximumEntries, 10)
  assert.equal(result.entries[0].itemIds[0], "366575102453")
  assert.equal(result.entries[0].orderId, "649000000000!260000000001")
  assert.equal(result.entries[0].attributionStatus, "PROVEN")
  assert.equal(result.entries[0].buyerMessageStatus, "BLOCKED")
  assert.equal(result.entries[0].whatsappNotificationStatus, "ACCEPTED_BY_META")
  assert.equal(result.entries[0].supplierStockStatus,
    "SUPPLIER_RECHECK_PENDING_LINK")
  assert.equal(result.entries[0].buyerPiiIncluded, false)
  assert.doesNotMatch(JSON.stringify(result), /buyerEmail|@example\.com/i)
})

test("WhatsApp audit preserves proven unavailable or deferred state without outbox", () => {
  const unavailable = projectRecentSalesFeedV1({
    orders: source([order]),
    orderLines: source([line]),
    saleEvents: source([saleEvent, {
      ...saleEvent,
      id: "event-whatsapp-audit-1",
      event_type: "WHATSAPP_SALE_NOTIFICATION_AUDIT",
      evidence: {
        status: "UNAVAILABLE",
        reasonCodes: ["WHATSAPP_CAPABILITY_UNAVAILABLE"],
      },
    }]),
    saleDeliveries: source([]),
  })
  assert.equal(unavailable.entries[0].whatsappNotificationStatus,
    "UNAVAILABLE")

  const deferred = projectRecentSalesFeedV1({
    orders: source([order]),
    orderLines: source([line]),
    saleEvents: source([saleEvent, {
      ...saleEvent,
      id: "event-whatsapp-audit-2",
      event_type: "WHATSAPP_SALE_NOTIFICATION_AUDIT",
      evidence: { status: "HISTORICAL_RECOVERY_SKIPPED" },
    }]),
    saleDeliveries: source([]),
  })
  assert.equal(deferred.entries[0].whatsappNotificationStatus, "DEFERRED")
})

test("unavailable persisted source remains null instead of a false zero", () => {
  const result = projectRecentSalesFeedV1({
    orders: source([], "ERROR", "COMMERCIAL_ORDER_READ_FAILED"),
    orderLines: source([]),
    saleEvents: source([]),
    saleDeliveries: source([]),
  })

  assert.equal(result.status, "UNAVAILABLE")
  assert.equal(result.resultCount, null)
  assert.deepEqual(result.entries, [])
})

test("partial order coverage never presents an incomplete result count as zero", () => {
  const result = projectRecentSalesFeedV1({
    orders: source([], "PARTIAL", "COMMERCIAL_ORDERS_RESULT_LIMIT_REACHED"),
    orderLines: source([]),
    saleEvents: source([]),
    saleDeliveries: source([]),
  })

  assert.equal(result.status, "PARTIAL")
  assert.equal(result.resultCount, null)
  assert.deepEqual(result.entries, [])
})

test("non-authoritative order rows cannot enter the sales feed", () => {
  const result = projectRecentSalesFeedV1({
    orders: source([{ ...order, source: "ACCOUNT_TRAFFIC_INFERENCE" }]),
    orderLines: source([line]),
    saleEvents: source([saleEvent]),
    saleDeliveries: source([]),
  })

  assert.equal(result.status, "PARTIAL")
  assert.equal(result.resultCount, null)
  assert.deepEqual(result.entries, [])
  assert.ok(result.limitationCodes.includes(
    "NON_AUTHORITATIVE_ORDER_SOURCE_EXCLUDED"))
})

test("independent audit-source failure remains unavailable, never a success state", () => {
  const result = projectRecentSalesFeedV1({
    orders: source([order]),
    orderLines: source([line]),
    saleEvents: source([], "ERROR", "COMMERCIAL_SALE_EVENT_READ_FAILED"),
    saleDeliveries: source([], "ERROR", "COMMERCIAL_SALE_DELIVERY_READ_FAILED"),
  })

  assert.equal(result.status, "PARTIAL")
  assert.equal(result.resultCount, 1)
  assert.equal(result.entries[0].attributionStatus, "UNAVAILABLE")
  assert.equal(result.entries[0].buyerMessageStatus, "UNAVAILABLE")
  assert.equal(result.entries[0].whatsappNotificationStatus, "UNAVAILABLE")
  assert.equal(result.entries[0].supplierStockStatus, "UNAVAILABLE")
})

test("recent feed is bounded to ten newest authoritative orders", () => {
  const orders = Array.from({ length: 12 }, (_, index) => ({
    ...order,
    marketplace_order_id: `ORDER-${String(index).padStart(2, "0")}`,
    order_created_at: new Date(Date.parse(order.order_created_at) + index * 1_000)
      .toISOString(),
  }))
  const result = projectRecentSalesFeedV1({
    orders: source(orders),
    orderLines: source([]),
    saleEvents: source([]),
    saleDeliveries: source([]),
  })

  assert.equal(result.resultCount, 12)
  assert.equal(result.entries.length, 10)
  assert.equal(result.truncated, true)
  assert.equal(result.entries[0].orderId, "ORDER-11")
})

test("order source health is official bounded polling and never claims realtime", () => {
  const available = buildOrderSourceHealthV1({
    status: "AVAILABLE",
    permissionStatus: "PROVEN",
    pollIntervalMinutes: 5,
    observedAt: order.observed_at,
  })
  const pending = buildOrderSourceHealthV1({
    status: "UNAVAILABLE",
    permissionStatus: "UNPROVEN",
    pollIntervalMinutes: 5,
    observedAt: null,
  })

  assert.equal(available.capability, "EBAY_SELL_FULFILLMENT_GET_ORDERS")
  assert.equal(available.detectionMode, "POLLING")
  assert.equal(available.pollIntervalMinutes, 5)
  assert.equal(available.bounded, true)
  assert.equal(pending.permissionStatus, "UNPROVEN")
  assert.equal(pending.observedAt, null)
})

test("repository bounds global fanout and does not select unused provider identifiers", () => {
  const repository = readFileSync(new URL(
    "./commercial-monitor-readonly-repository.ts",
    import.meta.url,
  ), "utf8")
  const salesAuditRepository = readFileSync(new URL(
    "./ebay-sales-order-readonly-audit-repository-v1.ts",
    import.meta.url,
  ), "utf8")
  assert.match(repository, /const remaining = maximum \+ 1 - rows\.length/)
  assert.match(repository, /SANITIZED_ORDER_LINE_ITEMS_RESULT_LIMIT_REACHED/)
  assert.doesNotMatch(repository,
    /commercial_alert_events|alert_delivery_outbox/)
  assert.match(salesAuditRepository,
    /const remaining = DELIVERY_AUDIT_MAXIMUM \+ 1 - rows\.length/)
  assert.match(salesAuditRepository,
    /COMMERCIAL_SALE_DELIVERY_AUDIT_RESULT_LIMIT_REACHED/)
  assert.match(salesAuditRepository,
    /\.select\("id,event_type,evidence,detected_at,marketplace_order_id"\)/)
  assert.match(salesAuditRepository, /"WHATSAPP_SALE_NOTIFICATION_AUDIT"/)
  assert.match(salesAuditRepository,
    /\.select\("commercial_event_id,channel,status"\)/)
  assert.doesNotMatch(salesAuditRepository,
    /\.select\([^\n]*provider_message_id/)
  assert.doesNotMatch(salesAuditRepository,
    /\.select\([^\n]*deduplication_key/)
  assert.doesNotMatch(salesAuditRepository,
    /buyer_(?:name|email|address|phone)|shipping_address/i)
  assert.doesNotMatch(salesAuditRepository,
    /\.(?:insert|update|upsert|delete|rpc)\s*\(|\bfetch\s*\(/)
})

test("existing durable order-line read model has a natural idempotent upsert key", () => {
  const service = readFileSync(new URL(
    "./ebay-commercial-monitor-service.ts",
    import.meta.url,
  ), "utf8")
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260715120000_create_marketplace_commercial_monitor_v1.sql",
    import.meta.url,
  ), "utf8")

  assert.match(migration,
    /marketplace_order_line_items_identity unique \([\s\S]*marketplace_account_key,[\s\S]*marketplace,[\s\S]*marketplace_order_id,[\s\S]*marketplace_line_item_id/)
  assert.match(service,
    /from\("marketplace_order_line_items"\)[\s\S]*onConflict: "marketplace_account_key,marketplace,marketplace_order_id,marketplace_line_item_id"/)
})
