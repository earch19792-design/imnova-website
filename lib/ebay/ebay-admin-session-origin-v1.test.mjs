import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { isSameSellerOsAdminOriginV1 } from
  "../admin-session-origin-v1.ts"
import { getSafeAdminReturnPath } from "../admin-auth-return.ts"

function allowed(origin, requestUrl =
  "http://localhost:3000/api/admin/session", secFetchSite = "same-origin") {
  return isSameSellerOsAdminOriginV1({ requestUrl, origin, secFetchSite })
}

test("admin session treats fixed localhost loopback aliases as one origin", () => {
  assert.equal(allowed("http://127.0.0.1:3000"), true)
  assert.equal(allowed("http://[::1]:3000"), true)
  assert.equal(allowed("http://localhost:3000",
    "http://127.0.0.1:3000/api/admin/session"), true)
  assert.equal(allowed("https://seller.example",
    "https://seller.example/api/admin/session"), true)
})

test("admin session origin normalization remains closed to non-equivalent origins", () => {
  assert.equal(allowed("https://127.0.0.1:3000"), false)
  assert.equal(allowed("http://127.0.0.1:3001"), false)
  assert.equal(allowed("http://127.0.0.2:3000"), false)
  assert.equal(allowed("http://localhost.evil.example:3000"), false)
  assert.equal(allowed("http://attacker.example:3000"), false)
  assert.equal(allowed("null"), false)
  assert.equal(allowed("http://127.0.0.1:3000/path"), false)
  assert.equal(allowed("http://user@127.0.0.1:3000"), false)
})

test("admin session rejects cross-site fetch metadata before origin aliasing", () => {
  assert.equal(allowed("http://127.0.0.1:3000",
    "http://localhost:3000/api/admin/session", "cross-site"), false)
  assert.equal(allowed("http://127.0.0.1:3000",
    "http://localhost:3000/api/admin/session", "same-site"), false)
  assert.equal(allowed(null,
    "http://localhost:3000/api/admin/session", "cross-site"), false)
  assert.equal(allowed(null,
    "http://localhost:3000/api/admin/session", null), true)
})

test("admin cookie remains HttpOnly, strict, admin-scoped and HTTPS-secure", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/session/route.ts", import.meta.url), "utf8")
  const cookieContract = readFileSync(new URL(
    "../admin-session-cookie-contract.ts", import.meta.url), "utf8")
  assert.match(cookieContract, /httpOnly:\s*true/)
  assert.match(cookieContract,
    /secure:\s*process\.env\.NODE_ENV\s*===\s*"production"/)
  assert.match(cookieContract, /sameSite:\s*"strict"/)
  assert.match(route,
    /sellerOsAdminSessionCookieOptions\("\/admin", 60 \* 60\)/)
  assert.match(cookieContract,
    /"\/api\/admin\/ebay\/publication-oauth\/start"/)
  assert.match(route, /isSameSellerOsAdminOriginV1/)
  assert.doesNotMatch(route + cookieContract,
    /ADMIN_SESSION_SECRET|caller.*cookie|localStorage/i)
})

test("admin login preserves the exact Luna ceremony return path", () => {
  assert.equal(getSafeAdminReturnPath(
    "/admin/ebay/luna-protected-session"),
  "/admin/ebay/luna-protected-session")
  assert.equal(getSafeAdminReturnPath("//attacker.example/admin"), "/admin")
  assert.equal(getSafeAdminReturnPath("https://attacker.example/admin"),
    "/admin")
})

test("admin login fails bounded instead of leaving the owner stuck", () => {
  const login = readFileSync(new URL(
    "../../app/admin/login/page.tsx", import.meta.url), "utf8")
  const session = readFileSync(new URL(
    "../../app/api/admin/session/route.ts", import.meta.url), "utf8")
  const middleware = readFileSync(new URL(
    "../../middleware.ts", import.meta.url), "utf8")

  assert.match(login, /ADMIN_SESSION_ESTABLISH_TIMEOUT_MS\s*=\s*20_000/)
  assert.match(login, /controller\.abort\(\)/)
  assert.match(login, /window\.location\.replace\(returnTo\)/)
  assert.match(login, /Protegiendo sesión\.\.\./)
  assert.match(login, /Abriendo Seller OS\.\.\./)
  assert.match(session, /ADMIN_SESSION_VALIDATION_TIMEOUT_MS\s*=\s*15_000/)
  assert.match(session, /admin_session_validation_timeout/)
  assert.match(session, /status:\s*503/)
  assert.match(middleware, /ADMIN_TOKEN_VERIFY_TIMEOUT_MS\s*=\s*15_000/)
  assert.match(middleware, /"UNAVAILABLE"/)
  assert.match(middleware,
    /token\s*&&\s*verification\s*===\s*"INVALID"/)
  assert.match(middleware,
    /ADMIN_AUTH_TEMPORARILY_UNAVAILABLE/)
})
