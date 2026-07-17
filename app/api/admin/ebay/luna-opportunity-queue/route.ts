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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(value) ? value : "EBAY_LUNA_QUEUE_REQUEST_FAILED"
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
      return NextResponse.json({ success: true, action, run, batch })
    }
    if (action === "restart_priority") {
      const pausedAt = new Date().toISOString()
      const { error: pauseError } = await supabase
        .from("ebay_luna_scan_runs")
        .update({ status: "paused", last_batch_at: pausedAt })
        .eq("status", "running")
      if (pauseError) throw new Error("EBAY_LUNA_SCAN_RESTART_FAILED")
      const run = await startEbayFirstLunaScan(supabase, body.categoryIds)
      runId = run.id
      const batch = await processNextEbayFirstLunaBatch(supabase, run.id)
      return NextResponse.json({ success: true, action, run, batch })
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
      return NextResponse.json({ success: true, action, batch })
    }
    return NextResponse.json(
      { success: false, error: "EBAY_LUNA_QUEUE_ACTION_INVALID" },
      { status: 400 },
    )
  } catch (error) {
    if (runId) await recordEbayFirstLunaScanFailure(supabase, runId, error).catch(() => undefined)
    return NextResponse.json({ success: false, error: safeError(error) }, { status: 502 })
  }
}
