export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readProductionStockGuardV1 } from
  "@/lib/ebay/ebay-production-stock-read-service-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const headers = { "Cache-Control": "private, no-store, max-age=0" }

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return Response.json({ success: false,
    error: auth.error ?? "ADMIN_FORBIDDEN" },
  { status: auth.status || 403, headers })
  const scope = getEbaySellerAccountScopeConfiguration()
  if (!scope.accountKey || !scope.accountAlias) return Response.json({
    success: false, error: "STOCKGUARD_ACCOUNT_SCOPE_REQUIRED" },
  { status: 503, headers })
  try {
    const result = await readProductionStockGuardV1({
      supabase: getSupabaseAdminClient(), accountKey: scope.accountKey,
      accountAlias: scope.accountAlias, itemId: null,
      includeKnownListingStockEvidence: true,
    })
    return Response.json({ success: true, observedAt: result.observedAt,
      currentLiveState: result.currentLiveState,
      cohortComplete: result.cohortComplete,
      sourceStatus: result.sourceStatus,
      listings: result.listings.map((row) => ({
        itemId: row.itemId, sku: row.sku,
        identityStatus: row.identityStatus,
        stockguardLinkStatus: row.stockguardLinkStatus,
        linkAuthorityState: row.linkAuthorityState,
        supplierLinkage: row.supplierLinkage,
        components: row.components,
        supplierAvailability: row.supplierAvailability,
        certifiedListingCapacity: row.certifiedListingCapacity,
        stockGuardState: row.stockGuardState,
        stockFreshness: row.stockFreshness,
        stockObservedAt: row.stockObservedAt,
        stockFreshUntil: row.stockFreshUntil,
        limitationCode: row.limitationCode,
        marketplaceWriteAuthorized: "NOT_EVALUATED" as const,
      })),
      safety: { ebayWrites: 0, inventoryQuantityWrites: 0,
        durableWrites: 0 } }, { headers })
  } catch {
    return Response.json({ success: false,
      error: "STOCKGUARD_FRESHNESS_READ_UNAVAILABLE" },
    { status: 503, headers })
  }
}
