export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { isSameSellerOsAdminOriginV1 } from "@/lib/admin-session-origin-v1"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import { parseEbayListingQualityReportV1 } from
  "@/lib/ebay/ebay-listing-quality-report-import-v1"
import {
  OWNER_QUALITY_REPORT_SAFETY_V1,
  persistOwnerListingQualityReportV1,
  prepareOwnerListingQualityReportImportV1,
  readExactProductTruthForLiveListingsV1,
  readOwnerListingQualityReportStatusV1,
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
    const status = await readOwnerListingQualityReportStatusV1({
      supabase: getSupabaseAdminClient(), accountKey: account.accountKey })
    return noStore({ success: true, status,
      permissions: { remoteOperatorUploadAccess: false,
        remoteOperatorRawReportAccess: false } })
  } catch (error) {
    return noStore({ success: false, error: safeError(error) }, 503)
  }
}

export async function POST(request: Request) {
  if (!dedicatedPreprod(request)) return noStore({ success: false,
    error: "QUALITY_REPORT_DEDICATED_PREPROD_ONLY" }, 403)
  const validation = await owner(request)
  if (!validation) return noStore({ success: false,
    error: "QUALITY_REPORT_OWNER_AUTH_REQUIRED" }, 403)
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
  if (!format || !fileName || !content) return noStore({ success: false,
    error: "QUALITY_REPORT_INPUT_INVALID" }, 400)
  try {
    const account = canonicalAccount()
    const snapshot = parseEbayListingQualityReportV1({ format, fileName,
      content, selectedWorksheet: typeof body?.selectedWorksheet === "string"
        ? body.selectedWorksheet : null })
    const monitor = await loadSellerOsAssistantMonitorSnapshotV1()
    const integrity = resolveCrossModuleLivePortfolioIntegrityV1(monitor)
    const live = currentLiveListingsForMonitorV1(monitor).map((listing) => ({
      listingKey: listing.key, itemId: listing.identity.itemId,
      sku: listing.identity.sku }))
    const supabase = getSupabaseAdminClient()
    const truth = await readExactProductTruthForLiveListingsV1({ supabase,
      accountKey: account.accountKey, itemIds: live.map((row) => row.itemId) })
    const prepared = prepareOwnerListingQualityReportImportV1({ snapshot,
      accountKey: account.accountKey, accountAlias: account.accountAlias,
      importedBy: validation.userId,
      liveScope: integrity.canonicalCohort, liveListings: live,
      productTruthByItemId: truth })
    const persisted = await persistOwnerListingQualityReportV1({ supabase,
      prepared })
    const status = await readOwnerListingQualityReportStatusV1({ supabase,
      accountKey: account.accountKey })
    return noStore({ success: true, importId: persisted.importId,
      idempotent: persisted.idempotent, status,
      guards: prepared.guards, safety: OWNER_QUALITY_REPORT_SAFETY_V1 })
  } catch (error) {
    return noStore({ success: false, error: safeError(error) }, 422)
  }
}
