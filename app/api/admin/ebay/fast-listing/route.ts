import { NextResponse } from "next/server"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { loadFastListingV1, projectLoadedFastListingV1, readFastCatalogV1, runFastListingActionV1,
  startFastListingV1, type FastScope } from "@/lib/seller-os/fast-listing-runtime-v1"
import { goldenRecord as record } from "@/lib/ebay/commercial-golden-path-domain-v1"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
function code(error: unknown) { return error instanceof Error && /^[A-Z][A-Z0-9_]{2,119}$/.test(error.message) ? error.message : "FAST_LISTING_REQUEST_FAILED" }
async function scope(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return { error: response({ success: false, error: auth.error }, auth.status) }
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) throw Error("FAST_LISTING_ACCOUNT_REQUIRED")
  const supabase = getSupabaseAdminClient()
  let ownerId = auth.userId
  if (!ownerId && auth.authenticationMode === "service_role") {
    const owners = await supabase.from("seller_os_commercial_trace_command_capabilities_v1").select("owner_user_id")
      .eq("marketplace_account_key", accountKey).eq("enabled", true).limit(20)
    const ids = [...new Set((owners.data ?? []).map(o => o.owner_user_id))]
    if (owners.error || ids.length !== 1) throw Error("FAST_LISTING_CANONICAL_OWNER_REQUIRED")
    ownerId = ids[0]
  }
  if (!ownerId) throw Error("FAST_LISTING_OWNER_REQUIRED")
  return { value: { supabase, accountKey, ownerId } satisfies FastScope, ownerAction: auth.authenticationMode !== "service_role" }
}
export async function GET(request: Request) {
  try {
    const auth = await scope(request); if (auth.error) return auth.error
    const params = new URL(request.url).searchParams, id = params.get("opportunityId")
    if (id) return response({ success: true, view: projectLoadedFastListingV1(auth.value!, await loadFastListingV1(auth.value!, id)) })
    return response({ success: true, catalog: await readFastCatalogV1(auth.value!, params.get("search") ?? "", params.get("category") ?? "") })
  } catch (error) { return response({ success: false, error: code(error) }, 400) }
}
export async function POST(request: Request) {
  try {
    const auth = await scope(request); if (auth.error) return auth.error
    const bytes = await request.text(); if (bytes.length > 16000) throw Error("FAST_LISTING_INPUT_TOO_LARGE")
    const body = record(JSON.parse(bytes)), action = String(body.action ?? "")
    if (action === "START") {
      const started = await startFastListingV1(auth.value!, { productId: typeof body.productId === "string" ? body.productId : undefined,
        variantId: typeof body.variantId === "string" ? body.variantId : undefined, sku: typeof body.sku === "string" ? body.sku : undefined })
      const id = String(record(started.opportunity).id)
      try { await runFastListingActionV1(auth.value!, id, "EVALUATE") } catch { /* Durable recovery owns the failed operation. */ }
      return response({ success: true, view: projectLoadedFastListingV1(auth.value!, await loadFastListingV1(auth.value!, id)) })
    }
    const id = String(body.opportunityId ?? "")
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error("FAST_LISTING_CASE_ID_INVALID")
    return response({ success: true, view: await runFastListingActionV1(auth.value!, id, action, body, auth.ownerAction),
      safety: { marketplaceWrites: 0, purchases: 0, automaticPublications: 0 } })
  } catch (error) { const c = code(error); return response({ success: false, error: c }, c === "FAST_LISTING_REVISION_CONFLICT" ? 409 : 400) }
}
