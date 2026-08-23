import assert from "node:assert/strict"
import {
  constants,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildEbayCommercialOrdersConsentUrl,
  buildEbayCommercialOrdersDiagnosticConsentUrl,
  createEbayCommercialOAuthState,
  EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_ENDPOINT,
  EBAY_COMMERCIAL_ORDERS_BASE_SCOPE,
  EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_PATH,
  EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_URL,
  EBAY_COMMERCIAL_ORDERS_COMMERCE_MESSAGE_SCOPE,
  EBAY_COMMERCIAL_ORDERS_FULFILLMENT_READONLY_SCOPE,
  EBAY_COMMERCIAL_ORDERS_LEGACY_CALLBACK_PATH,
  EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES,
  encryptEbayCommercialRefreshToken,
  getEbayCommercialOrdersCallbackConfiguration,
  hashEbayCommercialOAuthState,
  isValidEbayCommercialAuthorizationCode,
  isValidEbayCommercialOAuthState,
  validateEbayCommercialOAuthPublicKey,
} from "./ebay-commercial-orders-oauth-domain.ts"

test("genera state impredecible y URL Production con scopes exactos", () => {
  const first = createEbayCommercialOAuthState()
  const second = createEbayCommercialOAuthState()
  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first, second)
  assert.match(hashEbayCommercialOAuthState(first), /^[0-9a-f]{64}$/)

  const consentText = buildEbayCommercialOrdersConsentUrl({
    clientId: "client-id-public",
    runame: "registered-runame",
    state: first,
  })
  assert.match(consentText, /scope=[^&]+%20https%3A/)
  assert.doesNotMatch(consentText, /scope=[^&]+\+https%3A/)
  const consent = new URL(consentText)
  assert.equal(consent.origin + consent.pathname, EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_ENDPOINT)
  assert.equal(consent.searchParams.get("client_id"), "client-id-public")
  assert.equal(consent.searchParams.get("redirect_uri"), "registered-runame")
  assert.equal(consent.searchParams.get("response_type"), "code")
  assert.equal(consent.searchParams.get("scope"), EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES.join(" "))
  assert.equal(consent.searchParams.get("state"), first)
  assert.equal(consent.searchParams.has("prompt"), false)
  assert.deepEqual(EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES, [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
    "https://api.ebay.com/oauth/api_scope/commerce.message",
  ])
})

test("aísla base, state y fulfillment sin doble codificación", () => {
  const state = createEbayCommercialOAuthState()
  const common = {
    clientId: "client-id-public",
    runame: "registered-runame_exact",
  }
  const minimalText = buildEbayCommercialOrdersDiagnosticConsentUrl({
    ...common,
    phase: "base_only",
  })
  const minimal = new URL(minimalText)
  assert.deepEqual([...minimal.searchParams.keys()], [
    "client_id",
    "response_type",
    "redirect_uri",
    "scope",
  ])
  assert.equal(minimal.searchParams.get("redirect_uri"), common.runame)
  assert.equal(minimal.searchParams.get("scope"), EBAY_COMMERCIAL_ORDERS_BASE_SCOPE)
  assert.equal(minimal.searchParams.has("state"), false)
  assert.equal(minimal.searchParams.has("prompt"), false)

  const withState = new URL(buildEbayCommercialOrdersDiagnosticConsentUrl({
    ...common,
    phase: "base_with_state",
    state,
  }))
  assert.equal(withState.searchParams.get("state"), state)
  assert.equal(withState.searchParams.get("scope"), EBAY_COMMERCIAL_ORDERS_BASE_SCOPE)

  const fullText = buildEbayCommercialOrdersDiagnosticConsentUrl({
    ...common,
    phase: "base_with_state_and_fulfillment",
    state,
  })
  const full = new URL(fullText)
  assert.equal(full.searchParams.get("scope"), [
    EBAY_COMMERCIAL_ORDERS_BASE_SCOPE,
    EBAY_COMMERCIAL_ORDERS_FULFILLMENT_READONLY_SCOPE,
    EBAY_COMMERCIAL_ORDERS_COMMERCE_MESSAGE_SCOPE,
  ].join(" "))
  assert.match(fullText, /scope=[^&]+%20https%3A/)
  assert.doesNotMatch(fullText, /%252F|\+/)
  assert.match(state, /^[A-Za-z0-9_-]{43}$/)
})

test("declara el callback Seller same-host real como canónico y mantiene legacy bloqueado", () => {
  assert.equal(
    EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_PATH,
    "/api/admin/ebay/monitor/seller-oauth-reauth",
  )
  assert.equal(
    EBAY_COMMERCIAL_ORDERS_LEGACY_CALLBACK_PATH,
    "/api/admin/ebay/oauth/callback",
  )
  assert.equal(
    EBAY_COMMERCIAL_ORDERS_CANONICAL_CALLBACK_URL,
    "https://imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app/api/admin/ebay/monitor/seller-oauth-reauth",
  )
  const callback = getEbayCommercialOrdersCallbackConfiguration({
    VERCEL_BRANCH_URL:
      "imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app",
  })
  assert.equal(callback.deployedBranchHostStatus, "MATCH")
  assert.equal(callback.legacyCallbackBlocked, true)
  assert.equal(callback.secretsReturned, false)

  const cliPreviewCallback = getEbayCommercialOrdersCallbackConfiguration(
    {
      VERCEL_GIT_COMMIT_REF:
        "feature/seller-os-canonical-integration-foundation-v1",
    },
    "imnova-website-z1qh-git-featur-6c9e25-earch19792-6888s-projects.vercel.app",
  )
  assert.equal(cliPreviewCallback.deployedBranchHostStatus, "MATCH")
})

test("valida formato de state y authorization code antes de reclamar handoff", () => {
  const state = createEbayCommercialOAuthState()
  assert.equal(isValidEbayCommercialOAuthState(state), true)
  assert.equal(isValidEbayCommercialOAuthState(""), false)
  assert.equal(isValidEbayCommercialOAuthState(`${state}x`), false)
  assert.equal(isValidEbayCommercialAuthorizationCode("authorization-code"), true)
  assert.equal(isValidEbayCommercialAuthorizationCode(""), false)
  assert.equal(isValidEbayCommercialAuthorizationCode("x".repeat(2_049)), false)
})

test("cifra el refresh token para un consumidor efímero sin devolver plaintext", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 4_096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
  assert.equal(validateEbayCommercialOAuthPublicKey(publicKey), true)
  const secretMarker = "refresh-token-private-marker"
  const envelopeText = encryptEbayCommercialRefreshToken(secretMarker, publicKey)
  assert.doesNotMatch(envelopeText, /refresh-token-private-marker/)
  const envelope = JSON.parse(envelopeText)
  assert.equal(envelope.version, "RSA_OAEP_SHA256_AES_256_GCM_V1")

  const key = privateDecrypt({
    key: privateKey,
    oaepHash: "sha256",
    padding: constants.RSA_PKCS1_OAEP_PADDING,
  }, Buffer.from(envelope.encryptedKey, "base64"))
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ])
  assert.equal(plaintext.toString("utf8"), secretMarker)
  plaintext.fill(0)
  key.fill(0)
})

test("callback hace intercambio server-side, GetUser y no llama Orders ni APIs de escritura", () => {
  const service = readFileSync(
    "lib/ebay/ebay-commercial-orders-oauth-authorization.ts",
    "utf8",
  )
  const callback = readFileSync(
    "app/api/admin/ebay/commercial-orders-oauth/callback/route.ts",
    "utf8",
  )
  const start = readFileSync(
    "app/api/admin/ebay/commercial-orders-oauth/start/route.ts",
    "utf8",
  )
  const registeredCallback = readFileSync(
    "app/api/admin/ebay/oauth/callback/route.ts",
    "utf8",
  )
  const diagnosticRoute = readFileSync(
    "app/api/admin/ebay/commercial-orders-oauth/diagnostic/route.ts",
    "utf8",
  )
  const environmentPreflight = readFileSync(
    "app/api/admin/ebay/configuration/preflight/route.ts",
    "utf8",
  )
  const runbook = readFileSync(
    "docs/ebay-pro-isolation/EBAY_SALES_COMMERCIAL_MONITOR_V1.md",
    "utf8",
  )
  assert.match(service, /grant_type: "authorization_code"/)
  assert.match(service, /grant_type: "refresh_token"/)
  assert.match(service, /verifyEbayCommercialOfficialAccount/)
  assert.match(service, /VERCEL_ENV === "preview"/)
  assert.match(service, /feature\/seller-os-canonical-integration-foundation-v1/)
  assert.doesNotMatch(service,
    /AUTHORIZED_PREVIEW_BRANCH = "feature\/centralize-ebay-mobile-(?:command-)?center"/)
  assert.doesNotMatch(service, /getOrders\s*\(|publishOffer|createOrder|reviseInventoryStatus/i)
  assert.doesNotMatch(service + callback + start, /console\.(log|warn|error)/)
  assert.doesNotMatch(callback, /error_description|access_token|refresh_token|client_secret/i)
  assert.match(callback, /Referrer-Policy": "no-referrer"/)
  assert.match(callback, /Cache-Control": "no-store/)
  assert.match(start, /validateAdminApiRequest/)
  assert.match(registeredCallback, /getBlockedOauthCallbackResponse/)
  assert.doesNotMatch(registeredCallback, /processCommercialOrdersCallback|commercial-orders-oauth/)
  assert.match(callback, /completeEbayCommercialOrdersAuthorization/)
  assert.match(callback, /searchParams\.get\("code"\)/)
  assert.match(callback, /searchParams\.get\("state"\)/)
  assert.match(callback, /isValidEbayCommercialOAuthState\(input\.state\)/)
  assert.match(callback, /isValidEbayCommercialAuthorizationCode\(input\.code\)/)
  assert.match(callback, /searchParams\.set\("reason", reason\)/)
  assert.doesNotMatch(callback, /searchParams\.set\("code"/)
  assert.match(callback, /Referrer-Policy": "no-referrer"/)
  assert.match(callback, /X-Robots-Tag": "noindex"/)
  assert.match(environmentPreflight, /getEbayCommercialOrdersAuthorizationConfiguration/)
  assert.match(runbook, /seller-oauth-reauth/)
  assert.match(runbook, /ruta legacy[\s\S]*permanece bloqueada/i)
  assert.match(diagnosticRoute, /validateAdminApiRequest/)
  assert.match(diagnosticRoute, /diagnoseEbayCommercialOrdersConsentRequest/)
  assert.doesNotMatch(diagnosticRoute, /authorizationUrl|clientSecret|refreshToken|accessToken/)
  assert.match(service, /handoffCreated: false/)
  assert.match(service, /authorizationUrlReturned: false/)
  assert.match(service, /ebayWriteUsed: false/)
  assert.match(service, /effectiveClientIdFingerprint/)
  assert.match(service, /effectiveRuNameFingerprint/)
  assert.match(service, /dedicatedClientPairPresent/)
  assert.match(service, /clientSource/)
  assert.match(service, /runameSource/)
  assert.match(service, /leadingOrTrailingWhitespace/)
  assert.match(service, /controlOrInvisibleCharacters/)
  assert.match(service, /percentEncodedValues/)
  assert.doesNotMatch(service, /effectiveClientSecretFingerprint/)
  assert.match(service, /\.eq\("state_hash", hashEbayCommercialOAuthState\(input\.state\)\)/)
  assert.match(service, /\.eq\("status", "pending"\)/)
  assert.match(service, /\.gt\("expires_at", now\)/)
  assert.match(service, /\.maybeSingle\(\)/)
})

test("handoff staging es aditivo, RLS forzado y sólo service_role", () => {
  const service = readFileSync(
    "lib/ebay/ebay-commercial-orders-oauth-authorization.ts",
    "utf8",
  )
  const migration = readFileSync(
    "supabase/migrations/20260715133000_create_ebay_commercial_oauth_handoffs.sql",
    "utf8",
  )
  assert.doesNotMatch(migration, /\bdrop\b|\btruncate\b|\bdelete\s+from\b/i)
  assert.doesNotMatch(migration, /\bauthorization_code\b|\baccess_token\b/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /revoke all[\s\S]*from anon, authenticated/i)
  assert.match(migration, /grant select, insert, update, delete[\s\S]*to service_role/i)
  assert.match(migration, /state_hash text not null unique/i)
  assert.match(migration, /encrypted_refresh_token text null/i)
  assert.match(service, /update\(\{ status: "claimed"/)
  assert.match(service, /\.eq\("status", "pending"\)/)
  assert.match(service, /status: "failed"/)
  assert.match(service, /\.eq\("status", "claimed"\)/)
})
