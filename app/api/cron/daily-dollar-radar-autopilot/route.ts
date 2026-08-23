export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { runSellerOsDailyDollarRadarAutopilotV1 } from
  "@/lib/ebay/ebay-daily-dollar-radar-autopilot-runtime-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret &&
    request.headers.get("authorization") === `Bearer ${secret}`)
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" },
      { status: 401 })
  }
  try {
    const result = await runSellerOsDailyDollarRadarAutopilotV1({
      supabase: getSupabaseAdminClient(),
    })
    const success = (result.status === "COMPLETED" &&
      "operationalReadiness" in result &&
      result.operationalReadiness === "READY") ||
      result.status === "RUN_NOT_CLAIMED" ||
      result.status === "IDEMPOTENT_SUCCESS"
    return NextResponse.json({ success, result }, { status: success ? 200 : 503 })
  } catch {
    return NextResponse.json({ success: false,
      error: "DAILY_DOLLAR_RADAR_CRON_FAILED_CLOSED" }, { status: 503 })
  }
}
