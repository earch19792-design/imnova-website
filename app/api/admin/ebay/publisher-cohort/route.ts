export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readSellerOsPublisherOperationalCohortV1 } from
  "@/lib/ebay/seller-os-publisher-operational-cohort-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok || !auth.userId) return NextResponse.json({ success: false,
    error: auth.error ?? "PUBLISHER_COHORT_OWNER_AUTH_REQUIRED" },
  { status: auth.status || 403 })
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) return NextResponse.json({ success: false,
    error: "PUBLISHER_COHORT_ACCOUNT_SCOPE_REQUIRED" }, { status: 503 })
  try {
    const cohort = await readSellerOsPublisherOperationalCohortV1({
      supabase: getSupabaseAdminClient(), accountKey,
      actorUserId: auth.userId,
    })
    const response = NextResponse.json({ success: true, cohort })
    response.headers.set("Cache-Control", "private, no-store, max-age=0")
    return response
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    return NextResponse.json({ success: false,
      error: /^[A-Z][A-Z0-9_]{2,159}$/.test(code) ? code
        : "PUBLISHER_COHORT_READ_FAILED",
      safety: { marketplaceWrites: 0, databaseMutations: 0 } },
    { status: 503 })
  }
}
