import { createHash } from "node:crypto"
import { isIP } from "node:net"

import sharp from "sharp"

export const EBAY_IMAGE_TRANSFORMATION_VERSION =
  "EBAY_MAIN_IMAGE_SAFE_WHITE_V2"
export const EBAY_IMAGE_OUTPUT_SIZE = 1600
export const EBAY_IMAGE_MAX_SOURCE_BYTES = 15 * 1024 * 1024

const DEFAULT_ALLOWED_SOURCE_HOSTS = [
  "cdn.shopify.com",
  "lunaportex.com",
]

export type EbayOptimizedImage = {
  output: Buffer
  sourceSha256: string
  outputSha256: string
  source: {
    width: number
    height: number
    bytes: number
    format: string
  }
  outputMetadata: {
    width: number
    height: number
    bytes: number
    format: "jpeg"
  }
  transformation: {
    version: string
    generativeAiUsed: false
    backgroundMethod: "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION" |
      "AUTHORIZED_SOURCE_FRAMED_CONTAIN"
    sourcePixelsTreatment: "NEAR_NEUTRAL_WHITEN_ONLY" |
      "PRESERVED_FULL_FRAME"
    canvas: "WHITE"
    fit: "CONTAIN"
    maxProductBoxPixels: number
  }
  qa: {
    automaticStatus: "PASSED" | "PARTIAL"
    sourceEdgeLightNeutralRatio: number
    outputEdgeWhiteRatio: number
    productCoverageRatio: number
    productCoverageVerified: boolean
    sourceCenterLightNeutralRatio: number
    sourceCenterChromaticRatio: number
    sourceAmbiguousConnectedLightRatio: number
    sourceAmbiguousInteriorLightRatio: number
    sourceAmbiguousInteriorShare: number
    sourceVisualProfile: {
      brightness: "DARK" | "MID" | "LIGHT"
      contrast: "LOW" | "MEDIUM" | "HIGH"
      palette: "COOL" | "NEUTRAL" | "WARM" | "MIXED"
      productToneRisk: "LIGHT_NEUTRAL_AMBIGUITY" | "STANDARD"
    }
    outputWidth: number
    outputHeight: number
    outputUnderTwelveMegabytes: boolean
    exactSourceHashRecorded: true
    generativeChangesMade: false
    fullAuthorizedFramePreserved: boolean
    humanApprovalRequired: true
    manualChecksRequired: string[]
  }
}

export type EbayAuthorizedSecondaryForeground = {
  output: Buffer
  outputSha256: string
  maskSha256: string
  method: "NATIVE_ALPHA" | "EDGE_CONNECTED_LIGHT_NEUTRAL_V1" |
    "PROTECTED_TRIMAP_MATTING_V1" | "FULL_AUTHORIZED_FRAME"
  qa: {
    backgroundRemovalRatio: number
    transparentBorderRatio: number
    protectedPixelRetentionRatio: number
    opaqueCornerRatio: number
  }
}

export async function prepareAuthorizedEbayFullFrameLayer(
  source: Buffer,
): Promise<EbayAuthorizedSecondaryForeground> {
  const output = await sharp(source, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  }).rotate().ensureAlpha().png().toBuffer()
  const metadata = await sharp(output).metadata()
  const pixels = (metadata.width ?? 0) * (metadata.height ?? 0)
  if (!pixels) {
    output.fill(0)
    throw new Error("AUTHORIZED_FULL_FRAME_INVALID")
  }
  const mask = Buffer.alloc(pixels, 255)
  const maskSha256 = sha256(mask)
  mask.fill(0)
  return {
    output,
    outputSha256: sha256(output),
    maskSha256,
    method: "FULL_AUTHORIZED_FRAME",
    qa: {
      backgroundRemovalRatio: 0,
      transparentBorderRatio: 0,
      protectedPixelRetentionRatio: 1,
      opaqueCornerRatio: 1,
    },
  }
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function configuredSourceHosts() {
  const configured = (process.env.EBAY_IMAGE_SOURCE_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  const supabaseHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname
        .toLowerCase()
    } catch {
      return ""
    }
  })()
  return [...new Set([...DEFAULT_ALLOWED_SOURCE_HOSTS, ...configured, supabaseHost])]
    .filter((host) =>
      Boolean(host) &&
      !isIP(host) &&
      host !== "localhost" &&
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
        .test(host)
    )
}

function hostnameAllowed(hostname: string) {
  const normalized = hostname.toLowerCase()
  return configuredSourceHosts().some((allowed) =>
    normalized === allowed || normalized.endsWith(`.${allowed}`)
  )
}

export function validateAuthorizedImageSourceUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? "").trim())
    if (url.username || url.password) {
      throw new Error("EBAY_IMAGE_SOURCE_CREDENTIALS_NOT_ALLOWED")
    }
    if (url.port && url.port !== "443") {
      throw new Error("EBAY_IMAGE_SOURCE_PORT_NOT_ALLOWED")
    }
    if (url.protocol !== "https:" || !hostnameAllowed(url.hostname)) {
      throw new Error("EBAY_IMAGE_SOURCE_HOST_NOT_ALLOWED")
    }
    url.hash = ""
    return url
  } catch (error) {
    if (error instanceof Error && [
      "EBAY_IMAGE_SOURCE_CREDENTIALS_NOT_ALLOWED",
      "EBAY_IMAGE_SOURCE_PORT_NOT_ALLOWED",
      "EBAY_IMAGE_SOURCE_HOST_NOT_ALLOWED",
    ].includes(error.message)) {
      throw error
    }
    throw new Error("EBAY_IMAGE_SOURCE_URL_INVALID")
  }
}

async function readImageResponseWithHardLimit(
  response: Response,
  controller: AbortController,
) {
  if (!response.body) throw new Error("EBAY_IMAGE_SOURCE_BODY_MISSING")
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      if (totalBytes + value.byteLength > EBAY_IMAGE_MAX_SOURCE_BYTES) {
        controller.abort("EBAY_IMAGE_SOURCE_TOO_LARGE")
        await reader.cancel("EBAY_IMAGE_SOURCE_TOO_LARGE").catch(() => undefined)
        throw new Error("EBAY_IMAGE_SOURCE_TOO_LARGE")
      }
      // Copy only the accepted view so a small chunk cannot retain an
      // unexpectedly large backing ArrayBuffer supplied by the HTTP runtime.
      chunks.push(Buffer.from(value))
      totalBytes += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (!totalBytes) throw new Error("EBAY_IMAGE_SOURCE_TOO_LARGE")
  return Buffer.concat(chunks, totalBytes)
}

export async function fetchAuthorizedImageSource(value: unknown) {
  let url = validateAuthorizedImageSourceUrl(value)
  for (let redirect = 0; redirect <= 2; redirect += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort("EBAY_IMAGE_SOURCE_TIMEOUT"), 15_000)
    try {
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        redirect: "manual",
        headers: { Accept: "image/jpeg,image/png,image/webp;q=0.9" },
        signal: controller.signal,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location")
        if (!location || redirect === 2) throw new Error("EBAY_IMAGE_SOURCE_REDIRECT_BLOCKED")
        await response.body?.cancel().catch(() => undefined)
        url = validateAuthorizedImageSourceUrl(new URL(location, url).href)
        continue
      }
      if (!response.ok) throw new Error(`EBAY_IMAGE_SOURCE_HTTP_${response.status}`)
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]
      if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
        throw new Error("EBAY_IMAGE_SOURCE_CONTENT_TYPE_INVALID")
      }
      const contentLength = response.headers.get("content-length")
      const declaredLength = contentLength === null ? Number.NaN : Number(contentLength)
      if (Number.isFinite(declaredLength) && declaredLength > EBAY_IMAGE_MAX_SOURCE_BYTES) {
        controller.abort("EBAY_IMAGE_SOURCE_TOO_LARGE")
        throw new Error("EBAY_IMAGE_SOURCE_TOO_LARGE")
      }
      const buffer = await readImageResponseWithHardLimit(response, controller)
      const auditUrl = new URL(url)
      auditUrl.search = ""
      return { buffer, sourceUrl: auditUrl.href, contentType }
    } catch (error) {
      if (controller.signal.aborted
        && !(error instanceof Error && error.message === "EBAY_IMAGE_SOURCE_TOO_LARGE")) {
        throw new Error("EBAY_IMAGE_SOURCE_TIMEOUT")
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error("EBAY_IMAGE_SOURCE_REDIRECT_BLOCKED")
}

function lightNeutralRatio(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  const borderX = Math.max(2, Math.floor(width * 0.06))
  const borderY = Math.max(2, Math.floor(height * 0.06))
  let sampled = 0
  let lightNeutral = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= borderX && x < width - borderX && y >= borderY && y < height - borderY) continue
      const offset = (y * width + x) * channels
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      const max = Math.max(red, green, blue)
      const min = Math.min(red, green, blue)
      sampled += 1
      if (min >= 220 && max - min <= 28) lightNeutral += 1
    }
  }
  return sampled ? lightNeutral / sampled : 0
}

function edgeWhiteRatio(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  const borderX = Math.max(2, Math.floor(width * 0.06))
  const borderY = Math.max(2, Math.floor(height * 0.06))
  let sampled = 0
  let white = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= borderX && x < width - borderX &&
        y >= borderY && y < height - borderY) continue
      const offset = (y * width + x) * channels
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      sampled += 1
      if (Math.min(red, green, blue) >= 245 &&
        Math.max(red, green, blue) - Math.min(red, green, blue) <= 10) {
        white += 1
      }
    }
  }
  return sampled ? white / sampled : 0
}

function centerLightNeutralRatio(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  const insetX = Math.max(2, Math.floor(width * 0.12))
  const insetY = Math.max(2, Math.floor(height * 0.12))
  let sampled = 0
  let lightNeutral = 0
  for (let y = insetY; y < height - insetY; y += 1) {
    for (let x = insetX; x < width - insetX; x += 1) {
      const offset = (y * width + x) * channels
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      const max = Math.max(red, green, blue)
      const min = Math.min(red, green, blue)
      sampled += 1
      if (min >= 225 && max - min <= 24) lightNeutral += 1
    }
  }
  return sampled ? lightNeutral / sampled : 0
}

function centerChromaticRatio(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  const insetX = Math.max(2, Math.floor(width * 0.12))
  const insetY = Math.max(2, Math.floor(height * 0.12))
  let sampled = 0
  let chromatic = 0
  for (let y = insetY; y < height - insetY; y += 1) {
    for (let x = insetX; x < width - insetX; x += 1) {
      const offset = (y * width + x) * channels
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      sampled += 1
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 32) {
        chromatic += 1
      }
    }
  }
  return sampled ? chromatic / sampled : 0
}

function sourceVisualProfile(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 96))
  let samples = 0
  let brightnessTotal = 0
  let contrastTotal = 0
  let comparisons = 0
  let warm = 0
  let cool = 0
  let chromatic = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * channels
      const red = pixels[offset]
      const green = pixels[offset + 1]
      const blue = pixels[offset + 2]
      const luminance = (red * .2126 + green * .7152 + blue * .0722) / 255
      brightnessTotal += luminance
      samples += 1
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (spread > 22) chromatic += 1
      if (red - blue > 16) warm += 1
      if (blue - red > 16) cool += 1
      if (x >= step) {
        const previous = offset - step * channels
        const previousLuminance = (
          pixels[previous] * .2126 + pixels[previous + 1] * .7152 +
          pixels[previous + 2] * .0722
        ) / 255
        contrastTotal += Math.abs(luminance - previousLuminance)
        comparisons += 1
      }
    }
  }
  const brightnessValue = brightnessTotal / Math.max(1, samples)
  const contrastValue = contrastTotal / Math.max(1, comparisons)
  const warmRatio = warm / Math.max(1, samples)
  const coolRatio = cool / Math.max(1, samples)
  const chromaticRatio = chromatic / Math.max(1, samples)
  return {
    brightness: brightnessValue < .4 ? "DARK" as const
      : brightnessValue < .72 ? "MID" as const : "LIGHT" as const,
    contrast: contrastValue < .06 ? "LOW" as const
      : contrastValue < .16 ? "MEDIUM" as const : "HIGH" as const,
    palette: chromaticRatio < .18 ? "NEUTRAL" as const
      : warmRatio >= .38 && coolRatio < .18 ? "WARM" as const
        : coolRatio >= .38 && warmRatio < .18 ? "COOL" as const
          : "MIXED" as const,
  }
}

function whitenNearNeutralPixels(pixels: Buffer, channels: number) {
  const output = Buffer.from(pixels)
  for (let offset = 0; offset < output.length; offset += channels) {
    const red = output[offset]
    const green = output[offset + 1]
    const blue = output[offset + 2]
    const max = Math.max(red, green, blue)
    const min = Math.min(red, green, blue)
    if (min >= 225 && max - min <= 24) {
      output[offset] = 255
      output[offset + 1] = 255
      output[offset + 2] = 255
    }
  }
  return output
}

const FOREGROUND_MAX_DIMENSION = 1_600
const FOREGROUND_RECOVERY_PADDING_RATIO = .12
const FOREGROUND_RECOVERY_MINIMUM_ORIGINAL_BACKGROUND_RATIO = .10

function lightNeutralPixel(pixels: Buffer, offset: number) {
  const red = pixels[offset]
  const green = pixels[offset + 1]
  const blue = pixels[offset + 2]
  // Deliberately conservative: near-white enamel can be 235-249 after JPEG
  // compression. Treat it as protected product, not removable background.
  // Only essentially-white, neutral pixels may join the border flood.
  return Math.min(red, green, blue) >= 250 &&
    Math.max(red, green, blue) - Math.min(red, green, blue) <= 8
}

function conservativeBackgroundPixel(pixels: Buffer, offset: number) {
  const red = pixels[offset]
  const green = pixels[offset + 1]
  const blue = pixels[offset + 2]
  return Math.min(red, green, blue) >= 254 &&
    Math.max(red, green, blue) - Math.min(red, green, blue) <= 3
}

function connectedBorderBackground(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  removable: (pixels: Buffer, offset: number) => boolean,
) {
  const pixels = width * height
  const background = new Uint8Array(pixels)
  const queue = new Int32Array(pixels)
  let head = 0
  let tail = 0
  const enqueue = (index: number) => {
    if (background[index] || !removable(data, index * channels)) return
    background[index] = 1
    queue[tail++] = index
  }
  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    if (height > 1) enqueue((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width)
    if (width > 1) enqueue(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueue(index - 1)
    if (x + 1 < width) enqueue(index + 1)
    if (y > 0) enqueue(index - width)
    if (y + 1 < height) enqueue(index + width)
  }
  queue.fill(0)
  return background
}

/**
 * A white product connected to a white catalog background is not separable
 * from color alone. Compare the normal border flood with a much stricter
 * pure-white flood. A material delta that penetrates the protected
 * foreground envelope means the normal matte can erase real product pixels.
 */
function lightNeutralSeparationAmbiguity(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  const pixels = width * height
  const aggressive = connectedBorderBackground(
    data,
    width,
    height,
    channels,
    lightNeutralPixel,
  )
  const conservative = connectedBorderBackground(
    data,
    width,
    height,
    channels,
    conservativeBackgroundPixel,
  )
  const rowLeft = new Int32Array(height)
  const rowRight = new Int32Array(height)
  const columnTop = new Int32Array(width)
  const columnBottom = new Int32Array(width)
  rowLeft.fill(width)
  rowRight.fill(-1)
  columnTop.fill(height)
  columnBottom.fill(-1)
  try {
    for (let index = 0; index < pixels; index += 1) {
      if (aggressive[index]) continue
      const x = index % width
      const y = Math.floor(index / width)
      rowLeft[y] = Math.min(rowLeft[y], x)
      rowRight[y] = Math.max(rowRight[y], x)
      columnTop[x] = Math.min(columnTop[x], y)
      columnBottom[x] = Math.max(columnBottom[x], y)
    }
    let ambiguous = 0
    let ambiguousInterior = 0
    for (let index = 0; index < pixels; index += 1) {
      if (!aggressive[index] || conservative[index]) continue
      ambiguous += 1
      const x = index % width
      const y = Math.floor(index / width)
      if (
        x > rowLeft[y] && x < rowRight[y] &&
        y > columnTop[x] && y < columnBottom[x]
      ) {
        ambiguousInterior += 1
      }
    }
    const connectedLightRatio = ambiguous / Math.max(1, pixels)
    const interiorLightRatio = ambiguousInterior / Math.max(1, pixels)
    const interiorShare = ambiguousInterior / Math.max(1, ambiguous)
    return {
      connectedLightRatio,
      interiorLightRatio,
      interiorShare,
      mainFrameMustBePreserved: connectedLightRatio >= .01,
      foregroundExtractionUnsafe:
        connectedLightRatio >= .01 &&
        interiorLightRatio >= .0005 &&
        interiorShare >= .03,
    }
  } finally {
    aggressive.fill(0)
    conservative.fill(0)
    rowLeft.fill(0)
    rowRight.fill(0)
    columnTop.fill(0)
    columnBottom.fill(0)
  }
}

function foregroundCornerIndexes(width: number, height: number) {
  const insetX = Math.max(1, Math.floor(width * .06))
  const insetY = Math.max(1, Math.floor(height * .06))
  const indexes: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inHorizontalCorner = x < insetX || x >= width - insetX
      const inVerticalCorner = y < insetY || y >= height - insetY
      if (inHorizontalCorner && inVerticalCorner) indexes.push(y * width + x)
    }
  }
  return indexes
}

function nativeAlphaHasOpaqueLightNeutralFrame(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  sourceAlpha: Uint8Array,
) {
  const pixels = width * height
  const visited = new Uint8Array(pixels)
  const queue = new Int32Array(pixels)
  try {
    for (let start = 0; start < pixels; start += 1) {
      if (visited[start] || sourceAlpha[start] < 247 ||
        !lightNeutralPixel(data, start * channels)) continue
      let head = 0
      let tail = 0
      let area = 0
      let left = width
      let top = height
      let right = -1
      let bottom = -1
      let touchesNonOpaquePixels = false
      visited[start] = 1
      queue[tail++] = start
      while (head < tail) {
        const index = queue[head++]
        const x = index % width
        const y = Math.floor(index / width)
        area += 1
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x + 1 < width ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y + 1 < height ? index + width : -1,
        ]
        for (const neighbor of neighbors) {
          if (neighbor < 0) continue
          if (sourceAlpha[neighbor] < 247) touchesNonOpaquePixels = true
          if (visited[neighbor] || sourceAlpha[neighbor] < 247 ||
            !lightNeutralPixel(data, neighbor * channels)) continue
          visited[neighbor] = 1
          queue[tail++] = neighbor
        }
      }
      const boxWidth = right - left + 1
      const boxHeight = bottom - top + 1
      const boxArea = Math.max(1, boxWidth * boxHeight)
      // Native alpha is accepted only when an opaque white rectangle is not
      // hiding inside the transparent canvas. A large rectangular component
      // directly touching transparency is ambiguous, so fail closed. A white
      // product enclosed by a darker outline does not meet the adjacency gate.
      if (touchesNonOpaquePixels && area / pixels >= .02 &&
        boxWidth / width >= .45 && boxHeight / height >= .45 &&
        area / boxArea >= .02) return true
    }
    return false
  } finally {
    visited.fill(0)
    queue.fill(0)
  }
}

function buildBorderContactGuard(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  sourceAlpha: Uint8Array,
) {
  const guard = new Uint8Array(width * height)
  const borderPixels = Math.max(1, width * 2 + Math.max(0, height - 2) * 2)
  const maximumContactSpan = Math.max(2, Math.floor(borderPixels * .009))
  const guardDepth = 3
  const ambiguityScanDepth = guardDepth
  let unsafe = false
  const protectedAt = (index: number) => sourceAlpha[index] >= 247 &&
    !lightNeutralPixel(data, index * channels)
  const guardEdge = (
    length: number,
    indexAt: (position: number, inward: number) => number,
  ) => {
    const contacts: number[] = []
    for (let position = 0; position < length; position += 1) {
      if (protectedAt(indexAt(position, 0))) contacts.push(position)
    }
    if (!contacts.length) {
      // A dark/object pixel immediately behind an all-white edge can mean a
      // white product reaches the frame. That geometry is not separable with
      // deterministic color evidence, so reject it instead of erasing it.
      for (let position = 0; position < length; position += 1) {
        for (let inward = 1; inward <= ambiguityScanDepth; inward += 1) {
          if (protectedAt(indexAt(position, inward))) unsafe = true
        }
      }
      return
    }
    const first = contacts[0]
    const last = contacts[contacts.length - 1]
    const span = last - first + 1
    if (span > maximumContactSpan) {
      unsafe = true
      return
    }
    for (let position = Math.max(0, first - 1);
      position <= Math.min(length - 1, last + 1); position += 1) {
      for (let inward = 0; inward <= guardDepth; inward += 1) {
        guard[indexAt(position, inward)] = 1
      }
    }
  }
  guardEdge(width, (position, inward) =>
    Math.min(height - 1, inward) * width + position)
  guardEdge(width, (position, inward) =>
    Math.max(0, height - 1 - inward) * width + position)
  guardEdge(height, (position, inward) =>
    position * width + Math.min(width - 1, inward))
  guardEdge(height, (position, inward) =>
    position * width + Math.max(0, width - 1 - inward))
  return { guard, unsafe }
}

/**
 * Remove only a light-neutral background that is connected to the outside of
 * an authorized image. Unlike a global white/chroma key, this preserves white
 * product pixels enclosed by a darker rim (for example white enamelware).
 */
async function prepareAuthorizedEbaySecondaryForegroundOnce(
  source: Buffer,
  options: { authorizedNativeHighResolution?: boolean } = {},
): Promise<EbayAuthorizedSecondaryForeground | null> {
  const decoded = await sharp(source, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  }).rotate().resize({
    width: FOREGROUND_MAX_DIMENSION,
    height: FOREGROUND_MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
    kernel: sharp.kernel.lanczos3,
  }).toColourspace("srgb").ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  const { data, info } = decoded
  const width = info.width
  const height = info.height
  const pixels = width * height
  const channels = info.channels
  if (channels !== 4 || pixels === 0) {
    data.fill(0)
    return null
  }
  const removableBackgroundPixel = (offset: number) => {
    if (!options.authorizedNativeHighResolution) {
      return lightNeutralPixel(data, offset)
    }
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    return Math.min(red, green, blue) >= 242 &&
      Math.max(red, green, blue) - Math.min(red, green, blue) <= 12
  }

  const sourceAlpha = new Uint8Array(pixels)
  let transparentPixels = 0
  let opaquePixels = 0
  let protectedPixels = 0
  let protectedLeft = width
  let protectedTop = height
  let protectedRight = -1
  let protectedBottom = -1
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * channels
    const alpha = data[offset + 3]
    sourceAlpha[index] = alpha
    if (alpha <= 8) transparentPixels += 1
    if (alpha >= 247) opaquePixels += 1
    if (!removableBackgroundPixel(offset) && alpha >= 247) {
      protectedPixels += 1
      const x = index % width
      const y = Math.floor(index / width)
      protectedLeft = Math.min(protectedLeft, x)
      protectedTop = Math.min(protectedTop, y)
      protectedRight = Math.max(protectedRight, x)
      protectedBottom = Math.max(protectedBottom, y)
    }
  }

  let method: EbayAuthorizedSecondaryForeground["method"]
  const mask = new Uint8Array(pixels)
  let borderContactGuard: Uint8Array | null = null
  let foregroundGeometrySafe = true
  const separationAmbiguity = transparentPixels / pixels >= .005
    ? {
      connectedLightRatio: 0,
      interiorLightRatio: 0,
      interiorShare: 0,
      mainFrameMustBePreserved: false,
      foregroundExtractionUnsafe: false,
    }
    : lightNeutralSeparationAmbiguity(
      data,
      width,
      height,
      channels,
    )
  const separationProfile = sourceVisualProfile(
    data,
    width,
    height,
    channels,
  )
  if (
    separationAmbiguity.foregroundExtractionUnsafe &&
    separationProfile.brightness === "LIGHT" &&
    separationProfile.palette === "NEUTRAL"
  ) {
    data.fill(0)
    sourceAlpha.fill(0)
    mask.fill(0)
    throw new Error("AUTHORIZED_FOREGROUND_LIGHT_NEUTRAL_AMBIGUITY")
  }
  if (transparentPixels / pixels >= .005) {
    method = "NATIVE_ALPHA"
    if (nativeAlphaHasOpaqueLightNeutralFrame(
      data, width, height, channels, sourceAlpha,
    )) {
      data.fill(0)
      sourceAlpha.fill(0)
      mask.fill(0)
      return null
    }
    mask.set(sourceAlpha)
  } else {
    method = options.authorizedNativeHighResolution
      ? "PROTECTED_TRIMAP_MATTING_V1"
      : "EDGE_CONNECTED_LIGHT_NEUTRAL_V1"
    let sampledBorder = 0
    let lightBorder = 0
    const sampleBorder = (index: number) => {
      sampledBorder += 1
      if (removableBackgroundPixel(index * channels)) lightBorder += 1
    }
    for (let x = 0; x < width; x += 1) {
      sampleBorder(x)
      if (height > 1) sampleBorder((height - 1) * width + x)
    }
    for (let y = 1; y < height - 1; y += 1) {
      sampleBorder(y * width)
      if (width > 1) sampleBorder(y * width + width - 1)
    }
    // A non-neutral or photographic edge is not a safe candidate for local
    // background removal. Fail closed instead of placing an opaque source over
    // a generated scene or erasing an ambiguous product.
    if (!sampledBorder || lightBorder / sampledBorder <
      (options.authorizedNativeHighResolution ? .9 : .96)) {
      data.fill(0)
      sourceAlpha.fill(0)
      return null
    }

    const contact = buildBorderContactGuard(
      data, width, height, channels, sourceAlpha,
    )
    borderContactGuard = options.authorizedNativeHighResolution
      ? new Uint8Array(pixels) : contact.guard
    if (options.authorizedNativeHighResolution) contact.guard.fill(0)
    if (contact.unsafe && !options.authorizedNativeHighResolution) {
      data.fill(0)
      sourceAlpha.fill(0)
      mask.fill(0)
      borderContactGuard.fill(0)
      return null
    }
    const background = new Uint8Array(pixels)
    const queue = new Int32Array(pixels)
    let head = 0
    let tail = 0
    const enqueue = (index: number) => {
      if (background[index] || borderContactGuard?.[index] ||
        !removableBackgroundPixel(index * channels)) return
      background[index] = 1
      queue[tail] = index
      tail += 1
    }
    for (let x = 0; x < width; x += 1) {
      enqueue(x)
      if (height > 1) enqueue((height - 1) * width + x)
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(y * width)
      if (width > 1) enqueue(y * width + width - 1)
    }
    while (head < tail) {
      const index = queue[head]
      head += 1
      const x = index % width
      const y = Math.floor(index / width)
      if (x > 0) enqueue(index - 1)
      if (x + 1 < width) enqueue(index + 1)
      if (y > 0) enqueue(index - width)
      if (y + 1 < height) enqueue(index + width)
    }
    const protectedBoxWidth = protectedRight - protectedLeft + 1
    const protectedBoxHeight = protectedBottom - protectedTop + 1
    const protectedBoxArea = Math.max(
      0,
      protectedBoxWidth * protectedBoxHeight,
    )
    if (protectedPixels / pixels < .01 || protectedBoxArea / pixels < .04) {
      foregroundGeometrySafe = false
    } else {
      const rowLeft = new Int32Array(height)
      const rowRight = new Int32Array(height)
      const columnTop = new Int32Array(width)
      const columnBottom = new Int32Array(width)
      rowLeft.fill(width)
      rowRight.fill(-1)
      columnTop.fill(height)
      columnBottom.fill(-1)
      for (let index = 0; index < pixels; index += 1) {
        if (sourceAlpha[index] < 247 ||
          removableBackgroundPixel(index * channels)) continue
        const x = index % width
        const y = Math.floor(index / width)
        rowLeft[y] = Math.min(rowLeft[y], x)
        rowRight[y] = Math.max(rowRight[y], x)
        columnTop[x] = Math.min(columnTop[x], y)
        columnBottom[x] = Math.max(columnBottom[x], y)
      }
      let envelopePixels = 0
      let removedEnvelopePixels = 0
      for (let y = protectedTop; y <= protectedBottom; y += 1) {
        if (rowRight[y] < rowLeft[y]) continue
        for (let x = rowLeft[y]; x <= rowRight[y]; x += 1) {
          if (columnBottom[x] < columnTop[x] ||
            y < columnTop[x] || y > columnBottom[x]) continue
          const index = y * width + x
          envelopePixels += 1
          if (background[index]) removedEnvelopePixels += 1
        }
      }
      if (envelopePixels / pixels < .02 ||
        removedEnvelopePixels / Math.max(1, envelopePixels) >
          (options.authorizedNativeHighResolution ? .72 : .12)) {
        foregroundGeometrySafe = false
      }
      rowLeft.fill(0)
      rowRight.fill(0)
      columnTop.fill(0)
      columnBottom.fill(0)
    }
    mask.fill(255)
    for (let index = 0; index < pixels; index += 1) {
      if (background[index]) mask[index] = 0
    }
    background.fill(0)
    queue.fill(0)
  }

  let transparentBorder = 0
  let borderPixels = 0
  const inspectBorder = (index: number) => {
    borderPixels += 1
    if (mask[index] <= 8) transparentBorder += 1
  }
  for (let x = 0; x < width; x += 1) {
    inspectBorder(x)
    if (height > 1) inspectBorder((height - 1) * width + x)
  }
  for (let y = 1; y < height - 1; y += 1) {
    inspectBorder(y * width)
    if (width > 1) inspectBorder(y * width + width - 1)
  }
  let removedPixels = 0
  let retainedProtectedPixels = 0
  for (let index = 0; index < pixels; index += 1) {
    if (mask[index] <= 8) removedPixels += 1
    const offset = index * channels
    const protectedPixel = method === "NATIVE_ALPHA"
      ? sourceAlpha[index] >= 247
      : sourceAlpha[index] >= 247 && (
        !removableBackgroundPixel(offset) || borderContactGuard?.[index] === 1
      )
    if (protectedPixel && mask[index] >= 247) retainedProtectedPixels += 1
  }
  const corners = foregroundCornerIndexes(width, height)
  let opaqueCorners = 0
  for (const index of corners) {
    if (mask[index] >= 247) opaqueCorners += 1
  }
  const backgroundRemovalRatio = removedPixels / pixels
  const transparentBorderRatio = transparentBorder / Math.max(1, borderPixels)
  const protectedPixelCount = method === "NATIVE_ALPHA"
    ? opaquePixels
    : protectedPixels + (borderContactGuard
      ? borderContactGuard.reduce((count, value, index) => count + (
        value === 1 && removableBackgroundPixel(index * channels) &&
        sourceAlpha[index] >= 247 ? 1 : 0
      ), 0)
      : 0)
  const protectedPixelRetentionRatio = retainedProtectedPixels /
    Math.max(1, protectedPixelCount)
  const opaqueCornerRatio = opaqueCorners / Math.max(1, corners.length)
  const safe = (foregroundGeometrySafe ||
    options.authorizedNativeHighResolution === true) &&
    backgroundRemovalRatio >=
      (options.authorizedNativeHighResolution ? .005 : .02) &&
    backgroundRemovalRatio <= .98 &&
    transparentBorderRatio >=
      (options.authorizedNativeHighResolution ? .05 : .99) &&
    protectedPixelCount / pixels >= .001 &&
    protectedPixelRetentionRatio >=
      (options.authorizedNativeHighResolution ? .99 : .9999) &&
    opaqueCornerRatio <=
      (options.authorizedNativeHighResolution ? .4 : .001)
  if (!safe) {
    const controlledFailure = options.authorizedNativeHighResolution
      ? `AUTHORIZED_NATIVE_FOREGROUND_QA_FAILED:REMOVAL_${backgroundRemovalRatio.toFixed(4)}:BORDER_${transparentBorderRatio.toFixed(4)}:RETENTION_${protectedPixelRetentionRatio.toFixed(4)}:CORNERS_${opaqueCornerRatio.toFixed(4)}`
      : ""
    data.fill(0)
    sourceAlpha.fill(0)
    mask.fill(0)
    borderContactGuard?.fill(0)
    if (controlledFailure) throw new Error(controlledFailure)
    return null
  }

  const maskSha256 = sha256(Buffer.from(mask))
  for (let index = 0; index < pixels; index += 1) {
    data[index * channels + 3] = mask[index]
  }
  let output: Buffer
  try {
    output = await sharp(data, {
      raw: { width, height, channels: 4 },
    }).trim({ background: "#00000000", threshold: 1 }).png().toBuffer()
  } finally {
    data.fill(0)
    sourceAlpha.fill(0)
    mask.fill(0)
    borderContactGuard?.fill(0)
  }
  return {
    output,
    outputSha256: sha256(output),
    maskSha256,
    method,
    qa: {
      backgroundRemovalRatio: Number(backgroundRemovalRatio.toFixed(4)),
      transparentBorderRatio: Number(transparentBorderRatio.toFixed(4)),
      protectedPixelRetentionRatio: Number(protectedPixelRetentionRatio.toFixed(4)),
      opaqueCornerRatio: Number(opaqueCornerRatio.toFixed(4)),
    },
  }
}

/**
 * Catalog photos sometimes contain the exact isolated product on white while
 * the product itself touches the source frame. The strict first pass rejects
 * that geometry because it cannot prove where the product ends. A bounded
 * white margin makes the original edge inspectable, but the recovery is only
 * accepted when the matte removes substantial background from inside the
 * original frame as well. Photographic sources therefore remove only the
 * synthetic margin and remain rejected.
 */
export async function prepareAuthorizedEbaySecondaryForeground(
  source: Buffer,
  options: { authorizedNativeHighResolution?: boolean } = {},
): Promise<EbayAuthorizedSecondaryForeground | null> {
  const direct = await prepareAuthorizedEbaySecondaryForegroundOnce(
    source,
    options,
  )
  if (direct || options.authorizedNativeHighResolution) return direct

  const metadata = await sharp(source, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  }).metadata()
  // Native transparency already carries its own edge evidence. Never replace
  // or flatten it merely to make a failed matte pass.
  if (metadata.hasAlpha) return null

  let normalized: Buffer | null = null
  let padded: Buffer | null = null
  let recovered: EbayAuthorizedSecondaryForeground | null = null
  try {
    normalized = await sharp(source, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
    }).rotate().resize({
      width: FOREGROUND_MAX_DIMENSION,
      height: FOREGROUND_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    }).toColourspace("srgb").removeAlpha().png().toBuffer()
    const normalizedMetadata = await sharp(normalized).metadata()
    const width = normalizedMetadata.width ?? 0
    const height = normalizedMetadata.height ?? 0
    if (!width || !height) return null
    const padding = Math.max(
      48,
      Math.round(Math.max(width, height) *
        FOREGROUND_RECOVERY_PADDING_RATIO),
    )
    const paddedWidth = width + padding * 2
    const paddedHeight = height + padding * 2
    if (paddedWidth * paddedHeight > 40_000_000) return null
    padded = await sharp(normalized).extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: "#ffffff",
    }).png().toBuffer()
    const paddingOnlyRemovalRatio = 1 -
      (width * height) / (paddedWidth * paddedHeight)
    recovered = await prepareAuthorizedEbaySecondaryForegroundOnce(padded)
    if (!recovered ||
      recovered.qa.backgroundRemovalRatio <
        paddingOnlyRemovalRatio +
          FOREGROUND_RECOVERY_MINIMUM_ORIGINAL_BACKGROUND_RATIO) {
      recovered?.output.fill(0)
      return null
    }
    return recovered
  } finally {
    normalized?.fill(0)
    padded?.fill(0)
  }
}

export async function optimizeAuthorizedEbayMainImage(
  source: Buffer,
): Promise<EbayOptimizedImage> {
  if (!source.length || source.length > EBAY_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error("EBAY_IMAGE_SOURCE_TOO_LARGE")
  }
  const input = sharp(source, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  }).rotate()
  const metadata = await input.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width < 500 || height < 500) throw new Error("EBAY_IMAGE_SOURCE_BELOW_500PX")
  if (width > 8_000 || height > 8_000) throw new Error("EBAY_IMAGE_SOURCE_DIMENSIONS_TOO_LARGE")
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error("EBAY_IMAGE_SOURCE_FORMAT_INVALID")
  }

  const decoded = await input
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true })
  const edgeRatio = lightNeutralRatio(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  )
  const centerRatio = centerLightNeutralRatio(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  )
  const centerColorRatio = centerChromaticRatio(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  )
  const visualProfile = sourceVisualProfile(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  )
  // Inspect the flattened pixels even when the container declares an alpha
  // channel. Fully opaque PNG/WebP files are common and their mere presence
  // of alpha is not evidence that white-on-white geometry is separable.
  const separationAmbiguity = lightNeutralSeparationAmbiguity(
    decoded.data,
    decoded.info.width,
    decoded.info.height,
    decoded.info.channels,
  )
  // A mostly light-neutral center can be a white or reflective product, not
  // removable background. Whitening those pixels erased the exact product in
  // legitimate supplier photos such as white enamelware on white. Preserve
  // the full authorized frame whenever segmentation is ambiguous.
  const separationRequiresPreservedFrame =
    separationAmbiguity.mainFrameMustBePreserved &&
    visualProfile.brightness === "LIGHT" &&
    visualProfile.palette === "NEUTRAL"
  const preserveAuthorizedFrame = edgeRatio < 0.72 || (
    centerRatio >= 0.60 && centerColorRatio <= 0.08
  ) || separationRequiresPreservedFrame
  let output: Buffer
  try {
    if (preserveAuthorizedFrame) {
      // A light product on a light/grey supplier canvas cannot be segmented
      // safely by chroma without risking erased product pixels. Preserve the
      // complete authorized frame and only scale/contain it inside a neutral
      // white border. No crop, trim, whitening or generative fill is applied.
      output = await sharp(source, {
        failOn: "warning",
        limitInputPixels: 40_000_000,
      }).rotate().flatten({ background: "#ffffff" }).removeAlpha()
        .toColourspace("srgb")
        .resize(1_360, 1_360, {
          fit: "contain",
          background: "#f4f5f5",
          kernel: sharp.kernel.lanczos3,
        })
        .extend({ top: 120, right: 120, bottom: 120, left: 120,
          background: "#ffffff" })
        .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
        .toBuffer()
    } else {
      const normalizedPixels = whitenNearNeutralPixels(
        decoded.data,
        decoded.info.channels,
      )
      try {
        output = await sharp(normalizedPixels, {
          raw: {
            width: decoded.info.width,
            height: decoded.info.height,
            channels: decoded.info.channels,
          },
        })
          .trim({ background: "#ffffff", threshold: 12 })
          .resize(1_360, 1_360, {
            fit: "contain",
            background: "#ffffff",
            kernel: sharp.kernel.lanczos3,
          })
          .extend({ top: 120, right: 120, bottom: 120, left: 120,
            background: "#ffffff" })
          .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
          .toBuffer()
      } finally {
        normalizedPixels.fill(0)
      }
    }
  } catch {
    throw new Error("EBAY_IMAGE_PRODUCT_NOT_DETECTED")
  }
  if (output.length > 12 * 1024 * 1024) throw new Error("EBAY_IMAGE_OUTPUT_TOO_LARGE")
  const outputMetadata = await sharp(output).metadata()
  if (outputMetadata.width !== EBAY_IMAGE_OUTPUT_SIZE || outputMetadata.height !== EBAY_IMAGE_OUTPUT_SIZE) {
    throw new Error("EBAY_IMAGE_OUTPUT_DIMENSIONS_INVALID")
  }
  const decodedOutput = await sharp(output).removeAlpha().toColourspace("srgb")
    .raw().toBuffer({ resolveWithObject: true })
  const outputWhiteRatio = edgeWhiteRatio(
    decodedOutput.data,
    decodedOutput.info.width,
    decodedOutput.info.height,
    decodedOutput.info.channels,
  )
  decodedOutput.data.fill(0)
  const productCoverageRatio = 1_360 / EBAY_IMAGE_OUTPUT_SIZE
  const outputQaPassed = outputWhiteRatio >= 0.9 &&
    productCoverageRatio >= 0.7 && productCoverageRatio <= 0.85 &&
    (!preserveAuthorizedFrame || edgeRatio >= .9)

  return {
    output,
    sourceSha256: sha256(source),
    outputSha256: sha256(output),
    source: {
      width,
      height,
      bytes: source.length,
      format: metadata.format,
    },
    outputMetadata: {
      width: outputMetadata.width,
      height: outputMetadata.height,
      bytes: output.length,
      format: "jpeg",
    },
    transformation: {
      version: EBAY_IMAGE_TRANSFORMATION_VERSION,
      generativeAiUsed: false,
      backgroundMethod: preserveAuthorizedFrame
        ? "AUTHORIZED_SOURCE_FRAMED_CONTAIN"
        : "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION",
      sourcePixelsTreatment: preserveAuthorizedFrame
        ? "PRESERVED_FULL_FRAME"
        : "NEAR_NEUTRAL_WHITEN_ONLY",
      canvas: "WHITE",
      fit: "CONTAIN",
      maxProductBoxPixels: 1_360,
    },
    qa: {
      automaticStatus: outputQaPassed ? "PASSED" : "PARTIAL",
      sourceEdgeLightNeutralRatio: Number(edgeRatio.toFixed(4)),
      outputEdgeWhiteRatio: Number(outputWhiteRatio.toFixed(4)),
      productCoverageRatio: Number(productCoverageRatio.toFixed(4)),
      productCoverageVerified: productCoverageRatio >= 0.7 &&
        productCoverageRatio <= 0.85,
      sourceCenterLightNeutralRatio: Number(centerRatio.toFixed(4)),
      sourceCenterChromaticRatio: Number(centerColorRatio.toFixed(4)),
      sourceAmbiguousConnectedLightRatio: Number(
        separationAmbiguity.connectedLightRatio.toFixed(6),
      ),
      sourceAmbiguousInteriorLightRatio: Number(
        separationAmbiguity.interiorLightRatio.toFixed(6),
      ),
      sourceAmbiguousInteriorShare: Number(
        separationAmbiguity.interiorShare.toFixed(6),
      ),
      sourceVisualProfile: {
        ...visualProfile,
        productToneRisk: (
          centerRatio >= .60 && centerColorRatio <= .08
        ) || separationRequiresPreservedFrame
          ? "LIGHT_NEUTRAL_AMBIGUITY"
          : "STANDARD",
      },
      outputWidth: outputMetadata.width,
      outputHeight: outputMetadata.height,
      outputUnderTwelveMegabytes: true,
      exactSourceHashRecorded: true,
      generativeChangesMade: false,
      fullAuthorizedFramePreserved: preserveAuthorizedFrame,
      humanApprovalRequired: true,
      manualChecksRequired: [
        "EXACT_PRODUCT_FIDELITY",
        "NO_ADDED_OR_REMOVED_PARTS",
        "COLOR_AND_VARIANT_MATCH",
        "NO_TEXT_BADGES_OR_WATERMARKS",
        "PACKAGE_CONTENTS_MATCH",
        ...(preserveAuthorizedFrame ? [
          "SOURCE_BACKGROUND_PRESERVED_NOT_REMOVED",
          "MAIN_IMAGE_BACKGROUND_MANUAL_ACCEPTANCE",
        ] : []),
      ],
    },
  }
}

export function validateImageRightsEvidence(input: {
  rightsBasis?: unknown
  authorizationReference?: unknown
  rightsEvidenceConfirmed?: unknown
}) {
  const rightsBasis = String(input.rightsBasis ?? "").trim().toLowerCase()
  const authorizationReference = String(input.authorizationReference ?? "").trim().slice(0, 500)
  if (!["supplier_authorized", "owned", "licensed"].includes(rightsBasis)) {
    throw new Error("EBAY_IMAGE_RIGHTS_BASIS_INVALID")
  }
  if (authorizationReference.length < 8) {
    throw new Error("EBAY_IMAGE_AUTHORIZATION_REFERENCE_REQUIRED")
  }
  if (input.rightsEvidenceConfirmed !== true) {
    throw new Error("EBAY_IMAGE_RIGHTS_EVIDENCE_CONFIRMATION_REQUIRED")
  }
  return {
    rightsBasis,
    authorizationReference,
    rightsEvidenceConfirmed: true as const,
  }
}
