export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

const SELLER_OS_ADMIN_COOKIE = "seller_os_admin_session"

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite && fetchSite !== "same-origin") return false
  return !origin || origin === new URL(request.url).origin
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ success: false, error: "cross_site_request_rejected" }, { status: 403 })
  const validation = await validateAdminApiRequest(request)
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
