export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  getEbayFirstLunaQueueDashboard,
  processNextEbayFirstLunaBatch,
  recordEbayFirstLunaScanFailure,
  startEbayFirstLunaScan,
} from "@/lib/ebay/ebay-first-luna-scan-service"
import { getEbayReadonlyRateLimitMetadata } from "@/lib/ebay/ebay-readonly-rate-limit"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(value) ? value : "EBAY_LUNA_QUEUE_REQUEST_FAILED"
}

function batchResponse(action: string, run: unknown, batch: Record<string, unknown>) {
  if (batch.rateLimit) return NextResponse.json({
    success: false,
    action,
    run,
    batch,
    error: "EBAY_READONLY_GET_429",
    rateLimit: batch.rateLimit,
  }, { status: 429 })
  return NextResponse.json({ success: true, action, run, batch })
}

async function requireAdmin(req: Request) {
  const validation = await validateAdminApiRequest(req)
  return validation.ok
    ? null
    : NextResponse.json(
        { success: false, error: validation.error ?? "admin_forbidden" },
        { status: validation.status || 403 },
      )
}

export async function GET(req: Request) {
  const unauthorized = await requireAdmin(req)
  if (unauthorized) return unauthorized
  try {
    const dashboard = await getEbayFirstLunaQueueDashboard(getSupabaseAdminClient())
    return NextResponse.json({ success: true, dashboard })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeError(error) }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const unauthorized = await requireAdmin(req)
  if (unauthorized) return unauthorized
  const supabase = getSupabaseAdminClient()
  let runId = ""
  try {
    const body = record(await req.json())
    const action = typeof body.action === "string" ? body.action : ""
    if (action === "start") {
      const run = await startEbayFirstLunaScan(supabase, body.categoryIds)
      runId = run.id
      const batch = await processNextEbayFirstLunaBatch(supabase, run.id)
      return batchResponse(action, run, batch)
    }
    if (action === "restart_priority") {
      return NextResponse.json({
        success: false,
        error: "RESET_ALL_1513_BLOCKED",
        allowedActions: [
          "RETRY_FAILED_RETRYABLE",
          "RESUME_FROM_CHECKPOINT",
          "REPROCESS_STALE",
          "REANALYZE_AFFECTED",
        ],
      }, { status: 409 })
    }
    if (action === "preview_recovery") {
      const mode = typeof body.mode === "string" ? body.mode : ""
      if (!["RETRY_FAILED_RETRYABLE", "RESUME_FROM_CHECKPOINT", "REPROCESS_STALE", "REANALYZE_AFFECTED"].includes(mode)) {
        return NextResponse.json({ success: false, error: "RECOVERY_MODE_INVALID" }, { status: 400 })
      }
      let countQuery = supabase.from("ebay_seller_scan_tasks").select("id", { count: "exact", head: true })
      if (mode === "RETRY_FAILED_RETRYABLE") countQuery = countQuery.eq("status", "retry")
      else if (mode === "RESUME_FROM_CHECKPOINT") countQuery = countQuery.in("status", ["queued", "retry"])
      else if (mode === "REPROCESS_STALE") countQuery = countQuery.eq("status", "completed").lte("due_at", new Date().toISOString())
      else {
        const keys = Array.isArray(body.candidateKeys)
          ? body.candidateKeys.filter((value): value is string => typeof value === "string" && value.length <= 300).slice(0, 50)
          : []
        if (!keys.length) return NextResponse.json({ success: false, error: "AFFECTED_CANDIDATES_REQUIRED" }, { status: 400 })
        countQuery = countQuery.in("candidate_key", keys)
      }
      const { count, error: countError } = await countQuery
      if (countError) throw new Error("EBAY_RECOVERY_PREVIEW_FAILED")
      const taskCount = count ?? 0
      return NextResponse.json({
        success: true,
        action,
        preview: {
          mode,
          taskCount,
          estimatedBrowseCalls: { minimum: taskCount, maximum: taskCount * 3 },
          resetAll1513Allowed: false,
          executionPerformed: false,
        },
      })
    }
    if (["RETRY_FAILED_RETRYABLE", "RESUME_FROM_CHECKPOINT", "REPROCESS_STALE", "REANALYZE_AFFECTED"].includes(action)) {
      if (action !== "RESUME_FROM_CHECKPOINT") {
        const pausedAt = new Date().toISOString()
        const { error: pauseError } = await supabase
          .from("ebay_luna_scan_runs")
          .update({ status: "paused", last_batch_at: pausedAt })
          .eq("status", "running")
        if (pauseError) throw new Error("EBAY_LUNA_SCAN_RESTART_FAILED")
      }
      const run = await startEbayFirstLunaScan(supabase, body.categoryIds, {
        forceDue: action === "REPROCESS_STALE",
        triggerSource: "recovery",
        reconcileTasks: action === "REPROCESS_STALE",
      })
      runId = run.id
      const batch = await processNextEbayFirstLunaBatch(supabase, run.id)
      return batchResponse(action, run, batch)
    }
    if (action === "process_next") {
      runId = typeof body.runId === "string" ? body.runId : ""
      if (!/^[0-9a-f-]{36}$/i.test(runId)) {
        return NextResponse.json(
          { success: false, error: "EBAY_LUNA_SCAN_RUN_ID_REQUIRED" },
          { status: 400 },
        )
      }
      const batch = await processNextEbayFirstLunaBatch(supabase, runId)
      return batchResponse(action, null, batch)
    }
    return NextResponse.json(
      { success: false, error: "EBAY_LUNA_QUEUE_ACTION_INVALID" },
      { status: 400 },
    )
  } catch (error) {
    if (runId) await recordEbayFirstLunaScanFailure(supabase, runId, error).catch(() => undefined)
    const rateLimit = getEbayReadonlyRateLimitMetadata(error)
    return NextResponse.json({
      success: false,
      error: safeError(error),
      ...(rateLimit ? { rateLimit } : {}),
    }, { status: rateLimit?.httpStatus ?? 502 })
  }
}
