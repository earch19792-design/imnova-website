import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const jar = await import("./ebay-luna-session-cookie-jar-v2.ts")
const NOW = Date.parse("2026-08-30T06:00:00.000Z")
const EXPIRES = "2026-08-30T07:00:00.000Z"

const cookies = Object.freeze([{
  name: "customer_account_session", value: "www-host-only-fixture",
  domain: "www.lunaportex.com", path: "/account", secure: true,
  hostOnly: true, expiresAt: EXPIRES,
}, {
  name: "account_session", value: "account-host-only-fixture",
  domain: "account.lunaportex.com", path: "/orders", secure: true,
  hostOnly: true, expiresAt: EXPIRES,
}])

test("two exclusive cookies remain scoped to their exact host and path", () => {
  const parsed = jar.parseSellerOsLunaSessionCookieJarV2(cookies,
    NOW + 30 * 60_000)
  assert.ok(parsed)
  assert.equal(jar.sellerOsLunaCookieHeaderForUrlV2(parsed,
    "https://www.lunaportex.com/account", NOW),
  "customer_account_session=www-host-only-fixture")
  assert.equal(jar.sellerOsLunaCookieHeaderForUrlV2(parsed,
    "https://account.lunaportex.com/orders", NOW),
  "account_session=account-host-only-fixture")
  assert.equal(jar.sellerOsLunaCookieHeaderForUrlV2(parsed,
    "https://www.lunaportex.com/cart.js", NOW), null)
  assert.equal(jar.sellerOsLunaCookieHeaderForUrlV2(parsed,
    "https://lunaportex.com/account", NOW), null)
})

test("expired cookies and duplicate identities remain fail-closed", () => {
  const parsed = jar.parseSellerOsLunaSessionCookieJarV2(cookies, NOW)
  assert.ok(parsed)
  assert.equal(jar.sellerOsLunaCookieHeaderForUrlV2(parsed,
    "https://www.lunaportex.com/account", Date.parse(EXPIRES)), null)
  assert.equal(jar.parseSellerOsLunaSessionCookieJarV2([
    cookies[0], { ...cookies[0], value: "conflicting-fixture" },
  ], NOW), null)
})
