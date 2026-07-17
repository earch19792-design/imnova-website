export type EbayApplicationBrowseQuota = {
  status: "AVAILABLE" | "UNAVAILABLE"
  limit: number | null
  count: number | null
  remaining: number | null
  resetAt: string | null
  observedAt: string
  source: "EBAY_DEVELOPER_ANALYTICS_READONLY"
  payloadStored: false
  secretsExposed: false
  ebayWrites: 0
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseEbayApplicationBrowseQuota(
  value: unknown,
  observedAt = new Date().toISOString(),
): EbayApplicationBrowseQuota {
  const unavailable = (): EbayApplicationBrowseQuota => ({
    status: "UNAVAILABLE", limit: null, count: null, remaining: null, resetAt: null,
    observedAt, source: "EBAY_DEVELOPER_ANALYTICS_READONLY",
    payloadStored: false, secretsExposed: false, ebayWrites: 0,
  })
  const payload = record(value)
  const browse = array(payload.rateLimits).map(record).find((entry) =>
    text(entry.apiContext).toLocaleLowerCase("en-US") === "buy" &&
    text(entry.apiName).toLocaleLowerCase("en-US") === "browse")
  const rates = array(browse?.resources).map(record)
    .flatMap((resource) => array(resource.rates).map(record))
  const remainingValues = rates.map((rate) => numberOrNull(rate.remaining))
    .filter((entry): entry is number => entry !== null)
  const limits = rates.map((rate) => numberOrNull(rate.limit))
    .filter((entry): entry is number => entry !== null)
  const counts = rates.map((rate) => numberOrNull(rate.count))
    .filter((entry): entry is number => entry !== null)
  const resets = rates.map((rate) => text(rate.reset)).filter((entry) =>
    Number.isFinite(Date.parse(entry))).sort((left, right) => Date.parse(left) - Date.parse(right))
  return remainingValues.length ? {
    status: "AVAILABLE",
    limit: limits.length ? Math.min(...limits) : null,
    count: counts.length ? Math.max(...counts) : null,
    remaining: Math.min(...remainingValues),
    resetAt: resets[0] ?? null,
    observedAt,
    source: "EBAY_DEVELOPER_ANALYTICS_READONLY",
    payloadStored: false,
    secretsExposed: false,
    ebayWrites: 0,
  } : unavailable()
}
