import assert from "node:assert/strict"
import test from "node:test"

const {
  classifyEbayLiveCoverageFailureV1,
} = await import("./ebay-live-coverage-failure-v1.ts")

function failedCall(operation, providerErrorCode = null, httpStatus = 200) {
  return {
    operation,
    status: "FAILED",
    httpStatus,
    providerErrorCode,
    observedAt: "2026-10-05T12:00:00.000Z",
  }
}

test("LIVE coverage classifier distinguishes the four operational causes", () => {
  const cases = [
    ["EBAY_MONITOR_SELLER_DISCOVERY_TRADING_ERROR_518",
      "TRADING_GET_MY_EBAY_SELLING", "518", "QUOTA_EXHAUSTED"],
    ["EBAY_MONITOR_ACCOUNT_IDENTITY_TRADING_ERROR_931",
      "TRADING_GET_USER", "931", "AUTH_ERROR"],
    ["EBAY_MONITOR_SELLER_DISCOVERY_TRADING_ERROR_12345",
      "TRADING_GET_MY_EBAY_SELLING", "12345", "EBAY_TRADING_ERROR"],
    ["EBAY_MONITOR_READ_TIMEOUT",
      "TRADING_GET_MY_EBAY_SELLING", null,
      "TEMPORARY_UPSTREAM_FAILURE"],
  ]
  for (const [detailCode, operation, providerErrorCode, expected] of cases) {
    const result = classifyEbayLiveCoverageFailureV1({
      detailCode,
      calls: [failedCall(operation, providerErrorCode,
        providerErrorCode === null ? null : 200)],
    })
    assert.equal(result.status, "FAILED")
    assert.equal(result.causeClassification, expected)
    assert.equal(result.failedOperation, operation)
    assert.equal(result.zeroListingsInterpretation,
      "NO_SE_INTERPRETA_COMO_0_LISTINGS")
  }
})

test("Trading 10007 is temporary upstream, never inferred quota or auth", () => {
  const result = classifyEbayLiveCoverageFailureV1({
    detailCode: "EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_10007",
    calls: [
      failedCall("TRADING_GET_MY_EBAY_SELLING", "518"),
      failedCall("TRADING_GET_SELLER_LIST", "10007"),
    ],
  })
  assert.equal(result.causeClassification, "TEMPORARY_UPSTREAM_FAILURE")
  assert.equal(result.failedOperation, "TRADING_GET_SELLER_LIST")
  assert.equal(result.providerErrorCode, "10007")
  assert.equal(result.retryable, true)
  assert.deepEqual(result.attempts.map((attempt) => [
    attempt.operation,
    attempt.classification,
  ]), [
    ["TRADING_GET_MY_EBAY_SELLING", "QUOTA_EXHAUSTED"],
    ["TRADING_GET_SELLER_LIST", "TEMPORARY_UPSTREAM_FAILURE"],
  ])
})

test("durable 10007 detail remains a failed Trading state without live calls", () => {
  const result = classifyEbayLiveCoverageFailureV1({
    detailCode: "EBAY_MONITOR_SELLER_LIST_TRADING_ERROR_10007",
  })
  assert.equal(result.status, "FAILED")
  assert.equal(result.causeClassification, "TEMPORARY_UPSTREAM_FAILURE")
  assert.equal(result.failedOperation, "TRADING_GET_SELLER_LIST")
})

test("unrecognized evidence remains UNKNOWN_CAUSE", () => {
  const result = classifyEbayLiveCoverageFailureV1({
    detailCode: "CURRENT_LIVE_OFFICIAL_SOURCE_UNAVAILABLE",
  })
  assert.equal(result.status, "NOT_ATTEMPTED")
  assert.equal(result.causeClassification, "UNKNOWN_CAUSE")
  assert.equal(result.providerErrorCode, null)
})
