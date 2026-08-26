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
import { adaptMainSearchSoldCaptureForCanonicalImport } from
  "@/lib/ebay/ebay-main-search-sold-capture-adapter-v1"
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
    const oneClickResearch = body.researchSessionMode ===
      "EBAY_ONE_CLICK_RESEARCH_SESSION_V1"
    let content = text(body.content)
    let captureAdapter: Awaited<ReturnType<
      typeof adaptMainSearchSoldCaptureForCanonicalImport
    >> | null = null
    if (oneClickResearch) {
      if (text(body.format).toLocaleUpperCase("en-US") !== "JSON" ||
        text(body.sourceExportType) !== "EBAY_MAIN_SEARCH_SOLD_CAPTURE") {
        throw new Error("ONE_CLICK_RESEARCH_SOLD_SOURCE_INVALID")
      }
      let parsed: unknown
      try { parsed = JSON.parse(content) } catch {
        throw new Error("ONE_CLICK_RESEARCH_SOLD_JSON_INVALID")
      }
      const rows = Array.isArray(parsed) ? parsed
        : parsed && typeof parsed === "object" &&
            Array.isArray((parsed as Record<string, unknown>).rows)
          ? (parsed as { rows: unknown[] }).rows : null
      if (!rows) throw new Error("ONE_CLICK_RESEARCH_SOLD_ROWS_REQUIRED")
      captureAdapter = await adaptMainSearchSoldCaptureForCanonicalImport({ rows })
      content = JSON.stringify({ rows: captureAdapter.rows })
    }
    const result = await importOfficialSoldEvidence({
      supabase: auth.supabase,
      accountKey: auth.accountKey,
      actorId: auth.actorId,
      format: text(body.format).toLocaleUpperCase("en-US") as OfficialSoldEvidenceFormat,
      sourceExportType: text(body.sourceExportType) as OfficialSoldEvidenceExport,
      content,
      operatorAttested: body.operatorAttested === true,
    })
    let scan: Record<string, unknown> | null = null
    if (result.reanalysisRequired && !oneClickResearch) {
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
    let durableValidation: Record<string, unknown> | null = null
    if (oneClickResearch) {
      const { data: durableRows, error: durableReadError } = await auth.supabase.rpc(
        "read_marketplace_sold_evidence_v1", {
          p_marketplace_account_key: auth.accountKey,
          p_eligible_at: null,
          p_import_batch_id: result.batchId,
          p_limit: 2_000,
        },
      )
      if (durableReadError) throw new Error("ONE_CLICK_RESEARCH_DURABLE_READBACK_FAILED")
      const rows = Array.isArray(durableRows)
        ? durableRows as Array<Record<string, unknown>> : []
      if (!rows.length || rows.some((row) =>
        row.source_class !== "MAIN_SEARCH_SOLD" ||
        row.realized_price_status !== "UNPROVEN" ||
        row.realized_transaction_price_amount !== null ||
        typeof row.displayed_sold_price_amount !== "number" ||
        !["EXPLICIT_PRESENT", "EXPLICIT_ABSENT", "UNKNOWN"].includes(
          String(row.best_offer_status ?? ""),
        ))) {
        throw new Error("ONE_CLICK_RESEARCH_DURABLE_SEMANTICS_MISMATCH")
      }
      const now = Date.now()
      const ages = rows.map((row) => now - Date.parse(String(row.sold_at ?? "")))
      if (ages.some((age) => !Number.isFinite(age) || age < -86_400_000 ||
        age > 30 * 86_400_000)) {
        throw new Error("ONE_CLICK_RESEARCH_DURABLE_FRESHNESS_MISMATCH")
      }
      durableValidation = {
        status: "PASS",
        readbackCount: rows.length,
        freshSoldRows: rows.length,
        evidenceMaxAgeDays: Math.max(0, ...ages.map((age) => age / 86_400_000)),
        displayedVsRealizedGuard: "PASS",
        bestOfferGuard: "PASS",
        marketplaceWrites: 0,
      }
      scan = { status: "ONE_CLICK_RESEARCH_CAPTURE_ONLY",
        sameRunResumed: false, heavyRadarStarted: false, lunaProductFitStarted: false }
    }
    return listingAiResponse({ success: true, result: { ...result, scan,
      captureAdapter: captureAdapter ? {
        version: captureAdapter.version,
        sourceRowCount: captureAdapter.sourceRowCount,
        freshRowCount: captureAdapter.freshRowCount,
        staleCount: captureAdapter.staleCount,
        malformedCount: captureAdapter.malformedCount,
        browseItemLookupsAttempted: captureAdapter.browseItemLookupsAttempted,
        browseItemLookupsSucceeded: captureAdapter.browseItemLookupsSucceeded,
        evidenceMaxAgeDays: captureAdapter.evidenceMaxAgeDays,
        secretsExposed: false,
      } : null,
      durableValidation,
      openAiCalls: 0, ebayWrites: 0, canPublish: false } }, 202)
  } catch (error) {
    return listingAiFailure(error)
  }
}
