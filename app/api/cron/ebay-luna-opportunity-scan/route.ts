export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import {
  EBAY_LUNA_SCAN_STRATEGY,
  processNextEbayFirstLunaBatch,
  recordEbayFirstLunaScanFailure,
  startEbayFirstLunaScan,
} from "@/lib/ebay/ebay-first-luna-scan-service"

const CRON_MAX_BATCHES = 6
const CRON_TIME_BUDGET_MS = 47_000

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  }
  const supabase = getSupabaseAdminClient()
  let runId = ""
  const startedAt = Date.now()
  try {
    const { data: active } = await supabase
      .from("ebay_luna_scan_runs")
      .select("id")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (active?.id) runId = active.id
    else {
      const categoryIds = (process.env.EBAY_LUNA_BEST_SELLING_CATEGORY_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
      runId = (await startEbayFirstLunaScan(supabase, categoryIds)).id
    }
    const batches = []
    for (let index = 0; index < CRON_MAX_BATCHES; index += 1) {
      if (index > 0 && Date.now() - startedAt >= CRON_TIME_BUDGET_MS) break
      const batch = await processNextEbayFirstLunaBatch(supabase, runId)
      batches.push(batch)
      if (batch.completed) break
    }
    return NextResponse.json({
      success: true,
      runId,
      batches,
      automation: {
        strategy: EBAY_LUNA_SCAN_STRATEGY,
        maxBatches: CRON_MAX_BATCHES,
        timeBudgetMs: CRON_TIME_BUDGET_MS,
        elapsedMs: Date.now() - startedAt,
      },
    })
  } catch (error) {
    if (runId) await recordEbayFirstLunaScanFailure(supabase, runId, error).catch(() => undefined)
    return NextResponse.json({ success: false, error: "EBAY_LUNA_SCHEDULED_SCAN_FAILED" }, { status: 502 })
  }
}
