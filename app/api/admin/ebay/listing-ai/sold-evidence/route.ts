export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import {
  authorizeListingAiRequest,
  enforceListingAiRouteRateLimit,
  listingAiFailure,
  listingAiJson,
  listingAiResponse,
} from "@/lib/ebay/ebay-listing-ai-api"
import {
  getOfficialSoldEvidenceImportStatus,
  importOfficialSoldEvidence,
  type OfficialSoldEvidenceExport,
  type OfficialSoldEvidenceFormat,
} from "@/lib/ebay/ebay-official-sold-evidence-import"
import { startListingAiApprovalQueueScan } from "@/lib/ebay/ebay-listing-ai-approval-queue-service"
import { enqueueListingAiTop20Continuation } from "@/lib/ebay/ebay-listing-ai-top20-queue"

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

export async function GET(req: Request) {
  const auth = await authorizeListingAiRequest(req)
  if (!auth.ok) return auth.response
  try {
    enforceListingAiRouteRateLimit(auth.actorId, "READ")
    return listingAiResponse({ success: true,
      status: await getOfficialSoldEvidenceImportStatus({
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
    const body = await listingAiJson(req)
    if (body.action !== "import") throw new Error("SOLD_EVIDENCE_ACTION_INVALID")
    const result = await importOfficialSoldEvidence({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      actorId: auth.actorId,
      format: text(body.format).toLocaleUpperCase("en-US") as OfficialSoldEvidenceFormat,
      sourceExportType: text(body.sourceExportType) as OfficialSoldEvidenceExport,
      content: text(body.content),
      operatorAttested: body.operatorAttested === true,
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
        sameRunResumed: true }
    }
    return listingAiResponse({ success: true, result: { ...result, scan,
      openAiCalls: 0, ebayWrites: 0, canPublish: false } }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
