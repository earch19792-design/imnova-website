import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { getSellerOsAdminOriginBindingV1 } from
  "../admin-session-origin-v1"

export const SELLER_OS_LUNA_BROWSER_CEREMONY_VERSION =
  "SELLER_OS_LUNA_BROWSER_CEREMONY_V1" as const
export const SELLER_OS_LUNA_CEREMONY_STATE_COOKIE =
  "seller_os_luna_ceremony_v1" as const
export const SELLER_OS_LUNA_CEREMONY_TTL_MS = 10 * 60 * 1_000
export const SELLER_OS_LUNA_CEREMONY_CSRF_COOKIE =
  "seller_os_luna_ceremony_csrf_v1" as const
export const SELLER_OS_LUNA_CEREMONY_CSRF_TTL_MS = 10 * 60 * 1_000
export const SELLER_OS_LUNA_LOGIN_ENTRYPOINT =
  "https://www.lunaportex.com/account/login" as const

export const SELLER_OS_LUNA_NAVIGATION_HOSTS = Object.freeze([
  "www.lunaportex.com",
  "account.lunaportex.com",
] as const)
export const SELLER_OS_LUNA_ASSET_HOSTS = Object.freeze([
  "cdn.shopify.com",
] as const)
export const SELLER_OS_LUNA_SECURITY_CHALLENGE_HOSTS = Object.freeze([
  "challenges.cloudflare.com",
] as const)

const NAVIGATION_HOSTS = new Set<string>(SELLER_OS_LUNA_NAVIGATION_HOSTS)
const ASSET_HOSTS = new Set<string>(SELLER_OS_LUNA_ASSET_HOSTS)
const SECURITY_CHALLENGE_HOSTS = new Set<string>(
  SELLER_OS_LUNA_SECURITY_CHALLENGE_HOSTS,
)
const NAVIGATION_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"])
const ASSET_METHODS = new Set(["GET", "HEAD"])
const SECURITY_CHALLENGE_METHODS = new Set([
  "GET",
  "HEAD",
  "POST",
  "OPTIONS",
])
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STATE_TOKEN = /^1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/
const CSRF_TOKEN = /^c1\.[A-Za-z0-9_-]{43}$/
const CEREMONY_INSTANCE = /^[A-Za-z0-9_-]{22}$/
const SAFE_HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/
const SAFE_ERROR = /^[A-Z0-9_]{3,160}$/
const SENSITIVE_QUERY_KEY = /^(?:password|passwd|credential|cookie|authorization|access_token|refresh_token|id_token|session_token|username|email|login|login_hint)$/i

export type SellerOsLunaBrowserRequestDecisionV1 = Readonly<{
  allowed: boolean
  classification:
    | "NAVIGATION_ALLOWED"
    | "ASSET_ALLOWED"
    | "SECURITY_CHALLENGE_ALLOWED"
    | "INTERNAL_BLANK_ALLOWED"
    | "TOP_LEVEL_ASSET_DENIED"
    | "TOP_LEVEL_SECURITY_CHALLENGE_DENIED"
    | "EXTERNAL_IDP_DENIED"
    | "ARBITRARY_HOST_DENIED"
    | "METHOD_DENIED"
    | "URL_DENIED"
  host: string | null
  failureCode: string | null
}>

export type SellerOsLunaSessionCaptureV1 = Readonly<{
  sessionPayload: Buffer
  expiresAt: string
  postLoginHost: string
  postLoginPathClass: string
  authenticatedStateProven: true
}>

export type SellerOsLunaBrowserHandleV1 = Readonly<{
  captureVerifiedSession: () => Promise<SellerOsLunaSessionCaptureV1>
  close: (reason: string) => Promise<void>
}>

type CeremonyPhase =
  | "LAUNCHING"
  | "AWAITING_HUMAN_LOGIN"
  | "COMPLETING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"

type CeremonyRecord = {
  actorUserId: string
  tokenDigest: string
  startedAt: string
  expiresAt: string
  phase: CeremonyPhase
  browser: SellerOsLunaBrowserHandleV1 | null
  blockedHost: string | null
  failureCode: string | null
  storedAt: string | null
  sessionDigest: string | null
  postLoginHost: string | null
  postLoginPathClass: string | null
  authenticatedStateProven: boolean
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

export class SellerOsLunaBrowserCeremonyError extends Error {
  readonly code: string

  constructor(code: string) {
    const safe = SAFE_ERROR.test(code)
      ? code : "LUNA_CEREMONY_FAILED_CLOSED"
    super(safe)
    this.name = "SellerOsLunaBrowserCeremonyError"
    this.code = safe
  }
}

function safeUrl(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password || parsed.port || parsed.hash) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function externalIdentityProvider(host: string) {
  return host === "shop.app" || host === "pay.shopify.com" ||
    /(?:^|\.)(?:google\.com|googleusercontent\.com|facebook\.com|apple\.com|appleid\.apple\.com|microsoftonline\.com|live\.com|auth0\.com|okta\.com|cloudflareaccess\.com)$/.test(
      host,
    )
}

export function classifySellerOsLunaBrowserRequestV1(input: Readonly<{
  url: string
  method: string
  topLevelNavigation: boolean
}>) : SellerOsLunaBrowserRequestDecisionV1 {
  if (input.url === "about:blank" && input.topLevelNavigation &&
      input.method.toUpperCase() === "GET") {
    return Object.freeze({ allowed: true,
      classification: "INTERNAL_BLANK_ALLOWED" as const,
      host: null, failureCode: null })
  }
  const parsed = safeUrl(input.url)
  if (!parsed || parsed.protocol !== "https:") {
    return Object.freeze({ allowed: false, classification: "URL_DENIED" as const,
      host: parsed?.hostname ?? null,
      failureCode: "LUNA_CEREMONY_URL_DENIED" })
  }
  const host = parsed.hostname.toLowerCase()
  const method = input.method.toUpperCase()
  if (!SAFE_HOST.test(host)) {
    return Object.freeze({ allowed: false, classification: "URL_DENIED" as const,
      host: null, failureCode: "LUNA_CEREMONY_URL_DENIED" })
  }
  if ([...parsed.searchParams.keys()].some((key) =>
    SENSITIVE_QUERY_KEY.test(key))) {
    return Object.freeze({ allowed: false,
      classification: "URL_DENIED" as const, host,
      failureCode: "LUNA_CEREMONY_CREDENTIAL_QUERY_DENIED" })
  }
  if (input.topLevelNavigation && ASSET_HOSTS.has(host)) {
    return Object.freeze({ allowed: false,
      classification: "TOP_LEVEL_ASSET_DENIED" as const, host,
      failureCode: "LUNA_CEREMONY_ASSET_TOP_LEVEL_DENIED" })
  }
  if (input.topLevelNavigation && SECURITY_CHALLENGE_HOSTS.has(host)) {
    return Object.freeze({ allowed: false,
      classification: "TOP_LEVEL_SECURITY_CHALLENGE_DENIED" as const, host,
      failureCode: "LUNA_CEREMONY_SECURITY_CHALLENGE_TOP_LEVEL_DENIED" })
  }
  if (NAVIGATION_HOSTS.has(host)) {
    return NAVIGATION_METHODS.has(method)
      ? Object.freeze({ allowed: true,
        classification: "NAVIGATION_ALLOWED" as const, host,
        failureCode: null })
      : Object.freeze({ allowed: false, classification: "METHOD_DENIED" as const,
        host, failureCode: "LUNA_CEREMONY_METHOD_DENIED" })
  }
  if (!input.topLevelNavigation && ASSET_HOSTS.has(host)) {
    return ASSET_METHODS.has(method)
      ? Object.freeze({ allowed: true, classification: "ASSET_ALLOWED" as const,
        host, failureCode: null })
      : Object.freeze({ allowed: false, classification: "METHOD_DENIED" as const,
        host, failureCode: "LUNA_CEREMONY_ASSET_METHOD_DENIED" })
  }
  if (!input.topLevelNavigation && SECURITY_CHALLENGE_HOSTS.has(host)) {
    return SECURITY_CHALLENGE_METHODS.has(method)
      ? Object.freeze({ allowed: true,
        classification: "SECURITY_CHALLENGE_ALLOWED" as const, host,
        failureCode: null })
      : Object.freeze({ allowed: false, classification: "METHOD_DENIED" as const,
        host, failureCode: "LUNA_CEREMONY_SECURITY_CHALLENGE_METHOD_DENIED" })
  }
  if (externalIdentityProvider(host)) {
    return Object.freeze({ allowed: false,
      classification: "EXTERNAL_IDP_DENIED" as const, host,
      failureCode: "LUNA_CEREMONY_EXTERNAL_IDP_DENIED" })
  }
  return Object.freeze({ allowed: false,
    classification: "ARBITRARY_HOST_DENIED" as const, host,
    failureCode: "LUNA_CEREMONY_ARBITRARY_HOST_DENIED" })
}

export function assertSellerOsLunaCeremonyCsrfV1(input: Readonly<{
  requestUrl: string
  origin: string | null
  secFetchSite: string | null
  contentType: string | null
}>) {
  const originBinding = getSellerOsAdminOriginBindingV1({
    requestUrl: input.requestUrl,
    origin: input.origin,
    secFetchSite: input.secFetchSite,
    requireOrigin: true,
  })
  if (!originBinding ||
      input.contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json") {
    throw new SellerOsLunaBrowserCeremonyError(
      "LUNA_CEREMONY_CSRF_REJECTED",
    )
  }
  return originBinding
}

type CsrfRecord = {
  token: string
  tokenDigest: string
  contextDigest: string
  actorUserId: string
  adminSessionDigest: string
  ceremonyInstanceId: string
  originBinding: string
  ceremonyStateBinding: string
  expiresAt: number
}

type CsrfContext = Readonly<{
  actorUserId: string
  adminSessionToken: string
  ceremonyInstanceId: string
  requestUrl: string
  origin: string | null
  secFetchSite: string | null
  stateToken: string | null
}>

function sha256Domain(domain: string, value: string) {
  return createHash("sha256").update(domain, "utf8").update("\u0000", "utf8")
    .update(value, "utf8").digest("hex")
}

function equalText(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8")
  const rightBytes = Buffer.from(right, "utf8")
  return leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
}

function csrfStateBinding(stateToken: string | null) {
  if (!stateToken) return "NOT_STARTED"
  if (!STATE_TOKEN.test(stateToken)) {
    throw new SellerOsLunaBrowserCeremonyError("LUNA_CEREMONY_WRONG_STATE")
  }
  return sha256Domain("seller-os-luna-ceremony-state-v1", stateToken)
}

function assertCsrfIdentity(input: CsrfContext) {
  if (!UUID.test(input.actorUserId) ||
      !CEREMONY_INSTANCE.test(input.ceremonyInstanceId) ||
      input.adminSessionToken.length < 32 ||
      input.adminSessionToken.length > 16_384) {
    throw new SellerOsLunaBrowserCeremonyError(
      "LUNA_CEREMONY_CSRF_REJECTED",
    )
  }
  const originBinding = getSellerOsAdminOriginBindingV1({
    requestUrl: input.requestUrl,
    origin: input.origin,
    secFetchSite: input.secFetchSite,
    requireOrigin: false,
  })
  if (!originBinding) {
    throw new SellerOsLunaBrowserCeremonyError(
      "LUNA_CEREMONY_CSRF_REJECTED",
    )
  }
  const adminSessionDigest = sha256Domain(
    "seller-os-luna-admin-session-v1",
    input.adminSessionToken,
  )
  const ceremonyStateBinding = csrfStateBinding(input.stateToken)
  const contextDigest = sha256Domain(
    "seller-os-luna-csrf-context-v1",
    [input.actorUserId, adminSessionDigest, input.ceremonyInstanceId,
      originBinding, ceremonyStateBinding].join("\u0000"),
  )
  return Object.freeze({
    adminSessionDigest,
    ceremonyStateBinding,
    contextDigest,
    originBinding,
  })
}

export function createSellerOsLunaCeremonyCsrfBoundaryV1(input: Readonly<{
  now?: () => number
  random?: (bytes: number) => Buffer
}> = {}) {
  const now = input.now ?? Date.now
  const random = input.random ?? randomBytes
  const records = new Map<string, CsrfRecord>()
  const activeContexts = new Map<string, string>()
  const consumed = new Map<string, number>()

  function discard(record: CsrfRecord) {
    records.delete(record.tokenDigest)
    if (activeContexts.get(record.contextDigest) === record.tokenDigest) {
      activeContexts.delete(record.contextDigest)
    }
  }

  function clean(at: number) {
    for (const record of records.values()) {
      if (record.expiresAt <= at) discard(record)
    }
    for (const [digest, expiresAt] of consumed) {
      if (expiresAt <= at) consumed.delete(digest)
    }
  }

  function issue(context: CsrfContext) {
    const at = now()
    clean(at)
    const identity = assertCsrfIdentity(context)
    const activeDigest = activeContexts.get(identity.contextDigest)
    const active = activeDigest ? records.get(activeDigest) : null
    if (active && active.expiresAt > at) {
      return Object.freeze({
        csrfToken: active.token,
        expiresAt: new Date(active.expiresAt).toISOString(),
        singleUse: true as const,
        adminSessionBound: true as const,
        ceremonyInstanceBound: true as const,
        originBound: true as const,
        ceremonyStateBound: true as const,
      })
    }

    const token = `c1.${random(32).toString("base64url")}`
    if (!CSRF_TOKEN.test(token)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_CSRF_ENTROPY_UNAVAILABLE",
      )
    }
    const tokenDigestValue = sha256Domain(
      "seller-os-luna-csrf-token-v1",
      token,
    )
    const record: CsrfRecord = {
      token,
      tokenDigest: tokenDigestValue,
      contextDigest: identity.contextDigest,
      actorUserId: context.actorUserId,
      adminSessionDigest: identity.adminSessionDigest,
      ceremonyInstanceId: context.ceremonyInstanceId,
      originBinding: identity.originBinding,
      ceremonyStateBinding: identity.ceremonyStateBinding,
      expiresAt: at + SELLER_OS_LUNA_CEREMONY_CSRF_TTL_MS,
    }
    records.set(tokenDigestValue, record)
    activeContexts.set(identity.contextDigest, tokenDigestValue)
    return Object.freeze({
      csrfToken: token,
      expiresAt: new Date(record.expiresAt).toISOString(),
      singleUse: true as const,
      adminSessionBound: true as const,
      ceremonyInstanceBound: true as const,
      originBound: true as const,
      ceremonyStateBound: true as const,
    })
  }

  function consume(context: CsrfContext & Readonly<{
    action: "START" | "OWNER_HANDOFF" | "COMPLETE" | "CANCEL"
    contentType: string | null
    csrfHeader: string | null
    csrfCookie: string | null
  }>) {
    const originBinding = assertSellerOsLunaCeremonyCsrfV1({
      requestUrl: context.requestUrl,
      origin: context.origin,
      secFetchSite: context.secFetchSite,
      contentType: context.contentType,
    })
    const startsWithoutCeremonyState = context.action === "START" ||
      context.action === "OWNER_HANDOFF"
    if ((startsWithoutCeremonyState && context.stateToken) ||
        (!startsWithoutCeremonyState && !context.stateToken)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_WRONG_STATE",
      )
    }
    const identity = assertCsrfIdentity(context)
    const header = context.csrfHeader ?? ""
    const cookie = context.csrfCookie ?? ""
    if (!CSRF_TOKEN.test(header) || !CSRF_TOKEN.test(cookie) ||
        !equalText(header, cookie)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_CSRF_REJECTED",
      )
    }
    const digest = sha256Domain("seller-os-luna-csrf-token-v1", header)
    const at = now()
    for (const [consumedDigest, expiresAt] of consumed) {
      if (expiresAt <= at) consumed.delete(consumedDigest)
    }
    if (consumed.has(digest)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_CSRF_REUSED",
      )
    }
    const record = records.get(digest)
    if (!record) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_CSRF_REJECTED",
      )
    }
    if (record.expiresAt <= at) {
      discard(record)
      consumed.set(digest, at + SELLER_OS_LUNA_CEREMONY_CSRF_TTL_MS)
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_CSRF_EXPIRED",
      )
    }
    if (!equalText(record.contextDigest, identity.contextDigest) ||
        !equalText(record.adminSessionDigest, identity.adminSessionDigest) ||
        !equalText(record.ceremonyInstanceId, context.ceremonyInstanceId) ||
        !equalText(record.originBinding, originBinding) ||
        !equalText(record.ceremonyStateBinding,
          identity.ceremonyStateBinding) ||
        !equalText(record.actorUserId, context.actorUserId)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_CSRF_REJECTED",
      )
    }
    discard(record)
    consumed.set(digest, at + SELLER_OS_LUNA_CEREMONY_CSRF_TTL_MS)
    return true
  }

  function reset() {
    records.clear()
    activeContexts.clear()
    consumed.clear()
  }

  return Object.freeze({ issue, consume, reset })
}

type GlobalWithLunaCeremonyCsrf = typeof globalThis & {
  __sellerOsLunaCeremonyCsrfV1?: ReturnType<
    typeof createSellerOsLunaCeremonyCsrfBoundaryV1
  >
}

export function getSellerOsLunaCeremonyCsrfBoundaryV1() {
  const shared = globalThis as GlobalWithLunaCeremonyCsrf
  if (!shared.__sellerOsLunaCeremonyCsrfV1) {
    shared.__sellerOsLunaCeremonyCsrfV1 =
      createSellerOsLunaCeremonyCsrfBoundaryV1()
  }
  return shared.__sellerOsLunaCeremonyCsrfV1
}

function tokenDigest(token: string) {
  return createHash("sha256").update(
    `${SELLER_OS_LUNA_BROWSER_CEREMONY_VERSION}:${token}`,
    "utf8",
  ).digest("hex")
}

function safeFailure(cause: unknown, fallback: string) {
  if (cause instanceof SellerOsLunaBrowserCeremonyError) return cause.code
  const message = cause instanceof Error ? cause.message : ""
  return SAFE_ERROR.test(message) ? message : fallback
}

function safeCeremony(record: CeremonyRecord) {
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_BROWSER_CEREMONY_VERSION,
    phase: record.phase,
    startedAt: record.startedAt,
    expiresAt: record.expiresAt,
    browserVisibleToHuman: true as const,
    browserBackendControlled: true as const,
    profile: "EPHEMERAL" as const,
    profileReuse: false as const,
    remoteDebuggingPublic: false as const,
    blockedHost: record.blockedHost,
    failureCode: record.failureCode,
    storedAt: record.storedAt,
    sessionDigest: record.sessionDigest,
    postLoginHost: record.postLoginHost,
    postLoginPathClass: record.postLoginPathClass,
    authenticatedStateProven: record.authenticatedStateProven,
    stateReturned: false as const,
    credentialsIncluded: false as const,
    cookiesIncluded: false as const,
    rawHtmlIncluded: false as const,
    screenshotsIncluded: false as const,
  })
}

export function createSellerOsLunaBrowserCeremonyCoordinatorV1(input: Readonly<{
  instanceId?: string
  now?: () => number
  random?: (bytes: number) => Buffer
  launchBrowser: (input: Readonly<{
    onPolicyViolation: (host: string | null, code: string) => void
  }>) => Promise<SellerOsLunaBrowserHandleV1>
  persistSession: (input: Readonly<{
    actorUserId: string
    sessionPayload: Buffer
    now: string
  }>) => Promise<Readonly<{ storedAt: string; sessionDigest: string }>>
  verifyStoredSession: () => Promise<Readonly<{
    authenticated: boolean
    postLoginHost: string | null
    postLoginPathClass: string | null
  }>>
}>) {
  const random = input.random ?? randomBytes
  const now = input.now ?? Date.now
  const instanceId = input.instanceId ?? random(16).toString("base64url")
  if (!/^[A-Za-z0-9_-]{22}$/.test(instanceId)) {
    throw new SellerOsLunaBrowserCeremonyError(
      "LUNA_CEREMONY_INSTANCE_ID_INVALID",
    )
  }
  const records = new Map<string, CeremonyRecord>()
  const consumed = new Map<string, number>()
  const activeActor = new Map<string, string>()

  async function closeRecord(record: CeremonyRecord, reason: string) {
    if (record.cleanupTimer) clearTimeout(record.cleanupTimer)
    record.cleanupTimer = null
    const browser = record.browser
    record.browser = null
    if (browser) {
      try { await browser.close(reason) } catch { /* fail closed */ }
    }
  }

  function consume(record: CeremonyRecord, digest: string, at: number) {
    consumed.set(digest, at + SELLER_OS_LUNA_CEREMONY_TTL_MS)
    activeActor.delete(record.actorUserId)
    records.delete(digest)
  }

  function cleanConsumed(at: number) {
    for (const [digest, expiresAt] of consumed) {
      if (expiresAt <= at) consumed.delete(digest)
    }
  }

  async function resolveRecord(stateToken: string, actorUserId: string) {
    const at = now()
    cleanConsumed(at)
    const match = STATE_TOKEN.exec(stateToken)
    if (!match) {
      throw new SellerOsLunaBrowserCeremonyError("LUNA_CEREMONY_WRONG_STATE")
    }
    const encodedInstance = match[1] ?? ""
    const left = Buffer.from(encodedInstance)
    const right = Buffer.from(instanceId)
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_BACKEND_RESTART",
      )
    }
    const digest = tokenDigest(stateToken)
    const record = records.get(digest)
    if (!record) {
      throw new SellerOsLunaBrowserCeremonyError(
        consumed.has(digest)
          ? "LUNA_CEREMONY_REUSED_STATE" : "LUNA_CEREMONY_WRONG_STATE",
      )
    }
    if (record.actorUserId !== actorUserId) {
      throw new SellerOsLunaBrowserCeremonyError("LUNA_CEREMONY_WRONG_STATE")
    }
    if (Date.parse(record.expiresAt) <= at) {
      record.phase = "FAILED"
      record.failureCode = "LUNA_CEREMONY_EXPIRED_STATE"
      consume(record, digest, at)
      await closeRecord(record, record.failureCode)
      throw new SellerOsLunaBrowserCeremonyError(record.failureCode)
    }
    return { record, digest, at }
  }

  async function start(actorUserId: string) {
    if (!UUID.test(actorUserId)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_ADMIN_ACTOR_REQUIRED",
      )
    }
    const at = now()
    cleanConsumed(at)
    const activeDigest = activeActor.get(actorUserId)
    const existing = activeDigest ? records.get(activeDigest) : null
    if (existing && ["LAUNCHING", "AWAITING_HUMAN_LOGIN", "COMPLETING"]
      .includes(existing.phase)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_ALREADY_ACTIVE",
      )
    }
    const stateToken = `1.${instanceId}.${random(32).toString("base64url")}`
    if (!STATE_TOKEN.test(stateToken)) {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_STATE_ENTROPY_UNAVAILABLE",
      )
    }
    const digest = tokenDigest(stateToken)
    const record: CeremonyRecord = {
      actorUserId,
      tokenDigest: digest,
      startedAt: new Date(at).toISOString(),
      expiresAt: new Date(at + SELLER_OS_LUNA_CEREMONY_TTL_MS).toISOString(),
      phase: "LAUNCHING",
      browser: null,
      blockedHost: null,
      failureCode: null,
      storedAt: null,
      sessionDigest: null,
      postLoginHost: null,
      postLoginPathClass: null,
      authenticatedStateProven: false,
      cleanupTimer: null,
    }
    records.set(digest, record)
    activeActor.set(actorUserId, digest)
    try {
      record.browser = await input.launchBrowser({
        onPolicyViolation: (host, code) => {
          if (!record.blockedHost && host && SAFE_HOST.test(host)) {
            record.blockedHost = host
          }
          record.failureCode = SAFE_ERROR.test(code)
            ? code : "LUNA_CEREMONY_NAVIGATION_DENIED"
        },
      })
      record.phase = "AWAITING_HUMAN_LOGIN"
      record.cleanupTimer = setTimeout(() => {
        record.phase = "FAILED"
        record.failureCode = "LUNA_CEREMONY_EXPIRED_STATE"
        consume(record, digest, now())
        void closeRecord(record, record.failureCode)
      }, SELLER_OS_LUNA_CEREMONY_TTL_MS)
      record.cleanupTimer.unref?.()
      return Object.freeze({ stateToken, ceremony: safeCeremony(record) })
    } catch (cause) {
      record.phase = "FAILED"
      record.failureCode = safeFailure(
        cause,
        "LUNA_CEREMONY_BROWSER_LAUNCH_FAILED",
      )
      consume(record, digest, at)
      await closeRecord(record, record.failureCode)
      throw new SellerOsLunaBrowserCeremonyError(record.failureCode)
    }
  }

  async function status(stateToken: string, actorUserId: string) {
    const { record } = await resolveRecord(stateToken, actorUserId)
    return safeCeremony(record)
  }

  async function complete(stateToken: string, actorUserId: string) {
    const { record, digest, at } = await resolveRecord(stateToken, actorUserId)
    if (record.phase === "COMPLETING") {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_CONCURRENT_COMPLETION",
      )
    }
    if (record.phase !== "AWAITING_HUMAN_LOGIN") {
      throw new SellerOsLunaBrowserCeremonyError(
        "LUNA_CEREMONY_REUSED_STATE",
      )
    }
    record.phase = "COMPLETING"
    let payload: Buffer | null = null
    try {
      if (record.failureCode) {
        throw new SellerOsLunaBrowserCeremonyError(record.failureCode)
      }
      if (!record.browser) {
        throw new SellerOsLunaBrowserCeremonyError(
          "LUNA_CEREMONY_BROWSER_RESTART",
        )
      }
      const capture = await record.browser.captureVerifiedSession()
      payload = capture.sessionPayload
      if (!Buffer.isBuffer(payload) || payload.length < 80 ||
          payload.length > 12_000 || !capture.authenticatedStateProven ||
          !NAVIGATION_HOSTS.has(capture.postLoginHost) ||
          !Number.isFinite(Date.parse(capture.expiresAt))) {
        throw new SellerOsLunaBrowserCeremonyError(
          "LUNA_CEREMONY_SESSION_CAPTURE_INVALID",
        )
      }
      const stored = await input.persistSession({
        actorUserId,
        sessionPayload: payload,
        now: new Date(at).toISOString(),
      })
      const verified = await input.verifyStoredSession()
      if (!verified.authenticated || !verified.postLoginHost ||
          !NAVIGATION_HOSTS.has(verified.postLoginHost) ||
          !verified.postLoginPathClass) {
        throw new SellerOsLunaBrowserCeremonyError(
          "LUNA_CEREMONY_POST_STORE_VERIFICATION_FAILED",
        )
      }
      record.phase = "COMPLETED"
      record.storedAt = stored.storedAt
      record.sessionDigest = stored.sessionDigest
      record.postLoginHost = verified.postLoginHost
      record.postLoginPathClass = verified.postLoginPathClass
      record.authenticatedStateProven = true
      consume(record, digest, at)
      return safeCeremony(record)
    } catch (cause) {
      record.phase = "FAILED"
      record.failureCode = safeFailure(
        cause,
        "LUNA_CEREMONY_COMPLETION_FAILED",
      )
      consume(record, digest, at)
      throw new SellerOsLunaBrowserCeremonyError(record.failureCode)
    } finally {
      payload?.fill(0)
      await closeRecord(record, record.failureCode ?? "COMPLETED")
    }
  }

  async function cancel(stateToken: string, actorUserId: string) {
    const { record, digest, at } = await resolveRecord(stateToken, actorUserId)
    if (["COMPLETING", "COMPLETED", "FAILED", "CANCELLED"]
      .includes(record.phase)) {
      throw new SellerOsLunaBrowserCeremonyError(
        record.phase === "COMPLETING"
          ? "LUNA_CEREMONY_CONCURRENT_COMPLETION"
          : "LUNA_CEREMONY_REUSED_STATE",
      )
    }
    record.phase = "CANCELLED"
    record.failureCode = "LUNA_CEREMONY_CANCELLED"
    consume(record, digest, at)
    await closeRecord(record, record.failureCode)
    return safeCeremony(record)
  }

  async function shutdown() {
    await Promise.all([...records.values()].map((record) =>
      closeRecord(record, "LUNA_CEREMONY_BACKEND_SHUTDOWN")))
    records.clear()
    activeActor.clear()
    consumed.clear()
  }

  return Object.freeze({ instanceId, start, status, complete, cancel, shutdown })
}
