import { createHash } from "node:crypto"

import type { JsonRecord } from "./ebay-draft-only-readiness"
import {
  issueEbayDraftOnlyPreflightSnapshot,
  verifyEbayDraftOnlyPreflightSnapshot,
} from "./ebay-draft-only-preflight-snapshot"
import { isCanonicalEbayPackageSku } from "./ebay-sku"
import { readEbayTradingUserIdWithAccessToken } from "./ebay-trading-identity-proof"
import { getEbayDraftWriteEnvironmentBoundary } from "./environment-boundaries"

const DRAFT_ONLY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
].join(" ")
const REQUEST_TIMEOUT_MS = 12_000
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])
const PREFLIGHT_READ_ATTEMPTS = 2
const PREFLIGHT_READ_RETRY_DELAY_MS = 150
const EBAY_ACCEPT_LANGUAGE = "en-US"

export type EbayDraftOnlyTarget = "SANDBOX" | "PRODUCTION"

export const EBAY_FINAL_PUBLISH_CONFIRMATION = "PUBLICAR LISTING EN EBAY"

type GatewayConfig = {
  enabled: boolean
  masterEnabled: boolean
  targetEnabled: boolean
  environmentAllowed: boolean
  configured: boolean
  oauthConfigured: boolean
  identityBound: boolean
  snapshotConfigured: boolean
  target: EbayDraftOnlyTarget
  apiOrigin: string
  identityOrigin: string
  tokenEndpoint: string
  clientId: string
  clientSecret: string
  refreshToken: string
  expectedUserId: string
  expectedAccountFingerprint: string
  identityConfigurationConsistent: boolean
  accountFingerprint: string
  snapshotSecret: string
}

type GatewayResult = {
  ok: boolean
  status: number
  body: JsonRecord
  outcomeKnown: boolean
  retryable: boolean
  reconciled?: boolean
}

export type EbayDraftOnlyDependencyInput = {
  fulfillmentPolicyId: string
  paymentPolicyId: string
  returnPolicyId: string
  merchantLocationKey: string
  preflightSnapshot: string
}

type ReadResult = {
  ok: boolean
  status: number
  body: JsonRecord
  attempts?: number
}

type CachedAuthentication = {
  token: string
  expiresAt: number
  actualFingerprint: string
  maskedSellerAccountId: string
  accountType: string
  registrationMarketplaceId: string
}

const authenticationCache = new Map<string, CachedAuthentication>()

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

export type EbayDraftOnlyPreflightSelection = {
  fulfillmentPolicyId?: string
  paymentPolicyId?: string
  returnPolicyId?: string
  merchantLocationKey?: string
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

function safeReadErrors(result: ReadResult) {
  return Array.isArray(result.body.errors)
    ? result.body.errors.map(record).filter((item) => item.errorId)
    : []
}

function readErrorIds(result: ReadResult) {
  return safeReadErrors(result)
    .map((item) => String(item.errorId ?? "").trim())
    .filter(Boolean)
}

function isInventoryAbsenceResponse(result: ReadResult) {
  if (result.status === 404) return true
  if (result.status !== 400) return false
  const errors = safeReadErrors(result)
  return errors.length > 0 && errors.every((item) =>
    ["25702", "25710"].includes(String(item.errorId ?? "").trim())
    && item.domain === "API_INVENTORY"
    && item.category === "REQUEST"
  )
}

function accountFingerprint(target: EbayDraftOnlyTarget, userId: string) {
  return userId
    ? createHash("sha256").update(`${target}:${userId}`).digest("hex")
    : ""
}

function maskedSellerAccountId(value: string) {
  const normalized = value.trim().replace(/[\r\n\t]/g, "").slice(0, 128)
  if (!normalized) return ""
  if (normalized.length <= 4) {
    return `${normalized.slice(0, 1)}${"•".repeat(Math.max(2, normalized.length))}${normalized.slice(-1)}`
  }
  return `${normalized.slice(0, 2)}${"•".repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-2)}`
}

function normalizedFingerprint(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : ""
}

function authenticationCacheKey(config: GatewayConfig) {
  return createHash("sha256").update([
    config.target,
    config.clientId,
    config.clientSecret,
    config.refreshToken,
  ].join("\u0000")).digest("hex")
}

function boundIdentityStatus(config: GatewayConfig, actualFingerprint: string) {
  if (!config.identityConfigurationConsistent) return "IDENTITY_MISMATCH" as const
  if (!config.identityBound) return "IDENTITY_UNBOUND" as const
  return actualFingerprint === config.accountFingerprint
    ? "BOUND" as const
    : "IDENTITY_MISMATCH" as const
}

export function getEbayDraftOnlyGatewayConfig(): GatewayConfig {
  const targetValue = (process.env.EBAY_DRAFT_ONLY_TARGET?.trim().toUpperCase() || "SANDBOX")
  if (targetValue !== "SANDBOX" && targetValue !== "PRODUCTION") {
    throw new Error("EBAY_DRAFT_ONLY_TARGET_FORBIDDEN")
  }
  const target = targetValue as EbayDraftOnlyTarget
  // Production is intentionally isolated from every generic and Sandbox
  // credential. Pointing the target at PRODUCTION can never reuse the
  // read-only seller token or a Sandbox keyset by accident.
  const clientId = target === "PRODUCTION"
    ? process.env.EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID?.trim() || ""
    : process.env.EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID?.trim() || ""
  const clientSecret = target === "PRODUCTION"
    ? process.env.EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET?.trim() || ""
    : process.env.EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET?.trim() || ""
  const refreshToken = target === "PRODUCTION"
    ? process.env.EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN?.trim() || ""
    : process.env.EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN?.trim() || ""
  const expectedUserId = target === "PRODUCTION"
    ? process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID?.trim() || ""
    : process.env.EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID?.trim() || ""
  const expectedAccountFingerprint = normalizedFingerprint(target === "PRODUCTION"
    ? process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT
      || process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
    : process.env.EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_CREDENTIAL_FINGERPRINT
      || process.env.EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_ACCOUNT_FINGERPRINT)
  const snapshotSecret = target === "PRODUCTION"
    ? process.env.EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_HMAC_SECRET?.trim()
      || process.env.EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET?.trim()
      || ""
    : process.env.EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_HMAC_SECRET?.trim()
      || process.env.EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET?.trim()
      || ""
  const oauthConfigured = Boolean(clientId && clientSecret && refreshToken)
  const derivedExpectedFingerprint = accountFingerprint(target, expectedUserId)
  const boundAccountFingerprint = expectedAccountFingerprint || derivedExpectedFingerprint
  const identityConfigurationConsistent = !(
    expectedAccountFingerprint
    && derivedExpectedFingerprint
    && expectedAccountFingerprint !== derivedExpectedFingerprint
  )
  const identityBound = Boolean(boundAccountFingerprint) && identityConfigurationConsistent
  const snapshotConfigured = snapshotSecret.length >= 32
  const environmentBoundary = getEbayDraftWriteEnvironmentBoundary({
    draftTarget: target,
  })
  const masterEnabled = environmentBoundary.masterEnabled
  const environmentAllowed = environmentBoundary.environmentAllowed
  const targetEnabled = environmentBoundary.targetEnabled
  const apiOrigin = target === "PRODUCTION"
    ? "https://api.ebay.com"
    : "https://api.sandbox.ebay.com"
  const identityOrigin = target === "PRODUCTION"
    ? "https://apiz.ebay.com"
    : "https://apiz.sandbox.ebay.com"
  return {
    enabled: masterEnabled && targetEnabled,
    masterEnabled,
    targetEnabled,
    environmentAllowed,
    configured: oauthConfigured && identityBound && snapshotConfigured && identityConfigurationConsistent,
    oauthConfigured,
    identityBound,
    snapshotConfigured,
    target,
    apiOrigin,
    identityOrigin,
    tokenEndpoint: `${apiOrigin}/identity/v1/oauth2/token`,
    clientId,
    clientSecret,
    refreshToken,
    expectedUserId,
    expectedAccountFingerprint,
    identityConfigurationConsistent,
    accountFingerprint: boundAccountFingerprint,
    snapshotSecret,
  }
}

async function authenticatedToken(
  config: GatewayConfig,
  fetchImpl: typeof fetch,
  requireWriteEnabled = true,
  requireIdentityBinding = true,
) {
  if (requireWriteEnabled && !config.enabled) throw new Error("EBAY_DRAFT_ONLY_WRITES_DISABLED")
  if (!config.oauthConfigured) throw new Error("EBAY_DRAFT_ONLY_WRITE_OAUTH_MISSING")
  const cacheKey = authenticationCacheKey(config)
  const cached = authenticationCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    const identityStatus = boundIdentityStatus(config, cached.actualFingerprint)
    if (requireIdentityBinding && identityStatus !== "BOUND") {
      throw new Error(identityStatus === "IDENTITY_MISMATCH"
        ? "EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_MISMATCH"
        : "EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_UNBOUND")
    }
    return { ...cached, identityStatus }
  }
  if (cached) authenticationCache.delete(cacheKey)
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
  const token = body.access_token
  const expiresInSeconds = Number(body.expires_in)
  const identity = await preflightRead(
    config,
    token,
    new URL("/commerce/identity/v1/user/", config.identityOrigin),
    fetchImpl,
  )
  const actualUserId = typeof identity.body.userId === "string"
    ? identity.body.userId.trim()
    : ""
  const confirmedStatus = typeof identity.body.status === "string"
    ? identity.body.status.trim().toUpperCase()
    : ""
  if (!identity.ok || !actualUserId) {
    throw new Error("EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_UNAVAILABLE")
  }
  if (confirmedStatus && confirmedStatus !== "CONFIRMED") {
    throw new Error("EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_NOT_CONFIRMED")
  }
  let actualFingerprint = accountFingerprint(config.target, actualUserId)
  if (
    config.target === "PRODUCTION" &&
    config.identityBound &&
    actualFingerprint !== config.accountFingerprint
  ) {
    try {
      const tradingUserId = await readEbayTradingUserIdWithAccessToken(
        token,
        fetchImpl,
      )
      const tradingFingerprint = accountFingerprint(
        config.target,
        tradingUserId,
      )
      if (tradingFingerprint === config.accountFingerprint) {
        actualFingerprint = tradingFingerprint
      }
    } catch {
      // The exact bound fingerprint below remains the final fail-closed gate.
    }
  }
  const accountType = typeof identity.body.accountType === "string"
    ? identity.body.accountType.trim().toUpperCase().replace(/[^A-Z_]/g, "").slice(0, 32)
    : ""
  const rawRegistrationMarketplaceId = typeof identity.body.registrationMarketplaceId === "string"
    ? identity.body.registrationMarketplaceId.trim().toUpperCase()
    : ""
  const registrationMarketplaceId = /^EBAY_[A-Z0-9_]{2,24}$/.test(rawRegistrationMarketplaceId)
    ? rawRegistrationMarketplaceId
    : ""
  const identityStatus = boundIdentityStatus(config, actualFingerprint)
  if (requireIdentityBinding && identityStatus !== "BOUND") {
    throw new Error(identityStatus === "IDENTITY_MISMATCH"
      ? "EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_MISMATCH"
      : "EBAY_DRAFT_ONLY_ACCOUNT_IDENTITY_UNBOUND")
  }
  const authenticated = {
    token,
    actualFingerprint,
    identityStatus,
    maskedSellerAccountId: maskedSellerAccountId(actualUserId),
    accountType,
    registrationMarketplaceId,
  }
  if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 60) {
    authenticationCache.set(cacheKey, {
      token,
      actualFingerprint,
      maskedSellerAccountId: authenticated.maskedSellerAccountId,
      accountType,
      registrationMarketplaceId,
      expiresAt: Date.now() + (expiresInSeconds - 60) * 1_000,
    })
  }
  return authenticated
}

async function accessToken(
  config: GatewayConfig,
  fetchImpl: typeof fetch,
  requireWriteEnabled = true,
) {
  const authenticated = await authenticatedToken(
    config,
    fetchImpl,
    requireWriteEnabled,
    true,
  )
  if (!config.snapshotConfigured) {
    throw new Error("EBAY_DRAFT_ONLY_PREFLIGHT_SNAPSHOT_SECRET_MISSING")
  }
  return authenticated.token
}

const FORBIDDEN_WRITE_PATHS = [
  /^\/sell\/inventory\/v1\/offer\/[^/]+\/publish$/,
  /^\/sell\/inventory\/v1\/offer\/[^/]+\/publish_offer$/,
  /^\/sell\/inventory\/v1\/bulk_publish_offer$/,
  /^\/sell\/inventory\/v1\/publish_by_inventory_item_group$/,
  /^\/sell\/inventory\/v1\/offer\/publish_by_inventory_item_group$/,
  /^\/sell\/inventory\/v1\/offer\/[^/]+\/withdraw$/,
]

export function isEbayDraftOnlyForbiddenWritePath(pathname: string) {
  return FORBIDDEN_WRITE_PATHS.some((pattern) => pattern.test(pathname))
}

function assertAllowedInventoryWrite(config: GatewayConfig, url: URL, method: string) {
  if (isEbayDraftOnlyForbiddenWritePath(url.pathname)) {
    throw new Error("EBAY_DRAFT_ONLY_PUBLISH_FORBIDDEN")
  }
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
  const sellerIdentity = method === "GET"
    && url.pathname === "/commerce/identity/v1/user/"
    && url.search === ""
  const inventoryItem = method === "GET" && /^\/sell\/inventory\/v1\/inventory_item\/[^/]+$/.test(url.pathname)
  const offerById = method === "GET"
    && /^\/sell\/inventory\/v1\/offer\/[^/]+$/.test(url.pathname)
    && url.search === ""
  const offers = method === "GET"
    && url.pathname === "/sell/inventory/v1/offer"
    && Boolean(url.searchParams.get("sku"))
    && [...url.searchParams.keys()].every((key) => key === "sku" || key === "limit")
  const businessPolicy = method === "GET"
    && /^\/sell\/account\/v1\/(fulfillment_policy|payment_policy|return_policy)\/[^/]+$/.test(url.pathname)
    && url.search === ""
  const businessPolicyList = method === "GET"
    && /^\/sell\/account\/v1\/(fulfillment_policy|payment_policy|return_policy)$/.test(url.pathname)
    && url.searchParams.get("marketplace_id") === "EBAY_US"
    && [...url.searchParams.keys()].every((key) => key === "marketplace_id")
  const sellerPrivilege = method === "GET"
    && url.pathname === "/sell/account/v1/privilege"
    && url.search === ""
  const merchantLocation = method === "GET"
    && /^\/sell\/inventory\/v1\/location\/[^/]+$/.test(url.pathname)
    && url.search === ""
  const merchantLocationList = method === "GET"
    && url.pathname === "/sell/inventory/v1/location"
    && [...url.searchParams.keys()].every((key) => ["limit", "offset"].includes(key))
  const originAllowed = sellerIdentity
    ? url.origin === config.identityOrigin
    : url.origin === config.apiOrigin
  if (!originAllowed || (
    !sellerIdentity
    && !inventoryItem
    && !offerById
    && !offers
    && !businessPolicy
    && !businessPolicyList
    && !sellerPrivilege
    && !merchantLocation
    && !merchantLocationList
  )) {
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
        "Accept-Language": EBAY_ACCEPT_LANGUAGE,
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

function retryablePreflightRead(result: ReadResult) {
  return result.status === 0 || TRANSIENT_STATUSES.has(result.status)
}

async function preflightReadWithRetry(
  config: GatewayConfig,
  token: string,
  url: URL,
  fetchImpl: typeof fetch,
) {
  let lastResult: ReadResult = {
    ok: false,
    status: 0,
    body: {},
    attempts: 0,
  }
  for (let attempt = 1; attempt <= PREFLIGHT_READ_ATTEMPTS; attempt += 1) {
    const result = await preflightRead(config, token, url, fetchImpl)
    lastResult = { ...result, attempts: attempt }
    if (
      !retryablePreflightRead(result)
      || attempt === PREFLIGHT_READ_ATTEMPTS
    ) return lastResult
    await new Promise((resolve) =>
      setTimeout(resolve, PREFLIGHT_READ_RETRY_DELAY_MS))
  }
  return lastResult
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

function normalizedMerchantLocationKey(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^[A-Za-z0-9_-]{1,36}$/.test(normalized) ? normalized : null
}

function normalizedPolicyId(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^[A-Za-z0-9_-]{1,100}$/.test(normalized) ? normalized : null
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
  const rawItems = Array.isArray(value[collection]) ? value[collection] as unknown[] : []
  return rawItems.map(record).flatMap((item) => {
    const id = normalizedPolicyId(item[idField])
    const marketplaceId = String(item.marketplaceId ?? "").trim().toUpperCase()
    if (!id || marketplaceId !== "EBAY_US") return []
    const categoryTypes = policyCategoryTypeNames(item.categoryTypes)
    const supportsNonMotors = categoryTypes.includes("ALL_EXCLUDING_MOTORS_VEHICLES")
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
  const rawItems = Array.isArray(value.locations) ? value.locations as unknown[] : []
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
  if (requestedId && options.some((option) => option.usable && option.id === requestedId)) {
    return requestedId
  }
  const usable = options.filter((option) => option.usable)
  return usable.length === 1 ? usable[0].id : ""
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
    preflightReadWithRetry(config, token, inventoryUrl, fetchImpl),
    preflightReadWithRetry(config, token, offerUrl, fetchImpl),
  ])
  const inventoryAbsent = isInventoryAbsenceResponse(inventory)
  const offerArray = Array.isArray(offers.body.offers)
    ? offers.body.offers
    : null
  const total = typeof offers.body.total === "number"
    && Number.isInteger(offers.body.total)
    && offers.body.total >= 0
    ? offers.body.total
    : null
  const size = typeof offers.body.size === "number"
    && Number.isInteger(offers.body.size)
    && offers.body.size >= 0
    ? offers.body.size
    : null
  // For a new SKU, eBay can report absence as 404 or as a zero-result
  // pagination envelope with no collection. Every other shape stays blocked.
  const arrayConsistent = offerArray !== null
    && (total === null || total === offerArray.length)
    && (size === null || size === offerArray.length)
  const explicitEmptyPage = offers.ok
    && offerArray === null
    && total === 0
    && size === 0
  const absentByStatus = offers.status === 404
  const offersKnown = (offers.ok && arrayConsistent)
    || explicitEmptyPage
    || absentByStatus
  const offerCount = arrayConsistent && offerArray
    ? offerArray.length
    : 0
  const offerResponseShape = absentByStatus
    ? "NOT_FOUND"
    : arrayConsistent
      ? "OFFERS_ARRAY"
      : explicitEmptyPage
        ? "EXPLICIT_EMPTY_PAGE"
        : "UNAVAILABLE"
  const diagnostics = {
    inventoryHttpStatus: inventory.status,
    offersHttpStatus: offers.status,
    inventoryReadAttempts: inventory.attempts ?? 1,
    offersReadAttempts: offers.attempts ?? 1,
    inventoryErrorIds: readErrorIds(inventory),
    offersErrorIds: readErrorIds(offers),
    inventoryErrors: safeReadErrors(inventory),
    offersErrors: safeReadErrors(offers),
    offerResponseShape,
  }
  if ((!inventory.ok && !inventoryAbsent) || !offersKnown) {
    const requestRejected = (
      inventory.status === 400 && !inventoryAbsent
    ) || offers.status === 400
    return {
      safe: false,
      collision: false,
      inventoryExists: false,
      inventoryAbsent,
      offerCount: 0,
      requestRejected,
      blocker: requestRejected
        ? "EBAY_SKU_PREFLIGHT_REQUEST_REJECTED"
        : "EBAY_SKU_PREFLIGHT_UNAVAILABLE",
      ...diagnostics,
    }
  }
  return {
    safe: inventoryAbsent && offerCount === 0,
    collision: inventory.ok || offerCount > 0,
    inventoryExists: inventory.ok,
    inventoryAbsent,
    offerCount,
    requestRejected: false,
    blocker: inventory.ok || offerCount > 0 ? "EBAY_SKU_ALREADY_EXISTS" : null,
    ...diagnostics,
  }
}

function containsExpected(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((value, index) => containsExpected(actual[index], value))
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false
    const actualRecord = actual as JsonRecord
    return Object.entries(expected as JsonRecord)
      .every(([key, value]) => containsExpected(actualRecord[key], value))
  }
  return actual === expected
}

async function verifyInventoryItemWithToken(
  config: GatewayConfig,
  token: string,
  sku: string,
  expectedPayload: JsonRecord,
  fetchImpl: typeof fetch,
) {
  const url = new URL(
    `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    config.apiOrigin,
  )
  const result = await preflightRead(config, token, url, fetchImpl)
  const safe = result.ok && containsExpected(result.body, expectedPayload)
  return {
    safe,
    absent: result.status === 404,
    httpStatus: result.status,
    blocker: safe
      ? ""
      : result.status === 404
        ? "EBAY_INVENTORY_WRITE_CONFIRMED_ABSENT"
        : "EBAY_INVENTORY_OUTCOME_UNKNOWN",
  }
}

async function preflightDependenciesWithToken(
  config: GatewayConfig,
  token: string,
  input: EbayDraftOnlyDependencyInput,
  fetchImpl: typeof fetch,
) {
  const fulfillmentPolicyId = normalizedPolicyId(input.fulfillmentPolicyId)
  const paymentPolicyId = normalizedPolicyId(input.paymentPolicyId)
  const returnPolicyId = normalizedPolicyId(input.returnPolicyId)
  const merchantLocationKey = normalizedMerchantLocationKey(input.merchantLocationKey)
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
  const snapshot = verifyEbayDraftOnlyPreflightSnapshot(
    input.preflightSnapshot,
    {
      target: config.target,
      accountFingerprint: config.accountFingerprint,
      marketplaceId: "EBAY_US",
      fulfillmentPolicyId: fulfillmentPolicyId as string,
      paymentPolicyId: paymentPolicyId as string,
      returnPolicyId: returnPolicyId as string,
      merchantLocationKey: merchantLocationKey as string,
    },
    config.snapshotSecret,
  )
  if (!snapshot.valid) {
    return {
      safe: false,
      terminal: false,
      blocker: snapshot.blocker,
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
      requireImmediatePay: false,
    },
    {
      name: "paymentPolicy" as const,
      resource: "payment_policy",
      id: paymentPolicyId as string,
      idField: "paymentPolicyId",
      blocker: "EBAY_PAYMENT_POLICY_INVALID",
      requireImmediatePay: true,
    },
    {
      name: "returnPolicy" as const,
      resource: "return_policy",
      id: returnPolicyId as string,
      idField: "returnPolicyId",
      blocker: "EBAY_RETURN_POLICY_INVALID",
      requireImmediatePay: false,
    },
  ]
  const locationUrl = new URL(
    `/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey as string)}`,
    config.apiOrigin,
  )
  const [privilegeResult, policyResults, locationResult] = await Promise.all([
    preflightRead(
      config,
      token,
      new URL("/sell/account/v1/privilege", config.apiOrigin),
      fetchImpl,
    ),
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

  if ([privilegeResult, ...policyResults, locationResult].some(unavailableRead)) {
    return {
      safe: false,
      terminal: false,
      blocker: "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE",
      checks,
    }
  }
  if (
    !privilegeResult.ok
    || privilegeResult.body.sellerRegistrationCompleted !== true
  ) {
    return {
      safe: false,
      terminal: false,
      blocker: "EBAY_SELLER_PRIVILEGE_INVALID",
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
    const categoryTypes = policyCategoryTypeNames(result.body.categoryTypes)
    const publishReady = categoryTypes.includes("ALL_EXCLUDING_MOTORS_VEHICLES")
      && (!policy.requireImmediatePay || result.body.immediatePay === true)
    if (!returnedId || !marketplaceId) {
      return {
        safe: false,
        terminal: false,
        blocker: "EBAY_DRAFT_DEPENDENCIES_PREFLIGHT_UNAVAILABLE",
        checks,
      }
    }
    if (returnedId !== policy.id || marketplaceId !== "EBAY_US" || !publishReady) {
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
  return {
    safe: true,
    terminal: false,
    blocker: null,
    checks,
    snapshot: {
      verified: true,
      expiresAt: snapshot.payload?.expiresAt ?? null,
      accountFingerprint: config.accountFingerprint,
      marketplaceId: "EBAY_US",
    },
  }
}

export async function preflightEbayDraftSkuCollision(
  sku: string,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl)
  return preflightSkuCollisionWithToken(config, token, sku, fetchImpl)
}

export async function inspectEbayDraftSkuState(
  sku: string,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl, false)
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

export async function preflightEbayDraftOnlyMobile(
  requested: EbayDraftOnlyPreflightSelection = {},
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const authenticated = await authenticatedToken(config, fetchImpl, false, false)
  const listUrl = (resource: string) => {
    const url = new URL(`/sell/account/v1/${resource}`, config.apiOrigin)
    url.searchParams.set("marketplace_id", "EBAY_US")
    return url
  }
  const locationUrl = new URL("/sell/inventory/v1/location", config.apiOrigin)
  locationUrl.searchParams.set("limit", "100")
  locationUrl.searchParams.set("offset", "0")
  const [privilege, fulfillment, payment, returns, locations] = await Promise.all([
    preflightRead(
      config,
      authenticated.token,
      new URL("/sell/account/v1/privilege", config.apiOrigin),
      fetchImpl,
    ),
    preflightRead(config, authenticated.token, listUrl("fulfillment_policy"), fetchImpl),
    preflightRead(config, authenticated.token, listUrl("payment_policy"), fetchImpl),
    preflightRead(config, authenticated.token, listUrl("return_policy"), fetchImpl),
    preflightRead(config, authenticated.token, locationUrl, fetchImpl),
  ])
  const reads = [privilege, fulfillment, payment, returns, locations]
  if (reads.some((result) => !result.ok)) {
    throw new Error("EBAY_DRAFT_ONLY_READ_PREFLIGHT_UNAVAILABLE")
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
    fulfillmentPolicyId: selectedId(options.fulfillmentPolicies, requested.fulfillmentPolicyId),
    paymentPolicyId: selectedId(options.paymentPolicies, requested.paymentPolicyId),
    returnPolicyId: selectedId(options.returnPolicies, requested.returnPolicyId),
    merchantLocationKey: selectedId(options.merchantLocations, requested.merchantLocationKey),
  }
  const selectionComplete = Object.values(selection).every(Boolean)
  const sellerRegistrationCompleted = privilege.body.sellerRegistrationCompleted === true
  const sellingLimitPresent = privilege.body.sellingLimit !== null
    && privilege.body.sellingLimit !== undefined
  const sellingLimitAmount = Number(record(record(privilege.body.sellingLimit).amount).value)
  const sellingLimitZero = sellingLimitPresent
    && Number.isFinite(sellingLimitAmount)
    && sellingLimitAmount <= 0
  const privilegeUsable = sellerRegistrationCompleted
  const identityReady = authenticated.identityStatus === "BOUND"
  const canIssueSnapshot = identityReady
    && privilegeUsable
    && selectionComplete
    && config.snapshotConfigured
  const snapshot = canIssueSnapshot
    ? issueEbayDraftOnlyPreflightSnapshot({
      target: config.target,
      accountFingerprint: authenticated.actualFingerprint,
      marketplaceId: "EBAY_US",
      ...selection,
    }, config.snapshotSecret)
    : ""
  const snapshotVerification = snapshot
    ? verifyEbayDraftOnlyPreflightSnapshot(snapshot, {
      target: config.target,
      accountFingerprint: authenticated.actualFingerprint,
      marketplaceId: "EBAY_US",
      ...selection,
    }, config.snapshotSecret)
    : null
  return {
    mode: "GET_ONLY" as const,
    target: config.target,
    marketplaceId: "EBAY_US" as const,
    identity: {
      status: authenticated.identityStatus,
      accountFingerprint: authenticated.actualFingerprint,
      maskedSellerAccountId: authenticated.maskedSellerAccountId,
      expectedIdentityConfigured: config.identityBound,
      accountType: authenticated.accountType,
      registrationMarketplaceId: authenticated.registrationMarketplaceId,
    },
    privilege: {
      sellerRegistrationCompleted,
      sellingLimitPresent,
      sellingLimitZero,
      usable: privilegeUsable,
    },
    options,
    selection,
    selectionComplete,
    snapshot: snapshotVerification?.valid ? snapshot : "",
    snapshotExpiresAt: snapshotVerification?.payload?.expiresAt ?? null,
    snapshotStatus: snapshotVerification?.valid
      ? "READY"
      : authenticated.identityStatus !== "BOUND"
        ? authenticated.identityStatus
        : !config.snapshotConfigured
          ? "SNAPSHOT_SECRET_MISSING"
          : !privilegeUsable
            ? "SELLER_PRIVILEGE_BLOCKED"
            : "SELECTION_REQUIRED",
    warnings: sellingLimitZero ? ["SELLING_LIMIT_ZERO_PUBLISH_BLOCKED"] : [],
    sanitized: true,
  }
}

export async function verifyEbayDraftInventoryItem(
  sku: string,
  expectedPayload: JsonRecord,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl, false)
  return verifyInventoryItemWithToken(config, token, sku, expectedPayload, fetchImpl)
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
        "Accept-Language": EBAY_ACCEPT_LANGUAGE,
        "Content-Type": "application/json",
        "Content-Language": "en-US",
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
  const maximumAttempts = config.target === "PRODUCTION" ? 1 : 3
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    result = await write(config, token, url, "PUT", payload, fetchImpl)
    if (result.ok || !result.retryable) break
  }
  if (config.target === "PRODUCTION" && !result.ok && !result.outcomeKnown) {
    let verification: Awaited<ReturnType<typeof verifyInventoryItemWithToken>> | null = null
    for (let readAttempt = 0; readAttempt < 3; readAttempt += 1) {
      if (readAttempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      verification = await verifyInventoryItemWithToken(
        config,
        token,
        sku,
        payload,
        fetchImpl,
      )
      if (verification.safe) {
        return {
          ok: true,
          status: verification.httpStatus,
          body: { reconciledAfterUnknownPut: true, boundedReadAttempts: readAttempt + 1 },
          outcomeKnown: true,
          retryable: false,
          reconciled: true,
        }
      }
    }
    return {
      ...result,
      body: {
        blocker: "EBAY_INVENTORY_OUTCOME_UNKNOWN",
        lastReadStatus: verification?.httpStatus ?? 0,
        boundedReadAttempts: 3,
      },
      outcomeKnown: false,
      retryable: false,
    }
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

async function verifyOfferWithToken(
  config: GatewayConfig,
  token: string,
  offerId: string,
  expectedSku: string,
  expectedMarketplaceId: string,
  fetchImpl: typeof fetch,
) {
  const normalizedOfferId = sanitizeEbayOfferId(offerId)
  const normalizedSku = typeof expectedSku === "string" ? expectedSku.trim() : ""
  const normalizedMarketplaceId = typeof expectedMarketplaceId === "string"
    ? expectedMarketplaceId.trim().toUpperCase()
    : ""
  if (
    !normalizedOfferId
    || !/^[A-Za-z0-9._-]{1,50}$/.test(normalizedSku)
    || normalizedMarketplaceId !== "EBAY_US"
  ) {
    return {
      safe: false,
      httpStatus: 0,
      status: "",
      listingPresent: false,
      offerId: normalizedOfferId,
      sku: "",
      marketplaceId: "",
      blocker: "EBAY_OFFER_POST_CREATE_VERIFICATION_INVALID_ID",
    }
  }
  const url = new URL(
    `/sell/inventory/v1/offer/${encodeURIComponent(normalizedOfferId)}`,
    config.apiOrigin,
  )
  const result = await preflightRead(config, token, url, fetchImpl)
  const status = typeof result.body.status === "string"
    ? result.body.status.trim().toUpperCase()
    : ""
  const listingPresent = Object.prototype.hasOwnProperty.call(result.body, "listing")
    || Object.prototype.hasOwnProperty.call(result.body, "listingId")
  const returnedSku = typeof result.body.sku === "string" ? result.body.sku.trim() : ""
  const returnedMarketplaceId = typeof result.body.marketplaceId === "string"
    ? result.body.marketplaceId.trim().toUpperCase()
    : ""
  const rawReturnedOfferId = typeof result.body.offerId === "string"
    ? result.body.offerId.trim()
    : ""
  const offerIdMatches = !rawReturnedOfferId || rawReturnedOfferId === normalizedOfferId
  const identityMatches = returnedSku === normalizedSku
    && returnedMarketplaceId === normalizedMarketplaceId
    && offerIdMatches
  const safe = result.ok
    && status === "UNPUBLISHED"
    && !listingPresent
    && identityMatches
  const publicationIncident = listingPresent || status === "PUBLISHED"
  return {
    safe,
    httpStatus: result.status,
    status,
    listingPresent,
    offerId: normalizedOfferId,
    sku: returnedSku,
    marketplaceId: returnedMarketplaceId,
    blocker: safe
      ? ""
      : publicationIncident
        ? "EBAY_OFFER_PUBLICATION_SAFETY_INCIDENT"
        : identityMatches
          ? "EBAY_OFFER_POST_CREATE_VERIFICATION_FAILED"
          : "EBAY_OFFER_IDENTITY_MISMATCH",
  }
}

export async function verifyEbayUnpublishedOffer(
  offerId: string,
  expectedSku: string,
  expectedMarketplaceId = "EBAY_US",
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl, false)
  return verifyOfferWithToken(
    config,
    token,
    offerId,
    expectedSku,
    expectedMarketplaceId,
    fetchImpl,
  )
}

export async function verifyEbayCompensatedOfferRecoveryState(
  offerId: string,
  expectedSku: string,
  expectedEndedListingId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const normalizedOfferId = sanitizeEbayOfferId(offerId)
  const normalizedSku = typeof expectedSku === "string" ? expectedSku.trim() : ""
  const normalizedListingId = sanitizeEbayListingId(expectedEndedListingId)
  if (
    !normalizedOfferId || !isCanonicalEbayPackageSku(normalizedSku) ||
    !normalizedListingId
  ) {
    return {
      safe: false,
      status: "",
      offerId: normalizedOfferId,
      sku: normalizedSku,
      priorListingId: normalizedListingId,
      publishedOfferCount: 0,
      matchingOfferCount: 0,
      blocker: "EBAY_COMPENSATED_PUBLICATION_RECOVERY_IDENTITY_INVALID",
    }
  }
  const config = getEbayDraftOnlyGatewayConfig()
  if (config.target !== "PRODUCTION" || !config.configured) {
    throw new Error("EBAY_COMPENSATED_PUBLICATION_RECOVERY_RUNTIME_INVALID")
  }
  const token = await accessToken(config, fetchImpl, false)
  const url = new URL("/sell/inventory/v1/offer", config.apiOrigin)
  url.searchParams.set("sku", normalizedSku)
  url.searchParams.set("limit", "100")
  const result = await preflightRead(config, token, url, fetchImpl)
  const offers = result.ok && Array.isArray(result.body.offers)
    ? result.body.offers.map(record).filter((offer) =>
      offer.sku === normalizedSku && offer.marketplaceId === "EBAY_US")
    : []
  const matching = offers.filter((offer) =>
    sanitizeEbayOfferId(offer.offerId) === normalizedOfferId)
  const published = offers.filter((offer) => {
    const status = typeof offer.status === "string"
      ? offer.status.trim().toUpperCase() : ""
    return status === "PUBLISHED" || Boolean(publishedListingId(offer))
  })
  const target = matching.length === 1 ? matching[0] : {}
  const status = typeof target.status === "string"
    ? target.status.trim().toUpperCase() : ""
  const targetListingId = publishedListingId(target)
  const safe = result.ok && offers.length === 1 && matching.length === 1 &&
    published.length === 0 && status === "UNPUBLISHED" && !targetListingId
  return {
    safe,
    status,
    offerId: normalizedOfferId,
    sku: normalizedSku,
    priorListingId: normalizedListingId,
    publishedOfferCount: published.length,
    matchingOfferCount: matching.length,
    blocker: safe
      ? ""
      : !result.ok
        ? "EBAY_COMPENSATED_PUBLICATION_RECOVERY_OFFER_READ_FAILED"
        : published.length > 0
          ? "EBAY_COMPENSATED_PUBLICATION_RECOVERY_ACTIVE_OR_PUBLISHED_OFFER"
          : offers.length !== 1 || matching.length !== 1
            ? "EBAY_COMPENSATED_PUBLICATION_RECOVERY_OFFER_AMBIGUOUS"
            : "EBAY_COMPENSATED_PUBLICATION_RECOVERY_OFFER_NOT_UNPUBLISHED",
  }
}

export async function discoverEbayUnpublishedOfferBySku(
  sku: string,
  expectedOfferPayload: JsonRecord,
  fetchImpl: typeof fetch = fetch,
) {
  const normalizedSku = typeof sku === "string" ? sku.trim() : ""
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(normalizedSku)) {
    return {
      safe: false,
      httpStatus: 0,
      status: "",
      listingPresent: false,
      offerId: null,
      sku: normalizedSku,
      marketplaceId: "EBAY_US",
      blocker: "EBAY_OFFER_RECONCILIATION_SKU_INVALID",
    }
  }
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl, false)
  const url = new URL("/sell/inventory/v1/offer", config.apiOrigin)
  url.searchParams.set("sku", normalizedSku)
  url.searchParams.set("limit", "100")
  const result = await preflightRead(config, token, url, fetchImpl)
  const offers = result.ok && Array.isArray(result.body.offers)
    ? result.body.offers.map(record)
    : []
  const matches = offers.filter((offer) => (
    offer.status === "UNPUBLISHED"
    && offer.sku === normalizedSku
    && offer.marketplaceId === "EBAY_US"
    && containsExpected(offer, expectedOfferPayload)
    && !Object.prototype.hasOwnProperty.call(offer, "listing")
    && !Object.prototype.hasOwnProperty.call(offer, "listingId")
    && Boolean(sanitizeEbayOfferId(offer.offerId))
  ))
  if (matches.length !== 1) {
    return {
      safe: false,
      httpStatus: result.status,
      status: "",
      listingPresent: false,
      offerId: null,
      sku: normalizedSku,
      marketplaceId: "EBAY_US",
      blocker: "EBAY_OFFER_RECONCILIATION_NOT_UNIQUE",
    }
  }
  const offerId = sanitizeEbayOfferId(matches[0].offerId) as string
  return verifyOfferWithToken(
    config,
    token,
    offerId,
    normalizedSku,
    "EBAY_US",
    fetchImpl,
  )
}

export function sanitizeEbayOfferId(value: unknown) {
  const offerId = typeof value === "string" ? value.trim() : ""
  return /^[A-Za-z0-9_-]{1,80}$/.test(offerId) ? offerId : null
}

function sanitizeEbayListingId(value: unknown) {
  const listingId = typeof value === "string" ? value.trim() : ""
  return /^\d{9,20}$/.test(listingId) ? listingId : null
}

function publishedListingId(body: JsonRecord) {
  return sanitizeEbayListingId(body.listingId)
    ?? sanitizeEbayListingId(record(body.listing).listingId)
}

async function verifyPublishedOfferWithToken(
  config: GatewayConfig,
  token: string,
  offerId: string,
  expectedSku: string,
  fetchImpl: typeof fetch,
) {
  const normalizedOfferId = sanitizeEbayOfferId(offerId)
  const normalizedSku = typeof expectedSku === "string" ? expectedSku.trim() : ""
  if (!normalizedOfferId || !isCanonicalEbayPackageSku(normalizedSku)) {
    return {
      safe: false,
      active: false,
      httpStatus: 0,
      status: "",
      offerId: normalizedOfferId,
      listingId: null,
      sku: normalizedSku,
      marketplaceId: "EBAY_US",
      blocker: "EBAY_PUBLISHED_OFFER_IDENTITY_INVALID",
    }
  }
  const result = await preflightRead(
    config,
    token,
    new URL(
      `/sell/inventory/v1/offer/${encodeURIComponent(normalizedOfferId)}`,
      config.apiOrigin,
    ),
    fetchImpl,
  )
  const status = typeof result.body.status === "string"
    ? result.body.status.trim().toUpperCase()
    : ""
  const sku = typeof result.body.sku === "string" ? result.body.sku.trim() : ""
  const marketplaceId = typeof result.body.marketplaceId === "string"
    ? result.body.marketplaceId.trim().toUpperCase()
    : ""
  const listingId = publishedListingId(result.body)
  const safe = result.ok
    && status === "PUBLISHED"
    && sku === normalizedSku
    && marketplaceId === "EBAY_US"
    && Boolean(listingId)
  return {
    safe,
    // Inventory API PUBLISHED is reconciled here. Trading GetItem performs the
    // independent ACTIVE/ownership verification before monitor registration.
    active: safe,
    httpStatus: result.status,
    status,
    offerId: normalizedOfferId,
    listingId,
    sku,
    marketplaceId,
    blocker: safe
      ? ""
      : status === "UNPUBLISHED"
        ? "EBAY_OFFER_STILL_UNPUBLISHED"
        : "EBAY_PUBLISHED_OFFER_VERIFICATION_PENDING",
  }
}

export async function verifyEbayPublishedOffer(
  offerId: string,
  expectedSku: string,
  fetchImpl: typeof fetch = fetch,
) {
  const config = getEbayDraftOnlyGatewayConfig()
  const token = await accessToken(config, fetchImpl, false)
  return verifyPublishedOfferWithToken(config, token, offerId, expectedSku, fetchImpl)
}

export async function publishEbayOfferOnce(input: {
  offerId: string
  expectedSku: string
  previewHash: string
  publicationControlId: string
  confirmPublish: string
}, fetchImpl: typeof fetch = fetch) {
  const config = getEbayDraftOnlyGatewayConfig()
  const offerId = sanitizeEbayOfferId(input.offerId)
  const expectedSku = typeof input.expectedSku === "string" ? input.expectedSku.trim() : ""
  if (
    config.target !== "PRODUCTION"
    || input.confirmPublish !== EBAY_FINAL_PUBLISH_CONFIRMATION
    || !offerId
    || !isCanonicalEbayPackageSku(expectedSku)
    || !/^[0-9a-f]{64}$/.test(input.previewHash)
    || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.publicationControlId)
  ) throw new Error("EBAY_FINAL_PUBLISH_AUTHORIZATION_INVALID")

  const token = await accessToken(config, fetchImpl)
  const unpublished = await verifyOfferWithToken(
    config,
    token,
    offerId,
    expectedSku,
    "EBAY_US",
    fetchImpl,
  )
  if (!unpublished.safe) {
    const alreadyPublished = await verifyPublishedOfferWithToken(
      config,
      token,
      offerId,
      expectedSku,
      fetchImpl,
    )
    if (alreadyPublished.safe) {
      return {
        ok: true,
        status: alreadyPublished.httpStatus,
        listingId: alreadyPublished.listingId,
        outcomeKnown: true,
        reconciled: true,
        publishRequestSent: false,
        blocker: "",
      }
    }
    return {
      ok: false,
      status: unpublished.httpStatus,
      listingId: null,
      outcomeKnown: true,
      reconciled: false,
      publishRequestSent: false,
      blocker: unpublished.blocker || "EBAY_OFFER_NOT_PUBLISHABLE",
    }
  }

  const url = new URL(
    `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`,
    config.apiOrigin,
  )
  let responseStatus = 0
  let responseBody: JsonRecord = {}
  let requestCompleted = false
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Accept-Language": EBAY_ACCEPT_LANGUAGE,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    responseStatus = response.status
    responseBody = record(await response.json().catch(() => ({})))
    requestCompleted = true
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        listingId: null,
        outcomeKnown: response.status < 500,
        reconciled: false,
        publishRequestSent: true,
        blocker: response.status < 500
          ? "EBAY_PUBLISH_WRITE_REJECTED"
          : "EBAY_PUBLISH_OUTCOME_UNKNOWN",
        body: safeBody(responseBody),
      }
    }
  } catch {
    // A timeout is never retried with POST. Reconciliation below uses GET only.
  }

  const returnedListingId = publishedListingId(responseBody)
  if (requestCompleted && returnedListingId) {
    return {
      ok: true,
      status: responseStatus,
      listingId: returnedListingId,
      outcomeKnown: true,
      reconciled: false,
      publishRequestSent: true,
      blocker: "",
    }
  }

  let verification = await verifyPublishedOfferWithToken(
    config,
    token,
    offerId,
    expectedSku,
    fetchImpl,
  )
  for (let attempt = 1; attempt < 3 && !verification.safe; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
    verification = await verifyPublishedOfferWithToken(
      config,
      token,
      offerId,
      expectedSku,
      fetchImpl,
    )
  }
  return verification.safe
    ? {
      ok: true,
      status: responseStatus || verification.httpStatus,
      listingId: verification.listingId,
      outcomeKnown: true,
      reconciled: true,
      publishRequestSent: true,
      blocker: "",
    }
    : {
      ok: false,
      status: responseStatus || verification.httpStatus,
      listingId: null,
      outcomeKnown: false,
      reconciled: false,
      publishRequestSent: true,
      blocker: "EBAY_PUBLISH_OUTCOME_UNKNOWN",
    }
}

export function ebayDraftOnlyRuntimeStatus() {
  const config = getEbayDraftOnlyGatewayConfig()
  return {
    enabled: config.enabled,
    masterEnabled: config.masterEnabled,
    targetEnabled: config.targetEnabled,
    environmentAllowed: config.environmentAllowed,
    configured: config.configured,
    oauthConfigured: config.oauthConfigured,
    identityBound: config.identityBound,
    snapshotConfigured: config.snapshotConfigured,
    identityConfigurationConsistent: config.identityConfigurationConsistent,
    target: config.target,
    credentialProfile: config.target === "PRODUCTION"
      ? "EBAY_DRAFT_ONLY_PRODUCTION"
      : "EBAY_DRAFT_ONLY_SANDBOX",
    requiredCredentialKeys: config.target === "PRODUCTION"
      ? [
        "EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID",
        "EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET",
        "EBAY_DRAFT_ONLY_PRODUCTION_REFRESH_TOKEN",
        "EBAY_DRAFT_ONLY_PRODUCTION_PREFLIGHT_SNAPSHOT_SECRET",
        "EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH",
      ]
      : [
        "EBAY_DRAFT_ONLY_SANDBOX_CLIENT_ID",
        "EBAY_DRAFT_ONLY_SANDBOX_CLIENT_SECRET",
        "EBAY_DRAFT_ONLY_SANDBOX_REFRESH_TOKEN",
        "EBAY_DRAFT_ONLY_SANDBOX_PREFLIGHT_SNAPSHOT_SECRET",
      ],
    accountFingerprint: config.accountFingerprint || null,
    requiredIdentityBindingOneOf: config.target === "PRODUCTION"
      ? [
        "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID",
        "EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT",
      ]
      : [
        "EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_USER_ID",
        "EBAY_DRAFT_ONLY_SANDBOX_EXPECTED_ACCOUNT_FINGERPRINT",
      ],
    requiredOAuthScopes: [
      "sell.inventory",
      "sell.account.readonly",
      "commerce.identity.readonly",
    ],
    requiredReadOperations: [
      "GET immutable seller userId and match expected account fingerprint",
      "GET seller privileges and policy/location selectors",
      "GET SKU and offers collision preflight",
      "GET fulfillment/payment/return policies by ID",
      "GET merchant location and require ENABLED",
      "GET created offer by ID and require UNPUBLISHED with no listing ID",
    ],
    allowedWriteOperations: ["PUT createOrReplaceInventoryItem", "POST createOffer (UNPUBLISHED)"],
    forbiddenOperation: "publishOffer",
    canPublish: false,
    authorizedPublication: {
      scope: "SEPARATE_ONE_SHOT_HUMAN_AUTHORIZATION",
      operation: "POST publishOffer",
      productionOnly: true,
      exactFinalPreviewRequired: true,
      exactConfirmation: EBAY_FINAL_PUBLISH_CONFIRMATION,
      maximumPublishAttempts: 1,
      unattendedPublicationAllowed: false,
      reconciliationUsesGetOnly: true,
      available: config.enabled && config.configured && config.target === "PRODUCTION",
    },
  }
}
