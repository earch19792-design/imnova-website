export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { parseDirectedLunaProductUrl } from
  "@/lib/ebay/ebay-luna-directed-product-import"
import { readSellerOsLiveCommercialTraceV1,
  runSellerOsLiveCommercialTraceV1 } from
  "@/lib/ebay/seller-os-live-commercial-trace-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

function response(payload: unknown, status = 200) {
  const result = NextResponse.json(payload, { status })
  result.headers.set("Cache-Control", "private, no-store, max-age=0")
  return result
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code)
    ? code : "LIVE_COMMERCIAL_TRACE_REQUEST_FAILED"
}

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return response({ success: false, error: auth.error },
    auth.status)
  try {
    const traceId = new URL(request.url).searchParams.get("traceId")?.trim()
      ?? null
    if (traceId && !/^[0-9a-f-]{36}$/i.test(traceId)) return response({
      success: false, error: "LIVE_COMMERCIAL_TRACE_ID_INVALID" }, 400)
    const data = await readSellerOsLiveCommercialTraceV1({
      supabase: getSupabaseAdminClient(), traceId })
    return response({ success: true, ...data,
      liveUpdateWithoutRefresh: true,
      safety: { publicationWrites: 0, ebayWrites: 0,
        canPublish: false, purchaseAllowed: false } })
  } catch (error) {
    return response({ success: false, error: safeCode(error) }, 400)
  }
}

export async function POST(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return response({ success: false, error: auth.error },
    auth.status)
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return response({ success: false,
    error: "LIVE_COMMERCIAL_TRACE_ACCOUNT_SCOPE_REQUIRED" }, 400)
  try {
    const body = await request.json() as Record<string, unknown>
    if (body.action !== "START") return response({ success: false,
      error: "LIVE_COMMERCIAL_TRACE_ACTION_INVALID" }, 400)
    const productUrl = typeof body.productUrl === "string"
      ? body.productUrl : ""
    parseDirectedLunaProductUrl(productUrl)
    const result = await runSellerOsLiveCommercialTraceV1({
      supabase: getSupabaseAdminClient(), accountKey, productUrl,
      actorUserId: auth.userId })
    return response({ success: true, ...result,
      liveUpdateWithoutRefresh: true,
      safety: { publicationWrites: 0, ebayWrites: 0,
        canPublish: false, purchaseAllowed: false } })
  } catch (error) {
    return response({ success: false, error: safeCode(error),
      safety: { publicationWrites: 0, ebayWrites: 0,
        canPublish: false, purchaseAllowed: false } }, 400)
  }
}
