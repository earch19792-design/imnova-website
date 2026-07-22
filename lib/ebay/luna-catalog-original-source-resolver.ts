import { createHash } from "node:crypto"

import sharp from "sharp"

import type { AuthorizedForegroundIdentityEvidence } from
  "./authorized-product-foreground-identity"

// @ts-expect-error Node's native TypeScript tests need the explicit extension.
import { parseDirectedLunaProductUrl } from "./ebay-luna-directed-product-import.ts"

export const LUNA_CATALOG_SOURCE_RESOLVER_VERSION =
  "LUNA_CATALOG_ORIGINAL_SOURCE_RESOLVER_V2"

const LUNA_CATALOG_HOSTS = new Set([
  "lunaportex.com",
  "www.lunaportex.com",
  "cdn.shopify.com",
])
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_CATALOG_ASSETS = 24

type JsonRecord = Record<string, unknown>

export type LunaCatalogQualityTier =
  | "NATIVE_HIGH_RES"
  | "NATIVE_MEDIUM_RES"
  | "CONTROLLED_ENHANCEMENT"
  | "BLOCKED"

export type LunaCatalogViewClassification =
  | "PRIMARY"
  | "ALTERNATE_AUTHORIZED_ANGLE"
  | "DETAIL"
  | "PACKAGE_CONTENTS"
  | "UNKNOWN"

export type ResolvedLunaCatalogSourceAsset = {
  sourceImageId: string
  sourceAngle: "FRONT" | "SIDE" | "UNKNOWN"
  productId: string
  variantId: string
  sourceUrl: string
  nativeWidth: number
  nativeHeight: number
  contentType: "image/jpeg" | "image/png" | "image/webp"
  sha256: string
  viewClassification: LunaCatalogViewClassification
  qualityTier: Exclude<LunaCatalogQualityTier, "BLOCKED">
  selectedForSlots: string[]
  authorizationStatus: "AUTHORIZED_CATALOG" |
    "AUTHORIZED_CATALOG_NATIVE_HIGH_RES"
  enhancedDerivative: boolean
  sourceSha256: string
  enhancedSha256: string | null
  effectiveWidth: number
  effectiveHeight: number
  excludedSourceSha256s: string[]
  foregroundIdentityEvidence?: AuthorizedForegroundIdentityEvidence
  nativeBuffer: Buffer
  buffer: Buffer
}

export type AuthorizedCatalogSourcePack = {
  productId: string
  productIdentityHash: string
  productUrl: string
  sourceAssets: ResolvedLunaCatalogSourceAsset[]
  sourceAssetCount: number
  largestNativeWidth: number
  largestNativeHeight: number
  galleryCoverage: "SINGLE_VIEW" | "MULTI_VIEW" | "MULTI_VIEW_WITH_DETAIL"
  availableViewTypes: LunaCatalogViewClassification[]
  authorizationEvidenceHash: string
  resolverVersion: typeof LUNA_CATALOG_SOURCE_RESOLVER_VERSION
  discoveredCandidateCount: number
  inspectedCandidateCount: number
  precheck: {
    CATALOG_ORIGINAL_DISCOVERY_COMPLETED: true
    ALL_CATALOG_MEDIA_INSPECTED: true
    PRODUCT_IDENTITY_MATCHED: true
    SOURCE_PACK_READY: true
    SIX_SECONDARY_JOBS_FEASIBLE: true
    MARKET_VISUAL_SIGNALS_USABLE: true
    compositionManifestHash?: string
  }
}

type DiscoveredImage = {
  url: string
  hint: string
  order: number
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown, maximum = 2_000) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maximum)
    : ""
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

function allowedCatalogUrl(value: unknown, base?: string) {
  const candidate = text(value)
  if (!candidate) return null
  try {
    const url = new URL(
      candidate.startsWith("//") ? `https:${candidate}` : candidate,
      base,
    )
    if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") ||
      !LUNA_CATALOG_HOSTS.has(url.hostname.toLowerCase())) return null
    url.hash = ""
    return url
  } catch {
    return null
  }
}

/**
 * Shopify supports both query based transformations and legacy filename
 * suffixes. Remove only documented thumbnail tokens and retain `v`, which is
 * the catalog object's cache/identity version.
 */
export function originalShopifyCatalogImageUrl(value: unknown, base?: string) {
  const url = allowedCatalogUrl(value, base)
  if (!url) return null
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase() !== "v") url.searchParams.delete(key)
  }
  const parts = url.pathname.split("/")
  const filename = parts.pop() ?? ""
  const dot = filename.lastIndexOf(".")
  if (dot > 0) {
    let stem = filename.slice(0, dot)
    const extension = filename.slice(dot)
    const thumbnailSuffix = /_(?:pico|icon|thumb|small|compact|medium|large|grande|master|original|\d{1,5}x\d{0,5}|\d{0,5}x\d{1,5})(?:@\d+x)?$/i
    while (thumbnailSuffix.test(stem)) stem = stem.replace(thumbnailSuffix, "")
    parts.push(`${stem}${extension}`)
    url.pathname = parts.join("/")
  }
  return url.toString()
}

function addCandidate(
  values: DiscoveredImage[],
  value: unknown,
  hint: unknown,
  base: string,
) {
  const url = originalShopifyCatalogImageUrl(value, base)
  if (!url) return
  values.push({ url, hint: text(hint, 500), order: values.length })
}

function imageValuesFromRecord(
  values: DiscoveredImage[],
  value: unknown,
  hint: string,
  base: string,
) {
  if (typeof value === "string") {
    addCandidate(values, value, hint, base)
    return
  }
  const row = record(value)
  for (const field of [
    row.src,
    row.url,
    row.original_src,
    record(row.preview_image).src,
    record(row.featured_image).src,
  ]) addCandidate(values, field, text(row.alt) || hint, base)
}

function discoverJsonImages(payload: JsonRecord, base: string) {
  const values: DiscoveredImage[] = []
  imageValuesFromRecord(values, payload.featured_image, "featured", base)
  imageValuesFromRecord(values, payload.image, "featured", base)
  for (const [field, hint] of [["images", "gallery"], ["media", "media"]] as const) {
    if (!Array.isArray(payload[field])) continue
    for (const entry of payload[field]) imageValuesFromRecord(values, entry, hint, base)
  }
  if (Array.isArray(payload.variants)) {
    for (const variant of payload.variants.map(record)) {
      imageValuesFromRecord(
        values,
        variant.featured_image ?? variant.image,
        `variant:${text(variant.id, 80)}`,
        base,
      )
    }
  }
  return values
}

function decodeHtml(value: string) {
  return value.replaceAll("&amp;", "&").replaceAll("&#39;", "'")
    .replaceAll("&quot;", "\"")
}

function discoverHtmlImages(html: string, base: string) {
  const values: DiscoveredImage[] = []
  for (const match of html.matchAll(/\b(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/gi)) {
    for (const candidate of decodeHtml(match[1]).split(",")) {
      addCandidate(values, candidate.trim().split(/\s+/)[0], "srcset", base)
    }
  }
  for (const match of html.matchAll(/\b(?:data-zoom|data-zoom-image|data-src|src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const candidate = decodeHtml(match[1])
    if (/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(candidate)) {
      addCandidate(values, candidate, "html-media", base)
    }
  }
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1])
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        const product = record(node)
        const images = Array.isArray(product.image) ? product.image : [product.image]
        for (const image of images) imageValuesFromRecord(values, image, "json-ld", base)
      }
    } catch {
      // Invalid unrelated JSON-LD does not authorize or create a candidate.
    }
  }
  return values
}

async function boundedResponseText(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAX_DOCUMENT_BYTES) throw new Error("LUNA_CATALOG_DOCUMENT_TOO_LARGE")
  const body = await response.text()
  if (Buffer.byteLength(body) > MAX_DOCUMENT_BYTES) {
    throw new Error("LUNA_CATALOG_DOCUMENT_TOO_LARGE")
  }
  return body
}

async function fetchCatalogDocument(
  url: string,
  accept: string,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    headers: { Accept: accept },
  })
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error("LUNA_CATALOG_REDIRECT_BLOCKED")
  }
  const responseUrl = allowedCatalogUrl(response.url || url)
  if (!responseUrl) throw new Error("LUNA_CATALOG_REDIRECT_BLOCKED")
  return response
}

async function readImageWithLimit(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > MAX_IMAGE_BYTES) throw new Error("LUNA_CATALOG_IMAGE_TOO_LARGE")
  if (!response.body) throw new Error("LUNA_CATALOG_IMAGE_BODY_MISSING")
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      if (total + value.byteLength > MAX_IMAGE_BYTES) {
        await reader.cancel("LUNA_CATALOG_IMAGE_TOO_LARGE").catch(() => undefined)
        for (const chunk of chunks) chunk.fill(0)
        throw new Error("LUNA_CATALOG_IMAGE_TOO_LARGE")
      }
      chunks.push(Buffer.from(value))
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  if (!total) throw new Error("LUNA_CATALOG_IMAGE_BODY_MISSING")
  return Buffer.concat(chunks, total)
}

function classifyView(hint: string, index: number): LunaCatalogViewClassification {
  const normalized = hint.toLocaleLowerCase("en-US")
  if (/package|packaging|box|included|contents/.test(normalized)) {
    return "PACKAGE_CONTENTS"
  }
  if (/detail|close|macro|material|texture/.test(normalized)) return "DETAIL"
  if (index === 0 || /featured|primary|main|hero/.test(normalized)) return "PRIMARY"
  if (/alternate|angle|side|back|top|bottom|gallery|media|variant/.test(normalized)) {
    return "ALTERNATE_AUTHORIZED_ANGLE"
  }
  return "UNKNOWN"
}

async function controlledEnhancement(
  source: Buffer,
  width: number,
  height: number,
) {
  const scale = Math.min(2, 1_200 / Math.max(width, height))
  const targetWidth = Math.max(width, Math.round(width * scale))
  const targetHeight = Math.max(height, Math.round(height * scale))
  return sharp(source, { failOn: "warning", limitInputPixels: 40_000_000 })
    .rotate()
    .resize(targetWidth, targetHeight, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .sharpen({ sigma: .6, m1: .35, m2: .65, x1: 2, y2: 6, y3: 12 })
    .toColourspace("srgb")
    .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer()
}

function selectedSlots(
  classification: LunaCatalogViewClassification,
  index: number,
) {
  if (classification === "DETAIL") return ["QUALITY_DETAIL"]
  if (classification === "PACKAGE_CONTENTS") return ["PACKAGE_CONTENTS"]
  if (classification === "ALTERNATE_AUTHORIZED_ANGLE") {
    return ["ALTERNATE_AUTHORIZED_ANGLE"]
  }
  return index === 0
    ? ["MAIN_WHITE_BACKGROUND", "PRIMARY_USE", "TRUST_OR_OBJECTION"]
    : ["RETURN_RISK_CLARIFICATION", "ASPIRATIONAL_LIFESTYLE"]
}

function rank(asset: ResolvedLunaCatalogSourceAsset) {
  const quality = ({
    NATIVE_HIGH_RES: 400,
    NATIVE_MEDIUM_RES: 300,
    CONTROLLED_ENHANCEMENT: 200,
    BLOCKED: 0,
  } satisfies Record<LunaCatalogQualityTier, number>)[asset.qualityTier]
  const view = asset.viewClassification === "PRIMARY" ? 40
    : asset.viewClassification === "DETAIL" ? 30
      : asset.viewClassification === "ALTERNATE_AUTHORIZED_ANGLE" ? 20 : 10
  return quality + view + Math.min(99, Math.max(asset.nativeWidth, asset.nativeHeight) / 100)
}

export async function resolveLunaCatalogOriginalSourcePack(input: {
  productUrl: string
  expectedProductId: string
  expectedVariantId: string
  productIdentityHash: string
  authorizationEvidenceHash: string
  marketVisualSignalsUsable: boolean
  knownCatalogImageUrls?: string[]
  authorizedNativeAssets?: ResolvedLunaCatalogSourceAsset[]
  fetchImpl?: typeof fetch
}): Promise<AuthorizedCatalogSourcePack> {
  const parsed = parseDirectedLunaProductUrl(input.productUrl)
  if (!/^sha256:[0-9a-f]{64}$/.test(input.productIdentityHash) ||
    !/^[0-9a-f]{64}$/.test(input.authorizationEvidenceHash) ||
    !/^\d{1,30}$/.test(input.expectedProductId) ||
    !/^\d{1,30}$/.test(input.expectedVariantId)) {
    throw new Error("LUNA_CATALOG_IDENTITY_INPUT_INVALID")
  }
  if (!input.marketVisualSignalsUsable) {
    throw new Error("MARKET_VISUAL_SIGNALS_INSUFFICIENT")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const discovered: DiscoveredImage[] = []
  for (const value of input.knownCatalogImageUrls ?? []) {
    addCandidate(discovered, value, "catalog-snapshot", parsed.canonicalUrl)
  }
  let payload: JsonRecord | null = null
  try {
    const jsonResponse = await fetchCatalogDocument(
      parsed.jsonUrl,
      "application/json",
      fetchImpl,
    )
    if (!jsonResponse.ok) {
      throw new Error(`LUNA_CATALOG_JSON_HTTP_${jsonResponse.status}`)
    }
    const contentType = (jsonResponse.headers.get("content-type") ?? "")
      .split(";")[0].toLowerCase()
    if (contentType !== "application/json" && contentType !== "text/javascript") {
      throw new Error("LUNA_CATALOG_JSON_CONTENT_TYPE_INVALID")
    }
    payload = record(JSON.parse(await boundedResponseText(jsonResponse)))
    if (Object.keys(record(payload.product)).length) payload = record(payload.product)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("LUNA_CATALOG_JSON_INVALID")
    if (!discovered.length || (error instanceof Error && [
      "LUNA_CATALOG_DOCUMENT_TOO_LARGE",
      "LUNA_CATALOG_JSON_CONTENT_TYPE_INVALID",
      "LUNA_CATALOG_JSON_INVALID",
    ].includes(error.message))) {
      throw error
    }
  }
  if (payload) {
    const productId = String(payload.id ?? "")
    const variants = Array.isArray(payload.variants) ? payload.variants.map(record) : []
    if (productId !== input.expectedProductId ||
      !variants.some((variant) => String(variant.id ?? "") === input.expectedVariantId) ||
      text(payload.handle).toLocaleLowerCase("en-US") !== parsed.handle) {
      throw new Error("LUNA_CATALOG_PRODUCT_IDENTITY_MISMATCH")
    }
    discovered.push(...discoverJsonImages(payload, parsed.canonicalUrl))
  }
  try {
    const htmlResponse = await fetchCatalogDocument(
      parsed.canonicalUrl,
      "text/html,application/xhtml+xml",
      fetchImpl,
    )
    const htmlType = (htmlResponse.headers.get("content-type") ?? "")
      .split(";")[0].toLowerCase()
    if (htmlResponse.ok && ["text/html", "application/xhtml+xml"].includes(htmlType)) {
      const knownProductPaths = new Set(discovered.map((entry) =>
        new URL(entry.url).pathname))
      const htmlImages = discoverHtmlImages(
        await boundedResponseText(htmlResponse),
        parsed.canonicalUrl,
      ).filter((entry) => knownProductPaths.has(new URL(entry.url).pathname))
      discovered.push(...htmlImages)
    }
  } catch {
    // The complete Shopify product JSON remains authoritative when the
    // storefront HTML is rate-limited or unavailable.
  }
  const candidateMap = new Map<string, DiscoveredImage>()
  for (const entry of discovered) {
    if (!candidateMap.has(entry.url)) candidateMap.set(entry.url, entry)
  }
  const candidates = [...candidateMap.values()].slice(0, MAX_CATALOG_ASSETS)
  if (!candidates.length) throw new Error("LUNA_CATALOG_MEDIA_MISSING")

  const inspected = await Promise.all(candidates.map(async (candidate, index) => {
    let original: Buffer | null = null
    try {
      const response = await fetchCatalogDocument(
        candidate.url,
        "image/jpeg,image/png,image/webp;q=0.9",
        fetchImpl,
      )
      if (!response.ok) return null
      const imageType = (response.headers.get("content-type") ?? "")
        .split(";")[0].toLowerCase()
      if (!["image/jpeg", "image/png", "image/webp"].includes(imageType)) return null
      original = await readImageWithLimit(response)
      const metadata = await sharp(original, {
        failOn: "warning",
        limitInputPixels: 40_000_000,
      }).metadata()
      const width = metadata.width ?? 0
      const height = metadata.height ?? 0
      const decodedContentType = ({
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      } as const)[metadata.format as "jpeg" | "png" | "webp"]
      if (!width || !height || decodedContentType !== imageType) {
        original.fill(0)
        return null
      }
      const largest = Math.max(width, height)
      const classification = classifyView(candidate.hint, index)
      const sourceSha256 = sha256(original)
      let buffer = original
      const qualityTier: LunaCatalogQualityTier = largest >= 1_200
        ? "NATIVE_HIGH_RES"
        : largest >= 700 ? "NATIVE_MEDIUM_RES"
          : largest >= 500 ? "CONTROLLED_ENHANCEMENT" : "BLOCKED"
      let enhancedSha256: string | null = null
      let effectiveWidth = width
      let effectiveHeight = height
      if (qualityTier === "CONTROLLED_ENHANCEMENT") {
        buffer = await controlledEnhancement(original, width, height)
        const enhanced = await sharp(buffer).metadata()
        enhancedSha256 = sha256(buffer)
        effectiveWidth = enhanced.width ?? 0
        effectiveHeight = enhanced.height ?? 0
      }
      if (qualityTier === "BLOCKED") {
        original.fill(0)
        return null
      }
      const sourceAngle: ResolvedLunaCatalogSourceAsset["sourceAngle"] =
        classification === "PRIMARY" ? "FRONT" : "UNKNOWN"
      return {
        sourceImageId: `LUNA_CATALOG:${sourceSha256}`,
        sourceAngle,
        productId: input.expectedProductId,
        variantId: input.expectedVariantId,
        sourceUrl: candidate.url,
        nativeWidth: width,
        nativeHeight: height,
        contentType: imageType as ResolvedLunaCatalogSourceAsset["contentType"],
        sha256: enhancedSha256 ?? sourceSha256,
        viewClassification: classification,
        qualityTier,
        selectedForSlots: selectedSlots(classification, index),
        authorizationStatus: "AUTHORIZED_CATALOG" as const,
        enhancedDerivative: Boolean(enhancedSha256),
        sourceSha256,
        enhancedSha256,
        effectiveWidth,
        effectiveHeight,
        excludedSourceSha256s: [],
        nativeBuffer: original,
        buffer,
      }
    } catch {
      original?.fill(0)
      return null
    }
  }))
  const usable = [
    ...(input.authorizedNativeAssets ?? []),
    ...inspected.filter((asset): asset is NonNullable<typeof asset> =>
      asset !== null),
  ]
  const uniqueMap = new Map<string, ResolvedLunaCatalogSourceAsset>()
  for (const asset of usable) {
    if (!uniqueMap.has(asset.sha256)) {
      uniqueMap.set(asset.sha256, asset)
      continue
    }
    asset.nativeBuffer.fill(0)
    if (asset.buffer !== asset.nativeBuffer) asset.buffer.fill(0)
  }
  const unique = [...uniqueMap.values()]
  const selected = unique.sort((left, right) => rank(right) - rank(left))
  const primary = selected.find((asset) =>
    (asset.qualityTier === "NATIVE_HIGH_RES" ||
      asset.qualityTier === "CONTROLLED_ENHANCEMENT") &&
    Math.max(asset.effectiveWidth, asset.effectiveHeight) >= 1_200)
  if (!primary) {
    for (const asset of unique) asset.buffer.fill(0)
    throw new Error("NEEDS_ADDITIONAL_SOURCE_IMAGE:PRIMARY")
  }
  const sourceAssets = [
    primary,
    ...selected.filter((asset) => asset !== primary),
  ]
  const availableViewTypes = [...new Set(sourceAssets.map((asset) =>
    asset.viewClassification))]
  return {
    productId: input.expectedProductId,
    productIdentityHash: input.productIdentityHash,
    productUrl: parsed.canonicalUrl,
    sourceAssets,
    sourceAssetCount: sourceAssets.length,
    largestNativeWidth: Math.max(...sourceAssets.map((asset) => asset.nativeWidth)),
    largestNativeHeight: Math.max(...sourceAssets.map((asset) => asset.nativeHeight)),
    galleryCoverage: availableViewTypes.includes("DETAIL")
      ? "MULTI_VIEW_WITH_DETAIL"
      : sourceAssets.length > 1 ? "MULTI_VIEW" : "SINGLE_VIEW",
    availableViewTypes,
    authorizationEvidenceHash: input.authorizationEvidenceHash,
    resolverVersion: LUNA_CATALOG_SOURCE_RESOLVER_VERSION,
    discoveredCandidateCount: candidates.length,
    inspectedCandidateCount: candidates.length,
    precheck: {
      CATALOG_ORIGINAL_DISCOVERY_COMPLETED: true,
      ALL_CATALOG_MEDIA_INSPECTED: true,
      PRODUCT_IDENTITY_MATCHED: true,
      SOURCE_PACK_READY: true,
      SIX_SECONDARY_JOBS_FEASIBLE: true,
      MARKET_VISUAL_SIGNALS_USABLE: true,
    },
  }
}

export function disposeAuthorizedCatalogSourcePack(pack: AuthorizedCatalogSourcePack) {
  for (const asset of pack.sourceAssets) {
    asset.nativeBuffer.fill(0)
    if (asset.buffer !== asset.nativeBuffer) asset.buffer.fill(0)
  }
}

export function selectLunaCatalogGenerationSources(
  pack: AuthorizedCatalogSourcePack,
  maximum = 3,
) {
  const authorizedNative = pack.sourceAssets.filter((asset) =>
    asset.authorizationStatus === "AUTHORIZED_CATALOG_NATIVE_HIGH_RES")
  if (authorizedNative.length) {
    const main = authorizedNative.find((asset) => asset.sourceImageId === "MAIN")
    const side = authorizedNative.find((asset) => asset.sourceImageId === "SIDE")
    if (!main || !side || authorizedNative.length !== 2) {
      throw new Error("AUTHORIZED_CATALOG_NATIVE_MEDIA_CONTRACT_INVALID")
    }
    return [main, side]
  }
  const selected: ResolvedLunaCatalogSourceAsset[] = []
  const add = (asset: ResolvedLunaCatalogSourceAsset | undefined) => {
    if (asset && !selected.includes(asset) && selected.length < maximum) {
      selected.push(asset)
    }
  }
  add(pack.sourceAssets.find((asset) => asset.viewClassification === "PRIMARY")
    ?? pack.sourceAssets[0])
  for (const view of [
    "DETAIL",
    "ALTERNATE_AUTHORIZED_ANGLE",
    "PACKAGE_CONTENTS",
    "UNKNOWN",
  ] as const) {
    add(pack.sourceAssets.find((asset) => asset.viewClassification === view))
  }
  for (const asset of pack.sourceAssets) add(asset)
  return selected
}

export function bindLunaCatalogSourcesToStrategy(
  pack: AuthorizedCatalogSourcePack,
  selected: ResolvedLunaCatalogSourceAsset[],
  sourceIds: string[],
  strategy: Array<{ slot: string; authorizedSourceImageIds: string[] }>,
) {
  for (const asset of pack.sourceAssets) asset.selectedForSlots = []
  if (selected[0]) selected[0].selectedForSlots.push("MAIN_WHITE_BACKGROUND")
  for (const position of strategy) {
    const index = sourceIds.indexOf(position.authorizedSourceImageIds[0] ?? "")
    const asset = selected[index]
    if (asset && !asset.selectedForSlots.includes(position.slot)) {
      asset.selectedForSlots.push(position.slot)
    }
  }
}
