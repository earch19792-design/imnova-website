export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  applyEbayCommercialImprovement,
  COMMERCIAL_IMPROVEMENT_CONFIRMATION,
  inspectEbayCommercialImprovement,
  prepareEbayCommercialImprovement,
} from "@/lib/ebay/ebay-commercial-improvement-action-service"
import { isProvenSupplierLinkageV1 } from
  "@/lib/ebay/commercial-monitor-readonly-contract"
import { getEbayCommercialMonitorDashboard } from
  "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbayProRuntimeBoundary } from
  "@/lib/ebay/environment-boundaries"
import {
  buildRemoteLiveOptimizationOperatorV1,
  readRemoteLiveOperatorSalesResultsV1,
  remoteFeedHasUnprovenFalseZeroV1,
  remoteLiveOptimizationTasksV1,
  REMOTE_LIVE_OPTIMIZATION_OPERATOR_VERSION,
} from "@/lib/ebay/ebay-remote-live-optimization-operator-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import {
  loadSellerOsAssistantMonitorSnapshotV1,
  loadSellerOsAssistantMonitorV1,
} from
  "@/lib/ebay/ebay-seller-os-assistant-runtime"
import { buildSellerOsCurrentLiveVisualQualityV1 } from
  "@/lib/ebay/ebay-seller-os-visual-quality-v1"
import { buildProactiveExceptionQueueV1 } from
  "@/lib/ebay/ebay-seller-os-portfolio-intelligence-v1"
import { loadEbayPromotionRecommendationSafeExecutionV1 } from
  "@/lib/ebay/ebay-promotion-recommendation-safe-execution-v1"
import {
  claimMayelAutonomousResearchPlanV1,
  completeMayelLiveMarketRevalidationV1,
  readMayelAutonomousResearchAcquisitionV1,
  readMayelLiveMarketRevalidationPlanV1,
  readMayelLiveMarketRevalidationStatusV1,
  releaseMayelAutonomousResearchPlanV1,
  resumeMayelMarketRevalidationDownstreamV1,
  startMayelLiveMarketRevalidationV1,
} from "@/lib/ebay/ebay-mayel-live-market-revalidation-v1"
import { currentLiveListingsForMonitorV1 } from
  "@/lib/ebay/ebay-seller-os-live-portfolio-integrity-v1"
import {
  readRemoteOperatorPreparedImageProposalsV1,
  recordRemoteOperatorImageReviewV1,
} from "@/lib/ebay/ebay-remote-operator-image-review-v1"
import { readRemoteListingQualitySignalsV1 } from
  "@/lib/ebay/ebay-listing-quality-report-owner-import-v1"
import {
  applyRemoteOperatorSafeMutationCanaryV1,
  authorizeRemoteOperatorSafeMutationCanaryV1,
  readRemoteOperatorSafeMutationCanaryV1,
  REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION,
  resolveRemoteOperatorUserIdV1,
} from "@/lib/ebay/ebay-remote-operator-safe-mutation-canary-v1"
import { SELLER_OS_ACCESS_ROLES } from "@/lib/seller-os-access-control"
import {
  getSupabaseAdminClient,
  validateSellerOsApiRequest,
} from "@/lib/supabase-admin"

const VISUAL_CACHE_TTL_MS = 15 * 60_000
let visualCache: Readonly<{
  key: string
  expiresAt: number
  value: Promise<Awaited<ReturnType<
    typeof buildSellerOsCurrentLiveVisualQualityV1>>>
}> | null = null

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code : "REMOTE_LIVE_OPTIMIZATION_REQUEST_FAILED"
}

function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value.trim()) ? value.trim() : null
}

function idempotencyKey(value: unknown) {
  return typeof value === "string" &&
    /^[A-Za-z0-9._:-]{8,120}$/.test(value.trim()) ? value.trim() : null
}

function exactTitleValue(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return normalized === value && normalized.length >= 1 &&
    normalized.length <= 80 ? normalized : null
}

function authorizationDigest(value: unknown) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
    ? value : null
}

async function jsonBody(request: Request) {
  try {
    const value = await request.json()
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function boundaryBlocked(request: Request) {
  return getEbayProRuntimeBoundary({
    pathname: new URL(request.url).pathname,
    method: request.method,
  }).runtime !== "seller_os_dedicated_preprod"
}

function liveMutationEnabled() {
  return process.env.SELLER_OS_REMOTE_LIVE_MUTATIONS_ENABLED?.trim()
    .toLowerCase() === "true"
}

function titleCanaryEnabled() {
  return process.env.SELLER_OS_REMOTE_TITLE_CANARY_ENABLED?.trim()
    .toLowerCase() === "true"
}

function telemetryCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 0 && value <= 10_000 ? value : null
}

async function persistedActiveListingCount(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  accountKey: string,
) {
  const { count, error } = await supabase.from("ebay_active_listings")
    .select("id", { count: "exact", head: true })
    .eq("account_key", accountKey)
    .eq("listing_status", "active")
  if (error) throw new Error("REMOTE_ACTIVE_LISTING_COUNT_READ_FAILED")
  return count ?? 0
}

async function mayelMarketEvidence(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  accountKey: string,
  supplierVariantIds: readonly string[],
) {
  if (!supplierVariantIds.length) return Object.freeze({
    status: "UNAVAILABLE" as const,
    rows: Object.freeze([]),
    limitationCode: "LIVE_LISTING_SUPPLIER_VARIANT_LINK_UNAVAILABLE",
  })
  const maximumVariantScope = 100
  const boundedVariantIds = supplierVariantIds.slice(0, maximumVariantScope)
  const scopeTruncated = supplierVariantIds.length > maximumVariantScope
  const maximumRows = 500
  const base = "id,source_listing_id,matched_supplier_variant_id,match_classification,match_reasons,normalized_identity,average_sold_price,average_shipping,confirmed_sold_quantity,last_sold_date,created_at,evidence_reviewed,quality_status"
  const primary = await supabase.from(
    "marketplace_product_research_capture_observations")
    .select(base).eq("marketplace_account_key", accountKey)
    .eq("marketplace", "EBAY_US")
    .in("matched_supplier_variant_id", boundedVariantIds)
    .order("created_at", { ascending: false }).limit(maximumRows)
  if (!primary.error) return Object.freeze({
    status: scopeTruncated || (primary.data?.length ?? 0) >= maximumRows
      ? "PARTIAL" as const : "AVAILABLE" as const,
    rows: Object.freeze(primary.data ?? []),
    limitationCode: scopeTruncated
      ? "MAYEL_MARKET_EVIDENCE_VARIANT_SCOPE_LIMIT_REACHED"
      : (primary.data?.length ?? 0) >= maximumRows
        ? "MAYEL_MARKET_EVIDENCE_RESULT_LIMIT_REACHED" : null,
  })
  // Older installations intentionally omitted the official Item ID. Preserve
  // all proven market evidence and make only that field unavailable.
  const fallback = await supabase.from(
    "marketplace_product_research_capture_observations")
    .select("id,matched_supplier_variant_id,match_classification,match_reasons,normalized_identity,average_sold_price,average_shipping,confirmed_sold_quantity,last_sold_date,created_at,evidence_reviewed,quality_status")
    .eq("marketplace_account_key", accountKey).eq("marketplace", "EBAY_US")
    .in("matched_supplier_variant_id", boundedVariantIds)
    .order("created_at", { ascending: false }).limit(maximumRows)
  if (!fallback.error) return Object.freeze({
    status: "PARTIAL" as const,
    rows: Object.freeze(fallback.data ?? []),
    limitationCode: "COMPARABLE_ITEM_ID_NOT_PERSISTED",
  })
  return Object.freeze({ status: "UNAVAILABLE" as const,
    rows: Object.freeze([]),
    limitationCode: "MAYEL_MARKET_EVIDENCE_READ_UNAVAILABLE" })
}

async function visualQuality(
  monitor: Awaited<ReturnType<typeof loadSellerOsAssistantMonitorSnapshotV1>>,
) {
  const key = monitor.listings
    .filter((row) => row.discovery.livePresence.status === "LIVE_ACTIVE")
    .map((row) => `${row.identity.itemId}:${row.identity.primaryImageUrl ?? ""}`)
    .sort().join("|")
  const now = Date.now()
  if (visualCache && visualCache.key === key && visualCache.expiresAt > now) {
    return visualCache.value
  }
  const value = buildSellerOsCurrentLiveVisualQualityV1({ monitor })
  visualCache = Object.freeze({ key, expiresAt: now + VISUAL_CACHE_TTL_MS,
    value })
  try {
    return await value
  } catch (error) {
    if (visualCache?.value === value) visualCache = null
    throw error
  }
}

async function authorizedRequest(request: Request) {
  const validation = await validateSellerOsApiRequest(request)
  if (!validation.ok || !validation.userId ||
      validation.authenticationMode !== "seller_os_user" ||
      !validation.accessRole) return { validation, accepted: false as const }
  return { validation, accepted: true as const }
}

async function currentOptimizationTask(eventId: string) {
  const supabase = getSupabaseAdminClient()
  const dashboard = await getEbayCommercialMonitorDashboard(supabase)
  const tasks = remoteLiveOptimizationTasksV1(dashboard)
  return tasks.some((task) => task.id === eventId)
}

export async function GET(request: Request) {
  const auth = await authorizedRequest(request)
  if (!auth.accepted) return NextResponse.json({ success: false,
    error: auth.validation.error ?? "seller_os_forbidden" },
  { status: auth.validation.status || 403 })
  if (boundaryBlocked(request)) return NextResponse.json({ success: false,
    error: "REMOTE_LIVE_OPTIMIZATION_DEDICATED_PREPROD_ONLY" },
  { status: 403 })
  try {
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    const supabase = getSupabaseAdminClient()
    const monitorPromise = loadSellerOsAssistantMonitorSnapshotV1()
    const [initialMonitor, commercialDashboard, salesResults, executions,
      imageProposals, listingQualitySignals, persistedActiveCount] =
      await Promise.all([
        monitorPromise,
        getEbayCommercialMonitorDashboard(supabase),
        readRemoteLiveOperatorSalesResultsV1({ supabase,
          accountKey: account.accountKey }),
        supabase.from("ebay_commercial_improvement_executions")
          .select("commercial_event_id,actor_user_id,listing_id,phase,action_type,created_at,applied_verified_at,last_error_code")
          .eq("marketplace_account_key", account.accountKey)
          .order("created_at", { ascending: false }).limit(50),
        readRemoteOperatorPreparedImageProposalsV1({ supabase,
          accountKey: account.accountKey,
          operatorUserId: auth.validation.userId }),
        readRemoteListingQualitySignalsV1({ supabase,
          accountKey: account.accountKey }),
        persistedActiveListingCount(supabase, account.accountKey),
      ])
    let monitor = initialMonitor
    if (executions.error) {
      throw new Error("COMMERCIAL_IMPROVEMENT_LEDGER_READ_FAILED")
    }
    const initialCurrentLiveCount =
      currentLiveListingsForMonitorV1(monitor).length
    let falseZeroRetry = false
    if (remoteFeedHasUnprovenFalseZeroV1({
      currentLiveCount: initialCurrentLiveCount,
      persistedActiveCount,
      decisionCount: monitor.backend.decisions.length,
    })) {
      falseZeroRetry = true
      monitor = await loadSellerOsAssistantMonitorV1()
    }
    const currentLiveCount = currentLiveListingsForMonitorV1(monitor).length
    if (remoteFeedHasUnprovenFalseZeroV1({
      currentLiveCount,
      persistedActiveCount,
      decisionCount: monitor.backend.decisions.length,
    })) {
      throw new Error("REMOTE_FEED_FALSE_ZERO_REJECTED")
    }
    const currentLiveListings = currentLiveListingsForMonitorV1(monitor)
    const currentItemIds = currentLiveListings.map((listing) =>
      listing.identity.itemId)
    const [economicJobs, economicReadbacks] = await Promise.all([
      supabase.from("seller_os_economic_evidence_refresh_jobs_v1")
        .select("ebay_item_id,evidence_type,status,failure_class,next_retry_at,updated_at")
        .eq("marketplace_account_key", account.accountKey)
        .in("ebay_item_id", currentItemIds).limit(500),
      supabase.from("seller_os_live_economics_readbacks_v1")
        .select("ebay_item_id,status,live_price,luna_cost,luna_shipping,expected_ebay_fee,other_explicit_costs,expected_profit,margin_percent,roi_percent,calculated_at,missing_economic_inputs")
        .eq("marketplace_account_key", account.accountKey)
        .in("ebay_item_id", currentItemIds)
        .order("calculated_at", { ascending: false }).limit(500),
    ])
    if (economicJobs.error || economicReadbacks.error) {
      throw new Error("MAYEL_ECONOMIC_REFRESH_READ_MODEL_UNAVAILABLE")
    }
    const latestEconomicReadbacks = [...new Map(
      (economicReadbacks.data ?? []).map((row) =>
        [row.ebay_item_id, row] as const)).values()]
    const marketEvidence = await mayelMarketEvidence(
      supabase,
      account.accountKey,
      [...new Set(currentLiveListings.map((listing) =>
        listing.stock.supplierVariantId).filter((value): value is string =>
        Boolean(value)))],
    )
    const commercialExceptions = buildProactiveExceptionQueueV1({
      monitor,
      maximumEntries: 250,
    })
    const operatorUserId = auth.validation.accessRole ===
      SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator
      ? auth.validation.userId
      : await resolveRemoteOperatorUserIdV1(supabase)
    const safeMutationCanary = await readRemoteOperatorSafeMutationCanaryV1({
      supabase,
      accountKey: account.accountKey,
      listings: currentLiveListingsForMonitorV1(monitor),
      commercialExceptions,
      operatorUserId,
      executionEnabled: titleCanaryEnabled(),
    })
    const visual = await visualQuality(monitor)
    const dashboard = buildRemoteLiveOptimizationOperatorV1({
      monitor,
      commercialDashboard,
      commercialExceptions,
      visualQuality: visual,
      salesResults,
      imageProposals,
      listingQualitySignals,
      marketEvidence: marketEvidence.rows,
      marketEvidenceReadStatus: marketEvidence.status,
      marketEvidenceLimitationCode: marketEvidence.limitationCode,
      economicRefreshJobs: economicJobs.data ?? [],
      economicReadbacks: latestEconomicReadbacks,
      safeMutationCanary,
      improvementExecutions: executions.data ?? [],
      operatorUserId: auth.validation.userId,
      remoteScopeAuthorized: [SELLER_OS_ACCESS_ROLES.owner,
        SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator]
        .includes(auth.validation.accessRole),
      liveMutationEnabled: liveMutationEnabled(),
    })
    console.info("REMOTE_OPERATOR_SESSION_FEED_RESPONSE_V1", {
      requestPath: new URL(request.url).pathname,
      authUserPresent: true,
      remoteRoleResolved: auth.validation.accessRole,
      roleSource: "SUPABASE_AUTH_GET_USER_APP_METADATA",
      sessionValid: true,
      currentLiveCount,
      persistedActiveCount,
      canonicalExceptionCount:
        dashboard.feedTrace.commercialExceptionCount,
      taskCountBeforeAcl:
        dashboard.feedTrace.remoteTaskCandidateCountBeforeAcl,
      taskCountAfterAcl: dashboard.feedTrace.remoteTaskCountAfterAcl,
      taskCountInResponse: dashboard.taskListings.length,
      falseZeroRetry,
      responseSchema: dashboard.deliveryTrace.responseSchema,
      serverToClientCountParity:
        dashboard.deliveryTrace.serverToClientCountParity,
      piiIncluded: false,
      marketplaceWrites: 0,
    })
    const response = NextResponse.json({ success: true,
      accessRole: auth.validation.accessRole, dashboard })
    response.headers.set("Cache-Control", "private, no-store")
    response.headers.set("X-Seller-OS-Remote-Feed-Contract",
      dashboard.contractVersion)
    response.headers.set("X-Seller-OS-Remote-Task-Count",
      String(dashboard.taskListings.length))
    return response
  } catch (error) {
    console.warn("REMOTE_OPERATOR_SESSION_FEED_FAILURE_V1", {
      requestPath: new URL(request.url).pathname,
      authUserPresent: true,
      remoteRoleResolved: auth.validation.accessRole,
      roleSource: "SUPABASE_AUTH_GET_USER_APP_METADATA",
      sessionValid: true,
      errorCode: safeCode(error),
      piiIncluded: false,
      marketplaceWrites: 0,
    })
    return NextResponse.json({ success: false, error: safeCode(error),
      operatorMessage:
        "Esta vista no está disponible ahora. No necesitas hacer nada." },
    { status: 503, headers: { "Cache-Control": "private, no-store" } })
  }
}

export async function POST(request: Request) {
  const auth = await authorizedRequest(request)
  if (!auth.accepted) return NextResponse.json({ success: false,
    error: auth.validation.error ?? "seller_os_forbidden" },
  { status: auth.validation.status || 403 })
  if (boundaryBlocked(request)) return NextResponse.json({ success: false,
    error: "REMOTE_LIVE_OPTIMIZATION_DEDICATED_PREPROD_ONLY" },
  { status: 403 })
  const body = await jsonBody(request)
  const action = typeof body?.action === "string" ? body.action : ""
  if (action === "READ_AUTONOMOUS_RESEARCH_ACQUISITION") {
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const result = await readMayelAutonomousResearchAcquisitionV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
      })
      return NextResponse.json({ success: true, result,
        safety: { marketplaceWrites: 0, priceWrites: 0 } },
      { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error) },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "CLAIM_AUTONOMOUS_RESEARCH_PLAN") {
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const result = await claimMayelAutonomousResearchPlanV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
        workerId: body?.workerId, workerCapability: body?.workerCapability,
        planId: body?.planId,
      })
      return NextResponse.json({ success: true, result,
        safety: { marketplaceWrites: 0, priceWrites: 0 } },
      { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error) },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "RELEASE_AUTONOMOUS_RESEARCH_PLAN") {
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const result = await releaseMayelAutonomousResearchPlanV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
        workerId: body?.workerId, planId: body?.planId,
        errorCode: body?.errorCode,
      })
      return NextResponse.json({ success: true, result,
        safety: { marketplaceWrites: 0, priceWrites: 0 } },
      { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error) },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "READ_MARKET_REVALIDATION_STATUS") {
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const result = await readMayelLiveMarketRevalidationStatusV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
        itemId: body?.ebayItemId,
      })
      return NextResponse.json({ success: true, result,
        safety: { marketplaceWrites: 0, priceWrites: 0 } },
      { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error) },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "START_MARKET_REVALIDATION") {
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const result = await startMayelLiveMarketRevalidationV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
        actorId: auth.validation.userId,
        itemId: body?.ebayItemId,
        idempotencyKey: request.headers.get("Idempotency-Key"),
      })
      return NextResponse.json({ success: true, result,
        safety: { marketplaceWrites: 0, priceWrites: 0,
          promotionWrites: 0, sendOffers: 0, buyerMessages: 0 } },
      { headers: { "Cache-Control": "private, no-store",
        "X-Seller-OS-Mayel-Market-Revalidation": "RESEARCH_REQUIRED" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error),
        operatorMessage:
          "No pude iniciar la investigación automática. No se cambió nada en eBay." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "READ_MARKET_REVALIDATION_PLAN") {
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const result = await readMayelLiveMarketRevalidationPlanV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
        planId: body?.planId,
      })
      return NextResponse.json({ success: true, result,
        safety: { marketplaceWrites: 0, priceWrites: 0 } },
      { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error) },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "COMPLETE_MARKET_REVALIDATION") {
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const result = await completeMayelLiveMarketRevalidationV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
        actorId: auth.validation.userId, planId: body?.planId,
        capture: body?.productResearchCapture as never,
        soldRows: body?.mainSearchSoldRows,
        soldFilterAutomated: body?.soldFilterAutomated,
        paginationAutomated: body?.paginationAutomated,
        extensionMarketplaceWrites: body?.extensionMarketplaceWrites,
        workerId: body?.workerId,
        workerMetrics: body?.workerMetrics,
      })
      return NextResponse.json({ success: true, result,
        safety: { marketplaceWrites: 0, priceWrites: 0,
          promotionWrites: 0, sendOffers: 0, buyerMessages: 0 } },
      { headers: { "Cache-Control": "private, no-store",
        "X-Seller-OS-Mayel-Market-Revalidation": "COMPLETED" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error),
        operatorMessage:
          "La evidencia quedó protegida, pero Seller OS no pudo cerrar todavía la revalidación." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "RESUME_MARKET_REVALIDATION_DOWNSTREAM") {
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const result = await resumeMayelMarketRevalidationDownstreamV1({
        supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
        planId: body?.planId, workerId: body?.workerId,
      })
      return NextResponse.json({ success: true, result,
        safety: { marketplaceWrites: 0, priceWrites: 0,
          promotionWrites: 0, sendOffers: 0, buyerMessages: 0 } },
      { headers: { "Cache-Control": "private, no-store",
        "X-Seller-OS-Mayel-Market-Revalidation": "DOWNSTREAM_RESUMED" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error),
        operatorMessage:
          "La captura sigue guardada; Seller OS reintentará únicamente el tramo pendiente." },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "READ_EBAY_PROMOTION_RECOMMENDATION") {
    const ebayItemId = typeof body?.ebayItemId === "string" &&
      /^\d{9,20}$/.test(body.ebayItemId.trim())
      ? body.ebayItemId.trim() : null
    if (!ebayItemId) return NextResponse.json({ success: false,
      error: "MAYEL_EBAY_RECOMMENDATION_ITEM_ID_REQUIRED" }, { status: 400 })
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      const recommendation =
        await loadEbayPromotionRecommendationSafeExecutionV1({
          supabase: getSupabaseAdminClient(),
          accountKey: account.accountKey,
          ebayItemId,
        })
      return NextResponse.json({ success: true, recommendation,
        safety: { marketplaceWrites: 0, priceWrites: 0,
          promotionWrites: 0, sendOffers: 0, buyerMessages: 0 } },
      { headers: { "Cache-Control": "private, no-store",
        "X-Seller-OS-Mayel-Recommendation": "READ_ONLY" } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error),
        operatorMessage:
          "La recomendación oficial de eBay no está disponible ahora. La Estación visual sigue disponible.",
        safety: { marketplaceWrites: 0, priceWrites: 0,
          promotionWrites: 0, sendOffers: 0, buyerMessages: 0 } },
      { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
  }
  if (action === "REPORT_FEED_RENDER") {
    const view = ["HOME", "TASKS", "SUGGESTIONS"].includes(
      String(body?.view ?? "")) ? String(body?.view) : null
    const clientReceivedCount = telemetryCount(body?.clientReceivedCount)
    const clientPostFilterCount = telemetryCount(body?.clientPostFilterCount)
    const visibleRenderCount = telemetryCount(body?.visibleRenderCount)
    const serverGeneratedCount = telemetryCount(body?.serverGeneratedCount)
    const apiResponseCount = telemetryCount(body?.apiResponseCount)
    const contractVersion = body?.contractVersion ===
      REMOTE_LIVE_OPTIMIZATION_OPERATOR_VERSION
      ? REMOTE_LIVE_OPTIMIZATION_OPERATOR_VERSION : null
    if (!view || serverGeneratedCount === null ||
        apiResponseCount === null || clientReceivedCount === null ||
        clientPostFilterCount === null || visibleRenderCount === null ||
        !contractVersion || serverGeneratedCount !== apiResponseCount ||
        apiResponseCount !== clientReceivedCount) {
      return NextResponse.json({ success: false,
        error: "REMOTE_FEED_RENDER_TELEMETRY_INVALID" }, { status: 400 })
    }
    console.info("REMOTE_OPERATOR_CLIENT_RENDER_V1", {
      requestPath: new URL(request.url).pathname,
      authUserPresent: true,
      remoteRoleResolved: auth.validation.accessRole,
      roleSource: "SUPABASE_AUTH_GET_USER_APP_METADATA",
      sessionValid: true,
      contractVersion,
      view,
      serverGeneratedCount,
      apiResponseCount,
      clientReceivedCount,
      clientPostFilterCount,
      visibleRenderCount,
      piiIncluded: false,
      marketplaceWrites: 0,
    })
    return NextResponse.json({ success: true, recorded: true,
      safety: { marketplaceWrites: 0, listingMutations: 0,
        buyerMessages: 0, postsaleActions: 0 } },
    { headers: { "Cache-Control": "private, no-store" } })
  }
  if (action === "AUTHORIZE_SAFE_MUTATION_CANARY") {
    const expectedItemId = typeof body?.ebayItemId === "string" &&
      /^\d{9,20}$/.test(body.ebayItemId.trim()) ? body.ebayItemId.trim() : ""
    const expectedSourceSignalId = typeof body?.sourceSignalId === "string" &&
      /^[A-Za-z0-9._:-]{3,160}$/.test(body.sourceSignalId.trim())
      ? body.sourceSignalId.trim() : ""
    const expectedCurrentValue = exactTitleValue(body?.currentValue)
    const expectedProposedValue = exactTitleValue(body?.proposedValue)
    const expectedAuthorizationVersion = body?.authorizationVersion ===
      REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION
      ? REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION : null
    const expectedAuthorizationDigest = authorizationDigest(
      body?.authorizationDigest,
    )
    if (auth.validation.accessRole !== SELLER_OS_ACCESS_ROLES.owner ||
        !expectedItemId || !expectedSourceSignalId || !expectedCurrentValue ||
        !expectedProposedValue || !expectedAuthorizationVersion ||
        !expectedAuthorizationDigest) {
      return NextResponse.json({ success: false,
        error: "REMOTE_OPERATOR_CANARY_OWNER_AUTHORITY_REQUIRED" },
      { status: 403 })
    }
    console.info("REMOTE_OPERATOR_OWNER_AUTHORIZATION_REQUEST_V1", {
      requestPath: new URL(request.url).pathname,
      authUserPresent: true,
      ownerAuthValid: true,
      ownerRoleResolved: auth.validation.accessRole,
      roleSource: "SUPABASE_AUTH_GET_USER_APP_METADATA",
      ebayItemId: expectedItemId,
      authorizationDigest: expectedAuthorizationDigest,
      idempotencyKeyPresent: true,
      authorizationVersion: expectedAuthorizationVersion,
      piiIncluded: false,
      marketplaceWrites: 0,
      listingMutations: 0,
    })
    let candidateRefreshAttempted = false
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) {
        throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      }
      const accountKey = account.accountKey
      const supabase = getSupabaseAdminClient()
      const operatorUserId = await resolveRemoteOperatorUserIdV1(supabase)
      if (!operatorUserId) {
        throw new Error("REMOTE_OPERATOR_ACCOUNT_REQUIRED")
      }
      const authorizeFromMonitor = (monitor: Awaited<ReturnType<
        typeof loadSellerOsAssistantMonitorSnapshotV1>>) =>
        authorizeRemoteOperatorSafeMutationCanaryV1({
          supabase,
          accountKey,
          listings: currentLiveListingsForMonitorV1(monitor),
          commercialExceptions: buildProactiveExceptionQueueV1({
            monitor, maximumEntries: 250,
          }),
          ownerUserId: auth.validation.userId,
          operatorUserId,
          expectedItemId,
          expectedSourceSignalId,
          expectedCurrentValue,
          expectedProposedValue,
          expectedAuthorizationVersion,
          expectedAuthorizationDigest,
          executionEnabled: titleCanaryEnabled(),
        })
      let authorization
      try {
        authorization = await authorizeFromMonitor(
          await loadSellerOsAssistantMonitorSnapshotV1(),
        )
      } catch (error) {
        if (safeCode(error) !==
            "REMOTE_OPERATOR_CANARY_CURRENT_CANDIDATE_REQUIRED") throw error
        candidateRefreshAttempted = true
        authorization = await authorizeFromMonitor(
          await loadSellerOsAssistantMonitorV1(),
        )
      }
      const canary = authorization.candidate
      console.info("REMOTE_OPERATOR_OWNER_AUTHORIZATION_RESULT_V1", {
        requestPath: new URL(request.url).pathname,
        ownerAuthValid: true,
        ownerRoleResolved: auth.validation.accessRole,
        ebayItemId: expectedItemId,
        authorizationDigest: expectedAuthorizationDigest,
        idempotencyKeyPresent: true,
        candidateRefreshAttempted,
        databaseWriteAttempted: authorization.databaseWriteAttempted,
        databaseWriteResult: authorization.databaseWriteResult,
        durableReadbackPass: authorization.durableReadbackPass,
        exactAuthorizationRowCount: 1,
        piiIncluded: false,
        marketplaceWrites: 0,
        listingMutations: 0,
      })
      return NextResponse.json({ success: true,
        outcome: "OWNER_AUTHORIZED_SAFE_TITLE_CANARY",
        canary,
        message:
          "Mejora autorizada para Mayel. Todavía no se aplicó ningún cambio.",
        safety: { marketplaceWrites: 0, listingMutations: 0,
          promotionWrites: 0, listingEnds: 0 } })
    } catch (error) {
      const errorCode = safeCode(error)
      console.warn("REMOTE_OPERATOR_OWNER_AUTHORIZATION_FAILURE_V1", {
        requestPath: new URL(request.url).pathname,
        ownerAuthValid: true,
        ownerRoleResolved: auth.validation.accessRole,
        ebayItemId: expectedItemId,
        authorizationDigest: expectedAuthorizationDigest,
        idempotencyKeyPresent: true,
        candidateRefreshAttempted,
        databaseWriteAttempted: errorCode ===
          "REMOTE_OPERATOR_CANARY_CURRENT_CANDIDATE_REQUIRED" ? false
          : "UNCONFIRMED",
        errorCode,
        piiIncluded: false,
        marketplaceWrites: 0,
        listingMutations: 0,
      })
      return NextResponse.json({ success: false, error: errorCode,
        operatorMessage:
          "No se pudo autorizar esta mejora. No se aplicó ningún cambio." },
      { status: 409 })
    }
  }
  if (action === "APPLY_SAFE_MUTATION_CANARY") {
    const authorizationId = uuid(body?.authorizationId)
    const key = idempotencyKey(body?.idempotencyKey)
    const expectedItemId = typeof body?.ebayItemId === "string" &&
      /^\d{9,20}$/.test(body.ebayItemId) ? body.ebayItemId : null
    const expectedCurrentValue = exactTitleValue(body?.currentValue)
    const expectedProposedValue = exactTitleValue(body?.proposedValue)
    const expectedAuthorizationVersion = body?.authorizationVersion ===
      REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION
      ? REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_VERSION : null
    const expectedAuthorizationDigest = authorizationDigest(
      body?.authorizationDigest,
    )
    if (auth.validation.accessRole !==
        SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator ||
        !authorizationId || !key || !expectedItemId ||
        !expectedCurrentValue || !expectedProposedValue ||
        !expectedAuthorizationVersion || !expectedAuthorizationDigest) {
      return NextResponse.json({ success: false,
        error: "REMOTE_OPERATOR_CANARY_APPLY_INVALID" }, { status: 400 })
    }
    if (!titleCanaryEnabled()) {
      return NextResponse.json({ success: false,
        error: "REMOTE_OPERATOR_CANARY_PHYSICAL_ENABLEMENT_REQUIRED",
        operatorMessage:
          "Esta acción todavía no está habilitada. No necesitas hacer nada." },
      { status: 423 })
    }
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) {
        throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      }
      const supabase = getSupabaseAdminClient()
      const result = await applyRemoteOperatorSafeMutationCanaryV1({
        supabase,
        accountKey: account.accountKey,
        operatorUserId: auth.validation.userId,
        authorizationId,
        idempotencyKey: key,
        expectedItemId,
        expectedCurrentValue,
        expectedProposedValue,
        expectedAuthorizationVersion,
        expectedAuthorizationDigest,
        executionEnabled: true,
      })
      const verified = result.titleVerified === true
      const verifying = ["write_in_flight", "write_acknowledged",
        "outcome_unknown"].includes(result.phase)
      return NextResponse.json({ success: verified || verifying,
        outcome: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED" :
          result.phase === "outcome_unknown" ? "VERIFYING_DO_NOT_RETRY" :
            result.phase === "write_in_flight" ?
              "APPLYING_DO_NOT_DOUBLE_TAP" : "NOT_APPLIED",
        operatorMessage: verified
          ? "Cambio confirmado ✓"
          : verifying
            ? "Estamos verificando el cambio. No vuelvas a pulsar."
            : result.safeFailureMessage ??
              "No se aplicó el cambio. El listing permanece sin cambios confirmados.",
        result,
        postActionReadbackPass: verified,
        currentValuePreconditionMatch:
          result.currentValuePreconditionMatch,
        unknownResultAutoRetry: false,
        safety: { listingEnds: 0, promotionWrites: 0,
          ebayWriteAttemptCount: result.ebayWriteAttemptCount } },
      { status: verified ? 200 : verifying ? 202 : 409 })
    } catch (error) {
      const code = safeCode(error)
      const invalidated = code ===
        "REMOTE_OPERATOR_CANARY_AUTHORIZATION_INVALIDATED"
      return NextResponse.json({ success: false, error: code,
        operatorMessage: invalidated
          ? "La autorización ya no es válida porque el título actual cambió. No se aplicó ningún cambio."
          : code.includes("OUTCOME_UNKNOWN") ||
          code.includes("WRITE_IN_PROGRESS")
          ? "Estamos verificando el cambio. No vuelvas a pulsar."
          : "Esta acción no está disponible ahora. No necesitas hacer nada.",
        authorizationInvalidated: invalidated,
        executionBlocked: invalidated,
        currentValuePreconditionMatch: invalidated ? false : null,
        unknownResultAutoRetry: false,
        safety: { marketplaceWrites: invalidated ? 0 : null, listingEnds: 0,
          promotionWrites: 0 } }, { status: 409 })
    }
  }
  if (action === "REVIEW_IMAGE_PROPOSAL") {
    const proposalId = uuid(body?.proposalId)
    const decision = body?.decision === "APPROVE" ||
      body?.decision === "REJECT" ? body.decision : null
    if (!proposalId || !decision || auth.validation.accessRole !==
        SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator) {
      return NextResponse.json({ success: false,
        error: "REMOTE_OPERATOR_IMAGE_REVIEW_INVALID" }, { status: 400 })
    }
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) {
        throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      }
      const supabase = getSupabaseAdminClient()
      const proposals = await readRemoteOperatorPreparedImageProposalsV1({
        supabase, accountKey: account.accountKey,
        operatorUserId: auth.validation.userId,
      })
      const proposal = proposals.find((row) =>
        row.proposalId === proposalId)
      if (!proposal) {
        throw new Error("REMOTE_OPERATOR_IMAGE_PROPOSAL_NOT_FOUND")
      }
      const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
      const listing = currentLiveListingsForMonitorV1(monitor).find((row) =>
        row.identity.itemId === proposal.ebayItemId)
      const exactLiveIdentity = Boolean(listing &&
        listing.discovery.livePresence.status === "LIVE_ACTIVE" &&
        listing.discovery.livePresence.source ===
          "EBAY_TRADING_GET_MY_EBAY_SELLING" &&
        listing.identity.marketplaceCertification.status === "US_CERTIFIED" &&
        /^\d{9,20}$/.test(listing.identity.itemId) &&
        isProvenSupplierLinkageV1(listing.stock))
      if (!exactLiveIdentity) {
        throw new Error("REMOTE_OPERATOR_IMAGE_REVIEW_GUARDS_REQUIRED")
      }
      const review = await recordRemoteOperatorImageReviewV1({
        supabase, accountKey: account.accountKey,
        operatorUserId: auth.validation.userId, proposal, decision,
      })
      return NextResponse.json({ success: true,
        outcome: "IMAGE_PROPOSAL_REVIEW_RECORDED", review,
        message: decision === "APPROVE"
          ? "Propuesta aprobada para el siguiente paso. No se publicó ningún cambio."
          : "Propuesta rechazada. No se publicó ningún cambio.",
        safety: { marketplaceWrites: 0, newListingPublications: 0,
          listingEnds: 0, promotionWrites: 0 } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error),
        operatorMessage:
          "No pude guardar esta revisión. No se publicó ningún cambio." },
      { status: 409 })
    }
  }
  const eventId = uuid(body?.eventId)
  const key = idempotencyKey(body?.idempotencyKey)
  if (!body || !eventId || !["PREPARE_SAFE_LIVE_CHANGE",
    "APPLY_SAFE_LIVE_CHANGE", "ESCALATE_OWNER"].includes(action)) {
    return NextResponse.json({ success: false,
      error: "REMOTE_LIVE_OPTIMIZATION_ACTION_INVALID" }, { status: 400 })
  }
  if (action !== "ESCALATE_OWNER" && !liveMutationEnabled()) {
    return NextResponse.json({ success: false,
      error: "REMOTE_LIVE_MUTATION_PHYSICAL_CERTIFICATION_REQUIRED",
      operatorMessage:
        "Esta acción no está disponible ahora. No necesitas hacer nada." },
    { status: 423 })
  }
  try {
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    if (!await currentOptimizationTask(eventId)) {
      throw new Error("REMOTE_OPERATOR_CURRENT_TASK_REQUIRED")
    }
    const supabase = getSupabaseAdminClient()
    const inspected = await inspectEbayCommercialImprovement({ supabase,
      accountKey: account.accountKey, eventId })
    if (action === "ESCALATE_OWNER" ||
        inspected.actionType !== "PRICE") {
      return NextResponse.json({ success: true,
        outcome: "OWNER_APPROVAL_REQUIRED",
        ownerEscalationAlreadyVisibleInCanonicalDashboard: true,
        actionType: inspected.actionType,
        message: inspected.actionType === "PROMOTED_LISTINGS_GENERAL"
          ? "Este producto podría recibir más visibilidad. Necesita aprobación del owner."
          : "Esta decisión corresponde exclusivamente al owner.",
        safety: { marketplaceWrites: 0, listingEnds: 0,
          promotionWrites: 0, executionLedgerClaimed: false } })
    }
    if (!inspected.exactSupplierIdentityAvailable) {
      throw new Error("REMOTE_OPERATOR_PRODUCT_TRUTH_SUPPORT_REQUIRED")
    }
    if (!key) return NextResponse.json({ success: false,
      error: "REMOTE_OPERATOR_IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 })
    const common = { supabase, accountKey: account.accountKey,
      actorId: auth.validation.userId, eventId, idempotencyKey: key }
    if (action === "PREPARE_SAFE_LIVE_CHANGE") {
      const preview = await prepareEbayCommercialImprovement(common)
      return NextResponse.json({ success: true, outcome: "PREVIEW_READY",
        preview,
        guards: { exactListingIdentity: true, productTruthSupported: true,
          currentLiveReadbackRequired: true,
          actionWithinOperatorAuthority: preview.actionType === "PRICE" },
        safety: { marketplaceWrites: 0, listingEnds: 0,
          promotionWrites: 0 } })
    }
    if (body.confirmed !== true) return NextResponse.json({ success: false,
      error: "REMOTE_OPERATOR_EXPLICIT_CONFIRMATION_REQUIRED" },
    { status: 409 })
    const result = await applyEbayCommercialImprovement({ ...common,
      confirmation: COMMERCIAL_IMPROVEMENT_CONFIRMATION })
    const verified = result.appliedVerified === true
    return NextResponse.json({ success: verified,
      outcome: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED" :
        result.phase === "outcome_unknown" ? "VERIFYING_DO_NOT_RETRY" :
          "NOT_APPLIED",
      result,
      postActionReadbackPass: verified,
      unknownResultAutoRetry: false,
      safety: { listingEnds: 0, promotionWrites: 0,
        ebayWriteAttemptCount: result.ebayWriteAttemptCount } },
    { status: verified ? 200 : 409 })
  } catch (error) {
    const code = safeCode(error)
    return NextResponse.json({ success: false, error: code,
      operatorMessage: code.includes("OUTCOME_UNKNOWN")
        ? "Estamos verificando el cambio. No vuelvas a pulsar."
        : "Esta acción no está disponible ahora. No necesitas hacer nada.",
      unknownResultAutoRetry: false }, { status: 409 })
  }
}
