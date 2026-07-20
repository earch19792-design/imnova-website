import { createHash } from "node:crypto"

import {
  getEbayProductionIdentityBindingConfiguration,
} from "./ebay-seller-account-scope"
import { verifyEbayCommercialOfficialAccount } from "./ebay-commercial-readers"
import { EBAY_READONLY_SCOPES } from "./ebay-seller-readonly-oauth-data-audit"

type JsonRecord = Record<string, unknown>

const API_ORIGIN = "https://api.ebay.com"
const TOKEN_ENDPOINT = `${API_ORIGIN}/identity/v1/oauth2/token`
const MARKETPLACE_ID = "EBAY_US"
const REQUEST_TIMEOUT_MS = 8_000
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])

type GatewayConfig = {
  clientId: string
  clientSecret: string
  refreshToken: string
  expectedAccountFingerprint: string
  identityBound: boolean
  identityConfigurationConsistent: boolean
  oauthConfigured: boolean
  configured: boolean
}

type CachedAuthentication = {
  token: string
  expiresAt: number
  actualFingerprint: string
  identityStatus: "BOUND"
  accountType: string
  registrationMarketplaceId: string
}

type ReadResult = {
  ok: boolean
  status: number
  body: JsonRecord
}

export type EbayAccountPolicyReadonlySelection = {
  fulfillmentPolicyId?: string
  paymentPolicyId?: string
  returnPolicyId?: string
  merchantLocationKey?: string
}

const authenticationCache = new Map<string, CachedAuthentication>()

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function credential(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : ""
}

function safeBody(value: JsonRecord) {
  const errors = Array.isArray(value.errors)
    ? value.errors.slice(0, 3).map((raw) => {
      const item = record(raw)
      return {
        errorId: String(item.errorId ?? "").slice(0, 40),
        domain: String(item.domain ?? "").slice(0, 80),
        category: String(item.category ?? "").slice(0, 80),
        message: String(item.message ?? "")
          .replace(/[\r\n]+/g, " ")
          .slice(0, 240),
      }
    })
    : []
  return { errors }
}

function gatewayConfig(): GatewayConfig {
  const clientId = credential(process.env.EBAY_CLIENT_ID)
  const clientSecret = credential(process.env.EBAY_CLIENT_SECRET)
  const refreshToken = credential(process.env.EBAY_SELLER_REFRESH_TOKEN)
  const identity = getEbayProductionIdentityBindingConfiguration()
  const oauthConfigured = Boolean(clientId && clientSecret && refreshToken)
  return {
    clientId,
    clientSecret,
    refreshToken,
    expectedAccountFingerprint: identity.expectedAccountFingerprint,
    identityBound: identity.bound,
    identityConfigurationConsistent: identity.consistent,
    oauthConfigured,
    configured: oauthConfigured && identity.bound && identity.consistent,
  }
}

function cacheKey(config: GatewayConfig) {
  return createHash("sha256").update([
    config.clientId,
    config.clientSecret,
    config.refreshToken,
    EBAY_READONLY_SCOPES.join(" "),
  ].join("\u0000")).digest("hex")
}

function assertAllowedGet(url: URL, method: string) {
  const privilege = method === "GET"
    && url.origin === API_ORIGIN
    && url.pathname === "/sell/account/v1/privilege"
    && url.search === ""
  const policies = method === "GET"
    && url.origin === API_ORIGIN
    && /^\/sell\/account\/v1\/(fulfillment_policy|payment_policy|return_policy)$/.test(url.pathname)
    && url.searchParams.get("marketplace_id") === MARKETPLACE_ID
    && [...url.searchParams.keys()].every((key) => key === "marketplace_id")
  const locations = method === "GET"
    && url.origin === API_ORIGIN
    && url.pathname === "/sell/inventory/v1/location"
    && [...url.searchParams.keys()].every((key) => key === "limit" || key === "offset")
    && /^\d{1,3}$/.test(url.searchParams.get("limit") ?? "")
    && /^\d{1,9}$/.test(url.searchParams.get("offset") ?? "")
  if (!privilege && !policies && !locations) {
    throw new Error("EBAY_ACCOUNT_POLICY_READONLY_ENDPOINT_BLOCKED")
  }
}

async function read(
  token: string,
  url: URL,
  fetchImpl: typeof fetch,
): Promise<ReadResult> {
  assertAllowedGet(url, "GET")
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const body = record(await response.json().catch(() => ({})))
      if (TRANSIENT_STATUSES.has(response.status) && attempt === 0) continue
      return {
        ok: response.ok,
        status: response.status,
        body: response.ok ? body : safeBody(body),
      }
    } catch {
      if (attempt === 0) continue
    }
  }
  return { ok: false, status: 0, body: {} }
}

async function authenticatedToken(
  config: GatewayConfig,
  fetchImpl: typeof fetch,
  forceRefresh = false,
) {
  if (!config.oauthConfigured) {
    throw new Error("EBAY_ACCOUNT_POLICY_READONLY_OAUTH_MISSING")
  }
  if (!config.identityConfigurationConsistent) {
    throw new Error("EBAY_ACCOUNT_POLICY_IDENTITY_CONFIGURATION_INCONSISTENT")
  }
  if (!config.identityBound || !config.expectedAccountFingerprint) {
    throw new Error("EBAY_ACCOUNT_POLICY_IDENTITY_UNBOUND")
  }
  const key = cacheKey(config)
  if (!forceRefresh) {
    const cached = authenticationCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached
  }
  authenticationCache.delete(key)

  let response: Response | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${config.clientId}:${config.clientSecret}`,
            "utf8",
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: config.refreshToken,
          scope: EBAY_READONLY_SCOPES.join(" "),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!TRANSIENT_STATUSES.has(response.status) || attempt === 1) break
    } catch {
      response = null
      if (attempt === 1) break
    }
  }
  if (!response) {
    throw new Error("EBAY_ACCOUNT_POLICY_READONLY_REQUEST_FAILED")
  }
  const body = record(await response.json().catch(() => ({})))
  if (!response.ok || typeof body.access_token !== "string" || !body.access_token) {
    const oauthError = typeof body.error === "string"
      ? body.error.trim().toLowerCase()
      : ""
    if (oauthError === "invalid_scope") {
      throw new Error("EBAY_ACCOUNT_POLICY_READONLY_SCOPE_REAUTH_REQUIRED")
    }
    if (oauthError === "invalid_grant") {
      throw new Error("EBAY_ACCOUNT_POLICY_REFRESH_TOKEN_INVALID")
    }
    if (oauthError === "invalid_client") {
      throw new Error("EBAY_ACCOUNT_POLICY_CLIENT_CREDENTIALS_INVALID")
    }
    throw new Error(`EBAY_ACCOUNT_POLICY_READONLY_OAUTH_${response.status}`)
  }

  const token = body.access_token
  await verifyEbayCommercialOfficialAccount(token, fetchImpl)
  const actualFingerprint = config.expectedAccountFingerprint
  const expiresInSeconds = Number(body.expires_in)
  const authenticated: CachedAuthentication = {
    token,
    actualFingerprint,
    identityStatus: "BOUND",
    accountType: "",
    registrationMarketplaceId: "",
    expiresAt: Number.isFinite(expiresInSeconds) && expiresInSeconds > 60
      ? Date.now() + (expiresInSeconds - 60) * 1_000
      : Date.now(),
  }
  if (authenticated.expiresAt > Date.now()) {
    authenticationCache.set(key, authenticated)
  }
  return authenticated
}

function normalizedPolicyId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^[A-Za-z0-9_-]{1,100}$/.test(normalized) ? normalized : null
}

function normalizedMerchantLocationKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^[A-Za-z0-9_-]{1,36}$/.test(normalized) ? normalized : null
}

function safeLabel(value: unknown) {
  return typeof value === "string"
    ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 100)
    : ""
}

function policyCategoryTypeNames(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(record(item).name ?? item).trim().toUpperCase())
    : []
}

function sanitizedPolicyOptions(
  value: JsonRecord,
  collection: string,
  idField: string,
  requireImmediatePay = false,
) {
  const rawItems = Array.isArray(value[collection])
    ? value[collection] as unknown[]
    : []
  return rawItems.map(record).flatMap((item) => {
    const id = normalizedPolicyId(item[idField])
    const marketplaceId = String(item.marketplaceId ?? "").trim().toUpperCase()
    if (!id || marketplaceId !== MARKETPLACE_ID) return []
    const categoryTypes = policyCategoryTypeNames(item.categoryTypes)
    const supportsNonMotors = categoryTypes.includes(
      "ALL_EXCLUDING_MOTORS_VEHICLES",
    )
    const immediatePayReady = !requireImmediatePay || item.immediatePay === true
    const usable = supportsNonMotors && immediatePayReady
    return [{
      id,
      name: safeLabel(item.name) || "Policy eBay",
      usable,
      status: usable
        ? "PUBLISH_READY"
        : !supportsNonMotors
          ? "CATEGORY_NOT_SUPPORTED"
          : "IMMEDIATE_PAY_REQUIRED",
    }]
  })
}

function sanitizedLocationOptions(value: JsonRecord) {
  const rawItems = Array.isArray(value.locations)
    ? value.locations as unknown[]
    : []
  return rawItems.map(record).flatMap((item) => {
    const id = normalizedMerchantLocationKey(item.merchantLocationKey)
    const status = String(item.merchantLocationStatus ?? "").trim().toUpperCase()
    if (!id) return []
    return [{
      id,
      name: safeLabel(item.name) || "Ubicación eBay",
      usable: status === "ENABLED",
      status: status === "ENABLED" ? "ENABLED" : "DISABLED",
    }]
  })
}

function selectedId(
  options: Array<{ id: string; usable: boolean }>,
  requested: unknown,
) {
  const requestedId = typeof requested === "string" ? requested.trim() : ""
  if (
    requestedId
    && options.some((option) => option.usable && option.id === requestedId)
  ) return requestedId
  const usable = options.filter((option) => option.usable)
  return usable.length === 1 ? usable[0].id : ""
}

function listUrl(resource: string) {
  const url = new URL(`/sell/account/v1/${resource}`, API_ORIGIN)
  url.searchParams.set("marketplace_id", MARKETPLACE_ID)
  return url
}

async function executePreflight(
  config: GatewayConfig,
  requested: EbayAccountPolicyReadonlySelection,
  fetchImpl: typeof fetch,
  forceRefresh: boolean,
) {
  const authenticated = await authenticatedToken(config, fetchImpl, forceRefresh)
  const locationUrl = new URL("/sell/inventory/v1/location", API_ORIGIN)
  locationUrl.searchParams.set("limit", "100")
  locationUrl.searchParams.set("offset", "0")
  const [privilege, fulfillment, payment, returns, locations] = await Promise.all([
    read(authenticated.token, new URL("/sell/account/v1/privilege", API_ORIGIN), fetchImpl),
    read(authenticated.token, listUrl("fulfillment_policy"), fetchImpl),
    read(authenticated.token, listUrl("payment_policy"), fetchImpl),
    read(authenticated.token, listUrl("return_policy"), fetchImpl),
    read(authenticated.token, locationUrl, fetchImpl),
  ])
  const reads = [privilege, fulfillment, payment, returns, locations]
  if (reads.some((result) => result.status === 401) && !forceRefresh) {
    return executePreflight(config, requested, fetchImpl, true)
  }
  if (reads.some((result) => !result.ok)) {
    throw new Error("EBAY_ACCOUNT_POLICY_READONLY_PREFLIGHT_UNAVAILABLE")
  }
  const options = {
    fulfillmentPolicies: sanitizedPolicyOptions(
      fulfillment.body,
      "fulfillmentPolicies",
      "fulfillmentPolicyId",
    ),
    paymentPolicies: sanitizedPolicyOptions(
      payment.body,
      "paymentPolicies",
      "paymentPolicyId",
      true,
    ),
    returnPolicies: sanitizedPolicyOptions(
      returns.body,
      "returnPolicies",
      "returnPolicyId",
    ),
    merchantLocations: sanitizedLocationOptions(locations.body),
  }
  const selection = {
    fulfillmentPolicyId: selectedId(
      options.fulfillmentPolicies,
      requested.fulfillmentPolicyId,
    ),
    paymentPolicyId: selectedId(
      options.paymentPolicies,
      requested.paymentPolicyId,
    ),
    returnPolicyId: selectedId(
      options.returnPolicies,
      requested.returnPolicyId,
    ),
    merchantLocationKey: selectedId(
      options.merchantLocations,
      requested.merchantLocationKey,
    ),
  }
  const selectionComplete = Object.values(selection).every(Boolean)
  const sellerRegistrationCompleted =
    privilege.body.sellerRegistrationCompleted === true
  const sellingLimitPresent = privilege.body.sellingLimit !== null
    && privilege.body.sellingLimit !== undefined
  const sellingLimitAmount = Number(
    record(record(privilege.body.sellingLimit).amount).value,
  )
  const sellingLimitZero = sellingLimitPresent
    && Number.isFinite(sellingLimitAmount)
    && sellingLimitAmount <= 0
  return {
    mode: "GET_ONLY" as const,
    target: "PRODUCTION" as const,
    marketplaceId: MARKETPLACE_ID,
    identity: {
      status: authenticated.identityStatus,
      accountFingerprint: authenticated.actualFingerprint,
      expectedIdentityConfigured: config.identityBound,
      accountType: authenticated.accountType,
      registrationMarketplaceId: authenticated.registrationMarketplaceId,
    },
    privilege: {
      sellerRegistrationCompleted,
      sellingLimitPresent,
      sellingLimitZero,
      usable: sellerRegistrationCompleted,
    },
    options,
    selection,
    selectionComplete,
    snapshot: "",
    snapshotExpiresAt: null,
    snapshotStatus: !sellerRegistrationCompleted
      ? "SELLER_PRIVILEGE_BLOCKED"
      : selectionComplete
        ? "PROFILE_READY"
        : "SELECTION_REQUIRED",
    warnings: sellingLimitZero ? ["SELLING_LIMIT_ZERO_PUBLISH_BLOCKED"] : [],
    sanitized: true,
  }
}

export async function preflightEbayAccountPoliciesReadonly(
  requested: EbayAccountPolicyReadonlySelection = {},
  fetchImpl: typeof fetch = fetch,
) {
  const config = gatewayConfig()
  if (!config.configured) {
    if (!config.oauthConfigured) {
      throw new Error("EBAY_ACCOUNT_POLICY_READONLY_OAUTH_MISSING")
    }
    throw new Error("EBAY_ACCOUNT_POLICY_IDENTITY_UNBOUND")
  }
  return executePreflight(config, requested, fetchImpl, false)
}

export function ebayAccountPolicyReadonlyRuntimeStatus() {
  const config = gatewayConfig()
  return {
    mode: "GET_ONLY" as const,
    target: "PRODUCTION" as const,
    configured: config.configured,
    oauthConfigured: config.oauthConfigured,
    identityBound: config.identityBound,
    scopes: [...EBAY_READONLY_SCOPES],
    ebayResourceMethods: ["GET", "POST:GetUser(read-only)"],
    oauthTokenExchangeMethod: "POST",
    ebayWriteMethods: [],
    canPublish: false,
  }
}
