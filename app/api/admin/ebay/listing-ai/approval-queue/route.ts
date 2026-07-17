export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiJson,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import {
  getListingAiApprovalQueueStatus,
  startListingAiApprovalQueueScan,
} from "@/lib/ebay/ebay-listing-ai-approval-queue-service"
import { enqueueListingAiTop20Continuation } from "@/lib/ebay/ebay-listing-ai-top20-queue"

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    return listingAiResponse({ success: true,
      ...(await getListingAiApprovalQueueStatus(auth.supabase, auth.accountKey)) })
  } catch (error) {
    return listingAiFailure(error)
  }
}

export async function POST(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const body = await listingAiJson(req)
    if (body.action !== "scan") throw new Error("TOP20_ACTION_INVALID")
    const result = await startListingAiApprovalQueueScan({
      supabase: auth.supabase, accountKey: auth.accountKey,
    })
    let dispatchStatus: "QUEUED" | "PAUSED_DISPATCH_RECOVERABLE" | null = null
    if (result.shouldSchedule && result.continuationToken) {
      const dispatched = await enqueueListingAiTop20Continuation({
        supabase: auth.supabase,
        runId: result.runId,
        continuationGeneration: result.continuationGeneration,
        expectedBatch: result.expectedBatch,
      })
      dispatchStatus = dispatched.status
    }
    return listingAiResponse({ success: true, result: {
      runId: result.runId, status: dispatchStatus ?? result.status,
      catalogTotal: "catalogTotal" in result ? result.catalogTotal : undefined,
      alreadyRunning: "alreadyRunning" in result ? result.alreadyRunning : false,
      reusedFresh: "reusedFresh" in result ? result.reusedFresh : false,
      recovered: "recovered" in result ? result.recovered : false,
      openAiCalls: 0, ebayWrites: 0, canPublish: false,
    } }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
