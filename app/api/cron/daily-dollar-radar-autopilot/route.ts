export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { runSellerOsDailyDollarRadarAutopilotV1 } from
  "@/lib/ebay/ebay-daily-dollar-radar-autopilot-runtime-v1"
import { runSellerOsDemandFirstBroadNetNightlyV1 } from
  "@/lib/ebay/ebay-demand-first-broad-net-orchestrator-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret &&
    request.headers.get("authorization") === `Bearer ${secret}`)
}

function safeFailureCode(error: unknown) {
  const candidate = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(candidate)
    ? candidate : "DAILY_DOLLAR_RADAR_CRON_FAILED_CLOSED"
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" },
      { status: 401 })
  }
  try {
    const supabase = getSupabaseAdminClient()
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) {
      return NextResponse.json({ success: false,
        error: "DAILY_DOLLAR_RADAR_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 })
    }
    const broadNet = await runSellerOsDemandFirstBroadNetNightlyV1({
      supabase, accountKey,
    })
    if (broadNet.status !== "PASS") {
      return NextResponse.json({ success: false,
        error: "DAILY_DOLLAR_BROAD_NET_FAILED_CLOSED" }, { status: 503 })
    }
    const result = await runSellerOsDailyDollarRadarAutopilotV1({
      supabase,
    })
    const success = (result.status === "COMPLETED" &&
      "operationalReadiness" in result &&
      result.operationalReadiness === "READY") ||
      result.status === "RUN_NOT_CLAIMED" ||
      result.status === "IDEMPOTENT_SUCCESS"
    return NextResponse.json({ success, broadNet, result },
      { status: success ? 200 : 503 })
  } catch (error) {
    return NextResponse.json({ success: false,
      error: safeFailureCode(error) }, { status: 503 })
  }
}
