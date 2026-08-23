import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { after, test } from "node:test"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const previousTypeScriptLoader = require.extensions[".ts"]
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8")
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
    },
  })
  module._compile(output.outputText, filename)
}

const {
  SELLER_OS_EBAY_TRADING_RATE_LIMIT_RESOURCE_V1,
  buildSellerOsEbayTradingRateLimitStatusV1,
  collectSellerOsEbayTradingRateLimitStatusV1,
  createUnavailableSellerOsEbayTradingRateLimitStatusV1,
  resetSellerOsEbayTradingRateLimitCacheForTestsV1,
} = require("./ebay-trading-rate-limit-observability-v1.ts")

after(() => {
  if (previousTypeScriptLoader) {
    require.extensions[".ts"] = previousTypeScriptLoader
  } else {
    delete require.extensions[".ts"]
  }
})

const OBSERVED_AT = "2026-08-22T12:00:00.000Z"
const NOW = Date.parse(OBSERVED_AT)
const RESET_AT = "2026-08-23T00:00:00.000Z"

function payload({ resource = "api", count = 5_000, limit = 5_000,
  remaining = 0, reset = RESET_AT, timeWindow = 86_400 } = {}) {
  return { rateLimits: [{
    apiContext: "tradingapi",
    apiName: "tradingapi",
    apiVersion: "v1",
    resources: [{ name: resource, rates: [{ count, limit, remaining,
      reset, timeWindow, rawSecret: "must-not-propagate" }] }],
  }] }
}

function build(value) {
  return buildSellerOsEbayTradingRateLimitStatusV1({ payload: value,
    observedAt: OBSERVED_AT, ebayAppIdentityMatch: true })
}

function collectorOptions(fetcher) {
  return {
    environment: { EBAY_CLIENT_ID: "canonical-app-id",
      EBAY_CLIENT_SECRET: "server-owned-secret" },
    appIdentityVerifier: (clientId) => clientId === "canonical-app-id",
    tokenProvider: async () => "server-owned-application-token",
    fetcher,
    now: () => NOW,
  }
}

test("application Trading aggregate at zero blocks the gate and proves the 518 bucket", () => {
  const result = build(payload())
  assert.equal(result.contractVersion,
    "SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_V1")
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.ebayEnvironment, "PRODUCTION")
  assert.equal(result.ebayMarketplace, "EBAY_US")
  assert.equal(result.ebayAppIdentityMatch, true)
  assert.equal(result.tradingApiRateLimitFound, true)
  assert.equal(result.gateState, "BLOCKED")
  assert.equal(result.ebay518BucketIdentity, "PROVEN")
  assert.equal(result.ebay518LimitScope, "APPLICATION")
  assert.deepEqual(result.ebay518Rate, {
    apiContext: "tradingapi", apiName: "tradingapi", apiVersion: "v1",
    resource: "api", count: 5_000, limit: 5_000, remaining: 0,
    resetAt: RESET_AT, timeWindow: 86_400, limitScope: "APPLICATION",
  })
  assert.equal(result.nextSafeTradingProbeAt, RESET_AT)
  assert.equal(result.retryPolicy.tradingProbeWhileBlockedAllowed, false)
  assert.equal(result.retryPolicy.certificationProbesAfterProvenResetMaximum, 1)
  assert.equal(result.retryPolicy.automaticPolling, false)
  assert.equal(result.retryPolicy.p2ActivationAuthorized, false)
  assert.equal(result.safety.tradingLiveCallsByThisRead, 0)
  assert.equal(result.safety.getMyeBaySellingCallsByThisRead, 0)
  assert.equal(result.safety.getSellerListCallsByThisRead, 0)
  assert.equal(result.safety.getItemCallsByThisRead, 0)
  assert.doesNotMatch(JSON.stringify(result), /must-not-propagate/)
})

test("positive current Trading application quota is the only path to OPEN", () => {
  const result = build(payload({ count: 120, remaining: 4_880 }))
  assert.equal(result.gateState, "OPEN")
  assert.equal(result.evidenceCompleteness, "COMPLETE")
  assert.equal(result.ebay518BucketIdentity, "UNPROVEN")
  assert.equal(result.nextSafeTradingProbeAt, null)
})

test("unknown, incomplete, expired, or wrong-context evidence never opens the gate", () => {
  for (const candidate of [
    null,
    {},
    { rateLimits: [] },
    payload({ reset: OBSERVED_AT }),
    { rateLimits: [{ apiContext: "buy", apiName: "browse",
      resources: [{ name: "item_summary", rates: [{ count: 1, limit: 5_000,
        remaining: 4_999, reset: RESET_AT, timeWindow: 86_400 }] }] }] },
  ]) {
    const result = build(candidate)
    assert.equal(result.gateState, "UNPROVEN")
    assert.notEqual(result.gateState, "OPEN")
  }
})

test("both exhausted Trading methods prove correlation without inventing one primary rate", () => {
  const result = build({ rateLimits: [{ apiContext: "TRADINGAPI",
    apiName: "TradingApi", apiVersion: "v1", resources: [
      { name: "GetMyeBaySelling", rates: [{ count: 300, limit: 300,
        remaining: 0, reset: RESET_AT, timeWindow: 86_400 }] },
      { name: "GetSellerList", rates: [{ count: 300, limit: 300,
        remaining: 0, reset: RESET_AT, timeWindow: 86_400 }] },
    ] }] })
  assert.equal(result.gateState, "BLOCKED")
  assert.equal(result.ebay518BucketIdentity, "PROVEN")
  assert.equal(result.blockingRates.length, 2)
  assert.equal(result.ebay518Rate, null)
})

test("collector performs one fixed filtered Analytics GET and zero Trading calls", async () => {
  resetSellerOsEbayTradingRateLimitCacheForTestsV1()
  let calls = 0
  let seenUrl = ""
  const result = await collectSellerOsEbayTradingRateLimitStatusV1(
    collectorOptions(async (url, init) => {
      calls += 1
      seenUrl = String(url)
      assert.equal(init.method, "GET")
      assert.equal(init.redirect, "error")
      assert.equal(new Headers(init.headers).get("authorization"),
        "Bearer server-owned-application-token")
      return Response.json(payload())
    }),
  )
  const parsed = new URL(seenUrl)
  assert.equal(parsed.origin, "https://api.ebay.com")
  assert.equal(parsed.pathname,
    "/developer/analytics/v1_beta/rate_limit/")
  assert.deepEqual([...parsed.searchParams], [
    ["api_context", "tradingapi"],
    ["api_name", "tradingapi"],
  ])
  assert.equal(calls, 1)
  assert.equal(result.acquisition.developerAnalyticsCallsByThisRead, 1)
  assert.equal(result.acquisition.cacheStatus, "MISS")
  assert.equal(result.safety.tradingLiveCallsByThisRead, 0)
  assert.doesNotMatch(JSON.stringify(result),
    /server-owned|authorization|clientSecret|process\.env/i)
})

test("100 concurrent reads single-flight and cached replay never multiplies Analytics", async () => {
  resetSellerOsEbayTradingRateLimitCacheForTestsV1()
  let analyticsCalls = 0
  let tokenCalls = 0
  const options = collectorOptions(async () => {
    analyticsCalls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return Response.json(payload({ count: 100, remaining: 4_900 }))
  })
  options.tokenProvider = async () => {
    tokenCalls += 1
    return "server-owned-application-token"
  }
  const results = await Promise.all(Array.from({ length: 100 }, () =>
    collectSellerOsEbayTradingRateLimitStatusV1(options)))
  assert.equal(analyticsCalls, 1)
  assert.equal(tokenCalls, 1)
  assert.ok(results.every((entry) => entry.gateState === "OPEN"))
  const replay = await collectSellerOsEbayTradingRateLimitStatusV1(options)
  assert.equal(analyticsCalls, 1)
  assert.equal(replay.acquisition.cacheStatus, "HIT")
  assert.equal(replay.acquisition.developerAnalyticsCallsByThisRead, 0)
})

test("identity, token, HTTP, and payload failures remain UNPROVEN and sanitized", async () => {
  resetSellerOsEbayTradingRateLimitCacheForTestsV1()
  let reads = 0
  const unmatched = await collectSellerOsEbayTradingRateLimitStatusV1({
    ...collectorOptions(async () => { reads += 1; return Response.json(payload()) }),
    appIdentityVerifier: () => false,
  })
  assert.equal(unmatched.gateState, "UNPROVEN")
  assert.equal(unmatched.ebayAppIdentityMatch, false)
  assert.equal(reads, 0)

  resetSellerOsEbayTradingRateLimitCacheForTestsV1()
  const failed = await collectSellerOsEbayTradingRateLimitStatusV1(
    collectorOptions(async () => {
      reads += 1
      return new Response("sensitive upstream error", { status: 503 })
    }),
  )
  assert.equal(failed.status, "UNAVAILABLE")
  assert.equal(failed.gateState, "UNPROVEN")
  assert.equal(failed.acquisition.developerAnalyticsCallsByThisRead, 1)
  assert.doesNotMatch(JSON.stringify(failed), /sensitive upstream error/)
})

test("surface is fixed, bounded, PII-free, credential-free, and has no Trading call path", () => {
  assert.equal(SELLER_OS_EBAY_TRADING_RATE_LIMIT_RESOURCE_V1.id,
    "seller-os://phase-2/ebay-trading-rate-limit")
  const unavailable = createUnavailableSellerOsEbayTradingRateLimitStatusV1()
  assert.equal(unavailable.gateState, "UNPROVEN")
  assert.equal(unavailable.safety.ebayWritesByThisRead, 0)
  assert.equal(unavailable.safety.credentialsIncluded, false)
  assert.equal(unavailable.safety.buyerPiiIncluded, false)
  const source = readFileSync(new URL(
    "./ebay-trading-rate-limit-observability-v1.ts", import.meta.url), "utf8")
  assert.doesNotMatch(source,
    /api\.ebay\.com\/ws\/api\.dll|X-EBAY-API-CALL-NAME|<GetSellerListRequest|<GetMyeBaySellingRequest|<GetItemRequest/)
  assert.match(source, /api_context/)
  assert.match(source, /tradingapi/)
  assert.doesNotMatch(source, /caller.*url|input\.url|environment\.EBAY_API_CONTEXT/i)
})
