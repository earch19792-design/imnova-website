export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import { getListingAiStatus } from "@/lib/ebay/ebay-openai-listing-factory-v2-service"

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    const status = await getListingAiStatus(auth.supabase, auth.accountKey)
    return listingAiResponse({ success: true, ...status })
  } catch (error) {
    return listingAiFailure(error)
  }
}
