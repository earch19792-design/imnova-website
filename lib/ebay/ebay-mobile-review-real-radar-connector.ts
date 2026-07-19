import type { MarketRadarProductRow } from "@/lib/market-radar-types"
import {
  getMobileReviewPayloadError,
  readMobileReviewJson,
} from "./ebay-mobile-review-http.mjs"

export const EBAY_MOBILE_REVIEW_REAL_RADAR_CONNECTOR_VERSION =
  "EBAY_MOBILE_REVIEW_REAL_RADAR_CONNECTOR_V1"

export type RadarConnectorMode = "REAL_READONLY" | "DEMO_FIXTURE_ONLY"

export type RealRadarCandidate = {
  candidateRank: number
  candidateId: string
  marketRadarProductId: string
  marketRadarSnapshotId: string | null
  supplierProductId: string
  supplierVariantId: string | null
  supplierSku: string | null
  gtin: string | null
  weight: number | null
  weightUnit: string | null
  productName: string
  productTitle: string
  variantTitle: string | null
  brand: string | null
  productType: string | null
  handle: string
  productUrl: string | null
  imageReference: string | null
  lastSeenAt: string | null
  lastSnapshotAt: string | null
  inventoryStatus: string
  stockQuantity: number | null
  stockSource: string
  stockConfidence: string
  stockConfirmationAgeHours: number | null
  lunaPrice: number | null
  lunaCompareAtPrice: number | null
  discountPercent: number | null
  collections: string[]
  opportunityScore: number
  professionalReadinessStatus: string
  ebayEstimatedPrice: number | null
  ebayPriceSource: string | null
  categoryId: string | null
  pipelineStatus: string
  routeRecommendation: string
  missingFields: string[]
  riskFlags: string[]
  availabilityStatus: "AVAILABLE" | "REMOVED_FROM_LUNA_SCAN" | "UNKNOWN"
  suggestedPrice: { value: number; currency: "USD" }
  suggestedCategory: string
  listingBlueprintSummary: string
  marginPrecheckPassed: boolean
  demandValidationPassed: boolean
  imageValidationPassed: boolean
}

export type RadarProductInput = Partial<MarketRadarProductRow> & {
  ebay_price_source?: string | null
  ebay_category_id?: string | null
  ebay_demand_validation_passed?: boolean | null
  authorized_image_review_passed?: boolean | null
}

export type RealRadarConnectorInput = {
  products?: RadarProductInput[] | null
  mode?: RadarConnectorMode
}

export async function loadMarketRadarReadonlyDashboard(
  authorization: string,
  search?: string,
) {
  const request = globalThis["fetch"]
  const endpoint = search
    ? `/api/admin/market-radar?search=${encodeURIComponent(search)}`
    : "/api/admin/market-radar"
  const response = await request(endpoint, {
    method: "GET",
    cache: "no-store",
    headers: { Authorization: authorization },
  })
  const payload = await readMobileReviewJson<{
    success?: boolean
    error?: string
    dashboard?: { products?: RadarProductInput[] }
  }>(response, "Market Radar read-only no está disponible")
  if (!payload.success) {
    throw new Error(getMobileReviewPayloadError(payload, "Market Radar read-only no está disponible"))
  }
  return payload.dashboard?.products ?? []
}

export function findMarketRadarProductById(
  products: RadarProductInput[],
  productId: string,
) {
  const normalizedProductId = productId.trim()
  if (!normalizedProductId) return null
  return products.find(
    (product) => text(product.product_id) === normalizedProductId,
  ) ?? null
}

export async function loadMarketRadarReadonlyProductById(
  authorization: string,
  productId: string,
) {
  const normalizedProductId = productId.trim()
  if (!normalizedProductId) return null
  const products = await loadMarketRadarReadonlyDashboard(
    authorization,
    normalizedProductId,
  )
  return findMarketRadarProductById(products, normalizedProductId)
}

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const text = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback

export function getRealRadarCandidateRoute(product: RadarProductInput) {
  const inventoryStatus = text(product.inventory_status, "unknown")
  const observationStatus = text(product.observation_status, "observed")
  const age = numberOrNull(product.stock_confirmation_age_hours)

  if (
    inventoryStatus === "out_of_stock" ||
    observationStatus === "not_observed_latest_scan" ||
    observationStatus === "stale_missing_from_source"
  ) return "STOCK_HOLD"
  if (product.stock_reconfirmation_required === true || (age !== null && age > 24))
    return "NEED_STOCK_RECONFIRMATION"
  if (
    product.inventory_scope === "availability_only" ||
    product.inventory_scope === "unknown" ||
    !product.inventory_scope ||
    ((product.inventory_quantity === null || product.inventory_quantity === undefined) &&
      product.inventory_confidence === "low")
  ) return "NEED_STOCK_CONFIRMATION"
  if (numberOrNull(product.estimated_sale_price) === null || !product.ebay_price_source)
    return "NEED_EBAY_MARKET_PRICE"
  if (product.margin_precheck_passed !== true) return "NEED_MARGIN_REVIEW"
  return "NEED_MOBILE_REVIEW_OF_REAL_TOP5"
}

export function mapMarketRadarProductToMobileCandidate(
  product: RadarProductInput,
  candidateRank: number
): RealRadarCandidate {
  const routeRecommendation = getRealRadarCandidateRoute(product)
  const opportunityScore = numberOrNull(product.opportunity_score) ?? 0
  const lunaPrice = numberOrNull(product.price)
  const ebayEstimatedPrice = numberOrNull(product.estimated_sale_price)
  const unavailable = routeRecommendation === "STOCK_HOLD"
  const missingFields = [...(product.professional_missing_fields ?? [])]
  if (!product.ebay_category_id) missingFields.push("ebayCategoryId")
  if (!product.ebay_price_source) missingFields.push("ebayMarketPriceSource")
  const riskFlags = unavailable ? ["STOCK_HOLD"] : []

  return {
    candidateRank,
    candidateId: text(product.product_id),
    marketRadarProductId: text(product.product_id),
    marketRadarSnapshotId: product.snapshot_id ?? null,
    supplierProductId: text(product.supplier_product_id),
    supplierVariantId: product.supplier_variant_id ?? null,
    supplierSku: product.sku ?? null,
    gtin: product.barcode ?? null,
    weight: numberOrNull(product.weight),
    weightUnit: product.weight_unit ?? null,
    productName: text(product.title, "Producto sin título"),
    productTitle: text(product.title, "Producto sin título"),
    variantTitle: product.variant_title ?? null,
    // Luna vendor identifies the supplier, not the manufacturer brand.
    brand: null,
    productType: product.product_type ?? null,
    handle: text(product.handle),
    productUrl: product.product_url ?? null,
    imageReference: product.featured_image_url ?? null,
    lastSeenAt: product.last_seen_at ?? null,
    lastSnapshotAt: product.last_captured_at ?? null,
    inventoryStatus: text(product.observation_status, text(product.inventory_status, "unknown")),
    stockQuantity: product.inventory_quantity ?? null,
    stockSource: text(product.inventory_scope, text(product.inventory_source, "unknown")),
    stockConfidence: text(product.inventory_confidence, "unknown"),
    stockConfirmationAgeHours: numberOrNull(product.stock_confirmation_age_hours),
    lunaPrice,
    lunaCompareAtPrice: numberOrNull(product.compare_at_price),
    discountPercent: numberOrNull(product.discount_percent),
    collections: product.collections ?? [],
    opportunityScore,
    professionalReadinessStatus: text(product.professional_readiness_route, "PENDING"),
    ebayEstimatedPrice,
    ebayPriceSource: product.ebay_price_source ?? null,
    categoryId: product.ebay_category_id ?? null,
    pipelineStatus: text(product.pipeline_candidate_state, "NOT_IN_PIPELINE"),
    routeRecommendation,
    missingFields: [...new Set(missingFields)],
    riskFlags,
    availabilityStatus: unavailable ? "REMOVED_FROM_LUNA_SCAN" : "AVAILABLE",
    suggestedPrice: { value: ebayEstimatedPrice ?? lunaPrice ?? 0, currency: "USD" },
    suggestedCategory: product.ebay_category_id ?? "CATEGORY_PENDING",
    listingBlueprintSummary: `Radar read-only · ${routeRecommendation}`,
    marginPrecheckPassed: product.margin_precheck_passed === true,
    demandValidationPassed: product.ebay_demand_validation_passed === true,
    imageValidationPassed: product.authorized_image_review_passed === true,
  }
}

export function buildMobileReviewRealRadarConnector(
  input: RealRadarConnectorInput
) {
  const mode = input.mode ?? "REAL_READONLY"
  const fixtureUsed = mode === "DEMO_FIXTURE_ONLY"
  const products = input.products ?? []
  const ranked = [...products].sort(
    (left, right) =>
      (numberOrNull(right.opportunity_score) ?? 0) -
      (numberOrNull(left.opportunity_score) ?? 0)
  )
  const allCandidates = ranked.map((product, index) =>
    mapMarketRadarProductToMobileCandidate(product, index + 1)
  )
  const unavailableCandidates = allCandidates.filter(
    (candidate) => candidate.routeRecommendation === "STOCK_HOLD"
  )
  const stockHoldCandidates = unavailableCandidates
  const needsStockConfirmationCandidates = allCandidates.filter((candidate) =>
    ["NEED_STOCK_CONFIRMATION", "NEED_STOCK_RECONFIRMATION"].includes(
      candidate.routeRecommendation
    )
  )
  const top5Candidates = allCandidates
    .filter((candidate) => candidate.routeRecommendation !== "STOCK_HOLD")
    .slice(0, 5)
    .map((candidate, index) => ({ ...candidate, candidateRank: index + 1 }))
  const realRadarTop5Loaded = !fixtureUsed && top5Candidates.length === 5
  const eligibleCandidatesCount = top5Candidates.length
  const candidatesNeededForTop5 = Math.max(0, 5 - eligibleCandidatesCount)
  const dataSource = fixtureUsed
    ? "DEMO_FIXTURE_ONLY"
    : products.length
      ? "MARKET_RADAR_READONLY"
      : "NO_REAL_RADAR_DATA_AVAILABLE"
  const recommendedCandidate = top5Candidates[0] ?? null

  return {
    mobileReviewRealRadarConnectorBuilt: true,
    realRadarTop5Loaded,
    realRadarCandidatesCount: products.length,
    eligibleCandidatesCount,
    candidatesNeededForTop5,
    fixtureUsed,
    dataSource,
    allCandidates,
    top5Candidates,
    unavailableCandidates,
    stockHoldCandidates,
    needsStockConfirmationCandidates,
    recommendedCandidate,
    recommendedRoute: recommendedCandidate?.routeRecommendation ?? null,
    canProceedToB2RunPreflight: false,
    canPublish: false,
    decisionPersistence: "BROWSER_STATE_ONLY",
    officialApprovalRecord: false,
    supabaseWriteUsed: false,
    ebayApiUsed: false,
    ebayWriteUsed: false,
    nextRecommendedRoute: fixtureUsed
      ? "DEMO_ONLY_NO_APPROVAL"
      : realRadarTop5Loaded
        ? "NEED_MOBILE_REVIEW_OF_REAL_TOP5"
        : stockHoldCandidates.length
          ? "NEED_REVIEW_OF_RADAR_STOCK_HOLDS"
        : "NEED_MARKET_RADAR_REFRESH",
  }
}
