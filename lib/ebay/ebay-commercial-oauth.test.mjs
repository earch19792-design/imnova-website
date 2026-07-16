import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  classifyEbayCommercialOAuthFailure,
  getEbayCommercialOAuthAction,
  getEbayCommercialOrdersOAuthConfiguration,
  getEbayCommercialReaderAuthState,
  settleEbayCommercialReaderPromises,
} from "./ebay-commercial-oauth-domain.ts"

test("clasifica refresh token sin fulfillment scope sin exponer respuesta cruda", () => {
  const privateDescription =
    "requested scope sell.fulfillment.readonly exceeds grant secret-marker"
  const category = classifyEbayCommercialOAuthFailure(400, {
    error: "invalid_scope",
    error_description: privateDescription,
  })
  assert.equal(category, "INVALID_SCOPE")
  assert.doesNotMatch(JSON.stringify({ category }), /secret-marker|error_description/)
  assert.match(getEbayCommercialOAuthAction(category), /Autorizar manualmente Orders/)
})

test("clasifica invalid_grant, token revocado y credenciales incompatibles", () => {
  assert.equal(classifyEbayCommercialOAuthFailure(400, {
    error: "invalid_grant",
  }), "INVALID_GRANT")
  assert.equal(classifyEbayCommercialOAuthFailure(400, {
    error: "invalid_grant",
    error_description: "refresh token expired",
  }), "REFRESH_TOKEN_REVOKED_OR_EXPIRED")
  assert.equal(classifyEbayCommercialOAuthFailure(400, {
    error: "invalid_grant",
    error_description: "authorization was issued to another client",
  }), "CLIENT_CREDENTIAL_MISMATCH")
  assert.equal(classifyEbayCommercialOAuthFailure(401, {
    error: "invalid_client",
  }), "CLIENT_CREDENTIAL_MISMATCH")
})

test("Orders exige refresh token dedicado y prohíbe fallback al token general", () => {
  const missingDedicated = getEbayCommercialOrdersOAuthConfiguration({
    EBAY_CLIENT_ID: "client-id",
    EBAY_CLIENT_SECRET: "client-secret",
    EBAY_SELLER_REFRESH_TOKEN: "validated-general-refresh",
  })
  assert.equal(missingDedicated.configured, false)
  assert.equal(missingDedicated.genericSellerRefreshToken, "PRESENT")
  assert.equal(missingDedicated.dedicatedOrdersRefreshToken, "MISSING")
  assert.equal(missingDedicated.generalRefreshTokenFallbackAllowed, false)

  const dedicated = getEbayCommercialOrdersOAuthConfiguration({
    EBAY_CLIENT_ID: "client-id",
    EBAY_CLIENT_SECRET: "client-secret",
    EBAY_SELLER_REFRESH_TOKEN: "validated-general-refresh",
    EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN: "orders-refresh",
  })
  assert.equal(dedicated.configured, true)
  assert.equal(dedicated.refreshTokenSource, "EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN")
  assert.equal(dedicated.secretsReturned, false)
})

test("Orders y Watchers se asientan de forma independiente", async () => {
  const first = await settleEbayCommercialReaderPromises({
    orders: Promise.reject(new Error("EBAY_COMMERCIAL_ORDERS_OAUTH_INVALID_SCOPE")),
    analytics: Promise.resolve({ status: "AVAILABLE" }),
    watchers: Promise.resolve({ status: "AVAILABLE", observations: [1] }),
  })
  assert.equal(first.orders.status, "rejected")
  assert.equal(first.analytics.status, "fulfilled")
  assert.equal(first.watchers.status, "fulfilled")

  const second = await settleEbayCommercialReaderPromises({
    orders: Promise.resolve({ status: "AVAILABLE", orders: [] }),
    analytics: Promise.resolve({ status: "AVAILABLE" }),
    watchers: Promise.reject(new Error("EBAY_WATCHERS_READ_500")),
  })
  assert.equal(second.orders.status, "fulfilled")
  assert.equal(second.analytics.status, "fulfilled")
  assert.equal(second.watchers.status, "rejected")
})

test("estado de auth es allowlisted y separa identidad de scopes", () => {
  assert.deepEqual(getEbayCommercialReaderAuthState(
    "orders",
    "EBAY_COMMERCIAL_ORDERS_OAUTH_INVALID_SCOPE",
  ), {
    status: "INVALID_SCOPE",
    requiredScope: "sell.fulfillment.readonly",
    scopeConfirmed: false,
    identityMatch: null,
    actionRequired: getEbayCommercialOAuthAction("INVALID_SCOPE"),
    rawOAuthDescriptionExposed: false,
  })
  const identity = getEbayCommercialReaderAuthState(
    "watchers",
    "EBAY_COMMERCIAL_ACCOUNT_IDENTITY_MISMATCH",
  )
  assert.equal(identity.status, "CLIENT_CREDENTIAL_MISMATCH")
  assert.equal(identity.identityMatch, false)
  assert.equal(identity.rawOAuthDescriptionExposed, false)
})

test("Watchers usa Trading read-only y no depende del proveedor Fulfillment", () => {
  const readers = readFileSync("lib/ebay/ebay-commercial-readers.ts", "utf8")
  const watchersStart = readers.indexOf("export async function getEbayListingWatchers")
  const analyticsStart = readers.indexOf("export async function getComparableEbayTrafficAnalytics")
  const watchers = readers.slice(watchersStart, analyticsStart)
  assert.match(watchers, /getEbayTradingReadOnlyAccessToken/)
  assert.doesNotMatch(watchers, /getEbayCommercialOrdersAccessToken/)
  assert.match(readers, /getEbayCommercialOrdersAccessToken\(fetchImpl\)/)
})

test("preflight y UI no exponen secretos ni habilitan escrituras", () => {
  const oauth = readFileSync("lib/ebay/ebay-commercial-oauth.ts", "utf8")
  const panel = readFileSync(
    "app/admin/ebay/mobile-review/commercial-monitor-panel.tsx",
    "utf8",
  )
  const route = readFileSync(
    "app/api/admin/ebay/commercial-monitor/route.ts",
    "utf8",
  )
  assert.doesNotMatch(oauth, /console\.(log|error|warn)/)
  assert.match(oauth, /rawOAuthDescriptionReturned: false/)
  assert.match(oauth, /getOrdersUsed: false/)
  assert.match(oauth, /getItemUsed: false/)
  assert.match(oauth, /ebayWriteUsed: false/)
  assert.match(oauth, /callback: getEbayCommercialOrdersCallbackConfiguration\(\)/)
  assert.doesNotMatch(panel, /error_description|refreshToken|clientSecret|accessToken/)
  assert.match(route, /input\.action === "oauth_preflight"/)
  assert.match(route, /input\.action !== "run"/)
  assert.match(route, /process\.env\.VERCEL_ENV === "production"/)
})
