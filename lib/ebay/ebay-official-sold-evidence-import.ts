import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { classifyWinnerComparable, normalizeProductIdentity } from "./ebay-winner-evidence-v2.ts"
import type { ProductIdentityInput, WinnerComparableInput, WinnerComparableVisualEvidence } from "./ebay-winner-evidence-v2.ts"

export const OFFICIAL_SOLD_EVIDENCE_IMPORT_VERSION =
  "EBAY_OFFICIAL_SOLD_EVIDENCE_IMPORT_V3_2026_08_26"
export const OFFICIAL_SOLD_EVIDENCE_MAX_ROWS = 2_000
export const OFFICIAL_SOLD_EVIDENCE_MAX_BYTES = 2_000_000
export const OFFICIAL_SOLD_EVIDENCE_RECENCY_DAYS = 90

export type OfficialSoldEvidenceFormat = "CSV" | "JSON"
export type OfficialSoldEvidenceExport =
  | "EBAY_PRODUCT_RESEARCH_EXPORT"
  | "EBAY_SELLER_HUB_EXPORT"
  | "EBAY_MARKETPLACE_INSIGHTS_EXPORT"
  | "EBAY_MAIN_SEARCH_SOLD_CAPTURE"
export type SoldEvidenceSourceClass =
  | "OFFICIAL_PRODUCT_RESEARCH"
  | "MAIN_SEARCH_SOLD"
  | "OFFICIAL_API"
export type RealizedPriceStatus = "PROVEN" | "UNPROVEN" | "UNAVAILABLE"
export type BestOfferStatus = "EXPLICIT_PRESENT" | "EXPLICIT_ABSENT" | "UNKNOWN"
export type ShippingEvidenceStatus = "OBSERVED" | "UNAVAILABLE" | "AMBIGUOUS"
export type CommercialPackEvidenceClassification =
  | "EXACT_PACK_COMPARABLE"
  | "DIFFERENT_PACK_BUT_COMMERCIALLY_RELEVANT"
  | "PACK_UNKNOWN"
export type PackEvidenceStatus = "PROVEN" | "UNKNOWN"
export type OfficialSoldEvidenceScope =
  | "MARKET_WIDE_SOLD_EVIDENCE"
  | "OWN_ACCOUNT_SOLD_EVIDENCE"
export type OfficialSaleConfirmationBasis =
  | "SOLD_QUANTITY_POSITIVE"
  | "EXPLICIT_CONFIRMED_SALE_MINIMUM_ONE"

type JsonRecord = Record<string, unknown>

export type NormalizedOfficialSoldEvidence = {
  sourceClass: SoldEvidenceSourceClass
  itemId: string | null
  soldAt: string
  capturedAt: string
  queryOrResearchIdentity: string | null
  sourceListingReferenceHash: string
  evidenceDeduplicationKey: string
  normalizedIdentity: ReturnType<typeof normalizeProductIdentity>
  confirmedSoldQuantity: number
  evidenceScope: OfficialSoldEvidenceScope
  saleConfirmationBasis: OfficialSaleConfirmationBasis
  itemPrice: number | null
  shippingCost: number | null
  displayedSoldPriceAmount: number | null
  displayedSoldPriceCurrency: string | null
  realizedTransactionPriceAmount: number | null
  realizedTransactionPriceCurrency: string | null
  realizedPriceStatus: RealizedPriceStatus
  bestOfferStatus: BestOfferStatus
  visibleShippingAmount: number | null
  visibleShippingCurrency: string | null
  shippingStatus: ShippingEvidenceStatus
  priceEvidenceProvenance: string
  evidenceDigest: string
  keywordSignals: string[]
  shippingPattern: string | null
  returnsPattern: string | null
  imageCount: number | null
  visualEvidence: WinnerComparableVisualEvidence
  observedAt: string
  eligibleUntil: string
  packEvidenceStatus: PackEvidenceStatus
}

export type StoredOfficialSoldEvidence = {
  source_type: "EBAY_OFFICIAL_CSV_IMPORT" | "EBAY_OFFICIAL_JSON_IMPORT" |
    "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE" | "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE"
  source_class?: SoldEvidenceSourceClass
  item_id?: string | null
  sold_at?: string
  captured_at?: string
  query_or_research_identity?: string | null
  source_listing_reference_hash: string
  normalized_identity: ReturnType<typeof normalizeProductIdentity>
  confirmed_sold_quantity: number
  evidence_scope: OfficialSoldEvidenceScope
  sale_confirmation_basis: OfficialSaleConfirmationBasis
  item_price: number | null
  shipping_cost: number | null
  displayed_sold_price_amount?: number | null
  displayed_sold_price_currency?: string | null
  realized_transaction_price_amount?: number | null
  realized_transaction_price_currency?: string | null
  realized_price_status?: RealizedPriceStatus
  best_offer_status?: BestOfferStatus
  visible_shipping_amount?: number | null
  visible_shipping_currency?: string | null
  shipping_status?: ShippingEvidenceStatus
  price_evidence_provenance?: string
  evidence_digest?: string
  keyword_signals: string[]
  shipping_pattern: string | null
  returns_pattern: string | null
  image_count: number | null
  visual_evidence: WinnerComparableVisualEvidence
  observed_at: string
  match_classification?: "EXACT_LUNA_MATCH" | "SAME_PRODUCT_DIFFERENT_PACK" |
    "SAME_PRODUCT_DIFFERENT_SIZE" | "DIFFERENT_VARIANT" | null
  matched_supplier_variant_id?: string | null
}

const EXPORT_TYPES = new Set<OfficialSoldEvidenceExport>([
  "EBAY_PRODUCT_RESEARCH_EXPORT",
  "EBAY_SELLER_HUB_EXPORT",
  "EBAY_MARKETPLACE_INSIGHTS_EXPORT",
  "EBAY_MAIN_SEARCH_SOLD_CAPTURE",
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
  // ePID identifies a catalog product, not an individual listing. It must
  // never stand in for Item ID because that would corrupt source dedupe and
  // read-only listing-detail reconciliation.
  sourceListingId: ["sourcelistingid", "itemid", "ebayitemid", "legacyitemid"],
  observedAt: ["observedat", "completedat", "solddate", "date", "reportenddate", "enddate"],
  confirmedSoldQuantity: ["confirmedsoldquantity", "quantitysold", "soldquantity", "qtysold", "totalsold"],
  itemPrice: ["itemprice", "price", "soldprice", "averagesoldprice", "averageprice"],
  shippingCost: ["shippingcost", "shipping", "deliverycost"],
  capturedAt: ["capturedat", "capturetimestamp"],
  queryOrResearchIdentity: ["queryorresearchidentity", "queryidentity", "researchidentity"],
  displayedSoldPriceAmount: ["displayedsoldpriceamount", "displayedpriceamount"],
  displayedSoldPriceCurrency: ["displayedsoldpricecurrency", "displayedpricecurrency"],
  realizedTransactionPriceAmount: ["realizedtransactionpriceamount", "realizedpriceamount"],
  realizedTransactionPriceCurrency: ["realizedtransactionpricecurrency", "realizedpricecurrency"],
  realizedPriceStatus: ["realizedpricestatus"],
  bestOfferStatus: ["bestofferstatus"],
  visibleShippingAmount: ["visibleshippingamount"],
  visibleShippingCurrency: ["visibleshippingcurrency"],
  shippingStatus: ["shippingstatus"],
  priceEvidenceProvenance: ["priceevidenceprovenance"],
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
  explicitSaleConfirmed: ["saleconfirmed", "issold", "confirmedsale", "transactionconfirmed"],
  listingStatus: ["status", "listingstatus", "completionstatus", "itemstatus"],
  reportType: ["reporttype", "reportsource", "exporttype", "sourcereporttype"],
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

function currencyValue(value: unknown) {
  const normalized = normalizedText(value)?.toLocaleUpperCase("en-US")
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : null
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
  const root = record(parsed)
  const rootReportType = normalizedText(root.reportType) ?? normalizedText(root.reportSource) ??
    normalizedText(root.exportType)
  return rows.map((entry, index) => {
    const row = record(entry)
    if (!Object.keys(row).length) throw new Error(`SOLD_EVIDENCE_ROW_${index + 1}_INVALID`)
    rejectPiiKeys(Object.keys(row))
    return rootReportType && !Object.keys(row).some((key) => ALIASES.reportType.includes(canonicalKey(key)))
      ? { ...row, sourceReportType: rootReportType }
      : row
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
} | {
  packSignal: NormalizedOfficialSoldEvidence
  error: "PACK_COUNT_REQUIRED"
  transientTitleTokens: string[]
} | { completedWithoutSale: true }
  | { error: string }

export type SoldEvidenceNoValidRowsDiagnostic = Readonly<{
  sourceRowCount: number
  rejectedCount: number
  errorCounts: Readonly<Record<string, number>>
}>

export class SoldEvidenceNoValidRowsError extends Error {
  readonly diagnostic: SoldEvidenceNoValidRowsDiagnostic

  constructor(input: { sourceRowCount: number; errorCounts: Record<string, number> }) {
    super("SOLD_EVIDENCE_NO_VALID_ROWS")
    this.name = "SoldEvidenceNoValidRowsError"
    this.diagnostic = Object.freeze({
      sourceRowCount: input.sourceRowCount,
      rejectedCount: Object.values(input.errorCounts).reduce((total, count) => total + count, 0),
      errorCounts: Object.freeze({ ...input.errorCounts }),
    })
  }
}

export function soldEvidenceNoValidRowsDiagnostic(error: unknown) {
  return error instanceof SoldEvidenceNoValidRowsError ? error.diagnostic : null
}

export function oneClickSoldEvidenceNoValidRowsCode(input: {
  observedCount: number
  parsedCount: number
  diagnostic: SoldEvidenceNoValidRowsDiagnostic
}) {
  const reasons = Object.entries(input.diagnostic.errorCounts)
    .filter(([code, count]) => /^[A-Z0-9_]+$/.test(code) && Number.isInteger(count) && count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "en-US"))
    .slice(0, 8)
    .map(([code, count]) => `${code}_${count}`)
  return [
    "SOLD_EVIDENCE_NO_VALID_ROWS",
    `OBSERVED_${input.observedCount}`,
    `PARSED_${input.parsedCount}`,
    `NORMALIZED_${input.diagnostic.sourceRowCount}`,
    "VALID_0",
    `REJECTED_${input.diagnostic.rejectedCount}`,
    "DUPLICATE_NOT_REACHED",
    ...reasons,
  ].join(":")
}

function sourceSemantics(sourceExportType: OfficialSoldEvidenceExport, rows: JsonRecord[]) {
  if (sourceExportType === "EBAY_MAIN_SEARCH_SOLD_CAPTURE") {
    return { evidenceScope: "MARKET_WIDE_SOLD_EVIDENCE" as const,
      marketWideSchemaConfirmed: true }
  }
  if (sourceExportType === "EBAY_PRODUCT_RESEARCH_EXPORT" ||
    sourceExportType === "EBAY_MARKETPLACE_INSIGHTS_EXPORT") {
    return { evidenceScope: "MARKET_WIDE_SOLD_EVIDENCE" as const,
      marketWideSchemaConfirmed: true }
  }
  const markers = rows.map((row) => normalizedText(field(normalizedRow(row), "reportType")))
    .filter((value): value is string => Boolean(value))
  const marketWideSchemaConfirmed = markers.length === rows.length && markers.every((value) => {
    const normalized = canonicalKey(value)
    return normalized.includes("productresearch") || normalized.includes("marketplaceinsights")
  })
  return {
    evidenceScope: marketWideSchemaConfirmed
      ? "MARKET_WIDE_SOLD_EVIDENCE" as const
      : "OWN_ACCOUNT_SOLD_EVIDENCE" as const,
    marketWideSchemaConfirmed,
  }
}

function normalizeObservation(
  row: JsonRecord,
  now: Date,
  evidenceScope: OfficialSoldEvidenceScope,
  sourceExportType: OfficialSoldEvidenceExport,
): ParsedObservation {
  const values = normalizedRow(row)
  const sourceListingId = normalizedText(field(values, "sourceListingId"))
  const reportedSoldQuantity = positiveInteger(field(values, "confirmedSoldQuantity"))
  const explicitSale = booleanValue(field(values, "explicitSaleConfirmed")) === true
  const listingStatus = canonicalKey(normalizedText(field(values, "listingStatus")) ?? "")
  const statusConfirmsSale = ["sold", "confirmedsold", "saleconfirmed"].includes(listingStatus)
  const saleConfirmationBasis: OfficialSaleConfirmationBasis | null = reportedSoldQuantity
    ? "SOLD_QUANTITY_POSITIVE"
    : explicitSale || statusConfirmsSale
      ? "EXPLICIT_CONFIRMED_SALE_MINIMUM_ONE"
      : null
  const soldQuantity = reportedSoldQuantity ?? (saleConfirmationBasis ? 1 : null)
  if (!soldQuantity && ["completed", "ended", "closed", "finished"].includes(listingStatus)) {
    return { completedWithoutSale: true }
  }
  const packCount = positiveInteger(field(values, "packCount"))
  const observedRaw = normalizedText(field(values, "observedAt"))
  const observed = observedRaw ? new Date(observedRaw) : null
  if (!sourceListingId) return { error: "SOURCE_LISTING_REFERENCE_REQUIRED" as const }
  if (!soldQuantity || !saleConfirmationBasis) return { error: "SALE_CONFIRMATION_REQUIRED" as const }
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
  const isMainSearchSold = sourceExportType === "EBAY_MAIN_SEARCH_SOLD_CAPTURE"
  const sourceClass: SoldEvidenceSourceClass = isMainSearchSold
    ? "MAIN_SEARCH_SOLD"
    : sourceExportType === "EBAY_PRODUCT_RESEARCH_EXPORT"
      ? "OFFICIAL_PRODUCT_RESEARCH"
      : "OFFICIAL_API"
  const capturedRaw = normalizedText(field(values, "capturedAt"))
  const captured = capturedRaw ? new Date(capturedRaw) : now
  if (Number.isNaN(captured.getTime()) || captured.getTime() > now.getTime() + 86_400_000) {
    return { error: "CAPTURED_AT_INVALID" as const }
  }
  const queryIdentityRaw = normalizedText(field(values, "queryOrResearchIdentity"))
  if (isMainSearchSold && !queryIdentityRaw) {
    return { error: "QUERY_OR_RESEARCH_IDENTITY_REQUIRED" as const }
  }
  const eligibleUntil = new Date(observed.getTime() +
    OFFICIAL_SOLD_EVIDENCE_RECENCY_DAYS * 86_400_000).toISOString()
  const sourceListingReferenceHash = sha256(sourceListingId)
  const displayedSoldPriceAmount = finiteNumber(field(values, "displayedSoldPriceAmount"))
  const displayedSoldPriceCurrency = displayedSoldPriceAmount === null ? null
    : currencyValue(field(values, "displayedSoldPriceCurrency")) ?? "USD"
  const bestOfferStatus = enumValue(field(values, "bestOfferStatus"),
    ["EXPLICIT_PRESENT", "EXPLICIT_ABSENT", "UNKNOWN"] as const) ?? "UNKNOWN"
  const requestedRealizedStatus = enumValue(field(values, "realizedPriceStatus"),
    ["PROVEN", "UNPROVEN", "UNAVAILABLE"] as const)
  const requestedRealizedAmount = finiteNumber(field(values, "realizedTransactionPriceAmount"))
  const requestedRealizedCurrency = requestedRealizedAmount === null ? null
    : currencyValue(field(values, "realizedTransactionPriceCurrency")) ?? "USD"
  const realizedPriceStatus: RealizedPriceStatus = isMainSearchSold || bestOfferStatus === "EXPLICIT_PRESENT"
    ? "UNPROVEN"
    : requestedRealizedStatus ?? "UNAVAILABLE"
  if (requestedRealizedStatus === "PROVEN" &&
    (isMainSearchSold || bestOfferStatus === "EXPLICIT_PRESENT")) {
    return { error: "REALIZED_PRICE_PROOF_FORBIDDEN" as const }
  }
  if (realizedPriceStatus === "PROVEN" && requestedRealizedAmount === null) {
    return { error: "REALIZED_PRICE_AMOUNT_REQUIRED" as const }
  }
  const realizedTransactionPriceAmount = realizedPriceStatus === "PROVEN"
    ? requestedRealizedAmount : null
  const realizedTransactionPriceCurrency = realizedPriceStatus === "PROVEN"
    ? requestedRealizedCurrency : null
  const visibleShippingAmount = finiteNumber(field(values, "visibleShippingAmount"))
  const requestedShippingStatus = enumValue(field(values, "shippingStatus"),
    ["OBSERVED", "UNAVAILABLE", "AMBIGUOUS"] as const)
  const shippingStatus: ShippingEvidenceStatus = requestedShippingStatus ??
    (visibleShippingAmount === null ? "UNAVAILABLE" : "OBSERVED")
  if (shippingStatus === "OBSERVED" && visibleShippingAmount === null) {
    return { error: "VISIBLE_SHIPPING_AMOUNT_REQUIRED" as const }
  }
  const durableVisibleShippingAmount = shippingStatus === "OBSERVED" ? visibleShippingAmount : null
  const visibleShippingCurrency = durableVisibleShippingAmount === null ? null
    : currencyValue(field(values, "visibleShippingCurrency")) ?? "USD"
  const itemPrice = isMainSearchSold ? null : finiteNumber(field(values, "itemPrice"))
  const shippingCost = isMainSearchSold ? null : finiteNumber(field(values, "shippingCost"))
  const priceEvidenceProvenance = normalizedText(field(values, "priceEvidenceProvenance")) ??
    (isMainSearchSold ? "MAIN_SEARCH_VISIBLE_SOLD_ROW"
      : sourceClass === "OFFICIAL_PRODUCT_RESEARCH"
        ? "PRODUCT_RESEARCH_AGGREGATE"
        : "OFFICIAL_SOURCE_LEGACY_PRICE")
  const provenance = {
    sourceClass,
    itemId: isMainSearchSold ? sourceListingId : null,
    soldAt: observedAt,
    capturedAt: captured.toISOString(),
    queryOrResearchIdentity: queryIdentityRaw ? sha256(queryIdentityRaw) : null,
    displayedSoldPriceAmount,
    displayedSoldPriceCurrency,
    realizedTransactionPriceAmount,
    realizedTransactionPriceCurrency,
    realizedPriceStatus,
    bestOfferStatus,
    visibleShippingAmount: durableVisibleShippingAmount,
    visibleShippingCurrency,
    shippingStatus,
    priceEvidenceProvenance,
  }
  const normalized = {
    ...provenance,
    sourceListingReferenceHash,
    normalizedIdentity: identity,
    confirmedSoldQuantity: soldQuantity,
    evidenceScope,
    saleConfirmationBasis,
    itemPrice,
    shippingCost,
    shippingPattern: normalizedText(field(values, "shippingPattern")),
    returnsPattern: normalizedText(field(values, "returnsPattern")),
    imageCount: positiveInteger(field(values, "imageCount")),
    visualEvidence: visualEvidence(values, observedAt),
    observedAt,
    eligibleUntil,
  }
  const evidenceDigest = sha256(normalized)
  const value = {
    ...normalized,
    evidenceDigest,
    evidenceDeduplicationKey: evidenceDigest,
    keywordSignals: [] as string[],
    packEvidenceStatus: packCount ? "PROVEN" as const : "UNKNOWN" as const,
  }
  const transientTitleTokens = titleTokens(field(values, "title"))
  return packCount
    ? { value, transientTitleTokens }
    : { packSignal: value, error: "PACK_COUNT_REQUIRED" as const, transientTitleTokens }
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
  const semantics = sourceSemantics(input.sourceExportType, rows)
  const normalized = rows.map((row) => normalizeObservation(
    row, now, semantics.evidenceScope, input.sourceExportType,
  ))
  const errors = normalized.reduce<Record<string, number>>((counts, entry) => {
    if ("error" in entry) counts[entry.error] = (counts[entry.error] ?? 0) + 1
    return counts
  }, {})
  const accepted = normalized.filter((entry): entry is Extract<ParsedObservation, { value: unknown }> =>
    "value" in entry)
  const packSignals = normalized.filter((entry): entry is Extract<ParsedObservation,
    { packSignal: unknown }> => "packSignal" in entry)
  const completedWithoutSaleCount = normalized.filter((entry) => "completedWithoutSale" in entry).length
  const durableEvidence = [...accepted.map((entry) => ({ value: entry.value,
    transientTitleTokens: entry.transientTitleTokens })),
  ...packSignals.map((entry) => ({ value: entry.packSignal,
    transientTitleTokens: entry.transientTitleTokens }))]
  const tokenFrequency = durableEvidence.reduce<Map<string, number>>((counts, entry) => {
    for (const token of entry.transientTitleTokens) counts.set(token, (counts.get(token) ?? 0) + 1)
    return counts
  }, new Map())
  const withKeywordSignals = (entry: { value: NormalizedOfficialSoldEvidence;
    transientTitleTokens: string[] }) => ({ ...entry.value,
    keywordSignals: entry.transientTitleTokens.filter((token) => (tokenFrequency.get(token) ?? 0) >= 2)
      .slice(0, 12) })
  const observations = accepted.map((entry) => withKeywordSignals({ value: entry.value,
    transientTitleTokens: entry.transientTitleTokens }))
  const commercialPackSignals = packSignals.map((entry) => withKeywordSignals({
    value: entry.packSignal, transientTitleTokens: entry.transientTitleTokens,
  }))
  if (!observations.length && !commercialPackSignals.length && completedWithoutSaleCount === 0) {
    throw new SoldEvidenceNoValidRowsError({ sourceRowCount: rows.length, errorCounts: errors })
  }
  return {
    sourceType: input.sourceExportType === "EBAY_MAIN_SEARCH_SOLD_CAPTURE"
      ? "EBAY_MAIN_SEARCH_SOLD_BROWSER_CAPTURE" as const
      : input.format === "CSV" ? "EBAY_OFFICIAL_CSV_IMPORT" as const
        : "EBAY_OFFICIAL_JSON_IMPORT" as const,
    sourceExportType: input.sourceExportType,
    evidenceScope: semantics.evidenceScope,
    marketWideSchemaConfirmed: semantics.marketWideSchemaConfirmed,
    sourceFileHash: sha256(input.content),
    sourceRowCount: rows.length,
    rowCount: rows.length - completedWithoutSaleCount,
    // The durable batch counts every safe, confirmed Sold signal. Canonical pack
    // comparability remains a separate stricter count and PACK_UNKNOWN never
    // enters exact pricing/economics.
    validCount: observations.length + commercialPackSignals.length + completedWithoutSaleCount,
    confirmedSaleCount: observations.length + commercialPackSignals.length,
    completedWithoutSaleCount,
    rejectedCount: rows.length - observations.length - completedWithoutSaleCount,
    hardRejectedCount: rows.length - observations.length - commercialPackSignals.length -
      completedWithoutSaleCount,
    errorCounts: errors,
    observations,
    commercialPackSignals,
    packSignalsPreservedCount: commercialPackSignals.length,
    canonicalComparableCount: observations.length,
    rawFileStored: false,
    competitorTitlesStored: false,
    sellerIdentitiesStored: false,
    competitorImageUrlsStored: false,
    piiStored: false,
  }
}

export function soldPriceEvidenceForPositioning(row: StoredOfficialSoldEvidence) {
  const realized = finiteNumber(row.realized_transaction_price_amount)
  if (row.realized_price_status === "PROVEN" && realized !== null) {
    return { amount: realized,
      currency: row.realized_transaction_price_currency ?? "USD",
      semantics: "REALIZED_TRANSACTION_PRICE" as const,
      authoritativeRealizedPrice: true }
  }
  const displayed = finiteNumber(row.displayed_sold_price_amount)
  if (displayed !== null) {
    return { amount: displayed,
      currency: row.displayed_sold_price_currency ?? "USD",
      semantics: "DISPLAYED_SOLD_PRICE" as const,
      authoritativeRealizedPrice: false }
  }
  if (row.source_class === "OFFICIAL_PRODUCT_RESEARCH" ||
    row.source_type === "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE") {
    const aggregate = finiteNumber(row.item_price)
    return { amount: aggregate, currency: aggregate === null ? null : "USD",
      semantics: aggregate === null ? "UNAVAILABLE" as const : "PRODUCT_RESEARCH_AGGREGATE" as const,
      authoritativeRealizedPrice: false }
  }
  return { amount: null, currency: null, semantics: "UNAVAILABLE" as const,
    authoritativeRealizedPrice: false }
}

export function authoritativeRealizedTransactionPrice(row: StoredOfficialSoldEvidence) {
  const evidence = soldPriceEvidenceForPositioning(row)
  return evidence.authoritativeRealizedPrice ? evidence.amount : null
}

function storedSoldEvidenceBaseMatch(input: {
  targetIdentity: ProductIdentityInput
  row: StoredOfficialSoldEvidence
  targetSupplierVariantId?: string | null
}) {
  const target = normalizeProductIdentity(input.targetIdentity)
  const identity = normalizeProductIdentity(record(input.row.normalized_identity))
  const strictIdentifierMatch = Boolean(
    target.gtin && identity.gtin && target.gtin === identity.gtin ||
    target.manufacturerBrand && identity.manufacturerBrand &&
    target.manufacturerBrand === identity.manufacturerBrand && (
      target.mpn && identity.mpn && target.mpn === identity.mpn ||
      target.model && identity.model && target.model === identity.model
    ),
  )
  const captureStrategicMatch = input.row.source_type ===
    "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE" && Boolean(input.targetSupplierVariantId &&
      input.row.matched_supplier_variant_id === input.targetSupplierVariantId)
  return { target, identity, strictIdentifierMatch, captureStrategicMatch,
    matched: strictIdentifierMatch || captureStrategicMatch }
}

function winnerComparableFromStoredSoldEvidence(input: {
  targetIdentity: ProductIdentityInput
  row: StoredOfficialSoldEvidence
}) {
  const target = normalizeProductIdentity(input.targetIdentity)
  const identity = normalizeProductIdentity(record(input.row.normalized_identity))
  const priceEvidence = soldPriceEvidenceForPositioning(input.row)
  return {
    source: input.row.source_type,
    sourceListingId: input.row.source_listing_reference_hash,
    observedAt: input.row.observed_at,
    identity: { ...identity, productName: target.normalizedProductName },
    itemPrice: input.row.source_class === "MAIN_SEARCH_SOLD"
      ? authoritativeRealizedTransactionPrice(input.row)
      : input.row.realized_price_status === "PROVEN"
        ? authoritativeRealizedTransactionPrice(input.row)
        : input.row.item_price,
    shippingCost: input.row.source_class === "MAIN_SEARCH_SOLD" ? null : input.row.shipping_cost,
    displayedSoldPriceAmount: priceEvidence.semantics === "DISPLAYED_SOLD_PRICE"
      ? priceEvidence.amount : null,
    displayedSoldPriceCurrency: priceEvidence.semantics === "DISPLAYED_SOLD_PRICE"
      ? priceEvidence.currency : null,
    priceEvidenceSemantics: priceEvidence.semantics,
    realizedPriceStatus: input.row.realized_price_status ?? "UNAVAILABLE",
    bestOfferStatus: input.row.best_offer_status ?? "UNKNOWN",
    currency: "USD",
    confirmedSoldQuantity: input.row.confirmed_sold_quantity,
    evidenceScope: input.row.evidence_scope,
    keywords: input.row.keyword_signals, shippingPattern: input.row.shipping_pattern,
    returnsPattern: input.row.returns_pattern, imageCount: input.row.image_count,
    visualEvidence: { ...record(input.row.visual_evidence),
      sourceType: input.row.source_type === "EBAY_OFFICIAL_CSV_IMPORT"
        ? "OFFICIAL_EBAY_CSV_IMPORT" as const
        : input.row.source_type === "EBAY_OFFICIAL_JSON_IMPORT"
          ? "OFFICIAL_EBAY_JSON_IMPORT" as const
          : "OFFICIAL_EBAY_BROWSER_CAPTURE" as const },
    evidenceReviewed: true,
  } satisfies WinnerComparableInput
}

export type OfficialSoldPackIntelligenceSignal = {
  classification: CommercialPackEvidenceClassification
  packCount: number | null
  soldCount: 1
  soldQuantity: number
  recentSoldPrice: ReturnType<typeof soldPriceEvidenceForPositioning>
  pricePerUnit: number | null
  evidenceConfidence: "STRONG" | "UNRESOLVED"
  comparable: WinnerComparableInput
}

export function officialSoldPackIntelligenceForTarget(input: {
  targetIdentity: ProductIdentityInput
  rows: StoredOfficialSoldEvidence[]
  targetSupplierVariantId?: string | null
}) {
  return input.rows.flatMap((row): OfficialSoldPackIntelligenceSignal[] => {
    const base = storedSoldEvidenceBaseMatch({ ...input, row })
    if (!base.matched || Date.parse(row.observed_at) > Date.now() + 86_400_000) return []
    const rawClassification = classifyWinnerComparable(
      input.targetIdentity,
      { ...base.identity, productName: base.target.normalizedProductName },
    ).classification
    const classification: CommercialPackEvidenceClassification | null =
      base.identity.packCount === null
        ? "PACK_UNKNOWN"
        : rawClassification === "EXACT_MATCH"
          ? "EXACT_PACK_COMPARABLE"
          : rawClassification === "DIFFERENT_PACK"
            ? "DIFFERENT_PACK_BUT_COMMERCIALLY_RELEVANT"
            : null
    if (!classification) return []
    if (row.source_type === "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE") {
      const expected = row.match_classification === "SAME_PRODUCT_DIFFERENT_PACK"
        ? "DIFFERENT_PACK_BUT_COMMERCIALLY_RELEVANT"
        : row.match_classification === "EXACT_LUNA_MATCH"
          ? "EXACT_PACK_COMPARABLE"
          : null
      if (classification !== expected) return []
    }
    const recentSoldPrice = soldPriceEvidenceForPositioning(row)
    const totalUnits = base.identity.packCount && base.identity.unitCount
      ? base.identity.packCount * base.identity.unitCount : null
    return [{
      classification,
      packCount: base.identity.packCount,
      soldCount: 1,
      soldQuantity: row.confirmed_sold_quantity,
      recentSoldPrice,
      pricePerUnit: totalUnits && recentSoldPrice.amount !== null
        ? Math.round(recentSoldPrice.amount / totalUnits * 100) / 100 : null,
      evidenceConfidence: classification === "PACK_UNKNOWN" ? "UNRESOLVED" : "STRONG",
      comparable: winnerComparableFromStoredSoldEvidence({ targetIdentity: input.targetIdentity,
        row }),
    }]
  }).slice(0, 100)
}

export function officialSoldPackIntelligenceComparablesForTarget(input: {
  targetIdentity: ProductIdentityInput
  rows: StoredOfficialSoldEvidence[]
  targetSupplierVariantId?: string | null
}) {
  return officialSoldPackIntelligenceForTarget(input)
    .filter((signal) => signal.classification !== "EXACT_PACK_COMPARABLE")
    .map((signal) => signal.comparable)
}

export function officialSoldEvidenceComparablesForTarget(input: {
  targetIdentity: ProductIdentityInput
  rows: StoredOfficialSoldEvidence[]
  targetSupplierVariantId?: string | null
}) {
  const now = Date.now()
  return input.rows.flatMap((row): WinnerComparableInput[] => {
    const base = storedSoldEvidenceBaseMatch({ ...input, row })
    if (!base.matched || Date.parse(row.observed_at) > now + 86_400_000) return []
    const classification = classifyWinnerComparable(input.targetIdentity,
      { ...base.identity, productName: base.target.normalizedProductName }).classification
    const comparable = winnerComparableFromStoredSoldEvidence({
      targetIdentity: input.targetIdentity,
      row,
    })
    if (row.source_type === "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE") {
      if (row.match_classification === "SAME_PRODUCT_DIFFERENT_SIZE") {
        return ["DIFFERENT_PACK", "DIFFERENT_VARIANT"].includes(classification)
          ? [comparable] : []
      }
      const expected = row.match_classification === "DIFFERENT_VARIANT"
        ? "DIFFERENT_VARIANT"
        : row.match_classification === "SAME_PRODUCT_DIFFERENT_PACK"
          ? "DIFFERENT_PACK"
          : "EXACT_MATCH"
      return classification === expected ? [comparable] : []
    }
    return classification === "EXACT_MATCH" ? [comparable] : []
  }).slice(0, 100)
}

export function deduplicateOfficialSoldEvidence(rows: NormalizedOfficialSoldEvidence[]) {
  const observations = [...new Map(rows.map((row) =>
    [row.evidenceDeduplicationKey, row] as const)).values()]
  return { observations, duplicateCount: rows.length - observations.length }
}

export async function readReviewedOfficialSoldEvidence(input: {
  supabase: SupabaseClient
  accountKey: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const [imports, captures, reconciliations] = await Promise.all([
    input.supabase.rpc("read_marketplace_sold_evidence_v1", {
      p_marketplace_account_key: input.accountKey,
      p_eligible_at: now.toISOString(),
      p_import_batch_id: null,
      p_limit: 2_000,
    }),
    input.supabase.from("marketplace_product_research_capture_observations")
      .select("id,source,source_listing_reference_hash,normalized_identity,confirmed_sold_quantity,evidence_scope,average_sold_price,average_shipping,keyword_signals,visible_image_count,last_sold_date,match_classification,matched_supplier_variant_id")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .eq("evidence_reviewed", true)
      .eq("quality_status", "VALID")
      .gte("last_sold_date", new Date(now.getTime() - OFFICIAL_SOLD_EVIDENCE_RECENCY_DAYS * 86_400_000).toISOString())
      .order("last_sold_date", { ascending: false }).limit(2_000),
    input.supabase.from("marketplace_product_identity_reconciliation_events")
      .select("observation_id,classification,luna_supplier_variant_id,reconciled_at")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .order("reconciled_at", { ascending: false }).limit(5_000),
  ])
  if (imports.error || captures.error || reconciliations.error) throw new Error("SOLD_EVIDENCE_READ_FAILED")
  const latestReconciliation = new Map<string, { classification: string; variant: string | null }>()
  for (const row of reconciliations.data ?? []) if (!latestReconciliation.has(row.observation_id)) {
    latestReconciliation.set(row.observation_id, {
      classification: row.classification,
      variant: row.luna_supplier_variant_id,
    })
  }
  const eligible = new Set(["EXACT_LUNA_MATCH", "SAME_PRODUCT_DIFFERENT_PACK",
    "SAME_PRODUCT_DIFFERENT_SIZE"])
  const browserRows: StoredOfficialSoldEvidence[] = (captures.data ?? []).flatMap((row) => {
    const reconciliation = latestReconciliation.get(row.id)
    const classification = reconciliation?.classification ?? row.match_classification
    const matchedVariant = reconciliation?.variant ?? row.matched_supplier_variant_id
    if (!eligible.has(classification) || !matchedVariant) return []
    return [{
    source_type: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE",
    source_class: "OFFICIAL_PRODUCT_RESEARCH",
    item_id: null,
    sold_at: row.last_sold_date,
    captured_at: row.last_sold_date,
    query_or_research_identity: null,
    source_listing_reference_hash: row.source_listing_reference_hash,
    normalized_identity: row.normalized_identity as ReturnType<typeof normalizeProductIdentity>,
    confirmed_sold_quantity: row.confirmed_sold_quantity,
    evidence_scope: "MARKET_WIDE_SOLD_EVIDENCE",
    sale_confirmation_basis: "SOLD_QUANTITY_POSITIVE",
    item_price: row.average_sold_price,
    shipping_cost: row.average_shipping,
    displayed_sold_price_amount: null,
    displayed_sold_price_currency: null,
    realized_transaction_price_amount: null,
    realized_transaction_price_currency: null,
    realized_price_status: "UNAVAILABLE",
    best_offer_status: "UNKNOWN",
    visible_shipping_amount: null,
    visible_shipping_currency: null,
    shipping_status: "UNAVAILABLE",
    price_evidence_provenance: "PRODUCT_RESEARCH_AGGREGATE",
    evidence_digest: row.source_listing_reference_hash,
    keyword_signals: row.keyword_signals,
    shipping_pattern: row.average_shipping === 0 ? "FREE_SHIPPING" : null,
    returns_pattern: null,
    image_count: row.visible_image_count,
    visual_evidence: { imageCount: row.visible_image_count, observedAt: row.last_sold_date,
      evidenceLevel: row.visible_image_count === null ? "INSUFFICIENT" : "LOW" },
    observed_at: row.last_sold_date,
    match_classification: classification as StoredOfficialSoldEvidence["match_classification"],
    matched_supplier_variant_id: matchedVariant,
  }]
  })
  return [...(imports.data ?? []) as StoredOfficialSoldEvidence[], ...browserRows]
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
    .select("id,evidence_scope,source_row_count,valid_count,confirmed_sale_count,completed_without_sale_count,imported_count,duplicate_count,rejected_count,error_counts,imported_at")
    .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
    .eq("source_file_hash", parsed.sourceFileHash).maybeSingle()
  if (duplicateBatchError) throw new Error("SOLD_EVIDENCE_BATCH_DEDUP_READ_FAILED")
  if (duplicateBatch) {
    const packSignalsPreservedCount = Number(
      record(duplicateBatch.error_counts).PACK_COUNT_REQUIRED,
    ) || 0
    return { duplicate: true, batchId: duplicateBatch.id,
    evidenceScope: duplicateBatch.evidence_scope,
    rowCount: duplicateBatch.source_row_count, validCount: duplicateBatch.valid_count,
    confirmedSaleCount: duplicateBatch.confirmed_sale_count,
    completedWithoutSaleCount: duplicateBatch.completed_without_sale_count,
    importedCount: duplicateBatch.imported_count,
    duplicateCount: duplicateBatch.duplicate_count,
    rejectedCount: duplicateBatch.rejected_count + packSignalsPreservedCount,
    hardRejectedCount: duplicateBatch.rejected_count,
    packSignalsPreservedCount,
    canonicalComparableCount: Math.max(0, duplicateBatch.confirmed_sale_count -
      packSignalsPreservedCount),
    errorCounts: record(duplicateBatch.error_counts),
    importedAt: duplicateBatch.imported_at, reanalysisRequired: false,
    rawFileStored: false, piiStored: false, openAiCalls: 0, ebayWrites: 0 }
  }

  const persistableEvidence = [...parsed.observations, ...parsed.commercialPackSignals]
  const uniqueObservations = deduplicateOfficialSoldEvidence(persistableEvidence).observations
  const deduplicationKeys = uniqueObservations.map((row) => row.evidenceDeduplicationKey)
  const existingKeys = new Set<string>()
  for (let offset = 0; offset < deduplicationKeys.length; offset += 250) {
    const page = deduplicationKeys.slice(offset, offset + 250)
    const { data, error } = await input.supabase.from("marketplace_sold_evidence_observations")
      .select("evidence_deduplication_key").eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", "EBAY_US").in("evidence_deduplication_key", page)
    if (error) throw new Error("SOLD_EVIDENCE_OBSERVATION_DEDUP_READ_FAILED")
    for (const row of data ?? []) existingKeys.add(row.evidence_deduplication_key)
  }
  const fresh = uniqueObservations.filter((row) => !existingKeys.has(row.evidenceDeduplicationKey))
  const duplicateCount = persistableEvidence.length - fresh.length
  const batchId = randomUUID()
  const observedTimes = fresh.map((row) => Date.parse(row.observedAt)).filter(Number.isFinite)
  const rpcRows = fresh.map((row) => ({
    source_class: row.sourceClass,
    item_id: row.itemId,
    sold_at: row.soldAt,
    captured_at: row.capturedAt,
    query_or_research_identity: row.queryOrResearchIdentity,
    sale_confirmation_basis: row.saleConfirmationBasis,
    source_listing_reference_hash: row.sourceListingReferenceHash,
    evidence_deduplication_key: row.evidenceDeduplicationKey,
    normalized_identity: row.normalizedIdentity,
    confirmed_sold_quantity: row.confirmedSoldQuantity,
    item_price: row.itemPrice,
    shipping_cost: row.shippingCost,
    displayed_sold_price_amount: row.displayedSoldPriceAmount,
    displayed_sold_price_currency: row.displayedSoldPriceCurrency,
    realized_transaction_price_amount: row.realizedTransactionPriceAmount,
    realized_transaction_price_currency: row.realizedTransactionPriceCurrency,
    realized_price_status: row.realizedPriceStatus,
    best_offer_status: row.bestOfferStatus,
    visible_shipping_amount: row.visibleShippingAmount,
    visible_shipping_currency: row.visibleShippingCurrency,
    shipping_status: row.shippingStatus,
    price_evidence_provenance: row.priceEvidenceProvenance,
    evidence_digest: row.evidenceDigest,
    keyword_signals: row.keywordSignals,
    shipping_pattern: row.shippingPattern,
    returns_pattern: row.returnsPattern,
    image_count: row.imageCount,
    visual_evidence: row.visualEvidence,
    observed_at: row.observedAt,
    eligible_until: row.eligibleUntil,
  }))
  const { error: importError } = await input.supabase.rpc("import_marketplace_sold_evidence_v3", {
    p_batch_id: batchId,
    p_marketplace_account_key: input.accountKey,
    p_source_type: parsed.sourceType,
    p_source_export_type: parsed.sourceExportType,
    p_evidence_scope: parsed.evidenceScope,
    p_market_wide_schema_confirmed: parsed.marketWideSchemaConfirmed,
    p_source_file_hash: parsed.sourceFileHash,
    p_import_schema_version: OFFICIAL_SOLD_EVIDENCE_IMPORT_VERSION,
    p_source_row_count: parsed.sourceRowCount,
    p_row_count: parsed.rowCount,
    p_valid_count: parsed.validCount,
    p_confirmed_sale_count: parsed.confirmedSaleCount,
    p_completed_without_sale_count: parsed.completedWithoutSaleCount,
    p_duplicate_count: duplicateCount,
    p_rejected_count: parsed.hardRejectedCount,
    p_error_counts: parsed.errorCounts,
    p_source_observed_start: observedTimes.length ? new Date(Math.min(...observedTimes)).toISOString() : null,
    p_source_observed_end: observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : null,
    p_reviewed_by: input.actorId,
    p_observations: rpcRows,
  })
  if (importError) throw new Error("SOLD_EVIDENCE_IMPORT_PERSIST_FAILED")

  const [officialHashes, captureHashes] = await Promise.all([
    input.supabase.from("marketplace_sold_evidence_import_batches").select("source_file_hash")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .eq("status", "IMPORTED").order("source_file_hash", { ascending: true }),
    input.supabase.from("marketplace_product_research_capture_batches").select("capture_hash")
      .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
      .order("capture_hash", { ascending: true }),
  ])
  if (officialHashes.error || captureHashes.error) throw new Error("SOLD_EVIDENCE_VERSION_READ_FAILED")
  const soldEvidenceVersion = sha256([
    ...(officialHashes.data ?? []).map((row) => row.source_file_hash),
    ...(captureHashes.data ?? []).map((row) => row.capture_hash),
  ].sort())
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
  return { duplicate: false, batchId, evidenceScope: parsed.evidenceScope,
    rowCount: parsed.sourceRowCount, validCount: parsed.validCount,
    confirmedSaleCount: parsed.confirmedSaleCount,
    completedWithoutSaleCount: parsed.completedWithoutSaleCount,
    importedCount: fresh.length, duplicateCount, rejectedCount: parsed.rejectedCount,
    hardRejectedCount: parsed.hardRejectedCount,
    packSignalsPreservedCount: parsed.packSignalsPreservedCount,
    canonicalComparableCount: parsed.canonicalComparableCount,
    errorCounts: parsed.errorCounts,
    importedAt, reanalysisRequired: fresh.length > 0,
    rawFileStored: false, piiStored: false, openAiCalls: 0, ebayWrites: 0 }
}

type SoldEvidenceCoverageTarget = {
  id: string
  identity: ProductIdentityInput
}

export function officialSoldEvidenceCoverage(input: {
  rows: StoredOfficialSoldEvidence[]
  targets: SoldEvidenceCoverageTarget[]
}) {
  const matchedTargetIds = new Set<string>()
  let exactMatches = 0
  let ambiguousMatches = 0
  let withoutLunaMatch = 0
  for (const row of input.rows) {
    const matches = input.targets.filter((target) =>
      officialSoldEvidenceComparablesForTarget({ targetIdentity: target.identity, rows: [row] }).length === 1)
    if (matches.length === 1) {
      exactMatches += 1
      matchedTargetIds.add(matches[0].id)
    } else if (matches.length > 1) {
      ambiguousMatches += 1
    } else {
      withoutLunaMatch += 1
    }
  }
  return {
    exactMatches,
    ambiguousMatches,
    withoutLunaMatch,
    top20CandidatesEnriched: matchedTargetIds.size,
  }
}

function coverageTarget(row: { id: string; evidence_snapshot: unknown }): SoldEvidenceCoverageTarget | null {
  const snapshot = record(row.evidence_snapshot)
  const identity = record(record(snapshot.identityEnrichment).identity)
  if (!Object.keys(identity).length) return null
  return { id: row.id, identity: identity as ProductIdentityInput }
}

export async function getOfficialSoldEvidenceImportStatus(input: {
  supabase: SupabaseClient
  accountKey: string
}) {
  const [{ count: observations, error: observationError }, { data: latest, error: latestError },
    { data: latestRun, error: runError }] = await Promise.all([
      input.supabase.from("marketplace_sold_evidence_observations")
        .select("id", { count: "exact", head: true }).eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US").eq("evidence_reviewed", true),
      input.supabase.from("marketplace_sold_evidence_import_batches")
        .select("id,source_type,source_export_type,evidence_scope,market_wide_schema_confirmed,source_row_count,valid_count,confirmed_sale_count,completed_without_sale_count,imported_count,duplicate_count,rejected_count,error_counts,source_observed_start,source_observed_end,imported_at")
        .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
        .order("imported_at", { ascending: false }).limit(1).maybeSingle(),
      input.supabase.from("marketplace_listing_approval_queue_runs").select("id")
        .eq("marketplace_account_key", input.accountKey).eq("marketplace", "EBAY_US")
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ])
  if (observationError || latestError || runError) throw new Error("SOLD_EVIDENCE_STATUS_READ_FAILED")
  let coverage = { exactMatches: 0, ambiguousMatches: 0, withoutLunaMatch: 0,
    top20CandidatesEnriched: 0 }
  let packIntelligence = { packProvenObservationCount: 0, packUnknownSignalCount: 0,
    packCountRequiredCount: 0 }
  if (latest) {
    const [observationResult, targetResult] = await Promise.all([
      input.supabase.rpc("read_marketplace_sold_evidence_v1", {
        p_marketplace_account_key: input.accountKey,
        p_eligible_at: null,
        p_import_batch_id: latest.id,
        p_limit: 2_000,
      }),
      latestRun ? input.supabase.from("marketplace_listing_approval_queue_items")
        .select("id,evidence_snapshot").eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US").eq("run_id", latestRun.id) : Promise.resolve({ data: [], error: null }),
    ])
    if (observationResult.error || targetResult.error) throw new Error("SOLD_EVIDENCE_COVERAGE_READ_FAILED")
    coverage = officialSoldEvidenceCoverage({
      rows: (observationResult.data ?? []) as StoredOfficialSoldEvidence[],
      targets: (targetResult.data ?? []).map(coverageTarget)
        .filter((value): value is SoldEvidenceCoverageTarget => value !== null),
    })
    const latestRows = (observationResult.data ?? []) as StoredOfficialSoldEvidence[]
    packIntelligence = {
      packProvenObservationCount: latestRows.filter((row) =>
        normalizeProductIdentity(record(row.normalized_identity)).packCount !== null).length,
      packUnknownSignalCount: latestRows.filter((row) =>
        normalizeProductIdentity(record(row.normalized_identity)).packCount === null).length,
      packCountRequiredCount: Number(record(latest.error_counts).PACK_COUNT_REQUIRED) || 0,
    }
  }
  return { configured: true, reviewedObservationCount: observations ?? 0, latest: latest ?? null,
    coverage, packIntelligence,
    acceptedFormats: ["CSV", "JSON"], maxRows: OFFICIAL_SOLD_EVIDENCE_MAX_ROWS,
    recencyDays: OFFICIAL_SOLD_EVIDENCE_RECENCY_DAYS,
    rawFilesStored: false, competitorTitlesStored: false, sellerIdentitiesStored: false,
    competitorImageUrlsStored: false, piiStored: false, openAiCalls: 0, ebayWrites: 0 }
}
