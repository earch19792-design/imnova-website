export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { processSameDayPilotJobs } from "@/lib/ebay/ebay-same-day-pilot-service"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export async function GET(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  if (process.env.VERCEL_ENV !== "preview") return NextResponse.json({ success: true, status: "disabled", safety: { previewOnly: true, ebayWrites: 0, productionChanged: false } })
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false, error: "SAME_DAY_PILOT_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 })
  const result = await processSameDayPilotJobs({ supabase: getSupabaseAdminClient(), accountKey, workerId: `same-day:${randomUUID()}` })
  return NextResponse.json({ success: true, result, safety: { recursiveHttp: false, ebayWrites: 0, productionChanged: false } })
}
