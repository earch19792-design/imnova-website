import {
  NextResponse,
  type NextRequest,
} from "next/server"
import {
  getBlockedEbayProResponsePayload,
  getEbayProRuntimeBoundary,
} from "@/lib/ebay/environment-boundaries"

export function middleware(
  request: NextRequest
) {
  const pathname =
    request.nextUrl.pathname

  const boundary =
    getEbayProRuntimeBoundary({
      pathname,
    })

  if (!boundary.blocked) {
    return NextResponse.next()
  }

  if (
    pathname.startsWith(
      "/api/"
    )
  ) {
    return NextResponse.json(
      getBlockedEbayProResponsePayload(
        pathname
      ),
      {
        status: 403,
      }
    )
  }

  return NextResponse.redirect(
    new URL(
      "/admin",
      request.url
    ),
    307
  )
}

export const config = {
  matcher: [
    "/admin/market-radar/:path*",
    "/admin/ebay-seller-os/:path*",
    "/admin/ebay-listing/:path*",
    "/admin/ebay-listing-package/:path*",
    "/admin/ebay-listings/:path*",
    "/admin/ebay-image-generator/:path*",
    "/api/admin/market-radar/:path*",
    "/api/admin/ebay-winner-pipeline/:path*",
    "/api/admin/active-listing-risks/:path*",
    "/api/admin/ebay/oauth/:path*",
  ],
}
