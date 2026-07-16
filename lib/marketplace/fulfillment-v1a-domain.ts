import { createHash } from "node:crypto"

export const FULFILLMENT_V1A_STATES = [
  "SALE_DETECTED",
  "VALIDATING_ORDER",
  "PENDING_MANUAL_PURCHASE",
  "LUNA_ORDER_PLACED",
  "WAITING_FOR_TRACKING",
  "TRACKING_RECEIVED",
  "TRACKING_VALIDATING",
  "TRACKING_READY_FOR_SUBMISSION",
  "TRACKING_SUBMISSION_QUEUED",
  "TRACKING_SUBMITTED_SIMULATED",
  "SHIPPED_SIMULATED",
  "MANUAL_REVIEW_REQUIRED",
  "CANCELLED",
  "RETURN_OR_ISSUE",
] as const

export type FulfillmentV1AState = typeof FULFILLMENT_V1A_STATES[number]

const allowedTransitions: Readonly<Record<FulfillmentV1AState, readonly FulfillmentV1AState[]>> = {
  SALE_DETECTED: ["VALIDATING_ORDER", "MANUAL_REVIEW_REQUIRED", "CANCELLED"],
  VALIDATING_ORDER: ["PENDING_MANUAL_PURCHASE", "MANUAL_REVIEW_REQUIRED", "CANCELLED"],
  PENDING_MANUAL_PURCHASE: ["LUNA_ORDER_PLACED", "MANUAL_REVIEW_REQUIRED", "CANCELLED", "RETURN_OR_ISSUE"],
  LUNA_ORDER_PLACED: ["WAITING_FOR_TRACKING", "MANUAL_REVIEW_REQUIRED", "CANCELLED", "RETURN_OR_ISSUE"],
  WAITING_FOR_TRACKING: ["TRACKING_RECEIVED", "MANUAL_REVIEW_REQUIRED", "CANCELLED", "RETURN_OR_ISSUE"],
  TRACKING_RECEIVED: ["TRACKING_VALIDATING", "WAITING_FOR_TRACKING", "MANUAL_REVIEW_REQUIRED", "CANCELLED", "RETURN_OR_ISSUE"],
  TRACKING_VALIDATING: ["TRACKING_READY_FOR_SUBMISSION", "WAITING_FOR_TRACKING", "MANUAL_REVIEW_REQUIRED", "CANCELLED", "RETURN_OR_ISSUE"],
  TRACKING_READY_FOR_SUBMISSION: ["TRACKING_RECEIVED", "TRACKING_SUBMISSION_QUEUED", "MANUAL_REVIEW_REQUIRED", "CANCELLED", "RETURN_OR_ISSUE"],
  TRACKING_SUBMISSION_QUEUED: ["TRACKING_RECEIVED", "TRACKING_SUBMITTED_SIMULATED", "MANUAL_REVIEW_REQUIRED", "CANCELLED", "RETURN_OR_ISSUE"],
  TRACKING_SUBMITTED_SIMULATED: ["SHIPPED_SIMULATED", "MANUAL_REVIEW_REQUIRED", "RETURN_OR_ISSUE"],
  SHIPPED_SIMULATED: ["RETURN_OR_ISSUE", "MANUAL_REVIEW_REQUIRED"],
  MANUAL_REVIEW_REQUIRED: ["PENDING_MANUAL_PURCHASE", "WAITING_FOR_TRACKING", "TRACKING_READY_FOR_SUBMISSION", "CANCELLED", "RETURN_OR_ISSUE"],
  CANCELLED: [],
  RETURN_OR_ISSUE: ["MANUAL_REVIEW_REQUIRED"],
}

export type FulfillmentIdentity = {
  marketplaceAccountKey: string
  marketplace: string
  orderId: string
  lineItemId: string
  listingId: string
  marketplaceListingSku: string
  supplierSku: string
  supplierVariantId: string
  quantity: number
}

export type PurchaseConfirmation = {
  lunaOrderId: string
  productCost: number
  shippingCost: number
  taxAmount: number
  totalPaid: number
  currency: string
  purchasedAt: string
}

export type ShipmentItemInput = {
  lineItemId: string
  listingId: string
  marketplaceListingSku: string
  supplierSku: string
  quantity: number
}

export type NormalizedTrackingPayload = {
  trackingNumber: string
  carrier: string
  suggestedCarrier: string | null
  shippedDate: string
  partialShipment: boolean
  items: ShipmentItemInput[]
}

export const FULFILLMENT_SIMULATION_SCENARIOS = [
  "success",
  "temporary_error",
  "permanent_error",
  "ambiguous_timeout",
  "duplicate_response",
  "fulfillment_already_exists",
] as const

export type FulfillmentSimulationScenario = typeof FULFILLMENT_SIMULATION_SCENARIOS[number]

function requiredText(value: unknown, code: string, maximum = 200) {
  if (typeof value !== "string") throw new Error(code)
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(code)
  }
  return normalized
}

function money(value: unknown, code: string) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) throw new Error(code)
  return Number(parsed.toFixed(2))
}

function isoTimestamp(value: unknown, code: string) {
  const text = requiredText(value, code, 40)
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) throw new Error(code)
  return new Date(parsed).toISOString()
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableObject(item)]))
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(stableObject(value))
}

export function sha256Hex(value: unknown) {
  return createHash("sha256").update(
    typeof value === "string" ? value : canonicalJson(value),
    "utf8",
  ).digest("hex")
}

export function isFulfillmentTransitionAllowed(
  from: FulfillmentV1AState,
  to: FulfillmentV1AState,
) {
  return allowedTransitions[from].includes(to)
}

export function assertFulfillmentTransition(
  from: FulfillmentV1AState,
  to: FulfillmentV1AState,
) {
  if (!isFulfillmentTransitionAllowed(from, to)) {
    throw new Error("FULFILLMENT_TRANSITION_NOT_ALLOWED")
  }
}

export function normalizeFulfillmentIdentity(input: Partial<FulfillmentIdentity>) {
  const identity: FulfillmentIdentity = {
    marketplaceAccountKey: requiredText(input.marketplaceAccountKey, "FULFILLMENT_ACCOUNT_REQUIRED", 200),
    marketplace: requiredText(input.marketplace, "FULFILLMENT_MARKETPLACE_REQUIRED", 40).toUpperCase(),
    orderId: requiredText(input.orderId, "FULFILLMENT_ORDER_ID_REQUIRED", 200),
    lineItemId: requiredText(input.lineItemId, "FULFILLMENT_LINE_ITEM_ID_REQUIRED", 200),
    listingId: requiredText(input.listingId, "FULFILLMENT_LISTING_ID_REQUIRED", 200),
    marketplaceListingSku: requiredText(input.marketplaceListingSku, "FULFILLMENT_CUSTOM_LABEL_REQUIRED", 200),
    supplierSku: requiredText(input.supplierSku, "FULFILLMENT_SUPPLIER_SKU_REQUIRED", 200),
    supplierVariantId: requiredText(input.supplierVariantId, "FULFILLMENT_SUPPLIER_VARIANT_REQUIRED", 200),
    quantity: Number(input.quantity),
  }
  if (!Number.isSafeInteger(identity.quantity) || identity.quantity <= 0 || identity.quantity > 10_000) {
    throw new Error("FULFILLMENT_QUANTITY_INVALID")
  }
  return identity
}

export function fulfillmentIdentityFingerprint(input: Partial<FulfillmentIdentity>) {
  const identity = normalizeFulfillmentIdentity(input)
  return `sha256:${sha256Hex([
    identity.marketplaceAccountKey,
    identity.marketplace,
    identity.orderId,
    identity.lineItemId,
    identity.listingId,
    identity.marketplaceListingSku,
    identity.supplierSku,
    identity.supplierVariantId,
    String(identity.quantity),
  ].join("\u001f"))}`
}

export function normalizePurchaseConfirmation(input: Record<string, unknown>) {
  const purchase: PurchaseConfirmation = {
    lunaOrderId: requiredText(input.lunaOrderId, "FULFILLMENT_LUNA_ORDER_ID_REQUIRED", 120),
    productCost: money(input.productCost, "FULFILLMENT_PRODUCT_COST_INVALID"),
    shippingCost: money(input.shippingCost, "FULFILLMENT_SHIPPING_COST_INVALID"),
    taxAmount: input.taxAmount === undefined || input.taxAmount === null || input.taxAmount === ""
      ? 0
      : money(input.taxAmount, "FULFILLMENT_TAX_AMOUNT_INVALID"),
    totalPaid: money(input.totalPaid, "FULFILLMENT_TOTAL_PAID_INVALID"),
    currency: requiredText(input.currency, "FULFILLMENT_CURRENCY_REQUIRED", 3).toUpperCase(),
    purchasedAt: isoTimestamp(input.purchasedAt, "FULFILLMENT_PURCHASED_AT_INVALID"),
  }
  if (!["USD", "GTQ"].includes(purchase.currency)) throw new Error("FULFILLMENT_CURRENCY_NOT_ALLOWED")
  const expected = Number((purchase.productCost + purchase.shippingCost + purchase.taxAmount).toFixed(2))
  if (Math.abs(expected - purchase.totalPaid) > 0.01) throw new Error("FULFILLMENT_TOTAL_INCOHERENT")
  return purchase
}

export function isAllowedLunaProductUrl(value: unknown) {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      (url.hostname === "lunaportex.com" || url.hostname.endsWith(".lunaportex.com")) &&
      !url.username && !url.password
  } catch {
    return false
  }
}

const carrierAliases: Readonly<Record<string, string>> = {
  "US POSTAL SERVICE": "USPS",
  "UNITED STATES POSTAL SERVICE": "USPS",
  USPS: "USPS",
  UPS: "UPS",
  FEDEX: "FEDEX",
  "FED EX": "FEDEX",
  DHL: "DHL",
  ONTRAC: "ONTRAC",
  ESTAFETA: "ESTAFETA",
}

export function normalizeCarrier(value: unknown, required = true) {
  if ((value === null || value === undefined || value === "") && !required) return null
  const raw = requiredText(value, "FULFILLMENT_CARRIER_REQUIRED", 50).toUpperCase().replace(/\s+/g, " ")
  const normalized = carrierAliases[raw]
  if (!normalized) throw new Error("FULFILLMENT_CARRIER_INVALID")
  return normalized
}

export function normalizeTrackingNumber(value: unknown) {
  const tracking = requiredText(value, "FULFILLMENT_TRACKING_REQUIRED", 80)
    .toUpperCase()
    .replace(/[\s.]+/g, "")
  if (!/^[A-Z0-9][A-Z0-9-]{4,39}$/.test(tracking)) {
    throw new Error("FULFILLMENT_TRACKING_INVALID")
  }
  return tracking
}

function carrierLooksCoherent(carrier: string, tracking: string) {
  if (carrier === "UPS") return /^1Z[A-Z0-9]{16}$/.test(tracking)
  if (carrier === "FEDEX") return /^\d{12,15}$/.test(tracking)
  if (carrier === "DHL") return /^\d{10}$/.test(tracking) || /^JJD\d{15,18}$/.test(tracking)
  if (carrier === "USPS") return /^\d{20,22}$/.test(tracking) || /^[A-Z]{2}\d{9}US$/.test(tracking)
  return tracking.length >= 5
}

export function normalizeTrackingPayload(
  input: Record<string, unknown>,
  expectedItems: ShipmentItemInput[],
) {
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber)
  const carrier = normalizeCarrier(input.confirmedCarrier, true) as string
  const suggestedCarrier = normalizeCarrier(input.suggestedCarrier, false)
  if (!carrierLooksCoherent(carrier, trackingNumber)) {
    throw new Error("FULFILLMENT_CARRIER_TRACKING_MISMATCH")
  }
  const shippedDate = isoTimestamp(input.shippedDate, "FULFILLMENT_SHIPPED_DATE_INVALID")
  const rawItems = Array.isArray(input.items) ? input.items : []
  if (!rawItems.length) throw new Error("FULFILLMENT_SHIPMENT_ITEMS_REQUIRED")
  const expectedByLine = new Map(expectedItems.map((item) => [item.lineItemId, item]))
  const seen = new Set<string>()
  const items = rawItems.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("FULFILLMENT_SHIPMENT_ITEM_INVALID")
    }
    const row = value as Record<string, unknown>
    const lineItemId = requiredText(row.lineItemId, "FULFILLMENT_LINE_ITEM_ID_REQUIRED", 200)
    if (seen.has(lineItemId)) throw new Error("FULFILLMENT_SHIPMENT_LINE_DUPLICATE")
    seen.add(lineItemId)
    const expected = expectedByLine.get(lineItemId)
    if (!expected) throw new Error("FULFILLMENT_SHIPMENT_LINE_NOT_IN_ORDER")
    const quantity = Number(row.quantity)
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > expected.quantity) {
      throw new Error("FULFILLMENT_SHIPMENT_QUANTITY_INVALID")
    }
    return { ...expected, quantity }
  }).sort((left, right) => left.lineItemId.localeCompare(right.lineItemId))
  const shipped = items.reduce((sum, item) => sum + item.quantity, 0)
  const sold = expectedItems.reduce((sum, item) => sum + item.quantity, 0)
  const payload: NormalizedTrackingPayload = {
    trackingNumber,
    carrier,
    suggestedCarrier,
    shippedDate,
    partialShipment: shipped < sold || items.length < expectedItems.length,
    items,
  }
  return { payload, payloadHash: `sha256:${sha256Hex(payload)}` }
}

export function simulateMarketplaceFulfillmentSubmission(
  scenario: FulfillmentSimulationScenario,
  payloadHash: string,
) {
  const remoteId = `sim_${sha256Hex(`${scenario}:${payloadHash}`).slice(0, 24)}`
  switch (scenario) {
    case "success":
      return { outcome: "accepted" as const, retryable: false, acceptedRemotely: true, remoteId, code: "SIMULATED_ACCEPTED" }
    case "duplicate_response":
      return { outcome: "already_exists" as const, retryable: false, acceptedRemotely: true, remoteId, code: "SIMULATED_DUPLICATE_RECOGNIZED" }
    case "fulfillment_already_exists":
      return { outcome: "already_exists" as const, retryable: false, acceptedRemotely: true, remoteId, code: "SIMULATED_FULFILLMENT_EXISTS" }
    case "temporary_error":
      return { outcome: "temporary_error" as const, retryable: true, acceptedRemotely: false, remoteId: null, code: "SIMULATED_TEMPORARY_ERROR" }
    case "permanent_error":
      return { outcome: "permanent_error" as const, retryable: false, acceptedRemotely: false, remoteId: null, code: "SIMULATED_PERMANENT_ERROR" }
    case "ambiguous_timeout":
      return { outcome: "ambiguous_timeout" as const, retryable: false, acceptedRemotely: true, remoteId, code: "SIMULATED_TIMEOUT_AFTER_ACCEPTANCE" }
  }
}

export function containsFulfillmentPrivateData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsFulfillmentPrivateData)
  if (!value || typeof value !== "object") return false
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
    const forbidden = normalized === "buyer" || normalized.startsWith("buyername") ||
      normalized.startsWith("buyeremail") || normalized.startsWith("buyerusername") ||
      normalized === "shipto" || normalized.includes("shippingaddress") ||
      normalized.includes("addressline") || normalized === "fullname" ||
      normalized === "email" || normalized.endsWith("emailaddress") ||
      normalized === "phone" || normalized.endsWith("phonenumber") ||
      normalized.includes("cardnumber") || normalized === "cvv" ||
      normalized.includes("paymentmethod")
    return forbidden || containsFulfillmentPrivateData(child)
  })
}
