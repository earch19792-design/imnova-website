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
  itemId: string | null; now?: Date;
  includeKnownListingStockEvidence?: boolean
}) {
  const now = input.now ?? new Date()
  const scope = input.itemId ? { itemIds: [input.itemId], stockCheckJobIds: [] } : undefined
  const [registry, jobs, observations, live, authorityRead, quarantineRead,
    caseRead, sweepRead] =
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
      input.supabase.from("seller_os_listing_cases_v1").select("*")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .limit(1000),
      input.supabase.from("seller_os_listing_registry_sweeps_v1")
        .select("sweep_id,official_observed_at,official_live_item_count,reconciled_item_count")
        .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
        .eq("status", "COMPLETE").order("completed_at", { ascending: false })
        .limit(1).maybeSingle(),
    ])
  if (registry.status === "ERROR") throw Error("PRODUCTION_STOCK_REGISTRY_UNAVAILABLE")
  if (authorityRead.error || quarantineRead.error) {
    throw Error("PRODUCTION_STOCK_LINK_AUTHORITY_UNAVAILABLE")
  }
  const ids = new Set(live.currentItemIds)
  const liveListings = registry.rows.filter((row): row is typeof row &
    { ebay_item_id: string } => row.account_key === input.accountKey &&
      Boolean(row.ebay_item_id)).map((row) => ({ ebay_item_id: row.ebay_item_id,
        ebay_sku: row.ebay_sku, listing_status: row.listing_status })) as LiveRow[]
  const authorities = (authorityRead.data ?? []) as ListingLinkAuthorityRowV1[]
  const quarantines = (quarantineRead.data ?? []) as ListingIdentityQuarantineRowV1[]
  const sweep = sweepRead.error ? null : sweepRead.data as {
    sweep_id: string; official_observed_at: string;
    official_live_item_count: number; reconciled_item_count: number
  } | null
  const sweepCases = (caseRead.error ? [] : caseRead.data ?? []) as {
    case_id: string; ebay_item_id: string; ebay_custom_label: string | null;
    identity_status: string; stockguard_link_status: string;
    stockguard_authority_id: string | null; origin: string;
    last_reconciled_sweep_id: string | null
  }[]
  const currentCases = sweepCases.filter((row) =>
    row.last_reconciled_sweep_id === sweep?.sweep_id)
  const knownExactIds = new Set(input.includeKnownListingStockEvidence
    ? currentCases.filter((row) => row.identity_status === "LINKED_EXACT" &&
      Boolean(row.stockguard_authority_id)).map((row) => row.ebay_item_id)
    : [])
  const rows = registry.rows.filter(row => row.account_key === input.accountKey &&
    row.ebay_item_id && (input.itemId ? row.ebay_item_id === input.itemId
      : ids.has(row.ebay_item_id) || knownExactIds.has(row.ebay_item_id)))
  const canonicalFresh = Boolean(sweep && !caseRead.error &&
    sweepCases.length < 1000 &&
    now.getTime() - Date.parse(sweep.official_observed_at) <= 20 * 60_000 &&
    Date.parse(sweep.official_observed_at) - now.getTime() <= 60_000 &&
    currentCases.length === sweep.official_live_item_count &&
    currentCases.length === sweep.reconciled_item_count)
  const caseByItem = new Map((canonicalFresh ? currentCases : [])
    .map((row) => [row.ebay_item_id, row]))
  const listings = rows.map(row => {
    const itemId = row.ebay_item_id!
    const authorityGate = projectStockguardListingAuthorityP0({
      listing: { ebay_item_id: itemId, ebay_sku: row.ebay_sku,
        listing_status: row.listing_status }, liveListings, authorities, quarantines,
    })
    const listingCase = caseByItem.get(itemId) ?? null
    const caseExact = !canonicalFresh || Boolean(listingCase &&
      listingCase.identity_status === "LINKED_EXACT" &&
      listingCase.stockguard_authority_id === authorityGate.authority?.authority_id &&
      listingCase.ebay_custom_label?.trim().toUpperCase() ===
        row.ebay_sku?.trim().toUpperCase())
    const authority = authorityGate.stockguardEligible && caseExact
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
    const stockObservedAt = authority
      ? stock?.evidenceReferences?.at(-1)?.capturedAt ?? null : null
    const maximumAgeSeconds = stock?.freshness.maximumAgeSeconds
    const stockFreshUntil = stockObservedAt && maximumAgeSeconds &&
      Number.isFinite(Date.parse(stockObservedAt))
      ? new Date(Date.parse(stockObservedAt) + maximumAgeSeconds * 1_000).toISOString()
      : null
    const components = authority && Array.isArray(authority.components)
      ? authority.components.map((component) => ({
          supplierProductId: component.lunaProductId ?? component.luna_product_id,
          supplierVariantId: component.lunaVariantId ?? component.luna_variant_id,
          supplierSku: component.lunaSku ?? component.luna_sku,
        })) : []
    return { itemId, sku: row.ebay_sku,
      canonicalCaseId: listingCase?.case_id ?? null,
      listingOrigin: listingCase?.origin ?? null,
      identityStatus: listingCase?.identity_status ?? null,
      stockguardLinkStatus: listingCase?.stockguard_link_status ?? null,
      liveStatus: ids.has(itemId) && row.listing_status === "active"
        ? "LIVE_ACTIVE" : "CURRENT_LIVE_UNPROVEN",
      supplierLinkage: authority ? projection.supplierLinkageStatus : "UNPROVEN",
      linkAuthorityState: authorityGate.lifecycleState,
      identityQuarantine: authorityGate.quarantine?.reason_code ?? null,
      conflictingLiveItemIds: authorityGate.conflictingLiveItemIds,
      components,
      supplierAvailability: stock?.state === "IN_STOCK_SIGNAL" ? "IN_STOCK"
        : stock?.state === "CERTIFIED_OOS" ? "OUT_OF_STOCK" : "UNKNOWN",
      certifiedListingCapacity: authority &&
        stock?.freshness.status === "FRESH" &&
        projection.composition?.bundleCapacity.availability === "AVAILABLE"
        ? projection.composition.bundleCapacity.value : null,
      stockGuardState: authority ? stock?.state ?? "STOCK_UNKNOWN" : "STOCK_UNKNOWN",
      stockFreshness: authority ? stock?.freshness.status ?? "UNKNOWN" : "UNKNOWN",
      stockObservedAt, stockFreshUntil,
      limitationCode: canonicalFresh && !caseExact
        ? "CANONICAL_LISTING_CASE_IDENTITY_BLOCKED"
        : authorityGate.stockguardEligible
        ? projection.limitationCode : authorityGate.limitationCode,
    }
  })
  return { observedAt: now.toISOString(), currentLiveState: live.currentState,
    cohortComplete: live.currentState === "CURRENT_FRESH" && !registry.truncated &&
      (input.itemId ? listings.length === 1 : listings.length === ids.size) &&
      listings.every(row => row.liveStatus === "LIVE_ACTIVE") &&
      (!canonicalFresh || (input.itemId
        ? caseByItem.has(input.itemId)
        : ids.size === currentCases.length &&
          [...ids].every((id) => caseByItem.has(id)))),
    sourceStatus: { registry: registry.status, linkAuthority: "AVAILABLE" as const,
      listingRegistry: canonicalFresh ? "CURRENT_FRESH" as const :
        "CURRENT_UNAVAILABLE" as const,
      jobs: jobs.status, observations: observations.status }, listings }
}
