export const EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH =
  "/api/admin/ebay/fulfillment-tracking-oauth/callback"
export const EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST =
  "imnova-website-z1qh-git-featur-438554-earch19792-6888s-projects.vercel.app"
export const EBAY_FULFILLMENT_TRACKING_CALLBACK_URL =
  `https://${EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST}${EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH}`

export type EbayFulfillmentTrackingCallbackHostStatus =
  "MATCH" | "MISMATCH" | "UNAVAILABLE"

export type EbayFulfillmentTrackingPublicCallbackConfiguration = {
  canonicalPath?: string
  canonicalUrl?: string
  dedicated?: boolean
  deployedBranchHostStatus?: EbayFulfillmentTrackingCallbackHostStatus
}

type CallbackResolutionInput = {
  configurationCallback?: EbayFulfillmentTrackingPublicCallbackConfiguration | null
  connectionCallbackPath?: string | null
  currentOrigin?: string | null
}

function safeOrigin(value: string | null | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null
    return parsed.origin
  } catch {
    return null
  }
}

function dedicatedPath(value: string | null | undefined) {
  return value === EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH
    ? EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH
    : null
}

function canonicalCallbackUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (
      parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.host !== EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST ||
      parsed.pathname !== EBAY_FULFILLMENT_TRACKING_CALLBACK_PATH ||
      parsed.search || parsed.hash
    ) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function resolveEbayFulfillmentTrackingCallback(
  input: CallbackResolutionInput,
) {
  const configuredUrl = canonicalCallbackUrl(
    input.configurationCallback?.canonicalUrl,
  )
  const origin = safeOrigin(input.currentOrigin)
  const originHost = origin ? new URL(origin).host : ""
  const originIsCanonical =
    originHost === EBAY_FULFILLMENT_TRACKING_PREVIEW_BRANCH_HOST
  const configuredPath = dedicatedPath(
    input.configurationCallback?.canonicalPath,
  )
  const connectionPath = dedicatedPath(input.connectionCallbackPath)

  let callbackUrl = EBAY_FULFILLMENT_TRACKING_CALLBACK_URL
  let source: "CONFIGURATION_URL" | "CONFIGURATION_PATH" |
    "CONNECTION_PATH" | "PUBLIC_CONSTANT" = "PUBLIC_CONSTANT"

  if (configuredUrl) {
    callbackUrl = configuredUrl
    source = "CONFIGURATION_URL"
  } else if (origin && originIsCanonical && configuredPath) {
    callbackUrl = `${origin}${configuredPath}`
    source = "CONFIGURATION_PATH"
  } else if (origin && originIsCanonical && connectionPath) {
    callbackUrl = `${origin}${connectionPath}`
    source = "CONNECTION_PATH"
  }

  const reportedHostStatus =
    input.configurationCallback?.deployedBranchHostStatus
  const hostStatus: EbayFulfillmentTrackingCallbackHostStatus =
    reportedHostStatus === "MATCH" || reportedHostStatus === "MISMATCH" ||
      reportedHostStatus === "UNAVAILABLE"
      ? reportedHostStatus
      : !origin
        ? "UNAVAILABLE"
        : originIsCanonical ? "MATCH" : "MISMATCH"

  return {
    callbackUrl,
    callbackAvailable: Boolean(canonicalCallbackUrl(callbackUrl)),
    source,
    hostStatus,
  }
}
