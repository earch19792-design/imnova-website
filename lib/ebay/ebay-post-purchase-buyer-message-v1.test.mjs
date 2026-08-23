import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  EBAY_COMMERCE_MESSAGE_SCOPE,
  POST_PURCHASE_BUYER_MESSAGE_VERSION,
  SELLER_OS_BUYER_THANK_YOU_ACTIVATION_CUTOVER_AT,
  SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1,
  buildSellerOsBuyerThankYouStatusV1,
  getPostPurchaseBuyerMessageCapabilityV1,
  preflightEbayBuyerMessagingCapabilityV1,
  prepareEbayBuyerThankYouDispatchV1,
  sellerOsBuyerThankYouDeliveryKeyV1,
} = await import("./ebay-post-purchase-buyer-message-v1.ts")
const { POST_PURCHASE_THANK_YOU_TEMPLATE_V1,
  POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION } = await import(
  "./ebay-sales-order-event-foundation-v1.ts"
)
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
const { buildSellerOsSaleAlertsReadV1 } = await import(
  "./ebay-sale-alerts-read-v1.ts"
)
const { readSellerOsBuyerThankYouAuditV1 } = await import(
  "./ebay-buyer-thank-you-readonly-repository-v1.ts"
)

const NOW = "2026-08-21T05:30:00.000Z"

function order(overrides = {}) {
  return {
    ebayOrderId: "ORDER-ONE",
    creationDate: "2026-08-21T05:00:00.000Z",
    lastModifiedDate: "2026-08-21T05:01:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    marketplaceId: "EBAY_US",
    lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
      sku: "SKU-ONE", quantity: 1 }],
    ...overrides,
  }
}

function saleAlerts(orders, overrides = {}) {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED", observedAt: NOW,
      windowStart: "2026-07-22T05:30:00.000Z", windowEnd: NOW,
      orders, pagesRead: 1, rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [], ...overrides,
    },
    analytics: { status: "CERTIFIED",
      accountTraffic: { quantitySold: 999 } },
  })
  return buildSellerOsSaleAlertsReadV1(buildSellerOsRecentSalesFeedV1(
    buildSellerOsSalesOrderEventsReadV1(official),
  ), { activationCutoverAt: "2026-08-21T03:00:00.000Z" })
}

function capability(overrides = {}) {
  return {
    observedAt: NOW,
    provider: "EBAY_COMMERCE_MESSAGE_API",
    status: "READY",
    accountBindingStatus: "MATCHED",
    commerceMessageScopeConfirmed: true,
    refreshCapabilityConfirmed: true,
    fixedReadPreflightUsed: true,
    deliveryAttemptAllowed: true,
    automaticExecutionAuthority: "AUTO_EXECUTION_ALLOWED",
    limitationCodes: [],
    ...overrides,
  }
}

function audit(rows = [], overrides = {}) {
  return {
    source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER",
    status: "AVAILABLE",
    observedAt: NOW,
    rows,
    truncated: false,
    limitationCodes: [],
    ...overrides,
  }
}

test("I06 extends the canonical buyer-message foundation with one approved template", () => {
  const disabled = getPostPurchaseBuyerMessageCapabilityV1({
    VERCEL_ENV: "preview",
  })
  const activated = getPostPurchaseBuyerMessageCapabilityV1({
    VERCEL_ENV: "preview",
    EBAY_POST_PURCHASE_THANK_YOU_ENABLED: "true",
  })
  assert.equal(disabled.contractVersion, POST_PURCHASE_BUYER_MESSAGE_VERSION)
  assert.equal(disabled.status, "NOT_ACTIVATED")
  assert.equal(activated.status, "PREFLIGHT_REQUIRED")
  assert.equal(activated.requiredScope, EBAY_COMMERCE_MESSAGE_SCOPE)
  assert.equal(activated.durableOrderLevelLeaseActivated, true)
  assert.equal(activated.networkWriteExposedByMcp, false)
  assert.equal(POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
    "POST_PURCHASE_THANK_YOU_TEMPLATE_V1")
  assert.equal(POST_PURCHASE_THANK_YOU_TEMPLATE_V1,
    "Thank you for your purchase! We truly appreciate your business. Your order is being processed, and we'll keep you updated with any important information. If you have any questions, please feel free to message us through eBay.")
})

test("one order with multiple line events produces one order-grained thank-you plan", () => {
  const alerts = saleAlerts([order({ lineItems: [
    { lineItemId: "LINE-1", listingId: "366575102453",
      sku: "SKU-ONE", quantity: 3 },
    { lineItemId: "LINE-2", listingId: "366575102454",
      sku: null, quantity: 1 },
  ] })])
  const result = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: alerts,
    capability: capability(),
    audit: audit(),
  })
  assert.equal(result.contractVersion, "SELLER_OS_BUYER_THANK_YOU_STATUS_V1")
  assert.equal(result.statusCount, 1)
  assert.equal(result.entries[0].eventIds.length, 2)
  assert.equal(result.entries[0].lineItemIds.length, 2)
  assert.equal(result.entries[0].officialQuantity, 4)
  assert.equal(result.entries[0].messageGrain,
    "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER")
  assert.equal(result.entries[0].eligibleForBuyerThankYou, true)
  assert.equal(result.entries[0].workflowStep.state, "NOT_STARTED")
  assert.equal(result.entries[0].sideEffectClasses.includes(
    "BUYER_MESSAGE_SEND"), true)
  assert.equal(result.entries[0].sideEffectClasses.includes(
    "MARKETPLACE_WRITE"), true)
})

test("100 replays, restart and status updates keep one delivery identity", () => {
  const initial = saleAlerts([order()])
  const repeated = { ...initial,
    alerts: Array.from({ length: 100 }, (_, index) => ({
      ...initial.alerts[0],
      orderLastModifiedAt: new Date(Date.parse(
        "2026-08-21T05:01:00.000Z") + index * 1_000).toISOString(),
      fulfillmentStatus: index === 99 ? "FULFILLED" : "NOT_STARTED",
    })),
  }
  const first = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: repeated, capability: capability(), audit: audit(),
  })
  const afterRestart = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: repeated, capability: capability(), audit: audit(),
  })
  assert.equal(first.entries.length, 1)
  assert.equal(first.entries[0].eventIds.length, 1)
  assert.equal(first.entries[0].fulfillmentStatus, "FULFILLED")
  assert.equal(first.entries[0].deliveryKey,
    afterRestart.entries[0].deliveryKey)
  assert.equal(first.entries[0].workflowStep.stepExecutionId,
    afterRestart.entries[0].workflowStep.stepExecutionId)
})

test("historical replay is visible but permanently ineligible with zero attempts", () => {
  const alerts = saleAlerts([order({
    ebayOrderId: "ORDER-HISTORICAL",
    creationDate: "2026-08-20T12:00:00.000Z",
    lastModifiedDate: "2026-08-20T13:00:00.000Z",
  })])
  const result = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: alerts, capability: capability(), audit: audit(),
  })
  assert.equal(result.activation.activationCutoverAt,
    SELLER_OS_BUYER_THANK_YOU_ACTIVATION_CUTOVER_AT)
  assert.equal(result.entries[0].detectionClass, "HISTORICAL_REPLAY")
  assert.equal(result.entries[0].eligibleForBuyerThankYou, false)
  assert.equal(result.entries[0].buyerMessageSendAllowed, false)
  assert.equal(result.entries[0].workflowStep.state, "SKIPPED")
  assert.equal(result.entries[0].workflowStep.attemptCount, 0)
  assert.equal(result.entries[0].receipt.status, "ABSENT")
  assert.equal(result.buyerMessageSendCount, 0)
  assert.equal(result.productionNewSaleBuyerMessageObserved, false)
})

test("unavailable official evidence does not become zero buyer messages", () => {
  const unavailableAlerts = buildSellerOsSaleAlertsReadV1(
    buildSellerOsRecentSalesFeedV1(
      buildSellerOsSalesOrderEventsReadV1(
        createUnavailableSellerOsOfficialOrdersReadV1(
          "LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE",
        ),
      ),
    ),
  )
  const result = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: unavailableAlerts,
    capability: capability({ status: "UNAVAILABLE",
      deliveryAttemptAllowed: false }),
    audit: audit(),
  })
  assert.equal(result.sourceStatus, "UNAVAILABLE")
  assert.equal(result.statusCount, null)
  assert.equal(result.buyerMessageSendCount, null)
  assert.ok(result.limitations.includes("NO_EVIDENCE_DOES_NOT_PROVE_ZERO"))
})

test("partial source or incomplete durable audit blocks delivery eligibility", () => {
  const complete = saleAlerts([order()])
  const partialSource = { ...complete, status: "PARTIAL",
    evidenceCompleteness: "PARTIAL" }
  const sourceResult = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: partialSource, capability: capability(), audit: audit(),
  })
  const auditResult = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: complete, capability: capability(),
    audit: audit([], { status: "UNAVAILABLE",
      limitationCodes: ["BUYER_THANK_YOU_AUDIT_READ_FAILED"] }),
  })
  assert.equal(sourceResult.entries[0].eligibleForBuyerThankYou, false)
  assert.equal(auditResult.entries[0].eligibleForBuyerThankYou, false)
  assert.ok(sourceResult.entries[0].limitationCodes.includes(
    "BUYER_THANK_YOU_SOURCE_EVIDENCE_INCOMPLETE"))
  assert.ok(auditResult.entries[0].limitationCodes.includes(
    "BUYER_THANK_YOU_DURABLE_LEDGER_EVIDENCE_INCOMPLETE"))
})

test("fixed Message API preflight proves scope/account without returning conversations", async () => {
  const calls = []
  const result = await preflightEbayBuyerMessagingCapabilityV1({
    environment: { VERCEL_ENV: "preview",
      EBAY_POST_PURCHASE_THANK_YOU_ENABLED: "true" },
    now: () => new Date(NOW),
    tokenProvider: async () => "private-token-never-returned",
    identityVerifier: async () => ({ identityMatch: true }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method })
      return new Response(JSON.stringify({ conversations: [{
        otherPartyUsername: "private-buyer",
      }] }), { status: 200 })
    },
  })
  assert.equal(result.status, "READY")
  assert.equal(result.commerceMessageScopeConfirmed, true)
  assert.equal(result.accountBindingStatus, "MATCHED")
  assert.equal(result.deliveryAttemptAllowed, true)
  assert.equal(calls.length, 1)
  assert.match(calls[0].url,
    /\/commerce\/message\/v1\/conversation\?conversation_type=FROM_MEMBERS&limit=1&offset=0/)
  assert.doesNotMatch(JSON.stringify(result), /private-token|private-buyer/)
})

test("missing scope, token failure and upstream failure remain fail-closed", async () => {
  const missing = await preflightEbayBuyerMessagingCapabilityV1({
    environment: { VERCEL_ENV: "preview",
      EBAY_POST_PURCHASE_THANK_YOU_ENABLED: "true" },
    tokenProvider: async () => {
      throw new Error("EBAY_COMMERCIAL_ORDERS_OAUTH_UNAUTHORIZED_SCOPE")
    },
  })
  const forbidden = await preflightEbayBuyerMessagingCapabilityV1({
    environment: { VERCEL_ENV: "preview",
      EBAY_POST_PURCHASE_THANK_YOU_ENABLED: "true" },
    tokenProvider: async () => "private-token",
    identityVerifier: async () => ({ identityMatch: true }),
    fetchImpl: async () => new Response(null, { status: 403 }),
  })
  const upstream = await preflightEbayBuyerMessagingCapabilityV1({
    environment: { VERCEL_ENV: "preview",
      EBAY_POST_PURCHASE_THANK_YOU_ENABLED: "true" },
    tokenProvider: async () => "private-token",
    identityVerifier: async () => ({ identityMatch: true }),
    fetchImpl: async () => { throw new Error("network unavailable") },
  })
  assert.equal(missing.status, "AUTHORIZATION_BLOCKED")
  assert.deepEqual(missing.limitationCodes, [
    "EBAY_BUYER_MESSAGE_AUTHORIZATION_BLOCKED_INVALID_SCOPE",
  ])
  assert.equal(forbidden.status, "AUTHORIZATION_BLOCKED")
  assert.equal(upstream.status, "UPSTREAM_ERROR")
  assert.equal(missing.deliveryAttemptAllowed, false)
})

test("canonical OAuth categories remain bounded and diagnostically precise", async () => {
  const revoked = await preflightEbayBuyerMessagingCapabilityV1({
    environment: { VERCEL_ENV: "preview",
      EBAY_POST_PURCHASE_THANK_YOU_ENABLED: "true" },
    tokenProvider: async () => {
      throw new Error(
        "EBAY_COMMERCIAL_ORDERS_OAUTH_REFRESH_TOKEN_REVOKED_OR_EXPIRED")
    },
  })
  const tokenEndpoint = await preflightEbayBuyerMessagingCapabilityV1({
    environment: { VERCEL_ENV: "preview",
      EBAY_POST_PURCHASE_THANK_YOU_ENABLED: "true" },
    tokenProvider: async () => {
      throw new Error(
        "EBAY_COMMERCIAL_ORDERS_OAUTH_TOKEN_ENDPOINT_UNAVAILABLE")
    },
  })
  assert.equal(revoked.status, "AUTHORIZATION_BLOCKED")
  assert.deepEqual(revoked.limitationCodes, [
    "EBAY_BUYER_MESSAGE_AUTHORIZATION_BLOCKED_REFRESH_TOKEN_REVOKED_OR_EXPIRED",
  ])
  assert.equal(tokenEndpoint.status, "UPSTREAM_ERROR")
  assert.deepEqual(tokenEndpoint.limitationCodes, [
    "EBAY_BUYER_MESSAGE_OAUTH_UPSTREAM_UNAVAILABLE",
  ])
  assert.doesNotMatch(JSON.stringify({ revoked, tokenEndpoint }),
    /access_token|refresh_token|client_secret|Authorization/)
})

test("private order context is purpose-bound and successful send returns only a digest", async () => {
  const calls = []
  const prepared = await prepareEbayBuyerThankYouDispatchV1({
    orderId: "ORDER-ONE",
    expectedLineItemIds: ["LINE-1"],
    expectedItemIds: ["366575102453"],
    ordersTokenProvider: async () => "private-orders-token",
    messageTokenProvider: async () => "private-message-token",
    identityVerifier: async () => ({ identityMatch: true }),
    now: () => new Date(NOW),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      if (init.method === "GET") return Response.json({
        orderId: "ORDER-ONE",
        buyer: { username: "private-buyer", email: "private@example.test" },
        fulfillmentStartInstructions: [{ shippingStep: { shipTo: {
          fullName: "Private Buyer", contactAddress: { addressLine1: "Secret" },
        } } }],
        lineItems: [{ lineItemId: "LINE-1", legacyItemId: "366575102453" }],
      })
      const body = JSON.parse(init.body)
      assert.equal(body.otherPartyUsername, "private-buyer")
      assert.equal(body.messageText, POST_PURCHASE_THANK_YOU_TEMPLATE_V1)
      assert.deepEqual(body.reference, { referenceId: "366575102453",
        referenceType: "LISTING" })
      return Response.json({ messageId: "provider-message-id",
        createdDate: NOW, recipientUserName: "private-buyer",
        messageBody: POST_PURCHASE_THANK_YOU_TEMPLATE_V1 }, { status: 201 })
    },
  })
  assert.equal(prepared.recipientIdentityExposed, false)
  const receipt = await prepared.send()
  assert.equal(receipt.accepted, true)
  assert.match(receipt.providerReferenceDigest, /^sha256:[0-9a-f]{64}$/)
  assert.equal(receipt.recipientIdentityExposed, false)
  assert.equal(receipt.rawProviderPayloadExposed, false)
  assert.doesNotMatch(JSON.stringify({ prepared: {
    prepared: prepared.prepared,
    recipientIdentityExposed: prepared.recipientIdentityExposed,
  }, receipt }), /private-buyer|private@example|Secret|private-token/)
  assert.equal(calls.length, 2)
})

test("post-dispatch timeout is unknown and never marked retry-safe", async () => {
  const prepared = await prepareEbayBuyerThankYouDispatchV1({
    orderId: "ORDER-ONE",
    expectedLineItemIds: ["LINE-1"],
    expectedItemIds: ["366575102453"],
    ordersTokenProvider: async () => "orders-token",
    messageTokenProvider: async () => "message-token",
    identityVerifier: async () => ({}),
    fetchImpl: async (_url, init) => {
      if (init.method === "GET") return Response.json({
        orderId: "ORDER-ONE", buyer: { username: "private-buyer" },
        lineItems: [{ lineItemId: "LINE-1", legacyItemId: "366575102453" }],
      })
      throw new Error("timeout after write")
    },
  })
  await assert.rejects(prepared.send(), (error) => {
    assert.equal(error.code,
      "EBAY_BUYER_MESSAGE_ACCEPTANCE_OUTCOME_UNKNOWN")
    assert.equal(error.retrySafe, false)
    assert.equal(error.acceptanceOutcome, "UNKNOWN")
    return true
  })
})

test("definitive eBay 4xx rejection is terminal and never treated as accepted", async () => {
  const prepared = await prepareEbayBuyerThankYouDispatchV1({
    orderId: "ORDER-ONE",
    expectedLineItemIds: ["LINE-1"],
    expectedItemIds: ["366575102453"],
    ordersTokenProvider: async () => "orders-token",
    messageTokenProvider: async () => "message-token",
    identityVerifier: async () => ({}),
    fetchImpl: async (_url, init) => init.method === "GET"
      ? Response.json({ orderId: "ORDER-ONE",
          buyer: { username: "private-buyer" },
          lineItems: [{ lineItemId: "LINE-1",
            legacyItemId: "366575102453" }] })
      : new Response(null, { status: 403 }),
  })
  await assert.rejects(prepared.send(), (error) => {
    assert.equal(error.code, "EBAY_BUYER_MESSAGE_REJECTED_403")
    assert.equal(error.retrySafe, false)
    assert.equal(error.acceptanceOutcome, "NOT_ACCEPTED")
    return true
  })
})

test("missing Item ID remains valid and omits the optional listing reference", async () => {
  let sentBody = null
  const prepared = await prepareEbayBuyerThankYouDispatchV1({
    orderId: "ORDER-NO-ITEM",
    expectedLineItemIds: ["LINE-1"],
    expectedItemIds: [],
    ordersTokenProvider: async () => "orders-token",
    messageTokenProvider: async () => "message-token",
    identityVerifier: async () => ({}),
    fetchImpl: async (_url, init) => {
      if (init.method === "GET") return Response.json({
        orderId: "ORDER-NO-ITEM", buyer: { username: "private-buyer" },
        lineItems: [{ lineItemId: "LINE-1" }],
      })
      sentBody = JSON.parse(init.body)
      return Response.json({ messageId: "message-id" }, { status: 201 })
    },
  })
  await prepared.send()
  assert.equal(Object.hasOwn(sentBody, "reference"), false)
})

test("fixed durable audit read returns only bounded sanitized receipt metadata", async () => {
  const alerts = saleAlerts([order()])
  const deliveryKey = sellerOsBuyerThankYouDeliveryKeyV1({
    orderId: "ORDER-ONE", eventIds: alerts.alerts.map((row) => row.eventId),
  })
  const calls = []
  const rows = [{ id: "11111111-1111-4111-8111-111111111111",
    deduplication_key: deliveryKey, created_at: NOW,
    evidence: { deliveryKey, workflowState: "SUCCEEDED", attemptCount: 1,
      dispatchStarted: true, receiptStatus: "PRESENT",
      providerReferenceDigest: `sha256:${"a".repeat(64)}`,
      succeededAt: NOW, privateBuyer: "must-not-leak",
      rawProviderPayload: { accessToken: "must-not-leak" } } }]
  const builder = {
    select(value) { calls.push(["select", value]); return builder },
    eq(key, value) { calls.push(["eq", key, value]); return builder },
    in(key, value) { calls.push(["in", key, value]); return builder },
    order(key, value) { calls.push(["order", key, value]); return builder },
    limit(value) { calls.push(["limit", value]); return Promise.resolve({
      data: rows, error: null,
    }) },
  }
  const supabase = { from(table) { calls.push(["from", table]); return builder } }
  const result = await readSellerOsBuyerThankYouAuditV1(
    supabase, "CANONICAL-ACCOUNT", [deliveryKey], NOW,
  )
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.rows[0].receiptStatus, "PRESENT")
  assert.match(result.rows[0].providerReferenceDigest,
    /^sha256:[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|accessToken/)
  assert.deepEqual(calls[0], ["from", "commercial_alert_events"])
  assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 51))
})

test("public status is bounded, read-only and excludes PII, credentials and caller scope", () => {
  const alerts = saleAlerts([order()])
  const poisoned = { ...alerts, alerts: [{ ...alerts.alerts[0],
    buyer: { name: "Private Buyer", email: "private@example.test",
      phone: "+10000000000" },
    rawUpstreamPayload: { accessToken: "secret-token",
      shippingAddress: "Secret address" },
  }] }
  const result = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: poisoned, capability: capability(), audit: audit(),
  })
  const serialized = JSON.stringify(result)
  assert.equal(SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.name,
    "seller_os_get_buyer_thank_you_status")
  assert.equal(SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.sideEffects, false)
  assert.equal(result.bounded, true)
  assert.equal(result.maximumStatusEntries, 50)
  assert.equal(result.safety.readOnlyCertificationSurface, true)
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.buyerIdentityIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.buyerMessageSendsByThisRead, 0)
  assert.doesNotMatch(serialized,
    /Private Buyer|private@example|\+10000000000|Secret address|secret-token/)
  assert.doesNotMatch(serialized,
    /"(?:buyer|email|phone|address|otherPartyUsername|accessToken)"/i)
})

test("delivery identity rejects caller-shaped invalid roots", () => {
  assert.throws(() => sellerOsBuyerThankYouDeliveryKeyV1({
    orderId: "x", eventIds: ["not-an-event"],
  }), /BUYER_THANK_YOU_ORDER_IDENTITY_INVALID/)
  const source = readFileSync(new URL(
    "./ebay-post-purchase-buyer-message-v1.ts", import.meta.url,
  ), "utf8")
  assert.doesNotMatch(source, /console\.|logger\./)
  assert.doesNotMatch(source, /process\.env\[[^\]]+\]\s*=/)
})
