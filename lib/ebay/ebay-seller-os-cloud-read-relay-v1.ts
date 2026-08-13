import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"

// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { executeSellerOsAssistantToolV1, SELLER_OS_ASSISTANT_TOOLS_V1 } from "./ebay-seller-os-assistant-gateway-v1.ts"
import type { CommercialMonitorGetDto } from
  "./commercial-monitor-readonly-contract"

export const SELLER_OS_CLOUD_READ_RELAY_VERSION =
  "SELLER_OS_CLOUD_READ_RELAY_V1_2026_08_12"
export const SELLER_OS_CLOUD_READ_RELAY_PATH =
  "/api/seller-os/assistant/cloud-read-relay"
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
})

const MAX_REQUEST_BYTES = 8_192
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_CLOCK_SKEW_MS = 60_000
const REQUEST_TIMEOUT_MS = 30_000
const RELAY_TOOL_NAMES = new Set(
  SELLER_OS_ASSISTANT_TOOLS_V1.map((descriptor) => descriptor.name),
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
  const allowedKeys = new Set(["limit"])
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
      args.opportunityCaseId.length < 1 || args.opportunityCaseId.length > 120) {
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
    const response = await fetcher(configuration.endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json",
        [SELLER_OS_CLOUD_READ_RELAY_HEADERS.timestamp]: timestamp,
        [SELLER_OS_CLOUD_READ_RELAY_HEADERS.nonce]: requestNonce,
        [SELLER_OS_CLOUD_READ_RELAY_HEADERS.signature]: signature,
        [SELLER_OS_CLOUD_READ_RELAY_HEADERS.protectionBypass]:
          configuration.vercelProtectionBypass },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const responseText = await response.text()
    if (!response.ok || byteLength(responseText) > MAX_RESPONSE_BYTES) {
      throw new Error("SELLER_OS_CLOUD_READ_RELAY_READ_FAILED_CLOSED")
    }
    const payload = JSON.parse(responseText) as Record<string, unknown>
    if (payload.contractVersion !== SELLER_OS_CLOUD_READ_RELAY_VERSION ||
      payload.requestId !== envelope.requestId || !("result" in payload)) {
      throw new Error("SELLER_OS_CLOUD_READ_RELAY_RESPONSE_INVALID")
    }
    assertRelayResultSafe(payload.result)
    return payload.result
  }
}

export async function handleSellerOsCloudReadRelayRequestV1(
  req: Request,
  options: {
    environment?: NodeJS.ProcessEnv
    now?: () => number
    monitorLoader?: () => Promise<CommercialMonitorGetDto>
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
    const monitorLoader = options.monitorLoader ?? (async () => {
      const runtime = await import("./ebay-seller-os-assistant-runtime")
      return runtime.loadSellerOsAssistantMonitorSnapshotV1()
    })
    const monitor = await monitorLoader()
    const result = executeSellerOsAssistantToolV1({
      toolName: envelope.toolName,
      arguments: envelope.arguments,
      monitor,
    })
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
