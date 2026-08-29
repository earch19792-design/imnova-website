import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

const TEST_RUNTIME_CLIENT_ID = "test-production-app-id-12345678901234567"
const TEST_RUNTIME_RUNAME = "test-production-runame-12345678901234"
const TEST_RUNTIME_CLIENT_ID_SHA256 = createHash("sha256")
  .update(TEST_RUNTIME_CLIENT_ID, "utf8").digest("hex")
const TEST_RUNTIME_RUNAME_SHA256 = createHash("sha256")
  .update(TEST_RUNTIME_RUNAME, "utf8").digest("hex")
const RUNTIME_CREDENTIAL_DOMAIN_URL = new URL(
  "./ebay-seller-oauth-reauth-domain.ts",
  import.meta.url,
).href

function replaceTestCredentialExpectation(source, pattern, replacement) {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error("RUNTIME_CREDENTIAL_TEST_FIXTURE_INJECTION_FAILED")
  }
  return source.replace(pattern, (_match, prefix) => `${prefix}${replacement}`)
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    if (value.startsWith(".") &&
        !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try {
        return nextResolve(`${value}.ts`, context)
      } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)
    if (url !== RUNTIME_CREDENTIAL_DOMAIN_URL) return loaded
    const source = typeof loaded.source === "string"
      ? loaded.source
      : Buffer.from(loaded.source).toString("utf8")
    const withClientIdLength = replaceTestCredentialExpectation(
      source,
      /(const EXPECTED_PRODUCTION_APP_ID_UTF8_LENGTH =\s*)\d+/g,
      String(Buffer.byteLength(TEST_RUNTIME_CLIENT_ID, "utf8")),
    )
    const withClientIdHash = replaceTestCredentialExpectation(
      withClientIdLength,
      /(const EXPECTED_PRODUCTION_APP_ID_SHA256 =\s*)"[a-f0-9]{64}"/g,
      `"${TEST_RUNTIME_CLIENT_ID_SHA256}"`,
    )
    const withRunameLength = replaceTestCredentialExpectation(
      withClientIdHash,
      /(const EXPECTED_PRODUCTION_RUNAME_UTF8_LENGTH =\s*)\d+/g,
      String(Buffer.byteLength(TEST_RUNTIME_RUNAME, "utf8")),
    )
    const withRuntimeFixtures = replaceTestCredentialExpectation(
      withRunameLength,
      /(const EXPECTED_PRODUCTION_RUNAME_SHA256 =\s*)"[a-f0-9]{64}"/g,
      `"${TEST_RUNTIME_RUNAME_SHA256}"`,
    )
    return { ...loaded, source: withRuntimeFixtures }
  },
})

const {
  assertEbaySellerOAuthAnalyticsHandoffPolicy,
  certifyInstalledEbaySellerOAuthRuntime,
  claimAndVerifyEbaySellerOAuthReauth,
  diagnoseEbaySellerOAuthReauthAuthorization,
  isEbaySellerOAuthReauthAuthorizationStartAllowed,
  preflightEbaySellerOAuthReauthAuthorizationRequest,
  prepareEbaySellerOAuthReauthStart,
  verifyEbaySellerOAuthReauthCandidate,
} = await import("./ebay-seller-oauth-reauth.ts")
const {
  assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified,
  assertEbaySellerOAuthReauthAdmin,
  buildEbaySellerOAuthReauthAuthorizationUrl,
  buildEbaySellerOAuthReauthDiagnosticAuthorizationUrl,
  compareEbaySellerOAuthReauthCredentialFingerprint,
  compareEbaySellerOAuthReauthRuntimeCredentials,
  createEbaySellerOAuthReauthCookie,
  ebaySellerOAuthReauthSuccessResponseHeaders,
  EBAY_SELLER_OAUTH_REAUTH_BRANCH,
  EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
  EBAY_SELLER_OAUTH_REAUTH_EXTERNAL_DEADLINE_MS,
  EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS,
  EBAY_SELLER_OAUTH_REAUTH_MAX_EXTERNAL_READ_CALLS,
  EBAY_SELLER_OAUTH_REAUTH_PREVIEW_BRANCH_HOST,
  EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
  EBAY_SELLER_OAUTH_REAUTH_SCOPES,
  EBAY_SELLER_OAUTH_REAUTH_TERMINAL_RESERVE_MS,
  getEbaySellerOAuthReauthConfiguration,
  getEbaySellerOAuthReauthRuntimeCredentialMatch,
  hashEbaySellerOAuthReauthState,
  isEbaySellerOAuthReauthRuntimeCredentialMatchCertified,
  parseEbaySellerOAuthReauthCallbackUrl,
  renderEbaySellerOAuthReauthSuccessHtml,
  safeEbaySellerOAuthReauthError,
  verifyEbaySellerOAuthReauthCookie,
} = await import("./ebay-seller-oauth-reauth-domain.ts")
const {
  createSupabaseEbaySellerOAuthReauthStateLedger,
} = await import("./ebay-seller-oauth-reauth-ledger.ts")
const {
  ebayProductionAccountFingerprint,
} = await import("./ebay-seller-account-scope.ts")
const { getEbayProRuntimeBoundary } = await import("./environment-boundaries.ts")
const {
  getEbayCommercialOrdersAuthorizationConfiguration,
} = await import("./ebay-commercial-orders-oauth-authorization.ts")

const HOST = "imnova-canonical-branch.example.vercel.app"
const DEDICATED_PREPROD_HOST = "imnova-seller-os-preprod.vercel.app"
const USER_ID = "imnova-production-seller"
const ADMIN_ID = "11111111-1111-4111-8111-111111111111"
const STATE = "A".repeat(43)
const SECOND_STATE = "B".repeat(43)
const PRIVATE_CODE = "v%5E1.1%23private-code"
const PRIVATE_REFRESH = "v^1.1#NEW_PRIVATE_REFRESH_SENTINEL"
const OLD_ENV_REFRESH = "OLD_ENV_REFRESH_MUST_NEVER_BE_USED"
const PRIVATE_ACCESS = "NEW_PRIVATE_ACCESS_SENTINEL"
const PRIVATE_DESCRIPTION = "PRIVATE_ERROR_DESCRIPTION_MUST_NOT_ESCAPE"
const EXPECTED_FINGERPRINT = ebayProductionAccountFingerprint(USER_ID)

const environment = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: EBAY_SELLER_OAUTH_REAUTH_BRANCH,
  VERCEL_BRANCH_URL: HOST,
  EBAY_CLIENT_ID: TEST_RUNTIME_CLIENT_ID,
  EBAY_CLIENT_SECRET: "production-app-secret",
  EBAY_RuName: TEST_RUNTIME_RUNAME,
  EBAY_SELLER_ACCOUNT_KEY: "imnova-ebay-us-primary",
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: USER_ID,
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:
    EXPECTED_FINGERPRINT,
  EBAY_SELLER_REFRESH_TOKEN: OLD_ENV_REFRESH,
}

const dedicatedPreprodEnvironment = {
  ...environment,
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
  VERCEL: "1",
  VERCEL_PROJECT_ID: "prj_XvOpSg1jhmLLG1yOCFhAbiLEn222",
  VERCEL_PROJECT_PRODUCTION_URL: DEDICATED_PREPROD_HOST,
  EBAY_PRO_RUNTIME: "staging",
  NEXT_PUBLIC_SUPABASE_URL: "https://vsfthqydfrdzulldbfbe.supabase.co",
}

const configuration = getEbaySellerOAuthReauthConfiguration({
  environment,
  requestHost: HOST,
})

function fingerprintExpectation(value, length = Buffer.byteLength(value, "utf8")) {
  return {
    utf8Length: length,
    sha256: createHash("sha256").update(value, "utf8").digest("hex"),
  }
}

const CERTIFIED_RUNTIME_CREDENTIAL_MATCH =
  getEbaySellerOAuthReauthRuntimeCredentialMatch(configuration)

class AtomicMemoryLedger {
  constructor(now = Date.now()) {
    this.now = now
    this.rows = new Map()
    this.createCalls = 0
    this.claimCalls = 0
    this.releaseClaims = null
  }

  async createPending(input) {
    this.createCalls += 1
    if (this.rows.has(input.stateHash)) return false
    this.rows.set(input.stateHash, {
      status: "PENDING",
      expiresAt: Date.parse(input.expiresAt),
      flowVersion: input.flowVersion,
      claimedAt: null,
    })
    return true
  }

  async claimPending(input) {
    this.claimCalls += 1
    if (this.releaseClaims) await this.releaseClaims
    const row = this.rows.get(input.stateHash)
    if (!row || row.status !== "PENDING" || row.expiresAt <= this.now ||
        row.flowVersion !== input.flowVersion) return false
    row.status = "CLAIMED"
    row.claimedAt = this.now
    return true
  }
}

function fakeVerification(refreshToken = PRIVATE_REFRESH) {
  return {
    refreshToken,
    credentialSource: "NEW_OAUTH_CANDIDATE_ONLY",
    genericEnvironmentTokenFallback: false,
    capabilities: {
      tradingBase: "AVAILABLE",
      inventoryReadonly: "AVAILABLE",
      analyticsReadonly: "AVAILABLE",
      accountReadonly: "AVAILABLE",
    },
    calls: [],
    safety: {
      tokenPersisted: false,
      oauthCodePersisted: false,
      rawStatePersisted: false,
      ebayWrites: 0,
      inventoryWrites: 0,
      listingWrites: 0,
      promotionWrites: 0,
      fulfillmentWrites: 0,
      buyerMessageWrites: 0,
      whatsappDispatches: 0,
      businessDataMutations: 0,
      productCaseMutations: 0,
      registryMutations: 0,
      vaultMutations: 0,
      vercelMutations: 0,
    },
  }
}

function response(body, status = 200, contentType = "application/json") {
  return new Response(
    contentType === "application/json" ? JSON.stringify(body) : body,
    { status, headers: { "Content-Type": contentType } },
  )
}

function authorizationPreflightFetch(options = {}) {
  const requests = []
  const fetchImpl = async (resource, init = {}) => {
    const raw = String(resource)
    const url = new URL(raw)
    const scopes = url.searchParams.get("scope")?.split(/\s+/).filter(Boolean) ?? []
    const plusEncoding = /scope=[^&]+\+https%3A/.test(raw)
    const hasState = url.searchParams.has("state")
    requests.push({ raw, url, init, scopes, plusEncoding, hasState })
    const invalid = (options.invalidScopeCount === scopes.length) ||
      (options.invalidCanonicalState && hasState && !plusEncoding) ||
      (options.invalidPlus !== false && plusEncoding)
    return new Response(null, {
      status: 302,
      headers: {
        Location: invalid
          ? `https://auth2.ebay.com/oauth2/errorOauth?errorId=invalid_request&error_description=${PRIVATE_DESCRIPTION}`
          : "https://signin.ebay.com/signin?entry=oauth",
        "Set-Cookie": "PRIVATE_PROVIDER_COOKIE_MUST_NOT_ESCAPE=1",
      },
    })
  }
  return { fetchImpl, requests }
}

function successfulCandidateFetch(options = {}) {
  const requests = []
  const fetchImpl = async (resource, init = {}) => {
    const url = new URL(String(resource))
    const body = init.body instanceof URLSearchParams
      ? init.body
      : null
    requests.push({ url, init, body })
    if (url.pathname === "/identity/v1/oauth2/token") {
      if (body?.get("grant_type") === "authorization_code") {
        if (options.codeExchangeFailure) {
          return response({
            error: "invalid_grant",
            error_description: PRIVATE_DESCRIPTION,
          }, 400)
        }
        return response({
          access_token: "INITIAL_PRIVATE_ACCESS_SENTINEL",
          refresh_token: PRIVATE_REFRESH,
          expires_in: 7_200,
          ...(options.omitScopes ? {} : {
            scope: options.returnedScopes ??
              EBAY_SELLER_OAUTH_REAUTH_SCOPES.join(" "),
          }),
        })
      }
      assert.equal(body?.get("refresh_token"), PRIVATE_REFRESH)
      assert.notEqual(body?.get("refresh_token"), OLD_ENV_REFRESH)
      assert.equal(
        body?.get("scope"),
        EBAY_SELLER_OAUTH_REAUTH_SCOPES.join(" "),
      )
      return response({
        access_token: PRIVATE_ACCESS,
        expires_in: 7_200,
        ...(options.omitScopes ? {} : {
          scope: options.returnedScopes ??
            EBAY_SELLER_OAUTH_REAUTH_SCOPES.join(" "),
        }),
      })
    }
    if (url.pathname === "/ws/api.dll") {
      if (options.getUserXml) {
        return response(options.getUserXml, 200, "text/xml")
      }
      const userId = options.userId ?? USER_ID
      const site = options.site ?? "US"
      return response(
        `<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">` +
        `<Ack>Success</Ack><User><UserID>${userId}</UserID>` +
        `<Site>${site}</Site></User></GetUserResponse>`,
        200,
        "text/xml",
      )
    }
    const operation = url.pathname.includes("/inventory/")
      ? "inventory"
      : url.pathname.includes("/analytics/")
        ? "analytics"
        : "account"
    if (operation === "analytics" && options.analyticsResponse) {
      return options.analyticsResponse()
    }
    if (options.failProbe === operation) {
      return response({ errors: [{ message: PRIVATE_DESCRIPTION }] }, 403)
    }
    if (options.invalidProbeJson === operation) return response([])
    return response({})
  }
  return { fetchImpl, requests }
}

test("configuration preserves exact-branch Preview and service-role auth is rejected", () => {
  assert.equal(configuration.ready, true)
  for (const patch of [
    { VERCEL_ENV: "production" },
    { VERCEL_GIT_COMMIT_REF: "another-branch" },
    { VERCEL_BRANCH_URL: "another.example.vercel.app" },
  ]) {
    const result = getEbaySellerOAuthReauthConfiguration({
      environment: { ...environment, ...patch },
      requestHost: HOST,
    })
    assert.equal(result.ready, false)
  }
  assert.equal(
    assertEbaySellerOAuthReauthAdmin({
      ok: true,
      userId: ADMIN_ID,
      authenticationMode: "admin_user",
    }),
    ADMIN_ID,
  )
  assert.throws(() => assertEbaySellerOAuthReauthAdmin({
    ok: true,
    userId: null,
    authenticationMode: "service_role",
  }), /ADMIN_USER_REQUIRED/)
})

test("dedicated preprod uses the canonical boundary and exact callback host", () => {
  const dedicated = getEbaySellerOAuthReauthConfiguration({
    environment: dedicatedPreprodEnvironment,
    requestHost: DEDICATED_PREPROD_HOST,
  })
  assert.equal(dedicated.ready, true)
  assert.equal(dedicated.branchHost, DEDICATED_PREPROD_HOST)
  assert.equal(
    dedicated.callbackUrl,
    `https://${DEDICATED_PREPROD_HOST}${EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH}`,
  )
  assert.equal(
    getEbaySellerOAuthReauthRuntimeCredentialMatch(dedicated)
      .FINAL_BINDING_DIAGNOSIS,
    "BOTH_MATCH",
  )

  for (const patch of [
    { VERCEL_PROJECT_ID: "prj_wrong" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://qsefoxmmypmdtwrrtnry.supabase.co" },
    { EBAY_PRO_RUNTIME: "production_core" },
  ]) {
    const blocked = getEbaySellerOAuthReauthConfiguration({
      environment: { ...dedicatedPreprodEnvironment, ...patch },
      requestHost: DEDICATED_PREPROD_HOST,
    })
    assert.equal(blocked.ready, false)
    assert.equal(
      blocked.reason,
      "EBAY_SELLER_OAUTH_REAUTH_PREVIEW_REQUIRED",
    )
  }

  const wrongHost = getEbaySellerOAuthReauthConfiguration({
    environment: dedicatedPreprodEnvironment,
    requestHost: "another.example.vercel.app",
  })
  assert.equal(wrongHost.ready, false)
  assert.equal(wrongHost.reason, "EBAY_SELLER_OAUTH_REAUTH_HOST_DENIED")
})

test("commercial orders readonly reuses only the certified dedicated preprod boundary", () => {
  const dedicated = getEbayCommercialOrdersAuthorizationConfiguration(
    dedicatedPreprodEnvironment,
    DEDICATED_PREPROD_HOST,
  )
  assert.equal(dedicated.configured, true)
  assert.equal(dedicated.vercelTarget, "DEDICATED_PREPROD")
  assert.equal(dedicated.scopeProfile, "COMMERCIAL_ORDERS_READONLY")
  assert.deepEqual(dedicated.scopes, [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  ])
  assert.doesNotMatch(dedicated.scopes.join(" "), /commerce\.message/)
  assert.equal(
    dedicated.callback.canonicalUrl,
    `https://${DEDICATED_PREPROD_HOST}${EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH}`,
  )

  for (const patch of [
    { VERCEL_PROJECT_ID: "prj_wrong" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://qsefoxmmypmdtwrrtnry.supabase.co" },
    { EBAY_PRO_RUNTIME: "production_core" },
  ]) {
    const blocked = getEbayCommercialOrdersAuthorizationConfiguration(
      { ...dedicatedPreprodEnvironment, ...patch },
      DEDICATED_PREPROD_HOST,
    )
    assert.equal(blocked.configured, false)
    assert.notEqual(blocked.vercelTarget, "DEDICATED_PREPROD")
  }
})

test("CLI Preview accepts only the canonical alias when branch URL is absent", () => {
  const cliPreview = getEbaySellerOAuthReauthConfiguration({
    environment: { ...environment, VERCEL_BRANCH_URL: undefined },
    requestHost: EBAY_SELLER_OAUTH_REAUTH_PREVIEW_BRANCH_HOST,
  })
  assert.equal(cliPreview.ready, true)
  assert.equal(
    cliPreview.branchHost,
    EBAY_SELLER_OAUTH_REAUTH_PREVIEW_BRANCH_HOST,
  )

  const wrongHost = getEbaySellerOAuthReauthConfiguration({
    environment: { ...environment, VERCEL_BRANCH_URL: undefined },
    requestHost: "another.example.vercel.app",
  })
  assert.equal(wrongHost.ready, false)
  assert.equal(wrongHost.reason, "EBAY_SELLER_OAUTH_REAUTH_HOST_DENIED")
})

test("protected runtime credential comparison is exact, UTF-8 aware and boolean-only", () => {
  const clientId = "production-client-id-fixture"
  const runame = "production-rúnamé-fixture"
  const expectations = {
    clientId: fingerprintExpectation(clientId),
    runame: fingerprintExpectation(runame),
  }
  const exact = compareEbaySellerOAuthReauthRuntimeCredentials(
    { clientId, runame },
    expectations,
  )
  assert.deepEqual(exact, {
    RUNTIME_EBAY_CLIENT_ID_PRESENT: true,
    RUNTIME_EBAY_CLIENT_ID_LENGTH_MATCH: true,
    RUNTIME_EBAY_CLIENT_ID_SHA256_MATCH: true,
    RUNTIME_EBAY_RUNAME_PRESENT: true,
    RUNTIME_EBAY_RUNAME_LENGTH_MATCH: true,
    RUNTIME_EBAY_RUNAME_SHA256_MATCH: true,
    APP_ID_PORTAL_RUNTIME_MATCH: true,
    RUNAME_PORTAL_RUNTIME_MATCH: true,
    FINAL_BINDING_DIAGNOSIS: "BOTH_MATCH",
  })
  assert.equal(
    isEbaySellerOAuthReauthRuntimeCredentialMatchCertified(exact),
    true,
  )
  assert.doesNotThrow(() =>
    assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(exact))

  for (const key of [
    "RUNTIME_EBAY_CLIENT_ID_PRESENT",
    "RUNTIME_EBAY_CLIENT_ID_LENGTH_MATCH",
    "RUNTIME_EBAY_CLIENT_ID_SHA256_MATCH",
    "RUNTIME_EBAY_RUNAME_PRESENT",
    "RUNTIME_EBAY_RUNAME_LENGTH_MATCH",
    "RUNTIME_EBAY_RUNAME_SHA256_MATCH",
    "APP_ID_PORTAL_RUNTIME_MATCH",
    "RUNAME_PORTAL_RUNTIME_MATCH",
  ]) {
    const mismatch = { ...exact, [key]: false }
    assert.equal(
      isEbaySellerOAuthReauthRuntimeCredentialMatchCertified(mismatch),
      false,
    )
    assert.throws(
      () => assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(mismatch),
      /RUNTIME_CREDENTIAL_MISMATCH/,
    )
  }
  assert.equal(isEbaySellerOAuthReauthRuntimeCredentialMatchCertified({
    ...exact,
    FINAL_BINDING_DIAGNOSIS: "BOTH_MISMATCH",
  }), false)

  const wrongHash = "0".repeat(64)
  assert.equal(compareEbaySellerOAuthReauthRuntimeCredentials(
    { clientId, runame },
    {
      ...expectations,
      clientId: { ...expectations.clientId, sha256: wrongHash },
    },
  ).FINAL_BINDING_DIAGNOSIS, "APP_ID_MISMATCH_RUNAME_MATCH")
  assert.equal(compareEbaySellerOAuthReauthRuntimeCredentials(
    { clientId, runame },
    {
      ...expectations,
      runame: { ...expectations.runame, sha256: wrongHash },
    },
  ).FINAL_BINDING_DIAGNOSIS, "APP_ID_MATCH_RUNAME_MISMATCH")
  assert.equal(compareEbaySellerOAuthReauthRuntimeCredentials(
    { clientId: `${clientId}x`, runame: runame.toUpperCase() },
    expectations,
  ).FINAL_BINDING_DIAGNOSIS, "BOTH_MISMATCH")
  assert.equal(compareEbaySellerOAuthReauthRuntimeCredentials(
    { clientId: "", runame },
    expectations,
  ).FINAL_BINDING_DIAGNOSIS, "RUNTIME_CONFIGURATION_MISSING")

  const byteEvidence = compareEbaySellerOAuthReauthCredentialFingerprint(
    "é",
    fingerprintExpectation("é"),
  )
  assert.deepEqual(byteEvidence, {
    present: true,
    lengthMatch: true,
    sha256Match: true,
  })
  assert.deepEqual(compareEbaySellerOAuthReauthCredentialFingerprint(
    clientId,
    fingerprintExpectation(clientId, expectations.clientId.utf8Length + 1),
  ), {
    present: true,
    lengthMatch: false,
    sha256Match: true,
  })
  assert.throws(() => compareEbaySellerOAuthReauthCredentialFingerprint(
    clientId,
    { utf8Length: 0, sha256: "INVALID" },
  ), /FINGERPRINT_CONTRACT_INVALID/)

  const normalized = getEbaySellerOAuthReauthConfiguration({
    environment: {
      ...environment,
      EBAY_CLIENT_ID: `  ${clientId}  `,
      EBAY_RuName: `  ${runame}  `,
    },
    requestHost: HOST,
  })
  assert.equal(normalized.clientId, clientId)
  assert.equal(normalized.runame, runame)
  assert.equal(compareEbaySellerOAuthReauthRuntimeCredentials(
    normalized,
    expectations,
  ).FINAL_BINDING_DIAGNOSIS, "BOTH_MATCH")

  const fixedContractResult = getEbaySellerOAuthReauthRuntimeCredentialMatch(
    configuration,
  )
  const serialized = JSON.stringify(fixedContractResult)
  assert.deepEqual(Object.keys(fixedContractResult).sort(), [
    "APP_ID_PORTAL_RUNTIME_MATCH",
    "FINAL_BINDING_DIAGNOSIS",
    "RUNAME_PORTAL_RUNTIME_MATCH",
    "RUNTIME_EBAY_CLIENT_ID_LENGTH_MATCH",
    "RUNTIME_EBAY_CLIENT_ID_PRESENT",
    "RUNTIME_EBAY_CLIENT_ID_SHA256_MATCH",
    "RUNTIME_EBAY_RUNAME_LENGTH_MATCH",
    "RUNTIME_EBAY_RUNAME_PRESENT",
    "RUNTIME_EBAY_RUNAME_SHA256_MATCH",
  ].sort())
  for (const [key, value] of Object.entries(fixedContractResult)) {
    if (key !== "FINAL_BINDING_DIAGNOSIS") assert.equal(typeof value, "boolean")
  }
  assert.doesNotMatch(serialized, /[a-f0-9]{64}/i)
  assert.doesNotMatch(serialized, /production-app-id|production-generic-runame/)
})

test("authorization URL and signed transaction cookie bind exact scope/state/host/expiry", () => {
  const serialized = buildEbaySellerOAuthReauthAuthorizationUrl({
    clientId: configuration.clientId,
    runame: configuration.runame,
    state: STATE,
  })
  const url = new URL(serialized)
  assert.equal(url.origin, "https://auth.ebay.com")
  assert.equal(url.pathname, "/oauth2/authorize")
  assert.match(serialized, /scope=[^&]+%20https%3A/)
  assert.doesNotMatch(serialized, /\+|%252F/)
  assert.deepEqual(
    url.searchParams.get("scope").split(" "),
    [...EBAY_SELLER_OAUTH_REAUTH_SCOPES],
  )
  assert.doesNotMatch(url.searchParams.get("scope"), /fulfillment|marketing/)
  const now = Date.parse("2026-08-08T20:00:00.000Z")
  const cookie = createEbaySellerOAuthReauthCookie({
    state: STATE,
    expiresAt: now + 300_000,
    actorUserId: ADMIN_ID,
    branchHost: HOST,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: EXPECTED_FINGERPRINT,
  })
  const verified = verifyEbaySellerOAuthReauthCookie({
    cookie,
    state: STATE,
    now,
    branchHost: HOST,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: EXPECTED_FINGERPRINT,
  })
  assert.equal(verified.stateHash, hashEbaySellerOAuthReauthState(STATE))
  assert.throws(() => verifyEbaySellerOAuthReauthCookie({
    cookie,
    state: SECOND_STATE,
    now,
    branchHost: HOST,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: EXPECTED_FINGERPRINT,
  }), /STATE_MISMATCH/)
  assert.throws(() => verifyEbaySellerOAuthReauthCookie({
    cookie,
    state: STATE,
    now: now + 300_001,
    branchHost: HOST,
    clientSecret: configuration.clientSecret,
    expectedAccountFingerprint: EXPECTED_FINGERPRINT,
  }), /STATE_EXPIRED/)
})

test("authorization preflight isolates scopes, state and the previous plus encoding without redirecting", async () => {
  const preflight = authorizationPreflightFetch()
  const diagnosis = await diagnoseEbaySellerOAuthReauthAuthorization({
    configuration,
    fetchImpl: preflight.fetchImpl,
    stateFactory: () => SECOND_STATE,
  })
  assert.equal(diagnosis.rootCause, "URL_SERIALIZATION")
  assert.equal(diagnosis.testBase.acceptedByAuthEndpoint, "YES")
  assert.equal(diagnosis.testBaseAccount.acceptedByAuthEndpoint, "YES")
  assert.equal(diagnosis.testBaseAccountInventory.acceptedByAuthEndpoint, "YES")
  assert.equal(diagnosis.testFullFourScopes.acceptedByAuthEndpoint, "YES")
  assert.equal(diagnosis.canonicalWithState.acceptedByAuthEndpoint, "YES")
  assert.deepEqual(diagnosis.previousPlusEncodingWithState, {
    acceptedByAuthEndpoint: "NO",
    safeErrorCategory: "INVALID_REQUEST",
  })
  assert.equal(diagnosis.encodingCausesInvalidRequest, "YES")
  assert.equal(diagnosis.stateCausesInvalidRequest, "NO")
  assert.equal(diagnosis.runameAppBinding, "PASS")
  assert.equal(diagnosis.scopeContractExact, true)
  assert.equal(diagnosis.startAllowed, true)
  assert.equal(diagnosis.ledgerRowsCreated, 0)
  assert.equal(diagnosis.cookiesSet, 0)
  assert.equal(diagnosis.humanRedirects, 0)
  assert.equal(diagnosis.oauthConsentLaunched, false)
  assert.equal(diagnosis.authorizationCodeExchangeCalls, 0)
  assert.equal(preflight.requests.length, 6)
  assert.deepEqual(
    preflight.requests.slice(0, 4).map((request) => request.scopes.length),
    [1, 2, 3, 4],
  )
  assert.equal(preflight.requests[3].hasState, false)
  assert.equal(preflight.requests[4].hasState, true)
  assert.equal(preflight.requests[4].plusEncoding, false)
  assert.equal(preflight.requests[5].plusEncoding, true)
  for (const request of preflight.requests) {
    assert.equal(request.url.origin, "https://auth.ebay.com")
    assert.equal(request.url.pathname, "/oauth2/authorize")
    assert.equal(request.init.method, "GET")
    assert.equal(request.init.redirect, "manual")
    assert.equal(request.init.credentials, "omit")
    assert.equal(request.init.cache, "no-store")
    assert.equal(request.init.referrerPolicy, "no-referrer")
    assert.deepEqual(request.init.headers, {
      Accept: "text/html,application/json",
    })
    assert.equal(request.init.body, undefined)
  }
  const serializedDiagnosis = JSON.stringify(diagnosis)
  assert.doesNotMatch(serializedDiagnosis, new RegExp(PRIVATE_DESCRIPTION))
  assert.doesNotMatch(serializedDiagnosis, /production-app-id|production-generic-runame|provider_cookie/i)
  assert.doesNotMatch(serializedDiagnosis, new RegExp(SECOND_STATE))
})

test("positive canonical invariants allow start when causal root remains unproven", async () => {
  const preflight = authorizationPreflightFetch({ invalidPlus: false })
  const diagnosis = await diagnoseEbaySellerOAuthReauthAuthorization({
    configuration,
    fetchImpl: preflight.fetchImpl,
    stateFactory: () => SECOND_STATE,
  })
  assert.equal(diagnosis.rootCause, "STILL_UNPROVEN")
  assert.deepEqual(diagnosis.previousPlusEncodingWithState, {
    acceptedByAuthEndpoint: "YES",
    safeErrorCategory: "NONE",
  })
  assert.equal(diagnosis.encodingCausesInvalidRequest, "NO")
  assert.equal(diagnosis.startAllowed, true)
  assert.equal(
    isEbaySellerOAuthReauthAuthorizationStartAllowed(diagnosis),
    true,
  )

  const deniedMutations = [
    { testBase: { acceptedByAuthEndpoint: "NO", safeErrorCategory: "INVALID_REQUEST" } },
    { testBase: { acceptedByAuthEndpoint: "YES", safeErrorCategory: "INVALID_REQUEST" } },
    { testBaseAccount: { acceptedByAuthEndpoint: "NO", safeErrorCategory: "INVALID_REQUEST" } },
    { testBaseAccountInventory: { acceptedByAuthEndpoint: "NO", safeErrorCategory: "INVALID_REQUEST" } },
    { testFullFourScopes: { acceptedByAuthEndpoint: "NO", safeErrorCategory: "INVALID_REQUEST" } },
    { canonicalWithState: { acceptedByAuthEndpoint: "NO", safeErrorCategory: "INVALID_REQUEST" } },
    { runameAppBinding: "FAIL" },
    { runameSource: "UNEXPECTED_RUNAME_SOURCE" },
    { stateCausesInvalidRequest: "YES" },
    { stateFormatValid: false },
    { currentScopeEncoding: "FORM_URLENCODED_PLUS" },
    { scopeCount: 5 },
    { scopeContractExact: false },
    { parameterNames: [...diagnosis.parameterNames, "unexpected"] },
    { externalCalls: 5 },
    { ledgerRowsCreated: 1 },
    { cookiesSet: 1 },
    { humanRedirects: 1 },
    { oauthConsentLaunched: true },
    { authorizationCodeExchangeCalls: 1 },
    { secretsReturned: true },
  ]
  for (const mutation of deniedMutations) {
    assert.equal(isEbaySellerOAuthReauthAuthorizationStartAllowed({
      ...diagnosis,
      ...mutation,
      startAllowed: true,
    }), false)
  }
  assert.equal(isEbaySellerOAuthReauthAuthorizationStartAllowed({
    ...diagnosis,
    rootCause: "URL_SERIALIZATION",
  }), true)
})

test("authorization preflight classifies the first exact rejected addition", async () => {
  const cases = [
    [1, "CLIENT_ID_RUNAME_BINDING"],
    [2, "SCOPE_ACCOUNT_REJECTED"],
    [3, "SCOPE_INVENTORY_REJECTED"],
    [4, "SCOPE_ANALYTICS_REJECTED"],
  ]
  for (const [invalidScopeCount, rootCause] of cases) {
    const preflight = authorizationPreflightFetch({ invalidScopeCount })
    const diagnosis = await diagnoseEbaySellerOAuthReauthAuthorization({
      configuration,
      fetchImpl: preflight.fetchImpl,
      stateFactory: () => SECOND_STATE,
    })
    assert.equal(diagnosis.rootCause, rootCause)
    assert.equal(diagnosis.startAllowed, false)
    assert.equal(diagnosis.ledgerRowsCreated, 0)
    assert.equal(diagnosis.cookiesSet, 0)
  }
  const stateFailure = await diagnoseEbaySellerOAuthReauthAuthorization({
    configuration,
    fetchImpl: authorizationPreflightFetch({
      invalidCanonicalState: true,
      invalidPlus: false,
    }).fetchImpl,
    stateFactory: () => SECOND_STATE,
  })
  assert.equal(stateFailure.rootCause, "STATE_PARAMETER")
  assert.equal(stateFailure.stateCausesInvalidRequest, "YES")
  assert.equal(stateFailure.startAllowed, false)
})

test("authorization endpoint response classifier is bounded, exact-host and fail-closed", async () => {
  const authorizationUrl = buildEbaySellerOAuthReauthDiagnosticAuthorizationUrl({
    clientId: configuration.clientId,
    runame: configuration.runame,
    phase: "FULL_FOUR_SCOPES",
    state: SECOND_STATE,
  })
  const checks = [
    [
      new Response(null, {
        status: 302,
        headers: { Location: "https://signin.ebay.com/signin?entry=oauth" },
      }),
      "YES",
      "NONE",
    ],
    [
      new Response(null, {
        status: 302,
        headers: { Location: "https://auth2.ebay.com/oauth2/authorize?session=1" },
      }),
      "NO",
      "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
    ],
    [
      new Response(null, {
        status: 302,
        headers: { Location: "/oauth2/errorOauth?errorId=invalid_request&error_description=PRIVATE" },
      }),
      "NO",
      "INVALID_REQUEST",
    ],
    [
      new Response(null, {
        status: 302,
        headers: { Location: "https://signin.ebay.com.evil.invalid/signin" },
      }),
      "NO",
      "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
    ],
    [
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.invalid/oauth2/errorOauth?error_id=invalid_request" },
      }),
      "NO",
      "AUTH_ENDPOINT_REJECTED",
    ],
    [
      new Response(null, {
        status: 302,
        headers: { Location: `https://${HOST}${EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH}?code=PRIVATE` },
      }),
      "NO",
      "AUTH_ENDPOINT_REJECTED",
    ],
    [new Response(null, { status: 301 }), "NO", "AUTH_ENDPOINT_REJECTED"],
    [response({ error: "invalid_request" }, 400), "NO", "INVALID_REQUEST"],
    [response({ error: "temporarily_unavailable", error_description: "PRIVATE" }, 400), "NO", "AUTH_ENDPOINT_REJECTED"],
    [response({ ok: true }), "NO", "AUTH_ENDPOINT_RESPONSE_UNPROVEN"],
    [response("<html><title>eBay Sign in</title></html>", 200, "text/html"), "NO", "AUTH_ENDPOINT_RESPONSE_UNPROVEN"],
    [response("<html>invalid_request PRIVATE</html>", 200, "text/html"), "NO", "INVALID_REQUEST"],
    [response("<html>unknown</html>", 200, "text/html"), "NO", "AUTH_ENDPOINT_RESPONSE_UNPROVEN"],
    [response("x".repeat(16_385), 200, "text/html"), "NO", "AUTH_ENDPOINT_RESPONSE_UNPROVEN"],
  ]
  for (const [providerResponse, accepted, category] of checks) {
    let calls = 0
    const result = await preflightEbaySellerOAuthReauthAuthorizationRequest({
      authorizationUrl,
      stateExpected: true,
      fetchImpl: async () => {
        calls += 1
        return providerResponse
      },
    })
    assert.equal(calls, 1)
    assert.equal(result.acceptedByAuthEndpoint, accepted)
    assert.equal(result.safeErrorCategory, category)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|evil|code/i)
  }
  let unavailableCalls = 0
  const unavailable = await preflightEbaySellerOAuthReauthAuthorizationRequest({
    authorizationUrl,
    stateExpected: true,
    fetchImpl: async () => {
      unavailableCalls += 1
      throw new Error(PRIVATE_DESCRIPTION)
    },
  })
  assert.equal(unavailableCalls, 1)
  assert.deepEqual(unavailable, {
    acceptedByAuthEndpoint: "NO",
    safeErrorCategory: "AUTH_ENDPOINT_UNAVAILABLE",
  })

  let exactHopCalls = 0
  const exactHop = await preflightEbaySellerOAuthReauthAuthorizationRequest({
    authorizationUrl,
    stateExpected: true,
    fetchImpl: async (resource) => {
      exactHopCalls += 1
      const source = new URL(String(resource))
      if (exactHopCalls === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://auth2.ebay.com/oauth2/authorize${source.search}`,
          },
        })
      }
      assert.equal(source.origin, "https://auth2.ebay.com")
      return new Response(null, {
        status: 302,
        headers: { Location: "/oauth2/consents?session=oauth" },
      })
    },
  })
  assert.equal(exactHopCalls, 2)
  assert.deepEqual(exactHop, {
    acceptedByAuthEndpoint: "YES",
    safeErrorCategory: "NONE",
  })
  let auth2ErrorCalls = 0
  const auth2Error = await preflightEbaySellerOAuthReauthAuthorizationRequest({
    authorizationUrl,
    stateExpected: true,
    fetchImpl: async (resource) => {
      auth2ErrorCalls += 1
      const source = new URL(String(resource))
      return new Response(null, {
        status: 302,
        headers: {
          Location: auth2ErrorCalls === 1
            ? `https://auth2.ebay.com/oauth2/authorize${source.search}`
            : "/oauth2/errorOauth?errorId=invalid_request",
        },
      })
    },
  })
  assert.equal(auth2ErrorCalls, 2)
  assert.deepEqual(auth2Error, {
    acceptedByAuthEndpoint: "NO",
    safeErrorCategory: "INVALID_REQUEST",
  })

  let rewrittenHopCalls = 0
  const rewrittenHop = await preflightEbaySellerOAuthReauthAuthorizationRequest({
    authorizationUrl,
    stateExpected: true,
    fetchImpl: async (resource) => {
      rewrittenHopCalls += 1
      const source = new URL(String(resource))
      return new Response(null, {
        status: 302,
        headers: {
          Location: `https://auth2.ebay.com/oauth2/authorize${source.search.replaceAll("%20", "+")}`,
        },
      })
    },
  })
  assert.equal(rewrittenHopCalls, 1)
  assert.deepEqual(rewrittenHop, {
    acceptedByAuthEndpoint: "NO",
    safeErrorCategory: "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
  })
})

test("prepare recomputes runtime credentials and rejects forged positive evidence", async () => {
  const ledger = new AtomicMemoryLedger()
  let ebayCalls = 0
  let transactionStates = 0
  await assert.rejects(prepareEbaySellerOAuthReauthStart({
    configuration: { ...configuration, runame: `${configuration.runame}x` },
    runtimeCredentialMatch: CERTIFIED_RUNTIME_CREDENTIAL_MATCH,
    actorUserId: ADMIN_ID,
    ledger,
    stateFactory: () => {
      transactionStates += 1
      return STATE
    },
    diagnosticStateFactory: () => SECOND_STATE,
    fetchImpl: async () => {
      ebayCalls += 1
      throw new Error("FETCH_MUST_NOT_RUN")
    },
  }), /RUNTIME_CREDENTIAL_MISMATCH/)
  assert.equal(ebayCalls, 0)
  assert.equal(transactionStates, 0)
  assert.equal(ledger.createCalls, 0)
  assert.equal(ledger.rows.size, 0)
})

test("failed live preflight creates no transaction state, ledger row or authorization URL", async () => {
  const now = Date.parse("2026-08-08T20:00:00.000Z")
  const ledger = new AtomicMemoryLedger(now)
  let transactionStates = 0
  const preflight = authorizationPreflightFetch({ invalidScopeCount: 4 })
  await assert.rejects(prepareEbaySellerOAuthReauthStart({
    configuration,
    actorUserId: ADMIN_ID,
    ledger,
    clock: () => now,
    stateFactory: () => {
      transactionStates += 1
      return STATE
    },
    diagnosticStateFactory: () => SECOND_STATE,
    fetchImpl: preflight.fetchImpl,
  }), /PREFLIGHT_SCOPE_ANALYTICS_REJECTED/)
  assert.equal(transactionStates, 0)
  assert.equal(ledger.createCalls, 0)
  assert.equal(ledger.rows.size, 0)
})

test("callback accepts certified expiry metadata and rejects every other shape", () => {
  const base = `https://${HOST}${EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH}`
  assert.deepEqual(
    parseEbaySellerOAuthReauthCallbackUrl(
      `${base}?state=${STATE}&code=${encodeURIComponent(PRIVATE_CODE)}`,
    ),
    { kind: "CODE", state: STATE, code: PRIVATE_CODE },
  )
  assert.deepEqual(
    parseEbaySellerOAuthReauthCallbackUrl(
      `${base}?state=${STATE}&code=${encodeURIComponent(PRIVATE_CODE)}` +
        "&expires_in=299",
    ),
    { kind: "CODE", state: STATE, code: PRIVATE_CODE },
  )
  assert.equal(
    parseEbaySellerOAuthReauthCallbackUrl(
      `${base}?state=${STATE}&error=access_denied&error_description=private`,
    ).kind,
    "DENIED",
  )
  for (const query of [
    `state=${STATE}`,
    `state=${STATE}&state=${STATE}&code=a`,
    `state=${STATE}&code=a&code=b`,
    `state=${STATE}&code=a&expires_in=299&expires_in=300`,
    `state=${STATE}&code=a&error=access_denied`,
    `state=${STATE}&code=a&error=`,
    `state=${STATE}&error=access_denied&code=`,
    `state=${STATE}&code=a&error_description=contradictory`,
    `state=${STATE}&error=access_denied&expires_in=299`,
    `state=${STATE}&code=a&unexpected=1`,
    `state=${STATE}&code=a&expires_in=`,
    `state=${STATE}&code=a&expires_in=0`,
    `state=${STATE}&code=a&expires_in=0299`,
    `state=${STATE}&code=a&expires_in=-1`,
    `state=${STATE}&code=a&expires_in=%2B299`,
    `state=${STATE}&code=a&expires_in=299.0`,
    `state=${STATE}&code=a&expires_in=3e2`,
    `state=${STATE}&code=a&expires_in=3601`,
    `state=${STATE}&code=a&expires_in=${"9".repeat(5)}`,
    `state=${STATE}&code=${"x".repeat(1_025)}`,
    `state=${STATE}&code=${encodeURIComponent("bad\ncode")}`,
  ]) {
    assert.throws(
      () => parseEbaySellerOAuthReauthCallbackUrl(`${base}?${query}`),
      /CALLBACK_INVALID|CODE_INVALID/,
    )
  }
})

test("invalid callback shape reaches neither atomic claim nor token exchange", async () => {
  const ledger = new AtomicMemoryLedger()
  const privateQueryValue = "PRIVATE_CALLBACK_QUERY_VALUE_MUST_NOT_ESCAPE"
  let exchanges = 0
  let safeCode = ""
  await assert.rejects(async () => {
    const callback = parseEbaySellerOAuthReauthCallbackUrl(
      `https://${HOST}${EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH}` +
        `?state=${STATE}&code=${encodeURIComponent(PRIVATE_CODE)}` +
        `&unexpected=${privateQueryValue}`,
    )
    return claimAndVerifyEbaySellerOAuthReauth({
      callback,
      stateHash: hashEbaySellerOAuthReauthState(STATE),
      ledger,
      verifyCandidate: async () => {
        exchanges += 1
        return fakeVerification()
      },
    })
  }, (cause) => {
    safeCode = safeEbaySellerOAuthReauthError(cause)
    return safeCode === "EBAY_SELLER_OAUTH_REAUTH_CALLBACK_INVALID"
  })
  assert.equal(ledger.claimCalls, 0)
  assert.equal(exchanges, 0)
  assert.doesNotMatch(safeCode, new RegExp(privateQueryValue))
  assert.doesNotMatch(safeCode, new RegExp(PRIVATE_CODE.replaceAll("%", "")))
})

test("start inserts exactly one hash-only PENDING row and collision fails closed", async () => {
  const now = Date.parse("2026-08-08T20:00:00.000Z")
  const ledger = new AtomicMemoryLedger(now)
  const preflight = authorizationPreflightFetch({ invalidPlus: false })
  const first = await prepareEbaySellerOAuthReauthStart({
    configuration,
    actorUserId: ADMIN_ID,
    ledger,
    clock: () => now,
    stateFactory: () => STATE,
    diagnosticStateFactory: () => SECOND_STATE,
    fetchImpl: preflight.fetchImpl,
  })
  assert.equal(first.stateHashPersisted, true)
  assert.equal(first.rawStatePersisted, false)
  assert.equal(first.tokenGenerated, false)
  assert.deepEqual(first.authorizationPreflight, {
    rootCause: "STILL_UNPROVEN",
    liveAccepted: true,
    scopeEncoding: "RFC3986_PERCENT20",
    stateAccepted: true,
    scopeContractExact: true,
    positiveInvariantsPassed: true,
    runtimeCredentialMatch: true,
  })
  assert.equal(preflight.requests.length, 6)
  assert.equal(ledger.rows.size, 1)
  assert.deepEqual([...ledger.rows.keys()], [hashEbaySellerOAuthReauthState(STATE)])
  assert.doesNotMatch(JSON.stringify([...ledger.rows.values()]), /private|token|code/i)
  await assert.rejects(prepareEbaySellerOAuthReauthStart({
    configuration,
    actorUserId: ADMIN_ID,
    ledger,
    clock: () => now,
    stateFactory: () => STATE,
    diagnosticStateFactory: () => SECOND_STATE,
    fetchImpl: preflight.fetchImpl,
  }), /STATE_COLLISION/)
  assert.equal(preflight.requests.length, 12)
})

test("same state with different concurrent codes permits one claim/exchange/handoff", async () => {
  const ledger = new AtomicMemoryLedger()
  const stateHash = hashEbaySellerOAuthReauthState(STATE)
  ledger.rows.set(stateHash, {
    status: "PENDING",
    expiresAt: ledger.now + 300_000,
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
    claimedAt: null,
  })
  let release
  ledger.releaseClaims = new Promise((resolve) => { release = resolve })
  let oauthExchangeAttemptCount = 0
  const callback = (code) => claimAndVerifyEbaySellerOAuthReauth({
    callback: { kind: "CODE", state: STATE, code },
    stateHash,
    ledger,
    verifyCandidate: async () => {
      oauthExchangeAttemptCount += 1
      return fakeVerification()
    },
  })
  const pending = [callback("CODE_A"), callback("CODE_B")]
  release()
  const results = await Promise.all(pending)
  assert.equal(results.filter((result) => result.claimSucceeded).length, 1)
  assert.equal(results.filter((result) => result.kind === "HANDOFF").length, 1)
  assert.equal(results.filter((result) => result.kind === "DENIED").length, 1)
  assert.equal(oauthExchangeAttemptCount, 1)
  assert.equal(ledger.rows.get(stateHash).status, "CLAIMED")
})

test("one hundred concurrent callbacks still permit one exchange and handoff", async () => {
  const ledger = new AtomicMemoryLedger()
  const stateHash = hashEbaySellerOAuthReauthState(STATE)
  ledger.rows.set(stateHash, {
    status: "PENDING",
    expiresAt: ledger.now + 300_000,
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
    claimedAt: null,
  })
  let release
  ledger.releaseClaims = new Promise((resolve) => { release = resolve })
  let exchanges = 0
  const callbacks = Array.from({ length: 100 }, (_, index) =>
    claimAndVerifyEbaySellerOAuthReauth({
      callback: { kind: "CODE", state: STATE, code: `CODE_${index}` },
      stateHash,
      ledger,
      verifyCandidate: async () => {
        exchanges += 1
        return fakeVerification()
      },
    }))
  release()
  const results = await Promise.all(callbacks)
  assert.equal(results.filter((result) => result.kind === "HANDOFF").length, 1)
  assert.equal(results.filter((result) => result.kind === "DENIED").length, 99)
  assert.equal(exchanges, 1)
})

test("same/different code replay, refresh and Back-style replay remain terminal", async () => {
  for (const replayCode of ["CODE_A", "CODE_B", "CODE_A"]) {
    const ledger = new AtomicMemoryLedger()
    const stateHash = hashEbaySellerOAuthReauthState(STATE)
    ledger.rows.set(stateHash, {
      status: "PENDING",
      expiresAt: ledger.now + 300_000,
      flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
      claimedAt: null,
    })
    let exchanges = 0
    const verifier = async () => {
      exchanges += 1
      return fakeVerification()
    }
    const first = await claimAndVerifyEbaySellerOAuthReauth({
      callback: { kind: "CODE", state: STATE, code: "CODE_A" },
      stateHash,
      ledger,
      verifyCandidate: verifier,
    })
    const replay = await claimAndVerifyEbaySellerOAuthReauth({
      callback: { kind: "CODE", state: STATE, code: replayCode },
      stateHash,
      ledger,
      verifyCandidate: verifier,
    })
    assert.equal(first.kind, "HANDOFF")
    assert.equal(replay.kind, "DENIED")
    assert.equal(exchanges, 1)
    assert.equal(ledger.rows.get(stateHash).status, "CLAIMED")
  }
})

test("expired/missing/claimed rows and database failure perform zero exchanges", async () => {
  const stateHash = hashEbaySellerOAuthReauthState(STATE)
  for (const row of [
    null,
    {
      status: "PENDING",
      expiresAt: Date.now() - 1,
      flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
      claimedAt: null,
    },
    {
      status: "CLAIMED",
      expiresAt: Date.now() + 300_000,
      flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
      claimedAt: Date.now(),
    },
  ]) {
    const ledger = new AtomicMemoryLedger()
    if (row) ledger.rows.set(stateHash, row)
    let exchanges = 0
    const result = await claimAndVerifyEbaySellerOAuthReauth({
      callback: { kind: "CODE", state: STATE, code: "CODE" },
      stateHash,
      ledger,
      verifyCandidate: async () => {
        exchanges += 1
        return fakeVerification()
      },
    })
    assert.equal(result.kind, "DENIED")
    assert.equal(exchanges, 0)
  }
  let exchanges = 0
  await assert.rejects(claimAndVerifyEbaySellerOAuthReauth({
    callback: { kind: "CODE", state: STATE, code: "CODE" },
    stateHash,
    ledger: {
      createPending: async () => true,
      claimPending: async () => { throw new Error("LEDGER_PRIVATE_FAILURE") },
    },
    verifyCandidate: async () => {
      exchanges += 1
      return fakeVerification()
    },
  }), /LEDGER_PRIVATE_FAILURE/)
  assert.equal(exchanges, 0)
})

test("a stalled atomic claim times out without ever starting OAuth", async () => {
  let releaseClaim
  const delayedClaim = new Promise((resolve) => { releaseClaim = resolve })
  let exchanges = 0
  await assert.rejects(claimAndVerifyEbaySellerOAuthReauth({
    callback: { kind: "CODE", state: STATE, code: "CODE" },
    stateHash: hashEbaySellerOAuthReauthState(STATE),
    ledger: {
      createPending: async () => true,
      claimPending: async () => delayedClaim,
    },
    ledgerTimeoutMs: 5,
    verifyCandidate: async () => {
      exchanges += 1
      return fakeVerification()
    },
  }), /LEDGER_TIMEOUT/)
  releaseClaim(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(exchanges, 0)
})

test("failure after CLAIMED never rearms and requires a new state", async () => {
  for (const failure of ["PROCESS_CRASH_AFTER_CLAIM", "TOKEN_NETWORK_FAILURE"] ) {
    const ledger = new AtomicMemoryLedger()
    const stateHash = hashEbaySellerOAuthReauthState(STATE)
    ledger.rows.set(stateHash, {
      status: "PENDING",
      expiresAt: ledger.now + 300_000,
      flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
      claimedAt: null,
    })
    await assert.rejects(claimAndVerifyEbaySellerOAuthReauth({
      callback: { kind: "CODE", state: STATE, code: "CODE" },
      stateHash,
      ledger,
      verifyCandidate: async () => { throw new Error(failure) },
    }), new RegExp(failure))
    assert.equal(ledger.rows.get(stateHash).status, "CLAIMED")
    const replay = await claimAndVerifyEbaySellerOAuthReauth({
      callback: { kind: "CODE", state: STATE, code: "OTHER_CODE" },
      stateHash,
      ledger,
      verifyCandidate: async () => fakeVerification(),
    })
    assert.equal(replay.kind, "DENIED")
  }
})

test("candidate-only verifier uses exact union and six bounded read-only calls", async () => {
  const fake = successfulCandidateFetch()
  const result = await verifyEbaySellerOAuthReauthCandidate({
    authorizationCode: PRIVATE_CODE,
    configuration,
    callbackStartedAt: Date.now(),
    fetchImpl: fake.fetchImpl,
  })
  assert.equal(result.refreshToken, PRIVATE_REFRESH)
  assert.equal(result.credentialSource, "NEW_OAUTH_CANDIDATE_ONLY")
  assert.equal(result.genericEnvironmentTokenFallback, false)
  assert.equal(result.calls.length, EBAY_SELLER_OAUTH_REAUTH_MAX_EXTERNAL_READ_CALLS)
  assert.deepEqual(result.capabilities, {
    tradingBase: "AVAILABLE",
    inventoryReadonly: "AVAILABLE",
    analyticsReadonly: "AVAILABLE",
    accountReadonly: "AVAILABLE",
  })
  assert.deepEqual(result.endpointHealth, {
    analytics: { status: "HEALTHY", httpStatus: 200 },
  })
  assert.equal(fake.requests.length, 6)
  assert.equal(fake.requests.filter((request) => request.init.method === "GET").length, 3)
  assert.equal(fake.requests.filter((request) => request.url.pathname === "/ws/api.dll").length, 1)
  assert.equal(fake.requests.some((request) =>
    String(request.init.body ?? "").includes(OLD_ENV_REFRESH)), false)
  assert.equal(fake.requests.some((request) =>
    /fulfillment|marketing/.test(String(request.init.body ?? ""))), false)
  assert.equal(Object.values(result.safety).every((value) =>
    value === false || value === 0), true)
})

test("installed runtime verifier uses only generic env token and five read-only calls", async () => {
  const previous = process.env.EBAY_SELLER_REFRESH_TOKEN
  process.env.EBAY_SELLER_REFRESH_TOKEN = PRIVATE_REFRESH
  try {
    const fake = successfulCandidateFetch()
    const result = await certifyInstalledEbaySellerOAuthRuntime({
      configuration,
      startedAt: Date.now(),
      fetchImpl: fake.fetchImpl,
    })
    assert.equal(result.credentialSource, "GENERIC_ENV_TOKEN_ONLY")
    assert.equal(result.genericEnvironmentTokenFallback, false)
    assert.equal(result.refreshTokenPresent, true)
    assert.equal(result.oauthRefreshExchange, "AVAILABLE")
    assert.deepEqual(result.capabilities, {
      tradingBase: "AVAILABLE",
      inventoryReadonly: "AVAILABLE",
      analyticsReadonly: "AVAILABLE",
      accountReadonly: "AVAILABLE",
    })
    assert.deepEqual(result.endpointHealth, {
      analytics: { status: "HEALTHY", httpStatus: 200 },
    })
    assert.equal(result.calls.length, 5)
    assert.equal(fake.requests.length, 5)
    assert.equal(fake.requests.some((request) =>
      request.body?.get("grant_type") === "authorization_code"), false)
    assert.equal(fake.requests.filter((request) =>
      request.body?.get("grant_type") === "refresh_token").length, 1)
    assert.equal(fake.requests[0].body?.get("refresh_token"), PRIVATE_REFRESH)
    assert.equal(fake.requests[0].body?.get("scope"),
      EBAY_SELLER_OAUTH_REAUTH_SCOPES.join(" "))
    assert.equal(Object.values(result.safety).every((value) =>
      value === false || value === 0), true)
    const serialized = JSON.stringify(result)
    assert.doesNotMatch(serialized, new RegExp(PRIVATE_REFRESH))
    assert.doesNotMatch(serialized, new RegExp(PRIVATE_ACCESS))
    assert.doesNotMatch(serialized, new RegExp(PRIVATE_CODE.replaceAll("%", "")))
    assert.doesNotMatch(serialized, /cookie|ledgerRows/i)
  } finally {
    if (previous === undefined) delete process.env.EBAY_SELLER_REFRESH_TOKEN
    else process.env.EBAY_SELLER_REFRESH_TOKEN = previous
  }
})

test("installed runtime verifier missing token fails before every external call", async () => {
  const previous = process.env.EBAY_SELLER_REFRESH_TOKEN
  delete process.env.EBAY_SELLER_REFRESH_TOKEN
  let fetchCalls = 0
  try {
    await assert.rejects(certifyInstalledEbaySellerOAuthRuntime({
      configuration,
      startedAt: Date.now(),
      fetchImpl: async () => {
        fetchCalls += 1
        throw new Error("FETCH_MUST_NOT_RUN")
      },
    }), /INSTALLED_REFRESH_TOKEN_MISSING/)
    assert.equal(fetchCalls, 0)
  } finally {
    if (previous === undefined) delete process.env.EBAY_SELLER_REFRESH_TOKEN
    else process.env.EBAY_SELLER_REFRESH_TOKEN = previous
  }
})

test("installed runtime verifier honors the request-level terminal reserve", async () => {
  const previous = process.env.EBAY_SELLER_REFRESH_TOKEN
  process.env.EBAY_SELLER_REFRESH_TOKEN = PRIVATE_REFRESH
  let fetchCalls = 0
  try {
    await assert.rejects(certifyInstalledEbaySellerOAuthRuntime({
      configuration,
      startedAt: 1_000,
      clock: () => 30_000,
      fetchImpl: async () => {
        fetchCalls += 1
        throw new Error("FETCH_MUST_NOT_RUN")
      },
    }), /TIME_BUDGET_EXHAUSTED/)
    assert.equal(fetchCalls, 0)
  } finally {
    if (previous === undefined) delete process.env.EBAY_SELLER_REFRESH_TOKEN
    else process.env.EBAY_SELLER_REFRESH_TOKEN = previous
  }
})

test("scope metadata may be absent but extra/missing scope and capability failures deny", async () => {
  const omitted = successfulCandidateFetch({ omitScopes: true })
  const allowed = await verifyEbaySellerOAuthReauthCandidate({
    authorizationCode: PRIVATE_CODE,
    configuration,
    callbackStartedAt: Date.now(),
    fetchImpl: omitted.fetchImpl,
  })
  assert.equal(allowed.capabilities.analyticsReadonly, "AVAILABLE")

  const badScope = successfulCandidateFetch({
    returnedScopes: [
      ...EBAY_SELLER_OAUTH_REAUTH_SCOPES,
      "https://api.ebay.com/oauth/api_scope/sell.marketing",
    ].join(" "),
  })
  await assert.rejects(verifyEbaySellerOAuthReauthCandidate({
    authorizationCode: PRIVATE_CODE,
    configuration,
    callbackStartedAt: Date.now(),
    fetchImpl: badScope.fetchImpl,
  }), /SCOPE_RESPONSE_REJECTED/)

  for (const failProbe of ["inventory", "account"]) {
    const failed = successfulCandidateFetch({ failProbe })
    await assert.rejects(verifyEbaySellerOAuthReauthCandidate({
      authorizationCode: PRIVATE_CODE,
      configuration,
      callbackStartedAt: Date.now(),
      fetchImpl: failed.fetchImpl,
    }), new RegExp(`${failProbe.toUpperCase()}_SCOPE_UNAVAILABLE`))
    const malformed = successfulCandidateFetch({ invalidProbeJson: failProbe })
    await assert.rejects(verifyEbaySellerOAuthReauthCandidate({
      authorizationCode: PRIVATE_CODE,
      configuration,
      callbackStartedAt: Date.now(),
      fetchImpl: malformed.fetchImpl,
    }), new RegExp(`${failProbe.toUpperCase()}_SCOPE_UNAVAILABLE`))
  }
  for (const mismatch of [
    { userId: "different-seller", code: "ACCOUNT_BINDING_MISMATCH" },
    { site: "GERMANY", code: "ACCOUNT_BINDING_MISMATCH" },
  ]) {
    const failed = successfulCandidateFetch(mismatch)
    await assert.rejects(verifyEbaySellerOAuthReauthCandidate({
      authorizationCode: PRIVATE_CODE,
      configuration,
      callbackStartedAt: Date.now(),
      fetchImpl: failed.fetchImpl,
    }), new RegExp(mismatch.code))
  }
})

test("proven scope grant decouples Analytics endpoint health from candidate handoff", async () => {
  const cases = [
    {
      status: 429,
      payload: { errors: [{ message: PRIVATE_DESCRIPTION }] },
      health: "RATE_LIMITED",
    },
    {
      status: 503,
      payload: { errors: [{ message: PRIVATE_DESCRIPTION }] },
      health: "SERVER_UNAVAILABLE",
    },
    {
      status: 403,
      payload: { errors: [{ message: "access denied" }] },
      health: "ACCESS_DENIED",
    },
  ]
  for (const testCase of cases) {
    const fake = successfulCandidateFetch({
      analyticsResponse: () => response(testCase.payload, testCase.status),
    })
    const result = await verifyEbaySellerOAuthReauthCandidate({
      authorizationCode: PRIVATE_CODE,
      configuration,
      callbackStartedAt: Date.now(),
      fetchImpl: fake.fetchImpl,
    })
    assert.equal(result.endpointHealth.analytics.status, testCase.health)
    assert.equal(result.endpointHealth.analytics.httpStatus, testCase.status)
    const analyticsCall = fake.requests.find((request) =>
      request.url.pathname === "/sell/analytics/v1/traffic_report")
    assert.ok(analyticsCall)
    assert.doesNotMatch(JSON.stringify(result), new RegExp(PRIVATE_DESCRIPTION))
    assert.equal(result.refreshToken, PRIVATE_REFRESH)
  }
})

test("installed-token certification records nonblocking Analytics degradation", async () => {
  const previous = process.env.EBAY_SELLER_REFRESH_TOKEN
  process.env.EBAY_SELLER_REFRESH_TOKEN = PRIVATE_REFRESH
  try {
    for (const testCase of [
      { status: 429, health: "RATE_LIMITED" },
      { status: 502, health: "SERVER_UNAVAILABLE" },
    ]) {
      const fake = successfulCandidateFetch({
        analyticsResponse: () => response({}, testCase.status),
      })
      const result = await certifyInstalledEbaySellerOAuthRuntime({
        configuration,
        startedAt: Date.now(),
        fetchImpl: fake.fetchImpl,
      })
      assert.equal(result.endpointHealth.analytics.status, testCase.health)
      assert.equal(result.endpointHealth.analytics.httpStatus, testCase.status)
      assert.equal(result.capabilities.analyticsReadonly, "AVAILABLE")
    }
  } finally {
    if (previous === undefined) delete process.env.EBAY_SELLER_REFRESH_TOKEN
    else process.env.EBAY_SELLER_REFRESH_TOKEN = previous
  }
})

test("Analytics transport degradation does not deny an independently proven grant", async () => {
  const fake = successfulCandidateFetch({
    analyticsResponse: () => { throw new Error("PRIVATE_TRANSPORT_FAILURE") },
  })
  const result = await verifyEbaySellerOAuthReauthCandidate({
    authorizationCode: PRIVATE_CODE,
    configuration,
    callbackStartedAt: Date.now(),
    fetchImpl: fake.fetchImpl,
  })
  assert.deepEqual(result.endpointHealth.analytics, {
    status: "TRANSPORT_DEGRADED",
    httpStatus: null,
  })
  assert.equal(result.refreshToken, PRIVATE_REFRESH)
})

test("unproven exact scope union blocks handoff even when Analytics is only rate limited", () => {
  assert.throws(() => assertEbaySellerOAuthAnalyticsHandoffPolicy({
    exactScopeUnionProven: false,
    endpointHealth: { status: "RATE_LIMITED", httpStatus: 429 },
  }), /SCOPE_GRANT_UNPROVEN/)
})

test("authoritative invalid_scope and insufficient_scope prevent candidate handoff", async () => {
  for (const analyticsResponse of [
    () => response({ error: "invalid_scope" }, 403),
    () => new Response(JSON.stringify({ error: "access_denied" }), {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer error="insufficient_scope"',
      },
    }),
  ]) {
    const ledger = new AtomicMemoryLedger()
    const stateHash = hashEbaySellerOAuthReauthState(STATE)
    ledger.rows.set(stateHash, {
      status: "PENDING",
      expiresAt: ledger.now + 300_000,
      flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
      claimedAt: null,
    })
    const fake = successfulCandidateFetch({ analyticsResponse })
    await assert.rejects(claimAndVerifyEbaySellerOAuthReauth({
      callback: { kind: "CODE", state: STATE, code: PRIVATE_CODE },
      stateHash,
      ledger,
      verifyCandidate: (authorizationCode) =>
        verifyEbaySellerOAuthReauthCandidate({
          authorizationCode,
          configuration,
          callbackStartedAt: Date.now(),
          fetchImpl: fake.fetchImpl,
        }),
    }), /ANALYTICS_SCOPE_UNAVAILABLE/)
    assert.equal(ledger.rows.get(stateHash).status, "CLAIMED")
    assert.equal(fake.requests.filter((request) =>
      request.url.pathname === "/identity/v1/oauth2/token").length, 2)
  }
})

test("candidate GetUser identity evidence is strict, direct and unambiguous", async () => {
  const malformedIdentityPayloads = [
    `<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">` +
      `<Ack>Success</Ack><User><UserID>${USER_ID}</UserID>` +
      `<UserID>different-seller</UserID><Site>US</Site></User></GetUserResponse>`,
    `<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">` +
      `<Ack>Success</Ack><User><UserID>${USER_ID}</UserID>` +
      `<Site>US</Site><Site>Germany</Site></User></GetUserResponse>`,
    `<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">` +
      `<Ack>Success</Ack><User><UserID>${USER_ID}</UserID></User></GetUserResponse>`,
    `<GetUserResponse xmlns="urn:ebay:apis:eBLBaseComponents">` +
      `<Ack>Success</Ack><User><Wrapper><UserID>${USER_ID}</UserID>` +
      `<Site>US</Site></Wrapper></User></GetUserResponse>`,
  ]
  for (const getUserXml of malformedIdentityPayloads) {
    const failed = successfulCandidateFetch({ getUserXml })
    await assert.rejects(verifyEbaySellerOAuthReauthCandidate({
      authorizationCode: PRIVATE_CODE,
      configuration,
      callbackStartedAt: Date.now(),
      fetchImpl: failed.fetchImpl,
    }), /ACCOUNT_BINDING_MISMATCH/)
    assert.equal(failed.requests.some((request) =>
      request.url.pathname.includes("/inventory/") ||
      request.url.pathname.includes("/analytics/") ||
      request.url.pathname.includes("/account/")), false)
  }
})

test("OAuth and probe failures remain sanitized and claimed verification cannot replay", async () => {
  const fake = successfulCandidateFetch({ codeExchangeFailure: true })
  let serialized = ""
  try {
    await verifyEbaySellerOAuthReauthCandidate({
      authorizationCode: PRIVATE_CODE,
      configuration,
      callbackStartedAt: Date.now(),
      fetchImpl: fake.fetchImpl,
    })
  } catch (cause) {
    serialized = JSON.stringify({
      name: cause?.name,
      message: cause?.message,
    })
  }
  assert.match(serialized, /INVALID_GRANT/)
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_DESCRIPTION))
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_REFRESH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.equal(
    safeEbaySellerOAuthReauthError(new Error("PRIVATE_UPSTREAM_SECRET_SENTINEL")),
    "EBAY_SELLER_OAUTH_REAUTH_FAILED",
  )
})

test("callback budget keeps a terminal reserve and refuses late external work", async () => {
  assert.equal(
    EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS -
      EBAY_SELLER_OAUTH_REAUTH_EXTERNAL_DEADLINE_MS,
    EBAY_SELLER_OAUTH_REAUTH_TERMINAL_RESERVE_MS,
  )
  let fetchCalls = 0
  await assert.rejects(verifyEbaySellerOAuthReauthCandidate({
    authorizationCode: PRIVATE_CODE,
    configuration,
    callbackStartedAt: 0,
    clock: () => EBAY_SELLER_OAUTH_REAUTH_EXTERNAL_DEADLINE_MS - 100,
    fetchImpl: async () => {
      fetchCalls += 1
      return response({})
    },
  }), /TIME_BUDGET_EXHAUSTED/)
  assert.equal(fetchCalls, 0)
})

test("Supabase adapter invokes only exact create/claim RPCs and sanitizes failures", async () => {
  const calls = []
  const ledger = createSupabaseEbaySellerOAuthReauthStateLedger({
    async rpc(name, parameters) {
      calls.push({ name, parameters })
      return { data: true, error: null }
    },
  })
  const stateHash = hashEbaySellerOAuthReauthState(STATE)
  assert.equal(await ledger.createPending({
    stateHash,
    expiresAt: "2026-08-08T20:05:00.000Z",
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  }), true)
  assert.equal(await ledger.claimPending({
    stateHash,
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  }), true)
  assert.deepEqual(calls.map((call) => call.name), [
    "create_ebay_seller_oauth_reauth_state_v1",
    "claim_ebay_seller_oauth_reauth_state_v1",
  ])
  assert.equal(JSON.stringify(calls).includes(STATE), false)
  const failed = createSupabaseEbaySellerOAuthReauthStateLedger({
    async rpc() {
      return { data: null, error: { private: PRIVATE_DESCRIPTION } }
    },
  })
  await assert.rejects(failed.claimPending({
    stateHash,
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  }), /LEDGER_CLAIM_FAILED/)
})

test("migration is hash-only, service-role RPC-only and atomically terminal", () => {
  const sql = readFileSync(new URL(
    "../../supabase/migrations/20260808010000_create_ebay_seller_oauth_reauth_state_ledger.sql",
    import.meta.url,
  ), "utf8")
  const table = sql.match(
    /create table if not exists public\.ebay_seller_oauth_reauth_state_ledger \(([\s\S]*?)\n\);/i,
  )?.[1] ?? ""
  assert.match(table, /state_hash text primary key/i)
  assert.match(table, /status in \('PENDING', 'CLAIMED'\)/)
  const columns = [...table.matchAll(
    /^\s{2}([a-z][a-z0-9_]*)\s+(?:text|timestamptz)\b/gm,
  )].map((match) => match[1])
  assert.deepEqual(columns, [
    "state_hash",
    "status",
    "flow_version",
    "created_at",
    "expires_at",
    "claimed_at",
  ])
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /force row level security/i)
  assert.match(sql, /from anon, authenticated;/i)
  assert.doesNotMatch(sql, /grant .* on table .* to service_role/is)
  assert.match(sql, /auth\.role\(\) is distinct from 'service_role'/)
  assert.match(
    sql,
    /update public\.ebay_seller_oauth_reauth_state_ledger[\s\S]*set status = 'CLAIMED'[\s\S]*where state_hash = p_state_hash[\s\S]*and status = 'PENDING'[\s\S]*and expires_at > statement_timestamp\(\)[\s\S]*returning state_hash into v_claimed_hash;/i,
  )
  assert.doesNotMatch(sql, /set status = 'PENDING'/i)
  assert.match(sql, /created_at < statement_timestamp\(\) - interval '7 days'/)
})

test("temporary route/page isolate generic OAuth and purpose-bind encrypted Commercial handoff", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/monitor/seller-oauth-reauth/route.ts",
    import.meta.url,
  ), "utf8")
  const page = readFileSync(new URL(
    "../../app/admin/ebay/monitor/seller-oauth-reauth/page.tsx",
    import.meta.url,
  ), "utf8")
  const core = readFileSync(new URL(
    "./ebay-seller-oauth-reauth.ts",
    import.meta.url,
  ), "utf8")
  const domain = readFileSync(new URL(
    "./ebay-seller-oauth-reauth-domain.ts",
    import.meta.url,
  ), "utf8")
  const ledger = readFileSync(new URL(
    "./ebay-seller-oauth-reauth-ledger.ts",
    import.meta.url,
  ), "utf8")
  const inventoryCore = readFileSync(new URL(
    "./ebay-commercial-monitor-live-readonly.ts",
    import.meta.url,
  ), "utf8")
  const inventoryDomain = readFileSync(new URL(
    "./ebay-commercial-monitor-live-readonly-domain.ts",
    import.meta.url,
  ), "utf8")
  const registryRepairDryRun = readFileSync(new URL(
    "./ebay-registry-repair-dry-run.ts",
    import.meta.url,
  ), "utf8")
  const runtime = [
    route,
    page,
    core,
    domain,
    ledger,
    inventoryCore,
    inventoryDomain,
  ].join("\n")
  assert.match(route, /export async function POST/)
  assert.match(route, /export async function GET/)
  assert.match(route, /action === "diagnose"/)
  assert.match(route, /action === "compare_runtime_credentials"/)
  assert.match(route, /action === "certify_installed_runtime"/)
  assert.match(route, /action === "diagnose_inventory_consumer"/)
  assert.match(route, /action === "diagnose_registry_coverage_runtime"/)
  assert.match(route, /action === "preview_registry_repair"/)
  assert.match(route, /execute_approved_registry_repair/)
  assert.match(route, /executeApprovedRegistryRepairV1/)
  assert.match(route, /approvedPackageHandle/)
  assert.match(route, /approvedEvidenceFingerprint/)
  assert.match(route,
    /payloadKeys ===\s*"action,approvedEvidenceFingerprint,approvedPackageHandle"/)
  assert.doesNotMatch(route,
    /actionPayload\.(?:itemId|sku|registryRows|createCandidates|staleCandidates|accountKey|marketplaceId)/)
  assert.match(route,
    /error: "REGISTRY_REPAIR_DRY_RUN_REJECTED",\s*REJECTION_REASON: "UNPROVEN"/)
  assert.match(route, /AMBIGUITY_CLASS: "BLOCKING_UNPROVEN"/)
  assert.match(route,
    /REJECTION_REASON: registryRepairDryRun\.DRY_RUN_REJECTION_REASON,\s*AMBIGUITY_CLASS: registryRepairDryRun\.AMBIGUITY_CLASS/)
  assert.match(route,
    /UNPROVEN_COMPONENT: registryRepairDryRun\.UNPROVEN_COMPONENT,\s*UNPROVEN_COUNT: registryRepairDryRun\.UNPROVEN_COUNT/)
  assert.match(route,
    /UNPROVEN_TOTAL_COUNT: registryRepairDryRun\.UNPROVEN_TOTAL_COUNT/)
  assert.match(route,
    /BLOCKING_UNPROVEN_PRIMARY_SOURCE:\s*registryRepairDryRun\.BLOCKING_UNPROVEN_PRIMARY_SOURCE/)
  assert.match(route,
    /BLOCKING_UNPROVEN_SECONDARY_SOURCES:\s*registryRepairDryRun\.BLOCKING_UNPROVEN_SECONDARY_SOURCES/)
  assert.match(route,
    /RAW_UNPROVEN_COUNT: registryRepairDryRun\.RAW_UNPROVEN_COUNT/)
  assert.match(route,
    /UNPROVEN_PRIMARY_REASON:\s*registryRepairDryRun\.UNPROVEN_PRIMARY_REASON/)
  assert.match(route,
    /UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES:\s*registryRepairDryRun\.UNPROVEN_REASON_MULTIPLE_REGISTRY_CANDIDATES/)
  assert.match(route, /OTHER_SUBTYPE_COUNTS: registryRepairDryRun\.OTHER_SUBTYPE_COUNTS/)
  assert.match(route,
    /RAW_CREATE_IDENTITY_CANDIDATE_COUNT:\s*registryRepairDryRun\.RAW_CREATE_IDENTITY_CANDIDATE_COUNT/)
  assert.match(route,
    /CREATE_ABSENCE_CAS_UNPROVEN_COUNT:\s*registryRepairDryRun\.CREATE_ABSENCE_CAS_UNPROVEN_COUNT/)
  assert.match(route,
    /ABSENCE_PROOF_PRIMARY_CAUSE:\s*registryRepairDryRun\.ABSENCE_PROOF_PRIMARY_CAUSE/)
  assert.match(route,
    /LIFECYCLE_UNPROVEN_ACTION:\s*registryRepairDryRun\.LIFECYCLE_UNPROVEN_ACTION/)
  assert.match(route,
    /REPAIR_ROW_CURRENT_STATUS_CLASS:\s*registryRepairDryRun\.REPAIR_ROW_CURRENT_STATUS_CLASS/)
  assert.match(route,
    /REPAIR_ROW_STATUS_REACTIVATABLE:\s*registryRepairDryRun\.REPAIR_ROW_STATUS_REACTIVATABLE/)
  assert.match(route,
    /REACTIVATION_CAS_SUPPORTED:\s*registryRepairDryRun\.REACTIVATION_CAS_SUPPORTED/)
  assert.match(route,
    /HUMAN_REVIEW_WRITE_ALLOWED:\s*registryRepairDryRun\.HUMAN_REVIEW_WRITE_ALLOWED/)
  assert.match(route,
    /HUMAN_REVIEW_MUTATION_COUNT:\s*registryRepairDryRun\.HUMAN_REVIEW_MUTATION_COUNT/)
  assert.match(route,
    /FINAL_REJECTION_REASON: registryRepairDryRun\.FINAL_REJECTION_REASON/)
  assert.match(route,
    /UNPROVEN_COMPONENT: "EVIDENCE_UNAVAILABLE",\s*UNPROVEN_COUNT: "UNPROVEN"/)
  assert.match(route, /BLOCKING_UNPROVEN_PRIMARY_SOURCE: "SOURCE_READ"/)
  assert.match(route, /BLOCKING_UNPROVEN_SECONDARY_SOURCES: \[\]/)
  assert.match(route, /RAW_UNPROVEN_COUNT: "UNPROVEN"/)
  assert.match(route, /UNPROVEN_PRIMARY_REASON: "SOURCE_EVIDENCE"/)
  assert.match(route, /UNPROVEN_REASON_OTHER: "UNPROVEN"/)
  assert.match(route, /OTHER_SUBTYPE_COUNTS: \{/)
  assert.match(route, /LIFECYCLE_REQUIREMENT: "UNPROVEN"/)
  assert.match(route, /CREATE_MATERIALIZATION_STATUS: "UNPROVEN"/)
  assert.match(route, /ABSENCE_PROOF_PRIMARY_CAUSE: "UNPROVEN"/)
  assert.match(route, /LIFECYCLE_FAILURE_CAUSE: "UNPROVEN"/)
  assert.match(route, /REPAIR_ROW_CURRENT_STATUS_CLASS: "UNPROVEN"/)
  assert.match(route, /REPAIR_ROW_STATUS_REACTIVATABLE: "UNPROVEN"/)
  assert.match(route, /REACTIVATION_CAS_SUPPORTED: "UNPROVEN"/)
  assert.match(route, /HUMAN_REVIEW_WRITE_ALLOWED: "UNPROVEN"/)
  assert.match(route, /HUMAN_REVIEW_MUTATION_COUNT: "UNPROVEN"/)
  assert.match(page, /HUMAN REVIEW ITEMS WILL NOT BE MODIFIED/)
  assert.match(page, /ITEM_ID_ONLY_LIFECYCLE/)
  assert.match(page, /HUMAN_REVIEW_REASON_REACTIVATION_NOT_ALLOWED_COUNT/)
  assert.match(page, /const lifecycleReviewIsolated =/)
  assert.match(page, /lifecycleDiagnostic\.action === "NONE"/)
  assert.match(page, /lifecycleDiagnostic\.stage === "NONE"/)
  assert.match(page, /lifecycleDiagnostic\.failureCause === "REACTIVATION_NOT_ALLOWED"/)
  assert.match(page, /!lifecycleReviewIsolated &&/)
  assert.match(page, /function validateRegistryRepairDryRun/)
  assert.match(page, /EVIDENCE_STATUS_INVALID/)
  assert.match(page, /\["AVAILABLE", "UNPROVEN"\]/)
  assert.match(page, /Validator failure code:/)
  assert.match(page, /Repair-row lifecycle diagnostic/)
  assert.match(page, /REPAIR_ROW_STATUS_RAW_VALUE_RECOGNIZED/)
  assert.match(page, /REPAIR_ROW_STATUS_REACTIVATABLE/)
  assert.match(page, /"PAUSED"/)
  assert.match(page, /"DRAFT"/)
  assert.match(page, /"REACTIVATION_NOT_ALLOWED"/)
  assert.match(page, /REPAIR_ROW_ACCOUNT_SCOPE_MATCH/)
  assert.match(page, /REPAIR_ROW_AUTHORITATIVE_ITEM_ID_STILL_LIVE/)
  assert.match(page, /REPAIR_ROW_ITEM_ID_UNIQUE_BOTH_SIDES/)
  assert.match(page, /REPAIR_ROW_COMPETING_RELATIONSHIP/)
  assert.match(page, /REGISTRY_LIFECYCLE_SUPPORTS_REACTIVATION/)
  assert.match(page, /REACTIVATION_ALLOWED_FROM_ENDED/)
  assert.match(route, /FINAL_REJECTION_REASON: "UNPROVEN"/)
  assert.match(route, /action !== "start"/)
  assert.match(route, /maxDuration = 300/)
  const postRoute = route.slice(
    route.indexOf("export async function POST"),
    route.indexOf("export async function GET"),
  )
  assert.ok(postRoute.indexOf("const requestStartedAt = Date.now()") <
    postRoute.indexOf("validateAdminApiRequest(request)"))
  assert.match(postRoute,
    /certifyInstalledEbaySellerOAuthRuntime\(\{\s*configuration,\s*startedAt: requestStartedAt,\s*\}\)/)
  assert.ok(
    route.indexOf("validateAdminApiRequest(request)") <
      route.indexOf("getSupabaseAdminClient()"),
  )
  assert.match(route,
    /const runtimeCredentialMatch =\s*getEbaySellerOAuthReauthRuntimeCredentialMatch\(configuration\)\s*assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified\(\s*runtimeCredentialMatch,\s*\)/)
  const runtimeCredentialGate = route.indexOf(
    "assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(",
    route.indexOf("const runtimeCredentialMatch ="),
  )
  assert.ok(runtimeCredentialGate <
    route.indexOf("diagnoseEbaySellerOAuthReauthAuthorization({"))
  assert.ok(runtimeCredentialGate < route.indexOf("getSupabaseAdminClient()"))
  const installedAction = route.indexOf(
    'action === "certify_installed_runtime"',
  )
  assert.ok(installedAction > runtimeCredentialGate)
  assert.ok(installedAction < route.indexOf("getSupabaseAdminClient()"))
  assert.ok(route.indexOf("certifyInstalledEbaySellerOAuthRuntime({") <
    route.indexOf("getSupabaseAdminClient()"))
  const inventoryConsumerAction = route.indexOf(
    'action === "diagnose_inventory_consumer"',
  )
  assert.ok(inventoryConsumerAction > runtimeCredentialGate)
  assert.ok(inventoryConsumerAction < route.indexOf("getSupabaseAdminClient()"))
  assert.ok(route.indexOf("diagnoseInstalledEbayInventoryConsumer({") <
    route.indexOf("getSupabaseAdminClient()"))
  assert.match(route,
    /diagnoseInstalledEbayInventoryConsumer\(\{\s*startedAt: requestStartedAt,\s*\}\)/)
  const registryCoverageAction = route.indexOf(
    'action === "diagnose_registry_coverage_runtime"',
  )
  assert.ok(registryCoverageAction > runtimeCredentialGate)
  assert.ok(registryCoverageAction < route.indexOf("getSupabaseAdminClient()"))
  assert.ok(route.indexOf("diagnoseRegistryCoverageRuntime({") <
    route.indexOf("getSupabaseAdminClient()"))
  assert.match(route,
    /diagnoseRegistryCoverageRuntime\(\{\s*startedAt: requestStartedAt,\s*fetchImpl,?\s*\}\)/)
  const registryRepairPreviewAction = route.indexOf(
    'action === "preview_registry_repair"',
  )
  assert.ok(registryRepairPreviewAction > runtimeCredentialGate)
  assert.ok(registryRepairPreviewAction < route.indexOf("getSupabaseAdminClient()"))
  assert.ok(route.indexOf("previewEbayRegistryRepairRuntime({") <
    route.indexOf("getSupabaseAdminClient()"))
  assert.match(route,
    /previewEbayRegistryRepairRuntime\(\{\s*startedAt: requestStartedAt,\s*fetchImpl,?\s*\}\)/)
  assert.match(route,
    /prepareEbaySellerOAuthReauthStart\(\{\s*configuration,\s*actorUserId,/)
  const prepareFunction = core.slice(
    core.indexOf("export async function prepareEbaySellerOAuthReauthStart"),
    core.indexOf("export async function verifyEbaySellerOAuthReauthCandidate"),
  )
  assert.doesNotMatch(prepareFunction, /input\.runtimeCredentialMatch/)
  assert.match(prepareFunction,
    /assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified\(\s*getEbaySellerOAuthReauthRuntimeCredentialMatch\(input\.configuration\),\s*\)/)
  const coreCredentialGate = prepareFunction.indexOf(
    "getEbaySellerOAuthReauthRuntimeCredentialMatch(input.configuration)",
  )
  assert.ok(coreCredentialGate >= 0)
  assert.ok(coreCredentialGate < prepareFunction.indexOf(
    "diagnoseEbaySellerOAuthReauthAuthorization({",
  ))
  assert.ok(coreCredentialGate < prepareFunction.indexOf("input.stateFactory"))
  assert.ok(coreCredentialGate < prepareFunction.indexOf("createPending({"))
  const callbackRoute = route.slice(route.indexOf("export async function GET"))
  const callbackCredentialGate = callbackRoute.indexOf(
    "assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(",
  )
  const callbackParser = callbackRoute.indexOf(
    "parseEbaySellerOAuthReauthCallbackUrl(request.url)",
  )
  const callbackCookieRead = callbackRoute.indexOf("request.cookies.getAll")
  const callbackCookieVerification = callbackRoute.indexOf(
    "verifyEbaySellerOAuthReauthCookie({",
  )
  const callbackLedger = callbackRoute.indexOf("getSupabaseAdminClient()")
  const callbackClaim = callbackRoute.indexOf(
    "claimAndVerifyEbaySellerOAuthReauth({",
  )
  assert.ok(callbackCredentialGate >= 0)
  assert.ok(callbackCredentialGate < callbackParser)
  assert.ok(callbackParser < callbackCookieRead)
  assert.ok(callbackCookieRead < callbackCookieVerification)
  assert.ok(callbackCookieVerification < callbackLedger)
  assert.ok(callbackLedger < callbackClaim)
  const claimFunction = core.slice(
    core.indexOf("export async function claimAndVerifyEbaySellerOAuthReauth"),
  )
  assert.ok(claimFunction.indexOf("input.ledger.claimPending({") <
    claimFunction.indexOf("input.verifyCandidate(input.callback.code)"))
  assert.match(route, /"Referrer-Policy": "no-referrer"/)
  assert.match(route, /callbackHtml\(result\.code/)
  assert.match(route, /ebaySellerOAuthReauthCookieOptions\(0\)/)
  assert.equal((route.match(/ebaySellerOAuthReauthCookieOptions\(0\)/g) ?? []).length, 4)
  assert.match(route, /renderEbaySellerOAuthReauthSuccessHtml/)
  assert.match(route, /hasPendingEbayCommercialOrdersAuthorization/)
  assert.match(route, /completeEbayCommercialOrdersAuthorization/)
  assert.match(route, /encrypted one-time handoff/)
  assert.doesNotMatch(route, /NextResponse\.json\([^)]*refreshToken/s)
  const candidateVerifier = core.slice(
    core.indexOf("export async function verifyEbaySellerOAuthReauthCandidate"),
    core.indexOf("export async function certifyInstalledEbaySellerOAuthRuntime"),
  )
  const installedVerifier = core.slice(
    core.indexOf("export async function certifyInstalledEbaySellerOAuthRuntime"),
    core.indexOf("export type EbaySellerOAuthReauthClaimResult"),
  )
  assert.doesNotMatch(candidateVerifier, /EBAY_SELLER_REFRESH_TOKEN|process\.env/)
  assert.match(installedVerifier,
    /process\.env\.EBAY_SELLER_REFRESH_TOKEN/)
  assert.doesNotMatch(installedVerifier,
    /input\.(?:refreshToken|environment|authorizationCode)|createPending|claimPending/)
  assert.ok(
    core.indexOf("await diagnoseEbaySellerOAuthReauthAuthorization") <
      core.indexOf("const state = (input.stateFactory"),
  )
  assert.ok(
    core.indexOf("await diagnoseEbaySellerOAuthReauthAuthorization") <
      core.indexOf("input.ledger.createPending"),
  )
  const prepareStart = core.indexOf(
    "export async function prepareEbaySellerOAuthReauthStart",
  )
  const prepareCore = core.slice(prepareStart,
    core.indexOf("export async function verifyEbaySellerOAuthReauthCandidate"))
  assert.ok(prepareCore.indexOf(
    "assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(",
  ) < prepareCore.indexOf("await diagnoseEbaySellerOAuthReauthAuthorization"))
  assert.ok(prepareCore.indexOf(
    "assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(",
  ) < prepareCore.indexOf("input.ledger.createPending"))
  assert.doesNotMatch(core,
    /startAllowed:\s*canonicalAccepted\s*&&\s*rootCause/)
  assert.match(core,
    /isEbaySellerOAuthReauthAuthorizationStartAllowed\(diagnosis\)/)
  assert.match(core, /redirect: "manual"/)
  assert.match(core, /credentials: "omit"/)
  assert.match(core, /referrerPolicy: "no-referrer"/)
  assert.doesNotMatch(runtime, /console\.|telemetry|analytics\.track/i)
  assert.doesNotMatch([page, core, domain, ledger].join("\n"),
    /commercial-orders-oauth|account-policy-oauth-authorization/)
  assert.doesNotMatch(runtime, /from\s+["'][^"']*(?:vault|account-policy-oauth)/i)
  assert.doesNotMatch(runtime, /\.(?:insert|upsert|delete)\s*\(/i)
  assert.doesNotMatch(runtime, /ReviseItem|EndItem|AddItem|publishOffer|createShippingFulfillment|WhatsApp/)
  assert.doesNotMatch(registryRepairDryRun,
    /\.from\s*\(\s*["']|\.(?:insert|upsert|rpc)\s*\(|\bfetch\s*\(|getSupabaseAdminClient|\b(?:delete from|update public)\b/i)
  assert.match(page, /method: "POST"/)
  assert.match(page, /action: "diagnose"/)
  assert.match(page, /action: "compare_runtime_credentials"/)
  assert.match(page, /action: "certify_installed_runtime"/)
  assert.match(page, /action: "diagnose_inventory_consumer"/)
  assert.match(page, /action: "preview_registry_repair"/)
  assert.match(page, /action: "execute_approved_registry_repair"/)
  assert.match(page, /Execute approved Registry repair/)
  assert.match(page, /HUMAN REVIEW ITEMS WILL NOT BE MODIFIED/)
  assert.match(page, /validRegistryRepairExecutionResult/)
  const registryRepairExecution = page.slice(
    page.indexOf("async function executeApprovedRegistryRepair()"),
    page.indexOf("async function begin()"),
  )
  assert.match(registryRepairExecution, /approvedPackageHandle:/)
  assert.match(registryRepairExecution, /approvedEvidenceFingerprint:/)
  assert.doesNotMatch(registryRepairExecution,
    /itemId|sku|registryRows|createCandidates|staleCandidates|rpcInput/)
  assert.match(page, /Preview Registry repair/)
  assert.match(page, /DRY RUN — NO CHANGES WILL BE APPLIED/)
  assert.match(page, /CURRENT_LIVE_COUNT/)
  assert.match(page, /CURRENT_REGISTRY_COUNT/)
  assert.match(page, /CURRENT_EVIDENCE_FINGERPRINT/)
  assert.match(page, /DRY_RUN_FRESHNESS_STATUS/)
  assert.match(page, /DRY_RUN_STATE_BOUND/)
  assert.match(page, /DRY_RUN_STATE_FINGERPRINT_PRESENT/)
  assert.match(page, /APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE/)
  assert.match(page, /APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE/)
  assert.match(page, /DRY RUN STALE — REFRESH REQUIRED/)
  assert.match(page, /Current action groups from this live recheck/)
  assert.match(page, /DRY_RUN_REJECTION_REASON/)
  assert.match(page, /Rejection reason: \{registryRepairDryRunRejectionReason\}/)
  assert.match(page, /AMBIGUITY_CLASS/)
  assert.match(page, /Ambiguity class: \{registryRepairDryRunAmbiguityClass\}/)
  assert.match(page, /Unproven component: \{registryRepairUnprovenComponent\}/)
  assert.match(page, /Action guard \/ precondition diagnostics/)
  assert.match(page, /Phase 1 unproven aggregate aliases/)
  assert.match(page, /UNPROVEN_TOTAL_COUNT/)
  assert.match(page, /UNPROVEN_STATE_GUARD_COUNT/)
  assert.match(page, /UNPROVEN_SOURCE_READ_COUNT/)
  assert.match(page, /BLOCKING_UNPROVEN_PRIMARY_SOURCE/)
  assert.match(page, /BLOCKING_UNPROVEN_SECONDARY_SOURCES/)
  assert.match(page, /Raw pre-gate partitions · diagnostic only/)
  assert.match(page, /These raw counts do not replace certified action counts/)
  assert.match(page, /RAW_UNPROVEN_COUNT/)
  assert.match(page, /UNPROVEN_PRIMARY_REASON/)
  assert.match(page, /UNPROVEN_REASON_MISSING_AUTHORITATIVE_ITEM_ID/)
  assert.match(page, /Create identity → materialization → absence-CAS gates/)
  assert.match(page, /OTHER unproven subtype counts/)
  assert.match(page, /CREATE_NEW_MATERIALIZATION/)
  assert.match(page, /CREATE_MATERIALIZATION/)
  assert.match(page, /CREATE_ABSENCE_CAS_UNPROVEN_COUNT/)
  assert.match(page, /LIFECYCLE_PRECONDITION/)
  assert.match(page, /Absence-proof cause counts/)
  assert.match(page, /Lifecycle precondition diagnostic/)
  assert.match(page, /Final identity vs precondition taxonomy/)
  assert.match(page, /FINAL_IDENTITY_UNPROVEN_COUNT/)
  assert.match(page, /FINAL_PRECONDITION_UNPROVEN_COUNT/)
  for (const cause of [
    "ITEM_ID_ALREADY_PRESENT",
    "ITEM_ID_LOOKUP_UNPROVEN",
    "SKU_RELATION",
    "SYNC_KEY_COLLISION",
    "ACCOUNT_SCOPE",
    "MULTIPLE_REGISTRY_ROWS",
    "SECOND_READ_INCONSISTENCY",
    "OTHER",
    "UNPROVEN",
  ]) assert.match(page, new RegExp(cause))
  assert.doesNotMatch(page, /numericOtherSubtypeSum/)
  assert.match(page, /createIdentityPartitionConsistent/)
  assert.match(page, /createMaterializationPartitionConsistent/)
  assert.match(page, /createAbsenceCasPartitionConsistent/)
  for (const subtype of [
    "LISTING_IDENTITY_SHAPE",
    "CREATE_PAYLOAD_REQUIREMENT",
    "REGISTRY_ABSENCE_PROOF",
    "LIFECYCLE_REQUIREMENT",
    "NORMALIZATION_FAILURE",
    "UNEXPECTED_CLASSIFIER_BRANCH",
  ]) assert.match(page, new RegExp(subtype))
  for (const reason of [
    "NONE",
    "MISSING_AUTHORITATIVE_ITEM_ID",
    "DUPLICATE_ITEM_ID",
    "MULTIPLE_REGISTRY_CANDIDATES",
    "CROSS_LINK_CONFLICT",
    "ACCOUNT_SCOPE",
    "PARTITION_OVERLAP",
    "SOURCE_EVIDENCE",
    "OTHER",
  ]) assert.match(page, new RegExp(reason))
  for (const source of [
    "NONE",
    "SOURCE_READ",
    "STATE_GUARD",
    "IDENTITY_PARTITION",
    "REPAIR_EXISTING",
    "MARK_STALE",
    "CREATE_NEW",
    "HUMAN_REVIEW",
    "OTHER",
  ]) assert.match(page, new RegExp(source))
  for (const reason of [
    "REGISTRY_SOURCE_UNAVAILABLE",
    "LIVE_ENUMERATION_UNAVAILABLE",
    "ACCOUNT_BINDING_FAILED",
    "IDENTITY_PARTITION_INVALID",
    "REGISTRY_PARTITION_INVALID",
    "AMBIGUOUS_IDENTITY",
    "PRECONDITION_UNPROVEN",
    "STATE_CHANGED_DURING_SAME_REQUEST",
    "RESPONSE_CONTRACT_INVALID",
    "BUDGET_EXHAUSTED",
    "UNPROVEN",
  ]) assert.match(page, new RegExp(reason))
  for (const ambiguityClass of [
    "REVIEWABLE_ONLY",
    "BLOCKING_MULTIPLE_CANDIDATES",
    "BLOCKING_CROSS_LINK",
    "BLOCKING_DUPLICATE_AUTHORITY",
    "BLOCKING_PARTITION_CONFLICT",
    "BLOCKING_UNPROVEN",
    "NONE",
  ]) assert.match(page, new RegExp(ambiguityClass))
  for (const component of [
    "NONE",
    "REPAIR_EXISTING_MUTATION_GUARD",
    "MARK_STALE_MUTATION_GUARD",
    "CREATE_NEW_ABSENCE_OR_UNIQUENESS_GUARD",
    "HUMAN_REVIEW_EVIDENCE",
    "IDENTITY_PARTITION",
    "SAME_REQUEST_STATE",
    "MULTIPLE_COMPONENTS",
    "EVIDENCE_UNAVAILABLE",
  ]) assert.match(page, new RegExp(component))
  assert.doesNotMatch(page, /SAME_REQUEST_EVIDENCE_INCOHERENT/)
  const registryRepairPreview = page.slice(
    page.indexOf("async function previewRegistryRepair()"),
    page.indexOf("async function begin()"),
  )
  assert.doesNotMatch(registryRepairPreview, /reviewedEvidenceFingerprint/)
  assert.match(registryRepairPreview,
    /setError\("REGISTRY_REPAIR_DRY_RUN_REJECTED"\)/)
  assert.match(registryRepairPreview, /payload\.REJECTION_REASON/)
  assert.doesNotMatch(registryRepairPreview, /payload\.error|cause\.message/)
  assert.doesNotMatch(page, />\s*(?:Apply|Confirm Write|Confirmar escritura)\s*</i)
  assert.match(page, /action: "start"/)
  const beginStart = page.indexOf("async function begin()")
  const beginFunction = page.slice(
    beginStart,
    page.indexOf("  return (", beginStart),
  )
  assert.match(beginFunction, /runtimeCredentialMatchAllowsStart\(credentialMatch\)/)
  assert.match(beginFunction, /diagnosisAllowsStart\(diagnosis\)/)
  assert.doesNotMatch(beginFunction, /rootCause\s*!==\s*"URL_SERIALIZATION"/)
  assert.doesNotMatch(page, /diagnosis\.rootCause\s*!==\s*"URL_SERIALIZATION"/)
  assert.match(page, /payload\.success !== true/)
  assert.match(page, /validInventoryConsumerDiagnostic/)
  assert.match(inventoryCore,
    /credentialSource: "GENERIC_ENV_TOKEN_ONLY"/)
  const installedInventoryDiagnostic = inventoryCore.slice(
    inventoryCore.indexOf(
      "export async function diagnoseInstalledEbayInventoryConsumer",
    ),
    inventoryCore.indexOf(
      "export async function getEbayCommercialMonitorLiveReadonly",
    ),
  )
  assert.match(installedInventoryDiagnostic,
    /generalCredentials\(environment\)/)
  assert.doesNotMatch(installedInventoryDiagnostic,
    /input\.(?:refreshToken|accessToken|authorization)|EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN|(?:from|import|read|get)[A-Za-z0-9_]*Vault|createPending|claimPending/i)
  assert.match(installedInventoryDiagnostic,
    /maximumExternalCalls: 8/)
  assert.match(installedInventoryDiagnostic,
    /input:\s*\{\s*fetchImpl\?: FetchLike\s*clock\?: Clock\s*startedAt\?: number\s*\}/)
  const publicInventoryDiagnostic = installedInventoryDiagnostic.slice(
    0,
    installedInventoryDiagnostic.indexOf("async function probeVariant"),
  )
  assert.doesNotMatch(publicInventoryDiagnostic,
    /input\.(?:environment|scopes|includeFourScopeControl|headers|query|marketplaceHeader)/)
  const inventoryMatrixOperations = [
    "INVENTORY_GET_ITEMS_MATRIX_A",
    "INVENTORY_GET_ITEMS_MATRIX_B",
    "INVENTORY_GET_ITEMS_MATRIX_C",
    "INVENTORY_GET_ITEMS_MATRIX_D",
  ]
  for (const operation of inventoryMatrixOperations) {
    assert.match(installedInventoryDiagnostic, new RegExp(operation))
    assert.match(page, new RegExp(operation))
    assert.match(inventoryDomain, new RegExp(operation))
  }
  const subsetRefresh = installedInventoryDiagnostic.indexOf(
    'operation: "OAUTH_REFRESH_INVENTORY"',
  )
  const boundGetUser = installedInventoryDiagnostic.indexOf(
    "const account = await verifyAccount({",
  )
  const variantA = installedInventoryDiagnostic.indexOf(
    'operation: "INVENTORY_GET_ITEMS_MATRIX_A"',
  )
  const variantB = installedInventoryDiagnostic.indexOf(
    'operation: "INVENTORY_GET_ITEMS_MATRIX_B"',
  )
  const variantC = installedInventoryDiagnostic.indexOf(
    'operation: "INVENTORY_GET_ITEMS_MATRIX_C"',
  )
  const variantD = installedInventoryDiagnostic.indexOf(
    'operation: "INVENTORY_GET_ITEMS_MATRIX_D"',
  )
  const allSubset400 = installedInventoryDiagnostic.indexOf(
    ".every((variant) => variant.httpStatus === 400)",
  )
  const fourScopeRefresh = installedInventoryDiagnostic.indexOf(
    'operation: "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE"',
  )
  const fourScopeControl = installedInventoryDiagnostic.indexOf(
    'operation: "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL"',
  )
  assert.ok(subsetRefresh >= 0 && subsetRefresh < boundGetUser)
  assert.ok(boundGetUser < variantA && variantA < variantB)
  assert.ok(variantB < variantC && variantC < variantD)
  assert.ok(variantD < allSubset400 && allSubset400 < fourScopeRefresh)
  assert.ok(fourScopeRefresh < fourScopeControl)
  assert.match(installedInventoryDiagnostic,
    /\[currentCanonical, noMarketplaceHeader, limitOnly, noQuery\]\s*\.every\(\(variant\) => variant\.httpStatus === 400\)/)
  assert.match(installedInventoryDiagnostic,
    /controlBudget\.callsRemaining < 2/)
  assert.match(installedInventoryDiagnostic,
    /controlBudget\.deadlineAt - Date\.now\(\) < REQUEST_TIMEOUT_MS \* 2/)
  assert.match(installedInventoryDiagnostic,
    /fourScopeToken = fourScopeMinted\.value/)
  assert.match(installedInventoryDiagnostic,
    /token: fourScopeToken,[\s\S]*operation: "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL"|operation: "INVENTORY_GET_ITEMS_FOUR_SCOPE_CONTROL",[\s\S]*token: fourScopeToken/)
  assert.match(inventoryCore,
    /const INVENTORY_CONSUMER_DIAGNOSTIC_MAX_CALLS = 8/)
  assert.match(inventoryCore,
    /const INVENTORY_CONSUMER_DIAGNOSTIC_DEADLINE_MS = 21_000/)
  assert.match(inventoryCore, /function assertExactReadonlyRefreshScopes/)
  const exactFourScopeContract = inventoryCore.slice(
    inventoryCore.indexOf(
      ': input.operation === "OAUTH_REFRESH_INVENTORY_FOUR_SCOPE"',
    ),
    inventoryCore.indexOf(
      ': input.operation === "OAUTH_REFRESH_ANALYTICS"',
    ),
  )
  assert.match(exactFourScopeContract, /BASE_SCOPE/)
  assert.match(exactFourScopeContract, /ACCOUNT_READONLY_SCOPE/)
  assert.match(exactFourScopeContract, /INVENTORY_READONLY_SCOPE/)
  assert.match(exactFourScopeContract, /ANALYTICS_READONLY_SCOPE/)
  assert.doesNotMatch(exactFourScopeContract,
    /FULFILLMENT_READONLY_SCOPE|marketing|\.write/i)
  assert.match(inventoryDomain,
    /INVENTORY_GET_ITEMS_MATRIX_A[\s\S]*url\.searchParams\.get\("offset"\) !== "0"/)
  assert.match(inventoryDomain,
    /INVENTORY_GET_ITEMS_MATRIX_B[\s\S]*requestHeaderNames\.join\(","\) !== "authorization"/)
  assert.match(inventoryDomain,
    /INVENTORY_GET_ITEMS_MATRIX_C[\s\S]*url\.searchParams\.get\("limit"\) !== "50"/)
  assert.match(inventoryDomain,
    /INVENTORY_GET_ITEMS_MATRIX_D[\s\S]*\[\.\.\.url\.searchParams\.keys\(\)\]\.length !== 0/)
  const boundedErrorReader = inventoryCore.slice(
    inventoryCore.indexOf(
      "async function readBoundedInventoryErrorMetadata",
    ),
    inventoryCore.indexOf(
      "export async function diagnoseInstalledEbayInventoryConsumer",
    ),
  )
  assert.match(boundedErrorReader,
    /INVENTORY_CONSUMER_ERROR_BODY_MAX_BYTES/)
  assert.match(boundedErrorReader, /new TextDecoder\("utf-8", \{ fatal: true \}\)/)
  assert.match(boundedErrorReader,
    /parseSafeEbayInventoryErrorMetadata\(JSON\.parse\(body\)/)
  const safeErrorParser = inventoryDomain.slice(
    inventoryDomain.indexOf(
      "export function parseSafeEbayInventoryErrorMetadata",
    ),
    inventoryDomain.indexOf("function exactInventoryPageLink"),
  )
  assert.match(safeErrorParser, /errorObjectCount: rawErrors\.length/)
  assert.match(safeErrorParser, /errorIds: \[\.\.\.new Set\(errorIds\)\]\.sort\(\)/)
  assert.match(safeErrorParser, /domains: \[\.\.\.new Set\(domains\)\]\.sort\(\)/)
  assert.match(safeErrorParser, /categories: \[\.\.\.new Set\(categories\)\]\.sort\(\)/)
  assert.match(safeErrorParser,
    /parameterNames: \[\.\.\.new Set\(parameterNames\)\]\.sort\(\)/)
  const classifiedErrorReturn = safeErrorParser.slice(
    safeErrorParser.lastIndexOf('return {\n    status: "CLASSIFIED"'),
  )
  assert.doesNotMatch(classifiedErrorReturn,
    /(?:message|longMessage|inputRefIds|outputRefIds|value):/)
  const inventoryDiagnosticResult = installedInventoryDiagnostic.slice(
    installedInventoryDiagnostic.indexOf(
      "function diagnosticResult(): EbayInstalledInventoryConsumerDiagnostic",
    ),
  )
  assert.doesNotMatch(inventoryDiagnosticResult,
    /subsetToken|fourScopeToken|clientSecret|refreshToken|Authorization:/)
  assert.match(inventoryDiagnosticResult, /rawPayloadReturned: false/)
  assert.match(inventoryDiagnosticResult, /authorizationHeaderReturned: false/)
  assert.match(inventoryDiagnosticResult, /ledgerMutations: 0/)
  assert.match(inventoryDiagnosticResult, /ebayWrites: 0/)
  assert.match(page, /execution\.maximumExternalCalls !== 8/)
  assert.match(page, /record\.calls\.length > 8/)
  assert.match(page, /status === 200/)
  assert.match(page, /fourStatus === 200/)
  assert.match(page, /parsedVariants\.slice\(1\)\.reverse\(\)/)
  assert.match(installedInventoryDiagnostic,
    /returnedScopeSetIsExact\(minted, subsetScopes\)/)
  assert.match(installedInventoryDiagnostic,
    /returnedScopeSetIsExact\(fourScopeMinted, fourScopes\)/)
  assert.match(page, /INVENTORY_ERROR_METADATA_KEYS/)
  assert.match(page, /error\.parameterNames/)
  assert.match(inventoryDomain,
    /eBay defines offset as a zero-based page number, not a row offset/)
  assert.match(inventoryDomain,
    /input\.expectedOffset \+ 1/)
  assert.match(inventoryCore, /offset \+= 1/)
  assert.doesNotMatch(inventoryCore, /offset \+= page\.length/)
  assert.match(page,
    /setCredentialMatch\(null\)\s*setDiagnosis\(null\)/)
  assert.doesNotMatch(page, /[a-f0-9]{64}/i)
  assert.match(domain, /EXPECTED_PRODUCTION_APP_ID_UTF8_LENGTH = 40/)
  assert.match(domain, /EXPECTED_PRODUCTION_RUNAME_UTF8_LENGTH = 37/)
  assert.equal((domain.match(/"[a-f0-9]{64}"/g) ?? []).length, 2)
  assert.match(page, /AUTH_REQUEST_LIVE_PREFLIGHT_REQUIRED/)
  assert.match(page, /ADMIN_SESSION_REQUIRED/)
  assert.match(page, /Auth Accepted URL/)
  assert.equal(EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS["Referrer-Policy"], "no-referrer")
  assert.match(EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS["X-Robots-Tag"], /noindex/)
  assert.match(EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS["Content-Security-Policy"], /default-src 'none'/)
  const nonce = "N".repeat(24)
  const handoff = renderEbaySellerOAuthReauthSuccessHtml(
    PRIVATE_REFRESH,
    nonce,
  )
  assert.match(handoff, new RegExp(PRIVATE_REFRESH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.match(handoff, /Credencial sensible · copiar directamente a Vercel/)
  assert.match(handoff, /id=\"copy-token\"/)
  assert.match(handoff, new RegExp(`script nonce=\\"${nonce}\\"`))
  assert.match(handoff, /navigator\.clipboard\.writeText/)
  assert.doesNotMatch(handoff,
    /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|<form/i)
  const successHeaders = ebaySellerOAuthReauthSuccessResponseHeaders(nonce)
  assert.match(successHeaders["Content-Security-Policy"],
    new RegExp(`script-src 'nonce-${nonce}'`))
  assert.match(successHeaders["Content-Security-Policy"], /connect-src 'none'/)
  assert.equal(successHeaders["Cache-Control"].includes("no-store"), true)
})

test("customer Production remains blocked while dedicated preprod is allowed", () => {
  for (const [pathname, method] of [
    ["/admin/ebay/monitor/seller-oauth-reauth", "GET"],
    ["/api/admin/ebay/monitor/seller-oauth-reauth", "POST"],
    ["/api/admin/ebay/monitor/seller-oauth-reauth", "GET"],
  ]) {
    assert.equal(getEbayProRuntimeBoundary({
      pathname,
      method,
      vercelEnv: "production",
      nodeEnv: "production",
    }).blocked, true)
    assert.equal(getEbayProRuntimeBoundary({
      pathname,
      method,
      vercelEnv: "preview",
      nodeEnv: "production",
      vercelGitCommitRef: EBAY_SELLER_OAUTH_REAUTH_BRANCH,
    }).blocked, false)
  }
  for (const [pathname, method] of [
    ["/admin/ebay/monitor/seller-oauth-reauth", "GET"],
    ["/api/admin/ebay/monitor/seller-oauth-reauth", "POST"],
    ["/api/admin/ebay/monitor/seller-oauth-reauth", "GET"],
  ]) {
    assert.equal(getEbayProRuntimeBoundary({
      pathname,
      method,
      vercelEnv: "production",
      vercelTargetEnv: "production",
      vercelSystem: "1",
      vercelProjectId: "prj_XvOpSg1jhmLLG1yOCFhAbiLEn222",
      vercelProjectProductionUrl: DEDICATED_PREPROD_HOST,
      ebayProRuntime: "staging",
      supabaseUrl: "https://vsfthqydfrdzulldbfbe.supabase.co",
    }).blocked, false)
  }
})
