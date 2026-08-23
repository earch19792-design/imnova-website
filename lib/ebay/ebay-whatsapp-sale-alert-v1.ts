// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { stableCommercialKey } from "../marketplace/commercial-monitor-domain.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { SELLER_OS_DASHBOARD_SALE_ALERT_VERSION, sellerOsDashboardSaleAlertIdentityV1, type SellerOsSaleAlertsReadV1 } from "./ebay-sale-alerts-read-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { createUnavailableSellerOsSaleAlertsReadV1 } from "./ebay-sale-alerts-read-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildSellerOsCorrelationEnvelopeV1, buildSellerOsWorkflowStepExecutionV1 } from "./ebay-seller-os-workflow-foundation-v1.ts"

export const SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_VERSION =
  "SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_V1" as const
export const SELLER_OS_WHATSAPP_SALE_ALERT_VERSION =
  "SELLER_OS_WHATSAPP_SALE_ALERT_V1" as const
export const SELLER_OS_WHATSAPP_SALE_ALERT_STORAGE_ADAPTER_VERSION =
  "SELLER_OS_WHATSAPP_SALE_ALERT_STORAGE_ADAPTER_V1" as const

export const SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_whatsapp_sale_alert_status",
  title: "Get WhatsApp sale alert status",
  description: "Read the fixed canonical seller account's bounded, PII-free WhatsApp sale-alert eligibility, workflow, durable outbox receipt and deduplication evidence. This status read never sends a message and accepts no phone, account, URL, token, cursor, SQL or write instruction.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

export type SellerOsWhatsappProviderReadinessV1 = Readonly<{
  observedAt: string
  provider: "META_CLOUD_API"
  configurationStatus: "READY" | "NOT_READY" | "DISABLED"
  preflightStatus: "PASSED" | "FAILED" | "NOT_RUN" | "EXPIRED"
  deliveryAttemptAllowed: boolean
  realDeliveryPermitted: boolean
  configuredRecipientOnly: true
  approvedTemplateOnly: true
  environmentBoundary: "PREVIEW_ONLY"
  limitationCodes: readonly string[]
}>

export type SellerOsWhatsappDeliveryAuditRowV1 = Readonly<{
  deliveryKey: string
  outboxId: string
  status: "pending" | "leased" | "delivered" | "failed" |
    "dead_letter" | "cancelled"
  attempts: number
  leaseExpiresAt: string | null
  providerReferenceDigest: string | null
  deliveredAt: string | null
  lastErrorCode: string | null
  createdAt: string
  updatedAt: string
}>

export type SellerOsWhatsappDeliveryAuditV1 = Readonly<{
  source: "ALERT_DELIVERY_OUTBOX"
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"
  observedAt: string
  rows: readonly SellerOsWhatsappDeliveryAuditRowV1[]
  truncated: boolean
  limitationCodes: readonly string[]
}>

type SaleAlert = SellerOsSaleAlertsReadV1["alerts"][number]

const DESTINATION_CLASS = "CANONICAL_OWNER_OPERATOR" as const
const STEP_TYPE = "SEND_WHATSAPP_SALE_ALERT" as const
const MAXIMUM_STATUS_ENTRIES = 50

function uniqueCodes(values: readonly string[]) {
  return [...new Set(values.filter((value) =>
    /^[A-Z0-9_]{3,160}$/.test(value)))].sort().slice(0, 40)
}

export function sellerOsWhatsappSaleAlertDeliveryKeyV1(eventId: string) {
  return stableCommercialKey(
    eventId,
    "WHATSAPP_SALE_ALERT",
    DESTINATION_CLASS,
    SELLER_OS_WHATSAPP_SALE_ALERT_VERSION,
  )
}

export function sellerOsWhatsappSaleAlertStorageAdapterKeyV1(eventId: string) {
  return stableCommercialKey(
    eventId,
    "WHATSAPP_SALE_ALERT_STORAGE_ADAPTER",
    SELLER_OS_WHATSAPP_SALE_ALERT_STORAGE_ADAPTER_VERSION,
  )
}

export function buildSellerOsWhatsappSaleAlertDeliveryPlanV1(input: Readonly<{
  eventId: string
  orderId: string
  lineItemId: string
  itemId: string | null
  sku: string | null
  quantity: number
  orderCreatedAt: string
  orderStatus: string | null
  fulfillmentStatus: string | null
  marketplaceId: string | null
  detectionClass: "HISTORICAL_REPLAY" |
    "NEWLY_DETECTED_AFTER_I04_ACTIVATION"
  providerDeliveryAttemptAllowed: boolean
  legacyNotificationAlreadyMaterialized?: boolean
}>) {
  const deliveryKey = sellerOsWhatsappSaleAlertDeliveryKeyV1(input.eventId)
  const alertId = sellerOsDashboardSaleAlertIdentityV1(input.eventId)
  const historical = input.detectionClass === "HISTORICAL_REPLAY" ||
    input.legacyNotificationAlreadyMaterialized === true
  const eligible = !historical && input.providerDeliveryAttemptAllowed
  const reasonCode = historical
    ? "HISTORICAL_REPLAY_EXTERNAL_NOTIFICATION_FORBIDDEN" as const
    : !input.providerDeliveryAttemptAllowed
      ? "WHATSAPP_PROVIDER_OR_DESTINATION_NOT_READY" as const
      : "NEW_CANONICAL_SALE_ALERT_DELIVERY_ALLOWED" as const
  return Object.freeze({
    contractVersion: SELLER_OS_WHATSAPP_SALE_ALERT_VERSION,
    eventId: input.eventId,
    alertId,
    deliveryKey,
    storageAdapterKey: sellerOsWhatsappSaleAlertStorageAdapterKeyV1(
      input.eventId,
    ),
    destinationClass: DESTINATION_CLASS,
    detectionClass: input.detectionClass,
    eligible,
    reasonCode,
    sideEffectClass: "WHATSAPP_SEND" as const,
    authority: eligible
      ? "AUTO_EXECUTION_ALLOWED" as const
      : "READ_ONLY" as const,
    payload: Object.freeze({
      title: "Nueva venta eBay",
      summary: [
        input.sku ? `SKU ${input.sku}` : "SKU no disponible",
        input.itemId ? `Item ${input.itemId}` : "Item ID no disponible",
        `Cantidad ${input.quantity}`,
        `Order ${input.orderId}`,
      ].join(" · "),
      action: `Estado ${input.orderStatus ?? "no disponible"}; fulfillment ${input.fulfillmentStatus ?? "no disponible"}. Revisar la venta en Seller OS.`,
      eventId: input.eventId,
      dashboardAlertId: alertId,
      deliveryKey,
      orderId: input.orderId,
      lineItemId: input.lineItemId,
      itemId: input.itemId,
      sku: input.sku,
      quantity: input.quantity,
      orderCreatedAt: input.orderCreatedAt,
      marketplaceId: input.marketplaceId,
      notificationScope: "INTERNAL_OPERATOR_SALE_ALERT_ONLY",
      destinationClass: DESTINATION_CLASS,
      buyerPiiIncluded: false as const,
      rawUpstreamPayloadIncluded: false as const,
    }),
  })
}

function workflowState(row: SellerOsWhatsappDeliveryAuditRowV1 | null) {
  if (!row) return "NOT_STARTED" as const
  if (row.status === "leased") return "IN_PROGRESS" as const
  if (row.status === "delivered") return "SUCCEEDED" as const
  if (row.status === "failed") return "RETRYABLE_FAILURE" as const
  if (row.status === "dead_letter") return "TERMINAL_FAILURE" as const
  if (row.status === "cancelled") return "SKIPPED" as const
  return "NOT_STARTED" as const
}

function unavailableStatus(alerts: SellerOsSaleAlertsReadV1) {
  return alerts.status === "UNAVAILABLE"
}

export function buildSellerOsWhatsappSaleAlertStatusV1(input: Readonly<{
  saleAlerts: SellerOsSaleAlertsReadV1
  provider: SellerOsWhatsappProviderReadinessV1
  audit: SellerOsWhatsappDeliveryAuditV1
}>) {
  const { saleAlerts, provider, audit } = input
  if (unavailableStatus(saleAlerts)) {
    return Object.freeze({
      contractVersion: SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_VERSION,
      deliveryContractVersion: SELLER_OS_WHATSAPP_SALE_ALERT_VERSION,
      source: "SELLER_OS_DASHBOARD_SALE_ALERT_V1" as const,
      sourceContractVersion: SELLER_OS_DASHBOARD_SALE_ALERT_VERSION,
      authoritativeRootSource: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
      sourceStatus: "UNAVAILABLE" as const,
      observedAt: saleAlerts.observedAt,
      bounded: true as const,
      maximumStatusEntries: MAXIMUM_STATUS_ENTRIES,
      statusCount: null,
      observedStatusCount: null,
      entries: Object.freeze([]),
      providerReadiness: provider,
      deliveryPathStatus: "BLOCKED" as const,
      deliverySemantics: DELIVERY_SEMANTICS,
      authority: AUTHORITY,
      auditTrail: AUDIT_TRAIL,
      evidenceCompleteness: "UNAVAILABLE" as const,
      limitations: Object.freeze(uniqueCodes([
        ...saleAlerts.limitations,
        "DASHBOARD_SALE_ALERT_SOURCE_UNAVAILABLE",
        "NO_EVIDENCE_DOES_NOT_PROVE_ZERO",
      ])),
      safety: SAFETY,
    })
  }

  const auditByKey = new Map(audit.rows.map((row) => [row.deliveryKey, row]))
  const alerts = saleAlerts.alerts.slice(0, MAXIMUM_STATUS_ENTRIES)
  const entries = alerts.map((alert) => {
    const deliveryKey = sellerOsWhatsappSaleAlertDeliveryKeyV1(alert.eventId)
    const durable = auditByKey.get(deliveryKey) ?? null
    const historical = alert.detectionClass === "HISTORICAL_REPLAY"
    const historicalOutboxViolation = historical && durable !== null
    const providerReady = provider.deliveryAttemptAllowed &&
      provider.realDeliveryPermitted && provider.preflightStatus === "PASSED"
    const state = historical
      ? historicalOutboxViolation ? "BLOCKED" as const : "SKIPPED" as const
      : durable ? workflowState(durable)
        : providerReady ? "NOT_STARTED" as const : "BLOCKED" as const
    const receiptId = durable?.status === "delivered"
      ? stableCommercialKey(
          durable.outboxId,
          "WHATSAPP_PROVIDER_ACCEPTANCE_RECEIPT",
          SELLER_OS_WHATSAPP_SALE_ALERT_VERSION,
        )
      : null
    const correlation = buildSellerOsCorrelationEnvelopeV1({
      businessFactId: alert.eventId,
      eventId: alert.eventId,
      stepType: STEP_TYPE,
      stepVersion: SELLER_OS_WHATSAPP_SALE_ALERT_VERSION,
      sideEffectReceiptId: receiptId,
    })
    const limitationCodes = uniqueCodes([
      ...(historical
        ? ["HISTORICAL_REPLAY_EXTERNAL_NOTIFICATION_FORBIDDEN"] : []),
      ...(historicalOutboxViolation
        ? ["HISTORICAL_REPLAY_OUTBOX_PRESENT_SAFETY_VIOLATION"] : []),
      ...(!historical && !providerReady
        ? ["WHATSAPP_PROVIDER_OR_DESTINATION_NOT_READY"] : []),
      ...(durable?.status === "dead_letter"
        ? [durable.lastErrorCode ?? "WHATSAPP_DELIVERY_TERMINAL_FAILURE"] : []),
    ])
    return Object.freeze({
      deliveryContractVersion: SELLER_OS_WHATSAPP_SALE_ALERT_VERSION,
      eventId: alert.eventId,
      dashboardAlertId: alert.alertId,
      orderId: alert.orderId,
      lineItemId: alert.lineItemId,
      itemId: alert.itemId,
      sku: alert.sku,
      quantity: alert.quantity,
      marketplaceId: alert.marketplaceId,
      detectionClass: alert.detectionClass,
      eligibleForWhatsApp: !historical && providerReady,
      eligibilityReason: historical
        ? "HISTORICAL_REPLAY_EXTERNAL_NOTIFICATION_FORBIDDEN" as const
        : providerReady
          ? "NEW_CANONICAL_SALE_ALERT_DELIVERY_ALLOWED" as const
          : "WHATSAPP_PROVIDER_OR_DESTINATION_NOT_READY" as const,
      deliveryKey,
      destinationClass: DESTINATION_CLASS,
      destinationServerOwned: true as const,
      destinationIncluded: false as const,
      sideEffectClass: "WHATSAPP_SEND" as const,
      authority: providerReady && !historical
        ? "AUTO_EXECUTION_ALLOWED" as const : "READ_ONLY" as const,
      workflowStep: buildSellerOsWorkflowStepExecutionV1({
        stepExecutionId: correlation.stepExecutionId,
        stepType: STEP_TYPE,
        state,
        observedAt: audit.observedAt,
        sideEffectClass: "WHATSAPP_SEND",
        sideEffectReceiptId: receiptId,
        attemptCount: typeof durable?.attempts === "number" ? durable.attempts : 0,
        lease: durable?.status === "leased"
          ? { status: "ACTIVE", expiresAt: durable.leaseExpiresAt }
          : null,
        persistenceStatus: durable
          ? "DURABLE_ALERT_DELIVERY_OUTBOX" : "NO_DURABLE_OUTBOX_ROW",
      }),
      correlation,
      durableReceipt: Object.freeze({
        status: durable?.status === "delivered"
          ? "PRESENT" as const
          : audit.status === "UNAVAILABLE"
            ? "UNAVAILABLE" as const : "ABSENT" as const,
        receiptId,
        providerAcceptanceReferenceDigest:
          durable?.providerReferenceDigest ?? null,
        providerAcceptanceAt: durable?.deliveredAt ?? null,
        handsetDeliveryProven: false as const,
      }),
      attemptCount: typeof durable?.attempts === "number" ? durable.attempts : 0,
      providerReferenceSanitized: true as const,
      limitationCodes: Object.freeze(limitationCodes),
      buyerPiiIncluded: false as const,
    })
  })
  const historicalSendCount = entries.filter((entry) =>
    entry.detectionClass === "HISTORICAL_REPLAY" &&
    entry.durableReceipt.status === "PRESENT").length
  const successfulReceiptCount = entries.filter((entry) =>
    entry.durableReceipt.status === "PRESENT").length
  const newSuccessfulReceiptCount = entries.filter((entry) =>
    entry.detectionClass === "NEWLY_DETECTED_AFTER_I04_ACTIVATION" &&
    entry.durableReceipt.status === "PRESENT").length
  const truncated = saleAlerts.pagination.alertsTruncated === true ||
    saleAlerts.alerts.length > entries.length || audit.truncated
  const providerReady = provider.deliveryAttemptAllowed &&
    provider.realDeliveryPermitted && provider.preflightStatus === "PASSED"
  const complete = saleAlerts.evidenceCompleteness === "COMPLETE" &&
    audit.status === "AVAILABLE" && !truncated && historicalSendCount === 0
  return Object.freeze({
    contractVersion: SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_VERSION,
    deliveryContractVersion: SELLER_OS_WHATSAPP_SALE_ALERT_VERSION,
    source: "SELLER_OS_DASHBOARD_SALE_ALERT_V1" as const,
    sourceContractVersion: SELLER_OS_DASHBOARD_SALE_ALERT_VERSION,
    authoritativeRootSource: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
    sourceStatus: saleAlerts.sourceStatus,
    status: audit.status === "UNAVAILABLE"
      ? "PARTIAL" as const
      : historicalSendCount > 0 ? "BLOCKED" as const
        : truncated || audit.status === "PARTIAL"
          ? "PARTIAL" as const : "AVAILABLE" as const,
    observedAt: saleAlerts.observedAt,
    bounded: true as const,
    boundedWindow: saleAlerts.boundedWindow,
    maximumStatusEntries: MAXIMUM_STATUS_ENTRIES,
    statusCount: !truncated ? entries.length : null,
    observedStatusCount: entries.length,
    entries: Object.freeze(entries),
    providerReadiness: provider,
    deliveryPathStatus: providerReady ? "READY" as const : "BLOCKED" as const,
    deliveryOutcomes: Object.freeze({
      successfulReceiptCount,
      historicalSendCount,
      newlyDetectedSuccessfulReceiptCount: newSuccessfulReceiptCount,
      productionNewSaleSendObserved: newSuccessfulReceiptCount > 0,
    }),
    deduplication: Object.freeze({
      keyVersion: SELLER_OS_WHATSAPP_SALE_ALERT_VERSION,
      root: "CANONICAL_SALES_ORDER_EVENT_ID" as const,
      destinationClass: DESTINATION_CLASS,
      uniqueDurableOutboxKey: true as const,
      replayDoesNotChangeDeliveryKey: true as const,
      restartDoesNotChangeDeliveryKey: true as const,
      duplicateLogicalDeliveries: entries.length -
        new Set(entries.map((entry) => entry.deliveryKey)).size,
    }),
    deliverySemantics: DELIVERY_SEMANTICS,
    authority: AUTHORITY,
    auditTrail: AUDIT_TRAIL,
    evidenceCompleteness: complete
      ? "COMPLETE" as const : "PARTIAL" as const,
    limitations: Object.freeze(uniqueCodes([
      ...saleAlerts.limitations,
      ...audit.limitationCodes,
      ...provider.limitationCodes,
      ...(truncated ? ["WHATSAPP_SALE_ALERT_STATUS_TRUNCATED"] : []),
      ...(historicalSendCount > 0
        ? ["HISTORICAL_REPLAY_SEND_SAFETY_VIOLATION"] : []),
      ...(!providerReady ? ["WHATSAPP_DELIVERY_PATH_NOT_READY"] : []),
      "PRODUCTION_NEW_SALE_SEND_OBSERVED_SEPARATE_FROM_DELIVERY_PATH_READY",
    ])),
    safety: SAFETY,
  })
}

const DELIVERY_SEMANTICS = Object.freeze({
  classification: "AT_MOST_ONCE_BEST_EFFORT" as const,
  providerIdempotencyKeySupported: false as const,
  claimLeaseDurable: true as const,
  outboundDispatchStartedMarkerDurable: true as const,
  successReceiptDurable: true as const,
  succeededReceiptPreventsResendAfterRestart: true as const,
  indeterminateProviderOutcomeAutoRetryAllowed: false as const,
  indeterminateProviderOutcomeDisposition:
    "DEAD_LETTER_MANUAL_REVIEW" as const,
  expiredLeaseAfterDispatchStartedAutoRetryAllowed: false as const,
  crashAfterProviderAcceptanceBeforeReceiptDisposition:
    "DEAD_LETTER_MANUAL_REVIEW_NO_AUTO_RETRY" as const,
  deliveryMayBeLostToAvoidDuplicateWhenOutcomeIsUnknown: true as const,
  exactOnceClaimed: false as const,
})

const AUTHORITY = Object.freeze({
  contractVersion: "SELLER_OS_AUTOMATION_AUTHORITY_V1" as const,
  policyOwner: "SELLER_OS_SAFETY_AND_APPROVAL_FOUNDATION" as const,
  configuredNewSaleOperationalAlert:
    "AUTO_EXECUTION_ALLOWED" as const,
  historicalReplay: "READ_ONLY" as const,
  buyerMessaging: "NOT_AUTHORIZED" as const,
})

const AUDIT_TRAIL = Object.freeze({
  contractVersion: "SELLER_OS_AUDIT_TRAIL_POLICY_V1" as const,
  chain: Object.freeze([
    "OFFICIAL_ORDER", "SALES_ORDER_EVENT", "RECENT_SALES_FEED",
    "DASHBOARD_SALE_ALERT", "WHATSAPP_SALE_ALERT", "DELIVERY_OUTCOME",
  ] as const),
  rootIdentity: "CANONICAL_SALES_ORDER_EVENT_ID" as const,
})

const SAFETY = Object.freeze({
  readOnlyCertificationSurface: true as const,
  sideEffectsByThisRead: 0 as const,
  buyerPiiIncluded: false as const,
  rawUpstreamPayloadIncluded: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  phoneNumberIncluded: false as const,
  arbitraryUrlAllowed: false as const,
  callerControlledAccountAllowed: false as const,
  callerControlledTokenAllowed: false as const,
  callerControlledDestinationAllowed: false as const,
  databaseWritesByThisRead: 0 as const,
  marketplaceWrites: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  lunaLinkMutations: 0 as const,
  whatsappSendsByThisRead: 0 as const,
  buyerMessageSends: 0 as const,
  paymentTransactions: 0 as const,
})

export type SellerOsWhatsappSaleAlertStatusV1 = ReturnType<
  typeof buildSellerOsWhatsappSaleAlertStatusV1
>

export function createUnavailableSellerOsWhatsappSaleAlertStatusV1(
  limitationCode = "WHATSAPP_SALE_ALERT_STATUS_UNAVAILABLE",
) {
  const observedAt = new Date().toISOString()
  return buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts: createUnavailableSellerOsSaleAlertsReadV1(limitationCode),
    provider: Object.freeze({
      observedAt,
      provider: "META_CLOUD_API" as const,
      configurationStatus: "NOT_READY" as const,
      preflightStatus: "NOT_RUN" as const,
      deliveryAttemptAllowed: false,
      realDeliveryPermitted: false,
      configuredRecipientOnly: true as const,
      approvedTemplateOnly: true as const,
      environmentBoundary: "PREVIEW_ONLY" as const,
      limitationCodes: Object.freeze([limitationCode]),
    }),
    audit: Object.freeze({
      source: "ALERT_DELIVERY_OUTBOX" as const,
      status: "UNAVAILABLE" as const,
      observedAt,
      rows: Object.freeze([]),
      truncated: false,
      limitationCodes: Object.freeze([limitationCode]),
    }),
  })
}
