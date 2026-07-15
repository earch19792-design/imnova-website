import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto"

export const EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
] as const

export const EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_ENDPOINT =
  "https://auth.ebay.com/oauth2/authorize"

export function createEbayCommercialOAuthState() {
  return randomBytes(32).toString("base64url")
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
  if (!input.clientId || !input.runame || !/^[A-Za-z0-9_-]{43}$/.test(input.state)) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_OAUTH_START_INVALID")
  }
  const parameters = [
    ["client_id", input.clientId],
    ["redirect_uri", input.runame],
    ["response_type", "code"],
    ["scope", EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES.join(" ")],
    ["state", input.state],
    ["prompt", "login"],
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
