import { createHash } from "node:crypto"

import {
  getEbayProductionIdentityBindingConfiguration,
} from "./ebay-seller-account-scope"
import { verifyEbayCommercialOfficialAccount } from "./ebay-commercial-readers"
import { EBAY_READONLY_SCOPES } from "./ebay-seller-readonly-oauth-data-audit"
import { parseEbaySellerStoreSubscriptionReadonly } from
  "./ebay-account-subscription-readonly-domain"

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

function sanitizedEbayErrorId(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase()
  return /^[A-Z0-9_-]{1,40}$/.test(normalized)
    ? normalized.replaceAll("-", "_")
    : ""
}

function safeBody(value: JsonRecord) {
  const errors = Array.isArray(value.errors)
    ? value.errors.slice(0, 3).map((raw) => {
      const item = record(raw)
      return {
        errorId: sanitizedEbayErrorId(item.errorId),
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

function gatewayConfig(refreshTokenOverride = ""): GatewayConfig {
  const clientId = credential(process.env.EBAY_CLIENT_ID)
  const clientSecret = credential(process.env.EBAY_CLIENT_SECRET)
  const refreshToken = credential(refreshTokenOverride)
    || credential(process.env.EBAY_SELLER_REFRESH_TOKEN)
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
  const optedInPrograms = method === "GET"
    && url.origin === API_ORIGIN
    && url.pathname === "/sell/account/v1/program/get_opted_in_programs"
    && url.search === ""
  const privilege = method === "GET"
    && url.origin === API_ORIGIN
    && url.pathname === "/sell/account/v1/privilege"
    && url.search === ""
  const subscriptions = method === "GET"
    && url.origin === API_ORIGIN
    && url.pathname === "/sell/account/v1/subscription"
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
  const inventoryItem = method === "GET"
    && url.origin === API_ORIGIN
    && /^\/sell\/inventory\/v1\/inventory_item\/[^/]{1,300}$/.test(url.pathname)
    && url.search === ""
  const offersBySku = method === "GET"
    && url.origin === API_ORIGIN
    && url.pathname === "/sell/inventory/v1/offer"
    && [...url.searchParams.keys()].every((key) =>
      key === "sku" || key === "limit")
    && (url.searchParams.get("sku")?.length ?? 0) >= 1
    && (url.searchParams.get("sku")?.length ?? 0) <= 50
    && url.searchParams.get("limit") === "100"
  if (!optedInPrograms && !privilege && !subscriptions && !policies &&
    !locations && !inventoryItem && !offersBySku) {
    throw new Error("EBAY_ACCOUNT_POLICY_READONLY_ENDPOINT_BLOCKED")
  }
}

async function refreshAccessToken(
  config: GatewayConfig,
  fetchImpl: typeof fetch,
) {
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
  if (!response.ok || typeof body.access_token !== "string" ||
    !body.access_token) {
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
  return {
    token: body.access_token,
    expiresInSeconds: Number(body.expires_in),
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
          "Accept-Language": "en-US",
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

function failedReadCode(resource: string, result: ReadResult) {
  const firstError = Array.isArray(result.body.errors)
    ? record(result.body.errors[0])
    : {}
  const errorId = sanitizedEbayErrorId(firstError.errorId)
  return "EBAY_ACCOUNT_POLICY_READONLY_" + resource + "_"
    + String(result.status || "UNAVAILABLE")
    + (errorId ? "_EBAY_ERROR_" + errorId : "")
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

  const refreshed = await refreshAccessToken(config, fetchImpl)
  const token = refreshed.token
  await verifyEbayCommercialOfficialAccount(token, fetchImpl)
  const actualFingerprint = config.expectedAccountFingerprint
  const expiresInSeconds = refreshed.expiresInSeconds
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

export async function readCanonicalEbayListingManagementResourcesV1(input: {
  sku: string
  durableAccountIdentityProven: boolean
  refreshTokenOverride?: string
  fetchImpl?: typeof fetch
}) {
  const sku = input.sku.trim()
  if (!sku || sku.length > 50 || /[\u0000-\u001f\u007f]/.test(sku)) {
    throw new Error("EBAY_LISTING_MANAGEMENT_IDENTITY_INVALID")
  }
  if (!input.durableAccountIdentityProven) {
    throw new Error("EBAY_LISTING_MANAGEMENT_ACCOUNT_IDENTITY_UNPROVEN")
  }
  const config = gatewayConfig(input.refreshTokenOverride)
  if (!config.configured) {
    throw new Error(config.oauthConfigured
      ? "EBAY_ACCOUNT_POLICY_IDENTITY_UNBOUND"
      : "EBAY_ACCOUNT_POLICY_READONLY_OAUTH_MISSING")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  let token = (await refreshAccessToken(config, fetchImpl)).token
  try {
    const inventoryUrl = new URL(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      API_ORIGIN,
    )
    const offersUrl = new URL("/sell/inventory/v1/offer", API_ORIGIN)
    offersUrl.searchParams.set("sku", sku)
    offersUrl.searchParams.set("limit", "100")
    const [inventory, offers] = await Promise.all([
      read(token, inventoryUrl, fetchImpl),
      read(token, offersUrl, fetchImpl),
    ])
    return Object.freeze({
      inventory,
      offers,
      marketplaceId: MARKETPLACE_ID,
      accountFingerprint: config.expectedAccountFingerprint,
      sourceAuthority:
        "FRESH_ACCOUNT_BOUND_EBAY_INVENTORY_READONLY_V1" as const,
      observedAt: new Date().toISOString(),
    })
  } finally {
    token = ""
  }
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
  const optedInPrograms = await read(
    authenticated.token,
    new URL(
      "/sell/account/v1/program/get_opted_in_programs",
      API_ORIGIN,
    ),
    fetchImpl,
  )
  if (optedInPrograms.status === 401 && !forceRefresh) {
    return executePreflight(config, requested, fetchImpl, true)
  }
  if (!optedInPrograms.ok) {
    throw new Error(failedReadCode("OPTED_IN_PROGRAMS", optedInPrograms))
  }
  const sellingPolicyManagementEnabled = Array.isArray(
    optedInPrograms.body.programs,
  ) && optedInPrograms.body.programs.some((value) => (
    String(record(value).programType ?? "").trim().toUpperCase()
      === "SELLING_POLICY_MANAGEMENT"
  ))
  if (!sellingPolicyManagementEnabled) {
    throw new Error(
      "EBAY_ACCOUNT_POLICY_SELLING_POLICY_MANAGEMENT_NOT_OPTED_IN",
    )
  }
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
    const names = [
      "PRIVILEGE",
      "FULFILLMENT_POLICIES",
      "PAYMENT_POLICIES",
      "RETURN_POLICIES",
      "MERCHANT_LOCATIONS",
    ]
    const failedIndex = reads.findIndex((result) => !result.ok)
    throw new Error(
      failedReadCode(
        names[failedIndex] ?? "RESOURCE",
        reads[failedIndex] ?? { ok: false, status: 0, body: {} },
      ),
    )
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
  refreshTokenOverride = "",
) {
  const config = gatewayConfig(refreshTokenOverride)
  if (!config.configured) {
    if (!config.oauthConfigured) {
      throw new Error("EBAY_ACCOUNT_POLICY_READONLY_OAUTH_MISSING")
    }
    throw new Error("EBAY_ACCOUNT_POLICY_IDENTITY_UNBOUND")
  }
  return executePreflight(config, requested, fetchImpl, false)
}

/**
 * Canonical account identity authority shared by owner-facing control planes.
 * It intentionally proves only the current official account binding; listing
 * management models and write credential profiles remain separate execution
 * concerns.
 */
export async function readCanonicalEbayAccountIdentityAuthorityV1(
  fetchImpl: typeof fetch = fetch,
  refreshTokenOverride = "",
) {
  const config = gatewayConfig(refreshTokenOverride)
  if (!config.configured) {
    if (!config.oauthConfigured) {
      throw new Error("EBAY_ACCOUNT_POLICY_READONLY_OAUTH_MISSING")
    }
    throw new Error("EBAY_ACCOUNT_POLICY_IDENTITY_UNBOUND")
  }
  const authenticated = await authenticatedToken(config, fetchImpl, false)
  return Object.freeze({
    status: authenticated.identityStatus,
    proven: authenticated.identityStatus === "BOUND",
    sourceAuthority: "OFFICIAL_EBAY_ACCOUNT_IDENTITY_READ_V1" as const,
    observedAt: new Date().toISOString(),
    marketplaceId: MARKETPLACE_ID,
    sanitized: true,
  })
}

export async function readEbaySellerStoreSubscriptionReadonly(
  fetchImpl: typeof fetch = fetch,
) {
  const config = gatewayConfig()
  if (!config.configured) {
    if (!config.oauthConfigured) {
      throw new Error("EBAY_ACCOUNT_POLICY_READONLY_OAUTH_MISSING")
    }
    throw new Error("EBAY_ACCOUNT_POLICY_IDENTITY_UNBOUND")
  }
  const execute = async (forceRefresh: boolean): Promise<ReturnType<
    typeof parseEbaySellerStoreSubscriptionReadonly
  >> => {
    const authenticated = await authenticatedToken(config, fetchImpl, forceRefresh)
    const result = await read(
      authenticated.token,
      new URL("/sell/account/v1/subscription", API_ORIGIN),
      fetchImpl,
    )
    if (result.status === 401 && !forceRefresh) return execute(true)
    if (!result.ok) {
      throw new Error(failedReadCode("SUBSCRIPTIONS", result))
    }
    return parseEbaySellerStoreSubscriptionReadonly(result.body)
  }
  return execute(false)
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
