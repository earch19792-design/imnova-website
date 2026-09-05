import type { SupabaseClient } from "@supabase/supabase-js"

import { collectSellerOsLongitudinalOpportunityReadV1 } from
  "./ebay-longitudinal-opportunity-radar-read-v1"
import { readAlreadyLiveExactLunaIdentitiesV1 } from
  "./ebay-opportunity-radar-revenue-factory-adapter-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "./ebay-seller-account-scope"
import { buildSellerOsDashboardOpportunityAuthorityV1 } from
  "./seller-os-dashboard-opportunity-authority-v1"
import { readSellerOsDashboardSnapshotV1 } from
  "./seller-os-dashboard-snapshot-cache-v1"

export const SELLER_OS_DASHBOARD_QUEUE_READ_MODEL_VERSION =
  "SELLER_OS_DASHBOARD_QUEUE_READ_MODEL_V1" as const
const QUEUE_ROW_LIMIT = 250

const QUEUE_READ_MODEL_PROJECTION = [
  "id", "candidate_key", "market_radar_product_id", "supplier_product_id",
  "supplier_variant_id", "supplier_sku", "product_title", "queue_status",
  "decision",
  "dashboard_is_quick_pick", "dashboard_is_radar_candidate",
  "dashboard_radar_family_id", "dashboard_radar_luna_sku",
  "dashboard_quick_pick_operation_id",
  "dashboard_minimum_readiness_current", "dashboard_minimum_listing_ready",
  "dashboard_minimum_market_test_ready",
].join(",")

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

async function loadSellerOsDashboardQueueReadModelV1(
  supabase: SupabaseClient,
) {
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  const activeRisksQuery = accountKey
    ? supabase.from("ebay_active_listing_risk_events")
      .select("id,risk_type,risk_priority,risk_summary,recommended_action,created_at,active_listing:ebay_active_listings!inner(account_key)")
      .eq("active_listing.account_key", accountKey)
      .is("resolved_at", null)
      .order("created_at", { ascending: false }).limit(40)
    : Promise.resolve({ data: [], error: null })
  const [runs, queueRead, activeRisks] = await Promise.all([
    supabase.from("ebay_luna_scan_runs")
      .select("id,status,total_candidates,processed_candidates,successful_candidates,failed_candidates,best_selling_signals_found,last_error,started_at,last_batch_at")
      .order("started_at", { ascending: false }).limit(5),
    supabase.from("ebay_luna_opportunity_queue")
      .select(QUEUE_READ_MODEL_PROJECTION, { count: "exact" })
      .order("opportunity_score", { ascending: false })
      .limit(QUEUE_ROW_LIMIT),
    activeRisksQuery,
  ])
  const firstError = runs.error ?? queueRead.error ?? activeRisks.error
  if (firstError) throw new Error("SELLER_OS_DASHBOARD_QUEUE_READ_FAILED")

  const rows = (queueRead.data ?? []).map(record)
  const exactIdentities = rows.flatMap((row) => {
    const identityKey = typeof row.id === "string" ? row.id : ""
    const lunaProductId = typeof row.supplier_product_id === "string"
      ? row.supplier_product_id
      : typeof row.market_radar_product_id === "string"
        ? row.market_radar_product_id : ""
    const lunaVariantId = typeof row.supplier_variant_id === "string"
      ? row.supplier_variant_id : ""
    const supplierSku = typeof row.supplier_sku === "string"
      ? row.supplier_sku : ""
    return identityKey && lunaProductId && lunaVariantId && supplierSku
      ? [{ identityKey, lunaProductId, lunaVariantId, supplierSku }] : []
  })
  const [liveGuard, longitudinalRadar] = await Promise.all([
    accountKey
      ? readAlreadyLiveExactLunaIdentitiesV1({ supabase, accountKey,
        identities: exactIdentities })
      : Promise.resolve({ status: "UNAVAILABLE" as const,
        matches: new Map(), reasonCode: "SELLER_ACCOUNT_SCOPE_UNAVAILABLE" }),
    collectSellerOsLongitudinalOpportunityReadV1({
      toolName: "seller_os_get_opportunity_radar",
      arguments: { limit: 20 }, client: supabase,
    }),
  ])
  const scopedActiveRisks = (activeRisks.data ?? []).map((risk) => {
    const { active_listing: _activeListing, ...publicRisk } = risk
    return publicRisk
  })
  return Object.freeze({
    runs: runs.data ?? [],
    activeListingRisks: scopedActiveRisks,
    commercialOpportunityAuthority:
      buildSellerOsDashboardOpportunityAuthorityV1({
        queueRows: rows,
        liveReadStatus: liveGuard.status,
        liveMatches: liveGuard.matches,
        radarReadStatus: longitudinalRadar.status === "AVAILABLE"
          ? "AVAILABLE" : "UNAVAILABLE",
        radarEntries: "entries" in longitudinalRadar
          ? longitudinalRadar.entries : [],
      }),
    readModel: Object.freeze({
      contractVersion: SELLER_OS_DASHBOARD_QUEUE_READ_MODEL_VERSION,
      queueDatabaseReadCount: 1 as const,
      broadQueuePayloadRead: false as const,
      separateQueueCountQueries: 0 as const,
      selectedQueueFieldCount: 17 as const,
      assessmentJsonRead: false as const,
      generatedAuthorityProjectionCount: 8 as const,
      boundedRowLimit: QUEUE_ROW_LIMIT,
      totalQueueRows: queueRead.count ?? rows.length,
      truncated: (queueRead.count ?? rows.length) > rows.length,
      getReadOnly: true as const,
    }),
  })
}

export async function getSellerOsDashboardQueueReadModelV1(
  supabase: SupabaseClient,
) {
  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey ??
    "__unconfigured__"
  const snapshot = await readSellerOsDashboardSnapshotV1({
    key: `seller-os-dashboard-queue:${accountKey}`,
    load: () => loadSellerOsDashboardQueueReadModelV1(supabase),
  })
  return Object.freeze({ ...snapshot.value,
    readModel: Object.freeze({ ...snapshot.value.readModel,
      snapshotSource: snapshot.source,
      snapshotReused: snapshot.source !== "DATABASE_READ",
    }),
  })
}
