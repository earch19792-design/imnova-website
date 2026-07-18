export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiIdempotencyKey,
  listingAiJson,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import {
  getProductFactsStatus,
  runProductFactsEnrichment,
} from "@/lib/ebay/ebay-product-facts-enrichment"

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    return listingAiResponse({ success: true, status: await getProductFactsStatus({
      supabase: auth.supabase, accountKey: auth.accountKey,
    }) })
  } catch (error) {
    return listingAiFailure(error)
  }
}

export async function POST(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "WRITE")
    listingAiIdempotencyKey(req)
    const body = await listingAiJson(req)
    if (body.action !== "enrich") throw new Error("PRODUCT_FACT_ACTION_INVALID")
    const result = await runProductFactsEnrichment({ supabase: auth.supabase, accountKey: auth.accountKey })
    return listingAiResponse({ success: true, result }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
