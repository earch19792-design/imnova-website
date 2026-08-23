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
const { buildSellerOsWhatsappSaleAlertDeliveryPlanV1,
  buildSellerOsWhatsappSaleAlertStatusV1,
  sellerOsWhatsappSaleAlertDeliveryKeyV1 } = await import(
  "./ebay-whatsapp-sale-alert-v1.ts"
)
const { readSellerOsWhatsappSaleAlertAuditV1 } = await import(
  "./ebay-whatsapp-sale-alert-readonly-repository-v1.ts"
)
const { COMMERCIAL_WHATSAPP_DISPATCH_STARTED_MARKER,
  classifyCommercialWhatsappFailureV1,
  quarantineExpiredCommercialWhatsappDispatchesV1 } = await import(
  "../marketplace/commercial-alert-dispatcher.ts"
)
const { preflightSellerWhatsAppGateway,
  sendSellerWhatsAppApprovedTemplate } = await import(
  "./ebay-seller-whatsapp-gateway.ts"
)

const NOW = "2026-08-22T12:00:00.000Z"

function order(overrides = {}) {
  return {
    ebayOrderId: "ORDER-NEW",
    creationDate: "2026-08-21T04:00:00.000Z",
    lastModifiedDate: "2026-08-21T05:00:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "NOT_STARTED",
    marketplaceId: "EBAY_US",
    lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
      sku: "SKU-ONE", quantity: 1 }],
    ...overrides,
  }
}

function saleAlerts(orders = [order()]) {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: NOW,
      windowStart: "2026-07-23T12:00:00.000Z",
      windowEnd: NOW,
      orders,
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: { status: "AVAILABLE", quantitySold: 99 },
  })
  return buildSellerOsSaleAlertsReadV1(buildSellerOsRecentSalesFeedV1(
    buildSellerOsSalesOrderEventsReadV1(official),
  ))
}

function provider(ready = true) {
  return Object.freeze({
    observedAt: NOW,
    provider: "META_CLOUD_API",
    configurationStatus: ready ? "READY" : "NOT_READY",
    preflightStatus: ready ? "PASSED" : "FAILED",
    deliveryAttemptAllowed: ready,
    realDeliveryPermitted: ready,
    configuredRecipientOnly: true,
    approvedTemplateOnly: true,
    environmentBoundary: "PREVIEW_ONLY",
    limitationCodes: ready ? [] : ["SELLER_WHATSAPP_NOT_READY"],
  })
}

function audit(rows = [], status = "AVAILABLE") {
  return Object.freeze({
    source: "ALERT_DELIVERY_OUTBOX",
    status,
    observedAt: NOW,
    rows,
    truncated: false,
    limitationCodes: status === "AVAILABLE" ? []
      : ["WHATSAPP_SALE_ALERT_AUDIT_READ_FAILED"],
  })
}

function durableRow(eventId, overrides = {}) {
  return {
    deliveryKey: sellerOsWhatsappSaleAlertDeliveryKeyV1(eventId),
    outboxId: "11111111-1111-4111-8111-111111111111",
    status: "delivered",
    attempts: 1,
    leaseExpiresAt: null,
    providerReferenceDigest: `sha256:${"a".repeat(64)}`,
    deliveredAt: "2026-08-22T12:01:00.000Z",
    lastErrorCode: null,
    createdAt: "2026-08-22T12:00:10.000Z",
    updatedAt: "2026-08-22T12:01:00.000Z",
    ...overrides,
  }
}

test("I05 historical replay is always skipped and 100 replays never create a delivery", () => {
  const historical = saleAlerts([order({
    ebayOrderId: "ORDER-HISTORICAL",
    creationDate: "2026-08-20T12:00:00.000Z",
    lastModifiedDate: "2026-08-20T13:00:00.000Z",
  })])
  const results = Array.from({ length: 100 }, () =>
    buildSellerOsWhatsappSaleAlertStatusV1({
      saleAlerts: historical,
      provider: provider(true),
      audit: audit([]),
    }))

  assert.equal(new Set(results.map((result) =>
    result.entries[0].deliveryKey)).size, 1)
  assert.ok(results.every((result) =>
    result.entries[0].workflowStep.state === "SKIPPED" &&
    result.entries[0].eligibleForWhatsApp === false &&
    result.deliveryOutcomes.historicalSendCount === 0))
  assert.ok(results[0].entries[0].limitationCodes.includes(
    "HISTORICAL_REPLAY_EXTERNAL_NOTIFICATION_FORBIDDEN"))
  assert.equal(results[0].safety.whatsappSendsByThisRead, 0)
})

test("I05 creates one deterministic line delivery, preserves quantity, and isolates lines", () => {
  const alerts = saleAlerts([order({ lineItems: [
    { lineItemId: "LINE-1", listingId: "366575102453",
      sku: "SKU-ONE", quantity: 3 },
    { lineItemId: "LINE-2", listingId: "366575102454",
      sku: null, quantity: 1 },
  ] })])
  const first = buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts: alerts, provider: provider(true), audit: audit([]),
  })
  const afterRestart = buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts: alerts, provider: provider(true), audit: audit([]),
  })

  assert.equal(first.entries.length, 2)
  assert.equal(first.entries.find((entry) => entry.lineItemId === "LINE-1")
    .quantity, 3)
  assert.equal(new Set(first.entries.map((entry) => entry.deliveryKey)).size, 2)
  assert.deepEqual(first.entries.map((entry) => entry.deliveryKey),
    afterRestart.entries.map((entry) => entry.deliveryKey))
  assert.ok(first.entries.every((entry) =>
    entry.workflowStep.state === "NOT_STARTED" &&
    entry.workflowStep.stepExecutionId !== entry.deliveryKey &&
    entry.correlation.eventId === entry.eventId))
})

test("I05 durable success receipt survives restart and prevents logical resend", () => {
  const alerts = saleAlerts()
  const eventId = alerts.alerts[0].eventId
  const receipt = durableRow(eventId)
  const first = buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts: alerts, provider: provider(true), audit: audit([receipt]),
  })
  const afterRestart = buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts: alerts, provider: provider(true), audit: audit([receipt]),
  })

  assert.equal(first.entries[0].workflowStep.state, "SUCCEEDED")
  assert.equal(first.entries[0].durableReceipt.status, "PRESENT")
  assert.equal(first.entries[0].attemptCount, 1)
  assert.equal(first.entries[0].deliveryKey,
    afterRestart.entries[0].deliveryKey)
  assert.equal(first.entries[0].durableReceipt.receiptId,
    afterRestart.entries[0].durableReceipt.receiptId)
  assert.equal(first.deliveryOutcomes.productionNewSaleSendObserved, true)
  assert.equal(first.deliverySemantics.classification,
    "AT_MOST_ONCE_BEST_EFFORT")
  assert.equal(first.deliverySemantics.outboundDispatchStartedMarkerDurable,
    true)
  assert.equal(first.deliverySemantics.expiredLeaseAfterDispatchStartedAutoRetryAllowed,
    false)
  assert.equal(first.deliverySemantics.crashAfterProviderAcceptanceBeforeReceiptDisposition,
    "DEAD_LETTER_MANUAL_REVIEW_NO_AUTO_RETRY")
  assert.equal(first.deliverySemantics.exactOnceClaimed, false)
})

test("I05 provider failures preserve retry, terminal, blocked and crash-window semantics", () => {
  assert.equal(classifyCommercialWhatsappFailureV1({
    statusCode: 503, errorCode: "META_HTTP_503",
  }).workflowState, "RETRYABLE_FAILURE")
  assert.equal(classifyCommercialWhatsappFailureV1({
    statusCode: 403, errorCode: "META_HTTP_403",
  }).workflowState, "TERMINAL_FAILURE")
  assert.equal(classifyCommercialWhatsappFailureV1({
    statusCode: 429, errorCode: "META_HTTP_429",
  }).workflowState, "RETRYABLE_FAILURE")
  assert.equal(classifyCommercialWhatsappFailureV1({
    statusCode: null, errorCode: "SELLER_WHATSAPP_NOT_READY",
  }).workflowState, "BLOCKED")
  assert.deepEqual(classifyCommercialWhatsappFailureV1({
    statusCode: null, errorCode: "META_REQUEST_TIMEOUT",
    requestDispatched: false,
  }).retryAllowed, true)
  const unknown = classifyCommercialWhatsappFailureV1({
    statusCode: null, errorCode: "META_REQUEST_TIMEOUT",
    requestDispatched: true,
  })
  assert.equal(unknown.retryAllowed, false)
  assert.equal(unknown.outcomeKnown, false)
})

test("I05 expired post-dispatch lease is durably quarantined before claim retry", async () => {
  const updates = []
  const filters = []
  const supabase = {
    from(table) {
      return {
        update(payload) {
          updates.push({ table, payload })
          const chain = {
            eq(...args) { filters.push({ table, operator: "eq", args }); return chain },
            lt(...args) { filters.push({ table, operator: "lt", args }); return chain },
            select() { return chain },
            limit() {
              return Promise.resolve(table === "alert_delivery_outbox"
                ? { data: [{ id: "outbox-one", attempts: 1 }], error: null }
                : { data: null, error: null })
            },
            then(resolve) { return resolve({ data: null, error: null }) },
          }
          return chain
        },
      }
    },
  }
  const count = await quarantineExpiredCommercialWhatsappDispatchesV1(
    supabase,
    "canonical-account",
    NOW,
  )

  assert.equal(count, 1)
  assert.equal(updates[0].table, "alert_delivery_outbox")
  assert.equal(updates[0].payload.status, "dead_letter")
  assert.equal(updates[1].table, "alert_delivery_attempts")
  assert.equal(updates[1].payload.status, "failed")
  assert.ok(filters.some((entry) => entry.args.includes(
    COMMERCIAL_WHATSAPP_DISPATCH_STARTED_MARKER,
  )))
})

test("I05 plan uses the certified event root, server-owned destination and no PII", () => {
  const alert = saleAlerts().alerts[0]
  const plan = buildSellerOsWhatsappSaleAlertDeliveryPlanV1({
    eventId: alert.eventId,
    orderId: alert.orderId,
    lineItemId: alert.lineItemId,
    itemId: alert.itemId,
    sku: alert.sku,
    quantity: alert.quantity,
    orderCreatedAt: alert.orderCreatedAt,
    orderStatus: alert.orderStatus,
    fulfillmentStatus: alert.fulfillmentStatus,
    marketplaceId: alert.marketplaceId,
    detectionClass: alert.detectionClass,
    providerDeliveryAttemptAllowed: true,
  })
  const serialized = JSON.stringify(plan)

  assert.equal(plan.eligible, true)
  assert.equal(plan.destinationClass, "CANONICAL_OWNER_OPERATOR")
  assert.equal(plan.sideEffectClass, "WHATSAPP_SEND")
  assert.equal(plan.authority, "AUTO_EXECUTION_ALLOWED")
  assert.equal(plan.payload.quantity, 1)
  assert.equal(plan.payload.buyerPiiIncluded, false)
  assert.doesNotMatch(serialized,
    /buyerName|buyerEmail|shippingAddress|phoneNumber|accessToken|refreshToken|process\.env/i)
})

test("I05 canonical Meta provider path accepts one approved-template sandbox delivery", async () => {
  const names = ["VERCEL_ENV", "EBAY_PRO_RUNTIME",
    "EBAY_SELLER_WHATSAPP_ENABLED", "EBAY_SELLER_WHATSAPP_RECIPIENT",
    "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID",
    "WHATSAPP_ACCESS_TOKEN", "EBAY_SELLER_WHATSAPP_TEMPLATE_NAME",
    "EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME",
    "EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE"]
  const previous = new Map(names.map((name) => [name, process.env[name]]))
  Object.assign(process.env, {
    VERCEL_ENV: "preview",
    EBAY_PRO_RUNTIME: "staging",
    EBAY_SELLER_WHATSAPP_ENABLED: "true",
    EBAY_SELLER_WHATSAPP_RECIPIENT: "15555550100",
    WHATSAPP_PHONE_NUMBER_ID: "sandbox-phone-id",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "sandbox-business-id",
    WHATSAPP_ACCESS_TOKEN: "sandbox-placeholder-token",
    EBAY_SELLER_WHATSAPP_TEMPLATE_NAME: "sandbox_sale_alert",
    EBAY_SELLER_WHATSAPP_DIGEST_TEMPLATE_NAME: "sandbox_digest",
    EBAY_SELLER_WHATSAPP_TEMPLATE_LANGUAGE: "es",
  })
  let providerPosts = 0
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "POST") {
      providerPosts += 1
      return Response.json({ messages: [{ id: "sandbox-provider-reference" }] },
        { status: 200 })
    }
    if (String(url).includes("message_templates")) {
      const name = new URL(String(url)).searchParams.get("name")
      return Response.json({ data: [{ name, status: "APPROVED",
        language: "es", components: [{ type: "BODY",
          text: "{{1}} {{2}} {{3}} {{4}}" }] }] })
    }
    return Response.json({ id: "sandbox-phone-id" })
  }
  try {
    const preflight = await preflightSellerWhatsAppGateway({
      fetchImpl, force: true,
    })
    assert.equal(preflight.success, true)
    const result = await sendSellerWhatsAppApprovedTemplate({
      deliveryClass: "immediate",
      priorityLabel: "ALTA",
      title: "Nueva venta eBay",
      summary: "SKU SKU-ONE · Item 366575102453 · Cantidad 1",
      action: "Revisar en Seller OS",
    }, { fetchImpl })
    assert.equal(result.success, true)
    assert.equal(result.statusCode, 200)
    assert.equal(providerPosts, 1)
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test("I05 unavailable authority never becomes zero delivery evidence or Analytics WhatsApp", () => {
  const unavailableOrders = createUnavailableSellerOsOfficialOrdersReadV1(
    "OFFICIAL_ORDERS_UPSTREAM_UNAVAILABLE",
  )
  const unavailableAlerts = buildSellerOsSaleAlertsReadV1(
    buildSellerOsRecentSalesFeedV1(
      buildSellerOsSalesOrderEventsReadV1(unavailableOrders),
    ),
  )
  const result = buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts: unavailableAlerts,
    provider: provider(true),
    audit: audit([]),
  })

  assert.equal(result.sourceStatus, "UNAVAILABLE")
  assert.equal(result.statusCount, null)
  assert.deepEqual(result.entries, [])
  assert.ok(result.limitations.includes("NO_EVIDENCE_DOES_NOT_PROVE_ZERO"))
  assert.doesNotMatch(JSON.stringify(result), /quantitySold.*delivery/i)
})

test("I05 audit read is fixed, bounded and hashes rather than exposes provider references", async () => {
  const alert = saleAlerts().alerts[0]
  const deliveryKey = sellerOsWhatsappSaleAlertDeliveryKeyV1(alert.eventId)
  const calls = []
  const rows = [{
    id: "11111111-1111-4111-8111-111111111111",
    deduplication_key: `whatsapp:${deliveryKey}`,
    status: "delivered",
    attempts: 1,
    lease_expires_at: null,
    provider_message_id: "provider-reference-must-not-leak",
    delivered_at: NOW,
    last_error_code: null,
    created_at: NOW,
    updated_at: NOW,
  }]
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
  const result = await readSellerOsWhatsappSaleAlertAuditV1(
    supabase,
    "CANONICAL-ACCOUNT",
    [deliveryKey],
    NOW,
  )
  const serialized = JSON.stringify(result)

  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.rows[0].deliveryKey, deliveryKey)
  assert.match(result.rows[0].providerReferenceDigest, /^sha256:[0-9a-f]{64}$/)
  assert.doesNotMatch(serialized, /provider-reference-must-not-leak/)
  assert.deepEqual(calls[0], ["from", "alert_delivery_outbox"])
  assert.ok(calls.some((call) => call[0] === "limit" && call[1] === 51))
  assert.ok(calls.some((call) => call[0] === "eq" &&
    call[1] === "marketplace_account_key" && call[2] === "CANONICAL-ACCOUNT"))
})
