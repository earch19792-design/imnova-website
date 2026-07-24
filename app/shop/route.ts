export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  getEbayPublicStorefront,
} from "@/lib/ebay/ebay-public-storefront"

export async function GET(request: Request) {
  const storefront = getEbayPublicStorefront()
  if (!storefront.preferredShareUrl) {
    return NextResponse.json(
      {
        success: false,
        error: storefront.reason,
      },
      { status: 503 },
    )
  }
  return NextResponse.redirect(
    new URL(storefront.preferredShareUrl),
    {
      status: 307,
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  )
}
