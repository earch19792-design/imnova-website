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
import { approveListingAiGeneration } from "@/lib/ebay/ebay-openai-listing-factory-v2-service"

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const [{ id }, body] = await Promise.all([context.params, listingAiJson(req)])
    const result = await approveListingAiGeneration({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      actorId: auth.actorId,
      runId: id,
      versionId: listingAiText(body.versionId, 80),
      outputHash: listingAiText(body.outputHash, 80),
      idempotencyKey: listingAiIdempotencyKey(req),
      confirmed: body.confirmed === true,
    })
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}
