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
  runListingAiApprovalQueueBatch,
} from "@/lib/ebay/ebay-listing-ai-approval-queue-service"

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
    const result = await runListingAiApprovalQueueBatch({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      batchSize: typeof body.batchSize === "number" ? body.batchSize : undefined,
    })
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}
