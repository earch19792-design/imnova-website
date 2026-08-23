import type {
  SafeMarketplaceOrder,
  SafeMarketplaceOrderLine,
} from "../marketplace/commercial-monitor-domain.ts"
// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { stableCommercialKey } from "../marketplace/commercial-monitor-domain.ts"

export const SELLER_OS_SALES_ORDER_EVENT_FOUNDATION_VERSION =
  "SELLER_OS_SALES_ORDER_EVENT_FOUNDATION_V1_2026_08_13" as const
export const ORDER_EVENT_INGESTION_VERSION =
  "ORDER_EVENT_INGESTION_V1" as const
export const ORDER_DETECTION_POLICY_VERSION =
  "ORDER_DETECTION_POLICY_V1" as const
export const ORDER_SOURCE_HEALTH_VERSION = "ORDER_SOURCE_HEALTH_V1" as const
export const ORDER_EVENT_IDEMPOTENCY_VERSION =
  "ORDER_EVENT_IDEMPOTENCY_V1" as const
export const ORDER_TO_LISTING_IDENTITY_VERSION =
  "ORDER_TO_LISTING_IDENTITY_V1" as const
export const SALE_ATTRIBUTION_VERSION = "SALE_ATTRIBUTION_V1" as const
export const POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION =
  "POST_PURCHASE_THANK_YOU_TEMPLATE_V1" as const
export const COMMERCIAL_SALE_LEARNING_EVENT_VERSION =
  "COMMERCIAL_SALE_LEARNING_EVENT_V1" as const
export const MONITOR_COVERAGE_TRANSPARENCY_VERSION =
  "MONITOR_COVERAGE_TRANSPARENCY_V1" as const

export const POST_PURCHASE_THANK_YOU_TEMPLATE_V1 =
  "Thank you for your purchase! We truly appreciate your business. " +
  "Your order is being processed, and we'll keep you updated with any " +
  "important information. If you have any questions, please feel free to " +
  "message us through eBay."

export type OrderEvidenceStatus =
  | "PROVEN"
  | "PARTIAL"
  | "AMBIGUOUS"
  | "UNPROVEN"
  | "UNAVAILABLE"

export type OrderSourceStatus =
  | "AVAILABLE"
  | "PARTIAL"
  | "UNPROVEN"
  | "UNAVAILABLE"

export type OrderSourceHealthV1 = Readonly<{
  contractVersion: typeof ORDER_SOURCE_HEALTH_VERSION
  detectionPolicyVersion: typeof ORDER_DETECTION_POLICY_VERSION
  capability: "EBAY_SELL_FULFILLMENT_GET_ORDERS"
  permissionStatus: "PROVEN" | "UNPROVEN" | "UNAVAILABLE"
  detectionMode: "POLLING"
  eventDrivenStatus: "OFFICIAL_CAPABILITY_UNPROVEN_NOT_CONFIGURED"
  status: OrderSourceStatus
  pollIntervalMinutes: number
  expectedDetectionLatency: string
  observedAt: string | null
  lastSuccessfulReadAt: string | null
  limitationCodes: readonly string[]
  bounded: true
  idempotent: true
  incrementalCursor: true
  overlapMinutes: 5
}>

export function buildOrderSourceHealthV1(input: {
  status: OrderSourceStatus
  permissionStatus: "PROVEN" | "UNPROVEN" | "UNAVAILABLE"
  pollIntervalMinutes: number
  observedAt: string | null
  lastSuccessfulReadAt?: string | null
  limitationCodes?: readonly string[]
}): OrderSourceHealthV1 {
  const interval = Number.isSafeInteger(input.pollIntervalMinutes)
    ? Math.min(1_440, Math.max(5, input.pollIntervalMinutes))
    : 5
  return Object.freeze({
    contractVersion: ORDER_SOURCE_HEALTH_VERSION,
    detectionPolicyVersion: ORDER_DETECTION_POLICY_VERSION,
    capability: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
    permissionStatus: input.permissionStatus,
    detectionMode: "POLLING",
    eventDrivenStatus: "OFFICIAL_CAPABILITY_UNPROVEN_NOT_CONFIGURED",
    status: input.status,
    pollIntervalMinutes: interval,
    expectedDetectionLatency:
      `Hasta ~${interval} minutos más latencia de eBay y del scheduler`,
    observedAt: iso(input.observedAt),
    lastSuccessfulReadAt: iso(input.lastSuccessfulReadAt),
    limitationCodes: Object.freeze(unique(input.limitationCodes ?? [])),
    bounded: true,
    idempotent: true,
    incrementalCursor: true,
    overlapMinutes: 5,
  })
}

export type OrderListingIdentityV1 = Readonly<{
  listingKey: string
  itemId: string
  sku: string | null
  title: string | null
  currentLive: boolean
  source: string
  evidenceReference: string | null
}>

export type OrderToListingAttributionV1 = Readonly<{
  contractVersion: typeof ORDER_TO_LISTING_IDENTITY_VERSION
  status: OrderEvidenceStatus
  itemId: string
  orderLineItemId: string
  listingKey: string | null
  listingTitle: string | null
  listingSku: string | null
  itemIdAuthority: "EBAY_ORDER_LINE_LEGACY_ITEM_ID"
  localRelationshipStatus: OrderEvidenceStatus
  skuCorroboration:
    | "MATCHED"
    | "NOT_PROVIDED"
    | "LISTING_SKU_UNAVAILABLE"
    | "CONFLICT"
    | "AMBIGUOUS"
  currentLiveStatus: "PROVEN_CURRENT_LIVE" | "NOT_CURRENT_LIVE" | "UNPROVEN"
  reasonCodes: readonly string[]
  evidenceReferences: readonly string[]
  humanReviewRequired: boolean
}>

export type CanonicalOrderLineEventV1 = Readonly<{
  contractVersion: typeof ORDER_EVENT_INGESTION_VERSION
  eventType: "AUTHORITATIVE_ORDER_LINE_OBSERVED"
  orderId: string
  orderLineItemId: string
  transactionId: null
  ebayItemId: string
  sku: string | null
  listingTitle: string | null
  quantity: number
  unitPrice: number | null
  lineTotal: number | null
  orderTotal: number | null
  currency: string | null
  soldAt: string
  createdAt: string
  capturedAt: string
  paymentState: string
  fulfillmentState: string
  sourceSystem: "EBAY_SELL_FULFILLMENT"
  sourceOperation: "GET_ORDERS"
  evidenceReference: string
  orderStatus: "PROVEN"
  attributionStatus: OrderEvidenceStatus
  attribution: OrderToListingAttributionV1
  buyerMessageEligibility: "NOT_EVALUATED"
  idempotencyKey: string
  orderIdempotencyKey: string
  duplicateObservationCount: number
  buyerPiiIncluded: false
}>

export type CanonicalSaleEventV1 = Readonly<{
  contractVersion: typeof SALE_ATTRIBUTION_VERSION
  eventType: "SALE_DETECTED"
  status: "PROVEN"
  lifecycle: "NEW"
  orderId: string
  itemIds: readonly string[]
  orderLineItemIds: readonly string[]
  quantity: number
  orderTotal: number | null
  currency: string | null
  soldAt: string
  capturedAt: string
  paymentState: string
  fulfillmentState: string
  attributionStatus: OrderEvidenceStatus
  lineEvents: readonly CanonicalOrderLineEventV1[]
  idempotencyKey: string
  buyerMessageIdempotencyKey: string
  whatsappNotificationIdempotencyKey: string
  buyerPiiIncluded: false
  independentOfAnalytics: true
  independentOfSupplierState: true
  independentOfNotificationState: true
}>

export type CanonicalOrderEventIngestionV1 = Readonly<{
  contractVersion: typeof SELLER_OS_SALES_ORDER_EVENT_FOUNDATION_VERSION
  idempotencyPolicyVersion: typeof ORDER_EVENT_IDEMPOTENCY_VERSION
  sourceStatus: OrderSourceStatus
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "UNPROVEN"
  observedAt: string | null
  orderCount: number | null
  orderLineEventCount: number | null
  saleEventCount: number | null
  duplicateObservationsBlocked: number
  rejectedOrderCount: number
  orderLineEvents: readonly CanonicalOrderLineEventV1[]
  saleEvents: readonly CanonicalSaleEventV1[]
  limitationCodes: readonly string[]
  accountTrafficUsedAsOrderEvidence: false
  writesPerformed: 0
}>

function normalizedText(value: unknown, maximum = 300) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : ""
}

function normalizedItemId(value: unknown) {
  const itemId = normalizedText(value, 20)
  return /^\d{9,20}$/.test(itemId) ? itemId : ""
}

function iso(value: unknown) {
  const text = normalizedText(value, 40)
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort()
}

function orderedUnique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))]
}

function finiteMoney(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Number(value.toFixed(2))
    : null
}

function validOrder(order: SafeMarketplaceOrder) {
  return Boolean(
    normalizedText(order.ebayOrderId, 100) &&
    iso(order.creationDate) &&
    iso(order.lastModifiedDate) &&
    normalizedText(order.orderPaymentStatus, 40).toUpperCase() === "PAID" &&
    order.lineItems.length > 0,
  )
}

function validLine(line: SafeMarketplaceOrderLine) {
  return Boolean(
    normalizedText(line.lineItemId, 100) &&
    normalizedItemId(line.listingId) &&
    Number.isSafeInteger(line.quantity) && line.quantity > 0,
  )
}

export function orderEventIdempotencyKeyV1(
  accountKey: string,
  orderId: string,
  orderLineItemId: string,
) {
  return stableCommercialKey(
    normalizedText(accountKey, 160),
    "AUTHORITATIVE_ORDER_LINE_OBSERVED",
    ORDER_EVENT_INGESTION_VERSION,
    normalizedText(orderId, 100),
    normalizedText(orderLineItemId, 100),
  )
}

export function saleEventIdempotencyKeyV1(
  accountKey: string,
  orderId: string,
) {
  return stableCommercialKey(
    normalizedText(accountKey, 160),
    "SALE_DETECTED",
    normalizedText(orderId, 100),
  )
}

export function buyerMessageIdempotencyKeyV1(
  accountKey: string,
  orderId: string,
) {
  return stableCommercialKey(
    normalizedText(accountKey, 160),
    "ONE_ORDER_ONE_THANK_YOU_MESSAGE_V1",
    normalizedText(orderId, 100),
    POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
  )
}

export function whatsappSaleNotificationIdempotencyKeyV1(
  accountKey: string,
  orderId: string,
) {
  return stableCommercialKey(
    normalizedText(accountKey, 160),
    "ONE_SALE_ONE_OPERATOR_NOTIFICATION_V1",
    normalizedText(orderId, 100),
  )
}

function isStableKey(value: string) {
  return /^commercial-v1:[0-9a-f]{64}$/.test(value)
}

export function attributeOrderLineToListingV1(input: {
  line: SafeMarketplaceOrderLine
  listingIdentities: readonly OrderListingIdentityV1[]
  canonicalCurrentLiveItemIds?: readonly string[]
  listingSourceStatus: OrderSourceStatus
}): OrderToListingAttributionV1 {
  const itemId = normalizedItemId(input.line.listingId)
  const lineItemId = normalizedText(input.line.lineItemId, 100)
  const lineSku = normalizedText(input.line.sku, 120) || null
  const currentLive = new Set((input.canonicalCurrentLiveItemIds ?? [])
    .map(normalizedItemId).filter(Boolean))
  const candidates = input.listingIdentities.filter((candidate) =>
    normalizedItemId(candidate.itemId) === itemId)
  const exactSku = lineSku
    ? candidates.filter((candidate) =>
        normalizedText(candidate.sku, 120) === lineSku)
    : []
  const references = unique(candidates.flatMap((candidate) =>
    candidate.evidenceReference ? [candidate.evidenceReference] : []))
  const currentLiveStatus = currentLive.has(itemId) || candidates.some((row) =>
    row.currentLive)
    ? "PROVEN_CURRENT_LIVE" as const
    : input.listingSourceStatus === "AVAILABLE"
      ? "NOT_CURRENT_LIVE" as const
      : "UNPROVEN" as const

  const result = (
    status: OrderEvidenceStatus,
    candidate: OrderListingIdentityV1 | null,
    skuCorroboration: OrderToListingAttributionV1["skuCorroboration"],
    reasonCodes: string[],
    localRelationshipStatus: OrderEvidenceStatus = status,
  ): OrderToListingAttributionV1 => Object.freeze({
    contractVersion: ORDER_TO_LISTING_IDENTITY_VERSION,
    status,
    itemId,
    orderLineItemId: lineItemId,
    listingKey: candidate?.listingKey ?? (itemId ? `EBAY_ITEM:${itemId}` : null),
    listingTitle: candidate?.title ?? (normalizedText(input.line.title, 300) || null),
    listingSku: candidate?.sku ?? lineSku,
    itemIdAuthority: "EBAY_ORDER_LINE_LEGACY_ITEM_ID",
    localRelationshipStatus,
    skuCorroboration,
    currentLiveStatus,
    reasonCodes: Object.freeze(unique(reasonCodes)),
    evidenceReferences: Object.freeze(references),
    humanReviewRequired: localRelationshipStatus !== "PROVEN",
  })

  if (!itemId || !lineItemId) {
    return result("UNPROVEN", null, "NOT_PROVIDED", [
      "AUTHORITATIVE_ORDER_LINE_IDENTITY_INVALID",
    ])
  }
  if (input.listingSourceStatus === "UNAVAILABLE") {
    return result("PROVEN", null, lineSku ? "LISTING_SKU_UNAVAILABLE" : "NOT_PROVIDED", [
      "AUTHORITATIVE_ORDER_ITEM_ID_PROVES_EBAY_LISTING_IDENTITY",
      "LISTING_IDENTITY_SOURCE_UNAVAILABLE",
      "ORDER_ITEM_ID_PRESERVED",
    ], "UNAVAILABLE")
  }
  if (exactSku.length === 1) {
    return result("PROVEN", exactSku[0], "MATCHED", [
      "AUTHORITATIVE_ITEM_ID_MATCH",
      "ORDER_LINE_SKU_CORROBORATED",
    ])
  }
  if (exactSku.length > 1) {
    return result("PROVEN", null, "AMBIGUOUS", [
      "AUTHORITATIVE_ORDER_ITEM_ID_PROVES_EBAY_LISTING_IDENTITY",
      "DUPLICATE_LISTING_IDENTITY_FOR_ITEM_AND_SKU",
    ], "AMBIGUOUS")
  }
  if (candidates.length === 1) {
    const candidateSku = normalizedText(candidates[0].sku, 120) || null
    if (lineSku && candidateSku && lineSku !== candidateSku) {
      return result("PROVEN", candidates[0], "CONFLICT", [
        "AUTHORITATIVE_ITEM_ID_MATCH",
        "SKU_CORROBORATION_CONFLICT",
      ], "PARTIAL")
    }
    return result("PROVEN", candidates[0], lineSku
      ? "LISTING_SKU_UNAVAILABLE"
      : "NOT_PROVIDED", [
      "AUTHORITATIVE_ITEM_ID_MATCH",
      lineSku ? "LISTING_SKU_UNAVAILABLE" : "ORDER_LINE_SKU_NOT_PROVIDED",
    ])
  }
  if (candidates.length > 1) {
    return result("PROVEN", null, "AMBIGUOUS", [
      "AUTHORITATIVE_ORDER_ITEM_ID_PROVES_EBAY_LISTING_IDENTITY",
      "AUTHORITATIVE_ITEM_ID_MATCH_MULTIPLE_LISTING_IDENTITIES",
      "SKU_DID_NOT_DISAMBIGUATE",
    ], "AMBIGUOUS")
  }
  if (currentLive.has(itemId)) {
    return result("PROVEN", null, lineSku ? "LISTING_SKU_UNAVAILABLE" :
      "NOT_PROVIDED", [
      "AUTHORITATIVE_ORDER_ITEM_ID_PROVES_EBAY_LISTING_IDENTITY",
      "ORDER_ITEM_ID_IN_CANONICAL_CURRENT_LIVE_COHORT",
      "LISTING_IDENTITY_DETAIL_UNAVAILABLE",
    ], "PARTIAL")
  }
  return result("PROVEN", null, lineSku ? "LISTING_SKU_UNAVAILABLE" : "NOT_PROVIDED", [
    "AUTHORITATIVE_ORDER_ITEM_ID_PROVES_EBAY_LISTING_IDENTITY",
    "ORDER_ITEM_ID_NOT_RESOLVED_TO_LISTING_IDENTITY",
  ], "UNPROVEN")
}

function aggregateAttributionStatus(
  values: readonly OrderEvidenceStatus[],
): OrderEvidenceStatus {
  if (!values.length || values.includes("UNAVAILABLE")) return "UNAVAILABLE"
  if (values.includes("AMBIGUOUS")) return "AMBIGUOUS"
  if (values.includes("UNPROVEN")) return "UNPROVEN"
  if (values.includes("PARTIAL")) return "PARTIAL"
  return "PROVEN"
}

export function buildCanonicalOrderEventIngestionV1(input: {
  accountKey: string
  sourceStatus: OrderSourceStatus
  observedAt: string | null
  orders: readonly SafeMarketplaceOrder[]
  listingIdentities: readonly OrderListingIdentityV1[]
  listingSourceStatus?: OrderSourceStatus
  canonicalCurrentLiveItemIds?: readonly string[]
  limitationCodes?: readonly string[]
}): CanonicalOrderEventIngestionV1 {
  const observedAt = iso(input.observedAt)
  if (input.sourceStatus === "UNAVAILABLE" || input.sourceStatus === "UNPROVEN") {
    return Object.freeze({
      contractVersion: SELLER_OS_SALES_ORDER_EVENT_FOUNDATION_VERSION,
      idempotencyPolicyVersion: ORDER_EVENT_IDEMPOTENCY_VERSION,
      sourceStatus: input.sourceStatus,
      status: input.sourceStatus,
      observedAt,
      orderCount: null,
      orderLineEventCount: null,
      saleEventCount: null,
      duplicateObservationsBlocked: 0,
      rejectedOrderCount: input.orders.length,
      orderLineEvents: Object.freeze([]),
      saleEvents: Object.freeze([]),
      limitationCodes: Object.freeze(unique([
        ...(input.limitationCodes ?? []),
        input.sourceStatus === "UNAVAILABLE"
          ? "ORDER_SOURCE_UNAVAILABLE"
          : "ORDER_SOURCE_UNPROVEN",
      ])),
      accountTrafficUsedAsOrderEvidence: false,
      writesPerformed: 0,
    })
  }

  const candidates: CanonicalOrderLineEventV1[] = []
  let rejectedOrderCount = 0
  for (const order of input.orders) {
    if (!validOrder(order)) {
      rejectedOrderCount += 1
      continue
    }
    const orderId = normalizedText(order.ebayOrderId, 100)
    const creationDate = iso(order.creationDate) as string
    const capturedAt = observedAt ?? iso(order.lastModifiedDate) as string
    for (const line of order.lineItems) {
      if (!validLine(line)) continue
      const attribution = attributeOrderLineToListingV1({
        line,
        listingIdentities: input.listingIdentities,
        canonicalCurrentLiveItemIds: input.canonicalCurrentLiveItemIds,
        listingSourceStatus: input.listingSourceStatus ?? "AVAILABLE",
      })
      const quantity = Math.trunc(line.quantity)
      const lineTotal = finiteMoney(line.lineItemAmount)
      candidates.push(Object.freeze({
        contractVersion: ORDER_EVENT_INGESTION_VERSION,
        eventType: "AUTHORITATIVE_ORDER_LINE_OBSERVED",
        orderId,
        orderLineItemId: normalizedText(line.lineItemId, 100),
        transactionId: null,
        ebayItemId: normalizedItemId(line.listingId),
        sku: normalizedText(line.sku, 120) || null,
        listingTitle: attribution.listingTitle ??
          (normalizedText(line.title, 300) || null),
        quantity,
        unitPrice: lineTotal === null ? null : Number((lineTotal / quantity).toFixed(2)),
        lineTotal,
        orderTotal: finiteMoney(order.totalAmount),
        currency: normalizedText(line.currency ?? order.currency, 3).toUpperCase() || null,
        soldAt: creationDate,
        createdAt: creationDate,
        capturedAt,
        paymentState: normalizedText(order.orderPaymentStatus, 40).toUpperCase(),
        fulfillmentState: normalizedText(order.orderFulfillmentStatus, 40).toUpperCase(),
        sourceSystem: "EBAY_SELL_FULFILLMENT",
        sourceOperation: "GET_ORDERS",
        evidenceReference: `EBAY_ORDER_LINE:${orderId}:${normalizedText(line.lineItemId, 100)}`,
        orderStatus: "PROVEN",
        attributionStatus: attribution.status,
        attribution,
        buyerMessageEligibility: "NOT_EVALUATED",
        idempotencyKey: orderEventIdempotencyKeyV1(
          input.accountKey,
          orderId,
          line.lineItemId,
        ),
        orderIdempotencyKey: saleEventIdempotencyKeyV1(input.accountKey, orderId),
        duplicateObservationCount: 1,
        buyerPiiIncluded: false,
      }))
    }
  }

  const groups = new Map<string, CanonicalOrderLineEventV1[]>()
  for (const event of candidates) {
    const group = groups.get(event.idempotencyKey) ?? []
    group.push(event)
    groups.set(event.idempotencyKey, group)
  }
  const orderLineEvents = [...groups.values()].map((group) => {
    const selected = [...group].sort((left, right) =>
      right.capturedAt.localeCompare(left.capturedAt) ||
      JSON.stringify(left).localeCompare(JSON.stringify(right)))[0]
    return Object.freeze({ ...selected, duplicateObservationCount: group.length })
  }).sort((left, right) =>
    right.soldAt.localeCompare(left.soldAt) ||
    left.orderId.localeCompare(right.orderId) ||
    left.orderLineItemId.localeCompare(right.orderLineItemId))

  const byOrder = new Map<string, CanonicalOrderLineEventV1[]>()
  for (const event of orderLineEvents) {
    const group = byOrder.get(event.orderId) ?? []
    group.push(event)
    byOrder.set(event.orderId, group)
  }
  const saleEvents = [...byOrder.entries()].map(([orderId, lines]) => {
    const sortedLines = [...lines].sort((left, right) =>
      left.orderLineItemId.localeCompare(right.orderLineItemId))
    const first = sortedLines[0]
    return Object.freeze({
      contractVersion: SALE_ATTRIBUTION_VERSION,
      eventType: "SALE_DETECTED" as const,
      status: "PROVEN" as const,
      lifecycle: "NEW" as const,
      orderId,
      itemIds: Object.freeze(unique(sortedLines.map((line) => line.ebayItemId))),
      orderLineItemIds: Object.freeze(sortedLines.map((line) =>
        line.orderLineItemId)),
      quantity: sortedLines.reduce((sum, line) => sum + line.quantity, 0),
      orderTotal: first.orderTotal,
      currency: first.currency,
      soldAt: first.soldAt,
      capturedAt: sortedLines.map((line) => line.capturedAt).sort().at(-1) ??
        first.capturedAt,
      paymentState: first.paymentState,
      fulfillmentState: first.fulfillmentState,
      attributionStatus: aggregateAttributionStatus(sortedLines.map((line) =>
        line.attributionStatus)),
      lineEvents: Object.freeze(sortedLines),
      idempotencyKey: saleEventIdempotencyKeyV1(input.accountKey, orderId),
      buyerMessageIdempotencyKey: buyerMessageIdempotencyKeyV1(
        input.accountKey,
        orderId,
      ),
      whatsappNotificationIdempotencyKey:
        whatsappSaleNotificationIdempotencyKeyV1(input.accountKey, orderId),
      buyerPiiIncluded: false as const,
      independentOfAnalytics: true as const,
      independentOfSupplierState: true as const,
      independentOfNotificationState: true as const,
    }) satisfies CanonicalSaleEventV1
  }).sort((left, right) =>
    right.soldAt.localeCompare(left.soldAt) || left.orderId.localeCompare(right.orderId))

  return Object.freeze({
    contractVersion: SELLER_OS_SALES_ORDER_EVENT_FOUNDATION_VERSION,
    idempotencyPolicyVersion: ORDER_EVENT_IDEMPOTENCY_VERSION,
    sourceStatus: input.sourceStatus,
    status: input.sourceStatus,
    observedAt,
    orderCount: input.sourceStatus === "AVAILABLE" ? saleEvents.length : null,
    orderLineEventCount: input.sourceStatus === "AVAILABLE"
      ? orderLineEvents.length : null,
    saleEventCount: input.sourceStatus === "AVAILABLE" ? saleEvents.length : null,
    duplicateObservationsBlocked: candidates.length - orderLineEvents.length,
    rejectedOrderCount,
    orderLineEvents: Object.freeze(orderLineEvents),
    saleEvents: Object.freeze(saleEvents),
    limitationCodes: Object.freeze(unique(input.limitationCodes ?? [])),
    accountTrafficUsedAsOrderEvidence: false,
    writesPerformed: 0,
  })
}

export function evaluateBuyerMessageEligibilityV1(input: {
  saleEvent: CanonicalSaleEventV1
  buyerOrderContext: "PROVEN" | "UNPROVEN" | "UNAVAILABLE"
  capability: "AVAILABLE" | "UNAVAILABLE" | "UNPROVEN"
  previouslySent: "YES" | "NO" | "UNPROVEN"
  observationDisposition?: "NEW" | "HISTORICAL_RECOVERY"
}) {
  const reasons: string[] = []
  if (input.saleEvent.status !== "PROVEN") reasons.push("ORDER_STATUS_NOT_PROVEN")
  if (!normalizedText(input.saleEvent.orderId, 100)) reasons.push("ORDER_ID_NOT_PROVEN")
  if (input.saleEvent.attributionStatus !== "PROVEN") {
    reasons.push("ORDER_TO_LISTING_ATTRIBUTION_NOT_PROVEN")
  }
  if (input.buyerOrderContext !== "PROVEN") {
    reasons.push(`BUYER_ORDER_CONTEXT_${input.buyerOrderContext}`)
  }
  if (input.capability !== "AVAILABLE") {
    reasons.push(`BUYER_MESSAGE_CAPABILITY_${input.capability}`)
  }
  if (input.previouslySent !== "NO") {
    reasons.push(input.previouslySent === "YES"
      ? "MESSAGE_PREVIOUSLY_SENT"
      : "MESSAGE_PREVIOUSLY_SENT_UNPROVEN")
  }
  if (!isStableKey(input.saleEvent.buyerMessageIdempotencyKey)) {
    reasons.push("MESSAGE_IDEMPOTENCY_KEY_INVALID")
  }
  if (input.observationDisposition === "HISTORICAL_RECOVERY") {
    reasons.push("HISTORICAL_RECOVERY_AUTOMATIC_SEND_BLOCKED")
  }
  const status = input.previouslySent === "YES"
    ? "ALREADY_SENT" as const
    : input.capability === "UNAVAILABLE" ||
        input.buyerOrderContext === "UNAVAILABLE" ||
        input.saleEvent.attributionStatus === "UNAVAILABLE"
      ? "UNAVAILABLE" as const
      : reasons.length
        ? "UNPROVEN" as const
        : "ELIGIBLE" as const
  return Object.freeze({
    contractVersion: "BUYER_MESSAGE_ELIGIBILITY_V1" as const,
    status,
    sendAllowed: status === "ELIGIBLE",
    idempotencyKey: input.saleEvent.buyerMessageIdempotencyKey,
    templateVersion: POST_PURCHASE_THANK_YOU_TEMPLATE_VERSION,
    approvedMessage: POST_PURCHASE_THANK_YOU_TEMPLATE_V1,
    reasonCodes: Object.freeze(unique(reasons)),
    unrelatedMarketplaceWritesAllowed: false as const,
  })
}

export function evaluateWhatsappSaleNotificationEligibilityV1(input: {
  saleEvent: CanonicalSaleEventV1
  saleEventCreated: boolean
  operatorDestination: "AUTHORIZED" | "UNAUTHORIZED" | "UNPROVEN"
  capability: "AVAILABLE" | "UNAVAILABLE" | "UNPROVEN"
  previouslySent: "YES" | "NO" | "UNPROVEN"
  observationDisposition?: "NEW" | "HISTORICAL_RECOVERY"
}) {
  const reasons: string[] = []
  if (input.saleEvent.status !== "PROVEN") reasons.push("ORDER_STATUS_NOT_PROVEN")
  if (input.saleEvent.attributionStatus !== "PROVEN") {
    reasons.push("ORDER_TO_LISTING_ATTRIBUTION_NOT_PROVEN")
  }
  if (!input.saleEventCreated) reasons.push("SALE_EVENT_NOT_CREATED")
  if (input.operatorDestination !== "AUTHORIZED") {
    reasons.push(`WHATSAPP_OPERATOR_DESTINATION_${input.operatorDestination}`)
  }
  if (input.capability !== "AVAILABLE") {
    reasons.push(`WHATSAPP_CAPABILITY_${input.capability}`)
  }
  if (input.previouslySent !== "NO") {
    reasons.push(input.previouslySent === "YES"
      ? "WHATSAPP_NOTIFICATION_PREVIOUSLY_SENT"
      : "WHATSAPP_NOTIFICATION_PREVIOUSLY_SENT_UNPROVEN")
  }
  if (!isStableKey(input.saleEvent.whatsappNotificationIdempotencyKey)) {
    reasons.push("WHATSAPP_IDEMPOTENCY_KEY_INVALID")
  }
  if (input.observationDisposition === "HISTORICAL_RECOVERY") {
    reasons.push("HISTORICAL_RECOVERY_AUTOMATIC_SEND_BLOCKED")
  }
  const status = input.previouslySent === "YES"
    ? "ALREADY_SENT" as const
    : input.capability === "UNAVAILABLE" ||
        input.saleEvent.attributionStatus === "UNAVAILABLE"
      ? "UNAVAILABLE" as const
      : reasons.length
        ? "UNPROVEN" as const
        : "ELIGIBLE" as const
  return Object.freeze({
    contractVersion: "WHATSAPP_SALE_NOTIFICATION_ELIGIBILITY_V1" as const,
    status,
    sendAllowed: status === "ELIGIBLE",
    idempotencyKey: input.saleEvent.whatsappNotificationIdempotencyKey,
    reasonCodes: Object.freeze(unique(reasons)),
    channelScope: "INTERNAL_OPERATOR_SALE_ALERT_ONLY" as const,
    buyerWhatsappAllowed: false as const,
  })
}

export function buildSaleTriggeredStockRecheckV1(input: {
  saleEvent: CanonicalSaleEventV1
  supplierLinkStatus:
    | "PROVEN"
    | "HUMAN_APPROVED"
    | "UNPROVEN"
    | "UNAVAILABLE"
}) {
  const attributionProven = input.saleEvent.attributionStatus === "PROVEN"
  const linkProven = input.supplierLinkStatus === "PROVEN" ||
    input.supplierLinkStatus === "HUMAN_APPROVED"
  const state = !attributionProven
    ? "STOCK_RECHECK_BLOCKED_ATTRIBUTION" as const
    : linkProven
      ? "STOCK_REFRESH_REQUEST_READY" as const
      : "SUPPLIER_RECHECK_PENDING_LINK" as const
  return Object.freeze({
    contractVersion: "SALE_TRIGGERED_STOCK_RECHECK_V1" as const,
    orderId: input.saleEvent.orderId,
    itemIds: input.saleEvent.itemIds,
    state,
    supplierLinkStatus: input.supplierLinkStatus,
    requestAllowed: state === "STOCK_REFRESH_REQUEST_READY",
    requestExecuted: false as const,
    stockInvented: false as const,
    idempotencyKey: stableCommercialKey(
      "SALE_TRIGGERED_STOCK_RECHECK_V1",
      input.saleEvent.idempotencyKey,
    ),
  })
}

export function buildCommercialSaleLearningEventV1(input: {
  saleEvent: CanonicalSaleEventV1
  listingVersions?: Readonly<Record<string, string | null>>
  primaryImageVersions?: Readonly<Record<string, string | null>>
  trafficContext?: Readonly<Record<string, unknown>> | null
  experimentState?: Readonly<Record<string, unknown>> | null
  supplierState?: Readonly<Record<string, unknown>> | null
  stockState?: Readonly<Record<string, unknown>> | null
  economicsState?: Readonly<Record<string, unknown>> | null
}) {
  return Object.freeze({
    contractVersion: COMMERCIAL_SALE_LEARNING_EVENT_VERSION,
    eventType: "ATTRIBUTED_SALE_OBSERVATION" as const,
    persistenceStatus: input.saleEvent.attributionStatus === "PROVEN"
      ? "PERSISTENCE_READY" as const
      : "PENDING_PROVEN_ATTRIBUTION" as const,
    orderId: input.saleEvent.orderId,
    itemIds: input.saleEvent.itemIds,
    soldAt: input.saleEvent.soldAt,
    quantity: input.saleEvent.quantity,
    orderTotal: input.saleEvent.orderTotal,
    currency: input.saleEvent.currency,
    listingTitles: Object.freeze(Object.fromEntries(
      input.saleEvent.lineEvents.map((line) => [
        line.ebayItemId,
        line.listingTitle,
      ]),
    )),
    listingVersions: input.listingVersions ?? {},
    primaryImageVersions: input.primaryImageVersions ?? {},
    trafficContext: input.trafficContext ?? null,
    experimentState: input.experimentState ?? null,
    supplierState: input.supplierState ?? null,
    stockState: input.stockState ?? null,
    economicsState: input.economicsState ?? null,
    causalClaimAllowed: false as const,
    universalRuleAllowed: false as const,
    generalizationStatus: "INSUFFICIENT_FOR_GENERALIZATION" as const,
    idempotencyKey: stableCommercialKey(
      COMMERCIAL_SALE_LEARNING_EVENT_VERSION,
      input.saleEvent.idempotencyKey,
    ),
    buyerPiiIncluded: false as const,
  })
}

export type MonitorCoverageTransparencyV1 = Readonly<{
  contractVersion: typeof MONITOR_COVERAGE_TRANSPARENCY_VERSION
  status: "AVAILABLE" | "PARTIAL" | "UNPROVEN"
  currentLiveScopeId: string
  currentLiveScopeType: "CURRENT_LIVE_COHORT_SCOPE"
  currentLiveScopeCount: number | null
  currentLiveObservedAt: string | null
  monitoredItemIds: readonly string[]
  visiblePriorityItemIds: readonly string[]
  visiblePriorityRowCount: number
  monitoredOutsideVisibleCount: number | null
  visibleRowsEqualMonitoredScope: boolean | null
  visibleRowsArePresentationSubset: true
  notVisibleDoesNotMeanNotMonitored: true
}>

export function buildMonitorCoverageTransparencyV1(input: {
  scopeId: string
  scopeType: "CURRENT_LIVE_COHORT_SCOPE"
  observedAt: string | null
  listingCount: number | null
  itemIds: readonly string[]
  identityStatus: "CERTIFIED" | "PARTIAL" | "UNPROVEN"
  visiblePriorityItemIds: readonly string[]
}): MonitorCoverageTransparencyV1 {
  const monitoredItemIds = unique(input.itemIds.map(normalizedItemId)
    .filter(Boolean))
  const monitored = new Set(monitoredItemIds)
  const visiblePriorityItemIds = orderedUnique(input.visiblePriorityItemIds
    .map(normalizedItemId).filter((itemId) => monitored.has(itemId)))
  const countConsistent = input.listingCount !== null &&
    input.listingCount === monitoredItemIds.length
  const status = input.listingCount === null || input.identityStatus === "UNPROVEN"
    ? "UNPROVEN" as const
    : countConsistent && input.identityStatus === "CERTIFIED"
      ? "AVAILABLE" as const
      : "PARTIAL" as const
  const authoritativeScopeCount = status === "UNPROVEN"
    ? null
    : input.listingCount
  return Object.freeze({
    contractVersion: MONITOR_COVERAGE_TRANSPARENCY_VERSION,
    status,
    currentLiveScopeId: normalizedText(input.scopeId, 240),
    currentLiveScopeType: input.scopeType,
    currentLiveScopeCount: authoritativeScopeCount,
    currentLiveObservedAt: iso(input.observedAt),
    monitoredItemIds: Object.freeze(monitoredItemIds),
    visiblePriorityItemIds: Object.freeze(visiblePriorityItemIds),
    visiblePriorityRowCount: visiblePriorityItemIds.length,
    monitoredOutsideVisibleCount: authoritativeScopeCount === null
      ? null
      : Math.max(0, authoritativeScopeCount - visiblePriorityItemIds.length),
    visibleRowsEqualMonitoredScope: authoritativeScopeCount === null
      ? null
      : authoritativeScopeCount === visiblePriorityItemIds.length,
    visibleRowsArePresentationSubset: true,
    notVisibleDoesNotMeanNotMonitored: true,
  })
}

export function resolveMonitorCoverageForItemV1(
  coverage: MonitorCoverageTransparencyV1,
  itemId: string,
) {
  const normalized = normalizedItemId(itemId)
  const monitored = coverage.monitoredItemIds.includes(normalized)
  const visibleInPriorityRows = coverage.visiblePriorityItemIds.includes(
    normalized,
  )
  return Object.freeze({
    itemId: normalized,
    currentLive: monitored,
    monitored,
    visibleInPriorityRows,
    monitoredOutsideTopN: monitored && !visibleInPriorityRows,
    status: coverage.status === "UNPROVEN"
      ? "UNPROVEN" as const
      : monitored
        ? "MONITORED" as const
        : "NOT_IN_CURRENT_LIVE_SCOPE" as const,
  })
}
