// @ts-ignore Node's native TypeScript test runner requires the explicit extension.
import * as v1aDomain from "./fulfillment-v1a-domain.ts"
import type { NormalizedTrackingPayload } from "./fulfillment-v1a-domain"

const { canonicalJson, containsFulfillmentPrivateData, sha256Hex } = v1aDomain

export const EBAY_TRACKING_APPROVAL_TTL_MS = 30 * 60 * 1_000

export type SafeEbayTrackingOrderLine = {
  lineItemId: string
  listingId: string
  marketplaceListingSku: string
  quantity: number
  fulfillmentStatus: string
}

export type SafeEbayTrackingOrder = {
  orderId: string
  paymentStatus: string
  fulfillmentStatus: string
  cancellationStatus: string | null
  refunded: boolean
  lines: SafeEbayTrackingOrderLine[]
  buyerPiiReturned: false
}

export type SafeEbayShippingFulfillment = {
  fulfillmentId: string
  trackingNumber: string | null
  carrier: string | null
  shippedDate: string | null
  items: Array<{ lineItemId: string; quantity: number }>
}

export type EbayShippingFulfillmentRequest = {
  lineItems: Array<{ lineItemId: string; quantity: number }>
  shippedDate: string
  shippingCarrierCode: string
  trackingNumber: string
}

export type TrackingPreflightResult = {
  status: "READY" | "EXISTING_MATCH" | "BLOCKED"
  code:
    | "READY"
    | "EXISTING_FULFILLMENT_MATCH"
    | "APPROVAL_EXPIRED"
    | "APPROVAL_PAYLOAD_MISMATCH"
    | "IDENTITY_MISMATCH"
    | "ORDER_IDENTITY_MISMATCH"
    | "ORDER_NOT_PAID"
    | "ORDER_CANCELLED"
    | "ORDER_REFUNDED"
    | "ORDER_ALREADY_FULFILLED"
    | "TRACKING_DUPLICATE_CONFLICT"
    | "FULFILLMENT_QUANTITY_EXCEEDED"
  existingFulfillmentId: string | null
  paid: boolean
  identityMatch: boolean
  approvalMatch: boolean
  buyerPiiReturned: false
}

export function classifyEbayTrackingPostStatus(status: number) {
  if (status === 201) return "ACCEPTED" as const
  if (status === 409 || status === 429 || status >= 500) {
    return "AMBIGUOUS_RECONCILIATION_REQUIRED" as const
  }
  return "PERMANENT_ERROR" as const
}

export function canConfirmRemoteAbsence(input: {
  reconciliationCount: number
  postStartedAt: string | null
  now: number
}) {
  const postAt = input.postStartedAt ? Date.parse(input.postStartedAt) : NaN
  return input.reconciliationCount >= 2 && Number.isFinite(postAt) &&
    input.now - postAt >= 60_000
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function safeText(value: unknown, maximum = 200) {
  if (typeof value !== "string") return ""
  const normalized = value.trim()
  return /[\u0000-\u001f\u007f]/.test(normalized)
    ? ""
    : normalized.slice(0, maximum)
}

function safeUpper(value: unknown, maximum = 80) {
  return safeText(value, maximum).toUpperCase()
}

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function lineItemsMatch(
  left: Array<{ lineItemId: string; quantity: number }>,
  right: Array<{ lineItemId: string; quantity: number }>,
) {
  if (left.length !== right.length) return false
  const expected = new Map(left.map((item) => [item.lineItemId, item.quantity]))
  return right.every((item) => expected.get(item.lineItemId) === item.quantity)
}

export function buildEbayShippingFulfillmentRequest(
  payload: NormalizedTrackingPayload,
): EbayShippingFulfillmentRequest {
  if (!/^[A-Z0-9]{5,40}$/.test(payload.trackingNumber)) {
    throw new Error("FULFILLMENT_EBAY_TRACKING_ALPHANUMERIC_REQUIRED")
  }
  if (!/^[A-Z0-9_]{2,50}$/.test(payload.carrier)) {
    throw new Error("FULFILLMENT_EBAY_CARRIER_INVALID")
  }
  const lineItems = payload.items.map((item) => ({
    lineItemId: safeText(item.lineItemId, 120),
    quantity: positiveInteger(item.quantity),
  })).sort((left, right) => left.lineItemId.localeCompare(right.lineItemId))
  if (
    !lineItems.length ||
    lineItems.some((item) => !item.lineItemId || !item.quantity) ||
    !Number.isFinite(Date.parse(payload.shippedDate))
  ) throw new Error("FULFILLMENT_EBAY_PAYLOAD_INVALID")
  return {
    lineItems,
    shippedDate: new Date(payload.shippedDate).toISOString(),
    shippingCarrierCode: payload.carrier,
    trackingNumber: payload.trackingNumber,
  }
}

export function ebayShippingFulfillmentRequestHash(
  payload: EbayShippingFulfillmentRequest,
) {
  return `sha256:${sha256Hex(canonicalJson(payload))}`
}

export function normalizeEbayTrackingOrder(payload: unknown): SafeEbayTrackingOrder {
  const source = record(payload)
  const cancel = record(source.cancelStatus)
  const paymentSummary = record(source.paymentSummary)
  const refundStates = array(paymentSummary.refunds).map((value) => {
    const refund = record(value)
    return safeUpper(refund.refundStatus ?? refund.refundState ?? refund.status)
  }).filter(Boolean)
  const paymentStatus = safeUpper(source.orderPaymentStatus)
  const rawLines = array(source.lineItems)
  const lineRefunded = rawLines.some((value) => {
    const line = record(value)
    return array(line.refunds).some((refundValue) => {
      const refund = record(refundValue)
      const status = safeUpper(refund.refundStatus ?? refund.refundState ?? refund.status)
      return Boolean(status) && !["FAILED", "CANCELLED", "REJECTED"].includes(status)
    })
  })
  const result: SafeEbayTrackingOrder = {
    orderId: safeText(source.orderId, 120),
    paymentStatus,
    fulfillmentStatus: safeUpper(source.orderFulfillmentStatus),
    cancellationStatus: safeUpper(cancel.cancelState ?? cancel.cancelStatus) || null,
    refunded: paymentStatus.includes("REFUND") || lineRefunded || refundStates.some((status) =>
      !["FAILED", "CANCELLED", "REJECTED"].includes(status)
    ),
    lines: rawLines.map((value) => {
      const line = record(value)
      return {
        lineItemId: safeText(line.lineItemId, 120),
        listingId: safeText(line.legacyItemId, 40),
        marketplaceListingSku: safeText(line.sku, 200),
        quantity: positiveInteger(line.quantity),
        fulfillmentStatus: safeUpper(
          line.lineItemFulfillmentStatus ?? line.fulfillmentStatus,
        ),
      }
    }).filter((line) => line.lineItemId),
    buyerPiiReturned: false,
  }
  if (containsFulfillmentPrivateData(result)) {
    throw new Error("FULFILLMENT_PRIVATE_DATA_BLOCKED")
  }
  return result
}

export function normalizeEbayShippingFulfillments(
  payload: unknown,
): SafeEbayShippingFulfillment[] {
  const source = record(payload)
  const raw = Array.isArray(payload) ? payload : array(source.fulfillments)
  const result = raw.map((value) => {
    const row = record(value)
    return {
      fulfillmentId: safeText(row.fulfillmentId, 160),
      trackingNumber: safeText(
        row.shipmentTrackingNumber ?? row.trackingNumber,
        80,
      ) || null,
      carrier: safeUpper(row.shippingCarrierCode, 50) || null,
      shippedDate: safeText(row.shippedDate, 40) || null,
      items: array(row.lineItems).map((item) => {
        const line = record(item)
        return {
          lineItemId: safeText(line.lineItemId, 120),
          quantity: positiveInteger(line.quantity),
        }
      }).filter((line) => line.lineItemId && line.quantity),
    }
  }).filter((row) => row.fulfillmentId)
  if (containsFulfillmentPrivateData(result)) {
    throw new Error("FULFILLMENT_PRIVATE_DATA_BLOCKED")
  }
  return result
}

export function fulfillmentMatchesEbayRequest(
  fulfillment: SafeEbayShippingFulfillment,
  request: EbayShippingFulfillmentRequest,
) {
  return fulfillment.trackingNumber === request.trackingNumber &&
    fulfillment.carrier === request.shippingCarrierCode &&
    lineItemsMatch(fulfillment.items, request.lineItems)
}

export function evaluateEbayTrackingPreflight(input: {
  order: SafeEbayTrackingOrder
  fulfillments: SafeEbayShippingFulfillment[]
  expectedOrderId: string
  expectedLines: Array<{
    lineItemId: string
    listingId: string
    marketplaceListingSku: string
    supplierSku: string
    quantity: number
  }>
  supplierIdentityValid: boolean
  identityFingerprint: string | null
  expectedIdentityFingerprint: string
  currentPayloadHash: string | null
  approvedPayloadHash: string
  approvedAt: string | null
  enforceApprovalFreshness?: boolean
  now?: number
  request: EbayShippingFulfillmentRequest
}): TrackingPreflightResult {
  const now = input.now ?? Date.now()
  const approvalTime = input.approvedAt ? Date.parse(input.approvedAt) : NaN
  const approvalMatch = input.currentPayloadHash === input.approvedPayloadHash
  const identityFingerprintMatch = input.identityFingerprint === input.expectedIdentityFingerprint
  const localIdentityMatch = input.supplierIdentityValid && identityFingerprintMatch &&
    input.expectedLines.length > 0 && input.expectedLines.every((line) =>
      Boolean(line.supplierSku) && line.quantity > 0
    )
  const result = (
    status: TrackingPreflightResult["status"],
    code: TrackingPreflightResult["code"],
    existingFulfillmentId: string | null = null,
    identityMatch = localIdentityMatch,
  ): TrackingPreflightResult => ({
    status,
    code,
    existingFulfillmentId,
    paid: input.order.paymentStatus === "PAID",
    identityMatch,
    approvalMatch,
    buyerPiiReturned: false,
  })

  if (!approvalMatch) return result("BLOCKED", "APPROVAL_PAYLOAD_MISMATCH")
  if ((input.enforceApprovalFreshness ?? true) && (
    !Number.isFinite(approvalTime) ||
    now - approvalTime > EBAY_TRACKING_APPROVAL_TTL_MS ||
    approvalTime > now + 60_000
  )) {
    return result("BLOCKED", "APPROVAL_EXPIRED")
  }
  if (!localIdentityMatch) return result("BLOCKED", "IDENTITY_MISMATCH")
  const officialIdentityMatch = input.order.orderId === input.expectedOrderId &&
    input.expectedLines.every((expected) => input.order.lines.some((line) =>
      line.lineItemId === expected.lineItemId &&
      line.listingId === expected.listingId &&
      line.marketplaceListingSku === expected.marketplaceListingSku &&
      line.quantity === expected.quantity
    ))
  if (!officialIdentityMatch) {
    return result("BLOCKED", "ORDER_IDENTITY_MISMATCH", null, false)
  }
  const cancellation = input.order.cancellationStatus
  if (cancellation && !["NONE_REQUESTED", "CANCEL_REJECTED", "CANCEL_CLOSED_NO_REFUND"].includes(cancellation)) {
    return result("BLOCKED", "ORDER_CANCELLED")
  }
  if (input.order.refunded) return result("BLOCKED", "ORDER_REFUNDED")
  if (input.order.paymentStatus !== "PAID") return result("BLOCKED", "ORDER_NOT_PAID")

  const existingMatch = input.fulfillments.find((fulfillment) =>
    fulfillmentMatchesEbayRequest(fulfillment, input.request)
  )
  if (existingMatch) {
    return result("EXISTING_MATCH", "EXISTING_FULFILLMENT_MATCH", existingMatch.fulfillmentId)
  }
  const trackingConflict = input.fulfillments.some((fulfillment) =>
    fulfillment.trackingNumber === input.request.trackingNumber
  )
  if (trackingConflict) return result("BLOCKED", "TRACKING_DUPLICATE_CONFLICT")
  if (["FULFILLED", "SHIPPED"].includes(input.order.fulfillmentStatus)) {
    return result("BLOCKED", "ORDER_ALREADY_FULFILLED")
  }

  const fulfilledByLine = new Map<string, number>()
  for (const fulfillment of input.fulfillments) {
    for (const item of fulfillment.items) {
      fulfilledByLine.set(
        item.lineItemId,
        (fulfilledByLine.get(item.lineItemId) ?? 0) + item.quantity,
      )
    }
  }
  const expectedByLine = new Map(input.expectedLines.map((line) => [line.lineItemId, line.quantity]))
  for (const item of input.request.lineItems) {
    const sold = expectedByLine.get(item.lineItemId) ?? 0
    const alreadyFulfilled = fulfilledByLine.get(item.lineItemId) ?? 0
    if (!sold || item.quantity > sold - alreadyFulfilled) {
      return result("BLOCKED", alreadyFulfilled >= sold
        ? "ORDER_ALREADY_FULFILLED"
        : "FULFILLMENT_QUANTITY_EXCEEDED")
    }
  }
  return result("READY", "READY")
}
