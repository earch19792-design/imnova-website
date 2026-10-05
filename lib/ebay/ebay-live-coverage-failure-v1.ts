export const EBAY_LIVE_COVERAGE_FAILURE_CONTRACT_VERSION =
  "EBAY_LIVE_COVERAGE_FAILURE_V1" as const

export type EbayLiveCoverageFailureClassification =
  | "QUOTA_EXHAUSTED"
  | "AUTH_ERROR"
  | "EBAY_TRADING_ERROR"
  | "TEMPORARY_UPSTREAM_FAILURE"
  | "UNKNOWN_CAUSE"

export type EbayLiveCoverageTradingOperation =
  | "OAUTH_REFRESH_TRADING"
  | "OAUTH_REFRESH_FULFILLMENT"
  | "TRADING_GET_USER"
  | "TRADING_GET_MY_EBAY_SELLING"
  | "TRADING_GET_SELLER_LIST"

type FailureCallEvidence = Readonly<{
  operation: string
  status: "SUCCEEDED" | "FAILED"
  httpStatus: number | null
  observedAt: string
  providerErrorCode?: string | null
}>

export type EbayLiveCoverageFailureAttemptV1 = Readonly<{
  operation: EbayLiveCoverageTradingOperation
  classification: EbayLiveCoverageFailureClassification
  providerErrorCode: string | null
  httpStatus: number | null
  detailCode: string
  observedAt: string | null
}>

export type EbayLiveCoverageTradingDiagnosticV1 = Readonly<{
  contractVersion: typeof EBAY_LIVE_COVERAGE_FAILURE_CONTRACT_VERSION
  status: "AVAILABLE" | "FAILED" | "NOT_ATTEMPTED"
  causeClassification: EbayLiveCoverageFailureClassification | null
  failedOperation: EbayLiveCoverageTradingOperation | null
  providerErrorCode: string | null
  httpStatus: number | null
  detailCode: string | null
  observedAt: string | null
  retryable: boolean
  attempts: readonly EbayLiveCoverageFailureAttemptV1[]
  zeroListingsInterpretation:
    | "NO_SE_INTERPRETA_COMO_0_LISTINGS"
    | "AUTHORITATIVE_ONLY_WHEN_CERTIFIED_COMPLETE"
}>

const SAFE_CODE = /^[A-Z0-9_]{3,160}$/
const NUMERIC_PROVIDER_CODE = /^\d{1,12}$/
// Closed allowlists from eBay's Trading API documentation. Unknown numeric
// codes stay EBAY_TRADING_ERROR; they never inherit quota or auth semantics.
// https://developer.ebay.com/Devzone/XML/docs/Reference/eBay/Errors/ErrorMessages.htm
const QUOTA_PROVIDER_CODES = new Set(["518"])
const AUTH_PROVIDER_CODES = new Set(["517", "584", "931", "932"])
// eBay documents 10007 as a server-side system error and advises retrying.
// https://developer.ebay.com/api-docs/user-guides/static/make-a-call/error-handling.html
const TEMPORARY_PROVIDER_CODES = new Set(["10007"])
const OPERATIONS = new Set<EbayLiveCoverageTradingOperation>([
  "OAUTH_REFRESH_TRADING",
  "OAUTH_REFRESH_FULFILLMENT",
  "TRADING_GET_USER",
  "TRADING_GET_MY_EBAY_SELLING",
  "TRADING_GET_SELLER_LIST",
])

function operation(value: string): EbayLiveCoverageTradingOperation | null {
  return OPERATIONS.has(value as EbayLiveCoverageTradingOperation)
    ? value as EbayLiveCoverageTradingOperation
    : null
}

function safeCode(value: unknown, fallback = "UNKNOWN_CAUSE") {
  return typeof value === "string" && SAFE_CODE.test(value)
    ? value
    : fallback
}

function providerCodeFromDetail(value: string) {
  return value.match(/_TRADING_ERROR_(\d{1,12})$/)?.[1] ?? null
}

function operationFromDetail(value: string) {
  if (value.includes("SELLER_LIST")) return "TRADING_GET_SELLER_LIST" as const
  if (value.includes("SELLER_DISCOVERY")) {
    return "TRADING_GET_MY_EBAY_SELLING" as const
  }
  if (value.includes("ACCOUNT_IDENTITY")) return "TRADING_GET_USER" as const
  if (value.includes("OAUTH_REFRESH_TRADING")) {
    return "OAUTH_REFRESH_TRADING" as const
  }
  if (value.includes("OAUTH_REFRESH_FULFILLMENT")) {
    return "OAUTH_REFRESH_FULFILLMENT" as const
  }
  return null
}

function classify(input: Readonly<{
  detailCode: string
  providerErrorCode: string | null
  httpStatus: number | null
}>): EbayLiveCoverageFailureClassification {
  if (input.providerErrorCode &&
      QUOTA_PROVIDER_CODES.has(input.providerErrorCode)) {
    return "QUOTA_EXHAUSTED"
  }
  if (input.providerErrorCode &&
      AUTH_PROVIDER_CODES.has(input.providerErrorCode)) {
    return "AUTH_ERROR"
  }
  if (input.providerErrorCode &&
      TEMPORARY_PROVIDER_CODES.has(input.providerErrorCode)) {
    return "TEMPORARY_UPSTREAM_FAILURE"
  }
  if (input.httpStatus === 401 || input.httpStatus === 403 ||
      /(?:OAUTH|AUTH|TOKEN|SCOPE|UNAUTHORIZED|CONFIGURATION_MISSING)/.test(
        input.detailCode,
      )) {
    return "AUTH_ERROR"
  }
  if (input.httpStatus === 429 || /(?:QUOTA_EXHAUSTED|RATE_LIMIT)/.test(
    input.detailCode,
  )) {
    return "QUOTA_EXHAUSTED"
  }
  if ((input.httpStatus !== null && input.httpStatus >= 500) ||
      /(?:READ_TIMEOUT|NETWORK_ERROR|TEMPORARY_UPSTREAM_FAILURE)/.test(
        input.detailCode,
      )) {
    return "TEMPORARY_UPSTREAM_FAILURE"
  }
  if (input.providerErrorCode &&
      NUMERIC_PROVIDER_CODE.test(input.providerErrorCode)) {
    return "EBAY_TRADING_ERROR"
  }
  if (/EBAY_MONITOR_(?:SELLER_DISCOVERY|SELLER_LIST|ACCOUNT_IDENTITY)_/.test(
    input.detailCode,
  )) {
    return "EBAY_TRADING_ERROR"
  }
  return "UNKNOWN_CAUSE"
}

function attemptFromCall(
  call: FailureCallEvidence,
  fallbackDetailCode: string,
): EbayLiveCoverageFailureAttemptV1 | null {
  const callOperation = operation(call.operation)
  if (!callOperation || call.status !== "FAILED") return null
  const providerErrorCode = typeof call.providerErrorCode === "string" &&
      NUMERIC_PROVIDER_CODE.test(call.providerErrorCode)
    ? call.providerErrorCode
    : null
  const detailCode = providerErrorCode
    ? `EBAY_TRADING_ERROR_${providerErrorCode}`
    : call.httpStatus !== null
      ? `EBAY_HTTP_${call.httpStatus}`
      : fallbackDetailCode
  return Object.freeze({
    operation: callOperation,
    classification: classify({ detailCode, providerErrorCode,
      httpStatus: call.httpStatus }),
    providerErrorCode,
    httpStatus: call.httpStatus,
    detailCode,
    observedAt: Number.isFinite(Date.parse(call.observedAt))
      ? new Date(call.observedAt).toISOString()
      : null,
  })
}

export function classifyEbayLiveCoverageFailureV1(input: Readonly<{
  detailCode: unknown
  calls?: readonly FailureCallEvidence[]
}>): EbayLiveCoverageTradingDiagnosticV1 {
  const detailCode = safeCode(input.detailCode)
  const attempts = Object.freeze((input.calls ?? []).flatMap((call) => {
    const attempt = attemptFromCall(call, detailCode)
    return attempt ? [attempt] : []
  }))
  const detailProviderCode = providerCodeFromDetail(detailCode)
  const detailOperation = operationFromDetail(detailCode)
  const preferredAttempt = [...attempts].reverse().find((attempt) =>
    attempt.operation === "TRADING_GET_SELLER_LIST") ??
    [...attempts].reverse().find((attempt) =>
      attempt.operation === "TRADING_GET_MY_EBAY_SELLING") ??
    attempts.at(-1) ?? null
  const providerErrorCode = preferredAttempt?.providerErrorCode ??
    detailProviderCode
  const failedOperation = preferredAttempt?.operation ?? detailOperation
  const httpStatus = preferredAttempt?.httpStatus ?? null
  const causeClassification = classify({ detailCode, providerErrorCode,
    httpStatus })
  const attempted = attempts.length > 0
  const failureEvidenced = attempted || detailProviderCode !== null ||
    /(?:READ_TIMEOUT|NETWORK_ERROR|OAUTH_REFRESH|HTTP_[45]\d\d)/.test(detailCode)
  return Object.freeze({
    contractVersion: EBAY_LIVE_COVERAGE_FAILURE_CONTRACT_VERSION,
    status: failureEvidenced ? "FAILED" as const : "NOT_ATTEMPTED" as const,
    causeClassification,
    failedOperation,
    providerErrorCode,
    httpStatus,
    detailCode,
    observedAt: preferredAttempt?.observedAt ?? null,
    retryable: causeClassification === "QUOTA_EXHAUSTED" ||
      causeClassification === "TEMPORARY_UPSTREAM_FAILURE",
    attempts,
    zeroListingsInterpretation: "NO_SE_INTERPRETA_COMO_0_LISTINGS" as const,
  })
}

export function availableEbayLiveCoverageTradingV1(input: Readonly<{
  calls?: readonly FailureCallEvidence[]
  observedAt?: string | null
  detailCode?: string | null
}> = {}): EbayLiveCoverageTradingDiagnosticV1 {
  const attempts = Object.freeze((input.calls ?? []).flatMap((call) => {
    const attempt = attemptFromCall(call, "EBAY_TRADING_ATTEMPT_FAILED")
    return attempt ? [attempt] : []
  }))
  const successfulDiscovery = [...(input.calls ?? [])].reverse().find((call) =>
    call.status === "SUCCEEDED" && (
      call.operation === "TRADING_GET_SELLER_LIST" ||
      call.operation === "TRADING_GET_MY_EBAY_SELLING"))
  const observedAt = input.observedAt ?? successfulDiscovery?.observedAt ?? null
  return Object.freeze({
    contractVersion: EBAY_LIVE_COVERAGE_FAILURE_CONTRACT_VERSION,
    status: "AVAILABLE" as const,
    causeClassification: null,
    failedOperation: null,
    providerErrorCode: null,
    httpStatus: null,
    detailCode: input.detailCode ?? null,
    observedAt: observedAt && Number.isFinite(Date.parse(observedAt))
      ? new Date(observedAt).toISOString()
      : null,
    retryable: false,
    attempts,
    zeroListingsInterpretation:
      "AUTHORITATIVE_ONLY_WHEN_CERTIFIED_COMPLETE" as const,
  })
}
