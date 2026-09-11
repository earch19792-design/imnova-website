export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { authorizeProductionStockReadV1, productionStockReadTransportV1,
  PRODUCTION_STOCK_READ_VERSION } from "@/lib/ebay/ebay-production-stock-read-boundary-v1"
import { readProductionStockGuardV1 } from "@/lib/ebay/ebay-production-stock-read-service-v1"

const safety = { marketplaceWrites: 0, publicationWrites: 0, offerWrites: 0,
  adsWrites: 0, stockClaims: 0, durableWrites: 0 }
const respond = (body: unknown, status: number) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "Vary": "Authorization, x-seller-os-caller" },
})

export async function GET(request: Request) {
  const authorization = authorizeProductionStockReadV1(request)
  if (!authorization.allowed) return respond({ error: authorization.reason, safety }, 403)
  const account = getEbaySellerAccountScopeConfiguration()
  if (!account.accountKey || !account.accountAlias) return respond({
    error: "PRODUCTION_STOCK_ACCOUNT_AUTHORITY_UNCONFIGURED", safety }, 503)
  try {
    const supabase = getSupabaseAdminClient({ fetch: productionStockReadTransportV1({
      databaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      accountKey: account.accountKey, deadlineAt: Date.now() + 6_000,
    }) })
    const result = await readProductionStockGuardV1({ supabase,
      accountKey: account.accountKey, accountAlias: account.accountAlias,
      itemId: authorization.itemId })
    return respond({ contractVersion: PRODUCTION_STOCK_READ_VERSION,
      ...result, safety }, 200)
  } catch {
    return respond({ error: "PRODUCTION_STOCK_DURABLE_AUTHORITY_UNAVAILABLE", safety }, 503)
  }
}

function denyWrite() { return respond({ error: "PRODUCTION_STOCK_READ_OPERATION_DENIED", safety }, 405) }
export const POST = denyWrite
export const PUT = denyWrite
export const PATCH = denyWrite
export const DELETE = denyWrite
