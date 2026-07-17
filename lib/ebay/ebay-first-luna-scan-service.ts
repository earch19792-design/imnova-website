import type { SupabaseClient } from "@supabase/supabase-js"

import {
  EBAY_LUNA_DEMAND_OPPORTUNITY_ENGINE_VERSION,
  matchEbayBestSellingProductsToLuna,
} from "./ebay-luna-demand-opportunity-engine"
import { runEbayLunaOpportunityScan } from "./ebay-luna-demand-opportunity-gateway"
import {
  loadEbayCategoryLearningAdjustments,
} from "./ebay-category-performance-learning"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"
import {
  loadEbayListingObservationHistory,
  persistEbayOpportunityObservation,
} from "./ebay-luna-opportunity-observation-store"
import {
  discoverEbayBestSellingProducts,
  type EbayBestSellingProductSignal,
} from "./ebay-seller-keyword-demand-gateway"
import {
  buildSellerWorkerId,
  claimSellerScanTasks,
  completeSellerScanTask,
  createSellerAutomationRun,
  failSellerScanTask,
  finishSellerAutomationRun,
  getSellerAutomationHealth,
  reconcileSellerScanTasks,
  type SellerScanLane,
  type SellerScanTask,
} from "./ebay-seller-command-center-automation"
import {
  deliverSellerWhatsAppAlerts,
  enqueueSellerWhatsAppAlert,
  resolveSellerWhatsAppAlert,
} from "./ebay-seller-whatsapp-alerts"
import { getSellerWhatsAppGatewayConfiguration } from "./ebay-seller-whatsapp-gateway"
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
  automation_run_id?: string | null
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
  options: {
    forceDue?: boolean
    triggerSource?: "schedule" | "mobile" | "admin" | "event" | "recovery"
    lanes?: SellerScanLane[]
    reconcileTasks?: boolean
  } = {},
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
  const reconciliation = options.reconcileTasks === false
    ? { insertedOrUpdated: 0, dueNow: 0, skipped: true }
    : await reconcileSellerScanTasks(supabase, {
        forceDue: options.forceDue !== false,
        limit: Math.max(totalCandidates, 1),
      })
  const automationRun = await createSellerAutomationRun(supabase, {
    runKind: options.triggerSource === "mobile" ? "manual_acceleration" : "ebay_scan",
    triggerSource: options.triggerSource ?? "mobile",
    lanes: options.lanes ?? [],
    metrics: { reconciliation },
  })
  const { data, error } = await supabase
    .from("ebay_luna_scan_runs")
    .insert({
      status: "running",
      scan_mode: "hybrid",
      category_ids: numericCategoryIds(categoryIds),
      total_candidates: totalCandidates,
      automation_run_id: automationRun.id,
    })
    .select("*")
    .single()
  if (error || !data) throw new Error("EBAY_LUNA_SCAN_RUN_CREATE_FAILED")
  await supabase
    .from("ebay_seller_automation_runs")
    .update({ scan_run_id: data.id })
    .eq("id", automationRun.id)
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

async function bestSellingCategoriesDue(
  supabase: SupabaseClient,
  categoryIds: Array<string | null | undefined>,
  limit = 3,
) {
  const normalized = [...new Set(categoryIds
    .filter((value): value is string => typeof value === "string" && /^\d+$/.test(value)))]
    .slice(0, Math.max(1, limit))
  if (!normalized.length) return []
  const freshnessCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("ebay_luna_best_selling_signals")
    .select("category_id")
    .in("category_id", normalized)
    .gte("last_observed_at", freshnessCutoff)
  if (error) throw new Error("EBAY_BEST_SELLING_FRESHNESS_READ_FAILED")
  const fresh = new Set((data ?? []).map((row) => row.category_id))
  return normalized.filter((categoryId) => !fresh.has(categoryId))
}

async function createActiveListingRisk(
  supabase: SupabaseClient,
  marketRadarProductId: string | null,
  supplierVariantId: string | null,
  eventType: string,
  sourceSnapshotId: string | null,
  oldValue?: unknown,
  newValue?: unknown,
) {
  const riskType = eventType === "out_of_stock"
    ? "out_of_stock"
    : eventType === "price_up"
      ? "price_up"
      : null
  if (!marketRadarProductId || !riskType) return
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return
  let query = supabase
    .from("ebay_active_listings")
    .select("id,title,supplier_sku")
    .eq("account_key", accountKey)
    .eq("market_radar_product_id", marketRadarProductId)
    .eq("listing_status", "active")
  if (supplierVariantId) query = query.eq("supplier_variant_id", supplierVariantId)
  const { data } = await query.limit(20)
  for (const listing of data ?? []) {
    const riskFingerprint = `active-listing:${listing.id}:${riskType}`
    const riskSummary = riskType === "out_of_stock"
      ? "Luna Portex reportó el producto sin stock."
      : "Luna Portex reportó un aumento de costo."
    const recommendedAction = riskType === "out_of_stock"
      ? "Pausar o revisar inmediatamente el listing en eBay."
      : "Recalcular margen y revisar el precio del listing."
    const { data: riskData, error: riskError } = await supabase.rpc("upsert_ebay_active_listing_risk", {
      p_active_listing_id: listing.id,
      p_risk_type: riskType,
      p_risk_priority: riskType === "out_of_stock" ? "critical" : "high",
      p_risk_summary: riskSummary,
      p_recommended_action: recommendedAction,
      p_risk_fingerprint: riskFingerprint,
      p_evidence: { sourceSnapshotId, eventType },
    })
    const risk = (Array.isArray(riskData) ? riskData[0] : riskData) as {
      risk_id?: string
      was_resolved?: boolean
    } | null
    if (riskError || !risk?.risk_id) throw new Error("ACTIVE_LISTING_RISK_UPSERT_FAILED")
    const wasResolved = risk.was_resolved === true
    const oldCost = Number(oldValue)
    const newCost = Number(newValue)
    const costChangePct = Number.isFinite(oldCost) && oldCost > 0 && Number.isFinite(newCost)
      ? ((newCost - oldCost) / oldCost) * 100
      : null
    await enqueueSellerWhatsAppAlert(supabase, {
      alertType: riskType,
      entityType: "ebay_active_listing",
      entityId: listing.id,
      candidateKey: listing.supplier_sku,
      title: listing.title || "Listing activo eBay",
      summary: riskSummary,
      mobileUrl: process.env.EBAY_SELLER_COMMAND_CENTER_URL,
      facts: {
        hasActiveListing: true,
        supplierAvailable: riskType === "out_of_stock" ? false : null,
        currentStock: riskType === "out_of_stock" ? 0 : null,
        costChangePct,
      },
    }).catch(() => undefined)
    const alertFingerprint = `risk:${riskFingerprint}`
    const { data: existingAlert, error: existingAlertError } = await supabase
      .from("ebay_seller_alert_outbox")
      .select("id")
      .eq("alert_fingerprint", alertFingerprint)
      .maybeSingle()
    if (existingAlertError) throw new Error("SELLER_ALERT_OUTBOX_READ_FAILED")
    if (existingAlert && !wasResolved) continue
    const { error: alertError } = await supabase
      .from("ebay_seller_alert_outbox")
      .upsert({
        alert_fingerprint: alertFingerprint,
        alert_type: riskType,
        priority: riskType === "out_of_stock" ? "critical" : "high",
        entity_type: "ebay_active_listing_risk",
        entity_id: risk.risk_id,
        status: "pending",
        channel: "in_app",
        attempts: 0,
        delivered_at: null,
        last_error_code: null,
        payload: {
          accountKey,
          marketRadarProductId,
          supplierVariantId,
          sourceSnapshotId,
          eventType,
        },
      }, { onConflict: "alert_fingerprint" })
    if (alertError) throw new Error("SELLER_ALERT_OUTBOX_UPSERT_FAILED")
  }
}

async function createOpportunitySignalAlert(
  supabase: SupabaseClient,
  input: {
    opportunityId: string
    candidateKey: string
    title: string
    eventType: string
    snapshotId: string
    inventoryQuantity?: number | null
    stateValue?: unknown
  },
) {
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return
  const supported = ["price_down", "restocked", "out_of_stock", "price_up", "low_stock"]
  if (!supported.includes(input.eventType)) return
  const priority = input.eventType === "out_of_stock"
    ? "critical"
    : input.eventType === "restocked" || input.eventType === "low_stock"
      ? "high"
      : "medium"
  const stateFingerprint = input.eventType === "price_down" || input.eventType === "price_up"
    ? `:${String(input.stateValue ?? "changed").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40)}`
    : ""
  const alertFingerprint = `opportunity:${input.opportunityId}:${input.eventType}${stateFingerprint}:account:${accountKey}`
  if (input.eventType === "low_stock") {
    const { data: existing, error: readError } = await supabase
      .from("ebay_seller_alert_outbox")
      .select("id,status")
      .eq("alert_fingerprint", alertFingerprint)
      .maybeSingle()
    if (readError) throw new Error("SELLER_OPPORTUNITY_ALERT_READ_FAILED")
    if (existing && existing.status !== "cancelled") return
  }
  const { error } = await supabase.from("ebay_seller_alert_outbox").upsert({
    alert_fingerprint: alertFingerprint,
    alert_type: input.eventType,
    priority,
    entity_type: "ebay_luna_opportunity",
    entity_id: input.opportunityId,
    candidate_key: input.candidateKey,
    channel: "in_app",
    status: "pending",
    attempts: 0,
    delivered_at: null,
    last_error_code: null,
    payload: {
      accountKey,
      title: input.title,
      eventType: input.eventType,
      snapshotId: input.snapshotId,
      inventoryQuantity: input.inventoryQuantity ?? null,
    },
    due_at: new Date().toISOString(),
  }, { onConflict: "alert_fingerprint" })
  if (error) throw new Error("SELLER_OPPORTUNITY_ALERT_UPSERT_FAILED")
}

async function loadVariantForTask(supabase: SupabaseClient, task: SellerScanTask) {
  if (!task.market_radar_product_id) throw new Error("LUNA_CATALOG_TASK_PRODUCT_REQUIRED")
  let query = supabase
    .from("market_radar_latest_variants")
    .select("*")
    .eq("source_key", "lunaportex")
    .eq("product_id", task.market_radar_product_id)
  if (task.supplier_variant_id) query = query.eq("supplier_variant_id", task.supplier_variant_id)
  else if (task.supplier_sku) query = query.eq("sku", task.supplier_sku)
  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error("LUNA_CATALOG_TASK_READ_FAILED")
  if (!data) throw new Error("LUNA_CATALOG_TASK_VARIANT_NOT_FOUND")
  return data as LunaLatestVariantRow
}

async function processClaimedCandidate(
  supabase: SupabaseClient,
  run: ScanRun,
  task: SellerScanTask,
) {
  const variant = await loadVariantForTask(supabase, task)
  const candidate = mapLatestVariantToLunaCandidate(variant)
  const since = new Date(Date.now() - 38 * 86_400_000).toISOString()
  const history = candidate.candidateKey
    ? await loadEbayListingObservationHistory(supabase, candidate.candidateKey, since)
    : []
  const inferredCategories = candidate.categoryId ? [candidate.categoryId] : []
  const categoriesDue = await bestSellingCategoriesDue(
    supabase,
    [...(run.category_ids ?? []), ...inferredCategories],
  )
  const categoryLearningAdjustments = await loadEbayCategoryLearningAdjustments(
    supabase,
    EBAY_LUNA_DEMAND_OPPORTUNITY_ENGINE_VERSION,
  ).catch(() => ({}))
  const scan = await runEbayLunaOpportunityScan({
    candidates: [candidate],
    observationHistoryByCandidate: candidate.candidateKey
      ? { [candidate.candidateKey]: history }
      : {},
    bestSellingCategoryIds: categoriesDue,
    categoryLearningAdjustmentsByCategory: categoryLearningAdjustments,
  })
  const discoveries: Array<{
    categoryId: string
    status: string
    products: EbayBestSellingProductSignal[]
  }> = scan.bestSellingDiscovery.map(({ categoryId, status, products }) => ({ categoryId, status, products }))
  const discoveredCategoryIds = new Set(discoveries.map((entry) => entry.categoryId))
  const assessedCategoryIds = scan.rankedOpportunities
    .map((assessment) => assessment.listingIntelligencePackage.categoryRecommendation.categoryId)
    .filter((value): value is string => typeof value === "string" && /^\d+$/.test(value))
  const assessedCategoriesDue = await bestSellingCategoriesDue(supabase, assessedCategoryIds, 1)
  for (const categoryId of assessedCategoriesDue) {
    if (!discoveredCategoryIds.has(categoryId)) {
      discoveries.push({ categoryId, ...(await discoverEbayBestSellingProducts(categoryId)) })
    }
  }
  const newSignalCount = await storeBestSellingSignals(supabase, discoveries)
  const bestSellingSignals = await loadBestSellingSignals(supabase)
  const assessment = scan.rankedOpportunities[0]
  if (!assessment) throw new Error("EBAY_LUNA_CANDIDATE_ASSESSMENT_EMPTY")
  const matches = matchEbayBestSellingProductsToLuna(bestSellingSignals, [candidate])
  const queueRow = buildOpportunityQueueRow(assessment, matches)
  const { data: previousData } = await supabase
    .from("ebay_luna_opportunity_queue")
    .select("id,opportunity_score,supplier_price,supplier_available,supplier_inventory_quantity,queue_status")
    .eq("candidate_key", assessment.candidate.candidateKey)
    .maybeSingle()
  const previous = previousData as ExistingOpportunityQueueRow | null
  if (previous && ["listed", "archived"].includes(previous.queue_status)) queueRow.queue_status = previous.queue_status
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
  const events = buildOpportunityChangeEvents(previous, queueRow, variant.snapshot_id ?? "unknown")
  for (const event of events) {
    const { error: eventError } = await supabase.from("ebay_luna_opportunity_queue_events").upsert({
      opportunity_id: saved.id,
      event_type: event.type,
      old_value: { value: event.oldValue },
      new_value: { value: event.newValue },
      idempotency_key: `${saved.id}:${event.snapshotId}:${event.type}`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
    if (eventError) throw new Error("EBAY_LUNA_QUEUE_EVENT_UPSERT_FAILED")
    await createOpportunitySignalAlert(supabase, {
      opportunityId: saved.id,
      candidateKey: assessment.candidate.candidateKey,
      title: assessment.candidate.title,
      eventType: event.type,
      snapshotId: event.snapshotId,
      inventoryQuantity: assessment.candidate.inventoryQuantity,
      stateValue: event.newValue,
    })
    await createActiveListingRisk(
      supabase,
      assessment.candidate.marketRadarProductId,
      assessment.candidate.supplierVariantId,
      event.type,
      variant.snapshot_id,
      event.oldValue,
      event.newValue,
    )
  }
  if (
    assessment.candidate.available === true &&
    assessment.candidate.inventoryQuantity !== null &&
    assessment.candidate.inventoryQuantity !== undefined &&
    assessment.candidate.inventoryQuantity > 0 &&
    assessment.candidate.inventoryQuantity <= 3
  ) {
    await createOpportunitySignalAlert(supabase, {
      opportunityId: saved.id,
      candidateKey: assessment.candidate.candidateKey,
      title: assessment.candidate.title,
      eventType: "low_stock",
      snapshotId: variant.snapshot_id ?? "unknown",
      inventoryQuantity: assessment.candidate.inventoryQuantity,
    })
  } else {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    const { error: resolvedLowStockError } = await supabase
      .from("ebay_seller_alert_outbox")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("alert_fingerprint", `opportunity:${saved.id}:low_stock:account:${accountKey ?? "unconfigured"}`)
      .neq("status", "cancelled")
    if (resolvedLowStockError) throw new Error("SELLER_LOW_STOCK_ALERT_RESOLVE_FAILED")
  }
  const winnerAlertInput = {
    alertType: "winner_ready" as const,
    entityType: "ebay_luna_opportunity",
    entityId: saved.id,
    candidateKey: assessment.candidate.candidateKey,
    title: assessment.candidate.title,
    summary: `Oportunidad ${Math.round(assessment.scores.potentialScore)}% potencial, ${Math.round(assessment.scores.confidenceScore)}% confianza y margen estimado ${Math.round(assessment.economics.estimatedNetMarginPercent ?? 0)}%.`,
    mobileUrl: process.env.EBAY_SELLER_COMMAND_CENTER_URL,
    facts: {
      potentialScore: assessment.scores.potentialScore,
      confidenceScore: assessment.scores.confidenceScore,
      currentStock: assessment.candidate.inventoryQuantity,
      estimatedMarginPct: assessment.economics.estimatedNetMarginPercent,
      estimatedNetProfit: assessment.economics.estimatedNetProfit,
      hasExactEvidence: assessment.identity.exactIdentityConfirmed &&
        assessment.canProceedToListingPackage,
    },
  }
  if (assessment.canProceedToListingPackage) {
    await enqueueSellerWhatsAppAlert(supabase, winnerAlertInput).catch(() => undefined)
  } else {
    await resolveSellerWhatsAppAlert(supabase, winnerAlertInput).catch(() => undefined)
  }
  for (const event of events) {
    if (event.type === "restocked") {
      await enqueueSellerWhatsAppAlert(supabase, {
        alertType: "luna_restock",
        entityType: "ebay_luna_opportunity",
        entityId: saved.id,
        candidateKey: assessment.candidate.candidateKey,
        title: assessment.candidate.title,
        summary: `Luna confirmó reposición: ${assessment.candidate.inventoryQuantity ?? "cantidad pendiente"} unidades disponibles.`,
        mobileUrl: process.env.EBAY_SELLER_COMMAND_CENTER_URL,
        facts: {
          previousStock: previous?.supplier_inventory_quantity ?? 0,
          currentStock: assessment.candidate.inventoryQuantity,
          potentialScore: assessment.scores.potentialScore,
        },
      }).catch(() => undefined)
    }
    if (event.type === "price_down") {
      const oldCost = Number(event.oldValue)
      const newCost = Number(event.newValue)
      const costChangePct = Number.isFinite(oldCost) && oldCost > 0 && Number.isFinite(newCost)
        ? ((newCost - oldCost) / oldCost) * 100
        : null
      await enqueueSellerWhatsAppAlert(supabase, {
        alertType: "luna_cost_drop",
        entityType: "ebay_luna_opportunity",
        entityId: saved.id,
        candidateKey: assessment.candidate.candidateKey,
        title: assessment.candidate.title,
        summary: `El costo Luna bajó de $${oldCost.toFixed(2)} a $${newCost.toFixed(2)}.`,
        mobileUrl: process.env.EBAY_SELLER_COMMAND_CENTER_URL,
        facts: {
          costChangePct,
          potentialScore: assessment.scores.potentialScore,
        },
      }).catch(() => undefined)
    }
  }
  return {
    newSignalCount,
    result: {
      taskId: task.id,
      lane: task.lane,
      candidateKey: assessment.candidate.candidateKey,
      title: assessment.candidate.title,
      opportunityScore: assessment.scores.opportunityScore,
      decision: assessment.decision,
      queueStatus: queueRow.queue_status,
    },
  }
}

export async function processNextEbayFirstLunaBatch(
  supabase: SupabaseClient,
  runId: string,
  options: { batchSize?: number; workerId?: string; lanes?: SellerScanLane[] } = {},
) {
  const run = await getRun(supabase, runId)
  if (run.status !== "running") return { run, processed: 0, completed: true, results: [], failures: [] }
  const workerId = options.workerId ?? buildSellerWorkerId("seller-command-center")
  const tasks = await claimSellerScanTasks(supabase, {
    workerId,
    limit: options.batchSize ?? SCAN_BATCH_SIZE,
    leaseSeconds: 300,
    lanes: options.lanes,
  })

  if (!tasks.length) {
    const completedAt = new Date().toISOString()
    const { data: completedRun } = await supabase
      .from("ebay_luna_scan_runs")
      .update({ status: "completed", completed_at: completedAt, last_batch_at: completedAt })
      .eq("id", run.id)
      .select("*")
      .single()
    if (run.automation_run_id) {
      await finishSellerAutomationRun(supabase, run.automation_run_id, {
        status: run.failed_candidates > 0 ? "partial" : "completed",
        claimedTasks: run.processed_candidates,
        successfulTasks: run.successful_candidates,
        failedTasks: run.failed_candidates,
        metrics: { scanRunId: run.id, exhaustedDueQueue: true },
      }).catch(() => undefined)
    }
    return { run: completedRun ?? run, processed: 0, completed: true, results: [], failures: [] }
  }

  const results: Array<Record<string, unknown>> = []
  const failures: Array<Record<string, unknown>> = []
  let newSignalCount = 0
  let deadLetterCount = 0
  for (const task of tasks) {
    try {
      const processed = await processClaimedCandidate(supabase, run, task)
      newSignalCount += processed.newSignalCount
      results.push(processed.result)
      await completeSellerScanTask(supabase, task.id, workerId, processed.result)
    } catch (error) {
      const failedTask = await failSellerScanTask(supabase, task, workerId, error)
      if (failedTask?.status === "dead_letter") deadLetterCount += 1
      failures.push({ taskId: task.id, candidateKey: task.candidate_key, error: safeMessage(error) })
    }
  }

  const now = new Date().toISOString()
  const nextOffset = run.next_offset + tasks.length
  const { data: updatedRun, error: updateError } = await supabase
    .from("ebay_luna_scan_runs")
    .update({
      status: "running",
      processed_candidates: Math.min(nextOffset, run.total_candidates),
      next_offset: nextOffset,
      successful_candidates: run.successful_candidates + results.length,
      failed_candidates: run.failed_candidates + failures.length,
      best_selling_signals_found: run.best_selling_signals_found + newSignalCount,
      last_batch_at: now,
      last_error: failures.length ? String(failures[failures.length - 1]?.error ?? "EBAY_CANDIDATE_SCAN_FAILED") : null,
    })
    .eq("id", run.id)
    .select("*")
    .single()
  if (updateError) throw new Error("EBAY_LUNA_SCAN_RUN_UPDATE_FAILED")
  if (run.automation_run_id) {
    await supabase
      .from("ebay_seller_automation_runs")
      .update({
        claimed_tasks: nextOffset,
        successful_tasks: run.successful_candidates + results.length,
        failed_tasks: run.failed_candidates + failures.length,
        dead_letter_tasks: deadLetterCount,
        heartbeat_at: now,
        metrics: { lastBatchSize: tasks.length, workerId },
      })
      .eq("id", run.automation_run_id)
  }
  if (getSellerWhatsAppGatewayConfiguration().deliveryAttemptAllowed) {
    await deliverSellerWhatsAppAlerts(supabase, {
      workerId: buildSellerWorkerId("seller-whatsapp"),
      limit: 10,
      dryRun: false,
    }).catch(() => undefined)
  }
  return { run: updatedRun, processed: tasks.length, completed: false, results, failures }
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
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  const activeRisksQuery = accountKey
    ? supabase
      .from("ebay_active_listing_risk_events")
      .select("id,risk_type,risk_priority,risk_summary,recommended_action,created_at,active_listing:ebay_active_listings!inner(account_key)")
      .eq("active_listing.account_key", accountKey)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(40)
    : Promise.resolve({ data: [], error: null })
  const [runs, queue, events, activeRisks, total, ready, review, watchlist, holds] = await Promise.all([
    supabase.from("ebay_luna_scan_runs").select("*").order("started_at", { ascending: false }).limit(5),
    supabase.from("ebay_luna_opportunity_queue").select("id,candidate_key,market_radar_product_id,product_title,variant_title,supplier_sku,queue_status,decision,opportunity_score,demand_score,economics_score,identity_score,competition_score,supply_score,listing_readiness_score,active_comparables,sellers_with_movement,estimated_weekly_velocity,median_total_buyer_price,estimated_net_profit,supplier_price,supplier_available,supplier_inventory_quantity,best_selling_match_score,hard_gates,evidence_guards,assessment,last_scanned_at").order("opportunity_score", { ascending: false }).limit(QUEUE_LIMIT),
    supabase.from("ebay_luna_opportunity_queue_events").select("*,ebay_luna_opportunity_queue(product_title,supplier_sku)").order("created_at", { ascending: false }).limit(40),
    activeRisksQuery,
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }).eq("queue_status", "ready"),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }).eq("queue_status", "review"),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }).eq("queue_status", "watchlist"),
    supabase.from("ebay_luna_opportunity_queue").select("id", { count: "exact", head: true }).in("queue_status", ["hold", "rejected"]),
  ])
  const firstError = runs.error ?? queue.error ?? events.error ?? activeRisks.error ?? total.error ?? ready.error ?? review.error ?? watchlist.error ?? holds.error
  if (firstError) throw new Error("EBAY_LUNA_QUEUE_DASHBOARD_READ_FAILED")
  const automationHealth = await getSellerAutomationHealth(supabase)
  const rows = queue.data ?? []
  const professionalRows = rows
    .map((row) => buildProfessionalSellerQueueView(row))
    .sort((left, right) =>
      right.seller_priority_score - left.seller_priority_score ||
      Number(right.opportunity_score ?? 0) - Number(left.opportunity_score ?? 0),
    )
  const scopedActiveRisks = (activeRisks.data ?? []).map((risk) => {
    const { active_listing: _activeListing, ...publicRisk } = risk
    return publicRisk
  })
  return {
    runs: runs.data ?? [],
    queue: professionalRows,
    events: events.data ?? [],
    activeListingRisks: scopedActiveRisks,
    summary: {
      total: total.count ?? rows.length,
      ready: ready.count ?? rows.filter((row) => row.queue_status === "ready").length,
      review: review.count ?? rows.filter((row) => row.queue_status === "review").length,
      watchlist: watchlist.count ?? rows.filter((row) => row.queue_status === "watchlist").length,
      supplierHolds: holds.count ?? rows.filter((row) => row.queue_status === "hold" || row.queue_status === "rejected").length,
      activeListingRisks: scopedActiveRisks.length,
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
      lunaProductionSchedule: "0 9 * * *",
      productionScheduleLabel: "Luna diario 09:00 UTC + eBay diario 09:17 UTC · protección por prioridad",
      previewRunsCronAutomatically: false,
      productionRunsCronAutomatically: true,
      mobileAccelerationBatchCount: 10,
      variantsPerBatch: SCAN_BATCH_SIZE,
      lanes: ["protection", "event", "hot", "baseline", "coverage"],
      health: automationHealth,
    },
  }
}
