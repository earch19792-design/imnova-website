export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { getCommercialMonitorScheduleConfiguration } from "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { dispatchCommercialAlertOutbox } from "@/lib/marketplace/commercial-alert-dispatcher"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  const authorization = req.headers.get("authorization") ?? ""
  const left = Buffer.from(authorization)
  const right = Buffer.from(`Bearer ${secret}`)
  return Boolean(secret && left.length === right.length && timingSafeEqual(left, right))
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json(
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
    const result = await dispatchCommercialAlertOutbox(
      getSupabaseAdminClient(),
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
