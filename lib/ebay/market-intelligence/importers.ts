// @ts-expect-error Node's native TypeScript runner requires explicit extensions.
import { competitorListingSchema, ebayMarketIntelligenceInputSchema } from "./schema.ts"
import type { CompetitorListingInput, EbayMarketIntelligenceInput } from "./types.ts"

function parseCsvRows(source: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === "," && !quoted) {
      row.push(cell)
      cell = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ""
    } else {
      cell += character
    }
  }
  if (quoted) throw new Error("MARKET_INTELLIGENCE_CSV_UNCLOSED_QUOTE")
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

const NUMBER_FIELDS = new Set([
  "price", "shippingCost", "quantityIncluded", "totalUnitCount", "soldCountVisible",
  "watchersVisible", "sellerFeedbackPercent", "sellerFeedbackCount", "returnPeriodDays",
  "handlingTimeDays", "searchPosition", "reviewCount", "listingQualityScore",
])
const BOOLEAN_FIELDS = new Set([
  "returnsAccepted", "promotedVisible", "internationalShipping", "additionalProductsIncluded",
  "bestOfferVisible", "volumePricingVisible",
])
const JSON_FIELDS = new Set([
  "secondaryImageUrls", "itemSpecifics", "fieldEvidence", "badges",
  "mainImageAnalysis", "secondaryImageClassifications",
])

function decodeCsvValue(field: string, raw: string) {
  const value = raw.trim()
  if (!value) {
    if (["secondaryImageUrls", "badges", "secondaryImageClassifications"].includes(field)) return []
    if (["itemSpecifics", "fieldEvidence"].includes(field)) return {}
    return null
  }
  if (NUMBER_FIELDS.has(field)) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`MARKET_INTELLIGENCE_CSV_NUMBER_INVALID:${field}`)
    return parsed
  }
  if (BOOLEAN_FIELDS.has(field)) {
    if (["true", "yes", "1"].includes(value.toLowerCase())) return true
    if (["false", "no", "0"].includes(value.toLowerCase())) return false
    throw new Error(`MARKET_INTELLIGENCE_CSV_BOOLEAN_INVALID:${field}`)
  }
  if (JSON_FIELDS.has(field)) {
    try {
      return JSON.parse(value)
    } catch {
      throw new Error(`MARKET_INTELLIGENCE_CSV_JSON_INVALID:${field}`)
    }
  }
  return value
}

export function parseCompetitorListingsCsv(source: string): CompetitorListingInput[] {
  const rows = parseCsvRows(source)
  if (rows.length < 2) throw new Error("MARKET_INTELLIGENCE_CSV_ROWS_REQUIRED")
  const headers = rows[0].map((header) => header.trim())
  if (new Set(headers).size !== headers.length) {
    throw new Error("MARKET_INTELLIGENCE_CSV_HEADERS_DUPLICATED")
  }
  return rows.slice(1).map((values, rowIndex) => {
    if (values.length > headers.length) {
      throw new Error(`MARKET_INTELLIGENCE_CSV_COLUMNS_INVALID:${rowIndex + 2}`)
    }
    const candidate = Object.fromEntries(headers.map((header, index) => [
      header,
      decodeCsvValue(header, values[index] ?? ""),
    ]))
    const result = competitorListingSchema.safeParse(candidate)
    if (!result.success) {
      throw new Error(`MARKET_INTELLIGENCE_CSV_ROW_INVALID:${rowIndex + 2}`)
    }
    return result.data
  })
}

export function parseCompetitorListingsJson(source: string): CompetitorListingInput[] {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error("MARKET_INTELLIGENCE_JSON_INVALID")
  }
  if (!Array.isArray(value)) throw new Error("MARKET_INTELLIGENCE_JSON_ARRAY_REQUIRED")
  return value.map((item, index) => {
    const result = competitorListingSchema.safeParse(item)
    if (!result.success) throw new Error(`MARKET_INTELLIGENCE_JSON_COMPETITOR_INVALID:${index}`)
    return result.data
  })
}

export function parseMarketIntelligenceJson(source: string): EbayMarketIntelligenceInput {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error("MARKET_INTELLIGENCE_JSON_INVALID")
  }
  const result = ebayMarketIntelligenceInputSchema.safeParse(value)
  if (!result.success) throw new Error("MARKET_INTELLIGENCE_INPUT_INVALID")
  return result.data
}
