export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 10

import { NextResponse } from "next/server"

import { preflightLunaProductSource } from
  "@/lib/ebay/product-case-runner-preflight"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

const SAFETY = {
  readOnly: true,
  serverPersistence: false,
  supabaseWrites: 0,
  ebayCalls: 0,
  ebayWrites: 0,
  openAiCalls: 0,
  whatsappCalls: 0,
  imageDownloads: 0,
  credentialsForwarded: false,
  cookiesForwarded: false,
  rawBodyReturned: false,
} as const

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const

function failure(error: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      error,
      accessStatus: "SOURCE_REJECTED",
      safety: SAFETY,
    },
    { status, headers: RESPONSE_HEADERS },
  )
}

function errorStatus(code: string) {
  if (
    code === "PRODUCT_CASE_SOURCE_URL_INVALID" ||
    code === "PRODUCT_CASE_SOURCE_DNS_NOT_PUBLIC" ||
    code === "PRODUCT_CASE_SOURCE_REDIRECT_REJECTED"
  ) return 400
  if (code === "PRODUCT_CASE_SOURCE_RESPONSE_TOO_LARGE") return 413
  if (code === "PRODUCT_CASE_SOURCE_CONTENT_TYPE_REJECTED") return 415
  if (
    code === "PRODUCT_CASE_SOURCE_TIMEOUT" ||
    code === "PRODUCT_CASE_SOURCE_DNS_TIMEOUT"
  ) return 504
  if (code === "PRODUCT_CASE_PREFLIGHT_CAPTURED_AT_INVALID") return 500
  return 502
}

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^PRODUCT_CASE_(?:PREFLIGHT|SOURCE)_[A-Z0-9_]+$/.test(message)
    ? message
    : "PRODUCT_CASE_SOURCE_REQUEST_FAILED"
}

export async function GET(req: Request) {
  let authentication: Awaited<ReturnType<typeof validateAdminApiRequest>>
  try {
    authentication = await validateAdminApiRequest(req)
  } catch {
    return failure("admin_auth_unavailable", 503)
  }
  if (!authentication.ok) {
    return failure(
      authentication.error ?? "admin_forbidden",
      authentication.status || 403,
    )
  }

  const requestUrl = new URL(req.url)
  const sourceUrls = requestUrl.searchParams.getAll("sourceUrl")
  if (sourceUrls.length !== 1) {
    return failure("PRODUCT_CASE_SOURCE_URL_INVALID", 400)
  }

  try {
    const result = await preflightLunaProductSource({
      sourceUrl: sourceUrls[0],
      capturedAt: new Date().toISOString(),
    })
    return NextResponse.json(
      {
        success: true,
        ...result,
        safety: SAFETY,
      },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    const code = safeErrorCode(error)
    return failure(code, errorStatus(code))
  }
}
