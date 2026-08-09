import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import {
  getEbaySellerAccountScopeConfiguration,
} from "./ebay-seller-account-scope"

export const EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION =
  "EBAY_SELLER_OAUTH_REAUTH_V1" as const
export const EBAY_SELLER_OAUTH_REAUTH_BRANCH =
  "feature/seller-os-canonical-integration-foundation-v1" as const
export const EBAY_SELLER_OAUTH_REAUTH_PAGE_PATH =
  "/admin/ebay/monitor/seller-oauth-reauth" as const
export const EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH =
  "/api/admin/ebay/monitor/seller-oauth-reauth" as const
export const EBAY_SELLER_OAUTH_REAUTH_COOKIE =
  "__Secure-ebay_seller_oauth_reauth" as const
export const EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS = 5 * 60 * 1_000
export const EBAY_SELLER_OAUTH_REAUTH_PLATFORM_LIMIT_MS = 30_000
export const EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS = 24_000
export const EBAY_SELLER_OAUTH_REAUTH_TERMINAL_RESERVE_MS = 3_000
export const EBAY_SELLER_OAUTH_REAUTH_EXTERNAL_DEADLINE_MS =
  EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS -
  EBAY_SELLER_OAUTH_REAUTH_TERMINAL_RESERVE_MS
export const EBAY_SELLER_OAUTH_REAUTH_MAX_EXTERNAL_READ_CALLS = 6
export const EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT_MS = 1_500

export const EBAY_SELLER_OAUTH_REAUTH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
] as const

export const EBAY_SELLER_OAUTH_REAUTH_AUTHORIZATION_ENDPOINT =
  "https://auth.ebay.com/oauth2/authorize" as const
export const EBAY_SELLER_OAUTH_REAUTH_PREFLIGHT_PHASES = [
  "BASE",
  "BASE_ACCOUNT",
  "BASE_ACCOUNT_INVENTORY",
  "FULL_FOUR_SCOPES",
] as const
export type EbaySellerOAuthReauthPreflightPhase =
  typeof EBAY_SELLER_OAUTH_REAUTH_PREFLIGHT_PHASES[number]
export type EbaySellerOAuthReauthScopeEncoding =
  | "RFC3986_PERCENT20"
  | "FORM_URLENCODED_PLUS"

const EXPECTED_PRODUCTION_APP_ID_UTF8_LENGTH = 40
const EXPECTED_PRODUCTION_APP_ID_SHA256 =
  "0b4ce6cd893c14bded86394680568cf3cbb632d897176467ffe3ba91b2670869"
const EXPECTED_PRODUCTION_RUNAME_UTF8_LENGTH = 37
const EXPECTED_PRODUCTION_RUNAME_SHA256 =
  "a7a5c2d3b7c4449643153f5bc942406f1e9fb2982e45ff226f3818f492f40459"

export type EbaySellerOAuthReauthCredentialFingerprintExpectation = {
  utf8Length: number
  sha256: string
}

export type EbaySellerOAuthReauthRuntimeCredentialMatch = {
  RUNTIME_EBAY_CLIENT_ID_PRESENT: boolean
  RUNTIME_EBAY_CLIENT_ID_LENGTH_MATCH: boolean
  RUNTIME_EBAY_CLIENT_ID_SHA256_MATCH: boolean
  RUNTIME_EBAY_RUNAME_PRESENT: boolean
  RUNTIME_EBAY_RUNAME_LENGTH_MATCH: boolean
  RUNTIME_EBAY_RUNAME_SHA256_MATCH: boolean
  APP_ID_PORTAL_RUNTIME_MATCH: boolean
  RUNAME_PORTAL_RUNTIME_MATCH: boolean
  FINAL_BINDING_DIAGNOSIS:
    | "BOTH_MATCH"
    | "APP_ID_MATCH_RUNAME_MISMATCH"
    | "APP_ID_MISMATCH_RUNAME_MATCH"
    | "BOTH_MISMATCH"
    | "RUNTIME_CONFIGURATION_MISSING"
}

const STATE_COOKIE_VERSION = 1
const STATE_COOKIE_SALT = "IMNOVA_EBAY_SELLER_REAUTH_STATE_SALT_V1"
const STATE_COOKIE_INFO = "IMNOVA_EBAY_SELLER_REAUTH_STATE_HMAC_V1"
const SAFE_CODE = /^[A-Z0-9_]{3,120}$/
const VALID_HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/
const VALID_ADMIN_USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CookiePayload = {
  v: 1
  state: string
  expiresAt: number
  branch: typeof EBAY_SELLER_OAUTH_REAUTH_BRANCH
  host: string
  actorHash: string
}

export type EbaySellerOAuthReauthConfiguration = {
  ready: boolean
  reason: string | null
  clientId: string
  clientSecret: string
  runame: string
  branchHost: string
  callbackUrl: string
  expectedUserId: string
  expectedAccountFingerprint: string
}

export class EbaySellerOAuthReauthError extends Error {
  readonly code: string

  constructor(code: string) {
    const safe = SAFE_CODE.test(code)
      ? code
      : "EBAY_SELLER_OAUTH_REAUTH_FAILED"
    super(safe)
    this.name = "EbaySellerOAuthReauthError"
    this.code = safe
  }
}

function boundedCredential(value: unknown, maximum: number) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized && normalized.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : ""
}

function normalizedHost(value: unknown) {
  const candidate = typeof value === "string"
    ? value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : ""
  return VALID_HOST.test(candidate) ? candidate : ""
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function cookieKey(clientSecret: string) {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(clientSecret, "utf8"),
    Buffer.from(STATE_COOKIE_SALT, "utf8"),
    Buffer.from(STATE_COOKIE_INFO, "utf8"),
    32,
  ))
}

function cookieSignature(
  encodedPayload: string,
  clientSecret: string,
  expectedAccountFingerprint: string,
) {
  return createHmac("sha256", cookieKey(clientSecret))
    .update(`${encodedPayload}.${expectedAccountFingerprint}`, "utf8")
    .digest("base64url")
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8")
  const rightBuffer = Buffer.from(right, "utf8")
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
}

export function compareEbaySellerOAuthReauthCredentialFingerprint(
  value: string,
  expectation: EbaySellerOAuthReauthCredentialFingerprintExpectation,
) {
  if (!Number.isSafeInteger(expectation.utf8Length) ||
      expectation.utf8Length < 1 || expectation.utf8Length > 512 ||
      !/^[a-f0-9]{64}$/.test(expectation.sha256)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_FINGERPRINT_CONTRACT_INVALID",
    )
  }
  const present = Boolean(value)
  const lengthMatch = present &&
    Buffer.byteLength(value, "utf8") === expectation.utf8Length
  let actualSha256 = present ? sha256(value) : ""
  const sha256Match = present &&
    constantTimeEqual(actualSha256, expectation.sha256)
  actualSha256 = ""
  return { present, lengthMatch, sha256Match }
}

export function compareEbaySellerOAuthReauthRuntimeCredentials(
  configuration: Pick<EbaySellerOAuthReauthConfiguration, "clientId" | "runame">,
  expectations: {
    clientId: EbaySellerOAuthReauthCredentialFingerprintExpectation
    runame: EbaySellerOAuthReauthCredentialFingerprintExpectation
  },
): EbaySellerOAuthReauthRuntimeCredentialMatch {
  const clientId = compareEbaySellerOAuthReauthCredentialFingerprint(
    configuration.clientId,
    expectations.clientId,
  )
  const runame = compareEbaySellerOAuthReauthCredentialFingerprint(
    configuration.runame,
    expectations.runame,
  )
  const appMatches = clientId.lengthMatch && clientId.sha256Match
  const runameMatches = runame.lengthMatch && runame.sha256Match
  const finalBindingDiagnosis = !clientId.present || !runame.present
    ? "RUNTIME_CONFIGURATION_MISSING" as const
    : appMatches && runameMatches
      ? "BOTH_MATCH" as const
      : appMatches
        ? "APP_ID_MATCH_RUNAME_MISMATCH" as const
        : runameMatches
          ? "APP_ID_MISMATCH_RUNAME_MATCH" as const
          : "BOTH_MISMATCH" as const
  return {
    RUNTIME_EBAY_CLIENT_ID_PRESENT: clientId.present,
    RUNTIME_EBAY_CLIENT_ID_LENGTH_MATCH: clientId.lengthMatch,
    RUNTIME_EBAY_CLIENT_ID_SHA256_MATCH: clientId.sha256Match,
    RUNTIME_EBAY_RUNAME_PRESENT: runame.present,
    RUNTIME_EBAY_RUNAME_LENGTH_MATCH: runame.lengthMatch,
    RUNTIME_EBAY_RUNAME_SHA256_MATCH: runame.sha256Match,
    APP_ID_PORTAL_RUNTIME_MATCH: appMatches,
    RUNAME_PORTAL_RUNTIME_MATCH: runameMatches,
    FINAL_BINDING_DIAGNOSIS: finalBindingDiagnosis,
  }
}

export function getEbaySellerOAuthReauthRuntimeCredentialMatch(
  configuration: Pick<EbaySellerOAuthReauthConfiguration, "clientId" | "runame">,
) {
  return compareEbaySellerOAuthReauthRuntimeCredentials(configuration, {
    clientId: {
      utf8Length: EXPECTED_PRODUCTION_APP_ID_UTF8_LENGTH,
      sha256: EXPECTED_PRODUCTION_APP_ID_SHA256,
    },
    runame: {
      utf8Length: EXPECTED_PRODUCTION_RUNAME_UTF8_LENGTH,
      sha256: EXPECTED_PRODUCTION_RUNAME_SHA256,
    },
  })
}

export function isEbaySellerOAuthReauthRuntimeCredentialMatchCertified(
  match: EbaySellerOAuthReauthRuntimeCredentialMatch,
) {
  return match.RUNTIME_EBAY_CLIENT_ID_PRESENT === true &&
    match.RUNTIME_EBAY_CLIENT_ID_LENGTH_MATCH === true &&
    match.RUNTIME_EBAY_CLIENT_ID_SHA256_MATCH === true &&
    match.RUNTIME_EBAY_RUNAME_PRESENT === true &&
    match.RUNTIME_EBAY_RUNAME_LENGTH_MATCH === true &&
    match.RUNTIME_EBAY_RUNAME_SHA256_MATCH === true &&
    match.APP_ID_PORTAL_RUNTIME_MATCH === true &&
    match.RUNAME_PORTAL_RUNTIME_MATCH === true &&
    match.FINAL_BINDING_DIAGNOSIS === "BOTH_MATCH"
}

export function assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(
  match: EbaySellerOAuthReauthRuntimeCredentialMatch,
) {
  if (!isEbaySellerOAuthReauthRuntimeCredentialMatchCertified(match)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_RUNTIME_CREDENTIAL_MISMATCH",
    )
  }
}

function exactScopeSet(scopes: string[]) {
  const normalized = [...new Set(scopes.map((scope) => scope.trim())
    .filter(Boolean))].sort()
  const expected = [...EBAY_SELLER_OAUTH_REAUTH_SCOPES].sort()
  return normalized.length === expected.length &&
    normalized.every((scope, index) => scope === expected[index])
}

export function safeEbaySellerOAuthReauthError(cause: unknown) {
  if (cause instanceof EbaySellerOAuthReauthError) return cause.code
  return "EBAY_SELLER_OAUTH_REAUTH_FAILED"
}

export function createEbaySellerOAuthReauthState() {
  return randomBytes(32).toString("base64url")
}

export function isValidEbaySellerOAuthReauthState(state: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(state)
}

export function hashEbaySellerOAuthReauthState(state: string) {
  if (!isValidEbaySellerOAuthReauthState(state)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_INVALID",
    )
  }
  return sha256(state)
}

export function getEbaySellerOAuthReauthConfiguration(input: {
  environment?: NodeJS.ProcessEnv
  requestHost?: string | null
} = {}): EbaySellerOAuthReauthConfiguration {
  const environment = input.environment ?? process.env
  const clientId = boundedCredential(environment.EBAY_CLIENT_ID, 512)
  const clientSecret = boundedCredential(environment.EBAY_CLIENT_SECRET, 2_048)
  const runame = boundedCredential(environment.EBAY_RuName, 512)
  const branchHost = normalizedHost(environment.VERCEL_BRANCH_URL)
  const requestHost = normalizedHost(input.requestHost)
  const scope = getEbaySellerAccountScopeConfiguration(environment)
  const preview = environment.VERCEL_ENV?.trim().toLowerCase() === "preview"
  const branchMatch = environment.VERCEL_GIT_COMMIT_REF?.trim() ===
    EBAY_SELLER_OAUTH_REAUTH_BRANCH
  const hostMatch = Boolean(branchHost && requestHost && branchHost === requestHost)
  const reason = !preview
    ? "EBAY_SELLER_OAUTH_REAUTH_PREVIEW_REQUIRED"
    : !branchMatch
      ? "EBAY_SELLER_OAUTH_REAUTH_BRANCH_DENIED"
      : !hostMatch
        ? "EBAY_SELLER_OAUTH_REAUTH_HOST_DENIED"
        : !clientId || !clientSecret
          ? "EBAY_SELLER_OAUTH_REAUTH_APP_CONFIGURATION_MISSING"
          : !runame
            ? "EBAY_SELLER_OAUTH_REAUTH_RUNAME_MISSING"
            : !scope.configured || !scope.identity.expectedAccountFingerprint
              ? "EBAY_SELLER_OAUTH_REAUTH_ACCOUNT_BINDING_MISSING"
              : null
  return {
    ready: reason === null,
    reason,
    clientId,
    clientSecret,
    runame,
    branchHost,
    callbackUrl: branchHost
      ? `https://${branchHost}${EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH}`
      : "",
    expectedUserId: scope.identity.expectedUserId,
    expectedAccountFingerprint:
      scope.identity.expectedAccountFingerprint,
  }
}

export function assertEbaySellerOAuthReauthAdmin(validation: {
  ok: boolean
  userId?: string | null
  authenticationMode?: string | null
  status?: number
  error?: string | null
}) {
  if (!validation.ok || validation.authenticationMode !== "admin_user" ||
      !validation.userId || !VALID_ADMIN_USER_ID.test(validation.userId)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_ADMIN_USER_REQUIRED",
    )
  }
  return validation.userId
}

export function assertEbaySellerOAuthReauthSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  const expected = new URL(request.url).origin
  if (fetchSite !== "same-origin" || origin !== expected) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_SAME_ORIGIN_REQUIRED",
    )
  }
}

export function buildEbaySellerOAuthReauthAuthorizationUrl(input: {
  clientId: string
  runame: string
  state: string
}) {
  return buildEbaySellerOAuthReauthDiagnosticAuthorizationUrl({
    ...input,
    phase: "FULL_FOUR_SCOPES",
    encoding: "RFC3986_PERCENT20",
  })
}

function scopesForPreflightPhase(phase: EbaySellerOAuthReauthPreflightPhase) {
  const count = phase === "BASE"
    ? 1
    : phase === "BASE_ACCOUNT"
      ? 2
      : phase === "BASE_ACCOUNT_INVENTORY"
        ? 3
        : phase === "FULL_FOUR_SCOPES"
          ? 4
          : 0
  if (!count) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_PREFLIGHT_PHASE_INVALID",
    )
  }
  return EBAY_SELLER_OAUTH_REAUTH_SCOPES.slice(0, count)
}

export function buildEbaySellerOAuthReauthDiagnosticAuthorizationUrl(input: {
  clientId: string
  runame: string
  phase: EbaySellerOAuthReauthPreflightPhase
  state?: string
  encoding?: EbaySellerOAuthReauthScopeEncoding
}) {
  if (!boundedCredential(input.clientId, 512) ||
      !boundedCredential(input.runame, 512) ||
      (input.state !== undefined &&
        !isValidEbaySellerOAuthReauthState(input.state))) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_START_INVALID",
    )
  }
  const scopes = scopesForPreflightPhase(input.phase)
  const parameters = [
    ["client_id", input.clientId],
    ["response_type", "code"],
    ["redirect_uri", input.runame],
    ["scope", scopes.join(" ")],
    ...(input.state === undefined ? [] : [["state", input.state]]),
  ]
  const encoding = input.encoding ?? "RFC3986_PERCENT20"
  const query = encoding === "RFC3986_PERCENT20"
    ? parameters.map(([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    ).join("&")
    : new URLSearchParams(parameters).toString()
  const serialized =
    `${EBAY_SELLER_OAUTH_REAUTH_AUTHORIZATION_ENDPOINT}?${query}`
  const url = new URL(serialized)
  if (!exactScopeSet(
    url.searchParams.get("scope")?.split(/\s+/).filter(Boolean) ?? [],
  ) && input.phase === "FULL_FOUR_SCOPES") {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_SCOPE_CONTRACT_INVALID",
    )
  }
  const expectedKeys = input.state === undefined
    ? "client_id,redirect_uri,response_type,scope"
    : "client_id,redirect_uri,response_type,scope,state"
  if ([...url.searchParams.keys()].sort().join(",") !== expectedKeys ||
      url.origin !== "https://auth.ebay.com" ||
      url.pathname !== "/oauth2/authorize" ||
      url.hash ||
      url.username ||
      url.password ||
      (encoding === "RFC3986_PERCENT20" &&
        (serialized.includes("+") || serialized.includes("%252F")))) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_AUTHORIZATION_SERIALIZATION_INVALID",
    )
  }
  return serialized
}

export function createEbaySellerOAuthReauthCookie(input: {
  state: string
  expiresAt: number
  actorUserId: string
  branchHost: string
  clientSecret: string
  expectedAccountFingerprint: string
}) {
  if (!isValidEbaySellerOAuthReauthState(input.state) ||
      !Number.isSafeInteger(input.expiresAt) ||
      !VALID_ADMIN_USER_ID.test(input.actorUserId) ||
      !VALID_HOST.test(input.branchHost) ||
      !/^[0-9a-f]{64}$/.test(input.expectedAccountFingerprint) ||
      !boundedCredential(input.clientSecret, 2_048)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_COOKIE_INVALID",
    )
  }
  const payload: CookiePayload = {
    v: STATE_COOKIE_VERSION,
    state: input.state,
    expiresAt: input.expiresAt,
    branch: EBAY_SELLER_OAUTH_REAUTH_BRANCH,
    host: input.branchHost,
    actorHash: sha256(`ADMIN:${input.actorUserId}`),
  }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const signature = cookieSignature(
    encoded,
    input.clientSecret,
    input.expectedAccountFingerprint,
  )
  const cookie = `${STATE_COOKIE_VERSION}.${encoded}.${signature}`
  if (cookie.length > 2_048) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_COOKIE_INVALID",
    )
  }
  return cookie
}

export function verifyEbaySellerOAuthReauthCookie(input: {
  cookie: string
  state: string
  now: number
  branchHost: string
  clientSecret: string
  expectedAccountFingerprint: string
}) {
  if (!input.cookie || input.cookie.length > 2_048 ||
      !isValidEbaySellerOAuthReauthState(input.state)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_COOKIE_INVALID",
    )
  }
  const parts = input.cookie.split(".")
  if (parts.length !== 3 || parts[0] !== String(STATE_COOKIE_VERSION)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_COOKIE_INVALID",
    )
  }
  const [version, encoded, signature] = parts
  if (!version || !encoded || !signature) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_COOKIE_INVALID",
    )
  }
  const expectedSignature = cookieSignature(
    encoded,
    input.clientSecret,
    input.expectedAccountFingerprint,
  )
  if (!constantTimeEqual(signature, expectedSignature)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_MISMATCH",
    )
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    )
  } catch {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_COOKIE_INVALID",
    )
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_COOKIE_INVALID",
    )
  }
  const payload = decoded as CookiePayload
  const exactKeys = Object.keys(payload).sort().join(",") ===
    "actorHash,branch,expiresAt,host,state,v"
  if (!exactKeys || payload.v !== STATE_COOKIE_VERSION ||
      payload.branch !== EBAY_SELLER_OAUTH_REAUTH_BRANCH ||
      payload.host !== input.branchHost ||
      !/^[0-9a-f]{64}$/.test(payload.actorHash) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= input.now ||
      payload.expiresAt > input.now + EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS ||
      !constantTimeEqual(payload.state, input.state)) {
    throw new EbaySellerOAuthReauthError(
      payload.expiresAt <= input.now
        ? "EBAY_SELLER_OAUTH_REAUTH_STATE_EXPIRED"
        : "EBAY_SELLER_OAUTH_REAUTH_STATE_MISMATCH",
    )
  }
  return {
    state: payload.state,
    expiresAt: payload.expiresAt,
    stateHash: hashEbaySellerOAuthReauthState(payload.state),
  }
}

export type EbaySellerOAuthCallbackInput =
  | { kind: "CODE"; state: string; code: string }
  | { kind: "DENIED"; state: string }

export function parseEbaySellerOAuthReauthCallbackUrl(
  requestUrl: string,
): EbaySellerOAuthCallbackInput {
  if (!requestUrl || requestUrl.length > 4_096) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_CALLBACK_INVALID",
    )
  }
  const url = new URL(requestUrl)
  const allowed = new Set(["state", "code", "error", "error_description"])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_CALLBACK_INVALID",
    )
  }
  for (const key of allowed) {
    if (url.searchParams.getAll(key).length > 1) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_CALLBACK_INVALID",
      )
    }
  }
  const state = url.searchParams.get("state") ?? ""
  const hasCode = url.searchParams.has("code")
  const hasProviderError = url.searchParams.has("error")
  const code = url.searchParams.get("code")
  const providerError = url.searchParams.get("error")
  const providerErrorDescription = url.searchParams.get("error_description")
  if (!isValidEbaySellerOAuthReauthState(state) ||
      hasCode === hasProviderError ||
      (providerErrorDescription !== null && !providerError)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_CALLBACK_INVALID",
    )
  }
  if (hasProviderError) {
    if (!providerError || providerError.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(providerError)) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_CALLBACK_INVALID",
      )
    }
    return { kind: "DENIED", state }
  }
  if (!code || code.length > 1_024 || /[\u0000-\u001f\u007f]/.test(code)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_CODE_INVALID",
    )
  }
  return { kind: "CODE", state, code }
}

export function exactEbaySellerOAuthReauthReturnedScopes(value: unknown) {
  if (value === undefined) return null
  if (typeof value !== "string" || !value.trim()) return false
  return exactScopeSet(value.split(/\s+/).filter(Boolean))
}

export function ebaySellerOAuthReauthCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
    maxAge: maxAgeSeconds,
    priority: "high" as const,
  }
}

export const EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function renderEbaySellerOAuthReauthSuccessHtml(refreshToken: string) {
  if (!boundedCredential(refreshToken, 8_192)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_TOKEN_RESPONSE_INVALID",
    )
  }
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>eBay seller OAuth handoff</title></head><body>" +
    "<main><h1>Verified one-time seller refresh token handoff</h1>" +
    "<p>This OAuth state is already CLAIMED. Reload, Back, or replay cannot produce another handoff.</p>" +
    "<p><strong>Paste this value directly into the Vercel Sensitive Environment Variable UI. " +
    "Do not copy it into chat, terminal, markdown, source, .env, issue, PR, or logs.</strong></p>" +
    `<textarea readonly autocomplete=\"off\" spellcheck=\"false\" rows=\"8\" cols=\"100\">${escapeHtml(refreshToken)}</textarea>` +
    "<p>If this response is lost, start a completely new OAuth ceremony. There is no recovery or replay.</p>" +
    "</main></body></html>"
}

export function renderEbaySellerOAuthReauthFailureHtml(code: string) {
  const safe = SAFE_CODE.test(code)
    ? code
    : "EBAY_SELLER_OAUTH_REAUTH_FAILED"
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>eBay seller OAuth denied</title></head><body>" +
    `<main><h1>OAuth handoff denied</h1><p>${safe}</p>` +
    "<p>No token was persisted or returned. Start a new ceremony if appropriate.</p>" +
    "</main></body></html>"
}
