import { createHash } from "node:crypto"

export const EBAY_LISTING_QUALITY_REPORT_IMPORT_VERSION =
  "EBAY_LISTING_QUALITY_REPORT_IMPORT_V1_2026_08_11"
export const EBAY_LISTING_QUALITY_REPORT_SOURCE = "EBAY_LISTING_QUALITY_REPORT" as const

type Row = Record<string, unknown>
type QualityFormat = "CSV" | "JSON"

const ALIASES = {
  itemId: ["item id", "itemid", "listing id", "listingid"],
  sku: ["sku", "custom label", "customlabel"],
  recommendationCategory: ["recommendation category", "category", "recommendationcategory"],
  recommendationType: ["recommendation type", "type", "recommendationtype"],
  recommendationText: ["recommendation", "recommendation text", "guidance", "suggestion"],
  reportedBenchmark: ["benchmark", "reported benchmark", "category benchmark"],
  topCategoryBenchmark: ["top 10 benchmark", "top 10% benchmark", "top category benchmark"],
  qualityIssue: ["quality issue", "data issue", "issue"],
  reportDate: ["report date", "date"],
  reportWindowStart: ["window start", "report start", "start date"],
  reportWindowEnd: ["window end", "report end", "end date"],
  marketplace: ["marketplace", "site"],
} as const

const PII_HEADERS = /buyer|customer|email|phone|address|payment|recipient/i
const SECRET_TEXT = /authorization|bearer\s+|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|service[_ -]?role|cookie/i
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

function safeText(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum) || null
    : typeof value === "number" && Number.isFinite(value) ? String(value) : null
}

function normalizedHeader(value: unknown) {
  return (safeText(value, 120) ?? "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim()
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function parseCsv(content: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    if (char === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index += 1 }
      else quoted = !quoted
    } else if (char === "," && !quoted) {
      row.push(cell); cell = ""
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index += 1
      row.push(cell); cell = ""
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
    } else cell += char
  }
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  if (rows.length < 2) throw new Error("QUALITY_REPORT_CSV_ROWS_REQUIRED")
  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, "").trim())
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) =>
    [header, values[index] ?? ""])))
}

function parseRows(format: QualityFormat, content: string): Row[] {
  if (format === "CSV") return parseCsv(content)
  const parsed: unknown = JSON.parse(content)
  const rows = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Row).rows)
      ? (parsed as Row).rows as unknown[] : null
  if (!rows) throw new Error("QUALITY_REPORT_JSON_ROWS_REQUIRED")
  return rows.map((value) => value && typeof value === "object" && !Array.isArray(value)
    ? value as Row : {})
}

function field(row: Row, aliases: readonly string[]) {
  const entry = Object.entries(row).find(([key]) => aliases.includes(normalizedHeader(key)))
  return entry ? entry[1] : null
}

function numberValue(value: unknown) {
  const candidate = safeText(value, 40)?.replace(/[%,$]/g, "")
  const parsed = candidate === null ? Number.NaN : Number(candidate)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function parseEbayListingQualityReportV1(input: {
  format: QualityFormat
  fileName: string
  content: string
  importedAt?: string
}) {
  const importedAt = new Date(input.importedAt ?? new Date().toISOString())
  if (!Number.isFinite(importedAt.getTime())) throw new Error("QUALITY_REPORT_IMPORT_TIME_INVALID")
  if (!input.content.trim() || input.content.length > 5_000_000) {
    throw new Error("QUALITY_REPORT_FILE_INVALID")
  }
  if (SECRET_TEXT.test(input.content) || EMAIL.test(input.content)) {
    throw new Error("QUALITY_REPORT_SECRET_OR_PII_REJECTED")
  }
  const rawRows = parseRows(input.format, input.content)
  const headers = [...new Set(rawRows.flatMap((row) => Object.keys(row)))]
  if (headers.some((header) => PII_HEADERS.test(header))) {
    throw new Error("QUALITY_REPORT_BUYER_PII_HEADER_REJECTED")
  }
  const knownAliases = new Set<string>(Object.values(ALIASES).flat())
  const unknownHeaders = headers.filter((header) => !knownAliases.has(normalizedHeader(header)))
  const rows = rawRows.map((row, index) => {
    const itemId = safeText(field(row, ALIASES.itemId), 30)
    const sku = safeText(field(row, ALIASES.sku), 120)
    const recommendationText = safeText(field(row, ALIASES.recommendationText))
    const recommendationCategory = safeText(field(row, ALIASES.recommendationCategory), 120)
    const recommendationType = safeText(field(row, ALIASES.recommendationType), 120)
    const qualityIssue = safeText(field(row, ALIASES.qualityIssue), 240)
    if ((!itemId && !sku) || (!recommendationText && !recommendationCategory &&
        !recommendationType && !qualityIssue)) {
      throw new Error("QUALITY_REPORT_REQUIRED_STRUCTURE_MISSING")
    }
    if (itemId && !/^\d{9,19}$/.test(itemId)) throw new Error("QUALITY_REPORT_ITEM_ID_INVALID")
    const unknownFields = Object.fromEntries(unknownHeaders.map((header) =>
      [header.slice(0, 120), safeText(row[header], 240)]).filter(([, value]) => value !== null))
    return {
      sourceRowNumber: index + 2,
      sourceRowFingerprint: `qlr_row_${sha(JSON.stringify({ itemId, sku, recommendationText,
        recommendationCategory, recommendationType, qualityIssue })).slice(0, 24)}`,
      itemId,
      sku,
      recommendationCategory,
      recommendationType,
      recommendationText,
      reportedBenchmark: numberValue(field(row, ALIASES.reportedBenchmark)),
      topCategoryBenchmark: numberValue(field(row, ALIASES.topCategoryBenchmark)),
      qualityIssue,
      reportDate: safeText(field(row, ALIASES.reportDate), 40),
      reportWindowStart: safeText(field(row, ALIASES.reportWindowStart), 40),
      reportWindowEnd: safeText(field(row, ALIASES.reportWindowEnd), 40),
      marketplace: safeText(field(row, ALIASES.marketplace), 30),
      unknownFields,
    }
  })
  return {
    source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
    parserVersion: EBAY_LISTING_QUALITY_REPORT_IMPORT_VERSION,
    parserStatus: "READY_FOR_REAL_SAMPLE" as const,
    fileName: safeText(input.fileName, 180) ?? "quality-report",
    sourceFileFingerprint: `qlr_file_${sha(input.content).slice(0, 32)}`,
    importedAt: importedAt.toISOString(),
    rowCount: rows.length,
    unknownHeaders,
    rows,
    rawFileStored: false as const,
    buyerPiiStored: false as const,
  }
}

export function associateEbayListingQualityReportV1(input: {
  snapshot: ReturnType<typeof parseEbayListingQualityReportV1>
  listings: Array<{ listingKey: string; itemId: string; sku: string | null }>
}) {
  const byItem = new Map<string, typeof input.listings>()
  const bySku = new Map<string, typeof input.listings>()
  for (const listing of input.listings) {
    byItem.set(listing.itemId, [...(byItem.get(listing.itemId) ?? []), listing])
    if (listing.sku) bySku.set(listing.sku, [...(bySku.get(listing.sku) ?? []), listing])
  }
  return input.snapshot.rows.map((row) => {
    const candidates = row.itemId ? byItem.get(row.itemId) ?? []
      : row.sku ? bySku.get(row.sku) ?? [] : []
    const status = candidates.length > 1 ? "AMBIGUOUS" as const
      : candidates.length === 0 ? "UNRESOLVED" as const
        : row.itemId ? "MATCHED_ITEM_ID" as const : "MATCHED_UNIQUE_SKU" as const
    return { ...row, listingKey: candidates.length === 1 ? candidates[0].listingKey : null,
      associationStatus: status, fuzzyAssociationUsed: false as const }
  })
}

export function toCommercialMonitorQualityArtifactV1(
  snapshot: ReturnType<typeof parseEbayListingQualityReportV1>,
) {
  return {
    source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
    sourceVersion: snapshot.parserVersion,
    observedAt: snapshot.rows.map((row) => row.reportDate).find(Boolean) ?? snapshot.importedAt,
    importedAt: snapshot.importedAt,
    sourceFileFingerprint: snapshot.sourceFileFingerprint,
    rows: snapshot.rows.map((row) => ({
      itemId: row.itemId,
      sku: row.sku,
      recommendationCategory: row.recommendationCategory,
      recommendationType: row.recommendationType,
      recommendationText: row.recommendationText ?? row.qualityIssue,
      reportedBenchmark: row.reportedBenchmark,
      topCategoryBenchmark: row.topCategoryBenchmark,
      sourceRowFingerprint: row.sourceRowFingerprint,
    })),
  }
}
