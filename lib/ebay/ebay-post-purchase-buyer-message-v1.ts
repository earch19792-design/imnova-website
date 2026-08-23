import { createHash } from "node:crypto"

// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { stableCommercialKey } from "../marketplace/commercial-monitor-domain.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { EBAY_COMMERCIAL_ORDERS_COMMERCE_MESSAGE_SCOPE } from "./ebay-commercial-orders-oauth-domain.ts"
import {
  POST_PURCHASE_THANK_YOU_TEMPLATE_V1,
  POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
} from "./ebay-sales-order-event-foundation-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { SELLER_OS_DASHBOARD_SALE_ALERT_VERSION, type SellerOsSaleAlertsReadV1 } from "./ebay-sale-alerts-read-v1.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { buildSellerOsCorrelationEnvelopeV1, buildSellerOsWorkflowStepExecutionV1 } from "./ebay-seller-os-workflow-foundation-v1.ts"

export const POST_PURCHASE_BUYER_MESSAGE_VERSION =
  "POST_PURCHASE_BUYER_MESSAGE_V1" as const
export const ONE_ORDER_ONE_THANK_YOU_MESSAGE_VERSION =
  "ONE_ORDER_ONE_THANK_YOU_MESSAGE_V1" as const
export const BUYER_MESSAGE_AUDIT_VERSION = "BUYER_MESSAGE_AUDIT_V1" as const
export const SELLER_OS_BUYER_THANK_YOU_STATUS_VERSION =
  "SELLER_OS_BUYER_THANK_YOU_STATUS_V1" as const
export const SELLER_OS_EBAY_BUYER_THANK_YOU_VERSION =
  "SELLER_OS_EBAY_BUYER_THANK_YOU_V1" as const
export const SELLER_OS_BUYER_THANK_YOU_STORAGE_ADAPTER_VERSION =
  "SELLER_OS_BUYER_THANK_YOU_STORAGE_ADAPTER_V1" as const
export const SELLER_OS_BUYER_THANK_YOU_ACTIVATION_CUTOVER_AT =
  "2026-08-21T04:56:20.000Z" as const

export const EBAY_COMMERCE_MESSAGE_SCOPE =
  EBAY_COMMERCIAL_ORDERS_COMMERCE_MESSAGE_SCOPE

export const SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1 = Object.freeze({
  name: "seller_os_get_buyer_thank_you_status",
  title: "Get eBay buyer thank-you status",
  description: "Read the fixed canonical seller account's bounded, order-grained, PII-free eBay buyer thank-you eligibility, workflow, capability and durable receipt evidence. This status read never sends a message and accepts no recipient, account, URL, token, text, SQL or write instruction.",
  annotations: Object.freeze({
    readOnlyHint: true as const,
    destructiveHint: false as const,
    openWorldHint: false as const,
    idempotentHint: true as const,
  }),
  sideEffects: false as const,
})

const MESSAGE_API_ORIGIN = "https://api.ebay.com"
const MESSAGE_API_BASE_PATH = "/commerce/message/v1"
const MESSAGE_PREFLIGHT_PATH = `${MESSAGE_API_BASE_PATH}/conversation`
const MESSAGE_SEND_PATH = `${MESSAGE_API_BASE_PATH}/send_message`
const FULFILLMENT_ORDER_PATH = "/sell/fulfillment/v1/order"
const MARKETPLACE_ID = "EBAY_US"
const REQUEST_TIMEOUT_MS = 12_000
const MAXIMUM_STATUS_ENTRIES = 50
const STEP_TYPE = "SEND_EBAY_BUYER_THANK_YOU" as const

export type SellerOsBuyerThankYouCapabilityV1 = Readonly<{
  observedAt: string
  provider: "EBAY_COMMERCE_MESSAGE_API"
  status: "READY" | "NOT_ACTIVATED" | "AUTHORIZATION_BLOCKED" |
    "ACCOUNT_BINDING_MISMATCH" | "UPSTREAM_ERROR" | "UNAVAILABLE" |
    "BLOCKED_NON_PREVIEW"
  accountBindingStatus: "MATCHED" | "MISMATCHED" | "UNAVAILABLE"
  commerceMessageScopeConfirmed: boolean
  refreshCapabilityConfirmed: boolean
  fixedReadPreflightUsed: boolean
  deliveryAttemptAllowed: boolean
  automaticExecutionAuthority: "AUTO_EXECUTION_ALLOWED" |
    "HUMAN_APPROVAL_REQUIRED"
  limitationCodes: readonly string[]
}>

export type SellerOsBuyerThankYouAuditRowV1 = Readonly<{
  deliveryKey: string
  ledgerEventId: string
  workflowState: "NOT_STARTED" | "IN_PROGRESS" | "SUCCEEDED" |
    "RETRYABLE_FAILURE" | "TERMINAL_FAILURE" | "BLOCKED" |
    "SKIPPED" | "NOT_APPLICABLE"
  attemptCount: number
  dispatchStarted: boolean
  leaseExpiresAt: string | null
  receiptStatus: "PRESENT" | "ABSENT" | "UNKNOWN_OUTCOME"
  providerReferenceDigest: string | null
  succeededAt: string | null
  lastErrorCode: string | null
  manualReviewRequired: boolean
  createdAt: string
}>

export type SellerOsBuyerThankYouAuditV1 = Readonly<{
  source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER"
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"
  observedAt: string
  rows: readonly SellerOsBuyerThankYouAuditRowV1[]
  truncated: boolean
  limitationCodes: readonly string[]
}>

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>
type SaleAlert = SellerOsSaleAlertsReadV1["alerts"][number]

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : ""
}

function iso(value: unknown) {
  const candidate = text(value, 40)
  return Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString() : null
}

function limitationCodes(values: readonly string[]) {
  return [...new Set(values.filter((value) =>
    /^[A-Z0-9_]{3,160}$/.test(value)))].sort().slice(0, 40)
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
}

function validEventId(value: string) {
  return /^commercial-v1:[0-9a-f]{64}$/.test(value)
}

function validOrderId(value: string) {
  return /^[A-Za-z0-9-]{5,120}$/.test(value)
}

function validItemId(value: string) {
  return /^\d{9,20}$/.test(value)
}

export function sellerOsBuyerThankYouDeliveryKeyV1(input: Readonly<{
  orderId: string
  eventIds: readonly string[]
}>) {
  const orderId = text(input.orderId, 120)
  const eventIds = [...new Set(input.eventIds)].sort()
  if (!validOrderId(orderId) || !eventIds.length ||
      eventIds.some((eventId) => !validEventId(eventId))) {
    throw new Error("BUYER_THANK_YOU_ORDER_IDENTITY_INVALID")
  }
  return stableCommercialKey(
    "CANONICAL_EBAY_SELLER_ACCOUNT",
    orderId,
    ...eventIds,
    "EBAY_BUYER_THANK_YOU",
    POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
    SELLER_OS_EBAY_BUYER_THANK_YOU_VERSION,
  )
}

export function classifySellerOsBuyerThankYouDetectionV1(
  orderCreatedAt: string,
  dashboardDetectionClasses: readonly string[],
  activationCutoverAt: string =
    SELLER_OS_BUYER_THANK_YOU_ACTIVATION_CUTOVER_AT,
) {
  const createdAt = Date.parse(orderCreatedAt)
  const cutoverAt = Date.parse(activationCutoverAt)
  return Number.isFinite(createdAt) && Number.isFinite(cutoverAt) &&
      createdAt > cutoverAt && dashboardDetectionClasses.length > 0 &&
      dashboardDetectionClasses.every((value) =>
        value === "NEWLY_DETECTED_AFTER_I04_ACTIVATION")
    ? "NEWLY_DETECTED_AFTER_ACTIVATION" as const
    : "HISTORICAL_REPLAY" as const
}

export function getPostPurchaseBuyerMessageCapabilityV1(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const preview = environment.VERCEL_ENV === "preview"
  const explicitlyEnabled = environment
    .EBAY_POST_PURCHASE_THANK_YOU_ENABLED === "true"
  return Object.freeze({
    contractVersion: POST_PURCHASE_BUYER_MESSAGE_VERSION,
    status: !preview
      ? "BLOCKED_NON_PREVIEW" as const
      : explicitlyEnabled
        ? "PREFLIGHT_REQUIRED" as const
        : "NOT_ACTIVATED" as const,
    requiredScope: EBAY_COMMERCE_MESSAGE_SCOPE,
    previewOnly: true as const,
    explicitlyEnabled,
    exactlyOneApprovedTemplate: true as const,
    templateVersion: POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
    arbitraryTextAllowed: false as const,
    arbitraryRecipientAllowed: false as const,
    unrelatedMarketplaceWritesAllowed: false as const,
    durableOrderLevelLeaseRequired: true as const,
    durableOrderLevelLeaseActivated: true as const,
    authoritativeOrderPartnerContextRequired: true as const,
    automaticSendImplemented: true as const,
    networkWriteExposedByMcp: false as const,
    credentialsReturned: false as const,
  })
}

function safeOAuthErrorCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  if (/UNAUTHORIZED_SCOPE|INVALID_SCOPE/.test(value)) {
    return "EBAY_BUYER_MESSAGE_AUTHORIZATION_BLOCKED_INVALID_SCOPE"
  }
  if (/REFRESH_TOKEN_REVOKED_OR_EXPIRED/.test(value)) {
    return "EBAY_BUYER_MESSAGE_AUTHORIZATION_BLOCKED_REFRESH_TOKEN_REVOKED_OR_EXPIRED"
  }
  if (/INVALID_GRANT/.test(value)) {
    return "EBAY_BUYER_MESSAGE_AUTHORIZATION_BLOCKED_INVALID_GRANT"
  }
  if (/INVALID_CLIENT|CLIENT_CREDENTIAL_MISMATCH/.test(value)) {
    return "EBAY_BUYER_MESSAGE_AUTHORIZATION_BLOCKED_CLIENT_CREDENTIAL_MISMATCH"
  }
  if (/AUTHORIZATION_REQUIRED/.test(value)) {
    return "EBAY_BUYER_MESSAGE_AUTHORIZATION_BLOCKED"
  }
  if (/ACCOUNT_(?:IDENTITY|FINGERPRINT)_MISMATCH/.test(value)) {
    return "EBAY_BUYER_MESSAGE_ACCOUNT_BINDING_MISMATCH"
  }
  if (/TOKEN_ENDPOINT_UNAVAILABLE/.test(value)) {
    return "EBAY_BUYER_MESSAGE_OAUTH_UPSTREAM_UNAVAILABLE"
  }
  if (/MALFORMED_REQUEST/.test(value)) {
    return "EBAY_BUYER_MESSAGE_OAUTH_CONFIGURATION_UNAVAILABLE"
  }
  return "EBAY_BUYER_MESSAGE_AUTH_UNAVAILABLE"
}

async function canonicalMessageToken(fetchImpl: FetchLike) {
  const oauth = await import("./ebay-commercial-oauth")
  return oauth.getEbayCommercialMessageAccessToken(fetchImpl)
}

async function canonicalOrdersToken(fetchImpl: FetchLike) {
  const oauth = await import("./ebay-commercial-oauth")
  return oauth.getEbayCommercialOrdersAccessToken(fetchImpl)
}

async function clearCanonicalMessageToken() {
  const oauth = await import("./ebay-commercial-oauth")
  oauth.clearEbayCommercialMessageAccessToken()
}

async function clearCanonicalOrdersToken() {
  const oauth = await import("./ebay-commercial-oauth")
  oauth.clearEbayCommercialOrdersAccessToken()
}

async function verifyCanonicalSellerAccount(
  token: string,
  fetchImpl: FetchLike,
) {
  const readers = await import("./ebay-commercial-readers")
  return readers.verifyEbayCommercialOfficialAccount(token, fetchImpl)
}

export async function preflightEbayBuyerMessagingCapabilityV1(options: {
  environment?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  now?: () => Date
  tokenProvider?: () => Promise<string>
  identityVerifier?: (token: string) => Promise<unknown>
} = {}): Promise<SellerOsBuyerThankYouCapabilityV1> {
  const environment = options.environment ?? process.env
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())
  const observedAt = now().toISOString()
  const configuration = getPostPurchaseBuyerMessageCapabilityV1(environment)
  if (configuration.status === "BLOCKED_NON_PREVIEW") {
    return Object.freeze({ observedAt, provider: "EBAY_COMMERCE_MESSAGE_API",
      status: "BLOCKED_NON_PREVIEW", accountBindingStatus: "UNAVAILABLE",
      commerceMessageScopeConfirmed: false, refreshCapabilityConfirmed: false,
      fixedReadPreflightUsed: false, deliveryAttemptAllowed: false,
      automaticExecutionAuthority: "HUMAN_APPROVAL_REQUIRED",
      limitationCodes: Object.freeze(["BUYER_MESSAGE_PREVIEW_ONLY"]),
    })
  }
  let token = ""
  try {
    token = await (options.tokenProvider ?? (() =>
      canonicalMessageToken(fetchImpl)))()
    await (options.identityVerifier ?? ((value) =>
      verifyCanonicalSellerAccount(value, fetchImpl)))(token)
  } catch (error) {
    const code = safeOAuthErrorCode(error)
    token = ""
    return Object.freeze({ observedAt, provider: "EBAY_COMMERCE_MESSAGE_API",
      status: code.includes("ACCOUNT_BINDING")
        ? "ACCOUNT_BINDING_MISMATCH" as const
        : code.includes("AUTHORIZATION")
          ? "AUTHORIZATION_BLOCKED" as const
          : code.includes("UPSTREAM")
            ? "UPSTREAM_ERROR" as const : "UNAVAILABLE" as const,
      accountBindingStatus: code.includes("ACCOUNT_BINDING")
        ? "MISMATCHED" as const : "UNAVAILABLE" as const,
      commerceMessageScopeConfirmed: false, refreshCapabilityConfirmed: false,
      fixedReadPreflightUsed: false, deliveryAttemptAllowed: false,
      automaticExecutionAuthority: "HUMAN_APPROVAL_REQUIRED" as const,
      limitationCodes: Object.freeze([code]),
    })
  }
  try {
    const url = new URL(MESSAGE_PREFLIGHT_PATH, MESSAGE_API_ORIGIN)
    url.searchParams.set("conversation_type", "FROM_MEMBERS")
    url.searchParams.set("limit", "1")
    url.searchParams.set("offset", "0")
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    token = ""
    await response.body?.cancel().catch(() => undefined)
    if (!response.ok) {
      if (response.status === 401) await clearCanonicalMessageToken()
      const authorization = response.status === 401 || response.status === 403
      return Object.freeze({ observedAt, provider: "EBAY_COMMERCE_MESSAGE_API",
        status: authorization ? "AUTHORIZATION_BLOCKED" as const
          : response.status >= 500 ? "UPSTREAM_ERROR" as const
            : "UNAVAILABLE" as const,
        accountBindingStatus: "MATCHED" as const,
        commerceMessageScopeConfirmed: false,
        refreshCapabilityConfirmed: true,
        fixedReadPreflightUsed: true,
        deliveryAttemptAllowed: false,
        automaticExecutionAuthority: "HUMAN_APPROVAL_REQUIRED" as const,
        limitationCodes: Object.freeze([authorization
          ? `EBAY_BUYER_MESSAGE_PREFLIGHT_${response.status}`
          : "EBAY_BUYER_MESSAGE_PREFLIGHT_UNAVAILABLE"]),
      })
    }
    const enabled = configuration.explicitlyEnabled
    return Object.freeze({ observedAt, provider: "EBAY_COMMERCE_MESSAGE_API",
      status: enabled ? "READY" as const : "NOT_ACTIVATED" as const,
      accountBindingStatus: "MATCHED" as const,
      commerceMessageScopeConfirmed: true,
      refreshCapabilityConfirmed: true,
      fixedReadPreflightUsed: true,
      deliveryAttemptAllowed: enabled,
      automaticExecutionAuthority: enabled
        ? "AUTO_EXECUTION_ALLOWED" as const
        : "HUMAN_APPROVAL_REQUIRED" as const,
      limitationCodes: Object.freeze(enabled ? [] : [
        "BUYER_MESSAGE_EXPLICIT_ACTIVATION_REQUIRED",
      ]),
    })
  } catch {
    token = ""
    return Object.freeze({ observedAt, provider: "EBAY_COMMERCE_MESSAGE_API",
      status: "UPSTREAM_ERROR", accountBindingStatus: "MATCHED",
      commerceMessageScopeConfirmed: false, refreshCapabilityConfirmed: true,
      fixedReadPreflightUsed: true, deliveryAttemptAllowed: false,
      automaticExecutionAuthority: "HUMAN_APPROVAL_REQUIRED",
      limitationCodes: Object.freeze([
        "EBAY_BUYER_MESSAGE_PREFLIGHT_UPSTREAM_ERROR",
      ]),
    })
  }
}

function groupAlertsByOrder(alerts: readonly SaleAlert[]) {
  const groups = new Map<string, Map<string, SaleAlert>>()
  for (const alert of alerts) {
    const group = groups.get(alert.orderId) ?? new Map<string, SaleAlert>()
    const previous = group.get(alert.eventId)
    if (!previous || alert.orderLastModifiedAt >=
        previous.orderLastModifiedAt) group.set(alert.eventId, alert)
    groups.set(alert.orderId, group)
  }
  return [...groups.entries()].map(([orderId, rows]) => ({ orderId,
    rows: [...rows.values()].sort((left, right) => left.eventId.localeCompare(
      right.eventId)),
  })).sort((left, right) =>
    right.rows[0].orderCreatedAt.localeCompare(left.rows[0].orderCreatedAt) ||
    left.orderId.localeCompare(right.orderId))
}

export function sellerOsBuyerThankYouDeliveryKeysForSaleAlertsV1(
  saleAlerts: SellerOsSaleAlertsReadV1,
) {
  if (saleAlerts.status === "UNAVAILABLE") return Object.freeze([] as string[])
  return Object.freeze(groupAlertsByOrder(saleAlerts.alerts)
    .slice(0, MAXIMUM_STATUS_ENTRIES)
    .map(({ orderId, rows }) => sellerOsBuyerThankYouDeliveryKeyV1({
      orderId,
      eventIds: rows.map((row) => row.eventId),
    })))
}

function auditWorkflowState(row: SellerOsBuyerThankYouAuditRowV1 | null) {
  return row?.workflowState ?? "NOT_STARTED" as const
}

export function buildSellerOsBuyerThankYouStatusV1(input: Readonly<{
  saleAlerts: SellerOsSaleAlertsReadV1
  capability: SellerOsBuyerThankYouCapabilityV1
  audit: SellerOsBuyerThankYouAuditV1
  activationCutoverAt?: string
}>) {
  const activationCutoverAt = iso(input.activationCutoverAt ??
    SELLER_OS_BUYER_THANK_YOU_ACTIVATION_CUTOVER_AT) ??
    SELLER_OS_BUYER_THANK_YOU_ACTIVATION_CUTOVER_AT
  const sourceUnavailable = input.saleAlerts.status === "UNAVAILABLE"
  const grouped = sourceUnavailable ? [] : groupAlertsByOrder(
    input.saleAlerts.alerts,
  ).slice(0, MAXIMUM_STATUS_ENTRIES)
  const auditByKey = new Map(input.audit.rows.map((row) =>
    [row.deliveryKey, row]))
  const entries = grouped.map(({ orderId, rows }) => {
    const eventIds = rows.map((row) => row.eventId)
    const lineItemIds = rows.map((row) => row.lineItemId)
    const itemIds = rows.map((row) => row.itemId).filter(
      (value): value is string => Boolean(value))
    const lineItems = rows.map((row) => Object.freeze({
      lineItemId: row.lineItemId,
      itemId: row.itemId,
      sku: row.sku,
      quantity: row.quantity,
    }))
    const deliveryKey = sellerOsBuyerThankYouDeliveryKeyV1({
      orderId, eventIds,
    })
    const durable = auditByKey.get(deliveryKey) ?? null
    const detectionClass = classifySellerOsBuyerThankYouDetectionV1(
      rows[0].orderCreatedAt,
      rows.map((row) => row.detectionClass),
      activationCutoverAt,
    )
    const historical = detectionClass === "HISTORICAL_REPLAY"
    const sourceComplete = input.saleAlerts.status === "AVAILABLE" &&
      input.saleAlerts.evidenceCompleteness === "COMPLETE"
    const auditComplete = input.audit.status === "AVAILABLE"
    const orderEligible = rows.every((row) =>
      row.orderStatus === "PAID" &&
      row.source === "SELLER_OS_RECENT_SALES_FEED_V1" &&
      row.authoritativeRootSource === "EBAY_SELL_FULFILLMENT_GET_ORDERS")
    const capabilityReady = input.capability.status === "READY" &&
      input.capability.deliveryAttemptAllowed
    const historicalLedgerViolation = historical && durable !== null
    const eligible = !historical && sourceComplete && auditComplete &&
      orderEligible && capabilityReady &&
      durable?.workflowState !== "SUCCEEDED" &&
      durable?.manualReviewRequired !== true
    const state = historical
      ? historicalLedgerViolation ? "BLOCKED" as const : "SKIPPED" as const
      : durable ? auditWorkflowState(durable)
        : sourceComplete && auditComplete && orderEligible && capabilityReady
          ? "NOT_STARTED" as const : "BLOCKED" as const
    const primaryEventId = eventIds[0]
    const receiptId = durable?.receiptStatus === "PRESENT" &&
        durable.providerReferenceDigest
      ? stableCommercialKey(deliveryKey,
          durable.providerReferenceDigest,
          "EBAY_BUYER_MESSAGE_ACCEPTANCE_RECEIPT")
      : null
    const correlation = buildSellerOsCorrelationEnvelopeV1({
      businessFactId: stableCommercialKey(orderId,
        "EBAY_ORDER_BUYER_THANK_YOU_BUSINESS_FACT"),
      eventId: primaryEventId,
      stepType: STEP_TYPE,
      stepVersion: SELLER_OS_EBAY_BUYER_THANK_YOU_VERSION,
      sideEffectReceiptId: receiptId,
    })
    const limitations = limitationCodes([
      ...(historical
        ? ["HISTORICAL_REPLAY_BUYER_MESSAGE_FORBIDDEN"] : []),
      ...(historicalLedgerViolation
        ? ["HISTORICAL_REPLAY_DELIVERY_LEDGER_SAFETY_VIOLATION"] : []),
      ...(!historical && !orderEligible
        ? ["BUYER_THANK_YOU_ORDER_NOT_ELIGIBLE"] : []),
      ...(!historical && !sourceComplete
        ? ["BUYER_THANK_YOU_SOURCE_EVIDENCE_INCOMPLETE"] : []),
      ...(!historical && !auditComplete
        ? ["BUYER_THANK_YOU_DURABLE_LEDGER_EVIDENCE_INCOMPLETE"] : []),
      ...(!historical && !capabilityReady
        ? input.capability.limitationCodes : []),
      ...(durable?.manualReviewRequired
        ? ["UNKNOWN_PROVIDER_OUTCOME_MANUAL_REVIEW_REQUIRED"] : []),
      ...(durable?.lastErrorCode ? [durable.lastErrorCode] : []),
    ])
    return Object.freeze({
      deliveryContractVersion: SELLER_OS_EBAY_BUYER_THANK_YOU_VERSION,
      orderId,
      eventIds: Object.freeze(eventIds),
      primaryCorrelationEventId: primaryEventId,
      lineItemIds: Object.freeze(lineItemIds),
      itemIds: Object.freeze(itemIds),
      lineItems: Object.freeze(lineItems),
      officialQuantity: rows.reduce((total, row) => total + row.quantity, 0),
      orderCreatedAt: rows[0].orderCreatedAt,
      orderStatus: rows[0].orderStatus,
      fulfillmentStatus: rows[0].fulfillmentStatus,
      marketplaceId: rows[0].marketplaceId,
      messageGrain: "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER" as const,
      detectionClass,
      eligibleForBuyerThankYou: eligible,
      buyerMessageSendAllowed: eligible,
      authority: input.capability.automaticExecutionAuthority,
      deliveryKey,
      templateVersion: POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
      workflowStep: buildSellerOsWorkflowStepExecutionV1({
        stepExecutionId: correlation.stepExecutionId,
        stepType: STEP_TYPE,
        state,
        observedAt: input.audit.observedAt,
        sideEffectClass: "BUYER_MESSAGE_SEND",
        sideEffectReceiptId: receiptId,
        attemptCount: durable?.attemptCount ?? 0,
        lease: durable ? Object.freeze({
          status: durable.workflowState,
          expiresAt: durable.leaseExpiresAt,
        }) : null,
        persistenceStatus: durable
          ? "DURABLE_COMMERCIAL_EVENT_LEDGER"
          : historical ? "NOT_APPLICABLE_HISTORICAL_REPLAY"
            : "NOT_YET_RESERVED",
      }),
      receipt: Object.freeze({
        status: durable?.receiptStatus ?? "ABSENT" as const,
        providerReferenceDigest: durable?.providerReferenceDigest ?? null,
        succeededAt: durable?.succeededAt ?? null,
        manualReviewRequired: durable?.manualReviewRequired ?? false,
      }),
      correlation: Object.freeze({ ...correlation,
        involvedEventIds: Object.freeze(eventIds),
        orderLevelDeliveryKey: deliveryKey,
      }),
      sideEffectClasses: Object.freeze([
        "BUYER_MESSAGE_SEND", "MARKETPLACE_WRITE",
      ] as const),
      deduplication: Object.freeze({
        naturalKey: "CANONICAL_ACCOUNT_MARKETPLACE_ORDER_EVENT_ROOT_SET_TEMPLATE_VERSION" as const,
        eventRootsIncluded: true as const,
        stableAcrossReplay: true as const,
        stableAcrossRestart: true as const,
        maximumSuccessfulMessagesPerOrder: 1 as const,
      }),
      limitationCodes: Object.freeze(limitations),
      buyerPiiIncluded: false as const,
      buyerIdentityIncluded: false as const,
    })
  })
  const truncated = !sourceUnavailable &&
    groupAlertsByOrder(input.saleAlerts.alerts).length > entries.length
  const historicalCount = entries.filter((entry) =>
    entry.detectionClass === "HISTORICAL_REPLAY").length
  const succeededCount = entries.filter((entry) =>
    entry.workflowStep.state === "SUCCEEDED").length
  const partial = input.saleAlerts.status === "PARTIAL" ||
    input.audit.status === "PARTIAL" || truncated
  return Object.freeze({
    contractVersion: SELLER_OS_BUYER_THANK_YOU_STATUS_VERSION,
    deliveryContractVersion: SELLER_OS_EBAY_BUYER_THANK_YOU_VERSION,
    source: "SELLER_OS_DASHBOARD_SALE_ALERT_V1" as const,
    sourceContractVersion: SELLER_OS_DASHBOARD_SALE_ALERT_VERSION,
    authoritativeRootSource: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
    sourceStatus: sourceUnavailable ? "UNAVAILABLE" as const
      : partial ? "PARTIAL" as const : "AVAILABLE" as const,
    observedAt: input.saleAlerts.observedAt,
    bounded: true as const,
    maximumStatusEntries: MAXIMUM_STATUS_ENTRIES,
    statusCount: sourceUnavailable ? null : entries.length,
    entries: Object.freeze(entries),
    activation: Object.freeze({
      policyVersion: "I06_ACTIVATION_CUTOVER_V1" as const,
      activationCutoverAt,
      historicalOrderCount: sourceUnavailable ? null : historicalCount,
      newlyDetectedOrderCount: sourceUnavailable ? null
        : entries.length - historicalCount,
      historicalReplayBuyerMessageAllowed: false as const,
    }),
    message: Object.freeze({
      templateVersion: POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
      template: POST_PURCHASE_THANK_YOU_TEMPLATE_V1,
      templateDigest: digest(POST_PURCHASE_THANK_YOU_TEMPLATE_V1),
      language: "en" as const,
      messageGrain: "ONE_BUYER_THANK_YOU_PER_EBAY_ORDER" as const,
      arbitraryTextAllowed: false as const,
    }),
    capability: input.capability,
    deliverySemantics: Object.freeze({
      guarantee: "AT_MOST_ONCE_BEST_EFFORT" as const,
      providerIdempotencySupported: false as const,
      durablePreDispatchClaimRequired: true as const,
      successReceiptPreventsRestartResend: true as const,
      unknownProviderOutcomePolicy: "MANUAL_REVIEW_NO_AUTOMATIC_RESEND" as const,
    }),
    auditTrail: Object.freeze({
      contractVersion: "SELLER_OS_AUDIT_TRAIL_POLICY_V1" as const,
      chain: Object.freeze([
        "OFFICIAL_ORDER", "SALES_ORDER_EVENT", "RECENT_SALES_FEED",
        "DASHBOARD_SALE_ALERT", "WHATSAPP_SALE_ALERT",
        "EBAY_BUYER_THANK_YOU", "DELIVERY_OUTCOME",
      ] as const),
      whatsappAndBuyerMessageSiblingStepsIndependent: true as const,
    }),
    buyerMessageSendCount: sourceUnavailable ? null : succeededCount,
    productionNewSaleBuyerMessageObserved: sourceUnavailable ? null
      : entries.some((entry) => entry.detectionClass ===
          "NEWLY_DETECTED_AFTER_ACTIVATION" &&
          entry.workflowStep.state === "SUCCEEDED"),
    evidenceCompleteness: sourceUnavailable ? "UNAVAILABLE" as const
      : partial ? "PARTIAL" as const : "COMPLETE" as const,
    limitations: Object.freeze(limitationCodes([
      ...input.saleAlerts.limitations,
      ...input.audit.limitationCodes,
      ...input.capability.limitationCodes,
      ...(sourceUnavailable ? ["DASHBOARD_SALE_ALERT_SOURCE_UNAVAILABLE",
        "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"] : []),
      ...(truncated ? ["BUYER_THANK_YOU_STATUS_TRUNCATED"] : []),
    ])),
    safety: SAFETY,
  })
}

export function createUnavailableSellerOsBuyerThankYouStatusV1(
  limitationCode = "BUYER_THANK_YOU_STATUS_UNAVAILABLE",
) {
  const observedAt = new Date().toISOString()
  const capability: SellerOsBuyerThankYouCapabilityV1 = Object.freeze({
    observedAt, provider: "EBAY_COMMERCE_MESSAGE_API", status: "UNAVAILABLE",
    accountBindingStatus: "UNAVAILABLE", commerceMessageScopeConfirmed: false,
    refreshCapabilityConfirmed: false, fixedReadPreflightUsed: false,
    deliveryAttemptAllowed: false,
    automaticExecutionAuthority: "HUMAN_APPROVAL_REQUIRED",
    limitationCodes: Object.freeze([limitationCode]),
  })
  const audit: SellerOsBuyerThankYouAuditV1 = Object.freeze({
    source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER",
    status: "UNAVAILABLE", observedAt, rows: Object.freeze([]),
    truncated: false, limitationCodes: Object.freeze([limitationCode]),
  })
  const unavailableAlerts = {
    status: "UNAVAILABLE", observedAt: null, alerts: [], limitations: [
      limitationCode,
    ],
  } as unknown as SellerOsSaleAlertsReadV1
  return buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: unavailableAlerts, capability, audit,
  })
}

export class EbayBuyerThankYouDeliveryError extends Error {
  readonly code: string
  readonly phase: "PRE_DISPATCH" | "POST_DISPATCH"
  readonly retrySafe: boolean
  readonly acceptanceOutcome: "NOT_ATTEMPTED" | "NOT_ACCEPTED" | "UNKNOWN"

  constructor(input: Readonly<{
    code: string
    phase: "PRE_DISPATCH" | "POST_DISPATCH"
    retrySafe: boolean
    acceptanceOutcome: "NOT_ATTEMPTED" | "NOT_ACCEPTED" | "UNKNOWN"
  }>) {
    super(input.code)
    this.name = "EbayBuyerThankYouDeliveryError"
    this.code = input.code
    this.phase = input.phase
    this.retrySafe = input.retrySafe
    this.acceptanceOutcome = input.acceptanceOutcome
  }
}

/**
 * Resolve the purpose-bound recipient privately and return only a closure.
 * The buyer identifier never becomes a property, log value, audit value or
 * MCP result. The closure can be invoked only after the durable dispatcher
 * records `dispatchStarted=true`.
 */
export async function prepareEbayBuyerThankYouDispatchV1(input: Readonly<{
  orderId: string
  expectedLineItemIds: readonly string[]
  expectedItemIds: readonly string[]
  fetchImpl?: FetchLike
  ordersTokenProvider?: () => Promise<string>
  messageTokenProvider?: () => Promise<string>
  identityVerifier?: (token: string) => Promise<unknown>
  now?: () => Date
}>) {
  const orderId = text(input.orderId, 120)
  const expectedLineItemIds = [...new Set(input.expectedLineItemIds.map(
    (value) => text(value, 120)))].sort()
  const expectedItemIds = [...new Set(input.expectedItemIds.map(
    (value) => text(value, 20)))].sort()
  if (!validOrderId(orderId) || !expectedLineItemIds.length ||
      expectedLineItemIds.some((value) => !value) ||
      expectedItemIds.some((value) =>
        !validItemId(value))) {
    throw new EbayBuyerThankYouDeliveryError({
      code: "BUYER_THANK_YOU_DISPATCH_IDENTITY_INVALID",
      phase: "PRE_DISPATCH", retrySafe: false,
      acceptanceOutcome: "NOT_ATTEMPTED",
    })
  }
  const fetchImpl = input.fetchImpl ?? fetch
  let ordersToken = ""
  let messageToken = ""
  try {
    ordersToken = await (input.ordersTokenProvider ?? (() =>
      canonicalOrdersToken(fetchImpl)))()
    await (input.identityVerifier ?? ((value) =>
      verifyCanonicalSellerAccount(value, fetchImpl)))(ordersToken)
    const url = new URL(
      `${FULFILLMENT_ORDER_PATH}/${encodeURIComponent(orderId)}`,
      MESSAGE_API_ORIGIN,
    )
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${ordersToken}`,
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    ordersToken = ""
    if (!response.ok) {
      if (response.status === 401) await clearCanonicalOrdersToken()
      throw new EbayBuyerThankYouDeliveryError({
        code: `EBAY_BUYER_CONTEXT_READ_${response.status}`,
        phase: "PRE_DISPATCH", retrySafe: response.status === 429 ||
          response.status >= 500,
        acceptanceOutcome: "NOT_ATTEMPTED",
      })
    }
    const payload = record(await response.json())
    const payloadOrderId = text(payload.orderId, 120)
    const lines = array(payload.lineItems).map(record)
    const observedLineIds = new Set(lines.map((line) =>
      text(line.lineItemId, 120)).filter(Boolean))
    const observedItemIds = new Set(lines.map((line) =>
      text(line.legacyItemId, 20)).filter(validItemId))
    const buyer = record(payload.buyer)
    const privateRecipient = text(buyer.username, 128)
    if (payloadOrderId !== orderId || !privateRecipient ||
        expectedLineItemIds.some((value) => !observedLineIds.has(value)) ||
        expectedItemIds.some((value) => !observedItemIds.has(value))) {
      throw new EbayBuyerThankYouDeliveryError({
        code: "EBAY_BUYER_CONTEXT_IDENTITY_MISMATCH",
        phase: "PRE_DISPATCH", retrySafe: false,
        acceptanceOutcome: "NOT_ATTEMPTED",
      })
    }
    messageToken = await (input.messageTokenProvider ?? (() =>
      canonicalMessageToken(fetchImpl)))()
    await (input.identityVerifier ?? ((value) =>
      verifyCanonicalSellerAccount(value, fetchImpl)))(messageToken)
    const tokenForDispatch = messageToken
    messageToken = ""
    return Object.freeze({
      prepared: true as const,
      recipientIdentityExposed: false as const,
      rawOrderPayloadExposed: false as const,
      credentialsExposed: false as const,
      send: async () => {
        const url = new URL(MESSAGE_SEND_PATH, MESSAGE_API_ORIGIN)
        let response: Response
        try {
          response = await fetchImpl(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenForDispatch}`,
              "Content-Type": "application/json" },
            body: JSON.stringify({
              otherPartyUsername: privateRecipient,
              messageText: POST_PURCHASE_THANK_YOU_TEMPLATE_V1,
              emailCopyToSender: false,
              ...(expectedItemIds[0] ? { reference: {
                referenceId: expectedItemIds[0],
                referenceType: "LISTING",
              } } : {}),
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          })
        } catch {
          throw new EbayBuyerThankYouDeliveryError({
            code: "EBAY_BUYER_MESSAGE_ACCEPTANCE_OUTCOME_UNKNOWN",
            phase: "POST_DISPATCH", retrySafe: false,
            acceptanceOutcome: "UNKNOWN",
          })
        }
        if (response.status !== 201) {
          if (response.status === 401) await clearCanonicalMessageToken()
          await response.body?.cancel().catch(() => undefined)
          const definitiveRejection = [400, 401, 403, 404].includes(
            response.status,
          )
          throw new EbayBuyerThankYouDeliveryError({
            code: definitiveRejection
              ? `EBAY_BUYER_MESSAGE_REJECTED_${response.status}`
              : "EBAY_BUYER_MESSAGE_ACCEPTANCE_OUTCOME_UNKNOWN",
            phase: "POST_DISPATCH", retrySafe: false,
            acceptanceOutcome: definitiveRejection
              ? "NOT_ACCEPTED" : "UNKNOWN",
          })
        }
        const payload = record(await response.json())
        const messageId = text(payload.messageId, 300)
        if (!messageId) {
          throw new EbayBuyerThankYouDeliveryError({
            code: "EBAY_BUYER_MESSAGE_ACCEPTED_RECEIPT_INVALID",
            phase: "POST_DISPATCH", retrySafe: false,
            acceptanceOutcome: "UNKNOWN",
          })
        }
        return Object.freeze({
          accepted: true as const,
          provider: "EBAY_COMMERCE_MESSAGE_API" as const,
          providerReferenceDigest: digest(messageId),
          acceptedAt: iso(payload.createdDate) ??
            (input.now ?? (() => new Date()))().toISOString(),
          recipientIdentityExposed: false as const,
          rawProviderPayloadExposed: false as const,
          credentialsExposed: false as const,
        })
      },
    })
  } catch (error) {
    ordersToken = ""
    messageToken = ""
    if (error instanceof EbayBuyerThankYouDeliveryError) throw error
    const code = safeOAuthErrorCode(error)
    throw new EbayBuyerThankYouDeliveryError({
      code,
      phase: "PRE_DISPATCH",
      retrySafe: !code.includes("AUTHORIZATION") &&
        !code.includes("MISMATCH"),
      acceptanceOutcome: "NOT_ATTEMPTED",
    })
  }
}

const SAFETY = Object.freeze({
  readOnlyCertificationSurface: true as const,
  buyerPiiIncluded: false as const,
  buyerIdentityIncluded: false as const,
  rawUpstreamPayloadIncluded: false as const,
  credentialsIncluded: false as const,
  environmentValuesIncluded: false as const,
  arbitraryRecipientAllowed: false as const,
  callerControlledAccountAllowed: false as const,
  arbitraryUrlAllowed: false as const,
  callerControlledTokenAllowed: false as const,
  arbitraryMessageTextAllowed: false as const,
  databaseWritesByThisRead: 0 as const,
  marketplaceWritesByThisRead: 0 as const,
  buyerMessageSendsByThisRead: 0 as const,
  whatsappSendsByThisRead: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  lunaLinkMutations: 0 as const,
  paymentTransactions: 0 as const,
})

export type SellerOsBuyerThankYouStatusV1 = ReturnType<
  typeof buildSellerOsBuyerThankYouStatusV1
>
