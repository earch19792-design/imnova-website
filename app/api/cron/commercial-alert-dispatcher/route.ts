export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import { getCommercialMonitorScheduleConfiguration } from "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import { dispatchCommercialAlertOutbox } from "@/lib/marketplace/commercial-alert-dispatcher"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback
}

function record(value: unknown) {
  const resolved = Array.isArray(value) ? value[0] : value
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null
}

export async function GET(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) return NextResponse.json(
    { success: false, error: "CRON_UNAUTHORIZED" },
    { status: 401 },
  )
  const schedule = getCommercialMonitorScheduleConfiguration()
  if (process.env.VERCEL_ENV !== "preview" || !schedule.enabled) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      schedule,
      safety: { previewOnly: true, productionUnchanged: true },
    })
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json(
    { success: false, error: "COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED" },
    { status: 503 },
  )
  try {
    const supabase = getSupabaseAdminClient()
    const { error: gateError } = await supabase.rpc(
      "require_active_commercial_monitor_scheduler_authorization",
      {
        p_marketplace_account_key: accountKey,
        p_marketplace: "EBAY_US",
      },
    )
    if (gateError) return NextResponse.json({
      success: false,
      error: "COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED",
      safety: {
        alertClaimed: false,
        whatsappAttempted: false,
        productionUnchanged: true,
      },
    }, { status: 423 })
    const { data: heartbeatData, error: heartbeatError } = await supabase.rpc(
      "enqueue_ebay_monitoring_heartbeat_alerts",
      {
        p_marketplace_account_key: accountKey,
        p_marketplace: "EBAY_US",
        p_ebay_stale_minutes: boundedInteger(
          process.env.EBAY_COMMERCIAL_HEARTBEAT_STALE_MINUTES,
          20,
          10,
          1_440,
        ),
        p_luna_stale_minutes: boundedInteger(
          process.env.EBAY_TARGETED_LUNA_HEARTBEAT_STALE_MINUTES,
          45,
          15,
          1_440,
        ),
      },
    )
    const heartbeat = record(heartbeatData)
    if (heartbeatError || !heartbeat) return NextResponse.json({
      success: false,
      error: "COMMERCIAL_MONITOR_HEARTBEAT_RECONCILE_FAILED",
      safety: {
        alertClaimed: false,
        whatsappAttempted: false,
        productionUnchanged: true,
      },
    }, { status: 502 })
    if (heartbeat.status === "BLOCKED_INEXACT_ACTIVE_LISTING_STATE") {
      return NextResponse.json({
        success: false,
        error: "COMMERCIAL_MONITOR_EXACT_ACTIVE_LISTING_STATE_REQUIRED",
        heartbeat,
        safety: {
          alertClaimed: false,
          whatsappAttempted: false,
          productionUnchanged: true,
        },
      }, { status: 423 })
    }
    const result = await dispatchCommercialAlertOutbox(
      supabase,
      {
        marketplaceAccountKey: accountKey,
        workerId: `commercial-dispatch-schedule:${randomUUID()}`,
        limit: 1,
        dryRun: false,
      },
    )
    return NextResponse.json({ success: true, heartbeat, result })
  } catch {
    return NextResponse.json(
      { success: false, error: "COMMERCIAL_ALERT_DISPATCH_CRON_FAILED" },
      { status: 502 },
    )
  }
}
