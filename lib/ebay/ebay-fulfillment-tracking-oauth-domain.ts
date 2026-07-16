// @ts-ignore Node's native TypeScript test runner requires the explicit extension.
import * as commercialOAuthDomain from "./ebay-commercial-orders-oauth-domain.ts"
// @ts-ignore Node's native TypeScript test runner requires the explicit extension.
import { EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH, EBAY_FULFILLMENT_TRACKING_CALLBACK_URL, EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST } from "./ebay-fulfillment-tracking-public.ts"

export {
  EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH,
  EBAY_FULFILLMENT_TRACKING_CALLBACK_URL,
  EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST,
}

const {
  createEbayCommercialOAuthState,
  encryptEbayCommercialRefreshToken,
  hashEbayCommercialOAuthState,
  isValidEbayCommercialAuthorizationCode,
  isValidEbayCommercialOAuthState,
  validateEbayCommercialOAuthPublicKey,
} = commercialOAuthDomain

export const EBAY_FULFILLMENT_TRACKING_BASE_SCOPE =
  "https://api.ebay.com/oauth/api_scope"
export const EBAY_FULFILLMENT_TRACKING_WRITE_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment"
export const EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES = [
  EBAY_FULFILLMENT_TRACKING_BASE_SCOPE,
  EBAY_FULFILLMENT_TRACKING_WRITE_SCOPE,
] as const

export const EBAY_FULFILLMENT_TRACKING_CONNECTION_STATES = [
  "NOT_CONFIGURED",
  "AUTHORIZATION_REQUIRED",
  "AUTHORIZATION_IN_PROGRESS",
  "READY",
  "SCOPE_MISSING",
  "IDENTITY_MISMATCH",
  "FINGERPRINT_MISMATCH",
  "EXPIRED_OR_REVOKED",
  "ERROR",
] as const

export type EbayFulfillmentTrackingConnectionState =
  typeof EBAY_FULFILLMENT_TRACKING_CONNECTION_STATES[number]

export function ebayFulfillmentTrackingScopeConfirmed(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null
  const scopes = new Set(value.trim().split(/\s+/u))
  return scopes.has(EBAY_FULFILLMENT_TRACKING_WRITE_SCOPE)
}

export function classifyEbayFulfillmentTrackingConnectionError(
  value: unknown,
): EbayFulfillmentTrackingConnectionState {
  const code = typeof value === "string" ? value : ""
  if (code.includes("INVALID_SCOPE") || code.includes("SCOPE_MISSING")) {
    return "SCOPE_MISSING"
  }
  if (code.includes("FINGERPRINT_MISMATCH")) return "FINGERPRINT_MISMATCH"
  if (code.includes("IDENTITY_MISMATCH")) return "IDENTITY_MISMATCH"
  if (
    code.includes("INVALID_GRANT") || code.includes("REVOKED") ||
    code.includes("EXPIRED")
  ) return "EXPIRED_OR_REVOKED"
  return "ERROR"
}

export {
  createEbayCommercialOAuthState as createEbayFulfillmentTrackingOAuthState,
  encryptEbayCommercialRefreshToken as encryptEbayFulfillmentTrackingRefreshToken,
  hashEbayCommercialOAuthState as hashEbayFulfillmentTrackingOAuthState,
  isValidEbayCommercialAuthorizationCode as isValidEbayFulfillmentTrackingAuthorizationCode,
  isValidEbayCommercialOAuthState as isValidEbayFulfillmentTrackingOAuthState,
  validateEbayCommercialOAuthPublicKey as validateEbayFulfillmentTrackingPublicKey,
}

export function buildEbayFulfillmentTrackingConsentUrl(input: {
  clientId: string
  runame: string
  state: string
}) {
  if (
    !input.clientId || !input.runame ||
    !isValidEbayCommercialOAuthState(input.state)
  ) throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_START_INVALID")
  const query = [
    ["client_id", input.clientId],
    ["response_type", "code"],
    ["redirect_uri", input.runame],
    ["scope", EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES.join(" ")],
    ["state", input.state],
  ].map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")
  const url = `https://auth.ebay.com/oauth2/authorize?${query}`
  if (url.includes("prompt=") || url.includes("+") || url.includes("%252F")) {
    throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_ENCODING_INVALID")
  }
  return url
}

export function getEbayFulfillmentTrackingCallbackConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const deployedBranchHost = (environment.VERCEL_BRANCH_URL ?? "")
    .trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")
  return {
    canonicalPath: EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH,
    canonicalUrl: EBAY_FULFILLMENT_TRACKING_CALLBACK_URL,
    dedicated: true as const,
    deployedBranchHostStatus: !deployedBranchHost
      ? "UNAVAILABLE" as const
      : deployedBranchHost === EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST
        ? "MATCH" as const
        : "MISMATCH" as const,
    secretsReturned: false as const,
  }
}
