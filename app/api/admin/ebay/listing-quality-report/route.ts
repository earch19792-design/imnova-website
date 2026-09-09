export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"
import { createQualityUploadTraceV1, type QualityUploadStage } from
  "@/lib/ebay/ebay-listing-quality-upload-transport-v1"

import { isSameSellerOsAdminOriginV1 } from "@/lib/admin-session-origin-v1"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import { parseEbayListingQualityReportV1 } from
  "@/lib/ebay/ebay-listing-quality-report-import-v1"
import {
  OWNER_QUALITY_REPORT_SAFETY_V1,
  persistOwnerListingQualityReportV1,
  persistOwnerQualityReportUploadAttemptV1,
  prepareFailedOwnerQualityReportUploadAttemptV1,
  prepareOwnerListingQualityReportImportV1,
  prepareSuccessfulOwnerQualityReportUploadAttemptV1,
  readExactProductTruthForLiveListingsV1,
  readOwnerListingQualityReportStatusV1,
  readOwnerQualityReportLatestUploadAttemptV1,
} from "@/lib/ebay/ebay-listing-quality-report-owner-import-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { loadSellerOsAssistantMonitorSnapshotV1 } from
  "@/lib/ebay/ebay-seller-os-assistant-runtime"
import {
  currentLiveListingsForMonitorV1,
  resolveCrossModuleLivePortfolioIntegrityV1,
} from "@/lib/ebay/ebay-seller-os-live-portfolio-integrity-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

function noStore(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
  } })
}

function sameOrigin(request: Request) {
  return isSameSellerOsAdminOriginV1({ requestUrl: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site") })
}

function dedicatedPreprod(request: Request) {
  return getEbayProRuntimeBoundary({ pathname: new URL(request.url).pathname,
    method: request.method }).runtime === "seller_os_dedicated_preprod"
}

async function owner(request: Request) {
  if (!sameOrigin(request)) return null
  const validation = await validateAdminApiRequest(request)
  return validation.ok && validation.authenticationMode === "admin_user" &&
    validation.userId ? validation : null
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  if (/^QUALITY_REPORT_[A-Z0-9_]{3,160}$/.test(code)) return code
  return /^[A-Z0-9_]{3,120}$/.test(code)
    ? `QUALITY_REPORT_${code}` : "QUALITY_REPORT_IMPORT_FAILED"
}

function canonicalAccount() {
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey || !account.accountAlias) {
    throw new Error("QUALITY_REPORT_OWNER_SCOPE_INVALID")
  }
  return account as typeof account & { accountKey: string; accountAlias: string }
}

export async function GET(request: Request) {
  if (!dedicatedPreprod(request)) return noStore({ success: false,
    error: "QUALITY_REPORT_DEDICATED_PREPROD_ONLY" }, 403)
  const validation = await owner(request)
  if (!validation) return noStore({ success: false,
    error: "QUALITY_REPORT_OWNER_AUTH_REQUIRED" }, 403)
  try {
    const account = canonicalAccount()
    const supabase = getSupabaseAdminClient()
    const [status, latestUploadAttempt] = await Promise.all([
      readOwnerListingQualityReportStatusV1({ supabase,
        accountKey: account.accountKey }),
      readOwnerQualityReportLatestUploadAttemptV1({ supabase,
        accountKey: account.accountKey }),
    ])
    return noStore({ success: true, status, latestUploadAttempt,
      permissions: { remoteOperatorUploadAccess: false,
        remoteOperatorRawReportAccess: false } })
  } catch (error) {
    return noStore({ success: false, error: safeError(error) }, 503)
  }
}

export async function POST(request: Request) {
  const trace = createQualityUploadTraceV1(request.headers.get("x-seller-os-trace-id"))
  let stage: QualityUploadStage = "ROUTE"
  const reach = (next: QualityUploadStage) => {
    stage = next; trace.stages[next].REACHED = true
  }
  const respond = (payload: Record<string, unknown>, httpStatus = 200) => {
    const code = typeof payload.error === "string" ? payload.error : null
    trace.HTTP_STATUS = httpStatus; trace.ERROR_CODE = code
    trace.FAILURE_STAGE = code ? stage : null
    for (const observed of Object.values(trace.stages)) {
      if (observed.REACHED) observed.HTTP_STATUS = httpStatus
    }
    if (code) trace.stages[stage].ERROR_CODE = code
    return noStore({ ...payload, ERROR_CODE: code, TRACE_ID: trace.TRACE_ID,
      FAILURE_STAGE: trace.FAILURE_STAGE,
      failureClass: code && !trace.stages.WORKBOOK_PARSER.REACHED
        ? "PRE_INGESTION_UPLOAD_FAILURE" : code ? "INGESTION_FAILURE" : null,
      uploadTrace: trace }, httpStatus)
  }
  try {
    reach("ROUTE")
    if (!dedicatedPreprod(request)) return respond({ success: false,
      error: "QUALITY_REPORT_DEDICATED_PREPROD_ONLY" }, 403)
    reach("AUTH")
    const validation = await owner(request)
    if (!validation) return respond({ success: false,
      error: "QUALITY_REPORT_OWNER_AUTH_REQUIRED" }, 403)
    reach("FILE_TRANSPORT")
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return respond({ success: false, error: "QUALITY_REPORT_CONTENT_TYPE_INVALID" }, 415)
    }
    let body: Record<string, unknown> | null = null
    try {
      const parsed = await request.json()
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : null
    } catch { body = null }
    const format = body?.format === "CSV" || body?.format === "JSON" ||
      body?.format === "XLSX" ? body.format : null
    const fileName = typeof body?.fileName === "string" ? body.fileName : ""
    const content = typeof body?.content === "string" ? body.content : ""
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType : null
    const requestContentType = request.headers.get("content-type")
    const runtimeDeploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? null
    if (!format || !fileName || !content) return respond({ success: false,
      error: "QUALITY_REPORT_INPUT_INVALID" }, 400)
    const attemptedAt = new Date().toISOString()
    const correlationSeed = trace.TRACE_ID
    let account: ReturnType<typeof canonicalAccount>
    let supabase: ReturnType<typeof getSupabaseAdminClient>
    try {
      account = canonicalAccount()
      supabase = getSupabaseAdminClient()
    } catch (error) {
      return respond({ success: false, error: safeError(error) }, 503)
    }
    let snapshot: ReturnType<typeof parseEbayListingQualityReportV1> | null = null
    let prepared: ReturnType<typeof prepareOwnerListingQualityReportImportV1>
    try {
      reach("WORKBOOK_PARSER")
      snapshot = parseEbayListingQualityReportV1({ format, fileName,
        content, selectedWorksheet: typeof body?.selectedWorksheet === "string"
          ? body.selectedWorksheet : null })
      reach("IMPORT_VALIDATION")
      const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
      const integrity = resolveCrossModuleLivePortfolioIntegrityV1(monitor)
      const live = currentLiveListingsForMonitorV1(monitor).map((listing) => ({
        listingKey: listing.key, itemId: listing.identity.itemId,
        sku: listing.identity.sku }))
      const truth = await readExactProductTruthForLiveListingsV1({ supabase,
        accountKey: account.accountKey, itemIds: live.map((row) => row.itemId) })
      prepared = prepareOwnerListingQualityReportImportV1({ snapshot,
        accountKey: account.accountKey, accountAlias: account.accountAlias,
        importedBy: validation.userId,
        liveScope: integrity.canonicalCohort, liveListings: live,
        productTruthByItemId: truth })
    } catch (error) {
      try {
        const attempt = prepareFailedOwnerQualityReportUploadAttemptV1({
          accountKey: account.accountKey, attemptedBy: validation.userId,
          format, content, error, snapshot, mimeType, requestContentType,
          deploymentId: runtimeDeploymentId, failedStage: "IMPORT_VALIDATION",
          attemptedAt, correlationSeed })
        await persistOwnerQualityReportUploadAttemptV1({ supabase, attempt })
        trace.stages.UPLOAD_ATTEMPT_LEDGER.REACHED = true
      } catch {
        // Preserve the original fail-closed parser result. Audit failures are
        // intentionally not misreported as successful imports.
      }
      const [status, latestUploadAttempt] = await Promise.all([
        readOwnerListingQualityReportStatusV1({ supabase,
          accountKey: account.accountKey }).catch(() => null),
        readOwnerQualityReportLatestUploadAttemptV1({ supabase,
          accountKey: account.accountKey }).catch(() => null),
      ])
      return respond({ success: false, error: safeError(error), status,
        latestUploadAttempt }, 422)
    }

    if (!snapshot) return respond({ success: false,
      error: "QUALITY_REPORT_IMPORT_STATE_INVALID" }, 500)

    let persisted: Awaited<ReturnType<typeof persistOwnerListingQualityReportV1>>
    try {
      reach("IMPORTS")
      persisted = await persistOwnerListingQualityReportV1({ supabase, prepared })
      reach("SIGNALS")
    } catch (error) {
      try {
        const attempt = prepareFailedOwnerQualityReportUploadAttemptV1({
          accountKey: account.accountKey, attemptedBy: validation.userId,
          format, content, error, snapshot, mimeType, requestContentType,
          deploymentId: runtimeDeploymentId, failedStage: "IMPORT_RPC",
          attemptedAt, correlationSeed })
        await persistOwnerQualityReportUploadAttemptV1({ supabase, attempt })
        trace.stages.UPLOAD_ATTEMPT_LEDGER.REACHED = true
      } catch { /* The valid-import table remains authoritative. */ }
      return respond({ success: false, error: safeError(error) }, 422)
    }

    const successfulAttempt = prepareSuccessfulOwnerQualityReportUploadAttemptV1({
      accountKey: account.accountKey, attemptedBy: validation.userId,
      format, content, snapshot, prepared, validImportId: persisted.importId,
      mimeType, requestContentType, deploymentId: runtimeDeploymentId,
      attemptedAt, correlationSeed })
    stage = "UPLOAD_ATTEMPT_LEDGER"
    const { attemptId: uploadAttemptId } = await persistOwnerQualityReportUploadAttemptV1({ supabase,
      attempt: successfulAttempt })
    reach("UPLOAD_ATTEMPT_LEDGER")
    const [status, latestUploadAttempt] = await Promise.all([
      readOwnerListingQualityReportStatusV1({ supabase,
        accountKey: account.accountKey }),
      readOwnerQualityReportLatestUploadAttemptV1({ supabase,
        accountKey: account.accountKey }),
    ])
    return respond({ success: true, importId: persisted.importId, uploadAttemptId,
      idempotent: persisted.idempotent, status, latestUploadAttempt,
      guards: prepared.guards, safety: OWNER_QUALITY_REPORT_SAFETY_V1 })
  } catch (error) {
    return respond({ success: false, error: safeError(error) }, 503)
  }
}
