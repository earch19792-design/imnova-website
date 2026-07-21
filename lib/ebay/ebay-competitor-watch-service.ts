import type { SupabaseClient } from "@supabase/supabase-js"

import { containsPrivateBuyerData, extractPackQuantity, stableCommercialKey } from
  "../marketplace/commercial-monitor-domain"
import {
  buildCompetitorWatchAnalysis,
  EBAY_COMPETITOR_WATCH_VERSION,
  type CompetitorWatchObservation,
  type CompetitorWatchPreviousOffer,
} from "./ebay-competitor-watch-domain"
import {
  observeEbayActiveCompetitors,
} from "./ebay-seller-keyword-demand-gateway"
import type { EbaySellerKeywordCandidate } from "./ebay-seller-keyword-demand-validation"

const MARKETPLACE = "EBAY_US"
const DEFAULT_LISTINGS_PER_RUN = 3
const MAX_LISTINGS_PER_RUN = 10

type JsonRecord = Record<string, unknown>

export type CompetitorWatchListingInput = {
  listingId: string
  sku: string | null
  title: string
  price: number | null
  currency: string
  supplierVariantId: string | null
  supplierSku: string | null
  promotionAllowed: boolean
  rawPayload: JsonRecord | null
  supply: {
    title: string | null
    variantTitle: string | null
    sku: string | null
    barcode: string | null
    vendor: string | null
    productType: string | null
    metadata: JsonRecord | null
    unitCost: number | null
    costFresh: boolean
    available: boolean | null
  } | null
}

type ProfileRow = {
  id: string
  listing_id: string
  search_query_hash: string
  baseline_completed_at: string | null
  last_scanned_at: string | null
  last_research_refresh_recommended_at: string | null
  latest_suggestion_codes: string[] | null
  latest_active_offer_count: number
}

type OfferRow = {
  item_reference_hash: string
  seller_reference_hash: string
  active: boolean
  first_seen_as_baseline: boolean
  first_seen_at: string
  consecutive_scan_count: number
  potential_notified_at: string | null
  evidence_class: CompetitorWatchPreviousOffer["evidenceClass"]
}

type ResearchObservationRow = {
  source_listing_reference_hash: string
  confirmed_sold_quantity: number
  last_sold_date: string
  average_sold_price: number | string
  average_shipping: number | string | null
  free_shipping_percent: number | string | null
  detected_offer_pack_count: number | null
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function sellerImprovementUrl(eventId: string) {
  const configured = process.env.EBAY_SELLER_COMMAND_CENTER_URL?.trim() ?? ""
  try {
    const url = new URL(configured)
    if (url.protocol !== "https:") return null
    const base = url.toString().replace(/\/$/, "")
    return `${base}?section=commercial-monitor&improvement=${encodeURIComponent(eventId)}#competitor-watch-heading`
  } catch {
    return null
  }
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function booleanOrNull(value: unknown) {
  return value === true ? true : value === false ? false : null
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback
}

function ownShippingCost(rawPayload: JsonRecord | null) {
  const raw = record(rawPayload)
  const shippingOptions = array(raw.shippingOptions ?? raw.shipping_options).map(record)
  const shipping = record(shippingOptions[0]?.shippingCost ?? shippingOptions[0]?.shipping_cost)
  return numeric(shipping.value ?? raw.shippingCost ?? raw.shipping_cost)
}

function ownReturnsAccepted(rawPayload: JsonRecord | null) {
  const raw = record(rawPayload)
  const terms = record(raw.returnTerms ?? raw.return_terms ?? raw.returnPolicy)
  return booleanOrNull(terms.returnsAccepted ?? terms.returns_accepted ?? raw.returnsAccepted)
}

function ownImageCount(rawPayload: JsonRecord | null) {
  const raw = record(rawPayload)
  const primary = text(record(raw.image).imageUrl ?? raw.imageUrl)
  const additional = array(raw.additionalImages ?? raw.additional_images)
    .map((entry) => text(record(entry).imageUrl ?? entry))
    .filter(Boolean)
  const pictureUrls = array(record(raw.PictureDetails).PictureURL).map(text).filter(Boolean)
  const count = new Set([primary, ...additional, ...pictureUrls].filter(Boolean)).size
  return count || null
}

function rawCategoryId(rawPayload: JsonRecord | null) {
  const raw = record(rawPayload)
  const category = record(raw.category ?? raw.primaryCategory ?? raw.PrimaryCategory)
  const value = text(
    raw.categoryId ?? raw.category_id ?? category.categoryId ??
    category.CategoryID ?? raw.primaryCategoryId,
  )
  return /^\d+$/.test(value) ? value : null
}

function supplyMetadataValue(supply: CompetitorWatchListingInput["supply"], keys: string[]) {
  const metadata = record(supply?.metadata)
  for (const key of keys) {
    const value = text(metadata[key])
    if (value) return value
  }
  return null
}

function competitorCandidate(listing: CompetitorWatchListingInput): EbaySellerKeywordCandidate {
  const productName = listing.supply?.title || listing.title
  return {
    productName,
    productTitle: listing.title,
    variantTitle: listing.supply?.variantTitle,
    supplierSku: listing.supplierSku ?? listing.supply?.sku,
    categoryId: rawCategoryId(listing.rawPayload),
    gtin: listing.supply?.barcode,
    brand: listing.supply?.vendor ?? supplyMetadataValue(listing.supply, ["brand", "vendor"]),
    mpn: supplyMetadataValue(listing.supply, ["mpn", "manufacturerPartNumber", "manufacturer_part_number"]),
    model: supplyMetadataValue(listing.supply, ["model", "modelNumber", "model_number"]),
    packQuantity: extractPackQuantity([
      listing.supply?.title,
      listing.supply?.variantTitle,
      listing.title,
    ].filter(Boolean).join(" ")),
    productType: listing.supply?.productType,
  }
}

function previousOffer(row: OfferRow): CompetitorWatchPreviousOffer {
  return {
    itemReferenceHash: row.item_reference_hash,
    sellerReferenceHash: row.seller_reference_hash,
    active: row.active,
    firstSeenAsBaseline: row.first_seen_as_baseline,
    consecutiveScanCount: row.consecutive_scan_count,
    potentialNotifiedAt: row.potential_notified_at,
    evidenceClass: row.evidence_class,
  }
}

async function readResearchMatches(
  supabase: SupabaseClient,
  accountKey: string,
  supplierVariantId: string | null,
  itemReferenceHashes: string[],
) {
  if (!supplierVariantId || !itemReferenceHashes.length) {
    return new Map<string, ResearchObservationRow>()
  }
  const { data, error } = await supabase
    .from("marketplace_product_research_capture_observations")
    .select("source_listing_reference_hash,confirmed_sold_quantity,last_sold_date,average_sold_price,average_shipping,free_shipping_percent,detected_offer_pack_count")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("evidence_reviewed", true)
    .eq("quality_status", "VALID")
    .eq("match_classification", "EXACT_LUNA_MATCH")
    .eq("matched_supplier_variant_id", supplierVariantId)
    .in("source_listing_reference_hash", itemReferenceHashes)
    .order("last_sold_date", { ascending: false })
    .limit(500)
  if (error) throw new Error("COMPETITOR_PRODUCT_RESEARCH_EVIDENCE_READ_FAILED")
  const matches = new Map<string, ResearchObservationRow>()
  for (const row of (data ?? []) as ResearchObservationRow[]) {
    const existing = matches.get(row.source_listing_reference_hash)
    const currentSoldAt = Date.parse(row.last_sold_date)
    const existingSoldAt = Date.parse(existing?.last_sold_date ?? "")
    if (!existing || currentSoldAt > existingSoldAt ||
      (currentSoldAt === existingSoldAt &&
        row.confirmed_sold_quantity > existing.confirmed_sold_quantity)) {
      matches.set(row.source_listing_reference_hash, row)
    }
  }
  return matches
}

async function upsertProfile(input: {
  supabase: SupabaseClient
  accountKey: string
  listing: CompetitorWatchListingInput
  profile: ProfileRow | null
  searchQueryHash: string
  observedAt: string
  analysis: ReturnType<typeof buildCompetitorWatchAnalysis>
}) {
  const baselineCompletedAt = input.analysis.baselineEstablished
    ? input.observedAt
    : input.profile?.baseline_completed_at ?? input.observedAt
  const researchRecommendedAt = input.analysis.researchRefreshRecommended
    ? input.observedAt
    : input.profile?.last_research_refresh_recommended_at ?? null
  const { data, error } = await input.supabase
    .from("ebay_listing_competitor_watch_profiles")
    .upsert({
      marketplace_account_key: input.accountKey,
      marketplace: MARKETPLACE,
      listing_id: input.listing.listingId,
      sku: input.listing.sku,
      supplier_variant_id: input.listing.supplierVariantId,
      search_query_hash: input.searchQueryHash,
      status: "ACTIVE",
      baseline_completed_at: baselineCompletedAt,
      last_scanned_at: input.observedAt,
      last_research_refresh_recommended_at: researchRecommendedAt,
      latest_active_offer_count: input.analysis.activeOfferCount,
      latest_active_seller_count: input.analysis.activeSellerCount,
      latest_estimated_activity_seller_count: input.analysis.estimatedActivitySellerCount,
      latest_confirmed_sold_seller_count: input.analysis.confirmedSoldSellerCount,
      latest_median_landed_price: input.analysis.medianLandedPrice,
      latest_free_shipping_ratio: input.analysis.freeShippingRatio,
      latest_returns_accepted_ratio: input.analysis.returnsAcceptedRatio,
      latest_multi_image_ratio: input.analysis.multiImageRatio,
      latest_evidence_class: input.analysis.evidenceClass,
      latest_suggestion_codes: input.analysis.suggestionCodes,
      latest_suggested_terms: input.analysis.suggestedTerms,
      research_refresh_recommended: input.analysis.researchRefreshRecommended,
      research_refresh_reason_codes: input.analysis.researchRefreshReasonCodes,
      updated_at: input.observedAt,
    }, { onConflict: "marketplace_account_key,marketplace,listing_id" })
    .select("id")
    .single()
  if (error || !data?.id) throw new Error("COMPETITOR_WATCH_PROFILE_WRITE_FAILED")
  return data.id as string
}

async function persistScan(input: {
  supabase: SupabaseClient
  accountKey: string
  profileId: string
  monitorRunId: string
  listingId: string
  observedAt: string
  scan: Awaited<ReturnType<typeof observeEbayActiveCompetitors>>
  analysis: ReturnType<typeof buildCompetitorWatchAnalysis>
}) {
  const { error } = await input.supabase.from("ebay_listing_competitor_scans").insert({
    profile_id: input.profileId,
    monitor_run_id: input.monitorRunId,
    marketplace_account_key: input.accountKey,
    marketplace: MARKETPLACE,
    listing_id: input.listingId,
    scan_status: input.scan.status,
    observed_at: input.observedAt,
    baseline_established: input.analysis.baselineEstablished,
    candidate_found_count: input.scan.candidateFoundCount,
    returned_candidate_count: input.scan.returnedCandidateCount,
    eligible_offer_count: input.analysis.activeOfferCount,
    active_seller_count: input.analysis.activeSellerCount,
    new_offer_count: input.analysis.newOfferHashes.length,
    new_seller_count: input.analysis.newSellerHashes.length,
    potential_seller_count: input.analysis.potentialSellerHashes.length,
    estimated_activity_seller_count: input.analysis.estimatedActivitySellerCount,
    confirmed_sold_seller_count: input.analysis.confirmedSoldSellerCount,
    median_landed_price: input.analysis.medianLandedPrice,
    free_shipping_ratio: input.analysis.freeShippingRatio,
    returns_accepted_ratio: input.analysis.returnsAcceptedRatio,
    multi_image_ratio: input.analysis.multiImageRatio,
    evidence_class: input.analysis.evidenceClass,
    suggestion_codes: input.analysis.suggestionCodes,
    suggested_terms: input.analysis.suggestedTerms,
    research_refresh_recommended: input.analysis.researchRefreshRecommended,
    research_refresh_reason_codes: input.analysis.researchRefreshReasonCodes,
  })
  if (error) throw new Error("COMPETITOR_WATCH_SCAN_WRITE_FAILED")
}

async function persistOffers(input: {
  supabase: SupabaseClient
  accountKey: string
  profileId: string
  listingId: string
  observedAt: string
  observations: CompetitorWatchObservation[]
  previousRows: OfferRow[]
  analysis: ReturnType<typeof buildCompetitorWatchAnalysis>
}) {
  const { error: deactivateError } = await input.supabase
    .from("ebay_listing_competitor_offers")
    .update({ active: false, updated_at: input.observedAt })
    .eq("profile_id", input.profileId)
    .eq("active", true)
  if (deactivateError) throw new Error("COMPETITOR_WATCH_OFFER_DEACTIVATE_FAILED")
  if (!input.observations.length) return
  const previousByItem = new Map(input.previousRows.map((row) => [
    row.item_reference_hash,
    row,
  ]))
  const stateByItem = new Map(input.analysis.observationStates.map((state) => [
    state.observation.itemReferenceHash,
    state,
  ]))
  const potentialSellers = new Set(input.analysis.potentialSellerHashes)
  const rows = input.observations.map((observation) => {
    const previous = previousByItem.get(observation.itemReferenceHash)
    const state = stateByItem.get(observation.itemReferenceHash)
    return {
      profile_id: input.profileId,
      marketplace_account_key: input.accountKey,
      marketplace: MARKETPLACE,
      listing_id: input.listingId,
      item_reference_hash: observation.itemReferenceHash,
      seller_reference_hash: observation.sellerReferenceHash,
      identity_match_quality: observation.identityMatchQuality,
      evidence_class: observation.evidenceClass,
      price: observation.price,
      shipping_cost: observation.shippingCost,
      landed_price: observation.landedPrice,
      returns_accepted: observation.returnsAccepted,
      image_count: observation.imageCount,
      pack_quantity: observation.packQuantity,
      seller_feedback_band: observation.sellerFeedbackBand,
      estimated_sold_quantity: observation.estimatedSoldQuantity,
      confirmed_sold_quantity: observation.confirmedSoldQuantity ?? 0,
      confirmed_sold_last_date: observation.confirmedSoldLastDate ?? null,
      first_seen_as_baseline: state?.firstSeenAsBaseline ?? false,
      first_seen_at: previous?.first_seen_at ?? input.observedAt,
      last_seen_at: input.observedAt,
      consecutive_scan_count: state?.consecutiveScanCount ?? 1,
      potential_notified_at: potentialSellers.has(observation.sellerReferenceHash)
        ? input.observedAt
        : previous?.potential_notified_at ?? null,
      active: true,
      updated_at: input.observedAt,
    }
  })
  const { error } = await input.supabase
    .from("ebay_listing_competitor_offers")
    .upsert(rows, { onConflict: "profile_id,item_reference_hash" })
  if (error) throw new Error("COMPETITOR_WATCH_OFFER_WRITE_FAILED")
}

function competitorEventKind(analysis: ReturnType<typeof buildCompetitorWatchAnalysis>) {
  if (analysis.priceRecommendation) {
    return "COMPETITOR_CONFIRMED_SOLD_PRICE_RECOMMENDATION"
  }
  if (analysis.activeMarketPriceRecommendation) {
    return "COMPETITOR_ACTIVE_MARKET_PRICE_RECOMMENDATION"
  }
  if (analysis.potentialSellerHashes.length) return "COMPETITOR_NEW_POTENTIAL_SELLER"
  if (analysis.newlyConfirmedOfferHashes.length) return "COMPETITOR_SOLD_EVIDENCE_CONFIRMED"
  return "COMPETITOR_PATTERN_SUGGESTION"
}

async function persistCompetitorAlert(input: {
  supabase: SupabaseClient
  accountKey: string
  listing: CompetitorWatchListingInput
  observedAt: string
  analysis: ReturnType<typeof buildCompetitorWatchAnalysis>
}) {
  if (!input.analysis.alertRequired || !input.analysis.eventFingerprint) {
    return { eventsCreated: 0, alertsGenerated: 0, duplicatesAvoided: 0 }
  }
  const eventType = competitorEventKind(input.analysis)
  const priceRecommendation = input.analysis.priceRecommendation
  const activeMarketPriceRecommendation =
    input.analysis.activeMarketPriceRecommendation
  const anyPriceRecommendation = priceRecommendation ??
    activeMarketPriceRecommendation
  const marketPricePositionDetected = input.analysis.suggestionCodes.includes(
    "REVIEW_MARKET_PRICE_POSITION",
  )
  const listingShippingCost = ownShippingCost(input.listing.rawPayload) ?? 0
  const ownLandedPrice = input.listing.price === null ? null
    : Number((input.listing.price + listingShippingCost).toFixed(2))
  const deduplicationKey = stableCommercialKey(
    input.accountKey,
    eventType,
    input.listing.listingId,
    input.listing.sku,
    input.analysis.eventFingerprint,
  )
  const priceActionLabels = {
    RAISE_TO_CONFIRMED_SOLD_BAND: "Evaluar subir el precio a",
    LOWER_TO_CONFIRMED_SOLD_BAND: "Evaluar bajar el precio a",
    KEEP_PRICE_IN_CONFIRMED_SOLD_BAND: "Mantener el precio en",
    DO_NOT_MATCH_BELOW_ECONOMIC_FLOOR:
      "No igualar la referencia vendida; conservar o elevar el precio a",
  } as const
  const recommendedAction = priceRecommendation
    ? `${priceActionLabels[priceRecommendation.action]} ` +
      `$${priceRecommendation.proposedItemPrice.toFixed(2)}. Referencia vendida exacta: ` +
      `$${priceRecommendation.confirmedSoldBenchmarkLandedPrice.toFixed(2)} total; ` +
      `piso económico propio: $${priceRecommendation.minimumSafeLandedPrice.toFixed(2)}. ` +
      `Utilidad estimada $${Number(priceRecommendation.proposedEstimatedNetProfit ?? 0).toFixed(2)}, ` +
      `margen ${Number(priceRecommendation.proposedEstimatedMarginPercent ?? 0).toFixed(2)}% ` +
      `y ROI ${Number(priceRecommendation.proposedEstimatedRoiPercent ?? 0).toFixed(2)}%. ` +
      (priceRecommendation.promotionRecommendation.recommendedRatePercent > 0
        ? `Para impulsar, evaluar Promoted Listings al ${priceRecommendation.promotionRecommendation.recommendedRatePercent.toFixed(2)}% reservado; requiere autorización humana. `
        : `Promoción recomendada 0%. ${priceRecommendation.promotionRecommendation.reason} `) +
      "Requiere revisión humana; no se modificó eBay."
    : activeMarketPriceRecommendation
      ? [
          "LOWER_TO_ACTIVE_MARKET_SAFE_PRICE",
          "LOWER_TO_ACTIVE_MARKET_CONTROLLED_RISK_PRICE",
        ].includes(activeMarketPriceRecommendation.action)
        ? `Evaluar bajar a $${activeMarketPriceRecommendation.proposedItemPrice.toFixed(2)}. ` +
          `Mediana activa $${activeMarketPriceRecommendation.activeMarketMedianLandedPrice.toFixed(2)}; ` +
          `piso seguro $${activeMarketPriceRecommendation.minimumSafeLandedPrice.toFixed(2)} ` +
          `(${activeMarketPriceRecommendation.controlledRiskTenPercent
            ? "margen controlado mínimo 10%; promoción bloqueada"
            : activeMarketPriceRecommendation.promotionReserveIncluded
            ? "incluye reserva publicitaria 5%"
            : "promoción bloqueada"}). La oferta activa no es una venta confirmada. ` +
          "Requiere autorización humana; no se modificó eBay."
        : activeMarketPriceRecommendation.action === "RAISE_TO_SAFE_FLOOR"
          ? `Subir al piso seguro $${activeMarketPriceRecommendation.proposedItemPrice.toFixed(2)}; ` +
            `el precio actual no pasa la economía. Mediana activa ` +
            `$${activeMarketPriceRecommendation.activeMarketMedianLandedPrice.toFixed(2)}. ` +
            "Requiere autorización humana; no se modificó eBay."
          : `Mantener $${activeMarketPriceRecommendation.currentItemPrice.toFixed(2)}: ` +
            `ya está en el piso seguro $${activeMarketPriceRecommendation.minimumSafeLandedPrice.toFixed(2)}. ` +
            `La mediana activa $${activeMarketPriceRecommendation.activeMarketMedianLandedPrice.toFixed(2)} ` +
            "queda debajo del piso; no igualar ni ejecutar una escritura innecesaria."
    : marketPricePositionDetected && ownLandedPrice !== null &&
        input.analysis.medianLandedPrice !== null
      ? `Revisar posición de precio: tu total es $${ownLandedPrice.toFixed(2)} y la ` +
        `mediana activa equivalente observada es $${input.analysis.medianLandedPrice.toFixed(2)} ` +
        `entre ${input.analysis.activeSellerCount} vendedor(es). ` +
        (input.analysis.researchRefreshRecommended
          ? "Actualizar Product Research para confirmar ventas antes de aprobar un precio. "
          : "Usar esta señal como presión competitiva; confirmar ventas en Product Research antes de cambiar el precio. ") +
        "No se modificó eBay."
    : input.analysis.researchRefreshRecommended
      ? "Actualizar una sola captura dirigida de Product Research para esta familia y confirmar ventas antes de modificar el listing."
      : "Revisar la sugerencia comercial en Seller OS; no cambiar precio, título, imágenes ni políticas sin aprobación humana."
  const evidence = {
    evidenceClass: input.analysis.evidenceClass,
    activeSellerCount: input.analysis.activeSellerCount,
    newPotentialSellerCount: input.analysis.potentialSellerHashes.length,
    newlyConfirmedSoldOfferCount: input.analysis.newlyConfirmedOfferHashes.length,
    medianLandedPrice: input.analysis.medianLandedPrice,
    suggestionCodes: input.analysis.suggestionCodes,
    researchRefreshRecommended: input.analysis.researchRefreshRecommended,
    priceRecommendation: anyPriceRecommendation,
    confirmedSoldPriceRecommendation: priceRecommendation,
    activeMarketPriceRecommendation,
    promotionRecommendation: priceRecommendation?.promotionRecommendation ?? null,
    ownLandedPrice,
    confirmedSoldPriceRecommendationReady: priceRecommendation !== null,
    activeMarketPriceRecommendationReady:
      activeMarketPriceRecommendation !== null,
    confirmedSoldPriceUsed: priceRecommendation !== null,
    currentActiveOfferPriceUsedAsSoldPrice: false,
    activeOfferIsNotConfirmedSale: true,
    estimatedActivityIsNotConfirmedSale: true,
    rawCompetitorContentStored: false,
    automaticEbayMutation: false,
    ebayWrites: 0,
  }
  const payload = {
    title: priceRecommendation
      ? "Recomendación de precio · competidor con venta confirmada"
      : activeMarketPriceRecommendation
        ? "Precio seguro · competencia activa detectada"
      : marketPricePositionDetected
        ? "Acción de precio · competencia activa detectada"
      : input.analysis.researchRefreshRecommended
        ? "Competidor potencial · refrescar Product Research"
        : eventType === "COMPETITOR_SOLD_EVIDENCE_CONFIRMED"
          ? "Competidor con venta confirmada en Research"
          : "Nueva sugerencia del monitor de competencia",
    summary: priceRecommendation
      ? `Listing ${input.listing.listingId} · SKU ${input.listing.sku ?? "pendiente"}. ` +
        `Precio actual $${priceRecommendation.currentItemPrice.toFixed(2)}; ` +
        `${priceRecommendation.confirmedSoldSellerCount} vendedor(es) exacto(s), ` +
        `${priceRecommendation.confirmedSoldQuantity} venta(s) confirmada(s), ` +
        `referencia total $${priceRecommendation.confirmedSoldBenchmarkLandedPrice.toFixed(2)}. ` +
        `Confianza ${priceRecommendation.confidence}.`
      : activeMarketPriceRecommendation
        ? `Listing ${input.listing.listingId} · SKU ${input.listing.sku ?? "pendiente"}. ` +
          `Actual $${activeMarketPriceRecommendation.currentItemPrice.toFixed(2)}; ` +
          `mercado activo $${activeMarketPriceRecommendation.activeMarketMedianLandedPrice.toFixed(2)}; ` +
          `piso seguro $${activeMarketPriceRecommendation.minimumSafeLandedPrice.toFixed(2)}. ` +
          `${activeMarketPriceRecommendation.controlledRiskTenPercent
            ? "Modo 10% sin promoción. " : ""}` +
          "Oferta activa, no venta confirmada."
      : marketPricePositionDetected && ownLandedPrice !== null &&
          input.analysis.medianLandedPrice !== null
        ? `Listing ${input.listing.listingId} · SKU ${input.listing.sku ?? "pendiente"}. ` +
          `Precio total propio $${ownLandedPrice.toFixed(2)} frente a mediana activa ` +
          `$${input.analysis.medianLandedPrice.toFixed(2)}; ` +
          `${input.analysis.activeSellerCount} vendedor(es) comparables. ` +
          "Una oferta activa no se presenta como venta confirmada."
      : `Listing ${input.listing.listingId} · SKU ${input.listing.sku ?? "pendiente"}. ` +
        `${input.analysis.potentialSellerHashes.length} vendedor(es) potencial(es) nuevo(s); ` +
        `${input.analysis.newlyConfirmedOfferHashes.length} oferta(s) con venta confirmada. ` +
        `Clase de evidencia: ${input.analysis.evidenceClass}.`,
    action: recommendedAction,
    classification: eventType,
  }
  if (containsPrivateBuyerData(evidence) || containsPrivateBuyerData(payload)) {
    throw new Error("COMPETITOR_WATCH_PRIVATE_DATA_BLOCKED")
  }
  const { data: inserted, error: eventError } = await input.supabase
    .from("commercial_alert_events")
    .insert({
      marketplace_account_key: input.accountKey,
      marketplace: MARKETPLACE,
      event_type: eventType,
      severity: (priceRecommendation && priceRecommendation.action !==
        "KEEP_PRICE_IN_CONFIRMED_SOLD_BAND") ||
        (activeMarketPriceRecommendation &&
          activeMarketPriceRecommendation.action !==
            "HOLD_AT_SAFE_FLOOR_MARKET_BELOW_FLOOR") ? "high" : "medium",
      evidence,
      threshold_config_version: EBAY_COMPETITOR_WATCH_VERSION,
      detected_at: input.observedAt,
      listing_id: input.listing.listingId,
      sku: input.listing.sku,
      deduplication_key: deduplicationKey,
      recommended_action: recommendedAction,
    })
    .select("id")
    .maybeSingle()
  let eventId = inserted?.id as string | undefined
  let eventCreated = true
  if (eventError?.code === "23505") {
    eventCreated = false
    const { data: existing, error: readError } = await input.supabase
      .from("commercial_alert_events")
      .select("id")
      .eq("deduplication_key", deduplicationKey)
      .maybeSingle()
    if (readError || !existing?.id) {
      throw new Error("COMPETITOR_WATCH_EVENT_RECOVERY_READ_FAILED")
    }
    eventId = existing.id as string
  }
  if ((eventError && eventError.code !== "23505") || !eventId) {
    throw new Error("COMPETITOR_WATCH_EVENT_WRITE_FAILED")
  }
  const improvementUrl = sellerImprovementUrl(eventId)
  const whatsappAction = improvementUrl
    ? `Abrir acción en Seller OS: ${improvementUrl}. ${anyPriceRecommendation
        ? activeMarketPriceRecommendation?.action ===
            "HOLD_AT_SAFE_FLOOR_MARKET_BELOW_FLOOR"
          ? "Mantener el precio: el mercado activo está debajo del piso seguro."
          : activeMarketPriceRecommendation?.controlledRiskTenPercent
            ? "Autorizar o rechazar el precio competitivo; quedará bloqueado para promociones."
          : "Autorizar o rechazar la propuesta de precio; eBay no cambia sin tu confirmación."
        : marketPricePositionDetected
          ? "Confirmar ventas en Product Research antes de cambiar el precio."
          : input.analysis.researchRefreshRecommended
            ? "Actualizar la captura dirigida de Product Research."
            : "Revisar y decidir la mejora sugerida."}`
    : "Abrir Seller OS y revisar la mejora sugerida; eBay no cambia sin tu confirmación."
  const { error: outboxError } = await input.supabase.from("alert_delivery_outbox").insert({
    marketplace_account_key: input.accountKey,
    marketplace: MARKETPLACE,
    commercial_event_id: eventId,
    channel: "whatsapp",
    delivery_class: "immediate",
    severity: (priceRecommendation && priceRecommendation.action !==
      "KEEP_PRICE_IN_CONFIRMED_SOLD_BAND") ||
      (activeMarketPriceRecommendation &&
        activeMarketPriceRecommendation.action !==
          "HOLD_AT_SAFE_FLOOR_MARKET_BELOW_FLOOR") ? "high" : "medium",
    deduplication_key: `whatsapp:${deduplicationKey}`,
    status: "pending",
    payload: {
      ...payload,
      action: `${improvementUrl
        ? `Revisar y autorizar en Seller OS: ${improvementUrl}. `
        : "Revisar y autorizar desde Seller OS. "}${payload.action}`,
      whatsappAction,
      improvementUrl,
    },
    due_at: input.observedAt,
  })
  if (outboxError && outboxError.code !== "23505") {
    throw new Error("COMPETITOR_WATCH_ALERT_ENQUEUE_FAILED")
  }
  return {
    eventsCreated: eventCreated ? 1 : 0,
    alertsGenerated: outboxError ? 0 : 1,
    duplicatesAvoided: Number(!eventCreated) + Number(outboxError?.code === "23505"),
  }
}

async function loadProfiles(
  supabase: SupabaseClient,
  accountKey: string,
  listingIds: string[],
) {
  if (!listingIds.length) return [] as ProfileRow[]
  const { data, error } = await supabase
    .from("ebay_listing_competitor_watch_profiles")
    .select("id,listing_id,search_query_hash,baseline_completed_at,last_scanned_at,last_research_refresh_recommended_at,latest_suggestion_codes,latest_active_offer_count")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .in("listing_id", listingIds)
    .eq("status", "ACTIVE")
  if (error) throw new Error("COMPETITOR_WATCH_PROFILE_READ_FAILED")
  return (data ?? []) as ProfileRow[]
}

async function scanOneListing(input: {
  supabase: SupabaseClient
  accountKey: string
  monitorRunId: string
  listing: CompetitorWatchListingInput
  profile: ProfileRow | null
  ownSellerUsername: string | null
  fingerprintSecret: string
  observedAt: string
  persist: boolean
}) {
  const scan = await observeEbayActiveCompetitors({
    candidate: competitorCandidate(input.listing),
    marketplaceAccountKey: input.accountKey,
    fingerprintSecret: input.fingerprintSecret,
    ownSellerUsername: input.ownSellerUsername,
  })
  const profileScopeMatches = Boolean(
    input.profile?.baseline_completed_at &&
    input.profile.search_query_hash === scan.searchQueryHash,
  )
  let previousRows: OfferRow[] = []
  if (input.profile?.id && profileScopeMatches) {
    const { data, error } = await input.supabase
      .from("ebay_listing_competitor_offers")
      .select("item_reference_hash,seller_reference_hash,active,first_seen_as_baseline,first_seen_at,consecutive_scan_count,potential_notified_at,evidence_class")
      .eq("profile_id", input.profile.id)
      .limit(1_000)
    if (error) throw new Error("COMPETITOR_WATCH_OFFER_READ_FAILED")
    previousRows = (data ?? []) as OfferRow[]
  }
  const persistedActiveOfferCount = previousRows.filter((row) => row.active).length
  const baselineHistoryComplete = profileScopeMatches && (
    input.profile?.latest_active_offer_count === 0 ||
    persistedActiveOfferCount >= (input.profile?.latest_active_offer_count ?? 0)
  )
  const researchMatches = await readResearchMatches(
    input.supabase,
    input.accountKey,
    input.listing.supplierVariantId,
    scan.observations.map((entry) => entry.itemReferenceHash),
  )
  const observations: CompetitorWatchObservation[] = scan.observations.map((entry) => {
    const research = researchMatches.get(entry.itemReferenceHash)
    const soldItemPrice = numeric(research?.average_sold_price)
    const soldShipping = numeric(research?.average_shipping) ??
      (numeric(research?.free_shipping_percent) === 100 ? 0 : null)
    return research
      ? {
          ...entry,
          evidenceClass: "CONFIRMED_SOLD_HISTORY" as const,
          confirmedSoldQuantity: research.confirmed_sold_quantity,
          confirmedSoldLastDate: research.last_sold_date,
          confirmedSoldItemPrice: soldItemPrice,
          confirmedSoldShippingCost: soldShipping,
          confirmedSoldLandedPrice: soldItemPrice !== null && soldShipping !== null
            ? Number((soldItemPrice + soldShipping).toFixed(2)) : null,
          confirmedSoldOfferPackCount: research.detected_offer_pack_count,
        }
      : entry
  })
  const shippingCost = ownShippingCost(input.listing.rawPayload)
  const analysis = buildCompetitorWatchAnalysis({
    observations,
    previousOffers: previousRows.map(previousOffer),
    baselineExists: baselineHistoryComplete,
    ownListing: {
      itemPrice: input.listing.price,
      landedPrice: input.listing.price === null
        ? null
        : Number((input.listing.price + (shippingCost ?? 0)).toFixed(2)),
      shippingCost,
      packQuantity: extractPackQuantity([
        input.listing.supply?.title,
        input.listing.supply?.variantTitle,
        input.listing.title,
      ].filter(Boolean).join(" ")),
      supplierUnitCost: input.listing.supply?.unitCost ?? null,
      supplierCostFresh: input.listing.supply?.costFresh === true,
      supplierAvailable: input.listing.supply?.available ?? null,
      returnsAccepted: ownReturnsAccepted(input.listing.rawPayload),
      imageCount: ownImageCount(input.listing.rawPayload),
      title: input.listing.title,
      promotionAllowed: input.listing.promotionAllowed,
    },
    crossSellerCandidateConfirmedTerms: scan.crossSellerCandidateConfirmedTerms,
    previousSuggestionCodes: input.profile?.latest_suggestion_codes ?? [],
    lastResearchRefreshRecommendedAt:
      input.profile?.last_research_refresh_recommended_at ?? null,
    observedAt: input.observedAt,
  })
  if (!input.persist) return { listingId: input.listing.listingId, scan, analysis }
  // Persist the human-facing alert first. If enqueueing fails, the offer is not
  // marked as notified and the selective recommendation remains retryable.
  const alert = await persistCompetitorAlert({
    supabase: input.supabase,
    accountKey: input.accountKey,
    listing: input.listing,
    observedAt: input.observedAt,
    analysis,
  })
  const profileId = await upsertProfile({
    supabase: input.supabase,
    accountKey: input.accountKey,
    listing: input.listing,
    profile: input.profile,
    searchQueryHash: scan.searchQueryHash,
    observedAt: input.observedAt,
    analysis,
  })
  await persistScan({
    supabase: input.supabase,
    accountKey: input.accountKey,
    profileId,
    monitorRunId: input.monitorRunId,
    listingId: input.listing.listingId,
    observedAt: input.observedAt,
    scan,
    analysis,
  })
  await persistOffers({
    supabase: input.supabase,
    accountKey: input.accountKey,
    profileId,
    listingId: input.listing.listingId,
    observedAt: input.observedAt,
    observations,
    previousRows,
    analysis,
  })
  return { listingId: input.listing.listingId, scan, analysis, alert }
}

export async function monitorEbayListingCompetitors(input: {
  supabase: SupabaseClient
  accountKey: string
  monitorRunId: string
  listings: CompetitorWatchListingInput[]
  ownSellerUsername: string | null
  observedAt: string
  persist: boolean
}) {
  const fingerprintSecret = process.env.EBAY_COMPETITOR_FINGERPRINT_SECRET?.trim() ||
    process.env.EBAY_CLIENT_SECRET?.trim() || ""
  if (!fingerprintSecret) {
    throw new Error("EBAY_COMPETITOR_FINGERPRINT_CONFIGURATION_REQUIRED")
  }
  const profiles = await loadProfiles(
    input.supabase,
    input.accountKey,
    input.listings.map((listing) => listing.listingId),
  )
  const profileByListing = new Map(profiles.map((profile) => [profile.listing_id, profile]))
  const maxListings = integer(
    process.env.EBAY_COMPETITOR_MONITOR_LISTINGS_PER_RUN,
    DEFAULT_LISTINGS_PER_RUN,
    1,
    MAX_LISTINGS_PER_RUN,
  )
  const selected = [...input.listings].sort((left, right) => {
    const leftScanned = Date.parse(profileByListing.get(left.listingId)?.last_scanned_at ?? "")
    const rightScanned = Date.parse(profileByListing.get(right.listingId)?.last_scanned_at ?? "")
    const leftValue = Number.isFinite(leftScanned) ? leftScanned : 0
    const rightValue = Number.isFinite(rightScanned) ? rightScanned : 0
    return leftValue - rightValue || left.listingId.localeCompare(right.listingId)
  }).slice(0, maxListings)
  const results: Awaited<ReturnType<typeof scanOneListing>>[] = []
  const errors: Array<{ listingId: string; code: string }> = []
  for (const listing of selected) {
    try {
      results.push(await scanOneListing({
        ...input,
        listing,
        profile: profileByListing.get(listing.listingId) ?? null,
        fingerprintSecret,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      errors.push({
        listingId: listing.listingId,
        code: /^[A-Z0-9_]+$/.test(message) ? message : "COMPETITOR_WATCH_LISTING_FAILED",
      })
    }
  }
  const analyses = results.map((result) => result.analysis)
  return {
    status: errors.length
      ? results.length ? "PARTIAL" as const : "UNAVAILABLE" as const
      : "AVAILABLE" as const,
    source: "EBAY_BROWSE_ACTIVE_COMPETITOR_READONLY" as const,
    observedAt: input.observedAt,
    eligibleListings: input.listings.length,
    selectedListings: selected.length,
    scannedListings: results.length,
    baselineListings: analyses.filter((analysis) => analysis.baselineEstablished).length,
    activeOffers: analyses.reduce((sum, analysis) => sum + analysis.activeOfferCount, 0),
    activeSellers: analyses.reduce((sum, analysis) => sum + analysis.activeSellerCount, 0),
    newSellers: analyses.reduce((sum, analysis) => sum + analysis.newSellerHashes.length, 0),
    potentialSellers: analyses.reduce((sum, analysis) =>
      sum + analysis.potentialSellerHashes.length, 0),
    researchRefreshRecommendations: analyses.filter((analysis) =>
      analysis.researchRefreshRecommended).length,
    confirmedSoldPriceRecommendations: analyses.filter((analysis) =>
      analysis.priceRecommendation !== null).length,
    eventsCreated: results.reduce((sum, result) => sum + (result.alert?.eventsCreated ?? 0), 0),
    alertsGenerated: results.reduce((sum, result) => sum + (result.alert?.alertsGenerated ?? 0), 0),
    duplicatesAvoided: results.reduce((sum, result) =>
      sum + (result.alert?.duplicatesAvoided ?? 0), 0),
    errors,
    safety: {
      readOnlyEbay: true,
      rawCompetitorTitlesStored: false,
      rawSellerUsernamesStored: false,
      competitorImagesDownloaded: false,
      activeOfferTreatedAsConfirmedSale: false,
      automaticProductResearchImport: false,
      confirmedSoldPriceRequired: true,
      ownCostFloorRequired: true,
      automaticEbayMutation: false,
      ebayWrites: 0,
    },
  }
}
