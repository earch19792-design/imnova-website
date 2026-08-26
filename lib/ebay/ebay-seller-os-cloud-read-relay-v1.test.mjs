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
  SELLER_OS_CURRENT_LIVE_FACTS_RELAY_FIELDS_V1,
  SELLER_OS_DEMAND_FIRST_BROAD_NET_REPLAY_OPERATION_V1,
  SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1,
  SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1,
  createSellerOsCloudReadRelayExecutorV1,
  getSellerOsCloudReadRelayConfigurationV1,
  handleSellerOsCloudReadRelayRequestV1,
  signSellerOsCloudReadRelayRequestV1,
} from "./ebay-seller-os-cloud-read-relay-v1.ts"
import { evaluateSellerOsMcpToolSafetyV1 } from
  "./ebay-seller-os-mcp-tool-policy-v1.ts"
import { buildSellerOsOfficialOrdersReadV1 } from
  "./ebay-official-orders-read-v1.ts"

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

test("bounded current-live facts survive MCP through the existing Cloud Read Relay", async () => {
  const facts = { itemId: "123456789012", sku: "SKU-EXACT",
    customLabel: "CUSTOM-EXACT", title: "Bounded listing", quantity: 0,
    price: 19.95, currency: "USD", liveStatus: "LIVE_ACTIVE",
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
    observedAt: "2026-08-12T00:00:00Z" }
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(), now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init.body))
      return Response.json({
        contractVersion: SELLER_OS_CLOUD_READ_RELAY_VERSION,
        requestId: request.requestId,
        result: { identity: { itemId: "123456789012" },
          currentLiveFacts: facts, backwardCompatibleMarker: "PRESERVED",
          safety: { readOnly: true, buyerPiiIncluded: false,
            rawPayloadIncluded: false, credentialsIncluded: false,
            environmentValuesIncluded: false, databaseWrites: 0,
            marketplaceWrites: 0, lunaMutations: 0 } },
      })
    },
  })
  const result = await executor({ toolName: "seller_os_get_listing_intelligence",
    arguments: { itemId: "123456789012" } })
  assert.deepEqual(result.currentLiveFacts, {
    itemId: "123456789012", sku: "SKU-EXACT", customLabel: "CUSTOM-EXACT",
    title: "Bounded listing", quantity: 0, price: 19.95, currency: "USD",
    liveStatus: "LIVE_ACTIVE", source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
    observedAt: "2026-08-12T00:00:00Z",
  })
  assert.deepEqual(Object.keys(result.currentLiveFacts),
    [...SELLER_OS_CURRENT_LIVE_FACTS_RELAY_FIELDS_V1])
  assert.equal(result.safety.databaseWrites, 0)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.rawPayloadIncluded, false)
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.environmentValuesIncluded, false)
  assert.equal(result.safety.lunaMutations, 0)
  assert.equal(result.backwardCompatibleMarker, "PRESERVED")
})

test("current-live relay projection strips unknown fields and preserves authoritative zero", async () => {
  const facts = { itemId: "123456789012", sku: "SKU-EXACT",
    customLabel: "CUSTOM-EXACT", title: "Bounded listing", quantity: 0,
    price: 19.95, currency: "USD", liveStatus: "LIVE_ACTIVE",
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
    observedAt: "2026-08-12T00:00:00Z", rawPayload: { forbidden: true },
    buyerEmail: "not-relayed@example.invalid", clientSecret: "not-relayed" }
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(), now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init.body))
      return Response.json({
        contractVersion: SELLER_OS_CLOUD_READ_RELAY_VERSION,
        requestId: request.requestId,
        result: { identity: { itemId: "123456789012" }, currentLiveFacts: facts,
          safety: { databaseWrites: 0, marketplaceWrites: 0, lunaMutations: 0 } },
      })
    },
  })
  const result = await executor({ toolName: "seller_os_get_listing_intelligence",
    arguments: { itemId: "123456789012" } })
  assert.deepEqual(Object.keys(result.currentLiveFacts),
    [...SELLER_OS_CURRENT_LIVE_FACTS_RELAY_FIELDS_V1])
  assert.equal(result.currentLiveFacts.quantity, 0)
  assert.equal(result.currentLiveFacts.price, 19.95)
  assert.equal(result.currentLiveFacts.currency, "USD")
  assert.equal(result.currentLiveFacts.source,
    "EBAY_TRADING_GET_MY_EBAY_SELLING")
  assert.equal(result.currentLiveFacts.observedAt, "2026-08-12T00:00:00Z")
  assert.doesNotMatch(JSON.stringify(result),
    /rawPayload|buyerEmail|clientSecret|not-relayed/i)
})

test("non-live facts fail closed while the existing null conflict remains compatible", async () => {
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(), now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init.body))
      return Response.json({
        contractVersion: SELLER_OS_CLOUD_READ_RELAY_VERSION,
        requestId: request.requestId,
        result: { status: "NOT_FOUND", reason: "NOT_CURRENT_LIVE",
          conflict: "CONFLICT", itemId: "123456789012", currentLiveFacts: null,
          safety: { readOnly: true, buyerPiiIncluded: false,
            rawPayloadIncluded: false, credentialsIncluded: false,
            environmentValuesIncluded: false, databaseWrites: 0,
            marketplaceWrites: 0, lunaMutations: 0 } },
      })
    },
  })
  const result = await executor({ toolName: "seller_os_get_listing_intelligence",
    arguments: { itemId: "123456789012" } })
  assert.equal(result.status, "NOT_FOUND")
  assert.equal(result.reason, "NOT_CURRENT_LIVE")
  assert.equal(result.currentLiveFacts, null)
  assert.equal(result.safety.databaseWrites, 0)
  assert.equal(result.safety.marketplaceWrites, 0)

  const nonLiveExecutor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(), now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (_url, init) => {
      const request = JSON.parse(String(init.body))
      return Response.json({
        contractVersion: SELLER_OS_CLOUD_READ_RELAY_VERSION,
        requestId: request.requestId,
        result: { identity: { itemId: "123456789012" }, currentLiveFacts: {
          itemId: "123456789012", sku: "SKU-EXACT",
          customLabel: "CUSTOM-EXACT", title: "Historical listing", quantity: 1,
          price: 19.95, currency: "USD", liveStatus: "ENDED",
          source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
          observedAt: "2026-08-12T00:00:00Z",
        } },
      })
    },
  })
  await assert.rejects(() => nonLiveExecutor({
    toolName: "seller_os_get_listing_intelligence",
    arguments: { itemId: "123456789012" },
  }), /SELLER_OS_RELAY_CURRENT_LIVE_FACTS_INVALID/)
})

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

test("existing Preview relay executes one bounded broad-net replay without secrets or writes", async () => {
  let executions = 0
  const expected = {
    contractVersion: "SELLER_OS_DEMAND_FIRST_BROAD_NET_SERVER_REPLAY_V1",
    status: "PASS", replayCohortId: "latest-processed-20-tasks:100-signals",
    signalsTotal: 100, browseItemLookupsAttempted: 100,
    browseItemLookupsSucceeded: 90, marketplaceWrites: 0,
    safety: { readOnly: true, credentialsIncluded: false,
      environmentValuesIncluded: false, familyPersistenceWrites: 0,
      observationPersistenceWrites: 0, enrollmentWrites: 0,
      shippingRuns: 0, externalAlerts: 0, marketplaceWrites: 0,
      nightlyPolicyEnabled: false },
  }
  const response = await handleSellerOsCloudReadRelayRequestV1(signedRequest(
    envelope({ toolName: SELLER_OS_DEMAND_FIRST_BROAD_NET_REPLAY_OPERATION_V1,
      arguments: {} })), {
    environment: serverEnvironment(), now: () => NOW,
    demandFirstBroadNetReplayCollector: async () => {
      executions += 1
      return expected
    },
  })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(executions, 1)
  assert.deepEqual(payload.result, expected)
  assert.equal(payload.safety.readOnly, true)
  assert.equal(payload.safety.credentialsIncluded, false)
  assert.equal(payload.safety.marketplaceWrites, 0)
  assert.doesNotMatch(JSON.stringify(payload),
    /accessToken|refreshToken|clientSecret|serviceRoleKey|cookie|password/i)
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
  for (const argumentsValue of [
    { accountKey: "attacker-choice" },
    { url: "https://example.com" },
    { token: "caller-token" },
    { limit: 100 },
  ]) {
    const response = await handleSellerOsCloudReadRelayRequestV1(
      signedRequest(envelope({ toolName: "seller_os_get_official_orders",
        arguments: argumentsValue })), options)
    assert.equal(response.status, 400)
    const statusResponse = await handleSellerOsCloudReadRelayRequestV1(
      signedRequest(envelope({
        toolName: "seller_os_get_whatsapp_sale_alert_status",
        arguments: argumentsValue,
      })), options)
    assert.equal(statusResponse.status, 400)
    const buyerStatusResponse = await handleSellerOsCloudReadRelayRequestV1(
      signedRequest(envelope({
        toolName: "seller_os_get_buyer_thank_you_status",
        arguments: argumentsValue,
      })), options)
    assert.equal(buyerStatusResponse.status, 400)
    const linkageStatusResponse = await handleSellerOsCloudReadRelayRequestV1(
      signedRequest(envelope({
        toolName: SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1,
        arguments: argumentsValue,
      })), options)
    assert.equal(linkageStatusResponse.status, 400)
    const quotaStatusResponse = await handleSellerOsCloudReadRelayRequestV1(
      signedRequest(envelope({
        toolName: SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1,
        arguments: argumentsValue,
      })), options)
    assert.equal(quotaStatusResponse.status, 400)
  }
  assert.equal(SELLER_OS_ASSISTANT_TOOLS_V1.length, 13)
})

test("Radar and Opportunity Case use the shared longitudinal collector without loading the commercial monitor", async () => {
  let monitorReads = 0
  const calls = []
  const options = { environment: serverEnvironment(), now: () => NOW,
    monitorLoader: async () => { monitorReads += 1; return {} },
    longitudinalOpportunityReadCollector: async (input) => {
      calls.push(input)
      return { status: "AVAILABLE",
        backend: "LONGITUDINAL_PERSISTED_FAMILY_RADAR",
        persistedMarketObservationSeriesAvailable: true,
        resultCount: input.toolName === "seller_os_get_opportunity_radar" ? 5 : 1,
        soldMomentumClaimed: false, databaseWrites: 0, marketplaceWrites: 0 }
    } }
  const radar = await handleSellerOsCloudReadRelayRequestV1(signedRequest(
    envelope({ toolName: "seller_os_get_opportunity_radar",
      arguments: { limit: 20 } })), options)
  assert.equal(radar.status, 200)
  const radarBody = await radar.json()
  assert.equal(radarBody.result.resultCount, 5)
  const opportunityCaseId =
    `opportunity-case-v1:sha256:${"a".repeat(64)}`
  const opportunityCase = await handleSellerOsCloudReadRelayRequestV1(
    signedRequest(envelope({ toolName: "seller_os_get_opportunity_case",
      arguments: { opportunityCaseId } })), options)
  assert.equal(opportunityCase.status, 200)
  assert.equal((await opportunityCase.json()).result.resultCount, 1)
  assert.equal(monitorReads, 0)
  assert.deepEqual(calls, [
    { toolName: "seller_os_get_opportunity_radar", arguments: { limit: 20 } },
    { toolName: "seller_os_get_opportunity_case",
      arguments: { opportunityCaseId } },
  ])
})

test("malformed Opportunity Case identifiers fail before the longitudinal collector", async () => {
  let reads = 0
  const response = await handleSellerOsCloudReadRelayRequestV1(signedRequest(
    envelope({ toolName: "seller_os_get_opportunity_case",
      arguments: { opportunityCaseId: "public.secrets; select *" } })), {
    environment: serverEnvironment(), now: () => NOW,
    longitudinalOpportunityReadCollector: async () => {
      reads += 1
      return {}
    },
  })
  assert.equal(response.status, 400)
  assert.equal(reads, 0)
})

test("WhatsApp sale-alert status traverses the relay as a read without monitor or send", async () => {
  const expected = {
    contractVersion: "SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_V1",
    bounded: true,
    status: "AVAILABLE",
    entries: [],
    safety: {
      readOnlyCertificationSurface: true,
      buyerPiiIncluded: false,
      credentialsIncluded: false,
      environmentValuesIncluded: false,
      phoneNumberIncluded: false,
      whatsappSendsByThisRead: 0,
      marketplaceWrites: 0,
    },
  }
  let statusReads = 0
  let monitorReads = 0
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(),
    now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (url, init) => handleSellerOsCloudReadRelayRequestV1(
      new Request(url, init), {
        environment: serverEnvironment(),
        now: () => NOW,
        monitorLoader: async () => { monitorReads += 1; return {} },
        whatsappSaleAlertStatusCollector: async () => {
          statusReads += 1
          return expected
        },
      }),
  })
  const result = await executor({
    toolName: "seller_os_get_whatsapp_sale_alert_status",
    arguments: {},
  })
  assert.deepEqual(result, expected)
  assert.equal(statusReads, 1)
  assert.equal(monitorReads, 0)
  assert.equal(result.safety.whatsappSendsByThisRead, 0)
  assert.equal(result.safety.phoneNumberIncluded, false)
})

test("buyer thank-you status traverses the relay without resolving recipient or sending", async () => {
  const expected = {
    contractVersion: "SELLER_OS_BUYER_THANK_YOU_STATUS_V1",
    bounded: true,
    sourceStatus: "AVAILABLE",
    entries: [],
    safety: {
      readOnlyCertificationSurface: true,
      buyerPiiIncluded: false,
      buyerIdentityIncluded: false,
      credentialsIncluded: false,
      environmentValuesIncluded: false,
      buyerMessageSendsByThisRead: 0,
      marketplaceWritesByThisRead: 0,
    },
  }
  let statusReads = 0
  let monitorReads = 0
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(),
    now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (url, init) => handleSellerOsCloudReadRelayRequestV1(
      new Request(url, init), {
        environment: serverEnvironment(),
        now: () => NOW,
        monitorLoader: async () => { monitorReads += 1; return {} },
        buyerThankYouStatusCollector: async () => {
          statusReads += 1
          return expected
        },
      }),
  })
  const result = await executor({
    toolName: "seller_os_get_buyer_thank_you_status",
    arguments: {},
  })
  assert.deepEqual(result, expected)
  assert.equal(statusReads, 1)
  assert.equal(monitorReads, 0)
  assert.equal(result.safety.buyerMessageSendsByThisRead, 0)
  assert.equal(result.safety.buyerIdentityIncluded, false)
})

test("official Orders executes inside the authenticated Preview relay without local MCP OAuth", async () => {
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
  let officialReads = 0
  let monitorReads = 0
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(),
    now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (url, init) => handleSellerOsCloudReadRelayRequestV1(
      new Request(url, init), {
        environment: serverEnvironment(),
        now: () => NOW,
        monitorLoader: async () => { monitorReads += 1; return {} },
        officialOrdersCollector: async () => {
          officialReads += 1
          return expected
        },
      }),
  })
  const result = await executor({
    toolName: "seller_os_get_official_orders",
    arguments: {},
  })
  assert.deepEqual(result, expected)
  assert.equal(officialReads, 1)
  assert.equal(monitorReads, 0)
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.equal(result.officialOrderCount, 0)
  assert.equal(result.pagination.pagesRead, 1)
  assert.equal(result.safety.buyerPiiIncluded, false)
  assert.equal(result.safety.credentialsIncluded, false)
  assert.equal(result.safety.environmentValuesIncluded, false)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.databaseWrites, 0)
})

test("P2-I01 resource traverses the fixed relay without adding an MCP tool or local source secrets", async () => {
  const expected = {
    contractVersion: "SELLER_OS_LUNA_SUPPLIER_LINKAGE_STATUS_V1",
    status: "AVAILABLE", bounded: true,
    counts: { currentLive: 1, certified: 0, candidate: 0,
      humanReview: 0, unproven: 1, rejected: 0, stale: 0 },
    entries: [],
    safety: { readOnlySurface: true, buyerPiiIncluded: false,
      credentialsIncluded: false, environmentValuesIncluded: false,
      marketplaceWritesByThisRead: 0, inventoryWritesByThisRead: 0,
      lunaMutationsByThisRead: 0, whatsappSendsByThisRead: 0,
      buyerMessageSendsByThisRead: 0 },
  }
  let linkageReads = 0
  let monitorReads = 0
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(), now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (url, init) => handleSellerOsCloudReadRelayRequestV1(
      new Request(url, init), {
        environment: serverEnvironment(), now: () => NOW,
        monitorLoader: async () => { monitorReads += 1; return {} },
        lunaSupplierLinkageStatusCollector: async () => {
          linkageReads += 1
          return expected
        },
      }),
  })
  const result = await executor({
    toolName: SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1,
    arguments: {},
  })
  assert.deepEqual(result, expected)
  assert.equal(linkageReads, 1)
  assert.equal(monitorReads, 0)
  assert.equal(result.safety.marketplaceWritesByThisRead, 0)
  assert.equal(result.safety.lunaMutationsByThisRead, 0)
  assert.equal(result.safety.whatsappSendsByThisRead, 0)
  assert.equal(SELLER_OS_ASSISTANT_TOOLS_V1.some((tool) =>
    tool.name === SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1), false)
})

test("P2-I01A quota resource traverses one fixed relay operation without loading the Trading monitor", async () => {
  const expected = {
    contractVersion: "SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_V1",
    status: "AVAILABLE", sourceStatus: "AVAILABLE",
    source: "EBAY_DEVELOPER_ANALYTICS_GET_RATE_LIMITS",
    observedAt: "2026-08-22T12:00:00.000Z", bounded: true,
    ebayEnvironment: "PRODUCTION", ebayMarketplace: "EBAY_US",
    ebayAppIdentityMatch: true, tradingApiRateLimitFound: true,
    gateState: "BLOCKED", rates: [], rateCount: 1, truncated: false,
    evidenceCompleteness: "COMPLETE", ebay518BucketIdentity: "PROVEN",
    ebay518LimitScope: "APPLICATION", ebay518Rate: null,
    blockingRates: [], nextSafeTradingProbeAt: "2026-08-23T00:00:00.000Z",
    limitationCodes: [], acquisition: {
      method: "EBAY_DEVELOPER_ANALYTICS_CLIENT_CREDENTIALS",
      apiContextFilter: "tradingapi", apiNameFilter: "tradingapi",
      cacheStatus: "MISS", developerAnalyticsCallsByThisRead: 1,
    },
    safety: { readOnlySurface: true,
      callerProvidedApiContextAllowed: false, arbitraryUrlAllowed: false,
      tradingLiveCallsByThisRead: 0, getMyeBaySellingCallsByThisRead: 0,
      getSellerListCallsByThisRead: 0, getItemCallsByThisRead: 0,
      ebayWritesByThisRead: 0, listingWritesByThisRead: 0,
      inventoryWritesByThisRead: 0, oauthUserChangesByThisRead: 0,
      credentialsIncluded: false, environmentValuesIncluded: false,
      buyerPiiIncluded: false, lunaPollingByThisRead: 0,
      vaultWritesByThisRead: 0, messageSendsByThisRead: 0,
      paymentTransactionsByThisRead: 0 },
  }
  let quotaReads = 0
  let monitorReads = 0
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(), now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000002",
    fetcher: async (url, init) => handleSellerOsCloudReadRelayRequestV1(
      new Request(url, init), {
        environment: serverEnvironment(), now: () => NOW,
        monitorLoader: async () => { monitorReads += 1; return {} },
        ebayTradingRateLimitStatusCollector: async () => {
          quotaReads += 1
          return expected
        },
      }),
  })
  const result = await executor({
    toolName: SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1,
    arguments: {},
  })
  assert.deepEqual(result, expected)
  assert.equal(quotaReads, 1)
  assert.equal(monitorReads, 0)
  assert.equal(result.safety.tradingLiveCallsByThisRead, 0)
  assert.equal(SELLER_OS_ASSISTANT_TOOLS_V1.some((tool) =>
    tool.name === SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1), false)
})

test("relay completes Vercel protection cookie handoff once without exposing it", async () => {
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
  let reads = 0
  let cookiePresented = false
  const executor = createSellerOsCloudReadRelayExecutorV1({
    environment: clientEnvironment(),
    now: () => NOW,
    nonce: () => "00000000-0000-4000-8000-000000000003",
    fetcher: async (url, init) => {
      reads += 1
      if (reads === 1) {
        assert.equal(init?.redirect, "manual")
        assert.equal(new Headers(init?.headers).get(
          SELLER_OS_CLOUD_READ_RELAY_HEADERS.protectionCookieRequest), "true")
        return new Response(null, { status: 307, headers: {
          Location: SELLER_OS_CLOUD_READ_RELAY_PATH,
          "Set-Cookie": "_vercel_jwt=bounded.preview.jwt.value; Path=/; HttpOnly; Secure",
        } })
      }
      cookiePresented = new Headers(init?.headers).get("cookie") ===
        "_vercel_jwt=bounded.preview.jwt.value"
      return handleSellerOsCloudReadRelayRequestV1(new Request(url, init), {
        environment: serverEnvironment(),
        now: () => NOW,
        officialOrdersCollector: async () => expected,
      })
    },
  })
  const result = await executor({ toolName: "seller_os_get_official_orders",
    arguments: {} })
  assert.equal(reads, 2)
  assert.equal(cookiePresented, true)
  assert.equal(result.sourceStatus, "AVAILABLE")
  assert.doesNotMatch(JSON.stringify(result), /vercel_jwt|bounded\.preview\.jwt/i)
})

test("relay rejects cross-origin or malformed protection handoffs fail-closed", async () => {
  for (const response of [
    new Response(null, { status: 307, headers: {
      Location: "https://attacker.example/api/seller-os/assistant/cloud-read-relay",
      "Set-Cookie": "_vercel_jwt=bounded.preview.jwt.value; Path=/",
    } }),
    new Response(null, { status: 307, headers: {
      Location: SELLER_OS_CLOUD_READ_RELAY_PATH,
      "Set-Cookie": "other_cookie=not-accepted; Path=/",
    } }),
  ]) {
    let calls = 0
    const executor = createSellerOsCloudReadRelayExecutorV1({
      environment: clientEnvironment(),
      now: () => NOW,
      nonce: () => "00000000-0000-4000-8000-000000000004",
      fetcher: async () => { calls += 1; return response },
    })
    await assert.rejects(() => executor({
      toolName: "seller_os_get_official_orders", arguments: {},
    }), /SELLER_OS_CLOUD_READ_RELAY_READ_FAILED_CLOSED/)
    assert.equal(calls, 1)
  }
})

test("official Orders relay source failures remain unavailable and never become a false zero", async () => {
  const response = await handleSellerOsCloudReadRelayRequestV1(
    signedRequest(envelope({ toolName: "seller_os_get_official_orders",
      arguments: {} })), {
      environment: serverEnvironment(),
      now: () => NOW,
      officialOrdersCollector: async () => {
        throw new Error("EBAY_MONITOR_ORDERS_401")
      },
    })
  assert.equal(response.status, 502)
  const payload = await response.json()
  assert.equal(payload.code, "SELLER_OS_CLOUD_READ_RELAY_SOURCE_READ_FAILED")
  assert.equal(payload.credentialsIncluded, false)
  assert.equal(payload.buyerPiiIncluded, false)
  assert.equal(payload.marketplaceWrites, 0)
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
