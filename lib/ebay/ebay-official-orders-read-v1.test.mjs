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

const {
  buildSellerOsOfficialOrdersReadV1,
  reconcileSellerOsOfficialOrdersAnalyticsV1,
  SELLER_OS_OFFICIAL_ORDERS_READ_VERSION,
} = await import("./ebay-official-orders-read-v1.ts")

const WINDOW_START = "2026-08-01T00:00:00.000Z"
const WINDOW_END = "2026-08-20T00:00:00.000Z"

function order(overrides = {}) {
  return {
    ebayOrderId: "15-12345-12345",
    creationDate: "2026-08-12T10:00:00.000Z",
    lastModifiedDate: "2026-08-12T11:00:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    marketplaceId: "EBAY_US",
    lineItems: [{
      lineItemId: "1234567890!1001!2001",
      listingId: "366575102453",
      sku: "IMN-LST-000020",
      quantity: 2,
    }],
    ...overrides,
  }
}

function input(overrides = {}) {
  return {
    orders: {
      status: "CERTIFIED",
      observedAt: WINDOW_END,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      orders: [order()],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
      ...overrides.orders,
    },
    analytics: {
      status: "CERTIFIED",
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      accountTraffic: { quantitySold: 2 },
      ...overrides.analytics,
    },
  }
}

test("projects bounded official Fulfillment Orders without buyer PII", () => {
  const result = buildSellerOsOfficialOrdersReadV1(input())

  assert.equal(result.contractVersion, SELLER_OS_OFFICIAL_ORDERS_READ_VERSION)
  assert.equal(result.source, "EBAY_SELL_FULFILLMENT_GET_ORDERS")
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.bounded, true)
  assert.equal(result.officialOrderCount, 1)
  assert.equal(result.officialLineItemQuantity, 2)
  assert.equal(result.orders[0].orderId, "15-12345-12345")
  assert.equal(result.orders[0].orderStatus, "PAID")
  assert.equal(result.orders[0].fulfillmentStatus, "NOT_STARTED")
  assert.equal(result.orders[0].lineItems[0].lineItemId, "1234567890!1001!2001")
  assert.equal(result.orders[0].lineItems[0].itemId, "366575102453")
  assert.equal(result.orders[0].lineItems[0].sku, "IMN-LST-000020")
  assert.equal(result.orders[0].lineItems[0].quantity, 2)
  assert.equal(result.reconciliation.analyticsQuantitySold, 2)
  assert.equal(result.reconciliation.reconciliation, "MATCHED")
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.rawUpstreamPayloadIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.databaseWrites, 0)
  assert.doesNotMatch(JSON.stringify(result),
    /"(?:buyerName|buyerEmail|buyerPhone|buyerAddress|shippingAddress|paymentMethod)"/i)
})

test("returns a proven zero only after a successful authoritative empty query", () => {
  const result = buildSellerOsOfficialOrdersReadV1(input({ orders: { orders: [] },
    analytics: { accountTraffic: { quantitySold: 0 } } }))

  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.officialOrderCount, 0)
  assert.equal(result.officialLineItemQuantity, 0)
  assert.equal(result.reconciliation.reconciliation, "MATCHED")
})

test("maps OAuth and scope failures to authorization blocked without false zeroes", () => {
  const result = buildSellerOsOfficialOrdersReadV1(input({ orders: {
    status: "UNAVAILABLE", orders: [], observedAt: null,
    gapCodes: ["EBAY_MONITOR_FULFILLMENT_SCOPE_MISSING"],
  } }))

  assert.equal(result.sourceStatus, "AUTHORIZATION_BLOCKED")
  assert.equal(result.officialOrderCount, null)
  assert.equal(result.officialLineItemQuantity, null)
  assert.equal(result.evidenceCompleteness, "UNAVAILABLE")
})

test("maps upstream failure without representing it as no orders", () => {
  const result = buildSellerOsOfficialOrdersReadV1(input({ orders: {
    status: "UNAVAILABLE", orders: [], observedAt: null,
    gapCodes: ["EBAY_MONITOR_ORDERS_503"],
  } }))

  assert.equal(result.sourceStatus, "UPSTREAM_ERROR")
  assert.equal(result.officialOrderCount, null)
})

test("keeps bounded pagination and incomplete evidence explicit", () => {
  const orders = Array.from({ length: 51 }, (_, index) => order({
    ebayOrderId: `ORDER-${String(index).padStart(3, "0")}`,
    lineItems: [{ lineItemId: `LINE-${index}`, listingId: "366575102453",
      sku: "SKU", quantity: 1 }],
  }))
  const result = buildSellerOsOfficialOrdersReadV1(input({ orders: {
    status: "PARTIAL", orders, pagesRead: 10,
    gapCodes: ["FULFILLMENT_ORDER_PAGE_LIMIT_REACHED"],
  } }))

  assert.equal(result.sourceStatus, "PARTIAL")
  assert.equal(result.orders.length, 50)
  assert.equal(result.pagination.ordersTruncated, true)
  assert.equal(result.boundedWindow.lookbackDays, 30)
  assert.equal(result.pagination.maximumLineItemsPerOrder, 20)
  assert.equal(result.officialOrderCount, null)
  assert.ok(result.limitations.includes("OFFICIAL_ORDERS_RESPONSE_LIMIT_REACHED"))
})

test("bounds displayed line items while preserving the exact source quantity", () => {
  const lineItems = Array.from({ length: 21 }, (_, index) => ({
    lineItemId: `LINE-${index}`, listingId: "366575102453", sku: "SKU", quantity: 1,
  }))
  const result = buildSellerOsOfficialOrdersReadV1(input({ orders: { orders: [order({ lineItems })] } }))

  assert.equal(result.orders[0].lineItems.length, 20)
  assert.equal(result.orders[0].lineItemsTruncated, true)
  assert.equal(result.officialLineItemQuantity, 21)
})

test("preserves multiple line items and keeps a missing SKU null", () => {
  const result = buildSellerOsOfficialOrdersReadV1(input({ orders: { orders: [order({
    lineItems: [
      { lineItemId: "LINE-1", listingId: "366575102453", sku: null, quantity: 1 },
      { lineItemId: "LINE-2", listingId: "366592919965", sku: "SKU-2", quantity: 3 },
    ],
  })] } }))

  assert.equal(result.officialLineItemQuantity, 4)
  assert.equal(result.orders[0].lineItems[0].sku, null)
  assert.equal(result.orders[0].lineItems[1].itemId, "366592919965")
})

test("keeps an unavailable official Item ID null and marks the evidence partial", () => {
  const result = buildSellerOsOfficialOrdersReadV1(input({ orders: { orders: [order({
    lineItems: [{ lineItemId: "LINE-NO-ITEM", listingId: null,
      sku: "CUSTOM-LABEL", quantity: 1 }],
  })] } }))

  assert.equal(result.sourceStatus, "PARTIAL")
  assert.equal(result.orders[0].lineItems[0].itemId, null)
  assert.equal(result.orders[0].lineItems[0].sku, "CUSTOM-LABEL")
  assert.equal(result.orders[0].lineItems[0].sourceStatus, "PARTIAL")
  assert.ok(result.limitations.includes("OFFICIAL_ORDER_LINE_ITEM_IDENTITY_PARTIAL"))
})

test("keeps malformed order evidence partial and never fabricates zero", () => {
  const malformed = order({ ebayOrderId: "bad order id" })
  const result = buildSellerOsOfficialOrdersReadV1(input({ orders: {
    status: "PARTIAL", orders: [malformed], rawOrdersDiscardedAfterSanitization: 1,
  } }))

  assert.equal(result.sourceStatus, "PARTIAL")
  assert.equal(result.officialOrderCount, null)
  assert.ok(result.limitations.includes("OFFICIAL_ORDERS_DISCARDED_AFTER_SANITIZATION"))
})

test("keeps Analytics quantitySold distinct and classifies fixed-window differences", () => {
  const scopeDifference = buildSellerOsOfficialOrdersReadV1(input({ analytics: {
    windowStart: "2026-07-22T00:00:00.000Z", windowEnd: WINDOW_END,
    accountTraffic: { quantitySold: 99 },
  } }))
  const lag = buildSellerOsOfficialOrdersReadV1(input({ analytics: {
    windowStart: WINDOW_START, windowEnd: "2026-08-19T00:00:00.000Z",
    accountTraffic: { quantitySold: 99 },
  } }))
  const mismatch = buildSellerOsOfficialOrdersReadV1(input({ analytics: {
    accountTraffic: { quantitySold: 3 },
  } }))

  assert.equal(scopeDifference.reconciliation.reconciliation, "EXPECTED_SCOPE_DIFFERENCE")
  assert.equal(lag.reconciliation.reconciliation, "EXPECTED_REPORTING_LAG")
  assert.equal(mismatch.reconciliation.reconciliation, "UNEXPLAINED_MISMATCH")
  assert.equal(mismatch.reconciliation.analyticsQuantitySold, 3)
})

test("never infers orders from positive Analytics when the official source is unavailable", () => {
  const result = buildSellerOsOfficialOrdersReadV1(input({
    orders: { status: "UNAVAILABLE", observedAt: null, orders: [],
      gapCodes: ["LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE"] },
    analytics: { accountTraffic: { quantitySold: 3 } },
  }))

  assert.equal(result.reconciliation.analyticsQuantitySold, 3)
  assert.equal(result.reconciliation.officialOrdersStatus, "UNAVAILABLE")
  assert.equal(result.reconciliation.officialOrderCount, null)
  assert.equal(result.reconciliation.officialLineItemQuantity, null)
  assert.equal(result.reconciliation.reconciliation, "UNAVAILABLE")
  assert.equal(result.reconciliation.semanticBoundary,
    "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS")
})

test("reconciles relay Analytics metadata without changing unavailable official counts", () => {
  const official = buildSellerOsOfficialOrdersReadV1(input({
    orders: { status: "UNAVAILABLE", observedAt: null, orders: [],
      windowStart: null, windowEnd: null,
      gapCodes: ["LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE"] },
    analytics: { status: "UNAVAILABLE", accountTraffic: { quantitySold: null } },
  }))
  const result = reconcileSellerOsOfficialOrdersAnalyticsV1(official, {
    status: "AVAILABLE",
    windowStart: "2026-07-21T00:00:00.000Z",
    windowEnd: "2026-08-19T23:59:59.999Z",
    accountTraffic: { quantitySold: 3 },
  })

  assert.equal(result.sourceStatus, "UNAVAILABLE")
  assert.equal(result.officialOrderCount, null)
  assert.equal(result.officialLineItemQuantity, null)
  assert.equal(result.reconciliation.analyticsQuantitySold, 3)
  assert.equal(result.reconciliation.analyticsSource,
    "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT")
  assert.equal(result.reconciliation.reconciliation, "UNAVAILABLE")
})

test("drops adversarial buyer, address, payment, credential, and raw payload fields", () => {
  const hostile = order({
    buyer: { username: "buyer-secret", email: "buyer@example.test" },
    buyerName: "Buyer Name",
    phone: "+1-555-0100",
    shippingAddress: { street: "private" },
    billingAddress: { street: "private" },
    paymentData: { account: "private" },
    accessToken: "secret-token",
    rawPayload: { buyerEmail: "raw@example.test" },
  })
  const result = buildSellerOsOfficialOrdersReadV1(input({
    orders: { orders: [hostile] },
  }))
  const serialized = JSON.stringify(result)

  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.rawUpstreamPayloadIncluded, false)
  assert.doesNotMatch(serialized,
    /buyer-secret|buyer@example|Buyer Name|555-0100|private|secret-token|raw@example/i)
  assert.doesNotMatch(serialized,
    /buyerName|buyerUsername|email|phone|shippingAddress|billingAddress|paymentData|rawPayload/i)
})

test("has no caller-controlled date, endpoint, OAuth, write, or persistence path", () => {
  const source = readFileSync(new URL("./ebay-official-orders-read-v1.ts", import.meta.url), "utf8")
  assert.doesNotMatch(source, /\bfetch\s*\(|\bexec\s*\(|\bspawn\s*\(|\.from\s*\(/)
  assert.doesNotMatch(source, /buyer(Name|Email|Phone)|shippingAddress|accessToken|refreshToken/i)
  assert.match(source, /callerControlled: false/)
  assert.match(source, /arbitraryUrlAllowed: false/)
  assert.doesNotMatch(source, /createMigration|applyMigration|rollbackMigration|database\.insert/i)
  assert.match(source, /marketplaceWrites: 0/)
  assert.match(source, /inventoryWrites: 0/)
  assert.match(source, /productCaseMutations: 0/)
  assert.match(source, /lunaLinkMutations: 0/)
  assert.match(source, /whatsappSends: 0/)
})
