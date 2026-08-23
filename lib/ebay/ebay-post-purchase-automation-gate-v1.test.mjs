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
const { buildSellerOsWhatsappSaleAlertStatusV1,
  sellerOsWhatsappSaleAlertDeliveryKeyV1 } = await import(
  "./ebay-whatsapp-sale-alert-v1.ts"
)
const { buildSellerOsBuyerThankYouStatusV1,
  sellerOsBuyerThankYouDeliveryKeysForSaleAlertsV1 } = await import(
  "./ebay-post-purchase-buyer-message-v1.ts"
)
const { buildSellerOsPostPurchaseAutomationGateV1,
  SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_RESOURCE_V1 } = await import(
  "./ebay-post-purchase-automation-gate-v1.ts"
)

const OBSERVED_AT = "2026-08-21T12:00:00.000Z"
const WINDOW_START = "2026-07-22T12:00:00.000Z"
const WINDOW_END = "2026-08-21T12:00:00.000Z"

function rawOrder(overrides = {}) {
  return {
    ebayOrderId: overrides.ebayOrderId ?? "09-15056-51468",
    creationDate: overrides.creationDate ?? "2026-08-20T12:00:00.000Z",
    lastModifiedDate: overrides.lastModifiedDate ?? "2026-08-20T13:00:00.000Z",
    orderPaymentStatus: overrides.orderPaymentStatus ?? "PAID",
    orderFulfillmentStatus: overrides.orderFulfillmentStatus ?? "FULFILLED",
    marketplaceId: "EBAY_US",
    lineItems: overrides.lineItems ?? [{ lineItemId: "10083232519109",
      listingId: "366584348898", sku: "IMN-LST-000010", quantity: 1 }],
    ...overrides.extra,
  }
}

function official(orders = [rawOrder()], overrides = {}) {
  return buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: overrides.status ?? "CERTIFIED",
      observedAt: overrides.observedAt ?? OBSERVED_AT,
      windowStart: overrides.windowStart ?? WINDOW_START,
      windowEnd: overrides.windowEnd ?? WINDOW_END,
      orders,
      pagesRead: overrides.pagesRead ?? 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: overrides.gapCodes ?? [],
    },
    analytics: overrides.analytics ?? {
      status: "CERTIFIED", windowStart: WINDOW_START, windowEnd: WINDOW_END,
      accountTraffic: { quantitySold: 3 },
    },
  })
}

function provider(overrides = {}) {
  return {
    observedAt: OBSERVED_AT,
    provider: "META_CLOUD_API",
    configurationStatus: "READY",
    preflightStatus: "PASSED",
    deliveryAttemptAllowed: true,
    realDeliveryPermitted: true,
    configuredRecipientOnly: true,
    approvedTemplateOnly: true,
    environmentBoundary: "PREVIEW_ONLY",
    limitationCodes: [],
    ...overrides,
  }
}

function capability(overrides = {}) {
  return {
    observedAt: OBSERVED_AT,
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

function buildChain(options = {}) {
  const officialOrders = options.officialOrders ?? official(options.orders,
    options.officialOverrides)
  const salesOrderEvents = buildSellerOsSalesOrderEventsReadV1(officialOrders)
  const recentSalesFeed = buildSellerOsRecentSalesFeedV1(salesOrderEvents)
  const saleAlerts = buildSellerOsSaleAlertsReadV1(recentSalesFeed,
    options.alertOptions)
  const whatsappKeys = saleAlerts.alerts.map((alert) =>
    sellerOsWhatsappSaleAlertDeliveryKeyV1(alert.eventId))
  const whatsapp = buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts,
    provider: options.provider ?? provider(),
    audit: {
      source: "ALERT_DELIVERY_OUTBOX",
      status: "AVAILABLE",
      observedAt: OBSERVED_AT,
      rows: options.whatsappAudit ?? [],
      truncated: false,
      limitationCodes: [],
    },
  })
  const buyerKeys = sellerOsBuyerThankYouDeliveryKeysForSaleAlertsV1(saleAlerts)
  const buyerThankYou = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts,
    capability: options.capability ?? capability(),
    audit: {
      source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER",
      status: "AVAILABLE",
      observedAt: OBSERVED_AT,
      rows: options.buyerAudit ?? [],
      truncated: false,
      limitationCodes: [],
    },
  })
  return { officialOrders, salesOrderEvents, recentSalesFeed, saleAlerts,
    whatsapp, buyerThankYou, whatsappKeys, buyerKeys }
}

function gate(chain) {
  return buildSellerOsPostPurchaseAutomationGateV1(chain)
}

test("I07 aggregates the live I01-I06 contracts without adding a tool or side effect", () => {
  const result = gate(buildChain())
  assert.equal(result.contractVersion,
    "SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_V1")
  assert.equal(SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_RESOURCE_V1.id,
    "seller-os://phase-1/post-purchase-automation-gate")
  assert.equal(result.status, "READY")
  assert.equal(result.postPurchaseAutomationReady, true)
  assert.deepEqual(Object.values(result.regressionStatuses).map((row) =>
    row.status), Array(6).fill("PASSED"))
  assert.equal(result.identityIntegrity.status, "PROVEN")
  assert.equal(result.correlations[0].exactOneToOneLineChain, true)
  assert.equal(result.correlations[0].correlationEnvelopeMatch, true)
  assert.equal(result.historicalReplayProtection.status, "PROVEN")
  assert.equal(result.historicalReplayProtection.historicalWhatsappViolationCount, 0)
  assert.equal(result.historicalReplayProtection.historicalBuyerThankYouViolationCount, 0)
  assert.equal(result.auditTrail.legacyIsolation, true)
  assert.equal(result.safety.certificationGeneratedSideEffects, 0)
  assert.equal(result.safety.whatsappSendsByThisRead, 0)
  assert.equal(result.safety.buyerMessageSendsByThisRead, 0)
})

test("I07 replay x100 and restart keep every business and delivery identity stable", () => {
  const snapshots = Array.from({ length: 100 }, () => gate(buildChain()))
  const identity = (result) => ({
    eventId: result.correlations[0].eventId,
    dashboardAlertId: result.correlations[0].dashboardAlertId,
    whatsappDeliveryKey: result.correlations[0].whatsappDeliveryKey,
    buyerThankYouDeliveryKey: result.correlations[0].buyerThankYouDeliveryKey,
  })
  assert.deepEqual(new Set(snapshots.map((value) =>
    JSON.stringify(identity(value)))).size, 1)
  assert.equal(snapshots[99].replayRestartConcurrency
    .replayX100LogicalIdentityStable, true)
  assert.equal(snapshots[99].replayRestartConcurrency
    .restartLogicalIdentityStable, true)
  assert.equal(snapshots[99].replayRestartConcurrency
    .whatsappDurableClaimLease, true)
  assert.equal(snapshots[99].replayRestartConcurrency
    .buyerDurablePreDispatchClaim, true)
})

test("I07 preserves multi-line and quantity grain while aggregating one buyer thank-you", () => {
  const chain = buildChain({ orders: [rawOrder({ lineItems: [
    { lineItemId: "LINE-A", listingId: "366584348898",
      sku: "SKU-A", quantity: 3 },
    { lineItemId: "LINE-B", listingId: "366592504400",
      sku: null, quantity: 1 },
    { lineItemId: "LINE-C", listingId: null,
      sku: "SKU-C", quantity: 2 },
  ] })] })
  const result = gate(chain)
  assert.equal(chain.salesOrderEvents.events.length, 3)
  assert.deepEqual(chain.salesOrderEvents.events.map((event) => event.quantity),
    [3, 1, 2])
  assert.equal(chain.recentSalesFeed.entries.length, 3)
  assert.equal(chain.saleAlerts.alerts.length, 3)
  assert.equal(chain.whatsapp.entries.length, 3)
  assert.equal(chain.buyerThankYou.entries.length, 1)
  assert.equal(chain.buyerThankYou.entries[0].eventIds.length, 3)
  assert.equal(result.messageGrain.buyerThankYou,
    "ONE_PER_EBAY_ORDER")
  assert.equal(result.messageGrain.buyerThankYouOrderAggregationIntegrity, true)
})

test("I07 status and fulfillment updates do not mint a new sale or delivery identity", () => {
  const before = gate(buildChain())
  const after = gate(buildChain({ orders: [rawOrder({
    lastModifiedDate: "2026-08-21T11:30:00.000Z",
    orderPaymentStatus: "PAID",
    orderFulfillmentStatus: "IN_PROGRESS",
  })] }))
  const identities = (value) => value.correlations.map((row) => [
    row.eventId, row.dashboardAlertId, row.whatsappDeliveryKey,
    row.buyerThankYouDeliveryKey,
  ])
  assert.deepEqual(identities(before), identities(after))
  assert.equal(before.correlations[0].eventId, after.correlations[0].eventId)
  assert.equal(after.identityIntegrity.sameBusinessFactReplayKeepsIdentity, true)
})

test("I07 duplicate identity or broken linkage blocks rather than hiding divergence", () => {
  const chain = buildChain()
  const duplicated = {
    ...chain,
    salesOrderEvents: {
      ...chain.salesOrderEvents,
      events: [...chain.salesOrderEvents.events,
        chain.salesOrderEvents.events[0]],
      eventCount: 2,
    },
  }
  const result = gate(duplicated)
  assert.equal(result.status, "BLOCKED")
  assert.equal(result.postPurchaseAutomationReady, false)
  assert.equal(result.identityIntegrity.status, "FAILED")
  assert.equal(result.identityIntegrity.duplicateCounts.salesOrderEvents, 1)
  assert.ok(result.limitations.includes(
    "POST_PURCHASE_DUPLICATE_LOGICAL_IDENTITY_DETECTED"))
})

test("I07 preserves sibling isolation and both indeterminate-outcome manual-review policies", () => {
  const chain = buildChain({ orders: [rawOrder({
    creationDate: "2026-08-21T06:00:00.000Z",
    lastModifiedDate: "2026-08-21T06:10:00.000Z",
  })] })
  const result = gate(chain)
  assert.equal(result.siblingFailureIsolation.status, "PROVEN")
  assert.equal(result.siblingFailureIsolation.whatsappRetryReplaysSucceededSibling,
    false)
  assert.equal(result.siblingFailureIsolation
    .buyerThankYouRetryReplaysSucceededSibling, false)
  assert.equal(result.deliverySemantics.exactOnceClaimed, false)
  assert.equal(result.deliverySemantics
    .indeterminateOutcomeAutomaticResendAllowed, false)
  assert.equal(result.manualReview.whatsappDisposition,
    "DEAD_LETTER_MANUAL_REVIEW_NO_AUTO_RETRY")
  assert.equal(result.manualReview.buyerThankYouDisposition,
    "MANUAL_REVIEW_NO_AUTOMATIC_RESEND")
})

test("I07 unavailable official evidence remains unproven and Analytics never creates automation", () => {
  const officialOrders = createUnavailableSellerOsOfficialOrdersReadV1(
    "FULFILLMENT_OAUTH_UNAVAILABLE",
  )
  const chain = buildChain({ officialOrders })
  const result = gate(chain)
  assert.equal(result.status, "UNPROVEN")
  assert.equal(result.postPurchaseAutomationReady, false)
  assert.equal(result.regressionStatuses.i01.status, "UNPROVEN")
  assert.equal(result.regressionStatuses.i02.status, "UNPROVEN")
  assert.equal(chain.salesOrderEvents.eventCount, null)
  assert.equal(chain.recentSalesFeed.feedCount, null)
  assert.equal(chain.saleAlerts.alertCount, null)
  assert.equal(chain.salesOrderEvents.events.length, 0)
  assert.ok(result.authority.semanticBoundaries.includes(
    "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"))
  assert.equal(result.authority.analyticsUsedAsOfficialOrderOrAutomationEvidence,
    false)
})

test("I07 auth, commerce scope and provider failures remain fail-closed", () => {
  const chain = buildChain({
    provider: provider({ configurationStatus: "NOT_READY",
      preflightStatus: "FAILED", deliveryAttemptAllowed: false,
      realDeliveryPermitted: false,
      limitationCodes: ["SELLER_WHATSAPP_CONFIGURATION_INCOMPLETE"] }),
    capability: capability({ status: "AUTHORIZATION_BLOCKED",
      accountBindingStatus: "UNAVAILABLE",
      commerceMessageScopeConfirmed: false,
      refreshCapabilityConfirmed: false,
      deliveryAttemptAllowed: false,
      automaticExecutionAuthority: "HUMAN_APPROVAL_REQUIRED",
      limitationCodes: ["EBAY_BUYER_MESSAGE_AUTHORIZATION_BLOCKED_INVALID_SCOPE"] }),
  })
  const result = gate(chain)
  assert.equal(result.status, "BLOCKED")
  assert.equal(result.regressionStatuses.i05.status, "FAILED")
  assert.equal(result.regressionStatuses.i06.status, "FAILED")
  assert.equal(chain.whatsapp.deliveryOutcomes.successfulReceiptCount, 0)
  assert.equal(chain.buyerThankYou.buyerMessageSendCount, 0)
  assert.equal(result.safety.marketplaceWritesByThisRead, 0)
})

test("I07 strips PII, credentials, environment, raw payload and caller-shaped authority", () => {
  const poisonedOrder = rawOrder({ extra: {
    buyer: { name: "PRIVATE BUYER", email: "buyer@example.test" },
    shippingAddress: "PRIVATE ADDRESS",
    payment: { cardNumber: "4111111111111111" },
    accessToken: "SECRET_ACCESS_TOKEN",
    refreshToken: "SECRET_REFRESH_TOKEN",
    rawUpstreamPayload: { authorization: "Bearer secret" },
  } })
  const result = gate(buildChain({ orders: [poisonedOrder] }))
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized,
    /PRIVATE BUYER|buyer@example|PRIVATE ADDRESS|411111|SECRET_ACCESS|SECRET_REFRESH|Bearer secret/i)
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.buyerIdentityIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.environmentValuesIncluded, false)
  assert.equal(result.safety.arbitraryRecipientAllowed, false)
  assert.equal(result.safety.arbitraryUrlAllowed, false)
  assert.equal(result.safety.callerControlledTokenAllowed, false)
  assert.equal(result.safety.arbitrarySqlAllowed, false)
})

test("I07 durable success evidence is restart-safe and production flags require real receipts", () => {
  const orders = [rawOrder({ creationDate: "2026-08-21T06:00:00.000Z",
    lastModifiedDate: "2026-08-21T06:10:00.000Z" })]
  const projection = buildChain({ orders })
  const eventId = projection.saleAlerts.alerts[0].eventId
  const whatsappKey = projection.whatsappKeys[0]
  const buyerKey = projection.buyerKeys[0]
  const withReceipts = buildChain({ orders,
    whatsappAudit: [{ deliveryKey: whatsappKey, outboxId: "outbox-1",
      status: "delivered", attempts: 1, leaseExpiresAt: null,
      providerReferenceDigest: `sha256:${"a".repeat(64)}`,
      deliveredAt: "2026-08-21T06:11:00.000Z", lastErrorCode: null,
      createdAt: "2026-08-21T06:10:30.000Z",
      updatedAt: "2026-08-21T06:11:00.000Z" }],
    buyerAudit: [{ deliveryKey: buyerKey, ledgerEventId: "ledger-1",
      workflowState: "SUCCEEDED", attemptCount: 1, dispatchStarted: true,
      leaseExpiresAt: null, receiptStatus: "PRESENT",
      providerReferenceDigest: `sha256:${"b".repeat(64)}`,
      succeededAt: "2026-08-21T06:12:00.000Z", lastErrorCode: null,
      manualReviewRequired: false,
      createdAt: "2026-08-21T06:10:30.000Z" }],
  })
  const first = gate(withReceipts)
  const afterRestart = gate(withReceipts)
  assert.equal(first.correlations[0].eventId, eventId)
  assert.equal(first.productionEvidence.productionWhatsappNewSaleObserved, true)
  assert.equal(first.productionEvidence.productionBuyerThankYouNewSaleObserved,
    true)
  assert.equal(first.productionEvidence.productionFullPostPurchasePathObserved,
    true)
  assert.deepEqual(first.correlations, afterRestart.correlations)
  assert.equal(first.replayRestartConcurrency
    .successReceiptsPreventRestartResend, true)
})

test("I07 publishes the complete adversarial scenario contract without executing attacks", () => {
  const result = gate(buildChain())
  assert.equal(result.adversarialAssurance.scenarios.length, 23)
  for (const required of ["REPLAY_X100", "RESTART", "DUPLICATE_WORKER",
    "DUPLICATE_SCHEDULER", "MULTI_LINE_ORDER",
    "QUANTITY_GREATER_THAN_ONE", "ORDER_STATUS_UPDATE",
    "DASHBOARD_SIBLING_ISOLATION", "WHATSAPP_FAILURE_ISOLATION",
    "BUYER_THANK_YOU_FAILURE_ISOLATION",
    "WHATSAPP_INDETERMINATE_OUTCOME",
    "BUYER_MESSAGE_INDETERMINATE_OUTCOME", "DURABLE_RECEIPT_REPLAY",
    "HISTORICAL_REPLAY", "ANALYTICS_ONLY_SIGNAL",
    "OFFICIAL_ORDERS_UNAVAILABLE", "FULFILLMENT_OAUTH_MISSING",
    "COMMERCE_MESSAGE_SCOPE_MISSING", "WHATSAPP_PROVIDER_UNAVAILABLE",
    "PII_AND_SECRET_INJECTION", "ARBITRARY_RECIPIENT",
    "ARBITRARY_URL_OR_TOKEN", "LEGACY_OWNER_ISOLATION"]) {
    assert.ok(result.adversarialAssurance.scenarios.includes(required), required)
  }
  assert.equal(result.adversarialAssurance
    .runtimeReadExecutesSideEffectsOrFailureInjection, false)
})

test("I07 WhatsApp workers and duplicate schedulers share one durable unique claim boundary", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260715120000_create_marketplace_commercial_monitor_v1.sql",
    import.meta.url,
  ), "utf8")
  assert.match(migration,
    /create table if not exists public\.alert_delivery_outbox[\s\S]*deduplication_key text not null unique/i)
  assert.match(migration,
    /create or replace function public\.claim_alert_delivery_outbox[\s\S]*for update skip locked/i)
  assert.match(migration,
    /on conflict \(outbox_id, attempt_number, channel\) do update/i)
  const result = gate(buildChain())
  assert.equal(result.replayRestartConcurrency.whatsappUniqueDurableOutboxKey,
    true)
  assert.equal(result.replayRestartConcurrency.whatsappDurableClaimLease, true)
  assert.equal(result.replayRestartConcurrency
    .duplicateSchedulerUsesSameDeliveryIdentities, true)
})
