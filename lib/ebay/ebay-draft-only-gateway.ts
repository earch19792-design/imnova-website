import type { JsonRecord } from "./ebay-draft-only-readiness"

const DRAFT_ONLY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
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

export type EbayDraftOnlyDependencyInput = {
  fulfillmentPolicyId: string
  paymentPolicyId: string
  returnPolicyId: string
  merchantLocationKey: string
}

type ReadResult = {
  ok: boolean
  status: number
  body: JsonRecord
}

type DependencyCheck = {
  valid: boolean
  httpStatus: number
}

type DependencyChecks = {
  fulfillmentPolicy: DependencyCheck
  paymentPolicy: DependencyCheck
  returnPolicy: DependencyCheck
  merchantLocation: DependencyCheck & { enabled: boolean }
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
      scope: DRAFT_ONLY_SCOPE,
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

function assertAllowedPreflightRead(config: GatewayConfig, url: URL, method: string) {
  const inventoryItem = method === "GET" && /^\/sell\/inventory\/v1\/inventory_item\/[^/]+$/.test(url.pathname)
  const offers = method === "GET"
    && url.pathname === "/sell/inventory/v1/offer"
    && Boolean(url.searchParams.get("sku"))
    && [...url.searchParams.keys()].every((key) => key === "sku" || key === "limit")
  const businessPolicy = method === "GET"
    && /^\/sell\/account\/v1\/(fulfillment_policy|payment_policy|return_policy)\/[^/]+$/.test(url.pathname)
    && url.search === ""
  const merchantLocation = method === "GET"
    && /^\/sell\/inventory\/v1\/location\/[^/]+$/.test(url.pathname)
    && url.search === ""
  if (url.origin !== config.apiOrigin || (!inventoryItem && !offers && !businessPolicy && !merchantLocation)) {
    throw new Error("EBAY_DRAFT_ONLY_PREFLIGHT_ENDPOINT_BLOCKED")
  }
}

async function preflightRead(
  config: GatewayConfig,
  token: string,
  url: URL,
  fetchImpl: typeof fetch,
): Promise<ReadResult> {
  assertAllowedPreflightRead(config, url, "GET")
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

function blankDependencyChecks(): DependencyChecks {
  return {
    fulfillmentPolicy: { valid: false, httpStatus: 0 },
    paymentPolicy: { valid: false, httpStatus: 0 },
    returnPolicy: { valid: false, httpStatus: 0 },
    merchantLocation: { valid: false, enabled: false, httpStatus: 0 },
  }
}

function unavailableRead(result: ReadResult) {
  return result.status === 0
    || result.status === 401
    || result.status === 403
    || result.status === 429
    || result.status >= 500
}

function normalizedDependency(value: string, maximumLength: number) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : null
}

async function preflightSkuCollisionWithToken(
  config: GatewayConfig,
  token: string,
  sku: string,
  fetchImpl: typeof fetch,
) {
  const inventoryUrl = new URL(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, config.apiOrigin)
  const offerUrl = new URL("/sell/inventory/v1/offer", config.apiOrigin)
  offerUrl.searchParams.set("sku", sku)
  offerUrl.searchParams.set("limit", "100")
  const [inventory, offers] = await Promise.all([
    preflightRead(config, token, inventoryUrl, fetchImpl),
    preflightRead(config, token, offerUrl, fetchImpl),
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

async function preflightDependenciesWithToken(
  config: GatewayConfig,
  token: string,
  input: EbayDraftOnlyDependencyInput,
  fetchImpl: typeof fetch,
) {
  const fulfillmentPolicyId = normalizedDependency(input.fulfillmentPolicyId, 100)
  const paymentPolicyId = normalizedDependency(input.paymentPolicyId, 100)
  const returnPolicyId = normalizedDependency(input.returnPolicyId, 100)
  const merchantLocationKey = normalizedDependency(input.merchantLocationKey, 36)
  const invalidInput = [
    [fulfillmentPolicyId, "EBAY_FULFILLMENT_POLICY_INVALID"],
    [paymentPolicyId, "EBAY_PAYMENT_POLICY_INVALID"],
    [returnPolicyId, "EBAY_RETURN_POLICY_INVALID"],
    [merchantLocationKey, "EBAY_MERCHANT_LOCATION_INVALID"],
  ].find(([value]) => !value)
  if (invalidInput) {
    return {
      safe: false,
      terminal: false,
      blocker: invalidInput[1] as string,
      checks: blankDependencyChecks(),
    }
  }

  const policySpecs = [
    {
      name: "fulfillmentPolicy" as const,
      resource: "fulfillment_policy",
      id: fulfillmentPolicyId as string,
      idField: "fulfillmentPolicyId",
      blocker: "EBAY_FULFILLMENT_POLICY_INVALID",
    },
    {
      name: "paymentPolicy" as const,
      resource: "payment_policy",
      id: paymentPolicyId as string,
      idField: "paymentPolicyId",
      blocker: "EBAY_PAYMENT_POLICY_INVALID",
    },
    {
      name: "returnPolicy" as const,
      resource: "return_policy",
      id: returnPolicyId as string,
      idField: "returnPolicyId",
      blocker: "EBAY_RETURN_POLICY_INVALID",
    },
  ]
  const locationUrl = new URL(
    `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey as string)}`,
    config.apiOrigin,
  )
  const [policyResults, locationResult] = await Promise.all([
    Promise.all(policySpecs.map((policy) => preflightRead(
      config,
      token,
      new URL(`/sell/account/v1/${policy.resource}/${encodeURIComponent(policy.id)}`, config.apiOrigin),
      fetchImpl,
    ))),
    preflightRead(config, token, locationUrl, fetchImpl),
  ])
  const checks = blankDependencyChecks()
  policySpecs.forEach((policy, index) => {
    checks[policy.name] = { valid: false, httpStatus: policyResults[index].status }
  })
  checks.merchantLocation.httpStatus = locationResult.status

  if ([...policyResults, locationResult].some(unavailableRead)) {
    return {
      safe: false,
      terminal: false,
      blocker: "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE",
      checks,
    }
  }

  for (let index = 0; index < policySpecs.length; index += 1) {
    const policy = policySpecs[index]
    const result = policyResults[index]
    if (!result.ok) {
      return { safe: false, terminal: false, blocker: policy.blocker, checks }
    }
    const rawReturnedId = result.body[policy.idField]
    const returnedId = typeof rawReturnedId === "string"
      ? rawReturnedId.trim()
      : ""
    const marketplaceId = typeof result.body.marketplaceId === "string"
      ? result.body.marketplaceId.trim()
      : ""
    if (!returnedId || !marketplaceId) {
      return {
        safe: false,
        terminal: false,
        blocker: "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE",
        checks,
      }
    }
    if (returnedId !== policy.id || marketplaceId !== "EBAY_US") {
      return { safe: false, terminal: false, blocker: policy.blocker, checks }
    }
    checks[policy.name].valid = true
  }

  if (!locationResult.ok) {
    return { safe: false, terminal: false, blocker: "EBAY_MERCHANT_LOCATION_INVALID", checks }
  }
  const returnedLocationKey = typeof locationResult.body.merchantLocationKey === "string"
    ? locationResult.body.merchantLocationKey.trim()
    : ""
  const locationStatus = typeof locationResult.body.merchantLocationStatus === "string"
    ? locationResult.body.merchantLocationStatus.trim().toUpperCase()
    : ""
  if (!returnedLocationKey || !locationStatus) {
    return {
      safe: false,
      terminal: false,
      blocker: "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE",
      checks,
    }
  }
  if (returnedLocationKey !== merchantLocationKey) {
    return { safe: false, terminal: false, blocker: "EBAY_MERCHANT_LOCATION_INVALID", checks }
  }
  if (locationStatus !== "ENABLED") {
    return { safe: false, terminal: false, blocker: "EBAY_MERCHANT_LOCATION_DISABLED", checks }
  }
  checks.merchantLocation.valid = true
  checks.merchantLocation.enabled = true
  return { safe: true, terminal: false, blocker: null, checks }
}

export async function preflightEbayDraftSkuCollision(
  sku: string,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl)
  return preflightSkuCollisionWithToken(config, token, sku, fetchImpl)
}

export async function preflightEbayDraftDependencies(
  input: EbayDraftOnlyDependencyInput,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl)
  return preflightDependenciesWithToken(config, token, input, fetchImpl)
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
    requiredOAuthScopes: ["sell.inventory", "sell.account"],
    requiredReadOperations: [
      "GET SKU and offers collision preflight",
      "GET fulfillment/payment/return policies by ID",
      "GET merchant location and require ENABLED",
    ],
    allowedWriteOperations: ["PUT createOrReplaceInventoryItem", "POST createOffer (UNPUBLISHED)"],
    forbiddenOperation: "publishOffer",
    canPublish: false,
  }
}
