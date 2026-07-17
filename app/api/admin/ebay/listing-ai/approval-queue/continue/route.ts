export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import {
  continueListingAiApprovalQueueScan,
  validateListingAiApprovalQueueContinuation,
} from "@/lib/ebay/ebay-listing-ai-approval-queue-service"
import { enqueueListingAiTop20Continuation } from "@/lib/ebay/ebay-listing-ai-top20-queue"
import { getListingAiConfiguration } from "@/lib/ebay/ebay-openai-listing-factory-v2"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { listingAiFailure, listingAiJson, listingAiResponse } from "@/lib/ebay/ebay-listing-ai-api"

export async function POST(req: Request) {
  let runId = ""
  let token = ""
  try {
    const boundary = getListingAiConfiguration()
    if (!boundary.preview || !boundary.staging) throw new Error("LISTING_AI_PREVIEW_STAGING_REQUIRED")
    token = req.headers.get("x-top20-continuation-token")?.trim() ?? ""
    const body = await listingAiJson(req)
    runId = typeof body.runId === "string" ? body.runId.trim() : ""
    if (!runId || !token) throw new Error("TOP20_CONTINUATION_AUTH_REQUIRED")
    const supabase = getSupabaseAdminClient()
    const run = await validateListingAiApprovalQueueContinuation({
      supabase, runId, continuationToken: token,
    })
    const shouldRun = ["RUNNING", "PARTIAL_AUTO_CONTINUING"].includes(run.automation_status)
    let dispatchStatus: string | null = null
    if (shouldRun) {
      const result = await continueListingAiApprovalQueueScan({
        supabase, runId, continuationToken: token,
      })
      if (result.shouldContinue) {
        const dispatched = await enqueueListingAiTop20Continuation({
          supabase,
          runId,
          continuationGeneration: Number(run.continuation_generation),
          expectedBatch: Number(
            "currentBatch" in result ? result.currentBatch : run.current_batch ?? 0,
          ) + 1,
        })
        dispatchStatus = dispatched.status
      }
    }
    return listingAiResponse({ success: true, result: {
      runId, status: dispatchStatus ?? run.automation_status,
      accepted: shouldRun,
      openAiCalls: 0, ebayWrites: 0, canPublish: false,
    } }, shouldRun ? 202 : 200)
  } catch (error) {
    const code = error instanceof Error ? error.message : "TOP20_CONTINUATION_FAILED"
    return listingAiFailure(error)
  } finally {
    token = ""
  }
}
