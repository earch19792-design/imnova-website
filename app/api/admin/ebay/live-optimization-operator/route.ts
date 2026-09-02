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
  remoteLiveOptimizationTasksV1,
} from "@/lib/ebay/ebay-remote-live-optimization-operator-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { loadSellerOsAssistantMonitorSnapshotV1 } from
  "@/lib/ebay/ebay-seller-os-assistant-runtime"
import { buildSellerOsCurrentLiveVisualQualityV1 } from
  "@/lib/ebay/ebay-seller-os-visual-quality-v1"
import { buildProactiveExceptionQueueV1 } from
  "@/lib/ebay/ebay-seller-os-portfolio-intelligence-v1"
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
    const [monitor, commercialDashboard, salesResults, executions,
      imageProposals, listingQualitySignals] =
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
      ])
    if (executions.error) {
      throw new Error("COMMERCIAL_IMPROVEMENT_LEDGER_READ_FAILED")
    }
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
      safeMutationCanary,
      improvementExecutions: executions.data ?? [],
      operatorUserId: auth.validation.userId,
      remoteScopeAuthorized: [SELLER_OS_ACCESS_ROLES.owner,
        SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator]
        .includes(auth.validation.accessRole),
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
  if (action === "AUTHORIZE_SAFE_MUTATION_CANARY") {
    const expectedItemId = typeof body?.ebayItemId === "string" &&
      /^\d{9,20}$/.test(body.ebayItemId.trim()) ? body.ebayItemId.trim() : ""
    const expectedSourceSignalId = typeof body?.sourceSignalId === "string" &&
      /^[A-Za-z0-9._:-]{3,160}$/.test(body.sourceSignalId.trim())
      ? body.sourceSignalId.trim() : ""
    if (auth.validation.accessRole !== SELLER_OS_ACCESS_ROLES.owner ||
        !expectedItemId || !expectedSourceSignalId) {
      return NextResponse.json({ success: false,
        error: "REMOTE_OPERATOR_CANARY_OWNER_AUTHORITY_REQUIRED" },
      { status: 403 })
    }
    try {
      const account = getEbaySellerAccountScopeConfiguration()
      if (!account.accountKey) {
        throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
      }
      const supabase = getSupabaseAdminClient()
      const operatorUserId = await resolveRemoteOperatorUserIdV1(supabase)
      if (!operatorUserId) {
        throw new Error("REMOTE_OPERATOR_ACCOUNT_REQUIRED")
      }
      const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
      const commercialExceptions = buildProactiveExceptionQueueV1({
        monitor, maximumEntries: 250,
      })
      const canary = await authorizeRemoteOperatorSafeMutationCanaryV1({
        supabase,
        accountKey: account.accountKey,
        listings: currentLiveListingsForMonitorV1(monitor),
        commercialExceptions,
        ownerUserId: auth.validation.userId,
        operatorUserId,
        expectedItemId,
        expectedSourceSignalId,
        executionEnabled: titleCanaryEnabled(),
      })
      return NextResponse.json({ success: true,
        outcome: "OWNER_AUTHORIZED_SAFE_TITLE_CANARY",
        canary,
        message:
          "Canary autorizado. Mayel verá una sola acción preparada; todavía no se aplicó ningún cambio.",
        safety: { marketplaceWrites: 0, listingMutations: 0,
          promotionWrites: 0, listingEnds: 0 } })
    } catch (error) {
      return NextResponse.json({ success: false, error: safeCode(error),
        operatorMessage:
          "No se pudo autorizar este canary. No se aplicó ningún cambio." },
      { status: 409 })
    }
  }
  if (action === "APPLY_SAFE_MUTATION_CANARY") {
    const authorizationId = uuid(body?.authorizationId)
    const key = idempotencyKey(body?.idempotencyKey)
    if (auth.validation.accessRole !==
        SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator ||
        !authorizationId || !key) {
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
      const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
      const commercialExceptions = buildProactiveExceptionQueueV1({
        monitor, maximumEntries: 250,
      })
      const result = await applyRemoteOperatorSafeMutationCanaryV1({
        supabase,
        accountKey: account.accountKey,
        listings: currentLiveListingsForMonitorV1(monitor),
        commercialExceptions,
        operatorUserId: auth.validation.userId,
        authorizationId,
        idempotencyKey: key,
        executionEnabled: true,
      })
      const verified = result.titleVerified === true
      return NextResponse.json({ success: verified,
        outcome: verified ? "APPLIED_AND_OFFICIALLY_VERIFIED" :
          result.phase === "outcome_unknown" ? "VERIFYING_DO_NOT_RETRY" :
            result.phase === "write_in_flight" ?
              "APPLYING_DO_NOT_DOUBLE_TAP" : "NOT_APPLIED",
        result,
        postActionReadbackPass: verified,
        unknownResultAutoRetry: false,
        safety: { listingEnds: 0, promotionWrites: 0,
          ebayWriteAttemptCount: result.ebayWriteAttemptCount } },
      { status: verified ? 200 : 409 })
    } catch (error) {
      const code = safeCode(error)
      return NextResponse.json({ success: false, error: code,
        operatorMessage: code.includes("OUTCOME_UNKNOWN") ||
          code.includes("WRITE_IN_PROGRESS")
          ? "Estamos verificando el cambio. No vuelvas a pulsar."
          : "Esta acción no está disponible ahora. No necesitas hacer nada.",
        unknownResultAutoRetry: false }, { status: 409 })
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
