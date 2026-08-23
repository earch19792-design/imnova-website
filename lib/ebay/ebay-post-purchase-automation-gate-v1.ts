import type { SellerOsOfficialOrdersReadV1 } from "./ebay-official-orders-read-v1.ts"
import type { SellerOsSalesOrderEventsReadV1 } from "./ebay-sales-order-events-read-v1.ts"
import type { SellerOsRecentSalesFeedV1 } from "./ebay-sales-order-read-model-v1.ts"
import type { SellerOsSaleAlertsReadV1 } from "./ebay-sale-alerts-read-v1.ts"
import type { SellerOsWhatsappSaleAlertStatusV1 } from "./ebay-whatsapp-sale-alert-v1.ts"
import type { SellerOsBuyerThankYouStatusV1 } from "./ebay-post-purchase-buyer-message-v1.ts"

export const SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_VERSION =
  "SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_V1" as const

export const SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_RESOURCE_V1 =
  Object.freeze({
    id: "seller-os://phase-1/post-purchase-automation-gate",
    title: "Seller OS Phase 1 post-purchase automation gate",
    description: "Read the fixed canonical seller account's bounded, PII-free I01-I06 regression, identity, replay, historical-protection, delivery and safety evidence. This resource never sends or writes.",
  })

const MAXIMUM_CORRELATIONS = 50

const ADVERSARIAL_SCENARIOS = Object.freeze([
  "REPLAY_X100",
  "RESTART",
  "DUPLICATE_WORKER",
  "DUPLICATE_SCHEDULER",
  "MULTI_LINE_ORDER",
  "QUANTITY_GREATER_THAN_ONE",
  "ORDER_STATUS_UPDATE",
  "DASHBOARD_SIBLING_ISOLATION",
  "WHATSAPP_FAILURE_ISOLATION",
  "BUYER_THANK_YOU_FAILURE_ISOLATION",
  "WHATSAPP_INDETERMINATE_OUTCOME",
  "BUYER_MESSAGE_INDETERMINATE_OUTCOME",
  "DURABLE_RECEIPT_REPLAY",
  "HISTORICAL_REPLAY",
  "ANALYTICS_ONLY_SIGNAL",
  "OFFICIAL_ORDERS_UNAVAILABLE",
  "FULFILLMENT_OAUTH_MISSING",
  "COMMERCE_MESSAGE_SCOPE_MISSING",
  "WHATSAPP_PROVIDER_UNAVAILABLE",
  "PII_AND_SECRET_INJECTION",
  "ARBITRARY_RECIPIENT",
  "ARBITRARY_URL_OR_TOKEN",
  "LEGACY_OWNER_ISOLATION",
] as const)

function uniqueCodes(values: readonly string[]) {
  return [...new Set(values.filter((value) =>
    /^[A-Z0-9_]{3,160}$/.test(value)))].sort().slice(0, 60)
}

function occurrences(values: readonly string[]) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function duplicateCount(values: readonly string[]) {
  return values.length - new Set(values).size
}

function unavailableStatus(status: string) {
  return status === "UNAVAILABLE" || status === "AUTHORIZATION_BLOCKED" ||
    status === "UPSTREAM_ERROR"
}

function regression(status: "PASSED" | "FAILED" | "UNPROVEN",
  contractVersion: string, evidence: Record<string, unknown>) {
  return Object.freeze({ contractVersion, status, evidence: Object.freeze(evidence) })
}

export function buildSellerOsPostPurchaseAutomationGateV1(input: Readonly<{
  officialOrders: SellerOsOfficialOrdersReadV1
  salesOrderEvents: SellerOsSalesOrderEventsReadV1
  recentSalesFeed: SellerOsRecentSalesFeedV1
  saleAlerts: SellerOsSaleAlertsReadV1
  whatsapp: SellerOsWhatsappSaleAlertStatusV1
  buyerThankYou: SellerOsBuyerThankYouStatusV1
}>) {
  const { officialOrders, salesOrderEvents, recentSalesFeed, saleAlerts,
    whatsapp, buyerThankYou } = input
  const officialUnavailable = unavailableStatus(officialOrders.sourceStatus)
  const officialLines = officialOrders.orders.flatMap((order) =>
    order.lineItems.map((line) => ({
      key: `${order.orderId}\u0000${line.lineItemId}`,
      orderId: order.orderId,
      lineItemId: line.lineItemId,
      itemId: line.itemId,
      sku: line.sku,
      quantity: line.quantity,
    })))
  const officialByLine = occurrences(officialLines.map((line) => line.key))
  const eventIds = salesOrderEvents.events.map((event) => event.eventId)
  const feedEventIds = recentSalesFeed.entries.map((entry) => entry.eventId)
  const alertEventIds = saleAlerts.alerts.map((alert) => alert.eventId)
  const whatsappDeliveryKeys = whatsapp.entries.map((entry) => entry.deliveryKey)
  const buyerDeliveryKeys = buyerThankYou.entries.map((entry) => entry.deliveryKey)
  const whatsappStatus = "status" in whatsapp ? whatsapp.status : "UNAVAILABLE"
  const whatsappDeliveryOutcomes = "deliveryOutcomes" in whatsapp
    ? whatsapp.deliveryOutcomes : Object.freeze({
      successfulReceiptCount: null,
      historicalSendCount: null,
      newlyDetectedSuccessfulReceiptCount: null,
      productionNewSaleSendObserved: null,
    })
  const whatsappDeduplication = "deduplication" in whatsapp
    ? whatsapp.deduplication : Object.freeze({
      uniqueDurableOutboxKey: true as const,
      replayDoesNotChangeDeliveryKey: true as const,
      restartDoesNotChangeDeliveryKey: true as const,
    })
  const historicalAlertCount = "historicalAlertCount" in
      saleAlerts.historicalReplayPolicy
    ? saleAlerts.historicalReplayPolicy.historicalAlertCount : null
  const feedByEvent = occurrences(feedEventIds)
  const alertsByEvent = occurrences(alertEventIds)
  const whatsappByEvent = occurrences(whatsapp.entries.map((entry) =>
    entry.eventId))
  const buyerByEvent = occurrences(buyerThankYou.entries.flatMap((entry) =>
    entry.eventIds))
  const sourceProjectionTruncated = salesOrderEvents.events.length >
    MAXIMUM_CORRELATIONS
  const correlations = salesOrderEvents.events.slice(0,
    MAXIMUM_CORRELATIONS).map((event) => {
    const lineKey = `${event.orderId}\u0000${event.lineItemId}`
    const officialLine = officialLines.find((line) => line.key === lineKey)
    const feed = recentSalesFeed.entries.find((entry) =>
      entry.eventId === event.eventId)
    const alert = saleAlerts.alerts.find((entry) =>
      entry.eventId === event.eventId)
    const whatsappEntry = whatsapp.entries.find((entry) =>
      entry.eventId === event.eventId)
    const buyerEntry = buyerThankYou.entries.find((entry) =>
      entry.orderId === event.orderId && entry.eventIds.includes(event.eventId))
    const fieldsMatch = Boolean(officialLine && feed && alert &&
      officialLine.itemId === event.itemId && event.itemId === feed.itemId &&
      feed.itemId === alert.itemId && officialLine.sku === event.sku &&
      event.sku === feed.sku && feed.sku === alert.sku &&
      officialLine.quantity === event.quantity &&
      event.quantity === feed.quantity && feed.quantity === alert.quantity)
    const correlationEnvelopeMatch = Boolean(alert && whatsappEntry && buyerEntry &&
      alert.correlation.eventId === event.eventId &&
      alert.correlation.causationId === event.eventId &&
      whatsappEntry.correlation.eventId === event.eventId &&
      whatsappEntry.correlation.causationId === event.eventId &&
      buyerEntry.correlation.involvedEventIds.includes(event.eventId))
    return Object.freeze({
      eventId: event.eventId,
      orderId: event.orderId,
      lineItemId: event.lineItemId,
      officialLineOccurrences: officialByLine.get(lineKey) ?? 0,
      salesEventOccurrences: occurrences(eventIds).get(event.eventId) ?? 0,
      recentFeedOccurrences: feedByEvent.get(event.eventId) ?? 0,
      dashboardAlertOccurrences: alertsByEvent.get(event.eventId) ?? 0,
      whatsappStatusOccurrences: whatsappByEvent.get(event.eventId) ?? 0,
      buyerThankYouOrderStatusOccurrences: buyerByEvent.get(event.eventId) ?? 0,
      dashboardAlertId: alert?.alertId ?? null,
      whatsappDeliveryKey: whatsappEntry?.deliveryKey ?? null,
      buyerThankYouDeliveryKey: buyerEntry?.deliveryKey ?? null,
      fieldsMatch,
      correlationEnvelopeMatch,
      exactOneToOneLineChain: (officialByLine.get(lineKey) ?? 0) === 1 &&
        (occurrences(eventIds).get(event.eventId) ?? 0) === 1 &&
        (feedByEvent.get(event.eventId) ?? 0) === 1 &&
        (alertsByEvent.get(event.eventId) ?? 0) === 1 && fieldsMatch,
    })
  })
  const duplicateCounts = Object.freeze({
    salesOrderEvents: officialUnavailable ? null : duplicateCount(eventIds),
    recentSalesFeed: recentSalesFeed.status === "UNAVAILABLE"
      ? null : duplicateCount(feedEventIds),
    dashboardSaleAlerts: saleAlerts.status === "UNAVAILABLE"
      ? null : duplicateCount(alertEventIds),
    whatsappDeliveryIdentities: whatsapp.sourceStatus === "UNAVAILABLE"
      ? null : duplicateCount(whatsappDeliveryKeys),
    buyerThankYouOrderDeliveryIdentities:
      buyerThankYou.sourceStatus === "UNAVAILABLE"
        ? null : duplicateCount(buyerDeliveryKeys),
  })
  const mismatchCount = correlations.filter((row) =>
    !row.exactOneToOneLineChain || !row.correlationEnvelopeMatch).length
  const historicalWhatsapp = whatsapp.entries.filter((entry) =>
    entry.detectionClass === "HISTORICAL_REPLAY")
  const historicalBuyer = buyerThankYou.entries.filter((entry) =>
    entry.detectionClass === "HISTORICAL_REPLAY")
  const historicalWhatsappViolations = historicalWhatsapp.filter((entry) =>
    entry.eligibleForWhatsApp || entry.attemptCount !== 0 ||
    entry.durableReceipt.status === "PRESENT" ||
    !["SKIPPED", "NOT_APPLICABLE"].includes(entry.workflowStep.state)).length
  const historicalBuyerViolations = historicalBuyer.filter((entry) =>
    entry.eligibleForBuyerThankYou || entry.buyerMessageSendAllowed ||
    entry.workflowStep.attemptCount !== 0 || entry.receipt.status !== "ABSENT" ||
    !["SKIPPED", "NOT_APPLICABLE"].includes(entry.workflowStep.state)).length
  const whatsappSiblingIsolation = whatsapp.entries.every((entry) =>
    entry.workflowStep.retryPolicy.retryMayReplaySucceededSibling === false)
  const buyerSiblingIsolation = buyerThankYou.entries.every((entry) =>
    entry.workflowStep.retryPolicy.retryMayReplaySucceededSibling === false)
  const buyerOrderGrain = buyerThankYou.entries.every((entry) => {
    const expected = saleAlerts.alerts.filter((alert) =>
      alert.orderId === entry.orderId).map((alert) => alert.eventId).sort()
    return entry.messageGrain === "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER" &&
      JSON.stringify([...entry.eventIds].sort()) === JSON.stringify(expected)
  }) && duplicateCount(buyerThankYou.entries.map((entry) => entry.orderId)) === 0
  const legacyIsolation = saleAlerts.persistence
    .legacyCommercialAlertEventsUsedAsCanonicalOwner === false &&
    saleAlerts.persistence.legacyOrderGrainRecentSalesFeedUsedAsCanonicalOwner ===
      false
  const allDuplicateCountsZero = Object.values(duplicateCounts).every((value) =>
    value === null || value === 0)
  const i01Passed = officialOrders.sourceStatus === "AVAILABLE" &&
    officialOrders.observedAt !== null &&
    typeof officialOrders.officialOrderCount === "number" &&
    typeof officialOrders.officialLineItemQuantity === "number" &&
    officialOrders.safety.buyerPiiIncluded === false &&
    officialOrders.reconciliation.semanticBoundary ===
      "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS"
  const i02Passed = salesOrderEvents.sourceStatus === "AVAILABLE" &&
    salesOrderEvents.eventCount === officialLines.length &&
    salesOrderEvents.deduplication.identityStableAcrossReplay &&
    salesOrderEvents.deduplication.identityStableAcrossRestart
  const i03Passed = recentSalesFeed.status === "AVAILABLE" &&
    recentSalesFeed.feedCount === salesOrderEvents.events.length &&
    recentSalesFeed.ordering.deterministic
  const i04Passed = saleAlerts.status === "AVAILABLE" &&
    saleAlerts.alertCount === recentSalesFeed.entries.length &&
    saleAlerts.deduplication.rootEventIdentityPreserved && legacyIsolation
  const i05Passed = whatsappStatus === "AVAILABLE" &&
    whatsapp.deliveryPathStatus === "READY" &&
    whatsapp.deliverySemantics.classification === "AT_MOST_ONCE_BEST_EFFORT" &&
    whatsapp.deliverySemantics.exactOnceClaimed === false &&
    whatsapp.deliverySemantics.indeterminateProviderOutcomeAutoRetryAllowed ===
      false && historicalWhatsappViolations === 0
  const i06Passed = buyerThankYou.sourceStatus === "AVAILABLE" &&
    buyerThankYou.capability.status === "READY" &&
    buyerThankYou.capability.accountBindingStatus === "MATCHED" &&
    buyerThankYou.capability.commerceMessageScopeConfirmed === true &&
    buyerThankYou.capability.refreshCapabilityConfirmed === true &&
    buyerThankYou.deliverySemantics.guarantee === "AT_MOST_ONCE_BEST_EFFORT" &&
    buyerThankYou.deliverySemantics.unknownProviderOutcomePolicy ===
      "MANUAL_REVIEW_NO_AUTOMATIC_RESEND" && historicalBuyerViolations === 0 &&
    buyerOrderGrain
  const regressionStatuses = Object.freeze({
    i01: regression(officialUnavailable ? "UNPROVEN" : i01Passed
      ? "PASSED" : "FAILED", officialOrders.contractVersion, {
      sourceStatus: officialOrders.sourceStatus,
      officialOrderCount: officialOrders.officialOrderCount,
      officialLineItemQuantity: officialOrders.officialLineItemQuantity,
    }),
    i02: regression(unavailableStatus(salesOrderEvents.sourceStatus)
      ? "UNPROVEN" : i02Passed ? "PASSED" : "FAILED",
    salesOrderEvents.contractVersion, {
      eventCount: salesOrderEvents.eventCount,
      duplicateObservationsBlocked:
        salesOrderEvents.deduplication.duplicateObservationsBlocked,
    }),
    i03: regression(recentSalesFeed.status === "UNAVAILABLE" ? "UNPROVEN"
      : i03Passed ? "PASSED" : "FAILED", recentSalesFeed.contractVersion, {
      feedCount: recentSalesFeed.feedCount,
      orderingDeterministic: recentSalesFeed.ordering.deterministic,
    }),
    i04: regression(saleAlerts.status === "UNAVAILABLE" ? "UNPROVEN"
      : i04Passed ? "PASSED" : "FAILED", saleAlerts.contractVersion, {
      alertCount: saleAlerts.alertCount,
      historicalAlertCount,
    }),
    i05: regression(whatsapp.sourceStatus === "UNAVAILABLE" ? "UNPROVEN"
      : i05Passed ? "PASSED" : "FAILED", whatsapp.contractVersion, {
      deliveryPathStatus: whatsapp.deliveryPathStatus,
      historicalSendCount: whatsappDeliveryOutcomes.historicalSendCount,
      productionNewSaleSendObserved:
        whatsappDeliveryOutcomes.productionNewSaleSendObserved,
    }),
    i06: regression(buyerThankYou.sourceStatus === "UNAVAILABLE" ? "UNPROVEN"
      : i06Passed ? "PASSED" : "FAILED", buyerThankYou.contractVersion, {
      capability: buyerThankYou.capability.status,
      accountBindingStatus: buyerThankYou.capability.accountBindingStatus,
      commerceMessageScopeConfirmed:
        buyerThankYou.capability.commerceMessageScopeConfirmed,
      historicalBuyerMessageSendCount: historicalBuyer.filter((entry) =>
        entry.receipt.status === "PRESENT").length,
      productionNewSaleBuyerMessageObserved:
        buyerThankYou.productionNewSaleBuyerMessageObserved,
    }),
  })
  const regressionValues = Object.values(regressionStatuses)
  const regressionsPassed = regressionValues.every((row) =>
    row.status === "PASSED")
  const regressionsUnavailable = regressionValues.some((row) =>
    row.status === "UNPROVEN")
  const fullPathObserved = buyerThankYou.entries.some((buyerEntry) =>
    buyerEntry.detectionClass === "NEWLY_DETECTED_AFTER_ACTIVATION" &&
    buyerEntry.workflowStep.state === "SUCCEEDED" &&
    buyerEntry.eventIds.every((eventId) => {
      const whatsappEntry = whatsapp.entries.find((entry) =>
        entry.eventId === eventId)
      const alert = saleAlerts.alerts.find((entry) => entry.eventId === eventId)
      return alert?.workflowStep.state === "SUCCEEDED" &&
        whatsappEntry?.workflowStep.state === "SUCCEEDED"
    }))
  const manualReviewCounts = Object.freeze({
    whatsapp: whatsapp.entries.filter((entry) =>
      entry.workflowStep.state === "TERMINAL_FAILURE" ||
      entry.limitationCodes.some((code) => /MANUAL_REVIEW/.test(code))).length,
    buyerThankYou: buyerThankYou.entries.filter((entry) =>
      entry.receipt.manualReviewRequired ||
      entry.limitationCodes.some((code) => /MANUAL_REVIEW/.test(code))).length,
  })
  const invariantFailure = mismatchCount > 0 || !allDuplicateCountsZero ||
    historicalWhatsappViolations > 0 || historicalBuyerViolations > 0 ||
    !whatsappSiblingIsolation || !buyerSiblingIsolation || !buyerOrderGrain ||
    !legacyIsolation || sourceProjectionTruncated
  const ready = regressionsPassed && !invariantFailure
  const status = regressionsUnavailable ? "UNPROVEN" as const
    : ready ? "READY" as const : "BLOCKED" as const
  const completeness = regressionsUnavailable ? "UNAVAILABLE" as const
    : ready && officialOrders.evidenceCompleteness === "COMPLETE" &&
        salesOrderEvents.evidenceCompleteness === "COMPLETE" &&
        recentSalesFeed.evidenceCompleteness === "COMPLETE" &&
        saleAlerts.evidenceCompleteness === "COMPLETE" &&
        whatsapp.evidenceCompleteness === "COMPLETE" &&
        buyerThankYou.evidenceCompleteness === "COMPLETE"
      ? "COMPLETE" as const : "PARTIAL" as const
  return Object.freeze({
    contractVersion: SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_VERSION,
    status,
    postPurchaseAutomationReady: ready,
    observedAt: officialOrders.observedAt,
    bounded: true as const,
    boundedWindow: officialOrders.boundedWindow,
    maximumCorrelations: MAXIMUM_CORRELATIONS,
    correlationsTruncated: sourceProjectionTruncated,
    regressionStatuses,
    authority: Object.freeze({
      rootSource: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
      rootIdentity: "P1_I02_SALES_ORDER_EVENT_EVENT_ID" as const,
      analyticsUsedAsOfficialOrderOrAutomationEvidence: false as const,
      semanticBoundaries: Object.freeze([
        "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS",
        "NO_EVIDENCE_DOES_NOT_PROVE_ZERO",
      ] as const),
    }),
    identityIntegrity: Object.freeze({
      status: officialUnavailable ? "UNPROVEN" as const
        : mismatchCount === 0 && allDuplicateCountsZero
          ? "PROVEN" as const : "FAILED" as const,
      grain: "CANONICAL_ACCOUNT_MARKETPLACE_ORDER_LINE_EVENT_VERSION" as const,
      lineCorrelationCount: officialUnavailable ? null : correlations.length,
      mismatchCount: officialUnavailable ? null : mismatchCount,
      duplicateCounts,
      sameBusinessFactReplayKeepsIdentity: true as const,
      processingTimestampUsedInIdentity: false as const,
      retryAttemptUsedInIdentity: false as const,
      workerIdentityUsedInBusinessIdentity: false as const,
    }),
    correlations: Object.freeze(correlations),
    replayRestartConcurrency: Object.freeze({
      replayX100LogicalIdentityStable:
        salesOrderEvents.deduplication.identityStableAcrossReplay &&
        recentSalesFeed.deduplication.identityStableAcrossReplay &&
        saleAlerts.deduplication.alertIdentityStableAcrossReplay &&
        whatsappDeduplication.replayDoesNotChangeDeliveryKey,
      restartLogicalIdentityStable:
        salesOrderEvents.deduplication.identityStableAcrossRestart &&
        recentSalesFeed.deduplication.identityStableAcrossRestart &&
        saleAlerts.deduplication.alertIdentityStableAcrossRestart &&
        whatsappDeduplication.restartDoesNotChangeDeliveryKey,
      whatsappDurableClaimLease: whatsapp.deliverySemantics.claimLeaseDurable,
      whatsappUniqueDurableOutboxKey:
        whatsappDeduplication.uniqueDurableOutboxKey,
      buyerDurablePreDispatchClaim:
        buyerThankYou.deliverySemantics.durablePreDispatchClaimRequired,
      successReceiptsPreventRestartResend:
        whatsapp.deliverySemantics.succeededReceiptPreventsResendAfterRestart &&
        buyerThankYou.deliverySemantics.successReceiptPreventsRestartResend,
      duplicateSchedulerUsesSameDeliveryIdentities: true as const,
    }),
    siblingFailureIsolation: Object.freeze({
      status: whatsappSiblingIsolation && buyerSiblingIsolation
        ? "PROVEN" as const : "FAILED" as const,
      dashboardRetryReplaysSucceededSibling: false as const,
      whatsappRetryReplaysSucceededSibling: !whatsappSiblingIsolation,
      buyerThankYouRetryReplaysSucceededSibling: !buyerSiblingIsolation,
      invariant: "ONE_STEP_FAILURE_DOES_NOT_REPLAY_SUCCEEDED_SIBLING_STEPS" as const,
    }),
    messageGrain: Object.freeze({
      dashboard: "ONE_PER_SALES_ORDER_LINE_EVENT" as const,
      whatsapp: "ONE_PER_SALES_ORDER_LINE_EVENT" as const,
      buyerThankYou: "ONE_PER_EBAY_ORDER" as const,
      buyerThankYouOrderAggregationIntegrity: buyerOrderGrain,
    }),
    historicalReplayProtection: Object.freeze({
      status: historicalWhatsappViolations === 0 &&
          historicalBuyerViolations === 0 ? "PROVEN" as const : "FAILED" as const,
      historicalWhatsappEntryCount: historicalWhatsapp.length,
      historicalWhatsappViolationCount: historicalWhatsappViolations,
      historicalBuyerThankYouEntryCount: historicalBuyer.length,
      historicalBuyerThankYouViolationCount: historicalBuyerViolations,
      historicalExternalNotificationAllowed: false as const,
    }),
    deliverySemantics: Object.freeze({
      whatsapp: whatsapp.deliverySemantics,
      buyerThankYou: buyerThankYou.deliverySemantics,
      exactOnceClaimed: false as const,
      indeterminateOutcomeAutomaticResendAllowed: false as const,
    }),
    manualReview: Object.freeze({
      counts: manualReviewCounts,
      whatsappDisposition:
        "DEAD_LETTER_MANUAL_REVIEW_NO_AUTO_RETRY" as const,
      buyerThankYouDisposition:
        "MANUAL_REVIEW_NO_AUTOMATIC_RESEND" as const,
    }),
    auditTrail: Object.freeze({
      contractVersion: "SELLER_OS_AUDIT_TRAIL_POLICY_V1" as const,
      chain: Object.freeze([
        "OFFICIAL_ORDER", "SALES_ORDER_EVENT", "RECENT_SALES_FEED",
        "DASHBOARD_SALE_ALERT", "WHATSAPP_SALE_ALERT",
        "EBAY_BUYER_THANK_YOU", "DELIVERY_OUTCOME",
      ] as const),
      correlationEnvelopeVersion: "SELLER_OS_CORRELATION_ENVELOPE_V1" as const,
      legacyOrderGrainCanonicalOwner: false as const,
      legacyIsolation,
    }),
    adversarialAssurance: Object.freeze({
      matrixVersion: "SELLER_OS_POST_PURCHASE_ADVERSARIAL_MATRIX_V1" as const,
      scenarios: ADVERSARIAL_SCENARIOS,
      runtimeReadExecutesSideEffectsOrFailureInjection: false as const,
      verificationPolicy:
        "LIVE_CONTRACT_INVARIANTS_PLUS_FOCUSED_ADVERSARIAL_TESTS" as const,
    }),
    productionEvidence: Object.freeze({
      productionWhatsappNewSaleObserved:
        whatsappDeliveryOutcomes.productionNewSaleSendObserved,
      productionBuyerThankYouNewSaleObserved:
        buyerThankYou.productionNewSaleBuyerMessageObserved,
      productionFullPostPurchasePathObserved: fullPathObserved,
    }),
    evidenceCompleteness: completeness,
    limitations: Object.freeze(uniqueCodes([
      ...officialOrders.limitations,
      ...salesOrderEvents.limitations,
      ...recentSalesFeed.limitations,
      ...saleAlerts.limitations,
      ...whatsapp.limitations,
      ...buyerThankYou.limitations,
      ...(sourceProjectionTruncated
        ? ["POST_PURCHASE_GATE_CORRELATIONS_TRUNCATED"] : []),
      ...(mismatchCount > 0 ? ["POST_PURCHASE_CHAIN_IDENTITY_MISMATCH"] : []),
      ...(!allDuplicateCountsZero
        ? ["POST_PURCHASE_DUPLICATE_LOGICAL_IDENTITY_DETECTED"] : []),
      ...(historicalWhatsappViolations > 0 || historicalBuyerViolations > 0
        ? ["HISTORICAL_REPLAY_EXTERNAL_SIDE_EFFECT_VIOLATION"] : []),
      "PRODUCTION_ACTIVITY_FLAGS_REQUIRE_REAL_NEW_SALE_RECEIPTS",
    ])),
    safety: SAFETY,
  })
}

const SAFETY = Object.freeze({
  readOnlyCertificationSurface: true as const,
  certificationGeneratedSideEffects: 0 as const,
  buyerPiiIncluded: false as const,
  buyerIdentityIncluded: false as const,
  rawUpstreamPayloadIncluded: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  arbitraryAccountAllowed: false as const,
  arbitraryRecipientAllowed: false as const,
  arbitraryPhoneAllowed: false as const,
  arbitraryUrlAllowed: false as const,
  callerControlledTokenAllowed: false as const,
  arbitrarySqlAllowed: false as const,
  arbitraryBuyerMessageTextAllowed: false as const,
  databaseWritesByThisRead: 0 as const,
  marketplaceWritesByThisRead: 0 as const,
  inventoryWritesByThisRead: 0 as const,
  productCaseMutationsByThisRead: 0 as const,
  lunaMutationsByThisRead: 0 as const,
  whatsappSendsByThisRead: 0 as const,
  buyerMessageSendsByThisRead: 0 as const,
  paymentTransactionsByThisRead: 0 as const,
})

export type SellerOsPostPurchaseAutomationGateV1 = ReturnType<
  typeof buildSellerOsPostPurchaseAutomationGateV1
>

export function createUnavailableSellerOsPostPurchaseAutomationGateV1(
  limitationCode = "POST_PURCHASE_AUTOMATION_GATE_READ_FAILED_CLOSED",
) {
  return Object.freeze({
    contractVersion: SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_VERSION,
    status: "UNAVAILABLE" as const,
    postPurchaseAutomationReady: false as const,
    observedAt: null,
    bounded: true as const,
    evidenceCompleteness: "UNAVAILABLE" as const,
    limitations: Object.freeze([limitationCode]),
    safety: SAFETY,
  })
}
