export const SELLER_OS_SUPABASE_RUNTIME_ERROR_CLASSIFICATION_V1 =
  "SELLER_OS_SUPABASE_RUNTIME_ERROR_CLASSIFICATION_V1" as const

export type SellerOsSupabaseRuntimeFailureClassV1 =
  "SCHEMA_UNAVAILABLE" | "TEMPORARILY_UNAVAILABLE" | "UNCLASSIFIED"

type JsonRecord = Record<string, unknown>

const SCHEMA_ERROR_CODES = new Set([
  "3F000", "42P01", "42703", "42883",
  "PGRST202", "PGRST203", "PGRST204", "PGRST205",
])

const TEMPORARY_ERROR_CODES = new Set([
  "53300", "57014", "57P01", "57P02", "57P03",
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT",
  "PGRST000", "PGRST001", "PGRST002", "PGRST003", "PGRSTX00",
])

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function normalizedToken(value: unknown) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toUpperCase().slice(0, 80) : ""
}

function diagnosticText(value: unknown) {
  const row = record(value)
  return [
    value instanceof Error ? value.message : "",
    row.message, row.details, row.hint, row.statusText,
  ].filter((entry): entry is string => typeof entry === "string")
    .join(" ").normalize("NFKC").toUpperCase().slice(0, 1_200)
}

export function classifySellerOsSupabaseRuntimeFailureV1(
  error: unknown,
): SellerOsSupabaseRuntimeFailureClassV1 {
  const row = record(error)
  const code = normalizedToken(row.code)
  const message = diagnosticText(error)
  if (SCHEMA_ERROR_CODES.has(code) ||
      /SCHEMA CACHE|COULD NOT FIND (?:THE )?(?:TABLE|FUNCTION|COLUMN)|(?:TABLE|FUNCTION|COLUMN|RELATION) [^ ]+ DOES NOT EXIST|UNDEFINED (?:TABLE|FUNCTION|COLUMN)/
        .test(message)) {
    return "SCHEMA_UNAVAILABLE"
  }
  if (TEMPORARY_ERROR_CODES.has(code) || /^08[A-Z0-9]{3}$/.test(code) ||
      /STATEMENT TIMEOUT|TIMED OUT|TIMEOUT|QUERY CANCELED|CANCELING STATEMENT|FAILED TO FETCH|FETCH FAILED|NETWORK ERROR|CONNECTION (?:ERROR|FAILED|REFUSED|RESET)|SERVICE UNAVAILABLE|BAD GATEWAY|GATEWAY TIMEOUT|HTTP (?:500|502|503|504|522|524)/
        .test(message)) {
    return "TEMPORARILY_UNAVAILABLE"
  }
  return "UNCLASSIFIED"
}

export function sellerOsBrowserWorkerHeartbeatFailureCodeV1(error: unknown) {
  const classification = classifySellerOsSupabaseRuntimeFailureV1(error)
  if (classification === "SCHEMA_UNAVAILABLE") {
    return "SELLER_OS_BROWSER_WORKER_HEARTBEAT_SCHEMA_UNAVAILABLE" as const
  }
  if (classification === "TEMPORARILY_UNAVAILABLE") {
    return "SELLER_OS_BROWSER_WORKER_HEARTBEAT_TEMPORARILY_UNAVAILABLE" as const
  }
  return "SELLER_OS_BROWSER_WORKER_HEARTBEAT_PERSIST_FAILED" as const
}

export function sellerOsOpportunityQueueReadFailureCodeV1(error: unknown) {
  const classification = classifySellerOsSupabaseRuntimeFailureV1(error)
  if (classification === "SCHEMA_UNAVAILABLE") {
    return "EBAY_LUNA_QUEUE_SCHEMA_UNAVAILABLE" as const
  }
  if (classification === "TEMPORARILY_UNAVAILABLE") {
    return "EBAY_LUNA_QUEUE_TEMPORARILY_UNAVAILABLE" as const
  }
  return "EBAY_LUNA_QUEUE_DASHBOARD_READ_FAILED" as const
}
