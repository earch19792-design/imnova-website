// @ts-ignore Node's native TypeScript test runner requires the explicit extension.
import * as commercialOAuthDomain from "./ebay-commercial-orders-oauth-domain.ts"

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

export const EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH =
  "/api/admin/ebay/fulfillment-tracking-oauth/callback"
export const EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST =
  "imnova-website-z1qh-git-featur-438554-earch19792-6888s-projects.vercel.app"
export const EBAY_FULFILLMENT_TRACKING_CALLBACK_URL =
  `https://${EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST}${EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH}`

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
