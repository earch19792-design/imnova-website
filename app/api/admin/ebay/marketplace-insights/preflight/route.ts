export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiIdempotencyKey,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import { runMarketplaceInsightsPreflight } from "@/lib/ebay/ebay-marketplace-insights-preflight"

export async function POST(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    listingAiIdempotencyKey(req)
    const result = await runMarketplaceInsightsPreflight()
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}
