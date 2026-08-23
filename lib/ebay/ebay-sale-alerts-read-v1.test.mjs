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

const { buildSellerOsOfficialOrdersReadV1,
  createUnavailableSellerOsOfficialOrdersReadV1 } = await import(
  "./ebay-official-orders-read-v1.ts"
)
const { buildSellerOsSalesOrderEventsReadV1 } = await import(
  "./ebay-sales-order-events-read-v1.ts"
)
const { buildSellerOsRecentSalesFeedV1 } = await import(
  "./ebay-sales-order-read-model-v1.ts"
)
const { buildSellerOsSaleAlertsReadV1,
  SELLER_OS_SALE_ALERT_ACTIVATION_CUTOVER_AT } = await import(
  "./ebay-sale-alerts-read-v1.ts"
)

function officialOrder(overrides = {}) {
  return {
    ebayOrderId: "ORDER-1",
    creationDate: "2026-08-20T12:00:00.000Z",
    lastModifiedDate: "2026-08-20T13:00:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    marketplaceId: "EBAY_US",
    lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
      sku: "SKU-ONE", quantity: 1 }],
    ...overrides,
  }
}

function recentFeed(orders, overrides = {}) {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-22T12:00:00.000Z",
      windowStart: "2026-07-23T12:00:00.000Z",
      windowEnd: "2026-08-22T12:00:00.000Z",
      orders,
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
      ...overrides,
    },
    analytics: null,
  })
  return buildSellerOsRecentSalesFeedV1(
    buildSellerOsSalesOrderEventsReadV1(official),
  )
}

test("I04 creates one deterministic line-grained alert and preserves quantity", () => {
  const result = buildSellerOsSaleAlertsReadV1(recentFeed([
    officialOrder({ lineItems: [
      { lineItemId: "LINE-1", listingId: "366575102453",
        sku: "SKU-ONE", quantity: 3 },
      { lineItemId: "LINE-2", listingId: "366575102454",
        sku: null, quantity: 1 },
    ] }),
  ]))

  assert.equal(result.contractVersion, "SELLER_OS_SALE_ALERTS_READ_V1")
  assert.equal(result.alertCount, 2)
  assert.equal(result.alerts.length, 2)
  assert.equal(result.alerts.find((alert) => alert.lineItemId === "LINE-1").quantity,
    3)
  assert.equal(result.alerts.find((alert) => alert.lineItemId === "LINE-2").sku,
    null)
  assert.equal(new Set(result.alerts.map((alert) => alert.alertId)).size, 2)
  assert.ok(result.alerts.every((alert) =>
    alert.eventId === alert.correlation.eventId &&
    alert.correlation.businessFactId === alert.eventId))
})

test("I04 blocks 100 replays and status changes keep one alert identity", () => {
  const initial = recentFeed([officialOrder()])
  const updated = recentFeed([officialOrder({
    lastModifiedDate: "2026-08-21T14:00:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "FULFILLED",
  })])
  const replayed = { ...updated,
    entries: [...Array.from({ length: 100 }, () => initial.entries[0]),
      updated.entries[0]],
    observedFeedCount: 101,
  }
  const first = buildSellerOsSaleAlertsReadV1(replayed)
  const afterRestart = buildSellerOsSaleAlertsReadV1(replayed)

  assert.equal(first.alerts.length, 1)
  assert.equal(first.alerts[0].fulfillmentStatus, "FULFILLED")
  assert.equal(first.deduplication.duplicateObservationsBlocked, 100)
  assert.equal(first.alerts[0].alertId, afterRestart.alerts[0].alertId)
  assert.equal(first.alerts[0].eventId, initial.entries[0].eventId)
  assert.equal(first.alerts[0].workflowStep.state, "SUCCEEDED")
  assert.equal(first.alerts[0].workflowStep.stepExecutionId,
    afterRestart.alerts[0].workflowStep.stepExecutionId)
})

test("I04 distinguishes historical replay from post-activation detection", () => {
  const result = buildSellerOsSaleAlertsReadV1(recentFeed([
    officialOrder({ ebayOrderId: "ORDER-HISTORICAL",
      creationDate: "2026-08-20T12:00:00.000Z" }),
    officialOrder({ ebayOrderId: "ORDER-NEW",
      creationDate: "2026-08-21T04:00:00.000Z",
      lastModifiedDate: "2026-08-21T05:00:00.000Z",
      lineItems: [{ lineItemId: "LINE-NEW", listingId: "366575102455",
        sku: "NEW", quantity: 1 }] }),
  ]))

  assert.equal(result.historicalReplayPolicy.activationCutoverAt,
    SELLER_OS_SALE_ALERT_ACTIVATION_CUTOVER_AT)
  assert.equal(result.historicalReplayPolicy.historicalAlertCount, 1)
  assert.equal(result.historicalReplayPolicy.newlyDetectedAlertCount, 1)
  assert.equal(result.alerts.find((alert) =>
    alert.orderId === "ORDER-HISTORICAL").detectionClass, "HISTORICAL_REPLAY")
  assert.equal(result.alerts.find((alert) =>
    alert.orderId === "ORDER-NEW").detectionClass,
  "NEWLY_DETECTED_AFTER_I04_ACTIVATION")
  assert.ok(result.alerts.every((alert) =>
    alert.notificationDisposition.whatsappSendAllowed === false &&
    alert.notificationDisposition.buyerMessageSendAllowed === false))
})

test("I04 zero is authoritative only after an available official read", () => {
  const empty = buildSellerOsSaleAlertsReadV1(recentFeed([]))
  const unavailableFeed = buildSellerOsRecentSalesFeedV1(
    buildSellerOsSalesOrderEventsReadV1(
      createUnavailableSellerOsOfficialOrdersReadV1(
        "LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE",
      ),
    ),
  )
  const unavailable = buildSellerOsSaleAlertsReadV1(unavailableFeed)

  assert.equal(empty.status, "AVAILABLE")
  assert.equal(empty.alertCount, 0)
  assert.deepEqual(empty.alerts, [])
  assert.equal(unavailable.status, "UNAVAILABLE")
  assert.equal(unavailable.alertCount, null)
  assert.equal(unavailable.observedAlertCount, null)
  assert.ok(unavailable.limitations.includes("NO_EVIDENCE_DOES_NOT_PROVE_ZERO"))
})

test("I04 is bounded, excludes Analytics/PII and exposes no write authority", () => {
  const feed = recentFeed(Array.from({ length: 52 }, (_, index) =>
    officialOrder({
      ebayOrderId: `ORDER-${String(index).padStart(3, "0")}`,
      creationDate: new Date(Date.parse("2026-08-21T04:00:00.000Z") +
        index * 1_000).toISOString(),
      lastModifiedDate: new Date(Date.parse("2026-08-21T05:00:00.000Z") +
        index * 1_000).toISOString(),
      lineItems: [{ lineItemId: `LINE-${index}`, listingId: "366575102453",
        sku: null, quantity: 1 }],
    })))
  const poisoned = { ...feed.entries[0],
    source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    buyer: { name: "Private Buyer", email: "buyer@example.test" },
    rawUpstreamPayload: { accessToken: "secret-value" } }
  const result = buildSellerOsSaleAlertsReadV1({ ...feed,
    entries: [...feed.entries, poisoned] })
  const serialized = JSON.stringify(result)

  assert.equal(result.alerts.length, 50)
  assert.equal(result.alertCount, null)
  assert.equal(result.pagination.maximumAlerts, 50)
  assert.equal(result.pagination.alertsTruncated, true)
  assert.ok(result.limitations.includes("NON_AUTHORITATIVE_FEED_ENTRY_EXCLUDED"))
  assert.doesNotMatch(serialized,
    /Private Buyer|buyer@example\.test|secret-value|"buyer"|"accessToken"/)
  assert.equal(result.authority.analyticsUsedAsAlertEvidence, false)
  assert.equal(result.authority.semanticBoundary,
    "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS")
  assert.deepEqual({
    databaseWrites: result.safety.databaseWrites,
    marketplaceWrites: result.safety.marketplaceWrites,
    inventoryWrites: result.safety.inventoryWrites,
    productCaseMutations: result.safety.productCaseMutations,
    lunaLinkMutations: result.safety.lunaLinkMutations,
    whatsappSends: result.safety.whatsappSends,
    buyerMessageSends: result.safety.buyerMessageSends,
    paymentTransactions: result.safety.paymentTransactions,
  }, {
    databaseWrites: 0,
    marketplaceWrites: 0,
    inventoryWrites: 0,
    productCaseMutations: 0,
    lunaLinkMutations: 0,
    whatsappSends: 0,
    buyerMessageSends: 0,
    paymentTransactions: 0,
  })
})

test("I04 uses canonical feed/event ownership and deterministic IDs, not legacy grain", () => {
  const source = readFileSync(new URL("./ebay-sale-alerts-read-v1.ts",
    import.meta.url), "utf8")
  const workflow = readFileSync(new URL(
    "./ebay-seller-os-workflow-foundation-v1.ts", import.meta.url), "utf8")

  assert.match(source, /SELLER_OS_RECENT_SALES_FEED_V1/)
  assert.match(source, /ROOT_SALES_ORDER_EVENT_ID/)
  assert.match(source, /SELLER_OS_CORRELATION_ENVELOPE_V1|buildSellerOsCorrelationEnvelopeV1/)
  assert.match(workflow, /SELLER_OS_WORKFLOW_STEP_EXECUTION_V1/)
  assert.doesNotMatch(source,
    /projectRecentSalesFeedV1|eventType:\s*["']SALE_DETECTED|randomUUID|alert_delivery_outbox/)
  assert.doesNotMatch(source,
    /\.(?:insert|update|upsert|delete|rpc)\s*\(|\bfetch\s*\(/)
})
