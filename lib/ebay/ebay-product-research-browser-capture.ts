import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { normalizeProductIdentity } from "./ebay-winner-evidence-v2.ts"
import type { ProductIdentityInput } from "./ebay-winner-evidence-v2.ts"
import {
  PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION,
  persistProductResearchVisualPatterns,
  rejectedProductResearchVisualPattern,
  sanitizeProductResearchVisualPattern,
  type ProductResearchVisualPattern,
  type VisualComparableRow,
// @ts-ignore Node's native TypeScript runner requires explicit extensions.
} from "./ebay-product-research-visual-pattern.ts"

export const PRODUCT_RESEARCH_BROWSER_CAPTURE_VERSION =
  "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE_V2_2026_07_21"
export const PRODUCT_RESEARCH_BROWSER_CAPTURE_SOURCE =
  "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE" as const
export const PRODUCT_RESEARCH_CAPTURE_MAX_ROWS = 200
export const PRODUCT_RESEARCH_CAPTURE_MAX_BYTES = 100_000

export function isProductResearchNinetyDayWindow(
  value: ProductResearchBrowserCapture["dateRange"],
) {
  const label = typeof value?.label === "string"
    ? value.label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    : ""
  if (/\b90\b/.test(label) && /(?:day|days|dia|dias)/.test(label)) return true
  const timestamp = (entry: unknown) => {
    if (typeof entry !== "string" || !entry.trim()) return null
    const numeric = Number(entry)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
    const parsed = Date.parse(entry)
    return Number.isFinite(parsed) ? parsed : null
  }
  const start = timestamp(value?.start)
  const end = timestamp(value?.end)
  if (start === null || end === null || end <= start) return false
  const days = (end - start) / 86_400_000
  return days >= 89 && days <= 91
}

type JsonRecord = Record<string, unknown>

export type ProductResearchLunaMatch =
  | "EXACT_LUNA_MATCH"
  | "SAME_PRODUCT_DIFFERENT_PACK"
  | "SAME_PRODUCT_DIFFERENT_SIZE"
  | "DIFFERENT_VARIANT"
  | "AMBIGUOUS"
  | "NO_LUNA_MATCH"

export type ProductResearchCaptureTarget = {
  id: string
  queueItemId?: string | null
  supplierProductId?: string | null
  supplierVariantId: string
  supplierSku?: string | null
  sourceType?: "LOOP1_EVIDENCE" | "LUNA_CATALOG" | "VERIFIED_ACTIVE_LISTING_LINK"
  officialLinkVerified?: boolean
  identityEvidenceSource?: "LUNA_STRUCTURED_CATALOG" | "LUNA_OFFICIAL_PRODUCT_DESCRIPTION" | null
  identityEvidenceHash?: string | null
  identity: ProductIdentityInput
  productName: string
}

export type ProductResearchBrowserCapture = {
  source: typeof PRODUCT_RESEARCH_BROWSER_CAPTURE_SOURCE
  visualPatternSchemaVersion?: string | null
  captureId: string
  listingSite: string
  pagePath: string
  searchQuery: string
  dateRange: { label?: string | null; start?: string | null; end?: string | null }
  capturedAt: string
  visibleResultCount: number
  visibleColumns: string[]
  rows: unknown[]
  resultState?: "SOLD_ROWS_VISIBLE" | "NO_SOLD_RESULTS"
  emptyResultProof?: {
    status?: "OFFICIAL_NO_SOLD_RESULTS_MESSAGE_VISIBLE"
    queryMatched?: boolean
  } | null
}

type NormalizedCaptureRow = {
  sourceListingId: string | null
  sourceListingReferenceHash: string
  titleFingerprint: string
  identityHash: string
  productFamilyFingerprint: string
  detectedOfferPackCount: number | null
  detectedUnitCount: number | null
  detectedSize: string | null
  detectedVariant: string | null
  averageSoldPrice: number
  averageShipping: number | null
  totalSold: number
  itemSales: number | null
  lastSoldDate: string
  listingFormat: "FIXED_PRICE" | "AUCTION" | "BEST_OFFER" | "UNKNOWN"
  freeShippingPercent: number | null
  bids: number | null
  visibleImageCount: number | null
  visualPattern: ProductResearchVisualPattern | null
  keywordSignals: string[]
  transientTitle: string
}

export type ClassifiedProductResearchCapture = NormalizedCaptureRow & {
  matchClassification: ProductResearchLunaMatch
  matchReasons: string[]
  matchedTarget: ProductResearchCaptureTarget | null
  normalizedIdentity: ReturnType<typeof normalizeProductIdentity>
  deduplicationKey: string
}

const FORBIDDEN_KEYS = new Set([
  "buyer", "buyerid", "buyerusername", "buyeremail", "buyerphone", "buyername",
  "recipient", "recipientname", "fullname", "firstname", "lastname", "email", "phone",
  "phonenumber", "address", "address1", "address2", "street", "shippingaddress",
  "billingaddress", "postaladdress", "orderid", "ebayorderid", "cookie", "cookies",
  "authorization", "accesstoken", "refreshtoken", "jwt", "password", "payment",
  "card", "pagehtml", "outerhtml", "innerhtml", "imagesrc", "imageurl",
  "thumbnailurl", "base64", "blob", "screenshot", "imagebytes", "imagedata",
  "pixels", "pixeldata", "canvas", "binary", "buffer",
])

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "new", "free", "shipping", "fast", "sale",
  "authentic", "genuine", "best", "top", "ebay", "lot", "pack", "count", "set",
  "each", "per", "item", "items", "of", "ct", "qty", "quantity",
])

const REQUIRED_COLUMN_GROUPS = [
  ["title", "temporarytitle", "listing", "listingtitle", "item", "itemtitle", "product",
    "titulo", "anuncio", "articulo", "producto"],
  ["averagesoldprice", "avgsoldprice", "averageprice", "preciomediodeventa",
    "preciopromediodeventa"],
  ["totalsold", "quantitysold", "soldquantity", "totalvendido", "cantidadvendida",
    "unidadesvendidas"],
  ["lastsolddate", "solddate", "lastsold", "ultimaventa", "fechadeultimaventa"],
]

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function canonicalKey(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "")
}

function normalizedText(value: unknown, maximum = 300) {
  if (typeof value !== "string") return null
  const result = value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maximum)
  return result && !/[\u0000-\u001f\u007f]/.test(result) ? result : null
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`
  return JSON.stringify(value)
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : canonicalJson(value),
  ).digest("hex")}`
}

function finiteNonNegative(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(String(value).replace(/[$,%\s,]/g, ""))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = finiteNonNegative(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function confirmedSoldQuantity(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null
  }
  const normalized = normalizedText(value, 80)
  if (!normalized || /[$€£%]/.test(normalized)) return null
  const withoutLabel = normalized
    .replace(/^(?:total\s+sold|quantity\s+sold|sold\s+quantity|total\s+vendido|cantidad\s+vendida|unidades\s+vendidas)\s*:?\s*/i, "")
    .replace(/\s*(?:sold|vendid[oa]s?)$/i, "")
    .trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(withoutLabel)) return null
  const parsed = Number(withoutLabel.replace(/,/g, ""))
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function nonNegativeInteger(value: unknown) {
  const parsed = finiteNonNegative(value)
  return parsed !== null && Number.isInteger(parsed) ? parsed : null
}

function percent(value: unknown) {
  const parsed = finiteNonNegative(value)
  return parsed !== null && parsed <= 100 ? parsed : null
}

function captureDateBounds(input: ProductResearchBrowserCapture["dateRange"], capturedAt: Date) {
  const timestamp = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return null
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const explicitStart = timestamp(input?.start)
  const explicitEnd = timestamp(input?.end)
  if (explicitStart !== null && explicitEnd !== null && explicitEnd > explicitStart) {
    return { earliest: explicitStart - 86_400_000, latest: explicitEnd + 86_400_000 }
  }
  const label = normalizedText(input?.label, 120)?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? ""
  const days = Number(label.match(/\b(\d{1,3})\b(?=[^\d]*(?:day|days|dia|dias))/)?.[1])
  const boundedDays = Number.isInteger(days) && days > 0 && days <= 366 ? days : 90
  return {
    earliest: capturedAt.getTime() - (boundedDays + 2) * 86_400_000,
    latest: capturedAt.getTime() + 86_400_000,
  }
}

function normalizedDate(
  value: unknown,
  capturedAt: Date,
  bounds: ReturnType<typeof captureDateBounds>,
) {
  const text = normalizedText(value, 80)
  if (!text || /^\d+(?:[.,]\d+)?$/.test(text)) return null
  const parsed = new Date(text)
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() < bounds.earliest ||
    parsed.getTime() > bounds.latest || parsed.getTime() > capturedAt.getTime() + 86_400_000) return null
  return parsed.toISOString()
}

function rejectForbiddenKeys(value: unknown) {
  if (Array.isArray(value)) {
    for (const entry of value) rejectForbiddenKeys(entry)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, entry] of Object.entries(value as JsonRecord)) {
    if (FORBIDDEN_KEYS.has(canonicalKey(key))) throw new Error("PRODUCT_RESEARCH_CAPTURE_FORBIDDEN_FIELD")
    rejectForbiddenKeys(entry)
  }
}

function titleTokens(value: string) {
  return [...new Set((value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) && !/^\d+$/.test(token)))]
    .slice(0, 40)
}

function normalizeSize(value: unknown) {
  const text = normalizedText(value, 50)?.toLocaleLowerCase("en-US") ?? null
  if (!text) return null
  return text.replace(/fluid ounces?/g, "fl oz").replace(/ounces?/g, "oz")
    .replace(/\s+/g, " ").trim()
}

export function detectProductResearchOfferFacts(titleValue: unknown) {
  const title = normalizedText(titleValue)?.toLocaleLowerCase("en-US") ?? ""
  const packMatch = title.match(/\b(?:lot|pack|set)\s+of\s+(\d{1,3})\b/) ??
    title.match(/\b(\d{1,3})\s*[- ]?(?:pack|pk)\b/) ??
    title.match(/\bqty\s*[:x-]?\s*(\d{1,3})\b/) ??
    title.match(/\b(\d{1,3})\s*[x×]\s*\d{1,4}\s*(?:ct|count)\b/)
  const perPackCount = title.match(/\b(\d{1,4})\s*(?:ct|count)\s*(?:each|per\s+(?:pack|unit))\b/) ??
    title.match(/\b(\d{1,3})\s*[x×]\s*(\d{1,4})\s*(?:ct|count)\b/)?.slice(2) as RegExpMatchArray | null
  const generalCount = title.match(/\b(\d{1,4})\s*(?:ct|count)\b/)
  const sizeMatch = title.match(/\b\d+(?:\.\d+)?\s*(?:fl\s*oz|oz|lb|lbs|g|kg|ml|l|ct|count)\b/)
  return {
    packCount: packMatch ? positiveInteger(packMatch[1]) : /\bsingle\b/.test(title) ? 1 : null,
    unitCount: positiveInteger(perPackCount?.[1] ?? generalCount?.[1]),
    size: normalizeSize(sizeMatch?.[0]),
  }
}

function listingFormat(value: unknown) {
  const normalized = canonicalKey(normalizedText(value, 80) ?? "")
  if (normalized.includes("auction")) return "AUCTION" as const
  if (normalized.includes("bestoffer")) return "BEST_OFFER" as const
  if (normalized.includes("fixed") || normalized.includes("buyitnow")) return "FIXED_PRICE" as const
  return "UNKNOWN" as const
}

function validateContext(input: ProductResearchBrowserCapture) {
  if (input.source !== PRODUCT_RESEARCH_BROWSER_CAPTURE_SOURCE) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_SOURCE_INVALID")
  }
  if (input.listingSite !== "www.ebay.com" || !/^\/sh\/research\/?$/.test(input.pagePath)) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_OFFICIAL_ORIGIN_REQUIRED")
  }
  const query = normalizedText(input.searchQuery, 240)
  const rangeLabel = normalizedText(input.dateRange?.label, 120)
  const rangeStart = normalizedText(input.dateRange?.start, 80)
  const rangeEnd = normalizedText(input.dateRange?.end, 80)
  if (!query || !(rangeLabel || rangeStart && rangeEnd)) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_QUERY_CONTEXT_REQUIRED")
  }
  const capturedAt = new Date(input.capturedAt)
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 300_000 ||
    capturedAt.getTime() < Date.now() - 86_400_000) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_TIMESTAMP_INVALID")
  }
  const captureId = normalizedText(input.captureId, 80)
  if (!captureId || !/^[0-9a-f-]{36}$/i.test(captureId)) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_ID_INVALID")
  }
  const officialNoSoldResults = input.resultState === "NO_SOLD_RESULTS" &&
    input.emptyResultProof?.status === "OFFICIAL_NO_SOLD_RESULTS_MESSAGE_VISIBLE" &&
    input.emptyResultProof?.queryMatched === true
  if (!Array.isArray(input.rows) || input.rows.length > PRODUCT_RESEARCH_CAPTURE_MAX_ROWS ||
    input.visibleResultCount !== input.rows.length ||
    (officialNoSoldResults && (input.rows.length !== 0 || input.visibleResultCount !== 0)) ||
    (!officialNoSoldResults && input.rows.length === 0)) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_VISIBLE_ROWS_INVALID")
  }
  const columns = (Array.isArray(input.visibleColumns) ? input.visibleColumns : [])
    .map((column) => canonicalKey(String(column)))
  const visibleColumnsMatch = REQUIRED_COLUMN_GROUPS.every((aliases) =>
    aliases.some((alias) => columns.some((column) => column === alias || column.includes(alias))))
  const structuredColumnsMatch = input.rows.every((value) => {
    const row = record(value)
    return Object.hasOwn(row, "temporaryTitle") && Object.hasOwn(row, "averageSoldPrice") &&
      Object.hasOwn(row, "totalSold") && Object.hasOwn(row, "lastSoldDate")
  })
  if (!officialNoSoldResults && (!columns.length ||
    columns.some((column) => FORBIDDEN_KEYS.has(column)) ||
    !visibleColumnsMatch && !structuredColumnsMatch)) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_REQUIRED_COLUMNS_MISSING")
  }
  const visualPatternSchemaVersion = normalizedText(input.visualPatternSchemaVersion, 120)
  if (visualPatternSchemaVersion &&
    visualPatternSchemaVersion !== PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION) {
    throw new Error("PRODUCT_RESEARCH_VISUAL_SCHEMA_VERSION_INVALID")
  }
  return { query, capturedAt, rangeLabel, rangeStart, rangeEnd, visualPatternSchemaVersion,
    officialNoSoldResults,
    dateBounds: captureDateBounds(input.dateRange, capturedAt) }
}

function normalizeCaptureRow(
  value: unknown,
  capturedAt: Date,
  dateBounds: ReturnType<typeof captureDateBounds>,
  visualCaptureEnabled: boolean,
): NormalizedCaptureRow | { error: string } {
  const row = record(value)
  const transientTitle = normalizedText(row.temporaryTitle)
  const sourceListingId = normalizedText(row.listingId, 30)
  const averageSoldPrice = finiteNonNegative(row.averageSoldPrice)
  const averageShipping = row.averageShipping === null || row.averageShipping === undefined
    ? null : finiteNonNegative(row.averageShipping)
  const totalSold = confirmedSoldQuantity(row.totalSold)
  const lastSoldDate = normalizedDate(row.lastSoldDate, capturedAt, dateBounds)
  if (!transientTitle) return { error: "TEMPORARY_TITLE_REQUIRED" }
  if (sourceListingId && !/^\d{9,20}$/.test(sourceListingId)) return { error: "LISTING_ID_INVALID" }
  if (averageSoldPrice === null) return { error: "AVERAGE_SOLD_PRICE_INVALID" }
  if (!totalSold) return { error: "CONFIRMED_SOLD_QUANTITY_REQUIRED" }
  if (!lastSoldDate) return { error: "LAST_SOLD_DATE_INVALID" }
  if (row.averageShipping !== null && row.averageShipping !== undefined && averageShipping === null) {
    return { error: "AVERAGE_SHIPPING_INVALID" }
  }
  const detected = detectProductResearchOfferFacts(transientTitle)
  const suppliedPack = positiveInteger(row.detectedOfferPackCount)
  const suppliedUnits = positiveInteger(row.detectedUnitCount)
  const suppliedSize = normalizeSize(row.detectedSize)
  if (detected.packCount && suppliedPack && detected.packCount !== suppliedPack) {
    return { error: "DETECTED_PACK_CONFLICT" }
  }
  if (detected.unitCount && suppliedUnits && detected.unitCount !== suppliedUnits) {
    return { error: "DETECTED_UNIT_COUNT_CONFLICT" }
  }
  const packCount = detected.packCount ?? suppliedPack
  const unitCount = detected.unitCount ?? suppliedUnits
  const size = detected.size ?? suppliedSize
  const variant = normalizedText(row.detectedVariant, 80)?.toLocaleLowerCase("en-US") ?? null
  const keywords = titleTokens(transientTitle)
  const identityHash = sha256({ keywords, packCount, unitCount, size, variant })
  const productFamilyFingerprint = sha256({ keywords })
  // A malformed or unavailable visual feature must never reject otherwise valid sold evidence.
  // The extension sends no pixels or image references; the receiver retains only this safe schema.
  const visualPattern = visualCaptureEnabled
    ? sanitizeProductResearchVisualPattern(row.visualPattern, capturedAt) ??
      rejectedProductResearchVisualPattern({
        detectedPackCount: packCount,
        detectedUnitCount: unitCount,
        analyzedAt: capturedAt,
      })
    : null
  return {
    sourceListingId,
    sourceListingReferenceHash: sha256(sourceListingId ?? identityHash),
    titleFingerprint: sha256(transientTitle.toLocaleLowerCase("en-US")),
    identityHash,
    productFamilyFingerprint,
    detectedOfferPackCount: packCount,
    detectedUnitCount: unitCount,
    detectedSize: size,
    detectedVariant: variant,
    averageSoldPrice,
    averageShipping,
    totalSold,
    itemSales: finiteNonNegative(row.itemSales),
    lastSoldDate,
    listingFormat: listingFormat(row.listingFormat),
    freeShippingPercent: percent(row.freeShippingPercent),
    bids: nonNegativeInteger(row.bids),
    visibleImageCount: nonNegativeInteger(row.visibleImageCount),
    visualPattern,
    keywordSignals: keywords,
    transientTitle,
  }
}

function normalizedVariantEvidence(identity: ReturnType<typeof normalizeProductIdentity>) {
  return [identity.color, identity.scent, identity.variant].filter((value): value is string => Boolean(value))
}

function tokenSimilarity(rowTokens: string[], targetName: string) {
  const targetTokens = titleTokens(targetName)
  if (!rowTokens.length || !targetTokens.length) return 0
  const row = new Set(rowTokens)
  const target = new Set(targetTokens)
  const intersection = [...target].filter((token) => row.has(token)).length
  const union = new Set([...row, ...target]).size
  return Math.round(((intersection / target.size) * 0.75 + (intersection / union) * 0.25) * 10_000) / 10_000
}

function classifyAgainstTarget(row: NormalizedCaptureRow, target: ProductResearchCaptureTarget) {
  const identity = normalizeProductIdentity(target.identity)
  const score = tokenSimilarity(row.keywordSignals, target.productName)
  const brandTokens = titleTokens(identity.manufacturerBrand ?? "")
  const brandConfirmed = !brandTokens.length || brandTokens.every((token) => row.keywordSignals.includes(token))
  if (score < 0.68 || !brandConfirmed) return null
  const reasons: string[] = [`TITLE_IDENTITY_SCORE_${Math.round(score * 100)}`]
  if (row.detectedOfferPackCount !== null && identity.packCount !== null &&
    row.detectedOfferPackCount !== identity.packCount) reasons.push("PACK_COUNT_MISMATCH")
  if (row.detectedUnitCount !== null && identity.unitCount !== null &&
    row.detectedUnitCount !== identity.unitCount) reasons.push("UNIT_COUNT_MISMATCH")
  if (row.detectedSize && identity.size && row.detectedSize !== normalizeSize(identity.size)) {
    reasons.push("SIZE_MISMATCH")
  }
  const variantFacts = normalizedVariantEvidence(identity)
  const targetVariantVisible = !variantFacts.length || variantFacts.some((variant) =>
    titleTokens(variant).every((token) => row.keywordSignals.includes(token)))
  if (row.detectedVariant && variantFacts.length &&
    !variantFacts.some((variant) => variant === row.detectedVariant)) reasons.push("VARIANT_MISMATCH")
  const strongTarget = Boolean(identity.gtinValid ||
    identity.manufacturerBrand && (identity.mpn || identity.model))
  let classification: ProductResearchLunaMatch
  if (reasons.includes("VARIANT_MISMATCH")) classification = "DIFFERENT_VARIANT"
  else if (reasons.includes("PACK_COUNT_MISMATCH")) classification = "SAME_PRODUCT_DIFFERENT_PACK"
  else if (reasons.includes("UNIT_COUNT_MISMATCH") || reasons.includes("SIZE_MISMATCH")) {
    classification = "SAME_PRODUCT_DIFFERENT_SIZE"
  } else if (!strongTarget || score < 0.82 || row.detectedOfferPackCount === null ||
    identity.packCount === null || row.detectedOfferPackCount !== identity.packCount ||
    identity.unitCount !== null && row.detectedUnitCount !== identity.unitCount || !targetVariantVisible) {
    classification = "AMBIGUOUS"
    reasons.push("EXACT_IDENTITY_EVIDENCE_INCOMPLETE")
  } else classification = "EXACT_LUNA_MATCH"
  return { target, score, classification, reasons }
}

export function classifyProductResearchCaptureRow(
  row: NormalizedCaptureRow,
  targets: ProductResearchCaptureTarget[],
) {
  const matches = targets.map((target) => classifyAgainstTarget(row, target))
    .filter((value): value is NonNullable<ReturnType<typeof classifyAgainstTarget>> => value !== null)
    .sort((left, right) => right.score - left.score)
  if (!matches.length) return { classification: "NO_LUNA_MATCH" as const,
    reasons: ["NO_COMPATIBLE_LUNA_IDENTITY"], target: null }
  if (matches.length > 1 && matches[0].score - matches[1].score < 0.08) {
    return { classification: "AMBIGUOUS" as const,
      reasons: ["MULTIPLE_LUNA_IDENTITIES_COMPATIBLE"], target: null }
  }
  if (matches[0].classification === "AMBIGUOUS") {
    return { classification: "AMBIGUOUS" as const,
      reasons: matches[0].reasons, target: null }
  }
  return { classification: matches[0].classification, reasons: matches[0].reasons,
    target: matches[0].target }
}

function observationIdentity(row: NormalizedCaptureRow, match: ReturnType<typeof classifyProductResearchCaptureRow>) {
  if (!match.target) return normalizeProductIdentity({
    productName: null, packCount: row.detectedOfferPackCount, unitCount: row.detectedUnitCount,
    size: row.detectedSize, variant: row.detectedVariant, condition: "new",
  })
  const target = normalizeProductIdentity(match.target.identity)
  const exact = match.classification === "EXACT_LUNA_MATCH"
  const packChanged = match.classification === "SAME_PRODUCT_DIFFERENT_PACK"
  const offerIdentity = normalizeProductIdentity({
    manufacturerBrand: target.manufacturerBrand,
    gtin: exact ? target.gtin : null,
    mpn: target.mpn,
    model: target.model,
    productName: match.target.productName,
    packCount: row.detectedOfferPackCount ?? target.packCount,
    unitCount: row.detectedUnitCount ?? target.unitCount,
    size: row.detectedSize ?? target.size,
    color: target.color,
    scent: target.scent,
    variant: row.detectedVariant ?? target.variant,
    condition: target.condition ?? "new",
  })
  return { ...offerIdentity, gtin: packChanged ? null : offerIdentity.gtin,
    gtinValid: packChanged ? false : offerIdentity.gtinValid }
}

export function parseProductResearchBrowserCapture(input: {
  capture: ProductResearchBrowserCapture
  targets: ProductResearchCaptureTarget[]
}) {
  if (Buffer.byteLength(JSON.stringify(input.capture), "utf8") > PRODUCT_RESEARCH_CAPTURE_MAX_BYTES) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_TOO_LARGE")
  }
  rejectForbiddenKeys(input.capture)
  const context = validateContext(input.capture)
  const normalized = input.capture.rows.map((row) => normalizeCaptureRow(
    row,
    context.capturedAt,
    context.dateBounds,
    context.visualPatternSchemaVersion === PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION,
  ))
  const errorCounts = normalized.reduce<Record<string, number>>((counts, row) => {
    if ("error" in row) counts[row.error] = (counts[row.error] ?? 0) + 1
    return counts
  }, context.officialNoSoldResults ? { OFFICIAL_NO_SOLD_RESULTS: 1 } : {})
  const valid = normalized.filter((row): row is NormalizedCaptureRow => !("error" in row))
  // A structurally valid official table can legitimately contain no usable
  // historical-sale date. Preserve that negative result without converting a
  // displayed price or another numeric label into sold evidence. Other
  // all-row parser failures still reject the capture because they can signal
  // a broken extractor rather than an empty historical market.
  const zeroValidSoldRowsAccepted = context.officialNoSoldResults ||
    valid.length === 0 && Object.keys(errorCounts).length === 1 &&
      errorCounts.LAST_SOLD_DATE_INVALID === input.capture.rows.length
  if (!valid.length && !zeroValidSoldRowsAccepted) {
    const reasons = Object.entries(errorCounts).sort((left, right) => right[1] - left[1])
      .map(([code]) => code).slice(0, 3)
    throw new Error(`PRODUCT_RESEARCH_CAPTURE_NO_VALID_SOLD_ROWS:${reasons.join(":") || "UNKNOWN"}`)
  }
  const tokenFrequency = valid.reduce<Map<string, number>>((counts, row) => {
    for (const token of row.keywordSignals) counts.set(token, (counts.get(token) ?? 0) + 1)
    return counts
  }, new Map())
  const captureWindowHash = sha256({ dateRange: {
    label: context.rangeLabel, start: context.rangeStart, end: context.rangeEnd,
  }, capturedAt: context.capturedAt.toISOString().slice(0, 10) })
  const rows = valid.map((row): ClassifiedProductResearchCapture => {
    const match = classifyProductResearchCaptureRow(row, input.targets)
    const normalizedIdentity = observationIdentity(row, match)
    const keywordSignals = row.keywordSignals.filter((token) =>
      (tokenFrequency.get(token) ?? 0) >= 2).slice(0, 16)
    return {
      ...row,
      keywordSignals,
      matchClassification: match.classification,
      matchReasons: match.reasons,
      matchedTarget: match.target,
      normalizedIdentity,
      deduplicationKey: sha256({
        source: PRODUCT_RESEARCH_BROWSER_CAPTURE_SOURCE,
        sourceListingReferenceHash: row.sourceListingReferenceHash,
        identityHash: row.identityHash,
        packCount: row.detectedOfferPackCount,
        averageSoldPrice: row.averageSoldPrice,
        lastSoldDate: row.lastSoldDate,
        captureWindowHash,
      }),
    }
  })
  const uniqueRows = [...new Map(rows.map((row) => [row.deduplicationKey, row] as const)).values()]
  const matchCount = (classification: ProductResearchLunaMatch) =>
    uniqueRows.filter((row) => row.matchClassification === classification).length
  return {
    source: PRODUCT_RESEARCH_BROWSER_CAPTURE_SOURCE,
    importVersion: PRODUCT_RESEARCH_BROWSER_CAPTURE_VERSION,
    visualPatternSchemaVersion: context.visualPatternSchemaVersion,
    captureId: input.capture.captureId,
    captureHash: sha256({ captureId: input.capture.captureId, captureWindowHash,
      queryHash: sha256(context.query),
      resultState: context.officialNoSoldResults ? "NO_SOLD_RESULTS" : "SOLD_ROWS_VISIBLE",
      rows: uniqueRows.map((row) => row.deduplicationKey) }),
    captureWindowHash,
    listingSite: input.capture.listingSite,
    searchQueryHash: sha256(context.query.toLocaleLowerCase("en-US")),
    searchKeywordPatterns: titleTokens(context.query).slice(0, 16),
    dateRange: { label: context.rangeLabel, start: context.rangeStart, end: context.rangeEnd },
    capturedAt: context.capturedAt.toISOString(),
    sourceRowCount: input.capture.rows.length,
    validCount: valid.length,
    duplicateWithinCaptureCount: rows.length - uniqueRows.length,
    rejectedCount: input.capture.rows.length - valid.length,
    errorCounts,
    zeroValidSoldRowsAccepted,
    officialNoSoldResults: context.officialNoSoldResults,
    rows: uniqueRows,
    matchCounts: {
      exactLuna: matchCount("EXACT_LUNA_MATCH"),
      differentPack: matchCount("SAME_PRODUCT_DIFFERENT_PACK"),
      differentSize: matchCount("SAME_PRODUCT_DIFFERENT_SIZE"),
      differentVariant: matchCount("DIFFERENT_VARIANT"),
      ambiguous: matchCount("AMBIGUOUS"),
      noLunaMatch: matchCount("NO_LUNA_MATCH"),
    },
    rawHtmlStored: false,
    temporaryTitlesStored: false,
    competitorImagesDownloaded: 0,
    piiStored: false,
    openAiCalls: 0,
    ebayWrites: 0,
  }
}

export function productResearchCapturePersistenceRows(rows: ClassifiedProductResearchCapture[]) {
  return rows.map((row) => {
    const canBindLuna = !["AMBIGUOUS", "NO_LUNA_MATCH"].includes(row.matchClassification)
    return ({
    source_listing_id: row.sourceListingId,
    source_listing_reference_hash: row.sourceListingReferenceHash,
    title_fingerprint: row.titleFingerprint,
    identity_hash: row.identityHash,
    evidence_deduplication_key: row.deduplicationKey,
    normalized_identity: row.normalizedIdentity,
    detected_offer_pack_count: row.detectedOfferPackCount,
    detected_unit_count: row.detectedUnitCount,
    detected_size: row.detectedSize,
    detected_variant: row.detectedVariant,
    average_sold_price: row.averageSoldPrice,
    average_shipping: row.averageShipping,
    confirmed_sold_quantity: row.totalSold,
    item_sales: row.itemSales,
    last_sold_date: row.lastSoldDate,
    listing_format: row.listingFormat,
    free_shipping_percent: row.freeShippingPercent,
    bids: row.bids,
    visible_image_count: row.visibleImageCount,
    keyword_signals: row.keywordSignals,
    match_classification: row.matchClassification,
    match_reasons: row.matchReasons,
    matched_queue_item_id: canBindLuna ? row.matchedTarget?.queueItemId ?? null : null,
    matched_supplier_variant_id: canBindLuna ? row.matchedTarget?.supplierVariantId ?? null : null,
  })})
}

export function productResearchCapturePersistenceError(error: unknown) {
  const code = normalizedText(record(error).code, 40) ?? ""
  if (code === "23505") return "PRODUCT_RESEARCH_CAPTURE_IDEMPOTENCY_CONFLICT"
  if (code === "23514") return "PRODUCT_RESEARCH_CAPTURE_CONSTRAINT_REJECTED"
  if (code === "23503") return "PRODUCT_RESEARCH_CAPTURE_REFERENCE_MISMATCH"
  if (["PGRST202", "42883"].includes(code)) return "PRODUCT_RESEARCH_CAPTURE_RPC_SCHEMA_STALE"
  return "PRODUCT_RESEARCH_CAPTURE_PERSIST_FAILED"
}

function targetFromQueueRow(row: { id: string; supplier_variant_id: string; evidence_snapshot: unknown }) {
  const snapshot = record(row.evidence_snapshot)
  const identity = record(record(snapshot.identityEnrichment).identity)
  const productName = normalizedText(record(snapshot.product).name)
  if (!productName || !Object.keys(identity).length) return null
  return { id: row.id, queueItemId: row.id, supplierVariantId: row.supplier_variant_id,
    sourceType: "LOOP1_EVIDENCE" as const,
    identity: identity as ProductIdentityInput, productName }
}

export function targetFromCatalogRow(row: JsonRecord): ProductResearchCaptureTarget | null {
  const productName = normalizedText(row.title)
  const supplierVariantId = normalizedText(row.supplier_variant_id, 160)
  const supplierProductId = normalizedText(row.supplier_product_id ?? row.product_id, 160)
  if (!productName || !supplierVariantId || !supplierProductId) return null
  const metadata = record(row.metadata)
  const offer = detectProductResearchOfferFacts(`${productName} ${normalizedText(row.variant_title) ?? ""}`)
  const packCount = positiveInteger(metadata.packCount) ?? offer.packCount
  const rawVariant = normalizedText(metadata.variant ?? row.variant_title, 100)
  const variant = rawVariant && canonicalKey(rawVariant) !== "defaulttitle" ? rawVariant : null
  const identity = normalizeProductIdentity({
    manufacturerBrand: normalizedText(metadata.manufacturerBrand ?? metadata.brand),
    gtin: packCount === 1 || metadata.offerGtinVerified === true
      ? normalizedText(row.barcode, 32) : null,
    mpn: normalizedText(metadata.mpn ?? metadata.manufacturerPartNumber, 100),
    model: normalizedText(metadata.model ?? metadata.modelNumber, 100),
    productName,
    packCount,
    unitCount: positiveInteger(metadata.unitCount) ?? offer.unitCount,
    size: normalizedText(metadata.size, 50) ?? offer.size,
    color: normalizedText(metadata.color, 80),
    scent: normalizedText(metadata.scent ?? metadata.fragrance, 80),
    variant,
    condition: "new",
  })
  return {
    id: `catalog:${supplierProductId}:${supplierVariantId}`,
    queueItemId: null,
    supplierProductId,
    supplierVariantId,
    supplierSku: normalizedText(row.sku, 100),
    sourceType: "LUNA_CATALOG",
    identityEvidenceSource: normalizedText(metadata.identityEvidenceSource, 80) ===
      "LUNA_OFFICIAL_PRODUCT_DESCRIPTION"
      ? "LUNA_OFFICIAL_PRODUCT_DESCRIPTION" : "LUNA_STRUCTURED_CATALOG",
    identityEvidenceHash: normalizedText(metadata.identityEvidenceHash, 100),
    identity,
    productName,
  }
}

export function targetFromVerifiedActiveListingLink(input: {
  link: JsonRecord
  opportunity: JsonRecord
}): ProductResearchCaptureTarget | null {
  const supplierVariantId = normalizedText(input.link.supplier_variant_id, 160)
  const supplierSku = normalizedText(input.link.supplier_sku, 100)
  const productName = normalizedText(input.opportunity.product_title)
  const verificationStatus = normalizedText(input.link.verification_status, 50)
  const verificationMethod = normalizedText(input.link.verification_method, 80)
  if (!supplierVariantId || !productName || verificationStatus !== "verified" ||
    !["EBAY_TRADING_GET_ITEM_READONLY", "EBAY_SELL_INVENTORY_READONLY"].includes(
      verificationMethod ?? "",
    )) return null
  const variantTitle = normalizedText(input.opportunity.variant_title, 120)
  const offer = detectProductResearchOfferFacts(`${productName} ${variantTitle ?? ""}`)
  const variantParts = (variantTitle ?? "").split(/[·|]/).map((part) => part.trim())
    .filter((part) => part && canonicalKey(part) !== "defaulttitle" &&
      detectProductResearchOfferFacts(part).packCount === null)
  const gtin = offer.packCount === 1 ? normalizedText(input.opportunity.gtin, 32) : null
  return {
    id: `verified-listing:${normalizedText(input.link.id, 80) ?? supplierVariantId}`,
    queueItemId: null,
    supplierProductId: normalizedText(input.opportunity.supplier_product_id, 160),
    supplierVariantId,
    supplierSku,
    sourceType: "VERIFIED_ACTIVE_LISTING_LINK",
    officialLinkVerified: true,
    identity: normalizeProductIdentity({
      gtin,
      productName,
      packCount: offer.packCount,
      unitCount: offer.unitCount,
      size: offer.size,
      variant: variantParts[0] ?? null,
      condition: "new",
    }),
    productName,
  }
}

async function latestCaptureTargets(supabase: SupabaseClient, accountKey: string) {
  const { data: run, error: runError } = await supabase.from("marketplace_listing_approval_queue_runs")
    .select("id").eq("marketplace_account_key", accountKey).eq("marketplace", "EBAY_US")
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (runError) throw new Error("PRODUCT_RESEARCH_CAPTURE_RUN_READ_FAILED")
  const [queueResult, catalogResult, linksResult] = await Promise.all([
    run ? supabase.from("marketplace_listing_approval_queue_items")
      .select("id,supplier_variant_id,evidence_snapshot").eq("run_id", run.id)
      .eq("marketplace_account_key", accountKey).eq("marketplace", "EBAY_US")
      : Promise.resolve({ data: [], error: null }),
    supabase.from("market_radar_latest_variants")
      .select("product_id,supplier_product_id,supplier_variant_id,sku,barcode,title,variant_title,metadata")
      .eq("source_key", "lunaportex").limit(5_000),
    supabase.from("ebay_manual_listing_links")
      .select("id,opportunity_id,supplier_variant_id,supplier_sku,verification_status,verification_method")
      .eq("account_key", accountKey).eq("marketplace_id", "EBAY_US")
      .eq("verification_status", "verified").limit(1_000),
  ])
  if (queueResult.error || catalogResult.error || linksResult.error) {
    throw new Error("PRODUCT_RESEARCH_CAPTURE_TARGETS_READ_FAILED")
  }
  const opportunityIds = [...new Set((linksResult.data ?? [])
    .map((link) => normalizedText(link.opportunity_id, 80)).filter((id): id is string => Boolean(id)))]
  const opportunitiesResult = opportunityIds.length
    ? await supabase.from("ebay_luna_opportunity_queue")
      .select("id,supplier_product_id,product_title,variant_title,gtin,assessment")
      .in("id", opportunityIds)
    : { data: [], error: null }
  if (opportunitiesResult.error) throw new Error("PRODUCT_RESEARCH_CAPTURE_TARGETS_READ_FAILED")
  const queueTargets = (queueResult.data ?? []).map(targetFromQueueRow)
    .filter((value): value is NonNullable<ReturnType<typeof targetFromQueueRow>> => value !== null)
  const catalogTargets = (catalogResult.data ?? []).map((row) => targetFromCatalogRow(record(row)))
    .filter((value): value is ProductResearchCaptureTarget => value !== null)
  const opportunityById = new Map((opportunitiesResult.data ?? [])
    .map((opportunity) => [opportunity.id, record(opportunity)] as const))
  const verifiedLinkTargets = (linksResult.data ?? []).map((link) =>
    targetFromVerifiedActiveListingLink({
      link: record(link),
      opportunity: opportunityById.get(link.opportunity_id) ?? {},
    })).filter((value): value is ProductResearchCaptureTarget => value !== null)
  const byVariant = new Map<string, ProductResearchCaptureTarget>()
  for (const target of queueTargets) byVariant.set(target.supplierVariantId, target)
  for (const target of verifiedLinkTargets) if (!byVariant.has(target.supplierVariantId)) {
    byVariant.set(target.supplierVariantId, target)
  }
  for (const target of catalogTargets) if (!byVariant.has(target.supplierVariantId)) {
    byVariant.set(target.supplierVariantId, target)
  }
  return { runId: run?.id ?? null, targets: [...byVariant.values()] }
}

function visualComparableRows(rows: ClassifiedProductResearchCapture[]): VisualComparableRow[] {
  return rows.flatMap((row) => row.visualPattern ? [{
    evidenceDeduplicationKey: row.deduplicationKey,
    identityHash: row.identityHash,
    productFamilyFingerprint: row.productFamilyFingerprint,
    matchClassification: row.matchClassification,
    detectedOfferPackCount: row.detectedOfferPackCount,
    confirmedSoldQuantity: row.totalSold,
    lastSoldDate: row.lastSoldDate,
    visualPattern: row.visualPattern,
  }] : [])
}

function visualImportUnavailable(rows: VisualComparableRow[], error: string | null) {
  const count = (status: ProductResearchVisualPattern["analysisStatus"]) => rows.filter((row) =>
    row.visualPattern.analysisStatus === status).length
  return {
    captureSupported: rows.length > 0,
    thumbnailDetectedCount: rows.filter((row) => row.visualPattern.imagePresent).length,
    analyzedCount: count("ANALYZED"),
    partialCount: count("PARTIAL"),
    unavailableCount: count("UNAVAILABLE"),
    rejectedCount: count("REJECTED"),
    persistedCount: 0,
    existingVisualCount: 0,
    visualBriefs: [],
    error,
  }
}

async function persistVisualEnrichment(input: {
  supabase: SupabaseClient
  accountKey: string
  batchId: string
  runId: string | null
  parsed: ReturnType<typeof parseProductResearchBrowserCapture>
  categoryId: string | null
}) {
  const rows = visualComparableRows(input.parsed.rows)
  if (input.parsed.visualPatternSchemaVersion !== PRODUCT_RESEARCH_VISUAL_PATTERN_SCHEMA_VERSION) {
    return visualImportUnavailable([], null)
  }
  try {
    return await persistProductResearchVisualPatterns({
      supabase: input.supabase,
      accountKey: input.accountKey,
      captureBatchId: input.batchId,
      captureRunId: input.runId,
      queryContextHash: input.parsed.searchQueryHash,
      categoryId: input.categoryId,
      capturedAt: input.parsed.capturedAt,
      rows,
    })
  } catch {
    // Commercial evidence has already been durably imported. Visual enrichment is additive only.
    return visualImportUnavailable(rows, "VISUAL_PATTERN_PERSIST_UNAVAILABLE")
  }
}

export async function importProductResearchBrowserCapture(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  capture: ProductResearchBrowserCapture
  visualContext?: { categoryId?: string | null }
  now?: Date
}) {
  const { runId, targets } = await latestCaptureTargets(input.supabase, input.accountKey)
  const parsed = parseProductResearchBrowserCapture({ capture: input.capture, targets })
  const { data: duplicateBatch, error: duplicateBatchError } = await input.supabase
    .from("marketplace_product_research_capture_batches")
    .select("id,search_query_hash,source_row_count,valid_count,imported_count,duplicate_count,rejected_count,exact_luna_match_count,different_pack_count,different_size_count,different_variant_count,ambiguous_count,no_luna_match_count,candidates_enriched_count,error_counts,captured_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("capture_hash", parsed.captureHash).maybeSingle()
  if (duplicateBatchError) throw new Error("PRODUCT_RESEARCH_CAPTURE_DEDUP_READ_FAILED")
  if (duplicateBatch) {
    const visual = await persistVisualEnrichment({
      supabase: input.supabase,
      accountKey: input.accountKey,
      batchId: duplicateBatch.id,
      runId,
      parsed,
      categoryId: input.visualContext?.categoryId ?? null,
    })
    return { duplicate: true, batchId: duplicateBatch.id,
    searchQueryHash: duplicateBatch.search_query_hash,
    rowCount: duplicateBatch.source_row_count, validCount: duplicateBatch.valid_count,
    importedCount: duplicateBatch.imported_count, duplicateCount: duplicateBatch.duplicate_count,
    rejectedCount: duplicateBatch.rejected_count,
    matchCounts: { exactLuna: duplicateBatch.exact_luna_match_count,
      differentPack: duplicateBatch.different_pack_count,
      differentSize: duplicateBatch.different_size_count,
      differentVariant: duplicateBatch.different_variant_count,
      ambiguous: duplicateBatch.ambiguous_count, noLunaMatch: duplicateBatch.no_luna_match_count },
    candidatesEnriched: duplicateBatch.candidates_enriched_count,
    capturedAt: duplicateBatch.captured_at, reanalysisRequired: false,
    zeroValidSoldRowsAccepted: Number(duplicateBatch.valid_count) === 0,
    officialNoSoldResults:
      Number(record(duplicateBatch.error_counts).OFFICIAL_NO_SOLD_RESULTS) === 1,
    visual,
    rawHtmlStored: false, temporaryTitlesStored: false, competitorImagesDownloaded: 0,
    piiStored: false, openAiCalls: 0, ebayWrites: 0 }
  }

  const keys = parsed.rows.map((row) => row.deduplicationKey)
  const existing = new Set<string>()
  for (let offset = 0; offset < keys.length; offset += 100) {
    const { data, error } = await input.supabase.from("marketplace_product_research_capture_observations")
      .select("evidence_deduplication_key").eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").in("evidence_deduplication_key", keys.slice(offset, offset + 100))
    if (error) throw new Error("PRODUCT_RESEARCH_CAPTURE_OBSERVATION_DEDUP_FAILED")
    for (const row of data ?? []) existing.add(row.evidence_deduplication_key)
  }
  const fresh = parsed.rows.filter((row) => !existing.has(row.deduplicationKey))
  const duplicateCount = parsed.duplicateWithinCaptureCount + parsed.rows.length - fresh.length
  const candidatesEnriched = new Set(fresh.filter((row) => row.matchClassification === "EXACT_LUNA_MATCH")
    .map((row) => row.matchedTarget?.supplierVariantId).filter(Boolean)).size
  const batchId = randomUUID()
  const rpcRows = productResearchCapturePersistenceRows(fresh)
  const { error: persistError } = await input.supabase.rpc("import_product_research_browser_capture_v3", {
    p_batch_id: batchId,
    p_marketplace_account_key: input.accountKey,
    p_capture_hash: parsed.captureHash,
    p_capture_window_hash: parsed.captureWindowHash,
    p_listing_site: parsed.listingSite,
    p_search_query_hash: parsed.searchQueryHash,
    p_search_keyword_patterns: parsed.searchKeywordPatterns,
    p_date_range: parsed.dateRange,
    p_captured_at: parsed.capturedAt,
    p_source_row_count: parsed.sourceRowCount,
    p_valid_count: parsed.validCount,
    p_duplicate_count: duplicateCount,
    p_rejected_count: parsed.rejectedCount,
    p_exact_luna_match_count: parsed.matchCounts.exactLuna,
    p_different_pack_count: parsed.matchCounts.differentPack,
    p_different_size_count: parsed.matchCounts.differentSize,
    p_different_variant_count: parsed.matchCounts.differentVariant,
    p_ambiguous_count: parsed.matchCounts.ambiguous,
    p_no_luna_match_count: parsed.matchCounts.noLunaMatch,
    p_candidates_enriched_count: candidatesEnriched,
    p_error_counts: parsed.errorCounts,
    p_captured_by: input.actorId,
    p_observations: rpcRows,
  })
  if (persistError) throw new Error(productResearchCapturePersistenceError(persistError))

  const { data: importHashes, error: importHashError } = await input.supabase
    .from("marketplace_sold_evidence_import_batches").select("source_file_hash")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("status", "IMPORTED")
  const { data: captureHashes, error: captureHashError } = await input.supabase
    .from("marketplace_product_research_capture_batches").select("capture_hash")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
  if (importHashError || captureHashError) throw new Error("PRODUCT_RESEARCH_CAPTURE_VERSION_READ_FAILED")
  const soldEvidenceVersion = sha256([
    ...(importHashes ?? []).map((row) => row.source_file_hash),
    ...(captureHashes ?? []).map((row) => row.capture_hash),
  ].sort())
  if (runId && fresh.length) {
    const { error } = await input.supabase.from("marketplace_listing_approval_queue_runs")
      .update({ sold_evidence_version: soldEvidenceVersion,
        sold_evidence_imported_at: (input.now ?? new Date()).toISOString(),
        updated_at: (input.now ?? new Date()).toISOString() })
      .eq("id", runId).eq("marketplace_account_key", input.accountKey)
    if (error) throw new Error("PRODUCT_RESEARCH_CAPTURE_RUN_MARK_FAILED")
  }
  const visual = await persistVisualEnrichment({
    supabase: input.supabase,
    accountKey: input.accountKey,
    batchId,
    runId,
    parsed,
    categoryId: input.visualContext?.categoryId ?? null,
  })
  return { duplicate: false, batchId, searchQueryHash: parsed.searchQueryHash,
    rowCount: parsed.sourceRowCount,
    validCount: parsed.validCount, importedCount: fresh.length, duplicateCount,
    rejectedCount: parsed.rejectedCount, matchCounts: parsed.matchCounts,
    candidatesEnriched, capturedAt: parsed.capturedAt, reanalysisRequired: fresh.length > 0,
    zeroValidSoldRowsAccepted: parsed.zeroValidSoldRowsAccepted,
    officialNoSoldResults: parsed.officialNoSoldResults,
    visual,
    rawHtmlStored: false, temporaryTitlesStored: false, competitorImagesDownloaded: 0,
    piiStored: false, openAiCalls: 0, ebayWrites: 0 }
}

export async function getProductResearchBrowserCaptureStatus(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const [{ data: latest, error: latestError }, { data: run, error: runError }] = await Promise.all([
    input.supabase.from("marketplace_product_research_capture_batches")
      .select("id,source_row_count,valid_count,imported_count,duplicate_count,rejected_count,exact_luna_match_count,different_pack_count,different_size_count,different_variant_count,ambiguous_count,no_luna_match_count,candidates_enriched_count,captured_at,created_at")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    input.supabase.from("marketplace_listing_approval_queue_runs").select("id,ready_count")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (latestError || runError) throw new Error("PRODUCT_RESEARCH_CAPTURE_STATUS_READ_FAILED")
  return {
    configured: true,
    source: PRODUCT_RESEARCH_BROWSER_CAPTURE_SOURCE,
    officialOrigin: "MATCH_REQUIRED",
    receiverPath: "/admin/ebay/mobile-review/product-research-capture",
    latest: latest ?? null,
    readyResultCount: Number(run?.ready_count ?? 0),
    rawHtmlStored: false,
    temporaryTitlesStored: false,
    competitorImagesDownloaded: 0,
    piiStored: false,
    openAiCalls: 0,
    ebayWrites: 0,
    canPublish: false,
  }
}
