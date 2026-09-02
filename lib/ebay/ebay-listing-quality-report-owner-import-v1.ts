import { createHash, randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  EBAY_LISTING_QUALITY_REPORT_SOURCE,
  parseEbayListingQualityReportV1,
  QualityReportValidationError,
  type QualityReportValidationReason,
// @ts-expect-error Node's direct TypeScript audit runner requires the suffix.
} from "./ebay-listing-quality-report-import-v1.ts"

export const OWNER_LISTING_QUALITY_REPORT_IMPORT_VERSION =
  "REMOTE_OPERATOR_LISTING_QUALITY_REPORT_OWNER_IMPORT_V1_2026_09_02"

export type OwnerQualityReportSnapshotV1 = ReturnType<
  typeof parseEbayListingQualityReportV1>

export type OwnerQualityLiveListingV1 = Readonly<{
  listingKey: string
  itemId: string
  sku: string | null
}>

export type ExactProductTruthV1 = Readonly<{
  reference: string
  itemSpecifics: Readonly<Record<string, string>>
}>

export class OwnerQualityReportImportError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
    this.name = "OwnerQualityReportImportError"
  }
}

export type OwnerQualityReportUploadAttemptV1 = Readonly<{
  id: string
  attemptedAt: string
  fileType: "CSV" | "XLSX" | "JSON"
  status: "FAILED_VALIDATION" | "IMPORTED"
  safeFailureCode: string | null
  technicalReasonCode: string | null
  diagnosticsCaptureStatus: "CAPTURED" | "NOT_CAPTURED_LEGACY"
  workbookSheetNames: readonly string[]
  observedHeaderNames: readonly string[]
  recognizedSheet: string | null
  recognizedSheetNames: readonly string[]
  recognizedSheetCount: number
  headerMatchStatus: string
  failedStage: string
  requestTransportClass: string
  requestContentTypeClass: string
  fileSizeClass: string
  mimeTypeClass: string
  deploymentId: string
  rowsParsed: number
  currentLiveRowsMatched: number
  nonliveRowsExcluded: number
  validImportId: string | null
}>

function text(value: unknown, maximum = 500) {
  return typeof value === "string" && value.trim()
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum)
    : null
}

function normalized(value: unknown) {
  return (text(value, 160) ?? "").toLocaleLowerCase("en-US")
}

function normalizedSku(value: unknown) {
  return (text(value, 120) ?? "").toLocaleUpperCase("en-US")
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function boundedStringList(value: unknown, maximumItems: number) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((entry) => {
    const candidate = text(entry, 160)
    return candidate ? [candidate] : []
  }))].slice(0, maximumItems)
}

const HEADER_FAILURES = new Set<QualityReportValidationReason>([
  "NO_VALID_SHEET", "HEADER_ROW_NOT_FOUND", "ITEM_ID_COLUMN_NOT_FOUND",
  "RECOMMENDATION_COLUMNS_NOT_FOUND", "HUMAN_SELECTION_REQUIRED",
])

function technicalReasonCode(error: unknown) {
  if (error instanceof QualityReportValidationError) {
    const diagnosed = text(error.diagnosis.technicalReasonCode, 180)
    if (diagnosed && /^QUALITY_REPORT_[A-Z0-9_]{3,160}$/.test(diagnosed)) {
      return diagnosed
    }
    return `QUALITY_REPORT_${error.reason}`
  }
  const candidate = error instanceof Error ? error.message : ""
  return /^QUALITY_REPORT_[A-Z0-9_]{3,160}$/.test(candidate)
    ? candidate : "QUALITY_REPORT_IMPORT_FAILED"
}

function humanSafeFailureCode(error: unknown) {
  const reason = error instanceof QualityReportValidationError
    ? error.reason : null
  if (reason === "UNSUPPORTED_FILE_TYPE") return "REPORT_FILE_TYPE_NOT_SUPPORTED"
  if (reason === "FILE_TOO_LARGE") return "REPORT_FILE_TOO_LARGE"
  if (reason === "WORKBOOK_UNREADABLE" || reason === "MALFORMED_WORKBOOK") {
    return "REPORT_FILE_COULD_NOT_BE_READ"
  }
  if (reason && HEADER_FAILURES.has(reason)) {
    return "REPORT_STRUCTURE_NOT_RECOGNIZED"
  }
  return "REPORT_VALIDATION_NOT_PASSED"
}

function headerMatchStatus(error: unknown) {
  if (!(error instanceof QualityReportValidationError)) return "NOT_REACHED"
  return HEADER_FAILURES.has(error.reason) ? error.reason : "OTHER"
}

function diagnosticValue(error: unknown, key: string) {
  return error instanceof QualityReportValidationError
    ? error.diagnosis[key] : null
}

function reportFileSize(format: "CSV" | "XLSX" | "JSON", content: string) {
  return format === "XLSX" ? Buffer.from(content, "base64").length
    : Buffer.byteLength(content, "utf8")
}

const FAILED_STAGES = new Set([
  "REQUEST_BODY", "FILE_BUFFER", "WORKBOOK_OPEN",
  "WORKBOOK_SHEET_ENUMERATION", "SCHEMA_DISCOVERY", "ROW_PARSE",
  "IMPORT_VALIDATION", "IMPORT_RPC", "ATTEMPT_PERSIST",
])

function sanitizedFailedStage(error: unknown, fallback: string) {
  const diagnosed = text(diagnosticValue(error, "failedStage"), 80)
  if (diagnosed && FAILED_STAGES.has(diagnosed)) return diagnosed
  return FAILED_STAGES.has(fallback) ? fallback : "IMPORT_VALIDATION"
}

function fileSizeClass(bytes: number) {
  if (bytes <= 256 * 1024) return "UNDER_256_KIB" as const
  if (bytes <= 1024 * 1024) return "UNDER_1_MIB" as const
  if (bytes <= 3 * 1024 * 1024) return "UNDER_3_MIB" as const
  return "OVER_LIMIT" as const
}

function mimeTypeClass(value: unknown) {
  const candidate = normalized(value).split(";")[0].trim()
  if (!candidate) return "UNSPECIFIED" as const
  if (["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel"].includes(candidate)) return "XLSX_STANDARD" as const
  if (candidate === "application/octet-stream") return "OCTET_STREAM" as const
  return "OTHER" as const
}

function requestContentTypeClass(value: unknown) {
  const candidate = normalized(value).split(";")[0].trim()
  if (!candidate) return "UNSPECIFIED" as const
  return candidate === "application/json" ? "APPLICATION_JSON" as const
    : "OTHER" as const
}

function deploymentId(value: unknown) {
  const candidate = text(value, 100)
  return candidate && /^dpl_[A-Za-z0-9]{20,80}$/.test(candidate)
    ? candidate : "UNAVAILABLE_RUNTIME"
}

function attemptCorrelationReference(seed?: string) {
  return `qlr_attempt_${sha(seed ?? randomUUID()).slice(0, 32)}`
}

export function prepareFailedOwnerQualityReportUploadAttemptV1(input: {
  accountKey: string
  attemptedBy: string
  format: "CSV" | "XLSX" | "JSON"
  content: string
  error: unknown
  snapshot?: OwnerQualityReportSnapshotV1 | null
  mimeType?: string | null
  requestContentType?: string | null
  deploymentId?: string | null
  failedStage?: string
  attemptedAt?: string
  correlationSeed?: string
}) {
  const attemptedAt = new Date(input.attemptedAt ?? new Date().toISOString())
  if (!Number.isFinite(attemptedAt.getTime())) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_ATTEMPT_TIME_INVALID")
  }
  const workbook = input.snapshot?.workbook as Record<string, unknown> | undefined
  const workbookDiagnosis = workbook?.diagnosis &&
    typeof workbook.diagnosis === "object" && !Array.isArray(workbook.diagnosis)
    ? workbook.diagnosis as Record<string, unknown> : {}
  const recognizedSheetNames = boundedStringList(
    workbook?.recognizedWorksheets ?? diagnosticValue(input.error,
      "recognizedWorksheets"), 20)
  const sizeBytes = Math.max(1, reportFileSize(input.format, input.content))
  return Object.freeze({
    marketplace_account_key: input.accountKey,
    attempted_by: input.attemptedBy,
    attempted_at: attemptedAt.toISOString(),
    file_type: input.format,
    source_file_fingerprint: `qlr_file_${sha(input.content).slice(0, 32)}`,
    source_file_size_bytes: sizeBytes,
    attempt_status: "FAILED_VALIDATION" as const,
    safe_failure_code: humanSafeFailureCode(input.error),
    technical_reason_code: technicalReasonCode(input.error),
    diagnostics_capture_status: "CAPTURED" as const,
    workbook_sheet_names: boundedStringList(
      workbook?.worksheetNames ?? diagnosticValue(input.error,
        "worksheetNames"), 20),
    observed_header_names: boundedStringList(
      workbookDiagnosis.observedHeaderNames ?? diagnosticValue(input.error,
        "observedHeaderNames"), 250),
    recognized_sheet: text(
      workbook?.selectedWorksheet ?? diagnosticValue(input.error,
        "selectedWorksheet"), 120),
    recognized_sheet_names: recognizedSheetNames,
    recognized_sheet_count: recognizedSheetNames.length,
    header_match_status: headerMatchStatus(input.error),
    failed_stage: sanitizedFailedStage(input.error,
      input.failedStage ?? "IMPORT_VALIDATION"),
    request_transport_class: "JSON_BASE64" as const,
    request_content_type_class: requestContentTypeClass(
      input.requestContentType),
    file_size_class: fileSizeClass(sizeBytes),
    mime_type_class: mimeTypeClass(input.mimeType),
    deployment_id: deploymentId(input.deploymentId),
    rows_parsed: Math.max(0, Number(
      diagnosticValue(input.error, "detectedRows")) || 0),
    current_live_rows_matched: 0,
    nonlive_rows_excluded: 0,
    valid_import_id: null,
    request_correlation_reference: attemptCorrelationReference(
      input.correlationSeed),
  })
}

export function prepareSuccessfulOwnerQualityReportUploadAttemptV1(input: {
  accountKey: string
  attemptedBy: string
  format: "CSV" | "XLSX" | "JSON"
  content: string
  snapshot: OwnerQualityReportSnapshotV1
  prepared: ReturnType<typeof prepareOwnerListingQualityReportImportV1>
  validImportId: string
  mimeType?: string | null
  requestContentType?: string | null
  deploymentId?: string | null
  attemptedAt?: string
  correlationSeed?: string
}) {
  const attemptedAt = new Date(input.attemptedAt ?? new Date().toISOString())
  if (!Number.isFinite(attemptedAt.getTime())) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_ATTEMPT_TIME_INVALID")
  }
  const workbook = input.snapshot.workbook as Record<string, unknown>
  const diagnosis = workbook.diagnosis && typeof workbook.diagnosis === "object"
    && !Array.isArray(workbook.diagnosis)
    ? workbook.diagnosis as Record<string, unknown> : {}
  const recognizedSheetNames = boundedStringList(
    workbook.recognizedWorksheets, 20)
  const sizeBytes = Math.max(1, reportFileSize(input.format, input.content))
  return Object.freeze({
    marketplace_account_key: input.accountKey,
    attempted_by: input.attemptedBy,
    attempted_at: attemptedAt.toISOString(),
    file_type: input.format,
    source_file_fingerprint: input.snapshot.sourceFileFingerprint as
      `qlr_file_${string}`,
    source_file_size_bytes: sizeBytes,
    attempt_status: "IMPORTED" as const,
    safe_failure_code: null,
    technical_reason_code: null,
    diagnostics_capture_status: "CAPTURED" as const,
    workbook_sheet_names: boundedStringList(workbook.worksheetNames, 20),
    observed_header_names: boundedStringList(
      diagnosis.observedHeaderNames, 250),
    recognized_sheet: text(workbook.selectedWorksheet, 120),
    recognized_sheet_names: recognizedSheetNames,
    recognized_sheet_count: recognizedSheetNames.length,
    header_match_status: "MATCHED" as const,
    failed_stage: "NONE" as const,
    request_transport_class: "JSON_BASE64" as const,
    request_content_type_class: requestContentTypeClass(
      input.requestContentType),
    file_size_class: fileSizeClass(sizeBytes),
    mime_type_class: mimeTypeClass(input.mimeType),
    deployment_id: deploymentId(input.deploymentId),
    rows_parsed: input.snapshot.rowCount,
    current_live_rows_matched: input.prepared.import.report_row_count -
      input.prepared.import.nonlive_rows_excluded,
    nonlive_rows_excluded: input.prepared.import.nonlive_rows_excluded,
    valid_import_id: input.validImportId,
    request_correlation_reference: attemptCorrelationReference(
      input.correlationSeed),
  })
}

export async function persistOwnerQualityReportUploadAttemptV1(input: {
  supabase: SupabaseClient
  attempt: ReturnType<typeof prepareFailedOwnerQualityReportUploadAttemptV1> |
    ReturnType<typeof prepareSuccessfulOwnerQualityReportUploadAttemptV1>
}) {
  const table = input.supabase
    .from("ebay_listing_quality_report_upload_attempts")
  const result = input.attempt.attempt_status === "IMPORTED"
    ? await table.insert(input.attempt).select("id").single()
    : await table.insert(input.attempt).select("id").single()
  if (result.error || !text(result.data?.id, 40)) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_ATTEMPT_AUDIT_FAILED")
  }
  return Object.freeze({ attemptId: String(result.data.id) })
}

function reportDate(value: unknown) {
  const candidate = text(value, 40)
  if (!candidate) return null
  const iso = candidate.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/)
  const us = candidate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const result = iso ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
      : null
  if (!result) return null
  const parsed = new Date(`${result}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result
    ? result : null
}

function legacySignalType(row: OwnerQualityReportSnapshotV1["rows"][number]) {
  const value = normalized([row.recommendationCategory, row.recommendationType,
    row.recommendationText, row.qualityIssue, row.itemSpecificName]
    .filter(Boolean).join(" "))
  if (row.itemSpecificName || /item specific|aspect|attribute/.test(value)) {
    return "ITEM_SPECIFIC_MISSING" as const
  }
  if (/image|photo|picture|gallery/.test(value)) return "IMAGE_REVIEW" as const
  if (/title/.test(value)) return "TITLE_REVIEW" as const
  if (/category/.test(value)) return "CATEGORY_REVIEW" as const
  if (/description/.test(value)) return "DESCRIPTION_REVIEW" as const
  return "GENERAL_LISTING_QUALITY" as const
}

type SupportedQualitySignalV1 = Readonly<{
  type: "LISTING_QUALITY_SPECIFIC_RECOMMENDATION" |
    "VISUAL_COVERAGE_REVIEW" | "GOOGLE_SHOPPING_REJECTION" |
    "PROMOTION_VISIBILITY_OPPORTUNITY" |
    ReturnType<typeof legacySignalType>
  kind: "ITEM_SPECIFIC" | "VISUAL_COVERAGE" | "GOOGLE_REJECTION" |
    "PROMOTION" | "LEGACY"
  proposedField: string | null
  normalizedPayload: string
}>

function reportValuePresent(value: unknown) {
  const candidate = normalized(value)
  return Boolean(candidate) &&
    !/^(?:0|false|no|none|n a|n\/a|na|not applicable|-)$/.test(candidate) &&
    !/no (?:google shopping )?rejections?/.test(candidate)
}

function recommendedSpecificFields(value: unknown) {
  const candidate = text(value, 500)
  if (!candidate || !reportValuePresent(candidate)) return []
  return [...new Set(candidate.split(/[\n,;|]+/).flatMap((entry) => {
    const field = text(entry.replace(/^[-•*\s]+/, "")
      .replace(/\s*\([^)]*recommended[^)]*\)\s*$/i, ""), 120)
    if (!field || /^\d+(?:\.\d+)?$/.test(field) || !/[a-z]/i.test(field)) return []
    return [field]
  }))].slice(0, 20)
}

function promotionOpportunity(value: unknown) {
  const candidate = normalized(value)
  return /^(?:0|false|no|none|inactive|eligible)$/.test(candidate) ||
    /not promoted|not using|not active/.test(candidate)
}

function supportedSignals(row: OwnerQualityReportSnapshotV1["rows"][number]) {
  const result: SupportedQualitySignalV1[] = []
  for (const field of recommendedSpecificFields(
    row.recommendedItemSpecificsToAdd)) {
    result.push({ type: "LISTING_QUALITY_SPECIFIC_RECOMMENDATION",
      kind: "ITEM_SPECIFIC", proposedField: field,
      normalizedPayload: normalized(field) })
  }
  if (row.numberOfPhotos !== null && row.numberOfPhotos <= 1) {
    result.push({ type: "VISUAL_COVERAGE_REVIEW", kind: "VISUAL_COVERAGE",
      proposedField: null, normalizedPayload: `photo_count:${row.numberOfPhotos}` })
  }
  if (reportValuePresent(row.googleShoppingRejections)) {
    result.push({ type: "GOOGLE_SHOPPING_REJECTION", kind: "GOOGLE_REJECTION",
      proposedField: null, normalizedPayload: "rejection:present" })
  }
  if (promotionOpportunity(row.promotedListings)) {
    result.push({ type: "PROMOTION_VISIBILITY_OPPORTUNITY", kind: "PROMOTION",
      proposedField: null, normalizedPayload: "promotion:not_active" })
  }
  if (!result.length && (row.recommendationText || row.recommendationCategory ||
      row.recommendationType || row.qualityIssue || row.itemSpecificName ||
      row.reportedBenchmark !== null || row.topCategoryBenchmark !== null)) {
    const type = legacySignalType(row)
    result.push({ type, kind: type === "ITEM_SPECIFIC_MISSING"
      ? "ITEM_SPECIFIC" : "LEGACY",
      proposedField: text(row.itemSpecificName, 120),
      normalizedPayload: normalized(row.recommendationText ?? row.qualityIssue ??
        row.recommendationType ?? row.recommendationCategory ?? "legacy") })
  }
  return result
}

function sourceSignalSemantics(
  row: OwnerQualityReportSnapshotV1["rows"][number],
  signal: SupportedQualitySignalV1,
) {
  return Object.freeze({
    source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
    schema: "OFFICIAL_LISTING_QUALITY_REPORT",
    sourceSheetReference: row.sourceSheetName
      ? `qlr_sheet_${sha(row.sourceSheetName).slice(0, 16)}` : null,
    signalKind: signal.kind,
    metrics: Object.freeze({
      dailyImpressionsPerListing: row.dailyImpressionsPerListing,
      clickThroughRatePercent: row.clickThroughRate,
      salesConversionRatePercent: row.salesConversionRate,
    }),
    listingContext: Object.freeze({
      numberOfPhotos: row.numberOfPhotos,
      promotedListingActive: row.promotedListings
        ? !promotionOpportunity(row.promotedListings) : null,
      googleShoppingRejectionPresent:
        reportValuePresent(row.googleShoppingRejections),
    }),
    identifierContext: Object.freeze({
      upcPresent: Boolean(text(row.upc, 40)),
      eanPresent: Boolean(text(row.ean, 40)),
      identifierValuesPersisted: false as const,
    }),
  })
}

function exactFact(truth: ExactProductTruthV1 | undefined, field: string | null) {
  if (!truth || !field) return null
  const wanted = normalized(field)
  const entry = Object.entries(truth.itemSpecifics).find(([name, value]) =>
    normalized(name) === wanted && Boolean(text(value, 240)))
  return entry ? { field: text(entry[0], 120)!, value: text(entry[1], 240)!,
    reference: truth.reference } : null
}

const NEED_EVIDENCE =
  "eBay recomienda completar este dato, pero todavía no tenemos información suficiente. No necesitas hacer nada."

export function prepareOwnerListingQualityReportImportV1(input: {
  snapshot: OwnerQualityReportSnapshotV1
  accountKey: string
  accountAlias: string
  importedBy: string
  liveScope: Readonly<{ scopeId: string; observedAt: string | null;
    identityStatus: string }>
  liveListings: readonly OwnerQualityLiveListingV1[]
  productTruthByItemId?: ReadonlyMap<string, ExactProductTruthV1>
  now?: string
}) {
  if (!input.accountKey || !input.accountAlias ||
      !/^[0-9a-f-]{36}$/i.test(input.importedBy)) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_OWNER_SCOPE_INVALID")
  }
  if (input.liveScope.identityStatus !== "CERTIFIED" ||
      !input.liveScope.observedAt || !input.liveScope.scopeId) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_CURRENT_LIVE_SCOPE_UNPROVEN")
  }
  const workbook = input.snapshot.workbook as Record<string, unknown>
  const schemaDiscovered = workbook.selectionMethod === "SCHEMA_MULTI_SHEET"
  const liveByItem = new Map(input.liveListings.map((listing) =>
    [listing.itemId, listing]))
  if (liveByItem.size !== input.liveListings.length || input.liveListings.some((row) =>
    !/^\d{9,20}$/.test(row.itemId))) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_CURRENT_LIVE_SCOPE_AMBIGUOUS")
  }
  if (input.snapshot.rows.some((row) => !row.itemId || !/^\d{9,20}$/.test(row.itemId))) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_EXACT_ITEM_ID_REQUIRED")
  }
  const exactLiveMatches = input.snapshot.rows.filter((row) =>
    liveByItem.has(row.itemId!))
  if (!exactLiveMatches.length) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_CURRENT_LIVE_MATCH_REQUIRED")
  }
  const accounts = [...new Set(input.snapshot.rows.map((row) =>
    text(row.reportAccount, 120)).filter((value): value is string => Boolean(value)))]
  const explicitAccountMatch = accounts.length === 1 &&
    normalized(accounts[0]) === normalized(input.accountAlias) &&
    input.snapshot.rows.every((row) => Boolean(text(row.reportAccount, 120)))
  const currentLiveAccountMatch = schemaDiscovered && accounts.length === 0 &&
    exactLiveMatches.length > 0
  if (!explicitAccountMatch && !currentLiveAccountMatch) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_ACCOUNT_MATCH_UNPROVEN")
  }
  const reportAccount = explicitAccountMatch ? accounts[0] : input.accountAlias
  const dates = input.snapshot.rows.map((row) => reportDate(row.reportDate))
  if (dates.some((value) => !value) || new Set(dates).size !== 1) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_DATE_UNPROVEN")
  }
  const normalizedReportDate = dates[0]!
  const now = new Date(input.now ?? new Date().toISOString())
  if (!Number.isFinite(now.getTime()) || normalizedReportDate > now.toISOString().slice(0, 10)) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_DATE_INVALID")
  }
  const marketplaces = [...new Set(input.snapshot.rows.map((row) =>
    normalized(row.marketplace)).filter(Boolean))]
  if (marketplaces.some((value) => !["ebay_us", "us", "ebay.com"].includes(value))) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_MARKETPLACE_MISMATCH")
  }
  const liveBySku = new Map<string, OwnerQualityLiveListingV1[]>()
  for (const listing of input.liveListings) {
    const sku = normalizedSku(listing.sku)
    if (sku) liveBySku.set(sku, [...(liveBySku.get(sku) ?? []), listing])
  }
  for (const row of input.snapshot.rows) {
    const reportSku = normalizedSku(row.sku)
    if (!reportSku) continue
    const itemListing = liveByItem.get(row.itemId!)
    const skuListings = liveBySku.get(reportSku) ?? []
    if (itemListing && normalizedSku(itemListing.sku) !== reportSku ||
        skuListings.some((listing) => listing.itemId !== row.itemId)) {
      throw new OwnerQualityReportImportError("QUALITY_REPORT_SKU_MAPPING_MISMATCH")
    }
  }

  let nonliveRowsExcluded = 0
  const covered = new Set<string>()
  const seen = new Set<string>()
  const signals = input.snapshot.rows.flatMap((row) => {
    const listing = liveByItem.get(row.itemId!)
    if (!listing) { nonliveRowsExcluded += 1; return [] }
    const reportSku = normalizedSku(row.sku)
    const listingSku = normalizedSku(listing.sku)
    if (reportSku && (!listingSku || reportSku !== listingSku)) {
      throw new OwnerQualityReportImportError("QUALITY_REPORT_SKU_MAPPING_MISMATCH")
    }
    covered.add(row.itemId!)
    const truth = input.productTruthByItemId?.get(row.itemId!)
    const freshness = normalizedReportDate === now.toISOString().slice(0, 10)
      ? "CURRENT" as const : "STALE" as const
    return supportedSignals(row).flatMap((signal) => {
      const dedupeKey = `sha256:${sha([normalizedReportDate, row.itemId,
        signal.type, signal.normalizedPayload].join("|"))}`
      if (seen.has(dedupeKey)) return []
      seen.add(dedupeKey)
      const fact = signal.kind === "ITEM_SPECIFIC"
        ? exactFact(truth, signal.proposedField) : null
      const truthSupported = signal.kind === "ITEM_SPECIFIC"
        ? Boolean(fact) : signal.kind === "GOOGLE_REJECTION" ||
          signal.kind === "PROMOTION" ? false : Boolean(truth)
      const actionable = freshness === "CURRENT" && (signal.kind === "ITEM_SPECIFIC"
        ? Boolean(fact) : signal.kind === "VISUAL_COVERAGE" || signal.kind === "LEGACY"
          ? truthSupported : false)
      let happening = "eBay encontró una mejora posible en la información de este producto."
      let why = "Una ficha clara puede ayudar a que eBay y los compradores entiendan mejor el producto."
      let recommendation = truthSupported
        ? "Seller OS confirmó la identidad del producto exacto. Revisa la mejora sin cambiar hechos del producto."
        : NEED_EVIDENCE
      let whatToDo = actionable
        ? "Revisa la mejora propuesta y confirma que representa el producto exacto."
        : NEED_EVIDENCE
      let priority: "NEEDS_ATTENTION" | "CAN_IMPROVE" | "ENRICH" | "WAIT" =
        actionable ? "CAN_IMPROVE" : "WAIT"
      if (signal.kind === "ITEM_SPECIFIC") {
        happening = `eBay recomienda completar ${signal.proposedField} en este producto.`
        why = `Agregar ${signal.proposedField} puede ayudar a que eBay entienda mejor el listing.`
        recommendation = fact
          ? `Seller OS encontró un valor respaldado por el producto exacto: ${fact.value}.`
          : NEED_EVIDENCE
        whatToDo = fact ? `Revisa ${fact.field}: ${fact.value}.` : NEED_EVIDENCE
        priority = fact ? "NEEDS_ATTENTION" : "WAIT"
      } else if (signal.kind === "VISUAL_COVERAGE") {
        happening = "Este producto tiene una cobertura visual muy limitada."
        why = "Más vistas útiles pueden ayudar al comprador a entender mejor el producto."
        recommendation = truthSupported
          ? "Revisa si Seller OS tiene una propuesta visual del producto exacto."
          : NEED_EVIDENCE
        whatToDo = actionable
          ? "Compara las imágenes actuales con la propuesta y confirma que representan el producto exacto."
          : NEED_EVIDENCE
        priority = actionable ? "ENRICH" : "WAIT"
      } else if (signal.kind === "GOOGLE_REJECTION") {
        happening = "Google Shopping detectó un problema en este producto."
        why = "El problema puede limitar dónde aparece el listing fuera de eBay."
        recommendation = "Seller OS recomienda revisar la ficha sin cambiar hechos del producto."
        whatToDo = "Revisa la señal; si falta evidencia del producto exacto, no cambies nada."
        priority = "CAN_IMPROVE"
      } else if (signal.kind === "PROMOTION") {
        happening = "Este producto podría recibir más visibilidad."
        why = "Una promoción puede ampliar su exposición, pero implica una decisión de gasto."
        recommendation = "Necesita aprobación del owner."
        whatToDo = "No cambies el gasto. Déjalo para aprobación del owner."
        priority = "CAN_IMPROVE"
      }
      if (freshness === "STALE") {
        whatToDo = "Este reporte está desactualizado. No necesitas hacer nada con esta señal."
        priority = "WAIT"
      }
      return [{
        item_id: row.itemId!, sku: row.sku,
        signal_type: signal.type,
        raw_signal_reference: row.sourceRowFingerprint,
        normalized_recommendation: recommendation,
        what_is_happening: happening,
        why_it_matters: why,
        seller_os_recommendation: recommendation,
        what_to_do_now: whatToDo,
        priority_class: priority,
        product_truth_supported: truthSupported,
        proposed_field: fact?.field ?? null,
        proposed_value: fact?.value ?? null,
        product_truth_reference: fact?.reference ??
          (truthSupported ? truth?.reference ?? null : null),
        operator_action_required: actionable,
        sku_match_when_available: reportSku ? true : null,
        dedupe_key: dedupeKey,
        source_signal_semantics: sourceSignalSemantics(row, signal),
      }]
    })
  })
  const freshness = normalizedReportDate === now.toISOString().slice(0, 10)
    ? "CURRENT" as const : "STALE" as const
  const actionable = signals.filter((row) => row.operator_action_required).length
  const needEvidence = signals.filter((row) =>
    !row.product_truth_supported && ["ITEM_SPECIFIC_MISSING",
      "LISTING_QUALITY_SPECIFIC_RECOMMENDATION"].includes(row.signal_type)).length
  return Object.freeze({
    import: Object.freeze({
      marketplace_account_key: input.accountKey,
      parser_version: input.snapshot.parserVersion,
      source_file_fingerprint: input.snapshot.sourceFileFingerprint,
      file_name: input.snapshot.fileName,
      report_account: reportAccount,
      report_date: normalizedReportDate,
      report_observed_at: `${normalizedReportDate}T00:00:00.000Z`,
      freshness,
      live_scope_id: input.liveScope.scopeId,
      live_scope_observed_at: input.liveScope.observedAt,
      current_live_count: input.liveListings.length,
      report_row_count: input.snapshot.rows.length,
      live_listings_covered: covered.size,
      signals_imported: signals.length,
      signals_actionable: actionable,
      signals_need_evidence: needEvidence,
      nonlive_rows_excluded: nonliveRowsExcluded,
      imported_by: input.importedBy,
    }),
    signals: Object.freeze(signals),
    guards: Object.freeze({ currentLive: true as const,
      exactItemIdMatch: true as const, nonliveRowsExcluded: true as const,
      accountMatchAuthority: explicitAccountMatch
        ? "REPORT_METADATA" as const : "CANONICAL_CURRENT_LIVE_ITEM_ID" as const,
      duplicateTaskCount: 0 as const, factInvented: false as const,
      rawFileStored: false as const, remoteRawAccess: false as const }),
  })
}

function itemSpecifics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([name, raw]) => {
    const safeName = text(name, 120)
    const safeValue = text(raw, 240)
    return safeName && safeValue ? [[safeName, safeValue]] : []
  }))
}

export async function readExactProductTruthForLiveListingsV1(input: {
  supabase: SupabaseClient
  accountKey: string
  itemIds: readonly string[]
}) {
  if (!input.itemIds.length) return new Map<string, ExactProductTruthV1>()
  const links = await input.supabase.from("ebay_manual_listing_links")
    .select("ebay_item_id,opportunity_id,candidate_key,verification_status,connector_listing_status")
    .eq("account_key", input.accountKey).eq("marketplace_id", "EBAY_US")
    .eq("verification_status", "verified").eq("connector_listing_status", "active")
    .in("ebay_item_id", [...input.itemIds])
  if (links.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_PRODUCT_TRUTH_READ_FAILED")
  const opportunityIds = [...new Set((links.data ?? []).map((row) =>
    text(row.opportunity_id, 40)).filter((value): value is string => Boolean(value)))]
  if (!opportunityIds.length) return new Map<string, ExactProductTruthV1>()
  const packages = await input.supabase.from("ebay_listing_packages")
    .select("id,opportunity_id,candidate_key,status,package_data")
    .eq("status", "approved").in("opportunity_id", opportunityIds)
  if (packages.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_PRODUCT_TRUTH_READ_FAILED")
  const result = new Map<string, ExactProductTruthV1>()
  for (const link of links.data ?? []) {
    const packageRow = (packages.data ?? []).find((row) =>
      row.opportunity_id === link.opportunity_id && row.candidate_key === link.candidate_key)
    if (!packageRow || result.has(link.ebay_item_id)) continue
    const data = packageRow.package_data && typeof packageRow.package_data === "object" &&
      !Array.isArray(packageRow.package_data)
      ? packageRow.package_data as Record<string, unknown> : {}
    const specifics = itemSpecifics(data.itemSpecifics ?? data.aspects)
    result.set(link.ebay_item_id, Object.freeze({
      reference: `APPROVED_EXACT_LISTING_PACKAGE:${packageRow.id}`,
      itemSpecifics: Object.freeze(specifics),
    }))
  }
  return result
}

export async function persistOwnerListingQualityReportV1(input: {
  supabase: SupabaseClient
  prepared: ReturnType<typeof prepareOwnerListingQualityReportImportV1>
}) {
  const existing = await input.supabase.from("ebay_listing_quality_report_imports")
    .select("id").eq("marketplace_account_key",
      input.prepared.import.marketplace_account_key)
    .eq("source_file_fingerprint", input.prepared.import.source_file_fingerprint)
    .maybeSingle()
  if (existing.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_DUPLICATE_CHECK_FAILED")
  if (existing.data?.id) return { importId: existing.data.id, idempotent: true as const }
  const result = await input.supabase.rpc("import_ebay_listing_quality_report_v1", {
    p_import: input.prepared.import,
    p_signals: input.prepared.signals,
  })
  if (result.error || !text(result.data, 40)) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_PERSIST_FAILED")
  }
  return { importId: String(result.data), idempotent: false as const }
}

export async function readOwnerListingQualityReportStatusV1(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: string
}) {
  const result = await input.supabase.from("ebay_listing_quality_report_imports")
    .select("id,imported_at,report_date,live_listings_covered,signals_imported,signals_actionable,signals_need_evidence,nonlive_rows_excluded")
    .eq("marketplace_account_key", input.accountKey)
    .order("imported_at", { ascending: false }).limit(1).maybeSingle()
  if (result.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_STATUS_READ_FAILED")
  const today = new Date(input.now ?? new Date().toISOString()).toISOString().slice(0, 10)
  if (!result.data) return Object.freeze({ state: "MISSING" as const,
    lastReportImportedAt: null, reportDate: null, reportFreshness: "MISSING" as const,
    liveListingsCovered: 0, signalsImported: 0, signalsActionable: 0,
    signalsNeedEvidence: 0, nonliveRowsExcluded: 0, reminderVisible: true as const })
  const current = result.data.report_date === today
  return Object.freeze({ state: current ? "CURRENT" as const : "STALE" as const,
    lastReportImportedAt: result.data.imported_at,
    reportDate: result.data.report_date,
    reportFreshness: current ? "CURRENT" as const : "STALE" as const,
    liveListingsCovered: result.data.live_listings_covered,
    signalsImported: result.data.signals_imported,
    signalsActionable: result.data.signals_actionable,
    signalsNeedEvidence: result.data.signals_need_evidence,
    nonliveRowsExcluded: result.data.nonlive_rows_excluded,
    reminderVisible: !current })
}

export async function readOwnerQualityReportLatestUploadAttemptV1(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const result = await input.supabase
    .from("ebay_listing_quality_report_upload_attempts")
    .select("id,attempted_at,file_type,attempt_status,safe_failure_code,technical_reason_code,diagnostics_capture_status,workbook_sheet_names,observed_header_names,recognized_sheet,recognized_sheet_names,recognized_sheet_count,header_match_status,failed_stage,request_transport_class,request_content_type_class,file_size_class,mime_type_class,deployment_id,rows_parsed,current_live_rows_matched,nonlive_rows_excluded,valid_import_id")
    .eq("marketplace_account_key", input.accountKey)
    .order("attempted_at", { ascending: false })
    .order("id", { ascending: false }).limit(1).maybeSingle()
  if (result.error) {
    throw new OwnerQualityReportImportError("QUALITY_REPORT_ATTEMPT_STATUS_READ_FAILED")
  }
  if (!result.data) return null
  return Object.freeze({
    id: result.data.id,
    attemptedAt: result.data.attempted_at,
    fileType: result.data.file_type,
    status: result.data.attempt_status,
    safeFailureCode: result.data.safe_failure_code,
    technicalReasonCode: result.data.technical_reason_code,
    diagnosticsCaptureStatus: result.data.diagnostics_capture_status,
    workbookSheetNames: Object.freeze(
      boundedStringList(result.data.workbook_sheet_names, 20)),
    observedHeaderNames: Object.freeze(
      boundedStringList(result.data.observed_header_names, 250)),
    recognizedSheet: result.data.recognized_sheet,
    recognizedSheetNames: Object.freeze(
      boundedStringList(result.data.recognized_sheet_names, 20)),
    recognizedSheetCount: result.data.recognized_sheet_count,
    headerMatchStatus: result.data.header_match_status,
    failedStage: result.data.failed_stage,
    requestTransportClass: result.data.request_transport_class,
    requestContentTypeClass: result.data.request_content_type_class,
    fileSizeClass: result.data.file_size_class,
    mimeTypeClass: result.data.mime_type_class,
    deploymentId: result.data.deployment_id,
    rowsParsed: result.data.rows_parsed,
    currentLiveRowsMatched: result.data.current_live_rows_matched,
    nonliveRowsExcluded: result.data.nonlive_rows_excluded,
    validImportId: result.data.valid_import_id,
  }) as OwnerQualityReportUploadAttemptV1
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
  const latest = await input.supabase.from("ebay_listing_quality_report_imports")
    .select("id,report_date").eq("marketplace_account_key", input.accountKey)
    .order("imported_at", { ascending: false }).limit(1).maybeSingle()
  if (latest.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_STATUS_READ_FAILED")
  if (!latest.data?.id) return Object.freeze([]) as readonly RemoteListingQualitySignalV1[]
  const rows = await input.supabase.from("ebay_listing_quality_report_signals")
    .select("id,report_observed_at,item_id,signal_type,freshness,what_is_happening,why_it_matters,seller_os_recommendation,what_to_do_now,priority_class,product_truth_supported,proposed_field,proposed_value,operator_action_required")
    .eq("report_import_id", latest.data.id).order("created_at", { ascending: true })
  if (rows.error) throw new OwnerQualityReportImportError("QUALITY_REPORT_SIGNAL_READ_FAILED")
  const today = new Date(input.now ?? new Date().toISOString()).toISOString().slice(0, 10)
  const dynamicallyStale = latest.data.report_date !== today
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

export const OWNER_QUALITY_REPORT_SAFETY_V1 = Object.freeze({
  source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
  deterministicFirst: true as const,
  remoteOperatorUploadAccess: false as const,
  remoteOperatorRawReportAccess: false as const,
  factInvented: false as const,
  marketplaceWrites: 0 as const,
  listingMutations: 0 as const,
  newListingPublications: 0 as const,
  buyerMessages: 0 as const,
  postsaleActions: 0 as const,
})
