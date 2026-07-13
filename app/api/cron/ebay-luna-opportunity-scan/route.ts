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
import {
  buildSellerWorkerId,
  reconcileSellerScanTasks,
} from "@/lib/ebay/ebay-seller-command-center-automation"
import {
  collectOwnEbayPerformanceForLearning,
} from "@/lib/ebay/ebay-category-performance-learning"
import { reverifyManualEbayListingsReadonly } from "@/lib/ebay/ebay-manual-listing-service"

const CRON_MAX_CANDIDATES = 5
const CRON_TIME_BUDGET_MS = 45_000
const CRON_RESPONSE_RESERVE_MS = 15_000
const CRON_LEARNING_MINIMUM_REMAINING_MS = 30_000
const CRON_RECONCILIATION_MINIMUM_REMAINING_MS = 5_000
const CRON_CANDIDATE_MINIMUM_REMAINING_MS = 30_000

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
  const workDeadlineAt = startedAt + CRON_TIME_BUDGET_MS
  const remainingWorkMs = () => Math.max(0, workDeadlineAt - Date.now())
  const workerId = buildSellerWorkerId("vercel-cron")
  try {
    const manualListingReverification =
      await reverifyManualEbayListingsReadonly(supabase, {
        limit: 2,
        timeBudgetMs: 15_000,
      }).catch(() => ({
        status: "REVERIFICATION_FAILED_SCAN_CONTINUES" as const,
        verified: 0,
        downgraded: 0,
      }))
    const postListingLearning =
      remainingWorkMs() >= CRON_LEARNING_MINIMUM_REMAINING_MS
        ? await collectOwnEbayPerformanceForLearning(supabase).catch(() => ({
            status: "COLLECTION_FAILED_SCAN_CONTINUES" as const,
            rankingAdjustmentApplied: false,
          }))
        : {
            status: "COLLECTION_SKIPPED_CRON_DEADLINE_RESERVE" as const,
            rankingAdjustmentApplied: false,
          }
    const reconciliation =
      remainingWorkMs() >= CRON_RECONCILIATION_MINIMUM_REMAINING_MS
        ? await reconcileSellerScanTasks(supabase, {
            forceDue: false,
            limit: 200,
          })
        : {
            insertedOrUpdated: 0,
            dueNow: 0,
            status: "RECONCILIATION_SKIPPED_CRON_DEADLINE_RESERVE" as const,
          }
    const batches = []
    if (remainingWorkMs() >= CRON_CANDIDATE_MINIMUM_REMAINING_MS) {
      const { data: active } = await supabase
        .from("ebay_luna_scan_runs")
        .select("id")
        .eq("status", "running")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (active?.id) runId = active.id
      else if (
        remainingWorkMs() >= CRON_CANDIDATE_MINIMUM_REMAINING_MS
      ) {
        const categoryIds = (process.env.EBAY_LUNA_BEST_SELLING_CATEGORY_IDS ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
        runId = (await startEbayFirstLunaScan(supabase, categoryIds, {
          forceDue: false,
          triggerSource: "schedule",
          reconcileTasks: false,
        })).id
      }
      for (
        let index = 0;
        runId && index < CRON_MAX_CANDIDATES;
        index += 1
      ) {
        if (remainingWorkMs() < CRON_CANDIDATE_MINIMUM_REMAINING_MS) break
        const batch = await processNextEbayFirstLunaBatch(supabase, runId, {
          batchSize: 1,
          workerId,
        })
        batches.push(batch)
        if (batch.completed) break
      }
    }
    return NextResponse.json({
      success: true,
      runId,
      batches,
      automation: {
        strategy: EBAY_LUNA_SCAN_STRATEGY,
        workerId,
        reconciliation,
        maxCandidates: CRON_MAX_CANDIDATES,
        timeBudgetMs: CRON_TIME_BUDGET_MS,
        responseReserveMs: CRON_RESPONSE_RESERVE_MS,
        workDeadlineReached: Date.now() >= workDeadlineAt,
        elapsedMs: Date.now() - startedAt,
        postListingLearning,
        manualListingReverification,
      },
    })
  } catch (error) {
    if (runId) await recordEbayFirstLunaScanFailure(supabase, runId, error).catch(() => undefined)
    return NextResponse.json({ success: false, error: "EBAY_LUNA_SCHEDULED_SCAN_FAILED" }, { status: 502 })
  }
}
