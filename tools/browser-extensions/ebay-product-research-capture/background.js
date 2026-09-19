"use strict"

if (typeof importScripts === "function") {
  importScripts("worker-control-recovery.js", "navigation-binding.js")
}

const ANALYZE_MESSAGE = "IMNOVA_ANALYZE_VISIBLE_EBAY_THUMBNAIL_V1"
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_DECODED_PIXELS = 16_000_000
const ALLOWED_IMAGE_HOST = "i.ebayimg.com"
const ONE_CLICK_PROBE = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1"
const ADMIN_BRIDGE_VERSION = "PRODUCT_RESEARCH_ADMIN_BRIDGE_V2"
const ONE_CLICK_RUN_QUERY = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_QUERY_V1"
const NEAR_EXACT_SOLD_ENRICHMENT = "IMNOVA_EBAY_NEAR_EXACT_SOLD_ENRICHMENT_V1"
const PRODUCT_RESEARCH_CAPTURE = "IMNOVA_AUTOMATED_PRODUCT_RESEARCH_CAPTURE_V1"
const PRODUCT_RESEARCH_DIAGNOSTIC_PING = "IMNOVA_PRODUCT_RESEARCH_DIAGNOSTIC_PING_V1"
const MAIN_SEARCH_SOLD_CAPTURE = "IMNOVA_AUTOMATED_MAIN_SEARCH_SOLD_CAPTURE_V1"
const ENDED_ITEM_DETAIL_CAPTURE = "IMNOVA_AUTOMATED_ENDED_ITEM_DETAIL_CAPTURE_V1"
const ADMIN_ORIGINS = new Set([
  "https://imnova-website-z1qh-canonical-preview.vercel.app",
  "https://imnova-seller-os-preprod.vercel.app",
  "https://imnova-ebay-mobile-preprod.vercel.app",
])
const ADMIN_SCOPE_MATCHES = [...ADMIN_ORIGINS].flatMap((origin) => [
  `${origin}/admin/ebay/*`, `${origin}/admin/ebay-seller-os*`,
])
const ADMIN_CONTROL_SCOPE_MATCHES = [...ADMIN_ORIGINS].map(
  (origin) => `${origin}/admin/*`,
)
const ADMIN_SCOPE_PATH = /^\/admin\/(?:ebay(?:\/|$)|ebay-seller-os(?:\/|$))/
const ADMIN_PATH = /^\/admin\/(?:ebay\/(?:mobile-review|opportunity-queue\/research|commercial-trace)|ebay-seller-os)\/?$/
const WORKER_CONTROL_URL =
  "https://imnova-seller-os-preprod.vercel.app/admin/ebay/opportunity-queue/research?mayelResearchWorker=auto&browserWorkerControl=1"
const WORKER_CONTROL_ALARM = "seller-os-product-research-worker-control-v1"
const WORKER_CONTROL_RECOVERY =
  globalThis.SELLER_OS_PRODUCT_RESEARCH_CONTROL_RECOVERY_V1
const FREE_SHIPPING_NAVIGATION =
  globalThis.IMNOVA_FREE_SHIPPING_NAVIGATION_BINDING_V1
const SESSION_VERSION = "EBAY_ONE_CLICK_RESEARCH_SESSION_V1_2026_08_26"
const SESSION_SCOPE = "EBAY_RESEARCH_CAPTURE_ONLY"
const MAX_RUNTIME_MS = 15 * 60_000
const MAX_QUERIES = 15
const MAX_ROWS = 200
const MAX_PAGES_PER_QUERY = 2
const MAX_RETRIES = 1
const MAX_ENDED_ITEM_DETAIL_CAPTURES = 6
const PRODUCT_RESEARCH_DAY_RANGE = 90
const PRODUCT_RESEARCH_PAGE_LIMIT = 50
const PRODUCT_RESEARCH_TRACE_VERSION = "PRODUCT_RESEARCH_STAGE_TRACE_V2"
const PRODUCT_RESEARCH_TASK_BINDING_VERSION = "PRODUCT_RESEARCH_TASK_BINDING_V1"
const SERVICE_WORKER_INSTANCE_ID = globalThis.crypto?.randomUUID?.() ??
  `worker-${Date.now()}-${Math.random().toString(16).slice(2)}`

function canonicalAdminScopeTab(tab) {
  try {
    const url = new URL(tab?.url ?? "")
    return Number.isInteger(tab?.id) && ADMIN_ORIGINS.has(url.origin) &&
      ADMIN_SCOPE_PATH.test(url.pathname)
  } catch {
    return false
  }
}

async function injectAdminBridgeIntoExistingTabs() {
  let tabs
  try {
    tabs = await chrome.tabs.query({ url: ADMIN_SCOPE_MATCHES })
  } catch {
    return
  }
  await Promise.allSettled(tabs.map(async (tab) => {
    if (!canonicalAdminScopeTab(tab)) return
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      files: ["admin-bridge.js"],
      injectImmediately: true,
    })
  }))
}

void injectAdminBridgeIntoExistingTabs()

async function removeDuplicateWorkerControlTabs(tabIds) {
  await Promise.allSettled(tabIds.map(async (tabId) => {
    try { await chrome.tabs.remove(tabId) } catch { /* already closed */ }
  }))
}

async function ensureWorkerControlTab({ forceReloadExisting = false } = {}) {
  let existing
  try {
    existing = await chrome.tabs.query({
      url: ADMIN_CONTROL_SCOPE_MATCHES,
    })
  } catch {
    return { state: "UNOBSERVABLE", blockerCode: "CONTROL_TAB_QUERY_FAILED" }
  }
  const decision = WORKER_CONTROL_RECOVERY.decide(existing,
    forceReloadExisting)
  await removeDuplicateWorkerControlTabs(decision.duplicateTabIds)
  if (decision.action === "WAIT_FOR_AUTH") return {
    state: decision.workerState,
    blockerCode: decision.blockerCode,
    tabId: decision.primaryTabId,
  }
  if (decision.action === "REUSE_CONTROL_PAGE") return {
    state: "CONTROL_PAGE_ACTIVE", blockerCode: null,
    tabId: decision.primaryTabId,
  }
  if (decision.action === "RELOAD_CONTROL_PAGE") {
    try {
      await chrome.tabs.update(decision.primaryTabId, {
        url: WORKER_CONTROL_URL, active: false,
      })
      return { state: "RECOVERING", blockerCode: null,
        tabId: decision.primaryTabId }
    } catch {
      return { state: "UNOBSERVABLE",
        blockerCode: "CONTROL_PAGE_RELOAD_FAILED" }
    }
  }
  try {
    const created = await chrome.tabs.create({
      url: WORKER_CONTROL_URL, active: false,
    })
    return { state: "RECOVERING", blockerCode: null,
      tabId: created?.id ?? null }
  } catch {
    return { state: "UNOBSERVABLE",
      blockerCode: "CONTROL_PAGE_CREATE_FAILED" }
  }
}

function scheduleWorkerControlRecovery() {
  chrome.alarms?.create?.(WORKER_CONTROL_ALARM, { periodInMinutes: 2 })
  // onInstalled also runs for an extension replacement. Reinjecting the
  // versioned bridge repairs Seller OS tabs whose former isolated world was
  // invalidated without forcing the owner to find and reload each tab first.
  void injectAdminBridgeIntoExistingTabs()
  void ensureWorkerControlTab({ forceReloadExisting: true })
}

chrome.runtime.onInstalled?.addListener?.(scheduleWorkerControlRecovery)
chrome.runtime.onStartup?.addListener?.(scheduleWorkerControlRecovery)
chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm.name === WORKER_CONTROL_ALARM) void ensureWorkerControlTab()
})
chrome.tabs?.onUpdated?.addListener?.((_tabId, changeInfo) => {
  if (WORKER_CONTROL_RECOVERY.isControlAuthRedirect(changeInfo.url)) {
    void ensureWorkerControlTab()
  }
})

function officialResearchSender(sender) {
  try {
    const url = new URL(sender?.tab?.url ?? sender?.url ?? "")
    return url.protocol === "https:" && url.hostname === "www.ebay.com" &&
      /^\/sh\/research\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

function allowedImageUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "")
    if (url.protocol !== "https:" || url.hostname !== ALLOWED_IMAGE_HOST ||
      url.username || url.password || url.port) return null
    url.hash = ""
    return url
  } catch {
    return null
  }
}

async function readWithLimit(response, controller) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAX_IMAGE_BYTES) {
    controller.abort()
    throw new Error("VISUAL_THUMBNAIL_TOO_LARGE")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("VISUAL_THUMBNAIL_BODY_MISSING")
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > MAX_IMAGE_BYTES) {
        controller.abort()
        throw new Error("VISUAL_THUMBNAIL_TOO_LARGE")
      }
      chunks.push(value)
    }
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "" })
  } finally {
    for (const chunk of chunks) chunk.fill(0)
    chunks.length = 0
    reader.releaseLock()
  }
}

function rgbStats(data, width, height) {
  const total = Math.max(1, width * height)
  const samples = []
  const step = Math.max(1, Math.floor(Math.min(width, height) / 18))
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    if (x > step && y > step && x < width - step && y < height - step) continue
    const offset = (y * width + x) * 4
    samples.push([data[offset], data[offset + 1], data[offset + 2]])
  }
  const edge = samples.length ? samples : [[255, 255, 255]]
  const average = edge.reduce((sum, color) => [
    sum[0] + color[0], sum[1] + color[1], sum[2] + color[2],
  ], [0, 0, 0]).map((value) => value / edge.length)
  let neutralEdge = 0
  let coloredEdge = 0
  for (const color of edge) {
    const spread = Math.max(...color) - Math.min(...color)
    const brightness = (color[0] + color[1] + color[2]) / 3
    if (spread < 26 && brightness > 155) neutralEdge += 1
    if (spread > 48) coloredEdge += 1
  }
  let foreground = 0
  let transitions = 0
  let edgeContrastTotal = 0
  let centerX = 0
  let centerY = 0
  let minimumX = width
  let maximumX = 0
  let minimumY = height
  let maximumY = 0
  let brightnessTotal = 0
  let saturationTotal = 0
  let warm = 0
  let cool = 0
  const zones = {
    left: { count: 0, total: 0, squared: 0 },
    right: { count: 0, total: 0, squared: 0 },
    top: { count: 0, total: 0, squared: 0 },
    bottom: { count: 0, total: 0, squared: 0 },
  }
  const scanStep = Math.max(1, Math.floor(Math.sqrt(total / 3_600)))
  for (let y = 0; y < height; y += scanStep) for (let x = 0; x < width; x += scanStep) {
    const offset = (y * width + x) * 4
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    const luminance = (red * .2126 + green * .7152 + blue * .0722) / 255
    brightnessTotal += luminance
    saturationTotal += (maximum - minimum) / 255
    if (red - blue > 16) warm += 1
    if (blue - red > 16) cool += 1
    for (const [name, included] of [
      ["left", x < width * .28], ["right", x >= width * .72],
      ["top", y < height * .25], ["bottom", y >= height * .75],
    ]) if (included) {
      const zone = zones[name]
      zone.count += 1
      zone.total += luminance
      zone.squared += luminance * luminance
    }
    const distance = Math.abs(red - average[0]) + Math.abs(green - average[1]) +
      Math.abs(blue - average[2])
    if (distance > 76) {
      foreground += 1
      centerX += x
      centerY += y
      minimumX = Math.min(minimumX, x)
      maximumX = Math.max(maximumX, x)
      minimumY = Math.min(minimumY, y)
      maximumY = Math.max(maximumY, y)
    }
    if (x >= scanStep) {
      const previous = offset - scanStep * 4
      const difference = Math.abs(red - data[previous]) +
        Math.abs(green - data[previous + 1]) + Math.abs(blue - data[previous + 2])
      edgeContrastTotal += difference / (255 * 3)
      if (difference > 90) transitions += 1
    }
  }
  const scanned = Math.max(1, Math.ceil(width / scanStep) * Math.ceil(height / scanStep))
  const uniformity = (zone) => {
    const mean = zone.total / Math.max(1, zone.count)
    const deviation = Math.sqrt(Math.max(0,
      zone.squared / Math.max(1, zone.count) - mean * mean))
    return Math.max(0, 1 - deviation / .28)
  }
  return {
    neutralEdgeRatio: neutralEdge / edge.length,
    coloredEdgeRatio: coloredEdge / edge.length,
    foregroundRatio: foreground / scanned,
    transitionRatio: transitions / scanned,
    foregroundCenterX: foreground ? centerX / foreground / width : .5,
    foregroundCenterY: foreground ? centerY / foreground / height : .5,
    averageBrightness: brightnessTotal / scanned,
    averageSaturation: saturationTotal / scanned,
    edgeContrastRatio: edgeContrastTotal / scanned,
    warmRatio: warm / scanned,
    coolRatio: cool / scanned,
    foregroundBoundingWidth: foreground ? Math.min(1, (maximumX - minimumX + scanStep) / width) : 0,
    foregroundBoundingHeight: foreground ? Math.min(1, (maximumY - minimumY + scanStep) / height) : 0,
    leftUniformity: uniformity(zones.left),
    rightUniformity: uniformity(zones.right),
    topUniformity: uniformity(zones.top),
    bottomUniformity: uniformity(zones.bottom),
  }
}

async function analyzeThumbnail(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  let bitmap = null
  let canvas = null
  let pixelData = null
  try {
    const response = await fetch(url.href, {
      cache: "force-cache",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    })
    const contentType = response.headers.get("content-type") ?? ""
    if (!response.ok || !/^image\/(?:jpeg|png|webp)$/i.test(contentType)) {
      throw new Error("VISUAL_THUMBNAIL_RESPONSE_INVALID")
    }
    const blob = await readWithLimit(response, controller)
    bitmap = await createImageBitmap(blob)
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_DECODED_PIXELS) {
      throw new Error("VISUAL_THUMBNAIL_DIMENSIONS_INVALID")
    }
    const scale = Math.min(1, 128 / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) throw new Error("VISUAL_THUMBNAIL_CONTEXT_UNAVAILABLE")
    context.drawImage(bitmap, 0, 0, width, height)
    pixelData = context.getImageData(0, 0, width, height)
    return rgbStats(pixelData.data, width, height)
  } finally {
    clearTimeout(timeout)
    if (pixelData?.data) pixelData.data.fill(0)
    pixelData = null
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
    bitmap?.close()
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== ANALYZE_MESSAGE) return false
  const url = allowedImageUrl(message.imageUrl)
  if (!url || !officialResearchSender(sender)) {
    sendResponse({ success: false, error: "VISUAL_THUMBNAIL_SCOPE_INVALID" })
    return false
  }
  void analyzeThumbnail(url).then(
    (stats) => sendResponse({ success: true, stats }),
    () => sendResponse({ success: false, error: "VISUAL_THUMBNAIL_ANALYSIS_UNAVAILABLE" }),
  )
  return true
})

function oneClickAdminSender(sender) {
  try {
    const url = new URL(sender?.tab?.url ?? sender?.url ?? "")
    return sender?.frameId === 0 && ADMIN_ORIGINS.has(url.origin) &&
      ADMIN_PATH.test(url.pathname)
  } catch {
    return false
  }
}

function safeFailureCode(error, fallback) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:.-]+$/.test(value) ? value : fallback
}

function enrichmentFailureClass(code) {
  const value = typeof code === "string" ? code.toUpperCase() : ""
  if (/(?:TIMEOUT|LEASE_EXPIRED|DEADLINE)/.test(value)) return "TIMEOUT"
  if (/(?:CHALLENGE|CAPTCHA|ROBOT|ACCESS_DENIED)/.test(value)) {
    return "CHALLENGE"
  }
  if (/(?:NAVIGATION|TAB_CREATE|TAB_CLOSED|TAB_REMOVED|URL_INVALID)/
    .test(value)) return "NAVIGATION_FAILED"
  if (/(?:PARSE|CONTENT_CAPTURE|CAPTURE_RESULT|SOLD_FILTER|ROW_INVALID)/
    .test(value)) return "PAGE_PARSE_FAILED"
  return "REQUEST_FAILED"
}

function boundedLease(value) {
  const lease = value && typeof value === "object" ? value : {}
  const bounds = lease.bounds && typeof lease.bounds === "object" ? lease.bounds : {}
  const now = Date.now()
  const valid = lease.version === SESSION_VERSION && lease.scope === SESSION_SCOPE &&
    lease.marketplace === "EBAY_US" && /^[0-9a-f-]{36}$/i.test(lease.sessionId ?? "") &&
    Number.isFinite(lease.issuedAt) && Number.isFinite(lease.expiresAt) &&
    lease.issuedAt <= now + 60_000 && lease.expiresAt > now &&
    lease.expiresAt - lease.issuedAt <= MAX_RUNTIME_MS && lease.marketplaceWrites === 0 &&
    Number(bounds.maxRuntimeMs) <= MAX_RUNTIME_MS &&
    Number(bounds.maxQueries) <= MAX_QUERIES && Number(bounds.maxRows) <= MAX_ROWS &&
    Number(bounds.maxRowsPerCapture) <= MAX_ROWS &&
    Number(bounds.maxPagesPerQuery) <= MAX_PAGES_PER_QUERY &&
    Number(bounds.maxRetries) <= MAX_RETRIES
  if (!valid) throw new Error("ONE_CLICK_RESEARCH_LEASE_INVALID")
  return lease
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function newProductResearchTrace() {
  return {
    version: PRODUCT_RESEARCH_TRACE_VERSION,
    lastConfirmedStage: "TASK_RECEIVED",
    taskReceived: true,
    tabCreated: false,
    tabUpdatedComplete: false,
    finalUrlStateValid: false,
    urlStateClass: "UNAVAILABLE",
    urlPathState: "UNAVAILABLE",
    urlMarketplaceState: "UNAVAILABLE",
    urlQueryState: "UNAVAILABLE",
    urlCategoryState: "UNAVAILABLE",
    urlSoldTabState: "UNAVAILABLE",
    urlDayRangeState: "UNAVAILABLE",
    urlGuidedQueryState: "UNAVAILABLE",
    urlGuidedStageState: "UNAVAILABLE",
    authState: "UNVERIFIED",
    contentScriptPingSent: false,
    contentScriptPingAck: false,
    contentScriptBooted: false,
    queryStateMatch: false,
    categoryStateMatch: false,
    resultsContainerFound: false,
    resultsLoading: false,
    resultsReady: false,
    guidedQueryStatePresent: false,
    guidedQueryMatch: false,
    resultIdentityState: "NONE",
    resultIdentityCount: 0,
    resultFingerprintChanged: false,
    previousResultsFingerprintPresent: false,
    resultStateBoundToCurrentQuery: false,
    readinessRejectionReason: "GUIDED_QUERY_STATE_MISSING",
    zeroResultsState: "NOT_PROVEN",
    captureRequestSent: false,
    captureResponseReceived: false,
    captureResponseState: "NONE",
    rowCount: 0,
    sourceFormatChanged: false,
    externalEbayBlocker: "NONE",
    tabReloadedAfterContentScriptBoot: false,
  }
}

function productResearchLastStage(trace) {
  if (trace.rowCount > 0) return "ROW_COUNT"
  if (trace.captureResponseReceived) return "CAPTURE_RESPONSE_RECEIVED"
  if (trace.captureRequestSent) return "CAPTURE_REQUEST_SENT"
  if (trace.resultsReady) return "RESULTS_READY"
  if (trace.resultsLoading) return "RESULTS_LOADING"
  if (trace.resultsContainerFound) return "RESULTS_CONTAINER_FOUND"
  if (trace.categoryStateMatch) return "CATEGORY_STATE_MATCH"
  if (trace.queryStateMatch) return "QUERY_STATE_MATCH"
  if (trace.contentScriptBooted) return "CONTENT_SCRIPT_BOOTED"
  if (trace.contentScriptPingAck) return "CONTENT_SCRIPT_PING_ACK"
  if (trace.contentScriptPingSent) return "CONTENT_SCRIPT_PING_SENT"
  if (trace.finalUrlStateValid) return "FINAL_URL_STATE_VALID"
  if (trace.tabUpdatedComplete) return "TAB_UPDATED_COMPLETE"
  if (trace.tabCreated) return "TAB_CREATED"
  return "TASK_RECEIVED"
}

function boundedProductResearchTrace(value) {
  if (!value || typeof value !== "object") return null
  const trace = { ...value }
  trace.lastConfirmedStage = productResearchLastStage(trace)
  delete trace.contentScriptBootId
  return trace
}

function productResearchFailure(code, trace) {
  const error = new Error(code)
  error.diagnosticTrace = boundedProductResearchTrace(trace)
  return error
}

function updateProductResearchTabTrace(tab, input, trace) {
  if (tab?.status === "complete") trace.tabUpdatedComplete = true
  let url
  try { url = new URL(typeof tab?.url === "string" ? tab.url : "") } catch { return }
  const boundedUrlFieldState = (value, expected) => value === null || value === ""
    ? "ABSENT" : value === expected ? "MATCH" : "MISMATCH"
  trace.urlPathState = /^\/sh\/research\/?$/.test(url.pathname) ? "MATCH" : "MISMATCH"
  trace.urlMarketplaceState = boundedUrlFieldState(
    url.searchParams.get("marketplace"), "EBAY-US",
  )
  trace.urlQueryState = boundedUrlFieldState(url.searchParams.get("keywords"), input.searchQuery)
  trace.urlCategoryState = boundedUrlFieldState(
    url.searchParams.get("categoryId"), input.categoryId,
  )
  trace.urlSoldTabState = boundedUrlFieldState(url.searchParams.get("tabName"), "SOLD")
  trace.urlDayRangeState = boundedUrlFieldState(
    url.searchParams.get("dayRange"), String(PRODUCT_RESEARCH_DAY_RANGE),
  )
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""))
  trace.urlGuidedQueryState = boundedUrlFieldState(
    fragment.get("seller-os-query"), input.searchQuery,
  )
  const guidedStage = fragment.get("seller-os-query-stage")
  trace.urlGuidedStageState = guidedStage === null || guidedStage === ""
    ? "ABSENT" : guidedStage === "AWAITING_RESULTS" ? "AWAITING_RESULTS"
      : guidedStage === "RESULTS_READY" ? "RESULTS_READY" : "OTHER"
  const requestIdentityMatches = trace.urlQueryState === "MATCH" &&
    trace.urlCategoryState === "MATCH"
  const fullRepresentationMatches = [
    trace.urlPathState, trace.urlMarketplaceState, trace.urlQueryState,
    trace.urlCategoryState, trace.urlSoldTabState, trace.urlDayRangeState,
    trace.urlGuidedQueryState,
  ].every((state) => state === "MATCH") &&
    ["AWAITING_RESULTS", "RESULTS_READY"].includes(trace.urlGuidedStageState)
  trace.urlStateClass = fullRepresentationMatches ? "EXACT_REQUESTED_REPRESENTATION"
    : requestIdentityMatches ? "QUERY_CATEGORY_MATCH_URL_REPRESENTATION_DIFFERENT"
      : "REQUEST_IDENTITY_MISMATCH"
  if (url.hostname === "signin.ebay.com") {
    trace.authState = "LOGIN_REQUIRED"
    trace.externalEbayBlocker = "LOGIN_REDIRECT"
    return
  }
  if (url.hostname !== "www.ebay.com") {
    if (tab?.status === "complete") trace.externalEbayBlocker = "UNSUPPORTED_NAVIGATION"
    return
  }
  if (/captcha|splashui/i.test(url.pathname)) {
    trace.authState = "ACCESS_CHALLENGE"
    trace.externalEbayBlocker = "ACCESS_CHALLENGE"
    return
  }
  if (/consent|interstitial/i.test(url.pathname)) {
    trace.authState = "CONSENT_OR_INTERSTITIAL"
    trace.externalEbayBlocker = "CONSENT_OR_INTERSTITIAL"
    return
  }
  if (!/^\/sh\/research\/?$/.test(url.pathname)) {
    if (tab?.status === "complete") {
      trace.externalEbayBlocker = "UNSUPPORTED_PRODUCT_RESEARCH_PAGE_STATE"
    }
    return
  }
  trace.finalUrlStateValid = fullRepresentationMatches
}

function updateProductResearchContentTrace(diagnostic, trace) {
  if (!diagnostic || typeof diagnostic !== "object") return
  trace.contentScriptPingAck = true
  trace.contentScriptBooted = diagnostic.contentScriptBooted === true
  trace.queryStateMatch = diagnostic.queryStateMatch === true
  trace.categoryStateMatch = diagnostic.categoryStateMatch === true
  trace.resultsContainerFound = diagnostic.resultsContainerFound === true
  trace.resultsLoading = diagnostic.resultsLoading === true
  trace.resultsReady = diagnostic.resultsReady === true
  trace.guidedQueryStatePresent = diagnostic.guidedQueryStatePresent === true
  trace.guidedQueryMatch = diagnostic.guidedQueryMatch === true
  trace.resultIdentityState = ["NONE", "SOLD_ITEM_IDS", "OFFICIAL_ZERO_RESULTS",
    "SOURCE_FORMAT_UNRECOGNIZED"].includes(diagnostic.resultIdentityState)
    ? diagnostic.resultIdentityState : "NONE"
  const resultIdentityCount = Number(diagnostic.resultIdentityCount)
  trace.resultIdentityCount = Number.isInteger(resultIdentityCount) &&
    resultIdentityCount >= 0 && resultIdentityCount <= 12 ? resultIdentityCount : 0
  trace.resultFingerprintChanged = diagnostic.resultFingerprintChanged === true
  trace.previousResultsFingerprintPresent =
    diagnostic.previousResultsFingerprintPresent === true
  trace.resultStateBoundToCurrentQuery = diagnostic.resultStateBoundToCurrentQuery === true
  trace.readinessRejectionReason = [
    "READY", "GUIDED_QUERY_STATE_MISSING", "GUIDED_QUERY_MISMATCH",
    "QUERY_STATE_MISMATCH", "CATEGORY_STATE_MISMATCH", "RESULTS_STILL_LOADING",
    "RESULT_IDENTITY_MISSING", "STALE_RESULT_IDENTITY", "SOURCE_FORMAT_UNRECOGNIZED",
  ].includes(diagnostic.readinessRejectionReason)
    ? diagnostic.readinessRejectionReason : "RESULT_IDENTITY_MISSING"
  trace.zeroResultsState = diagnostic.zeroResultsState === "OFFICIAL_ZERO_RESULTS"
    ? "OFFICIAL_ZERO_RESULTS" : "NOT_PROVEN"
  trace.authState = [
    "AUTHENTICATED_PRODUCT_RESEARCH", "LOGIN_REQUIRED", "CONSENT_OR_INTERSTITIAL",
    "ACCESS_CHALLENGE", "UNVERIFIED",
  ].includes(diagnostic.authState) ? diagnostic.authState : "UNVERIFIED"
  if (diagnostic.externalEbayBlocker && diagnostic.externalEbayBlocker !== "NONE") {
    trace.externalEbayBlocker = diagnostic.externalEbayBlocker
  }
  if (typeof diagnostic.contentScriptBootId === "string" &&
    /^[0-9a-f-]{36}$/i.test(diagnostic.contentScriptBootId)) {
    if (trace.contentScriptBootId &&
      trace.contentScriptBootId !== diagnostic.contentScriptBootId) {
      trace.tabReloadedAfterContentScriptBoot = true
    }
    trace.contentScriptBootId = diagnostic.contentScriptBootId
  }
}

async function productResearchContentCapture(input) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < input.timeoutMs) {
    if (Date.now() >= input.expiresAt) {
      throw productResearchFailure("ONE_CLICK_RESEARCH_SESSION_EXPIRED", input.trace)
    }
    let taskBinding = null
    try {
      const tab = await chrome.tabs.get(input.tabId)
      updateProductResearchTabTrace(tab, input, input.trace)
      taskBinding = attestedProductResearchTaskBinding(tab, input, input.trace)
    } catch { /* the bounded message probe below remains authoritative */ }
    if (["LOGIN_REDIRECT", "ACCESS_CHALLENGE", "CONSENT_OR_INTERSTITIAL",
      "UNSUPPORTED_NAVIGATION", "UNSUPPORTED_PRODUCT_RESEARCH_PAGE_STATE"]
      .includes(input.trace.externalEbayBlocker)) {
      throw productResearchFailure(`PRODUCT_RESEARCH_${input.trace.externalEbayBlocker}`,
        input.trace)
    }
    input.trace.contentScriptPingSent = true
    try {
      const ping = await chrome.tabs.sendMessage(input.tabId, {
        type: PRODUCT_RESEARCH_DIAGNOSTIC_PING,
        searchQuery: input.searchQuery,
        categoryId: input.categoryId,
        ...(taskBinding ? { taskBinding } : {}),
      })
      if (ping?.success === true && ping?.status === "READY") {
        updateProductResearchContentTrace(ping.diagnostic, input.trace)
      }
    } catch { /* missing receiver is recorded by a false ping ACK */ }
    input.trace.captureRequestSent = true
    try {
      const response = await chrome.tabs.sendMessage(input.tabId, {
        ...input.message,
        ...(taskBinding ? { taskBinding } : {}),
      })
      input.trace.captureResponseReceived = true
      input.trace.captureResponseState = response?.status === "READY" ? "READY"
        : response?.status === "FAILED" || response?.success === false ? "FAILED" : "PENDING"
      updateProductResearchContentTrace(response?.diagnostic, input.trace)
      if (response?.success === false || response?.status === "FAILED") {
        throw productResearchFailure(safeFailureCode(new Error(String(response?.error ?? "")),
          "ONE_CLICK_RESEARCH_CONTENT_CAPTURE_FAILED"), input.trace)
      }
      if (response?.success === true && response?.status === "READY") {
        input.trace.resultsReady = true
        input.trace.rowCount = Math.max(0, Math.min(MAX_ROWS,
          Number(response?.capture?.visibleResultCount) || 0))
        return response
      }
    } catch (error) {
      if (error?.diagnosticTrace) throw error
      const code = safeFailureCode(error, "")
      if (code && !/receiving end does not exist|message port closed/i.test(
        error instanceof Error ? error.message : "")) {
        throw productResearchFailure(code, input.trace)
      }
    }
    await wait(750)
  }
  if (input.trace.tabUpdatedComplete && input.trace.finalUrlStateValid &&
    !input.trace.contentScriptPingAck) {
    input.trace.externalEbayBlocker = "CONTENT_SCRIPT_MISSING"
  } else if (input.trace.contentScriptBooted &&
    input.trace.authState === "AUTHENTICATED_PRODUCT_RESEARCH" &&
    input.trace.queryStateMatch && input.trace.categoryStateMatch &&
    !input.trace.resultsContainerFound && !input.trace.resultsLoading) {
    input.trace.sourceFormatChanged = true
    input.trace.externalEbayBlocker = "SOURCE_FORMAT_CHANGED"
  } else if (!input.trace.tabUpdatedComplete || input.trace.resultsLoading) {
    input.trace.externalEbayBlocker = "EBAY_PAGE_STILL_LOADING"
  }
  throw productResearchFailure(input.timeoutCode, input.trace)
}

async function contentCapture(input) {
  const startedAt = Date.now()
  let staleResponseCount = 0
  let boundDocumentInjectionAttempted = false
  const captureBinding = input.navigation
    ? FREE_SHIPPING_NAVIGATION.captureBinding(input.navigation,
      input.message.queryIdentity, input.captureNonce)
    : null
  while (Date.now() - startedAt < input.timeoutMs) {
    if (Date.now() >= input.expiresAt) throw new Error("ONE_CLICK_RESEARCH_SESSION_EXPIRED")
    try {
      if (captureBinding) {
        await FREE_SHIPPING_NAVIGATION.assertAuthoritativeDocument(chrome,
          captureBinding, input.navigation)
      }
      const messageOptions = captureBinding
        ? { documentId: captureBinding.documentId } : undefined
      let response
      try {
        response = await chrome.tabs.sendMessage(input.tabId, {
          ...input.message,
          ...(captureBinding ? { captureBinding } : {}),
        }, messageOptions)
      } catch (error) {
        const missingReceiver = /receiving end does not exist|message port closed/i
          .test(error instanceof Error ? error.message : "")
        if (!captureBinding || !missingReceiver ||
            boundDocumentInjectionAttempted) throw error
        boundDocumentInjectionAttempted = true
        const injected = await chrome.scripting.executeScript({
          target: { tabId: captureBinding.tabId,
            documentIds: [captureBinding.documentId] },
          files: ["sold-content.js"],
          injectImmediately: true,
        })
        const injectedDocuments = new Set((Array.isArray(injected) ? injected : [])
          .map((entry) => entry?.documentId).filter(Boolean))
        if (!injectedDocuments.has(captureBinding.documentId)) {
          const failure = new Error("STALE_DOCUMENT_RESPONSE")
          failure.navigationEvidence = input.navigation
          throw failure
        }
        await wait(100)
        continue
      }
      if (input.navigation) {
        try {
          await FREE_SHIPPING_NAVIGATION.assertAuthoritativeDocument(chrome,
            captureBinding, input.navigation)
          FREE_SHIPPING_NAVIGATION.verifyBoundCapture(input.navigation,
            response, captureBinding)
        } catch (error) {
          staleResponseCount += 1
          if (staleResponseCount < 2) {
            await wait(250)
            continue
          }
          throw error
        }
      }
      if (response?.success === false || response?.status === "FAILED") {
        throw new Error(safeFailureCode(new Error(String(response?.error ?? "")),
          "ONE_CLICK_RESEARCH_CONTENT_CAPTURE_FAILED"))
      }
      if (response?.success === true && response?.status === "READY") return response
    } catch (error) {
      const code = safeFailureCode(error, "")
      if (code && !/receiving end does not exist|message port closed/i.test(
        error instanceof Error ? error.message : "")) throw error
    }
    await wait(750)
  }
  throw new Error(input.timeoutCode)
}

function freeShippingFailureCode(error) {
  const code = safeFailureCode(error, "FREE_SHIPPING_CAPTURE_FAILED")
  if (/CHALLENGE|CAPTCHA|ACCESS_DENIED/.test(code)) return "CHALLENGE"
  if (/MARKER_OR_DOM|PARSE|SOURCE_FORMAT/.test(code)) return "PAGE_PARSE_FAILED"
  if (code === "FILTER_REMOVED_BY_EBAY" || code === "STALE_DOCUMENT_RESPONSE" ||
      code === "NAVIGATION_TIMEOUT" || code === "NAVIGATION_FAILED") return code
  return code
}

async function captureBoundFreeShippingPage(input) {
  const attempts = []
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let navigation = null
    const navigationBindingId = crypto.randomUUID()
    const captureNonce = crypto.randomUUID()
    try {
      navigation = await FREE_SHIPPING_NAVIGATION.waitForFreeShippingNavigation({
        chromeApi: chrome,
        tabId: input.tabId,
        requestedUrl: input.requestedUrl,
        expectedQuery: input.searchQuery,
        bindingId: navigationBindingId,
        timeoutMs: input.timeoutMs,
      })
      attempts.push(navigation)
      const sold = await contentCapture({
        tabId: input.tabId,
        expiresAt: input.expiresAt,
        timeoutMs: input.timeoutMs,
        timeoutCode: "NAVIGATION_TIMEOUT",
        navigation,
        captureNonce,
        message: { type: MAIN_SEARCH_SOLD_CAPTURE,
          queryIdentity: input.searchQuery,
          freeShippingFilterRequired: true,
          navigationBindingId,
          maxRows: input.maxRows },
      })
      const rows = (Array.isArray(sold.rows) ? sold.rows : []).map((row) => ({
        ...row, navigationEvidence: navigation,
      }))
      return { sold: { ...sold, rows }, navigation,
        navigationAttempts: attempts, navigationAttemptCount: attempt + 1 }
    } catch (error) {
      const navigationEvidence = error?.navigationEvidence ?? navigation
      if (navigationEvidence && attempts.at(-1) !== navigationEvidence) {
        attempts.push(navigationEvidence)
      }
      const code = freeShippingFailureCode(error)
      lastError = error instanceof Error ? error : new Error(code)
      lastError.navigationEvidence = navigationEvidence
      lastError.navigationAttempts = attempts
      lastError.navigationAttemptCount = attempt + 1
      if (!FREE_SHIPPING_NAVIGATION.RETRYABLE.has(code) || attempt === 1) break
    }
  }
  throw lastError ?? new Error("FREE_SHIPPING_CAPTURE_FAILED")
}

function productResearchCategoryId(value) {
  const categoryId = String(value ?? "").trim()
  if (!categoryId) return "0"
  if (!/^\d{1,12}$/.test(categoryId)) {
    throw new Error("ONE_CLICK_RESEARCH_CATEGORY_INVALID")
  }
  return categoryId
}

function productResearchTaskBinding(lease, task, searchQuery, categoryId, ordinal) {
  const taskId = typeof task?.id === "string"
    ? task.id.normalize("NFKC").trim().slice(0, 80) : ""
  if (!taskId || !/^[A-Za-z0-9_.:-]+$/.test(taskId)) {
    throw new Error("ONE_CLICK_RESEARCH_TASK_ID_INVALID")
  }
  return {
    version: PRODUCT_RESEARCH_TASK_BINDING_VERSION,
    sessionId: lease.sessionId,
    taskId,
    ordinal,
    expectedQuery: searchQuery,
    expectedCategoryId: categoryId,
  }
}

function attestedProductResearchTaskBinding(tab, input, trace) {
  let url
  try { url = new URL(typeof tab?.url === "string" ? tab.url : "") } catch { return null }
  const navigationAttested = tab?.id === input.tabId && tab?.status === "complete" &&
    url.protocol === "https:" && url.hostname === "www.ebay.com" &&
    /^\/sh\/research\/?$/.test(url.pathname) &&
    url.searchParams.get("keywords") === input.searchQuery &&
    url.searchParams.get("categoryId") === input.categoryId &&
    url.searchParams.get("tabName") === "SOLD" &&
    url.searchParams.get("dayRange") === String(PRODUCT_RESEARCH_DAY_RANGE) &&
    trace.urlPathState === "MATCH" && trace.urlQueryState === "MATCH" &&
    trace.urlCategoryState === "MATCH"
  if (!navigationAttested) return null
  return {
    ...input.taskBinding,
    navigationAttested: true,
    freshTabForTask: true,
  }
}

function productResearchUrl(searchQuery, categoryId) {
  const endDate = Date.now()
  const startDate = endDate - PRODUCT_RESEARCH_DAY_RANGE * 24 * 60 * 60 * 1_000
  const url = new URL("https://www.ebay.com/sh/research")
  url.searchParams.set("marketplace", "EBAY-US")
  url.searchParams.set("keywords", searchQuery)
  url.searchParams.set("dayRange", String(PRODUCT_RESEARCH_DAY_RANGE))
  url.searchParams.set("endDate", String(endDate))
  url.searchParams.set("startDate", String(startDate))
  url.searchParams.set("categoryId", productResearchCategoryId(categoryId))
  url.searchParams.set("offset", "0")
  url.searchParams.set("limit", String(PRODUCT_RESEARCH_PAGE_LIMIT))
  url.searchParams.set("tabName", "SOLD")
  url.searchParams.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")
  const fragment = new URLSearchParams()
  fragment.set("seller-os-query", searchQuery)
  fragment.set("seller-os-query-stage", "AWAITING_RESULTS")
  url.hash = fragment.toString()
  return url.href
}

function soldSearchUrl(searchQuery, page, freeShippingOnly = false) {
  const url = new URL("https://www.ebay.com/sch/i.html")
  url.searchParams.set("_nkw", searchQuery)
  url.searchParams.set("LH_Sold", "1")
  url.searchParams.set("LH_Complete", "1")
  if (freeShippingOnly) url.searchParams.set("LH_FS", "1")
  url.searchParams.set("_sop", "13")
  url.searchParams.set("_ipg", "60")
  url.searchParams.set("_pgn", String(page))
  return url.href
}

async function runOneClickQueryOnce(message, lease) {
  const task = message.task && typeof message.task === "object" ? message.task : {}
  const searchQuery = typeof task.searchQuery === "string"
    ? task.searchQuery.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 100) : ""
  const ordinal = Number(task.ordinal)
  const remainingRows = Number(message.remainingRows)
  if (searchQuery.length < 3 || !Number.isInteger(ordinal) || ordinal < 1 ||
    !Number.isInteger(remainingRows) ||
    remainingRows < 1 || remainingRows > Number(lease.bounds.maxRows)) {
    throw new Error("ONE_CLICK_RESEARCH_QUERY_BOUNDS_INVALID")
  }
  const categoryId = productResearchCategoryId(task.categoryId)
  const taskBinding = productResearchTaskBinding(
    lease, task, searchQuery, categoryId, ordinal,
  )
  const productResearchTrace = newProductResearchTrace()
  const tab = await chrome.tabs.create({
    url: productResearchUrl(searchQuery, categoryId), active: false,
  })
  if (!Number.isInteger(tab?.id)) throw new Error("ONE_CLICK_RESEARCH_TAB_CREATE_FAILED")
  productResearchTrace.tabCreated = true
  updateProductResearchTabTrace(tab, { searchQuery, categoryId }, productResearchTrace)
  try {
    const productResearch = await productResearchContentCapture({
      tabId: tab.id,
      expiresAt: lease.expiresAt,
      timeoutMs: 60_000,
      timeoutCode: "PRODUCT_RESEARCH_AUTOMATED_CAPTURE_TIMEOUT",
      searchQuery,
      categoryId,
      taskBinding,
      trace: productResearchTrace,
      message: { type: PRODUCT_RESEARCH_CAPTURE, searchQuery, categoryId,
        maxRows: Number(lease.bounds.maxRowsPerCapture) },
    })
    const soldRows = []
    let soldFilterAutomated = false
    for (let page = 1; page <= Number(lease.bounds.maxPagesPerQuery) &&
      soldRows.length < remainingRows; page += 1) {
      await chrome.tabs.update(tab.id, { url: soldSearchUrl(searchQuery, page), active: false })
      const sold = await contentCapture({
        tabId: tab.id,
        expiresAt: lease.expiresAt,
        timeoutMs: 45_000,
        timeoutCode: "MAIN_SEARCH_SOLD_AUTOMATED_CAPTURE_TIMEOUT",
        message: { type: MAIN_SEARCH_SOLD_CAPTURE, queryIdentity: searchQuery,
          maxRows: Math.min(remainingRows - soldRows.length, MAX_ROWS) },
      })
      soldFilterAutomated = sold.soldFilterProven === true
      for (const row of Array.isArray(sold.rows) ? sold.rows : []) {
        if (soldRows.length >= remainingRows) break
        soldRows.push(row)
      }
      if (!sold.nextPageAvailable || !sold.rows?.length) break
    }
    return {
      success: true,
      extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version,
      productResearchCapture: productResearch.capture,
      productResearchDiagnosticTrace: boundedProductResearchTrace(productResearchTrace),
      mainSearchSoldRows: soldRows,
      soldFilterAutomated,
      paginationAutomated: true,
      cookieAccess: false,
      marketplaceWrites: 0,
    }
  } finally {
    try { await chrome.tabs.remove(tab.id) } catch { /* already closed */ }
  }
}

async function runOneClickQuery(message) {
  const lease = boundedLease(message.lease)
  let lastError = null
  for (let attempt = 0; attempt <= Number(lease.bounds.maxRetries); attempt += 1) {
    try {
      return await runOneClickQueryOnce(message, lease)
    } catch (error) {
      lastError = error
      if (Date.now() >= lease.expiresAt) break
    }
  }
  throw lastError ?? new Error("ONE_CLICK_RESEARCH_QUERY_FAILED")
}

async function runNearExactSoldTask(task, lease, maximumRows) {
  const searchQuery = typeof task?.searchQuery === "string"
    ? task.searchQuery.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 100)
    : ""
  const ordinal = Number(task?.ordinal)
  if (searchQuery.length < 3 || !Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error("NEAR_EXACT_SOLD_TASK_INVALID")
  }
  const tab = await chrome.tabs.create({
    url: soldSearchUrl(searchQuery, 1, false), active: false,
  })
  if (!Number.isInteger(tab?.id)) throw new Error(
    "NEAR_EXACT_SOLD_TAB_CREATE_FAILED")
  try {
    const rowsByItemId = new Map()
    let soldFilterProven = false
    let freeShippingFilterProven = false
    let freeShippingBranchStatus = "NOT_ATTEMPTED"
    let freeShippingBranchError = null
    let freeShippingNavigation = null
    let freeShippingNavigationAttempts = []
    let freeShippingNavigationAttemptCount = 0
    let allSoldBranchError = null
    for (const branch of [
      { name: "ALL_SOLD", freeShippingOnly: false,
        maximumPages: Number(lease.bounds.maxPagesPerQuery) },
      { name: "FREE_SHIPPING_ONLY", freeShippingOnly: true, maximumPages: 1 },
    ]) {
      try {
        for (let page = 1; page <= branch.maximumPages &&
          (branch.freeShippingOnly || rowsByItemId.size < maximumRows); page += 1) {
          const requestedUrl = soldSearchUrl(searchQuery, page,
            branch.freeShippingOnly)
          let sold
          if (branch.freeShippingOnly) {
            const captured = await captureBoundFreeShippingPage({
              tabId: tab.id,
              requestedUrl,
              searchQuery,
              expiresAt: lease.expiresAt,
              timeoutMs: 12_000,
              maxRows: Math.min(maximumRows, MAX_ROWS),
            })
            sold = captured.sold
            freeShippingNavigation = captured.navigation
            freeShippingNavigationAttempts = captured.navigationAttempts
            freeShippingNavigationAttemptCount =
              captured.navigationAttemptCount
          } else {
            await chrome.tabs.update(tab.id, { url: requestedUrl, active: false })
            sold = await contentCapture({
              tabId: tab.id, expiresAt: lease.expiresAt, timeoutMs: 12_000,
              timeoutCode: "NEAR_EXACT_SOLD_CAPTURE_TIMEOUT",
              message: { type: MAIN_SEARCH_SOLD_CAPTURE,
                queryIdentity: searchQuery,
                freeShippingFilterRequired: false,
                maxRows: Math.min(maximumRows - rowsByItemId.size, MAX_ROWS) },
            })
          }
          if (branch.freeShippingOnly) {
            freeShippingFilterProven = sold.freeShippingFilterProven === true
            freeShippingBranchStatus = freeShippingFilterProven
              ? "COMPLETED" : "FAILED"
          } else soldFilterProven = sold.soldFilterProven === true
          for (const row of Array.isArray(sold.rows) ? sold.rows : []) {
            if (rowsByItemId.size >= maximumRows &&
                !rowsByItemId.has(row.itemId)) break
            const current = rowsByItemId.get(row.itemId)
            if (!current) rowsByItemId.set(row.itemId, row)
            else if (row.shippingEvidence === "PROVEN_ZERO_BY_SEARCH_FILTER") {
              rowsByItemId.set(row.itemId,
                FREE_SHIPPING_NAVIGATION.mergeFreeShippingEvidence(current, row))
            }
          }
          if (!sold.nextPageAvailable || !sold.rows?.length) break
        }
      } catch (error) {
        if (branch.freeShippingOnly) {
          freeShippingBranchStatus = "FAILED"
          freeShippingBranchError = freeShippingFailureCode(error)
          freeShippingNavigation = error?.navigationEvidence ??
            freeShippingNavigation
          freeShippingNavigationAttempts = Array.isArray(
            error?.navigationAttempts) ? error.navigationAttempts
            : freeShippingNavigationAttempts
          freeShippingNavigationAttemptCount = Number(
            error?.navigationAttemptCount) ||
            freeShippingNavigationAttemptCount
        } else allSoldBranchError = safeFailureCode(error,
          "NEAR_EXACT_SOLD_CAPTURE_FAILED")
      }
    }
    if (!soldFilterProven && !freeShippingFilterProven) {
      const failure = new Error(allSoldBranchError || freeShippingBranchError ||
        "NEAR_EXACT_SOLD_FILTER_NOT_PROVEN")
      failure.freeShippingNavigation = freeShippingNavigation
      failure.freeShippingNavigationAttempts = freeShippingNavigationAttempts
      failure.freeShippingNavigationAttemptCount =
        freeShippingNavigationAttemptCount
      failure.freeShippingBranchStatus = freeShippingBranchStatus
      failure.freeShippingBranchError = freeShippingBranchError
      failure.allSoldBranchError = allSoldBranchError
      throw failure
    }
    return { ordinal, searchQuery, rows: [...rowsByItemId.values()],
      soldFilterProven: soldFilterProven || freeShippingFilterProven,
      allSoldBranchError, freeShippingFilterProven,
      freeShippingBranchStatus, freeShippingBranchError,
      freeShippingNavigation, freeShippingNavigationAttempts,
      freeShippingNavigationAttemptCount }
  } finally {
    try { await chrome.tabs.remove(tab.id) } catch { /* owned tab already closed */ }
  }
}

async function runEndedItemDetailTask(row, lease) {
  const itemId = typeof row?.itemId === "string" ? row.itemId.trim() : ""
  if (!/^\d{9,20}$/.test(itemId)) throw new Error("ENDED_ITEM_ID_INVALID")
  const tab = await chrome.tabs.create({
    url: `https://www.ebay.com/itm/${encodeURIComponent(itemId)}`, active: false,
  })
  if (!Number.isInteger(tab?.id)) throw new Error("ENDED_ITEM_TAB_CREATE_FAILED")
  try {
    return await contentCapture({ tabId: tab.id, expiresAt: lease.expiresAt,
      timeoutMs: 12_000, timeoutCode: "ENDED_ITEM_DETAIL_CAPTURE_TIMEOUT",
      message: { type: ENDED_ITEM_DETAIL_CAPTURE, expectedItemId: itemId } })
  } finally {
    try { await chrome.tabs.remove(tab.id) } catch { /* owned tab already closed */ }
  }
}

function mergeEndedItemDetail(row, detail) {
  const sameItem = detail?.listingIdentityStatus === "PROVEN_SAME_ITEM_ID" &&
    detail.itemId === row.itemId
  if (!sameItem) return row
  const endedItemProven = detail.endedItemIdentityStatus ===
    "PROVEN_SAME_ENDED_ITEM"
  const detailSellerProven = detail.sellerIdentityStatus === "PROVEN" &&
    typeof detail.sellerUsername === "string" && detail.sellerUsername.length > 1
  const detailShippingObserved = endedItemProven &&
    detail.shippingStatus === "OBSERVED" &&
    Number.isFinite(Number(detail.visibleShippingAmount))
  const detailDisplayedConfirmed = endedItemProven && detail.displayedPriceStatus ===
    "DISPLAYED_PRICE_CONFIRMED" &&
    Number.isFinite(Number(detail.displayedSoldPriceAmount))
  const detailRealizedConfirmed = endedItemProven && detail.realizedPriceStatus ===
    "REALIZED_PRICE_CONFIRMED" &&
    Number.isFinite(Number(detail.realizedTransactionPriceAmount))
  const bestOfferStatus = row.bestOfferStatus === "EXPLICIT_PRESENT" ||
      detail.bestOfferStatus === "EXPLICIT_PRESENT"
    ? "EXPLICIT_PRESENT" : detail.bestOfferStatus === "EXPLICIT_ABSENT"
      ? "EXPLICIT_ABSENT" : row.bestOfferStatus || "UNKNOWN"
  const fieldProvenance = { ...(row.fieldProvenance || {}) }
  for (const field of ["sellerIdentity", "shipping", "displayedPrice",
    "bestOffer", "realizedPrice"]) {
    const evidence = detail.fieldProvenance?.[field]
    if (["ENDED_ITEM_PUBLIC_DETAIL", "SOLD_ITEM_PUBLIC_DETAIL_SAME_ITEM_ID"]
      .includes(evidence?.source) &&
        evidence.evidenceItemId === row.itemId) fieldProvenance[field] = evidence
  }
  if (row.bestOfferStatus === "EXPLICIT_PRESENT") {
    fieldProvenance.bestOffer = row.fieldProvenance?.bestOffer ??
      fieldProvenance.bestOffer
  }
  const realizedPriceStatus = detailRealizedConfirmed &&
      bestOfferStatus !== "EXPLICIT_PRESENT"
    ? "REALIZED_PRICE_CONFIRMED" : "UNPROVEN"
  return { ...row,
    sellerUsername: detailSellerProven ? detail.sellerUsername : row.sellerUsername,
    sellerProfileUrl: detailSellerProven ? detail.sellerProfileUrl : row.sellerProfileUrl,
    stableSellerIdentity: detailSellerProven
      ? detail.stableSellerIdentity : row.stableSellerIdentity,
    sellerIdentityStatus: detailSellerProven ? "PROVEN" : row.sellerIdentityStatus,
    sellerIdentitySource: detailSellerProven
      ? detail.sellerIdentitySource : row.sellerIdentitySource,
    sellerIdentityKey: detailSellerProven
      ? detail.sellerIdentityKey : row.sellerIdentityKey,
    visibleShippingAmount: detailShippingObserved
      ? Number(detail.visibleShippingAmount) : row.visibleShippingAmount,
    shippingStatus: detailShippingObserved ? "OBSERVED" : row.shippingStatus,
    displayedSoldPriceAmount: detailDisplayedConfirmed
      ? Number(detail.displayedSoldPriceAmount) : row.displayedSoldPriceAmount,
    realizedTransactionPriceAmount: realizedPriceStatus ===
        "REALIZED_PRICE_CONFIRMED"
      ? Number(detail.realizedTransactionPriceAmount) : null,
    realizedTransactionPriceCurrency: realizedPriceStatus ===
      "REALIZED_PRICE_CONFIRMED" ? "USD" : null,
    realizedPriceStatus, bestOfferStatus, fieldProvenance,
    listingIdentityStatus: "PROVEN_SAME_ITEM_ID",
    endedItemIdentityStatus: endedItemProven
      ? "PROVEN_SAME_ENDED_ITEM" : row.endedItemIdentityStatus,
    pricingEligibility: bestOfferStatus === "EXPLICIT_PRESENT" ||
        realizedPriceStatus !== "REALIZED_PRICE_CONFIRMED"
      ? "DISPLAYED_PRICE_NOT_REALIZED"
      : "SUBJECT_TO_COMMERCIAL_IDENTITY_VALIDATION" }
}

async function enrichEndedItemDetails(rows, lease) {
  const unique = []
  const seen = new Set()
  for (const row of rows) {
    if (!/^\d{9,20}$/.test(String(row?.itemId ?? "")) || seen.has(row.itemId)) continue
    seen.add(row.itemId)
    unique.push(row)
    if (unique.length >= MAX_ENDED_ITEM_DETAIL_CAPTURES) break
  }
  const details = new Map()
  const outcomes = new Map()
  let cursor = 0
  const worker = async () => {
    while (cursor < unique.length) {
      const index = cursor
      cursor += 1
      const row = unique[index]
      try {
        const detail = await runEndedItemDetailTask(row, lease)
        details.set(row.itemId, detail)
        outcomes.set(row.itemId, { itemId: row.itemId, status: "COMPLETED",
          error: null,
          listingIdentityStatus: detail.listingIdentityStatus ?? "NOT_PROVEN",
          endedItemIdentityStatus: detail.endedItemIdentityStatus ?? "NOT_PROVEN",
          sellerIdentityStatus: detail.sellerIdentityStatus ?? "UNKNOWN" })
      } catch (error) {
        const errorCode = safeFailureCode(error,
          "ENDED_ITEM_DETAIL_CAPTURE_FAILED")
        details.set(row.itemId, null)
        outcomes.set(row.itemId, { itemId: row.itemId, status: "FAILED",
          error: errorCode, failureClass: enrichmentFailureClass(errorCode),
          listingIdentityStatus: "NOT_PROVEN",
          endedItemIdentityStatus: "NOT_PROVEN",
          sellerIdentityStatus: "UNKNOWN" })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, unique.length) }, () => worker()))
  return { rows: rows.map((row) => mergeEndedItemDetail(row,
      details.get(row.itemId))), outcomes: [...outcomes.values()],
    attemptedCount: unique.length,
    completedCount: [...details.values()].filter((detail) =>
      detail?.listingIdentityStatus === "PROVEN_SAME_ITEM_ID").length }
}

async function runNearExactSoldEnrichment(message) {
  const lease = boundedLease(message.lease)
  const tasks = Array.isArray(message.tasks) ? message.tasks : []
  const remainingRows = Number(message.remainingRows)
  if (!tasks.length || tasks.length > 6 || !Number.isInteger(remainingRows) ||
    remainingRows < 1 || remainingRows > MAX_ROWS) {
    throw new Error("NEAR_EXACT_SOLD_ENRICHMENT_BOUNDS_INVALID")
  }
  const perTaskLimit = Math.max(1, Math.floor(remainingRows / tasks.length))
  const results = []
  let cursor = 0
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      const task = tasks[index]
      try {
        const completed = await runNearExactSoldTask(task, lease, perTaskLimit)
        results[index] = { ...completed, status: "COMPLETED", error: null }
      } catch (error) {
        const errorCode = safeFailureCode(error,
          "NEAR_EXACT_SOLD_TASK_FAILED")
        results[index] = {
          ordinal: Number(task?.ordinal),
          searchQuery: typeof task?.searchQuery === "string"
            ? task.searchQuery.normalize("NFKC").trim().replace(/\s+/g, " ")
              .slice(0, 100)
            : "",
          rows: [], soldFilterProven: false, status: "FAILED",
          error: errorCode,
          failureClass: enrichmentFailureClass(errorCode),
          allSoldBranchError: error?.allSoldBranchError ?? null,
          freeShippingFilterProven: false,
          freeShippingBranchStatus:
            error?.freeShippingBranchStatus ?? "FAILED",
          freeShippingBranchError: error?.freeShippingBranchError ?? null,
          freeShippingNavigation: error?.freeShippingNavigation ??
            error?.navigationEvidence ?? null,
          freeShippingNavigationAttempts:
            error?.freeShippingNavigationAttempts ??
            error?.navigationAttempts ?? [],
          freeShippingNavigationAttemptCount: Number(
            error?.freeShippingNavigationAttemptCount ??
            error?.navigationAttemptCount) || 0,
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, () => worker()))
  const completed = results.filter((result) => result?.status === "COMPLETED")
  const searchRows = completed.flatMap((result) => result.rows).slice(0, remainingRows)
  const endedItemDetails = await enrichEndedItemDetails(searchRows, lease)
  const rows = endedItemDetails.rows
  return { success: true, extensionId: chrome.runtime.id,
    extensionVersion: chrome.runtime.getManifest().version,
    rows, taskOutcomes: results.map((result) => ({ ordinal: result.ordinal,
      searchQuery: result.searchQuery, observedRows: result.rows.length,
      soldFilterProven: result.soldFilterProven, status: result.status,
      allSoldBranchError: result.allSoldBranchError ?? null,
      freeShippingFilterProven: result.freeShippingFilterProven === true,
      freeShippingBranchStatus: result.freeShippingBranchStatus ?? "FAILED",
      freeShippingBranchError: result.freeShippingBranchError ?? null,
      requestedUrl: result.freeShippingNavigation?.requestedUrl ?? null,
      pendingUrl: result.freeShippingNavigation?.pendingUrl ?? null,
      effectiveUrl: result.freeShippingNavigation?.effectiveUrl ?? null,
      tabId: result.freeShippingNavigation?.tabId ?? null,
      documentId: result.freeShippingNavigation?.documentId ?? null,
      navigationStartedAt:
        result.freeShippingNavigation?.navigationStartedAt ?? null,
      navigationCompletedAt:
        result.freeShippingNavigation?.navigationCompletedAt ?? null,
      filterProofStatus:
        result.freeShippingNavigation?.filterProofStatus ?? null,
      navigationRetryCount: Math.max(0,
        (result.freeShippingNavigationAttemptCount ?? 1) - 1),
      error: result.error,
      failureClass: result.status === "FAILED" ? result.failureClass : null })),
    soldFilterProven: completed.length > 0 &&
      completed.every((result) => result.soldFilterProven),
    completedTaskCount: completed.length,
    failedTaskCount: results.length - completed.length,
    endedItemDetailAttemptedCount: endedItemDetails.attemptedCount,
    endedItemDetailCompletedCount: endedItemDetails.completedCount,
    endedItemDetailOutcomes: endedItemDetails.outcomes,
    endedItemDetailBudgetLimit: MAX_ENDED_ITEM_DETAIL_CAPTURES,
    paginationAutomated: true, cookieAccess: false, marketplaceWrites: 0 }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!oneClickAdminSender(sender)) return false
  if (message?.type === ONE_CLICK_PROBE) {
    sendResponse({ success: true, ready: true, extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version,
      bridgeVersionRequired: ADMIN_BRIDGE_VERSION,
      runtimeReachable: true,
      serviceWorkerResponse: "PROBE_ACK",
      serviceWorkerInstanceId: SERVICE_WORKER_INSTANCE_ID,
      persistentCredential: false, cookieAccess: false, marketplaceWrites: 0 })
    return false
  }
  if (![ONE_CLICK_RUN_QUERY, NEAR_EXACT_SOLD_ENRICHMENT]
    .includes(message?.type)) return false
  const operation = message.type === NEAR_EXACT_SOLD_ENRICHMENT
    ? runNearExactSoldEnrichment(message) : runOneClickQuery(message)
  void operation.then(
    (result) => sendResponse(result),
    (error) => sendResponse({ success: false,
      error: safeFailureCode(error, "ONE_CLICK_RESEARCH_QUERY_FAILED"),
      diagnosticTrace: boundedProductResearchTrace(error?.diagnosticTrace),
      cookieAccess: false, marketplaceWrites: 0 }),
  )
  return true
})
