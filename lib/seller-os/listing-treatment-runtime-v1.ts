import type { SupabaseClient } from "@supabase/supabase-js"
import type { CommercialMonitorGetDto } from "../ebay/commercial-monitor-readonly-contract"
import { readDurableListingQualityArtifactV1 } from "../ebay/ebay-listing-quality-report-read-v1"
import { normalizeEbayListingQualityReport } from "../ebay/ebay-commercial-monitor-intelligence-v1"
import { currentLiveListingsForMonitorV1 } from "../ebay/ebay-seller-os-live-portfolio-integrity-v1"
import { prepareRevenueFirstListingPreviewV1 } from "./revenue-first-preview-v1"
import { keywordWireDigestV1 } from "./keyword-intelligence-handoff-v1"
import { diagnoseListingTreatmentV1, projectListingMetricsV1, promotionPortfolioPreviewV1,
  validatePromotionPolicyV1, MAX_TREATMENT_LISTINGS, TREATMENT_RECEIPT_V1, SIMULATION_SAFETY,
  compareTreatmentReceiptV1,
  type Economics, type MetricWindow, type PromotionPolicy } from "./listing-treatment-engine-v1"

const fields = { salePrice: "EBAY_LIVE_PRICE", productCost: "LUNA_CURRENT_COST", shippingCost: "LUNA_CURRENT_SHIPPING", ebayFees: "EXPECTED_EBAY_FEE", otherCosts: "OTHER_EXPLICIT_COSTS" } as const
export async function readListingTreatmentsV1(input: { supabase: SupabaseClient; accountKey: string;
  monitor: CommercialMonitorGetDto; itemIds: string[]; policy: PromotionPolicy; window: MetricWindow; now?: Date }) {
  validatePromotionPolicyV1(input.policy)
  if (!input.itemIds.length || input.itemIds.length > MAX_TREATMENT_LISTINGS ||
    new Set(input.itemIds).size !== input.itemIds.length || input.itemIds.some(id => !/^\d{9,19}$/.test(id))) throw Error("BOUNDED_UNIQUE_LISTINGS_REQUIRED")
  const now = input.now ?? new Date()
  const live = currentLiveListingsForMonitorV1(input.monitor)
  const listings = input.itemIds.map(id => live.find(l => l.identity.itemId === id))
  if (listings.some(l => !l)) throw Error("EXACT_CURRENT_LIVE_LISTING_REQUIRED")
  const [economicsRead, artifact] = await Promise.all([
    input.supabase.from("seller_os_live_economic_evidence_v1")
      .select("evidence_id,ebay_item_id,evidence_type,value_amount,value_currency,captured_at,fresh_until,freshness_status,source_authority,evidence_metadata")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
      .in("ebay_item_id", input.itemIds).order("captured_at", { ascending: false })
      .order("created_at", { ascending: false }).limit(500),
    readDurableListingQualityArtifactV1({ supabase: input.supabase, accountKey: input.accountKey, now: now.toISOString() }),
  ])
  const quality = normalizeEbayListingQualityReport({ artifact, listings: input.monitor.listings })
  const rows = listings.map(listing => {
    const itemId = listing!.identity.itemId
    const economics = Object.fromEntries(Object.entries(fields).map(([key, type]) => {
      const row = economicsRead.error ? null : economicsRead.data?.find(r => r.ebay_item_id === itemId && r.evidence_type === type)
      return [key, { value: row?.value_amount === null || row?.value_amount === undefined ? null : Number(row.value_amount),
        reference: row?.evidence_id ?? null, fresh: Boolean(row && row.value_currency === "USD" && row.freshness_status === "FRESH" &&
          Date.parse(row.fresh_until) >= now.getTime() && Date.parse(row.captured_at) <= now.getTime()) }]
    })) as Omit<Economics, "adFeeBasis">
    const complete: Economics = { ...economics, adFeeBasis: { value: null, reference: null, fresh: false } }
    const recommendations = quality.recommendations.filter(r => r.listingKey === listing!.key && r.associationStatus === "ITEM_ID_CERTIFIED")
    const quantity = listing!.stock.quantity
    const stockProven = quantity.availability === "AVAILABLE" && quantity.freshness.status === "FRESH" && quantity.identity.itemId === itemId
    const treatment = diagnoseListingTreatmentV1({ itemId, window: input.window,
      comparison: null, // The existing feed has no certified baseline/sample assessment. Never reuse legacy universal thresholds.
      economics: complete, policy: input.policy,
      stock: stockProven && quantity.value === 0 ? "LOW" : stockProven && quantity.value! > 0 ? "AVAILABLE" : "UNKNOWN",
      stockReference: stockProven ? quantity.source.evidenceReference : null,
      protected: input.monitor.backend.decisions.some(d => d.listingKey === listing!.key && d.protectionState === "DO_NOT_TOUCH"),
      qualityReferences: recommendations.map(r => `${r.sourceVersion}:${r.observedAt}:${itemId}`), keywordReferences: [] })
    return { ...treatment, title: listing!.identity.title, metrics: projectListingMetricsV1(listing!),
      quality: { ...quality, recommendations }, economicsReadAvailable: !economicsRead.error,
      limitations: ["FUNNEL_BASELINE_AND_SAMPLE_RULE_UNPROVEN", "TOTAL_AD_FEE_BASIS_UNPROVEN", "BASE_EBAY_FEE_MODEL_NOT_REALIZED_FEES"],
      previewUrl: `/admin/ebay/listing-optimization/preview?itemId=${itemId}` }
  })
  return { rows, summary: promotionPortfolioPreviewV1(rows), policy: input.policy,
    observedAt: now.toISOString(), safety: SIMULATION_SAFETY }
}

export async function prepareTreatmentPreviewV1(input: Parameters<typeof readListingTreatmentsV1>[0] & { traceId: string }) {
  const result = await readListingTreatmentsV1(input)
  // Sequential bounded execution shares the existing monitor snapshot and circuit breaker.
  const previews = []
  for (const row of result.rows) {
    const preview = await prepareRevenueFirstListingPreviewV1({ supabase: input.supabase, accountKey: input.accountKey,
      monitor: input.monitor, itemId: row.itemId, traceId: input.traceId, now: input.now })
    const gatedPreview = row.treatment === "OPTIMIZE" || !("original" in preview) ? preview : {
      ...preview, preview: preview.original, treatmentOptimization: "NOT_REQUIRED_METRICS_GATE",
      previewDigest: keywordWireDigestV1({ itemId: row.itemId, preview: preview.original }) }
    previews.push({ itemId: row.itemId, result: gatedPreview })
  }
  return { ...result, previews }
}

export async function persistTreatmentSimulationReceiptV1(input: { supabase: SupabaseClient; accountKey: string;
  itemId: string; idempotencyKey: string; result: Awaited<ReturnType<typeof readListingTreatmentsV1>> }) {
  const row = input.result.rows.find(r => r.itemId === input.itemId)
  if (!row || !/^[a-zA-Z0-9:_-]{8,100}$/.test(input.idempotencyKey)) throw Error("TREATMENT_RECEIPT_INPUT_INVALID")
  const digest = keywordWireDigestV1({ policy: input.result.policy, row })
  const key = keywordWireDigestV1([input.accountKey, input.itemId, input.idempotencyKey])
  const before = { metrics: row.metrics, economics: row.economics }
  const read = await input.supabase.from("seller_os_assistant_treatment_receipts_v1")
    .select("receipt_id,input_digest,before_evidence,treatment,policy,created_at")
    .eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.itemId).eq("receipt_id", key).maybeSingle()
  if (read.error) throw Error("TREATMENT_RECEIPT_READ_FAILED")
  if (read.data) {
    if (keywordWireDigestV1(read.data.policy) !== keywordWireDigestV1(input.result.policy)) throw Error("TREATMENT_IDEMPOTENCY_CONFLICT")
    return { ...read.data, replayed: true }
  }
  const inserted = await input.supabase.from("seller_os_assistant_treatment_receipts_v1").upsert({
    receipt_id: key, marketplace_account_key: input.accountKey, ebay_item_id: input.itemId,
    contract_version: TREATMENT_RECEIPT_V1, input_digest: digest, treatment: row.treatment,
    receipt_kind: "SIMULATION", policy: input.result.policy, before_evidence: before,
    result: { promotion: row.promotion, why: row.why, supportingEvidence: row.supportingEvidence },
  }, { onConflict: "receipt_id", ignoreDuplicates: true })
  if (inserted.error) throw Error("TREATMENT_RECEIPT_WRITE_FAILED")
  const durable = await input.supabase.from("seller_os_assistant_treatment_receipts_v1")
    .select("receipt_id,input_digest,before_evidence,treatment,created_at")
    .eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.itemId).eq("receipt_id", key).single()
  if (durable.error) throw Error("TREATMENT_RECEIPT_READBACK_FAILED")
  return { ...durable.data, replayed: false }
}

export async function measureLatestTreatmentV1(input: { supabase: SupabaseClient; accountKey: string;
  row: Awaited<ReturnType<typeof readListingTreatmentsV1>>["rows"][number]; window: MetricWindow }) {
  const read = await input.supabase.from("seller_os_assistant_treatment_receipts_v1")
    .select("receipt_id,receipt_kind,before_evidence,created_at")
    .eq("marketplace_account_key", input.accountKey).eq("ebay_item_id", input.row.itemId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (read.error) throw Error("TREATMENT_MEASUREMENT_READ_FAILED")
  if (!read.data) return { itemId: input.row.itemId, status: "INSUFFICIENT_EVIDENCE", reason: "NO_TREATMENT_RECEIPT", causalAttribution: false }
  type Snapshot = { metrics?: ReturnType<typeof projectListingMetricsV1>; economics?: { profitBeforeAds: number | null } }
  const snapshot = (value: Snapshot) => {
    const window = value.metrics?.windows[input.window]
    const observation = window?.impressions
    return { itemId: input.row.itemId, window: input.window,
      reference: observation?.reference ?? "", start: observation?.window?.start ?? "", end: observation?.window?.end ?? "",
      values: { ctr: window?.ctr?.value ?? null, conversion: window?.conversion?.value ?? null,
        traffic: window?.impressions?.value ?? null, sales: window?.salesRevenue?.value ?? null,
        profit: value.economics?.profitBeforeAds ?? null } }
  }
  const compared = compareTreatmentReceiptV1(snapshot(read.data.before_evidence as Snapshot), snapshot(input.row))
  return { itemId: input.row.itemId, receiptId: read.data.receipt_id, receiptKind: read.data.receipt_kind,
    ...compared, appliedMarketplaceAction: false, profitComparisonBasis: "UNIT_ECONOMICS_NOT_REALIZED_TOTAL_PROFIT" }
}
