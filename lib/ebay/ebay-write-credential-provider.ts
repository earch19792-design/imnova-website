import {
  assertEbayCapabilityGrantPurpose,
  EBAY_PRODUCTION_CAPABILITY_REGISTRY,
  type EbayProductionCapabilityGrant,
  type EbayWriteCapability,
} from "./ebay-production-capability-policy"
import {
  tradingXmlContainer,
  tradingXmlTagValue,
} from "./ebay-manual-listing-trading-readonly"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
  getEbaySellerAccountScopeConfiguration,
} from "./ebay-seller-account-scope"

export const EBAY_WRITE_CREDENTIAL_PROVIDER_VERSION =
  "EBAY_WRITE_CREDENTIAL_PROVIDER_V1" as const

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll"
const WRITE_CREDENTIAL_BRAND: unique symbol = Symbol("EBAY_WRITE_CREDENTIAL")
const WRITE_TOKEN: unique symbol = Symbol("EBAY_WRITE_TOKEN")

type CachedWriteCredential = {
  token: string
  expiresAt: number
  accountFingerprint: string
}

const cache = new Map<string, CachedWriteCredential>()

export type EbayWriteCredential<C extends EbayWriteCapability =
  EbayWriteCapability> = {
  readonly [WRITE_CREDENTIAL_BRAND]: true
  readonly [WRITE_TOKEN]: string
  readonly purpose: C
  readonly providerVersion: typeof EBAY_WRITE_CREDENTIAL_PROVIDER_VERSION
  readonly scopes: readonly string[]
  readonly accountKey: string
  readonly accountFingerprint: string
  readonly expiresAt: string
}

async function verifyOfficialWriteIdentity(input: {
  accessToken: string
  accountKey: string
  fetchImpl: typeof fetch
}) {
  const scope = getEbaySellerAccountScopeConfiguration()
  const identity = getEbayProductionIdentityBindingConfiguration()
  if (!scope.configured || !scope.accountKey || !identity.bound ||
    !identity.consistent || !/^[0-9a-f]{64}$/.test(
      identity.expectedAccountFingerprint,
    )) {
    throw new Error("EBAY_WRITE_CREDENTIAL_ACCOUNT_IDENTITY_REQUIRED")
  }
  if (scope.accountKey !== input.accountKey) {
    throw new Error("EBAY_WRITE_CREDENTIAL_ACCOUNT_MISMATCH")
  }
  const response = await input.fetchImpl(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetUser",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": input.accessToken,
    },
    body: "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
      "<OutputSelector>User.UserID</OutputSelector></GetUserRequest>",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  const xml = await response.text()
  const ack = tradingXmlTagValue(xml, "Ack")?.toLowerCase()
  const userId = tradingXmlTagValue(tradingXmlContainer(xml, "User"), "UserID")
  if (!response.ok || !["success", "warning"].includes(ack ?? "") || !userId) {
    throw new Error("EBAY_WRITE_CREDENTIAL_OFFICIAL_IDENTITY_UNAVAILABLE")
  }
  const fingerprint = ebayProductionAccountFingerprint(userId)
  const expectedUserMatches = !identity.expectedUserId ||
    identity.expectedUserId.toLocaleLowerCase("en-US") ===
      userId.toLocaleLowerCase("en-US")
  if (!expectedUserMatches ||
    fingerprint !== identity.expectedAccountFingerprint) {
    throw new Error("EBAY_WRITE_CREDENTIAL_ACCOUNT_MISMATCH")
  }
  return fingerprint
}

export async function getEbayWriteCredential<C extends EbayWriteCapability>(
  capability: C,
  grant: EbayProductionCapabilityGrant<C>,
  fetchImpl: typeof fetch = fetch,
): Promise<EbayWriteCredential<C>> {
  assertEbayCapabilityGrantPurpose(grant, capability, "effect")
  const clientId = process.env.EBAY_WRITE_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_WRITE_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = process.env.EBAY_WRITE_SELLER_REFRESH_TOKEN?.trim() ?? ""
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("EBAY_WRITE_CREDENTIAL_NOT_CONFIGURED")
  }
  const scopes = [...EBAY_PRODUCTION_CAPABILITY_REGISTRY[capability].requiredScopes]
  if (!scopes.length) throw new Error("EBAY_WRITE_CREDENTIAL_SCOPE_REQUIRED")
  const scopeValue = scopes.join(" ")
  const cacheKey = `${grant.accountKey}:${capability}:${scopeValue}`
  let cached = cache.get(cacheKey)
  if (!cached || cached.expiresAt <= Date.now() + 60_000) {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`,
          "utf8",
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: scopeValue,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
    const payload = await response.json().catch(() => ({})) as {
      access_token?: unknown
      expires_in?: unknown
    }
    const token = typeof payload.access_token === "string"
      ? payload.access_token.trim()
      : ""
    if (!response.ok || !token) {
      throw new Error("EBAY_WRITE_CREDENTIAL_SCOPE_REQUIRED")
    }
    const expiresIn = Math.max(120, Number(payload.expires_in) || 7_200)
    const accountFingerprint = await verifyOfficialWriteIdentity({
      accessToken: token,
      accountKey: grant.accountKey,
      fetchImpl,
    })
    cached = {
      token,
      expiresAt: Date.now() + expiresIn * 1_000,
      accountFingerprint,
    }
    cache.set(cacheKey, cached)
  }
  return {
    [WRITE_CREDENTIAL_BRAND]: true,
    [WRITE_TOKEN]: cached.token,
    purpose: capability,
    providerVersion: EBAY_WRITE_CREDENTIAL_PROVIDER_VERSION,
    scopes,
    accountKey: grant.accountKey,
    accountFingerprint: cached.accountFingerprint,
    expiresAt: new Date(cached.expiresAt).toISOString(),
  }
}

export function useEbayWriteCredential<C extends EbayWriteCapability>(
  credential: EbayWriteCredential,
  capability: C,
  accountKey: string,
) {
  if (credential?.[WRITE_CREDENTIAL_BRAND] !== true ||
    credential.purpose !== capability ||
    credential.accountKey !== accountKey ||
    !/^[0-9a-f]{64}$/.test(credential.accountFingerprint) ||
    !credential[WRITE_TOKEN] ||
    Date.parse(credential.expiresAt) <= Date.now()) {
    throw new Error("EBAY_WRITE_CREDENTIAL_PURPOSE_MISMATCH")
  }
  return credential[WRITE_TOKEN]
}
