import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
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
  SELLER_OS_MCP_ENDPOINT_VERSION,
  createSellerOsMcpServerV1,
  handleSellerOsMcpRequestV1,
} = require("./ebay-seller-os-mcp-server-v1.ts")
const {
  createUnavailableSellerOsRuntimeHealthV1,
} = require("./ebay-seller-os-runtime-health-v1.ts")
const {
  createUnavailableSellerOsDevStatusV1,
} = require("./ebay-seller-os-dev-status-v1.ts")
const {
  createUnavailableSellerOsCiStatusV1,
} = require("./ebay-seller-os-ci-status-v1.ts")

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
    assert.equal(listed.tools.length, 18)
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
  assert.equal(body.result.tools.length, 18)
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
  assert.equal(body.result.isError, undefined)
  assert.deepEqual(body.result.structuredContent.result, expected)
  assert.equal(body.result.structuredContent.result.contractVersion,
    "SELLER_OS_RUNTIME_HEALTH_V1")
  assert.equal(body.result.structuredContent.result.safety.readOnly, true)
  assert.equal(body.result.structuredContent.result.safety.marketplaceWrites, 0)
  assert.equal(body.result.structuredContent.result.safety.inventoryWrites, 0)
  assert.equal(body.result.structuredContent.result.safety.productCaseMutations, 0)
  assert.equal(body.result.structuredContent.result.safety.lunaLinkMutations, 0)
  assert.equal(body.result.structuredContent.result.safety.whatsappSends, 0)
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
