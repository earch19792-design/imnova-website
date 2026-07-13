import type { JsonRecord } from "./ebay-draft-only-readiness"

const INVENTORY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
].join(" ")
const REQUEST_TIMEOUT_MS = 12_000
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])

type DraftTarget = "SANDBOX"

type GatewayConfig = {
  enabled: boolean
  configured: boolean
  target: DraftTarget
  apiOrigin: string
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  refreshToken: string
}

type GatewayResult = {
  ok: boolean
  status: number
  body: JsonRecord
  outcomeKnown: boolean
  retryable: boolean
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function safeBody(value: JsonRecord) {
  const errors = Array.isArray(value.errors) ? value.errors.slice(0, 3).map((raw) => {
    const item = record(raw)
    return {
      errorId: String(item.errorId ?? "").slice(0, 40),
      domain: String(item.domain ?? "").slice(0, 80),
      category: String(item.category ?? "").slice(0, 80),
      message: String(item.message ?? "").replace(/[\r\n]+/g, " ").slice(0, 240),
    }
  }) : []
  return { errors }
}

export function getEbayDraftOnlyGatewayConfig(): GatewayConfig {
  const targetValue = (process.env.EBAY_DRAFT_ONLY_TARGET?.trim().toUpperCase() || "SANDBOX")
  if (targetValue !== "SANDBOX") throw new Error("EBAY_DRAFT_ONLY_TARGET_FORBIDDEN")
  const clientId = process.env.EBAY_DRAFT_ONLY_CLIENT_ID?.trim()
    || process.env.EBAY_SANDBOX_CLIENT_ID?.trim()
    || ""
  const clientSecret = process.env.EBAY_DRAFT_ONLY_CLIENT_SECRET?.trim()
    || process.env.EBAY_SANDBOX_CLIENT_SECRET?.trim()
    || ""
  const refreshToken = process.env.EBAY_DRAFT_ONLY_REFRESH_TOKEN?.trim() || ""
  return {
    enabled: process.env.EBAY_DRAFT_ONLY_WRITES_ENABLED === "true",
    configured: Boolean(clientId && clientSecret && refreshToken),
    target: "SANDBOX",
    apiOrigin: "https://api.sandbox.ebay.com",
    tokenEndpoint: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    clientId,
    clientSecret,
    refreshToken,
  }
}

async function accessToken(config: GatewayConfig, fetchImpl: typeof fetch) {
  if (!config.enabled) throw new Error("EBAY_DRAFT_ONLY_WRITES_DISABLED")
  if (!config.configured) throw new Error("EBAY_DRAFT_ONLY_WRITE_OAUTH_MISSING")
  const response = await fetchImpl(config.tokenEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      scope: INVENTORY_SCOPE,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const body = record(await response.json().catch(() => ({})))
  if (!response.ok || typeof body.access_token !== "string" || !body.access_token) {
    throw new Error(`EBAY_DRAFT_ONLY_OAUTH_${response.status}`)
  }
  return body.access_token
}

function assertAllowedInventoryWrite(config: GatewayConfig, url: URL, method: string) {
  const inventoryItem = method === "PUT" && /^\/sell\/inventory\/v1\/inventory_item\/[^/]+$/.test(url.pathname)
  const createOffer = method === "POST" && url.pathname === "/sell/inventory/v1/offer"
  if (url.origin !== config.apiOrigin || (!inventoryItem && !createOffer)) {
    throw new Error("EBAY_DRAFT_ONLY_ENDPOINT_BLOCKED")
  }
  if (url.pathname.includes("publish_offer") || url.pathname.includes("withdraw_offer")) {
    throw new Error("EBAY_DRAFT_ONLY_PUBLISH_FORBIDDEN")
  }
}

function assertAllowedCollisionRead(config: GatewayConfig, url: URL, method: string) {
  const inventoryItem = method === "GET" && /^\/sell\/inventory\/v1\/inventory_item\/[^/]+$/.test(url.pathname)
  const offers = method === "GET" && url.pathname === "/sell/inventory/v1/offer" && Boolean(url.searchParams.get("sku"))
  if (url.origin !== config.apiOrigin || (!inventoryItem && !offers)) {
    throw new Error("EBAY_DRAFT_ONLY_PREFLIGHT_ENDPOINT_BLOCKED")
  }
}

async function collisionRead(config: GatewayConfig, token: string, url: URL, fetchImpl: typeof fetch) {
  assertAllowedCollisionRead(config, url, "GET")
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = record(await response.json().catch(() => ({})))
    return {
      ok: response.ok,
      status: response.status,
      body: (response.ok ? body : safeBody(body)) as JsonRecord,
    }
  } catch {
    return { ok: false, status: 0, body: {} as JsonRecord }
  }
}

export async function preflightEbayDraftSkuCollision(
  sku: string,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl)
  const inventoryUrl = new URL(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, config.apiOrigin)
  const offerUrl = new URL("/sell/inventory/v1/offer", config.apiOrigin)
  offerUrl.searchParams.set("sku", sku)
  offerUrl.searchParams.set("limit", "100")
  const [inventory, offers] = await Promise.all([
    collisionRead(config, token, inventoryUrl, fetchImpl),
    collisionRead(config, token, offerUrl, fetchImpl),
  ])
  const inventoryAbsent = inventory.status === 404
  const offersKnown = offers.ok && Array.isArray(offers.body.offers)
  if ((!inventory.ok && !inventoryAbsent) || !offersKnown) {
    return { safe: false, collision: false, blocker: "EBAY_SKU_PREFLIGHT_UNAVAILABLE" }
  }
  const offerCount = (offers.body.offers as unknown[]).length
  return {
    safe: inventoryAbsent && offerCount === 0,
    collision: inventory.ok || offerCount > 0,
    blocker: inventory.ok || offerCount > 0 ? "EBAY_SKU_ALREADY_EXISTS" : null,
  }
}

async function write(
  config: GatewayConfig,
  token: string,
  url: URL,
  method: "PUT" | "POST",
  payload: JsonRecord,
  fetchImpl: typeof fetch,
): Promise<GatewayResult> {
  assertAllowedInventoryWrite(config, url, method)
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const body = record(await response.json().catch(() => ({})))
    return {
      ok: response.ok,
      status: response.status,
      body: response.ok ? body : safeBody(body),
      outcomeKnown: response.ok || response.status < 500,
      retryable: TRANSIENT_STATUSES.has(response.status),
    }
  } catch {
    return { ok: false, status: 0, body: {}, outcomeKnown: false, retryable: false }
  }
}

export async function createOrReplaceEbayDraftInventoryItem(
  sku: string,
  payload: JsonRecord,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl)
  const url = new URL(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, config.apiOrigin)
  let result: GatewayResult = { ok: false, status: 0, body: {}, outcomeKnown: false, retryable: false }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await write(config, token, url, "PUT", payload, fetchImpl)
    if (result.ok || !result.retryable) break
  }
  return result
}

export async function createEbayUnpublishedOffer(
  payload: JsonRecord,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl)
  const url = new URL("/sell/inventory/v1/offer", config.apiOrigin)
  // createOffer is deliberately attempted once. A timeout/5xx has an unknown
  // outcome and must be reconciled manually; retrying POST could duplicate it.
  return write(config, token, url, "POST", payload, fetchImpl)
}

export function sanitizeEbayOfferId(value: unknown) {
  const offerId = typeof value === "string" ? value.trim() : ""
  return /^[A-Za-z0-9_-]{1,80}$/.test(offerId) ? offerId : null
}

export function ebayDraftOnlyRuntimeStatus() {
  const config = getEbayDraftOnlyGatewayConfig()
  return {
    enabled: config.enabled,
    configured: config.configured,
    target: config.target,
    allowedWriteOperations: ["PUT createOrReplaceInventoryItem", "POST createOffer (UNPUBLISHED)"],
    forbiddenOperation: "publishOffer",
    canPublish: false,
  }
}
