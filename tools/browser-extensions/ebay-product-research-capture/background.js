"use strict"

const ANALYZE_MESSAGE = "IMNOVA_ANALYZE_VISIBLE_EBAY_THUMBNAIL_V1"
const MAX_IMAGE_BYTES = 3 * 1024 * 1024
const MAX_DECODED_PIXELS = 16_000_000
const ALLOWED_IMAGE_HOST = "i.ebayimg.com"

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
  let centerX = 0
  let centerY = 0
  const scanStep = Math.max(1, Math.floor(Math.sqrt(total / 3_600)))
  for (let y = 0; y < height; y += scanStep) for (let x = 0; x < width; x += scanStep) {
    const offset = (y * width + x) * 4
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const distance = Math.abs(red - average[0]) + Math.abs(green - average[1]) +
      Math.abs(blue - average[2])
    if (distance > 76) {
      foreground += 1
      centerX += x
      centerY += y
    }
    if (x >= scanStep) {
      const previous = offset - scanStep * 4
      if (Math.abs(red - data[previous]) + Math.abs(green - data[previous + 1]) +
        Math.abs(blue - data[previous + 2]) > 90) transitions += 1
    }
  }
  const scanned = Math.max(1, Math.ceil(width / scanStep) * Math.ceil(height / scanStep))
  return {
    neutralEdgeRatio: neutralEdge / edge.length,
    coloredEdgeRatio: coloredEdge / edge.length,
    foregroundRatio: foreground / scanned,
    transitionRatio: transitions / scanned,
    foregroundCenterX: foreground ? centerX / foreground / width : .5,
    foregroundCenterY: foreground ? centerY / foreground / height : .5,
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
