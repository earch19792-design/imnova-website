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
import { getProductResearchVisualPatternStatus } from "@/lib/ebay/ebay-product-research-visual-pattern"
import { enqueueListingAiTop20Continuation } from "@/lib/ebay/ebay-listing-ai-top20-queue"
import {
  assertProductResearchCaptureMatchesNextQuery,
  getProductResearchQueryPlanStatus,
  markProductResearchQueryCaptured,
} from "@/lib/ebay/ebay-product-research-query-plan"
import { getEbayApplicationBrowseQuota } from "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { resumeSameDayPilotAfterProductResearchCapture } from "@/lib/ebay/ebay-same-day-pilot-service"

async function visualStatusOrUnavailable(input: {
  supabase: Parameters<typeof getProductResearchVisualPatternStatus>[0]["supabase"]
  accountKey: string
}) {
  try {
    return await getProductResearchVisualPatternStatus(input)
  } catch {
    return {
      configured: false,
      error: "VISUAL_PATTERN_STATUS_UNAVAILABLE",
      visualNotCapturedLegacyStatus: "VISUAL_NOT_CAPTURED_LEGACY",
      rawImageBytesStored: false,
      imageUrlsStored: false,
      screenshotsStored: false,
      base64Stored: false,
      blobsStored: false,
      rawHtmlStored: false,
      piiStored: false,
      openAiCalls: 0,
      ebayWrites: 0,
      productionChanged: false,
    }
  }
}

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    const [status, queryPlan, browseQuota, visual] = await Promise.all([
      getProductResearchBrowserCaptureStatus({
        supabase: auth.supabase, accountKey: auth.accountKey,
      }),
      getProductResearchQueryPlanStatus({
        supabase: auth.supabase, accountKey: auth.accountKey,
      }),
      getEbayApplicationBrowseQuota(),
      visualStatusOrUnavailable({
        supabase: auth.supabase, accountKey: auth.accountKey,
      }),
    ])
    return listingAiResponse({ success: true, status: { ...status, queryPlan, browseQuota, visual } })
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
    if (!body.capture || typeof body.capture !== "object") {
      throw new Error("PRODUCT_RESEARCH_CAPTURE_BODY_INVALID")
    }
    const capture = body.capture as ProductResearchBrowserCapture
    let plannedTask: Awaited<ReturnType<typeof assertProductResearchCaptureMatchesNextQuery>>
    try {
      plannedTask = await assertProductResearchCaptureMatchesNextQuery({
        supabase: auth.supabase, accountKey: auth.accountKey, searchQuery: capture.searchQuery,
      })
    } catch (planError) {
      const code = planError instanceof Error ? planError.message : ""
      if (code !== "PRODUCT_RESEARCH_QUERY_PLAN_NEXT_QUERY_REQUIRED") throw planError
      // A visible table from another tab is a navigation problem, not a bad
      // commercial import. Return the durable next query without persisting a
      // row, so v1.2.5 can apply it automatically in the same eBay tab.
      let queryPlan: Awaited<ReturnType<typeof getProductResearchQueryPlanStatus>> = null
      try {
        queryPlan = await getProductResearchQueryPlanStatus({
          supabase: auth.supabase, accountKey: auth.accountKey,
        })
      } catch {
        throw planError
      }
      if (queryPlan?.status !== "ACTIVE" || !queryPlan.nextQuery) throw planError
      return listingAiResponse({ success: true, result: {
        captureQueryCorrected: true,
        navigationOnly: true,
        batchId: null,
        capturedAt: null,
        rowCount: 0, validCount: 0, importedCount: 0, duplicateCount: 0, rejectedCount: 0,
        candidatesEnriched: 0,
        matchCounts: { exactLuna: 0, differentPack: 0, differentSize: 0,
          differentVariant: 0, ambiguous: 0, noLunaMatch: 0 },
        reanalysisRequired: false,
        scan: { status: "PRODUCT_RESEARCH_QUERY_NAVIGATION_CORRECTED",
          commercialEvidenceStored: false, browserMayClose: false,
          observationsImported: 0, discoveryRepeated: false },
        queryPlan,
        source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
        rawHtmlStored: false, temporaryTitlesStored: false,
        competitorImagesDownloaded: 0, piiStored: false,
        openAiCalls: 0, ebayWrites: 0, canPublish: false,
      } }, 200)
    }
    if (plannedTask?.alreadyProcessed && plannedTask.captureBatchId) {
      const queryPlan = await getProductResearchQueryPlanStatus({
        supabase: auth.supabase, accountKey: auth.accountKey, planId: plannedTask.planId,
      })
      let sameDayPilot: {
        resumed: number
        familyEnriched: number
        deferred?: boolean
        error?: string
      }
      try {
        sameDayPilot = await resumeSameDayPilotAfterProductResearchCapture({
          supabase: auth.supabase, accountKey: auth.accountKey,
          searchQuery: plannedTask.searchQuery,
          batchId: plannedTask.captureBatchId,
          capturedAt: plannedTask.capturedAt,
        })
      } catch {
        sameDayPilot = { resumed: 0, familyEnriched: 0, deferred: true,
          error: "SAME_DAY_PILOT_CAPTURE_RESUME_DEFERRED" }
      }
      const visualStatus = await visualStatusOrUnavailable({
        supabase: auth.supabase, accountKey: auth.accountKey,
      })
      return listingAiResponse({ success: true, result: {
        captureAlreadyProcessed: true,
        batchId: plannedTask.captureBatchId,
        capturedAt: plannedTask.capturedAt,
        rowCount: 0, validCount: 0, importedCount: 0, duplicateCount: 0, rejectedCount: 0,
        candidatesEnriched: 0,
        matchCounts: { exactLuna: 0, differentPack: 0, differentSize: 0,
          differentVariant: 0, ambiguous: 0, noLunaMatch: 0 },
        reanalysisRequired: false,
        scan: { status: "PROCESSED_CAPTURE_REPLAY_REDIRECTED",
          commercialEvidencePreserved: true, browserMayClose: true,
          observationsImported: 0, discoveryRepeated: false },
        queryPlan, visualStatus, sameDayPilot,
        source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
        rawHtmlStored: false, temporaryTitlesStored: false,
        competitorImagesDownloaded: 0, piiStored: false,
        openAiCalls: 0, ebayWrites: 0, canPublish: false,
      } }, 200)
    }
    const result = await importProductResearchBrowserCapture({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      actorId: auth.actorId,
      capture,
      visualContext: { categoryId: plannedTask?.categoryId ?? null },
    })
    const queryPlan = plannedTask ? await markProductResearchQueryCaptured({
      supabase: auth.supabase, accountKey: auth.accountKey,
      // The assertion above already proved canonical equivalence. Use the
      // durable task hash so harmless punctuation or Luna's "Default Title"
      // placeholder cannot prevent the verified task from advancing.
      searchQueryHash: plannedTask.queryHash, captureBatchId: result.batchId,
      planId: plannedTask.planId, taskId: plannedTask.taskId,
    }) : null
    // Resume the durable same-day state machine immediately after the safe
    // commercial import. Official reconciliation can be long-running and must
    // never make the browser receipt fail after evidence was already stored.
    let sameDayPilot: {
      resumed: number
      familyEnriched: number
      deferred?: boolean
      error?: string
    }
    try {
      sameDayPilot = await resumeSameDayPilotAfterProductResearchCapture({
        supabase: auth.supabase, accountKey: auth.accountKey,
        searchQuery: capture.searchQuery, batchId: result.batchId,
        capturedAt: result.capturedAt, exactLunaMatches: result.matchCounts.exactLuna,
      })
    } catch {
      // The evidence and its query task are already durable. The background
      // worker repairs this exact checkpoint, so the receipt must not tell the
      // operator to capture the same table again.
      sameDayPilot = { resumed: 0, familyEnriched: 0, deferred: true,
        error: "SAME_DAY_PILOT_CAPTURE_RESUME_DEFERRED" }
    }
    let scan: Record<string, unknown> | null = null
    if (sameDayPilot.deferred) {
      // Import + query-task advancement already committed. Do not enter the
      // legacy synchronous continuation: any secondary read failure would
      // otherwise report a false capture rejection and tempt the operator to
      // resend a query that the durable plan has already completed.
      scan = { status: "CAPTURE_SAVED_SAME_DAY_RESUME_DEFERRED",
        error: sameDayPilot.error,
        observationsReconciled: 0, sameRunResumed: false,
        commercialEvidencePreserved: true, browserMayClose: true,
        discoveryRepeated: false }
    } else if (result.reanalysisRequired) {
      if (sameDayPilot.resumed > 0) {
        scan = { status: "DURABLE_RECONCILIATION_QUEUED", observationsReconciled: 0,
          maximumReferencesPerCandidate: 10, sameRunResumed: true,
          browserMayClose: true, discoveryRepeated: false }
      } else {
        // Preserve the legacy non-pilot continuation, but constrain it to the
        // current capture instead of rereading up to 200 historical rows.
        const { data: currentRows, error: currentRowsError } = await auth.supabase
          .from("marketplace_product_research_capture_observations")
          .select("id").eq("capture_batch_id", result.batchId)
          .eq("marketplace_account_key", auth.accountKey).eq("marketplace", "EBAY_US")
          .eq("evidence_reviewed", true).order("confirmed_sold_quantity", { ascending: false }).limit(10)
        if (currentRowsError) throw new Error("PRODUCT_RESEARCH_CAPTURE_CURRENT_ROWS_READ_FAILED")
        try {
          const reconciled = await reconcileProductResearchObservations({
            supabase: auth.supabase, accountKey: auth.accountKey,
            observationIds: (currentRows ?? []).map((row) => row.id),
          })
          let dispatchStatus: string | null = null
          if (reconciled.reanalysis.shouldSchedule && reconciled.reanalysis.runId) {
            const dispatched = await enqueueListingAiTop20Continuation({
              supabase: auth.supabase, runId: reconciled.reanalysis.runId,
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
        } catch (error) {
          const code = error instanceof Error && /^[A-Z0-9_:-]+$/.test(error.message)
            ? error.message : "PRODUCT_RESEARCH_RECONCILIATION_DEFERRED"
          scan = { status: "CAPTURE_SAVED_RECONCILIATION_DEFERRED", error: code,
            observationsReconciled: 0, sameRunResumed: true,
            commercialEvidencePreserved: true, discoveryRepeated: false }
        }
      }
    }
    const visualStatus = await visualStatusOrUnavailable({
      supabase: auth.supabase, accountKey: auth.accountKey,
    })
    return listingAiResponse({ success: true, result: { ...result, scan, queryPlan,
      visualStatus, sameDayPilot,
      source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
      rawHtmlStored: false, temporaryTitlesStored: false,
      competitorImagesDownloaded: 0, piiStored: false,
      openAiCalls: 0, ebayWrites: 0, canPublish: false } }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
