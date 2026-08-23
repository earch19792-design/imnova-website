import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {
        return nextResolve(specifier, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const {
  SELLER_OS_LUNA_ASSET_HOSTS,
  SELLER_OS_LUNA_CEREMONY_CSRF_TTL_MS,
  SELLER_OS_LUNA_CEREMONY_TTL_MS,
  SELLER_OS_LUNA_NAVIGATION_HOSTS,
  SELLER_OS_LUNA_SECURITY_CHALLENGE_HOSTS,
  classifySellerOsLunaBrowserRequestV1,
  createSellerOsLunaBrowserCeremonyCoordinatorV1,
  createSellerOsLunaCeremonyCsrfBoundaryV1,
} = await import("./ebay-luna-protected-session-ceremony-v1.ts")

const {
  probeLunaProtectedSessionHeaderV1,
} = await import("./ebay-luna-protected-session-server-v1.ts")

const ACTOR = "11111111-1111-4111-8111-111111111111"
const OTHER_ACTOR = "22222222-2222-4222-8222-222222222222"
const INSTANCE = "AAAAAAAAAAAAAAAAAAAAAA"
const OTHER_INSTANCE = "BBBBBBBBBBBBBBBBBBBBBB"
const ADMIN_SESSION = `admin-session-fixture-${"a".repeat(64)}`
const OTHER_ADMIN_SESSION = `admin-session-fixture-${"b".repeat(64)}`
const REQUEST_URL =
  "http://localhost:3000/api/admin/ebay/luna-protected-session"
const SESSION_PAYLOAD = () => Buffer.alloc(96, 0x61)

function csrfHarness() {
  let at = 1_800_000_000_000
  let counter = 1
  const boundary = createSellerOsLunaCeremonyCsrfBoundaryV1({
    now: () => at,
    random: (bytes) => Buffer.alloc(bytes, counter++),
  })
  const context = {
    actorUserId: ACTOR,
    adminSessionToken: ADMIN_SESSION,
    ceremonyInstanceId: INSTANCE,
    requestUrl: REQUEST_URL,
    origin: null,
    secFetchSite: "same-origin",
    stateToken: null,
  }
  return {
    boundary,
    context,
    issue(overrides = {}) {
      return boundary.issue({ ...context, ...overrides })
    },
    consume(token, overrides = {}) {
      return boundary.consume({
        ...context,
        action: "START",
        origin: "http://127.0.0.1:3000",
        contentType: "application/json",
        csrfHeader: token,
        csrfCookie: token,
        ...overrides,
      })
    },
    advance(milliseconds) { at += milliseconds },
  }
}

function harness(overrides = {}) {
  let at = 1_800_000_000_000
  let counter = 1
  let closed = 0
  let capturedPayload = SESSION_PAYLOAD()
  const coordinator = createSellerOsLunaBrowserCeremonyCoordinatorV1({
    instanceId: overrides.instanceId ?? INSTANCE,
    now: () => at,
    random: (bytes) => Buffer.alloc(bytes, counter++),
    launchBrowser: overrides.launchBrowser ?? (async () => ({
      captureVerifiedSession: overrides.captureVerifiedSession ??
        (async () => ({
          sessionPayload: capturedPayload,
          expiresAt: new Date(at + 3_600_000).toISOString(),
          postLoginHost: "account.lunaportex.com",
          postLoginPathClass: "LUNA_CUSTOMER_ACCOUNT",
          authenticatedStateProven: true,
        })),
      close: async () => { closed += 1 },
    })),
    persistSession: overrides.persistSession ?? (async () => ({
      storedAt: new Date(at).toISOString(),
      sessionDigest: `luna-session-v1:sha256:${"a".repeat(64)}`,
    })),
    verifyStoredSession: overrides.verifyStoredSession ?? (async () => ({
      authenticated: true,
      postLoginHost: "account.lunaportex.com",
      postLoginPathClass: "LUNA_CUSTOMER_ACCOUNT",
    })),
  })
  return {
    coordinator,
    advance(milliseconds) { at += milliseconds },
    closed: () => closed,
    payload: () => capturedPayload,
    replacePayload(value) { capturedPayload = value },
  }
}

function request(url, topLevelNavigation = true, method = "GET") {
  return classifySellerOsLunaBrowserRequestV1({
    url, method, topLevelNavigation,
  })
}

test("normal Luna login and callback paths are the only navigation hosts", () => {
  assert.deepEqual(SELLER_OS_LUNA_NAVIGATION_HOSTS,
    ["www.lunaportex.com", "account.lunaportex.com"])
  for (const url of [
    "https://www.lunaportex.com/account/login",
    "https://account.lunaportex.com/",
    "https://account.lunaportex.com/authentication/oauth/authorize?client_id=fixed",
    "https://account.lunaportex.com/authentication/login",
    "https://account.lunaportex.com/callback?code=opaque&state=opaque",
  ]) assert.equal(request(url).allowed, true)
})

test("Shop, payment, and social identity provider navigation is blocked", () => {
  for (const host of ["shop.app", "pay.shopify.com", "accounts.google.com",
    "www.facebook.com", "appleid.apple.com", "login.microsoftonline.com",
    "tenant.auth0.com", "tenant.okta.com"]) {
    const result = request(`https://${host}/login`)
    assert.equal(result.allowed, false)
    assert.equal(result.classification, "EXTERNAL_IDP_DENIED")
  }
})

test("arbitrary host, protocol, and credential query navigation fail closed", () => {
  assert.equal(request("https://example.com/").classification,
    "ARBITRARY_HOST_DENIED")
  assert.equal(request("http://www.lunaportex.com/").classification,
    "URL_DENIED")
  assert.equal(request(
    "https://account.lunaportex.com/authentication/login?password=fixture",
  ).failureCode, "LUNA_CEREMONY_CREDENTIAL_QUERY_DENIED")
})

test("cdn.shopify.com is asset-only and can never navigate top-level", () => {
  assert.deepEqual(SELLER_OS_LUNA_ASSET_HOSTS, ["cdn.shopify.com"])
  assert.equal(request("https://cdn.shopify.com/auth.js", false).allowed, true)
  const top = request("https://cdn.shopify.com/auth.js", true)
  assert.equal(top.allowed, false)
  assert.equal(top.classification, "TOP_LEVEL_ASSET_DENIED")
})

test("Cloudflare challenge is exact-host subresource only", () => {
  assert.deepEqual(SELLER_OS_LUNA_SECURITY_CHALLENGE_HOSTS,
    ["challenges.cloudflare.com"])
  for (const method of ["GET", "HEAD", "POST", "OPTIONS"]) {
    const challenge = request(
      "https://challenges.cloudflare.com/turnstile/v0/api.js", false, method,
    )
    assert.equal(challenge.allowed, true)
    assert.equal(challenge.classification, "SECURITY_CHALLENGE_ALLOWED")
  }
  const top = request(
    "https://challenges.cloudflare.com/turnstile/v0/api.js", true,
  )
  assert.equal(top.allowed, false)
  assert.equal(top.classification,
    "TOP_LEVEL_SECURITY_CHALLENGE_DENIED")
  assert.equal(request(
    "https://challenges.cloudflare.com/turnstile/v0/api.js", false, "PUT",
  ).classification, "METHOD_DENIED")
})

test("Cloudflare wildcard and unrelated challenge hosts remain impossible", () => {
  for (const host of ["cloudflare.com", "www.cloudflare.com",
    "challenge.cloudflare.com", "challenges.evil.example",
    "sub.challenges.cloudflare.com"]) {
    const denied = request(`https://${host}/challenge`, false)
    assert.equal(denied.allowed, false)
    assert.equal(denied.classification, "ARBITRARY_HOST_DENIED")
  }
  for (const host of ["shop.app", "pay.shopify.com",
    "accounts.google.com", "appleid.apple.com"]) {
    assert.equal(request(`https://${host}/`, false).classification,
      "EXTERNAL_IDP_DENIED")
  }
})

test("CSRF token is server-owned, stable across GET refresh, and single-use", () => {
  const h = csrfHarness()
  const first = h.issue()
  const refreshed = h.issue({
    requestUrl:
      "http://127.0.0.1:3000/api/admin/ebay/luna-protected-session",
  })
  assert.equal(first.csrfToken, refreshed.csrfToken)
  assert.equal(first.adminSessionBound, true)
  assert.equal(first.ceremonyInstanceBound, true)
  assert.equal(first.originBound, true)
  assert.equal(first.ceremonyStateBound, true)
  assert.equal(h.consume(first.csrfToken), true)
  assert.throws(() => h.consume(first.csrfToken),
    /LUNA_CEREMONY_CSRF_REUSED/)
  assert.notEqual(h.issue().csrfToken, first.csrfToken)
})

test("CSRF loopback policy shares localhost, IPv4, and IPv6 aliases only", () => {
  for (const origin of ["http://localhost:3000",
    "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    const h = csrfHarness()
    const issued = h.issue()
    assert.equal(h.consume(issued.csrfToken, { origin }), true)
  }
  for (const override of [
    { origin: "http://127.0.0.1:3001" },
    { origin: "https://127.0.0.1:3000" },
    { origin: "http://attacker.example:3000" },
    { origin: "http://localhost.evil.example:3000" },
    { origin: "http://127.0.0.1:3000", secFetchSite: "cross-site" },
  ]) {
    const h = csrfHarness()
    const issued = h.issue()
    assert.throws(() => h.consume(issued.csrfToken, override),
      /LUNA_CEREMONY_CSRF_REJECTED/)
  }
})

test("missing, wrong, mismatched, and non-JSON CSRF requests fail closed", () => {
  for (const override of [
    { csrfHeader: null },
    { csrfCookie: null },
    { csrfHeader: "wrong" },
    { csrfCookie: "wrong" },
    { contentType: "text/plain" },
    { origin: null },
  ]) {
    const h = csrfHarness()
    const issued = h.issue()
    assert.throws(() => h.consume(issued.csrfToken, override),
      /LUNA_CEREMONY_CSRF_REJECTED/)
  }
})

test("expired CSRF fails closed without reaching ceremony launch", () => {
  const h = csrfHarness()
  const issued = h.issue()
  h.advance(SELLER_OS_LUNA_CEREMONY_CSRF_TTL_MS + 1)
  assert.throws(() => h.consume(issued.csrfToken),
    /LUNA_CEREMONY_CSRF_EXPIRED/)
})

test("CSRF binds Admin session, actor, backend instance, and ceremony state", () => {
  for (const override of [
    { adminSessionToken: OTHER_ADMIN_SESSION },
    { actorUserId: OTHER_ACTOR },
    { ceremonyInstanceId: OTHER_INSTANCE },
  ]) {
    const h = csrfHarness()
    const issued = h.issue()
    assert.throws(() => h.consume(issued.csrfToken, override),
      /LUNA_CEREMONY_CSRF_REJECTED/)
  }

  const stateToken = `1.${INSTANCE}.${"A".repeat(43)}`
  const h = csrfHarness()
  const issued = h.issue({ stateToken })
  assert.throws(() => h.consume(issued.csrfToken, {
    action: "START", stateToken,
  }), /LUNA_CEREMONY_WRONG_STATE/)
  assert.equal(h.consume(issued.csrfToken, {
    action: "COMPLETE", stateToken,
  }), true)
})

test("CSRF reaches mocked start and completion boundaries exactly once", async () => {
  let launches = 0
  const ceremony = harness({
    launchBrowser: async () => {
      launches += 1
      return {
        captureVerifiedSession: async () => ({
          sessionPayload: SESSION_PAYLOAD(),
          expiresAt: "2027-01-15T09:00:00.000Z",
          postLoginHost: "account.lunaportex.com",
          postLoginPathClass: "LUNA_CUSTOMER_ACCOUNT",
          authenticatedStateProven: true,
        }),
        close: async () => {},
      }
    },
  })
  const startCsrf = csrfHarness()
  const startToken = startCsrf.issue()
  assert.equal(startCsrf.consume(startToken.csrfToken), true)
  const started = await ceremony.coordinator.start(ACTOR)
  assert.equal(launches, 1)

  const completeCsrf = csrfHarness()
  const completeToken = completeCsrf.issue({ stateToken: started.stateToken })
  assert.equal(completeCsrf.consume(completeToken.csrfToken, {
    action: "COMPLETE", stateToken: started.stateToken,
  }), true)
  const completed = await ceremony.coordinator.complete(
    started.stateToken, ACTOR,
  )
  assert.equal(completed.phase, "COMPLETED")
  assert.throws(() => completeCsrf.consume(completeToken.csrfToken, {
    action: "COMPLETE", stateToken: started.stateToken,
  }), /LUNA_CEREMONY_CSRF_REUSED/)
})

test("valid ceremony stores once, verifies once, closes, and zeroes payload", async () => {
  let stores = 0
  let verifies = 0
  const h = harness({
    persistSession: async () => {
      stores += 1
      return { storedAt: "2027-01-15T08:00:00.000Z",
        sessionDigest: `luna-session-v1:sha256:${"b".repeat(64)}` }
    },
    verifyStoredSession: async () => {
      verifies += 1
      return { authenticated: true, postLoginHost: "account.lunaportex.com",
        postLoginPathClass: "LUNA_CUSTOMER_ACCOUNT" }
    },
  })
  const started = await h.coordinator.start(ACTOR)
  assert.equal(started.ceremony.phase, "AWAITING_HUMAN_LOGIN")
  assert.equal("stateToken" in started.ceremony, false)
  const completed = await h.coordinator.complete(started.stateToken, ACTOR)
  assert.equal(completed.phase, "COMPLETED")
  assert.equal(completed.authenticatedStateProven, true)
  assert.equal(completed.cookiesIncluded, false)
  assert.equal(stores, 1)
  assert.equal(verifies, 1)
  assert.equal(h.closed(), 1)
  assert.equal(h.payload().every((byte) => byte === 0), true)
})

test("wrong state and wrong actor fail closed", async () => {
  const h = harness()
  const started = await h.coordinator.start(ACTOR)
  const wrongState = `${started.stateToken.slice(0, -1)}${
    started.stateToken.endsWith("A") ? "B" : "A"}`
  await assert.rejects(h.coordinator.status(wrongState, ACTOR),
    /LUNA_CEREMONY_WRONG_STATE/)
  await assert.rejects(h.coordinator.status(started.stateToken, OTHER_ACTOR),
    /LUNA_CEREMONY_WRONG_STATE/)
  await h.coordinator.shutdown()
})

test("expired state closes browser and cannot complete", async () => {
  const h = harness()
  const started = await h.coordinator.start(ACTOR)
  h.advance(SELLER_OS_LUNA_CEREMONY_TTL_MS + 1)
  await assert.rejects(h.coordinator.complete(started.stateToken, ACTOR),
    /LUNA_CEREMONY_EXPIRED_STATE/)
  assert.equal(h.closed(), 1)
})

test("completed state is single-use and replay protected", async () => {
  const h = harness()
  const started = await h.coordinator.start(ACTOR)
  await h.coordinator.complete(started.stateToken, ACTOR)
  await assert.rejects(h.coordinator.complete(started.stateToken, ACTOR),
    /LUNA_CEREMONY_REUSED_STATE/)
})

test("two concurrent completions permit one active completion only", async () => {
  let release
  const captured = new Promise((resolve) => { release = resolve })
  const h = harness({
    captureVerifiedSession: async () => {
      await captured
      return { sessionPayload: h.payload(),
        expiresAt: "2027-01-15T09:00:00.000Z",
        postLoginHost: "account.lunaportex.com",
        postLoginPathClass: "LUNA_CUSTOMER_ACCOUNT",
        authenticatedStateProven: true }
    },
  })
  const started = await h.coordinator.start(ACTOR)
  const first = h.coordinator.complete(started.stateToken, ACTOR)
  await Promise.resolve()
  await assert.rejects(h.coordinator.complete(started.stateToken, ACTOR),
    /LUNA_CEREMONY_CONCURRENT_COMPLETION/)
  release()
  await first
})

test("backend restart invalidates an in-flight state", async () => {
  const first = harness({ instanceId: "AAAAAAAAAAAAAAAAAAAAAA" })
  const second = harness({ instanceId: "BBBBBBBBBBBBBBBBBBBBBB" })
  const started = await first.coordinator.start(ACTOR)
  await assert.rejects(second.coordinator.status(started.stateToken, ACTOR),
    /LUNA_CEREMONY_BACKEND_RESTART/)
  await first.coordinator.shutdown()
  await second.coordinator.shutdown()
})

test("browser crash and policy violations fail before Vault persistence", async () => {
  let stores = 0
  const crash = harness({
    captureVerifiedSession: async () => {
      throw new Error("LUNA_CEREMONY_BROWSER_CRASH")
    },
    persistSession: async () => { stores += 1; throw new Error("unexpected") },
  })
  const crashStarted = await crash.coordinator.start(ACTOR)
  await assert.rejects(crash.coordinator.complete(crashStarted.stateToken, ACTOR),
    /LUNA_CEREMONY_BROWSER_CRASH/)

  const denied = harness({
    launchBrowser: async ({ onPolicyViolation }) => {
      onPolicyViolation("shop.app", "LUNA_CEREMONY_EXTERNAL_IDP_DENIED")
      return { captureVerifiedSession: async () => {
        throw new Error("must not capture")
      }, close: async () => {} }
    },
    persistSession: async () => { stores += 1; throw new Error("unexpected") },
  })
  const deniedStarted = await denied.coordinator.start(ACTOR)
  await assert.rejects(denied.coordinator.complete(
    deniedStarted.stateToken, ACTOR,
  ), /LUNA_CEREMONY_EXTERNAL_IDP_DENIED/)
  assert.equal(stores, 0)
})

test("Vault unavailable and Vault write failure close the ephemeral browser", async () => {
  for (const code of ["LUNA_PROTECTED_SESSION_VAULT_UNAVAILABLE",
    "LUNA_PROTECTED_SESSION_VAULT_WRITE_FAILED"]) {
    const h = harness({ persistSession: async () => { throw new Error(code) } })
    const started = await h.coordinator.start(ACTOR)
    await assert.rejects(h.coordinator.complete(started.stateToken, ACTOR),
      new RegExp(code))
    assert.equal(h.closed(), 1)
  }
})

test("post-store verification failure never reports configured", async () => {
  const h = harness({ verifyStoredSession: async () => ({
    authenticated: false, postLoginHost: null, postLoginPathClass: null,
  }) })
  const started = await h.coordinator.start(ACTOR)
  await assert.rejects(h.coordinator.complete(started.stateToken, ACTOR),
    /LUNA_CEREMONY_POST_STORE_VERIFICATION_FAILED/)
  assert.equal(h.closed(), 1)
})

test("bounded authenticated recognition read rejects redirects outside Luna", async () => {
  await assert.rejects(probeLunaProtectedSessionHeaderV1({
    cookieHeader: "_shopify_essential=opaque-fixture",
    fetchImpl: async () => new Response(null, {
      status: 302, headers: { location: "https://shop.app/" },
    }),
  }), /LUNA_PROTECTED_SESSION_REDIRECT_DENIED/)
})

test("bounded authenticated recognition read returns sanitized proof only", async () => {
  const urls = []
  const result = await probeLunaProtectedSessionHeaderV1({
    cookieHeader: "_shopify_essential=opaque-fixture",
    fetchImpl: async (url) => {
      urls.push(String(url))
      return urls.length === 1
        ? new Response(null, { status: 302,
          headers: { location: "https://account.lunaportex.com/" } })
        : new Response("private page fixture", { status: 200 })
    },
  })
  assert.equal(result.authenticated, true)
  assert.equal(result.logicalReadCount, 1)
  assert.equal(result.responseBodyRead, false)
  assert.equal(result.stockEvaluated, false)
  assert.equal(result.oosInferred, false)
  assert.equal("cookieHeader" in result, false)
})

test("route accepts only action and stores state and CSRF in protected cookies", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-protected-session/route.ts",
    import.meta.url,
  ), "utf8")
  assert.match(route, /Object\.keys\(value\)\.join\(","\) !== "action"/)
  assert.match(route, /httpOnly:\s*true/)
  assert.match(route, /sameSite:\s*"strict"/)
  assert.match(route, /started\.stateToken, stateCookieOptions/)
  assert.match(route, /SELLER_OS_LUNA_CEREMONY_CSRF_COOKIE/)
  assert.match(route, /getSellerOsLunaCeremonyCsrfBoundaryV1\(\)\.consume/)
  assert.match(route, /adminSessionToken:\s*bearerToken\(request\)/)
  assert.match(route, /ceremonyInstanceId:\s*coordinator\.instanceId/)
  assert.match(route, /LUNA_CEREMONY_VAULT_RUNTIME_UNAVAILABLE/)
  assert.match(route, /stateReturned:\s*false/)
  assert.doesNotMatch(route, /actionPayload\.(?:url|cookie|password|credential)/)
  assert.doesNotMatch(route, /sessionPayload[,:]/)
})

test("worker is visible, backend-controlled, routed, and always cleans profile", async () => {
  const worker = await readFile(new URL(
    "./ebay-luna-canonical-browser-worker-server-v1.ts", import.meta.url,
  ), "utf8")
  assert.match(worker, /headless:\s*false/)
  assert.match(worker, /launchPersistentContext\(profilePath/)
  assert.match(worker, /serviceWorkers:\s*"block"/)
  assert.match(worker,
    /securityChallengeAllowlist:\s*\["challenges\.cloudflare\.com"\]/)
  assert.match(worker,
    /securityChallengeTopLevelNavigationAllowed:\s*false/)
  assert.match(worker, /context\.route\("\*\*\/\*"/)
  assert.match(worker, /LUNA_CEREMONY_AUTHENTICATED_SESSION_NOT_PROVEN/)
  assert.match(worker, /unauthenticatedCookieFingerprints/)
  assert.match(worker, /clearCookies\(\)/)
  assert.match(worker, /deleteEphemeralProfile\(profilePath\)/)
  assert.match(worker, /remoteDebuggingPublic:\s*false/)
  assert.doesNotMatch(worker, /remote-debugging-port/)
  assert.doesNotMatch(worker, /storageState\s*\(/)
  assert.doesNotMatch(worker, /\.screenshot\s*\(/)
  assert.doesNotMatch(worker, /request\.postData/)
  assert.doesNotMatch(worker, /console\.(?:log|info|warn|error)/)
  assert.doesNotMatch(worker, /\.\.\.process\.env/)
  assert.match(worker, /HOME:\s*profilePath/)
})

test("UI has no credential/cookie input or copy-paste handoff", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-protected-session/page.tsx",
    import.meta.url,
  ), "utf8")
  assert.doesNotMatch(page, /<input\b/i)
  assert.doesNotMatch(page, /type=["']password["']/i)
  assert.doesNotMatch(page, /navigator\.clipboard|localStorage|sessionStorage/)
  assert.doesNotMatch(page,
    /const CSRF_VALUE\s*=\s*"SELLER_OS_LUNA_BROWSER_CEREMONY_V1"/)
  assert.match(page, /"X-Seller-OS-CSRF": csrfToken/)
  assert.match(page, /Escribe allí tu correo y contraseña; nunca aquí/)
  assert.match(page, /Sign in with Shop/)
})

test("status refresh is GET-only, rotates no state, and clears stale UI error", async () => {
  const page = await readFile(new URL(
    "../../app/admin/ebay/luna-protected-session/page.tsx",
    import.meta.url,
  ), "utf8")
  const refreshSource = page.slice(
    page.indexOf("const refresh = useCallback"),
    page.indexOf("const act = useCallback"),
  )
  assert.match(refreshSource, /fetch\(ENDPOINT/)
  assert.doesNotMatch(refreshSource, /method:\s*"POST"/)
  assert.doesNotMatch(refreshSource, /X-Seller-OS-CSRF/)
  assert.match(refreshSource, /setError\(""\)/)
  assert.match(refreshSource, /setPayload\(result\)/)
})

test("ceremony CSRF reuses the canonical closed Admin origin policy", async () => {
  const ceremony = await readFile(new URL(
    "./ebay-luna-protected-session-ceremony-v1.ts", import.meta.url,
  ), "utf8")
  assert.match(ceremony, /getSellerOsAdminOriginBindingV1/)
  assert.doesNotMatch(ceremony, /origin\.origin\s*!==\s*requestUrl\.origin/)
})

test("Vault is the exclusive canonical session store and service-role RPC", async () => {
  const server = await readFile(new URL(
    "./ebay-luna-protected-session-server-v1.ts", import.meta.url,
  ), "utf8")
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260821193830_create_seller_os_luna_stock_observation_storage.sql",
    import.meta.url,
  ), "utf8")
  assert.match(server, /store_seller_os_luna_protected_session_v1/)
  assert.doesNotMatch(server, /legacyServerEnvironmentSession/)
  assert.doesNotMatch(server, /process\.env\.LUNAPORTEX_AUTH_COOKIE/)
  assert.match(migration,
    /revoke all on function public\.store_seller_os_luna_protected_session_v1\([\s\S]*?from public, anon, authenticated, service_role;/)
  assert.match(migration,
    /grant execute on function public\.store_seller_os_luna_protected_session_v1\([\s\S]*?to service_role;/)
})

test("safety surfaces freeze polling, stock jobs, OOS, and marketplace writes", async () => {
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-protected-session/route.ts",
    import.meta.url,
  ), "utf8")
  for (const pattern of [/productionLunaPolling:\s*0/,
    /lunaStockJobsCreated:\s*0/, /certifiedOosProduced:\s*false/,
    /lunaMutations:\s*0/, /marketplaceWrites:\s*0/,
    /credentialsIncluded:\s*false/, /cookiesIncluded:\s*false/]) {
    assert.match(route, pattern)
  }
})
