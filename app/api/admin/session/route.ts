export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { isSameSellerOsAdminOriginV1 } from "@/lib/admin-session-origin-v1"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

const SELLER_OS_ADMIN_COOKIE = "seller_os_admin_session"
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
      validateAdminApiRequest(request)
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
  if (!validation.ok || !validation.userId || validation.authenticationMode !== "admin_user") {
    return NextResponse.json({ success: false, error: validation.error ?? "admin_session_rejected" }, { status: validation.status })
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? ""
  const response = NextResponse.json({ success: true, role: "ADMIN" })
  response.cookies.set(SELLER_OS_ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: 60 * 60,
  })
  response.headers.set("Cache-Control", "no-store")
  return response
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "cross_site_request_rejected" }, { status: 403 })
  const response = NextResponse.json({ success: true })
  response.cookies.set(SELLER_OS_ADMIN_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/admin", maxAge: 0 })
  response.headers.set("Cache-Control", "no-store")
  return response
}
