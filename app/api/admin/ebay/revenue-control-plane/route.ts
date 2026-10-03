export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readSellerOsRevenueControlPlaneV1 } from
  "@/lib/ebay/seller-os-revenue-control-plane-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const headers = { "Cache-Control": "private, no-store, max-age=0" }

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return Response.json({ error: auth.error ?? "ADMIN_FORBIDDEN" },
    { status: auth.status || 403, headers })
  const scope = getEbaySellerAccountScopeConfiguration()
  if (!scope.accountKey || !scope.accountAlias) return Response.json({
    error: "REVENUE_CONTROL_ACCOUNT_SCOPE_REQUIRED" },
    { status: 503, headers })
  try {
    const result = await readSellerOsRevenueControlPlaneV1({
      supabase: getSupabaseAdminClient(), accountKey: scope.accountKey,
      accountAlias: scope.accountAlias,
    })
    return Response.json(result, { headers,
      status: result.portfolioStatus === "PROVEN" ? 200 : 503 })
  } catch {
    return Response.json({ error: "REVENUE_CONTROL_READ_UNAVAILABLE",
      portfolioCount: null, rows: [],
      safety: { ebayWrites: 0, publicationWrites: 0, durableWrites: 0 } },
    { status: 503, headers })
  }
}
