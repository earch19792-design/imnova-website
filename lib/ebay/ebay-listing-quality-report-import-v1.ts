import { createHash } from "node:crypto"
import { unzipSync } from "fflate"

export const EBAY_LISTING_QUALITY_REPORT_IMPORT_VERSION =
  "EBAY_LISTING_QUALITY_REPORT_IMPORT_V1_2026_09_02_REAL_WORKBOOK_V4"
export const EBAY_LISTING_QUALITY_REPORT_SOURCE = "EBAY_LISTING_QUALITY_REPORT" as const

type Row = Record<string, unknown>
type QualityFormat = "CSV" | "JSON" | "XLSX"
export type QualityReportValidationReason = "UNSUPPORTED_FILE_TYPE" | "WORKBOOK_UNREADABLE" |
  "NO_DATA_SHEET_FOUND" | "HEADER_ROW_NOT_FOUND" | "ITEM_ID_COLUMN_NOT_FOUND" |
  "LISTING_IDENTITY_UNPROVEN" | "RECOMMENDATION_COLUMNS_NOT_FOUND" |
  "BENCHMARK_COLUMNS_NOT_FOUND" | "MULTIPLE_CANDIDATE_SHEETS" |
  "HUMAN_SELECTION_REQUIRED" | "NO_VALID_SHEET" |
  "MALFORMED_WORKBOOK" | "FILE_TOO_LARGE" | "OTHER"

// Base64 transport stays below the Vercel request-body ceiling. OOXML expansion is bounded separately.
const MAX_FILE_BYTES = 3_000_000
const MAX_UNCOMPRESSED_BYTES = 24_000_000
const MAX_WORKSHEETS = 20
const MAX_ROWS = 25_000
const MAX_COLUMNS = 250
const MAX_HEADER_SCAN_ROWS = 80

const ALIASES = {
  itemId: ["item id", "itemid", "listing id", "listingid", "ebay item id", "ebayitemid"],
  itemTitle: ["item title", "listing title", "title"],
  sku: ["sku", "custom label", "customlabel", "custom sku"],
  reportAccount: ["seller account", "account", "seller username", "ebay username", "account name"],
  itemSpecificName: ["item specific", "item specific name", "aspect", "aspect name", "attribute", "attribute name", "field name"],
  recommendationCategory: ["recommendation category", "recommendation category name", "category", "recommendationcategory"],
  recommendationType: ["recommendation type", "type", "recommendationtype"],
  recommendationText: ["recommendation", "recommendation text", "guidance", "suggestion", "recommended action"],
  reportedBenchmark: ["benchmark", "reported benchmark", "category benchmark"],
  topCategoryBenchmark: ["top 10 benchmark", "top 10% benchmark", "top category benchmark", "top 10 percent benchmark"],
  qualityIssue: ["quality issue", "data issue", "issue", "quality recommendation"],
  category: ["ebay category", "category name", "leaf category"],
  reportDate: ["report date", "date"],
  reportWindowStart: ["window start", "report start", "start date"],
  reportWindowEnd: ["window end", "report end", "end date"],
  marketplace: ["marketplace", "site"],
  recommendedItemSpecificsToAdd: ["recommended item specifics to add"],
  numberOfPhotos: ["number of photos", "photo count", "photos"],
  googleShoppingRejections: ["google shopping rejections", "google shopping rejection"],
  promotedListings: ["promoted listings", "promoted listing"],
  promotedListingsAdRate: ["promoted listings ad rate", "promoted listing ad rate"],
  dailyImpressionsPerListing: ["daily impressions per listing"],
  clickThroughRate: ["click through rate", "click-through rate", "ctr"],
  salesConversionRate: ["sales conversion rate", "conversion rate"],
  upc: ["upc"],
  ean: ["ean"],
} as const

const IDENTITY_ALIASES = [...ALIASES.itemId, ...ALIASES.sku]
const RECOMMENDATION_ALIASES = [...ALIASES.recommendationCategory,
  ...ALIASES.recommendationType, ...ALIASES.recommendationText, ...ALIASES.qualityIssue]
const BENCHMARK_ALIASES = [...ALIASES.reportedBenchmark, ...ALIASES.topCategoryBenchmark]
const REAL_QUALITY_ALIASES = [
  ...ALIASES.recommendedItemSpecificsToAdd, ...ALIASES.numberOfPhotos,
  ...ALIASES.googleShoppingRejections, ...ALIASES.promotedListings,
  ...ALIASES.promotedListingsAdRate, ...ALIASES.dailyImpressionsPerListing,
  ...ALIASES.clickThroughRate, ...ALIASES.salesConversionRate,
]
const NON_LISTING_SHEET_NAMES = new Set(["summary", "guide"])
const PII_HEADERS = /buyer|customer|email|phone|address|payment|recipient/i
const SECRET_TEXT = /authorization|bearer\s+|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|service[_ -]?role|cookie/i
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const FORBIDDEN_XLSX_PATH = /(^|\/)(vbaProject\.bin|externalLinks\/|embeddings\/|activeX\/|customXml\/)/i
const XML_DECODER = new TextDecoder("utf-8", { fatal: false })

export class QualityReportValidationError extends Error {
  reason: QualityReportValidationReason
  diagnosis: Record<string, unknown>
  constructor(reason: QualityReportValidationReason,
    diagnosis: Record<string, unknown> = {}) {
    super(reason)
    this.name = "QualityReportValidationError"
    this.reason = reason
    this.diagnosis = diagnosis
  }
}

function safeText(value: unknown, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, maximum) || null
    : typeof value === "number" && Number.isFinite(value) ? String(value)
      : value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null
}

function normalizedHeader(value: unknown) {
  return (safeText(value, 160) ?? "").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim()
}

function sha(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function decodeXml(value: string) {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g,
      (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
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
  if (rows.length < 2) throw new QualityReportValidationError("HEADER_ROW_NOT_FOUND")
  const headers = rows[0].slice(0, MAX_COLUMNS).map((value) => value.replace(/^\uFEFF/, "").trim())
  return { rows: rows.slice(1, MAX_ROWS + 1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))),
  metadata: { format: "CSV" as const, worksheetNames: [], selectedWorksheet: null,
    headerRowNumber: 1, formulaCellCount: 0, externalLinksRejected: false } }
}

function parseJson(content: string) {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { throw new QualityReportValidationError("OTHER") }
  const rows = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as Row).rows)
      ? (parsed as Row).rows as unknown[] : null
  if (!rows) throw new QualityReportValidationError("HEADER_ROW_NOT_FOUND")
  return { rows: rows.slice(0, MAX_ROWS).map((value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}),
  metadata: { format: "JSON" as const, worksheetNames: [], selectedWorksheet: null,
    headerRowNumber: 1, formulaCellCount: 0, externalLinksRejected: false } }
}

function xlsxColumnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ""
  return [...letters].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1
}

function workbookSheets(xml: string) {
  return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/?\s*>/g)]
    .map((match) => ({ name: decodeXml(match[1]).slice(0, 120), relationshipId: match[2] }))
}

function workbookRelationships(xml: string) {
  return new Map([...xml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/?\s*>/g)]
    .map((match) => [match[1], match[2].replace(/^\/?/, "")]))
}

function sharedStrings(xml: string | null) {
  if (!xml) return []
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((text) => text[1]).join("")))
}

function workbookCreatedAt(xml: string | null) {
  if (!xml) return null
  const value = xml.match(/<dcterms:created\b[^>]*>([^<]+)<\/dcterms:created>/i)?.[1]
  const candidate = safeText(value, 80)
  if (!candidate) return null
  const parsed = new Date(candidate)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function labeledWorkbookMetadata(grid: ReturnType<typeof worksheetGrid>) {
  const result: { reportAccounts: string[]; reportDates: string[];
    marketplaces: string[] } = { reportAccounts: [], reportDates: [], marketplaces: [] }
  const definitions = [
    { target: result.reportAccounts,
      labels: ["seller account", "seller username", "ebay username", "account name", "seller id"] },
    { target: result.reportDates,
      labels: ["report date", "report generated", "generated on", "generation date"] },
    { target: result.marketplaces,
      labels: ["marketplace", "ebay site", "site"] },
  ]
  for (const row of grid.rows.slice(0, MAX_HEADER_SCAN_ROWS)) {
    for (const [index, raw] of row.cells.entries()) {
      const cell = safeText(raw, 240)
      if (!cell) continue
      const normalizedCell = normalizedHeader(cell)
      for (const definition of definitions) {
        const exact = definition.labels.includes(normalizedCell)
        const inline = definition.labels.find((label) =>
          normalizedCell.startsWith(`${label} `))
        const adjacent = exact ? row.cells.slice(index + 1)
          .map((value) => safeText(value, 160)).find(Boolean) ?? null : null
        const embedded = inline ? safeText(cell.slice(inline.length)
          .replace(/^\s*[:=-]\s*/, ""), 160) : null
        const value = adjacent ?? embedded
        if (value && !definition.target.includes(value)) definition.target.push(value)
      }
    }
  }
  return result
}

function worksheetGrid(xml: string, strings: string[]) {
  let formulaCellCount = 0
  const rows: Array<{ rowNumber: number; cells: string[] }> = []
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS + MAX_HEADER_SCAN_ROWS) break
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1)
    const cells: string[] = []
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const column = xlsxColumnIndex(cellMatch[1].match(/\br="([A-Z]+\d+)"/i)?.[1] ?? "")
      if (column < 0 || column >= MAX_COLUMNS) continue
      const type = cellMatch[1].match(/\bt="([^"]+)"/)?.[1] ?? "n"
      const body = cellMatch[2]
      if (/<f\b/i.test(body)) formulaCellCount += 1
      const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1]
      const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? null
      const value = inline ? [...inline.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((match) => decodeXml(match[1])).join("")
        : type === "s" && raw !== null ? strings[Number(raw)] ?? ""
          : raw === null ? "" : decodeXml(raw)
      cells[column] = value
    }
    if (cells.some((cell) => safeText(cell) !== null)) rows.push({ rowNumber, cells })
  }
  return { rows, formulaCellCount }
}

function headerScore(cells: string[]) {
  const normalized = new Set(cells.map(normalizedHeader).filter(Boolean))
  const identity = IDENTITY_ALIASES.some((alias) => normalized.has(alias))
  const itemTitle = ALIASES.itemTitle.some((alias) => normalized.has(alias))
  const recommendation = RECOMMENDATION_ALIASES.some((alias) => normalized.has(alias))
  const benchmark = BENCHMARK_ALIASES.some((alias) => normalized.has(alias))
  const schemaQuality = REAL_QUALITY_ALIASES.some((alias) => normalized.has(alias))
  const itemId = ALIASES.itemId.some((alias) => normalized.has(alias))
  const sku = ALIASES.sku.some((alias) => normalized.has(alias))
  const category = ALIASES.category.some((alias) => normalized.has(alias))
  const recognizableHeaders = Object.values(ALIASES).filter((aliases) =>
    aliases.some((alias) => normalized.has(alias))).length
  return { score: Number(identity) * 5 + Number(itemTitle) * 4 +
    Number(schemaQuality) * 6 + Number(recommendation) * 4 + Number(benchmark) * 2,
    identity, itemId, itemTitle, sku, recommendation, benchmark, schemaQuality,
    category, recognizableHeaders }
}

function candidateSheetEvidence(input: {
  definition: { name: string; relationshipId: string }
  grid: ReturnType<typeof worksheetGrid>
  header: ReturnType<typeof headerScore> & { rowNumber: number; cells: string[] }
}) {
  const normalizedHeaders = input.header.cells.map(normalizedHeader)
  const columnFor = (aliases: readonly string[]) => normalizedHeaders.findIndex((header) =>
    aliases.includes(header))
  const itemIdColumn = columnFor(ALIASES.itemId)
  const skuColumn = columnFor(ALIASES.sku)
  const guidanceColumns = [
    columnFor(ALIASES.recommendationCategory), columnFor(ALIASES.recommendationType),
    columnFor(ALIASES.recommendationText), columnFor(ALIASES.qualityIssue),
    columnFor(ALIASES.reportedBenchmark), columnFor(ALIASES.topCategoryBenchmark),
    columnFor(ALIASES.recommendedItemSpecificsToAdd),
    columnFor(ALIASES.numberOfPhotos), columnFor(ALIASES.googleShoppingRejections),
    columnFor(ALIASES.promotedListings), columnFor(ALIASES.promotedListingsAdRate),
    columnFor(ALIASES.dailyImpressionsPerListing), columnFor(ALIASES.clickThroughRate),
    columnFor(ALIASES.salesConversionRate),
  ].filter((column) => column >= 0)
  const dataRows = input.grid.rows.filter((row) => row.rowNumber > input.header.rowNumber)
    .slice(0, MAX_ROWS)
  const nonEmptyRows = dataRows.filter((row) => row.cells.some((cell) => safeText(cell) !== null))
  const validIdentity = (row: typeof dataRows[number]) => {
    const itemId = itemIdColumn >= 0 ? safeText(row.cells[itemIdColumn], 30) : null
    const sku = skuColumn >= 0 ? safeText(row.cells[skuColumn], 120) : null
    return Boolean(itemId && /^\d{9,19}$/.test(itemId) || sku)
  }
  const validGuidance = (row: typeof dataRows[number]) => guidanceColumns.some((column) =>
    safeText(row.cells[column]) !== null)
  const recognizedRows = nonEmptyRows.filter((row) => validIdentity(row) && validGuidance(row))
  const duplicateHeaderNoiseRows = nonEmptyRows.filter((row) => row.cells.filter((cell) =>
    normalizedHeaders.includes(normalizedHeader(cell)) && normalizedHeader(cell)).length >= 2).length
  const metadataText = input.grid.rows.filter((row) => row.rowNumber < input.header.rowNumber)
    .flatMap((row) => row.cells).map(normalizedHeader).join(" ")
  const reportMetadataConsistency = ["ebay", "listing", "quality", "report"]
    .filter((token) => metadataText.includes(token)).length
  const rowDensity = nonEmptyRows.length ? recognizedRows.length / nonEmptyRows.length : 0
  const confidence = Math.round(Math.max(0, Math.min(100,
    Number(input.header.itemId) * 18 + Number(input.header.itemTitle) * 8 +
    Number(input.header.schemaQuality) * 16 + Number(input.header.sku) * 7 +
    Number(input.header.recommendation) * 16 + Number(input.header.benchmark) * 10 +
    Number(input.header.category) * 5 + Math.min(12, input.header.recognizableHeaders * 2) +
    Math.min(12, recognizedRows.length * 2) + rowDensity * 14 +
    Math.min(6, reportMetadataConsistency * 1.5) -
    Math.min(20, duplicateHeaderNoiseRows * 5))))
  const recognizedKeyColumns = [
    ...(input.header.itemId ? ["ITEM_ID"] : []),
    ...(input.header.itemTitle ? ["ITEM_TITLE"] : []),
    ...(input.header.sku ? ["UNIQUE_SKU"] : []),
    ...(input.header.recommendation ? ["RECOMMENDATION"] : []),
    ...(input.header.benchmark ? ["BENCHMARK"] : []),
    ...(input.header.schemaQuality ? ["REAL_QUALITY_SCHEMA"] : []),
    ...(input.header.category ? ["CATEGORY"] : []),
  ]
  const reasonCodes = [
    ...(input.header.itemId ? ["ITEM_ID_COLUMN_PRESENT"] : []),
    ...(input.header.itemTitle ? ["ITEM_TITLE_COLUMN_PRESENT"] : []),
    ...(input.header.sku ? ["UNIQUE_SKU_COLUMN_PRESENT"] : []),
    ...(input.header.recommendation ? ["RECOMMENDATION_FIELDS_PRESENT"] : []),
    ...(input.header.benchmark ? ["BENCHMARK_FIELDS_PRESENT"] : []),
    ...(input.header.schemaQuality ? ["REAL_QUALITY_FIELDS_PRESENT"] : []),
    ...(input.header.category ? ["CATEGORY_FIELDS_PRESENT"] : []),
    ...(recognizedRows.length ? ["VALID_LISTING_ROWS_PRESENT"] : ["NO_VALID_LISTING_ROWS"]),
    ...(reportMetadataConsistency >= 2 ? ["EBAY_REPORT_METADATA_CONSISTENT"] : []),
    ...(duplicateHeaderNoiseRows ? ["DUPLICATE_HEADER_NOISE_PENALTY"] : []),
  ]
  return { ...input, confidence, recognizedRowCount: recognizedRows.length,
    nonEmptyDataRowCount: nonEmptyRows.length,
    validListingRowDensity: Math.round(rowDensity * 10_000) / 100,
    duplicateHeaderNoiseRows, reportMetadataConsistency, recognizedKeyColumns, reasonCodes }
}

function parseXlsx(contentBase64: string, requestedWorksheet?: string | null) {
  if (contentBase64.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8) {
    throw new QualityReportValidationError("FILE_TOO_LARGE")
  }
  let bytes: Uint8Array
  try { bytes = Buffer.from(contentBase64, "base64") } catch {
    throw new QualityReportValidationError("WORKBOOK_UNREADABLE")
  }
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new QualityReportValidationError(bytes.length > MAX_FILE_BYTES ? "FILE_TOO_LARGE" : "WORKBOOK_UNREADABLE")
  }
  let archive: Record<string, Uint8Array>
  try {
    let declaredUncompressedBytes = 0
    archive = unzipSync(bytes, { filter: (file) => {
      if (FORBIDDEN_XLSX_PATH.test(file.name)) {
        throw new QualityReportValidationError("MALFORMED_WORKBOOK", { forbiddenPart: true })
      }
      declaredUncompressedBytes += file.originalSize
      if (file.originalSize > MAX_UNCOMPRESSED_BYTES ||
          declaredUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new QualityReportValidationError("FILE_TOO_LARGE")
      }
      return /^(\[Content_Types\]\.xml|_rels\/\.rels|docProps\/core\.xml|xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml))$/i.test(file.name)
    } })
  } catch (error) {
    if (error instanceof QualityReportValidationError) throw error
    throw new QualityReportValidationError("WORKBOOK_UNREADABLE")
  }
  if (Object.values(archive).reduce((total, value) => total + value.length, 0) >
      MAX_UNCOMPRESSED_BYTES) throw new QualityReportValidationError("FILE_TOO_LARGE")
  const workbook = archive["xl/workbook.xml"]
  const relationships = archive["xl/_rels/workbook.xml.rels"]
  if (!workbook || !relationships) throw new QualityReportValidationError("MALFORMED_WORKBOOK")
  const sheetDefinitions = workbookSheets(XML_DECODER.decode(workbook))
  if (!sheetDefinitions.length) throw new QualityReportValidationError("NO_DATA_SHEET_FOUND")
  if (sheetDefinitions.length > MAX_WORKSHEETS) throw new QualityReportValidationError("FILE_TOO_LARGE")
  const relationshipMap = workbookRelationships(XML_DECODER.decode(relationships))
  const strings = sharedStrings(archive["xl/sharedStrings.xml"]
    ? XML_DECODER.decode(archive["xl/sharedStrings.xml"]) : null)
  const observedHeaderNames = new Set<string>()
  const workbookMetadata = { reportAccounts: new Set<string>(),
    reportDates: new Set<string>(), marketplaces: new Set<string>() }
  const evidence = sheetDefinitions.flatMap((definition) => {
    const target = relationshipMap.get(definition.relationshipId)
    if (!target) return []
    const path = target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`
    const file = archive[path]
    if (!file) return []
    const grid = worksheetGrid(XML_DECODER.decode(file), strings)
    const discoveredMetadata = labeledWorkbookMetadata(grid)
    for (const value of discoveredMetadata.reportAccounts) workbookMetadata.reportAccounts.add(value)
    for (const value of discoveredMetadata.reportDates) workbookMetadata.reportDates.add(value)
    for (const value of discoveredMetadata.marketplaces) workbookMetadata.marketplaces.add(value)
    for (const cell of grid.rows.flatMap((row) => row.cells)) {
      const candidate = safeText(cell, 1_000)
      if (candidate && (SECRET_TEXT.test(candidate) || EMAIL.test(candidate))) {
        throw new Error("QUALITY_REPORT_SECRET_OR_PII_REJECTED")
      }
    }
    const headers = grid.rows.slice(0, MAX_HEADER_SCAN_ROWS).map((row) =>
      ({ ...row, ...headerScore(row.cells) })).filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score || left.rowNumber - right.rowNumber)
    for (const cell of headers[0]?.cells ?? []) {
      const header = safeText(cell, 160)
      if (header) observedHeaderNames.add(header)
    }
    return headers[0] ? [{ ...candidateSheetEvidence({ definition, grid,
      header: headers[0] }), workbookMetadata: discoveredMetadata }] : []
  })
  const isExcludedListingSheet = (candidate: typeof evidence[number]) =>
    NON_LISTING_SHEET_NAMES.has(normalizedHeader(candidate.definition.name))
  const hasGoogleRejectionSchema = (candidate: typeof evidence[number]) => {
    const normalized = candidate.header.cells.map(normalizedHeader)
    return ALIASES.googleShoppingRejections.some((alias) => normalized.includes(alias))
  }
  const schemaCandidates = evidence.filter((candidate) =>
    !isExcludedListingSheet(candidate) && candidate.recognizedRowCount > 0 &&
    candidate.header.itemId && candidate.header.itemTitle && candidate.header.schemaQuality)
  const googleCandidates = evidence.filter((candidate) =>
    !isExcludedListingSheet(candidate) && candidate.recognizedRowCount > 0 &&
    candidate.header.itemId && hasGoogleRejectionSchema(candidate))
  const realCandidates = [...new Map([...schemaCandidates, ...googleCandidates]
    .map((candidate) => [candidate.definition.relationshipId, candidate])).values()]
    .sort((left, right) => right.confidence - left.confidence ||
      right.recognizedRowCount - left.recognizedRowCount ||
      left.definition.name.localeCompare(right.definition.name))
  const legacyCandidates = evidence.filter((candidate) =>
    candidate.recognizedRowCount > 0 && candidate.header.identity &&
    (candidate.header.recommendation || candidate.header.benchmark))
    .sort((left, right) => right.confidence - left.confidence ||
      right.recognizedRowCount - left.recognizedRowCount ||
      left.definition.name.localeCompare(right.definition.name))
  const diagnosticCandidates = realCandidates.length ? realCandidates : legacyCandidates
  const publicCandidates = diagnosticCandidates.slice(0, MAX_WORKSHEETS).map((candidate) => ({
    sheetName: candidate.definition.name, headerRowNumber: candidate.header.rowNumber,
    recognizedRowCount: candidate.recognizedRowCount,
    nonEmptyDataRowCount: candidate.nonEmptyDataRowCount,
    recognizedKeyColumns: candidate.recognizedKeyColumns,
    confidence: candidate.confidence, reasonCodes: candidate.reasonCodes,
    validListingRowDensity: candidate.validListingRowDensity,
    recognizableHeaderCount: candidate.header.recognizableHeaders,
    reportMetadataConsistency: candidate.reportMetadataConsistency,
    duplicateHeaderNoiseRows: candidate.duplicateHeaderNoiseRows,
  }))
  const metadataSnapshot = {
    reportAccount: workbookMetadata.reportAccounts.size === 1
      ? [...workbookMetadata.reportAccounts][0] : null,
    reportDate: workbookMetadata.reportDates.size === 1
      ? [...workbookMetadata.reportDates][0] : null,
    marketplace: workbookMetadata.marketplaces.size === 1
      ? [...workbookMetadata.marketplaces][0] : null,
    workbookCreatedAt: workbookCreatedAt(archive["docProps/core.xml"]
      ? XML_DECODER.decode(archive["docProps/core.xml"]) : null),
  }
  const baseDiagnosis = { recognizedFileType: "EBAY_LISTING_QUALITY_REPORT_XLSX",
    worksheetNames: sheetDefinitions.map((row) => row.name),
    candidateSheetCount: diagnosticCandidates.length,
    candidateSheets: publicCandidates,
    observedHeaderNames: [...observedHeaderNames].slice(0, MAX_COLUMNS) }
  const rowsForCandidate = (candidate: typeof evidence[number]) => {
    const headers = candidate.header.cells.map((cell, index) =>
      safeText(cell, 160) ?? `Column ${index + 1}`)
    return candidate.grid.rows.filter((row) => row.rowNumber > candidate.header.rowNumber)
      .map((row) => ({ ...Object.fromEntries(headers.map((header, index) =>
        [header, row.cells[index] ?? ""])),
      __sourceSheetName: candidate.definition.name,
      __sourceRowNumber: row.rowNumber }))
      .filter((row) => Object.entries(row).some(([key, value]) =>
        !key.startsWith("__") && safeText(value) !== null))
  }
  if (realCandidates.length) {
    const rows = realCandidates.flatMap(rowsForCandidate)
    if (!rows.length) throw new QualityReportValidationError("NO_DATA_SHEET_FOUND", {
      ...baseDiagnosis, sheetResolutionState: "SCHEMA_DISCOVERED" })
    if (rows.length > MAX_ROWS) throw new QualityReportValidationError("FILE_TOO_LARGE")
    const recognizedWorksheets = realCandidates.map((candidate) => candidate.definition.name)
    const diagnosis = { ...baseDiagnosis,
      sheetResolutionState: "SCHEMA_DISCOVERED",
      selectionMethod: "SCHEMA_MULTI_SHEET",
      recognizedWorksheets,
      recognizedSheetCount: recognizedWorksheets.length,
      selectedWorksheet: recognizedWorksheets.length === 1 ? recognizedWorksheets[0] : null,
      categorySheetNameHardcoded: false,
      summaryGuideRowsExcluded: true,
      ...metadataSnapshot }
    return { rows, metadata: { format: "XLSX" as const,
      worksheetNames: sheetDefinitions.map((row) => row.name),
      recognizedWorksheets,
      recognizedSheetCount: recognizedWorksheets.length,
      selectedWorksheet: recognizedWorksheets.length === 1 ? recognizedWorksheets[0] : null,
      headerRowNumber: realCandidates[0].header.rowNumber,
      formulaCellCount: realCandidates.reduce((total, candidate) =>
        total + candidate.grid.formulaCellCount, 0),
      externalLinksRejected: true,
      sheetResolutionState: "SCHEMA_DISCOVERED" as const,
      selectionMethod: "SCHEMA_MULTI_SHEET" as const,
      candidateSheets: publicCandidates,
      ...metadataSnapshot,
      diagnosis } }
  }
  const candidates = legacyCandidates
  if (!candidates.length) throw new QualityReportValidationError("NO_VALID_SHEET", {
    ...baseDiagnosis, sheetResolutionState: "NO_VALID_SHEET" })
  const requested = safeText(requestedWorksheet, 120)
  const explicitlySelected = requested
    ? candidates.find((candidate) => candidate.definition.name === requested) ?? null : null
  if (requested && !explicitlySelected) throw new QualityReportValidationError("NO_VALID_SHEET", {
    ...baseDiagnosis, sheetResolutionState: "NO_VALID_SHEET", requestedWorksheet: requested })
  const top = candidates[0]
  const second = candidates[1] ?? null
  const materiallyDominant = top.confidence >= 72 && (!second ||
    top.confidence - second.confidence >= 12 ||
    top.recognizedRowCount >= Math.max(3, second.recognizedRowCount * 2) &&
      top.confidence - second.confidence >= 5)
  if (!explicitlySelected && !materiallyDominant) {
    throw new QualityReportValidationError("HUMAN_SELECTION_REQUIRED", {
      ...baseDiagnosis, sheetResolutionState: "HUMAN_SELECTION_REQUIRED",
      reason: "NO_MATERIALLY_DOMINANT_HIGH_CONFIDENCE_SHEET" })
  }
  const candidate = explicitlySelected ?? top
  const score = candidate.header
  const diagnosis = { ...baseDiagnosis,
    sheetResolutionState: materiallyDominant && !explicitlySelected
      ? "AUTO_SELECTED" : "HUMAN_SELECTION_REQUIRED",
    selectionMethod: explicitlySelected ? "HUMAN_SELECTED" : "AUTO_SELECTED",
    worksheetNames: sheetDefinitions.map((row) => row.name), selectedWorksheet: candidate.definition.name,
    headerRowNumber: score.rowNumber, itemIdColumnFound: candidate.header.cells
      .some((cell) => (ALIASES.itemId as readonly string[]).includes(normalizedHeader(cell))),
    skuColumnFound: candidate.header.cells.some((cell) =>
      (ALIASES.sku as readonly string[]).includes(normalizedHeader(cell))),
    recommendationColumnsFound: score.recommendation, benchmarkColumnsFound: score.benchmark }
  if (!score.identity) throw new QualityReportValidationError("ITEM_ID_COLUMN_NOT_FOUND", diagnosis)
  if (!score.recommendation && !score.benchmark) {
    throw new QualityReportValidationError("RECOMMENDATION_COLUMNS_NOT_FOUND", diagnosis)
  }
  const rows = rowsForCandidate(candidate).slice(0, MAX_ROWS)
  if (!rows.length) throw new QualityReportValidationError("NO_DATA_SHEET_FOUND", diagnosis)
  return { rows, metadata: { format: "XLSX" as const,
    worksheetNames: sheetDefinitions.map((row) => row.name), selectedWorksheet: candidate.definition.name,
    headerRowNumber: candidate.header.rowNumber, formulaCellCount: candidate.grid.formulaCellCount,
    externalLinksRejected: true, sheetResolutionState: diagnosis.sheetResolutionState,
    selectionMethod: diagnosis.selectionMethod, candidateSheets: publicCandidates,
    recognizedWorksheets: [candidate.definition.name], recognizedSheetCount: 1,
    ...metadataSnapshot, diagnosis } }
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

function parseRows(format: QualityFormat, content: string, selectedWorksheet?: string | null) {
  if (format === "CSV") return parseCsv(content)
  if (format === "JSON") return parseJson(content)
  return parseXlsx(content, selectedWorksheet)
}

export function parseEbayListingQualityReportV1(input: {
  format: QualityFormat
  fileName: string
  content: string
  importedAt?: string
  selectedWorksheet?: string | null
}) {
  const importedAt = new Date(input.importedAt ?? new Date().toISOString())
  if (!Number.isFinite(importedAt.getTime())) throw new QualityReportValidationError("OTHER")
  const extension = input.fileName.toLowerCase().split(".").pop()
  if (!(["CSV", "JSON", "XLSX"] as QualityFormat[]).includes(input.format) ||
      !["csv", "json", "xlsx"].includes(extension ?? "")) {
    throw new QualityReportValidationError("UNSUPPORTED_FILE_TYPE")
  }
  if (!input.content.trim() || input.content.length > MAX_FILE_BYTES * 1.4) {
    throw new QualityReportValidationError("FILE_TOO_LARGE")
  }
  if (input.format !== "XLSX" && (SECRET_TEXT.test(input.content) || EMAIL.test(input.content))) {
    throw new Error("QUALITY_REPORT_SECRET_OR_PII_REJECTED")
  }
  const parsed = parseRows(input.format, input.content, input.selectedWorksheet)
  const rawRows = parsed.rows
  const parsedMetadata = parsed.metadata as Record<string, unknown>
  for (const row of rawRows) {
    for (const value of Object.values(row)) {
      const candidate = safeText(value, 1_000)
      if (candidate && (SECRET_TEXT.test(candidate) || EMAIL.test(candidate))) {
        throw new Error("QUALITY_REPORT_SECRET_OR_PII_REJECTED")
      }
    }
  }
  const headers = [...new Set(rawRows.flatMap((row) => Object.keys(row)))]
    .filter((header) => !header.startsWith("__")).slice(0, MAX_COLUMNS)
  if (headers.some((header) => PII_HEADERS.test(header))) {
    throw new Error("QUALITY_REPORT_BUYER_PII_HEADER_REJECTED")
  }
  const knownAliases = new Set<string>(Object.values(ALIASES).flat())
  const unknownHeaders = headers.filter((header) => !knownAliases.has(normalizedHeader(header)))
  const warnings: string[] = []
  const rows = rawRows.flatMap((row, index) => {
    const sourceRow = row as Row
    const itemId = safeText(field(row, ALIASES.itemId), 30)
    const sku = safeText(field(row, ALIASES.sku), 120)
    const recommendationText = safeText(field(row, ALIASES.recommendationText))
    const recommendationCategory = safeText(field(row, ALIASES.recommendationCategory), 120)
    const recommendationType = safeText(field(row, ALIASES.recommendationType), 120)
    const qualityIssue = safeText(field(row, ALIASES.qualityIssue), 240)
    const reportAccount = safeText(field(row, ALIASES.reportAccount), 120) ??
      safeText(parsedMetadata.reportAccount, 120)
    const itemSpecificName = safeText(field(row, ALIASES.itemSpecificName), 120)
    const reportedBenchmark = numberValue(field(row, ALIASES.reportedBenchmark))
    const topCategoryBenchmark = numberValue(field(row, ALIASES.topCategoryBenchmark))
    const recommendedItemSpecificsToAdd = safeText(
      field(row, ALIASES.recommendedItemSpecificsToAdd), 500)
    const numberOfPhotos = numberValue(field(row, ALIASES.numberOfPhotos))
    const googleShoppingRejections = safeText(
      field(row, ALIASES.googleShoppingRejections), 500)
    const promotedListings = safeText(field(row, ALIASES.promotedListings), 120)
    const promotedListingsAdRate = numberValue(
      field(row, ALIASES.promotedListingsAdRate))
    const dailyImpressionsPerListing = numberValue(
      field(row, ALIASES.dailyImpressionsPerListing))
    const clickThroughRate = numberValue(field(row, ALIASES.clickThroughRate))
    const salesConversionRate = numberValue(field(row, ALIASES.salesConversionRate))
    const upc = safeText(field(row, ALIASES.upc), 40)
    const ean = safeText(field(row, ALIASES.ean), 40)
    if (!itemId && !sku) { warnings.push("ROW_WITHOUT_LISTING_IDENTITY_SKIPPED"); return [] }
    if (!recommendationText && !recommendationCategory && !recommendationType && !qualityIssue &&
        reportedBenchmark === null && topCategoryBenchmark === null &&
        !recommendedItemSpecificsToAdd && numberOfPhotos === null &&
        !googleShoppingRejections && !promotedListings && promotedListingsAdRate === null &&
        dailyImpressionsPerListing === null && clickThroughRate === null &&
        salesConversionRate === null) {
      warnings.push("ROW_WITHOUT_GUIDANCE_SKIPPED"); return []
    }
    if (itemId && !/^\d{9,19}$/.test(itemId)) {
      warnings.push("ROW_WITH_INVALID_ITEM_ID_SKIPPED"); return []
    }
    const unknownFields = Object.fromEntries(unknownHeaders.map((header) =>
      [header.slice(0, 120), safeText(sourceRow[header], 240)]).filter(([, value]) => value !== null))
    return [{
      sourceSheetName: safeText(row.__sourceSheetName, 120),
      sourceRowNumber: Number(row.__sourceRowNumber) ||
        index + (Number(parsedMetadata.headerRowNumber) || 1) + 1,
      sourceRowFingerprint: `qlr_row_${sha(JSON.stringify({ itemId, sku, recommendationText,
        recommendationCategory, recommendationType, qualityIssue, reportAccount,
        itemSpecificName, recommendedItemSpecificsToAdd, numberOfPhotos,
        googleShoppingRejections, promotedListings, promotedListingsAdRate,
        dailyImpressionsPerListing, clickThroughRate, salesConversionRate,
        sourceSheetName: row.__sourceSheetName })).slice(0, 24)}`,
      itemId, sku, recommendationCategory, recommendationType, recommendationText,
      reportedBenchmark, topCategoryBenchmark, qualityIssue,
      reportAccount, itemSpecificName,
      itemTitle: safeText(field(row, ALIASES.itemTitle), 300),
      recommendedItemSpecificsToAdd, numberOfPhotos, googleShoppingRejections,
      promotedListings, promotedListingsAdRate, dailyImpressionsPerListing,
      clickThroughRate, salesConversionRate, upc, ean,
      category: safeText(field(row, ALIASES.category), 160),
      reportDate: safeText(field(row, ALIASES.reportDate), 40) ??
        safeText(parsedMetadata.reportDate, 40) ??
        safeText(parsedMetadata.workbookCreatedAt, 40)?.slice(0, 10) ?? null,
      reportWindowStart: safeText(field(row, ALIASES.reportWindowStart), 40),
      reportWindowEnd: safeText(field(row, ALIASES.reportWindowEnd), 40),
      marketplace: safeText(field(row, ALIASES.marketplace), 30) ??
        safeText(parsedMetadata.marketplace, 30), unknownFields,
    }]
  })
  if (!rows.length) throw new QualityReportValidationError("LISTING_IDENTITY_UNPROVEN", {
    ...("diagnosis" in parsed.metadata ? parsed.metadata.diagnosis : {}),
    detectedRows: rawRows.length })
  const categories = [...new Set(rows.map((row) => row.recommendationCategory).filter(Boolean))]
  return {
    source: EBAY_LISTING_QUALITY_REPORT_SOURCE,
    parserVersion: EBAY_LISTING_QUALITY_REPORT_IMPORT_VERSION,
    parserStatus: "VALIDATED_READY_FOR_IMPORT" as const,
    fileName: safeText(input.fileName, 180) ?? "quality-report",
    sourceFileFingerprint: `qlr_file_${sha(input.content).slice(0, 32)}`,
    importedAt: importedAt.toISOString(), rowCount: rows.length, unknownHeaders, rows,
    workbook: parsed.metadata,
    preview: { recognizedReport: true, rowsDetected: rawRows.length,
      normalizedRows: rows.length, recommendationCategories: categories.slice(0, 20),
      benchmarkAvailable: rows.some((row) => row.reportedBenchmark !== null),
      topTenBenchmarkAvailable: rows.some((row) => row.topCategoryBenchmark !== null),
      warnings: [...new Set(warnings)].slice(0, 20), readyForImport: true as const },
    rawFileStored: false as const, buyerPiiStored: false as const,
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

export function summarizeEbayListingQualityAssociationsV1(
  rows: ReturnType<typeof associateEbayListingQualityReportV1>,
) {
  const count = (status: string) => rows.filter((row) => row.associationStatus === status).length
  const matchedItemId = count("MATCHED_ITEM_ID")
  const matchedUniqueSku = count("MATCHED_UNIQUE_SKU")
  const unresolved = count("UNRESOLVED")
  const ambiguous = count("AMBIGUOUS")
  return { reportRows: rows.length, matchedItemId, matchedUniqueSku, unresolved, ambiguous,
    partitionValid: matchedItemId + matchedUniqueSku + unresolved + ambiguous === rows.length }
}

export function toCommercialMonitorQualityArtifactV1(
  snapshot: ReturnType<typeof parseEbayListingQualityReportV1>,
) {
  return {
    source: EBAY_LISTING_QUALITY_REPORT_SOURCE, sourceVersion: snapshot.parserVersion,
    observedAt: snapshot.rows.map((row) => row.reportDate).find(Boolean) ?? snapshot.importedAt,
    importedAt: snapshot.importedAt, sourceFileFingerprint: snapshot.sourceFileFingerprint,
    rows: snapshot.rows.map((row) => ({ itemId: row.itemId, sku: row.sku,
      recommendationCategory: row.recommendationCategory,
      recommendationType: row.recommendationType,
      recommendationText: row.recommendationText ?? row.qualityIssue,
      reportedBenchmark: row.reportedBenchmark, topCategoryBenchmark: row.topCategoryBenchmark,
      sourceRowFingerprint: row.sourceRowFingerprint })),
  }
}
