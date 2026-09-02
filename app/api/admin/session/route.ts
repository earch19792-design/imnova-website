export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { isSameSellerOsAdminOriginV1 } from "@/lib/admin-session-origin-v1"
import {
  SELLER_OS_ADMIN_SESSION_COOKIE,
  SELLER_OS_PUBLICATION_OAUTH_START_PATH,
  SELLER_OS_PUBLICATION_OAUTH_START_SESSION_COOKIE,
  sellerOsAdminSessionCookieOptions,
} from "@/lib/admin-session-cookie-contract"
import { SELLER_OS_ACCESS_ROLES } from "@/lib/seller-os-access-control"
import { validateSellerOsApiRequest } from "@/lib/supabase-admin"

const ADMIN_SESSION_VALIDATION_TIMEOUT_MS = 15_000

async function withValidationTimeout<T>(
  task: Promise<T>
) {
  let timeout: ReturnType<typeof setTimeout> |
    undefined

  try {
    return await Promise.race([
      task.then((value) => ({
        status: "COMPLETED" as const,
        value,
      })),
      new Promise<{
        status: "TIMED_OUT"
      }>((resolve) => {
        timeout = globalThis.setTimeout(
          () => resolve({
            status: "TIMED_OUT",
          }),
          ADMIN_SESSION_VALIDATION_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    if (timeout !== undefined) {
      globalThis.clearTimeout(timeout)
    }
  }
}

function sameOrigin(request: Request) {
  return isSameSellerOsAdminOriginV1({
    requestUrl: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  })
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "cross_site_request_rejected" }, { status: 403 })
  const validationResult =
    await withValidationTimeout(
      validateSellerOsApiRequest(request)
    )

  if (
    validationResult.status ===
    "TIMED_OUT"
  ) {
    return NextResponse.json({
      success: false,
      error:
        "admin_session_validation_timeout",
    }, {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    })
  }

  const validation = validationResult.value
  if (!validation.ok || !validation.userId ||
      validation.authenticationMode !== "seller_os_user" ||
      !validation.accessRole) {
    return NextResponse.json({ success: false,
      error: validation.error ?? "seller_os_session_rejected" },
    { status: validation.status })
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? ""
  const response = NextResponse.json({ success: true,
    role: validation.accessRole })
  response.cookies.set(
    SELLER_OS_ADMIN_SESSION_COOKIE,
    token,
    sellerOsAdminSessionCookieOptions("/admin", 60 * 60),
  )
  if (validation.accessRole === SELLER_OS_ACCESS_ROLES.owner) {
    response.cookies.set(
      SELLER_OS_PUBLICATION_OAUTH_START_SESSION_COOKIE,
      token,
      sellerOsAdminSessionCookieOptions(
        SELLER_OS_PUBLICATION_OAUTH_START_PATH,
        60 * 60,
      ),
    )
  } else {
    response.cookies.set(
      SELLER_OS_PUBLICATION_OAUTH_START_SESSION_COOKIE,
      "",
      sellerOsAdminSessionCookieOptions(
        SELLER_OS_PUBLICATION_OAUTH_START_PATH,
        0,
      ),
    )
  }
  response.headers.set("Cache-Control", "no-store")
  return response
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "cross_site_request_rejected" }, { status: 403 })
  const response = NextResponse.json({ success: true })
  response.cookies.set(
    SELLER_OS_ADMIN_SESSION_COOKIE,
    "",
    sellerOsAdminSessionCookieOptions("/admin", 0),
  )
  response.cookies.set(
    SELLER_OS_PUBLICATION_OAUTH_START_SESSION_COOKIE,
    "",
    sellerOsAdminSessionCookieOptions(
      SELLER_OS_PUBLICATION_OAUTH_START_PATH,
      0,
    ),
  )
  response.headers.set("Cache-Control", "no-store")
  return response
}
