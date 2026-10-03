export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readProductionStockGuardV1 } from
  "@/lib/ebay/ebay-production-stock-read-service-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const headers = { "Cache-Control": "private, no-store, max-age=0" }
const itemIdPattern = /^\d{9,20}$/
const safeImage = (value: unknown) => typeof value === "string" &&
  /^https:\/\/cdn\.shopify\.com\/s\/files\/1\/0798\/2520\/7520\//.test(value)
  ? value : null
const safeSourceUrl = (value: unknown) => {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" &&
      (url.hostname === "lunaportex.com" ||
        url.hostname === "www.lunaportex.com") ? url.toString() : null
  } catch { return null }
}

function fail(code: string, status = 409) {
  return Response.json({ success: false, error: code,
    safety: { ebayWrites: 0, quantityWrites: 0, publication: 0 } },
  { status, headers })
}

async function target(itemId: string) {
  const scope = getEbaySellerAccountScopeConfiguration()
  if (!scope.accountKey || !scope.accountAlias) {
    throw Error("STOCKGUARD_ACCOUNT_SCOPE_REQUIRED")
  }
  const supabase = getSupabaseAdminClient()
  const readback = await readProductionStockGuardV1({ supabase,
    accountKey: scope.accountKey, accountAlias: scope.accountAlias,
    itemId, includeKnownListingStockEvidence: true })
  const row = readback.listings.find((entry) => entry.itemId === itemId)
  const component = row?.components[0]
  if (!readback.cohortComplete || row?.supplierLinkage !== "CERTIFIED" ||
      row.liveStatus !== "LIVE_ACTIVE" || row.components.length !== 1 ||
      !component?.supplierProductId || !component.supplierVariantId ||
      !component.supplierSku || row.identityQuarantine) {
    throw Error("STOCKGUARD_EXACT_CERTIFIED_LIVE_LINK_REQUIRED")
  }
  const [authority, decision, source] = await Promise.all([
    supabase.from("seller_os_listing_product_link_authorities_v1")
      .select("linkage_id,evidence_maximum_age_seconds,luna_product_id,luna_variant_id,luna_sku")
      .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
      .eq("ebay_item_id", itemId).eq("lifecycle_state", "ACTIVE")
      .limit(1).maybeSingle(),
    supabase.from("seller_os_luna_linkage_decisions")
      .select("decision,linkage_id,evidence_maximum_age_seconds,luna_product_id,luna_variant_id,luna_sku")
      .eq("account_key", scope.accountKey).eq("marketplace_id", "EBAY_US")
      .eq("ebay_item_id", itemId)
      .order("decision_version", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("market_radar_latest_variants")
      .select("title,variant_title,featured_image_url,image_urls,product_url,sku,supplier_product_id,supplier_variant_id")
      .eq("source_key", "lunaportex")
      .eq("supplier_product_id", component.supplierProductId)
      .eq("supplier_variant_id", component.supplierVariantId)
      .eq("sku", component.supplierSku).limit(2),
  ])
  if (authority.error || decision.error || source.error ||
      (source.data?.length ?? 0) > 1) {
    throw Error("STOCKGUARD_MANUAL_SOURCE_READ_FAILED")
  }
  // The canonical reader certifies exact approved decisions predating the
  // active-authority table. Reuse that durable source for OWNER stock evidence.
  const durable = authority.data ??
    (row.linkAuthorityState === "APPROVED_DURABLE_DECISION" &&
      decision.data?.decision === "APPROVE_EXACT_LINKAGE" ? decision.data : null)
  const maximumAgeSeconds = durable?.evidence_maximum_age_seconds
  if (!durable || durable.luna_product_id !== component.supplierProductId ||
      durable.luna_variant_id !== component.supplierVariantId ||
      durable.luna_sku !== component.supplierSku ||
      !/^luna-linkage-v1:sha256:[0-9a-f]{64}$/.test(durable.linkage_id) ||
      !Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 60 ||
      maximumAgeSeconds > 21600) {
    throw Error("STOCKGUARD_MANUAL_EXACT_DURABLE_AUTHORITY_REQUIRED")
  }
  const eligible = (row.stockFreshness === "UNKNOWN" ||
    row.stockFreshness === "STALE") && (source.data?.length ?? 0) === 1
  const luna = source.data?.[0] ?? null
  return { supabase, scope, row, component, durable, eligible,
    blocker: eligible ? null : row.stockFreshness === "FRESH"
      ? "STOCKGUARD_FRESH_STOCK_ALREADY_AVAILABLE"
      : "STOCKGUARD_MANUAL_EXACT_LUNA_SOURCE_REQUIRED",
    luna: luna ? { title: luna.title, variantTitle: luna.variant_title,
      imageUrl: safeImage(luna.featured_image_url) ??
        safeImage(Array.isArray(luna.image_urls) ? luna.image_urls[0] : null),
      sku: luna.sku, productId: luna.supplier_product_id,
      variantId: luna.supplier_variant_id,
      productUrl: safeSourceUrl(luna.product_url) } : null }
}

export async function GET(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return fail(auth.error ?? "ADMIN_FORBIDDEN", auth.status || 403)
  if (!auth.userId) return fail("STOCKGUARD_OWNER_REQUIRED", 403)
  const itemId = new URL(request.url).searchParams.get("itemId") ?? ""
  if (!itemIdPattern.test(itemId)) return fail("STOCKGUARD_ITEM_ID_INVALID", 400)
  try {
    const found = await target(itemId)
    return Response.json({ success: true, item: {
      itemId, title: found.row.title,
      stockFreshness: found.row.stockFreshness,
      stockState: found.row.stockGuardState,
      stockObservedAt: found.row.stockObservedAt,
      supplierSku: found.component.supplierSku,
      productId: found.component.supplierProductId,
      variantId: found.component.supplierVariantId,
    }, luna: found.luna,
      eligible: found.eligible,
      blocker: found.blocker,
      safety: { ebayWrites: 0, quantityWrites: 0, publication: 0 } }, { headers })
  } catch (error) {
    return fail(error instanceof Error ? error.message :
      "STOCKGUARD_MANUAL_READ_FAILED", 503)
  }
}

export async function POST(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return fail(auth.error ?? "ADMIN_FORBIDDEN", auth.status || 403)
  if (!auth.userId) return fail("STOCKGUARD_OWNER_REQUIRED", 403)
  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch {
    return fail("STOCKGUARD_MANUAL_INPUT_INVALID", 400)
  }
  const itemId = String(body.itemId ?? "")
  const state = String(body.stockState ?? "")
  const quantity = body.exactQuantity === null || body.exactQuantity === undefined
    ? null : Number(body.exactQuantity)
  if (!itemIdPattern.test(itemId) ||
      body.confirmation !== "VERIFY STOCK MANUALLY" ||
      !["IN_STOCK", "OUT_OF_STOCK"].includes(state) ||
      quantity !== null && (!Number.isSafeInteger(quantity) || quantity < 0 ||
        quantity > 1000000 || state === "IN_STOCK" && quantity === 0 ||
        state === "OUT_OF_STOCK" && quantity !== 0) ||
      (quantity !== null) !== (body.quantityExplicitlyVisible === true)) {
    return fail("STOCKGUARD_MANUAL_EXPLICIT_OBSERVATION_REQUIRED", 400)
  }
  try {
    const found = await target(itemId)
    if (!found.eligible) return fail(found.blocker ?? "STOCKGUARD_MANUAL_NOT_ELIGIBLE")
    const now = new Date().toISOString()
    const saved = await found.supabase
      .from("seller_os_owner_luna_stock_observations_v1")
      .insert({ account_key: found.scope.accountKey,
        marketplace_id: "EBAY_US", ebay_item_id: itemId,
        linkage_id: found.durable.linkage_id,
        luna_sku: found.component.supplierSku,
        luna_product_id: found.component.supplierProductId,
        luna_variant_id: found.component.supplierVariantId,
        observed_stock_state: state,
        observed_supplier_quantity: quantity,
        quantity_explicitly_visible: quantity !== null,
        observed_at: now, owner_confirmed_at: now,
        actor_user_id: auth.userId,
        maximum_age_seconds: found.durable.evidence_maximum_age_seconds })
      .select("observation_id").single()
    if (saved.error || !saved.data) throw Error("STOCKGUARD_MANUAL_RECEIPT_WRITE_FAILED")
    const read = await readProductionStockGuardV1({ supabase: found.supabase,
      accountKey: found.scope.accountKey!, accountAlias: found.scope.accountAlias!,
      itemId, includeKnownListingStockEvidence: true })
    const row = read.listings.find((entry) => entry.itemId === itemId)
    if (row?.supplierLinkage !== "CERTIFIED" ||
        row.lastSuccessfulSource !== "LUNA_OWNER_VISIBLE_SOURCE" ||
        row.stockFreshness !== "FRESH" ||
        row.supplierStockQuantity !== quantity) {
      throw Error("STOCKGUARD_MANUAL_CANONICAL_READBACK_FAILED")
    }
    return Response.json({ success: true,
      contractVersion: "OWNER_VERIFIED_LUNA_STOCK_OBSERVATION_V1",
      observationId: saved.data.observation_id,
      stockState: row.stockGuardState,
      stockFreshness: row.stockFreshness,
      stockFreshUntil: row.stockFreshUntil,
      supplierStockQuantity: row.supplierStockQuantity,
      safety: { ebayWrites: 0, quantityWrites: 0, publication: 0 } }, { headers })
  } catch (error) {
    return fail(error instanceof Error ? error.message :
      "STOCKGUARD_MANUAL_VERIFICATION_FAILED", 503)
  }
}
