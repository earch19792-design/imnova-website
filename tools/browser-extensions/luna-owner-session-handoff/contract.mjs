export const BUILD_ID = "LUNA_OWNER_SESSION_HANDOFF_EXTENSION_V1"
export const BUILD_VERSION = "1.0.0"
export const HANDOFF_VERSION = "SELLER_OS_LUNA_OWNER_REAUTH_HANDOFF_V1"
export const SESSION_VERSION = "SELLER_OS_LUNA_PROTECTED_SESSION_V1"
export const PREPROD_ORIGIN = "https://imnova-seller-os-preprod.vercel.app"
export const UPLOAD_PATH = "/api/admin/ebay/luna-protected-session"
export const ENVIRONMENT =
  "SELLER_OS_DEDICATED_PREPROD:vsfthqydfrdzulldbfbe:prj_XvOpSg1jhmLLG1yOCFhAbiLEn222"
export const OPTIONAL_LUNA_ORIGINS = Object.freeze([
  "https://lunaportex.com/*",
  "https://www.lunaportex.com/*",
  "https://account.lunaportex.com/*",
])
export const LUNA_TAB_PATTERNS = Object.freeze([
  "https://lunaportex.com/*",
  "https://www.lunaportex.com/*",
  "https://account.lunaportex.com/*",
])

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NONCE = /^[A-Za-z0-9_-]{43}$/
const SAFE_COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/
const SAFE_COOKIE_VALUE = /^[^;\u0000-\u001f\u007f]{1,4096}$/
const REQUIRED_COOKIE = /^(?:__Host-|__Secure-)?(?:_shopify_essential|_secure_customer_sig|customer_auth_provider|customer_auth_session_created_at|customer_account_session|shopify_customer_account_session|_shopify_customer_account_session|account_session|accounts_session|identity_session)$/i
const CHALLENGE_KEYS = [
  "challengeId",
  "contractVersion",
  "environmentBinding",
  "expiresAt",
  "nonce",
  "oneTime",
  "ownerAdminCreated",
  "plaintextSessionAccepted",
  "publicKeyPem",
  "targetOrigin",
  "uploadPath",
].join(",")

export function safeCode(cause) {
  const value = cause instanceof Error ? cause.message : String(cause ?? "")
  return /^[A-Z0-9_]{3,160}$/.test(value)
    ? value : "LUNA_OWNER_EXTENSION_FAILED_CLOSED"
}

export function exactChallenge(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== CHALLENGE_KEYS ||
      value.contractVersion !== HANDOFF_VERSION ||
      typeof value.challengeId !== "string" || !UUID.test(value.challengeId) ||
      typeof value.nonce !== "string" || !NONCE.test(value.nonce) ||
      value.environmentBinding !== ENVIRONMENT ||
      value.targetOrigin !== PREPROD_ORIGIN || value.uploadPath !== UPLOAD_PATH ||
      value.oneTime !== true || value.ownerAdminCreated !== true ||
      value.plaintextSessionAccepted !== false ||
      typeof value.publicKeyPem !== "string" ||
      !value.publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----") ||
      !value.publicKeyPem.endsWith("-----END PUBLIC KEY-----\n") ||
      typeof value.expiresAt !== "string") {
    throw new Error("LUNA_OWNER_HANDOFF_CHALLENGE_INVALID")
  }
  const expiry = Date.parse(value.expiresAt)
  if (!Number.isFinite(expiry) || expiry <= now || expiry > now + 9 * 60_000) {
    throw new Error("LUNA_OWNER_HANDOFF_EXPIRED")
  }
  return value
}

export function selectSessionCookies(cookies, now = Date.now()) {
  const selected = cookies.filter((cookie) => {
    const domain = String(cookie.domain ?? "").toLowerCase().replace(/^\./, "")
    return (domain === "lunaportex.com" || domain === "www.lunaportex.com") &&
      cookie.secure === true && SAFE_COOKIE_NAME.test(String(cookie.name ?? "")) &&
      SAFE_COOKIE_VALUE.test(String(cookie.value ?? "")) &&
      REQUIRED_COOKIE.test(String(cookie.name ?? ""))
  })
  const unique = new Map()
  for (const cookie of selected) {
    const previous = unique.get(cookie.name)
    if (previous && previous.value !== cookie.value) {
      throw new Error("LUNA_OWNER_HANDOFF_SESSION_COOKIE_SET_AMBIGUOUS")
    }
    unique.set(cookie.name, cookie)
  }
  const values = [...unique.values()].sort((left, right) =>
    left.name.localeCompare(right.name))
  if (values.length < 1 || values.length > 12) {
    throw new Error("LUNA_OWNER_HANDOFF_SESSION_COOKIE_SET_INVALID")
  }
  const cookieHeader = values.map((cookie) =>
    `${cookie.name}=${cookie.value}`).join("; ")
  if (new TextEncoder().encode(cookieHeader).byteLength > 8_192) {
    throw new Error("LUNA_OWNER_HANDOFF_SESSION_COOKIE_SET_INVALID")
  }
  const explicitExpiries = values
    .filter((cookie) => Number(cookie.expirationDate) > 0)
    .map((cookie) => Math.floor(Number(cookie.expirationDate) * 1_000))
  const expiresAt = Math.min(
    now + 24 * 60 * 60_000,
    explicitExpiries.length ? Math.min(...explicitExpiries) : Infinity,
  )
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 60_000) {
    throw new Error("LUNA_OWNER_HANDOFF_SESSION_EXPIRY_INVALID")
  }
  return Object.freeze({ values, cookieHeader, expiresAt })
}

function bytesToBase64Url(bytes) {
  let binary = ""
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function publicKeyBytes(pem) {
  const body = pem.replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "").replace(/\s/g, "")
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export async function encryptSessionPayload(challengeInput, sessionInput,
  cryptoImpl = globalThis.crypto) {
  const challenge = exactChallenge(challengeInput)
  if (!cryptoImpl?.subtle || !cryptoImpl?.getRandomValues) {
    throw new Error("LUNA_OWNER_EXTENSION_WEBCRYPTO_UNAVAILABLE")
  }
  const encoder = new TextEncoder()
  let sessionBytes = null
  let sessionKeyBytes = null
  let iv = null
  let encryptedBytes = null
  let wrappedKeyBytes = null
  let publicBytes = null
  try {
    sessionBytes = encoder.encode(JSON.stringify({
      contractVersion: SESSION_VERSION,
      cookieHeader: sessionInput.cookieHeader,
      capturedAt: sessionInput.capturedAt,
      validatedAt: sessionInput.validatedAt,
      expiresAt: sessionInput.expiresAt,
    }))
    sessionKeyBytes = cryptoImpl.getRandomValues(new Uint8Array(32))
    iv = cryptoImpl.getRandomValues(new Uint8Array(12))
    const sessionKey = await cryptoImpl.subtle.importKey(
      "raw", sessionKeyBytes, "AES-GCM", false, ["encrypt"])
    const additionalData = encoder.encode([
      HANDOFF_VERSION,
      challenge.challengeId,
      ENVIRONMENT,
      challenge.expiresAt,
    ].join("\u0000"))
    encryptedBytes = new Uint8Array(await cryptoImpl.subtle.encrypt({
      name: "AES-GCM", iv, additionalData, tagLength: 128,
    }, sessionKey, sessionBytes))
    additionalData.fill(0)
    if (encryptedBytes.length <= 16) {
      throw new Error("LUNA_OWNER_EXTENSION_ENCRYPTION_FAILED")
    }
    publicBytes = publicKeyBytes(challenge.publicKeyPem)
    const publicKey = await cryptoImpl.subtle.importKey("spki", publicBytes, {
      name: "RSA-OAEP", hash: "SHA-256",
    }, false, ["encrypt"])
    wrappedKeyBytes = new Uint8Array(await cryptoImpl.subtle.encrypt({
      name: "RSA-OAEP",
    }, publicKey, sessionKeyBytes))
    const ciphertext = encryptedBytes.slice(0, -16)
    const authTag = encryptedBytes.slice(-16)
    const envelope = Object.freeze({
      contractVersion: HANDOFF_VERSION,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      environmentBinding: ENVIRONMENT,
      expiresAt: challenge.expiresAt,
      wrappedKey: bytesToBase64Url(wrappedKeyBytes),
      iv: bytesToBase64Url(iv),
      authTag: bytesToBase64Url(authTag),
      ciphertext: bytesToBase64Url(ciphertext),
    })
    ciphertext.fill(0)
    authTag.fill(0)
    return envelope
  } finally {
    sessionBytes?.fill(0)
    sessionKeyBytes?.fill(0)
    iv?.fill(0)
    encryptedBytes?.fill(0)
    wrappedKeyBytes?.fill(0)
    publicBytes?.fill(0)
  }
}
