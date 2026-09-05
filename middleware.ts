import { NextResponse, type NextRequest } from "next/server"
import {
  getBlockedEbayProResponsePayload,
  getEbayProRuntimeBoundary,
  isEbayOAuthNodeGuardedCeremonyPath,
} from "@/lib/ebay/environment-boundaries"
import { SELLER_OS_ACCESS_ROLES } from "@/lib/seller-os-access-control"

const ADMIN_COOKIE = "seller_os_admin_session"
const ADMIN_TOKEN_VERIFY_TIMEOUT_MS = 15_000
const RETIRED_PUBLIC_PREFIXES = ["/store", "/products", "/community", "/miembro", "/about", "/contact"]
const LEGACY_ADMIN_REDIRECTS: Readonly<Record<string, string>> = {
  "/admin/campaigns": "/admin",
  "/admin/products": "/admin",
  "/admin/self-improvement": "/admin",
  "/admin/marketplace-os": "/admin",
  "/admin/market-radar": "/admin/ebay/mobile-review",
  "/admin/ebay-pro": "/admin/ebay-seller-os",
  "/admin/ebay-listing": "/admin/ebay/listing-workspace",
  "/admin/ebay-listing-package": "/admin/ebay/listing-workspace",
  "/admin/ebay-image-generator": "/admin/ebay/listing-workspace",
}

function startsAtRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

type AdminTokenVerification =
  | "OWNER"
  | "REMOTE_OPERATOR"
  | "INVALID"
  | "UNAVAILABLE"

async function fetchWithAdminTimeout(
  input: string,
  init: RequestInit
) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    ADMIN_TOKEN_VERIFY_TIMEOUT_MS
  )

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

async function isVerifiedSellerOsToken(
  token: string
): Promise<AdminTokenVerification> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!token) return "INVALID"
  if (!url || !anonKey) return "UNAVAILABLE"
  try {
    const userResponse = await fetchWithAdminTimeout(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` }, cache: "no-store" })
    if (userResponse.status === 401 || userResponse.status === 403) return "INVALID"
    if (!userResponse.ok) return "UNAVAILABLE"
    const user = await userResponse.json() as {
      app_metadata?: { is_admin?: boolean; role?: string }
    }
    if (user.app_metadata?.is_admin === true ||
        user.app_metadata?.role === "admin") {
      return "OWNER"
    }
    if (user.app_metadata?.role ===
        SELLER_OS_ACCESS_ROLES.remoteLiveOptimizationOperator) {
      return "REMOTE_OPERATOR"
    }
    const permissionResponse = await fetchWithAdminTimeout(`${url}/rest/v1/rpc/is_admin`, { method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", cache: "no-store" })
    if (permissionResponse.status === 401 || permissionResponse.status === 403) return "INVALID"
    if (!permissionResponse.ok) return "UNAVAILABLE"
    return await permissionResponse.json() === true
      ? "OWNER"
      : "INVALID"
  } catch {
    return "UNAVAILABLE"
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (pathname === "/privacy-policy") return NextResponse.redirect(new URL("/privacy", request.url), 308)
  if (RETIRED_PUBLIC_PREFIXES.some((route) => startsAtRoute(pathname, route))) {
    return new NextResponse("Esta superficie ya no forma parte de Seller OS.", { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } })
  }

  const legacyEntry = Object.entries(LEGACY_ADMIN_REDIRECTS).find(([route]) => startsAtRoute(pathname, route))
  if (legacyEntry) return NextResponse.redirect(new URL(legacyEntry[1], request.url), 308)

  const boundary = getEbayProRuntimeBoundary({ pathname, method: request.method })
  const nodeGuardedOAuthCeremony =
    isEbayOAuthNodeGuardedCeremonyPath(pathname)
  if (boundary.blocked && !nodeGuardedOAuthCeremony) {
    if (pathname.startsWith("/api/")) return NextResponse.json(
      getBlockedEbayProResponsePayload(pathname, boundary), { status: 403 })
    return NextResponse.redirect(new URL("/admin", request.url), 307)
  }

  if (startsAtRoute(pathname, "/admin") && pathname !== "/admin/login") {
    const token = request.cookies.get(ADMIN_COOKIE)?.value ?? ""
    const verification =
      await isVerifiedSellerOsToken(token)
    if (!["OWNER", "REMOTE_OPERATOR"].includes(verification)) {
      const login = new URL("/admin/login", request.url)
      login.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`)
      if (verification === "UNAVAILABLE") {
        login.searchParams.set(
          "authError",
          "ADMIN_AUTH_TEMPORARILY_UNAVAILABLE"
        )
      }
      const response = NextResponse.redirect(login, 307)
      if (token && verification === "INVALID") response.cookies.set(ADMIN_COOKIE, "", { path: "/admin", maxAge: 0 })
      return response
    }
    if (verification === "REMOTE_OPERATOR" && pathname !== "/admin") {
      return NextResponse.redirect(new URL("/admin", request.url), 307)
    }
  }

  const response = NextResponse.next()
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("Referrer-Policy", "same-origin")
  response.headers.set("X-Content-Type-Options", "nosniff")
  return response
}

export const config = {
  matcher: [
    "/admin/:path*", "/store/:path*", "/products/:path*", "/community/:path*", "/miembro/:path*", "/about/:path*", "/contact/:path*", "/privacy-policy",
    "/api/admin/market-radar/:path*", "/api/admin/ebay-winner-pipeline/:path*", "/api/admin/active-listing-risks/:path*", "/api/admin/ebay/oauth/:path*", "/api/admin/ebay/:path*",
  ],
}
