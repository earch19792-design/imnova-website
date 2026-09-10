import type { SupabaseClient } from "@supabase/supabase-js"
import { assessOwnHistoryMetricsV1, type MetricSnapshotV1 } from "./listing-metrics-cold-start-v1"
import { readLatestValidListingQualityImportV1 } from "../ebay/ebay-listing-quality-report-read-v1"

/** Reuse existing metrics and Quality authorities. One bounded selected cohort,
 * no new report acquisition and no marketplace traffic. */
export async function readAdsDecisionEvidenceV1(input: { supabase: SupabaseClient; accountKey: string;
  listings: { itemId: string; sku: string | null }[]; now: Date }) {
  if (!input.listings.length || input.listings.length > 20) throw Error("ADS_BOUNDED_INPUT_REQUIRED")
  const ids = input.listings.map(l => l.itemId)
  const [snapshots, latest] = await Promise.all([
    input.supabase.from("listing_commercial_snapshots")
      .select("id,marketplace_account_key,marketplace,listing_id,sku,impressions,views,transactions,window_start,window_end,observed_at,completeness_status,source")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US").in("listing_id", ids)
      .gte("window_end", new Date(input.now.getTime() - 62 * 86400000).toISOString().slice(0, 10))
      .order("window_end", { ascending: false }).order("observed_at", { ascending: false }).limit(260),
    readLatestValidListingQualityImportV1(input).catch(() => null),
  ])
  const signals = latest?.report_date === input.now.toISOString().slice(0, 10)
    ? await input.supabase.from("ebay_listing_quality_report_signals").select("id,item_id,priority_class,product_truth_supported,freshness")
      .eq("report_import_id", latest.id).in("item_id", ids).order("id").limit(100) : null
  return new Map(input.listings.map(listing => {
    const rows = (snapshots.error ? [] : snapshots.data ?? []) as MetricSnapshotV1[]
    const exact = rows.filter(r => r.listing_id === listing.itemId && Date.parse(r.window_end) + 86400000 - Date.parse(r.window_start) === 7 * 86400000)
    const assessment = assessOwnHistoryMetricsV1({ ...input, ...listing, window: "7D", current: exact[0] ?? null, history: exact.slice(1) })
    const qualityReferences = (signals?.error ? [] : signals?.data ?? []).filter(r => r.item_id === listing.itemId &&
      r.freshness === "CURRENT" && r.product_truth_supported === true && r.priority_class === "NEEDS_ATTENTION").map(r => String(r.id))
    return [listing.itemId, { comparison: assessment.comparison, metricsStatus: assessment.status, qualityReferences }]
  }))
}
