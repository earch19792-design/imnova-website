// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { stableCommercialKey } from "../marketplace/commercial-monitor-domain.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { SELLER_OS_RECENT_SALES_FEED_VERSION, buildSellerOsRecentSalesFeedV1, type SellerOsRecentSalesFeedV1 } from "./ebay-sales-order-read-model-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildSellerOsSalesOrderEventsReadV1 } from "./ebay-sales-order-events-read-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { createUnavailableSellerOsOfficialOrdersReadV1 } from "./ebay-official-orders-read-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildSellerOsCorrelationEnvelopeV1, buildSellerOsWorkflowStepExecutionV1 } from "./ebay-seller-os-workflow-foundation-v1.ts"

export const SELLER_OS_SALE_ALERTS_READ_VERSION =
  "SELLER_OS_SALE_ALERTS_READ_V1" as const
export const SELLER_OS_DASHBOARD_SALE_ALERT_VERSION =
  "SELLER_OS_DASHBOARD_SALE_ALERT_V1" as const
export const SELLER_OS_SALE_ALERT_ACTIVATION_CUTOVER_AT =
  "2026-08-21T03:25:44.000Z" as const

export const SELLER_OS_SALE_ALERTS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_sale_alerts",
  title: "Get canonical Dashboard sale alerts",
  description: "Project the fixed canonical seller account's bounded Recent Sales Feed into one deterministic, PII-free Dashboard alert per official order-line event. This read accepts no account, date, URL, token, cursor, SQL, or write instruction and never sends WhatsApp or buyer messages.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

const MAXIMUM_ALERTS = 50
const STEP_TYPE = "PROJECT_DASHBOARD_SALE_ALERT" as const

function limitationCodes(values: readonly string[]) {
  return [...new Set(values.filter((value) =>
    /^[A-Z0-9_]{3,160}$/.test(value)))].sort().slice(0, 30)
}

export function sellerOsDashboardSaleAlertIdentityV1(eventId: string) {
  return stableCommercialKey(
    eventId,
    "DASHBOARD_SALE_ALERT",
    SELLER_OS_DASHBOARD_SALE_ALERT_VERSION,
  )
}

export function classifySellerOsSaleAlertDetectionV1(
  orderCreatedAt: string,
  activationCutoverAt: string = SELLER_OS_SALE_ALERT_ACTIVATION_CUTOVER_AT,
) {
  const createdAt = Date.parse(orderCreatedAt)
  const cutoverAt = Date.parse(activationCutoverAt)
  return Number.isFinite(createdAt) && Number.isFinite(cutoverAt) &&
      createdAt > cutoverAt
    ? "NEWLY_DETECTED_AFTER_I04_ACTIVATION" as const
    : "HISTORICAL_REPLAY" as const
}

function unavailable(feed: SellerOsRecentSalesFeedV1) {
  return Object.freeze({
    contractVersion: SELLER_OS_SALE_ALERTS_READ_VERSION,
    alertContractVersion: SELLER_OS_DASHBOARD_SALE_ALERT_VERSION,
    source: "SELLER_OS_RECENT_SALES_FEED_V1" as const,
    sourceContractVersion: SELLER_OS_RECENT_SALES_FEED_VERSION,
    authoritativeRootSource: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
    sourceStatus: feed.sourceStatus,
    status: "UNAVAILABLE" as const,
    observedAt: feed.observedAt,
    bounded: true as const,
    boundedWindow: feed.boundedWindow,
    pagination: Object.freeze({
      maximumAlerts: MAXIMUM_ALERTS,
      alertsTruncated: null,
      sourceEntriesTruncated: feed.pagination.entriesTruncated,
    }),
    alertCount: null,
    observedAlertCount: null,
    alerts: Object.freeze([]),
    ordering: ORDERING,
    deduplication: Object.freeze({
      inputEventObservations: null,
      uniqueLogicalAlerts: null,
      duplicateObservationsBlocked: 0,
      alertIdentityStableAcrossReplay: true as const,
      alertIdentityStableAcrossRestart: true as const,
      rootEventIdentityPreserved: true as const,
      status: "SOURCE_UNAVAILABLE" as const,
    }),
    historicalReplayPolicy: HISTORICAL_REPLAY_POLICY,
    persistence: PERSISTENCE,
    authority: AUTHORITY,
    auditTrail: Object.freeze({
      contractVersion: "SELLER_OS_AUDIT_TRAIL_POLICY_V1" as const,
      status: "SOURCE_UNAVAILABLE" as const,
      chain: Object.freeze([
        "OFFICIAL_ORDER", "SALES_ORDER_EVENT", "RECENT_SALES_FEED",
        "DASHBOARD_SALE_ALERT",
      ] as const),
    }),
    evidenceCompleteness: "UNAVAILABLE" as const,
    limitations: Object.freeze(limitationCodes([
      ...feed.limitations,
      "RECENT_SALES_FEED_SOURCE_UNAVAILABLE",
      "NO_EVIDENCE_DOES_NOT_PROVE_ZERO",
      "DASHBOARD_ALERTS_NOT_DURABLY_PERSISTED",
    ])),
    safety: SAFETY,
  })
}

/**
 * Canonical I04 projection. It consumes only the certified line-grained I03
 * feed. The older order-grained recent-sales/SALE_DETECTED projections are
 * intentionally not accepted as inputs or identity owners.
 */
export function buildSellerOsSaleAlertsReadV1(
  feed: SellerOsRecentSalesFeedV1,
  options: Readonly<{ activationCutoverAt?: string }> = {},
) {
  if (feed.status === "UNAVAILABLE") return unavailable(feed)
  const activationCutoverAt = Number.isFinite(Date.parse(
    options.activationCutoverAt ?? SELLER_OS_SALE_ALERT_ACTIVATION_CUTOVER_AT,
  ))
    ? new Date(options.activationCutoverAt ??
      SELLER_OS_SALE_ALERT_ACTIVATION_CUTOVER_AT).toISOString()
    : SELLER_OS_SALE_ALERT_ACTIVATION_CUTOVER_AT
  const authoritative = feed.entries.filter((entry) =>
    entry.source === "EBAY_SELL_FULFILLMENT_GET_ORDERS" &&
    entry.provenance.authority === "OFFICIAL_EBAY_ORDER" &&
    entry.provenance.analyticsUsedAsOrderEvidence === false &&
    entry.eventLinkage.exact)
  const grouped = new Map<string, (typeof authoritative)[number][]>()
  for (const entry of authoritative) {
    const group = grouped.get(entry.eventId) ?? []
    group.push(entry)
    grouped.set(entry.eventId, group)
  }
  const projected = [...grouped.values()].map((group) => [...group].sort(
    (left, right) => right.orderLastModifiedAt.localeCompare(
      left.orderLastModifiedAt,
    ) || JSON.stringify(left).localeCompare(JSON.stringify(right)),
  )[0]).sort((left, right) =>
    right.orderCreatedAt.localeCompare(left.orderCreatedAt) ||
    left.eventId.localeCompare(right.eventId))
  const visible = projected.slice(0, MAXIMUM_ALERTS)
  const alerts = visible.map((entry) => {
    const alertId = sellerOsDashboardSaleAlertIdentityV1(entry.eventId)
    const detectionClass = classifySellerOsSaleAlertDetectionV1(
      entry.orderCreatedAt,
      activationCutoverAt,
    )
    const correlation = buildSellerOsCorrelationEnvelopeV1({
      businessFactId: entry.eventId,
      eventId: entry.eventId,
      stepType: STEP_TYPE,
      stepVersion: SELLER_OS_DASHBOARD_SALE_ALERT_VERSION,
    })
    return Object.freeze({
      alertContractVersion: SELLER_OS_DASHBOARD_SALE_ALERT_VERSION,
      alertId,
      eventId: entry.eventId,
      orderId: entry.orderId,
      lineItemId: entry.lineItemId,
      itemId: entry.itemId,
      sku: entry.sku,
      quantity: entry.quantity,
      marketplaceId: entry.marketplaceId,
      orderCreatedAt: entry.orderCreatedAt,
      orderLastModifiedAt: entry.orderLastModifiedAt,
      orderStatus: entry.orderStatus,
      fulfillmentStatus: entry.fulfillmentStatus,
      severity: "NORMAL" as const,
      lifecycleStatus: "ACTIVE" as const,
      visibilityStatus: "VISIBLE" as const,
      detectionClass,
      createdAt: detectionClass === "HISTORICAL_REPLAY"
        ? activationCutoverAt : entry.orderCreatedAt,
      updatedAt: entry.orderLastModifiedAt,
      source: "SELLER_OS_RECENT_SALES_FEED_V1" as const,
      authoritativeRootSource:
        "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
      sourceStatus: entry.sourceStatus,
      provenance: Object.freeze({
        ...entry.provenance,
        sourceContractVersion: SELLER_OS_RECENT_SALES_FEED_VERSION,
        sourceOperation: "PROJECT_RECENT_SALES_FEED_TO_DASHBOARD_ALERT" as const,
        rootEvidenceReference: entry.provenance.evidenceReference,
      }),
      correlation,
      workflowStep: buildSellerOsWorkflowStepExecutionV1({
        stepExecutionId: correlation.stepExecutionId,
        stepType: STEP_TYPE,
        state: "SUCCEEDED",
        observedAt: feed.observedAt,
        sideEffectClass: "OBSERVABILITY_READ",
      }),
      notificationDisposition: Object.freeze({
        dashboardVisible: true as const,
        historicalBackfillNotificationAllowed: false as const,
        whatsappSendAllowed: false as const,
        buyerMessageSendAllowed: false as const,
      }),
      buyerPiiIncluded: false as const,
    })
  })
  const sourceEntriesTruncated = feed.pagination.entriesTruncated === true
  const alertsTruncated = sourceEntriesTruncated || projected.length > alerts.length
  const excluded = feed.entries.length - authoritative.length
  const exact = feed.status === "AVAILABLE" && !alertsTruncated && excluded === 0
  const complete = exact && feed.evidenceCompleteness === "COMPLETE"
  return Object.freeze({
    contractVersion: SELLER_OS_SALE_ALERTS_READ_VERSION,
    alertContractVersion: SELLER_OS_DASHBOARD_SALE_ALERT_VERSION,
    source: "SELLER_OS_RECENT_SALES_FEED_V1" as const,
    sourceContractVersion: SELLER_OS_RECENT_SALES_FEED_VERSION,
    authoritativeRootSource: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
    sourceStatus: feed.sourceStatus,
    status: feed.status,
    observedAt: feed.observedAt,
    bounded: true as const,
    boundedWindow: feed.boundedWindow,
    pagination: Object.freeze({
      maximumAlerts: MAXIMUM_ALERTS,
      alertsTruncated,
      sourceEntriesTruncated: feed.pagination.entriesTruncated,
    }),
    alertCount: exact ? alerts.length : null,
    observedAlertCount: alerts.length,
    alerts: Object.freeze(alerts),
    ordering: ORDERING,
    deduplication: Object.freeze({
      inputEventObservations: authoritative.length,
      uniqueLogicalAlerts: grouped.size,
      duplicateObservationsBlocked: authoritative.length - grouped.size,
      alertIdentityStableAcrossReplay: true as const,
      alertIdentityStableAcrossRestart: true as const,
      rootEventIdentityPreserved: true as const,
      status: alertsTruncated || excluded > 0
        ? "PARTIAL" as const : "DETERMINISTIC" as const,
    }),
    historicalReplayPolicy: Object.freeze({
      ...HISTORICAL_REPLAY_POLICY,
      activationCutoverAt,
      historicalAlertCount: alerts.filter((alert) =>
        alert.detectionClass === "HISTORICAL_REPLAY").length,
      newlyDetectedAlertCount: alerts.filter((alert) =>
        alert.detectionClass === "NEWLY_DETECTED_AFTER_I04_ACTIVATION").length,
    }),
    persistence: PERSISTENCE,
    authority: AUTHORITY,
    auditTrail: Object.freeze({
      contractVersion: "SELLER_OS_AUDIT_TRAIL_POLICY_V1" as const,
      status: complete ? "COMPLETE" as const : "PARTIAL" as const,
      chain: Object.freeze([
        "OFFICIAL_ORDER", "SALES_ORDER_EVENT", "RECENT_SALES_FEED",
        "DASHBOARD_SALE_ALERT",
      ] as const),
    }),
    evidenceCompleteness: complete ? "COMPLETE" as const : "PARTIAL" as const,
    limitations: Object.freeze(limitationCodes([
      ...feed.limitations,
      ...(alertsTruncated ? ["SALE_ALERTS_RESPONSE_TRUNCATED"] : []),
      ...(excluded > 0 ? ["NON_AUTHORITATIVE_FEED_ENTRY_EXCLUDED"] : []),
      "DASHBOARD_ALERTS_NOT_DURABLY_PERSISTED",
    ])),
    safety: SAFETY,
  })
}

const ORDERING = Object.freeze({
  primary: "ORDER_CREATED_AT_DESC" as const,
  tieBreaker: "EVENT_ID_ASC" as const,
  observedAtUsedForOrdering: false as const,
  deterministic: true as const,
})

const HISTORICAL_REPLAY_POLICY = Object.freeze({
  policyVersion: "SELLER_OS_SALE_ALERT_BOOTSTRAP_POLICY_V1" as const,
  activationCutoverAt: SELLER_OS_SALE_ALERT_ACTIVATION_CUTOVER_AT,
  historicalRule: "ORDER_CREATED_AT_LESS_THAN_OR_EQUAL_TO_ACTIVATION_CUTOVER" as const,
  newDetectionRule: "ORDER_CREATED_AT_AFTER_ACTIVATION_CUTOVER" as const,
  historicalReplayVisibleOnDashboard: true as const,
  historicalReplayExternalNotificationAllowed: false as const,
})

const PERSISTENCE = Object.freeze({
  status: "DETERMINISTIC_DASHBOARD_PROJECTION" as const,
  durableAlertPersistedByThisRead: false as const,
  legacyCommercialAlertEventsUsedAsCanonicalOwner: false as const,
  legacyOrderGrainRecentSalesFeedUsedAsCanonicalOwner: false as const,
  naturalKey: "ROOT_SALES_ORDER_EVENT_ID" as const,
  databaseWrites: 0 as const,
  sideEffectClass: "OBSERVABILITY_READ" as const,
})

const AUTHORITY = Object.freeze({
  recentSalesFeedOnly: true as const,
  officialOrdersOnly: true as const,
  analyticsUsedAsAlertEvidence: false as const,
  semanticBoundary:
    "ANALYTICS_QUANTITY_SOLD_IS_NOT_OFFICIAL_ORDERS" as const,
})

const SAFETY = Object.freeze({
  readOnlyAuditSurface: true as const,
  automationAuthority: "READ_ONLY" as const,
  buyerPiiIncluded: false as const,
  rawUpstreamPayloadIncluded: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  arbitraryUrlAllowed: false as const,
  callerControlledAccountAllowed: false as const,
  callerControlledTokenAllowed: false as const,
  databaseWrites: 0 as const,
  internalIdempotentMaintenanceWrites: 0 as const,
  internalBusinessStateWrites: 0 as const,
  marketplaceWrites: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  lunaLinkMutations: 0 as const,
  whatsappSends: 0 as const,
  buyerMessageSends: 0 as const,
  paymentTransactions: 0 as const,
})

export function createUnavailableSellerOsSaleAlertsReadV1(
  limitationCode = "SALE_ALERTS_READ_NOT_AVAILABLE",
) {
  return unavailable(buildSellerOsRecentSalesFeedV1(
    buildSellerOsSalesOrderEventsReadV1(
      createUnavailableSellerOsOfficialOrdersReadV1(limitationCode),
    ),
  ))
}

export type SellerOsSaleAlertsReadV1 = ReturnType<
  typeof buildSellerOsSaleAlertsReadV1
>
