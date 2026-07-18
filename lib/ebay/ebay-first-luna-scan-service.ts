import type { SupabaseClient } from "@supabase/supabase-js"
import { getEbayReadonlyRateLimitMetadata } from "./ebay-readonly-rate-limit"
import {
  assertEbayLaneAvailable,
  recordPersistentEbayRateLimit,
} from "./ebay-persistent-quota-coordinator"
import { runLightweightFamilyDiscovery } from "./ebay-two-speed-discovery-service"

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
const ALL_SCAN_LANES: SellerScanLane[] = ["protection", "event", "hot", "baseline", "coverage"]

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

type ScannerQuotaPause = {
  apiFamily: string
  operation: string
  lane: string
  resumeAt: string | null
  rateLimit: {
    httpStatus: 429
    retryAfterSeconds: number | null
    retryAfterSource: string
    observedAt: string
    resumeAt: string | null
    affectedLane: string
  }
}

function scannerQuotaPause(
  quota: unknown,
  input: { apiFamily: string; operation: string; lane: string },
  now = new Date(),
): ScannerQuotaPause {
  const row = quota && typeof quota === "object" ? quota as Record<string, unknown> : {}
  const resumeAt = typeof row.resumeAt === "string" && Number.isFinite(Date.parse(row.resumeAt))
    ? row.resumeAt
    : null
  const persistedSeconds = typeof row.retryAfterSeconds === "number"
    ? row.retryAfterSeconds
    : null
  const derivedSeconds = resumeAt
    ? Math.max(0, Math.ceil((Date.parse(resumeAt) - now.getTime()) / 1_000))
    : null
  return {
    ...input,
    resumeAt,
    rateLimit: {
      httpStatus: 429,
      retryAfterSeconds: derivedSeconds !== null
        ? derivedSeconds
        : persistedSeconds !== null && Number.isFinite(persistedSeconds) ? persistedSeconds : null,
      retryAfterSource: typeof row.retryAfterSource === "string"
        ? row.retryAfterSource
        : derivedSeconds === null ? "UNAVAILABLE" : "RETRY_AFTER_HTTP_DATE",
      observedAt: typeof row.observedAt === "string" ? row.observedAt : now.toISOString(),
      resumeAt,
      affectedLane: typeof row.affectedLane === "string" ? row.affectedLane : input.lane,
    },
  }
}

function earliestQuotaPause(pauses: ScannerQuotaPause[]) {
  return [...pauses].sort((left, right) => {
    const leftAt = Date.parse(left.resumeAt ?? "")
    const rightAt = Date.parse(right.resumeAt ?? "")
    if (!Number.isFinite(leftAt)) return 1
    if (!Number.isFinite(rightAt)) return -1
    return leftAt - rightAt
  })[0] ?? null
}

async function eligibleScanLanes(
  supabase: SupabaseClient,
  requestedLanes: SellerScanLane[],
  now = new Date(),
) {
  const needsProtection = requestedLanes.includes("protection")
  const discoveryLanes = requestedLanes.filter((lane) => lane !== "protection")
  const [exact, lightweight, deep] = await Promise.all([
    needsProtection
      ? assertEbayLaneAvailable(supabase, "BROWSE", "EXACT_VERIFICATION", now)
      : Promise.resolve(null),
    discoveryLanes.length
      ? assertEbayLaneAvailable(supabase, "BROWSE", "LIGHTWEIGHT_DISCOVERY", now)
      : Promise.resolve(null),
    discoveryLanes.length
      ? assertEbayLaneAvailable(supabase, "BROWSE", "DEEP_EXPLORATION", now)
      : Promise.resolve(null),
  ])
  const pauses: ScannerQuotaPause[] = []
  if (exact && !exact.available) pauses.push(scannerQuotaPause(exact, {
    apiFamily: "BROWSE",
    operation: "EXACT_VERIFICATION",
    lane: "P1_EXACT_VERIFICATION",
  }, now))
  if (lightweight && !lightweight.available) pauses.push(scannerQuotaPause(lightweight, {
    apiFamily: "BROWSE",
    operation: "LIGHTWEIGHT_DISCOVERY",
    lane: "P2_DISCOVERY",
  }, now))
  if (deep && !deep.available) pauses.push(scannerQuotaPause(deep, {
    apiFamily: "BROWSE",
    operation: "DEEP_EXPLORATION",
    lane: "P3_DEEP_ANALYSIS",
  }, now))
  return {
    lanes: [
      ...(needsProtection && exact?.available ? ["protection" as const] : []),
      ...(discoveryLanes.length && lightweight?.available && deep?.available ? discoveryLanes : []),
    ],
    pauses,
  }
}

async function pauseClaimedScanTasks(
  supabase: SupabaseClient,
  tasks: SellerScanTask[],
  workerId: string,
  resumeAt: string,
  reasonCode = "EBAY_READONLY_GET_429",
) {
  if (!tasks.length) return 0
  const { data, error } = await supabase.rpc("pause_ebay_seller_scan_tasks_for_quota", {
    p_task_ids: tasks.map((task) => task.id),
    p_worker_id: workerId,
    p_resume_at: resumeAt,
    p_reason_code: reasonCode,
  })
  if (error) throw new Error("EBAY_QUOTA_PAUSED_TASK_RELEASE_FAILED")
  const released = Array.isArray(data) ? data.length : data ? 1 : 0
  if (released !== tasks.length) throw new Error("EBAY_QUOTA_PAUSED_TASK_RELEASE_INCOMPLETE")
  return released
}

function taskUsesQuotaLane(task: SellerScanTask, affectedLane: string | undefined) {
  if (affectedLane === "P1_EXACT_VERIFICATION") return task.lane === "protection"
  if (affectedLane === "P2_DISCOVERY" || affectedLane === "P3_DEEP_ANALYSIS") {
    return task.lane !== "protection"
  }
  return true
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
  const lightweight = task.lane === "protection"
    ? {
        stage: "PROTECTION_EXACT_VERIFICATION" as const,
        promoteToDeep: true,
        familyFingerprint: candidate.candidateKey,
        cacheHit: false,
        sourceCallCount: 0,
        local: { eligible: true, blockers: [] as string[] },
      }
    : await runLightweightFamilyDiscovery(supabase, candidate)
  if (lightweight.stage === "QUOTA_PAUSED") {
    return {
      newSignalCount: 0,
      quotaPause: scannerQuotaPause(lightweight.quota, {
        apiFamily: "BROWSE",
        operation: "LIGHTWEIGHT_DISCOVERY",
        lane: "P2_DISCOVERY",
      }),
      result: {
        taskId: task.id,
        lane: task.lane,
        candidateKey: candidate.candidateKey,
        title: candidate.title,
        classification: "NEW_LUNA_SIGNAL",
        stage: lightweight.stage,
        familyFingerprint: lightweight.familyFingerprint,
        cacheHit: lightweight.cacheHit,
        sourceCallCount: lightweight.sourceCallCount,
        blockers: ["LIGHTWEIGHT_DISCOVERY_QUOTA_PAUSED"],
        deepAnalysisPerformed: false,
        ebayWrites: 0,
      },
    }
  }
  if (!lightweight.promoteToDeep) {
    return {
      newSignalCount: 0,
      result: {
        taskId: task.id,
        lane: task.lane,
        candidateKey: candidate.candidateKey,
        title: candidate.title,
        classification: lightweight.stage === "LOCAL_FILTERED" ? "BLOCKED" : "NEW_LUNA_SIGNAL",
        stage: lightweight.stage,
        familyFingerprint: lightweight.familyFingerprint,
        cacheHit: lightweight.cacheHit,
        sourceCallCount: lightweight.sourceCallCount,
        blockers: lightweight.local.blockers,
        deepAnalysisPerformed: false,
        ebayWrites: 0,
      },
    }
  }
  const deepQuota = await assertEbayLaneAvailable(
    supabase,
    "BROWSE",
    task.lane === "protection" ? "EXACT_VERIFICATION" : "DEEP_EXPLORATION",
  )
  if (!deepQuota.available) {
    return {
      newSignalCount: 0,
      quotaPause: scannerQuotaPause(deepQuota, {
        apiFamily: "BROWSE",
        operation: task.lane === "protection" ? "EXACT_VERIFICATION" : "DEEP_EXPLORATION",
        lane: task.lane === "protection" ? "P1_EXACT_VERIFICATION" : "P3_DEEP_ANALYSIS",
      }),
      result: {
        taskId: task.id,
        lane: task.lane,
        candidateKey: candidate.candidateKey,
        title: candidate.title,
        classification: "PRELIMINARY_POTENTIAL",
        stage: "DEEP_QUOTA_PAUSED",
        familyFingerprint: lightweight.familyFingerprint,
        cacheHit: lightweight.cacheHit,
        sourceCallCount: lightweight.sourceCallCount,
        blockers: ["DEEP_DISCOVERY_QUOTA_PAUSED"],
        deepAnalysisPerformed: false,
        ebayWrites: 0,
      },
    }
  }
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
  const requestedLanes = options.lanes?.length
    ? [...new Set(options.lanes)]
    : ALL_SCAN_LANES
  const quotaPlan = await eligibleScanLanes(supabase, requestedLanes)
  const preflightPause = earliestQuotaPause(quotaPlan.pauses)
  if (!quotaPlan.lanes.length && preflightPause) {
    return {
      run,
      processed: 0,
      completed: false,
      results: [],
      failures: [],
      pausedTasks: 0,
      rateLimit: preflightPause.rateLimit,
    }
  }
  const tasks = await claimSellerScanTasks(supabase, {
    workerId,
    limit: options.batchSize ?? SCAN_BATCH_SIZE,
    leaseSeconds: 300,
    lanes: quotaPlan.lanes,
  })

  if (!tasks.length) {
    if (preflightPause) {
      return {
        run,
        processed: 0,
        completed: false,
        results: [],
        failures: [],
        pausedTasks: 0,
        rateLimit: preflightPause.rateLimit,
      }
    }
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
  let terminalCount = 0
  let pauseTaskIndex: number | null = null
  let pauseResumeAt: string | null = null
  let batchRateLimit: ScannerQuotaPause["rateLimit"] | null = null
  for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
    const task = tasks[taskIndex]
    try {
      const processed = await processClaimedCandidate(supabase, run, task)
      if ("quotaPause" in processed && processed.quotaPause) {
        pauseTaskIndex = taskIndex
        pauseResumeAt = processed.quotaPause.resumeAt
        batchRateLimit = processed.quotaPause.rateLimit
        break
      }
      newSignalCount += processed.newSignalCount
      results.push(processed.result)
      await completeSellerScanTask(supabase, task.id, workerId, processed.result)
      terminalCount += 1
    } catch (error) {
      const rateLimit = getEbayReadonlyRateLimitMetadata(error)
      if (rateLimit) {
        const quotaError = error && typeof error === "object"
          ? error as Record<string, unknown>
          : {}
        const operation = typeof quotaError.quotaOperation === "string"
          ? quotaError.quotaOperation
          : task.lane === "protection" ? "EXACT_VERIFICATION" : "DEEP_EXPLORATION"
        const affectedLane = typeof quotaError.quotaLane === "string"
          ? quotaError.quotaLane
          : task.lane === "protection" ? "P1_EXACT_VERIFICATION" : "P3_DEEP_ANALYSIS"
        if (!(error && typeof error === "object" && "quotaPersisted" in error)) {
          const persisted = await recordPersistentEbayRateLimit(supabase, {
            error,
            apiFamily: typeof quotaError.quotaApiFamily === "string" ? quotaError.quotaApiFamily : "BROWSE",
            endpoint: "BUY_BROWSE_READONLY",
            operation,
            lane: affectedLane === "P1_EXACT_VERIFICATION"
              ? "P1_EXACT_VERIFICATION"
              : affectedLane === "P2_DISCOVERY" ? "P2_DISCOVERY" : "P3_DEEP_ANALYSIS",
            checkpoint: { runId: run.id, taskId: task.id, candidateKey: task.candidate_key },
            retryCount: task.attempts,
          })
          pauseResumeAt = persisted?.resumeAt ?? null
        } else {
          pauseResumeAt = typeof quotaError.quotaResumeAt === "string"
            ? quotaError.quotaResumeAt : null
        }
        pauseTaskIndex = taskIndex
        batchRateLimit = {
          ...rateLimit,
          resumeAt: pauseResumeAt,
          affectedLane,
        }
        break
      }
      const failedTask = await failSellerScanTask(supabase, task, workerId, error)
      if (failedTask?.status === "dead_letter") deadLetterCount += 1
      failures.push({ taskId: task.id, candidateKey: task.candidate_key, error: safeMessage(error) })
      terminalCount += 1
    }
  }

  const remainingClaimedTasks = pauseTaskIndex === null ? [] : tasks.slice(pauseTaskIndex)
  const affectedLane = batchRateLimit?.affectedLane
  const quotaPausedTasks = remainingClaimedTasks.filter((task) => taskUsesQuotaLane(task, affectedLane))
  const unaffectedTasks = remainingClaimedTasks.filter((task) => !taskUsesQuotaLane(task, affectedLane))
  if (quotaPausedTasks.length) {
    const exactResumeAt = pauseResumeAt ?? new Date(Date.now() + 15 * 60_000).toISOString()
    pauseResumeAt = exactResumeAt
    if (batchRateLimit) batchRateLimit.resumeAt = exactResumeAt
    await pauseClaimedScanTasks(supabase, quotaPausedTasks, workerId, exactResumeAt)
  }
  if (unaffectedTasks.length) {
    await pauseClaimedScanTasks(
      supabase,
      unaffectedTasks,
      workerId,
      new Date().toISOString(),
      "QUOTA_OTHER_LANE_DEFERRED",
    )
  }

  const now = new Date().toISOString()
  const nextOffset = run.next_offset + terminalCount
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
      last_error: batchRateLimit
        ? "EBAY_READONLY_GET_429"
        : failures.length ? String(failures[failures.length - 1]?.error ?? "EBAY_CANDIDATE_SCAN_FAILED") : null,
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
        metrics: {
          lastBatchSize: tasks.length,
          pausedTasks: quotaPausedTasks.length,
          unaffectedTasksReleased: unaffectedTasks.length,
          workerId,
        },
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
  return {
    run: updatedRun,
    processed: terminalCount,
    completed: false,
    results,
    failures,
    pausedTasks: quotaPausedTasks.length,
    unaffectedTasksReleased: unaffectedTasks.length,
    rateLimit: batchRateLimit,
  }
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
    supabase.from("ebay_luna_opportunity_queue").select("id,candidate_key,market_radar_product_id,supplier_variant_id,product_title,variant_title,supplier_sku,queue_status,decision,opportunity_score,demand_score,economics_score,identity_score,competition_score,supply_score,listing_readiness_score,active_comparables,sellers_with_movement,estimated_weekly_velocity,median_total_buyer_price,estimated_net_profit,supplier_price,supplier_available,supplier_inventory_quantity,best_selling_match_score,hard_gates,evidence_guards,assessment,last_scanned_at").order("opportunity_score", { ascending: false }).limit(QUEUE_LIMIT),
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
  const [{ data: quotaStates, error: quotaError }, { data: quotaEvents, error: quotaEventError }] = await Promise.all([
    supabase.from("ebay_api_quota_states")
      .select("api_family,operation,remaining,reset_at,reserved_budget,available_budget,status,owner_lane,last_refreshed_at")
      .order("owner_lane", { ascending: true }),
    supabase.from("ebay_api_quota_events")
      .select("api_family,http_status,retry_after_seconds,retry_after_source,observed_at,pause_started_at,resume_at,affected_lane,retry_count")
      .order("observed_at", { ascending: false }).limit(1),
  ])
  if (quotaError || quotaEventError) throw new Error("EBAY_QUOTA_DASHBOARD_READ_FAILED")
  const automationHealth = await getSellerAutomationHealth(supabase)
  const rows = queue.data ?? []
  const supplierVariantIds = [...new Set(rows
    .map((row) => row.supplier_variant_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0))]
  const productResearchBySupplierVariant = new Map<string, {
    soldExactCount: number
    soldRelatedPackCount: number
    soldRelatedSizeCount: number
    latestObservedAt: string | null
  }>()
  let productResearchRankingStatus: "AVAILABLE" | "UNAVAILABLE" | "NOT_APPLICABLE" = supplierVariantIds.length
    ? "AVAILABLE"
    : "NOT_APPLICABLE"
  if (supplierVariantIds.length) {
    const { data: researchRows, error: researchError } = await supabase
      .from("marketplace_product_research_capture_observations")
      .select("matched_supplier_variant_id,match_classification,confirmed_sold_quantity,last_sold_date")
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", "EBAY_US")
      .in("matched_supplier_variant_id", supplierVariantIds)
      .eq("evidence_reviewed", true)
      .limit(5_000)
    if (researchError) {
      // Product Research enriches ranking but must never take down the operational queue.
      productResearchRankingStatus = "UNAVAILABLE"
    } else {
      for (const observation of researchRows ?? []) {
        if (!observation.matched_supplier_variant_id) continue
        const current = productResearchBySupplierVariant.get(observation.matched_supplier_variant_id) ?? {
          soldExactCount: 0,
          soldRelatedPackCount: 0,
          soldRelatedSizeCount: 0,
          latestObservedAt: null,
        }
        const sold = Math.max(0, Number(observation.confirmed_sold_quantity ?? 0))
        if (observation.match_classification === "EXACT_LUNA_MATCH") current.soldExactCount += sold
        else if (observation.match_classification === "SAME_PRODUCT_DIFFERENT_PACK") current.soldRelatedPackCount += sold
        else if (observation.match_classification === "SAME_PRODUCT_DIFFERENT_SIZE") current.soldRelatedSizeCount += sold
        if (!current.latestObservedAt || observation.last_sold_date > current.latestObservedAt) {
          current.latestObservedAt = observation.last_sold_date
        }
        productResearchBySupplierVariant.set(observation.matched_supplier_variant_id, current)
      }
    }
  }
  const professionalRows = rows
    .map((row) => {
      const research = row.supplier_variant_id
        ? productResearchBySupplierVariant.get(row.supplier_variant_id)
        : undefined
      if (!research) return buildProfessionalSellerQueueView({
        ...row,
        product_research_ranking_status: productResearchRankingStatus,
      })
      const assessment = row.assessment && typeof row.assessment === "object"
        ? row.assessment as Record<string, unknown> : {}
      const market = assessment.market && typeof assessment.market === "object"
        ? assessment.market as Record<string, unknown> : {}
      return buildProfessionalSellerQueueView({
        ...row,
        product_research_ranking_status: productResearchRankingStatus,
        assessment: {
          ...assessment,
          market: {
            ...market,
            soldExactCount: research.soldExactCount,
            soldRelatedPackCount: research.soldRelatedPackCount,
            soldRelatedSizeCount: research.soldRelatedSizeCount,
            productResearchObservedAt: research.latestObservedAt,
          },
        },
      })
    })
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
    quota: {
      states: quotaStates ?? [],
      latestPause: quotaEvents?.[0] ?? null,
      discoveryPaused: (quotaStates ?? []).some((state) =>
        ["P2_DISCOVERY", "P3_DEEP_ANALYSIS"].includes(state.owner_lane) && state.status === "PAUSED_429"),
      monitorBudgetProtected: (quotaStates ?? []).filter((state) =>
        String(state.owner_lane).startsWith("P0_")).every((state) => Number(state.reserved_budget ?? 0) > 0),
    },
    rankingEvidence: {
      productResearchStatus: productResearchRankingStatus,
      failureCode: productResearchRankingStatus === "UNAVAILABLE"
        ? "EBAY_PRODUCT_RESEARCH_RANKING_UNAVAILABLE"
        : null,
    },
  }
}
