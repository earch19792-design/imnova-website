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
  getProductIdentityReconciliationStatus,
  reconcileProductResearchObservations,
} from "@/lib/ebay/ebay-product-research-identity-reconciliation"
import { enqueueListingAiTop20Continuation } from "@/lib/ebay/ebay-listing-ai-top20-queue"

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    return listingAiResponse({ success: true,
      status: await getProductIdentityReconciliationStatus({
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
    if (body.action !== "reconcile") throw new Error("PRODUCT_IDENTITY_RECONCILIATION_ACTION_INVALID")
    const result = await reconcileProductResearchObservations({
      supabase: auth.supabase, accountKey: auth.accountKey,
    })
    let dispatchStatus: string | null = null
    if (result.reanalysis.shouldSchedule && result.reanalysis.runId) {
      const dispatched = await enqueueListingAiTop20Continuation({
        supabase: auth.supabase, runId: result.reanalysis.runId,
        continuationGeneration: result.reanalysis.continuationGeneration,
        expectedBatch: result.reanalysis.expectedBatch,
      })
      dispatchStatus = dispatched.status
    }
    return listingAiResponse({ success: true, result: { ...result,
      reanalysis: { ...result.reanalysis, dispatchStatus },
      canPublish: false, openAiCalls: 0, ebayWrites: 0,
    } }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
