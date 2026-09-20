import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import { getSellerOsAdminOriginBindingV1 } from
  "../admin-session-origin-v1"
import { SellerOsAdminPreResearchErrorV1 } from
  "./luna-pre-research-admin-api-v1"

export const SELLER_OS_CONTROL_CSRF_TTL_MS = 10 * 60 * 1_000

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN = /^pr2\.([0-9a-z]{6,12})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/
const OPERATIONS = new Set(["TEO_CONTROL_AUTHORIZATION"])

type CsrfContext = Readonly<{
  actorUserId: string
  adminSessionToken: string
  requestUrl: string
  origin: string | null
  secFetchSite: string | null
  operation: string
}>

function fail(code: string): never {
  throw new SellerOsAdminPreResearchErrorV1(code)
}

function sha256(parts: readonly string[]) {
  return createHash("sha256").update(parts.join("\n")).digest("hex")
}

function equalText(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function signingKey(secret: string) {
  if (secret.length < 32 || secret.length > 16_384) {
    fail("ADMIN_PRE_RESEARCH_CSRF_ENTROPY_UNAVAILABLE")
  }
  return createHash("sha256")
    .update("SELLER_OS_CONTROL_CSRF_SIGNING_KEY_V1\n")
    .update(secret)
    .digest()
}

function subject(input: CsrfContext, requireOrigin: boolean) {
  if (!UUID.test(input.actorUserId) || input.adminSessionToken.length < 32 ||
      input.adminSessionToken.length > 16_384 ||
      !OPERATIONS.has(input.operation)) {
    fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
  }
  const origin = getSellerOsAdminOriginBindingV1({
    requestUrl: input.requestUrl,
    origin: input.origin,
    secFetchSite: input.secFetchSite,
    requireOrigin,
  })
  if (!origin) fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
  return sha256([
    "SELLER_OS_CONTROL_CSRF_SUBJECT_V1",
    input.actorUserId,
    sha256(["admin-session", input.adminSessionToken]),
    origin,
    input.operation,
  ])
}

function signature(secret: string, subjectDigest: string, payload: string) {
  return createHmac("sha256", signingKey(secret))
    .update(["SELLER_OS_CONTROL_CSRF_TOKEN_V1", subjectDigest, payload]
      .join("\n"))
    .digest("base64url")
}

export function issueSellerOsControlCsrfV1(
  input: CsrfContext,
  options: Readonly<{
    signingSecret: string
    now?: () => number
    random?: (bytes: number) => Buffer
  }>,
) {
  const at = (options.now ?? Date.now)()
  const expiresAtSeconds = Math.floor(
    (at + SELLER_OS_CONTROL_CSRF_TTL_MS) / 1_000)
  const nonce = (options.random ?? randomBytes)(32).toString("base64url")
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) {
    fail("ADMIN_PRE_RESEARCH_CSRF_ENTROPY_UNAVAILABLE")
  }
  const payload = `pr2.${expiresAtSeconds.toString(36)}.${nonce}`
  const csrfToken = `${payload}.${signature(options.signingSecret,
    subject(input, false), payload)}`
  if (!TOKEN.test(csrfToken)) {
    fail("ADMIN_PRE_RESEARCH_CSRF_ENTROPY_UNAVAILABLE")
  }
  return Object.freeze({
    csrfToken,
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    singleUse: true as const,
    adminSessionBound: true as const,
    originBound: true as const,
  })
}

export async function consumeSellerOsControlCsrfV1(
  input: CsrfContext & Readonly<{
    contentType: string | null
    csrfHeader: string | null
    csrfCookie: string | null
  }>,
  options: Readonly<{
    signingSecret: string
    now?: () => number
    consumeReplay: (input: Readonly<{
      tokenDigest: string
      actorUserId: string
      expiresAt: string
    }>) => Promise<boolean>
  }>,
) {
  if (input.contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json") fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
  const subjectDigest = subject(input, true)
  const header = input.csrfHeader ?? ""
  const cookie = input.csrfCookie ?? ""
  const parsed = TOKEN.exec(header)
  if (!parsed || !TOKEN.test(cookie) || !equalText(header, cookie)) {
    fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
  }
  const expiresAtSeconds = Number.parseInt(parsed[1], 36)
  const expiresAtMs = expiresAtSeconds * 1_000
  const at = (options.now ?? Date.now)()
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtMs <= at) {
    fail("ADMIN_PRE_RESEARCH_CSRF_EXPIRED")
  }
  if (expiresAtMs > at + SELLER_OS_CONTROL_CSRF_TTL_MS + 1_000) {
    fail("ADMIN_PRE_RESEARCH_CSRF_REJECTED")
  }
  const payload = header.slice(0, header.lastIndexOf("."))
  const expected = `${payload}.${signature(options.signingSecret,
    subjectDigest, payload)}`
  if (!equalText(header, expected)) {
    fail("ADMIN_PRE_RESEARCH_CSRF_SUBJECT_MISMATCH")
  }
  const tokenDigest = sha256(["csrf-token-v2", header])
  const expiresAt = new Date(expiresAtMs).toISOString()
  if (!await options.consumeReplay({ tokenDigest,
    actorUserId: input.actorUserId, expiresAt })) {
    fail("ADMIN_PRE_RESEARCH_CSRF_REUSED")
  }
  return Object.freeze({ actorUserId: input.actorUserId,
    operation: input.operation, expiresAt })
}
