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
import { reconcileProductResearchObservations } from "@/lib/ebay/ebay-product-research-identity-reconciliation"
import { enqueueListingAiTop20Continuation } from "@/lib/ebay/ebay-listing-ai-top20-queue"
import {
  getProductResearchQueryPlanStatus,
  markProductResearchQueryCaptured,
} from "@/lib/ebay/ebay-product-research-query-plan"
import { getEbayApplicationBrowseQuota } from "@/lib/ebay/ebay-seller-keyword-demand-gateway"

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    const [status, queryPlan, browseQuota] = await Promise.all([
      getProductResearchBrowserCaptureStatus({
        supabase: auth.supabase, accountKey: auth.accountKey,
      }),
      getProductResearchQueryPlanStatus({
        supabase: auth.supabase, accountKey: auth.accountKey,
      }),
      getEbayApplicationBrowseQuota(),
    ])
    return listingAiResponse({ success: true, status: { ...status, queryPlan, browseQuota } })
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
    const queryPlan = await markProductResearchQueryCaptured({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      searchQueryHash: result.searchQueryHash,
      captureBatchId: result.batchId,
    })
    let scan: Record<string, unknown> | null = null
    if (result.reanalysisRequired) {
      const reconciled = await reconcileProductResearchObservations({
        supabase: auth.supabase, accountKey: auth.accountKey,
      })
      let dispatchStatus: string | null = null
      if (reconciled.reanalysis.shouldSchedule && reconciled.reanalysis.runId) {
        const dispatched = await enqueueListingAiTop20Continuation({
          supabase: auth.supabase,
          runId: reconciled.reanalysis.runId,
          continuationGeneration: reconciled.reanalysis.continuationGeneration,
          expectedBatch: reconciled.reanalysis.expectedBatch,
        })
        dispatchStatus = dispatched.status
      }
      scan = { runId: reconciled.reanalysis.runId,
        status: dispatchStatus ?? (reconciled.reanalysis.shouldSchedule
          ? "PARTIAL_AUTO_CONTINUING" : "NO_AFFECTED_TARGETS"),
        observationsReconciled: reconciled.observationsProcessed,
        affectedTargets: reconciled.reanalysis.affectedTargets,
        sameRunResumed: true, discoveryRepeated: false }
    }
    return listingAiResponse({ success: true, result: { ...result, scan, queryPlan,
      source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
      rawHtmlStored: false, temporaryTitlesStored: false,
      competitorImagesDownloaded: 0, piiStored: false,
      openAiCalls: 0, ebayWrites: 0, canPublish: false } }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
