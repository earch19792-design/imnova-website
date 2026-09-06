export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readSellerOsProductJourneyV1 } from
  "@/lib/seller-os/product-journey-read-model-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return NextResponse.json({ success: false,
    error: auth.error ?? "PRODUCT_JOURNEY_OWNER_AUTH_REQUIRED" },
  { status: auth.status || 403 })
  const candidateId = new URL(request.url).searchParams.get("candidateId")
    ?.trim() ?? ""
  if (!/^sha256:[0-9a-f]{64}$/.test(candidateId)) {
    return NextResponse.json({ success: false,
      error: "PRODUCT_JOURNEY_CANDIDATE_ID_INVALID" }, { status: 400 })
  }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false,
    error: "PRODUCT_JOURNEY_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 })
  try {
    const journey = await readSellerOsProductJourneyV1({
      supabase: getSupabaseAdminClient(), accountKey, candidateId,
    })
    const response = NextResponse.json({ success: true, journey,
      safety: { readOnly: true, databaseMutations: 0,
        marketplaceWrites: 0 } })
    response.headers.set("Cache-Control", "private, no-store, max-age=0")
    response.headers.set("X-Seller-Os-Projection",
      "SELLER_OS_PRODUCT_JOURNEY_V1")
    return response
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    const status = code === "PRODUCT_JOURNEY_NOT_FOUND" ? 404 : 503
    return NextResponse.json({ success: false,
      error: /^[A-Z][A-Z0-9_]{2,159}$/.test(code) ? code
        : "PRODUCT_JOURNEY_READ_FAILED",
      safety: { readOnly: true, databaseMutations: 0,
        marketplaceWrites: 0 } }, { status })
  }
}
