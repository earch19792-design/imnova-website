import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { after, test } from "node:test"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from
  "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"

const require = createRequire(import.meta.url)
const ts = require("typescript")
const previousTypeScriptLoader = require.extensions[".ts"]

// The application compiles extensionless TypeScript imports through Next.js.
// This focused Node test uses an equivalent CommonJS transpile hook so it can
// exercise the real route handler without starting a second web server.
require.extensions[".ts"] = (module, filename) => {
  const source = readFileSync(filename, "utf8")
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
    },
  })
  module._compile(output.outputText, filename)
}

const managedEnvironment = [
  "NODE_ENV",
  "EBAY_PRO_RUNTIME",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "SELLER_OS_MCP_DEPLOYMENT_MODE",
  "SELLER_OS_MCP_BIND_HOST",
]
const originalEnvironment = new Map(managedEnvironment.map((name) =>
  [name, process.env[name]]))

process.env.NODE_ENV = "development"
process.env.EBAY_PRO_RUNTIME = "development"
process.env.SELLER_OS_MCP_DEPLOYMENT_MODE = "TUNNEL_DEVELOPMENT"
process.env.SELLER_OS_MCP_BIND_HOST = "127.0.0.1"
delete process.env.VERCEL
delete process.env.VERCEL_ENV
delete process.env.VERCEL_TARGET_ENV

const {
  SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1,
  SELLER_OS_MCP_ENDPOINT_VERSION,
  createSellerOsMcpServerV1,
  handleSellerOsMcpRequestV1,
} = require("./ebay-seller-os-mcp-server-v1.ts")
const {
  createUnavailableSellerOsRuntimeHealthV1,
} = require("./ebay-seller-os-runtime-health-v1.ts")
const {
  SELLER_OS_CANONICAL_REPOSITORY_V1,
  createUnavailableSellerOsDevStatusV1,
} = require("./ebay-seller-os-dev-status-v1.ts")
const {
  createUnavailableSellerOsCiStatusV1,
} = require("./ebay-seller-os-ci-status-v1.ts")
const {
  createUnavailableSellerOsDataStatusV1,
} = require("./ebay-seller-os-data-status-v1.ts")
const {
  buildSellerOsOfficialOrdersReadV1,
} = require("./ebay-official-orders-read-v1.ts")
const {
  buildSellerOsSalesOrderEventsReadV1,
} = require("./ebay-sales-order-events-read-v1.ts")
const {
  buildSellerOsRecentSalesFeedV1,
} = require("./ebay-sales-order-read-model-v1.ts")
const {
  buildSellerOsSaleAlertsReadV1,
} = require("./ebay-sale-alerts-read-v1.ts")
const {
  buildSellerOsWhatsappSaleAlertStatusV1,
} = require("./ebay-whatsapp-sale-alert-v1.ts")
const {
  buildSellerOsBuyerThankYouStatusV1,
} = require("./ebay-post-purchase-buyer-message-v1.ts")
const {
  buildSellerOsPostPurchaseAutomationGateV1,
} = require("./ebay-post-purchase-automation-gate-v1.ts")
const {
  buildSellerOsLunaSupplierLinkageStatusV1,
} = require("./ebay-luna-supplier-linkage-certification-v1.ts")
const {
  buildSellerOsEbayTradingRateLimitStatusV1,
} = require("./ebay-trading-rate-limit-observability-v1.ts")
const {
  SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1,
  SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1,
} = require("./ebay-seller-os-cloud-read-relay-v1.ts")

after(() => {
  if (previousTypeScriptLoader) {
    require.extensions[".ts"] = previousTypeScriptLoader
  } else {
    delete require.extensions[".ts"]
  }
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const MCP_URL = "http://127.0.0.1/api/seller-os/assistant/mcp"
const STREAMABLE_ACCEPT = "application/json, text/event-stream"

function request(body, options = {}) {
  const headers = new Headers(options.headers)
  if (options.method === undefined || options.method === "POST") {
    if (!headers.has("accept")) headers.set("accept", STREAMABLE_ACCEPT)
    if (!headers.has("content-type")) headers.set("content-type", "application/json")
  }
  return new Request(MCP_URL, {
    method: options.method ?? "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function initializeRequest(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "seller-os-transport-regression", version: "1.0.0" },
    },
  }
}

test("stateless initialize and initialized notification complete without a session", async () => {
  const initialized = await handleSellerOsMcpRequestV1(request(initializeRequest()))
  assert.equal(initialized.status, 200)
  assert.match(initialized.headers.get("content-type") ?? "", /^application\/json/)
  assert.equal(initialized.headers.get("mcp-session-id"), null)
  assert.equal(initialized.headers.get("x-seller-os-assistant-mode"), "READ_ONLY")
  const result = await initialized.json()
  assert.equal(result.result.protocolVersion, "2025-06-18")
  assert.equal(result.result.serverInfo.name, "seller-os-private-readonly")
  assert.equal(result.result.serverInfo.version, SELLER_OS_MCP_ENDPOINT_VERSION)
  assert.deepEqual(Object.keys(result.result.capabilities), ["tools"])

  const notification = await handleSellerOsMcpRequestV1(request({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  assert.equal(notification.status, 202)
  assert.equal(notification.headers.get("mcp-session-id"), null)
  assert.equal(await notification.text(), "")
})

test("SDK client completes lifecycle, lists every tool, and invokes read-only search", async () => {
  const observed = []
  const localFetch = async (input, init) => {
    const outbound = new Request(input, init)
    let rpc = null
    if (outbound.method === "POST") {
      rpc = await outbound.clone().json()
    }
    observed.push({
      method: outbound.method,
      accept: outbound.headers.get("accept"),
      contentType: outbound.headers.get("content-type"),
      sessionId: outbound.headers.get("mcp-session-id"),
      protocolVersion: outbound.headers.get("mcp-protocol-version"),
      rpcMethod: rpc?.method ?? null,
    })
    return handleSellerOsMcpRequestV1(outbound)
  }
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: localFetch,
  })
  const client = new Client({ name: "seller-os-sdk-regression", version: "1.0.0" })
  try {
    await client.connect(transport)
    const listed = await client.listTools()
    assert.equal(listed.tools.length, SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1)
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_commercial_context"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_system_review_bundle"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_runtime_health"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_dev_status"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_ci_status"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_data_status"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_official_orders"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_sales_order_events"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_recent_sales_feed"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_sale_alerts"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_whatsapp_sale_alert_status"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_buyer_thank_you_status"))
    assert.ok(listed.tools.some((tool) =>
      tool.name === "seller_os_get_demand_first_broad_net_replay"))
    for (const tool of listed.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name)
      assert.equal(tool.annotations?.destructiveHint, false, tool.name)
      assert.equal(tool.annotations?.openWorldHint, false, tool.name)
    }

    const searched = await client.callTool({
      name: "search",
      arguments: { query: "commercial", limit: 5 },
    })
    assert.equal(searched.isError, undefined)
    assert.ok(searched.structuredContent.results.some((entry) =>
      entry.id === "seller-os://commercial-context"))
  } finally {
    await client.close()
  }

  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(observed.some((entry) => entry.rpcMethod === "initialize"))
  assert.ok(observed.some((entry) =>
    entry.rpcMethod === "notifications/initialized"))
  assert.ok(observed.some((entry) => entry.rpcMethod === "tools/list"))
  assert.ok(observed.some((entry) => entry.rpcMethod === "tools/call"))
  assert.ok(observed.some((entry) => entry.method === "GET" &&
    entry.accept === "text/event-stream"))
  assert.equal(observed.every((entry) => entry.sessionId === null), true)
})

test("manual broad-net replay tool invokes exactly one bounded read-only collector", async () => {
  let collectorCalls = 0
  const expected = { contractVersion:
    "SELLER_OS_DEMAND_FIRST_BROAD_NET_SERVER_REPLAY_V1", status: "PASS",
    replayCohortId: "latest-processed-20-tasks:100-signals",
    signalsTotal: 100, marketplaceWrites: 0,
    safety: { readOnly: true, credentialsIncluded: false,
      environmentValuesIncluded: false, familyPersistenceWrites: 0,
      observationPersistenceWrites: 0, enrollmentWrites: 0,
      shippingRuns: 0, externalAlerts: 0, marketplaceWrites: 0,
      nightlyPolicyEnabled: false } }
  const server = createSellerOsMcpServerV1({
    demandFirstBroadNetReplayCollector: async () => {
      collectorCalls += 1
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({ jsonrpc: "2.0", id: 6,
    method: "tools/call", params: {
      name: "seller_os_get_demand_first_broad_net_replay", arguments: {},
    } }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.result.isError, undefined)
  assert.deepEqual(body.result.structuredContent.result, expected)
  assert.equal(collectorCalls, 1)
})

test("W0 reuse map and policy are allowlisted through existing search and fetch tools", async () => {
  const searchResponse = await handleSellerOsMcpRequestV1(request({
    jsonrpc: "2.0",
    id: 40,
    method: "tools/call",
    params: { name: "search", arguments: { query: "cross-phase", limit: 5 } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  assert.equal(searchResponse.status, 200)
  const searched = (await searchResponse.json()).result.structuredContent.results
  assert.deepEqual(searched.map((entry) => entry.id).sort(), [
    "seller-os://cross-phase/reuse-map",
    "seller-os://cross-phase/reuse-policy",
  ])

  for (const [id, version] of [
    ["seller-os://cross-phase/reuse-map", "SELLER_OS_CROSS_PHASE_REUSE_MAP_V1"],
    ["seller-os://cross-phase/reuse-policy", "SELLER_OS_CROSS_PHASE_REUSE_POLICY_V1"],
  ]) {
    const response = await handleSellerOsMcpRequestV1(request({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: { name: "fetch", arguments: { id } },
    }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
    assert.equal(response.status, 200)
    const document = (await response.json()).result.structuredContent
    assert.equal(document.id, id)
    assert.equal(document.url, id)
    assert.equal(document.metadata.source,
      "SELLER_OS_CROSS_PHASE_SHARED_FOUNDATION")
    assert.equal(document.metadata.bounded, true)
    assert.equal(document.metadata.marketplaceWrites, 0)
    assert.equal(JSON.parse(document.text).contractVersion, version)
    assert.doesNotMatch(document.text,
      /"accessToken"\s*:|"refreshToken"\s*:|"clientSecret"\s*:|Bearer\s+[A-Za-z0-9]|buyerEmail/i)
  }
})

test("fetch keeps non-allowlisted W0 resource paths fail-closed", async () => {
  const response = await handleSellerOsMcpRequestV1(request({
    jsonrpc: "2.0",
    id: 42,
    method: "tools/call",
    params: { name: "fetch", arguments: {
      id: "seller-os://cross-phase/../../environment",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.result.isError, true)
})

test("I07 gate is an allowlisted bounded resource and does not grow the tool catalog", async () => {
  const officialOrders = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-21T12:00:00.000Z",
      windowStart: "2026-07-22T12:00:00.000Z",
      windowEnd: "2026-08-21T12:00:00.000Z",
      orders: [{ ebayOrderId: "09-15056-51468",
        creationDate: "2026-08-20T12:00:00.000Z",
        lastModifiedDate: "2026-08-20T13:00:00.000Z",
        orderPaymentStatus: "PAID", orderFulfillmentStatus: "FULFILLED",
        marketplaceId: "EBAY_US",
        lineItems: [{ lineItemId: "10083232519109",
          listingId: "366584348898", sku: "IMN-LST-000010", quantity: 1 }] }],
      pagesRead: 1, rawOrdersDiscardedAfterSanitization: 0, gapCodes: [],
    },
    analytics: null,
  })
  const salesOrderEvents = buildSellerOsSalesOrderEventsReadV1(officialOrders)
  const recentSalesFeed = buildSellerOsRecentSalesFeedV1(salesOrderEvents)
  const saleAlerts = buildSellerOsSaleAlertsReadV1(recentSalesFeed)
  const whatsapp = buildSellerOsWhatsappSaleAlertStatusV1({ saleAlerts,
    provider: { observedAt: "2026-08-21T12:00:00.000Z",
      provider: "META_CLOUD_API", configurationStatus: "READY",
      preflightStatus: "PASSED", deliveryAttemptAllowed: true,
      realDeliveryPermitted: true, configuredRecipientOnly: true,
      approvedTemplateOnly: true, environmentBoundary: "PREVIEW_ONLY",
      limitationCodes: [] },
    audit: { source: "ALERT_DELIVERY_OUTBOX", status: "AVAILABLE",
      observedAt: "2026-08-21T12:00:00.000Z", rows: [], truncated: false,
      limitationCodes: [] } })
  const buyerThankYou = buildSellerOsBuyerThankYouStatusV1({ saleAlerts,
    capability: { observedAt: "2026-08-21T12:00:00.000Z",
      provider: "EBAY_COMMERCE_MESSAGE_API", status: "READY",
      accountBindingStatus: "MATCHED", commerceMessageScopeConfirmed: true,
      refreshCapabilityConfirmed: true, fixedReadPreflightUsed: true,
      deliveryAttemptAllowed: true,
      automaticExecutionAuthority: "AUTO_EXECUTION_ALLOWED",
      limitationCodes: [] },
    audit: { source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER",
      status: "AVAILABLE", observedAt: "2026-08-21T12:00:00.000Z",
      rows: [], truncated: false, limitationCodes: [] } })
  const expected = buildSellerOsPostPurchaseAutomationGateV1({ officialOrders,
    salesOrderEvents, recentSalesFeed, saleAlerts, whatsapp, buyerThankYou })
  let collectorCalls = 0
  const call = async (body) => {
    const server = createSellerOsMcpServerV1({
      postPurchaseAutomationGateCollector: async () => {
        collectorCalls += 1
        return expected
      },
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(request(body,
      { headers: { "mcp-protocol-version": "2025-06-18" } }))
  }
  const searchResponse = await call({ jsonrpc: "2.0",
    id: 43, method: "tools/call", params: { name: "search",
      arguments: { query: "post-purchase automation", limit: 5 } } })
  const searched = (await searchResponse.json()).result.structuredContent.results
  assert.deepEqual(searched.map((entry) => entry.id), [
    "seller-os://phase-1/post-purchase-automation-gate",
  ])
  const response = await call({ jsonrpc: "2.0",
    id: 44, method: "tools/call", params: { name: "fetch", arguments: {
      id: "seller-os://phase-1/post-purchase-automation-gate",
    } } })
  const document = (await response.json()).result.structuredContent
  const result = JSON.parse(document.text)
  assert.equal(document.metadata.source, "SELLER_OS_PHASE_ONE_CERTIFICATION")
  assert.equal(document.metadata.bounded, true)
  assert.equal(result.contractVersion,
    "SELLER_OS_POST_PURCHASE_AUTOMATION_GATE_V1")
  assert.equal(result.status, "READY")
  assert.equal(result.safety.readOnlyCertificationSurface, true)
  assert.equal(result.safety.whatsappSendsByThisRead, 0)
  assert.equal(result.safety.buyerMessageSendsByThisRead, 0)
  assert.doesNotMatch(document.text,
    /"accessToken"\s*:|"refreshToken"\s*:|"clientSecret"\s*:|Bearer\s+[A-Za-z0-9]|buyerEmail/i)
  assert.equal(collectorCalls, 1)

  const listed = await call({ jsonrpc: "2.0", id: 45,
    method: "tools/list", params: {} })
  assert.equal((await listed.json()).result.tools.length,
    SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1)
})

test("P2-I01 linkage is an allowlisted bounded resource without growing the tool catalog", async () => {
  const expected = buildSellerOsLunaSupplierLinkageStatusV1({
    accountKey: "seller:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    accountAlias: "seller",
    accountBindingMatched: true,
    scope: { identityStatus: "CERTIFIED", scopeId: "current-live:test",
      observedAt: "2026-08-21T12:00:00.000Z",
      itemIds: ["366543596425"], historicalOrNonliveCount: 9 },
    listings: [{ itemId: "366543596425", sku: "IMN-LST-000003",
      title: "Lysol To Go Disinfecting Wipes 3 Pack",
      listingType: "PACK", observedAt: "2026-08-21T12:00:00.000Z",
      evidenceReferences: ["current-live:366543596425"] }],
    conflicts: [{ itemId: "366543596425",
      evidenceReferences: ["representation:a", "representation:b"],
      titleRepresentations: ["Representation A", "Representation B"],
      skuRepresentations: ["SKU-A", "SKU-B"],
      identityRepresentationConflict: true }],
    repositoryEvidence: { status: "AVAILABLE",
      observedAt: "2026-08-21T12:00:00.000Z",
      approvalEvidence: [], candidateEvidence: [], rowsRead: 0,
      truncated: false, limitationCodes: [] },
  })
  let collectorCalls = 0
  const call = async (body) => {
    const server = createSellerOsMcpServerV1({
      lunaSupplierLinkageStatusCollector: async () => {
        collectorCalls += 1
        return expected
      },
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(request(body,
      { headers: { "mcp-protocol-version": "2025-06-18" } }))
  }
  const searchResponse = await call({ jsonrpc: "2.0", id: 46,
    method: "tools/call", params: { name: "search", arguments: {
      query: "Luna supplier linkage", limit: 5,
    } } })
  const searched = (await searchResponse.json()).result.structuredContent.results
  assert.deepEqual(searched.map((entry) => entry.id), [
    "seller-os://phase-2/luna-supplier-linkage",
  ])

  const response = await call({ jsonrpc: "2.0", id: 47,
    method: "tools/call", params: { name: "fetch", arguments: {
      id: "seller-os://phase-2/luna-supplier-linkage",
    } } })
  const document = (await response.json()).result.structuredContent
  const result = JSON.parse(document.text)
  assert.equal(document.metadata.source, "SELLER_OS_PHASE_TWO_CERTIFICATION")
  assert.equal(document.metadata.bounded, true)
  assert.equal(document.metadata.marketplaceWrites, 0)
  assert.equal(result.contractVersion,
    "SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_V1")
  assert.equal(result.counts.currentLive, 1)
  assert.equal(result.counts.humanReview, 1)
  assert.equal(result.scope.historicalOrNonliveIncludedInDenominator, false)
  assert.equal(result.entries[0].stockCertification.automaticPauseAllowed, false)
  assert.equal(result.safety.readOnlySurface, true)
  assert.equal(result.safety.marketplaceWritesByThisRead, 0)
  assert.equal(result.safety.lunaMutationsByThisRead, 0)
  assert.doesNotMatch(document.text,
    /"buyerEmail"\s*:|"shippingAddress"\s*:|"accessToken"\s*:|"refreshToken"\s*:|"clientSecret"\s*:|"authorizationHeader"\s*:|Bearer\s+[A-Za-z0-9]|"cookie"\s*:|process\.env|"rawPayload"\s*:|https?:\/\//i)
  assert.equal(collectorCalls, 1)

  const listed = await call({ jsonrpc: "2.0", id: 48,
    method: "tools/list", params: {} })
  assert.equal((await listed.json()).result.tools.length,
    SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1)

  const rejected = await call({ jsonrpc: "2.0", id: 49,
    method: "tools/call", params: { name: "fetch", arguments: {
      id: "seller-os://phase-2/luna-supplier-linkage/../../environment",
    } } })
  assert.equal((await rejected.json()).result.isError, true)
})

test("Tunnel P2-I01 resource uses the canonical fixed cloud relay operation", async () => {
  const expected = buildSellerOsLunaSupplierLinkageStatusV1({
    accountKey: "seller:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    accountAlias: "seller", accountBindingMatched: true,
    scope: { identityStatus: "CERTIFIED", scopeId: "current-live:test",
      observedAt: "2026-08-21T12:00:00.000Z",
      itemIds: ["366584348898"], historicalOrNonliveCount: 0 },
    listings: [{ itemId: "366584348898", sku: "IMN-LST-000010",
      title: "Translator Z6 Black", listingType: "INDIVIDUAL",
      observedAt: "2026-08-21T12:00:00.000Z",
      evidenceReferences: ["current-live:366584348898"] }],
    repositoryEvidence: { status: "AVAILABLE",
      observedAt: "2026-08-21T12:00:00.000Z", approvalEvidence: [],
      candidateEvidence: [], rowsRead: 0, truncated: false,
      limitationCodes: [] },
  })
  const calls = []
  const server = createSellerOsMcpServerV1({
    applicationAuthMode: "TUNNEL_TRANSPORT_ONLY",
    toolExecutor: async (input) => {
      calls.push(input)
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0", id: 50, method: "tools/call",
    params: { name: "fetch", arguments: {
      id: "seller-os://phase-2/luna-supplier-linkage",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const document = (await response.json()).result.structuredContent
  assert.equal(JSON.parse(document.text).contractVersion,
    "SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_V1")
  assert.deepEqual(calls, [{
    toolName: SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1,
    arguments: {},
  }])
})

test("P2-I01A Trading quota is an allowlisted bounded resource without growing the tool catalog", async () => {
  const expected = buildSellerOsEbayTradingRateLimitStatusV1({
    observedAt: "2026-08-22T12:00:00.000Z",
    ebayAppIdentityMatch: true,
    payload: { rateLimits: [{ apiContext: "tradingapi",
      apiName: "tradingapi", apiVersion: "v1", resources: [{ name: "api",
        rates: [{ count: 5_000, limit: 5_000, remaining: 0,
          reset: "2026-08-23T00:00:00.000Z", timeWindow: 86_400 }] }] }] },
  })
  let collectorCalls = 0
  const call = async (body) => {
    const server = createSellerOsMcpServerV1({
      ebayTradingRateLimitStatusCollector: async () => {
        collectorCalls += 1
        return expected
      },
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true,
    })
    await server.connect(transport)
    return transport.handleRequest(request(body,
      { headers: { "mcp-protocol-version": "2025-06-18" } }))
  }
  const searchResponse = await call({ jsonrpc: "2.0", id: 51,
    method: "tools/call", params: { name: "search", arguments: {
      query: "Trading API rate-limit", limit: 5,
    } } })
  const searched = (await searchResponse.json()).result.structuredContent.results
  assert.deepEqual(searched.map((entry) => entry.id), [
    "seller-os://phase-2/ebay-trading-rate-limit",
  ])

  const response = await call({ jsonrpc: "2.0", id: 52,
    method: "tools/call", params: { name: "fetch", arguments: {
      id: "seller-os://phase-2/ebay-trading-rate-limit",
    } } })
  const document = (await response.json()).result.structuredContent
  const result = JSON.parse(document.text)
  assert.equal(document.metadata.source, "SELLER_OS_PHASE_TWO_CERTIFICATION")
  assert.equal(document.metadata.bounded, true)
  assert.equal(document.metadata.marketplaceWrites, 0)
  assert.equal(result.contractVersion,
    "SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_V1")
  assert.equal(result.gateState, "BLOCKED")
  assert.equal(result.ebay518BucketIdentity, "PROVEN")
  assert.equal(result.rates[0].resource, "api")
  assert.equal(result.rates[0].remaining, 0)
  assert.equal(result.safety.tradingLiveCallsByThisRead, 0)
  assert.equal(result.safety.ebayWritesByThisRead, 0)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.doesNotMatch(document.text,
    /"buyerEmail"\s*:|"shippingAddress"\s*:|"accessToken"\s*:|"refreshToken"\s*:|"clientSecret"\s*:|"authorizationHeader"\s*:|Bearer\s+[A-Za-z0-9]|"cookie"\s*:|process\.env|"rawPayload"\s*:/i)
  assert.equal(collectorCalls, 1)

  const listed = await call({ jsonrpc: "2.0", id: 53,
    method: "tools/list", params: {} })
  assert.equal((await listed.json()).result.tools.length,
    SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1)

  const rejected = await call({ jsonrpc: "2.0", id: 54,
    method: "tools/call", params: { name: "fetch", arguments: {
      id: "https://api.ebay.com/developer/analytics/v1_beta/rate_limit/",
    } } })
  assert.equal((await rejected.json()).result.isError, true)
})

test("Tunnel P2-I01A resource uses only the fixed Analytics relay operation", async () => {
  const expected = buildSellerOsEbayTradingRateLimitStatusV1({
    observedAt: "2026-08-22T12:00:00.000Z",
    ebayAppIdentityMatch: true,
    payload: { rateLimits: [{ apiContext: "tradingapi",
      apiName: "tradingapi", resources: [{ name: "api", rates: [{
        count: 5_000, limit: 5_000, remaining: 0,
        reset: "2026-08-23T00:00:00.000Z", timeWindow: 86_400,
      }] }] }] },
  })
  const calls = []
  const server = createSellerOsMcpServerV1({
    applicationAuthMode: "TUNNEL_TRANSPORT_ONLY",
    toolExecutor: async (input) => {
      calls.push(input)
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0", id: 55, method: "tools/call",
    params: { name: "fetch", arguments: {
      id: "seller-os://phase-2/ebay-trading-rate-limit",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const document = (await response.json()).result.structuredContent
  assert.equal(JSON.parse(document.text).gateState, "BLOCKED")
  assert.deepEqual(calls, [{
    toolName: SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1,
    arguments: {},
  }])
})

test("stateless GET and DELETE fail fast with protocol-correct method discovery", async () => {
  for (const method of ["GET", "DELETE"]) {
    const response = await handleSellerOsMcpRequestV1(request(undefined, {
      method,
      headers: method === "GET" ? { accept: "text/event-stream",
        "mcp-protocol-version": "2025-06-18" } : {
        "mcp-protocol-version": "2025-06-18",
      },
    }))
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.get("allow"), "POST", method)
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/)
    assert.deepEqual(await response.json(), {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    })
  }
})

test("stateless requests neither create nor adopt client-supplied sessions", async () => {
  const response = await handleSellerOsMcpRequestV1(request({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/list",
    params: {},
  }, { headers: {
    "mcp-protocol-version": "2025-06-18",
    "mcp-session-id": "unknown-client-session",
  } }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("mcp-session-id"), null)
  const body = await response.json()
  assert.equal(body.id, 7)
  assert.equal(body.result.tools.length, SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1)
})

test("runtime health tool registration returns its versioned bounded contract", async () => {
  const expected = createUnavailableSellerOsRuntimeHealthV1(
    "2026-08-20T03:54:41.000Z",
  )
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    runtimeHealthCollector: async () => {
      collectorCalls += 1
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: { name: "seller_os_get_runtime_health", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  assert.equal(response.status, 200)
  const body = await response.json()
  const actual = body.result.structuredContent.result
  const { runtimeCatalog: _actualCatalog, ...actualBase } = actual
  const { runtimeCatalog: _expectedCatalog, ...expectedBase } = expected
  assert.equal(body.result.isError, undefined)
  assert.deepEqual(actualBase, expectedBase)
  assert.equal(actual.contractVersion,
    "SELLER_OS_RUNTIME_HEALTH_V1")
  assert.equal(actual.runtimeCatalog.contractVersion,
    "SELLER_OS_RUNTIME_CATALOG_ATTESTATION_V1")
  assert.equal(actual.runtimeCatalog.runtimeCatalogCount,
    SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1)
  assert.equal(actual.runtimeCatalog.expectedCatalogCount,
    SELLER_OS_MCP_EXPECTED_CATALOG_COUNT_V1)
  assert.equal(actual.runtimeCatalog.officialOrdersToolPresent, true)
  assert.equal(actual.runtimeCatalog.salesOrderEventsToolPresent, true)
  assert.equal(actual.runtimeCatalog.recentSalesFeedToolPresent, true)
  assert.equal(actual.runtimeCatalog.saleAlertsToolPresent, true)
  assert.equal(actual.runtimeCatalog.exactCatalogMatch, true)
  const workspaceMatchesCanonicalRuntime = resolve(process.cwd()) === resolve(
    SELLER_OS_CANONICAL_REPOSITORY_V1.directory,
  )
  assert.equal(actual.runtimeCatalog.runtimeWorkingDirectoryMatch,
    workspaceMatchesCanonicalRuntime)
  assert.equal(actual.runtimeCatalog.workspaceRuntimeBindingStatus,
    workspaceMatchesCanonicalRuntime ? "MATCHED" : "MISMATCHED")
  assert.equal(actual.runtimeCatalog.limitations.includes(
    "RUNTIME_WORKING_DIRECTORY_IDENTITY_MISMATCH"),
    !workspaceMatchesCanonicalRuntime)
  assert.equal(actual.runtimeCatalog.safety.fileContentsIncluded, false)
  assert.equal(actual.safety.readOnly, true)
  assert.equal(actual.safety.marketplaceWrites, 0)
  assert.equal(actual.safety.inventoryWrites, 0)
  assert.equal(actual.safety.productCaseMutations, 0)
  assert.equal(actual.safety.lunaLinkMutations, 0)
  assert.equal(actual.safety.whatsappSends, 0)
  assert.equal(collectorCalls, 1)
})

test("runtime health MCP schema rejects caller-controlled inspection scope", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    runtimeHealthCollector: async () => {
      collectorCalls += 1
      return createUnavailableSellerOsRuntimeHealthV1()
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: { name: "seller_os_get_runtime_health", arguments: {
      service: "attacker.service", port: 22, command: "restart",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("dev status tool registration returns its versioned bounded contract", async () => {
  const expected = createUnavailableSellerOsDevStatusV1(
    "2026-08-20T04:44:00.000Z",
  )
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    devStatusCollector: async () => {
      collectorCalls += 1
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: { name: "seller_os_get_dev_status", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.result.isError, undefined)
  assert.deepEqual(body.result.structuredContent.result, expected)
  assert.equal(body.result.structuredContent.result.contractVersion,
    "SELLER_OS_DEV_STATUS_V1")
  assert.equal(body.result.structuredContent.result.safety.readOnly, true)
  assert.equal(body.result.structuredContent.result.safety.arbitraryGitAllowed, false)
  assert.equal(body.result.structuredContent.result.safety.marketplaceWrites, 0)
  assert.equal(body.result.structuredContent.result.safety.inventoryWrites, 0)
  assert.equal(body.result.structuredContent.result.safety.productCaseMutations, 0)
  assert.equal(body.result.structuredContent.result.safety.lunaLinkMutations, 0)
  assert.equal(body.result.structuredContent.result.safety.whatsappSends, 0)
  assert.equal(collectorCalls, 1)
})

test("dev status MCP schema rejects caller-controlled Git scope", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    devStatusCollector: async () => {
      collectorCalls += 1
      return createUnavailableSellerOsDevStatusV1()
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: { name: "seller_os_get_dev_status", arguments: {
      repository: "/tmp/attacker", revision: "HEAD~1", command: "push",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("CI status tool registration returns its versioned bounded contract", async () => {
  const expected = createUnavailableSellerOsCiStatusV1(
    "2026-08-20T05:44:00.000Z",
  )
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    ciStatusCollector: async () => {
      collectorCalls += 1
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 12,
    method: "tools/call",
    params: { name: "seller_os_get_ci_status", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.result.isError, undefined)
  assert.deepEqual(body.result.structuredContent.result, expected)
  assert.equal(body.result.structuredContent.result.contractVersion,
    "SELLER_OS_CI_STATUS_V1")
  assert.equal(body.result.structuredContent.result.safety.readOnly, true)
  assert.equal(body.result.structuredContent.result.safety.marketplaceWrites, 0)
  assert.equal(body.result.structuredContent.result.safety.inventoryWrites, 0)
  assert.equal(body.result.structuredContent.result.safety.productCaseMutations, 0)
  assert.equal(body.result.structuredContent.result.safety.lunaLinkMutations, 0)
  assert.equal(body.result.structuredContent.result.safety.whatsappSends, 0)
  assert.equal(collectorCalls, 1)
})

test("CI status MCP schema rejects caller-controlled command scope", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    ciStatusCollector: async () => {
      collectorCalls += 1
      return createUnavailableSellerOsCiStatusV1()
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 13,
    method: "tools/call",
    params: { name: "seller_os_get_ci_status", arguments: {
      command: "npm test", workingDirectory: "/tmp", testPattern: "*",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("data status tool registration returns its versioned bounded contract", async () => {
  const expected = createUnavailableSellerOsDataStatusV1(
    "2026-08-20T13:00:00.000Z",
  )
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    dataStatusCollector: async () => {
      collectorCalls += 1
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 14,
    method: "tools/call",
    params: { name: "seller_os_get_data_status", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.result.isError, undefined)
  assert.deepEqual(body.result.structuredContent.result, expected)
  assert.equal(body.result.structuredContent.result.contractVersion,
    "SELLER_OS_DATA_STATUS_V1")
  assert.equal(body.result.structuredContent.result.safety.readOnly, true)
  assert.equal(body.result.structuredContent.result.safety.databaseWritesAllowed, false)
  assert.equal(body.result.structuredContent.result.safety.marketplaceWrites, 0)
  assert.equal(body.result.structuredContent.result.safety.inventoryWrites, 0)
  assert.equal(body.result.structuredContent.result.safety.productCaseMutations, 0)
  assert.equal(body.result.structuredContent.result.safety.lunaLinkMutations, 0)
  assert.equal(body.result.structuredContent.result.safety.whatsappSends, 0)
  assert.equal(collectorCalls, 1)
})

test("data status MCP schema rejects caller-controlled data and migration scope", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    dataStatusCollector: async () => {
      collectorCalls += 1
      return createUnavailableSellerOsDataStatusV1()
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 15,
    method: "tools/call",
    params: { name: "seller_os_get_data_status", arguments: {
      sql: "select secret", table: "auth.users", schema: "vault",
      repository: "/tmp/attacker", migration: "apply",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("official Orders tool registration returns bounded PII-free official evidence", async () => {
  const expected = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-20T18:00:00.000Z",
      windowStart: "2026-07-21T18:00:00.000Z",
      windowEnd: "2026-08-20T18:00:00.000Z",
      orders: [{
        ebayOrderId: "15-12345-12345",
        creationDate: "2026-08-19T12:00:00.000Z",
        lastModifiedDate: "2026-08-19T13:00:00.000Z",
        orderPaymentStatus: "PAID",
        orderFulfillmentStatus: "NOT_STARTED",
        marketplaceId: "EBAY_US",
        lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
          sku: "CUSTOM-LABEL", quantity: 2 }],
      }],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    officialOrdersCollector: async () => {
      collectorCalls += 1
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 16,
    method: "tools/call",
    params: { name: "seller_os_get_official_orders", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  const result = body.result.structuredContent.result
  assert.equal(response.status, 200)
  assert.equal(body.result.isError, undefined)
  assert.deepEqual(result, expected)
  assert.equal(result.contractVersion, "SELLER_OS_OFFICIAL_ORDERS_READ_V1")
  assert.equal(result.source, "EBAY_SELL_FULFILLMENT_GET_ORDERS")
  assert.equal(result.safety.readOnly, true)
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.rawUpstreamPayloadIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.databaseWrites, 0)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.inventoryWrites, 0)
  assert.equal(result.safety.productCaseMutations, 0)
  assert.equal(result.safety.lunaLinkMutations, 0)
  assert.equal(result.safety.whatsappSends, 0)
  assert.equal(collectorCalls, 1)
})

test("Sales Order Events tool projects the same official collector read without writes", async () => {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-20T18:00:00.000Z",
      windowStart: "2026-07-21T18:00:00.000Z",
      windowEnd: "2026-08-20T18:00:00.000Z",
      orders: [{
        ebayOrderId: "15-12345-12345",
        creationDate: "2026-08-19T12:00:00.000Z",
        lastModifiedDate: "2026-08-19T13:00:00.000Z",
        orderPaymentStatus: "PAID",
        orderFulfillmentStatus: "NOT_STARTED",
        marketplaceId: "EBAY_US",
        lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
          sku: "CUSTOM-LABEL", quantity: 3 }],
      }],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  let officialCollectorCalls = 0
  const server = createSellerOsMcpServerV1({
    officialOrdersCollector: async () => {
      officialCollectorCalls += 1
      return official
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 19,
    method: "tools/call",
    params: { name: "seller_os_get_sales_order_events", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  const result = body.result.structuredContent.result
  assert.equal(body.result.isError, undefined)
  assert.deepEqual(result, buildSellerOsSalesOrderEventsReadV1(official))
  assert.equal(result.contractVersion, "SELLER_OS_SALES_ORDER_EVENTS_READ_V1")
  assert.equal(result.eventCount, 1)
  assert.equal(result.events[0].quantity, 3)
  assert.equal(result.events[0].buyerPiiIncluded, false)
  assert.equal(result.persistenceStatus, "NOT_PERSISTED_BY_THIS_READ")
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.databaseWrites, 0)
  assert.equal(result.safety.buyerMessageSends, 0)
  assert.equal(officialCollectorCalls, 1)
})

test("Sales Order Events schema rejects caller account, URL, token, SQL and limit", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    salesOrderEventsCollector: async () => {
      collectorCalls += 1
      throw new Error("SHOULD_NOT_BE_CALLED")
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name: "seller_os_get_sales_order_events", arguments: {
      accountId: "attacker", url: "https://example.test", token: "secret",
      sql: "select *", limit: 100000,
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("Recent Sales Feed tool projects the same Sales Order Events with exact linkage", async () => {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-20T18:00:00.000Z",
      windowStart: "2026-07-21T18:00:00.000Z",
      windowEnd: "2026-08-20T18:00:00.000Z",
      orders: [{
        ebayOrderId: "15-12345-12345",
        creationDate: "2026-08-19T12:00:00.000Z",
        lastModifiedDate: "2026-08-19T13:00:00.000Z",
        orderPaymentStatus: "PAID",
        orderFulfillmentStatus: "NOT_STARTED",
        marketplaceId: "EBAY_US",
        lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
          sku: "CUSTOM-LABEL", quantity: 3 }],
      }],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  const events = buildSellerOsSalesOrderEventsReadV1(official)
  let eventCollectorCalls = 0
  const server = createSellerOsMcpServerV1({
    salesOrderEventsCollector: async () => {
      eventCollectorCalls += 1
      return events
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 22,
    method: "tools/call",
    params: { name: "seller_os_get_recent_sales_feed", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  const result = body.result.structuredContent.result

  assert.equal(body.result.isError, undefined)
  assert.deepEqual(result, buildSellerOsRecentSalesFeedV1(events))
  assert.equal(result.contractVersion, "SELLER_OS_RECENT_SALES_FEED_V1")
  assert.equal(result.feedCount, 1)
  assert.equal(result.entries[0].quantity, 3)
  assert.equal(result.entries[0].eventLinkage.eventId,
    events.events[0].eventId)
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.databaseWrites, 0)
  assert.equal(eventCollectorCalls, 1)
})

test("Recent Sales Feed schema rejects caller account, URL, token, SQL and limit", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    recentSalesFeedCollector: async () => {
      collectorCalls += 1
      throw new Error("SHOULD_NOT_BE_CALLED")
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 23,
    method: "tools/call",
    params: { name: "seller_os_get_recent_sales_feed", arguments: {
      accountId: "attacker", url: "https://example.test", token: "secret",
      sql: "select *", limit: 100000,
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("Dashboard Sale Alerts tool projects the canonical feed with exact event linkage", async () => {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-22T18:00:00.000Z",
      windowStart: "2026-07-23T18:00:00.000Z",
      windowEnd: "2026-08-22T18:00:00.000Z",
      orders: [{
        ebayOrderId: "15-12345-12345",
        creationDate: "2026-08-21T04:00:00.000Z",
        lastModifiedDate: "2026-08-21T05:00:00.000Z",
        orderPaymentStatus: "PAID",
        orderFulfillmentStatus: "NOT_STARTED",
        marketplaceId: "EBAY_US",
        lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
          sku: "CUSTOM-LABEL", quantity: 3 }],
      }],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  const feed = buildSellerOsRecentSalesFeedV1(
    buildSellerOsSalesOrderEventsReadV1(official),
  )
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    recentSalesFeedCollector: async () => {
      collectorCalls += 1
      return feed
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 25,
    method: "tools/call",
    params: { name: "seller_os_get_sale_alerts", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  const result = body.result.structuredContent.result

  assert.equal(body.result.isError, undefined)
  assert.deepEqual(result, buildSellerOsSaleAlertsReadV1(feed))
  assert.equal(result.contractVersion, "SELLER_OS_SALE_ALERTS_READ_V1")
  assert.equal(result.alertCount, 1)
  assert.equal(result.alerts[0].eventId, feed.entries[0].eventId)
  assert.equal(result.alerts[0].quantity, 3)
  assert.equal(result.alerts[0].workflowStep.state, "SUCCEEDED")
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.databaseWrites, 0)
  assert.equal(result.safety.whatsappSends, 0)
  assert.equal(result.safety.buyerMessageSends, 0)
  assert.equal(collectorCalls, 1)
})

test("Dashboard Sale Alerts schema rejects caller account, URL, token, SQL and limit", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    saleAlertsCollector: async () => {
      collectorCalls += 1
      throw new Error("SHOULD_NOT_BE_CALLED")
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 26,
    method: "tools/call",
    params: { name: "seller_os_get_sale_alerts", arguments: {
      accountId: "attacker", url: "https://example.test", token: "secret",
      sql: "select *", limit: 100000,
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("WhatsApp sale-alert status is bounded, read-only and never sends", async () => {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-22T18:00:00.000Z",
      windowStart: "2026-07-23T18:00:00.000Z",
      windowEnd: "2026-08-22T18:00:00.000Z",
      orders: [{
        ebayOrderId: "15-12345-12345",
        creationDate: "2026-08-20T04:00:00.000Z",
        lastModifiedDate: "2026-08-20T05:00:00.000Z",
        orderPaymentStatus: "PAID",
        orderFulfillmentStatus: "FULFILLED",
        marketplaceId: "EBAY_US",
        lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
          sku: "CUSTOM-LABEL", quantity: 1 }],
      }],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  const saleAlerts = buildSellerOsSaleAlertsReadV1(
    buildSellerOsRecentSalesFeedV1(
      buildSellerOsSalesOrderEventsReadV1(official),
    ),
  )
  const expected = buildSellerOsWhatsappSaleAlertStatusV1({
    saleAlerts,
    provider: {
      observedAt: "2026-08-22T18:00:00.000Z",
      provider: "META_CLOUD_API",
      configurationStatus: "READY",
      preflightStatus: "PASSED",
      deliveryAttemptAllowed: true,
      realDeliveryPermitted: true,
      configuredRecipientOnly: true,
      approvedTemplateOnly: true,
      environmentBoundary: "PREVIEW_ONLY",
      limitationCodes: [],
    },
    audit: {
      source: "ALERT_DELIVERY_OUTBOX",
      status: "AVAILABLE",
      observedAt: "2026-08-22T18:00:00.000Z",
      rows: [],
      truncated: false,
      limitationCodes: [],
    },
  })
  let calls = 0
  const server = createSellerOsMcpServerV1({
    whatsappSaleAlertStatusCollector: async () => {
      calls += 1
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 27,
    method: "tools/call",
    params: { name: "seller_os_get_whatsapp_sale_alert_status",
      arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  const result = body.result.structuredContent.result

  assert.equal(body.result.isError, undefined)
  assert.deepEqual(result, expected)
  assert.equal(result.contractVersion,
    "SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_V1")
  assert.equal(result.entries[0].workflowStep.state, "SKIPPED")
  assert.equal(result.deliveryOutcomes.historicalSendCount, 0)
  assert.equal(result.safety.whatsappSendsByThisRead, 0)
  assert.equal(result.safety.buyerMessageSends, 0)
  assert.equal(result.safety.phoneNumberIncluded, false)
  assert.equal(calls, 1)
})

test("WhatsApp status schema rejects caller phone, account, URL, token and SQL", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    whatsappSaleAlertStatusCollector: async () => {
      collectorCalls += 1
      throw new Error("SHOULD_NOT_BE_CALLED")
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 28,
    method: "tools/call",
    params: { name: "seller_os_get_whatsapp_sale_alert_status", arguments: {
      phone: "15555550100", accountId: "attacker",
      url: "https://example.test", token: "secret", sql: "select *",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("buyer thank-you status is a bounded read-only MCP surface and never sends", async () => {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-22T18:00:00.000Z",
      windowStart: "2026-07-23T18:00:00.000Z",
      windowEnd: "2026-08-22T18:00:00.000Z",
      orders: [{
        ebayOrderId: "15-12345-12345",
        creationDate: "2026-08-20T18:00:00.000Z",
        lastModifiedDate: "2026-08-20T18:01:00.000Z",
        orderPaymentStatus: "PAID",
        orderFulfillmentStatus: "FULFILLED",
        marketplaceId: "EBAY_US",
        lineItems: [{ lineItemId: "LINE-1", listingId: "366575102453",
          sku: "SKU", quantity: 1 }],
      }],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  const alerts = buildSellerOsSaleAlertsReadV1(
    buildSellerOsRecentSalesFeedV1(
      buildSellerOsSalesOrderEventsReadV1(official),
    ),
  )
  const expected = buildSellerOsBuyerThankYouStatusV1({
    saleAlerts: alerts,
    capability: {
      observedAt: "2026-08-22T18:00:00.000Z",
      provider: "EBAY_COMMERCE_MESSAGE_API",
      status: "READY",
      accountBindingStatus: "MATCHED",
      commerceMessageScopeConfirmed: true,
      refreshCapabilityConfirmed: true,
      fixedReadPreflightUsed: true,
      deliveryAttemptAllowed: true,
      automaticExecutionAuthority: "AUTO_EXECUTION_ALLOWED",
      limitationCodes: [],
    },
    audit: {
      source: "COMMERCIAL_ALERT_EVENTS_BUYER_MESSAGE_LEDGER",
      status: "AVAILABLE",
      observedAt: "2026-08-22T18:00:00.000Z",
      rows: [],
      truncated: false,
      limitationCodes: [],
    },
  })
  let calls = 0
  const server = createSellerOsMcpServerV1({
    buyerThankYouStatusCollector: async () => {
      calls += 1
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0", id: 29, method: "tools/call",
    params: { name: "seller_os_get_buyer_thank_you_status", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  const result = body.result.structuredContent.result
  assert.equal(result.contractVersion,
    "SELLER_OS_BUYER_THANK_YOU_STATUS_V1")
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0].detectionClass, "HISTORICAL_REPLAY")
  assert.equal(result.entries[0].workflowStep.state, "SKIPPED")
  assert.equal(result.buyerMessageSendCount, 0)
  assert.equal(result.safety.buyerMessageSendsByThisRead, 0)
  assert.equal(result.safety.buyerIdentityIncluded, false)
  assert.equal(calls, 1)
})

test("buyer thank-you status rejects recipient, account, URL, token, text and SQL", async () => {
  let calls = 0
  const server = createSellerOsMcpServerV1({
    buyerThankYouStatusCollector: async () => {
      calls += 1
      throw new Error("SHOULD_NOT_BE_CALLED")
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0", id: 30, method: "tools/call",
    params: { name: "seller_os_get_buyer_thank_you_status", arguments: {
      recipient: "private-buyer", accountId: "attacker",
      url: "https://example.test", token: "secret",
      messageText: "caller text", sql: "select *",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(body.result.isError, true)
  assert.equal(calls, 0)
})

test("Tunnel runtime resolves official Orders through the canonical cloud relay", async () => {
  const expected = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-20T18:00:00.000Z",
      windowStart: "2026-07-21T18:00:00.000Z",
      windowEnd: "2026-08-20T18:00:00.000Z",
      orders: [],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  const calls = []
  const server = createSellerOsMcpServerV1({
    applicationAuthMode: "TUNNEL_TRANSPORT_ONLY",
    toolExecutor: async (input) => {
      calls.push(input)
      return expected
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 18,
    method: "tools/call",
    params: { name: "seller_os_get_official_orders", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const result = (await response.json()).result.structuredContent.result
  assert.deepEqual(calls, [{ toolName: "seller_os_get_official_orders",
    arguments: {} }])
  assert.deepEqual(result, expected)
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.officialOrderCount, 0)
})

test("Tunnel Sales Order Events reuses the canonical official Orders relay", async () => {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-20T18:00:00.000Z",
      windowStart: "2026-07-21T18:00:00.000Z",
      windowEnd: "2026-08-20T18:00:00.000Z",
      orders: [],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  const calls = []
  const server = createSellerOsMcpServerV1({
    applicationAuthMode: "TUNNEL_TRANSPORT_ONLY",
    toolExecutor: async (input) => {
      calls.push(input)
      return official
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 21,
    method: "tools/call",
    params: { name: "seller_os_get_sales_order_events", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const result = (await response.json()).result.structuredContent.result
  assert.deepEqual(calls, [{ toolName: "seller_os_get_official_orders",
    arguments: {} }])
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.eventCount, 0)
})

test("Tunnel Recent Sales Feed reuses official Orders through the canonical relay", async () => {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-20T18:00:00.000Z",
      windowStart: "2026-07-21T18:00:00.000Z",
      windowEnd: "2026-08-20T18:00:00.000Z",
      orders: [],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  const calls = []
  const server = createSellerOsMcpServerV1({
    applicationAuthMode: "TUNNEL_TRANSPORT_ONLY",
    toolExecutor: async (input) => {
      calls.push(input)
      return official
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 24,
    method: "tools/call",
    params: { name: "seller_os_get_recent_sales_feed", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const result = (await response.json()).result.structuredContent.result
  assert.deepEqual(calls, [{ toolName: "seller_os_get_official_orders",
    arguments: {} }])
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.feedCount, 0)
  assert.equal(result.authority.analyticsUsedAsSaleRowEvidence, false)
})

test("Tunnel Dashboard Sale Alerts reuses official Orders through the canonical relay", async () => {
  const official = buildSellerOsOfficialOrdersReadV1({
    orders: {
      status: "CERTIFIED",
      observedAt: "2026-08-22T18:00:00.000Z",
      windowStart: "2026-07-23T18:00:00.000Z",
      windowEnd: "2026-08-22T18:00:00.000Z",
      orders: [],
      pagesRead: 1,
      rawOrdersDiscardedAfterSanitization: 0,
      gapCodes: [],
    },
    analytics: null,
  })
  const calls = []
  const server = createSellerOsMcpServerV1({
    applicationAuthMode: "TUNNEL_TRANSPORT_ONLY",
    toolExecutor: async (input) => {
      calls.push(input)
      return official
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 27,
    method: "tools/call",
    params: { name: "seller_os_get_sale_alerts", arguments: {} },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const result = (await response.json()).result.structuredContent.result
  assert.deepEqual(calls, [{ toolName: "seller_os_get_official_orders",
    arguments: {} }])
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.alertCount, 0)
  assert.equal(result.authority.analyticsUsedAsAlertEvidence, false)
})

test("official Orders MCP schema rejects caller-controlled read and write scope", async () => {
  let collectorCalls = 0
  const server = createSellerOsMcpServerV1({
    officialOrdersCollector: async () => {
      collectorCalls += 1
      throw new Error("SHOULD_NOT_BE_CALLED")
    },
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  const response = await transport.handleRequest(request({
    jsonrpc: "2.0",
    id: 17,
    method: "tools/call",
    params: { name: "seller_os_get_official_orders", arguments: {
      accountId: "attacker", url: "https://example.test", token: "secret",
      start: "2000-01-01", cursor: "unbounded", command: "acknowledge",
    } },
  }, { headers: { "mcp-protocol-version": "2025-06-18" } }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.result.isError, true)
  assert.equal(collectorCalls, 0)
})

test("POST Accept and Content-Type negotiation rejects malformed clients", async () => {
  const unacceptableGet = await handleSellerOsMcpRequestV1(request(undefined, {
    method: "GET",
  }))
  assert.equal(unacceptableGet.status, 406)
  assert.deepEqual(await unacceptableGet.json(), {
    jsonrpc: "2.0",
    error: { code: -32000,
      message: "Not Acceptable: Client must accept text/event-stream" },
    id: null,
  })

  const unacceptable = await handleSellerOsMcpRequestV1(request(
    initializeRequest(8),
    { headers: { accept: "application/json" } },
  ))
  assert.equal(unacceptable.status, 406)
  assert.equal((await unacceptable.json()).error.code, -32000)

  const unsupported = await handleSellerOsMcpRequestV1(request(
    initializeRequest(9),
    { headers: { accept: STREAMABLE_ACCEPT, "content-type": "text/plain" } },
  ))
  assert.equal(unsupported.status, 415)
  assert.equal((await unsupported.json()).error.code, -32000)
})

test("transport source remains stateless, JSON-response-only, and write-free", () => {
  const source = readFileSync(new URL("./ebay-seller-os-mcp-server-v1.ts",
    import.meta.url), "utf8")
  assert.match(source, /sessionIdGenerator: undefined/)
  assert.match(source, /enableJsonResponse: true/)
  assert.match(source, /if \(req\.method !== "POST"\)/)
  assert.doesNotMatch(source,
    /createOffer|publishOffer|inventory.*write|supplier.*write|sendWhatsApp|executeSql/i)
})
