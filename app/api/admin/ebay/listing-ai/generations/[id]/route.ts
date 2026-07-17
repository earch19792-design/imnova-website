export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import { getListingAiGeneration } from "@/lib/ebay/ebay-openai-listing-factory-v2-service"

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    const { id } = await context.params
    const generation = await getListingAiGeneration(auth.supabase, auth.accountKey, id)
    return listingAiResponse({ success: true, generation })
  } catch (error) {
    return listingAiFailure(error)
  }
}
