"use strict"

const SELLER_OS_ORIGIN =
  "https://imnova-website-z1qh-canonical-preview.vercel.app"
const CONTROL_PAGE = `${SELLER_OS_ORIGIN}/admin/ebay/luna-shipping-capture`
const PORT_NAME = "SELLER_OS_LUNA_SHIPPING_CAPTURE_V1"
const JOB_RESULT = "LUNA_SHIPPING_JOB_RESULT"
const CONTRACT = "LUNA_SHIPPING_QUOTE_CAPTURE_V1"
const EXACT_EXTENSION_ID = "mhpkojahbbfdgodeaecggpjaplllgclk"
const EXTENSION_PING = "SELLER_OS_LUNA_SHIPPING_PING"
const EXTENSION_READY = "LUNA_SHIPPING_EXTENSION_READY"
const EXTENSION_BUILD_VERSION = "1.0.43"
const JOB_RESUME = "SELLER_OS_LUNA_SHIPPING_JOB_RESUME"
const GET_ACTIVE_JOB = "GET_ACTIVE_LUNA_SHIPPING_JOB"
const JOB_PROGRESS = "LUNA_SHIPPING_JOB_PROGRESS"
const JOB_RUNTIME_FAILURE = "LUNA_SHIPPING_JOB_RUNTIME_FAILURE"
const SET_ACTIVE_JOB_PHASE = "SET_ACTIVE_LUNA_SHIPPING_JOB_PHASE"
const CHECKOUT_NAVIGATION_TRIGGER = "LUNA_CHECKOUT_NAVIGATION_TRIGGERED"
const CHECKOUT_BOOTSTRAP_ACK = "SHOP_APP_CHECKOUT_BOOTSTRAP_ACK"
const RESUME_ACTIVE_JOB = "RESUME_ACTIVE_LUNA_SHIPPING_JOB"
const BIND_CANONICAL_DESTINATION_EXECUTE =
  "BIND_CANONICAL_DESTINATION_EXECUTE_V1"
const BIND_EXECUTION_CONTRACT = "LUNA_CANONICAL_DESTINATION_BIND_EXECUTION_V1"
const BIND_ELIGIBILITY_PROBE =
  "SELLER_OS_LUNA_BIND_ELIGIBILITY_PROBE_V1"
const BIND_ELIGIBILITY_CONTRACT = "LUNA_BIND_ELIGIBILITY_PROBE_V1"
const GET_CANONICAL_DESTINATION_BINDING =
  "GET_LUNA_CANONICAL_DESTINATION_BINDING"
const AUTO_BIND_CANONICAL_DESTINATION =
  "AUTO_BIND_LUNA_CANONICAL_DESTINATION_V1"
const AUTO_BIND_CONTRACT = "LUNA_CANONICAL_DESTINATION_AUTO_BIND_V1"
const GET_CANONICAL_DESTINATION_STATUS =
  "SELLER_OS_GET_LUNA_CANONICAL_DESTINATION_STATUS"
const CANONICAL_DESTINATION_STATUS =
  "LUNA_CANONICAL_DESTINATION_STATUS"
const GET_BINDING_STORAGE_DIAGNOSTIC =
  "SELLER_OS_GET_LUNA_BINDING_STORAGE_DIAGNOSTIC_V1"
const BINDING_STORAGE_DIAGNOSTIC =
  "LUNA_BINDING_STORAGE_DIAGNOSTIC_V1"
const DESTINATION_BINDING_RESULT =
  "LUNA_CANONICAL_DESTINATION_BINDING_RESULT"
const DESTINATION_FINGERPRINT_VERSION =
  "LUNA_SHOP_PAY_DESTINATION_SHA256_V1"
const DESTINATION_STORAGE_KEY = "sellerOsLunaCanonicalDestinationBindingV1"
const DESTINATION_STORAGE_AUTHORITY =
  `chrome.storage.local:${DESTINATION_STORAGE_KEY}`
const RUNTIME_TRACE_CONTRACT = "LUNA_SHIPPING_RUNTIME_TRACE_V1"
const RUNTIME_TRACE_EVENT = "LUNA_SHIPPING_RUNTIME_TRACE_EVENT"
const SHIPPING_SERVER_RESULT = "SELLER_OS_LUNA_SHIPPING_SERVER_RESULT"
const GET_ACTIVE_PRODUCTION_JOB_STATUS =
  "SELLER_OS_GET_ACTIVE_LUNA_SHIPPING_JOB_STATUS"
const ACTIVE_PRODUCTION_JOB_STATUS = "LUNA_SHIPPING_ACTIVE_JOB_STATUS"
const MAX_RUNTIME_TRACE_EVENTS = 100
const CART_PHASE = "AWAITING_CART_CONFIRMATION"
const CHECKOUT_PHASE = "AWAITING_CHECKOUT_SHIPPING"
const RECONNECT_GRACE_MS = 20_000
const CHECKOUT_BOOTSTRAP_ACK_TIMEOUT_MS = 2_500
const BIND_STEP_TIMEOUT_MS = 2_000
const BIND_TOP_FRAME_TIMEOUT_MS = 25_000
const BIND_CONTENT_RESPONSE_TIMEOUT_MS = 5_000
const BIND_CHECKOUT_BOOTSTRAP_TIMEOUT_MS = 90_000
const CHECKOUT_NAVIGATION_OBSERVATION_TIMEOUT_MS = 20_000
const MAX_BIND_DISCOVERY_TABS = 200
const CHECKOUT_HOSTS = new Set(["lunaportex.com", "www.lunaportex.com",
  "account.lunaportex.com", "shop.app"])
const SHOP_APP_HOST_PATTERN = "https://shop.app/*"
const CHECKOUT_STATE_RANK = new Map([
  ["SHIPPING_FLOW_RESUMED", 5], [CHECKOUT_PHASE, 6],
  ["CHECKOUT_NAVIGATION_ARMED", 7],
  ["CHECKOUT_NAVIGATION_TRIGGERED", 8],
  ["CHECKOUT_NAVIGATION_TIMEOUT", 9],
  ["CHECKOUT_NAVIGATION_OBSERVED", 10], ["CHECKOUT_HOST_ALLOWED", 11],
  ["CHECKOUT_INJECTION_REQUESTED", 20],
  ["CHECKOUT_INJECTION_API_SUCCEEDED", 21],
  ["CHECKOUT_SCRIPT_INJECTED", 22], ["CHECKOUT_SCRIPT_BOOTSTRAP_ACK", 30],
  ["CHECKOUT_CONTENT_SCRIPT_LOADED", 40], ["CONTENT_SCRIPT_LOADED", 40],
  ["ACTIVE_JOB_REQUESTED", 45], ["ACTIVE_JOB_RECOVERED_ON_CHECKOUT", 50],
  ["CHECKOUT_CLASSIFIER_STARTED", 60], ["CHECKOUT_HOST_CLASSIFIED", 70],
  ["CHECKOUT_PAGE_DETECTED", 75],
  ["SHOP_PAY_DOM_WAITING", 80], ["SHOP_PAY_DOM_READY", 90],
  ["CHECKOUT_PAGE_CLASSIFIED", 100],
  ["NORMAL_CHECKOUT_WITH_SHIPPING", 102], ["UNKNOWN_CHECKOUT_PAGE", 102],
  ["CHECKOUT_EXPECTED_PRODUCT_VERIFIED", 103],
  ["CHECKOUT_EXPECTED_QUANTITY_VERIFIED", 104],
  ["CANONICAL_US_PROFILE_FOUND", 105],
  ["SHOP_PAY_QUOTE_PARSER_STARTED", 110], ["SHIPPING_CAPTURE_STARTED", 111],
  ["SHIPPING_ADDRESS_ACCEPTED", 112], ["SHIPPING_OPTIONS_DETECTED", 113],
  ["SHIPPING_QUOTE_CAPTURED", 120], ["RESULT_POSTED", 130],
  ["AUTHENTICATED_OPERATION_CONFIRMED", 121],
])

let sellerPort = null
let activeTabId = null
let activeJob = null
let lastRuntimeState = null
let activeJobPhase = null
let originalCartSnapshot = null
let cartSubtotalUsd = null
let checkoutNavigationArmed = false
let checkoutNavigationTriggered = false
let checkoutInjectionStarted = false
let checkoutBootstrapAckReceived = false
let checkoutBootstrapAckEmitted = false
let checkoutBootstrapAckTimer = null
let lastCheckoutStateRank = 0
let lastCheckoutState = null
let disconnectCleanupTimer = null
let activeRuntimeTrace = null
let canonicalBindInFlight = false
let canonicalBindBootstrapActive = false
let canonicalBindCheckoutWaiter = null
let canonicalBindBootstrapTraceStates = new Set()
let canonicalBindBootstrapAttempted = false
let checkoutNavigationObservation = null
let checkoutNavigationObservationTimer = null

const PROGRESS_TRACE_STATE = new Map([
  ["PRODUCT_PAGE_DOM_READY", "PRODUCT_PAGE_OPENED"],
  ["PRODUCT_IDENTITY_VERIFIED", "PRODUCT_IDENTITY_VERIFIED"],
  ["PRODUCT_OOS_CONFIRMED", "PRODUCT_OOS_CONFIRMED"],
  ["ADD_TO_CART_ELEMENT_FOUND", "ADD_TO_CART_FOUND"],
  ["ADD_TO_CART_CLICK_DISPATCHED", "ADD_TO_CART_DISPATCHED"],
  ["CART_PAGE_DETECTED", "CART_PAGE_DETECTED"],
  ["ACTIVE_JOB_RECOVERED_ON_CART", "ACTIVE_JOB_RECOVERED_ON_CART"],
  ["CART_EXPECTED_PRODUCT_FOUND", "CART_PRODUCT_VERIFIED"],
  ["CART_EXPECTED_QUANTITY_FOUND", "CART_QUANTITY_VERIFIED"],
  ["CART_MUTATION_CONFIRMED", "CART_MUTATION_CONFIRMED"],
  ["CHECKOUT_NAVIGATION_ARMED", "CHECKOUT_NAVIGATION_ARMED"],
  ["CHECKOUT_NAVIGATION_TRIGGERED", "CHECKOUT_NAVIGATION_TRIGGERED"],
  ["CHECKOUT_NAVIGATION_TIMEOUT", "CHECKOUT_NAVIGATION_TIMEOUT"],
  ["CHECKOUT_NAVIGATION_OBSERVED", "CHECKOUT_NAVIGATION_OBSERVED"],
  ["CHECKOUT_HOST_CLASSIFIED", "CHECKOUT_HOST_CLASSIFIED"],
  ["CHECKOUT_HOST_ALLOWED", "CHECKOUT_HOST_CLASSIFIED"],
  ["CHECKOUT_INJECTION_REQUESTED", "CHECKOUT_SCRIPT_INJECTION_REQUESTED"],
  ["CHECKOUT_INJECTION_API_SUCCEEDED", "CHECKOUT_SCRIPT_INJECTION_RESULT"],
  ["CHECKOUT_SCRIPT_BOOTSTRAP_ACK", "CHECKOUT_BOOTSTRAP_ACK"],
  ["ACTIVE_JOB_RECOVERED_ON_CHECKOUT", "ACTIVE_JOB_RECOVERED_ON_CHECKOUT"],
  ["SHOP_PAY_DOM_READY", "SHOP_PAY_DOM_READY"],
  ["CHECKOUT_PAGE_CLASSIFIED", "CHECKOUT_PAGE_CLASSIFIED"],
  ["CHECKOUT_PAGE_DETECTED", "CHECKOUT_PAGE_CLASSIFIED"],
  ["NORMAL_CHECKOUT_WITH_SHIPPING", "CHECKOUT_PAGE_CLASSIFIED"],
  ["CANONICAL_US_PROFILE_FOUND", "CANONICAL_DESTINATION_MATCH"],
  ["SHOP_PAY_QUOTE_PARSER_STARTED", "QUOTE_PARSER_STARTED"],
])

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value))
  const result = await crypto.subtle.digest("SHA-256", bytes)
  return `sha256:${Array.from(new Uint8Array(result))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

async function beginRuntimeTrace(seed, candidateId) {
  const captureSessionIdHash = await sha256(seed)
  activeRuntimeTrace = {
    traceId: `luna-shipping-trace-v1:${captureSessionIdHash}`,
    captureSessionIdHash,
    candidateId: /^sha256:[0-9a-f]{64}$/.test(candidateId ?? "")
      ? candidateId : null,
    sequence: 0,
    events: [],
  }
}

function traceMoney(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100_000
    ? Math.round(value * 100) / 100 : null
}

function emitRuntimeTrace(state, success = true, reasonCode = "NONE", details = {}) {
  if (!activeRuntimeTrace ||
      activeRuntimeTrace.sequence >= MAX_RUNTIME_TRACE_EVENTS) return
  activeRuntimeTrace.sequence += 1
  const event = {
    contractVersion: RUNTIME_TRACE_CONTRACT,
    traceId: activeRuntimeTrace.traceId,
    candidateId: activeRuntimeTrace.candidateId,
    sequence: activeRuntimeTrace.sequence,
    timestamp: new Date().toISOString(),
    extensionVersion: EXTENSION_BUILD_VERSION,
    captureSessionIdHash: activeRuntimeTrace.captureSessionIdHash,
    state, event: state, success,
    reasonCode: safeRuntimeReason(reasonCode).toUpperCase(),
    purchaseBoundaryEnforced: true,
  }
  for (const field of ["subtotalUsd", "shippingUsd", "totalUsd"]) {
    const value = traceMoney(details[field])
    if (value !== null) event[field] = value
  }
  for (const field of ["shopPayMarkerShipTo", "shopPayMarkerShipping",
    "shopPayMarkerSubtotal", "shopPayMarkerTotal", "shopPayMarkerPayNow"]) {
    if (typeof details[field] === "boolean") event[field] = details[field]
  }
  for (const field of ["bindCheckoutBootstrapRequired",
    "bindCheckoutBootstrapAttempted", "bindStartJobInvoked"]) {
    if (typeof details[field] === "boolean") event[field] = details[field]
  }
  if (details.productOosConfirmed === true) event.productOosConfirmed = true
  if (details.productPageStockStatus === "FRESH_OUT_OF_STOCK") {
    event.productPageStockStatus = "FRESH_OUT_OF_STOCK"
  }
  for (const field of ["subtotalLabelFound", "subtotalAmountCandidateFound",
    "subtotalCurrencyFound", "subtotalParsed", "shippingLabelFound",
    "shippingAmountCandidateFound", "shippingCurrencyFound", "shippingParsed",
    "totalLabelFound", "totalAmountCandidateFound", "totalCurrencyFound",
    "totalParsed"]) {
    if (typeof details[field] === "boolean") event[field] = details[field]
  }
  for (const field of ["tabsQueryTotalCount", "shopAppHostTabCount",
    "shopAppProbedCount", "tabsEnumeratedCount",
    "contentScriptResponderCount", "eligibleCheckoutCount",
    "probeAttemptCount", "probeResponseCount", "eligibleResponseCount",
    "probeErrorCount", "bindCheckoutDiscoveryValidCount"]) {
    const value = details[field]
    if (Number.isInteger(value) && value >= 0 && value <= 10_000) {
      event[field] = value
    }
  }
  activeRuntimeTrace.events.push(event)
  try { sellerPort?.postMessage({ type: RUNTIME_TRACE_EVENT, event }) } catch {
    // The bounded trace remains buffered and is replayed on bridge reconnect.
  }
}

function traceProgress(state, details) {
  const traceState = PROGRESS_TRACE_STATE.get(state)
  if (traceState) emitRuntimeTrace(traceState, true, "NONE", details)
  if (state === "SHIPPING_QUOTE_CAPTURED") {
    emitRuntimeTrace("SUBTOTAL_PARSED", true, "NONE", details)
    emitRuntimeTrace("SHIPPING_PARSED", true, "NONE", details)
    emitRuntimeTrace("TOTAL_PARSED", true, "NONE", details)
  }
}

function emitBindBootstrapTraceOnce(state) {
  if (!canonicalBindBootstrapActive ||
      canonicalBindBootstrapTraceStates.has(state)) return
  canonicalBindBootstrapTraceStates.add(state)
  emitRuntimeTrace(state)
}

function waitForCanonicalBindCheckout() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (canonicalBindCheckoutWaiter?.timer !== timer) return
      canonicalBindCheckoutWaiter = null
      reject(new Error("BIND_CHECKOUT_BOOTSTRAP_TIMEOUT"))
    }, BIND_CHECKOUT_BOOTSTRAP_TIMEOUT_MS)
    canonicalBindCheckoutWaiter = { resolve, reject, timer }
  })
}

function settleCanonicalBindCheckout(error = null) {
  const waiter = canonicalBindCheckoutWaiter
  if (!waiter) return
  canonicalBindCheckoutWaiter = null
  clearTimeout(waiter.timer)
  if (error) waiter.reject(error)
  else waiter.resolve()
}

function resetCheckoutNavigationObserver() {
  if (checkoutNavigationObservationTimer) {
    clearTimeout(checkoutNavigationObservationTimer)
  }
  checkoutNavigationObservationTimer = null
  checkoutNavigationObservation = null
}

function initializeCheckoutNavigationObserver(job) {
  resetCheckoutNavigationObserver()
  checkoutNavigationObservation = {
    captureSessionId: job.captureSessionId,
    armed: false,
    observed: false,
    tabId: null,
    host: null,
    origin: null,
  }
}

function armCheckoutNavigationObserver() {
  if (!activeJob || !checkoutNavigationObservation ||
      checkoutNavigationObservation.captureSessionId !==
        activeJob.captureSessionId) return false
  checkoutNavigationObservation.armed = true
  if (checkoutNavigationObservationTimer) {
    clearTimeout(checkoutNavigationObservationTimer)
  }
  const captureSessionId = activeJob.captureSessionId
  checkoutNavigationObservationTimer = setTimeout(() => {
    checkoutNavigationObservationTimer = null
    if (!activeJob || activeJob.captureSessionId !== captureSessionId ||
        !checkoutNavigationObservation?.armed ||
        checkoutNavigationObservation.observed) return
    emitProgress("CHECKOUT_NAVIGATION_TIMEOUT")
    failBindingBootstrapOrActiveJob(checkoutNavigationTriggered
      ? "CHECKOUT_NAVIGATION_NOT_OBSERVED"
      : "CHECKOUT_NAVIGATION_NOT_TRIGGERED")
  }, CHECKOUT_NAVIGATION_OBSERVATION_TIMEOUT_MS)
  emitProgress("CHECKOUT_NAVIGATION_ARMED")
  return true
}

function markCheckoutNavigationTriggered() {
  if (!activeJob || !checkoutNavigationObservation?.armed ||
      checkoutNavigationObservation.captureSessionId !==
        activeJob.captureSessionId) return false
  checkoutNavigationTriggered = true
  if (checkoutNavigationObservationTimer) {
    clearTimeout(checkoutNavigationObservationTimer)
  }
  const captureSessionId = activeJob.captureSessionId
  checkoutNavigationObservationTimer = setTimeout(() => {
    checkoutNavigationObservationTimer = null
    if (!activeJob || activeJob.captureSessionId !== captureSessionId ||
        !checkoutNavigationTriggered ||
        checkoutNavigationObservation?.observed) return
    emitProgress("CHECKOUT_NAVIGATION_TIMEOUT")
    failBindingBootstrapOrActiveJob("CHECKOUT_NAVIGATION_NOT_OBSERVED")
  }, CHECKOUT_NAVIGATION_OBSERVATION_TIMEOUT_MS)
  emitProgress("CHECKOUT_NAVIGATION_TRIGGERED")
  return true
}

function clearActiveJob() {
  resetCheckoutNavigationObserver()
  activeJob = null
  activeJobPhase = null
  originalCartSnapshot = null
  cartSubtotalUsd = null
  checkoutNavigationArmed = false
  checkoutNavigationTriggered = false
  checkoutInjectionStarted = false
  checkoutBootstrapAckReceived = false
  checkoutBootstrapAckEmitted = false
  if (checkoutBootstrapAckTimer) clearTimeout(checkoutBootstrapAckTimer)
  checkoutBootstrapAckTimer = null
  lastCheckoutStateRank = 0
  lastCheckoutState = null
  lastRuntimeState = null
  activeRuntimeTrace = null
  canonicalBindBootstrapActive = false
  canonicalBindBootstrapTraceStates = new Set()
  canonicalBindBootstrapAttempted = false
  settleCanonicalBindCheckout(new Error("BIND_CHECKOUT_BOOTSTRAP_ABORTED"))
}

function finalizeCanonicalBindRuntime(bootstrapStarted) {
  const bindTrace = activeRuntimeTrace
  if (bootstrapStarted || !activeJob) {
    clearActiveJob()
    activeTabId = null
  } else {
    canonicalBindBootstrapActive = false
    canonicalBindBootstrapTraceStates = new Set()
    canonicalBindBootstrapAttempted = false
    settleCanonicalBindCheckout(new Error("BIND_CHECKOUT_BOOTSTRAP_ABORTED"))
  }
  activeRuntimeTrace = bindTrace
  emitRuntimeTrace("BIND_RUNTIME_CLEARED")
}

function safeCartSnapshot(value) {
  if (!Array.isArray(value) || value.length > 50) return null
  const rows = value.map((entry) => ({
    id: String(entry?.id ?? ""), quantity: Number(entry?.quantity),
  }))
  return rows.every((entry) => /^\d{8,24}$/.test(entry.id) &&
    Number.isInteger(entry.quantity) && entry.quantity >= 1 &&
    entry.quantity <= 1_000) ? rows : null
}

function safeSellerSender(sender) {
  try {
    const url = new URL(sender?.origin ?? sender?.url ?? "")
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.port && url.origin === SELLER_OS_ORIGIN
  } catch { return false }
}

function exactLunaUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" ||
        !new Set(["lunaportex.com", "www.lunaportex.com"]).has(url.hostname) ||
        !/^\/products\/[a-z0-9][a-z0-9-]{1,180}\/?$/.test(url.pathname) ||
        url.username || url.password || url.port) return null
    url.hostname = "www.lunaportex.com"
    url.search = ""
    return url
  } catch { return null }
}

function safeNavigationIdentity(value) {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(url.hostname)) return null
    return { host: url.hostname, origin: `https://${url.hostname}` }
  } catch { return null }
}

function allowedCheckoutNavigation(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || !CHECKOUT_HOSTS.has(url.hostname)) return null
    const pathAllowed = new Set(["lunaportex.com", "www.lunaportex.com"])
      .has(url.hostname) ? /^\/checkouts?(?:\/|$)/.test(url.pathname)
      : true
    return pathAllowed ? { host: url.hostname,
      origin: `https://${url.hostname}` } : null
  } catch { return null }
}

function isPreNavigationCartDocument(value) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      new Set(["lunaportex.com", "www.lunaportex.com"]).has(url.hostname) &&
      url.pathname.replace(/\/$/, "") === "/cart"
  } catch { return false }
}

function effectiveShopAppContract() {
  const manifest = chrome.runtime.getManifest()
  return manifest.version === EXTENSION_BUILD_VERSION &&
    Array.isArray(manifest.permissions) &&
    manifest.permissions.includes("storage") &&
    Array.isArray(manifest.host_permissions) &&
    manifest.host_permissions.includes(SHOP_APP_HOST_PATTERN) &&
    Array.isArray(manifest.content_scripts) &&
    manifest.content_scripts.some((entry) =>
      Array.isArray(entry.matches) && entry.matches.includes(SHOP_APP_HOST_PATTERN)) &&
    CHECKOUT_HOSTS.has("shop.app")
}

function jobValidationReason(value) {
  const job = value && typeof value === "object" ? value : {}
  const identity = job.identity && typeof job.identity === "object"
    ? job.identity : {}
  const destination = job.destination && typeof job.destination === "object"
    ? job.destination : {}
  if (!("contractVersion" in job)) return "JOB_MISSING_FIELD:contractVersion"
  if (job.contractVersion !== CONTRACT) return "JOB_INVALID_CONTRACT_VERSION"
  for (const [field, owner] of [
    ["captureSessionId", job], ["nonce", job], ["productName", job],
    ["salePriceUsd", job], ["supplierCostUsd", job],
    ["candidateId", identity], ["canonicalProductUrl", identity],
    ["lunaProductId", identity], ["lunaVariantId", identity],
    ["supplierSku", identity], ["quantity", identity],
    ["profileId", destination], ["profileDigest", destination],
    ["country", destination], ["province", destination],
    ["postalCode", destination],
  ]) if (!(field in owner)) return `JOB_MISSING_FIELD:${
    owner === identity ? "identity." : owner === destination ? "destination." : ""}${field}`
  if (typeof job.captureSessionId !== "string" || typeof job.nonce !== "string" ||
      typeof job.productName !== "string" || typeof job.salePriceUsd !== "number" ||
      typeof job.supplierCostUsd !== "number") return "JOB_INVALID_TYPE:job"
  if (typeof identity.candidateId !== "string" ||
      typeof identity.canonicalProductUrl !== "string" ||
      typeof identity.lunaProductId !== "string" ||
      typeof identity.lunaVariantId !== "string" ||
      typeof identity.supplierSku !== "string" ||
      typeof identity.quantity !== "number") return "JOB_INVALID_TYPE:identity"
  if (typeof destination.profileId !== "string" ||
      typeof destination.profileDigest !== "string" ||
      typeof destination.country !== "string" ||
      typeof destination.province !== "string" ||
      typeof destination.postalCode !== "string") return "JOB_INVALID_TYPE:destination"
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(job.captureSessionId)) return "JOB_INVALID_TYPE:captureSessionId"
  if (!/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(job.nonce)) {
    return "JOB_INVALID_TYPE:nonce"
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(identity.candidateId) ||
      !/^\d{8,24}$/.test(identity.lunaProductId) ||
      !/^\d{8,24}$/.test(identity.lunaVariantId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$/.test(identity.supplierSku)) {
    return "JOB_IDENTITY_MISMATCH:identity"
  }
  if (!Number.isInteger(identity.quantity) || identity.quantity < 1 ||
      identity.quantity > 20) return "JOB_INVALID_TYPE:identity.quantity"
  if (!exactLunaUrl(identity.canonicalProductUrl)) {
    return "JOB_IDENTITY_MISMATCH:identity.canonicalProductUrl"
  }
  if (!/^[A-Z0-9_-]{3,80}$/.test(destination.profileId) ||
      !/^sha256:[0-9a-f]{64}$/.test(destination.profileDigest) ||
      destination.country !== "US" || !/^[A-Z]{2}$/.test(destination.province) ||
      !/^\d{5}(?:-\d{4})?$/.test(destination.postalCode)) {
    return "JOB_INVALID_TYPE:destination"
  }
  if (!Number.isFinite(job.salePriceUsd) || job.salePriceUsd <= 0 ||
      !Number.isFinite(job.supplierCostUsd) || job.supplierCostUsd < 0 ||
      job.productName.trim().length < 2 || job.productName.length > 240) {
    return "JOB_INVALID_TYPE:commercialFacts"
  }
  return null
}

function safeJob(value) {
  return jobValidationReason(value) === null ? value : null
}

function sameJob(left, right) {
  return left?.captureSessionId === right?.captureSessionId &&
    left?.nonce === right?.nonce &&
    left?.identity?.candidateId === right?.identity?.candidateId
}

function encodeJob(job) {
  const bytes = new TextEncoder().encode(JSON.stringify(job))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function decodeJobFromUrl(value) {
  try {
    const encoded = new URL(value).hash.slice(1)
      .split("&").map((entry) => entry.split("="))
      .find(([key]) => key === "seller-os-luna-shipping-v1")?.[1]
    if (!encoded || encoded.length > 12_000) return null
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - encoded.length % 4) % 4)
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const decoded = JSON.parse(new TextDecoder().decode(bytes))
    return safeJob(decoded)
  } catch { return null }
}

function recoverActiveJob(sender) {
  if (!Number.isInteger(sender.tab?.id)) return null
  const navigatedJob = decodeJobFromUrl(sender.url ?? "")
  if (activeJob && navigatedJob && !sameJob(activeJob, navigatedJob)) return null
  if (!activeJob) activeJob = navigatedJob
  if (!activeJob) return null
  const expected = exactLunaUrl(activeJob.identity.canonicalProductUrl)
  let actual = null
  try { actual = new URL(sender.url ?? "") } catch { return null }
  const storefrontHost = new Set(["lunaportex.com", "www.lunaportex.com"])
    .has(actual.hostname)
  const productPath = expected && actual.pathname.replace(/\/$/, "") ===
    expected.pathname.replace(/\/$/, "")
  const cartPath = (activeJobPhase === CART_PHASE ||
    (activeJobPhase === CHECKOUT_PHASE && checkoutNavigationArmed &&
      !checkoutNavigationTriggered)) &&
    actual.pathname.replace(/\/$/, "") === "/cart"
  const lunaCheckout = storefrontHost && /^\/checkouts?(?:\/|$)/
    .test(actual.pathname)
  const accountCheckout = actual.hostname === "account.lunaportex.com"
  const shopPayCheckout = actual.hostname === "shop.app"
  const checkoutPath = activeJobPhase === CHECKOUT_PHASE &&
    checkoutNavigationArmed &&
    (lunaCheckout || accountCheckout || shopPayCheckout)
  if (!expected || actual.protocol !== "https:" ||
      ((!storefrontHost || (!productPath && !cartPath)) && !checkoutPath)) return null
  activeTabId = sender.tab.id
  return activeJob
}

function safeRuntimeReason(value) {
  return typeof value === "string" && /^[A-Za-z0-9_:.-]{3,120}$/.test(value)
    ? value : "LUNA_SHIPPING_RUNTIME_FAILURE"
}

function safeDestinationCandidate(value) {
  return value?.fingerprintVersion === DESTINATION_FINGERPRINT_VERSION &&
    /^sha256:[0-9a-f]{64}$/.test(value?.canonicalDestinationFingerprint ?? "") &&
    value?.countryClass === "US" ? Object.freeze({
      fingerprintVersion: value.fingerprintVersion,
      canonicalDestinationFingerprint: value.canonicalDestinationFingerprint,
      countryClass: "US",
    }) : null
}

function safeDestinationBinding(value) {
  const candidate = safeDestinationCandidate(value)
  const boundAtMs = typeof value?.boundAt === "string"
    ? Date.parse(value.boundAt) : Number.NaN
  const boundAt = Number.isFinite(boundAtMs)
    ? new Date(boundAtMs).toISOString() : null
  return candidate && boundAt ? Object.freeze({ ...candidate, boundAt }) : null
}

function safeAutoBindCandidate(value) {
  const markers = value?.safeMarkerBooleans
  const markerFields = ["shipTo", "shipping", "subtotal", "total", "payNow"]
  if (value?.contractVersion !== AUTO_BIND_CONTRACT ||
      value?.destinationUnambiguous !== true ||
      value?.acceptedUsDestination !== true ||
      value?.shippingAddressAccepted !== true ||
      value?.shippingOptionsDetected !== true ||
      !markers || markerFields.some((field) => markers[field] !== true)) {
    return null
  }
  return safeDestinationCandidate({
    fingerprintVersion: value.fingerprintVersion,
    canonicalDestinationFingerprint: value.fingerprint,
    countryClass: value.countryClass,
  })
}

function readDestinationBindingEnvelope() {
  return new Promise((resolve, reject) => chrome.storage.local.get(
    DESTINATION_STORAGE_KEY, (value) => {
      if (chrome.runtime.lastError) {
        reject(new Error("BINDING_STORAGE_READ_FAILED"))
        return
      }
      const present = Boolean(value && Object.prototype.hasOwnProperty.call(
        value, DESTINATION_STORAGE_KEY))
      resolve({ present, value: present ? value[DESTINATION_STORAGE_KEY] : null })
    }))
}

function bindingStorageDiagnostic() {
  const base = {
    type: BINDING_STORAGE_DIAGNOSTIC,
    extensionId: chrome.runtime.id,
    expectedExtensionId: EXACT_EXTENSION_ID,
    extensionVersion: chrome.runtime.getManifest().version,
    storageAreaUsed: "chrome.storage.local",
    writeStorageAuthority: DESTINATION_STORAGE_AUTHORITY,
    readStorageAuthority: DESTINATION_STORAGE_AUTHORITY,
    statusStorageAuthority: DESTINATION_STORAGE_AUTHORITY,
    autoClaimStorageAuthority: DESTINATION_STORAGE_AUTHORITY,
    authoritiesAligned: true,
    extensionIdContinuity: chrome.runtime.id === EXACT_EXTENSION_ID,
  }
  return readDestinationBindingEnvelope().then((stored) => {
    const envelope = stored.present && stored.value &&
      typeof stored.value === "object" ? stored.value : null
    const fingerprintPresent =
      typeof envelope?.canonicalDestinationFingerprint === "string" &&
      envelope.canonicalDestinationFingerprint.length > 0
    const countryClassPresent = typeof envelope?.countryClass === "string" &&
      envelope.countryClass.length > 0
    const boundAtPresent = typeof envelope?.boundAt === "string" &&
      envelope.boundAt.length > 0
    const schemaVersion = envelope?.fingerprintVersion ===
      DESTINATION_FINGERPRINT_VERSION ? DESTINATION_FINGERPRINT_VERSION
      : envelope?.fingerprintVersion == null ? "ABSENT" : "UNSUPPORTED"
    const current = safeDestinationBinding(envelope)
    const legacy = current ? null : safeDestinationCandidate(envelope)
    let bindingClassification = "NO_BINDING_PRESENT"
    if (current) bindingClassification = "PRIMARY_BINDING_VALID"
    else if (legacy) bindingClassification = "LEGACY_BINDING_VALID"
    else if (stored.present && envelope?.fingerprintVersion !==
        DESTINATION_FINGERPRINT_VERSION) {
      bindingClassification = "BINDING_PRESENT_SCHEMA_REJECTED"
    } else if (stored.present) {
      bindingClassification = "BINDING_PRESENT_FIELD_REJECTED"
    }
    return {
      ...base,
      canonicalPrimaryKeyPresent: stored.present,
      canonicalLegacyKeyPresent: false,
      canonicalEnvelopePresent: Boolean(envelope),
      canonicalEnvelopeSchemaVersion: schemaVersion,
      canonicalEnvelopeValid: Boolean(current || legacy),
      canonicalCountryClassPresent: countryClassPresent,
      canonicalBoundAtPresent: boundAtPresent,
      canonicalFingerprintPresent: fingerprintPresent,
      storageReadStatus: "READ_OK",
      bindingClassification,
    }
  }, () => ({
    ...base,
    canonicalPrimaryKeyPresent: false,
    canonicalLegacyKeyPresent: false,
    canonicalEnvelopePresent: false,
    canonicalEnvelopeSchemaVersion: "NOT_READ",
    canonicalEnvelopeValid: false,
    canonicalCountryClassPresent: false,
    canonicalBoundAtPresent: false,
    canonicalFingerprintPresent: false,
    storageReadStatus: "BINDING_STORAGE_READ_FAILED",
    bindingClassification: "STORAGE_READ_FAILED",
  }))
}

async function readDestinationBinding() {
  const stored = await readDestinationBindingEnvelope()
  if (!stored.present) return null
  const current = safeDestinationBinding(stored.value)
  if (current) return current
  const legacy = safeDestinationCandidate(stored.value)
  if (!legacy) throw new Error("BINDING_PRESENT_INVALID")
  const normalized = Object.freeze({ ...legacy, boundAt: new Date().toISOString() })
  try { await writeDestinationBinding(normalized) } catch {
    throw new Error("BINDING_STORAGE_MIGRATION_WRITE_FAILED")
  }
  const readbackEnvelope = await readDestinationBindingEnvelope()
  const readback = readbackEnvelope.present
    ? safeDestinationBinding(readbackEnvelope.value) : null
  if (!readback || readback.canonicalDestinationFingerprint !==
      normalized.canonicalDestinationFingerprint) {
    throw new Error("BINDING_STORAGE_MIGRATION_READBACK_FAILED")
  }
  return readback
}

function boundedBindStep(promise, transition, timeoutMs = BIND_STEP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`BIND_TIMEOUT:${transition}`))
    }, timeoutMs)
    Promise.resolve(promise).then((value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }, (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}

function writeDestinationBinding(binding) {
  return new Promise((resolve, reject) => chrome.storage.local.set({
    [DESTINATION_STORAGE_KEY]: binding,
  }, () => {
    if (chrome.runtime.lastError) {
      reject(new Error("BIND_STORAGE_WRITE_FAILED"))
      return
    }
    resolve()
  }))
}

async function autoBindCanonicalDestination(value) {
  const candidate = safeAutoBindCandidate(value)
  if (!candidate) {
    throw new Error("CANONICAL_DESTINATION_AUTO_BIND_UNVERIFIABLE")
  }
  const existingBinding = await readDestinationBinding()
  if (existingBinding) {
    if (existingBinding.canonicalDestinationFingerprint !==
        candidate.canonicalDestinationFingerprint) {
      throw new Error("CANONICAL_US_SHIPPING_PROFILE_MISMATCH")
    }
    return { contractVersion: AUTO_BIND_CONTRACT, success: true,
      canonicalDestinationBound: true, canonicalDestinationMatch: true,
      operation: "VALIDATE_EXISTING_CANONICAL_DESTINATION",
      binding: existingBinding }
  }
  const binding = Object.freeze({ ...candidate,
    boundAt: new Date().toISOString() })
  emitRuntimeTrace("BIND_CHECKOUT_MARKERS_VERIFIED")
  emitRuntimeTrace("CANONICAL_FINGERPRINT_COMPUTED")
  await writeDestinationBinding(binding)
  emitRuntimeTrace("CANONICAL_FINGERPRINT_WRITE_COMPLETE")
  let readback
  try {
    readback = await readDestinationBinding()
  } catch {
    throw new Error("BIND_STORAGE_READBACK_FAILED")
  }
  if (!readback || readback.fingerprintVersion !== binding.fingerprintVersion ||
      readback.countryClass !== binding.countryClass ||
      readback.canonicalDestinationFingerprint !==
        binding.canonicalDestinationFingerprint) {
    throw new Error("BIND_STORAGE_READBACK_MISMATCH")
  }
  emitRuntimeTrace("CANONICAL_FINGERPRINT_READBACK_VERIFIED")
  emitRuntimeTrace("CANONICAL_DESTINATION_MATCH")
  emitRuntimeTrace("CANONICAL_BIND_COMPLETED")
  return { contractVersion: AUTO_BIND_CONTRACT, success: true,
    canonicalDestinationBound: true, canonicalDestinationMatch: true,
    operation: "AUTO_BIND_CANONICAL_DESTINATION", binding: readback }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(tabId)) {
      reject(new Error("BIND_CHECKOUT_TAB_ID_INVALID"))
      return
    }
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("CHECKOUT_CONTENT_SCRIPT_NOT_AVAILABLE"))
        return
      }
      resolve(response)
    })
  })
}

function queryTabs(queryInfo) {
  return new Promise((resolve, reject) => chrome.tabs.query(queryInfo, (tabs) => {
    if (chrome.runtime.lastError) {
      reject(new Error("CANONICAL_BINDING_CHECKOUT_TAB_DISCOVERY_FAILED"))
      return
    }
    resolve(Array.isArray(tabs) ? tabs : [])
  }))
}

async function queryAccessibleTabIds() {
  const tabs = await queryTabs({})
  if (tabs.length > MAX_BIND_DISCOVERY_TABS) {
    throw new Error("BIND_TAB_ENUMERATION_LIMIT_EXCEEDED")
  }
  return {
    totalCount: tabs.length,
    tabs: tabs.filter((tab) => Number.isInteger(tab?.id))
      .map((tab) => ({ id: tab.id })),
  }
}

function safeEligibilityResponse(value) {
  const fields = ["eligible", "checkoutPageDetected",
    "shipToMarker", "shippingMarker", "subtotalMarker", "totalMarker",
    "payNowMarker"]
  if (!value || typeof value !== "object" ||
      value.contractVersion !== BIND_ELIGIBILITY_CONTRACT ||
      value.checkoutHostClassification !== "SHOP_PAY_CHECKOUT_HOST" ||
      fields.some((field) => typeof value[field] !== "boolean")) return null
  return Object.freeze({ contractVersion: value.contractVersion,
    checkoutHostClassification: value.checkoutHostClassification,
    ...Object.fromEntries(fields.map((field) => [field, value[field]])) })
}

async function probeBindingCapability(tabId) {
  try {
    const response = await boundedBindStep(sendTabMessage(tabId, {
      type: BIND_ELIGIBILITY_PROBE,
      contractVersion: BIND_ELIGIBILITY_CONTRACT,
    }), "BIND_CHECKOUT_TAB_ELIGIBILITY", BIND_TOP_FRAME_TIMEOUT_MS)
    const safe = safeEligibilityResponse(response)
    return { id: tabId, responded: response !== undefined,
      responder: Boolean(safe), probeError: !safe,
      eligible: Boolean(safe) && safe.eligible && safe.checkoutPageDetected &&
      safe.checkoutHostClassification === "SHOP_PAY_CHECKOUT_HOST" &&
      safe.shipToMarker && safe.shippingMarker && safe.subtotalMarker &&
      safe.totalMarker && safe.payNowMarker }
  } catch {
    return { id: tabId, responded: false, responder: false,
      probeError: true, eligible: false }
  }
}

async function requestDestinationOperationFromTab(tabId, message) {
  try {
    return await boundedBindStep(sendTabMessage(tabId, message),
      "BIND_CONTENT_SCRIPT_RESPONSE", BIND_CONTENT_RESPONSE_TIMEOUT_MS)
  } catch (error) {
    if (error instanceof Error && new Set([
      "CHECKOUT_CONTENT_SCRIPT_NOT_AVAILABLE",
      "BIND_TIMEOUT:BIND_CONTENT_SCRIPT_RESPONSE",
    ]).has(error.message)) {
      throw new Error("BIND_CONTENT_SCRIPT_NOT_RESPONDING")
    }
    throw error
  }
}

function safeBindingExecutionResponse(value, validating) {
  const markers = value?.safeMarkerBooleans
  const markerFields = ["shipTo", "shipping", "subtotal", "total", "payNow"]
  if (!value || typeof value !== "object" ||
      value.contractVersion !== BIND_EXECUTION_CONTRACT ||
      value.success !== true || value.fingerprintVersion !==
        DESTINATION_FINGERPRINT_VERSION || value.countryClass !== "US" ||
      !/^sha256:[0-9a-f]{64}$/.test(value.fingerprint ?? "") ||
      !markers || markerFields.some((field) => markers[field] !== true) ||
      (validating && value.canonicalDestinationMatch !== true)) return null
  return Object.freeze({ fingerprint: value.fingerprint,
    fingerprintVersion: value.fingerprintVersion, countryClass: "US",
    canonicalDestinationMatch: value.canonicalDestinationMatch === true })
}

async function discoverCanonicalBindingCheckoutTab() {
  emitRuntimeTrace("BIND_SHOP_APP_TAB_DISCOVERY_STARTED")
  emitRuntimeTrace("BIND_EXISTING_CHECKOUT_SEARCH_STARTED")
  const discovery = await boundedBindStep(queryAccessibleTabIds(),
    "BIND_SHOP_APP_TAB_DISCOVERY_STARTED")
  const checkoutTabs = discovery.tabs
  const probedTabs = await Promise.all(checkoutTabs.map(({ id }) =>
    probeBindingCapability(id)))
  const responderTabs = probedTabs.filter((tab) => tab.responder)
  const eligibleTabs = probedTabs.filter((tab) => tab.eligible)
  const responseTabs = probedTabs.filter((tab) => tab.responded)
  const errorTabs = probedTabs.filter((tab) => tab.probeError)
  emitRuntimeTrace("BIND_SHOP_APP_TAB_DISCOVERY_RESULT", true, "NONE", {
    tabsQueryTotalCount: discovery.totalCount,
    tabsEnumeratedCount: checkoutTabs.length,
    shopAppProbedCount: probedTabs.length,
    contentScriptResponderCount: responderTabs.length,
    eligibleCheckoutCount: eligibleTabs.length,
    probeAttemptCount: probedTabs.length,
    probeResponseCount: responseTabs.length,
    eligibleResponseCount: eligibleTabs.length,
    probeErrorCount: errorTabs.length,
    bindCheckoutDiscoveryValidCount: eligibleTabs.length,
  })
  if (!eligibleTabs.length) {
    return null
  }
  if (eligibleTabs.length > 1) {
    throw new Error("MULTIPLE_BIND_CHECKOUT_TABS_FOUND")
  }
  const [{ id: checkoutTabId }] = eligibleTabs
  emitRuntimeTrace("BIND_SHOP_APP_TAB_SELECTED")
  return checkoutTabId
}

async function bindCanonicalDestination(existingBinding, checkoutTabId) {
  if (!Number.isInteger(checkoutTabId)) {
    throw new Error("BIND_CHECKOUT_TAB_SELECTION_INVALID")
  }
  const message = { type: BIND_CANONICAL_DESTINATION_EXECUTE,
    contractVersion: BIND_EXECUTION_CONTRACT,
    operation: existingBinding ? "VALIDATE" : "BIND",
    ...(existingBinding ? { binding: existingBinding } : {}) }
  emitRuntimeTrace("BIND_TOP_FRAME_EXECUTION_STARTED")
  const response = await requestDestinationOperationFromTab(
    checkoutTabId, message)
  if (response?.success !== true) {
    throw new Error(safeRuntimeReason(response?.error ??
      "BIND_EXECUTE_SCRIPT_RESULT_NOT_RETURNED"))
  }
  const safeExecution = safeBindingExecutionResponse(response,
    Boolean(existingBinding))
  if (!safeExecution) throw new Error("BIND_CHECKOUT_MARKERS_INVALID")
  emitRuntimeTrace("BIND_CHECKOUT_MARKERS_VERIFIED")
  emitRuntimeTrace("BIND_SHIP_TO_DETECTED")
  const candidate = existingBinding ?? safeDestinationCandidate({
    canonicalDestinationFingerprint: safeExecution.fingerprint,
    fingerprintVersion: safeExecution.fingerprintVersion,
    countryClass: safeExecution.countryClass,
  })
  if (!candidate) throw new Error("BIND_SHIP_TO_NOT_FOUND")
  emitRuntimeTrace("BIND_SHIP_TO_AVAILABLE")
  emitRuntimeTrace("CANONICAL_FINGERPRINT_COMPUTED")
  const binding = existingBinding ?? Object.freeze({ ...candidate,
    boundAt: new Date().toISOString() })
  if (!existingBinding) {
    emitRuntimeTrace("CANONICAL_FINGERPRINT_WRITE_STARTED")
    await boundedBindStep(writeDestinationBinding(binding),
      "CANONICAL_FINGERPRINT_WRITE_STARTED")
    emitRuntimeTrace("CANONICAL_FINGERPRINT_WRITE_COMPLETE")
  }
  const readback = await boundedBindStep(readDestinationBinding(),
    "CANONICAL_FINGERPRINT_READBACK_VERIFIED")
  if (!readback ||
      readback.canonicalDestinationFingerprint !==
        binding.canonicalDestinationFingerprint) {
    throw new Error("BIND_STORAGE_READBACK_MISMATCH")
  }
  emitRuntimeTrace("CANONICAL_FINGERPRINT_READBACK_VERIFIED")
  emitRuntimeTrace("CANONICAL_DESTINATION_MATCH")
  emitRuntimeTrace("CANONICAL_BIND_COMPLETED")
  return { type: DESTINATION_BINDING_RESULT, success: true,
    canonicalDestinationBound: true, canonicalDestinationMatch: true,
    canonicalUsProfileFound: true, shippingAddressAccepted: true,
    operation: existingBinding ? "VALIDATE_CANONICAL_DESTINATION"
      : "BIND_CANONICAL_DESTINATION" }
}

async function bootstrapCanonicalDestinationCheckout(bootstrapJob) {
  const invalidReason = jobValidationReason(bootstrapJob)
  if (invalidReason) throw new Error("BIND_BOOTSTRAP_JOB_INVALID")
  if (activeJob) throw new Error("BIND_BOOTSTRAP_ACTIVE_JOB_CONFLICT")
  canonicalBindBootstrapActive = true
  canonicalBindBootstrapTraceStates = new Set()
  canonicalBindBootstrapAttempted = true
  const checkoutReady = waitForCanonicalBindCheckout()
  try {
    const startJobPromise = startJob(bootstrapJob, false, true)
    emitRuntimeTrace("BIND_START_JOB_INVOKED", true, "NONE", {
      bindCheckoutBootstrapRequired: true,
      bindCheckoutBootstrapAttempted: true,
      bindStartJobInvoked: true,
    })
    await startJobPromise
    emitBindBootstrapTraceOnce("BIND_BOOTSTRAP_PRODUCT_OPENED")
    await checkoutReady
  } catch (error) {
    settleCanonicalBindCheckout(error instanceof Error ? error
      : new Error("BIND_CHECKOUT_BOOTSTRAP_FAILED"))
    await checkoutReady.catch(() => {})
    throw error
  }
  const checkoutTabId = await discoverCanonicalBindingCheckoutTab()
  if (!Number.isInteger(checkoutTabId)) {
    if (!canonicalBindBootstrapAttempted) {
      throw new Error("BIND_CHECKOUT_BOOTSTRAP_INVARIANT_VIOLATION")
    }
    throw new Error("BIND_CHECKOUT_TAB_NOT_FOUND")
  }
  emitBindBootstrapTraceOnce("BIND_BOOTSTRAP_CHECKOUT_DETECTED")
  return checkoutTabId
}

async function handleCanonicalDestinationBinding(port, bootstrapJob) {
  if (canonicalBindInFlight) {
    try {
      port.postMessage({ type: DESTINATION_BINDING_RESULT, success: false,
        canonicalDestinationBound: false, canonicalDestinationMatch: false,
        error: "BIND_ALREADY_IN_PROGRESS" })
    } catch { /* The caller bridge is already unavailable. */ }
    return
  }
  canonicalBindInFlight = true
  canonicalBindBootstrapAttempted = false
  let existingBinding = null
  let bootstrapStarted = false
  let bindingResponse = null
  try {
    await beginRuntimeTrace(crypto.randomUUID(), null)
    emitRuntimeTrace("CANONICAL_BIND_REQUESTED")
    emitRuntimeTrace("BIND_REQUEST_ACCEPTED")
    existingBinding = await boundedBindStep(readDestinationBinding(),
      "CANONICAL_BIND_REQUESTED")
    let checkoutTabId = await discoverCanonicalBindingCheckoutTab()
    if (Number.isInteger(checkoutTabId)) {
      emitRuntimeTrace("BIND_EXISTING_CHECKOUT_FOUND")
    } else {
      emitRuntimeTrace("BIND_CHECKOUT_BOOTSTRAP_REQUIRED", true, "NONE", {
        bindCheckoutBootstrapRequired: true,
        bindCheckoutBootstrapAttempted: false,
        bindStartJobInvoked: false,
      })
      bootstrapStarted = true
      checkoutTabId = await bootstrapCanonicalDestinationCheckout(bootstrapJob)
    }
    bindingResponse = await bindCanonicalDestination(existingBinding,
      checkoutTabId)
  } catch (error) {
    emitRuntimeTrace("FAIL", false, error instanceof Error ? error.message
      : "CANONICAL_US_PROFILE_VALIDATION_UNAVAILABLE")
    try {
      port.postMessage({ type: DESTINATION_BINDING_RESULT, success: false,
        canonicalDestinationBound: Boolean(existingBinding),
        canonicalDestinationMatch: false,
        error: safeRuntimeReason(error instanceof Error ? error.message
          : "CANONICAL_US_PROFILE_VALIDATION_UNAVAILABLE") })
    } catch {
      emitRuntimeTrace("FAIL", false, "BIND_ACK_FAILED")
    }
  } finally {
    if (bindingResponse) finalizeCanonicalBindRuntime(bootstrapStarted)
    else if (bootstrapStarted) clearActiveJob()
    canonicalBindInFlight = false
  }
  if (!bindingResponse) return
  emitRuntimeTrace("PASS")
  try {
    port.postMessage(bindingResponse)
  } catch {
    emitRuntimeTrace("FAIL", false, "BIND_ACK_FAILED")
  } finally {
    activeRuntimeTrace = null
  }
}

function emitProgress(state, details = {}) {
  if (!sellerPort || !activeJob) return
  const rank = CHECKOUT_STATE_RANK.get(state) ?? 0
  if (rank && (rank < lastCheckoutStateRank ||
      (rank === lastCheckoutStateRank && state !== lastCheckoutState))) return
  if (rank) {
    lastCheckoutStateRank = rank
    lastCheckoutState = state
  }
  lastRuntimeState = state
  traceProgress(state, details)
  const markerDetails = {}
  for (const field of ["shopPayMarkerOrderSummary", "shopPayMarkerProduct",
    "shopPayMarkerQuantity", "shopPayMarkerShipTo", "shopPayMarkerShipping",
    "shopPayMarkerSubtotal", "shopPayMarkerShippingAmount",
    "shopPayMarkerTotal", "shopPayMarkerShippingMethod",
    "shopPayMarkerPayment", "shopPayMarkerPayNow", "subtotalLabelFound",
    "subtotalAmountCandidateFound", "subtotalCurrencyFound", "subtotalParsed",
    "shippingLabelFound", "shippingAmountCandidateFound",
    "shippingCurrencyFound", "shippingParsed", "totalLabelFound",
    "totalAmountCandidateFound", "totalCurrencyFound", "totalParsed"]) {
    if (typeof details[field] === "boolean") markerDetails[field] = details[field]
  }
  sellerPort.postMessage({ type: JOB_PROGRESS, state,
    candidateId: activeJob.identity.candidateId,
    ...(Number.isFinite(details.cartSubtotalUsd) &&
      details.cartSubtotalUsd >= 0 && details.cartSubtotalUsd <= 100_000
      ? { cartSubtotalUsd: Math.round(details.cartSubtotalUsd * 100) / 100 }
      : {}),
    ...(traceMoney(details.subtotalUsd) !== null
      ? { subtotalUsd: traceMoney(details.subtotalUsd) } : {}),
    ...(traceMoney(details.shippingUsd) !== null
      ? { shippingUsd: traceMoney(details.shippingUsd) } : {}),
    ...(traceMoney(details.totalUsd) !== null
      ? { totalUsd: traceMoney(details.totalUsd) } : {}),
    ...(new Set(["LUNA_STOREFRONT_CHECKOUT_HOST", "LUNA_ACCOUNT_HOST",
      "SHOP_PAY_CHECKOUT_HOST",
      "UNSUPPORTED_CHECKOUT_HOST"]).has(details.checkoutHostClassification)
      ? { checkoutHostClassification: details.checkoutHostClassification } : {}),
    ...(safeNavigationIdentity(`https://${details.checkoutNavigationHost}`)
      ? { checkoutNavigationHost: details.checkoutNavigationHost } : {}),
    ...(safeNavigationIdentity(details.checkoutNavigationOrigin)
      ? { checkoutNavigationOrigin: details.checkoutNavigationOrigin } : {}),
    ...(typeof details.checkoutHostPermissionMatch === "boolean"
      ? { checkoutHostPermissionMatch: details.checkoutHostPermissionMatch } : {}),
    ...(Number.isInteger(details.checkoutInjectionFrameId) &&
      details.checkoutInjectionFrameId === 0
      ? { checkoutInjectionFrameId: details.checkoutInjectionFrameId } : {}),
    ...(typeof details.checkoutScriptBootstrapAck === "boolean"
      ? { checkoutScriptBootstrapAck: details.checkoutScriptBootstrapAck } : {}),
    ...(new Set(["PENDING", "INJECTION_API_ERROR", "WRONG_FRAME_TARGET",
      "CHECKOUT_CONTENT_SCRIPT_BOOTSTRAP_NOT_ACKNOWLEDGED"])
      .has(details.checkoutScriptBootstrapErrorCode)
      ? { checkoutScriptBootstrapErrorCode:
          details.checkoutScriptBootstrapErrorCode } : {}),
    ...(new Set(["NORMAL_CHECKOUT_WITH_SHIPPING", "UNKNOWN_CHECKOUT_PAGE"])
      .has(details.checkoutPageClassification)
      ? { checkoutPageClassification: details.checkoutPageClassification } : {}),
    ...(new Set(["EXPLICIT_CHALLENGE_UI", "EXPLICIT_LOGIN_REQUIRED",
      "SESSION_EXPIRED_UI", "NO_EXPLICIT_AUTH_REQUIREMENT"])
      .has(details.authSignal) ? { authSignal: details.authSignal } : {}),
    ...(details.authSignalSource === "FIXED_HOST_PATH_AND_VISIBLE_DOM"
      ? { authSignalSource: details.authSignalSource } : {}),
    ...markerDetails })
}

async function startJob(job, productionAutoClaim = false,
  preserveRuntimeTrace = false) {
  const invalidReason = jobValidationReason(job)
  if (invalidReason) throw new Error(invalidReason)
  const exact = safeJob(job)
  const url = exact && exactLunaUrl(exact.identity.canonicalProductUrl)
  if (!exact || !url) throw new Error("JOB_IDENTITY_MISMATCH:identity.canonicalProductUrl")
  if (activeJob) {
    if (sameJob(activeJob, exact)) return false
    throw new Error("LUNA_SHIPPING_JOB_ALREADY_RUNNING")
  }
  activeJob = exact
  initializeCheckoutNavigationObserver(exact)
  if (!preserveRuntimeTrace) {
    await beginRuntimeTrace(exact.captureSessionId, exact.identity.candidateId)
  }
  if (productionAutoClaim === true) {
    emitRuntimeTrace("PRODUCTION_OBSERVER_REARMED")
    emitRuntimeTrace("PRODUCTION_WORKER_READY")
    emitRuntimeTrace("INITIAL_AUTO_CLAIM_STARTED")
    emitRuntimeTrace("ELIGIBLE_JOB_FOUND")
    emitRuntimeTrace("PRODUCTION_JOB_CLAIMED")
    emitRuntimeTrace("PRODUCTION_JOB_DISPATCHED")
  }
  emitRuntimeTrace("BRIDGE_CONNECTED")
  emitRuntimeTrace("JOB_DISPATCHED")
  activeJobPhase = "PRODUCT_PAGE"
  originalCartSnapshot = null
  cartSubtotalUsd = null
  checkoutNavigationArmed = false
  checkoutNavigationTriggered = false
  checkoutInjectionStarted = false
  checkoutBootstrapAckReceived = false
  checkoutBootstrapAckEmitted = false
  if (checkoutBootstrapAckTimer) clearTimeout(checkoutBootstrapAckTimer)
  checkoutBootstrapAckTimer = null
  lastCheckoutStateRank = 0
  lastCheckoutState = null
  lastRuntimeState = "CANARY_DISPATCHED"
  url.hash = `seller-os-luna-shipping-v1=${encodeJob(exact)}`
  if (activeTabId === null) {
    const tab = await chrome.tabs.create({ url: url.toString(), active: true })
    if (!Number.isInteger(tab.id)) throw new Error("LUNA_SHIPPING_TAB_UNAVAILABLE")
    activeTabId = tab.id
  } else {
    await chrome.tabs.update(activeTabId, { url: url.toString(), active: true })
  }
  return true
}

function failActiveJob(error) {
  if (!activeJob) return
  emitRuntimeTrace("FAIL", false, safeRuntimeReason(error))
  sellerPort?.postMessage({ type: JOB_RESULT, success: false,
    error: safeRuntimeReason(error), lastRuntimeState,
    capture: { candidateId: activeJob.identity.candidateId } })
  clearActiveJob()
}

function failBindingBootstrapOrActiveJob(error) {
  if (canonicalBindBootstrapActive) {
    settleCanonicalBindCheckout(new Error(safeRuntimeReason(error)))
    return
  }
  failActiveJob(error)
}

function failObservedDisallowedCheckout(observed, allowed) {
  if (!observed || allowed || !checkoutNavigationObservation?.observed ||
      checkoutNavigationObservation.origin !== observed.origin) return false
  failBindingBootstrapOrActiveJob("REAL_CHECKOUT_HOST_NOT_ALLOWLISTED")
  return true
}

function emitCheckoutBootstrapAck() {
  if (!activeJob || !checkoutInjectionStarted ||
      !checkoutBootstrapAckReceived || checkoutBootstrapAckEmitted) return
  checkoutBootstrapAckEmitted = true
  if (checkoutBootstrapAckTimer) clearTimeout(checkoutBootstrapAckTimer)
  checkoutBootstrapAckTimer = null
  emitProgress("CHECKOUT_SCRIPT_BOOTSTRAP_ACK", {
    checkoutInjectionFrameId: 0, checkoutScriptBootstrapAck: true,
  })
  emitProgress("CHECKOUT_CONTENT_SCRIPT_LOADED", {
    checkoutInjectionFrameId: 0, checkoutScriptBootstrapAck: true,
  })
}

function observeCheckoutNavigation(details, inject) {
  if (!activeJob || activeJobPhase !== CHECKOUT_PHASE ||
      !checkoutNavigationArmed || !checkoutNavigationTriggered ||
      !Array.isArray(originalCartSnapshot) ||
      !Number.isFinite(cartSubtotalUsd) ||
      details?.tabId !== activeTabId || details?.frameId !== 0) return
  if (!checkoutNavigationObservation?.armed ||
      checkoutNavigationObservation.captureSessionId !==
        activeJob.captureSessionId) return
  if (isPreNavigationCartDocument(details.url)) return
  const observed = safeNavigationIdentity(details.url)
  if (!observed) return
  const allowed = allowedCheckoutNavigation(details.url)
  const firstObservation = !checkoutNavigationObservation.observed
  if (firstObservation) {
    checkoutNavigationObservation.observed = true
    checkoutNavigationObservation.tabId = details.tabId
    checkoutNavigationObservation.host = observed.host
    checkoutNavigationObservation.origin = observed.origin
    if (checkoutNavigationObservationTimer) {
      clearTimeout(checkoutNavigationObservationTimer)
      checkoutNavigationObservationTimer = null
    }
  } else if (checkoutNavigationObservation.tabId !== details.tabId) {
    return
  } else if (checkoutNavigationObservation.host !== observed.host) {
    checkoutNavigationObservation.host = observed.host
    checkoutNavigationObservation.origin = observed.origin
    failObservedDisallowedCheckout(observed, allowed)
    return
  }
  if (!inject && !checkoutBootstrapAckReceived) {
    lastCheckoutStateRank = CHECKOUT_STATE_RANK.get(CHECKOUT_PHASE) ?? 0
    lastCheckoutState = CHECKOUT_PHASE
  }
  if (firstObservation) {
    emitProgress("CHECKOUT_NAVIGATION_OBSERVED", {
      checkoutNavigationHost: observed.host,
      checkoutNavigationOrigin: observed.origin,
      checkoutHostPermissionMatch: Boolean(allowed),
    })
    emitBindBootstrapTraceOnce("BIND_BOOTSTRAP_CHECKOUT_NAVIGATION_OBSERVED")
  }
  if (!allowed) {
    failObservedDisallowedCheckout(observed, allowed)
    return
  }
  emitProgress("CHECKOUT_HOST_ALLOWED", {
    checkoutNavigationHost: allowed.host,
    checkoutNavigationOrigin: allowed.origin,
    checkoutHostPermissionMatch: true,
  })
  if (!inject && !checkoutBootstrapAckReceived) {
    checkoutInjectionStarted = false
    checkoutBootstrapAckReceived = false
    checkoutBootstrapAckEmitted = false
    if (checkoutBootstrapAckTimer) clearTimeout(checkoutBootstrapAckTimer)
    checkoutBootstrapAckTimer = null
    return
  }
  if (checkoutInjectionStarted) return
  checkoutInjectionStarted = true
  emitProgress("CHECKOUT_INJECTION_REQUESTED", {
    checkoutInjectionFrameId: 0, checkoutScriptBootstrapAck: false,
    checkoutScriptBootstrapErrorCode: "PENDING",
  })
  if (checkoutBootstrapAckReceived) {
    emitCheckoutBootstrapAck()
    return
  }
  checkoutBootstrapAckTimer = setTimeout(() => {
    checkoutBootstrapAckTimer = null
    failBindingBootstrapOrActiveJob(
      "CHECKOUT_CONTENT_SCRIPT_BOOTSTRAP_NOT_ACKNOWLEDGED")
  }, CHECKOUT_BOOTSTRAP_ACK_TIMEOUT_MS)
}

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.runtime.id !== EXACT_EXTENSION_ID) return
  void chrome.tabs.create({ url: `${CONTROL_PAGE}?bridgeOnly=1`, active: true })
})

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message?.type !== EXTENSION_PING || !safeSellerSender(sender) ||
      chrome.runtime.id !== EXACT_EXTENSION_ID ||
      !effectiveShopAppContract()) return false
  sendResponse({
    type: EXTENSION_READY,
    extensionId: EXACT_EXTENSION_ID,
    extensionVersion: chrome.runtime.getManifest().version,
    extensionBuildVersion: EXTENSION_BUILD_VERSION,
    shopAppManifestPermission: true,
    shopAppContentScriptMatch: true,
    shopAppRuntimeAllowlist: true,
    shopAppCheckoutHostClassification: true,
    sellerOsOriginValidated: true,
  })
  return false
})

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== PORT_NAME || !safeSellerSender(port.sender) || sellerPort) {
    port.disconnect()
    return
  }
  if (disconnectCleanupTimer) {
    clearTimeout(disconnectCleanupTimer)
    disconnectCleanupTimer = null
  }
  sellerPort = port
  for (const event of activeRuntimeTrace?.events ?? []) {
    port.postMessage({ type: RUNTIME_TRACE_EVENT, event })
  }
  port.onMessage.addListener((message) => {
    if (message?.type === GET_BINDING_STORAGE_DIAGNOSTIC) {
      void bindingStorageDiagnostic().then((diagnostic) =>
        port.postMessage(diagnostic))
      return
    }
    if (message?.type === GET_CANONICAL_DESTINATION_STATUS) {
      void readDestinationBinding().then((binding) => port.postMessage({
        type: CANONICAL_DESTINATION_STATUS,
        canonicalDestinationBound: Boolean(binding),
        canonicalDestinationMatch: false,
        bindingStatus: binding ? "BINDING_PRESENT_VALID" : "NO_BINDING_PRESENT",
      })).catch((error) => port.postMessage({
        type: CANONICAL_DESTINATION_STATUS,
        error: safeRuntimeReason(error instanceof Error ? error.message
          : "BINDING_STORAGE_READ_FAILED"),
      }))
      return
    }
    if (message?.type === "SELLER_OS_BIND_LUNA_CANONICAL_DESTINATION") {
      void handleCanonicalDestinationBinding(port, message.bootstrapJob)
      return
    }
    if (message?.type === GET_ACTIVE_PRODUCTION_JOB_STATUS) {
      port.postMessage({ type: ACTIVE_PRODUCTION_JOB_STATUS,
        active: Boolean(activeJob),
        ...(activeJob ? { job: activeJob, phase: activeJobPhase } : {}) })
      return
    }
    if (message?.type === "START_SHIPPING_JOB") {
      void startJob(message.job, message.productionAutoClaim === true)
        .catch((error) => port.postMessage({
        type: JOB_RESULT, success: false,
        error: error instanceof Error ? error.message : "LUNA_SHIPPING_JOB_FAILED",
        capture: { candidateId: message.job?.identity?.candidateId ?? null },
      }))
      return
    }
    if (message?.type === SHIPPING_SERVER_RESULT) {
      if (!activeJob || message.candidateId !== activeJob.identity.candidateId) {
        return
      }
      if (message.success !== true) {
        failActiveJob(typeof message.reasonCode === "string"
          ? message.reasonCode : "LUNA_SHIPPING_CAPTURE_SERVER_RESULT_FAILED")
        return
      }
      if (message.terminalDecision === "REJECT_STOCK") {
        emitRuntimeTrace("STOCK_EVIDENCE_RECONCILED", true, "NONE", {
          productOosConfirmed: true,
          productPageStockStatus: "FRESH_OUT_OF_STOCK",
        })
        emitRuntimeTrace("REJECTED_STOCK")
        emitRuntimeTrace("PRODUCTION_JOB_COMPLETED")
        emitRuntimeTrace("AUTO_NEXT")
        emitRuntimeTrace("PASS")
        clearActiveJob()
        return
      }
      const safeDetails = { subtotalUsd: message.subtotalUsd,
        shippingUsd: message.shippingUsd, totalUsd: message.totalUsd }
      emitRuntimeTrace("CAPTURE_POST", true, "NONE", safeDetails)
      emitRuntimeTrace("DURABLE_READBACK", true, "NONE", safeDetails)
      emitRuntimeTrace("ECONOMICS_EVALUATED", true, "NONE", safeDetails)
      emitRuntimeTrace("PASS", true, "NONE", safeDetails)
      clearActiveJob()
      return
    }
    if (message?.type !== RESUME_ACTIVE_JOB) return
    const invalidReason = jobValidationReason(message.job)
    if (invalidReason || (activeJob && !sameJob(activeJob, message.job))) {
      port.postMessage({ type: JOB_RESULT, success: false,
        error: invalidReason ?? "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED",
        capture: { candidateId: message.job?.identity?.candidateId ?? null } })
      return
    }
    activeJob = message.job
    activeJobPhase = new Set([CART_PHASE, CHECKOUT_PHASE]).has(message.phase)
      ? message.phase : "PRODUCT_PAGE"
    emitProgress("BRIDGE_RECONNECTED")
  })
  port.onDisconnect.addListener(() => {
    if (sellerPort !== port) return
    sellerPort = null
    if (!activeJob) return
    disconnectCleanupTimer = setTimeout(() => {
      if (!sellerPort) clearActiveJob()
      disconnectCleanupTimer = null
    }, RECONNECT_GRACE_MS)
  })
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === GET_CANONICAL_DESTINATION_BINDING) {
    const recovered = recoverActiveJob(sender)
    if (!recovered || activeJobPhase !== CHECKOUT_PHASE ||
        message.captureSessionId !== activeJob.captureSessionId) {
      sendResponse({ accepted: false,
        error: "ACTIVE_JOB_CHECKOUT_CONTINUITY_UNPROVEN" })
      return false
    }
    void readDestinationBinding().then((binding) => sendResponse({
      accepted: true,
      bindingStatus: binding ? "BINDING_PRESENT_VALID" : "NO_BINDING_PRESENT",
      ...(binding ? { binding } : {}),
    })).catch((error) => sendResponse({ accepted: false,
      error: safeRuntimeReason(error instanceof Error ? error.message
        : "BINDING_STORAGE_READ_FAILED") }))
    return true
  }
  if (message?.type === AUTO_BIND_CANONICAL_DESTINATION) {
    const recovered = sender.frameId === 0 && recoverActiveJob(sender)
    if (!recovered || activeJobPhase !== CHECKOUT_PHASE ||
        message.captureSessionId !== activeJob.captureSessionId) {
      sendResponse({ contractVersion: AUTO_BIND_CONTRACT, success: false,
        error: "ACTIVE_JOB_CHECKOUT_CONTINUITY_UNPROVEN" })
      return false
    }
    void autoBindCanonicalDestination(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ contractVersion: AUTO_BIND_CONTRACT,
        success: false, error: safeRuntimeReason(error instanceof Error
          ? error.message : "CANONICAL_DESTINATION_AUTO_BIND_FAILED") }))
    return true
  }
  if (message?.type === CHECKOUT_BOOTSTRAP_ACK) {
    if (message.extensionBuildVersion !== EXTENSION_BUILD_VERSION) {
      sendResponse({ accepted: false,
        error: "EXTENSION_ARTIFACT_VERSION_MISMATCH" })
      return false
    }
    const recovered = sender.frameId === 0 && recoverActiveJob(sender)
    if (!recovered || activeJobPhase !== CHECKOUT_PHASE ||
        !checkoutNavigationArmed) {
      sendResponse({ accepted: false, error: sender.frameId === 0
        ? "ACTIVE_JOB_CHECKOUT_CONTINUITY_UNPROVEN" : "WRONG_FRAME_TARGET" })
      return false
    }
    observeCheckoutNavigation({ tabId: sender.tab.id, frameId: 0,
      url: sender.url }, true)
    if (!checkoutNavigationObservation?.observed) {
      sendResponse({ accepted: false,
        error: "CHECKOUT_NAVIGATION_NOT_OBSERVED" })
      return false
    }
    checkoutBootstrapAckReceived = true
    emitCheckoutBootstrapAck()
    if (canonicalBindBootstrapActive) settleCanonicalBindCheckout()
    sendResponse({ accepted: true, captureSessionId: activeJob.captureSessionId })
    return false
  }
  if (message?.type === GET_ACTIVE_JOB) {
    const recovered = recoverActiveJob(sender)
    if (!recovered) {
      sendResponse({ accepted: false,
        error: "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED" })
      return false
    }
    emitProgress("ACTIVE_JOB_REQUESTED")
    sendResponse({ accepted: true, job: recovered, phase: activeJobPhase,
      originalCartSnapshot, cartSubtotalUsd,
      bindingBootstrap: canonicalBindBootstrapActive })
    return false
  }
  if (message?.type === SET_ACTIVE_JOB_PHASE) {
    const recovered = recoverActiveJob(sender)
    const startingCart = message.phase === CART_PHASE
    const startingCheckout = message.phase === CHECKOUT_PHASE &&
      activeJobPhase === CART_PHASE && Array.isArray(originalCartSnapshot) &&
      Number.isFinite(message.cartSubtotalUsd) && message.cartSubtotalUsd >= 0 &&
      message.cartSubtotalUsd <= 100_000
    const snapshot = startingCart
      ? safeCartSnapshot(message.originalCartSnapshot) : originalCartSnapshot
    if (!recovered || (!startingCart && !startingCheckout) || !snapshot ||
        message.captureSessionId !== activeJob.captureSessionId) {
      sendResponse({ accepted: false,
        error: "ACTIVE_JOB_CART_CONTINUITY_UNPROVEN" })
      return false
    }
    activeJobPhase = message.phase
    originalCartSnapshot = snapshot
    if (startingCart) {
      checkoutNavigationArmed = false
      checkoutNavigationTriggered = false
    }
    if (startingCheckout) {
      cartSubtotalUsd = Math.round(message.cartSubtotalUsd * 100) / 100
      checkoutNavigationArmed = true
      checkoutNavigationTriggered = false
      if (!armCheckoutNavigationObserver()) {
        sendResponse({ accepted: false,
          error: "CHECKOUT_NAVIGATION_OBSERVER_NOT_ARMED" })
        return false
      }
    }
    emitProgress(activeJobPhase)
    sendResponse({ accepted: true, phase: activeJobPhase })
    return false
  }
  if (message?.type === CHECKOUT_NAVIGATION_TRIGGER) {
    const recovered = recoverActiveJob(sender)
    if (!recovered || activeJobPhase !== CHECKOUT_PHASE ||
        message.captureSessionId !== activeJob.captureSessionId ||
        !markCheckoutNavigationTriggered()) {
      sendResponse({ accepted: false,
        error: "CHECKOUT_NAVIGATION_NOT_TRIGGERED" })
      return false
    }
    sendResponse({ accepted: true,
      captureSessionId: activeJob.captureSessionId })
    return false
  }
  if (message?.type === JOB_RESUME) {
    const invalidReason = jobValidationReason(message.job)
    if (invalidReason || !Number.isInteger(sender.tab?.id) ||
        (activeJob && !sameJob(activeJob, message.job))) {
      sendResponse({ accepted: false,
        error: invalidReason ?? "SERVICE_WORKER_JOB_STATE_NOT_RECOVERED" })
      return false
    }
    activeJob = message.job
    activeTabId = sender.tab.id
    sendResponse({ accepted: true, captureSessionId: activeJob.captureSessionId })
    return false
  }
  if (message?.type === JOB_PROGRESS && recoverActiveJob(sender) &&
      (!message.captureSessionId ||
        message.captureSessionId === activeJob.captureSessionId) &&
      (!message.candidateId ||
        message.candidateId === activeJob.identity.candidateId) &&
      new Set(["CONTENT_SCRIPT_LOADED", "ACTIVE_JOB_REQUESTED",
        "ACTIVE_JOB_RECOVERED", "PRODUCT_PAGE_DOM_READY",
        "AUTH_EXPLICITLY_FAILED", "AUTH_CHALLENGE_PRESENT",
        "AUTH_NOT_YET_REQUIRED", "AUTHENTICATED_OPERATION_CONFIRMED",
        "PRODUCT_IDENTITY_CHECK_STARTED", "PRODUCT_IDENTITY_VERIFIED",
        "PRODUCT_OOS_CONFIRMED",
        "ADD_TO_CART_ELEMENT_FOUND", "ADD_TO_CART_CLICK_DISPATCHED",
        "AWAITING_CART_CONFIRMATION", "ACTIVE_JOB_RECOVERED_ON_CART",
        "CART_PAGE_DETECTED", "CART_EXPECTED_PRODUCT_FOUND",
        "CART_EXPECTED_QUANTITY_FOUND", "CART_MUTATION_CONFIRMED",
        "BRIDGE_RECONNECTED", "SHIPPING_FLOW_RESUMED",
        "AWAITING_CHECKOUT_SHIPPING", "CHECKOUT_NAVIGATION_ARMED",
        "CHECKOUT_NAVIGATION_TRIGGERED", "CHECKOUT_NAVIGATION_TIMEOUT",
        "CHECKOUT_NAVIGATION_OBSERVED",
        "CHECKOUT_HOST_ALLOWED", "CHECKOUT_INJECTION_REQUESTED",
        "CHECKOUT_INJECTION_API_SUCCEEDED", "CHECKOUT_SCRIPT_INJECTED",
        "CHECKOUT_SCRIPT_BOOTSTRAP_ACK",
        "CHECKOUT_CONTENT_SCRIPT_LOADED",
        "ACTIVE_JOB_RECOVERED_ON_CHECKOUT", "CHECKOUT_CLASSIFIER_STARTED",
        "CHECKOUT_HOST_CLASSIFIED", "SHOP_PAY_DOM_WAITING",
        "SHOP_PAY_DOM_READY", "CHECKOUT_PAGE_CLASSIFIED",
        "CHECKOUT_PAGE_DETECTED", "SHOP_PAY_QUOTE_PARSER_STARTED",
        "NORMAL_GUEST_CHECKOUT", "NORMAL_CHECKOUT_WITH_CONTACT_FORM",
        "NORMAL_CHECKOUT_WITH_SHIPPING_FORM", "NORMAL_CHECKOUT_WITH_SHIPPING",
        "EXPLICIT_LOGIN_PAGE",
        "EXPLICIT_AUTH_CHALLENGE", "SESSION_EXPIRED",
        "UNKNOWN_CHECKOUT_PAGE", "CANONICAL_US_PROFILE_FOUND",
        "SHIPPING_ADDRESS_ACCEPTED", "SHIPPING_OPTIONS_DETECTED",
        "SHIPPING_CAPTURE_STARTED", "SHIPPING_QUOTE_CAPTURED",
        "RESULT_POSTED"]).has(message.state)) {
    if (canonicalBindBootstrapActive) {
      if (message.state === "PRODUCT_IDENTITY_VERIFIED") {
        emitBindBootstrapTraceOnce("BIND_BOOTSTRAP_PRODUCT_VERIFIED")
      } else if (message.state === "CART_MUTATION_CONFIRMED") {
        emitBindBootstrapTraceOnce("BIND_BOOTSTRAP_CART_CONFIRMED")
      } else if (message.state === "CHECKOUT_NAVIGATION_OBSERVED") {
        emitBindBootstrapTraceOnce(
          "BIND_BOOTSTRAP_CHECKOUT_NAVIGATION_OBSERVED")
      }
    }
    emitProgress(message.state, { cartSubtotalUsd: message.cartSubtotalUsd,
      subtotalUsd: message.subtotalUsd,
      shippingUsd: message.shippingUsd,
      totalUsd: message.totalUsd,
      checkoutHostClassification: message.checkoutHostClassification,
      checkoutNavigationHost: message.checkoutNavigationHost,
      checkoutNavigationOrigin: message.checkoutNavigationOrigin,
      checkoutHostPermissionMatch: message.checkoutHostPermissionMatch,
      checkoutPageClassification: message.checkoutPageClassification,
      shopPayMarkerOrderSummary: message.shopPayMarkerOrderSummary,
      shopPayMarkerProduct: message.shopPayMarkerProduct,
      shopPayMarkerQuantity: message.shopPayMarkerQuantity,
      shopPayMarkerShipTo: message.shopPayMarkerShipTo,
      shopPayMarkerShipping: message.shopPayMarkerShipping,
      shopPayMarkerSubtotal: message.shopPayMarkerSubtotal,
      shopPayMarkerShippingAmount: message.shopPayMarkerShippingAmount,
      shopPayMarkerTotal: message.shopPayMarkerTotal,
      shopPayMarkerShippingMethod: message.shopPayMarkerShippingMethod,
      shopPayMarkerPayment: message.shopPayMarkerPayment,
      shopPayMarkerPayNow: message.shopPayMarkerPayNow,
      subtotalLabelFound: message.subtotalLabelFound,
      subtotalAmountCandidateFound: message.subtotalAmountCandidateFound,
      subtotalCurrencyFound: message.subtotalCurrencyFound,
      subtotalParsed: message.subtotalParsed,
      shippingLabelFound: message.shippingLabelFound,
      shippingAmountCandidateFound: message.shippingAmountCandidateFound,
      shippingCurrencyFound: message.shippingCurrencyFound,
      shippingParsed: message.shippingParsed,
      totalLabelFound: message.totalLabelFound,
      totalAmountCandidateFound: message.totalAmountCandidateFound,
      totalCurrencyFound: message.totalCurrencyFound,
      totalParsed: message.totalParsed,
      productOosConfirmed: message.productOosConfirmed,
      productPageStockStatus: message.productPageStockStatus,
      authSignal: message.authSignal,
      authSignalSource: message.authSignalSource })
    return false
  }
  if (message?.type === JOB_RUNTIME_FAILURE && recoverActiveJob(sender)) {
    let error = safeRuntimeReason(message.error)
    if (error === "LUNA_UNKNOWN_CHECKOUT_PAGE") {
      if (!checkoutBootstrapAckEmitted) {
        error = "CHECKOUT_CONTENT_SCRIPT_BOOTSTRAP_NOT_ACKNOWLEDGED"
      } else if (lastCheckoutStateRank < 50) {
        error = "ACTIVE_JOB_CHECKOUT_CONTINUITY_UNPROVEN"
      } else if (lastCheckoutStateRank < 60) {
        error = "CHECKOUT_CLASSIFIER_NOT_STARTED"
      } else if (lastCheckoutStateRank < 70) {
        error = "CHECKOUT_HOST_NOT_CLASSIFIED"
      }
    }
    if (canonicalBindBootstrapActive) {
      settleCanonicalBindCheckout(new Error(error))
    } else {
      failActiveJob(error)
    }
    return false
  }
  if (message?.type !== JOB_RESULT || !sellerPort ||
      sender.tab?.id !== activeTabId || !activeJob) return false
  const capture = message.capture && typeof message.capture === "object"
    ? message.capture : {}
  if (capture.candidateId !== activeJob.identity.candidateId ||
      capture.captureSessionId !== activeJob.captureSessionId ||
      capture.nonce !== activeJob.nonce) return false
  sellerPort.postMessage({ type: JOB_RESULT,
    success: message.success === true,
    ...(message.success === true ? { capture,
      ...(message.terminalDecision === "REJECT_STOCK" &&
        capture.productOosConfirmed === true &&
        capture.productPageStockStatus === "FRESH_OUT_OF_STOCK"
        ? { terminalDecision: "REJECT_STOCK" } : {}) }
      : { error: typeof message.error === "string"
        ? safeRuntimeReason(message.error) : "LUNA_SHIPPING_JOB_FAILED",
        lastRuntimeState, capture }) })
  if (message.success !== true) {
    emitRuntimeTrace("FAIL", false, typeof message.error === "string"
      ? safeRuntimeReason(message.error) : "LUNA_SHIPPING_JOB_FAILED")
    clearActiveJob()
  }
  return false
})

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    activeTabId = null
    clearActiveJob()
  }
})

chrome.webNavigation?.onCommitted?.addListener((details) => {
  observeCheckoutNavigation(details, false)
})

chrome.webNavigation?.onCompleted?.addListener((details) => {
  observeCheckoutNavigation(details, true)
})
