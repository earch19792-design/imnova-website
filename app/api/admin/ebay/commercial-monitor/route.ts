export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  COMMERCIAL_MONITOR_LANES,
  getEbayCommercialMonitorDashboard,
  recordSellerHubListingEvidence,
  runEbayCommercialMonitor,
  updateCommercialThresholds,
  type CommercialMonitorLane,
} from "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { getEbayCommercialOAuthPreflight } from "@/lib/ebay/ebay-commercial-oauth"
import {
  compareEbayCommercialAnalyticsWithSellerHub,
} from "@/lib/ebay/ebay-commercial-analytics-reconciliation"
import { getEbayReadonlyRateLimitMetadata } from "@/lib/ebay/ebay-readonly-rate-limit"
import {
  applyEbayCommercialImprovement,
  prepareEbayCommercialImprovement,
} from "@/lib/ebay/ebay-commercial-improvement-action-service"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : "COMMERCIAL_MONITOR_REQUEST_FAILED"
}

function safeRateLimit(error: unknown) {
  const direct = getEbayReadonlyRateLimitMetadata(error)
  const durable = error && typeof error === "object" && "quotaPause" in error
    ? (error as { quotaPause?: unknown }).quotaPause
    : null
  const pause = durable && typeof durable === "object" && !Array.isArray(durable)
    ? durable as Record<string, unknown>
    : null
  if (!direct && pause?.httpStatus !== 429) return null
  const retryAfterSeconds = direct?.retryAfterSeconds ??
    (typeof pause?.retryAfterSeconds === "number" && Number.isFinite(pause.retryAfterSeconds)
      ? Math.max(0, Math.floor(pause.retryAfterSeconds))
      : null)
  const resumeAt = typeof pause?.resumeAt === "string" && Number.isFinite(Date.parse(pause.resumeAt))
    ? pause.resumeAt
    : direct && retryAfterSeconds !== null
      ? new Date(Date.parse(direct.observedAt) + retryAfterSeconds * 1_000).toISOString()
      : null
  return {
    httpStatus: 429 as const,
    retryAfterSeconds,
    resumeAt,
    affectedLane: typeof pause?.affectedLane === "string" ? pause.affectedLane : null,
  }
}

async function body(req: Request) {
  try {
    const value = await req.json()
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function lanes(value: unknown): CommercialMonitorLane[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((lane): lane is CommercialMonitorLane =>
        typeof lane === "string" &&
        COMMERCIAL_MONITOR_LANES.includes(lane as CommercialMonitorLane)
      ))]
    : [...COMMERCIAL_MONITOR_LANES]
}

function productionBlocked() {
  return process.env.VERCEL_ENV === "production"
}

function uuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (productionBlocked()) return NextResponse.json({
    success: false,
    error: "COMMERCIAL_MONITOR_PREVIEW_ONLY",
    safety: { productionUnchanged: true, ebayWriteUsed: false },
  }, { status: 403 })
  try {
    return NextResponse.json({
      success: true,
      dashboard: await getEbayCommercialMonitorDashboard(getSupabaseAdminClient()),
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  if (productionBlocked()) return NextResponse.json({
    success: false,
    error: "COMMERCIAL_MONITOR_PREVIEW_ONLY",
    safety: { productionUnchanged: true, ebayWriteUsed: false },
  }, { status: 403 })
  const input = await body(req)
  if (!input) return NextResponse.json(
    { success: false, error: "COMMERCIAL_MONITOR_INVALID_JSON" },
    { status: 400 },
  )
  try {
    const supabase = getSupabaseAdminClient()
    if (input.action === "authorize_scheduler") {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      const dryRunId = uuid(input.dryRunId)
      const requestedMinutes = Number(input.durationMinutes ?? 60)
      if (!accountKey || !validation.userId || !dryRunId || input.confirmed !== true ||
        !Number.isInteger(requestedMinutes) || requestedMinutes < 5 || requestedMinutes > 1_440) {
        return NextResponse.json({ success: false, error: "COMMERCIAL_MONITOR_SCHEDULER_AUTHORIZATION_INVALID" }, { status: 400 })
      }
      const { data, error } = await supabase.rpc("authorize_commercial_monitor_scheduler", {
        p_marketplace_account_key: accountKey, p_marketplace: "EBAY_US", p_dry_run_id: dryRunId,
        p_authorized_by: validation.userId, p_authorization_seconds: requestedMinutes * 60,
        p_max_dry_run_age_seconds: 1_800,
      })
      if (error) {
        const code = error.message.match(/COMMERCIAL_MONITOR_SCHEDULER_[A-Z0-9_]+/)?.[0] ??
          "COMMERCIAL_MONITOR_SCHEDULER_AUTHORIZATION_FAILED"
        throw new Error(code)
      }
      const authorization = Array.isArray(data) ? data[0] : data
      return NextResponse.json({ success: true, action: "authorize_scheduler",
        authorization: { status: "ACTIVE", authorizedAt: authorization?.authorized_at ?? null,
          expiresAt: authorization?.expires_at ?? null, actorRecorded: true, credentialsReturned: false },
        dashboard: await getEbayCommercialMonitorDashboard(supabase),
        safety: { externalReadersStarted: false, whatsappAttempted: false, ebayWrites: 0, productionChanged: false } })
    }
    if (input.action === "revoke_scheduler") {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey || !validation.userId || input.confirmed !== true) {
        return NextResponse.json({ success: false, error: "COMMERCIAL_MONITOR_SCHEDULER_REVOCATION_INVALID" }, { status: 400 })
      }
      const { data, error } = await supabase.rpc("revoke_commercial_monitor_scheduler_authorization", {
        p_marketplace_account_key: accountKey, p_marketplace: "EBAY_US", p_revoked_by: validation.userId,
      })
      if (error) throw new Error("COMMERCIAL_MONITOR_SCHEDULER_REVOCATION_FAILED")
      return NextResponse.json({ success: true, action: "revoke_scheduler", revoked: data === true,
        dashboard: await getEbayCommercialMonitorDashboard(supabase),
        safety: { schedulerAuthorized: false, whatsappAttempted: false, ebayWrites: 0, productionChanged: false } })
    }
    if (input.action === "update_thresholds") {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
      const version = typeof input.version === "string" ? input.version.trim() : ""
      const thresholds = await updateCommercialThresholds(supabase, {
        marketplaceAccountKey: accountKey,
        version,
        thresholds: input.thresholds,
        userId: validation.userId,
      })
      return NextResponse.json({ success: true, action: "update_thresholds", thresholds })
    }
    if (input.action === "oauth_preflight") {
      return NextResponse.json({
        success: true,
        action: "oauth_preflight",
        preflight: await getEbayCommercialOAuthPreflight(),
      })
    }
    if (input.action === "compare_seller_hub") {
      return NextResponse.json({
        success: true,
        action: "compare_seller_hub",
        comparison: await compareEbayCommercialAnalyticsWithSellerHub({
          listingId: "366543596425",
        }),
      })
    }
    if (input.action === "record_seller_hub_listing_evidence") {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
      const evidence = await recordSellerHubListingEvidence(supabase, {
        marketplaceAccountKey: accountKey,
        evidence: input.evidence && typeof input.evidence === "object" &&
            !Array.isArray(input.evidence)
          ? input.evidence as Record<string, unknown>
          : {},
        userId: validation.userId,
      })
      return NextResponse.json({
        success: true,
        action: "record_seller_hub_listing_evidence",
        evidence,
        dashboard: await getEbayCommercialMonitorDashboard(supabase),
      })
    }
    if (input.action === "prepare_improvement" || input.action === "apply_improvement") {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      const eventId = uuid(input.eventId)
      const idempotencyKey = typeof input.idempotencyKey === "string"
        ? input.idempotencyKey.trim() : ""
      if (!accountKey || !validation.userId || !eventId ||
        !/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
        return NextResponse.json({ success: false,
          error: "COMMERCIAL_IMPROVEMENT_REQUEST_INVALID" }, { status: 400 })
      }
      const common = { supabase, accountKey, actorId: validation.userId,
        eventId, idempotencyKey }
      const improvement = input.action === "prepare_improvement"
        ? await prepareEbayCommercialImprovement(common)
        : await applyEbayCommercialImprovement({
            ...common,
            confirmation: typeof input.confirmation === "string"
              ? input.confirmation : "",
          })
      return NextResponse.json({ success: true, action: input.action,
        improvement })
    }
    if (input.action !== "run") {
      return NextResponse.json(
        { success: false, error: "COMMERCIAL_MONITOR_ACTION_INVALID" },
        { status: 400 },
      )
    }
    const dryRunId = typeof input.dryRunId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.dryRunId)
      ? input.dryRunId
      : undefined
    if (input.dryRun !== true && !dryRunId) {
      return NextResponse.json(
        { success: false, error: "COMMERCIAL_DRY_RUN_GATE_REQUIRED" },
        { status: 409 },
      )
    }
    const result = await runEbayCommercialMonitor(supabase, {
      triggerSource: input.dryRun === true ? "dry_run" : "manual",
      lanes: lanes(input.lanes),
      workerId: `commercial-manual:${validation.userId ?? "service"}:${randomUUID()}`,
      dispatchWhatsApp: true,
      dryRunWhatsApp: input.dryRun === true || process.env.VERCEL_ENV !== "preview",
      authorizedDryRunId: input.dryRun === true ? undefined : dryRunId,
    })
    const dashboard = await getEbayCommercialMonitorDashboard(supabase)
    return NextResponse.json({ success: true, run: result, dashboard })
  } catch (error) {
    const code = safeCode(error)
    const rateLimit = safeRateLimit(error)
    return NextResponse.json(
      { success: false, error: rateLimit ? "EBAY_READONLY_GET_429" : code, ...(rateLimit ? { rateLimit } : {}) },
      {
        status: rateLimit?.httpStatus ?? (code === "COMMERCIAL_MONITOR_ALREADY_RUNNING" ? 409 : 502),
        ...(rateLimit?.retryAfterSeconds !== null && rateLimit?.retryAfterSeconds !== undefined
          ? { headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
          : {}),
      },
    )
  }
}
