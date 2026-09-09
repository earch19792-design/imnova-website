import type { SupabaseClient } from "@supabase/supabase-js"
import type { FunnelEvidence, MetricWindow } from "./listing-treatment-engine-v1"

export const METRICS_COLD_START_V1 = "SELLER_OS_ASSISTANT_METRICS_COLD_START_V1"
// A precision rule, never a universal good/bad CTR. Healthy requires positive
// separation from the listing's own independent historical interval.
export const METRIC_SAMPLE_RULE_V1 = "OWN_HISTORY_WILSON_95_RELATIVE_HALF_WIDTH_25_PERCENT_V1"
export type MetricSnapshotV1 = {
  id: string; marketplace_account_key: string; marketplace: string; listing_id: string;
  sku: string | null; impressions: number | null; views: number | null; transactions: number | null;
  window_start: string; window_end: string; observed_at: string;
  completeness_status: string; source: Record<string, unknown>
}
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0
const day = 86400000
function interval(successes: unknown, trials: unknown) {
  if (!number(successes) || !number(trials) || !Number.isInteger(successes) || !Number.isInteger(trials) || trials <= 0 || successes > trials) return null
  const p = successes / trials, z = 1.959963984540054, z2 = z * z
  const center = (p + z2 / (2 * trials)) / (1 + z2 / trials)
  const half = z * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials)) / (1 + z2 / trials)
  return { low: center - half, high: center + half, precise: p > 0 && half / p <= 0.25 }
}
function evidence(row: MetricSnapshotV1, input: { accountKey: string; itemId: string; sku: string | null; window: MetricWindow; now: Date }, current: boolean) {
  const s = row.source
  const end = Date.parse(row.window_end) + day
  const duration = end - Date.parse(row.window_start)
  const observed = Date.parse(row.observed_at)
  if (row.marketplace_account_key !== input.accountKey || row.marketplace !== "EBAY_US" || row.listing_id !== input.itemId ||
    (row.sku !== null && row.sku !== input.sku) || row.completeness_status !== "complete" || !row.id ||
    s.analytics !== "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" || s.syntheticFallbackUsed !== false || s.fixtureEvidenceUsed !== false ||
    !Number.isFinite(observed) || observed > input.now.getTime() || end > input.now.getTime() ||
    duration !== ({ "24H": 1, "7D": 7, "30D": 30 }[input.window] * day) ||
    (current && (s.freshnessStatus !== "CURRENT" || input.now.getTime() - observed > day || input.now.getTime() - end > 2 * day)) ||
    s.calculatedCtrApplicable !== true || s.transactionsApplicable !== true || s.totalListingViewsApplicable !== true) return null
  const ctr = interval(s.calculatedCtrNumerator, s.calculatedCtrDenominator)
  const conversion = interval(row.transactions, row.views)
  if (!ctr?.precise || !conversion?.precise || !number(row.impressions) || row.impressions <= 0) return null
  // Poisson count precision; use only equal-length, non-overlapping windows.
  const half = 1.959963984540054 * Math.sqrt(row.impressions)
  if (half / row.impressions > 0.25) return null
  return { ctr, conversion, traffic: { low: Math.max(0, row.impressions - half), high: row.impressions + half } }
}

export function assessOwnHistoryMetricsV1(input: { accountKey: string; itemId: string; sku: string | null;
  window: MetricWindow; now: Date; current: MetricSnapshotV1 | null; history: MetricSnapshotV1[] }) {
  const pending = { contractVersion: METRICS_COLD_START_V1, status: "PENDING_REAL_SAMPLE" as const,
    metricSampleSufficient: false, comparison: null as FunnelEvidence | null, isError: false,
    label: "Obtener más datos", reevaluation: "ON_EACH_EXISTING_ASSISTANT_READ", codexRequired: false }
  if (!input.current) return { ...pending, reason: "CURRENT_WINDOW_EVIDENCE_PENDING" }
  const current = evidence(input.current, input, true)
  if (!current) return { ...pending, reason: "CURRENT_SAMPLE_OR_SOURCE_INSUFFICIENT" }
  // Choose the newest independent period, never add overlapping snapshots.
  const previous = [...input.history].filter(r => Date.parse(r.window_end) + day <= Date.parse(input.current!.window_start))
    .sort((a, b) => Date.parse(b.window_end) - Date.parse(a.window_end) || Date.parse(b.observed_at) - Date.parse(a.observed_at))[0]
  const prior = previous ? evidence(previous, input, false) : null
  if (!prior) return { ...pending, reason: "INDEPENDENT_OWN_HISTORY_PENDING" }
  const direction = (a: { low: number; high: number }, b: typeof a) => a.high < b.low ? "LOW" : a.low > b.high ? "HEALTHY" : "UNKNOWN"
  const comparison: FunnelEvidence = { itemId: input.itemId, window: input.window, basis: "OWN_HISTORY",
    reference: `listing_commercial_snapshots:${input.current.id}:${previous.id}`, sampleRuleReference: METRIC_SAMPLE_RULE_V1,
    sufficient: true, fresh: true, traffic: direction(current.traffic, prior.traffic),
    ctr: direction(current.ctr, prior.ctr), conversion: direction(current.conversion, prior.conversion) }
  const diagnosed = comparison.traffic !== "UNKNOWN" && comparison.ctr !== "UNKNOWN" && comparison.conversion !== "UNKNOWN"
  return { ...pending, metricSampleSufficient: true, comparison,
    status: diagnosed ? "COMPARABLE_SAMPLE" as const : "PENDING_COMPARATIVE_SEPARATION" as const,
    reason: diagnosed ? null : "CONFIDENCE_INTERVALS_OVERLAP", intervals: { current, prior } }
}

const columns = "id,marketplace_account_key,marketplace,listing_id,sku,impressions,views,transactions,window_start,window_end,observed_at,completeness_status,source"
export async function readOwnHistoryMetricsV1(input: { supabase: SupabaseClient; accountKey: string; itemId: string;
  sku: string | null; window: MetricWindow; now: Date; start: string | null; end: string | null }) {
  const assess = (current: MetricSnapshotV1 | null, history: MetricSnapshotV1[]) => assessOwnHistoryMetricsV1({ ...input, current, history })
  if (!input.start || !input.end) return assess(null, [])
  const base = () => input.supabase.from("listing_commercial_snapshots").select(columns)
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US").eq("listing_id", input.itemId)
  const current = await base().eq("window_start", input.start.slice(0, 10)).eq("window_end", input.end.slice(0, 10))
    .order("observed_at", { ascending: false }).limit(1).maybeSingle()
  if (current.error || !current.data) return assess(null, [])
  const history = await base().lt("window_end", input.start.slice(0, 10)).order("window_end", { ascending: false })
    .order("observed_at", { ascending: false }).limit(12)
  return assess(current.data as MetricSnapshotV1, history.error ? [] : history.data as MetricSnapshotV1[])
}
