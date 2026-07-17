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
} from "@/lib/ebay/ebay-listing-ai-api"
import {
  getProductResearchBrowserCaptureStatus,
  importProductResearchBrowserCapture,
  type ProductResearchBrowserCapture,
} from "@/lib/ebay/ebay-product-research-browser-capture"
import { startListingAiApprovalQueueScan } from "@/lib/ebay/ebay-listing-ai-approval-queue-service"
import { enqueueListingAiTop20Continuation } from "@/lib/ebay/ebay-listing-ai-top20-queue"

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    return listingAiResponse({ success: true,
      status: await getProductResearchBrowserCaptureStatus({
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
    if (body.action !== "capture") throw new Error("PRODUCT_RESEARCH_CAPTURE_ACTION_INVALID")
    const result = await importProductResearchBrowserCapture({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      actorId: auth.actorId,
      capture: body.capture as ProductResearchBrowserCapture,
    })
    let scan: Record<string, unknown> | null = null
    if (result.reanalysisRequired) {
      const started = await startListingAiApprovalQueueScan({
        supabase: auth.supabase, accountKey: auth.accountKey,
      })
      let dispatchStatus: string | null = null
      if (started.shouldSchedule && started.continuationToken) {
        const dispatched = await enqueueListingAiTop20Continuation({
          supabase: auth.supabase,
          runId: started.runId,
          continuationGeneration: started.continuationGeneration,
          expectedBatch: started.expectedBatch,
        })
        dispatchStatus = dispatched.status
      }
      scan = { runId: started.runId, status: dispatchStatus ?? started.status,
        sameRunResumed: true, discoveryRepeated: false }
    }
    return listingAiResponse({ success: true, result: { ...result, scan,
      source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
      rawHtmlStored: false, temporaryTitlesStored: false,
      competitorImagesDownloaded: 0, piiStored: false,
      openAiCalls: 0, ebayWrites: 0, canPublish: false } }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
