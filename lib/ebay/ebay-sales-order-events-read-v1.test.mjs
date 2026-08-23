import assert from "node:assert/strict"
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

const { buildSellerOsOfficialOrdersReadV1,
  createUnavailableSellerOsOfficialOrdersReadV1 } = await import(
  "./ebay-official-orders-read-v1.ts")
const { buildSellerOsSalesOrderEventsReadV1,
  SELLER_OS_SALES_ORDER_EVENTS_READ_VERSION } = await import(
  "./ebay-sales-order-events-read-v1.ts")

const OBSERVED_AT = "2026-08-20T20:00:00.000Z"

function line(overrides = {}) {
  return { lineItemId: "LINE-1", listingId: "366575102453",
    sku: "SKU-1", quantity: 1, ...overrides }
}

function order(overrides = {}) {
  return {
    ebayOrderId: "15-12345-12345",
    creationDate: "2026-08-19T12:00:00.000Z",
    lastModifiedDate: "2026-08-19T13:00:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    marketplaceId: "EBAY_US",
    lineItems: [line()],
    ...overrides,
  }
}

function official(orders = [order()]) {
  return buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: OBSERVED_AT,
      windowStart: "2026-07-21T20:00:00.000Z",
      windowEnd: OBSERVED_AT,
      orders,
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: {
      status: "CERTIFIED",
      windowStart: "2026-07-21T20:00:00.000Z",
      windowEnd: OBSERVED_AT,
      accountTraffic: { quantitySold: 99 },
    },
  })
}

test("projects one deterministic official sale event per line item", () => {
  const result = buildSellerOsSalesOrderEventsReadV1(official())

  assert.equal(result.contractVersion,
    SELLER_OS_SALES_ORDER_EVENTS_READ_VERSION)
  assert.equal(result.source, "EBAY_SELL_FULFILLMENT_GET_ORDERS")
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.eventCount, 1)
  assert.equal(result.events[0].eventType,
    "AUTHORITATIVE_ORDER_LINE_OBSERVED")
  assert.match(result.events[0].eventId, /^commercial-v1:[0-9a-f]{64}$/)
  assert.equal(result.events[0].orderId, "15-12345-12345")
  assert.equal(result.events[0].lineItemId, "LINE-1")
  assert.equal(result.events[0].itemId, "366575102453")
  assert.equal(result.events[0].sku, "SKU-1")
  assert.equal(result.events[0].quantity, 1)
  assert.equal(result.events[0].provenance.authority,
    "OFFICIAL_EBAY_ORDER")
  assert.equal(result.projectionType, "DETERMINISTIC_EVENT_PROJECTION")
  assert.equal(result.persistenceStatus, "NOT_PERSISTED_BY_THIS_READ")
})

test("multiple lines produce distinct events while quantity stays on one line event", () => {
  const result = buildSellerOsSalesOrderEventsReadV1(official([order({
    lineItems: [line({ lineItemId: "LINE-A", quantity: 3 }),
      line({ lineItemId: "LINE-B", listingId: null, sku: null, quantity: 2 })],
  })]))

  assert.equal(result.observedEventCount, 2)
  assert.equal(result.events[0].eventId === result.events[1].eventId, false)
  assert.deepEqual(result.events.map((event) => event.quantity).sort(), [2, 3])
  const missing = result.events.find((event) => event.lineItemId === "LINE-B")
  assert.equal(missing.itemId, null)
  assert.equal(missing.sku, null)
  assert.equal(missing.sourceStatus, "PARTIAL")
})

test("one hundred identical replays collapse to one logical event", () => {
  const base = official()
  const replayed = { ...base,
    orders: Array.from({ length: 100 }, () => base.orders[0]) }
  const result = buildSellerOsSalesOrderEventsReadV1(replayed)

  assert.equal(result.observedEventCount, 1)
  assert.equal(result.deduplication.inputLineObservations, 100)
  assert.equal(result.deduplication.uniqueLogicalEvents, 1)
  assert.equal(result.deduplication.duplicateObservationsBlocked, 99)
  assert.equal(result.deduplication.identityStableAcrossReplay, true)
  assert.equal(result.deduplication.identityStableAcrossRestart, true)
})

test("restart, last-modified and fulfillment changes preserve event identity", () => {
  const first = buildSellerOsSalesOrderEventsReadV1(official())
  const changed = buildSellerOsSalesOrderEventsReadV1(official([order({
    lastModifiedDate: "2026-08-20T10:00:00.000Z",
    orderFulfillmentStatus: "FULFILLED",
  })]))
  const restarted = buildSellerOsSalesOrderEventsReadV1(official())

  assert.equal(changed.events[0].eventId, first.events[0].eventId)
  assert.equal(restarted.events[0].eventId, first.events[0].eventId)
  assert.equal(changed.events[0].fulfillmentStatus, "FULFILLED")
  assert.equal(changed.events[0].replay.orderLastModifiedAtUsedInIdentity, false)
})

test("different orders and different lines cannot collide", () => {
  const result = buildSellerOsSalesOrderEventsReadV1(official([
    order({ ebayOrderId: "ORDER-A", lineItems: [line({ lineItemId: "LINE-A" }),
      line({ lineItemId: "LINE-B" })] }),
    order({ ebayOrderId: "ORDER-B", lineItems: [line({ lineItemId: "LINE-A" })] }),
  ]))
  assert.equal(result.events.length, 3)
  assert.equal(new Set(result.events.map((event) => event.eventId)).size, 3)
})

test("unavailable official source never turns Analytics into events or zero", () => {
  const unavailable = createUnavailableSellerOsOfficialOrdersReadV1(
    "LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE",
  )
  const input = { ...unavailable, reconciliation: {
    ...unavailable.reconciliation, analyticsQuantitySold: 3,
  } }
  const result = buildSellerOsSalesOrderEventsReadV1(input)

  assert.equal(result.sourceStatus, "UNAVAILABLE")
  assert.equal(result.eventCount, null)
  assert.equal(result.observedEventCount, null)
  assert.deepEqual(result.events, [])
  assert.equal(result.authority.analyticsUsedAsOrderEvidence, false)
  assert.equal(result.authority.semanticBoundary,
    "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS")
  assert.ok(result.limitations.includes("NO_EVIDENCE_DOES_NOT_PROVE_ZERO"))
})

test("a successful authoritative empty window proves zero events", () => {
  const result = buildSellerOsSalesOrderEventsReadV1(official([]))
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.eventCount, 0)
  assert.equal(result.observedEventCount, 0)
  assert.deepEqual(result.events, [])
})

test("projection is bounded and reports upstream truncation explicitly", () => {
  const base = official()
  const truncated = { ...base,
    pagination: { ...base.pagination, ordersTruncated: true } }
  const result = buildSellerOsSalesOrderEventsReadV1(truncated)
  assert.equal(result.bounded, true)
  assert.equal(result.pagination.maximumPages, 10)
  assert.equal(result.pagination.maximumOrders, 50)
  assert.equal(result.pagination.maximumLineItemsPerOrder, 20)
  assert.equal(result.pagination.maximumEvents, 1_000)
  assert.equal(result.pagination.eventsTruncated, true)
  assert.equal(result.eventCount, null)
  assert.equal(result.evidenceCompleteness, "PARTIAL")
})

test("an available untruncated source keeps an exact projection count while limitations stay partial", () => {
  const base = official()
  const limited = { ...base, evidenceCompleteness: "PARTIAL",
    limitations: ["ORDERS_WINDOW_CHECKOUT_COMPLETE_ONLY"] }
  const result = buildSellerOsSalesOrderEventsReadV1(limited)
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.eventCount, 1)
  assert.equal(result.evidenceCompleteness, "PARTIAL")
  assert.deepEqual(result.limitations, ["ORDERS_WINDOW_CHECKOUT_COMPLETE_ONLY"])
})

test("public event projection excludes PII, raw payloads and credentials", () => {
  const base = official()
  const poisoned = { ...base, orders: base.orders.map((value) => ({ ...value,
    buyer: { name: "Secret Buyer", email: "buyer@example.test",
      shippingAddress: "private" },
    accessToken: "SECRET_ACCESS_TOKEN",
    rawUpstreamPayload: { payment: "private" },
  })) }
  const result = buildSellerOsSalesOrderEventsReadV1(poisoned)
  const serialized = JSON.stringify(result)

  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.rawUpstreamPayloadIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.environmentValuesIncluded, false)
  assert.equal(result.safety.databaseWrites, 0)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.inventoryWrites, 0)
  assert.equal(result.safety.productCaseMutations, 0)
  assert.equal(result.safety.lunaLinkMutations, 0)
  assert.equal(result.safety.whatsappSends, 0)
  assert.equal(result.safety.buyerMessageSends, 0)
  assert.doesNotMatch(serialized,
    /Secret Buyer|buyer@example|"shippingAddress"|SECRET_ACCESS_TOKEN|"rawUpstreamPayload"|"payment"/i)
})
