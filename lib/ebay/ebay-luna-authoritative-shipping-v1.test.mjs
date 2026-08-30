import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
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
} })

const {
  acquireAuthoritativeLunaShippingV1,
  evaluateLunaShippingEconomicsV1,
  normalizeLunaShippingIdentityV1,
  parseLunaRetryAfterV1,
} = await import("./ebay-luna-authoritative-shipping-v1.ts")
const {
  attemptLunaAuthenticatedHttpShippingQuoteV1,
  SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1,
} = await import("./ebay-luna-authoritative-shipping-server-v1.ts")

function identity(hex = "1") {
  return {
    candidateId: `sha256:${hex.repeat(64)}`,
    canonicalProductUrl: "https://lunaportex.com/products/exact-product",
    lunaProductId: "9220832493792",
    lunaVariantId: "48809643540704",
    supplierSku: "ITEM3734",
    quantity: 1,
  }
}

const destination = {
  profileId: "CANONICAL_US_PROFILE",
  profileDigest: `sha256:${"a".repeat(64)}`,
  country: "US",
  province: "FL",
  postalCode: "33487",
}

function quote(method = "LUNA_PROTECTED_BROWSER_CHECKOUT_SHIPPING") {
  return {
    status: "AVAILABLE",
    subtotalUsd: 10.96,
    shippingAmountUsd: 4.25,
    currency: "USD",
    acquisitionMethod: method,
    observedAt: "2026-08-24T17:00:00.000Z",
    evidenceDigest: `sha256:${"b".repeat(64)}`,
    exactLunaIdentity: true,
    destinationProfileId: destination.profileId,
    destinationProfileDigest: destination.profileDigest,
    noPurchase: true,
    noPayment: true,
  }
}

function limited(delay = 60_000) {
  return {
    status: "LUNA_RATE_LIMITED",
    blocker: "LUNA_RATE_LIMITED",
    retryAfterMs: delay,
    retryNotBefore: "2026-08-24T17:01:00.000Z",
    purchasePerformed: false,
    paymentPerformed: false,
  }
}

test("HTTP success is used without launching browser fallback", async () => {
  let browserCalls = 0
  const result = await acquireAuthoritativeLunaShippingV1({
    identity: identity("1"), destination,
    httpAcquire: async () => quote("LUNA_AUTHENTICATED_HTTP_CART_SHIPPING"),
    browserAcquire: async () => { browserCalls += 1; return quote() },
    now: Date.parse("2026-08-24T17:00:00.000Z"),
  })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.browserFallbackUsed, false)
  assert.equal(result.http429Handled, false)
  assert.equal(browserCalls, 0)
})

test("CURRENT LIVE reader scope reuses the same acquisition authority without a fake candidate", async () => {
  const liveIdentity = { ...identity("1") }
  delete liveIdentity.candidateId
  liveIdentity.readerScopeId =
    `live-listing-shipping-reader-v1:sha256:${"9".repeat(64)}`
  const result = await acquireAuthoritativeLunaShippingV1({
    identity: liveIdentity, destination,
    httpAcquire: async () => quote("LUNA_AUTHENTICATED_HTTP_CART_SHIPPING"),
    browserAcquire: async () => quote(),
    now: Date.parse("2026-08-24T17:00:00.000Z"),
  })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(liveIdentity.candidateId, undefined)
})

test("canonical Luna reader accepts a real bounded long product handle", async () => {
  const longIdentity = {
    ...identity("8"),
    canonicalProductUrl:
      "https://lunaportex.com/products/language-translator-device-portable-translator-device-with-138-languages-4-1-touch-screen-smart-voice-photo-translator-real-time-offline-online-translation-for-business-learning-travel-black",
  }
  const normalized = normalizeLunaShippingIdentityV1(longIdentity)
  const result = await acquireAuthoritativeLunaShippingV1({
    identity: longIdentity, destination,
    httpAcquire: async () => quote("LUNA_AUTHENTICATED_HTTP_CART_SHIPPING"),
    browserAcquire: async () => quote(),
    now: Date.parse("2026-08-24T17:00:00.000Z"),
  })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(normalized.canonicalProductUrl, longIdentity.canonicalProductUrl.replace(
    "https://lunaportex.com", "https://www.lunaportex.com"))
})

test("HTTP 429 is classified once and switches to protected browser", async () => {
  let httpCalls = 0
  let browserCalls = 0
  const result = await acquireAuthoritativeLunaShippingV1({
    identity: identity("2"), destination,
    httpAcquire: async () => { httpCalls += 1; return limited() },
    browserAcquire: async () => { browserCalls += 1; return quote() },
    now: Date.parse("2026-08-24T17:00:00.000Z"),
  })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.http429Handled, true)
  assert.equal(result.browserFallbackUsed, true)
  assert.equal(httpCalls, 1)
  assert.equal(browserCalls, 1)
})

test("active Retry-After window never hammers HTTP again", async () => {
  let httpCalls = 0
  let browserCalls = 0
  const candidate = identity("3")
  await acquireAuthoritativeLunaShippingV1({
    identity: candidate, destination,
    httpAcquire: async () => { httpCalls += 1; return limited(120_000) },
    browserAcquire: async () => { browserCalls += 1; return quote() },
    now: Date.parse("2026-08-24T17:00:00.000Z"),
  })
  await acquireAuthoritativeLunaShippingV1({
    identity: candidate, destination,
    httpAcquire: async () => { httpCalls += 1; return limited(120_000) },
    browserAcquire: async () => { browserCalls += 1; return quote() },
    now: Date.parse("2026-08-24T17:00:30.000Z"),
  })
  assert.equal(httpCalls, 1)
  assert.equal(browserCalls, 2)
})

test("browser unavailable blocks without inventing a shipping amount", async () => {
  const result = await acquireAuthoritativeLunaShippingV1({
    identity: identity("4"), destination,
    httpAcquire: async () => limited(),
    browserAcquire: async () => ({ status: "BLOCKED",
      blocker: "LUNA_PROTECTED_BROWSER_UNAVAILABLE", retryAfterMs: null,
      retryNotBefore: null, purchasePerformed: false,
      paymentPerformed: false }),
    now: Date.parse("2026-08-24T17:00:00.000Z"),
  })
  assert.equal(result.status, "BLOCKED")
  assert.equal(result.quote, null)
  assert.equal(result.blocker, "LUNA_PROTECTED_BROWSER_UNAVAILABLE")
})

test("Retry-After accepts seconds and HTTP date with a bounded horizon", () => {
  const now = Date.parse("2026-08-24T17:00:00.000Z")
  assert.equal(parseLunaRetryAfterV1("120", now), 120_000)
  assert.equal(parseLunaRetryAfterV1("Sun, 24 Aug 2026 17:02:00 GMT", now),
    120_000)
  assert.equal(parseLunaRetryAfterV1("999999", now), 900_000)
})

test("authoritative shipping feeds the existing canonical economics policy", () => {
  const profitable = evaluateLunaShippingEconomicsV1({
    salePriceUsd: 27.17,
    supplierCostUsd: 10.96,
    shippingQuote: quote(),
  })
  assert.equal(profitable.contributionProfitUsd, 4.96)
  assert.equal(profitable.contributionMarginPercent, 18.25)
  assert.equal(profitable.status, "PROVEN_UNPROFITABLE")
  const blocked = evaluateLunaShippingEconomicsV1({
    salePriceUsd: 27.17, supplierCostUsd: 10.96, shippingQuote: null,
  })
  assert.equal(blocked.contributionProfitUsd, null)
})

test("authenticated HTTP cart path returns one exact authoritative rate and restores cart", async () => {
  const responses = [
    new Response(JSON.stringify({ items: [] }), { status: 200 }),
    new Response(JSON.stringify({}), { status: 200 }),
    new Response(JSON.stringify({ product_id: "9220832493792",
      variant_id: "48809643540704", sku: "ITEM3734",
      final_line_price: 1096 }), { status: 200 }),
    new Response(JSON.stringify({ shipping_rates: [{ price: "4.25",
      currency: "USD" }] }), { status: 200 }),
    new Response(JSON.stringify({}), { status: 200 }),
  ]
  const calls = []
  const result = await attemptLunaAuthenticatedHttpShippingQuoteV1(
    identity("5"), {
      resolveProtectedSession: async () => "session=opaque-fixture",
      fetchImpl: async (url, init) => {
        calls.push({ path: new URL(url).pathname, method: init?.method })
        const response = responses.shift()
        assert.ok(response)
        return response
      },
    })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.shippingAmountUsd, 4.25)
  assert.equal(result.exactLunaIdentity, true)
  assert.deepEqual(calls.map((call) => call.path), [
    "/cart.js", "/cart/clear.js", "/cart/add.js",
    "/cart/shipping_rates.json", "/cart/clear.js",
  ])
})

test("V2 shipping jar never leaks account or account-path cookies into cart requests", async () => {
  const expiresAt = "2026-09-01T00:00:00.000Z"
  const responses = [
    new Response(JSON.stringify({ items: [] }), { status: 200, headers: {
      "Set-Cookie": "cart_session=cart-fixture; Path=/; Secure",
    } }),
    new Response(JSON.stringify({}), { status: 200 }),
    new Response(JSON.stringify({ product_id: "9220832493792",
      variant_id: "48809643540704", sku: "ITEM3734",
      final_line_price: 1096 }), { status: 200 }),
    new Response(JSON.stringify({ shipping_rates: [{ price: "4.25",
      currency: "USD" }] }), { status: 200 }),
    new Response(JSON.stringify({}), { status: 200 }),
  ]
  const observedCookies = []
  const result = await attemptLunaAuthenticatedHttpShippingQuoteV1(
    identity("7"), {
      resolveProtectedSession: async () => ({
        contractVersion: "SELLER_OS_LUNA_PROTECTED_SESSION_V2",
        capturedAt: "2026-08-30T00:00:00.000Z",
        validatedAt: "2026-08-30T00:00:00.000Z",
        expiresAt,
        cookieJar: [{
          name: "customer_account_session", value: "www-account-path-fixture",
          domain: "www.lunaportex.com", path: "/account", secure: true,
          hostOnly: true, expiresAt,
        }, {
          name: "account_session", value: "account-host-fixture",
          domain: "account.lunaportex.com", path: "/orders", secure: true,
          hostOnly: true, expiresAt,
        }],
      }),
      fetchImpl: async (_url, init) => {
        observedCookies.push(new Headers(init?.headers).get("cookie"))
        const response = responses.shift()
        assert.ok(response)
        return response
      },
    })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(observedCookies[0], null)
  assert.deepEqual(observedCookies.slice(1), Array(4).fill(
    "cart_session=cart-fixture"))
  assert.doesNotMatch(observedCookies.filter(Boolean).join(";"),
    /www-account-path-fixture|account-host-fixture/)
})

test("authenticated HTTP 429 is returned once with Retry-After and no mutation", async () => {
  let calls = 0
  const result = await attemptLunaAuthenticatedHttpShippingQuoteV1(
    identity("6"), {
      resolveProtectedSession: async () => "session=opaque-fixture",
      fetchImpl: async () => {
        calls += 1
        return new Response(JSON.stringify({}), {
          status: 429, headers: { "Retry-After": "120" },
        })
      },
    })
  assert.equal(result.status, "LUNA_RATE_LIMITED")
  assert.equal(result.retryAfterMs, 120_000)
  assert.equal(calls, 1)
})

test("shipping delta is bounded, server-only, and has no order or payment path", async () => {
  const [contract, server, worker] = await Promise.all([
    "./ebay-luna-authoritative-shipping-v1.ts",
    "./ebay-luna-authoritative-shipping-server-v1.ts",
    "./ebay-luna-canonical-browser-worker-server-v1.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")))
  assert.doesNotMatch(contract + server,
    /\.insert\(|\.upsert\(|create table|scheduler|queue/i)
  assert.doesNotMatch(server,
    /\/checkouts?|place.?order|\/orders(?:\/|\b)|payment_intent|purchase_order/i)
  assert.match(worker, /fetchLunaProtectedBrowserShippingQuoteV1/)
  assert.match(worker, /\/cart\/shipping_rates\.json/)
  assert.doesNotMatch(worker,
    /\/checkouts?|place.?order|\/orders(?:\/|\b)|payment_intent/i)
  assert.equal(SELLER_OS_CANONICAL_LUNA_SHIPPING_DESTINATION_V1.country, "US")
})
