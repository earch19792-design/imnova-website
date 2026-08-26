"use strict"

const ANALYZE_MESSAGE = "IMNOVA_ANALYZE_VISIBLE_EBAY_THUMBNAIL_V1"
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_DECODED_PIXELS = 16_000_000
const ALLOWED_IMAGE_HOST = "i.ebayimg.com"
const ONE_CLICK_PROBE = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_PROBE_V1"
const ONE_CLICK_RUN_QUERY = "IMNOVA_EBAY_ONE_CLICK_RESEARCH_QUERY_V1"
const PRODUCT_RESEARCH_CAPTURE = "IMNOVA_AUTOMATED_PRODUCT_RESEARCH_CAPTURE_V1"
const MAIN_SEARCH_SOLD_CAPTURE = "IMNOVA_AUTOMATED_MAIN_SEARCH_SOLD_CAPTURE_V1"
const ADMIN_ORIGIN = "https://imnova-website-z1qh-canonical-preview.vercel.app"
const ADMIN_PATH = /^\/admin\/ebay\/mobile-review\/?$/
const SESSION_VERSION = "EBAY_ONE_CLICK_RESEARCH_SESSION_V1_2026_08_26"
const SESSION_SCOPE = "EBAY_RESEARCH_CAPTURE_ONLY"
const MAX_RUNTIME_MS = 15 * 60_000
const MAX_QUERIES = 15
const MAX_ROWS = 200
const MAX_PAGES_PER_QUERY = 2
const MAX_RETRIES = 1
const PRODUCT_RESEARCH_DAY_RANGE = 90
const PRODUCT_RESEARCH_PAGE_LIMIT = 50

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
    return sender?.frameId === 0 && url.origin === ADMIN_ORIGIN &&
      ADMIN_PATH.test(url.pathname)
  } catch {
    return false
  }
}

function safeFailureCode(error, fallback) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_:.-]+$/.test(value) ? value : fallback
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

async function contentCapture(input) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < input.timeoutMs) {
    if (Date.now() >= input.expiresAt) throw new Error("ONE_CLICK_RESEARCH_SESSION_EXPIRED")
    try {
      const response = await chrome.tabs.sendMessage(input.tabId, input.message)
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

function productResearchCategoryId(value) {
  const categoryId = String(value ?? "").trim()
  if (!categoryId) return "0"
  if (!/^\d{1,12}$/.test(categoryId)) {
    throw new Error("ONE_CLICK_RESEARCH_CATEGORY_INVALID")
  }
  return categoryId
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

function soldSearchUrl(searchQuery, page) {
  const url = new URL("https://www.ebay.com/sch/i.html")
  url.searchParams.set("_nkw", searchQuery)
  url.searchParams.set("LH_Sold", "1")
  url.searchParams.set("LH_Complete", "1")
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
  const tab = await chrome.tabs.create({
    url: productResearchUrl(searchQuery, categoryId), active: false,
  })
  if (!Number.isInteger(tab?.id)) throw new Error("ONE_CLICK_RESEARCH_TAB_CREATE_FAILED")
  try {
    const productResearch = await contentCapture({
      tabId: tab.id,
      expiresAt: lease.expiresAt,
      timeoutMs: 60_000,
      timeoutCode: "PRODUCT_RESEARCH_AUTOMATED_CAPTURE_TIMEOUT",
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!oneClickAdminSender(sender)) return false
  if (message?.type === ONE_CLICK_PROBE) {
    sendResponse({ success: true, ready: true, extensionId: chrome.runtime.id,
      extensionVersion: chrome.runtime.getManifest().version,
      persistentCredential: false, cookieAccess: false, marketplaceWrites: 0 })
    return false
  }
  if (message?.type !== ONE_CLICK_RUN_QUERY) return false
  void runOneClickQuery(message).then(
    (result) => sendResponse(result),
    (error) => sendResponse({ success: false,
      error: safeFailureCode(error, "ONE_CLICK_RESEARCH_QUERY_FAILED"),
      cookieAccess: false, marketplaceWrites: 0 }),
  )
  return true
})
