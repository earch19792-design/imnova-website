export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 15

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { PRODUCTION_STOCK_AUTHORITY_BINDING_V1 as binding,
  productionStockAuthorityConfigurationValidV1 } from "@/lib/ebay/ebay-production-stock-authority-binding-v1"
import { authorizeProductionStockReadV1, productionStockReadTransportV1,
  PRODUCTION_STOCK_READ_VERSION } from "@/lib/ebay/ebay-production-stock-read-boundary-v1"
import { readProductionStockGuardV1 } from "@/lib/ebay/ebay-production-stock-read-service-v1"

const safety = { marketplaceWrites: 0, publicationWrites: 0, offerWrites: 0,
  adsWrites: 0, stockClaims: 0, durableWrites: 0 }
const respond = (body: unknown, status: number) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "Vary": "x-seller-os-service-assertion, x-seller-os-caller" },
})

export async function GET(request: Request) {
  const authorization = await authorizeProductionStockReadV1(request)
  if (!authorization.allowed) return respond({ error: authorization.reason, safety }, 403)
  if (!productionStockAuthorityConfigurationValidV1(process.env)) return respond({
    error: "PRODUCTION_STOCK_CANONICAL_BINDING_CONFIGURATION_MISMATCH", safety }, 503)
  const authority = { service: binding.service, bindingVersion: binding.version,
    accountAlias: binding.accountAlias, serviceAuthenticated: true,
    productionAccountBindingPresent: true, productionAccountBindingCanonical: true,
    preprodRuntimeDependency: false, preprodSecretReused: false }
  const failures: string[] = []
  try {
    const supabase = getSupabaseAdminClient({ fetch: productionStockReadTransportV1({
      databaseUrl: binding.databaseUrl,
      accountKey: binding.accountKey, deadlineAt: Date.now() + 6_000,
      onFailure: code => { failures.push(code) },
    }) })
    const result = await readProductionStockGuardV1({ supabase,
      accountKey: binding.accountKey, accountAlias: binding.accountAlias,
      itemId: authorization.itemId })
    if (failures.length) return respond({ error: [...new Set(failures)].sort()[0],
      authority, safety }, 503)
    return respond({ contractVersion: PRODUCTION_STOCK_READ_VERSION,
      ...result, authority, safety }, 200)
  } catch {
    return respond({ error: [...new Set(failures)].sort()[0] ??
      "PRODUCTION_STOCK_CANONICAL_REPOSITORY_READ_FAILED", authority, safety }, 503)
  }
}

function denyWrite() { return respond({ error: "PRODUCTION_STOCK_READ_OPERATION_DENIED", safety }, 405) }
export const POST = denyWrite
export const PUT = denyWrite
export const PATCH = denyWrite
export const DELETE = denyWrite
