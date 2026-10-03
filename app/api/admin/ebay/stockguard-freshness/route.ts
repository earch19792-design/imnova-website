export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { readProductionStockGuardV1 } from
  "@/lib/ebay/ebay-production-stock-read-service-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"
import { reconcileSellerOsStockIdentityV1 } from
  "@/lib/ebay/ebay-stock-identity-auto-reconciliation-v1"
import { projectStockguardOosProtectionStatusV1 } from
  "@/lib/ebay/stockguard-oos-quantity-protection-v1"

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
    const supabase = getSupabaseAdminClient()
    const [result, protectionRead] = await Promise.all([
      readProductionStockGuardV1({ supabase, accountKey: scope.accountKey,
        accountAlias: scope.accountAlias, itemId: null,
        includeKnownListingStockEvidence: true }),
      supabase.from("seller_os_stockguard_oos_protection_v1")
        .select("item_id,protection_status,protection_confirmed_at,official_readback_quantity,limitation_code,protection_attempted_at")
        .eq("seller_account", scope.accountKey).eq("marketplace", "EBAY_US")
        .order("protection_attempted_at", { ascending: false }).limit(1000),
    ])
    if (protectionRead.error || (protectionRead.data?.length ?? 0) >= 1000) {
      throw new Error("STOCKGUARD_PROTECTION_READ_FAILED")
    }
    const protectionByItem = new Map<string, NonNullable<typeof protectionRead.data>[number]>()
    const confirmedByItem = new Map<string, NonNullable<typeof protectionRead.data>[number]>()
    for (const receipt of protectionRead.data ?? []) {
      if (!protectionByItem.has(receipt.item_id)) {
        protectionByItem.set(receipt.item_id, receipt)
      }
      if (!confirmedByItem.has(receipt.item_id) &&
          ["APPLIED_CONFIRMED", "NO_OP_CONFIRMED"].includes(
            receipt.protection_status)) {
        confirmedByItem.set(receipt.item_id, receipt)
      }
    }
    return Response.json({ success: true, observedAt: result.observedAt,
      currentLiveState: result.currentLiveState,
      cohortComplete: result.cohortComplete,
      sourceStatus: result.sourceStatus,
      listings: result.listings.map((row) => {
        const protection = protectionByItem.get(row.itemId)
        const confirmed = confirmedByItem.get(row.itemId)
        return ({
        itemId: row.itemId, sku: row.sku, title: row.title,
        identityStatus: row.identityStatus,
        stockguardLinkStatus: row.stockguardLinkStatus,
        linkAuthorityState: row.linkAuthorityState,
        liveStatus: row.liveStatus,
        monitoringStatus: row.supplierLinkage === "CERTIFIED" &&
          row.liveStatus === "LIVE_ACTIVE" ? "MONITORED" : "UNPROVEN",
        supplierLinkage: row.supplierLinkage,
        dataQualityWarnings: row.dataQualityWarnings,
        conflictingSupplierItemIds: row.conflictingSupplierItemIds,
        components: row.components,
        supplierAvailability: row.supplierAvailability,
        certifiedListingCapacity: row.certifiedListingCapacity,
        stockGuardState: row.stockGuardState,
        stockFreshness: row.stockFreshness,
        stockObservedAt: row.stockObservedAt,
        stockFreshUntil: row.stockFreshUntil,
        supplierStockQuantity: row.supplierStockQuantity,
        lastSuccessfulSource: row.lastSuccessfulSource,
        limitationCode: row.limitationCode,
        stockProtectionStatus: projectStockguardOosProtectionStatusV1({
          receiptStatus: confirmed?.protection_status ??
            protection?.protection_status ?? null,
          freshness: row.stockFreshness,
          supplierAvailability: row.supplierAvailability ?? "UNKNOWN" }),
        protectionReadback: confirmed ? "CONFIRMED" : "UNCONFIRMED",
        protectionConfirmedAt: confirmed?.protection_confirmed_at ?? null,
        ebayProtectionQuantity: confirmed?.official_readback_quantity ?? null,
        protectionBlocker: protection?.limitation_code ?? null,
        marketplaceWriteAuthorized: "NOT_EVALUATED" as const,
      }) }),
      safety: { ebayWrites: 0, inventoryQuantityWrites: 0,
        durableWrites: 0 } }, { headers })
  } catch {
    return Response.json({ success: false,
      error: "STOCKGUARD_FRESHNESS_READ_UNAVAILABLE" },
    { status: 503, headers })
  }
}

export async function POST(request: Request) {
  const auth = await validateAdminApiRequest(request)
  if (!auth.ok) return Response.json({ success: false,
    error: auth.error ?? "ADMIN_FORBIDDEN" },
  { status: auth.status || 403, headers })
  const scope = getEbaySellerAccountScopeConfiguration()
  if (!scope.accountKey || !scope.accountAlias) return Response.json({
    success: false, error: "STOCKGUARD_ACCOUNT_SCOPE_REQUIRED" },
  { status: 503, headers })
  try {
    const supabase = getSupabaseAdminClient()
    const before = await readProductionStockGuardV1({ supabase,
      accountKey: scope.accountKey, accountAlias: scope.accountAlias,
      itemId: null, includeKnownListingStockEvidence: true })
    if (!before.cohortComplete || before.currentLiveState !== "CURRENT_FRESH") {
      return Response.json({ success: false,
        error: "STOCKGUARD_CURRENT_LIVE_COHORT_REQUIRED",
        safety: { ebayQuantityWrites: 0, ebayContentWrites: 0,
          publication: 0, pricing: 0 } }, { status: 409, headers })
    }
    const targets = before.listings.filter((row) =>
      row.supplierLinkage === "CERTIFIED" &&
      (row.stockFreshness === "STALE" || row.stockFreshness === "UNKNOWN"))
      .sort((a, b) => Number(b.stockFreshness === "STALE") -
        Number(a.stockFreshness === "STALE") || a.itemId.localeCompare(b.itemId))
      .slice(0, 20).map((row) => row.itemId)
    const refresh = await reconcileSellerOsStockIdentityV1(supabase, {
      accountKey: scope.accountKey, targetItemIds: targets,
      allowApprovedDecisionFallback: true,
    })
    const after = await readProductionStockGuardV1({ supabase,
      accountKey: scope.accountKey, accountAlias: scope.accountAlias,
      itemId: null, includeKnownListingStockEvidence: true })
    return Response.json({ success: true, refresh,
      observedAt: after.observedAt,
      currentLiveState: after.currentLiveState,
      cohortComplete: after.cohortComplete,
      sourceStatus: after.sourceStatus,
      listings: after.listings.map((row) => ({
        itemId: row.itemId, supplierLinkage: row.supplierLinkage,
        stockFreshness: row.stockFreshness,
        stockObservedAt: row.stockObservedAt,
        stockFreshUntil: row.stockFreshUntil,
        limitationCode: row.limitationCode,
      })),
      safety: { ebayQuantityWrites: 0, ebayContentWrites: 0,
        publication: 0, pricing: 0, stockEvidenceRefreshOnly: true },
    }, { headers })
  } catch {
    return Response.json({ success: false,
      error: "STOCKGUARD_REFRESH_FAILED",
      safety: { ebayQuantityWrites: 0, ebayContentWrites: 0,
        publication: 0, pricing: 0 } }, { status: 503, headers })
  }
}
