import type { SupabaseClient } from "@supabase/supabase-js"

import {
  matchEbayBestSellingProductsToLuna,
} from "./ebay-luna-demand-opportunity-engine"
import { runEbayLunaOpportunityScan } from "./ebay-luna-demand-opportunity-gateway"
import {
  loadEbayListingObservationHistory,
  persistEbayOpportunityObservation,
} from "./ebay-luna-opportunity-observation-store"
import {
  discoverEbayBestSellingProducts,
  type EbayBestSellingProductSignal,
} from "./ebay-seller-keyword-demand-gateway"
import {
  buildBestSellingSignalKey,
  buildOpportunityChangeEvents,
  buildOpportunityQueueRow,
  buildProfessionalSellerQueueView,
  mapLatestVariantToLunaCandidate,
  type ExistingOpportunityQueueRow,
  type LunaLatestVariantRow,
} from "./ebay-first-luna-opportunity-queue"

const SCAN_BATCH_SIZE = 2
const QUEUE_LIMIT = 100
export const EBAY_LUNA_SCAN_STRATEGY = "priority_first"

type ScanRun = {
  id: string
  status: string
  category_ids: string[] | null
  total_candidates: number
  processed_candidates: number
  next_offset: number
  successful_candidates: number
  failed_candidates: number
  best_selling_signals_found: number
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "EBAY_LUNA_SCAN_FAILED"
  return /^[A-Z0-9_]+$/.test(message) ? message : "EBAY_LUNA_SCAN_FAILED"
}

function numericCategoryIds(values: unknown) {
  return Array.isArray(values)
    ? [...new Set(values.filter((value): value is string =>
        typeof value === "string" && /^\d+$/.test(value.trim()),
      ).map((value) => value.trim()))].slice(0, 12)
    : []
}

async function countLunaVariants(supabase: SupabaseClient) {
  const { count, error } = await supabase
    .from("market_radar_latest_variants")
    .select("product_id", { count: "exact", head: true })
    .eq("source_key", "lunaportex")
  if (error) throw new Error("LUNA_CATALOG_COUNT_FAILED")
  return count ?? 0
}

export async function startEbayFirstLunaScan(
  supabase: SupabaseClient,
  categoryIds: unknown,
) {
  const { data: activeRun } = await supabase
    .from("ebay_luna_scan_runs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (activeRun) return activeRun as ScanRun
  const totalCandidates = await countLunaVariants(supabase)
  const { data, error } = await supabase
    .from("ebay_luna_scan_runs")
    .insert({
      status: "running",
      scan_mode: "hybrid",
      category_ids: numericCategoryIds(categoryIds),
      total_candidates: totalCandidates,
    })
    .select("*")
    .single()
  if (error || !data) throw new Error("EBAY_LUNA_SCAN_RUN_CREATE_FAILED")
  return data as ScanRun
}

async function getRun(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase
    .from("ebay_luna_scan_runs")
    .select("*")
    .eq("id", runId)
    .single()
  if (error || !data) throw new Error("EBAY_LUNA_SCAN_RUN_NOT_FOUND")
  return data as ScanRun
}

async function storeBestSellingSignals(
  supabase: SupabaseClient,
  discoveries: Array<{
    categoryId: string
    status: string
    products: EbayBestSellingProductSignal[]
  }>,
) {
  const now = new Date().toISOString()
  const signals = discoveries.flatMap((discovery) => discovery.products)
  if (!signals.length) return 0
  const { error } = await supabase
    .from("ebay_luna_best_selling_signals")
    .upsert(signals.map((signal) => ({
      signal_key: buildBestSellingSignalKey(signal),
      category_id: signal.categoryId,
      epid: signal.epid,
      title: signal.title,
      image_url: signal.imageUrl,
      average_rating: signal.averageRating,
      rating_count: signal.ratingCount,
      review_count: signal.reviewCount,
      discovery_status: "available",
      last_observed_at: now,
      raw_signal: signal,
    })), { onConflict: "signal_key" })
  if (error) throw new Error("EBAY_BEST_SELLING_SIGNAL_PERSIST_FAILED")
  return signals.length
}

async function loadBestSellingSignals(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("ebay_luna_best_selling_signals")
    .select("category_id,epid,title,image_url,average_rating,rating_count,review_count")
    .order("last_observed_at", { ascending: false })
    .limit(500)
  if (error) throw new Error("EBAY_BEST_SELLING_SIGNAL_READ_FAILED")
  return (data ?? []).map((row) => ({
    categoryId: row.category_id,
    epid: row.epid,
    title: row.title,
    imageUrl: row.image_url,
    averageRating: row.average_rating === null ? null : Number(row.average_rating),
    ratingCount: row.rating_count,
    reviewCount: row.review_count,
    evidenceClass: "EBAY_MARKETING_BEST_SELLING_PRODUCT" as const,
  }))
}

async function createActiveListingRisk(
  supabase: SupabaseClient,
  marketRadarProductId: string | null,
  supplierVariantId: string | null,
  eventType: string,
) {
  const riskType = eventType === "out_of_stock"
    ? "out_of_stock"
    : eventType === "price_up"
      ? "price_up"
      : null
  if (!marketRadarProductId || !riskType) return
  let query = supabase
    .from("ebay_active_listings")
    .select("id")
    .eq("market_radar_product_id", marketRadarProductId)
    .eq("listing_status", "active")
  if (supplierVariantId) query = query.eq("supplier_variant_id", supplierVariantId)
  const { data } = await query.limit(20)
  for (const listing of data ?? []) {
    const { data: existing } = await supabase
      .from("ebay_active_listing_risk_events")
      .select("id")
      .eq("active_listing_id", listing.id)
      .eq("risk_type", riskType)
      .is("resolved_at", null)
      .limit(1)
    if (existing?.length) continue
    await supabase.from("ebay_active_listing_risk_events").insert({
      active_listing_id: listing.id,
      risk_type: riskType,
      risk_priority: riskType === "out_of_stock" ? "critical" : "high",
      risk_summary: riskType === "out_of_stock"
        ? "Luna Portex reportó el producto sin stock."
        : "Luna Portex reportó un aumento de costo.",
      recommended_action: riskType === "out_of_stock"
        ? "Pausar o revisar inmediatamente el listing en eBay."
        : "Recalcular margen y revisar el precio del listing.",
    })
  }
}

export async function processNextEbayFirstLunaBatch(
  supabase: SupabaseClient,
  runId: string,
) {
  const run = await getRun(supabase, runId)
  if (run.status !== "running") return { run, processed: 0, completed: true, results: [] }
  const { data, error } = await supabase
    .from("market_radar_latest_variants")
    .select("*")
    .eq("source_key", "lunaportex")
    .order("seller_scan_priority_score", { ascending: false, nullsFirst: false })
    .order("product_id", { ascending: true })
    .order("supplier_variant_id", { ascending: true })
    .range(run.next_offset, run.next_offset + SCAN_BATCH_SIZE - 1)
  if (error) throw new Error("LUNA_CATALOG_BATCH_READ_FAILED")
  const variants = (data ?? []) as LunaLatestVariantRow[]
  if (!variants.length) {
    const completedAt = new Date().toISOString()
    const { data: completedRun } = await supabase
      .from("ebay_luna_scan_runs")
      .update({ status: "completed", completed_at: completedAt, last_batch_at: completedAt })
      .eq("id", run.id)
      .select("*")
      .single()
    return { run: completedRun ?? run, processed: 0, completed: true, results: [] }
  }

  const candidates = variants.map(mapLatestVariantToLunaCandidate)
  const historyByCandidate: Record<string, Awaited<ReturnType<typeof loadEbayListingObservationHistory>>> = {}
  const since = new Date(Date.now() - 38 * 86_400_000).toISOString()
  for (const candidate of candidates) {
    if (candidate.candidateKey) {
      historyByCandidate[candidate.candidateKey] = await loadEbayListingObservationHistory(
        supabase,
        candidate.candidateKey,
        since,
      )
    }
  }
  const inferredCategories = candidates
    .map((candidate) => candidate.categoryId)
    .filter((value): value is string => Boolean(value))
  const scan = await runEbayLunaOpportunityScan({
    candidates,
    observationHistoryByCandidate: historyByCandidate,
    bestSellingCategoryIds: [...new Set([...(run.category_ids ?? []), ...inferredCategories])].slice(0, 3),
  })
  const discoveries: Array<{
    categoryId: string
    status: string
    products: EbayBestSellingProductSignal[]
  }> = scan.bestSellingDiscovery.map(({ categoryId, status, products }) => ({
    categoryId,
    status,
    products,
  }))
  const discoveredCategoryIds = new Set(discoveries.map((entry) => entry.categoryId))
  const assessedCategoryIds = scan.rankedOpportunities
    .map((assessment) => assessment.listingIntelligencePackage.categoryRecommendation.categoryId)
    .filter((value): value is string => typeof value === "string" && /^\d+$/.test(value))
  for (const categoryId of [...new Set(assessedCategoryIds)].slice(0, 3)) {
    if (discoveredCategoryIds.has(categoryId)) continue
    discoveries.push({ categoryId, ...(await discoverEbayBestSellingProducts(categoryId)) })
  }
  const newSignalCount = await storeBestSellingSignals(supabase, discoveries)
  const bestSellingSignals = await loadBestSellingSignals(supabase)
  const results = []

  for (const assessment of scan.rankedOpportunities) {
    const candidate = candidates.find((entry) => entry.candidateKey === assessment.candidate.candidateKey)
    const variant = variants.find((entry) => entry.product_id === assessment.candidate.marketRadarProductId &&
      entry.supplier_variant_id === assessment.candidate.supplierVariantId)
    const matches = matchEbayBestSellingProductsToLuna(bestSellingSignals, candidate ? [candidate] : [])
    const queueRow = buildOpportunityQueueRow(assessment, matches)
    const { data: previousData } = await supabase
      .from("ebay_luna_opportunity_queue")
      .select("id,opportunity_score,supplier_price,supplier_available,supplier_inventory_quantity,queue_status")
      .eq("candidate_key", assessment.candidate.candidateKey)
      .maybeSingle()
    const previous = previousData as ExistingOpportunityQueueRow | null
    if (previous && ["listed", "archived"].includes(previous.queue_status)) {
      queueRow.queue_status = previous.queue_status
    }
    const { data: saved, error: saveError } = await supabase
      .from("ebay_luna_opportunity_queue")
      .upsert(queueRow, { onConflict: "candidate_key" })
      .select("id")
      .single()
    if (saveError || !saved) throw new Error("EBAY_LUNA_QUEUE_UPSERT_FAILED")
    await persistEbayOpportunityObservation(
      supabase,
      assessment,
      assessment.currentObservations,
      true,
      { trustedInternalQueueRun: true },
    )
    const events = buildOpportunityChangeEvents(previous, queueRow, variant?.snapshot_id ?? "unknown")
    for (const event of events) {
      await supabase.from("ebay_luna_opportunity_queue_events").upsert({
        opportunity_id: saved.id,
        event_type: event.type,
        old_value: { value: event.oldValue },
        new_value: { value: event.newValue },
        idempotency_key: `${saved.id}:${event.snapshotId}:${event.type}`,
      }, { onConflict: "idempotency_key", ignoreDuplicates: true })
      await createActiveListingRisk(
        supabase,
        assessment.candidate.marketRadarProductId,
        assessment.candidate.supplierVariantId,
        event.type,
      )
    }
    results.push({
      candidateKey: assessment.candidate.candidateKey,
      title: assessment.candidate.title,
      opportunityScore: assessment.scores.opportunityScore,
      decision: assessment.decision,
      queueStatus: queueRow.queue_status,
    })
  }

  const now = new Date().toISOString()
  const nextOffset = run.next_offset + variants.length
  const completed = nextOffset >= run.total_candidates
  const { data: updatedRun, error: updateError } = await supabase
    .from("ebay_luna_scan_runs")
    .update({
      status: completed ? "completed" : "running",
      processed_candidates: Math.min(nextOffset, run.total_candidates),
      next_offset: nextOffset,
      successful_candidates: run.successful_candidates + results.length,
      best_selling_signals_found: run.best_selling_signals_found + newSignalCount,
      last_batch_at: now,
      completed_at: completed ? now : null,
      last_error: null,
    })
    .eq("id", run.id)
    .select("*")
    .single()
  if (updateError) throw new Error("EBAY_LUNA_SCAN_RUN_UPDATE_FAILED")
  return { run: updatedRun, processed: variants.length, completed, results }
}

export async function recordEbayFirstLunaScanFailure(
  supabase: SupabaseClient,
  runId: string,
  error: unknown,
) {
  const run = await getRun(supabase, runId)
  const code = safeMessage(error)
  await supabase.from("ebay_luna_scan_runs").update({
    failed_candidates: run.failed_candidates + 1,
    last_error: code,
    last_batch_at: new Date().toISOString(),
  }).eq("id", run.id)
  return code
}

export async function getEbayFirstLunaQueueDashboard(supabase: SupabaseClient) {
  const [runs, queue, events, activeRisks, total, ready, review, watchlist, holds] = await Promise.all([
    supabase.from("ebay_luna_scan_runs").select("*").order("started_at", { ascending: false }).limit(5),
    supabase.from("ebay_luna_opportunity_queue").select("id,candidate_key,market_radar_product_id,product_title,variant_title,supplier_sku,queue_status,decision,opportunity_score,demand_score,economics_score,identity_score,competition_score,supply_score,listing_readiness_score,active_comparables,sellers_with_movement,estimated_weekly_velocity,median_total_buyer_price,estimated_net_profit,supplier_price,supplier_available,supplier_inventory_quantity,best_selling_match_score,hard_gates,evidence_guards,assessment,last_scanned_at").order("opportunity_score", { ascending: false }).limit(QUEUE_LIMIT),
    supabase.from("ebay_luna_opportunity_queue_events").select("*,ebay_luna_opportunity_queue(product_title,supplier_sku)").order("created_at", { ascending: false }).limit(40),
    supabase.from("ebay_active_listing_risk_events").select("id,risk_type,risk_priority,risk_summary,recommended_action,created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(40),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }).eq("queue_status", "ready"),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }).eq("queue_status", "review"),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }).eq("queue_status", "watchlist"),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }).in("queue_status", ["hold", "rejected"]),
  ])
  const firstError = runs.error ?? queue.error ?? events.error ?? activeRisks.error ?? total.error ?? ready.error ?? review.error ?? watchlist.error ?? holds.error
  if (firstError) throw new Error("EBAY_LUNA_QUEUE_DASHBOARD_READ_FAILED")
  const rows = queue.data ?? []
  const professionalRows = rows
    .map((row) => buildProfessionalSellerQueueView(row))
    .sort((left, right) =>
      right.seller_priority_score - left.seller_priority_score ||
      Number(right.opportunity_score ?? 0) - Number(left.opportunity_score ?? 0),
    )
  return {
    runs: runs.data ?? [],
    queue: professionalRows,
    events: events.data ?? [],
    activeListingRisks: activeRisks.data ?? [],
    summary: {
      total: total.count ?? rows.length,
      ready: ready.count ?? rows.filter((row) => row.queue_status === "ready").length,
      review: review.count ?? rows.filter((row) => row.queue_status === "review").length,
      watchlist: watchlist.count ?? rows.filter((row) => row.queue_status === "watchlist").length,
      supplierHolds: holds.count ?? rows.filter((row) => row.queue_status === "hold" || row.queue_status === "rejected").length,
      activeListingRisks: activeRisks.data?.length ?? 0,
    },
    safety: {
      ebayReadOnly: true,
      noDrafts: true,
      noOffers: true,
      noPublishing: true,
      humanApprovalRequired: true,
    },
    automation: {
      strategy: EBAY_LUNA_SCAN_STRATEGY,
      productionSchedule: "17 9 * * *",
      productionScheduleLabel: "Luna 03:00 + eBay 03:17 · America/Managua",
      previewRunsCronAutomatically: false,
      productionRunsCronAutomatically: true,
      mobileAccelerationBatchCount: 10,
      variantsPerBatch: SCAN_BATCH_SIZE,
    },
  }
}
