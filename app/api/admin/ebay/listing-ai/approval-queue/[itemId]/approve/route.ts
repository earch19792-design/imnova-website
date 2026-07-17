export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiIdempotencyKey,
  listingAiJson,
  listingAiResponse,
  listingAiText,
} from "@/lib/ebay/ebay-listing-ai-api"
import { approveListingAiQueueItem } from "@/lib/ebay/ebay-listing-ai-approval-queue-service"

export async function POST(req: Request, context: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const body = await listingAiJson(req)
    const { itemId } = await context.params
    const result = await approveListingAiQueueItem({
      supabase: auth.supabase, accountKey: auth.accountKey, actorId: auth.actorId,
      itemId, packageHash: listingAiText(body.packageHash), confirmed: body.confirmed === true,
      idempotencyKey: listingAiIdempotencyKey(req),
    })
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}
