export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiIdempotencyKey,
  listingAiJson,
  listingAiResponse,
  listingAiText,
} from "@/lib/ebay/ebay-listing-ai-api"
import { generateListingAi } from "@/lib/ebay/ebay-openai-listing-factory-v2-service"

export async function POST(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const body = await listingAiJson(req)
    const result = await generateListingAi({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      actorId: auth.actorId,
      packageId: listingAiText(body.packageId, 80),
      packageHash: listingAiText(body.packageHash, 80),
      idempotencyKey: listingAiIdempotencyKey(req),
    })
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}
