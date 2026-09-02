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
import { getEbayCommercialMonitorDashboard } from
  "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbayProRuntimeBoundary } from
  "@/lib/ebay/environment-boundaries"
import {
  buildRemoteLiveOptimizationOperatorV1,
  readRemoteLiveOperatorSalesResultsV1,
  remoteLiveOptimizationTasksV1,
} from "@/lib/ebay/ebay-remote-live-optimization-operator-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { loadSellerOsAssistantMonitorSnapshotV1 } from
  "@/lib/ebay/ebay-seller-os-assistant-runtime"
import { buildSellerOsCurrentLiveVisualQualityV1 } from
  "@/lib/ebay/ebay-seller-os-visual-quality-v1"
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
    const [monitor, commercialDashboard, salesResults, executions] =
      await Promise.all([
        monitorPromise,
        getEbayCommercialMonitorDashboard(supabase),
        readRemoteLiveOperatorSalesResultsV1({ supabase,
          accountKey: account.accountKey }),
        supabase.from("ebay_commercial_improvement_executions")
          .select("commercial_event_id,phase,action_type,applied_verified_at,last_error_code")
          .eq("marketplace_account_key", account.accountKey)
          .order("created_at", { ascending: false }).limit(50),
      ])
    if (executions.error) {
      throw new Error("COMMERCIAL_IMPROVEMENT_LEDGER_READ_FAILED")
    }
    const visual = await visualQuality(monitor)
    const dashboard = buildRemoteLiveOptimizationOperatorV1({
      monitor,
      commercialDashboard,
      visualQuality: visual,
      salesResults,
      improvementExecutions: executions.data ?? [],
      liveMutationEnabled: liveMutationEnabled(),
    })
    const response = NextResponse.json({ success: true,
      accessRole: auth.validation.accessRole, dashboard })
    response.headers.set("Cache-Control", "private, no-store")
    return response
  } catch (error) {
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
          ? "Esta promoción necesita aprobación del owner porque aumenta el gasto."
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
