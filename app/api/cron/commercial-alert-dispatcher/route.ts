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
    const result = await dispatchCommercialAlertOutbox(
      supabase,
      {
        marketplaceAccountKey: accountKey,
        workerId: `commercial-dispatch-schedule:${randomUUID()}`,
        limit: 1,
        dryRun: false,
      },
    )
    return NextResponse.json({ success: true, result })
  } catch {
    return NextResponse.json(
      { success: false, error: "COMMERCIAL_ALERT_DISPATCH_CRON_FAILED" },
      { status: 502 },
    )
  }
}
