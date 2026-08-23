import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export default {}", shortCircuit: true }
    }
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
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
  buildEbayCommercialOrdersBrowserStartUrl,
  createEbayCommercialOrdersBrowserStartTicket,
  EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_VERSION,
  EBAY_COMMERCIAL_ORDERS_BROWSER_START_TTL_MS,
  verifyEbayCommercialOrdersBrowserStartTicket,
} = await import("./ebay-commercial-orders-oauth-browser-ceremony.ts")

const NOW = 1_800_000_000_000
const HOST =
  "imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app"
const HANDOFF = "22222222-2222-4222-8222-222222222222"
const STATE = "A".repeat(43)
const SECRET = "test-secret-never-returned"
const ACCOUNT = "b".repeat(64)
const ACTOR = "11111111-1111-4111-8111-111111111111"
const OTHER_ACTOR = "33333333-3333-4333-8333-333333333333"
const DEPLOYMENT = "imnova-website-safe-deployment.vercel.app"

function ticket(overrides = {}) {
  return createEbayCommercialOrdersBrowserStartTicket({
    state: STATE,
    handoffId: HANDOFF,
    expiresAt: NOW + 240_000,
    host: HOST,
    deploymentIdentity: DEPLOYMENT,
    actorUserId: ACTOR,
    clientSecret: SECRET,
    expectedAccountFingerprint: ACCOUNT,
    ...overrides,
  })
}

test("browser START ticket is encrypted, same-host, admin-activation-bound, and bounded", () => {
  const value = ticket()
  assert.equal(EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_VERSION,
    "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_V2")
  assert.equal(EBAY_COMMERCIAL_ORDERS_BROWSER_START_TTL_MS, 15 * 60 * 1_000)
  assert.doesNotMatch(value, new RegExp(STATE))
  assert.doesNotMatch(value, new RegExp(HANDOFF))
  assert.doesNotMatch(value, /test-secret-never-returned/)
  assert.deepEqual(verifyEbayCommercialOrdersBrowserStartTicket({
    ticket: value,
    now: NOW,
    host: HOST,
    deploymentIdentity: DEPLOYMENT,
    actorUserId: ACTOR,
    clientSecret: SECRET,
    expectedAccountFingerprint: ACCOUNT,
  }), {
    state: STATE,
    handoffId: HANDOFF,
    expiresAt: NOW + 240_000,
    host: HOST,
    purpose: "COMMERCIAL_ORDERS_AND_BUYER_MESSAGE",
  })
})

test("browser START ticket classifies host, deployment, actor, expiry, and tampering", () => {
  const value = ticket()
  const common = {
    ticket: value,
    now: NOW,
    host: HOST,
    deploymentIdentity: DEPLOYMENT,
    actorUserId: ACTOR,
    clientSecret: SECRET,
    expectedAccountFingerprint: ACCOUNT,
  }
  assert.throws(() => verifyEbayCommercialOrdersBrowserStartTicket({
    ...common,
    host: "other-preview.example.vercel.app",
  }), /TICKET_HOST_MISMATCH/)
  assert.throws(() => verifyEbayCommercialOrdersBrowserStartTicket({
    ...common,
    deploymentIdentity: "other-safe-deployment.vercel.app",
  }), /TICKET_DEPLOYMENT_MISMATCH/)
  assert.throws(() => verifyEbayCommercialOrdersBrowserStartTicket({
    ...common,
    actorUserId: OTHER_ACTOR,
  }), /TICKET_ACTOR_MISMATCH/)
  assert.throws(() => verifyEbayCommercialOrdersBrowserStartTicket({
    ...common,
    now: NOW + 240_001,
  }), /TICKET_EXPIRED/)
  assert.throws(() => verifyEbayCommercialOrdersBrowserStartTicket({
    ...common,
    ticket: (() => {
      const parts = value.split(".")
      const tag = parts[3]
      parts[3] = `${tag.startsWith("A") ? "B" : "A"}${tag.slice(1)}`
      return parts.join(".")
    })(),
  }), /TICKET_SIGNATURE_INVALID/)
  assert.throws(() => verifyEbayCommercialOrdersBrowserStartTicket({
    ...common,
    ticket: "not-a-valid-ticket",
  }), /TICKET_MALFORMED/)
})

test("safe START URL uses same-host query transport that survives Preview protection", () => {
  const value = ticket()
  const startUrl = new URL(buildEbayCommercialOrdersBrowserStartUrl({
    host: HOST,
    ticket: value,
  }))
  assert.equal(startUrl.host, HOST)
  assert.equal(startUrl.pathname,
    "/admin/ebay/monitor/commercial-orders-oauth-start")
  assert.equal(startUrl.searchParams.get("ticket"), value)
  assert.equal(startUrl.hash, "")
  assert.doesNotMatch(startUrl.href, new RegExp(STATE))
  assert.doesNotMatch(startUrl.href, new RegExp(HANDOFF))
})

test("live-browser boundary issues HttpOnly state cookie before redirect", () => {
  const activationRoute = readFileSync(
    "app/api/admin/ebay/commercial-orders-oauth/browser-start/route.ts",
    "utf8",
  )
  const page = readFileSync(
    "app/admin/ebay/monitor/commercial-orders-oauth-start/page.tsx",
    "utf8",
  )
  const startRoute = readFileSync(
    "app/api/admin/ebay/commercial-orders-oauth/start/route.ts",
    "utf8",
  )
  assert.match(activationRoute, /assertEbaySellerOAuthReauthSameOrigin/)
  assert.match(activationRoute, /assertEbaySellerOAuthReauthAdmin/)
  assert.match(activationRoute, /response\.cookies\.set\(/)
  assert.match(activationRoute, /ebaySellerOAuthReauthCookieOptions/)
  assert.match(activationRoute, /stateCookieIssued: true|ceremony: activated\.ceremony/)
  assert.match(page, /new URL\(window\.location\.href\)/)
  assert.match(page, /searchParams\.get\("ticket"\)/)
  assert.doesNotMatch(page, /window\.location\.hash/)
  assert.match(page, /window\.history\.replaceState/)
  assert.match(page, /credentials: "same-origin"/)
  assert.match(page, /window\.location\.replace\(payload\.authorizationUrl/)
  assert.match(startRoute, /startEbayCommercialOrdersBrowserAuthorization/)
  assert.match(startRoute, /assertEbaySellerOAuthReauthAdmin/)
  assert.doesNotMatch(startRoute, /authorizationUrl:/)
})

test("browser exchange is deployment/actor bound and exposes bounded readiness only", () => {
  const service = readFileSync(
    "lib/ebay/ebay-commercial-orders-oauth-authorization.ts",
    "utf8",
  )
  const page = readFileSync(
    "app/admin/ebay/monitor/commercial-orders-oauth-start/page.tsx",
    "utf8",
  )
  assert.match(service, /deploymentIdentity: binding\.deploymentIdentity/)
  assert.match(service, /actorUserId: input\.actorUserId/)
  assert.match(service, /startTicketMinted: true/)
  assert.match(service, /startTicketUnconsumed: true/)
  assert.match(service, /clientExchangePathReady: true/)
  assert.match(service, /stateCookieCanBeIssued: true/)
  assert.match(service, /TICKET_ALREADY_CONSUMED/)
  assert.match(page,
    /EBAY_COMMERCIAL_ORDERS_BROWSER_START_CLIENT_EXCHANGE_NOT_EXECUTED/)
})

test("ceremony is fixed-scope and cannot select account, URL, token, or recipient", () => {
  const service = readFileSync(
    "lib/ebay/ebay-commercial-orders-oauth-authorization.ts",
    "utf8",
  )
  const activationRoute = readFileSync(
    "app/api/admin/ebay/commercial-orders-oauth/browser-start/route.ts",
    "utf8",
  )
  const page = readFileSync(
    "app/admin/ebay/monitor/commercial-orders-oauth-start/page.tsx",
    "utf8",
  )
  assert.match(service, /EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES\.join\(" "\)/)
  assert.match(service, /startHostMatchesCallbackHost: true/)
  assert.match(service, /runameResolvesToExpectedCallback: true/)
  assert.match(service, /rawStatePersisted: false/)
  assert.doesNotMatch(
    activationRoute,
    /actionPayload\.(?:account|accountId|url|token|recipient|phone)/,
  )
  assert.doesNotMatch(
    page,
    /searchParams\.get\("(?:account|accountId|url|token|recipient|phone)"\)/,
  )
})

test("seller callback completes encrypted handoff without rendering the token", () => {
  const callback = readFileSync(
    "app/api/admin/ebay/monitor/seller-oauth-reauth/route.ts",
    "utf8",
  )
  const specialized = callback.match(
    /function commercialOrdersSuccessHtml\(\) \{([\s\S]*?)\n\}/,
  )?.[1] ?? ""
  assert.match(callback, /hasPendingEbayCommercialOrdersAuthorization/)
  assert.match(callback, /completeEbayCommercialOrdersAuthorization/)
  assert.match(callback, /commercialOrdersSuccessHtml\(\)/)
  assert.match(specialized, /encrypted one-time handoff/)
  assert.doesNotMatch(specialized, /refreshToken|accessToken|authorizationCode/)
})
