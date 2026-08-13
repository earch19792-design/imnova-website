import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { SELLER_OS_ASSISTANT_TOOLS_V1 } from
  "./ebay-seller-os-assistant-gateway-v1.ts"
import {
  SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT,
  SELLER_OS_CLOUD_READ_RELAY_HEADERS,
  SELLER_OS_CLOUD_READ_RELAY_PATH,
  SELLER_OS_CLOUD_READ_RELAY_VERSION,
  createSellerOsCloudReadRelayExecutorV1,
  getSellerOsCloudReadRelayConfigurationV1,
  handleSellerOsCloudReadRelayRequestV1,
  signSellerOsCloudReadRelayRequestV1,
} from "./ebay-seller-os-cloud-read-relay-v1.ts"
import { evaluateSellerOsMcpToolSafetyV1 } from
  "./ebay-seller-os-mcp-tool-policy-v1.ts"

const mcpServerSource = readFileSync(new URL(
  "./ebay-seller-os-mcp-server-v1.ts", import.meta.url), "utf8")

const NOW = 1_786_579_200_000
const RELAY_URL = `https://seller-os-preview-abc.vercel.app${SELLER_OS_CLOUD_READ_RELAY_PATH}`
const RELAY_SECRET = "relay_authentication_secret_1234567890abcd"
const PROTECTION_BYPASS = "preview_transport_bypass_1234567890abcd"

function serverEnvironment(overrides = {}) {
  return { VERCEL_ENV: "preview",
    [SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.authenticationSecret]: RELAY_SECRET,
    ...overrides }
}

function clientEnvironment(overrides = {}) {
  return {
    [SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.endpointUrl]: RELAY_URL,
    [SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.authenticationSecret]: RELAY_SECRET,
    [SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.vercelProtectionBypass]:
      PROTECTION_BYPASS,
    ...overrides,
  }
}

function envelope(overrides = {}) {
  return { contractVersion: SELLER_OS_CLOUD_READ_RELAY_VERSION,
    requestId: "00000000-0000-4000-8000-000000000001",
    toolName: "seller_os_get_recent_system_changes", arguments: {},
    ...overrides }
}

function signedRequest(value, overrides = {}) {
  const body = JSON.stringify(value)
  const timestamp = String(overrides.timestamp ?? NOW)
  const nonce = overrides.nonce ?? "00000000-0000-4000-8000-000000000002"
  const signature = overrides.signature ?? signSellerOsCloudReadRelayRequestV1({
    timestamp, nonce, body, authenticationSecret: RELAY_SECRET,
  })
  return new Request(RELAY_URL, { method: "POST", headers: {
    "Content-Type": "application/json",
    [SELLER_OS_CLOUD_READ_RELAY_HEADERS.timestamp]: timestamp,
    [SELLER_OS_CLOUD_READ_RELAY_HEADERS.nonce]: nonce,
    [SELLER_OS_CLOUD_READ_RELAY_HEADERS.signature]: signature,
  }, body })
}

test("tunnel executor reaches the Preview relay without local Seller OS source secrets", async () => {
  const environment = clientEnvironment()
  for (const key of ["EBAY_SELLER_ACCOUNT_KEY",
    "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT",
    "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_SELLER_REFRESH_TOKEN",
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    assert.equal(environment[key], undefined)
  }
  const executor = createSellerOsCloudReadRelayExecutorV1({ environment,
    now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (url, init) => {
      assert.equal(url, RELAY_URL)
      assert.equal(init.headers[SELLER_OS_CLOUD_READ_RELAY_HEADERS.protectionBypass],
        PROTECTION_BYPASS)
      assert.equal("authorization" in init.headers, false)
      return handleSellerOsCloudReadRelayRequestV1(new Request(url, init), {
        environment: serverEnvironment(), now: () => NOW,
        monitorLoader: async () => ({}),
      })
    } })
  const result = await executor({
    toolName: "seller_os_get_recent_system_changes", arguments: {},
  })
  assert.equal(result.status, "UNPROVEN_NO_DURABLE_CHANGE_LEDGER")
  assert.equal(result.marketplaceWrites, 0)
  assert.match(mcpServerSource,
    /applicationAuthMode[\s\S]*TUNNEL_TRANSPORT_ONLY[\s\S]*createSellerOsCloudReadRelayExecutorV1/)
})

test("relay authentication is HMAC-bound and fails closed for missing, wrong, or stale proofs", async () => {
  let reads = 0
  const options = { environment: serverEnvironment(), now: () => NOW,
    monitorLoader: async () => { reads += 1; return {} } }
  const missing = await handleSellerOsCloudReadRelayRequestV1(new Request(
    RELAY_URL, { method: "POST", body: JSON.stringify(envelope()) }), options)
  assert.equal(missing.status, 401)
  const wrong = await handleSellerOsCloudReadRelayRequestV1(signedRequest(
    envelope(), { signature: "0".repeat(64) }), options)
  assert.equal(wrong.status, 401)
  const stale = await handleSellerOsCloudReadRelayRequestV1(signedRequest(
    envelope(), { timestamp: NOW - 60_001 }), options)
  assert.equal(stale.status, 401)
  assert.equal(reads, 0)
})

test("relay allowlists only canonical Assistant Gateway tools and bounded arguments", async () => {
  const options = { environment: serverEnvironment(), now: () => NOW,
    monitorLoader: async () => ({}) }
  const unknownTool = await handleSellerOsCloudReadRelayRequestV1(
    signedRequest(envelope({ toolName: "seller_os_write_listing" })), options)
  assert.equal(unknownTool.status, 400)
  const accountOverride = await handleSellerOsCloudReadRelayRequestV1(
    signedRequest(envelope({ arguments: { accountKey: "attacker-choice" } })), options)
  assert.equal(accountOverride.status, 400)
  const arbitraryUrl = await handleSellerOsCloudReadRelayRequestV1(
    signedRequest(envelope({ arguments: { url: "https://example.com" } })), options)
  assert.equal(arbitraryUrl.status, 400)
  assert.equal(SELLER_OS_ASSISTANT_TOOLS_V1.length, 13)
})

test("relay URL is exact Preview HTTPS and relay auth cannot reuse the protection bypass", () => {
  assert.equal(getSellerOsCloudReadRelayConfigurationV1(clientEnvironment()).ok,
    true)
  for (const endpointUrl of [
    "http://seller-os-preview-abc.vercel.app/api/seller-os/assistant/cloud-read-relay",
    "https://example.com/api/seller-os/assistant/cloud-read-relay",
    "https://seller-os-preview-abc.vercel.app/api/seller-os/assistant/cloud-read-relay?url=https://example.com",
    "https://seller-os-preview-abc.vercel.app/api/other",
  ]) {
    const state = getSellerOsCloudReadRelayConfigurationV1(
      clientEnvironment({
        [SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.endpointUrl]: endpointUrl,
      }))
    assert.equal(state.ok, false, endpointUrl)
    assert.ok(state.reasonCodes.includes(
      "RELAY_ENDPOINT_NOT_CANONICAL_PREVIEW_HTTPS"), endpointUrl)
  }
  const reused = getSellerOsCloudReadRelayConfigurationV1(clientEnvironment({
    [SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.vercelProtectionBypass]: RELAY_SECRET,
  }))
  assert.equal(reused.ok, false)
  assert.ok(reused.reasonCodes.includes(
    "RELAY_AUTH_MUST_BE_DISTINCT_FROM_PREVIEW_BYPASS"))
})

test("cloud relay is Preview-only and never executes in Production", async () => {
  let reads = 0
  const response = await handleSellerOsCloudReadRelayRequestV1(
    signedRequest(envelope()), {
      environment: serverEnvironment({ VERCEL_ENV: "production" }),
      now: () => NOW,
      monitorLoader: async () => { reads += 1; return {} },
    })
  assert.equal(response.status, 404)
  assert.equal(reads, 0)
})

test("cloud relay and complete MCP registry expose zero write-capable tools", () => {
  const safety = evaluateSellerOsMcpToolSafetyV1(SELLER_OS_ASSISTANT_TOOLS_V1)
  assert.equal(safety.registeredToolCount, 15)
  assert.equal(safety.assistantWriteTools, 0)
  assert.equal(safety.allToolsReadOnly, true)
  assert.deepEqual(safety.writeToolNames, [])
})
