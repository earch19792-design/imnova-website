export type EbayReadonlyRateLimitSource =
  | "RETRY_AFTER_SECONDS"
  | "RETRY_AFTER_HTTP_DATE"
  | "UNAVAILABLE"

export type EbayReadonlyRateLimitMetadata = {
  httpStatus: 429
  retryAfterSeconds: number | null
  retryAfterSource: EbayReadonlyRateLimitSource
  observedAt: string
}

export class EbayReadonlyRateLimitError extends Error {
  readonly rateLimit: EbayReadonlyRateLimitMetadata

  constructor(code: "EBAY_OAUTH_429" | "EBAY_READONLY_GET_429", rateLimit: EbayReadonlyRateLimitMetadata) {
    super(code)
    this.name = "EbayReadonlyRateLimitError"
    this.rateLimit = rateLimit
  }
}

export function parseEbayRetryAfter(
  value: string | null,
  nowMs = Date.now(),
): Pick<EbayReadonlyRateLimitMetadata, "retryAfterSeconds" | "retryAfterSource"> {
  const normalized = value?.trim() ?? ""
  if (!normalized) return { retryAfterSeconds: null, retryAfterSource: "UNAVAILABLE" }
  if (/^\d+$/.test(normalized)) {
    return {
      retryAfterSeconds: Math.min(Number(normalized), 7 * 24 * 60 * 60),
      retryAfterSource: "RETRY_AFTER_SECONDS",
    }
  }
  const parsedDate = Date.parse(normalized)
  if (!Number.isFinite(parsedDate) || parsedDate <= nowMs) {
    return { retryAfterSeconds: null, retryAfterSource: "UNAVAILABLE" }
  }
  return {
    retryAfterSeconds: Math.min(Math.ceil((parsedDate - nowMs) / 1_000), 7 * 24 * 60 * 60),
    retryAfterSource: "RETRY_AFTER_HTTP_DATE",
  }
}

export function createEbayReadonlyRateLimitError(
  code: "EBAY_OAUTH_429" | "EBAY_READONLY_GET_429",
  response: Response,
) {
  return new EbayReadonlyRateLimitError(code, {
    httpStatus: 429,
    ...parseEbayRetryAfter(response.headers.get("retry-after")),
    observedAt: new Date().toISOString(),
  })
}

export function createEbayReadonlyQuotaLimitError(resetAt: string, nowMs = Date.now()) {
  const parsedReset = Date.parse(resetAt)
  const retryAfterSeconds = Number.isFinite(parsedReset) && parsedReset > nowMs
    ? Math.min(Math.ceil((parsedReset - nowMs) / 1_000), 7 * 24 * 60 * 60)
    : null
  return new EbayReadonlyRateLimitError("EBAY_READONLY_GET_429", {
    httpStatus: 429,
    retryAfterSeconds,
    retryAfterSource: retryAfterSeconds === null ? "UNAVAILABLE" : "RETRY_AFTER_HTTP_DATE",
    observedAt: new Date(nowMs).toISOString(),
  })
}

export function getEbayReadonlyRateLimitMetadata(
  error: unknown,
): EbayReadonlyRateLimitMetadata | null {
  return error instanceof EbayReadonlyRateLimitError ? error.rateLimit : null
}
