import { createHash } from "node:crypto"

import { calculateEbayUnitEconomics } from "./ebay-unit-economics"

export const LUNA_SHIPPING_QUOTE_CAPTURE_VERSION =
  "LUNA_SHIPPING_QUOTE_CAPTURE_V1" as const
export const LUNA_SHIPPING_EXTENSION_ID =
  "mhpkojahbbfdgodeaecggpjaplllgclk" as const
export const LUNA_SHIPPING_EXTENSION_MAXIMUM_BATCH = 20
export const LUNA_SHIPPING_EXTENSION_MAXIMUM_CAPTURE_AGE_MS = 10 * 60 * 1_000
export const LUNA_NORMAL_CHROME_EXTENSION_SHIPPING_SOURCE =
  "NORMAL_CHROME_EXTENSION_VISIBLE_DOM" as const
export const LUNA_SHIPPING_RUNTIME_TRACE_VERSION =
  "LUNA_SHIPPING_RUNTIME_TRACE_V1" as const
export const LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS = 100

export const LUNA_SHIPPING_RUNTIME_TRACE_STATES = Object.freeze([
  "BIND_RUNTIME_CLEARED", "PRODUCTION_OBSERVER_REARMED",
  "PRODUCTION_WORKER_READY", "INITIAL_AUTO_CLAIM_STARTED",
  "ELIGIBLE_JOB_FOUND", "PRODUCTION_JOB_CLAIMED",
  "PRODUCTION_JOB_DISPATCHED", "WORKER_IDLE_NO_ELIGIBLE_JOB",
  "BRIDGE_CONNECTED", "JOB_DISPATCHED", "PRODUCT_PAGE_OPENED",
  "PRODUCT_IDENTITY_VERIFIED", "PRODUCT_OOS_CONFIRMED",
  "STOCK_EVIDENCE_RECONCILED", "REJECTED_STOCK",
  "PRODUCTION_JOB_COMPLETED", "AUTO_NEXT", "ADD_TO_CART_FOUND",
  "ADD_TO_CART_DISPATCHED", "CART_PAGE_DETECTED",
  "ACTIVE_JOB_RECOVERED_ON_CART", "CART_PRODUCT_VERIFIED",
  "CART_QUANTITY_VERIFIED", "CART_MUTATION_CONFIRMED",
  "CHECKOUT_NAVIGATION_ARMED", "CHECKOUT_NAVIGATION_TRIGGERED",
  "CHECKOUT_NAVIGATION_TIMEOUT",
  "CHECKOUT_NAVIGATION_OBSERVED", "CHECKOUT_HOST_CLASSIFIED",
  "CHECKOUT_SCRIPT_INJECTION_REQUESTED",
  "CHECKOUT_SCRIPT_INJECTION_RESULT", "CHECKOUT_BOOTSTRAP_ACK",
  "ACTIVE_JOB_RECOVERED_ON_CHECKOUT", "SHOP_PAY_DOM_READY",
  "CHECKOUT_PAGE_CLASSIFIED", "CANONICAL_BIND_REQUESTED",
  "BIND_REQUEST_ACCEPTED", "BIND_EXISTING_CHECKOUT_SEARCH_STARTED",
  "BIND_EXISTING_CHECKOUT_FOUND", "BIND_CHECKOUT_BOOTSTRAP_REQUIRED",
  "BIND_START_JOB_INVOKED",
  "BIND_BOOTSTRAP_PRODUCT_OPENED", "BIND_BOOTSTRAP_PRODUCT_VERIFIED",
  "BIND_BOOTSTRAP_CART_CONFIRMED",
  "BIND_BOOTSTRAP_CHECKOUT_NAVIGATION_OBSERVED",
  "BIND_BOOTSTRAP_CHECKOUT_DETECTED", "BIND_SHIP_TO_DETECTED",
  "BIND_SHOP_APP_TAB_DISCOVERY_STARTED", "BIND_SHOP_APP_TAB_DISCOVERY_RESULT",
  "BIND_SHOP_APP_TAB_SELECTED",
  "BIND_TOP_FRAME_EXECUTION_STARTED", "BIND_CHECKOUT_MARKERS_VERIFIED",
  "BIND_SHIP_TO_AVAILABLE", "CANONICAL_FINGERPRINT_COMPUTED",
  "CANONICAL_FINGERPRINT_WRITE_STARTED",
  "CANONICAL_FINGERPRINT_WRITE_COMPLETE",
  "CANONICAL_FINGERPRINT_READBACK_VERIFIED",
  "CANONICAL_DESTINATION_MATCH", "CANONICAL_BIND_COMPLETED",
  "QUOTE_PARSER_STARTED", "SUBTOTAL_PARSED", "SHIPPING_PARSED",
  "TOTAL_PARSED", "CAPTURE_POST", "DURABLE_READBACK",
  "ECONOMICS_EVALUATED", "PASS", "FAIL",
] as const)

export type LunaShippingRuntimeTraceStateV1 =
  typeof LUNA_SHIPPING_RUNTIME_TRACE_STATES[number]

export type LunaShippingRuntimeTraceEventV1 = Readonly<{
  contractVersion: typeof LUNA_SHIPPING_RUNTIME_TRACE_VERSION
  traceId: string
  candidateId: string | null
  sequence: number
  timestamp: string
  extensionVersion: string
  captureSessionIdHash: string
  state: LunaShippingRuntimeTraceStateV1
  event: LunaShippingRuntimeTraceStateV1
  success: boolean
  reasonCode: string
  subtotalUsd?: number
  shippingUsd?: number
  totalUsd?: number
  shopPayMarkerShipTo?: boolean
  shopPayMarkerShipping?: boolean
  shopPayMarkerSubtotal?: boolean
  shopPayMarkerTotal?: boolean
  shopPayMarkerPayNow?: boolean
  subtotalLabelFound?: boolean
  subtotalAmountCandidateFound?: boolean
  subtotalCurrencyFound?: boolean
  subtotalParsed?: boolean
  shippingLabelFound?: boolean
  shippingAmountCandidateFound?: boolean
  shippingCurrencyFound?: boolean
  shippingParsed?: boolean
  totalLabelFound?: boolean
  totalCurrencyFound?: boolean
  totalAmountCandidateFound?: boolean
  totalLabelAmountContainerFound?: boolean
  totalParsed?: boolean
  tabsQueryTotalCount?: number
  shopAppHostTabCount?: number
  shopAppProbedCount?: number
  tabsEnumeratedCount?: number
  contentScriptResponderCount?: number
  eligibleCheckoutCount?: number
  probeAttemptCount?: number
  probeResponseCount?: number
  eligibleResponseCount?: number
  probeErrorCount?: number
  bindCheckoutDiscoveryValidCount?: number
  bindCheckoutBootstrapRequired?: boolean
  bindCheckoutBootstrapAttempted?: boolean
  bindStartJobInvoked?: boolean
  productOosConfirmed?: boolean
  productPageStockStatus?: "FRESH_OUT_OF_STOCK"
  purchaseBoundaryEnforced: true
}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NONCE = /^[A-Za-z0-9_.-]{32,128}$/
const SHA256 = /^sha256:[0-9a-f]{64}$/
const PRODUCT_ID = /^\d{8,24}$/
const SAFE_SKU = /^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$/
const SAFE_REASON = /^[A-Z][A-Z0-9_:.-]{1,119}$/
const TRACE_ID = /^luna-shipping-trace-v1:sha256:[0-9a-f]{64}$/
const EXTENSION_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/
const TRACE_EVENT_KEYS = new Set([
  "candidateId", "captureSessionIdHash", "contractVersion", "event",
  "extensionVersion", "purchaseBoundaryEnforced", "reasonCode", "sequence",
  "shippingUsd", "shopPayMarkerPayNow", "shopPayMarkerShipTo",
  "shopPayMarkerShipping", "shopPayMarkerSubtotal", "shopPayMarkerTotal",
  "shippingAmountCandidateFound", "shippingCurrencyFound",
  "shippingLabelFound", "shippingParsed", "state",
  "subtotalAmountCandidateFound", "subtotalCurrencyFound",
  "subtotalLabelFound", "subtotalParsed", "subtotalUsd", "success",
  "timestamp", "totalAmountCandidateFound", "totalCurrencyFound",
  "totalLabelAmountContainerFound", "totalLabelFound", "totalParsed",
  "totalUsd", "traceId", "tabsQueryTotalCount", "shopAppHostTabCount",
  "shopAppProbedCount", "tabsEnumeratedCount", "contentScriptResponderCount",
  "eligibleCheckoutCount", "probeAttemptCount", "probeResponseCount",
  "eligibleResponseCount", "probeErrorCount",
  "bindCheckoutDiscoveryValidCount", "bindCheckoutBootstrapRequired",
  "bindCheckoutBootstrapAttempted", "bindStartJobInvoked",
  "productOosConfirmed", "productPageStockStatus",
])
const TRACE_STATE_SET = new Set<string>(LUNA_SHIPPING_RUNTIME_TRACE_STATES)

export function normalizeLunaShippingRuntimeTraceEventV1(
  input: LunaShippingRuntimeTraceEventV1,
  now = Date.now(),
) : LunaShippingRuntimeTraceEventV1 {
  const keys = Object.keys(input)
  const timestampMs = Date.parse(input.timestamp)
  const optionalMoney = [input.subtotalUsd, input.shippingUsd, input.totalUsd]
    .filter((value) => value !== undefined)
  const markerFields = [input.shopPayMarkerShipTo,
    input.shopPayMarkerShipping, input.shopPayMarkerSubtotal,
    input.shopPayMarkerTotal, input.shopPayMarkerPayNow,
    input.subtotalLabelFound, input.subtotalAmountCandidateFound,
    input.subtotalCurrencyFound, input.subtotalParsed,
    input.shippingLabelFound, input.shippingAmountCandidateFound,
    input.shippingCurrencyFound, input.shippingParsed,
    input.totalLabelFound, input.totalCurrencyFound,
    input.totalAmountCandidateFound, input.totalLabelAmountContainerFound,
    input.totalParsed, input.bindCheckoutBootstrapRequired,
    input.bindCheckoutBootstrapAttempted, input.bindStartJobInvoked]
    .filter((value) => value !== undefined)
  const countFields = [input.tabsQueryTotalCount, input.shopAppHostTabCount,
    input.shopAppProbedCount, input.tabsEnumeratedCount,
    input.contentScriptResponderCount, input.eligibleCheckoutCount,
    input.probeAttemptCount, input.probeResponseCount,
    input.eligibleResponseCount, input.probeErrorCount,
    input.bindCheckoutDiscoveryValidCount]
    .filter((value) => value !== undefined)
  if (keys.some((key) => !TRACE_EVENT_KEYS.has(key)) ||
      input.contractVersion !== LUNA_SHIPPING_RUNTIME_TRACE_VERSION ||
      !TRACE_ID.test(input.traceId) ||
      (input.candidateId !== null && !SHA256.test(input.candidateId)) ||
      !Number.isInteger(input.sequence) || input.sequence < 1 ||
      input.sequence > LUNA_SHIPPING_RUNTIME_TRACE_MAXIMUM_EVENTS ||
      !Number.isFinite(timestampMs) || timestampMs > now + 60_000 ||
      now - timestampMs > 24 * 60 * 60 * 1_000 ||
      !EXTENSION_VERSION.test(input.extensionVersion) ||
      !SHA256.test(input.captureSessionIdHash) ||
      !TRACE_STATE_SET.has(input.state) || input.event !== input.state ||
      typeof input.success !== "boolean" || !SAFE_REASON.test(input.reasonCode) ||
      input.purchaseBoundaryEnforced !== true ||
      optionalMoney.some((value) => money(value) === null) ||
      markerFields.some((value) => typeof value !== "boolean") ||
      (input.productPageStockStatus !== undefined &&
        input.productPageStockStatus !== "FRESH_OUT_OF_STOCK") ||
      (input.productOosConfirmed !== undefined &&
        typeof input.productOosConfirmed !== "boolean") ||
      countFields.some((value) => !Number.isInteger(value) || value < 0 ||
        value > 10_000)) {
    throw new Error("LUNA_SHIPPING_RUNTIME_TRACE_CONTRACT_INVALID")
  }
  return Object.freeze({ ...input })
}

export type LunaShippingIdentityV1 = Readonly<{
  candidateId: string
  canonicalProductUrl: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  quantity: number
}>

export type LunaShippingDestinationV1 = Readonly<{
  profileId: string
  profileDigest: string
  country: "US"
  province: string
  postalCode: string
}>

export type LunaChromeShippingJobV1 = Readonly<{
  contractVersion: typeof LUNA_SHIPPING_QUOTE_CAPTURE_VERSION
  captureSessionId: string
  nonce: string
  identity: LunaShippingIdentityV1
  destination: LunaShippingDestinationV1
  salePriceUsd: number
  supplierCostUsd: number
  productName: string
}>

export type LunaChromeShippingVisibleCaptureV1 = Readonly<{
  contractVersion: typeof LUNA_SHIPPING_QUOTE_CAPTURE_VERSION
  captureSessionId: string
  nonce: string
  candidateId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  quantity: number
  subtotalUsd: number
  shippingUsd: number
  totalUsd: number
  currency: "USD"
  observedAt: string
  acquisitionMethod: typeof LUNA_NORMAL_CHROME_EXTENSION_SHIPPING_SOURCE
  extensionEvidenceDigest: string
  normalChromeAuthenticated: true
  expectedProductIdMatch: true
  expectedVariantIdMatch: true
  expectedSupplierSkuMatch: true
  subtotalPlusShippingReconciles: true
  cartRestoreProven: true
  cookieAccess: false
  credentialAccess: false
  lunaPurchases: 0
}>

export type LunaShippingCapturePostV1 = Readonly<{
  candidateId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  quantity: number
  subtotalUsd: number
  shippingUsd: number
  totalUsd: number
  currency: "USD"
  observedAt: string
  acquisitionMethod: typeof LUNA_NORMAL_CHROME_EXTENSION_SHIPPING_SOURCE
  evidenceDigest: string
  captureSessionId: string
  nonce: string
}>

export const LUNA_PRODUCT_PAGE_STOCK_OBSERVATION_VERSION =
  "LUNA_PRODUCT_PAGE_STOCK_OBSERVATION_V1" as const
export const LUNA_PRODUCT_PAGE_STOCK_MAXIMUM_AGE_SECONDS = 86_400
export const LUNA_NORMAL_CHROME_PRODUCT_PAGE_STOCK_SOURCE =
  "NORMAL_CHROME_EXTENSION_VISIBLE_PRODUCT_PAGE" as const

export type LunaProductPageOosPostV1 = Readonly<{
  candidateId: string
  lunaProductId: string
  lunaVariantId: string
  supplierSku: string
  quantity: number
  productPageStockStatus: "FRESH_OUT_OF_STOCK"
  productOosConfirmed: true
  soldOutMarker: boolean
  outOfStockMarker: boolean
  observedAt: string
  acquisitionMethod: typeof LUNA_NORMAL_CHROME_PRODUCT_PAGE_STOCK_SOURCE
  evidenceDigest: string
  captureSessionId: string
  nonce: string
}>

const CAPTURE_POST_KEYS = Object.freeze([
  "acquisitionMethod", "candidateId", "captureSessionId", "currency",
  "evidenceDigest", "lunaProductId", "lunaVariantId", "nonce", "observedAt",
  "quantity", "shippingUsd", "subtotalUsd", "supplierSku", "totalUsd",
].sort())

export function certifyLunaShippingCapturePostV1(input: Readonly<{
  job: LunaChromeShippingJobV1
  capture: LunaShippingCapturePostV1
  now?: number
}>) {
  const keys = Object.keys(input.capture).sort()
  if (keys.length !== CAPTURE_POST_KEYS.length ||
      keys.some((key, index) => key !== CAPTURE_POST_KEYS[index])) {
    throw new Error("LUNA_SHIPPING_CAPTURE_POST_CONTRACT_INVALID")
  }
  return certifyLunaChromeShippingVisibleCaptureV1({
    job: input.job,
    now: input.now,
    capture: {
      contractVersion: LUNA_SHIPPING_QUOTE_CAPTURE_VERSION,
      captureSessionId: input.capture.captureSessionId,
      nonce: input.capture.nonce,
      candidateId: input.capture.candidateId,
      lunaProductId: input.capture.lunaProductId,
      lunaVariantId: input.capture.lunaVariantId,
      supplierSku: input.capture.supplierSku,
      quantity: input.capture.quantity,
      subtotalUsd: input.capture.subtotalUsd,
      shippingUsd: input.capture.shippingUsd,
      totalUsd: input.capture.totalUsd,
      currency: input.capture.currency,
      observedAt: input.capture.observedAt,
      acquisitionMethod: input.capture.acquisitionMethod,
      extensionEvidenceDigest: input.capture.evidenceDigest,
      normalChromeAuthenticated: true,
      expectedProductIdMatch: true,
      expectedVariantIdMatch: true,
      expectedSupplierSkuMatch: true,
      subtotalPlusShippingReconciles: true,
      cartRestoreProven: true,
      cookieAccess: false,
      credentialAccess: false,
      lunaPurchases: 0,
    },
  })
}

function money(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) return null
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

function safeProductName(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
  return normalized.length >= 2 && normalized.length <= 240 ? normalized : null
}

function canonicalProductUrl(value: string) {
  let parsed: URL
  try { parsed = new URL(value) } catch {
    throw new Error("LUNA_SHIPPING_PRODUCT_URL_INVALID")
  }
  if (parsed.protocol !== "https:" ||
      !new Set(["lunaportex.com", "www.lunaportex.com"]).has(parsed.hostname) ||
      !/^\/products\/[a-z0-9][a-z0-9-]{1,180}\/?$/.test(parsed.pathname) ||
      parsed.username || parsed.password || parsed.port) {
    throw new Error("LUNA_SHIPPING_PRODUCT_URL_INVALID")
  }
  parsed.hostname = "www.lunaportex.com"
  parsed.pathname = parsed.pathname.replace(/\/$/, "")
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString()
}

function normalizeIdentity(input: LunaShippingIdentityV1) {
  if (!SHA256.test(input.candidateId) || !PRODUCT_ID.test(input.lunaProductId) ||
      !PRODUCT_ID.test(input.lunaVariantId) || !SAFE_SKU.test(input.supplierSku) ||
      !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 20) {
    throw new Error("LUNA_SHIPPING_IDENTITY_INVALID")
  }
  return Object.freeze({ ...input,
    canonicalProductUrl: canonicalProductUrl(input.canonicalProductUrl) })
}

export function normalizeLunaChromeShippingDestinationV1(
  input: LunaShippingDestinationV1,
) {
  if (!/^[A-Z0-9_-]{3,80}$/.test(input.profileId) ||
      !SHA256.test(input.profileDigest) || input.country !== "US" ||
      !/^[A-Z]{2}$/.test(input.province) ||
      !/^\d{5}(?:-\d{4})?$/.test(input.postalCode)) {
    throw new Error("LUNA_SHIPPING_DESTINATION_INVALID")
  }
  return Object.freeze({ ...input })
}

export function normalizeLunaChromeShippingJobV1(
  input: LunaChromeShippingJobV1,
) : LunaChromeShippingJobV1 {
  const identity = normalizeIdentity(input.identity)
  const destination = normalizeLunaChromeShippingDestinationV1(input.destination)
  const salePriceUsd = money(input.salePriceUsd)
  const supplierCostUsd = money(input.supplierCostUsd)
  const productName = safeProductName(input.productName)
  if (input.contractVersion !== LUNA_SHIPPING_QUOTE_CAPTURE_VERSION ||
      !UUID.test(input.captureSessionId) || !NONCE.test(input.nonce) ||
      salePriceUsd === null || salePriceUsd <= 0 ||
      supplierCostUsd === null || productName === null) {
    throw new Error("LUNA_SHIPPING_EXTENSION_JOB_INVALID")
  }
  return Object.freeze({ ...input, identity, destination, salePriceUsd,
    supplierCostUsd, productName })
}

export function certifyLunaChromeShippingVisibleCaptureV1(input: Readonly<{
  job: LunaChromeShippingJobV1
  capture: LunaChromeShippingVisibleCaptureV1
  now?: number
}>) {
  const job = normalizeLunaChromeShippingJobV1(input.job)
  const capture = input.capture
  const subtotalUsd = money(capture.subtotalUsd)
  const shippingUsd = money(capture.shippingUsd)
  const totalUsd = money(capture.totalUsd)
  const observedAtMs = Date.parse(capture.observedAt)
  const now = input.now ?? Date.now()
  if (capture.contractVersion !== LUNA_SHIPPING_QUOTE_CAPTURE_VERSION ||
      capture.captureSessionId !== job.captureSessionId ||
      capture.nonce !== job.nonce ||
      capture.candidateId !== job.identity.candidateId ||
      capture.lunaProductId !== job.identity.lunaProductId ||
      capture.lunaVariantId !== job.identity.lunaVariantId ||
      capture.supplierSku !== job.identity.supplierSku ||
      capture.quantity !== job.identity.quantity ||
      subtotalUsd === null || shippingUsd === null || totalUsd === null ||
      capture.currency !== "USD" ||
      capture.acquisitionMethod !== LUNA_NORMAL_CHROME_EXTENSION_SHIPPING_SOURCE ||
      !SHA256.test(capture.extensionEvidenceDigest) ||
      !Number.isFinite(observedAtMs) || observedAtMs > now + 60_000 ||
      now - observedAtMs > LUNA_SHIPPING_EXTENSION_MAXIMUM_CAPTURE_AGE_MS ||
      capture.normalChromeAuthenticated !== true ||
      capture.expectedProductIdMatch !== true ||
      capture.expectedVariantIdMatch !== true ||
      capture.expectedSupplierSkuMatch !== true ||
      capture.subtotalPlusShippingReconciles !== true ||
      capture.cartRestoreProven !== true || capture.cookieAccess !== false ||
      capture.credentialAccess !== false || capture.lunaPurchases !== 0 ||
      Math.round(totalUsd * 100) !==
        Math.round((subtotalUsd + shippingUsd) * 100)) {
    throw new Error("LUNA_SHIPPING_EXTENSION_CAPTURE_UNPROVEN")
  }
  const quoteInput = {
    lunaProductId: job.identity.lunaProductId,
    lunaVariantId: job.identity.lunaVariantId,
    supplierSku: job.identity.supplierSku,
    subtotalUsd, shippingAmountUsd: shippingUsd, currency: "USD" as const,
    destinationProfileDigest: job.destination.profileDigest,
    acquisitionMethod: LUNA_NORMAL_CHROME_EXTENSION_SHIPPING_SOURCE,
    observedAt: capture.observedAt,
  }
  const evidenceDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(quoteInput)).digest("hex")}`
  const quote = Object.freeze({
    status: "AVAILABLE" as const,
    subtotalUsd, shippingAmountUsd: shippingUsd, currency: "USD" as const,
    acquisitionMethod: LUNA_NORMAL_CHROME_EXTENSION_SHIPPING_SOURCE,
    observedAt: capture.observedAt,
    evidenceDigest,
    exactLunaIdentity: true as const,
    destinationProfileId: job.destination.profileId,
    destinationProfileDigest: job.destination.profileDigest,
    noPurchase: true as const, noPayment: true as const,
  })
  const economicsResult = calculateEbayUnitEconomics({
    salePrice: job.salePriceUsd,
    supplierCost: job.supplierCostUsd,
  }, { estimatedOutboundShipping: shippingUsd })
  const economics = Object.freeze({
    status: economicsResult.ready && economicsResult.passesProfitGate
      ? "PROVEN_PROFITABLE" as const : "PROVEN_UNPROFITABLE" as const,
    contributionProfitUsd: economicsResult.estimatedNetProfit,
    contributionMarginPercent: economicsResult.estimatedNetMarginPercent,
    salePriceUsd: economicsResult.salePrice,
    supplierCostUsd: economicsResult.supplierCost,
    ebayFeeUsd: economicsResult.estimatedEbayFees,
    returnsReserveUsd: economicsResult.returnsReserve,
    promotionReserveUsd: economicsResult.promotedListingsReserve,
    passesEconomics: economicsResult.passesProfitGate,
  })
  return Object.freeze({
    captureStatus: "AUTHORITATIVE_LUNA_SHIPPING_AVAILABLE" as const,
    quote,
    economics,
    cookieAccess: false as const,
    credentialAccess: false as const,
    lunaPurchases: 0 as const,
    marketplaceWrites: 0 as const,
  })
}
