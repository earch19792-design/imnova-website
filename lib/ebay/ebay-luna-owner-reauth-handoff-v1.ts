import "server-only"

import {
  constants,
  createDecipheriv,
  createHash,
  generateKeyPair as generateKeyPairCallback,
  privateDecrypt,
  randomBytes,
} from "node:crypto"
import { promisify } from "node:util"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseAdminClient } from "../supabase-admin"
import { SELLER_OS_LUNA_PROTECTED_SESSION_VERSION } from
  "./ebay-luna-automation-prerequisites-v1"
import {
  probeLunaProtectedSessionEnvelopeV2,
  storeSellerOsLunaProtectedSessionV1,
  verifyStoredSellerOsLunaProtectedSessionV1,
} from "./ebay-luna-protected-session-server-v1"
import {
  SELLER_OS_LUNA_PROTECTED_SESSION_COOKIE_JAR_VERSION,
  parseSellerOsLunaSessionCookieJarV2,
} from "./ebay-luna-session-cookie-jar-v2"
import {
  SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION,
  getEbayProRuntimeBoundary,
} from "./environment-boundaries"

export const SELLER_OS_LUNA_OWNER_HANDOFF_VERSION =
  "SELLER_OS_LUNA_OWNER_REAUTH_HANDOFF_V1" as const
export const SELLER_OS_LUNA_OWNER_HANDOFF_TTL_MS = 8 * 60 * 1_000
export const SELLER_OS_LUNA_OWNER_HANDOFF_ORIGIN =
  "https://imnova-seller-os-preprod.vercel.app" as const
export const SELLER_OS_LUNA_OWNER_HANDOFF_PATH =
  "/api/admin/ebay/luna-protected-session" as const
export const SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT =
  "SELLER_OS_DEDICATED_PREPROD:vsfthqydfrdzulldbfbe:prj_XvOpSg1jhmLLG1yOCFhAbiLEn222" as const

const CREATE_RPC = "create_seller_os_luna_owner_handoff_v1" as const
const CLAIM_RPC = "claim_seller_os_luna_owner_handoff_v1" as const
const COMPLETE_RPC = "complete_seller_os_luna_owner_handoff_v1" as const
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BASE64URL = /^[A-Za-z0-9_-]+$/
const NONCE = /^[A-Za-z0-9_-]{43}$/
const COOKIE_HEADER = /^[^=;\s]+=[^\r\n;]*(?:;\s*[^=;\s]+=[^\r\n;]*)*$/
const MAX_SESSION_BYTES = 12_000
const generateKeyPair = promisify(generateKeyPairCallback)

const PROBE_SOURCE_STATUSES = new Set([
  "AVAILABLE", "AUTH_REQUIRED", "SOURCE_UNAVAILABLE",
])
const PROBE_PATH_CLASSES = new Set([
  "AUTHENTICATION_REQUIRED", "AUTH_CALLBACK", "LUNA_CUSTOMER_ACCOUNT",
  "LUNA_ACCOUNT", "LUNA_ALLOWED_POST_LOGIN",
])
const PROBE_HTTP_STATUS_CLASS = /^[1-5]XX$/

type RpcClient = Pick<SupabaseClient, "rpc">

export type SellerOsLunaOwnerHandoffEncryptedEnvelopeV1 = Readonly<{
  contractVersion: typeof SELLER_OS_LUNA_OWNER_HANDOFF_VERSION
  challengeId: string
  nonce: string
  environmentBinding: typeof SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT
  expiresAt: string
  wrappedKey: string
  iv: string
  authTag: string
  ciphertext: string
}>

function fail(code: string): never {
  throw new Error(/^[A-Z0-9_]{3,160}$/.test(code)
    ? code : "LUNA_OWNER_HANDOFF_FAILED_CLOSED")
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function sellerOsLunaOwnerHandoffSameInstantV1(
  left: unknown,
  right: unknown,
) {
  if (typeof left !== "string" || typeof right !== "string") return false
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) &&
    leftTime === rightTime
}

export function sellerOsLunaOwnerHandoffProbeFailureCodeV1(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "LUNA_OWNER_HANDOFF_PROBE_PRE_VAULT_CLASSIFICATION_UNAVAILABLE"
  }
  const probe = value as Record<string, unknown>
  const sourceStatus = typeof probe.sourceStatus === "string" &&
      PROBE_SOURCE_STATUSES.has(probe.sourceStatus)
    ? probe.sourceStatus : "CLASSIFICATION_UNAVAILABLE"
  const httpStatusClass = typeof probe.responseStatusClass === "string" &&
      PROBE_HTTP_STATUS_CLASS.test(probe.responseStatusClass)
    ? probe.responseStatusClass : "STATUS_UNAVAILABLE"
  const pathClass = typeof probe.postLoginPathClass === "string" &&
      PROBE_PATH_CLASSES.has(probe.postLoginPathClass)
    ? probe.postLoginPathClass : "PATH_UNAVAILABLE"
  return [
    "LUNA_OWNER_HANDOFF_PROBE_PRE_VAULT",
    sourceStatus,
    httpStatusClass,
    pathClass,
  ].join("_")
}

function sellerOsLunaOwnerHandoffProbeThrownCodeV1(cause: unknown) {
  const code = cause instanceof Error ? cause.message : ""
  return /^LUNA_PROTECTED_SESSION_[A-Z0-9_]{3,100}$/.test(code)
    ? `LUNA_OWNER_HANDOFF_PROBE_PRE_VAULT_${code}`
    : "LUNA_OWNER_HANDOFF_PROBE_PRE_VAULT_CLASSIFICATION_UNAVAILABLE"
}

export function isSellerOsLunaOwnerHandoffRuntimeV1(
  pathname: string = SELLER_OS_LUNA_OWNER_HANDOFF_PATH,
  method: string = "POST",
) {
  const boundary = getEbayProRuntimeBoundary({ pathname, method })
  return boundary.boundaryClassification ===
      SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION &&
    boundary.dedicatedPreprod.certified === true && boundary.blocked === false
}

function assertDedicatedPreprod(pathname: string, method: string) {
  if (!isSellerOsLunaOwnerHandoffRuntimeV1(pathname, method)) {
    fail("LUNA_OWNER_HANDOFF_DEDICATED_PREPROD_REQUIRED")
  }
}

function aad(input: Readonly<{
  challengeId: string
  expiresAt: string
}>) {
  return Buffer.from([
    SELLER_OS_LUNA_OWNER_HANDOFF_VERSION,
    input.challengeId,
    SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT,
    input.expiresAt,
  ].join("\u0000"), "utf8")
}

function decoded(value: string, minimum: number, maximum: number) {
  if (!BASE64URL.test(value) || value.length > Math.ceil(maximum * 4 / 3) + 4) {
    fail("LUNA_OWNER_HANDOFF_ENVELOPE_INVALID")
  }
  const bytes = Buffer.from(value, "base64url")
  if (bytes.length < minimum || bytes.length > maximum ||
      bytes.toString("base64url") !== value) {
    bytes.fill(0)
    fail("LUNA_OWNER_HANDOFF_ENVELOPE_INVALID")
  }
  return bytes
}

function parseEnvelope(value: unknown, now: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("LUNA_OWNER_HANDOFF_ENVELOPE_INVALID")
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(",") !==
      "authTag,challengeId,ciphertext,contractVersion,environmentBinding,expiresAt,iv,nonce,wrappedKey" ||
      record.contractVersion !== SELLER_OS_LUNA_OWNER_HANDOFF_VERSION ||
      typeof record.challengeId !== "string" || !UUID.test(record.challengeId) ||
      typeof record.nonce !== "string" || !NONCE.test(record.nonce) ||
      record.environmentBinding !== SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT ||
      typeof record.expiresAt !== "string" ||
      typeof record.wrappedKey !== "string" ||
      typeof record.iv !== "string" ||
      typeof record.authTag !== "string" ||
      typeof record.ciphertext !== "string") {
    fail("LUNA_OWNER_HANDOFF_ENVELOPE_INVALID")
  }
  const expiresAt = Date.parse(record.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now ||
      expiresAt > now + SELLER_OS_LUNA_OWNER_HANDOFF_TTL_MS + 60_000) {
    fail("LUNA_OWNER_HANDOFF_EXPIRED")
  }
  return record as SellerOsLunaOwnerHandoffEncryptedEnvelopeV1
}

function parseSessionPayload(payload: Buffer, now: number) {
  if (payload.length < 80 || payload.length > MAX_SESSION_BYTES) {
    fail("LUNA_OWNER_HANDOFF_SESSION_INVALID")
  }
  let value: unknown
  try { value = JSON.parse(payload.toString("utf8")) } catch {
    fail("LUNA_OWNER_HANDOFF_SESSION_INVALID")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("LUNA_OWNER_HANDOFF_SESSION_INVALID")
  }
  const session = value as Record<string, unknown>
  if (typeof session.capturedAt !== "string" ||
      typeof session.validatedAt !== "string" ||
      typeof session.expiresAt !== "string") {
    fail("LUNA_OWNER_HANDOFF_SESSION_INVALID")
  }
  const capturedAt = Date.parse(session.capturedAt)
  const validatedAt = Date.parse(session.validatedAt)
  const expiresAt = Date.parse(session.expiresAt)
  if (![capturedAt, validatedAt, expiresAt].every(Number.isFinite) ||
      capturedAt > validatedAt || validatedAt > now + 5 * 60_000 ||
      expiresAt <= now + 60_000 || expiresAt - capturedAt > 24 * 60 * 60_000) {
    fail("LUNA_OWNER_HANDOFF_SESSION_INVALID")
  }
  const timestamps = {
    capturedAt: new Date(capturedAt).toISOString(),
    validatedAt: new Date(validatedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  }
  if (session.contractVersion === SELLER_OS_LUNA_PROTECTED_SESSION_VERSION &&
      Object.keys(session).sort().join(",") ===
        "capturedAt,contractVersion,cookieHeader,expiresAt,validatedAt" &&
      typeof session.cookieHeader === "string" &&
      session.cookieHeader.length >= 8 && session.cookieHeader.length <= 8_192 &&
      COOKIE_HEADER.test(session.cookieHeader)) {
    return Object.freeze({
      contractVersion: SELLER_OS_LUNA_PROTECTED_SESSION_VERSION,
      cookieHeader: session.cookieHeader,
      ...timestamps,
    })
  }
  if (session.contractVersion ===
        SELLER_OS_LUNA_PROTECTED_SESSION_COOKIE_JAR_VERSION &&
      Object.keys(session).sort().join(",") ===
        "capturedAt,contractVersion,cookieJar,expiresAt,validatedAt") {
    const cookieJar = parseSellerOsLunaSessionCookieJarV2(
      session.cookieJar,
      expiresAt,
    )
    if (cookieJar) return Object.freeze({
      contractVersion: SELLER_OS_LUNA_PROTECTED_SESSION_COOKIE_JAR_VERSION,
      cookieJar,
      ...timestamps,
    })
  }
  fail("LUNA_OWNER_HANDOFF_SESSION_INVALID")
}

async function client(input?: RpcClient) {
  try { return input ?? getSupabaseAdminClient() } catch {
    fail("LUNA_OWNER_HANDOFF_VAULT_UNAVAILABLE")
  }
}

export async function createSellerOsLunaOwnerHandoffV1(input: Readonly<{
  actorUserId: string
  now?: number
  client?: RpcClient
}>) {
  assertDedicatedPreprod(SELLER_OS_LUNA_OWNER_HANDOFF_PATH, "POST")
  if (!UUID.test(input.actorUserId)) fail("LUNA_OWNER_HANDOFF_OWNER_ADMIN_REQUIRED")
  const at = input.now ?? Date.now()
  const expiresAt = new Date(at + SELLER_OS_LUNA_OWNER_HANDOFF_TTL_MS)
    .toISOString()
  const nonce = randomBytes(32).toString("base64url")
  const keys = await generateKeyPair("rsa", {
    modulusLength: 4096,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  const publicKeyPem = String(keys.publicKey)
  let privateKeyPem: string | null = String(keys.privateKey)
  try {
    const rpc = await client(input.client)
    const { data, error } = await rpc.rpc(CREATE_RPC, {
      p_actor: input.actorUserId,
      p_nonce_hash: digest(nonce),
      p_public_key_pem: publicKeyPem,
      p_private_key_pem: privateKeyPem,
      p_environment_binding: SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT,
      p_expires_at: expiresAt,
      p_now: new Date(at).toISOString(),
    })
    if (error || typeof data !== "string" || !UUID.test(data)) {
      fail("LUNA_OWNER_HANDOFF_CHALLENGE_CREATE_FAILED")
    }
    return Object.freeze({
      contractVersion: SELLER_OS_LUNA_OWNER_HANDOFF_VERSION,
      challengeId: data,
      nonce,
      publicKeyPem,
      expiresAt,
      environmentBinding: SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT,
      targetOrigin: SELLER_OS_LUNA_OWNER_HANDOFF_ORIGIN,
      uploadPath: SELLER_OS_LUNA_OWNER_HANDOFF_PATH,
      oneTime: true as const,
      ownerAdminCreated: true as const,
      plaintextSessionAccepted: false as const,
    })
  } finally {
    privateKeyPem = null
  }
}

export async function consumeSellerOsLunaOwnerHandoffV1(input: Readonly<{
  envelope: unknown
  now?: number
  client?: RpcClient
  fetchImpl?: typeof fetch
}>) {
  assertDedicatedPreprod(SELLER_OS_LUNA_OWNER_HANDOFF_PATH, "PUT")
  const at = input.now ?? Date.now()
  const envelope = parseEnvelope(input.envelope, at)
  const rpc = await client(input.client)
  const { data, error } = await rpc.rpc(CLAIM_RPC, {
    p_id: envelope.challengeId,
    p_nonce_hash: digest(envelope.nonce),
    p_environment_binding: SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT,
    p_now: new Date(at).toISOString(),
  })
  if (error) fail("LUNA_OWNER_HANDOFF_CLAIM_UNAVAILABLE")
  if (data === null || data === undefined) {
    fail("LUNA_OWNER_HANDOFF_REPLAY_OR_EXPIRED")
  }
  const claimed = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown> : null
  let privateKeyPem: string | null = null

  let wrappedKey: Buffer | null = null
  let iv: Buffer | null = null
  let authTag: Buffer | null = null
  let ciphertext: Buffer | null = null
  let sessionKey: Buffer | null = null
  let plaintext: Buffer | null = null
  let resultCode = "LUNA_OWNER_HANDOFF_FAILED_CLOSED"
  try {
    if (!claimed || typeof claimed.actorUserId !== "string" ||
        !UUID.test(claimed.actorUserId) ||
        typeof claimed.privateKeyPem !== "string" ||
        !claimed.privateKeyPem.startsWith("-----BEGIN PRIVATE KEY-----") ||
        claimed.environmentBinding !==
          SELLER_OS_LUNA_OWNER_HANDOFF_ENVIRONMENT ||
        typeof claimed.expiresAt !== "string") {
      fail("LUNA_OWNER_HANDOFF_POST_CLAIM_VALIDATION_FAILED")
    }
    if (!sellerOsLunaOwnerHandoffSameInstantV1(
      claimed.expiresAt,
      envelope.expiresAt,
    )) {
      fail("LUNA_OWNER_HANDOFF_POST_CLAIM_EXPIRY_MISMATCH")
    }
    privateKeyPem = claimed.privateKeyPem
    wrappedKey = decoded(envelope.wrappedKey, 512, 512)
    iv = decoded(envelope.iv, 12, 12)
    authTag = decoded(envelope.authTag, 16, 16)
    ciphertext = decoded(envelope.ciphertext, 80, MAX_SESSION_BYTES + 16)
    try {
      sessionKey = privateDecrypt({
        key: privateKeyPem ?? fail("LUNA_OWNER_HANDOFF_EPHEMERAL_KEY_UNAVAILABLE"),
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      }, wrappedKey)
    } catch {
      fail("LUNA_OWNER_HANDOFF_DECRYPT_FAILED")
    }
    if (sessionKey.length !== 32) fail("LUNA_OWNER_HANDOFF_DECRYPT_FAILED")
    try {
      const decipher = createDecipheriv("aes-256-gcm", sessionKey, iv)
      decipher.setAAD(aad(envelope))
      decipher.setAuthTag(authTag)
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    } catch {
      fail("LUNA_OWNER_HANDOFF_DECRYPT_FAILED")
    }
    const session = parseSessionPayload(plaintext, at)
    let probe: Awaited<ReturnType<typeof probeLunaProtectedSessionEnvelopeV2>>
    try {
      probe = await probeLunaProtectedSessionEnvelopeV2({
        envelope: session,
        fetchImpl: input.fetchImpl,
        now: at,
      })
    } catch (cause) {
      fail(sellerOsLunaOwnerHandoffProbeThrownCodeV1(cause))
    }
    if (!probe.authenticated) {
      fail(sellerOsLunaOwnerHandoffProbeFailureCodeV1(probe))
    }
    const verifiedPayload = Buffer.from(JSON.stringify({
      contractVersion: session.contractVersion,
      ...(session.contractVersion === SELLER_OS_LUNA_PROTECTED_SESSION_VERSION
        ? { cookieHeader: session.cookieHeader }
        : { cookieJar: session.cookieJar }),
      capturedAt: session.capturedAt,
      validatedAt: new Date(at).toISOString(),
      expiresAt: session.expiresAt,
    }), "utf8")
    try {
      await storeSellerOsLunaProtectedSessionV1({
        actorUserId: claimed.actorUserId,
        sessionPayload: verifiedPayload,
        now: new Date(at).toISOString(),
        client: rpc,
      })
    } finally {
      verifiedPayload.fill(0)
    }
    const readback = await verifyStoredSellerOsLunaProtectedSessionV1({
      client: rpc,
      fetchImpl: input.fetchImpl,
      now: at,
    })
    if (!readback.authenticated) fail("LUNA_OWNER_HANDOFF_VAULT_READBACK_FAILED")
    resultCode = "LUNA_OWNER_HANDOFF_SESSION_READY"
    const completed = await rpc.rpc(COMPLETE_RPC, {
      p_id: envelope.challengeId,
      p_success: true,
      p_result_code: resultCode,
      p_now: new Date(at).toISOString(),
    })
    if (completed.error || completed.data !== true) {
      fail("LUNA_OWNER_HANDOFF_COMPLETION_LEDGER_FAILED")
    }
    return Object.freeze({
      contractVersion: SELLER_OS_LUNA_OWNER_HANDOFF_VERSION,
      status: "SESSION_READY" as const,
      encryptedHandoffSuccess: true as const,
      sessionPersistedToStagingVault: true as const,
      preprodReadback: "SESSION_READY" as const,
      challengeConsumed: true as const,
      privateKeyDestroyedAtClaim: true as const,
      plaintextSessionReturned: false as const,
      marketplaceWrites: 0 as const,
    })
  } catch (cause) {
    resultCode = cause instanceof Error && /^[A-Z0-9_]{3,160}$/.test(cause.message)
      ? cause.message : "LUNA_OWNER_HANDOFF_FAILED_CLOSED"
    let failureLedgerClosed = false
    try {
      const completed = await rpc.rpc(COMPLETE_RPC, {
        p_id: envelope.challengeId,
        p_success: false,
        p_result_code: resultCode,
        p_now: new Date(at).toISOString(),
      })
      failureLedgerClosed = !completed.error && completed.data === true
    } catch { /* evaluated below */ }
    if (!failureLedgerClosed) {
      fail("LUNA_OWNER_HANDOFF_FAILURE_LEDGER_FAILED")
    }
    throw cause
  } finally {
    wrappedKey?.fill(0)
    iv?.fill(0)
    authTag?.fill(0)
    ciphertext?.fill(0)
    sessionKey?.fill(0)
    plaintext?.fill(0)
    privateKeyPem = null
  }
}
