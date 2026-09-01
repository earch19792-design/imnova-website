import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
} from "node:crypto"

const EBAY_AUTHORIZATION_ENDPOINT = "https://auth.ebay.com/oauth2/authorize"

export const EBAY_PUBLICATION_OAUTH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
] as const

export const EBAY_PUBLICATION_OAUTH_BUNDLE_VERSION =
  "EBAY_PUBLICATION_OAUTH_CREDENTIAL_BUNDLE_V1" as const

export const EBAY_PUBLICATION_OAUTH_CALLBACK_PATH =
  "/api/admin/ebay/monitor/seller-oauth-reauth" as const

export function createEbayPublicationOAuthState() {
  return randomBytes(32).toString("base64url")
}

export function hashEbayPublicationOAuthState(state: string) {
  return createHash("sha256").update(state, "utf8").digest("hex")
}

export function isValidEbayPublicationOAuthState(state: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(state)
}

export function isValidEbayPublicationAuthorizationCode(code: string) {
  return Boolean(code) && code.length <= 2_048
}

export function validateEbayPublicationOAuthPublicKey(publicKeyPem: string) {
  if (
    publicKeyPem.length < 700 || publicKeyPem.length > 1_600 ||
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

export function buildEbayPublicationConsentUrl(input: {
  clientId: string
  runame: string
  state: string
}) {
  if (
    !input.clientId || !input.runame ||
    !isValidEbayPublicationOAuthState(input.state)
  ) {
    throw new Error("EBAY_PUBLICATION_OAUTH_START_INVALID")
  }
  const parameters = [
    ["client_id", input.clientId],
    ["response_type", "code"],
    ["redirect_uri", input.runame],
    ["scope", EBAY_PUBLICATION_OAUTH_SCOPES.join(" ")],
    ["state", input.state],
  ]
  return `${EBAY_AUTHORIZATION_ENDPOINT}?${parameters
    .map(([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")}`
}

export function publicationScopesConfirmed(scope: unknown) {
  if (typeof scope !== "string" || !scope.trim()) return null
  const returned = new Set(scope.trim().split(/\s+/))
  return EBAY_PUBLICATION_OAUTH_SCOPES.every((value) => returned.has(value))
}

export function publicationIdentityConfirmed(payload: unknown) {
  const identity = payload && typeof payload === "object" &&
      !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
  const userId = typeof identity.userId === "string"
    ? identity.userId.trim()
    : ""
  const status = typeof identity.status === "string"
    ? identity.status.trim().toUpperCase()
    : ""

  // eBay returns userId with commerce.identity.readonly. The status field is
  // intentionally omitted unless the separate identity.status scope is
  // requested, so absence is not an account failure. If eBay does return a
  // status, however, fail closed unless the account is confirmed.
  return Boolean(userId) && (!status || status === "CONFIRMED")
}

export function encryptEbayPublicationCredentialBundle(input: {
  clientId: string
  clientSecret: string
  refreshToken: string
  publicKeyPem: string
}) {
  if (!input.clientId || !input.clientSecret || !input.refreshToken) {
    throw new Error("EBAY_PUBLICATION_OAUTH_CREDENTIAL_BUNDLE_INVALID")
  }
  let plaintext = JSON.stringify({
    version: EBAY_PUBLICATION_OAUTH_BUNDLE_VERSION,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    refreshToken: input.refreshToken,
  })
  try {
    if (!validateEbayPublicationOAuthPublicKey(input.publicKeyPem)) {
      throw new Error("EBAY_PUBLICATION_OAUTH_PUBLIC_KEY_INVALID")
    }
    const key = randomBytes(32)
    const iv = randomBytes(12)
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ])
      const tag = cipher.getAuthTag()
      const encryptedKey = publicEncrypt({
        key: input.publicKeyPem,
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
  } finally {
    plaintext = ""
    input.clientId = ""
    input.clientSecret = ""
    input.refreshToken = ""
  }
}
