export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { isSameSellerOsAdminOriginV1 } from
  "@/lib/admin-session-origin-v1"
import { getEbayProRuntimeBoundary } from
  "@/lib/ebay/environment-boundaries"
import {
  createRemoteLiveOperatorInvitation,
  enrollRemoteLiveOperator,
  readRemoteLiveOperatorEnrollmentStatus,
  REMOTE_LIVE_OPERATOR_INVITATION_TTL_SECONDS,
} from "@/lib/remote-live-operator-enrollment"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function sameOrigin(request: Request) {
  return isSameSellerOsAdminOriginV1({
    requestUrl: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  })
}

function dedicatedPreprod(request: Request) {
  return getEbayProRuntimeBoundary({
    pathname: new URL(request.url).pathname,
    method: request.method,
  }).runtime === "seller_os_dedicated_preprod"
}

async function body(request: Request) {
  try {
    const parsed = await request.json()
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^REMOTE_OPERATOR_[A-Z0-9_]{3,160}$/.test(code)
    ? code : "REMOTE_OPERATOR_ENROLLMENT_FAILED"
}

function noStore(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
    },
  })
}

export async function GET(request: Request) {
  if (!sameOrigin(request)) return noStore({ success: false,
    error: "REMOTE_OPERATOR_ENROLLMENT_CROSS_SITE_REJECTED" }, 403)
  if (!dedicatedPreprod(request)) return noStore({ success: false,
    error: "REMOTE_OPERATOR_ENROLLMENT_DEDICATED_PREPROD_ONLY" }, 403)
  const validation = await validateAdminApiRequest(request)
  if (!validation.ok || validation.authenticationMode !== "admin_user" ||
      !validation.userId) return noStore({ success: false,
    error: validation.error ?? "REMOTE_OPERATOR_OWNER_AUTH_REQUIRED" },
  validation.status || 403)
  try {
    const status = await readRemoteLiveOperatorEnrollmentStatus(
      getSupabaseAdminClient(),
    )
    return noStore({ success: true,
      configured: status.configured,
      exactSingleton: status.exactSingleton,
      enrollmentAvailable: !status.configured &&
        !status.fixedSlotOccupiedByAnotherAuthority })
  } catch (error) {
    return noStore({ success: false, error: safeError(error) }, 503)
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return noStore({ success: false,
    error: "REMOTE_OPERATOR_ENROLLMENT_CROSS_SITE_REJECTED" }, 403)
  if (!dedicatedPreprod(request)) return noStore({ success: false,
    error: "REMOTE_OPERATOR_ENROLLMENT_DEDICATED_PREPROD_ONLY" }, 403)

  const validation = await validateAdminApiRequest(request)
  if (!validation.ok || validation.authenticationMode !== "admin_user" ||
      !validation.userId) return noStore({ success: false,
    error: validation.error ?? "REMOTE_OPERATOR_OWNER_AUTH_REQUIRED" },
  validation.status || 403)

  try {
    const supabase = getSupabaseAdminClient()
    const status = await readRemoteLiveOperatorEnrollmentStatus(supabase)
    if (status.configured) return noStore({ success: false,
      error: "REMOTE_OPERATOR_ALREADY_CONFIGURED",
      enrollmentClosed: true }, 409)
    if (status.fixedSlotOccupiedByAnotherAuthority) {
      return noStore({ success: false,
        error: "REMOTE_OPERATOR_SINGLETON_SLOT_CONFLICT" }, 409)
    }
    const invitation = await createRemoteLiveOperatorInvitation()
    const url = new URL("/admin/login", request.url)
    url.hash = `remoteSetup=${encodeURIComponent(invitation)}`
    return noStore({ success: true,
      setupUrl: url.toString(),
      expiresInSeconds: REMOTE_LIVE_OPERATOR_INVITATION_TTL_SECONDS,
      enrollmentClosedAfterSuccess: true })
  } catch (error) {
    return noStore({ success: false, error: safeError(error) }, 409)
  }
}

export async function PUT(request: Request) {
  if (!sameOrigin(request)) return noStore({ success: false,
    error: "REMOTE_OPERATOR_ENROLLMENT_CROSS_SITE_REJECTED" }, 403)
  if (!dedicatedPreprod(request)) return noStore({ success: false,
    error: "REMOTE_OPERATOR_ENROLLMENT_DEDICATED_PREPROD_ONLY" }, 403)
  const input = await body(request)
  if (!input) return noStore({ success: false,
    error: "REMOTE_OPERATOR_ENROLLMENT_INPUT_INVALID" }, 400)
  try {
    const result = await enrollRemoteLiveOperator({
      supabase: getSupabaseAdminClient(),
      invitation: input.invitation,
      username: input.username,
      password: input.password,
    })
    return noStore({ success: true,
      accountCreated: result.created,
      role: result.role,
      enrollmentClosed: true })
  } catch (error) {
    const code = safeError(error)
    const status = code === "REMOTE_OPERATOR_ALREADY_CONFIGURED" ? 409 :
      code.includes("INVALID") || code.includes("PASSWORD_POLICY") ? 400 :
        409
    return noStore({ success: false, error: code,
      enrollmentClosed: code === "REMOTE_OPERATOR_ALREADY_CONFIGURED" },
    status)
  }
}
