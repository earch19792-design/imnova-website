import assert from "node:assert/strict"
import test from "node:test"

import {
  EBAY_MARKETPLACE_INSIGHTS_PREFLIGHT_CONTRACT,
  getMarketplaceInsightsPreflightConfiguration,
  isMarketplaceInsightsPreflightRouteAllowed,
  parseMarketplaceInsightsOwnerPreflightAction,
  projectMarketplaceInsightsOwnerPreflightResult,
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

function dedicatedPreprodEnvironment(overrides = {}) {
  return {
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    VERCEL: "1",
    VERCEL_PROJECT_ID: "prj_XvOpSg1jhmLLG1yOCFhAbiLEn222",
    VERCEL_PROJECT_PRODUCTION_URL: "imnova-seller-os-preprod.vercel.app",
    EBAY_PRO_RUNTIME: "staging",
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

test("exact dedicated PREPROD project permits the read-only preflight in Vercel production", async () => {
  let calls = 0
  const result = await runMarketplaceInsightsPreflight({
    environment: dedicatedPreprodEnvironment(),
    fetchImpl: async () => (++calls === 1
      ? tokenResponse()
      : new Response("{}", { status: 200 })),
  })
  assert.equal(calls, 2)
  assert.equal(result.environment, "DEDICATED_PREPROD")
  assert.equal(result.dedicatedPreprod, true)
  assert.equal(result.configuredFlag, "FALSE")
  assert.equal(result.entitlement, "AUTHORIZED")
  assert.equal(result.tokenHttpStatus, 200)
  assert.equal(result.endpointHttpStatus, 200)
  assert.equal(result.safety.ebayWrites, 0)
})

test("OWNER preflight action has an exact body and sanitized projection", async () => {
  assert.deepEqual(parseMarketplaceInsightsOwnerPreflightAction({
    action: "PREFLIGHT_MARKETPLACE_INSIGHTS",
  }), { action: "PREFLIGHT_MARKETPLACE_INSIGHTS" })
  for (const body of [null, {}, { action: "OTHER" }, {
    action: "PREFLIGHT_MARKETPLACE_INSIGHTS", url: "https://example.test",
  }]) assert.throws(() => parseMarketplaceInsightsOwnerPreflightAction(body),
    /MARKETPLACE_INSIGHTS_PREFLIGHT_REQUEST_REJECTED/)

  let calls = 0
  const result = await runMarketplaceInsightsPreflight({
    environment: dedicatedPreprodEnvironment(),
    fetchImpl: async () => (++calls === 1
      ? tokenResponse()
      : new Response("secret payload must not escape", { status: 403 })),
  })
  const projected = projectMarketplaceInsightsOwnerPreflightResult(result)
  assert.deepEqual(projected, {
    TOKEN_PREFLIGHT: "PASS", TOKEN_HTTP_STATUS: 200,
    INVALID_CLIENT: "NO", SCOPE_ACCEPTED: "YES",
    MARKETPLACE_INSIGHTS_ENDPOINT_PREFLIGHT: "FAIL",
    ENDPOINT_HTTP_STATUS: 403, ENTITLEMENT_STATUS: "NOT_ENTITLED",
    MARKETPLACE_INSIGHTS_READY: "NO", SAFE_TO_ENABLE: "NO",
  })
  assert.doesNotMatch(JSON.stringify(projected),
    /access-token-sensitive|client-secret-sensitive|secret payload/)
})

test("dedicated PREPROD gate rejects wrong project, host, runtime and Seller OS production", () => {
  const rejected = [
    { VERCEL_PROJECT_ID: "prj_arbitrary" },
    { VERCEL_PROJECT_PRODUCTION_URL: "arbitrary-project.vercel.app" },
    { EBAY_PRO_RUNTIME: "production_core" },
    {
      VERCEL_PROJECT_ID: "prj_customerProductionHistorical",
      VERCEL_PROJECT_PRODUCTION_URL: "imnova-website-z1qh.vercel.app",
      EBAY_PRO_RUNTIME: "production_core",
      NEXT_PUBLIC_SUPABASE_URL: "https://qsefoxmmypmdtwrrtnry.supabase.co",
    },
  ]
  for (const override of rejected) {
    const configuration = getMarketplaceInsightsPreflightConfiguration(
      dedicatedPreprodEnvironment(override),
    )
    assert.equal(configuration.configured, false)
    assert.equal(configuration.dedicatedPreprod, false)
  }
})

test("dedicated PREPROD gate rejects missing credentials and any other route", () => {
  assert.equal(getMarketplaceInsightsPreflightConfiguration(
    dedicatedPreprodEnvironment({ EBAY_CLIENT_ID: "" }),
  ).configured, false)
  assert.equal(getMarketplaceInsightsPreflightConfiguration(
    dedicatedPreprodEnvironment({ EBAY_CLIENT_SECRET: "" }),
  ).configured, false)
  assert.equal(isMarketplaceInsightsPreflightRouteAllowed(
    "https://imnova-seller-os-preprod.vercel.app/api/admin/ebay/marketplace-insights/preflight",
    dedicatedPreprodEnvironment(),
  ), true)
  assert.equal(isMarketplaceInsightsPreflightRouteAllowed(
    "https://imnova-seller-os-preprod.vercel.app/api/admin/ebay/draft-only",
    dedicatedPreprodEnvironment(),
  ), false)
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
