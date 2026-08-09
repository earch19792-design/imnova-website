import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
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
})

const {
  claimAndVerifyEbaySellerOAuthReauth,
  prepareEbaySellerOAuthReauthStart,
  verifyEbaySellerOAuthReauthCandidate,
} = await import("./ebay-seller-oauth-reauth.ts")
const {
  assertEbaySellerOAuthReauthAdmin,
  buildEbaySellerOAuthReauthAuthorizationUrl,
  createEbaySellerOAuthReauthCookie,
  EBAY_SELLER_OAUTH_REAUTH_BRANCH,
  EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
  EBAY_SELLER_OAUTH_REAUTH_EXTERNAL_DEADLINE_MS,
  EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS,
  EBAY_SELLER_OAUTH_REAUTH_MAX_EXTERNAL_READ_CALLS,
  EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
  EBAY_SELLER_OAUTH_REAUTH_SCOPES,
  EBAY_SELLER_OAUTH_REAUTH_TERMINAL_RESERVE_MS,
  getEbaySellerOAuthReauthConfiguration,
  hashEbaySellerOAuthReauthState,
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

const HOST = "imnova-canonical-branch.example.vercel.app"
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
  EBAY_CLIENT_ID: "production-app-id",
  EBAY_CLIENT_SECRET: "production-app-secret",
  EBAY_RuName: "production-generic-runame",
  EBAY_SELLER_ACCOUNT_KEY: "imnova-ebay-us-primary",
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: USER_ID,
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT:
    EXPECTED_FINGERPRINT,
  EBAY_SELLER_REFRESH_TOKEN: OLD_ENV_REFRESH,
}

const configuration = getEbaySellerOAuthReauthConfiguration({
  environment,
  requestHost: HOST,
})

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
    if (options.failProbe === operation) {
      return response({ errors: [{ message: PRIVATE_DESCRIPTION }] }, 403)
    }
    if (options.invalidProbeJson === operation) return response([])
    return response({})
  }
  return { fetchImpl, requests }
}

test("configuration is exact-branch Preview only and service-role auth is rejected", () => {
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

test("authorization URL and signed transaction cookie bind exact scope/state/host/expiry", () => {
  const url = new URL(buildEbaySellerOAuthReauthAuthorizationUrl({
    clientId: configuration.clientId,
    runame: configuration.runame,
    state: STATE,
  }))
  assert.equal(url.origin, "https://auth.ebay.com")
  assert.equal(url.pathname, "/oauth2/authorize")
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

test("callback query rejects missing, duplicate, contradictory and oversized inputs", () => {
  const base = `https://${HOST}${EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH}`
  assert.equal(
    parseEbaySellerOAuthReauthCallbackUrl(
      `${base}?state=${STATE}&code=${encodeURIComponent(PRIVATE_CODE)}`,
    ).kind,
    "CODE",
  )
  assert.equal(
    parseEbaySellerOAuthReauthCallbackUrl(
      `${base}?state=${STATE}&error=access_denied&error_description=private`,
    ).kind,
    "DENIED",
  )
  for (const query of [
    `state=${STATE}`,
    `state=${STATE}&code=a&code=b`,
    `state=${STATE}&code=a&error=access_denied`,
    `state=${STATE}&code=a&error=`,
    `state=${STATE}&error=access_denied&code=`,
    `state=${STATE}&code=a&error_description=contradictory`,
    `state=${STATE}&code=a&unexpected=1`,
    `state=${STATE}&code=${"x".repeat(1_025)}`,
    `state=${STATE}&code=${encodeURIComponent("bad\ncode")}`,
  ]) {
    assert.throws(
      () => parseEbaySellerOAuthReauthCallbackUrl(`${base}?${query}`),
      /CALLBACK_INVALID|CODE_INVALID/,
    )
  }
})

test("start inserts exactly one hash-only PENDING row and collision fails closed", async () => {
  const now = Date.parse("2026-08-08T20:00:00.000Z")
  const ledger = new AtomicMemoryLedger(now)
  const first = await prepareEbaySellerOAuthReauthStart({
    configuration,
    actorUserId: ADMIN_ID,
    ledger,
    clock: () => now,
    stateFactory: () => STATE,
  })
  assert.equal(first.stateHashPersisted, true)
  assert.equal(first.rawStatePersisted, false)
  assert.equal(first.tokenGenerated, false)
  assert.equal(ledger.rows.size, 1)
  assert.deepEqual([...ledger.rows.keys()], [hashEbaySellerOAuthReauthState(STATE)])
  assert.doesNotMatch(JSON.stringify([...ledger.rows.values()]), /private|token|code/i)
  await assert.rejects(prepareEbaySellerOAuthReauthStart({
    configuration,
    actorUserId: ADMIN_ID,
    ledger,
    clock: () => now,
    stateFactory: () => STATE,
  }), /STATE_COLLISION/)
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

  for (const failProbe of ["inventory", "analytics", "account"]) {
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

test("temporary route/page are isolated and never import mutable OAuth or writers", () => {
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
  const ledger = readFileSync(new URL(
    "./ebay-seller-oauth-reauth-ledger.ts",
    import.meta.url,
  ), "utf8")
  const runtime = [route, page, core, ledger].join("\n")
  assert.match(route, /export async function POST/)
  assert.match(route, /export async function GET/)
  assert.match(route, /maxDuration = 30/)
  assert.ok(
    route.indexOf("validateAdminApiRequest(request)") <
      route.indexOf("getSupabaseAdminClient()"),
  )
  assert.match(route, /callbackHtml\(result\.code/)
  assert.match(route, /ebaySellerOAuthReauthCookieOptions\(0\)/)
  assert.equal((route.match(/ebaySellerOAuthReauthCookieOptions\(0\)/g) ?? []).length, 2)
  assert.match(route, /renderEbaySellerOAuthReauthSuccessHtml/)
  assert.doesNotMatch(route, /NextResponse\.json\([^)]*refreshToken/s)
  assert.doesNotMatch(core, /EBAY_SELLER_REFRESH_TOKEN/)
  assert.doesNotMatch(runtime, /console\.|telemetry|analytics\.track/i)
  assert.doesNotMatch(runtime, /commercial-orders-oauth|account-policy-oauth-authorization/)
  assert.doesNotMatch(runtime, /from\s+["'][^"']*(?:vault|account-policy-oauth)/i)
  assert.doesNotMatch(runtime, /\.(?:insert|upsert|delete)\s*\(/i)
  assert.doesNotMatch(runtime, /ReviseItem|EndItem|AddItem|publishOffer|createShippingFulfillment|WhatsApp/)
  assert.match(page, /method: "POST"/)
  assert.match(page, /ADMIN_SESSION_REQUIRED/)
  assert.match(page, /Auth Accepted URL/)
  assert.equal(EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS["Referrer-Policy"], "no-referrer")
  assert.match(EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS["X-Robots-Tag"], /noindex/)
  assert.match(EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS["Content-Security-Policy"], /default-src 'none'/)
  const handoff = renderEbaySellerOAuthReauthSuccessHtml(PRIVATE_REFRESH)
  assert.match(handoff, new RegExp(PRIVATE_REFRESH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.doesNotMatch(handoff, /<script|fetch\(|form/i)
})

test("production boundary blocks both temporary UI and API", () => {
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
})
