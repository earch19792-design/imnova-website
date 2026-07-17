export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiCodes,
  listingAiFailure,
  listingAiIdempotencyKey,
  listingAiJson,
  listingAiResponse,
  listingAiText,
} from "@/lib/ebay/ebay-listing-ai-api"
import { requestListingAiRevision } from "@/lib/ebay/ebay-openai-listing-factory-v2-service"

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    const [{ id }, body] = await Promise.all([context.params, listingAiJson(req)])
    const result = await requestListingAiRevision({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      actorId: auth.actorId,
      runId: id,
      idempotencyKey: listingAiIdempotencyKey(req),
      reasonCodes: listingAiCodes(body.reasonCodes),
      restoreVersionId: listingAiText(body.restoreVersionId, 80) || null,
    })
    return listingAiResponse({ success: true, result })
  } catch (error) {
    return listingAiFailure(error)
  }
}
