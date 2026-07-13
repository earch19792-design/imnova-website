import type { EbayLunaOpportunityAssessment } from "./ebay-luna-demand-opportunity-engine"
import type { EbayBestSellingProductSignal } from "./ebay-seller-keyword-demand-gateway"
import type { LunaOpportunityCandidateInput } from "./ebay-luna-opportunity-types"
// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { detectEbayProductRestrictionGuards } from "./ebay-product-restriction-guards.ts"

type JsonRecord = Record<string, unknown>

export type LunaLatestVariantRow = {
  product_id: string
  supplier_product_id: string | null
  supplier_variant_id: string | null
  sku: string | null
  barcode: string | null
  title: string
  variant_title: string | null
  vendor: string | null
  product_type: string | null
  tags: string[] | null
  product_url: string | null
  featured_image_url: string | null
  image_urls: string[] | null
  metadata: JsonRecord | null
  snapshot_id: string | null
  price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  weight: number | string | null
  weight_unit: string | null
  captured_at: string | null
}

export type ExistingOpportunityQueueRow = {
  id: string
  opportunity_score: number | string | null
  supplier_price: number | string | null
  supplier_available: boolean | null
  supplier_inventory_quantity: number | null
  queue_status: string
}

type ProfessionalQueueRow = Record<string, unknown> & {
  active_comparables?: unknown
  demand_score?: unknown
  listing_readiness_score?: unknown
  market_radar_product_id?: unknown
  opportunity_score?: unknown
  supplier_available?: unknown
  supplier_inventory_quantity?: unknown
  supplier_price?: unknown
  assessment?: unknown
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function number(value: unknown) {
  return numberOrNull(value) ?? 0
}

export function buildProfessionalSellerQueueView(row: ProfessionalQueueRow) {
  const assessment = record(row.assessment)
  const identity = record(assessment.identity)
  const economics = record(assessment.economics)
  const listingPackage = record(assessment.listingIntelligencePackage)
  const titleStrategy = record(listingPackage.titleStrategy)
  const category = record(listingPackage.categoryRecommendation)
  const comparableCandidates = records(identity.comparables)
  const market = record(assessment.market)
  const candidateCount = numberOrNull(market.candidateListingsFound) ?? comparableCandidates.length
  const exactComparableCount = number(row.active_comparables)
  const exactIdentityConfirmed = identity.exactIdentityConfirmed === true
  const canProceedToListingPackage = assessment.canProceedToListingPackage === true
  const supplierAvailable = row.supplier_available === true
  const supplierInventory = numberOrNull(row.supplier_inventory_quantity)
  const supplierCost = numberOrNull(row.supplier_price)
  const opportunityScore = number(row.opportunity_score)
  const assessmentScores = record(assessment.scores)
  // V2 calculates this once in the canonical engine. Re-weighting demand,
  // readiness and identity here counted the same evidence twice and could make
  // the mobile ranking disagree with the persisted opportunity ranking.
  const sellerPriorityScore = Math.min(100, Math.round(
    numberOrNull(assessmentScores.sellerPriorityScore) ??
    numberOrNull(row.seller_priority_score) ??
    opportunityScore,
  ))
  const hardGates = Array.isArray(row.hard_gates)
    ? row.hard_gates.filter((value): value is string => typeof value === "string")
    : []
  const evidenceGuards = Array.isArray(row.evidence_guards)
    ? row.evidence_guards.filter((value): value is string => typeof value === "string")
    : []

  let sellerLane = "REFINE_EBAY_SEARCH"
  let nextSellerAction = "Refina la frase de búsqueda o confirma la categoría antes de invertir tiempo en el listing."
  if (!supplierAvailable || supplierInventory === 0) {
    sellerLane = "SUPPLY_HOLD"
    nextSellerAction = "Confirma stock real en Luna antes de preparar el listing."
  } else if (canProceedToListingPackage) {
    sellerLane = "LISTING_PACKAGE_READY"
    nextSellerAction = "Prepara el paquete de listing y envíalo a revisión humana."
  } else if (!exactIdentityConfirmed) {
    sellerLane = candidateCount >= 3
      ? "HIGH_POTENTIAL_NEEDS_IDENTITY"
      : candidateCount > 0
        ? "MARKET_SIGNAL_NEEDS_IDENTITY"
        : "REFINE_EBAY_SEARCH"
    nextSellerAction = candidateCount > 0
      ? "Confirma GTIN o Brand + MPN. Los candidatos eBay son referencias de mercado, no el producto exacto todavía."
      : nextSellerAction
  } else if (supplierCost === null || economics.ready !== true) {
    sellerLane = "FAST_TRACK_NEEDS_ECONOMICS"
    nextSellerAction = "Confirma precio comparable exacto, costo y margen antes de preparar el listing."
  } else if (hardGates.length || evidenceGuards.length) {
    sellerLane = "FAST_TRACK_NEEDS_FACTS"
    nextSellerAction = "Completa los datos obligatorios y las guardas visibles para desbloquear el paquete de listing."
  }

  return {
    ...row,
    assessment: undefined,
    ebay_candidate_count: candidateCount,
    exact_comparable_count: exactComparableCount,
    seller_priority_score: sellerPriorityScore,
    score_axes: {
      potential: numberOrNull(assessmentScores.potentialScore) ?? opportunityScore,
      confidence: numberOrNull(assessmentScores.confidenceScore) ?? 0,
      urgency: numberOrNull(assessmentScores.urgencyScore) ?? 0,
    },
    seller_lane: sellerLane,
    next_seller_action: nextSellerAction,
    can_prepare_listing_package: canProceedToListingPackage,
    listing_intake_url: typeof row.id === "string"
      ? `/admin/ebay/listing-workspace?opportunity=${encodeURIComponent(row.id)}&candidate=${encodeURIComponent(text(row.candidate_key) ?? "")}`
      : null,
    winning_structure: {
      strategyConfidence: text(titleStrategy.strategyConfidence),
      primarySearchPhrase: text(titleStrategy.primarySearchPhrase),
      secondarySearchTerms: Array.isArray(titleStrategy.secondarySearchTerms)
        ? titleStrategy.secondarySearchTerms.filter((value): value is string => typeof value === "string").slice(0, 5)
        : [],
      confirmedAttributes: Array.isArray(titleStrategy.confirmedAttributes)
        ? titleStrategy.confirmedAttributes.filter((value): value is string => typeof value === "string").slice(0, 6)
        : [],
      titleFormula: text(titleStrategy.titleFormula),
      categoryId: text(category.categoryId),
      categoryName: text(category.categoryName),
    },
    top_ebay_candidates: comparableCandidates.slice(0, 3).map((candidate) => ({
      title: text(candidate.title) ?? "Referencia eBay",
      price: numberOrNull(candidate.price),
      currency: text(candidate.currency) ?? "USD",
      identityMatchScore: number(candidate.identityMatchScore),
      identityMatchQuality: text(candidate.identityMatchQuality) ?? "REVIEW",
      professionalReferenceScore: number(candidate.professionalReferenceScore),
    })),
  }
}

export function mapLatestVariantToLunaCandidate(
  row: LunaLatestVariantRow,
): LunaOpportunityCandidateInput {
  const metadata = record(row.metadata)
  const dimensions = record(metadata.dimensions)
  const imageProvenance = record(metadata.imageProvenance ?? metadata.image_provenance)
  const detectedRestrictions = detectEbayProductRestrictionGuards({
    title: row.title,
    productName: row.variant_title,
    category: text(metadata.category),
    categoryText: text(metadata.categoryText ?? metadata.category_text),
    categoryName: text(metadata.categoryName ?? metadata.category_name),
    handle: text(metadata.handle) ?? row.product_url,
    productType: row.product_type,
    description: text(metadata.description),
    imageAlt: text(metadata.imageAlt ?? metadata.image_alt),
    imageReference: row.featured_image_url,
  })
  const suppliedRestrictions = Array.isArray(metadata.restrictionGuards)
    ? metadata.restrictionGuards.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : []
  return {
    candidateKey: `luna-portex:${row.supplier_product_id ?? row.product_id}:${row.supplier_variant_id ?? row.sku ?? "default"}`,
    marketRadarProductId: row.product_id,
    supplierProductId: row.supplier_product_id,
    supplierVariantId: row.supplier_variant_id,
    sku: row.sku,
    title: row.title,
    variantTitle: row.variant_title,
    // Luna's vendor can be a distributor and is not automatically the product
    // manufacturer. Only explicit catalog provenance may satisfy Brand + MPN.
    brand: text(metadata.brand ?? metadata.manufacturerBrand ?? metadata.manufacturer_brand),
    mpn: text(metadata.mpn),
    gtin: row.barcode,
    color: text(metadata.color),
    size: text(metadata.size),
    packQuantity: numberOrNull(metadata.packQuantity ?? metadata.pack_quantity),
    productType: row.product_type,
    categoryId: text(metadata.ebayCategoryId ?? metadata.ebay_category_id),
    description: text(metadata.description),
    tags: row.tags ?? [],
    supplierCost: numberOrNull(row.price),
    available: row.available,
    inventoryQuantity: row.inventory_quantity,
    stockCapturedAt: row.captured_at,
    weight: numberOrNull(row.weight),
    weightUnit: row.weight_unit,
    dimensions: numberOrNull(dimensions.length) !== null &&
      numberOrNull(dimensions.width) !== null &&
      numberOrNull(dimensions.height) !== null
      ? {
          length: numberOrNull(dimensions.length),
          width: numberOrNull(dimensions.width),
          height: numberOrNull(dimensions.height),
          unit: text(dimensions.unit),
        }
      : null,
    imageUrls: [row.featured_image_url, ...(row.image_urls ?? [])]
      .filter((value): value is string => Boolean(value)),
    // A reachable supplier URL proves availability, not reuse authorization.
    // Authorization must be an explicit supplier/provenance fact and can later
    // be confirmed by the human review workspace.
    imageAuthorized: metadata.imageAuthorized === true ||
      metadata.image_authorized === true || imageProvenance.authorized === true,
    restrictionGuards: [...new Set([
      ...suppliedRestrictions,
      ...detectedRestrictions.pendingRestrictionGuards,
    ])],
    metadata,
  }
}

function queueStatus(assessment: EbayLunaOpportunityAssessment) {
  if (assessment.candidate.available === false) return "hold"
  if (assessment.decision === "REJECT_OR_HOLD") return "rejected"
  if (assessment.canProceedToListingPackage) return "ready"
  if (assessment.scores.opportunityScore >= 55) return "review"
  return "watchlist"
}

export function buildOpportunityQueueRow(
  assessment: EbayLunaOpportunityAssessment,
  bestSellingMatches: Array<Record<string, unknown>>,
  now = new Date(),
) {
  const matchScore = Math.max(
    0,
    ...bestSellingMatches.map((match) => Number(match.discoveryMatchScore ?? 0)),
  )
  const keywordStructure = assessment.listingIntelligencePackage
    .titleStrategy ?? {}
  return {
    candidate_key: assessment.candidate.candidateKey,
    market_radar_product_id: assessment.candidate.marketRadarProductId,
    supplier_product_id: assessment.candidate.supplierProductId,
    supplier_variant_id: assessment.candidate.supplierVariantId,
    supplier_sku: assessment.candidate.sku,
    product_title: assessment.candidate.title,
    variant_title: assessment.candidate.variantTitle,
    gtin: assessment.candidate.gtin,
    queue_status: queueStatus(assessment),
    decision: assessment.decision,
    opportunity_score: assessment.scores.opportunityScore,
    demand_score: assessment.scores.demandScore,
    economics_score: assessment.scores.economicsScore,
    identity_score: assessment.scores.identityScore,
    competition_score: assessment.scores.competitionScore,
    supply_score: assessment.scores.supplyScore,
    listing_readiness_score: assessment.scores.listingReadinessScore,
    active_comparables: assessment.market.activeExactComparables,
    sellers_with_movement: assessment.market.sellersWithPositiveMovement,
    estimated_weekly_velocity: assessment.market.totalEstimatedWeeklyVelocity || null,
    median_total_buyer_price: assessment.market.medianTotalBuyerPrice,
    estimated_net_profit: assessment.economics.estimatedNetProfit,
    supplier_price: assessment.candidate.supplierCost,
    supplier_available: assessment.candidate.available,
    supplier_inventory_quantity: assessment.candidate.inventoryQuantity,
    supplier_snapshot_at: assessment.candidate.stockCapturedAt,
    best_selling_match_score: matchScore || null,
    best_selling_matches: bestSellingMatches.slice(0, 12),
    keyword_structure: keywordStructure,
    hard_gates: assessment.hardGates,
    evidence_guards: assessment.evidenceGuards,
    assessment,
    last_scanned_at: now.toISOString(),
    next_scan_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    updated_at: now.toISOString(),
  }
}

export function buildOpportunityChangeEvents(
  previous: ExistingOpportunityQueueRow | null,
  next: ReturnType<typeof buildOpportunityQueueRow>,
  snapshotId: string,
) {
  if (!previous) return [{ type: "discovered", oldValue: null, newValue: next.opportunity_score, snapshotId }]
  const events: Array<{ type: string; oldValue: unknown; newValue: unknown }> = []
  const oldPrice = numberOrNull(previous.supplier_price)
  const newPrice = numberOrNull(next.supplier_price)
  if (oldPrice !== null && newPrice !== null && oldPrice !== newPrice) {
    events.push({ type: newPrice > oldPrice ? "price_up" : "price_down", oldValue: oldPrice, newValue: newPrice })
  }
  if (previous.supplier_available !== next.supplier_available) {
    events.push({
      type: next.supplier_available ? "restocked" : "out_of_stock",
      oldValue: previous.supplier_available,
      newValue: next.supplier_available,
    })
  }
  if (previous.supplier_inventory_quantity !== next.supplier_inventory_quantity) {
    events.push({ type: "stock_changed", oldValue: previous.supplier_inventory_quantity, newValue: next.supplier_inventory_quantity })
  }
  const oldScore = numberOrNull(previous.opportunity_score) ?? 0
  if (Math.abs(oldScore - next.opportunity_score) >= 5) {
    events.push({ type: "rescored", oldValue: oldScore, newValue: next.opportunity_score })
  }
  if (previous.queue_status !== next.queue_status) {
    events.push({ type: "status_changed", oldValue: previous.queue_status, newValue: next.queue_status })
  }
  return events.map((event) => ({ ...event, snapshotId }))
}

export function buildBestSellingSignalKey(signal: EbayBestSellingProductSignal) {
  return [signal.categoryId, signal.epid ?? signal.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")]
    .join(":")
    .slice(0, 300)
}
