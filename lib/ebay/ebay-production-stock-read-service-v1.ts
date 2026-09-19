import type { SupabaseClient } from "@supabase/supabase-js"
import { readRegistry, readCanonicalLunaStockJobs,
  readCanonicalLunaStockObservations } from
  "./commercial-monitor-readonly-repository"
import { readCurrentLiveAuthorityV1 } from "./ebay-current-live-authority-v1"
import { projectSellerOsCanonicalLunaStockReadModelV1 } from
  "./ebay-luna-canonical-stock-read-model-adapter-v1"
import { projectStockguardListingAuthorityP0,
  type ListingIdentityQuarantineRowV1,
  type ListingLinkAuthorityRowV1 } from
  "./stockguard-listing-link-authority-p0"

type LiveRow = Readonly<{
  ebay_item_id: string
  ebay_sku: string | null
  listing_status: string
}>

export async function readProductionStockGuardV1(input: {
  supabase: SupabaseClient; accountKey: string; accountAlias: string;
  itemId: string | null; now?: Date
}) {
  const now = input.now ?? new Date()
  const scope = input.itemId ? { itemIds: [input.itemId], stockCheckJobIds: [] } : undefined
  const [registry, jobs, observations, live, authorityRead, quarantineRead] =
    await Promise.all([
      readRegistry(input.supabase, input.accountKey),
      readCanonicalLunaStockJobs(input.supabase, input.accountKey, scope),
      readCanonicalLunaStockObservations(input.supabase, input.accountKey, scope),
      readCurrentLiveAuthorityV1({ supabase: input.supabase, accountKey: input.accountKey, now }),
      input.supabase.from("seller_os_listing_product_link_authorities_v1")
        .select("*").eq("account_key", input.accountKey)
        .order("updated_at", { ascending: false }),
      input.supabase.from("seller_os_listing_identity_quarantines_v1")
        .select("*").eq("account_key", input.accountKey)
        .order("observed_at", { ascending: false }),
    ])
  if (registry.status === "ERROR") throw Error("PRODUCTION_STOCK_REGISTRY_UNAVAILABLE")
  if (authorityRead.error || quarantineRead.error) {
    throw Error("PRODUCTION_STOCK_LINK_AUTHORITY_UNAVAILABLE")
  }
  const ids = new Set(live.currentItemIds)
  const rows = registry.rows.filter(row => row.account_key === input.accountKey &&
    row.ebay_item_id && (input.itemId ? row.ebay_item_id === input.itemId : ids.has(row.ebay_item_id)))
  const liveListings = registry.rows.filter((row): row is typeof row &
    { ebay_item_id: string } => row.account_key === input.accountKey &&
      Boolean(row.ebay_item_id)).map((row) => ({ ebay_item_id: row.ebay_item_id,
        ebay_sku: row.ebay_sku, listing_status: row.listing_status })) as LiveRow[]
  const authorities = (authorityRead.data ?? []) as ListingLinkAuthorityRowV1[]
  const quarantines = (quarantineRead.data ?? []) as ListingIdentityQuarantineRowV1[]
  const listings = rows.map(row => {
    const itemId = row.ebay_item_id!
    const authorityGate = projectStockguardListingAuthorityP0({
      listing: { ebay_item_id: itemId, ebay_sku: row.ebay_sku,
        listing_status: row.listing_status }, liveListings, authorities, quarantines,
    })
    const authority = authorityGate.stockguardEligible
      ? authorityGate.authority : null
    const decisions = { status: "AVAILABLE" as const, rows: authority ? [{
      decision_id: authority.source_decision_id,
      decision_version: 1,
      decision: "APPROVE_EXACT_LINKAGE",
      decision_at: authority.activated_at,
      ebay_item_id: authority.ebay_item_id,
      ebay_sku: authority.ebay_sku,
      linkage_id: authority.linkage_id,
      components: authority.components,
      evidence_digest: authority.source_fingerprint ?? "",
      evidence_references: [{ authorityId: authority.authority_id }],
    }] : [] }
    const projection = projectSellerOsCanonicalLunaStockReadModelV1({ itemId,
      identity: { itemId, sku: row.ebay_sku, variationKey: null },
      marketplace: { marketplaceId: "EBAY_US", accountAlias: input.accountAlias }, now,
      decisions, jobs, observations })
    const stock = projection.stock
    const components = authority && Array.isArray(authority.components)
      ? authority.components.map((component) => ({
          supplierProductId: component.lunaProductId ?? component.luna_product_id,
          supplierVariantId: component.lunaVariantId ?? component.luna_variant_id,
          supplierSku: component.lunaSku ?? component.luna_sku,
        })) : []
    return { itemId, sku: row.ebay_sku,
      liveStatus: ids.has(itemId) && row.listing_status === "active"
        ? "LIVE_ACTIVE" : "CURRENT_LIVE_UNPROVEN",
      supplierLinkage: authority ? projection.supplierLinkageStatus : "UNPROVEN",
      linkAuthorityState: authorityGate.lifecycleState,
      identityQuarantine: authorityGate.quarantine?.reason_code ?? null,
      conflictingLiveItemIds: authorityGate.conflictingLiveItemIds,
      components,
      supplierAvailability: stock?.state === "IN_STOCK_SIGNAL" ? "IN_STOCK"
        : stock?.state === "CERTIFIED_OOS" ? "OUT_OF_STOCK" : "UNKNOWN",
      stockGuardState: authority ? stock?.state ?? "STOCK_UNKNOWN" : "STOCK_UNKNOWN",
      stockFreshness: authority ? stock?.freshness.status ?? "UNKNOWN" : "UNKNOWN",
      stockObservedAt: authority ? stock?.evidenceReferences?.at(-1)?.capturedAt ?? null : null,
      limitationCode: authorityGate.stockguardEligible
        ? projection.limitationCode : authorityGate.limitationCode,
    }
  })
  return { observedAt: now.toISOString(), currentLiveState: live.currentState,
    cohortComplete: live.currentState === "CURRENT_FRESH" && !registry.truncated &&
      (input.itemId ? listings.length === 1 : listings.length === ids.size) &&
      listings.every(row => row.liveStatus === "LIVE_ACTIVE"),
    sourceStatus: { registry: registry.status, linkAuthority: "AVAILABLE" as const,
      jobs: jobs.status, observations: observations.status }, listings }
}
