export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  getCommercialMonitorScheduleConfiguration,
  getDueCommercialMonitorLanes,
  runEbayCommercialMonitor,
} from "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(value) ? value : "COMMERCIAL_MONITOR_CRON_FAILED"
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
      safety: {
        previewOnly: true,
        productionUnchanged: true,
        ebayWriteUsed: false,
      },
    })
  }
  try {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
    const supabase = getSupabaseAdminClient()
    const lanes = await getDueCommercialMonitorLanes(supabase, accountKey)
    const run = await runEbayCommercialMonitor(supabase, {
      triggerSource: "schedule",
      lanes,
      workerId: `commercial-schedule:${randomUUID()}`,
      dispatchWhatsApp: false,
      dryRunWhatsApp: true,
    })
    return NextResponse.json({ success: true, schedule, lanes, run })
  } catch (error) {
    const code = safeCode(error)
    return NextResponse.json(
      {
        success: false,
        error: code,
        schedule,
        safety: code === "COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED"
          ? {
              externalReadersStarted: false,
              productionUnchanged: true,
              ebayWriteUsed: false,
            }
          : {
              productionUnchanged: true,
              ebayWriteUsed: false,
            },
      },
      { status: code === "COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED" ? 423 : 502 },
    )
  }
}
