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
import { confirmListingAiQueueLunaObservation } from "@/lib/ebay/ebay-listing-ai-approval-queue-service"
import type { LunaAvailabilityConfirmation } from "@/lib/ebay/ebay-listing-ai-approval-queue"

const availability = new Set<LunaAvailabilityConfirmation>([
  "EXACT_QUANTITY_VISIBLE", "AVAILABLE_QUANTITY_NOT_SHOWN", "OUT_OF_STOCK",
])

export async function POST(req: Request, context: { params: Promise<{ itemId: string }> }) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const body = await listingAiJson(req)
    const { itemId } = await context.params
    const normalizedAvailability = listingAiText(body.availability) as LunaAvailabilityConfirmation
    if (!availability.has(normalizedAvailability)) throw new Error("LUNA_AVAILABILITY_CONFIRMATION_INVALID")
    const result = await confirmListingAiQueueLunaObservation({
      supabase: auth.supabase, accountKey: auth.accountKey, actorId: auth.actorId,
      itemId, idempotencyKey: listingAiIdempotencyKey(req),
      priceObserved: Number(body.priceObserved), availability: normalizedAvailability,
      exactQuantity: body.exactQuantity === null || body.exactQuantity === undefined
        ? null : Number(body.exactQuantity),
    })
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}
