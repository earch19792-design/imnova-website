import type {
  CommercialListingReadModel,
  CommercialMetricKey,
  EbayListingQualityRecommendation,
  Observation,
} from "./commercial-monitor-readonly-contract"

export const MAYEL_COMMERCIAL_INTELLIGENCE_VERSION =
  "MAYEL_COMMERCIAL_INTELLIGENCE_V1" as const

export type MayelCommercialCapabilityStatus = "AVAILABLE" | "PARTIAL" |
  "UNAVAILABLE"

type JsonRecord = Record<string, unknown>

export type MayelMarketEvidenceRowV1 = Readonly<{
  id?: unknown
  item_id?: unknown
  source_listing_id?: unknown
  matched_supplier_variant_id?: unknown
  match_classification?: unknown
  match_reasons?: unknown
  normalized_identity?: unknown
  average_sold_price?: unknown
  average_shipping?: unknown
  confirmed_sold_quantity?: unknown
  last_sold_date?: unknown
  created_at?: unknown
  evidence_reviewed?: unknown
  quality_status?: unknown
}>

export type MayelCommercialFieldV1 = Readonly<{
  value: number | null
  status: MayelCommercialCapabilityStatus
  source: string | null
  observedAt: string | null
  freshness: "FRESH" | "STALE" | "UNKNOWN" | "NOT_APPLICABLE"
  limitationCode: string | null
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").trim().slice(0, maximum) : null
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function date(value: unknown) {
  const parsed = text(value, 80)
  return parsed && Number.isFinite(Date.parse(parsed))
    ? new Date(parsed).toISOString() : null
}

function median(values: readonly number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2))
    : sorted[middle]
}

function metric(
  listing: CommercialListingReadModel,
  key: CommercialMetricKey,
): MayelCommercialFieldV1 {
  const observation = listing.metrics[key] as Observation<number> | undefined
  if (!observation) return Object.freeze({
    value: null,
    status: "UNAVAILABLE" as const,
    source: null,
    observedAt: null,
    freshness: "UNKNOWN" as const,
    limitationCode: "METRIC_NOT_IN_CURRENT_READ_MODEL",
  })
  const available = observation.availability === "AVAILABLE" &&
    number(observation.value) !== null
  const partial = observation.availability === "PARTIAL" &&
    number(observation.value) !== null
  return Object.freeze({
    value: available || partial ? number(observation.value) : null,
    status: available ? "AVAILABLE" as const : partial ? "PARTIAL" as const
      : "UNAVAILABLE" as const,
    source: text(observation.source?.system, 120),
    observedAt: date(observation.capturedAt),
    freshness: observation.freshness?.status ?? "UNKNOWN",
    limitationCode: text(observation.limitationCode, 180),
  })
}

function newestDate(values: readonly (string | null)[]) {
  return values.filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
}

function evidenceTitle(identity: JsonRecord) {
  return text(identity.title ?? identity.productTitle ?? identity.productName,
    180)
}

function pricePosition(action: string | null, fresh: boolean) {
  if (!fresh) return "EVIDENCIA_VENCIDA" as const
  if (action === "LOWER_TO_CONFIRMED_SOLD_BAND") {
    return "POR_ENCIMA_DEL_MERCADO" as const
  }
  if (action === "RAISE_TO_CONFIRMED_SOLD_BAND") {
    return "POR_DEBAJO_DEL_MERCADO" as const
  }
  if (action === "KEEP_PRICE_IN_CONFIRMED_SOLD_BAND") {
    return "DENTRO_DEL_MERCADO" as const
  }
  return "MERCADO_POR_COMPROBAR" as const
}

function commercialInterpretation(input: Readonly<{
  reasonCodes: readonly string[]
  pricePosition: ReturnType<typeof pricePosition>
  marketStatus: MayelCommercialCapabilityStatus
}>) {
  if (input.marketStatus === "UNAVAILABLE" ||
      input.pricePosition === "EVIDENCIA_VENCIDA") {
    return Object.freeze({
      classification: "REVALIDAR_PRIMERO" as const,
      explanation:
        "La evidencia de mercado no permite atribuir el problema a precio o imágenes.",
    })
  }
  if (input.reasonCodes.includes("LOW_CTR_WITH_SUFFICIENT_IMPRESSIONS") &&
      input.pricePosition === "DENTRO_DEL_MERCADO") {
    return Object.freeze({
      classification: "POSIBLE_OPORTUNIDAD_VISUAL" as const,
      explanation:
        "El precio está dentro del mercado y el CTR probado es bajo; conviene revisar la presentación visual.",
    })
  }
  if (input.reasonCodes.includes("TRAFFIC_WITHOUT_CONVERSION") &&
      input.pricePosition === "POR_ENCIMA_DEL_MERCADO") {
    return Object.freeze({
      classification: "REVISAR_PRECIO_O_MERCADO" as const,
      explanation:
        "Hay tráfico sin conversión y el precio está sobre la banda vendida; no se culpa automáticamente a las imágenes.",
    })
  }
  return Object.freeze({
    classification: "SOLO_OBSERVAR" as const,
    explanation:
      "No existe evidencia suficiente para atribuir el resultado a una sola causa.",
  })
}

function capabilityAudit(
  quality: readonly EbayListingQualityRecommendation[],
) {
  return Object.freeze([
    { type: "ITEM_SPECIFIC_LISTING_QUALITY", status:
      quality.length ? "AVAILABLE" as const : "PARTIAL" as const,
      source: "EBAY_LISTING_QUALITY_REPORT",
      limitationCode: quality.length ? null :
        "NO_CURRENT_EXACT_LISTING_RECOMMENDATION" },
    { type: "PROMOTED_LISTINGS_RECOMMENDED_AD_RATE",
      status: "PARTIAL" as const,
      source: "EBAY_SELL_RECOMMENDATION_API_AD_READONLY",
      limitationCode: "AVAILABLE_ON_DEMAND_NOT_DURABLY_CACHED" },
    { type: "RECOMMENDED_PRICE_OR_PRICE_ADJUSTMENT",
      status: "UNAVAILABLE" as const, source: null,
      limitationCode: "OFFICIAL_EBAY_PRICE_RECOMMENDATION_SOURCE_UNPROVEN" },
    { type: "SIMILAR_LISTINGS_OR_SIMILAR_SOLD_CONTEXT",
      status: "UNAVAILABLE" as const, source: null,
      limitationCode: "OFFICIAL_EBAY_SIMILAR_LISTINGS_SOURCE_UNPROVEN" },
    { type: "FREE_SHIPPING", status: "UNAVAILABLE" as const, source: null,
      limitationCode: "OFFICIAL_EBAY_SHIPPING_RECOMMENDATION_SOURCE_UNPROVEN" },
    { type: "BUYER_INTEREST_SEND_OFFER_AUTOMATED_OFFER",
      status: "UNAVAILABLE" as const, source: null,
      limitationCode: "OFFICIAL_EBAY_OFFER_RECOMMENDATION_SOURCE_UNPROVEN" },
    { type: "CATEGORY_IDENTIFIERS_RETURNS_OTHER",
      status: "PARTIAL" as const,
      source: "EBAY_LISTING_QUALITY_REPORT",
      limitationCode: "ONLY_WHEN_PRESENT_IN_OFFICIAL_QUALITY_REPORT" },
  ])
}

export function buildMayelCommercialIntelligenceV1(input: Readonly<{
  listing: CommercialListingReadModel
  commercialDashboard: unknown
  marketEvidence: readonly MayelMarketEvidenceRowV1[]
  marketEvidenceReadStatus?: MayelCommercialCapabilityStatus
  marketEvidenceLimitationCode?: string | null
  qualityRecommendations: readonly EbayListingQualityRecommendation[]
  decisionReasonCodes?: readonly string[]
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const itemId = input.listing.identity.itemId
  const supplierVariantId = input.listing.stock.supplierVariantId
  const dashboard = record(input.commercialDashboard)
  const competitorWatch = record(dashboard.competitorWatch)
  const profiles = Array.isArray(competitorWatch.profiles)
    ? competitorWatch.profiles.map(record) : []
  const profile = profiles.find((row) => text(row.listing_id, 30) === itemId)
    ?? null
  const priceEvents = Array.isArray(competitorWatch.priceRecommendations)
    ? competitorWatch.priceRecommendations.map(record) : []
  const priceEvent = priceEvents.find((row) =>
    text(row.listingId, 30) === itemId) ?? null
  const priceRecommendation = record(priceEvent?.priceRecommendation)
  const allRows = supplierVariantId ? input.marketEvidence.filter((value) =>
    text(value.matched_supplier_variant_id, 100) === supplierVariantId) : []
  const reviewedRows = allRows.filter((value) =>
    value.evidence_reviewed === true &&
    (!text(value.quality_status, 40) || value.quality_status === "VALID"))
  const acceptedRows = reviewedRows.filter((value) =>
    value.match_classification === "EXACT_LUNA_MATCH")
  const rejectedRows = reviewedRows.filter((value) =>
    value.match_classification !== "EXACT_LUNA_MATCH")
  const comparable = (value: MayelMarketEvidenceRowV1,
    accepted: boolean) => {
    const identity = record(value.normalized_identity)
    const soldPrice = number(value.average_sold_price)
    const shippingCost = number(value.average_shipping)
    return Object.freeze({
      evidenceId: text(value.id, 80),
      ebayItemId: text(value.item_id ?? value.source_listing_id, 30),
      title: evidenceTitle(identity),
      titleAvailability: evidenceTitle(identity) ? "AVAILABLE" as const
        : "UNAVAILABLE_PRIVACY_MINIMIZED" as const,
      soldPrice,
      shippingCost,
      landedPrice: soldPrice !== null && shippingCost !== null
        ? Number((soldPrice + shippingCost).toFixed(2)) : null,
      soldQuantity: number(value.confirmed_sold_quantity),
      soldAt: date(value.last_sold_date),
      condition: text(identity.condition ?? identity.conditionName, 80),
      classification: accepted ? "ACEPTADO" as const : "RECHAZADO" as const,
      matchClassification: text(value.match_classification, 80),
      reason: Array.isArray(value.match_reasons)
        ? value.match_reasons.map((reason) => text(reason, 160))
          .filter((reason): reason is string => Boolean(reason))[0] ??
            (accepted ? "PRODUCTO_EXACTO" : "NO_ES_PRODUCTO_EXACTO")
        : accepted ? "PRODUCTO_EXACTO" : "NO_ES_PRODUCTO_EXACTO",
      source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
    })
  }
  const accepted = acceptedRows.map((row) => comparable(row, true))
  const rejected = rejectedRows.map((row) => comparable(row, false))
  const freshAccepted = accepted.filter((row) => row.soldAt &&
    now.getTime() - Date.parse(row.soldAt) <= 90 * 86_400_000)
  const soldPrices = freshAccepted.map((row) => row.landedPrice ?? row.soldPrice)
    .filter((value): value is number => value !== null)
  const soldQuantities = accepted.map((row) => row.soldQuantity)
    .filter((value): value is number => value !== null)
  const lastResearchAt = newestDate(reviewedRows.map((row) =>
    date(row.created_at))) ?? date(profile?.last_scanned_at)
  const newestSoldAt = newestDate(accepted.map((row) => row.soldAt))
  const evidenceFresh = Boolean(newestSoldAt &&
    now.getTime() - Date.parse(newestSoldAt) <= 90 * 86_400_000)
  const marketStatus: MayelCommercialCapabilityStatus =
    input.marketEvidenceReadStatus === "UNAVAILABLE"
      ? "UNAVAILABLE" : accepted.length && evidenceFresh
        ? rejected.length || input.marketEvidenceReadStatus === "PARTIAL"
          ? "PARTIAL" : "AVAILABLE"
        : accepted.length ? "PARTIAL" : "UNAVAILABLE"
  const position = pricePosition(text(priceRecommendation.action, 100),
    evidenceFresh)
  const quality = input.qualityRecommendations.filter((row) =>
    row.listingKey === input.listing.key &&
    row.associationStatus !== "UNPROVEN")
  const economicKeys = ["listing_price", "supplier_cost", "shipping", "fees",
    "net_profit", "margin", "roi"] as const
  const availableEconomicFieldCount = economicKeys.filter((key) =>
    metric(input.listing, key).status === "AVAILABLE").length
  const economicsStatus: MayelCommercialCapabilityStatus =
    availableEconomicFieldCount === economicKeys.length ? "AVAILABLE" :
      availableEconomicFieldCount > 0 ? "PARTIAL" : "UNAVAILABLE"
  const economics = Object.freeze({
    status: economicsStatus,
    livePrice: metric(input.listing, "listing_price"),
    supplierCost: metric(input.listing, "supplier_cost"),
    shippingCost: metric(input.listing, "shipping"),
    ebayFees: metric(input.listing, "fees"),
    otherCostsOrReserves: metric(input.listing, "promoted_fees"),
    expectedProfit: metric(input.listing, "net_profit"),
    marginPercent: metric(input.listing, "margin"),
    roi: metric(input.listing, "roi"),
    unknownNeverRenderedAsZero: true as const,
  })
  return Object.freeze({
    contractVersion: MAYEL_COMMERCIAL_INTELLIGENCE_VERSION,
    status: economics.status === "AVAILABLE" && marketStatus === "AVAILABLE"
      ? "AVAILABLE" as const : economics.status === "UNAVAILABLE" &&
        marketStatus === "UNAVAILABLE" ? "UNAVAILABLE" as const
        : "PARTIAL" as const,
    workspaceIndependentFromCommercialFeed: true as const,
    economics,
    market: Object.freeze({
      status: marketStatus,
      source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
      lastResearchAt,
      freshness: accepted.length ? evidenceFresh ? "FRESH" as const
        : "STALE" as const : "UNKNOWN" as const,
      limitationCode: input.marketEvidenceLimitationCode ??
        (!supplierVariantId ? "SUPPLIER_VARIANT_LINK_REQUIRED" :
          !accepted.length ? "EXACT_SOLD_COMPARABLES_NOT_AVAILABLE" : null),
      soldComparableCount: accepted.length || marketStatus !== "UNAVAILABLE"
        ? accepted.length : null,
      acceptedComparableCount: accepted.length || marketStatus !== "UNAVAILABLE"
        ? accepted.length : null,
      rejectedComparableCount: reviewedRows.length ||
          marketStatus !== "UNAVAILABLE" ? rejected.length : null,
      soldPriceMinimum: soldPrices.length ? Math.min(...soldPrices) : null,
      soldPriceMedian: median(soldPrices),
      soldPriceMaximum: soldPrices.length ? Math.max(...soldPrices) : null,
      soldQuantityEvidence: soldQuantities.length
        ? soldQuantities.reduce((sum, value) => sum + value, 0) : null,
      acceptedComparables: Object.freeze(accepted.slice(0, 8)),
      rejectedComparables: Object.freeze(rejected.slice(0, 8)),
      competitorEvidenceIsProductTruth: false as const,
      competitorAssetsMayBeReused: false as const,
    }),
    pricePosition: Object.freeze({
      status: position,
      livePrice: metric(input.listing, "listing_price").value,
      soldRangeBasis: "CONFIRMED_SOLD_LANDED_WHEN_SHIPPING_PROVEN",
      defensibleSellerOsPrice: number(priceRecommendation.proposedItemPrice),
      marketPriceAuthority: freshAccepted.length
        ? "FRESH_CONFIRMED_SOLD_EVIDENCE" as const
        : "UNPROVEN" as const,
      costStackUsedToInventMarketPrice: false as const,
    }),
    performance: Object.freeze({
      status: ["impressions", "ebay_views", "ctr_calculated", "watchers",
        "orders", "units_sold", "conversion"].some((key) =>
        metric(input.listing, key as CommercialMetricKey).status === "AVAILABLE")
        ? "PARTIAL" as const : "UNAVAILABLE" as const,
      impressions: metric(input.listing, "impressions"),
      views: metric(input.listing, "ebay_views"),
      ctrPercent: metric(input.listing, "ctr_calculated").status === "AVAILABLE"
        ? metric(input.listing, "ctr_calculated")
        : metric(input.listing, "ctr_reported"),
      watchers: metric(input.listing, "watchers"),
      officialOrderCount: metric(input.listing, "orders"),
      unitsSold: metric(input.listing, "units_sold"),
      conversion: metric(input.listing, "conversion"),
      salesInferredFromViewsOrWatchers: false as const,
    }),
    interpretation: commercialInterpretation({
      reasonCodes: input.decisionReasonCodes ?? [],
      pricePosition: position,
      marketStatus,
    }),
    ebayRecommendations: Object.freeze({
      status: quality.length ? "PARTIAL" as const : "UNAVAILABLE" as const,
      officialListingQuality: Object.freeze(quality.map((row) =>
        Object.freeze({ source: row.source, observedAt: row.observedAt,
          type: row.recommendationType,
          category: row.recommendationCategory,
          exactPlatformWording: row.recommendationText,
          eligibility: row.associationStatus,
          freshness: "UNKNOWN" as const,
          sellerOsClassification: "NECESITA_MAS_EVIDENCIA" as const,
          automaticExecutionAuthority: false as const }))),
      capabilityAudit: capabilityAudit(quality),
      platformRecommendationIsSoldEvidence: false as const,
      platformRecommendationIsProductTruth: false as const,
      platformRecommendationIsExecutionAuthority: false as const,
      promotionRecommendationReadOnDemand: true as const,
    }),
    revalidation: Object.freeze({
      visible: true as const,
      status: "PARTIAL" as const,
      requestAuthority: true as const,
      sellerOsChoosesResearchPlan: true as const,
      ipadExtensionRequired: false as const,
      durableWorkerContinuationAvailable: false as const,
      limitationCode:
        "LIVE_LISTING_TO_DURABLE_PRODUCT_RESEARCH_PLAN_CONNECTOR_UNPROVEN",
    }),
    authority: Object.freeze({
      mayelViewEconomics: true as const,
      mayelViewCompetitors: true as const,
      mayelViewEbayRecommendations: true as const,
      mayelRequestMarketRevalidation: true as const,
      mayelMakeCommercialRecommendation: true as const,
      mayelDirectPriceWrite: false as const,
      mayelPromotionWrite: false as const,
      mayelSendOffer: false as const,
      mayelSpendAuthority: false as const,
    }),
    safety: Object.freeze({
      marketplaceWrites: 0 as const,
      priceWrites: 0 as const,
      promotionWrites: 0 as const,
      sendOffers: 0 as const,
      buyerMessages: 0 as const,
      unknownRenderedAsZero: false as const,
    }),
  })
}

export type MayelCommercialIntelligenceV1 = ReturnType<
  typeof buildMayelCommercialIntelligenceV1>
