import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { classifyWinnerComparable, normalizeProductIdentity } from "./ebay-winner-evidence-v2.ts"
import type { ProductIdentityInput, WinnerComparableInput, WinnerComparableVisualEvidence } from "./ebay-winner-evidence-v2.ts"

export const OFFICIAL_SOLD_EVIDENCE_IMPORT_VERSION =
  "EBAY_OFFICIAL_SOLD_EVIDENCE_IMPORT_V1_2026_07_17"
export const OFFICIAL_SOLD_EVIDENCE_MAX_ROWS = 2_000
export const OFFICIAL_SOLD_EVIDENCE_MAX_BYTES = 2_000_000
export const OFFICIAL_SOLD_EVIDENCE_RECENCY_DAYS = 90

export type OfficialSoldEvidenceFormat = "CSV" | "JSON"
export type OfficialSoldEvidenceExport =
  | "EBAY_PRODUCT_RESEARCH_EXPORT"
  | "EBAY_SELLER_HUB_EXPORT"
  | "EBAY_MARKETPLACE_INSIGHTS_EXPORT"

type JsonRecord = Record<string, unknown>

export type NormalizedOfficialSoldEvidence = {
  sourceListingReferenceHash: string
  evidenceDeduplicationKey: string
  normalizedIdentity: ReturnType<typeof normalizeProductIdentity>
  confirmedSoldQuantity: number
  itemPrice: number | null
  shippingCost: number | null
  keywordSignals: string[]
  shippingPattern: string | null
  returnsPattern: string | null
  imageCount: number | null
  visualEvidence: WinnerComparableVisualEvidence
  observedAt: string
  eligibleUntil: string
}

export type StoredOfficialSoldEvidence = {
  source_type: "EBAY_OFFICIAL_CSV_IMPORT" | "EBAY_OFFICIAL_JSON_IMPORT"
  source_listing_reference_hash: string
  normalized_identity: ReturnType<typeof normalizeProductIdentity>
  confirmed_sold_quantity: number
  item_price: number | null
  shipping_cost: number | null
  keyword_signals: string[]
  shipping_pattern: string | null
  returns_pattern: string | null
  image_count: number | null
  visual_evidence: WinnerComparableVisualEvidence
  observed_at: string
}

const EXPORT_TYPES = new Set<OfficialSoldEvidenceExport>([
  "EBAY_PRODUCT_RESEARCH_EXPORT",
  "EBAY_SELLER_HUB_EXPORT",
  "EBAY_MARKETPLACE_INSIGHTS_EXPORT",
])

const PII_KEYS = new Set([
  "buyer", "buyerid", "buyerusername", "buyeremail", "buyerphone", "buyername",
  "recipient", "recipientname", "fullname", "firstname", "lastname", "email", "phone",
  "phonenumber", "address", "address1", "address2", "street", "shippingaddress",
  "billingaddress", "postaladdress", "orderid", "ebayorderid",
])

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "new", "free", "shipping", "fast", "sale",
  "authentic", "genuine", "best", "top", "ebay", "pack", "count", "set",
])

const ALIASES: Record<string, string[]> = {
  sourceListingId: ["sourcelistingid", "itemid", "ebayitemid", "legacyitemid", "epid"],
  observedAt: ["observedat", "completedat", "solddate", "date", "reportenddate", "enddate"],
  confirmedSoldQuantity: ["confirmedsoldquantity", "quantitysold", "soldquantity", "qtysold", "totalsold"],
  itemPrice: ["itemprice", "price", "soldprice", "averagesoldprice", "averageprice"],
  shippingCost: ["shippingcost", "shipping", "deliverycost"],
  manufacturerBrand: ["manufacturerbrand", "brand"],
  gtin: ["gtin", "upc", "ean", "isbn"],
  mpn: ["mpn", "manufacturerpartnumber", "partnumber"],
  model: ["model", "modelnumber"],
  title: ["title", "listingtitle", "itemtitle", "producttitle"],
  packCount: ["packcount", "pack", "quantityincluded", "numberofitems"],
  unitCount: ["unitcount", "totalunitcount", "countperpack"],
  size: ["size"], color: ["color", "colour"], scent: ["scent", "fragrance"],
  variant: ["variant", "variation"], condition: ["condition", "itemcondition"],
  shippingPattern: ["shippingpattern", "shippingtype"],
  returnsPattern: ["returnspattern", "returnpolicy"],
  imageCount: ["imagecount", "numberofimages"],
  mainImageBackground: ["mainimagebackground"],
  productCoverageEstimate: ["productcoverageestimate"],
  fullPackVisible: ["fullpackvisible"], unitCountVisible: ["unitcountvisible"],
  packageFrontVisible: ["packagefrontvisible"], textDensity: ["textdensity"],
  infographicPresence: ["infographicpresence"], dimensionsImage: ["dimensionsimage"],
  contentsImage: ["contentsimage"], lifestyleImage: ["lifestyleimage"],
  useContextImage: ["usecontextimage"], handsOrPeoplePresent: ["handsorpeoplepresent"],
  visualClutter: ["visualclutter"], imageConsistency: ["imageconsistency"],
  mainImageClarity: ["mainimageclarity"],
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}
}

function canonicalKey(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "")
}

function normalizedText(value: unknown) {
  if (typeof value !== "string") return null
  const result = value.normalize("NFKC").trim().replace(/\s+/g, " ")
  return result || null
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(String(value).replace(/[$,]/g, ""))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function positiveInteger(value: unknown) {
  const parsed = finiteNumber(value)
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function booleanValue(value: unknown) {
  if (value === true || value === false) return value
  const normalized = normalizedText(value)?.toLocaleLowerCase("en-US")
  if (["true", "yes", "si", "sí", "1"].includes(normalized ?? "")) return true
  if (["false", "no", "0"].includes(normalized ?? "")) return false
  return null
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`
  return JSON.stringify(value)
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : canonicalJson(value),
  ).digest("hex")}`
}

function parseCsvRows(source: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (character === '"') {
      if (quoted && next === '"') { cell += '"'; index += 1 } else quoted = !quoted
    } else if (character === "," && !quoted) {
      row.push(cell); cell = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1
      row.push(cell)
      if (row.some((entry) => entry.trim())) rows.push(row)
      row = []; cell = ""
    } else cell += character
  }
  if (quoted) throw new Error("SOLD_EVIDENCE_CSV_UNCLOSED_QUOTE")
  row.push(cell)
  if (row.some((entry) => entry.trim())) rows.push(row)
  return rows
}

function rejectPiiKeys(keys: string[]) {
  if (keys.some((key) => PII_KEYS.has(canonicalKey(key)))) {
    throw new Error("SOLD_EVIDENCE_PII_COLUMNS_REJECTED")
  }
}

function csvRecords(source: string): JsonRecord[] {
  const rows = parseCsvRows(source)
  if (rows.length < 2) throw new Error("SOLD_EVIDENCE_ROWS_REQUIRED")
  const headers = rows[0].map((entry) => entry.trim())
  rejectPiiKeys(headers)
  if (new Set(headers.map(canonicalKey)).size !== headers.length) {
    throw new Error("SOLD_EVIDENCE_HEADERS_DUPLICATED")
  }
  return rows.slice(1).map((values, index) => {
    if (values.length > headers.length) throw new Error(`SOLD_EVIDENCE_ROW_${index + 2}_INVALID`)
    return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]))
  })
}

function jsonRecords(source: string): JsonRecord[] {
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { throw new Error("SOLD_EVIDENCE_JSON_INVALID") }
  const rootRows = record(parsed).rows
  const rows: unknown[] | null = Array.isArray(parsed) ? parsed : Array.isArray(rootRows) ? rootRows : null
  if (!rows?.length) throw new Error("SOLD_EVIDENCE_ROWS_REQUIRED")
  return rows.map((entry, index) => {
    const row = record(entry)
    if (!Object.keys(row).length) throw new Error(`SOLD_EVIDENCE_ROW_${index + 1}_INVALID`)
    rejectPiiKeys(Object.keys(row))
    return row
  })
}

function normalizedRow(row: JsonRecord) {
  const nestedIdentity = record(row.identity)
  const entries = new Map<string, unknown>()
  for (const [key, value] of [...Object.entries(row), ...Object.entries(nestedIdentity)]) {
    entries.set(canonicalKey(key), value)
  }
  return entries
}

function field(row: Map<string, unknown>, name: keyof typeof ALIASES) {
  for (const alias of ALIASES[name]) if (row.has(alias)) return row.get(alias)
  return null
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]) {
  const normalized = normalizedText(value)?.toLocaleUpperCase("en-US") as T | undefined
  return normalized && allowed.includes(normalized) ? normalized : null
}

function titleTokens(value: unknown) {
  const title = normalizedText(value)?.toLocaleLowerCase("en-US") ?? ""
  return [...new Set((title.match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token)))]
    .slice(0, 30)
}

function visualEvidence(row: Map<string, unknown>, observedAt: string): WinnerComparableVisualEvidence {
  const boolean = (name: keyof typeof ALIASES) => booleanValue(field(row, name))
  const imageCount = positiveInteger(field(row, "imageCount"))
  const evidence: WinnerComparableVisualEvidence = {
    imageCount,
    mainImageBackground: enumValue(field(row, "mainImageBackground"),
      ["WHITE", "LIGHT_NEUTRAL", "COLORED", "LIFESTYLE", "UNKNOWN"] as const),
    productCoverageEstimate: finiteNumber(field(row, "productCoverageEstimate")),
    fullPackVisible: boolean("fullPackVisible"),
    unitCountVisible: boolean("unitCountVisible"),
    packageFrontVisible: boolean("packageFrontVisible"),
    textDensity: enumValue(field(row, "textDensity"),
      ["NONE", "LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const),
    infographicPresence: boolean("infographicPresence"),
    dimensionsImage: boolean("dimensionsImage"), contentsImage: boolean("contentsImage"),
    lifestyleImage: boolean("lifestyleImage"), useContextImage: boolean("useContextImage"),
    handsOrPeoplePresent: boolean("handsOrPeoplePresent"),
    visualClutter: enumValue(field(row, "visualClutter"), ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const),
    imageConsistency: enumValue(field(row, "imageConsistency"), ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const),
    mainImageClarity: enumValue(field(row, "mainImageClarity"), ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const),
    evidenceLevel: imageCount !== null ? "LOW" : "INSUFFICIENT",
    observedAt,
  }
  return evidence
}

type ParsedObservation = {
  value: NormalizedOfficialSoldEvidence
  transientTitleTokens: string[]
} | { error: string }

function normalizeObservation(row: JsonRecord, now: Date): ParsedObservation {
  const values = normalizedRow(row)
  const sourceListingId = normalizedText(field(values, "sourceListingId"))
  const soldQuantity = positiveInteger(field(values, "confirmedSoldQuantity"))
  const packCount = positiveInteger(field(values, "packCount"))
  const observedRaw = normalizedText(field(values, "observedAt"))
  const observed = observedRaw ? new Date(observedRaw) : null
  if (!sourceListingId) return { error: "SOURCE_LISTING_REFERENCE_REQUIRED" as const }
  if (!soldQuantity) return { error: "CONFIRMED_SOLD_QUANTITY_REQUIRED" as const }
  if (!packCount) return { error: "PACK_COUNT_REQUIRED" as const }
  if (!observed || Number.isNaN(observed.getTime()) || observed.getTime() > now.getTime() + 86_400_000) {
    return { error: "OBSERVED_AT_INVALID" as const }
  }
  const identity = normalizeProductIdentity({
    manufacturerBrand: normalizedText(field(values, "manufacturerBrand")),
    gtin: normalizedText(field(values, "gtin")), mpn: normalizedText(field(values, "mpn")),
    model: normalizedText(field(values, "model")), productName: null, packCount,
    unitCount: positiveInteger(field(values, "unitCount")), size: normalizedText(field(values, "size")),
    color: normalizedText(field(values, "color")), scent: normalizedText(field(values, "scent")),
    variant: normalizedText(field(values, "variant")), condition: normalizedText(field(values, "condition")),
  })
  if (!identity.gtinValid && !(identity.manufacturerBrand && (identity.mpn || identity.model))) {
    return { error: "STRONG_PRODUCT_IDENTIFIER_REQUIRED" as const }
  }
  const observedAt = observed.toISOString()
  const eligibleUntil = new Date(observed.getTime() +
    OFFICIAL_SOLD_EVIDENCE_RECENCY_DAYS * 86_400_000).toISOString()
  const sourceListingReferenceHash = sha256(sourceListingId)
  const itemPrice = finiteNumber(field(values, "itemPrice"))
  const shippingCost = finiteNumber(field(values, "shippingCost"))
  const normalized = {
    sourceListingReferenceHash,
    normalizedIdentity: identity,
    confirmedSoldQuantity: soldQuantity,
    itemPrice,
    shippingCost,
    shippingPattern: normalizedText(field(values, "shippingPattern")),
    returnsPattern: normalizedText(field(values, "returnsPattern")),
    imageCount: positiveInteger(field(values, "imageCount")),
    visualEvidence: visualEvidence(values, observedAt),
    observedAt,
    eligibleUntil,
  }
  return {
    value: {
      ...normalized,
      evidenceDeduplicationKey: sha256(normalized),
      keywordSignals: [] as string[],
    },
    transientTitleTokens: titleTokens(field(values, "title")),
  }
}

export function parseOfficialSoldEvidenceImport(input: {
  format: OfficialSoldEvidenceFormat
  content: string
  sourceExportType: OfficialSoldEvidenceExport
  now?: Date
}) {
  if (!EXPORT_TYPES.has(input.sourceExportType)) throw new Error("SOLD_EVIDENCE_SOURCE_EXPORT_INVALID")
  if (!input.content || Buffer.byteLength(input.content, "utf8") > OFFICIAL_SOLD_EVIDENCE_MAX_BYTES) {
    throw new Error("SOLD_EVIDENCE_FILE_SIZE_INVALID")
  }
  const rows = input.format === "CSV" ? csvRecords(input.content)
    : input.format === "JSON" ? jsonRecords(input.content)
      : (() => { throw new Error("SOLD_EVIDENCE_FORMAT_INVALID") })()
  if (rows.length > OFFICIAL_SOLD_EVIDENCE_MAX_ROWS) throw new Error("SOLD_EVIDENCE_ROW_LIMIT_EXCEEDED")
  const now = input.now ?? new Date()
  const normalized = rows.map((row) => normalizeObservation(row, now))
  const errors = normalized.reduce<Record<string, number>>((counts, entry) => {
    if ("error" in entry) counts[entry.error] = (counts[entry.error] ?? 0) + 1
    return counts
  }, {})
  const accepted = normalized.filter((entry): entry is Extract<ParsedObservation, { value: unknown }> =>
    "value" in entry)
  const tokenFrequency = accepted.reduce<Map<string, number>>((counts, entry) => {
    for (const token of entry.transientTitleTokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    return counts
  }, new Map())
  const observations = accepted.map((entry) => ({ ...entry.value,
    keywordSignals: entry.transientTitleTokens.filter((token) => (tokenFrequency.get(token) ?? 0) >= 2)
      .slice(0, 12) }))
  if (!observations.length) throw new Error("SOLD_EVIDENCE_NO_VALID_ROWS")
  return {
    sourceType: input.format === "CSV" ? "EBAY_OFFICIAL_CSV_IMPORT" as const
      : "EBAY_OFFICIAL_JSON_IMPORT" as const,
    sourceExportType: input.sourceExportType,
    sourceFileHash: sha256(input.content),
    rowCount: rows.length,
    rejectedCount: rows.length - observations.length,
    errorCounts: errors,
    observations,
    rawFileStored: false,
    competitorTitlesStored: false,
    sellerIdentitiesStored: false,
    competitorImageUrlsStored: false,
    piiStored: false,
  }
}

export function officialSoldEvidenceComparablesForTarget(input: {
  targetIdentity: ProductIdentityInput
  rows: StoredOfficialSoldEvidence[]
}) {
  const target = normalizeProductIdentity(input.targetIdentity)
  const now = Date.now()
  return input.rows.flatMap((row): WinnerComparableInput[] => {
    const identity = normalizeProductIdentity(record(row.normalized_identity))
    const strictIdentifierMatch = Boolean(
      target.gtin && identity.gtin && target.gtin === identity.gtin ||
      target.manufacturerBrand && identity.manufacturerBrand &&
      target.manufacturerBrand === identity.manufacturerBrand && (
        target.mpn && identity.mpn && target.mpn === identity.mpn ||
        target.model && identity.model && target.model === identity.model
      ),
    )
    if (!strictIdentifierMatch || Date.parse(row.observed_at) > now + 86_400_000) return []
    const comparable: WinnerComparableInput = {
      source: row.source_type,
      sourceListingId: row.source_listing_reference_hash,
      observedAt: row.observed_at,
      identity: { ...identity, productName: target.normalizedProductName },
      itemPrice: row.item_price, shippingCost: row.shipping_cost, currency: "USD",
      confirmedSoldQuantity: row.confirmed_sold_quantity,
      keywords: row.keyword_signals, shippingPattern: row.shipping_pattern,
      returnsPattern: row.returns_pattern, imageCount: row.image_count,
      visualEvidence: { ...record(row.visual_evidence),
        sourceType: row.source_type === "EBAY_OFFICIAL_CSV_IMPORT"
          ? "OFFICIAL_EBAY_CSV_IMPORT" : "OFFICIAL_EBAY_JSON_IMPORT" },
      evidenceReviewed: true,
    }
    const classification = classifyWinnerComparable(input.targetIdentity, comparable.identity).classification
    return ["EXACT_MATCH", "DIFFERENT_PACK", "DIFFERENT_VARIANT", "NEAR_MATCH"].includes(classification)
      ? [comparable] : []
  }).slice(0, 100)
}

export async function readReviewedOfficialSoldEvidence(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const { data, error } = await input.supabase.from("marketplace_sold_evidence_observations")
    .select("source_type,source_listing_reference_hash,normalized_identity,confirmed_sold_quantity,item_price,shipping_cost,keyword_signals,shipping_pattern,returns_pattern,image_count,visual_evidence,observed_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("evidence_reviewed", true).gte("eligible_until", now.toISOString())
    .order("observed_at", { ascending: false }).limit(2_000)
  if (error) throw new Error("SOLD_EVIDENCE_READ_FAILED")
  return (data ?? []) as StoredOfficialSoldEvidence[]
}

export async function importOfficialSoldEvidence(input: {
  supabase: SupabaseClient
  accountKey: string
  actorId: string
  format: OfficialSoldEvidenceFormat
  sourceExportType: OfficialSoldEvidenceExport
  content: string
  operatorAttested: boolean
  now?: Date
}) {
  if (!input.operatorAttested) throw new Error("SOLD_EVIDENCE_OPERATOR_ATTESTATION_REQUIRED")
  const parsed = parseOfficialSoldEvidenceImport(input)
  const { data: duplicateBatch, error: duplicateBatchError } = await input.supabase
    .from("marketplace_sold_evidence_import_batches")
    .select("id,row_count,imported_count,duplicate_count,rejected_count,imported_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("source_file_hash", parsed.sourceFileHash).maybeSingle()
  if (duplicateBatchError) throw new Error("SOLD_EVIDENCE_BATCH_DEDUP_READ_FAILED")
  if (duplicateBatch) return { duplicate: true, batchId: duplicateBatch.id,
    rowCount: duplicateBatch.row_count, importedCount: duplicateBatch.imported_count,
    duplicateCount: duplicateBatch.duplicate_count, rejectedCount: duplicateBatch.rejected_count,
    importedAt: duplicateBatch.imported_at, reanalysisRequired: false,
    rawFileStored: false, piiStored: false, openAiCalls: 0, ebayWrites: 0 }

  const deduplicationKeys = parsed.observations.map((row) => row.evidenceDeduplicationKey)
  const existingKeys = new Set<string>()
  for (let offset = 0; offset < deduplicationKeys.length; offset += 250) {
    const page = deduplicationKeys.slice(offset, offset + 250)
    const { data, error } = await input.supabase.from("marketplace_sold_evidence_observations")
      .select("evidence_deduplication_key").eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").in("evidence_deduplication_key", page)
    if (error) throw new Error("SOLD_EVIDENCE_OBSERVATION_DEDUP_READ_FAILED")
    for (const row of data ?? []) existingKeys.add(row.evidence_deduplication_key)
  }
  const fresh = parsed.observations.filter((row) => !existingKeys.has(row.evidenceDeduplicationKey))
  const duplicateCount = parsed.observations.length - fresh.length
  const batchId = randomUUID()
  const observedTimes = fresh.map((row) => Date.parse(row.observedAt)).filter(Number.isFinite)
  const rpcRows = fresh.map((row) => ({
    source_listing_reference_hash: row.sourceListingReferenceHash,
    evidence_deduplication_key: row.evidenceDeduplicationKey,
    normalized_identity: row.normalizedIdentity,
    confirmed_sold_quantity: row.confirmedSoldQuantity,
    item_price: row.itemPrice,
    shipping_cost: row.shippingCost,
    keyword_signals: row.keywordSignals,
    shipping_pattern: row.shippingPattern,
    returns_pattern: row.returnsPattern,
    image_count: row.imageCount,
    visual_evidence: row.visualEvidence,
    observed_at: row.observedAt,
    eligible_until: row.eligibleUntil,
  }))
  const { error: importError } = await input.supabase.rpc("import_marketplace_sold_evidence_v1", {
    p_batch_id: batchId,
    p_marketplace_account_key: input.accountKey,
    p_source_type: parsed.sourceType,
    p_source_export_type: parsed.sourceExportType,
    p_source_file_hash: parsed.sourceFileHash,
    p_import_schema_version: OFFICIAL_SOLD_EVIDENCE_IMPORT_VERSION,
    p_row_count: parsed.rowCount,
    p_duplicate_count: duplicateCount,
    p_rejected_count: parsed.rejectedCount,
    p_error_counts: parsed.errorCounts,
    p_source_observed_start: observedTimes.length ? new Date(Math.min(...observedTimes)).toISOString() : null,
    p_source_observed_end: observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : null,
    p_reviewed_by: input.actorId,
    p_observations: rpcRows,
  })
  if (importError) throw new Error("SOLD_EVIDENCE_IMPORT_PERSIST_FAILED")

  const { data: hashes, error: hashesError } = await input.supabase
    .from("marketplace_sold_evidence_import_batches").select("source_file_hash")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("status", "IMPORTED").order("source_file_hash", { ascending: true })
  if (hashesError) throw new Error("SOLD_EVIDENCE_VERSION_READ_FAILED")
  const soldEvidenceVersion = sha256((hashes ?? []).map((row) => row.source_file_hash))
  const importedAt = (input.now ?? new Date()).toISOString()
  const { data: latestRun, error: latestRunError } = await input.supabase
    .from("marketplace_listing_approval_queue_runs").select("id")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (latestRunError) throw new Error("SOLD_EVIDENCE_RUN_READ_FAILED")
  if (latestRun) {
    const { error: runError } = await input.supabase.from("marketplace_listing_approval_queue_runs")
      .update({ sold_evidence_version: soldEvidenceVersion,
        sold_evidence_imported_at: importedAt, updated_at: importedAt }).eq("id", latestRun.id)
      .eq("marketplace_account_key", input.accountKey)
    if (runError) throw new Error("SOLD_EVIDENCE_RUN_MARK_FAILED")
  }
  return { duplicate: false, batchId, rowCount: parsed.rowCount,
    importedCount: fresh.length, duplicateCount, rejectedCount: parsed.rejectedCount,
    importedAt, reanalysisRequired: fresh.length > 0,
    rawFileStored: false, piiStored: false, openAiCalls: 0, ebayWrites: 0 }
}

export async function getOfficialSoldEvidenceImportStatus(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const [{ count: observations, error: observationError }, { data: latest, error: latestError }] =
    await Promise.all([
      input.supabase.from("marketplace_sold_evidence_observations")
        .select("id", { count: "exact", head: true }).eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US").eq("evidence_reviewed", true),
      input.supabase.from("marketplace_sold_evidence_import_batches")
        .select("id,source_type,source_export_type,row_count,imported_count,duplicate_count,rejected_count,source_observed_start,source_observed_end,imported_at")
        .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
        .order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    ])
  if (observationError || latestError) throw new Error("SOLD_EVIDENCE_STATUS_READ_FAILED")
  return { configured: true, reviewedObservationCount: observations ?? 0, latest: latest ?? null,
    acceptedFormats: ["CSV", "JSON"], maxRows: OFFICIAL_SOLD_EVIDENCE_MAX_ROWS,
    recencyDays: OFFICIAL_SOLD_EVIDENCE_RECENCY_DAYS,
    rawFilesStored: false, competitorTitlesStored: false, sellerIdentitiesStored: false,
    competitorImageUrlsStored: false, piiStored: false, openAiCalls: 0, ebayWrites: 0 }
}
