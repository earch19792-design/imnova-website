import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"

// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { executeSellerOsAssistantToolV1, SELLER_OS_ASSISTANT_TOOLS_V1 } from "./ebay-seller-os-assistant-gateway-v1.ts"
import type { CommercialMonitorGetDto } from
  "./commercial-monitor-readonly-contract"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { SELLER_OS_OFFICIAL_ORDERS_TOOL_V1, type SellerOsOfficialOrdersReadV1 } from "./ebay-official-orders-read-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1, type SellerOsWhatsappSaleAlertStatusV1 } from "./ebay-whatsapp-sale-alert-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1, type SellerOsBuyerThankYouStatusV1 } from "./ebay-post-purchase-buyer-message-v1.ts"
import type { SellerOsLunaSupplierLinkageReadV1 } from "./ebay-luna-supplier-linkage-certification-v1.ts"
import type { SellerOsEbayTradingRateLimitStatusV1 } from
  "./ebay-trading-rate-limit-observability-v1.ts"
// @ts-expect-error Node's direct TypeScript runner requires the explicit extension.
import { collectSellerOsLongitudinalOpportunityReadV1 } from "./ebay-longitudinal-opportunity-radar-read-v1.ts"

export const SELLER_OS_CLOUD_READ_RELAY_VERSION =
  "SELLER_OS_CLOUD_READ_RELAY_V1_2026_08_12"
export const SELLER_OS_CLOUD_READ_RELAY_PATH =
  "/api/seller-os/assistant/cloud-read-relay"
export const SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1 =
  "seller_os_internal_read_luna_supplier_linkage_resource" as const
export const SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1 =
  "seller_os_internal_read_ebay_trading_rate_limit_resource" as const
export const SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT = Object.freeze({
  endpointUrl: "SELLER_OS_CLOUD_READ_RELAY_URL",
  authenticationSecret: "SELLER_OS_CLOUD_READ_RELAY_SECRET",
  vercelProtectionBypass: "SELLER_OS_CLOUD_READ_RELAY_PROTECTION_BYPASS",
})
export const SELLER_OS_CLOUD_READ_RELAY_HEADERS = Object.freeze({
  timestamp: "x-seller-os-relay-timestamp",
  nonce: "x-seller-os-relay-nonce",
  signature: "x-seller-os-relay-signature",
  protectionBypass: "x-vercel-protection-bypass",
  protectionCookieRequest: "x-vercel-set-bypass-cookie",
})

const MAX_REQUEST_BYTES = 8_192
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_CLOCK_SKEW_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000
const RELAY_TOOL_NAMES = new Set(
  [
    ...SELLER_OS_ASSISTANT_TOOLS_V1.map((descriptor) => descriptor.name),
    SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.name,
    SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.name,
    SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.name,
    SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1,
    SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1,
  ],
)
const SAFE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "X-Seller-OS-Relay-Mode": "READ_ONLY",
  "X-Seller-OS-Relay-Version": SELLER_OS_CLOUD_READ_RELAY_VERSION,
})

export type SellerOsAssistantToolCallV1 = Readonly<{
  toolName: string
  arguments: Record<string, unknown>
}>

export type SellerOsAssistantToolExecutorV1 = (
  input: SellerOsAssistantToolCallV1,
) => Promise<unknown>

type SellerOsCloudReadRelayConfigurationV1 = Readonly<{
  ok: boolean
  endpointUrl: string | null
  authenticationSecret: string | null
  vercelProtectionBypass: string | null
  reasonCodes: readonly string[]
}>

type RelayEnvelopeV1 = Readonly<{
  contractVersion: typeof SELLER_OS_CLOUD_READ_RELAY_VERSION
  requestId: string
  toolName: string
  arguments: Record<string, unknown>
}>

function normalize(value: string | undefined) {
  return value?.trim() ?? ""
}

function validSecret(value: string) {
  return value.length >= 32 && value.length <= 512 && !/\s/.test(value)
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8")
}

function relayError(status: number, code: string) {
  return Response.json({ status: "SELLER_OS_CLOUD_READ_RELAY_FAILED_CLOSED",
    code, credentialsIncluded: false, buyerPiiIncluded: false,
    marketplaceWrites: 0 }, { status, headers: SAFE_HEADERS })
}

function canonicalSignatureInput(timestamp: string, nonce: string, body: string) {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex")
  return ["POST", SELLER_OS_CLOUD_READ_RELAY_PATH, timestamp, nonce,
    bodyHash].join("\n")
}

export function signSellerOsCloudReadRelayRequestV1(input: {
  timestamp: string
  nonce: string
  body: string
  authenticationSecret: string
}) {
  return createHmac("sha256", input.authenticationSecret)
    .update(canonicalSignatureInput(input.timestamp, input.nonce, input.body), "utf8")
    .digest("hex")
}

function signaturesMatch(expected: string, received: string) {
  if (!/^[a-f0-9]{64}$/.test(received)) return false
  const expectedBuffer = Buffer.from(expected, "hex")
  const receivedBuffer = Buffer.from(received, "hex")
  return expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
}

function normalizeRelayArguments(toolName: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELLER_OS_RELAY_ARGUMENTS_INVALID")
  }
  const args = value as Record<string, unknown>
  const allowedKeys = new Set<string>(
    toolName === SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.name ||
        toolName === SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.name ||
        toolName === SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.name ||
        toolName === SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1 ||
        toolName === SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1
      ? [] : ["limit"],
  )
  if (toolName === "seller_os_get_listing_intelligence") {
    allowedKeys.add("itemId")
  }
  if (toolName === "seller_os_get_opportunity_case") {
    allowedKeys.add("opportunityCaseId")
  }
  if (Object.keys(args).some((key) => !allowedKeys.has(key))) {
    throw new Error("SELLER_OS_RELAY_ARGUMENT_NOT_ALLOWLISTED")
  }
  const normalized: Record<string, unknown> = {}
  if (args.limit !== undefined) {
    if (!Number.isInteger(args.limit) || Number(args.limit) < 1 ||
      Number(args.limit) > 100) {
      throw new Error("SELLER_OS_RELAY_LIMIT_INVALID")
    }
    normalized.limit = Number(args.limit)
  }
  if (toolName === "seller_os_get_listing_intelligence") {
    if (typeof args.itemId !== "string" || !/^\d{9,19}$/.test(args.itemId)) {
      throw new Error("SELLER_OS_RELAY_ITEM_ID_INVALID")
    }
    normalized.itemId = args.itemId
  }
  if (toolName === "seller_os_get_opportunity_case") {
    if (typeof args.opportunityCaseId !== "string" ||
      !/^opportunity-case-v1:sha256:[0-9a-f]{64}$/.test(
        args.opportunityCaseId,
      )) {
      throw new Error("SELLER_OS_RELAY_OPPORTUNITY_CASE_ID_INVALID")
    }
    normalized.opportunityCaseId = args.opportunityCaseId
  }
  return normalized
}

function normalizeEnvelope(value: unknown): RelayEnvelopeV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELLER_OS_RELAY_ENVELOPE_INVALID")
  }
  const envelope = value as Record<string, unknown>
  if (envelope.contractVersion !== SELLER_OS_CLOUD_READ_RELAY_VERSION ||
    typeof envelope.requestId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(envelope.requestId) ||
    typeof envelope.toolName !== "string" ||
    !RELAY_TOOL_NAMES.has(envelope.toolName)) {
    throw new Error("SELLER_OS_RELAY_ENVELOPE_NOT_ALLOWLISTED")
  }
  const allowedEnvelopeKeys = new Set([
    "contractVersion", "requestId", "toolName", "arguments",
  ])
  if (Object.keys(envelope).some((key) => !allowedEnvelopeKeys.has(key))) {
    throw new Error("SELLER_OS_RELAY_ENVELOPE_FIELD_NOT_ALLOWLISTED")
  }
  return Object.freeze({
    contractVersion: SELLER_OS_CLOUD_READ_RELAY_VERSION,
    requestId: envelope.requestId,
    toolName: envelope.toolName,
    arguments: normalizeRelayArguments(envelope.toolName, envelope.arguments),
  })
}

const FORBIDDEN_OUTPUT_KEYS = new Set([
  "accesstoken", "refreshtoken", "clientsecret", "servicerolekey",
  "authorization", "authorizationheader", "cookie", "sessioncookie",
  "password", "buyeremail", "buyerphone", "buyeraddress",
  "shippingaddress", "recipientaddress",
])

export const SELLER_OS_CURRENT_LIVE_FACTS_RELAY_FIELDS_V1 = Object.freeze([
  "itemId", "sku", "customLabel", "title", "quantity", "price", "currency",
  "liveStatus", "source", "observedAt",
] as const)

const SELLER_OS_CURRENT_LIVE_DISCOVERY_SOURCE_V1 =
  "EBAY_TRADING_GET_MY_EBAY_SELLING" as const

function nullableString(value: unknown) {
  return value === null || typeof value === "string"
}

export function projectSellerOsCloudReadRelayResultV1(
  toolName: string,
  value: unknown,
) {
  if (toolName !== "seller_os_get_listing_intelligence") return value
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SELLER_OS_RELAY_LISTING_RESULT_INVALID")
  }
  const result = value as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(result, "currentLiveFacts")) {
    return value
  }
  const candidate = result.currentLiveFacts
  if (candidate === null) return value
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("SELLER_OS_RELAY_CURRENT_LIVE_FACTS_INVALID")
  }
  const facts = candidate as Record<string, unknown>
  if (!SELLER_OS_CURRENT_LIVE_FACTS_RELAY_FIELDS_V1.every((field) =>
    Object.prototype.hasOwnProperty.call(facts, field)) ||
      typeof facts.itemId !== "string" || !/^\d{9,19}$/.test(facts.itemId) ||
      !nullableString(facts.sku) || !nullableString(facts.customLabel) ||
      !nullableString(facts.title) ||
      !(facts.quantity === null ||
        (Number.isSafeInteger(facts.quantity) && Number(facts.quantity) >= 0)) ||
      !(facts.price === null ||
        (typeof facts.price === "number" && Number.isFinite(facts.price) &&
          facts.price >= 0)) ||
      !nullableString(facts.currency) || facts.liveStatus !== "LIVE_ACTIVE" ||
      facts.source !== SELLER_OS_CURRENT_LIVE_DISCOVERY_SOURCE_V1 ||
      typeof facts.observedAt !== "string" ||
      !Number.isFinite(Date.parse(facts.observedAt))) {
    throw new Error("SELLER_OS_RELAY_CURRENT_LIVE_FACTS_INVALID")
  }
  const identity = result.identity
  if (identity && typeof identity === "object" && !Array.isArray(identity) &&
      typeof (identity as Record<string, unknown>).itemId === "string" &&
      (identity as Record<string, unknown>).itemId !== facts.itemId) {
    throw new Error("SELLER_OS_RELAY_CURRENT_LIVE_FACTS_IDENTITY_CONFLICT")
  }
  return Object.freeze({ ...result, currentLiveFacts: Object.freeze({
    itemId: facts.itemId,
    sku: facts.sku,
    customLabel: facts.customLabel,
    title: facts.title,
    quantity: facts.quantity,
    price: facts.price,
    currency: facts.currency,
    liveStatus: facts.liveStatus,
    source: facts.source,
    observedAt: facts.observedAt,
  }) })
}

function assertRelayResultSafe(value: unknown) {
  const serialized = JSON.stringify(value)
  if (byteLength(serialized) > MAX_RESPONSE_BYTES) {
    throw new Error("SELLER_OS_RELAY_RESPONSE_NOT_BOUNDED")
  }
  const pending: unknown[] = [value]
  while (pending.length) {
    const current = pending.pop()
    if (!current || typeof current !== "object") continue
    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "")
      if (FORBIDDEN_OUTPUT_KEYS.has(normalizedKey)) {
        throw new Error("SELLER_OS_RELAY_SENSITIVE_OUTPUT_FORBIDDEN")
      }
      pending.push(child)
    }
  }
}

export function getSellerOsCloudReadRelayConfigurationV1(
  environment: NodeJS.ProcessEnv = process.env,
): SellerOsCloudReadRelayConfigurationV1 {
  const endpointValue = normalize(
    environment[SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.endpointUrl],
  )
  const authenticationSecret = normalize(
    environment[SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.authenticationSecret],
  )
  const vercelProtectionBypass = normalize(
    environment[SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.vercelProtectionBypass],
  )
  const reasonCodes: string[] = []
  let endpointUrl: string | null = null
  try {
    const parsed = new URL(endpointValue)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.pathname !== SELLER_OS_CLOUD_READ_RELAY_PATH || parsed.search ||
      parsed.hash || !parsed.hostname.endsWith(".vercel.app")) {
      reasonCodes.push("RELAY_ENDPOINT_NOT_CANONICAL_PREVIEW_HTTPS")
    } else {
      endpointUrl = parsed.toString()
    }
  } catch {
    reasonCodes.push("RELAY_ENDPOINT_NOT_CANONICAL_PREVIEW_HTTPS")
  }
  if (!validSecret(authenticationSecret)) {
    reasonCodes.push("RELAY_AUTHENTICATION_SECRET_REQUIRED")
  }
  if (!validSecret(vercelProtectionBypass)) {
    reasonCodes.push("RELAY_PREVIEW_PROTECTION_TRANSPORT_REQUIRED")
  }
  if (authenticationSecret && authenticationSecret === vercelProtectionBypass) {
    reasonCodes.push("RELAY_AUTH_MUST_BE_DISTINCT_FROM_PREVIEW_BYPASS")
  }
  return Object.freeze({ ok: reasonCodes.length === 0, endpointUrl,
    authenticationSecret: validSecret(authenticationSecret)
      ? authenticationSecret : null,
    vercelProtectionBypass: validSecret(vercelProtectionBypass)
      ? vercelProtectionBypass : null,
    reasonCodes: Object.freeze(reasonCodes) })
}

export function createSellerOsCloudReadRelayExecutorV1(options: {
  environment?: NodeJS.ProcessEnv
  fetcher?: typeof fetch
  now?: () => number
  nonce?: () => string
} = {}): SellerOsAssistantToolExecutorV1 {
  const environment = options.environment ?? process.env
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? Date.now
  const nonce = options.nonce ?? randomUUID
  return async (input) => {
    const configuration = getSellerOsCloudReadRelayConfigurationV1(environment)
    if (!configuration.ok || !configuration.endpointUrl ||
      !configuration.authenticationSecret ||
      !configuration.vercelProtectionBypass) {
      throw new Error("SELLER_OS_CLOUD_READ_RELAY_CONFIGURATION_REQUIRED")
    }
    if (!RELAY_TOOL_NAMES.has(input.toolName)) {
      throw new Error("SELLER_OS_RELAY_TOOL_NOT_ALLOWLISTED")
    }
    const envelope: RelayEnvelopeV1 = Object.freeze({
      contractVersion: SELLER_OS_CLOUD_READ_RELAY_VERSION,
      requestId: randomUUID(),
      toolName: input.toolName,
      arguments: normalizeRelayArguments(input.toolName, input.arguments),
    })
    const body = JSON.stringify(envelope)
    if (byteLength(body) > MAX_REQUEST_BYTES) {
      throw new Error("SELLER_OS_RELAY_REQUEST_NOT_BOUNDED")
    }
    const timestamp = String(now())
    const requestNonce = nonce()
    const signature = signSellerOsCloudReadRelayRequestV1({ timestamp,
      nonce: requestNonce, body,
      authenticationSecret: configuration.authenticationSecret })
    const headers = { "Content-Type": "application/json",
      [SELLER_OS_CLOUD_READ_RELAY_HEADERS.timestamp]: timestamp,
      [SELLER_OS_CLOUD_READ_RELAY_HEADERS.nonce]: requestNonce,
      [SELLER_OS_CLOUD_READ_RELAY_HEADERS.signature]: signature,
      [SELLER_OS_CLOUD_READ_RELAY_HEADERS.protectionBypass]:
        configuration.vercelProtectionBypass,
      [SELLER_OS_CLOUD_READ_RELAY_HEADERS.protectionCookieRequest]: "true" }
    let response = await fetcher(configuration.endpointUrl, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 307) {
      const locationValue = response.headers.get("location")
      const cookieValue = response.headers.get("set-cookie")
      const endpoint = new URL(configuration.endpointUrl)
      let location: URL | null = null
      try {
        location = locationValue ? new URL(locationValue, endpoint) : null
      } catch {
        location = null
      }
      const cookieMatch = cookieValue?.match(
        /^_vercel_jwt=([A-Za-z0-9._~-]{16,4096})(?:;|$)/,
      ) ?? null
      if (!location || location.origin !== endpoint.origin ||
          location.pathname !== endpoint.pathname || location.search ||
          location.hash || !cookieMatch) {
        throw new Error("SELLER_OS_CLOUD_READ_RELAY_READ_FAILED_CLOSED")
      }
      let protectionCookie = cookieMatch[1]
      try {
        response = await fetcher(configuration.endpointUrl, {
          method: "POST",
          headers: { ...headers, Cookie: `_vercel_jwt=${protectionCookie}` },
          body,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } finally {
        protectionCookie = ""
      }
    }
    const responseText = await response.text()
    if (!response.ok || byteLength(responseText) > MAX_RESPONSE_BYTES) {
      throw new Error("SELLER_OS_CLOUD_READ_RELAY_READ_FAILED_CLOSED")
    }
    const payload = JSON.parse(responseText) as Record<string, unknown>
    if (payload.contractVersion !== SELLER_OS_CLOUD_READ_RELAY_VERSION ||
      payload.requestId !== envelope.requestId || !("result" in payload)) {
      throw new Error("SELLER_OS_CLOUD_READ_RELAY_RESPONSE_INVALID")
    }
    const result = projectSellerOsCloudReadRelayResultV1(
      input.toolName,
      payload.result,
    )
    assertRelayResultSafe(result)
    return result
  }
}

export async function handleSellerOsCloudReadRelayRequestV1(
  req: Request,
  options: {
    environment?: NodeJS.ProcessEnv
    now?: () => number
    monitorLoader?: () => Promise<CommercialMonitorGetDto>
    officialOrdersCollector?: () => Promise<SellerOsOfficialOrdersReadV1>
    whatsappSaleAlertStatusCollector?: () => Promise<
      SellerOsWhatsappSaleAlertStatusV1
    >
    buyerThankYouStatusCollector?: () => Promise<
      SellerOsBuyerThankYouStatusV1
    >
    lunaSupplierLinkageStatusCollector?: () => Promise<
      SellerOsLunaSupplierLinkageReadV1
    >
    ebayTradingRateLimitStatusCollector?: () => Promise<
      SellerOsEbayTradingRateLimitStatusV1
    >
    longitudinalOpportunityReadCollector?: typeof
      collectSellerOsLongitudinalOpportunityReadV1
  } = {},
) {
  const environment = options.environment ?? process.env
  if (environment.VERCEL_ENV !== "preview" || req.method !== "POST" ||
    new URL(req.url).pathname !== SELLER_OS_CLOUD_READ_RELAY_PATH) {
    return relayError(404, "SELLER_OS_CLOUD_READ_RELAY_PREVIEW_ONLY")
  }
  const authenticationSecret = normalize(
    environment[SELLER_OS_CLOUD_READ_RELAY_ENVIRONMENT.authenticationSecret],
  )
  if (!validSecret(authenticationSecret)) {
    return relayError(503, "SELLER_OS_CLOUD_READ_RELAY_NOT_ACTIVATED")
  }
  const timestamp = req.headers.get(
    SELLER_OS_CLOUD_READ_RELAY_HEADERS.timestamp,
  ) ?? ""
  const requestNonce = req.headers.get(
    SELLER_OS_CLOUD_READ_RELAY_HEADERS.nonce,
  ) ?? ""
  const receivedSignature = req.headers.get(
    SELLER_OS_CLOUD_READ_RELAY_HEADERS.signature,
  ) ?? ""
  const observedAt = Number(timestamp)
  const now = (options.now ?? Date.now)()
  if (!/^\d{13}$/.test(timestamp) || !Number.isFinite(observedAt) ||
    Math.abs(now - observedAt) > MAX_CLOCK_SKEW_MS ||
    !/^[a-f0-9-]{36}$/.test(requestNonce)) {
    return relayError(401, "SELLER_OS_CLOUD_READ_RELAY_AUTH_REQUIRED")
  }
  let body = ""
  try {
    body = await req.text()
  } catch {
    return relayError(400, "SELLER_OS_CLOUD_READ_RELAY_REQUEST_INVALID")
  }
  if (!body || byteLength(body) > MAX_REQUEST_BYTES) {
    return relayError(413, "SELLER_OS_CLOUD_READ_RELAY_REQUEST_NOT_BOUNDED")
  }
  const expectedSignature = signSellerOsCloudReadRelayRequestV1({ timestamp,
    nonce: requestNonce, body, authenticationSecret })
  if (!signaturesMatch(expectedSignature, receivedSignature)) {
    return relayError(401, "SELLER_OS_CLOUD_READ_RELAY_AUTH_REQUIRED")
  }
  let envelope: RelayEnvelopeV1
  try {
    envelope = normalizeEnvelope(JSON.parse(body))
  } catch {
    return relayError(400, "SELLER_OS_CLOUD_READ_RELAY_REQUEST_NOT_ALLOWLISTED")
  }
  try {
    let result: unknown
    if (envelope.toolName === SELLER_OS_OFFICIAL_ORDERS_TOOL_V1.name) {
      const collector = options.officialOrdersCollector ?? (async () => {
        const runtime = await import("./ebay-seller-os-assistant-runtime")
        return runtime.collectSellerOsOfficialOrdersReadV1()
      })
      result = await collector()
    } else if (envelope.toolName ===
        SELLER_OS_WHATSAPP_SALE_ALERT_STATUS_TOOL_V1.name) {
      const collector = options.whatsappSaleAlertStatusCollector ??
        (async () => {
          const runtime = await import("./ebay-seller-os-assistant-runtime")
          return runtime.collectSellerOsWhatsappSaleAlertStatusV1()
        })
      result = await collector()
    } else if (envelope.toolName ===
        SELLER_OS_BUYER_THANK_YOU_STATUS_TOOL_V1.name) {
      const collector = options.buyerThankYouStatusCollector ??
        (async () => {
          const runtime = await import("./ebay-seller-os-assistant-runtime")
          return runtime.collectSellerOsBuyerThankYouStatusV1()
      })
      result = await collector()
    } else if (envelope.toolName ===
        SELLER_OS_LUNA_SUPPLIER_LINKAGE_RELAY_OPERATION_V1) {
      const collector = options.lunaSupplierLinkageStatusCollector ??
        (async () => {
          const runtime = await import("./ebay-seller-os-assistant-runtime")
          return runtime.collectSellerOsLunaSupplierLinkageStatusV1()
        })
      result = await collector()
    } else if (envelope.toolName ===
        SELLER_OS_EBAY_TRADING_RATE_LIMIT_RELAY_OPERATION_V1) {
      const collector = options.ebayTradingRateLimitStatusCollector ??
        (async () => {
          const runtime = await import(
            "./ebay-trading-rate-limit-observability-v1"
          )
          return runtime.collectSellerOsEbayTradingRateLimitStatusV1()
        })
      result = await collector()
    } else if (envelope.toolName === "seller_os_get_opportunity_radar" ||
        envelope.toolName === "seller_os_get_opportunity_case") {
      const collector = options.longitudinalOpportunityReadCollector ??
        collectSellerOsLongitudinalOpportunityReadV1
      result = await collector({
        toolName: envelope.toolName,
        arguments: envelope.arguments,
      })
    } else {
      const monitorLoader = options.monitorLoader ?? (async () => {
        const runtime = await import("./ebay-seller-os-assistant-runtime")
        return runtime.loadSellerOsAssistantMonitorSnapshotV1()
      })
      const monitor = await monitorLoader()
      result = executeSellerOsAssistantToolV1({
        toolName: envelope.toolName,
        arguments: envelope.arguments,
        monitor,
      })
    }
    result = projectSellerOsCloudReadRelayResultV1(
      envelope.toolName,
      result,
    )
    assertRelayResultSafe(result)
    return Response.json({
      contractVersion: SELLER_OS_CLOUD_READ_RELAY_VERSION,
      requestId: envelope.requestId,
      result,
      safety: { readOnly: true, assistantWriteTools: 0,
        credentialsIncluded: false, buyerPiiIncluded: false,
        marketplaceWrites: 0 },
    }, { status: 200, headers: SAFE_HEADERS })
  } catch {
    return relayError(502, "SELLER_OS_CLOUD_READ_RELAY_SOURCE_READ_FAILED")
  }
}
