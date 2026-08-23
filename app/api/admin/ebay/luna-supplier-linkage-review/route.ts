export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"

import {
  SELLER_OS_LUNA_LINKAGE_APPROVAL_CSRF_TTL_MS,
  SellerOsLunaLinkageApprovalControlPlaneError,
  assertSellerOsLunaLinkageApprovalAdminV1,
  executeSellerOsLunaLinkageApprovalDecisionV1,
} from "@/lib/ebay/ebay-luna-linkage-approval-control-plane-v1"
import {
  SellerOsLunaLinkageApprovalAdminServerError,
  buildSellerOsLunaLinkageAdminReviewPayloadV1,
  getSellerOsLunaLinkageApprovalAdminCsrfBoundaryV1,
  loadSellerOsLunaLinkageAdminReviewV1,
  parseSellerOsLunaLinkageAdminDecisionRequestV1,
} from "@/lib/ebay/ebay-luna-linkage-approval-admin-server-v1"
import {
  createSellerOsLunaLinkageApprovalRepositoryV1,
} from "@/lib/ebay/ebay-luna-linkage-approval-repository-v1"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

const CSRF_COOKIE = "seller_os_luna_linkage_approval_csrf"
const ENDPOINT = "/api/admin/ebay/luna-supplier-linkage-review"
const MAXIMUM_REQUEST_BYTES = 2_048
const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, no-cache, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
})

function protectedCookieOptions(request: NextRequest, maxAge: number) {
  const forwarded = request.headers.get("x-forwarded-proto")
  return {
    httpOnly: true,
    secure: forwarded === "https" || request.nextUrl.protocol === "https:",
    sameSite: "strict" as const,
    path: ENDPOINT,
    maxAge,
    priority: "high" as const,
  }
}

function bearerToken(request: NextRequest) {
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  )
  return match?.[1] ?? ""
}

function safeCode(cause: unknown) {
  if (cause instanceof SellerOsLunaLinkageApprovalControlPlaneError ||
      cause instanceof SellerOsLunaLinkageApprovalAdminServerError) {
    return cause.code
  }
  const code = cause instanceof Error ? cause.message : ""
  return /^[A-Z0-9_]{3,160}$/.test(code)
    ? code : "LUNA_LINKAGE_ADMIN_REVIEW_FAILED_CLOSED"
}

function errorStatus(code: string) {
  if (code.includes("ADMIN_USER_REQUIRED")) return 403
  if (code.includes("CALLER_INPUT")) return 400
  if (code.includes("CSRF")) return 403
  if (code.includes("STALE") || code.includes("CONFLICT") ||
      code.includes("CURRENT_COHORT") || code.includes("DECISION_NOT_ALLOWED") ||
      code.includes("EXACT_EVIDENCE_REQUIRED")) return 409
  return 503
}

async function readDecisionRequest(request: NextRequest) {
  const body = await request.text()
  if (!body || Buffer.byteLength(body, "utf8") > MAXIMUM_REQUEST_BYTES) {
    throw new SellerOsLunaLinkageApprovalAdminServerError(
      "LUNA_LINKAGE_ADMIN_DECISION_CALLER_INPUT_REJECTED",
    )
  }
  let value: unknown
  try { value = JSON.parse(body) } catch {
    throw new SellerOsLunaLinkageApprovalAdminServerError(
      "LUNA_LINKAGE_ADMIN_DECISION_CALLER_INPUT_REJECTED",
    )
  }
  return parseSellerOsLunaLinkageAdminDecisionRequestV1(value)
}

function safeFailure(cause: unknown) {
  const code = safeCode(cause)
  return NextResponse.json({
    success: false,
    error: code,
    credentialsIncluded: false,
    cookiesIncluded: false,
    buyerPiiIncluded: false,
  }, { status: errorStatus(code), headers: HEADERS })
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.search) {
    return safeFailure(new SellerOsLunaLinkageApprovalAdminServerError(
      "LUNA_LINKAGE_ADMIN_REVIEW_CALLER_SCOPE_REJECTED",
    ))
  }
  try {
    const auth = await validateAdminApiRequest(request)
    const actorUserId = assertSellerOsLunaLinkageApprovalAdminV1(auth)
    const loaded = await loadSellerOsLunaLinkageAdminReviewV1(
      getSupabaseAdminClient(),
    )
    const csrf = getSellerOsLunaLinkageApprovalAdminCsrfBoundaryV1().issue({
      actorUserId,
      adminSessionToken: bearerToken(request),
      requestUrl: request.url,
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      currentCohortId: loaded.reviewSet.currentCohortId,
      reviewSetDigest: loaded.reviewSet.reviewSetDigest,
    })
    const response = NextResponse.json(
      buildSellerOsLunaLinkageAdminReviewPayloadV1({ loaded, csrf }),
      { status: 200, headers: HEADERS },
    )
    response.cookies.set(CSRF_COOKIE, csrf.csrfToken,
      protectedCookieOptions(request,
        Math.floor(SELLER_OS_LUNA_LINKAGE_APPROVAL_CSRF_TTL_MS / 1_000)))
    return response
  } catch (cause) {
    return safeFailure(cause)
  }
}

export async function POST(request: NextRequest) {
  let csrfConsumed = false
  try {
    const auth = await validateAdminApiRequest(request)
    const actorUserId = assertSellerOsLunaLinkageApprovalAdminV1(auth)
    const decisionRequest = await readDecisionRequest(request)
    const client = getSupabaseAdminClient()
    const loaded = await loadSellerOsLunaLinkageAdminReviewV1(client)
    const csrfReceipt =
      getSellerOsLunaLinkageApprovalAdminCsrfBoundaryV1().consume({
        actorUserId,
        adminSessionToken: bearerToken(request),
        requestUrl: request.url,
        origin: request.headers.get("origin"),
        secFetchSite: request.headers.get("sec-fetch-site"),
        currentCohortId: loaded.reviewSet.currentCohortId,
        reviewSetDigest: loaded.reviewSet.reviewSetDigest,
        contentType: request.headers.get("content-type"),
        csrfHeader: request.headers.get("x-seller-os-csrf"),
        csrfCookie: request.cookies.get(CSRF_COOKIE)?.value ?? null,
      })
    csrfConsumed = true
    // Avoid expanding Supabase's recursive schema generics at this boundary;
    // the repository itself validates the narrow RPC/read contract.
    const repository = createSellerOsLunaLinkageApprovalRepositoryV1(
      client as never,
    )
    const receipt = await executeSellerOsLunaLinkageApprovalDecisionV1({
      adminValidation: auth,
      csrfReceipt,
      request: decisionRequest,
      currentReviewSet: loaded.reviewSet,
      durableStore: repository.recordDecision,
    })
    const response = NextResponse.json({
      success: true,
      receipt,
      safety: Object.freeze({
        humanDecisionWrite: 1,
        lunaStockReads: 0,
        productionLunaPolling: 0,
        lunaStockJobsCreated: 0,
        certifiedOosProduced: false,
        ebayWrites: 0,
        marketplaceWrites: 0,
        credentialsIncluded: false,
        cookiesIncluded: false,
        buyerPiiIncluded: false,
      }),
    }, { status: receipt.idempotent ? 200 : 201, headers: HEADERS })
    response.cookies.set(CSRF_COOKIE, "", {
      ...protectedCookieOptions(request, 0), maxAge: 0,
    })
    return response
  } catch (cause) {
    const response = safeFailure(cause)
    if (csrfConsumed) {
      response.cookies.set(CSRF_COOKIE, "", {
        ...protectedCookieOptions(request, 0), maxAge: 0,
      })
    }
    return response
  }
}
