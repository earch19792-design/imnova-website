import { createHash } from "node:crypto"

const LUNA_HOSTS = new Set(["lunaportex.com", "www.lunaportex.com"])
const ALLOWED_PACK_SIZES = new Set([3, 6, 12])
const MAX_RESPONSE_BYTES = 1_000_000

type JsonRecord = Record<string, unknown>

export type DirectedLunaVariant = {
  id: string
  title: string
  sku: string
  sourceUnitBarcode: string | null
  sourceUnitPrice: number
  sourceCompareAtPrice: number | null
  available: boolean
  weight: number | null
  weightUnit: string | null
}

export type DirectedLunaProduct = {
  productId: string
  handle: string
  title: string
  vendor: string | null
  productType: string | null
  canonicalUrl: string
  imageUrls: string[]
  variants: DirectedLunaVariant[]
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function safeImageUrl(value: unknown) {
  const candidate = text(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate.startsWith("//") ? `https:${candidate}` : candidate)
    if (url.protocol !== "https:") return null
    const shopifyHost = url.hostname === "shopify.com" ||
      url.hostname.endsWith(".shopify.com")
    if (!shopifyHost && !LUNA_HOSTS.has(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

export function parseDirectedLunaProductUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000) {
    throw new Error("LUNA_DIRECTED_IMPORT_URL_INVALID")
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("LUNA_DIRECTED_IMPORT_URL_INVALID")
  }
  if (url.protocol !== "https:" || !LUNA_HOSTS.has(url.hostname)) {
    throw new Error("LUNA_DIRECTED_IMPORT_URL_INVALID")
  }
  const match = url.pathname.match(/^\/products\/([^/]+)\/?$/)
  if (!match) throw new Error("LUNA_DIRECTED_IMPORT_URL_INVALID")
  let handle: string
  try {
    handle = decodeURIComponent(match[1]).toLowerCase()
  } catch {
    throw new Error("LUNA_DIRECTED_IMPORT_URL_INVALID")
  }
  const handleCodepoints = [...handle]
  if (
    handleCodepoints.length < 1 ||
    handleCodepoints.length > 181 ||
    !/^[\p{L}\p{N}\p{M}\p{Extended_Pictographic}\u200D-]+$/u.test(handle) ||
    !/^[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(handle)
  ) {
    throw new Error("LUNA_DIRECTED_IMPORT_URL_INVALID")
  }
  const encodedHandle = encodeURIComponent(handle)
  return {
    handle,
    canonicalUrl: `https://lunaportex.com/products/${encodedHandle}`,
    jsonUrl: `https://lunaportex.com/products/${encodedHandle}.js`,
  }
}

export function normalizeDirectedPackSizes(value: unknown) {
  if (!Array.isArray(value)) throw new Error("LUNA_DIRECTED_IMPORT_PACKS_INVALID")
  const packs = [...new Set(value.map(Number))].sort((left, right) => left - right)
  if (!packs.length || packs.some((pack) => !ALLOWED_PACK_SIZES.has(pack))) {
    throw new Error("LUNA_DIRECTED_IMPORT_PACKS_INVALID")
  }
  return packs
}

export async function fetchDirectedLunaProduct(
  productUrl: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<DirectedLunaProduct> {
  const parsedUrl = parseDirectedLunaProductUrl(productUrl)
  const response = await fetchImpl(parsedUrl.jsonUrl, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
  if (!response.ok || response.status >= 300) {
    throw new Error(`LUNA_DIRECTED_IMPORT_FETCH_${response.status}`)
  }
  const responseUrl = new URL(response.url || parsedUrl.jsonUrl)
  if (!LUNA_HOSTS.has(responseUrl.hostname) || responseUrl.protocol !== "https:") {
    throw new Error("LUNA_DIRECTED_IMPORT_REDIRECT_REJECTED")
  }
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > MAX_RESPONSE_BYTES) throw new Error("LUNA_DIRECTED_IMPORT_RESPONSE_TOO_LARGE")
  const raw = await response.text()
  if (raw.length > MAX_RESPONSE_BYTES) throw new Error("LUNA_DIRECTED_IMPORT_RESPONSE_TOO_LARGE")
  let payload: JsonRecord
  try {
    payload = record(JSON.parse(raw))
  } catch {
    throw new Error("LUNA_DIRECTED_IMPORT_RESPONSE_INVALID")
  }
  const productId = String(payload.id ?? "")
  const title = text(payload.title)
  const handle = text(payload.handle)
  if (!/^\d{1,30}$/.test(productId) || !title || handle !== parsedUrl.handle) {
    throw new Error("LUNA_DIRECTED_IMPORT_PRODUCT_INVALID")
  }
  const variants = Array.isArray(payload.variants)
    ? payload.variants.map(record).map((variant): DirectedLunaVariant | null => {
        const id = String(variant.id ?? "")
        const sku = text(variant.sku)
        const cents = Number(variant.price)
        if (
          !/^\d{1,30}$/.test(id) ||
          !sku ||
          sku.length > 120 ||
          !Number.isInteger(cents) ||
          cents <= 0 ||
          typeof variant.available !== "boolean"
        ) {
          return null
        }
        const grams = Number(variant.grams)
        const weight = Number(variant.weight)
        const hasGrams = Number.isFinite(grams) && grams > 0
        const compareAtCents = Number(variant.compare_at_price)
        return {
          id,
          title: text(variant.title) ?? "Variante general",
          sku,
          sourceUnitBarcode: text(variant.barcode),
          sourceUnitPrice: cents / 100,
          sourceCompareAtPrice: Number.isInteger(compareAtCents) && compareAtCents > 0
            ? compareAtCents / 100
            : null,
          available: variant.available,
          weight: hasGrams
            ? grams
            : Number.isFinite(weight) && weight > 0 ? weight : null,
          weightUnit: hasGrams ? "g" : text(variant.weight_unit),
        }
      }).filter((variant): variant is DirectedLunaVariant => Boolean(variant))
    : []
  if (!variants.length) throw new Error("LUNA_DIRECTED_IMPORT_VARIANT_REQUIRED")
  const imageUrls = Array.isArray(payload.images)
    ? payload.images.map(safeImageUrl).filter((url): url is string => Boolean(url)).slice(0, 24)
    : []
  return {
    productId,
    handle,
    title,
    vendor: text(payload.vendor),
    productType: text(payload.type),
    canonicalUrl: parsedUrl.canonicalUrl,
    imageUrls,
    variants,
  }
}

export function buildDirectedLunaPackRows(input: {
  product: DirectedLunaProduct
  sourceVariantId: unknown
  packSizes: unknown
  humanConfirmedCommercialPacks: unknown
  observedAt?: Date
}) {
  if (input.humanConfirmedCommercialPacks !== true) {
    throw new Error("LUNA_DIRECTED_IMPORT_HUMAN_CONFIRMATION_REQUIRED")
  }
  const packs = normalizeDirectedPackSizes(input.packSizes)
  const sourceVariantId = String(input.sourceVariantId ?? "")
  const variant = input.product.variants.find((item) => item.id === sourceVariantId)
  if (!variant) throw new Error("LUNA_DIRECTED_IMPORT_VARIANT_INVALID")
  if (!variant.available) throw new Error("LUNA_DIRECTED_IMPORT_SOURCE_UNAVAILABLE")
  const observedAt = (input.observedAt ?? new Date()).toISOString()
  return packs.map((packQuantity) => {
    const candidateKey = `luna-portex:directed:${input.product.productId}:${variant.id}:pack-${packQuantity}`
    const supplierPrice = Number((variant.sourceUnitPrice * packQuantity).toFixed(2))
    return {
      candidate_key: candidateKey,
      market_radar_product_id: null,
      supplier_product_id: input.product.productId,
      supplier_variant_id: variant.id,
      supplier_sku: variant.sku,
      product_title: input.product.title,
      variant_title: `${packQuantity} Pack · ${variant.title}`,
      // A unit UPC must never be represented as the GTIN of a multipack.
      gtin: null,
      queue_status: "review",
      decision: "DIRECTED_LUNA_PACK_INTAKE",
      opportunity_score: 0,
      demand_score: 0,
      economics_score: 0,
      identity_score: 0,
      competition_score: 0,
      supply_score: 0,
      listing_readiness_score: 0,
      supplier_price: supplierPrice,
      supplier_available: true,
      supplier_inventory_quantity: null,
      supplier_snapshot_at: observedAt,
      hard_gates: [
        "NEED_AUTHORIZED_PRODUCT_IMAGES",
        "NEED_PACKAGE_WEIGHT_AND_DIMENSIONS",
        "NEED_EBAY_TAXONOMY_CATEGORY",
        "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
        "NEED_EXACT_PACK_INVENTORY_CONFIRMATION",
        "NEED_EBAY_EXACT_IDENTITY_CONFIRMATION",
        "NEED_UNIT_ECONOMICS_VALIDATION",
      ],
      evidence_guards: [],
      assessment: {
        intakeMode: "DIRECTED_LUNA_MANUAL_PACK",
        canProceedToListingPackage: false,
        candidate: {
          title: input.product.title,
          variantTitle: `${packQuantity} Pack · ${variant.title}`,
          sku: variant.sku,
          packQuantity,
          productUrl: input.product.canonicalUrl,
          imageUrls: input.product.imageUrls,
          sourceUnitBarcode: variant.sourceUnitBarcode,
          sourceUnitPrice: variant.sourceUnitPrice,
          description: "",
        },
        sourceVerification: {
          officialLunaProductFetched: true,
          sourceHost: "lunaportex.com",
          sourceProductId: input.product.productId,
          sourceVariantId: variant.id,
          sourceSku: variant.sku,
          sourceAvailable: true,
          exactInventoryQuantityKnown: false,
          humanConfirmedCommercialPacks: true,
          observedAt,
          payloadDigest: createHash("sha256")
            .update(`${input.product.productId}:${variant.id}:${variant.sku}:${variant.sourceUnitPrice}`)
            .digest("hex"),
        },
        economics: {
          ready: false,
          sourceUnitCost: variant.sourceUnitPrice,
          packSourceCost: supplierPrice,
          targetSellingPrice: null,
        },
        identity: {
          exactIdentityConfirmed: false,
          sourceUnitBarcodeExcludedFromMultipackGtin: true,
        },
        scores: {
          potentialScore: 0,
          confidenceScore: 0,
          urgencyScore: 0,
          sellerPriorityScore: 0,
        },
      },
      last_scanned_at: observedAt,
      next_scan_at: observedAt,
      updated_at: observedAt,
    }
  })
}

export function isDirectedLunaManualPackAssessment(value: unknown) {
  const assessment = record(value)
  const verification = record(assessment.sourceVerification)
  return assessment.intakeMode === "DIRECTED_LUNA_MANUAL_PACK"
    && verification.officialLunaProductFetched === true
    && verification.sourceHost === "lunaportex.com"
    && verification.humanConfirmedCommercialPacks === true
    && verification.sourceAvailable === true
}
