import type { SupabaseClient } from "@supabase/supabase-js"
import { OwnerQualityReportImportError } from "./ebay-listing-quality-report-errors-v1"
const EBAY_LISTING_QUALITY_REPORT_SOURCE = "EBAY_LISTING_QUALITY_REPORT" as const
const OWNER_LISTING_QUALITY_REPORT_IMPORT_VERSION = "REMOTE_OPERATOR_LISTING_QUALITY_REPORT_OWNER_IMPORT_V1_2026_09_02"

export async function readLatestValidListingQualityImportV1(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const result = await input.supabase.from("ebay_listing_quality_report_imports")
    .select("id,imported_at,report_date,report_observed_at,live_listings_covered,current_live_count,signals_imported,signals_actionable,signals_need_evidence,nonlive_rows_excluded")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .order("report_date", { ascending: false })
    .order("imported_at", { ascending: false })
    .order("id", { ascending: false }).limit(1).maybeSingle()
  if (result.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_STATUS_READ_FAILED")
  return result.data
}

export async function readOwnerListingQualityReportStatusV1(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: string
}) {
  const result = { data: await readLatestValidListingQualityImportV1(input) }
  const today = new Date(input.now ?? new Date().toISOString()).toISOString().slice(0, 10)
  if (!result.data) return Object.freeze({ state: "MISSING" as const,
    reportExists: false, importId: null,
    lastReportImportedAt: null, reportDate: null, reportFreshness: "MISSING" as const,
    liveListingsCovered: 0, signalsImported: 0, signalsActionable: 0,
    signalsNeedEvidence: 0, nonliveRowsExcluded: 0, reminderVisible: true as const })
  const current = result.data.report_date === today
  return Object.freeze({ state: current ? "CURRENT" as const : "STALE" as const,
    reportExists: true, importId: result.data.id,
    lastReportImportedAt: result.data.imported_at,
    reportDate: result.data.report_date,
    reportFreshness: current ? "CURRENT" as const : "STALE" as const,
    liveListingsCovered: result.data.live_listings_covered,
    signalsImported: result.data.signals_imported,
    signalsActionable: current ? result.data.signals_actionable : 0,
    signalsNeedEvidence: result.data.signals_need_evidence,
    nonliveRowsExcluded: result.data.nonlive_rows_excluded,
    reminderVisible: !current })
}

export type RemoteListingQualitySignalV1 = Readonly<{
  signalId: string
  itemId: string
  sourceAuthority: "EBAY_LISTING_QUALITY_REPORT"
  observedAt: string
  signalType: string
  freshness: "CURRENT" | "STALE"
  whatIsHappening: string
  whyItMatters: string
  sellerOsRecommendation: string
  whatToDoNow: string
  priorityClass: "NEEDS_ATTENTION" | "CAN_IMPROVE" | "ENRICH" | "WAIT"
  productTruthSupported: boolean
  proposedField: string | null
  proposedValue: string | null
  operatorActionRequired: boolean
}>

export async function readRemoteListingQualitySignalsV1(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: string
}) {
  const latest = { data: await readLatestValidListingQualityImportV1(input) }
  if (!latest.data?.id) return Object.freeze([]) as readonly RemoteListingQualitySignalV1[]
  return readSignalsForQualityImportV1(input, latest.data)
}

async function readSignalsForQualityImportV1(input: {
  supabase: SupabaseClient; accountKey: string; now?: string
}, latest: { id: string; report_date: string; signals_imported?: number }) {
  const rows = await input.supabase.from("ebay_listing_quality_report_signals")
    .select("id,report_observed_at,item_id,signal_type,freshness,what_is_happening,why_it_matters,seller_os_recommendation,what_to_do_now,priority_class,product_truth_supported,proposed_field,proposed_value,operator_action_required")
    .eq("report_import_id", latest.id).order("created_at", { ascending: true })
  if (rows.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_SIGNAL_READ_FAILED")
  if (typeof latest.signals_imported === "number" && (rows.data ?? []).length !== latest.signals_imported) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_SIGNAL_READ_INCOMPLETE")
  }
  const today = new Date(input.now ?? new Date().toISOString()).toISOString().slice(0, 10)
  const dynamicallyStale = latest.report_date !== today
  return Object.freeze((rows.data ?? []).map((row) => Object.freeze({
    signalId: row.id,
    itemId: row.item_id,
    sourceAuthority: "EBAY_LISTING_QUALITY_REPORT" as const,
    observedAt: row.report_observed_at,
    signalType: row.signal_type,
    freshness: dynamicallyStale ? "STALE" as const
      : row.freshness as "CURRENT" | "STALE",
    whatIsHappening: row.what_is_happening,
    whyItMatters: row.why_it_matters,
    sellerOsRecommendation: row.seller_os_recommendation,
    whatToDoNow: dynamicallyStale
      ? "Este reporte está desactualizado. No necesitas hacer nada con esta señal."
      : row.what_to_do_now,
    priorityClass: dynamicallyStale ? "WAIT" as const
      : row.priority_class as RemoteListingQualitySignalV1["priorityClass"],
    productTruthSupported: row.product_truth_supported,
    proposedField: row.proposed_field, proposedValue: row.proposed_value,
    operatorActionRequired: dynamicallyStale ? false
      : row.operator_action_required,
  })))
}

async function readLatestQualityUploadReceiptV1(input: {
  supabase: SupabaseClient; accountKey: string; now?: string
}, selected: Awaited<ReturnType<typeof readLatestValidListingQualityImportV1>>) {
  try {
    const result = await input.supabase.from("ebay_listing_quality_report_upload_attempts")
      .select("id,attempted_at,attempt_status,rows_parsed,current_live_rows_matched,valid_import_id")
      .eq("marketplace_account_key", input.accountKey)
      .order("attempted_at", { ascending: false }).order("id", { ascending: false })
      .limit(1).maybeSingle()
    if (result.error) throw new Error("QUALITY_UPLOAD_RECEIPT_READ_FAILED")
    const attempt = result.data
    if (!attempt) return { status: "MISSING" as const }
    let uploaded = attempt.valid_import_id === selected?.id ? selected : null
    if (attempt.valid_import_id && !uploaded) {
      const report = await input.supabase.from("ebay_listing_quality_report_imports")
        .select("id,report_date,signals_imported")
        .eq("id", attempt.valid_import_id).eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US").maybeSingle()
      if (report.error || !report.data) throw new Error("QUALITY_UPLOAD_IMPORT_READ_FAILED")
      uploaded = report.data
    }
    const today = (input.now ?? new Date().toISOString()).slice(0, 10)
    return { status: "AVAILABLE" as const, attemptId: String(attempt.id),
      attemptedAt: String(attempt.attempted_at),
      attemptStatus: attempt.attempt_status === "IMPORTED" ? "IMPORTED" as const : "FAILED_VALIDATION" as const,
      validImportId: uploaded?.id ?? null, reportDate: uploaded?.report_date ?? null,
      freshness: uploaded ? uploaded.report_date === today ? "CURRENT" as const : "STALE" as const : null,
      rowsParsed: Number(attempt.rows_parsed), currentLiveRowsMatched: Number(attempt.current_live_rows_matched),
      signalsImported: uploaded ? Number(uploaded.signals_imported) : null,
      selectedAsLatestValidReport: Boolean(uploaded && uploaded.id === selected?.id) }
  } catch { return { status: "UNAVAILABLE" as const } }
}

// Recommendation dates/signals use one selected import. The last upload receipt
// independently identifies an older upload without replacing the latest report.
export async function readDurableListingQualityArtifactV1(input: {
  supabase: SupabaseClient; accountKey: string; now?: string
}) {
  const latest = await readLatestValidListingQualityImportV1(input)
  const latestUploadAttempt = await readLatestQualityUploadReceiptV1(input, latest)
  if (!latest) return { source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
    durable: true, reportExists: false, status: "MISSING", rows: [], latestUploadAttempt }
  const signals = await readSignalsForQualityImportV1(input, latest)
  const freshness = latest.report_date === (input.now ?? new Date().toISOString()).slice(0, 10)
    ? "CURRENT" : "STALE"
  return { source: EBAY_LISTING_QUALITY_REPORT_SOURCE, durable: true,
    latestUploadAttempt,
    sourceVersion: OWNER_LISTING_QUALITY_REPORT_IMPORT_VERSION,
    reportExists: true, importId: latest.id, reportDate: latest.report_date,
    freshness, observedAt: latest.report_observed_at, importedAt: latest.imported_at,
    coverage: { liveListingsCovered: latest.live_listings_covered,
      historicalLiveScopeCount: latest.current_live_count,
      nonliveRowsExcluded: latest.nonlive_rows_excluded },
    rows: signals.map(signal => ({ itemId: signal.itemId,
      recommendationCategory: signal.priorityClass, recommendationType: signal.signalType,
      recommendationText: signal.sellerOsRecommendation, freshness: signal.freshness,
      actionState: signal.freshness === "STALE" ? "WAIT"
        : !signal.productTruthSupported ? "NEEDS_EVIDENCE"
        : signal.operatorActionRequired ? "ACTIONABLE" : "WAIT",
      productTruthSupported: signal.productTruthSupported })) }
}
