import type { SupabaseClient } from "@supabase/supabase-js"
import { readRegistry, readCanonicalLunaLinkageDecisions,
  readCanonicalLunaStockJobs, readCanonicalLunaStockObservations } from
  "./commercial-monitor-readonly-repository"
import { readCurrentLiveAuthorityV1 } from "./ebay-current-live-authority-v1"
import { projectSellerOsCanonicalLunaStockReadModelV1 } from
  "./ebay-luna-canonical-stock-read-model-adapter-v1"

export async function readProductionStockGuardV1(input: {
  supabase: SupabaseClient; accountKey: string; accountAlias: string;
  itemId: string | null; now?: Date
}) {
  const now = input.now ?? new Date()
  const scope = input.itemId ? { itemIds: [input.itemId], stockCheckJobIds: [] } : undefined
  const [registry, decisions, jobs, observations, live] = await Promise.all([
    readRegistry(input.supabase, input.accountKey),
    readCanonicalLunaLinkageDecisions(input.supabase, input.accountKey),
    readCanonicalLunaStockJobs(input.supabase, input.accountKey, scope),
    readCanonicalLunaStockObservations(input.supabase, input.accountKey, scope),
    readCurrentLiveAuthorityV1({ supabase: input.supabase, accountKey: input.accountKey, now }),
  ])
  if (registry.status === "ERROR") throw Error("PRODUCTION_STOCK_REGISTRY_UNAVAILABLE")
  const ids = new Set(live.currentItemIds)
  const rows = registry.rows.filter(row => row.account_key === input.accountKey &&
    row.ebay_item_id && (input.itemId ? row.ebay_item_id === input.itemId : ids.has(row.ebay_item_id)))
  const listings = rows.map(row => {
    const itemId = row.ebay_item_id!
    const duplicate = rows.filter(other => other.ebay_item_id === itemId).length !== 1
    const decision = decisions.rows.filter(d => d.ebay_item_id === itemId)
      .sort((a, b) => Number(b.decision_version) - Number(a.decision_version))[0]
    const exactSku = Boolean(row.ebay_sku && decision?.ebay_sku === row.ebay_sku)
    const projection = projectSellerOsCanonicalLunaStockReadModelV1({ itemId,
      identity: { itemId, sku: row.ebay_sku, variationKey: null },
      marketplace: { marketplaceId: "EBAY_US", accountAlias: input.accountAlias }, now,
      decisions: duplicate || !exactSku ? { status: "AVAILABLE", rows: [] } : decisions,
      jobs, observations })
    const stock = projection.stock
    const components = projection.supplierLinkageStatus === "CERTIFIED" && Array.isArray(decision?.components)
      ? decision.components.map((component: Record<string, unknown>) => ({
          supplierProductId: component.lunaProductId ?? component.luna_product_id,
          supplierVariantId: component.lunaVariantId ?? component.luna_variant_id,
          supplierSku: component.lunaSku ?? component.luna_sku,
        })) : []
    return { itemId, sku: row.ebay_sku,
      liveStatus: !duplicate && ids.has(itemId) && row.listing_status === "active"
        ? "LIVE_ACTIVE" : "CURRENT_LIVE_UNPROVEN",
      supplierLinkage: projection.supplierLinkageStatus, components,
      supplierAvailability: stock?.state === "IN_STOCK_SIGNAL" ? "IN_STOCK"
        : stock?.state === "CERTIFIED_OOS" ? "OUT_OF_STOCK" : "UNKNOWN",
      stockGuardState: stock?.state ?? "STOCK_UNKNOWN",
      stockFreshness: stock?.freshness.status ?? "UNKNOWN",
      stockObservedAt: stock?.evidenceReferences?.at(-1)?.capturedAt ?? null,
      limitationCode: duplicate ? "DUPLICATE_CURRENT_IDENTITY" : !exactSku
        ? "EXACT_CURRENT_SKU_LINKAGE_REQUIRED" : projection.limitationCode,
    }
  })
  return { observedAt: now.toISOString(), currentLiveState: live.currentState,
    cohortComplete: live.currentState === "CURRENT_FRESH" && !registry.truncated &&
      (input.itemId ? listings.length === 1 : listings.length === ids.size) &&
      listings.every(row => row.liveStatus === "LIVE_ACTIVE"),
    sourceStatus: { registry: registry.status, decisions: decisions.status,
      jobs: jobs.status, observations: observations.status }, listings }
}
