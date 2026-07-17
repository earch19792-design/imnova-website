export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiIdempotencyKey,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import { discardListingAiQueueItem } from "@/lib/ebay/ebay-listing-ai-approval-queue-service"

export async function POST(req: Request, context: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const { itemId } = await context.params
    const result = await discardListingAiQueueItem({
      supabase: auth.supabase, accountKey: auth.accountKey, actorId: auth.actorId,
      itemId, idempotencyKey: listingAiIdempotencyKey(req),
    })
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}
