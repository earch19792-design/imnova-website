export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { runLunaPortexMarketRadarSync } from "@/lib/market-radar-lunaportex"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  }
  const startedAt = Date.now()
  try {
    const sync = await runLunaPortexMarketRadarSync(getSupabaseAdminClient())
    return NextResponse.json({
      success: true,
      sync,
      automation: {
        stage: "LUNA_MARKET_RADAR_REFRESH",
        nextStage: "EBAY_LUNA_PRIORITY_SCAN",
        elapsedMs: Date.now() - startedAt,
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: "MARKET_RADAR_LUNA_SCHEDULED_SYNC_FAILED" },
      { status: 502 },
    )
  }
}
