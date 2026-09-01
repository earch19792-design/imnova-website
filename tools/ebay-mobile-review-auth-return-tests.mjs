import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { DEFAULT_ADMIN_RETURN_PATH, getSafeAdminReturnPath } from "../lib/admin-auth-return.ts"

const loginSource = readFileSync("app/admin/login/page.tsx", "utf8")
const mobileReviewSource = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")

test("admin return path accepts internal admin destinations", () => {
  assert.equal(getSafeAdminReturnPath("/admin/ebay/mobile-review"), "/admin/ebay/mobile-review")
  assert.equal(getSafeAdminReturnPath("/admin/market-radar?tab=products"), "/admin/market-radar?tab=products")
})

test("admin return path rejects external and malformed destinations", () => {
  for (const unsafe of [null, "", "https://evil.example/admin", "//evil.example/admin", "/store", "javascript:alert(1)"]) {
    assert.equal(getSafeAdminReturnPath(unsafe), DEFAULT_ADMIN_RETURN_PATH)
  }
})

test("Mobile Review offers login only for AUTH_REQUIRED and login returns safely", () => {
  assert.match(mobileReviewSource, /loadState === "AUTH_REQUIRED"/)
  assert.match(mobileReviewSource, /\/admin\/login\?returnTo=%2Fadmin%2Febay%2Fmobile-review/)
  assert.match(mobileReviewSource, /Iniciar sesión/)
  assert.match(loginSource, /getSafeAdminReturnPath/)
  assert.match(loginSource, /window\.location\.replace\(returnTo\)/)
})

test("auth return fix does not add external writes or secrets", () => {
  const combined = `${loginSource}\n${mobileReviewSource}`
  for (const forbidden of [/\.insert\s*\(/, /\.update\s*\(/, /\.upsert\s*\(/, /publishOffer\s*\(/, /process\.env/, /OPENAI_API_KEY/]) {
    assert.doesNotMatch(combined, forbidden)
  }
})
