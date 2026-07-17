import assert from "node:assert/strict"
import test from "node:test"

import {
  EBAY_MARKETPLACE_INSIGHTS_PREFLIGHT_CONTRACT,
  getMarketplaceInsightsPreflightConfiguration,
  runMarketplaceInsightsPreflight,
} from "./ebay-marketplace-insights-preflight.ts"

const scope = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"

function previewEnvironment(overrides = {}) {
  return {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-command-center",
    NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
    EBAY_CLIENT_ID: "client-id-sensitive",
    EBAY_CLIENT_SECRET: "client-secret-sensitive",
    EBAY_MARKETPLACE_INSIGHTS_ENABLED: "false",
    ...overrides,
  }
}

function tokenResponse(options = {}) {
  return new Response(JSON.stringify({
    access_token: "access-token-sensitive",
    token_type: "Application Access Token",
    expires_in: 7200,
    scope,
    ...options,
  }), { status: 200, headers: { "content-type": "application/json" } })
}

test("configuration requires exact Preview branch, staging ref and client pair", () => {
  assert.equal(getMarketplaceInsightsPreflightConfiguration(previewEnvironment()).configured, true)
  assert.equal(getMarketplaceInsightsPreflightConfiguration(previewEnvironment({
    VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  })).configured, false)
  assert.equal(getMarketplaceInsightsPreflightConfiguration(previewEnvironment({
    EBAY_CLIENT_SECRET: "",
  })).clientPair, "MISSING")
})

test("production is blocked before any network request", async () => {
  let calls = 0
  const result = await runMarketplaceInsightsPreflight({
    environment: previewEnvironment({ VERCEL_ENV: "production" }),
    fetchImpl: async () => { calls += 1; return new Response() },
  })
  assert.equal(calls, 0)
  assert.equal(result.environment, "BLOCKED")
  assert.equal(result.safety.ebayWrites, 0)
})

test("invalid scope is classified without calling sales history", async () => {
  let calls = 0
  const result = await runMarketplaceInsightsPreflight({
    environment: previewEnvironment(),
    fetchImpl: async () => {
      calls += 1
      return new Response(JSON.stringify({ error: "invalid_scope", error_description: "secret detail" }), {
        status: 400, headers: { "content-type": "application/json" },
      })
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.entitlement, "INVALID_SCOPE")
  assert.equal(result.historyRequest, "NOT_EXECUTED")
  assert.doesNotMatch(JSON.stringify(result), /secret detail|client-secret-sensitive/)
})

test("403 Marketplace Insights response is classified NOT_ENTITLED", async () => {
  const methods = []
  const result = await runMarketplaceInsightsPreflight({
    environment: previewEnvironment(),
    fetchImpl: async (_url, init) => {
      methods.push(init?.method)
      return methods.length === 1 ? tokenResponse() : new Response("protected body", { status: 403 })
    },
  })
  assert.deepEqual(methods, ["POST", "GET"])
  assert.equal(result.tokenStatus, "READY")
  assert.equal(result.scopeConfirmed, true)
  assert.equal(result.entitlement, "NOT_ENTITLED")
  assert.equal(result.historyRequest, "REJECTED")
  assert.equal(result.safety.payloadStored, false)
})

test("authorized entitlement executes one official GET and returns no payload or secret", async () => {
  const requests = []
  const result = await runMarketplaceInsightsPreflight({
    environment: previewEnvironment(),
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method })
      return requests.length === 1
        ? tokenResponse()
        : new Response(JSON.stringify({ itemSales: [{ title: "must not be returned" }] }), { status: 200 })
    },
  })
  assert.equal(requests.length, 2)
  assert.equal(requests[1].method, "GET")
  assert.match(requests[1].url, /marketplace-insights\/v1_beta\/item_sales\/search/)
  assert.equal(result.entitlement, "AUTHORIZED")
  assert.equal(result.historyRequest, "AVAILABLE")
  assert.equal(result.safety.ebayWrites, 0)
  assert.doesNotMatch(JSON.stringify(result), /access-token-sensitive|must not be returned/)
})

test("disabled feature flag is reported but does not mutate or obscure entitlement preflight", async () => {
  let calls = 0
  const result = await runMarketplaceInsightsPreflight({
    environment: previewEnvironment({ EBAY_MARKETPLACE_INSIGHTS_ENABLED: "false" }),
    fetchImpl: async () => (++calls === 1 ? tokenResponse() : new Response("{}", { status: 200 })),
  })
  assert.equal(result.configuredFlag, "FALSE")
  assert.equal(result.entitlement, "AUTHORIZED")
  assert.equal(calls, 2)
})

test("contract uses the exact read-only sales-history endpoint and scope", () => {
  assert.equal(EBAY_MARKETPLACE_INSIGHTS_PREFLIGHT_CONTRACT.method, "GET")
  assert.equal(EBAY_MARKETPLACE_INSIGHTS_PREFLIGHT_CONTRACT.scope, scope)
  assert.equal(EBAY_MARKETPLACE_INSIGHTS_PREFLIGHT_CONTRACT.productionWrites, 0)
})
