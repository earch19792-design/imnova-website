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
  createEbayCommercialOAuthState,
  EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_ENDPOINT,
  EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES,
  encryptEbayCommercialRefreshToken,
  hashEbayCommercialOAuthState,
  validateEbayCommercialOAuthPublicKey,
} from "./ebay-commercial-orders-oauth-domain.ts"

test("genera state impredecible y URL Production con scopes exactos", () => {
  const first = createEbayCommercialOAuthState()
  const second = createEbayCommercialOAuthState()
  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first, second)
  assert.match(hashEbayCommercialOAuthState(first), /^[0-9a-f]{64}$/)

  const consent = new URL(buildEbayCommercialOrdersConsentUrl({
    clientId: "client-id-public",
    runame: "registered-runame",
    state: first,
  }))
  assert.equal(consent.origin + consent.pathname, EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_ENDPOINT)
  assert.equal(consent.searchParams.get("client_id"), "client-id-public")
  assert.equal(consent.searchParams.get("redirect_uri"), "registered-runame")
  assert.equal(consent.searchParams.get("response_type"), "code")
  assert.equal(consent.searchParams.get("scope"), EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES.join(" "))
  assert.equal(consent.searchParams.get("state"), first)
  assert.deepEqual(EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES, [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  ])
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
  assert.match(service, /grant_type: "authorization_code"/)
  assert.match(service, /grant_type: "refresh_token"/)
  assert.match(service, /verifyEbayCommercialOfficialAccount/)
  assert.match(service, /VERCEL_ENV === "preview"/)
  assert.match(service, /feature\/centralize-ebay-mobile-command-center/)
  assert.doesNotMatch(service, /getOrders\s*\(|publishOffer|createOrder|reviseInventoryStatus/i)
  assert.doesNotMatch(service + callback + start, /console\.(log|warn|error)/)
  assert.doesNotMatch(callback, /error_description|access_token|refresh_token|client_secret/i)
  assert.match(callback, /Referrer-Policy": "no-referrer"/)
  assert.match(callback, /Cache-Control": "no-store/)
  assert.match(start, /validateAdminApiRequest/)
  assert.match(registeredCallback, /\^\[A-Za-z0-9_-\]\{43\}\$/)
  assert.match(registeredCallback, /processCommercialOrdersCallback\(req\)/)
  assert.match(registeredCallback, /getBlockedOauthCallbackResponse/)
})

test("handoff staging es aditivo, RLS forzado y sólo service_role", () => {
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
})
