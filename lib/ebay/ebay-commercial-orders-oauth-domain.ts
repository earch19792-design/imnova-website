import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto"

// @ts-ignore Node's native TypeScript test runner requires the explicit extension.
import { EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES } from "./ebay-capability-registry.ts"

export { EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES }

export const EBAY_COMMERCIAL_ORDERS_BASE_SCOPE =
  EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES[0]
export const EBAY_COMMERCIAL_ORDERS_FULFILLMENT_READONLY_SCOPE =
  EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES[1]

export const EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_ENDPOINT =
  "https://auth.ebay.com/oauth2/authorize"

export const EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_PATH =
  "/api/admin/ebay/commercial-orders-oauth/callback"
export const EBAY_COMMERCIAL_ORDERS_LEGACY_CALLBACK_PATH =
  "/api/admin/ebay/oauth/callback"
export const EBAY_COMMERCIAL_ORDERS_PREVIEW_BRANCH_HOST =
  "imnova-website-z1qh-git-featur-438554-earch19792-6888s-projects.vercel.app"
export const EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_URL =
  `https://${EBAY_COMMERCIAL_ORDERS_PREVIEW_BRANCH_HOST}${EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_PATH}`

export function getEbayCommercialOrdersCallbackConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const deployedBranchHost = (environment.VERCEL_BRANCH_URL ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
  return {
    canonicalPath: EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_PATH,
    canonicalUrl: EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_URL,
    legacyPath: EBAY_COMMERCIAL_ORDERS_LEGACY_CALLBACK_PATH,
    legacyCallbackBlocked: true as const,
    deployedBranchHostStatus: !deployedBranchHost
      ? "UNAVAILABLE" as const
      : deployedBranchHost === EBAY_COMMERCIAL_ORDERS_PREVIEW_BRANCH_HOST
        ? "MATCH" as const
        : "MISMATCH" as const,
    secretsReturned: false as const,
  }
}

export function createEbayCommercialOAuthState() {
  return randomBytes(32).toString("base64url")
}
export function isValidEbayCommercialOAuthState(state: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(state)
}
export function isValidEbayCommercialAuthorizationCode(code: string) {
  return Boolean(code) && code.length <= 2_048
}
export function hashEbayCommercialOAuthState(state: string) {
  return createHash("sha256").update(state, "utf8").digest("hex")
}

export function validateEbayCommercialOAuthPublicKey(publicKeyPem: string) {
  if (
    publicKeyPem.length < 700 ||
    publicKeyPem.length > 1_600 ||
    !publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----")
  ) return false
  try {
    const key = createPublicKey(publicKeyPem)
    return key.asymmetricKeyType === "rsa" &&
      (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 4_096
  } catch {
    return false
  }
}

export function buildEbayCommercialOrdersConsentUrl(input: {
  clientId: string
  runame: string
  state: string
}) {
  return buildEbayCommercialOrdersDiagnosticConsentUrl({
    ...input,
    phase: "base_with_state_and_fulfillment",
  })
}

export function buildEbayCommercialOrdersDiagnosticConsentUrl(input: {
  clientId: string
  runame: string
  state?: string
  phase: "base_only" | "base_with_state" | "base_with_state_and_fulfillment"
}) {
  const stateRequired = input.phase !== "base_only"
  if (
    !input.clientId || !input.runame ||
    (stateRequired && !isValidEbayCommercialOAuthState(input.state ?? "")) ||
    (!stateRequired && input.state)
  ) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_OAUTH_START_INVALID")
  }
  const scopes = input.phase === "base_with_state_and_fulfillment"
    ? EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES
    : [EBAY_COMMERCIAL_ORDERS_BASE_SCOPE]
  const parameters = [
    ["client_id", input.clientId],
    ["response_type", "code"],
    ["redirect_uri", input.runame],
    ["scope", scopes.join(" ")],
    ...(stateRequired ? [["state", input.state ?? ""]] : []),
  ]
  return `${EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_ENDPOINT}?${parameters
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")}`
}

export function encryptEbayCommercialRefreshToken(
  refreshToken: string,
  publicKeyPem: string,
) {
  if (!refreshToken || !validateEbayCommercialOAuthPublicKey(publicKeyPem)) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_OAUTH_ENCRYPTION_INVALID")
  }
  const key = randomBytes(32)
  const iv = randomBytes(12)
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv)
    const ciphertext = Buffer.concat([
      cipher.update(refreshToken, "utf8"),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    const encryptedKey = publicEncrypt({
      key: publicKeyPem,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    }, key)
    return JSON.stringify({
      version: "RSA_OAEP_SHA256_AES_256_GCM_V1",
      encryptedKey: encryptedKey.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    })
  } finally {
    key.fill(0)
    iv.fill(0)
  }
}
