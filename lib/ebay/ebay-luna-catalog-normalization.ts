import type {
  LunaOpportunityCandidateInput,
  NormalizedLunaOpportunityCandidate,
} from "./ebay-luna-opportunity-types.ts"

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = numberOrNull(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizedGtin(value: unknown) {
  const parsed = text(value)?.replace(/\D/g, "") ?? ""
  return /^\d{8,14}$/.test(parsed) ? parsed : null
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()))]
    : []
}

function stockAgeHours(value: string | null, now: Date) {
  if (!value) return null
  const captured = new Date(value)
  if (!Number.isFinite(captured.getTime())) return null
  return Math.max(0, Math.round(((now.getTime() - captured.getTime()) / 3_600_000) * 100) / 100)
}

function normalizeDimensions(value: LunaOpportunityCandidateInput["dimensions"]) {
  if (!value) return null
  const length = numberOrNull(value.length)
  const width = numberOrNull(value.width)
  const height = numberOrNull(value.height)
  const unit = text(value.unit)
  if (length === null || width === null || height === null || !unit) return null
  return { length, width, height, unit }
}

function buildCandidateKey(input: LunaOpportunityCandidateInput) {
  const derived = [
    "luna-portex",
    text(input.supplierProductId),
    text(input.supplierVariantId) ?? text(input.sku),
  ].filter(Boolean).join(":")
  return text(input.candidateKey) ?? (derived || "luna-portex:unknown-candidate")
}

export function normalizeLunaOpportunityCandidate(
  input: LunaOpportunityCandidateInput,
  nowValue: string | Date = new Date()
): NormalizedLunaOpportunityCandidate {
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue)
  const metadata = input.metadata ?? {}
  const title = text(input.title) ?? text(input.productName) ?? "Untitled Luna Portex product"
  const brand = text(input.brand) ?? text(input.vendor) ?? text(metadata.brand)
  const mpn = text(input.mpn) ?? text(metadata.mpn) ?? text(metadata.model)
  const gtin = normalizedGtin(input.gtin) ?? normalizedGtin(input.upc) ??
    normalizedGtin(input.barcode) ?? normalizedGtin(metadata.gtin) ??
    normalizedGtin(metadata.upc) ?? normalizedGtin(metadata.barcode)
  const color = text(input.color) ?? text(metadata.color)
  const size = text(input.size) ?? text(metadata.size)
  const packQuantity = positiveInteger(input.packQuantity ?? metadata.packQuantity)
  const missingIdentityFields = [
    !gtin && "gtin",
    !brand && "brand",
    !mpn && "mpn",
    !color && "color",
    !size && "size",
    !packQuantity && "packQuantity",
  ].filter((entry): entry is string => Boolean(entry))
  const identityDataCompleteness = Math.round(
    ((6 - missingIdentityFields.length) / 6) * 100
  )
  return {
    candidateKey: buildCandidateKey(input),
    marketRadarProductId: text(input.marketRadarProductId),
    supplierProductId: text(input.supplierProductId),
    supplierVariantId: text(input.supplierVariantId),
    sku: text(input.sku),
    title,
    variantTitle: text(input.variantTitle),
    brand,
    mpn,
    gtin,
    color,
    size,
    packQuantity,
    productType: text(input.productType),
    categoryId: /^\d+$/.test(text(input.categoryId) ?? "") ? text(input.categoryId) : null,
    categoryHint: text(input.categoryHint),
    description: text(input.description),
    tags: strings(input.tags),
    supplierCost: numberOrNull(input.supplierCost ?? input.price),
    available: typeof input.available === "boolean" ? input.available : null,
    inventoryQuantity: numberOrNull(input.inventoryQuantity),
    stockCapturedAt: text(input.stockCapturedAt),
    stockAgeHours: stockAgeHours(text(input.stockCapturedAt), now),
    weight: numberOrNull(input.weight),
    weightUnit: text(input.weightUnit),
    dimensions: normalizeDimensions(input.dimensions),
    imageUrls: strings(input.imageUrls),
    imageAuthorized: input.imageAuthorized === true,
    restrictionGuards: strings(input.restrictionGuards),
    identityDataCompleteness,
    missingIdentityFields,
    source: "LUNA_PORTEX",
  }
}

export function buildEbayDemandCandidateFromLuna(
  input: NormalizedLunaOpportunityCandidate
) {
  return {
    productName: input.title,
    variantTitle: input.variantTitle,
    supplierSku: input.sku,
    categoryId: input.categoryId,
    gtin: input.gtin,
    brand: input.brand,
    mpn: input.mpn,
    color: input.color,
    size: input.size,
    packQuantity: input.packQuantity,
    productType: input.productType,
    description: input.description,
  }
}
