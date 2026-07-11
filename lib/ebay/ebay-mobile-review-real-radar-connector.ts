import type { MarketRadarProductRow } from "@/lib/market-radar-types"

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
  productName: string
  productTitle: string
  variantTitle: string | null
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
}

export type RadarProductInput = Partial<MarketRadarProductRow> & {
  ebay_price_source?: string | null
  ebay_category_id?: string | null
}

export type RealRadarConnectorInput = {
  products?: RadarProductInput[] | null
  mode?: RadarConnectorMode
}

export async function loadMarketRadarReadonlyDashboard(authorization: string) {
  const request = globalThis["fetch"]
  const response = await request("/api/admin/market-radar", {
    method: "GET",
    cache: "no-store",
    headers: { Authorization: authorization },
  })
  const payload = (await response.json()) as {
    success?: boolean
    dashboard?: { products?: RadarProductInput[] }
  }
  if (!response.ok || !payload.success) {
    throw new Error("Market Radar read-only no está disponible.")
  }
  return payload.dashboard?.products ?? []
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
  if (product.inventory_scope === "availability_only")
    return "NEED_STOCK_CONFIRMATION"
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
    productName: text(product.title, "Producto sin título"),
    productTitle: text(product.title, "Producto sin título"),
    variantTitle: product.variant_title ?? null,
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
  const allCandidates = ranked.map(mapMarketRadarProductToMobileCandidate)
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
