import { timingSafeEqual } from "node:crypto"

import type { SafeListingDefaults } from "./ebay-manual-listing-domain"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
} from "./ebay-seller-account-scope"
import {
  createEbayReadonlyRateLimitError,
  getEbayReadonlyRateLimitMetadata,
} from "./ebay-readonly-rate-limit"

export const EBAY_MANUAL_LISTING_TRADING_CONNECTOR =
  "EBAY_TRADING_GET_ITEM_READONLY" as const

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const REQUEST_TIMEOUT_MS = 10_000
const COMPATIBILITY_LEVEL = "1423"
const SITE_ID_US = "0"
const MAX_RETRIES = 2

type CachedToken = {
  value: string
  expiresAt: number
}

type FetchLike = typeof fetch

export type TradingManualListingResult = {
  ownership: "verified" | "not_owned" | "identity_mismatch" | "inactive"
  itemId: string
  listingStatus: string | null
  ebaySku: string | null
  title: string | null
  availableQuantity: number | null
  price: number | null
  currency: string | null
  safeDefaults: SafeListingDefaults
  observedAt: string
}

type EbayProductionIdentityReadOnlyProbeBaseResult = {
  oauthValid: true
  accessTokenReceived: true
  getUserValid: true
  environment: "PRODUCTION"
  maskedUserId: string
  fingerprintFormatValid: true
  configuredFingerprintPresent: boolean
  configuredFingerprintMatches: boolean
  identityBindingStatus: "UNBOUND" | "BOUND_MATCH"
  scopesVerified: true
  ebayWriteUsed: false
  canPublish: false
}

export type EbayProductionIdentityReadOnlyProbeResult =
  | EbayProductionIdentityReadOnlyProbeBaseResult & {
    fingerprint: string
    configuredFingerprintPresent: false
    configuredFingerprintMatches: false
    identityBindingStatus: "UNBOUND"
  }
  | EbayProductionIdentityReadOnlyProbeBaseResult & {
    fingerprint?: never
    configuredFingerprintPresent: true
    configuredFingerprintMatches: true
    identityBindingStatus: "BOUND_MATCH"
  }

let cachedToken: CachedToken | null = null

function normalizedFingerprint(value: unknown) {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase()
    : ""
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : ""
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function tagPattern(tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "i",
  )
}

export function tradingXmlTagValue(xml: string, tag: string) {
  const match = xml.match(tagPattern(tag))
  if (!match) return null
  const value = decodeXml(match[1].replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
  return value || null
}

export function tradingXmlContainer(xml: string, tag: string) {
  return xml.match(tagPattern(tag))?.[1] ?? ""
}

function safeIdentifier(value: string | null, maximumLength = 100) {
  return value &&
    value.length <= maximumLength &&
    /^[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : null
}

function numericIdentifier(value: string | null, maximumLength = 20) {
  return value && new RegExp(`^[0-9]{1,${maximumLength}}$`).test(value)
    ? value
    : null
}

function safeListingTitle(value: string | null) {
  return value && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null
}

function nonNegativeInteger(value: string | null) {
  if (value === null || value === "") return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function positiveNumber(value: string | null) {
  if (value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function parseTradingManualListingResponses(
  getUserXml: string,
  getItemXml: string,
  expectedItemId: string,
  now = new Date(),
  expectedSellerUserId?: string,
  expectedAccountFingerprint?: string,
): TradingManualListingResult {
  const authenticatedUser = tradingXmlTagValue(
    tradingXmlContainer(getUserXml, "User"),
    "UserID",
  )
  const item = tradingXmlContainer(getItemXml, "Item")
  const sellerUser = tradingXmlTagValue(
    tradingXmlContainer(item, "Seller"),
    "UserID",
  )
  const returnedItemId = tradingXmlTagValue(item, "ItemID")
  if (
    !authenticatedUser ||
    !sellerUser ||
    returnedItemId !== expectedItemId
  ) {
    throw new Error("EBAY_TRADING_OWNERSHIP_EVIDENCE_INCOMPLETE")
  }

  const listingStatus = tradingXmlTagValue(
    tradingXmlContainer(item, "SellingStatus"),
    "ListingStatus",
  )
  const sellingStatus = tradingXmlContainer(item, "SellingStatus")
  const listedQuantity = nonNegativeInteger(
    tradingXmlTagValue(item, "Quantity"),
  )
  const quantitySold = nonNegativeInteger(
    tradingXmlTagValue(sellingStatus, "QuantitySold"),
  ) ?? 0
  const availableQuantity = listedQuantity === null
    ? null
    : Math.max(0, listedQuantity - quantitySold)
  const sameSeller =
    authenticatedUser.toLocaleLowerCase("en-US") ===
    sellerUser.toLocaleLowerCase("en-US")
  const expectedUserMatches = !expectedSellerUserId ||
    authenticatedUser.toLocaleLowerCase("en-US") ===
      expectedSellerUserId.trim().toLocaleLowerCase("en-US")
  const normalizedExpectedFingerprint = normalizedFingerprint(
    expectedAccountFingerprint,
  )
  const expectedFingerprintMatches = !normalizedExpectedFingerprint ||
    ebayProductionAccountFingerprint(authenticatedUser) === normalizedExpectedFingerprint
  const expectedIdentityMatches =
    expectedUserMatches && expectedFingerprintMatches
  const active = listingStatus?.toLowerCase() === "active"

  const sellerProfiles = tradingXmlContainer(item, "SellerProfiles")
  const category = tradingXmlContainer(item, "PrimaryCategory")
  const safeDefaults: SafeListingDefaults = {}
  const fulfillmentPolicyId = numericIdentifier(
    tradingXmlTagValue(sellerProfiles, "ShippingProfileID"),
    20,
  )
  const paymentPolicyId = numericIdentifier(
    tradingXmlTagValue(sellerProfiles, "PaymentProfileID"),
    20,
  )
  const returnPolicyId = numericIdentifier(
    tradingXmlTagValue(sellerProfiles, "ReturnProfileID"),
    20,
  )
  const categoryId = numericIdentifier(
    tradingXmlTagValue(category, "CategoryID"),
    20,
  )
  const conditionId = numericIdentifier(
    tradingXmlTagValue(item, "ConditionID"),
    12,
  )
  if (fulfillmentPolicyId) safeDefaults.fulfillmentPolicyId = fulfillmentPolicyId
  if (paymentPolicyId) safeDefaults.paymentPolicyId = paymentPolicyId
  if (returnPolicyId) safeDefaults.returnPolicyId = returnPolicyId
  if (categoryId) safeDefaults.categoryId = categoryId
  if (conditionId) safeDefaults.conditionId = conditionId

  return {
    ownership: !expectedIdentityMatches
      ? "identity_mismatch"
      : !sameSeller
        ? "not_owned"
        : active
          ? "verified"
          : "inactive",
    itemId: expectedItemId,
    listingStatus: safeIdentifier(listingStatus, 40),
    ebaySku: safeIdentifier(tradingXmlTagValue(item, "SKU")),
    title: safeListingTitle(tradingXmlTagValue(item, "Title")),
    availableQuantity,
    price: positiveNumber(tradingXmlTagValue(sellingStatus, "CurrentPrice")),
    currency: safeIdentifier(tradingXmlTagValue(item, "Currency"), 3)
      ?.toUpperCase() ?? null,
    safeDefaults,
    observedAt: now.toISOString(),
  }
}

function responseAccepted(xml: string) {
  const ack = tradingXmlTagValue(xml, "Ack")?.toLowerCase()
  return ack === "success" || ack === "warning"
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function getTradingAccessToken(
  fetchImpl: FetchLike,
  useCache = true,
) {
  if (useCache && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? ""
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("EBAY_TRADING_READONLY_NOT_CONFIGURED")
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`,
    "utf8",
  ).toString("base64")
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: BASE_SCOPE,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (response.status === 429) {
    throw createEbayReadonlyRateLimitError("EBAY_OAUTH_429", response, {
      apiFamily: "OAUTH",
      operation: "TRADING_REFRESH_TOKEN",
      endpoint: "/identity/v1/oauth2/token",
    })
  }
  if (!response.ok) {
    throw new Error(`EBAY_TRADING_OAUTH_${response.status}`)
  }
  let payload: Record<string, unknown>
  try {
    payload = await response.json() as Record<string, unknown>
  } catch {
    throw new Error(`EBAY_TRADING_OAUTH_${response.status}`)
  }
  const accessToken = typeof payload.access_token === "string"
    ? payload.access_token.trim()
    : ""
  if (!accessToken) throw new Error(`EBAY_TRADING_OAUTH_${response.status}`)
  const expiresIn = Math.max(120, Number(payload.expires_in) || 7_200)
  if (useCache) {
    cachedToken = {
      value: accessToken,
      expiresAt: Date.now() + expiresIn * 1_000,
    }
  }
  return accessToken
}

/** Shared, validated Trading OAuth provider for server-side read-only calls. */
export async function getEbayTradingReadOnlyAccessToken(
  fetchImpl: FetchLike = fetch,
) {
  return getTradingAccessToken(fetchImpl)
}

function requestXml(callName: "GetUser" | "GetItem", ebayItemId?: string) {
  if (callName === "GetUser") {
    return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
      "<OutputSelector>User.UserID</OutputSelector>" +
      "</GetUserRequest>"
  }
  if (!ebayItemId || !/^\d{9,20}$/.test(ebayItemId)) {
    throw new Error("MANUAL_LISTING_ITEM_ID_INVALID")
  }
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${ebayItemId}</ItemID>` +
    [
      "Item.ItemID",
      "Item.Seller.UserID",
      "Item.SellingStatus.ListingStatus",
      "Item.Title",
      "Item.SKU",
      "Item.Quantity",
      "Item.SellingStatus.QuantitySold",
      "Item.SellingStatus.CurrentPrice",
      "Item.Currency",
      "Item.PrimaryCategory.CategoryID",
      "Item.ConditionID",
      "Item.SellerProfiles.SellerShippingProfile.ShippingProfileID",
      "Item.SellerProfiles.SellerPaymentProfile.PaymentProfileID",
      "Item.SellerProfiles.SellerReturnProfile.ReturnProfileID",
    ].map((selector) =>
      `<OutputSelector>${selector}</OutputSelector>`
    ).join("") +
    "</GetItemRequest>"
}

async function tradingRead(
  callName: "GetUser" | "GetItem",
  accessToken: string,
  fetchImpl: FetchLike,
  ebayItemId?: string,
) {
  const endpoint = new URL(TRADING_ENDPOINT)
  if (
    endpoint.origin !== "https://api.ebay.com" ||
    endpoint.pathname !== "/ws/api.dll"
  ) {
    throw new Error("BLOCKED_NON_READONLY_EBAY_TRADING_REQUEST")
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml",
          "X-EBAY-API-CALL-NAME": callName,
          "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
          "X-EBAY-API-SITEID": SITE_ID_US,
          "X-EBAY-API-IAF-TOKEN": accessToken,
        },
        body: requestXml(callName, ebayItemId),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const xml = await response.text()
      if (response.status === 429) {
        throw createEbayReadonlyRateLimitError("EBAY_READONLY_GET_429", response, {
          apiFamily: "TRADING",
          operation: callName === "GetUser" ? "GET_USER" : "GET_ITEM_IDENTITY",
          endpoint: "/ws/api.dll",
        })
      }
      if (response.ok && responseAccepted(xml)) return xml
      if (
        ![500, 502, 503, 504].includes(response.status) ||
        attempt === MAX_RETRIES - 1
      ) {
        throw new Error(`EBAY_TRADING_${callName.toUpperCase()}_${response.status}`)
      }
    } catch (error) {
      if (getEbayReadonlyRateLimitMetadata(error)) throw error
      if (attempt === MAX_RETRIES - 1) throw error
    }
    await wait(400 * (attempt + 1))
  }
  throw new Error(`EBAY_TRADING_${callName.toUpperCase()}_FAILED`)
}

export function getTradingManualListingReadonlyConfiguration() {
  const identity = getEbayProductionIdentityBindingConfiguration()
  return {
    configured: Boolean(
      process.env.EBAY_CLIENT_ID?.trim() &&
      process.env.EBAY_CLIENT_SECRET?.trim() &&
      process.env.EBAY_SELLER_REFRESH_TOKEN?.trim()
    ),
    environment: "PRODUCTION" as const,
    identityBound: identity.bound,
    identityConfigurationConsistent: identity.consistent,
    identityMayRequireRebindingAfterEbayUserIdMigration: true as const,
    connector: EBAY_MANUAL_LISTING_TRADING_CONNECTOR,
    ebayWriteUsed: false as const,
    canPublish: false as const,
  }
}

function maskEbayUserId(userId: string) {
  if (userId.length <= 4) return "********"
  return `${userId.slice(0, 2)}******${userId.slice(-2)}`
}

export async function probeEbayProductionIdentityReadOnly(
  fetchImpl: FetchLike = fetch,
): Promise<EbayProductionIdentityReadOnlyProbeResult> {
  // The identity probe intentionally bypasses the process token cache so each
  // invocation validates the currently configured Preview refresh token.
  const accessToken = await getTradingAccessToken(fetchImpl, false)

  const getUserXml = await tradingRead("GetUser", accessToken, fetchImpl)
  const userId = tradingXmlTagValue(
    tradingXmlContainer(getUserXml, "User"),
    "UserID",
  )
  if (!userId) {
    throw new Error("EBAY_TRADING_GETUSER_IDENTITY_MISSING")
  }

  const fingerprint = ebayProductionAccountFingerprint(userId)
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error("EBAY_TRADING_GETUSER_IDENTITY_MISSING")
  }

  const identity = getEbayProductionIdentityBindingConfiguration()
  if (!identity.configuredFingerprintValid || !identity.consistent) {
    throw new Error("EBAY_TRADING_CONFIGURED_FINGERPRINT_MISMATCH")
  }
  const configuredFingerprint = normalizedFingerprint(
    identity.expectedAccountFingerprint,
  )
  const baseResult = {
    oauthValid: true,
    accessTokenReceived: true,
    getUserValid: true,
    environment: "PRODUCTION",
    maskedUserId: maskEbayUserId(userId),
    fingerprintFormatValid: true,
    scopesVerified: true,
    ebayWriteUsed: false,
    canPublish: false,
  } as const

  if (!configuredFingerprint) {
    return {
      ...baseResult,
      fingerprint,
      configuredFingerprintPresent: false,
      configuredFingerprintMatches: false,
      identityBindingStatus: "UNBOUND",
    }
  }

  const configuredFingerprintMatches = timingSafeEqual(
    Buffer.from(fingerprint, "hex"),
    Buffer.from(configuredFingerprint, "hex"),
  )
  if (!configuredFingerprintMatches) {
    throw new Error("EBAY_TRADING_CONFIGURED_FINGERPRINT_MISMATCH")
  }

  return {
    ...baseResult,
    configuredFingerprintPresent: true,
    configuredFingerprintMatches: true,
    identityBindingStatus: "BOUND_MATCH",
  }
}

export async function readManualListingFromTradingApi(
  ebayItemId: string,
  fetchImpl: FetchLike = fetch,
) {
  const identity = getEbayProductionIdentityBindingConfiguration()
  if (!identity.bound) {
    throw new Error("EBAY_TRADING_OFFICIAL_IDENTITY_NOT_BOUND")
  }
  const accessToken = await getTradingAccessToken(fetchImpl)
  const [getUserXml, getItemXml] = await Promise.all([
    tradingRead("GetUser", accessToken, fetchImpl),
    tradingRead("GetItem", accessToken, fetchImpl, ebayItemId),
  ])
  return parseTradingManualListingResponses(
    getUserXml,
    getItemXml,
    ebayItemId,
    new Date(),
    identity.expectedUserId,
    identity.expectedAccountFingerprint,
  )
}
