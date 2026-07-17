import { createHash } from "node:crypto"
import { isIP } from "node:net"

import sharp from "sharp"

export const EBAY_IMAGE_TRANSFORMATION_VERSION =
  "EBAY_MAIN_IMAGE_SAFE_WHITE_V1"
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
    backgroundMethod: "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION"
    canvas: "WHITE"
    fit: "CONTAIN"
    maxProductBoxPixels: number
  }
  qa: {
    automaticStatus: "PASSED"
    sourceEdgeLightNeutralRatio: number
    outputWidth: number
    outputHeight: number
    outputUnderTwelveMegabytes: boolean
    exactSourceHashRecorded: true
    generativeChangesMade: false
    humanApprovalRequired: true
    manualChecksRequired: string[]
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
  if (edgeRatio < 0.72) {
    throw new Error("EBAY_IMAGE_BACKGROUND_REQUIRES_MANUAL_REMOVAL")
  }

  const normalizedPixels = whitenNearNeutralPixels(
    decoded.data,
    decoded.info.channels,
  )
  let output: Buffer
  try {
    output = await sharp(normalizedPixels, {
      raw: {
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
      },
    })
      .trim({ background: "#ffffff", threshold: 12 })
      .resize(1_400, 1_400, {
        fit: "contain",
        background: "#ffffff",
        kernel: sharp.kernel.lanczos3,
      })
      .extend({ top: 100, right: 100, bottom: 100, left: 100, background: "#ffffff" })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer()
  } catch {
    throw new Error("EBAY_IMAGE_PRODUCT_NOT_DETECTED")
  }
  if (output.length > 12 * 1024 * 1024) throw new Error("EBAY_IMAGE_OUTPUT_TOO_LARGE")
  const outputMetadata = await sharp(output).metadata()
  if (outputMetadata.width !== EBAY_IMAGE_OUTPUT_SIZE || outputMetadata.height !== EBAY_IMAGE_OUTPUT_SIZE) {
    throw new Error("EBAY_IMAGE_OUTPUT_DIMENSIONS_INVALID")
  }

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
      backgroundMethod: "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION",
      canvas: "WHITE",
      fit: "CONTAIN",
      maxProductBoxPixels: 1_400,
    },
    qa: {
      automaticStatus: "PASSED",
      sourceEdgeLightNeutralRatio: Number(edgeRatio.toFixed(4)),
      outputWidth: outputMetadata.width,
      outputHeight: outputMetadata.height,
      outputUnderTwelveMegabytes: true,
      exactSourceHashRecorded: true,
      generativeChangesMade: false,
      humanApprovalRequired: true,
      manualChecksRequired: [
        "EXACT_PRODUCT_FIDELITY",
        "NO_ADDED_OR_REMOVED_PARTS",
        "COLOR_AND_VARIANT_MATCH",
        "NO_TEXT_BADGES_OR_WATERMARKS",
        "PACKAGE_CONTENTS_MATCH",
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
